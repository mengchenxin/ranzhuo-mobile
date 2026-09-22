function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "http://127.0.0.1:8787").replace(/\/+$/, "");
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(normalizeBaseUrl(baseUrl) + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "网关请求失败");
  return payload;
}

export async function getGatewayHealth(baseUrl) {
  return requestJson(baseUrl, "/api/health");
}

export async function getGatewayMetrics(baseUrl) {
  return requestJson(baseUrl, "/api/metrics");
}

export async function getGatewayLogs(baseUrl, limit = 30) {
  return requestJson(baseUrl, "/api/logs?limit=" + limit);
}

export async function getGatewayProviderConfig(baseUrl) {
  return requestJson(baseUrl, "/api/config/provider");
}

export async function saveGatewayProviderConfig(baseUrl, config) {
  return requestJson(baseUrl, "/api/config/provider", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function getEvaluationCatalog(baseUrl) {
  return requestJson(baseUrl, "/api/evaluations/catalog");
}

export async function runEvaluationSuite(baseUrl, payload) {
  return requestJson(baseUrl, "/api/evaluations/run", {
    method: "POST",
    headers: {
      "X-Provider-Key": payload.providerKey || "",
    },
    body: JSON.stringify(payload),
  });
}

export async function testProviderConnection(baseUrl, payload) {
  return requestJson(baseUrl, "/api/providers/test", {
    method: "POST",
    headers: {
      "X-Provider-Key": payload.providerKey || "",
    },
    body: JSON.stringify(payload),
  });
}

export async function runAgent(baseUrl, payload) {
  return requestJson(baseUrl, "/api/agent/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function extractMemories(baseUrl, payload) {
  return requestJson(baseUrl, "/api/memory/extract", {
    method: "POST",
    headers: {
      "X-Provider-Key": payload.providerKey || "",
    },
    body: JSON.stringify(payload),
  });
}

export async function listKnowledgeDocuments(baseUrl) {
  return requestJson(baseUrl, "/api/rag/documents");
}

export async function ingestKnowledgeDocument(baseUrl, payload) {
  return requestJson(baseUrl, "/api/rag/documents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteKnowledgeDocument(baseUrl, documentId) {
  return requestJson(baseUrl, "/api/rag/documents/" + documentId, {
    method: "DELETE",
  });
}

export async function searchKnowledge(baseUrl, payload) {
  return requestJson(baseUrl, "/api/rag/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function streamGatewayChat({
  baseUrl,
  provider,
  providerBaseUrl,
  providerKey,
  model,
  temperature,
  messages,
  signal,
  fallback,
  onDelta,
  onReasoning,
  onStart,
  onDone,
}) {
  const response = await fetch(normalizeBaseUrl(baseUrl) + "/api/chat/stream", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Provider-Key": providerKey || "",
    },
    body: JSON.stringify({
      provider,
      baseUrl: providerBaseUrl,
      model,
      temperature,
      messages,
      fallback,
    }),
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "流式请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      let event = "message";
      let data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "start") onStart?.(payload);
      if (event === "delta") onDelta?.(payload.content || "");
      if (event === "reasoning") onReasoning?.(payload.content || "");
      if (event === "done") onDone?.(payload);
      if (event === "error") throw new Error(payload.message || "模型请求失败");
    }
  }
}
