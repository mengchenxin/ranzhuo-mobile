const providerDefaults = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
    apiKey: "ollama",
  },
  custom: {
    baseUrl: "http://127.0.0.1:8000/v1",
    model: "",
  },
};
const circuitStates = new Map();
const circuitFailureThreshold = Math.max(
  1,
  Number(process.env.RANZHUO_CIRCUIT_FAILURE_THRESHOLD || 3),
);
const circuitCooldownMs = Math.max(
  1000,
  Number(process.env.RANZHUO_CIRCUIT_COOLDOWN_MS || 30_000),
);

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function resolveProvider(input = {}, headerKey = "") {
  const provider = input.provider || "deepseek";
  const defaults = providerDefaults[provider] || providerDefaults.custom;
  const baseUrl = trimTrailingSlash(input.baseUrl || defaults.baseUrl);
  const apiKey =
    input.apiKey ||
    headerKey ||
    (defaults.apiKeyEnv ? process.env[defaults.apiKeyEnv] : "") ||
    defaults.apiKey ||
    "";

  return {
    provider,
    baseUrl,
    model: input.model || defaults.model,
    apiKey,
    temperature:
      Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.85,
  };
}

function requireModel(config) {
  if (!config.model) throw new Error("模型名称不能为空");
  if (!config.baseUrl) throw new Error("服务地址不能为空");
  if (!config.apiKey && config.provider !== "ollama") {
    throw new Error("缺少 " + config.provider + " 的 API 密钥");
  }
}

function upstreamError(payload, status) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    "模型服务返回 HTTP " + status;
  const error = new Error(message);
  error.status = status;
  return error;
}

function isRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!isRetryableStatus(response.status) || attempt === attempts - 1) {
        return {
          response,
          attempts: attempt + 1,
        };
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 250 * 2 ** attempt + Math.round(Math.random() * 120)),
    );
  }

  throw new Error(
    "模型服务网络不可达" + (lastError?.message ? "：" + lastError.message : ""),
  );
}

function providerKey(config) {
  return [config.provider, config.baseUrl, config.model].join("|");
}

function getCircuit(config) {
  const key = providerKey(config);
  const current = circuitStates.get(key) || {
    key,
    provider: config.provider,
    model: config.model,
    failures: 0,
    openUntil: 0,
    lastError: "",
    updatedAt: new Date().toISOString(),
  };
  circuitStates.set(key, current);
  return current;
}

function circuitIsOpen(config) {
  const circuit = getCircuit(config);
  if (circuit.openUntil && circuit.openUntil > Date.now()) return true;
  if (circuit.openUntil && circuit.openUntil <= Date.now()) {
    circuit.openUntil = 0;
    circuit.failures = 0;
    circuit.updatedAt = new Date().toISOString();
  }
  return false;
}

function recordCircuitSuccess(config) {
  const circuit = getCircuit(config);
  circuit.failures = 0;
  circuit.openUntil = 0;
  circuit.lastError = "";
  circuit.updatedAt = new Date().toISOString();
}

function recordCircuitFailure(config, error) {
  const circuit = getCircuit(config);
  circuit.failures += 1;
  circuit.lastError = error.message;
  circuit.updatedAt = new Date().toISOString();
  if (circuit.failures >= circuitFailureThreshold) {
    circuit.openUntil = Date.now() + circuitCooldownMs;
  }
}

function shouldTryFallback(error) {
  return error?.name !== "AbortError";
}

export function getCircuitStates() {
  return Array.from(circuitStates.values()).map((circuit) => ({
    ...circuit,
    open: circuit.openUntil > Date.now(),
  }));
}

export async function createChatCompletion({
  providerConfig,
  messages,
  tools,
  toolChoice,
  temperature,
  maxTokens,
  signal,
}) {
  requireModel(providerConfig);

  const { response, attempts } = await fetchWithRetry(
    providerConfig.baseUrl + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(providerConfig.apiKey
          ? { Authorization: "Bearer " + providerConfig.apiKey }
          : {}),
      },
      signal,
      body: JSON.stringify({
        model: providerConfig.model,
        messages,
        ...(tools?.length ? { tools, tool_choice: toolChoice || "auto" } : {}),
        temperature: temperature ?? Number(providerConfig.temperature) ?? 0.85,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        stream: false,
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamError(payload, response.status);
  return {
    ...payload,
    gatewayMeta: {
      attempts,
    },
  };
}

export async function createChatCompletionResilient({
  providerConfig,
  fallbackProviderConfig,
  ...options
}) {
  const candidates = [providerConfig, fallbackProviderConfig].filter(Boolean);
  const errors = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (circuitIsOpen(candidate)) {
      errors.push(
        new Error(`${candidate.provider}/${candidate.model} 熔断器已打开`),
      );
      continue;
    }

    try {
      const payload = await createChatCompletion({
        providerConfig: candidate,
        ...options,
      });
      recordCircuitSuccess(candidate);
      return {
        ...payload,
        gatewayMeta: {
          ...(payload.gatewayMeta || {}),
          provider: candidate.provider,
          model: candidate.model,
          fallbackUsed: index > 0,
        },
      };
    } catch (error) {
      recordCircuitFailure(candidate, error);
      errors.push(error);
      if (!shouldTryFallback(error)) throw error;
    }
  }

  throw new Error(
    "所有模型候选均失败：" +
      errors.map((error) => error.message).join(" | "),
  );
}

export async function streamChatCompletion({
  providerConfig,
  messages,
  temperature,
  onDelta,
  onReasoning,
  signal,
}) {
  requireModel(providerConfig);

  const { response, attempts } = await fetchWithRetry(
    providerConfig.baseUrl + "/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(providerConfig.apiKey
          ? { Authorization: "Bearer " + providerConfig.apiKey }
          : {}),
      },
      signal,
      body: JSON.stringify({
        model: providerConfig.model,
        messages,
        temperature: temperature ?? Number(providerConfig.temperature) ?? 0.85,
        stream: true,
        stream_options:
          providerConfig.provider === "deepseek" ||
          providerConfig.provider === "openai"
            ? { include_usage: true }
            : undefined,
      }),
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw upstreamError(payload, response.status);
  }

  if (!response.body) throw new Error("模型服务没有返回流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let finishReason = null;

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;

    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    const choice = payload.choices?.[0];
    const delta = choice?.delta || {};
    if (delta.content) onDelta?.(delta.content);
    if (delta.reasoning_content) onReasoning?.(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (payload.usage) usage = payload.usage;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) processLine(line);
  }

  processLine(buffer);

  return {
    usage,
    finishReason,
    attempts,
  };
}

export async function streamChatCompletionResilient({
  providerConfig,
  fallbackProviderConfig,
  ...options
}) {
  const candidates = [providerConfig, fallbackProviderConfig].filter(Boolean);
  const errors = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (circuitIsOpen(candidate)) {
      errors.push(
        new Error(`${candidate.provider}/${candidate.model} 熔断器已打开`),
      );
      continue;
    }

    let emitted = false;
    try {
      const result = await streamChatCompletion({
        ...options,
        providerConfig: candidate,
        onDelta(delta) {
          emitted = true;
          options.onDelta?.(delta);
        },
      });
      recordCircuitSuccess(candidate);
      return {
        ...result,
        provider: candidate.provider,
        model: candidate.model,
        fallbackUsed: index > 0,
      };
    } catch (error) {
      recordCircuitFailure(candidate, error);
      errors.push(error);
      if (emitted || !shouldTryFallback(error)) throw error;
    }
  }

  throw new Error(
    "所有流式模型候选均失败：" +
      errors.map((error) => error.message).join(" | "),
  );
}

export async function testProviderConnection(providerConfig) {
  const startedAt = Date.now();
  const payload = await createChatCompletion({
    providerConfig: {
      ...providerConfig,
      temperature: 0,
    },
    messages: [
      {
        role: "system",
        content: "你是接口连通性测试助手。",
      },
      {
        role: "user",
        content: "只回复 OK，不要添加其他内容。",
      },
    ],
    maxTokens: 8,
  });
  const content = payload.choices?.[0]?.message?.content?.trim() || "";

  return {
    ok: Boolean(content),
    provider: providerConfig.provider,
    model: providerConfig.model,
    latencyMs: Date.now() - startedAt,
    attempts: payload.gatewayMeta?.attempts || 1,
    sample: content.slice(0, 40),
    usage: payload.usage || null,
  };
}

export function providerCatalog() {
  return Object.entries(providerDefaults).map(([id, value]) => ({
    id,
    defaultBaseUrl: value.baseUrl,
    defaultModel: value.model,
    requiresKey: id !== "ollama",
    keyConfigured: Boolean(value.apiKeyEnv && process.env[value.apiKeyEnv]),
  }));
}
