import crypto from "node:crypto";
import {
  getChunks,
  getDocuments,
  insertDocument,
  removeDocument,
} from "./database.mjs";
import { embedTexts, tokenize } from "./embeddings.mjs";

function splitText(text, size = 420, overlap = 84) {
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
  const contentChunks = splitText(text);
  if (!contentChunks.length) throw new Error("文档内容不能为空");

  const embeddingResult = await embedTexts(contentChunks);
  const chunks = contentChunks.map((content, index) => ({
    id: crypto.randomUUID(),
    index,
    content,
    embedding: embeddingResult.vectors[index],
  }));

  const document = {
    id: crypto.randomUUID(),
    title: String(title || "未命名资料").trim(),
    characterId,
    source,
    textLength: String(text).length,
    embeddingProvider: embeddingResult.provider,
    embeddingModel: embeddingResult.model,
    chunks,
    createdAt: new Date().toISOString(),
  };

  await insertDocument(document);
  return {
    ...document,
    chunks: chunks.length,
  };
}

export async function listDocuments() {
  return getDocuments();
}

export async function deleteDocument(documentId) {
  return removeDocument(documentId);
}

function cosineSimilarity(left, right) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function normalizeScores(items, key) {
  const values = items.map((item) => item.scores[key]);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 1);
  return items.map((item) => ({
    ...item,
    scores: {
      ...item.scores,
      [key]: (item.scores[key] - minimum) / (maximum - minimum || 1),
    },
  }));
}

function bm25Scores(query, chunks) {
  const queryTokens = [...new Set(tokenize(query))];
  const documents = chunks.map((chunk) => tokenize(chunk.content));
  const averageLength =
    documents.reduce((total, tokens) => total + tokens.length, 0) /
    Math.max(1, documents.length);
  const documentFrequency = new Map();

  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  return chunks.map((chunk, documentIndex) => {
    const tokens = documents[documentIndex];
    const frequencies = new Map();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) || 0;
      if (!frequency) continue;
      const documentCount = documentFrequency.get(token) || 0;
      const idf = Math.log(
        1 +
          (chunks.length - documentCount + 0.5) /
            Math.max(0.5, documentCount),
      );
      const denominator =
        frequency +
        1.5 *
          (1 - 0.75 + 0.75 * (tokens.length / Math.max(1, averageLength)));
      score += idf * ((frequency * 2.5) / denominator);
    }

    return {
      chunk,
      scores: {
        bm25: score,
        vector: 0,
        hybrid: 0,
        rerank: 0,
      },
    };
  });
}

function phraseAndCoverageScore(query, content, title) {
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedContent = content.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  const queryTokens = [...new Set(tokenize(query))];
  const matchedTokens = queryTokens.filter((token) =>
    normalizedContent.includes(token),
  );
  const coverage = matchedTokens.length / Math.max(1, queryTokens.length);
  const phraseBonus =
    normalizedQuery.length >= 3 && normalizedContent.includes(normalizedQuery)
      ? 1
      : 0;
  const titleBonus = queryTokens.some((token) =>
    normalizedTitle.includes(token),
  )
    ? 1
    : 0;
  return { coverage, phraseBonus, titleBonus };
}

export async function searchKnowledge(query, options = {}) {
  const chunks = await getChunks(options.characterId);
  if (!chunks.length) {
    return {
      results: [],
      retrieval: {
        strategy: "hybrid-bm25-vector-rerank",
        candidateCount: 0,
      },
    };
  }

  const queryEmbedding = (await embedTexts([query])).vectors[0];
  let candidates = bm25Scores(query, chunks);
  candidates = candidates.map((candidate) => ({
    ...candidate,
    scores: {
      ...candidate.scores,
      vector: cosineSimilarity(
        queryEmbedding,
        candidate.chunk.embedding,
      ),
    },
  }));
  candidates = normalizeScores(candidates, "bm25");
  candidates = normalizeScores(candidates, "vector");

  let results = candidates.map((candidate) => {
    const { chunk, scores } = candidate;
    const lexical = phraseAndCoverageScore(
      query,
      chunk.content,
      chunk.title,
    );
    const hybrid = scores.bm25 * 0.58 + scores.vector * 0.42;
    const rerank =
      hybrid +
      lexical.coverage * 0.08 +
      lexical.phraseBonus * 0.05 +
      lexical.titleBonus * 0.02;

    return {
      documentId: chunk.documentId,
      title: chunk.title,
      characterId: chunk.characterId,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      score: rerank,
      scores: {
        ...scores,
        hybrid,
        rerank,
        ...lexical,
      },
    };
  });

  results.sort((left, right) => right.score - left.score);
  const limit = Math.max(1, Math.min(12, Number(options.limit) || 5));
  results = results.slice(0, limit).map((result, index) => ({
    ...result,
    citationId: index + 1,
  }));

  return {
    results,
    retrieval: {
      strategy: "hybrid-bm25-vector-rerank",
      candidateCount: chunks.length,
      resultCount: results.length,
    },
  };
}
