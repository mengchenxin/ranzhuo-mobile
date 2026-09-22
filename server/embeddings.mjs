import crypto from "node:crypto";

const dimensions = 512;
const cache = new Map();

function getEmbeddingConfig() {
  const baseUrl = String(
    process.env.RANZHUO_EMBEDDING_BASE_URL || "",
  ).replace(/\/+$/, "");
  const model = process.env.RANZHUO_EMBEDDING_MODEL || "";
  const apiKey = process.env.RANZHUO_EMBEDDING_API_KEY || "";
  return {
    enabled: Boolean(baseUrl && model),
    baseUrl,
    model,
    apiKey,
  };
}

export function embeddingInfo() {
  const config = getEmbeddingConfig();
  return config.enabled
    ? {
        provider: "openai-compatible",
        model: config.model,
        dimensions: null,
        fallback: false,
      }
    : {
        provider: "local-hash-v2",
        model: "local-hash-v2",
        dimensions,
        fallback: true,
      };
}

function tokenize(text) {
  const normalized = String(text || "").toLowerCase();
  const units =
    normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g)?.map(String) || [];
  const tokens = [...units];

  for (let index = 0; index < units.length - 1; index += 1) {
    const left = units[index];
    const right = units[index + 1];
    if (/[\u3400-\u9fff]/.test(left) && /[\u3400-\u9fff]/.test(right)) {
      tokens.push(left + right);
    }
  }

  for (let index = 0; index < units.length - 2; index += 1) {
    const trigram = units.slice(index, index + 3).join("");
    if (/^[\u3400-\u9fff]{3}$/.test(trigram)) tokens.push(trigram);
  }

  return tokens;
}

function hashToken(token) {
  const digest = crypto.createHash("sha1").update(token).digest();
  return digest.readUInt32BE(0) % dimensions;
}

function localEmbedding(text) {
  const vector = new Float32Array(dimensions);
  const frequencies = new Map();
  for (const token of tokenize(text)) {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  for (const [token, frequency] of frequencies) {
    const index = hashToken(token);
    const weight =
      (1 + Math.log(frequency)) * (token.length > 1 ? 1.35 : 1);
    vector[index] += weight;
  }

  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Array.from(vector, (value) => value / magnitude);
}

async function remoteEmbeddings(texts, config) {
  const response = await fetch(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {}),
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
      encoding_format: "float",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `Embedding 服务返回 HTTP ${response.status}`,
    );
  }
  const vectors = payload.data
    ?.sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
  if (!vectors?.length || vectors.length !== texts.length) {
    throw new Error("Embedding 服务返回的数据不完整");
  }
  return vectors;
}

export async function embedTexts(texts) {
  const normalized = texts.map((text) => String(text || ""));
  const missing = normalized
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => !cache.has(text));
  const config = getEmbeddingConfig();

  if (missing.length && config.enabled) {
    try {
      const vectors = await remoteEmbeddings(
        missing.map((item) => item.text),
        config,
      );
      missing.forEach((item, index) => {
        cache.set(item.text, vectors[index]);
      });
      return {
        vectors: normalized.map((text) => cache.get(text)),
        provider: "openai-compatible",
        model: config.model,
        fallback: false,
      };
    } catch {
      // A local deterministic fallback keeps ingestion available when the
      // embedding endpoint is temporarily offline.
    }
  }

  for (const { text } of missing) {
    cache.set(text, localEmbedding(text));
  }
  if (cache.size > 2000) {
    const oldestKeys = Array.from(cache.keys()).slice(0, 500);
    for (const key of oldestKeys) cache.delete(key);
  }

  return {
    vectors: normalized.map((text) => cache.get(text)),
    provider: "local-hash-v2",
    model: "local-hash-v2",
    fallback: true,
  };
}

export async function embedText(text) {
  const result = await embedTexts([text]);
  return result.vectors[0];
}

export { tokenize };
