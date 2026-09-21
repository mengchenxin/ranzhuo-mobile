import crypto from "node:crypto";
import { readStore, updateStore } from "./store.mjs";

const dimensions = 384;

function tokenize(text) {
  const normalized = String(text || "").toLowerCase();
  const units =
    normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g)?.map(String) || [];
  const tokens = [...units];

  for (let index = 0; index < units.length - 1; index += 1) {
    const left = units[index];
    const right = units[index + 1];
    const isCjkPair =
      /[\u3400-\u9fff]/.test(left) && /[\u3400-\u9fff]/.test(right);
    if (isCjkPair) tokens.push(left + right);
  }

  return tokens;
}

function hashToken(token) {
  const digest = crypto.createHash("sha1").update(token).digest();
  return digest.readUInt32BE(0) % dimensions;
}

export function embedText(text) {
  const vector = new Float32Array(dimensions);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const index = hashToken(token);
    vector[index] += token.length > 1 ? 1.4 : 1;
  }

  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude) || 1;
  return Array.from(vector, (value) => value / magnitude);
}

function cosineSimilarity(left, right) {
  let score = 0;
  for (let index = 0; index < dimensions; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function splitText(text, size = 360, overlap = 72) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + size);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

export async function ingestDocument({
  title,
  text,
  characterId = "shared",
  source = "manual",
}) {
  const chunks = splitText(text).map((content, index) => ({
    id: crypto.randomUUID(),
    index,
    content,
    embedding: embedText(content),
  }));

  if (!chunks.length) throw new Error("文档内容不能为空");

  const document = {
    id: crypto.randomUUID(),
    title: String(title || "未命名资料").trim(),
    characterId,
    source,
    textLength: String(text).length,
    chunks,
    createdAt: new Date().toISOString(),
  };

  await updateStore("rag", [], (documents) => {
    documents.unshift(document);
    return documents.slice(0, 100);
  });

  return {
    ...document,
    chunks: chunks.length,
  };
}

export async function listDocuments() {
  const documents = await readStore("rag", []);
  return documents.map((document) => ({
    id: document.id,
    title: document.title,
    characterId: document.characterId,
    source: document.source,
    textLength: document.textLength,
    chunks: document.chunks.length,
    createdAt: document.createdAt,
  }));
}

export async function deleteDocument(documentId) {
  let deleted = false;
  await updateStore("rag", [], (documents) => {
    const next = documents.filter((document) => document.id !== documentId);
    deleted = next.length !== documents.length;
    return deleted ? next : documents;
  });
  return deleted;
}

export async function searchKnowledge(query, options = {}) {
  const queryVector = embedText(query);
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 5));
  const documents = await readStore("rag", []);
  const results = [];

  for (const document of documents) {
    if (
      options.characterId &&
      options.characterId !== "shared" &&
      document.characterId !== options.characterId &&
      document.characterId !== "shared"
    ) {
      continue;
    }

    for (const chunk of document.chunks) {
      results.push({
        documentId: document.id,
        title: document.title,
        characterId: document.characterId,
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        content: chunk.content,
        score: cosineSimilarity(queryVector, chunk.embedding),
      });
    }
  }

  return results
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
