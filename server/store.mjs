import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(
  process.env.RANZHUO_DATA_DIR || path.join(serverDir, "data"),
);

const files = {
  rag: path.join(dataDir, "rag.json"),
  logs: path.join(dataDir, "call-logs.json"),
  providerConfig: path.join(dataDir, "provider-config.json"),
};

const writeQueues = new Map();

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function readStore(name, fallback) {
  await ensureDataDir();
  try {
    const contents = await readFile(files[name], "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) {
      throw new Error(`本地数据文件 ${name}.json 格式损坏`);
    }
    throw error;
  }
}

function enqueueWrite(name, task) {
  const previous = writeQueues.get(name) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  writeQueues.set(name, next);
  next
    .finally(() => {
      if (writeQueues.get(name) === next) writeQueues.delete(name);
    })
    .catch(() => {});
  return next;
}

async function writeStoreUnlocked(name, value) {
  await ensureDataDir();
  const temporaryPath = `${files[name]}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  await rename(temporaryPath, files[name]);
}

export function writeStore(name, value) {
  return enqueueWrite(name, () => writeStoreUnlocked(name, value));
}

export function updateStore(name, fallback, updater) {
  return enqueueWrite(name, async () => {
    const current = await readStore(name, fallback);
    const next = await updater(current);
    await writeStoreUnlocked(name, next);
    return next;
  });
}

export async function appendCallLog(entry) {
  return updateStore("logs", [], (logs) => {
    logs.unshift({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entry,
    });
    return logs.slice(0, 300);
  });
}

export async function getCallLogs(limit = 50) {
  const logs = await readStore("logs", []);
  return logs.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

export async function getProviderConfig() {
  const environmentProvider = process.env.DEEPSEEK_API_KEY
    ? {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: process.env.DEEPSEEK_API_KEY,
      }
    : process.env.OPENAI_API_KEY
      ? {
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          apiKey: process.env.OPENAI_API_KEY,
        }
      : null;

  const stored = await readStore("providerConfig", null);
  if (stored) return stored;

  return readStore("providerConfig", {
    configured: Boolean(environmentProvider),
    enabled: Boolean(environmentProvider),
    transport: "gateway",
    provider: environmentProvider?.provider || "deepseek",
    baseUrl: environmentProvider?.baseUrl || "https://api.deepseek.com/v1",
    model: environmentProvider?.model || "deepseek-chat",
    temperature: 0.85,
    apiKey: environmentProvider?.apiKey || "",
  });
}

export async function setProviderConfig(config) {
  const current = await getProviderConfig();
  const next = {
    ...current,
    ...config,
    configured: true,
    apiKey:
      typeof config.apiKey === "string" && config.apiKey.trim()
        ? config.apiKey.trim()
        : current.apiKey,
  };
  await writeStore("providerConfig", next);
  return next;
}

export function maskProviderConfig(config) {
  const { apiKey, ...safeConfig } = config;
  return {
    ...safeConfig,
    apiKeyConfigured: Boolean(apiKey),
  };
}

export { dataDir };
