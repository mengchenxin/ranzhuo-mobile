import http from "node:http";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import { runAgent, tools } from "./agent.mjs";
import { runEvaluationSuite } from "./evaluations.mjs";
import { embeddingInfo } from "./embeddings.mjs";
import {
  createChatCompletion,
  createChatCompletionResilient,
  getCircuitStates,
  providerCatalog,
  resolveProvider,
  streamChatCompletion,
  streamChatCompletionResilient,
  testProviderConnection,
} from "./providers.mjs";
import {
  deleteDocument,
  ingestDocument,
  listDocuments,
  searchKnowledge,
} from "./rag.mjs";
import {
  appendCallLog,
  dataDir,
  getCallLogs,
  getProviderConfig,
  maskProviderConfig,
  setProviderConfig,
} from "./store.mjs";

const host =
  process.env.RANZHUO_GATEWAY_HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(
  process.env.PORT || process.env.RANZHUO_GATEWAY_PORT || 8787,
);
const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);
const configuredOrigins = String(process.env.RANZHUO_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const rateLimitPerTenMinutes = Math.max(
  1,
  Number(process.env.RANZHUO_RATE_LIMIT_PER_10_MIN || 30),
);
const rateBuckets = new Map();
const requireClientKey =
  process.env.RANZHUO_REQUIRE_CLIENT_KEY === "true" ||
  (process.env.RANZHUO_REQUIRE_CLIENT_KEY !== "false" &&
    process.env.NODE_ENV === "production" &&
    !process.env.DEEPSEEK_API_KEY &&
    !process.env.OPENAI_API_KEY);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  return (
    origin === "null" ||
    origin === "capacitor://localhost" ||
    origin === "http://localhost" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

async function serveStatic(request, response, pathname) {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  if (pathname.startsWith("/api/")) return false;

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const candidate = path.resolve(distDir, relativePath);
  if (!candidate.startsWith(distDir)) return false;

  let filePath = candidate;
  let fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    filePath = path.join(distDir, "index.html");
    fileStat = await stat(filePath).catch(() => null);
  }
  if (!fileStat?.isFile()) return false;

  response.writeHead(200, {
    "Content-Type":
      contentTypes[path.extname(filePath).toLowerCase()] ||
      "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(filePath).pipe(response);
  return true;
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin || "*");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Provider-Key",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function consumeRateLimit(request, response, limit = rateLimitPerTenMinutes) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const clientId = forwarded || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const current = rateBuckets.get(clientId);

  if (!current || now - current.startedAt >= windowMs) {
    rateBuckets.set(clientId, { startedAt: now, count: 1 });
    return true;
  }

  if (current.count >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - current.startedAt)) / 1000);
    response.setHeader("Retry-After", String(retryAfter));
    sendJson(response, 429, {
      error: "请求过于频繁，请稍后再试",
      retryAfter,
    });
    return false;
  }

  current.count += 1;
  return true;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw new Error("请求内容超过 3 MB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function providerFromRequest(body, request) {
  const stored = await getProviderConfig();
  const clientKey = body.apiKey || request.headers["x-provider-key"] || "";
  if (requireClientKey && !clientKey) {
    const error = new Error("当前站点要求访问者填写自己的 API Key");
    error.status = 400;
    throw error;
  }

  return resolveProvider({
    ...stored,
    ...body,
    apiKey: clientKey || stored.apiKey || "",
  });
}

function fallbackProviderFromRequest(body, request) {
  const fallback = body.fallback;
  if (!fallback?.enabled || !fallback.model) return null;
  return resolveProvider({
    ...fallback,
    apiKey:
      fallback.apiKey ||
      request.headers["x-fallback-provider-key"] ||
      (fallback.provider === (body.provider || "deepseek")
        ? body.apiKey || request.headers["x-provider-key"] || ""
        : "") ||
      "",
  });
}

function getTraceId(request) {
  const provided = String(request.headers["x-trace-id"] || "").trim();
  return provided || crypto.randomUUID();
}

async function handleChat(request, response, body) {
  const providerConfig = await providerFromRequest(body, request);
  const fallbackProviderConfig = fallbackProviderFromRequest(body, request);
  const traceId = getTraceId(request);
  const startedAt = Date.now();
  let content = "";
  let reasoning = "";

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Trace-Id": traceId,
  });

  const sendEvent = (event, data) => {
    response.write("event: " + event + "\n");
    response.write("data: " + JSON.stringify(data) + "\n\n");
  };

  sendEvent("start", {
    traceId,
    provider: providerConfig.provider,
    model: providerConfig.model,
    fallbackConfigured: Boolean(fallbackProviderConfig),
  });

  try {
    const result = await streamChatCompletionResilient({
      providerConfig,
      fallbackProviderConfig,
      messages: body.messages || [],
      temperature: body.temperature,
      onDelta(delta) {
        content += delta;
        sendEvent("delta", { content: delta });
      },
      onReasoning(delta) {
        reasoning += delta;
        sendEvent("reasoning", { content: delta });
      },
    });

    sendEvent("done", {
      usage: result.usage,
      finishReason: result.finishReason,
      provider: result.provider || providerConfig.provider,
      model: result.model || providerConfig.model,
      fallbackUsed: Boolean(result.fallbackUsed),
      traceId,
    });
    await appendCallLog({
      route: "/api/chat/stream",
      provider: providerConfig.provider,
      model: providerConfig.model,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      inputChars: JSON.stringify(body.messages || []).length,
      outputChars: content.length,
      usage: result.usage,
      reasoningChars: reasoning.length,
      fallbackUsed: Boolean(result.fallbackUsed),
      traceId,
    });
  } catch (error) {
    sendEvent("error", { message: error.message });
    await appendCallLog({
      route: "/api/chat/stream",
      provider: providerConfig.provider,
      model: providerConfig.model,
      status: "error",
      latencyMs: Date.now() - startedAt,
      error: error.message,
      traceId,
    });
  } finally {
    response.end();
  }
}

async function route(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, "http://" + request.headers.host);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "ranzhuo-ai-gateway",
      version: "0.1.0",
      dataDir,
      providers: providerCatalog(),
      embedding: embeddingInfo(),
      agentTools: tools.map((tool) => tool.function.name),
      circuits: getCircuitStates(),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/logs") {
    sendJson(response, 200, {
      logs: await getCallLogs(url.searchParams.get("limit")),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/config/provider") {
    sendJson(response, 200, {
      config: {
        ...maskProviderConfig(await getProviderConfig()),
        clientKeyRequired: requireClientKey,
        serverKeyManaged: Boolean(
          process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY,
        ),
      },
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/config/provider") {
    if (requireClientKey) {
      sendJson(response, 403, {
        error: "当前部署使用访客自带 Key，服务端不会保存密钥",
      });
      return;
    }
    const body = await readBody(request);
    const saved = await setProviderConfig(body);
    sendJson(response, 200, {
      config: maskProviderConfig(saved),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/metrics") {
    const logs = await getCallLogs(300);
    const successful = logs.filter((log) => log.status === "ok");
    const latencyValues = logs
      .map((log) => Number(log.latencyMs))
      .filter(Number.isFinite);
    const totalLatency = logs.reduce(
      (total, log) => total + (Number(log.latencyMs) || 0),
      0,
    );
    sendJson(response, 200, {
      totalCalls: logs.length,
      successfulCalls: successful.length,
      failedCalls: logs.length - successful.length,
      successRate: logs.length ? successful.length / logs.length : 0,
      averageLatencyMs: logs.length ? Math.round(totalLatency / logs.length) : 0,
      p95LatencyMs: percentile(latencyValues, 0.95),
      totalInputChars: logs.reduce(
        (total, log) => total + (Number(log.inputChars) || 0),
        0,
      ),
      totalOutputChars: logs.reduce(
        (total, log) => total + (Number(log.outputChars) || 0),
        0,
      ),
      totalTokens: logs.reduce(
        (total, log) => total + (Number(log.usage?.total_tokens) || 0),
        0,
      ),
      lastCallAt: logs[0]?.createdAt || null,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/evaluations/catalog") {
    sendJson(response, 200, {
      suites: [
        {
          id: "ranzhuo-ai-foundation",
          name: "AI 工程金标评测",
          deterministicCases: 17,
          optionalLiveCases: 3,
          dimensions: ["Tool Calling", "RAG", "Memory", "Provider"],
        },
      ],
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/evaluations/run") {
    if (
      !consumeRateLimit(
        request,
        response,
        Math.max(3, Math.floor(rateLimitPerTenMinutes / 5)),
      )
    ) {
      return;
    }
    const body = await readBody(request);
    const includeLive = Boolean(body.includeLive);
    const providerConfig = includeLive
      ? await providerFromRequest(body, request)
      : resolveProvider({
          provider: body.provider || "deepseek",
          baseUrl: body.baseUrl,
          model: body.model || "deepseek-flash",
        });
    const startedAt = Date.now();
    try {
      const result = await runEvaluationSuite({
        providerConfig,
        includeLive,
      });
      await appendCallLog({
        route: "/api/evaluations/run",
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: result.failed ? "error" : "ok",
        latencyMs: Date.now() - startedAt,
        passed: result.passed,
        total: result.total,
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/providers/test") {
    if (
      !consumeRateLimit(
        request,
        response,
        Math.max(5, Math.floor(rateLimitPerTenMinutes / 2)),
      )
    ) {
      return;
    }
    const body = await readBody(request);
    const providerConfig = await providerFromRequest(body, request);
    const fallbackProviderConfig = fallbackProviderFromRequest(body, request);
    const traceId = getTraceId(request);
    try {
      const result = await testProviderConnection(providerConfig);
      await appendCallLog({
        route: "/api/providers/test",
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: result.ok ? "ok" : "error",
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        usage: result.usage,
      });
      sendJson(response, 200, result);
    } catch (error) {
      await appendCallLog({
        route: "/api/providers/test",
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: "error",
        error: error.message,
      });
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/chat/stream") {
    if (!consumeRateLimit(request, response)) return;
    await handleChat(request, response, await readBody(request));
    return;
  }

  if (request.method === "POST" && pathname === "/api/agent/run") {
    if (
      !consumeRateLimit(
        request,
        response,
        Math.max(5, Math.floor(rateLimitPerTenMinutes / 2)),
      )
    ) {
      return;
    }
    const body = await readBody(request);
    const providerConfig = await providerFromRequest(body, request);
    const fallbackProviderConfig = fallbackProviderFromRequest(body, request);
    const traceId = getTraceId(request);
    const startedAt = Date.now();
    try {
      const result = await runAgent({
        goal: body.goal,
        providerConfig,
        fallbackProviderConfig,
        character: body.character,
        maxSteps: body.maxSteps,
      });
      await appendCallLog({
        route: "/api/agent/run",
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: "ok",
        latencyMs: Date.now() - startedAt,
        steps: result.trace.length,
        usage: result.usage,
        traceId,
      });
      sendJson(response, 200, { ...result, traceId });
    } catch (error) {
      await appendCallLog({
        route: "/api/agent/run",
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: "error",
        latencyMs: Date.now() - startedAt,
        error: error.message,
        traceId,
      });
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/memory/extract") {
    if (
      !consumeRateLimit(
        request,
        response,
        Math.max(5, Math.floor(rateLimitPerTenMinutes / 2)),
      )
    ) {
      return;
    }
    const body = await readBody(request);
    const providerConfig = await providerFromRequest(body, request);
    try {
      const payload = await createChatCompletion({
        providerConfig,
        messages: [
          {
            role: "system",
            content:
              "从对话中提取适合长期保存的用户记忆。只返回 JSON 数组，每项包含 type、content、importance、confidence 四个字段。type 只能是 preference、fact、event、relationship。",
          },
          {
            role: "user",
            content: JSON.stringify({
              character: body.character,
              messages: body.messages || [],
            }),
          },
        ],
        temperature: 0.1,
      });
      const raw = payload.choices?.[0]?.message?.content || "[]";
      const match = raw.match(/\[[\s\S]*\]/);
      sendJson(response, 200, {
        memories: JSON.parse(match?.[0] || "[]"),
        usage: payload.usage || null,
      });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/rag/documents") {
    const body = await readBody(request);
    try {
      const document = await ingestDocument(body);
      sendJson(response, 201, { document });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/rag/documents") {
    sendJson(response, 200, { documents: await listDocuments() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/rag/search") {
    const body = await readBody(request);
    sendJson(response, 200, await searchKnowledge(body.query, body));
    return;
  }

  if (
    request.method === "DELETE" &&
    pathname.startsWith("/api/rag/documents/")
  ) {
    const documentId = decodeURIComponent(pathname.split("/").pop());
    sendJson(response, (await deleteDocument(documentId)) ? 200 : 404, {
      deleted: true,
    });
    return;
  }

  if (await serveStatic(request, response, pathname)) return;

  sendJson(response, 404, { error: "Not found" });
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    sendJson(response, error.status || 500, { error: error.message });
  });
});

server.listen(port, host, () => {
  console.log("Ranzhuo AI Gateway listening on http://" + host + ":" + port);
});
