import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(
  process.env.RANZHUO_DATA_DIR || path.join(serverDir, "data"),
);
const databasePath = path.join(dataDir, "ranzhuo.sqlite");

let database;

function getDatabase() {
  if (database) return database;
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      character_id TEXT NOT NULL,
      source TEXT NOT NULL,
      text_length INTEGER NOT NULL,
      embedding_provider TEXT,
      embedding_model TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_document
      ON chunks(document_id, chunk_index);

    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      route TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      input_chars INTEGER,
      output_chars INTEGER,
      usage_json TEXT,
      error TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_call_logs_created
      ON call_logs(created_at DESC);
  `);
  ensureColumn(database, "documents", "embedding_provider", "TEXT");
  ensureColumn(database, "documents", "embedding_model", "TEXT");
  return database;
}

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export async function initDatabase() {
  await mkdir(dataDir, { recursive: true });
  const db = getDatabase();
  await migrateLegacyJson(db);
  return db;
}

async function migrateLegacyJson(db) {
  const documentCount = db
    .prepare("SELECT COUNT(*) AS count FROM documents")
    .get().count;
  if (documentCount === 0) {
    try {
      const documents = JSON.parse(
        await readFile(path.join(dataDir, "rag.json"), "utf8"),
      );
      for (const document of documents) insertDocumentIntoDatabase(document);
    } catch {
      // No legacy RAG data to migrate.
    }
  }

  const logCount = db
    .prepare("SELECT COUNT(*) AS count FROM call_logs")
    .get().count;
  if (logCount === 0) {
    try {
      const logs = JSON.parse(
        await readFile(path.join(dataDir, "call-logs.json"), "utf8"),
      );
      for (const log of logs) appendDatabaseCallLog(log);
    } catch {
      // No legacy log data to migrate.
    }
  }
}

function insertDocumentIntoDatabase(document) {
  const db = getDatabase();
  const insertDocumentStatement = db.prepare(`
    INSERT OR REPLACE INTO documents
      (
        id, title, character_id, source, text_length,
        embedding_provider, embedding_model, created_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunkStatement = db.prepare(`
    INSERT OR REPLACE INTO chunks
      (id, document_id, chunk_index, content, embedding)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    insertDocumentStatement.run(
      document.id,
      document.title,
      document.characterId,
      document.source,
      document.textLength,
      document.embeddingProvider || "local-hash-v2",
      document.embeddingModel || "local-hash-v2",
      document.createdAt,
    );
    for (const chunk of document.chunks) {
      insertChunkStatement.run(
        chunk.id,
        document.id,
        chunk.index,
        chunk.content,
        JSON.stringify(chunk.embedding),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function insertDocument(document) {
  await initDatabase();
  insertDocumentIntoDatabase(document);
}

export async function getDocuments() {
  const db = await initDatabase();
  return db
    .prepare(`
      SELECT
        d.id,
        d.title,
        d.character_id AS characterId,
        d.source,
        d.text_length AS textLength,
        d.embedding_provider AS embeddingProvider,
        d.embedding_model AS embeddingModel,
        d.created_at AS createdAt,
        COUNT(c.id) AS chunks
      FROM documents d
      LEFT JOIN chunks c ON c.document_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC
    `)
    .all();
}

export async function removeDocument(documentId) {
  const db = await initDatabase();
  const result = db
    .prepare("DELETE FROM documents WHERE id = ?")
    .run(documentId);
  return result.changes > 0;
}

export async function getChunks(characterId) {
  const db = await initDatabase();
  const rows = db
    .prepare(`
      SELECT
        c.id AS chunkId,
        c.document_id AS documentId,
        c.chunk_index AS chunkIndex,
        c.content,
        c.embedding,
        d.title,
        d.character_id AS characterId
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE ? IS NULL OR ? = 'shared' OR d.character_id = ? OR d.character_id = 'shared'
      ORDER BY d.created_at DESC, c.chunk_index ASC
    `)
    .all(characterId || null, characterId || null, characterId || null);

  return rows.map((row) => ({
    ...row,
    embedding: JSON.parse(row.embedding),
  }));
}

function serializeCallLog(entry) {
  const {
    id = crypto.randomUUID(),
    createdAt = new Date().toISOString(),
    route,
    provider,
    model,
    status,
    latencyMs,
    inputChars,
    outputChars,
    usage,
    error,
    ...metadata
  } = entry;
  return {
    id,
    createdAt,
    route,
    provider: provider || null,
    model: model || null,
    status,
    latencyMs: latencyMs ?? null,
    inputChars: inputChars ?? null,
    outputChars: outputChars ?? null,
    usageJson: usage ? JSON.stringify(usage) : null,
    error: error || null,
    metadataJson: Object.keys(metadata).length
      ? JSON.stringify(metadata)
      : null,
  };
}

function appendDatabaseCallLog(entry) {
  const log = serializeCallLog(entry);
  getDatabase()
    .prepare(`
      INSERT OR REPLACE INTO call_logs
        (
          id, created_at, route, provider, model, status, latency_ms,
          input_chars, output_chars, usage_json, error, metadata_json
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      log.id,
      log.createdAt,
      log.route,
      log.provider,
      log.model,
      log.status,
      log.latencyMs,
      log.inputChars,
      log.outputChars,
      log.usageJson,
      log.error,
      log.metadataJson,
    );
}

export async function insertCallLog(entry) {
  await initDatabase();
  appendDatabaseCallLog(entry);
}

function deserializeCallLog(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    route: row.route,
    provider: row.provider,
    model: row.model,
    status: row.status,
    latencyMs: row.latency_ms,
    inputChars: row.input_chars,
    outputChars: row.output_chars,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    error: row.error,
    ...(row.metadata_json ? JSON.parse(row.metadata_json) : {}),
  };
}

export async function getDatabaseCallLogs(limit = 300) {
  const db = await initDatabase();
  return db
    .prepare(`
      SELECT *
      FROM call_logs
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(1000, Number(limit) || 300)))
    .map(deserializeCallLog);
}

export { databasePath };
