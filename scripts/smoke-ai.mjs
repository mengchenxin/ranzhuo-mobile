import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 8799;
const baseUrl = "http://127.0.0.1:" + port;
const dataDir = path.join(
  root,
  "server",
  "test-data",
  String(process.pid),
);
let mockRequestCount = 0;
const mockProvider = http.createServer((request, response) => {
  mockRequestCount += 1;
  response.setHeader("Content-Type", "application/json");

  if (mockRequestCount === 1) {
    response.writeHead(503);
    response.end(JSON.stringify({ error: { message: "temporary unavailable" } }));
    return;
  }

  response.writeHead(200);
  response.end(
    JSON.stringify({
      id: "mock-completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: "OK",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 1,
        total_tokens: 9,
      },
    }),
  );
});
mockProvider.listen(8801, "127.0.0.1");

function startGateway(extraEnv = {}) {
  return spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      RANZHUO_GATEWAY_PORT: String(port),
      RANZHUO_DATA_DIR: dataDir,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let child = startGateway();

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Gateway did not become healthy");
}

try {
  const health = await waitForHealth();
  if (!health.ok) throw new Error("Health check failed");

  const ingestResponse = await fetch(baseUrl + "/api/rag/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "测试知识",
      text: "染酌小手机是一个面向 AI Roleplay 的本地优先应用。它支持 DeepSeek 和 Ollama。",
    }),
  });
  const ingested = await ingestResponse.json();
  if (!ingestResponse.ok) throw new Error(ingested.error);

  const searchResponse = await fetch(baseUrl + "/api/rag/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "支持哪些模型？", limit: 3 }),
  });
  const searched = await searchResponse.json();
  if (!searched.results?.[0]?.content.includes("DeepSeek")) {
    throw new Error("RAG search did not return the expected chunk");
  }

  const removeResponse = await fetch(
    baseUrl + "/api/rag/documents/" + ingested.document.id,
    { method: "DELETE" },
  );
  if (!removeResponse.ok) throw new Error("Failed to remove test document");

  const beforeLogs = await fetch(baseUrl + "/api/logs?limit=100").then(
    (response) => response.json(),
  );
  const probeResponses = await Promise.all(
    Array.from({ length: 3 }, () =>
      fetch(baseUrl + "/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "custom",
          model: "log-probe",
          goal: "验证调用日志持久化",
        }),
      }),
    ),
  );
  if (probeResponses.some((response) => response.status !== 500)) {
    throw new Error("Log probe did not fail as expected");
  }

  const afterLogs = await fetch(baseUrl + "/api/logs?limit=100").then(
    (response) => response.json(),
  );
  if (afterLogs.logs.length - beforeLogs.logs.length < 3) {
    throw new Error("Concurrent call logs were not persisted");
  }

  const metrics = await fetch(baseUrl + "/api/metrics").then((response) =>
    response.json(),
  );
  if (!metrics.failedCalls || !("p95LatencyMs" in metrics)) {
    throw new Error("Gateway metrics are incomplete");
  }

  const providerTestResponse = await fetch(baseUrl + "/api/providers/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "custom",
      baseUrl: "http://127.0.0.1:8801/v1",
      model: "mock-model",
      apiKey: "test-key",
    }),
  });
  const providerTest = await providerTestResponse.json();
  if (!providerTestResponse.ok || !providerTest.ok) {
    throw new Error(providerTest.error || "Provider connectivity test failed");
  }
  if (providerTest.attempts !== 2 || mockRequestCount !== 2) {
    throw new Error("Provider retry probe did not recover after a 503");
  }

  const saveConfigResponse = await fetch(baseUrl + "/api/config/provider", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      enabled: true,
      transport: "gateway",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      temperature: 0.8,
      apiKey: "persistence-test-key",
    }),
  });
  const savedConfig = await saveConfigResponse.json();
  if (!savedConfig.config?.apiKeyConfigured) {
    throw new Error("Provider key was not persisted");
  }
  if (!savedConfig.config?.configured) {
    throw new Error("Provider config did not switch to configured state");
  }
  if (Object.hasOwn(savedConfig.config, "apiKey")) {
    throw new Error("Provider API key must never be returned to the client");
  }

  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 180));
  child = startGateway();
  await waitForHealth();
  const persistedConfig = await fetch(baseUrl + "/api/config/provider").then(
    (response) => response.json(),
  );
  if (
    !persistedConfig.config?.apiKeyConfigured ||
    persistedConfig.config.model !== "deepseek-flash"
  ) {
    throw new Error("Provider config did not survive a Gateway restart");
  }

  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 180));
  child = startGateway({ RANZHUO_REQUIRE_CLIENT_KEY: "true" });
  await waitForHealth();

  const missingKeyResponse = await fetch(baseUrl + "/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "deepseek",
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  if (missingKeyResponse.status !== 400) {
    throw new Error("Client-key mode did not reject a missing API key");
  }

  const blockedConfigResponse = await fetch(baseUrl + "/api/config/provider", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "deepseek",
      model: "deepseek-flash",
      apiKey: "must-not-be-saved",
    }),
  });
  if (blockedConfigResponse.status !== 403) {
    throw new Error("Client-key mode allowed saving a visitor key on the server");
  }

  const evaluationResponse = await fetch(baseUrl + "/api/evaluations/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "deepseek",
      model: "deepseek-flash",
      includeLive: false,
    }),
  });
  const evaluation = await evaluationResponse.json();
  if (!evaluationResponse.ok || evaluation.failed) {
    throw new Error("Client-key mode blocked the deterministic evaluation suite");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        providers: health.providers.map((provider) => provider.id),
        tools: health.agentTools,
        ragTopScore: searched.results[0].score,
        persistedLogs: afterLogs.logs.length - beforeLogs.logs.length,
        failedCalls: metrics.failedCalls,
        p95LatencyMs: metrics.p95LatencyMs,
        retryAttempts: providerTest.attempts,
        providerConfigPersisted: true,
        clientKeyEnforced: true,
        deterministicEvaluationWithoutKey: evaluation.passed,
      },
      null,
      2,
    ),
  );
} finally {
  child.kill();
  mockProvider.close();
}
