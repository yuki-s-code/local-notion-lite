import { createHash } from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import SQLiteDatabase from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { vaultPaths } from "../../utils/paths";
import { atomicWriteJson } from "../../utils/atomicWrite";
import {
  embedTextWithTransformer,
  getActiveTransformerModelId,
  normalizeJapaneseText,
} from "../transformerSemanticRetrieval";
import type {
  SemanticChunk,
  SemanticIndexItem,
  SemanticRelatedResult,
  SemanticSearchResult,
  SemanticWorkspaceIndex,
} from "./semanticTypes";

export const WORKSPACE_SEMANTIC_INDEX_VERSION = 1;
export const WORKSPACE_SEMANTIC_ENGINE =
  "workspace-semantic-ruri-v3-v3-chunked" as const;
const SQLITE_VEC_ENGINE_VERSION = "sqlite-vec-v1";
const SQLITE_FTS_ENGINE_VERSION = "sqlite-fts5-trigram-v1";
/**
 * Changes whenever the text composition sent to the embedding model changes.
 * It is intentionally part of the content hash so a normal diff rebuild
 * progressively replaces vectors produced by an older ranking profile.
 */
const EMBEDDING_PROFILE = "body-first-related-v693";

type SemanticSearchOptions = {
  limit?: number;
  excludeIds?: string[];
  types?: string[];
  target?: SemanticChunk | null;
  /** Related panels use semantic preselection before lexical reranking to keep page navigation responsive. */
  prefilterBySemantic?: boolean;
  /** Minimum final score to return. Default is intentionally broad for explicit workspace search. */
  minScore?: number;
  /** Related panels rank body evidence above title overlap; explicit search keeps the existing balanced profile. */
  rankingProfile?: "workspace" | "related";
};

type SemanticBuildOptions = {
  /** Maximum number of new/changed chunks to embed in this run. Reused embeddings are unlimited. */
  maxNewEmbeddings?: number;
  /** Label stored in cache metadata for admin/status display. */
  mode?: "diff" | "full";
  /**
   * Changed chunks requested by an interactive save are embedded before the
   * normal diff queue. This keeps the page currently being edited fresh
   * without forcing a full rebuild.
   */
  preferredChunkIds?: string[];
  /** Background jobs call this before each new embedding so user interaction can pause the job. */
  waitForPermit?: () => Promise<void>;
  /** Rebuild only the specified source records while retaining all other prior embeddings. */
  onlySourceIds?: string[];
  /** Always regenerate embeddings for these source records, even if their hash did not change. */
  forceSourceIds?: string[];
  /**
   * Partial source updates pass only the changed source chunks. Keep every
   * previous item outside these stable source keys, while replacing/removing
   * the targeted source items atomically.
   */
  replaceSourceKeys?: string[];
};

type SemanticDiffInfo = {
  total: number;
  reusable: number;
  changed: number;
  newItems: number;
  deleted: number;
  missingEmbedding: number;
  pending: number;
  model: string;
};

function textHash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function sourceKeyOf(
  chunk: Pick<SemanticChunk, "type" | "sourceId" | "databaseId">,
): string {
  return `${String(chunk.type)}:${String(chunk.databaseId || "")}:${String(chunk.sourceId)}`;
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i];
  return Math.max(0, Math.min(1, sum));
}

function buildFtsMatchQuery(input: string): string | null {
  const normalized = normalizeJapaneseText(input).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  const compact = normalized.replace(/\s+/g, "");
  const words = normalized
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3);
  const grams: string[] = [];
  for (let i = 0; i <= compact.length - 3; i += 1)
    grams.push(compact.slice(i, i + 3));
  const terms = Array.from(new Set([...words, ...grams]))
    .map((term) => term.replace(/["'`]/g, "").trim())
    .filter((term) => term.length >= 3)
    .slice(0, 18);
  if (!terms.length) return null;
  // Every term is quoted and passed as a bound parameter. This avoids FTS query
  // syntax errors from ordinary Japanese punctuation while retaining trigram matches.
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

function uniqueWords(input: string): string[] {
  const normalized = normalizeJapaneseText(input);
  const tokens = normalized
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const compact = normalized.replace(/\s+/g, "");
  const grams: string[] = [];
  for (let i = 0; i < Math.max(0, compact.length - 1); i += 1)
    grams.push(compact.slice(i, i + 2));
  return Array.from(new Set([...tokens, ...grams])).slice(0, 300);
}

function lexicalScore(query: string, text: string): number {
  const queryTerms = uniqueWords(query);
  if (!queryTerms.length) return 0;
  const haystack = normalizeJapaneseText(text).replace(/\s+/g, "");
  let hits = 0;
  let weighted = 0;
  for (const term of queryTerms) {
    const needle = normalizeJapaneseText(term).replace(/\s+/g, "");
    if (!needle) continue;
    if (haystack.includes(needle)) {
      hits += 1;
      weighted += Math.min(3, Math.max(1, needle.length / 2));
    }
  }
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (weighted / Math.max(4, queryTerms.length)) * 34 +
          (hits / queryTerms.length) * 38,
      ),
    ),
  );
}

function compactText(input: unknown): string {
  return normalizeJapaneseText(String(input || "")).replace(/\s+/g, "");
}

function keywordOverlapScore(a: string[] = [], b: string[] = []): number {
  const left = new Set(
    a.map((item) => compactText(item)).filter((item) => item.length >= 2),
  );
  const right = b
    .map((item) => compactText(item))
    .filter((item) => item.length >= 2);
  if (!left.size || !right.length) return 0;
  const hits = right.filter((item) => left.has(item)).length;
  return Math.min(
    100,
    Math.round((hits / Math.max(1, Math.min(left.size, right.length))) * 100),
  );
}

function relationBoost(
  target: SemanticChunk | null | undefined,
  item: SemanticChunk,
): number {
  if (!target) return 0;
  let boost = 0;
  if (
    target.intentId &&
    item.intentId &&
    compactText(target.intentId) === compactText(item.intentId)
  )
    boost += 10;
  if (
    target.databaseId &&
    item.databaseId &&
    target.databaseId === item.databaseId
  )
    boost += 7;
  if (
    target.parentPageId &&
    item.parentPageId &&
    target.parentPageId === item.parentPageId
  )
    boost += 5;
  boost += Math.round(
    keywordOverlapScore(target.tags || [], item.tags || []) * 0.07,
  );
  boost += Math.round(
    keywordOverlapScore(target.keywords || [], item.keywords || []) * 0.06,
  );
  if (target.type === item.type) boost += 2;
  return Math.min(20, boost);
}

function relatedEvidenceEnough(item: SemanticSearchResult): boolean {
  // Related panels are passive recommendations. Avoid showing weak semantic-only
  // matches unless there is at least one visible piece of evidence.
  return (
    item.semanticScore >= 62 ||
    (item.bodyScore || 0) >= 20 ||
    // Title-only overlap is deliberately a high bar. The related panel must
    // not surface an item merely because both records have similar headings.
    (item.titleScore || 0) >= 45 ||
    (item.metaScore || 0) >= 24 ||
    (item.relationBoost || 0) >= 6
  );
}

function relatedMinScoreForType(type: string): number {
  if (type === "attachment_summary") return 62;
  if (type === "database_row") return 58;
  return 56;
}

function filterRelatedQuality(results: SemanticSearchResult[]): {
  visible: SemanticSearchResult[];
  hiddenLowScoreCount: number;
  minScore: number;
  minSemanticScore: number;
} {
  const minSemanticScore = 50;
  const visible = results.filter((item) => {
    const minScore = relatedMinScoreForType(item.chunk.type);
    return (
      item.score >= minScore &&
      item.semanticScore >= minSemanticScore &&
      relatedEvidenceEnough(item)
    );
  });
  return {
    visible,
    hiddenLowScoreCount: Math.max(0, results.length - visible.length),
    minScore: 56,
    minSemanticScore,
  };
}

function buildMetaText(chunk: SemanticChunk): string {
  return [
    chunk.semanticMetaText,
    chunk.intentId ? `意図 ${chunk.intentId}` : "",
    chunk.tags?.length ? `タグ ${chunk.tags.join(" ")}` : "",
    chunk.keywords?.length ? `重要語 ${chunk.keywords.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function indexPath(sharedRoot: string): string {
  return path.join(
    vaultPaths(sharedRoot).smartAssist,
    "workspace-semantic-index.json",
  );
}

const MAX_STORED_SEMANTIC_TEXT_CHARS = 8_000;
const MAX_EMBEDDING_TEXT_CHARS = 1_800;
// Keep metadata compact so a long-document chunk can retain meaningful body text.

/**
 * Semantic indexing must never send binary payloads (for example BlockNote image
 * data URLs) to the tokenizer. Besides being meaningless for retrieval, a large
 * data URI can exhaust the WASM tokenizer/model and abort a whole rebuild.
 */
function stripNonSemanticPayload(input: unknown): string {
  return (
    String(input ?? "")
      // Markdown images keep their alt text but discard the source URL/data URI.
      .replace(/!\[([^\]]{0,240})\]\((?:[^)]*)\)/g, "$1")
      // HTML image/video/audio/file tags are not semantic prose.
      .replace(
        /<(?:img|image|video|audio|source|object|embed|iframe)\b[^>]*>/gi,
        " ",
      )
      // data: URIs, including base64 images embedded by editors.
      .replace(
        /\bdata:[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+(?:;[^,\s]*)?,[^\s)>'"]+/gi,
        " ",
      )
      .replace(/\b(?:blob|file):[^\s)>'"]+/gi, " ")
      // A long no-space token is almost always encoded binary or an opaque payload.
      .replace(/\S{512,}/g, " ")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function safeSemanticText(input: unknown, maxChars: number): string {
  const cleaned = stripNonSemanticPayload(input);
  return cleaned.length > maxChars
    ? cleaned.slice(0, maxChars).trim()
    : cleaned;
}

function buildEmbeddingText(chunk: SemanticChunk): string {
  // The embedding represents what the record says, not merely its label.
  // Keep the title once as a small disambiguator, then reserve the majority of
  // the model input for body text. This is especially important for related
  // recommendations, where similarly named administrative pages are common.
  const title = safeSemanticText(chunk.title, 120);
  const tags = (chunk.tags || [])
    .map((tag) => safeSemanticText(tag, 64))
    .filter(Boolean)
    .slice(0, 18);
  const keywords = (chunk.keywords || [])
    .map((word) => safeSemanticText(word, 64))
    .filter(Boolean)
    .slice(0, 22);
  const meta = safeSemanticText(
    [
      `種別: ${chunk.type}`,
      title ? `見出し: ${title}` : "",
      chunk.intentId ? `意図: ${safeSemanticText(chunk.intentId, 100)}` : "",
      tags.length ? `タグ: ${tags.join(" ")}` : "",
      keywords.length ? `重要語: ${keywords.join(" ")}` : "",
      chunk.semanticMetaText
        ? `メタ情報: ${safeSemanticText(chunk.semanticMetaText, 180)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    320,
  );
  const bodyBudget = Math.max(
    1_100,
    MAX_EMBEDDING_TEXT_CHARS - meta.length - 12,
  );
  const body = safeSemanticText(chunk.text, bodyBudget);
  // Build after each component is bounded. Slicing only after concatenation can
  // temporarily allocate a huge data URL and still destabilize the process.
  return `${meta}\n本文:\n${body}`.slice(0, MAX_EMBEDDING_TEXT_CHARS);
}

function embeddingTextHash(chunk: SemanticChunk): string {
  // Include the profile in the hash without adding an artificial token to the
  // embedding itself. Existing vectors will therefore be replaced gradually by
  // the next diff/full rebuild instead of silently being reused.
  return textHash(`${EMBEDDING_PROFILE}\n${buildEmbeddingText(chunk)}`);
}

function normalizeChunk(chunk: SemanticChunk): SemanticChunk | null {
  const title = safeSemanticText(chunk.title, 300);
  const text = safeSemanticText(chunk.text, MAX_STORED_SEMANTIC_TEXT_CHARS);
  if (!chunk.id || !chunk.type || !chunk.sourceId) return null;
  if ((title + text).trim().length < 2) return null;
  return {
    ...chunk,
    title: title || safeSemanticText(chunk.sourceId, 300),
    text,
    keywords: Array.isArray(chunk.keywords)
      ? chunk.keywords
          .map((item) => safeSemanticText(item, 120))
          .filter(Boolean)
          .slice(0, 40)
      : undefined,
    tags: Array.isArray(chunk.tags)
      ? chunk.tags
          .map((item) => safeSemanticText(item, 120))
          .filter(Boolean)
          .slice(0, 40)
      : undefined,
    semanticMetaText:
      safeSemanticText(chunk.semanticMetaText, 2_000) || undefined,
  };
}

function safeJsonArray(value: unknown): number[] {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(raw)
      ? raw.map(Number).filter((item) => Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

function workspaceCacheDbPath(localCacheDir?: string | null): string | null {
  const dir = String(localCacheDir || "").trim();
  if (!dir) return null;
  return path.join(path.resolve(dir), "workspace-semantic-cache.sqlite");
}

export class SemanticIndexService {
  /** Reuses the hydrated index for consecutive page opens. It is cleared after every index write. */
  private memoryIndex: SemanticWorkspaceIndex | null = null;
  /** A cold cache is hydrated after the response path has returned. */
  private memoryIndexWarmPromise: Promise<SemanticWorkspaceIndex | null> | null = null;
  private memoryIndexWarmScheduled = false;
  /** True once this process has checked the local/shared Index at least once. */
  private memoryIndexWarmAttempted = false;
  /** sqlite-vec is the primary local candidate-retrieval path when available. */
  private vectorCapability: { available: boolean; error?: string } | null =
    null;
  /** Optional FTS5/trigram candidate injection for exact terminology and tags. */
  private ftsCapability: { available: boolean; error?: string } | null = null;
  /**
   * One local SQLite connection is reused for the process lifetime. This avoids
   * reopening the database and reloading sqlite-vec/FTS extensions for every
   * related-page or Smart Assist search. The cache is disposable and remains
   * local-only; a restart still safely recreates the connection.
   */
  private cacheDb: any | null = null;
  private cacheDbOpenedAt: string | null = null;
  private cacheDbOpenCount = 0;
  /** In-memory observability only: do not add write I/O to every user search. */
  private searchTelemetry = {
    vectorSearchCount: 0,
    fallbackSearchCount: 0,
    lexicalSearchCount: 0,
    lastLexicalCandidateCount: 0,
    lastEngine: "not-run" as
      "not-run" | "sqlite-vec" | "js-fallback" | "embedding-unavailable",
    lastElapsedMs: null as number | null,
    lastCandidateCount: 0,
    lastResultCount: 0,
    lastAt: null as string | null,
  };
  /** v450: local-only cache hygiene; never changes the shared JSON source of truth. */
  private maintenanceRunning = false;
  private maintenanceQueued = false;

  constructor(
    private sharedRoot: string,
    private localCacheDir?: string | null,
  ) {}

  clearMemoryCache(): void {
    this.memoryIndex = null;
    this.memoryIndexWarmPromise = null;
    this.memoryIndexWarmScheduled = false;
    this.memoryIndexWarmAttempted = false;
  }

  /**
   * Returns only an already-hydrated index. It never performs SQLite or shared
   * file I/O, so request handlers can keep navigation-facing responses fast.
   */
  getLoadedIndex(): SemanticWorkspaceIndex | null {
    return this.memoryIndex;
  }

  /** Whether this process is still checking the cold local/shared Index. */
  isIndexWarming(): boolean {
    return Boolean(this.memoryIndexWarmPromise || this.memoryIndexWarmScheduled);
  }

  /** True after a cold load established that no usable Index currently exists. */
  hasConfirmedMissingIndex(): boolean {
    return this.memoryIndexWarmAttempted && !this.memoryIndex && !this.isIndexWarming();
  }

  /**
   * Starts local cache hydration only after the current request has yielded.
   * The first passive related-panel request can therefore return immediately
   * with a warming status instead of waiting for a large SQLite read.
   */
  warmIndexInBackground(delayMs = 0): void {
    if (
      this.memoryIndex ||
      this.memoryIndexWarmPromise ||
      this.memoryIndexWarmScheduled ||
      this.memoryIndexWarmAttempted
    )
      return;
    this.memoryIndexWarmScheduled = true;
    const start = () => {
      this.memoryIndexWarmScheduled = false;
      if (this.memoryIndex || this.memoryIndexWarmPromise) return;
      this.memoryIndexWarmPromise = this.readIndex()
        .catch(() => null)
        .finally(() => {
          this.memoryIndexWarmAttempted = true;
          this.memoryIndexWarmPromise = null;
        });
    };
    setTimeout(start, Math.max(0, Math.floor(delayMs)));
  }

  /** Write the shared semantic index through a same-directory temporary file before replacement. */
  private async atomicWriteIndex(index: SemanticWorkspaceIndex): Promise<void> {
    await atomicWriteJson(indexPath(this.sharedRoot), index, "semantic-index");
  }

  private cacheDbPath(): string | null {
    return workspaceCacheDbPath(this.localCacheDir);
  }

  private openCacheDb(): any | null {
    const dbPath = this.cacheDbPath();
    if (!dbPath) return null;
    if (this.cacheDb) return this.cacheDb;
    fs.ensureDirSync(path.dirname(dbPath));
    const db = new SQLiteDatabase(dbPath);
    this.cacheDb = db;
    this.cacheDbOpenCount += 1;
    this.cacheDbOpenedAt = new Date().toISOString();
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_semantic_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS workspace_semantic_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL DEFAULT '',
        ended_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT '',
        max_new_embeddings TEXT NOT NULL DEFAULT '',
        embedded_this_run INTEGER NOT NULL DEFAULT 0,
        reused_count INTEGER NOT NULL DEFAULT 0,
        pending_count INTEGER NOT NULL DEFAULT 0,
        stale_kept_count INTEGER NOT NULL DEFAULT 0,
        normalized_count INTEGER NOT NULL DEFAULT 0,
        item_count INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS workspace_semantic_failures (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 1,
        error TEXT NOT NULL DEFAULT '',
        failed_at TEXT NOT NULL DEFAULT '',
        occurrence_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_failures_source ON workspace_semantic_failures(source_id);
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_failures_failed_at ON workspace_semantic_failures(failed_at DESC);
      CREATE TABLE IF NOT EXISTS workspace_semantic_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        parent_page_id TEXT NOT NULL DEFAULT '',
        database_id TEXT NOT NULL DEFAULT '',
        row_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        intent_id TEXT NOT NULL DEFAULT '',
        semantic_meta_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        chunk_index INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 1,
        text_hash TEXT NOT NULL DEFAULT '',
        embedding_json TEXT NOT NULL DEFAULT '[]',
        dimension INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_items_type ON workspace_semantic_items(type);
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_items_model ON workspace_semantic_items(model);
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_items_hash ON workspace_semantic_items(text_hash);
      CREATE TABLE IF NOT EXISTS workspace_semantic_vec_map (
        item_id TEXT PRIMARY KEY,
        text_hash TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        dimension INTEGER NOT NULL DEFAULT 0,
        vec_rowid INTEGER NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_vec_map_model ON workspace_semantic_vec_map(model, dimension);
      CREATE TABLE IF NOT EXISTS workspace_semantic_fts_map (
        item_id TEXT PRIMARY KEY,
        text_hash TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        fts_rowid INTEGER NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_fts_map_model ON workspace_semantic_fts_map(model);
      CREATE INDEX IF NOT EXISTS idx_workspace_semantic_runs_started ON workspace_semantic_runs(started_at);
    `);
    // Existing local caches predate long-document chunk metadata. SQLite's ADD
    // COLUMN is safe here and keeps upgrades non-destructive.
    const cols = new Set(
      (
        db
          .prepare("PRAGMA table_info(workspace_semantic_items)")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    if (!cols.has("chunk_index"))
      db.exec(
        "ALTER TABLE workspace_semantic_items ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0",
      );
    if (!cols.has("chunk_count"))
      db.exec(
        "ALTER TABLE workspace_semantic_items ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 1",
      );
    try {
      sqliteVec.load(db);
      this.vectorCapability = { available: true };
    } catch (error: any) {
      // Never block the existing semantic search if a packaged sqlite-vec binary
      // cannot be loaded. The caller transparently falls back to JS cosine search.
      this.vectorCapability = {
        available: false,
        error: String(error?.message || error),
      };
    }
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS workspace_semantic_fts USING fts5(
        item_id UNINDEXED,
        title,
        text,
        meta,
        tokenize='trigram'
      )`);
      this.ftsCapability = { available: true };
    } catch (error: any) {
      // FTS is an optional exact-terminology boost. Semantic retrieval remains
      // available when a local SQLite build does not include FTS5/trigram.
      this.ftsCapability = {
        available: false,
        error: String(error?.message || error),
      };
    }
    return db;
  }

  /** Local semantic cache is retained while the service lives; only unexpected
   * temporary connections would be closed here. */
  private releaseCacheDb(db: any): void {
    if (!db || db === this.cacheDb) return;
    try {
      db.close();
    } catch {}
  }

  /** Explicit lifecycle hook for a future server shutdown/reconfigure path. */
  dispose(): void {
    const db = this.cacheDb;
    this.cacheDb = null;
    this.cacheDbOpenedAt = null;
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }

  private recordBuildRun(
    index: SemanticWorkspaceIndex | null,
    status: "success" | "partial" | "error",
    startedAt: string,
    error?: string,
  ): void {
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db) return;
      const buildStats = ((index as any)?.buildStats || {}) as any;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const endedAt = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO workspace_semantic_runs (
          id, started_at, ended_at, status, mode, max_new_embeddings,
          embedded_this_run, reused_count, pending_count, stale_kept_count,
          normalized_count, item_count, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        startedAt,
        endedAt,
        status,
        String(buildStats.mode || "unknown"),
        String(buildStats.maxNewEmbeddings ?? ""),
        Number(buildStats.embeddedThisRun || 0),
        Number(buildStats.reusedCount || 0),
        Number(buildStats.pendingCount || 0),
        Number(buildStats.staleKeptCount || 0),
        Number(buildStats.normalizedCount || 0),
        Number(index?.indexedCount || index?.items?.length || 0),
        String(error || index?.error || "").slice(0, 4000),
      );
      db.prepare(
        `DELETE FROM workspace_semantic_runs WHERE id NOT IN (SELECT id FROM workspace_semantic_runs ORDER BY started_at DESC LIMIT 50)`,
      ).run();
    } catch {
      // history is diagnostic only; never fail indexing because run logging failed.
    } finally {
      this.releaseCacheDb(db);
    }
  }

  async getUpdateHistory(limit = 20): Promise<any[]> {
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db) return [];
      const safeLimit = Math.max(
        1,
        Math.min(50, Math.floor(Number(limit) || 20)),
      );
      return db
        .prepare(
          `
        SELECT id, started_at AS startedAt, ended_at AS endedAt, status, mode,
          max_new_embeddings AS maxNewEmbeddings, embedded_this_run AS embeddedThisRun,
          reused_count AS reusedCount, pending_count AS pendingCount,
          stale_kept_count AS staleKeptCount, normalized_count AS normalizedCount,
          item_count AS itemCount, error
        FROM workspace_semantic_runs
        ORDER BY started_at DESC
        LIMIT ?
      `,
        )
        .all(safeLimit);
    } catch (error: any) {
      return [{ status: "error", error: String(error?.message || error) }];
    } finally {
      this.releaseCacheDb(db);
    }
  }

  private async readIndexFromCache(): Promise<SemanticWorkspaceIndex | null> {
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db) return null;
      const model = getActiveTransformerModelId();
      const metaRows = db
        .prepare("SELECT key, value FROM workspace_semantic_meta")
        .all() as Array<{ key: string; value: string }>;
      const meta = new Map(metaRows.map((row) => [row.key, row.value]));
      if (meta.get("version") !== String(WORKSPACE_SEMANTIC_INDEX_VERSION))
        return null;
      if (meta.get("engine") !== WORKSPACE_SEMANTIC_ENGINE) return null;
      if ((meta.get("model") || model) !== model) return null;
      const rows = db
        .prepare(
          "SELECT * FROM workspace_semantic_items WHERE model = ? ORDER BY type, id",
        )
        .all(model) as any[];
      if (!rows.length) return null;
      const items = rows
        .map((row) => ({
          id: String(row.id),
          type: String(row.type) as SemanticChunk["type"],
          sourceId: String(row.source_id || ""),
          parentPageId: row.parent_page_id || undefined,
          databaseId: row.database_id || undefined,
          rowId: row.row_id || undefined,
          title: String(row.title || row.id),
          text: String(row.text || ""),
          keywords: (() => {
            try {
              const v = JSON.parse(row.keywords_json || "[]");
              return Array.isArray(v)
                ? v.map(String).filter(Boolean)
                : undefined;
            } catch {
              return undefined;
            }
          })(),
          tags: (() => {
            try {
              const v = JSON.parse(row.tags_json || "[]");
              return Array.isArray(v)
                ? v.map(String).filter(Boolean)
                : undefined;
            } catch {
              return undefined;
            }
          })(),
          intentId: row.intent_id || undefined,
          semanticMetaText: row.semantic_meta_text || undefined,
          updatedAt: row.updated_at || undefined,
          chunkIndex: Number(row.chunk_index || 0),
          chunkCount: Math.max(1, Number(row.chunk_count || 1)),
          textHash: row.text_hash || "",
          embedding: safeJsonArray(row.embedding_json),
          dimension: Number(row.dimension || 0),
        }))
        .filter(
          (item) => item.id && item.sourceId && item.embedding.length,
        ) as SemanticIndexItem[];
      if (!items.length) return null;
      return {
        version: WORKSPACE_SEMANTIC_INDEX_VERSION,
        engine: WORKSPACE_SEMANTIC_ENGINE,
        model,
        dimension: Number(meta.get("dimension") || items[0]?.dimension || 0),
        generatedAt: meta.get("generatedAt") || new Date().toISOString(),
        revision: meta.get("revision") || meta.get("generatedAt") || undefined,
        embeddingProfile: meta.get("embeddingProfile") || "legacy-title-weighted",
        indexedCount: items.length,
        available: meta.get("available") !== "false",
        error: meta.get("error") || undefined,
        items,
      };
    } catch {
      return null;
    } finally {
      this.releaseCacheDb(db);
    }
  }

  private vectorTableName(dimension: number): string {
    // Dimension is derived from the active embedding model; keep the identifier
    // numeric-only so it cannot become a SQL injection surface.
    return `workspace_semantic_vec_${Math.max(1, Math.floor(Number(dimension) || 0))}`;
  }

  private toVectorBuffer(values: number[]): Buffer {
    const vector = new Float32Array(
      values.map((value) =>
        Number.isFinite(Number(value)) ? Number(value) : 0,
      ),
    );
    return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  }

  /**
   * Synchronize the optional sqlite-vec table with the already-persisted semantic
   * items. This is intentionally incremental: unchanged hashes retain their
   * vector rows, so normal save/diff indexing never rewrites the whole vector DB.
   */
  private syncVectorIndex(db: any, index: SemanticWorkspaceIndex): void {
    const dimension = Math.max(0, Number(index.dimension || 0));
    const model = String(index.model || getActiveTransformerModelId());
    if (
      !this.vectorCapability?.available ||
      !dimension ||
      !index.items.length
    ) {
      return;
    }
    const table = this.vectorTableName(dimension);
    const meta = db.prepare(
      "INSERT OR REPLACE INTO workspace_semantic_meta (key, value) VALUES (?, ?)",
    );
    const previousDimension = Number(
      (
        db
          .prepare(
            "SELECT value FROM workspace_semantic_meta WHERE key = 'sqliteVecDimension'",
          )
          .get() as any
      )?.value || 0,
    );
    const previousModel = String(
      (
        db
          .prepare(
            "SELECT value FROM workspace_semantic_meta WHERE key = 'sqliteVecModel'",
          )
          .get() as any
      )?.value || "",
    );
    if (
      previousDimension &&
      (previousDimension !== dimension || previousModel !== model)
    ) {
      const oldTable = this.vectorTableName(previousDimension);
      try {
        db.exec(`DROP TABLE IF EXISTS ${oldTable}`);
      } catch {}
      db.prepare("DELETE FROM workspace_semantic_vec_map").run();
    }
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(embedding float[${dimension}])`,
    );
    const mapRows = db
      .prepare(
        "SELECT item_id AS itemId, text_hash AS textHash, vec_rowid AS vecRowid FROM workspace_semantic_vec_map WHERE model = ? AND dimension = ?",
      )
      .all(model, dimension) as Array<{
      itemId: string;
      textHash: string;
      vecRowid: number;
    }>;
    const mapped = new Map(mapRows.map((row) => [String(row.itemId), row]));
    const activeIds = new Set(
      index.items
        .filter((item) => item.embedding?.length === dimension)
        .map((item) => String(item.id)),
    );
    const deleteVector = db.prepare(`DELETE FROM ${table} WHERE rowid = ?`);
    const deleteMap = db.prepare(
      "DELETE FROM workspace_semantic_vec_map WHERE item_id = ?",
    );
    for (const row of mapRows) {
      if (!activeIds.has(String(row.itemId))) {
        try {
          deleteVector.run(Number(row.vecRowid));
        } catch {}
        deleteMap.run(String(row.itemId));
      }
    }
    const insertVector = db.prepare(
      `INSERT INTO ${table} (embedding) VALUES (?)`,
    );
    const insertMap = db.prepare(
      "INSERT OR REPLACE INTO workspace_semantic_vec_map (item_id, text_hash, model, dimension, vec_rowid) VALUES (?, ?, ?, ?, ?)",
    );
    for (const item of index.items) {
      if (!item.embedding?.length || item.embedding.length !== dimension)
        continue;
      const previous = mapped.get(String(item.id));
      if (previous && previous.textHash === String(item.textHash || ""))
        continue;
      if (previous) {
        try {
          deleteVector.run(Number(previous.vecRowid));
        } catch {}
        deleteMap.run(String(item.id));
      }
      const result = insertVector.run(this.toVectorBuffer(item.embedding));
      const vecRowid = Number(result?.lastInsertRowid || 0);
      if (vecRowid > 0)
        insertMap.run(
          String(item.id),
          String(item.textHash || ""),
          model,
          dimension,
          vecRowid,
        );
    }
    meta.run("sqliteVecEnabled", "true");
    meta.run("sqliteVecEngine", SQLITE_VEC_ENGINE_VERSION);
    meta.run("sqliteVecDimension", String(dimension));
    meta.run("sqliteVecModel", model);
    meta.run(
      "sqliteVecRevision",
      String(index.revision || index.generatedAt || ""),
    );
    meta.run("sqliteVecLastSyncAt", new Date().toISOString());
  }

  private searchVectorCandidates(
    queryEmbedding: number[],
    index: SemanticWorkspaceIndex,
    limit: number,
  ): Array<{ id: string; semanticScore: number }> | null {
    const dimension = Math.max(0, Number(index.dimension || 0));
    if (
      !this.vectorCapability?.available ||
      !dimension ||
      queryEmbedding.length !== dimension
    )
      return null;
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db || !this.vectorCapability?.available) return null;
      const meta = db
        .prepare(
          "SELECT key, value FROM workspace_semantic_meta WHERE key IN ('sqliteVecDimension', 'sqliteVecModel', 'sqliteVecRevision')",
        )
        .all() as Array<{ key: string; value: string }>;
      const values = Object.fromEntries(
        meta.map((row) => [row.key, row.value]),
      );
      if (
        Number(values.sqliteVecDimension || 0) !== dimension ||
        values.sqliteVecModel !== String(index.model || "")
      )
        return null;
      const table = this.vectorTableName(dimension);
      const rows = db
        .prepare(
          `
        SELECT map.item_id AS itemId, vec.distance AS distance
        FROM ${table} AS vec
        JOIN workspace_semantic_vec_map AS map ON map.vec_rowid = vec.rowid
        WHERE vec.embedding MATCH ? AND k = ?
      `,
        )
        .all(
          this.toVectorBuffer(queryEmbedding),
          Math.max(1, Math.min(1000, limit)),
        ) as Array<{ itemId: string; distance: number }>;
      return rows.map((row) => ({
        id: String(row.itemId),
        // vec0 uses L2 distance for float vectors. Ruri vectors are normalized,
        // so cosine similarity is 1 - (L2² / 2), preserving the legacy 0..100 scale.
        semanticScore: Math.max(
          0,
          Math.min(
            100,
            Math.round((1 - Number(row.distance || 0) ** 2 / 2) * 100),
          ),
        ),
      }));
    } catch {
      return null;
    } finally {
      this.releaseCacheDb(db);
    }
  }

  /**
   * Keep a small local FTS5/trigram index in sync with semantic chunks. This is
   * incremental like sqlite-vec: unchanged lexical content keeps its FTS row.
   */
  private syncFtsIndex(db: any, index: SemanticWorkspaceIndex): void {
    const model = String(index.model || getActiveTransformerModelId());
    if (!this.ftsCapability?.available || !index.items.length) return;
    const meta = db.prepare(
      "INSERT OR REPLACE INTO workspace_semantic_meta (key, value) VALUES (?, ?)",
    );
    const previousModel = String(
      (
        db
          .prepare(
            "SELECT value FROM workspace_semantic_meta WHERE key = 'sqliteFtsModel'",
          )
          .get() as any
      )?.value || "",
    );
    if (previousModel && previousModel !== model) {
      try {
        db.prepare("DELETE FROM workspace_semantic_fts").run();
      } catch {}
      db.prepare("DELETE FROM workspace_semantic_fts_map").run();
    }
    const mapRows = db
      .prepare(
        "SELECT item_id AS itemId, text_hash AS textHash, fts_rowid AS ftsRowid FROM workspace_semantic_fts_map WHERE model = ?",
      )
      .all(model) as Array<{
      itemId: string;
      textHash: string;
      ftsRowid: number;
    }>;
    const mapped = new Map(mapRows.map((row) => [String(row.itemId), row]));
    const activeIds = new Set(index.items.map((item) => String(item.id)));
    const deleteFts = db.prepare(
      "DELETE FROM workspace_semantic_fts WHERE rowid = ?",
    );
    const deleteMap = db.prepare(
      "DELETE FROM workspace_semantic_fts_map WHERE item_id = ?",
    );
    for (const row of mapRows) {
      if (!activeIds.has(String(row.itemId))) {
        try {
          deleteFts.run(Number(row.ftsRowid));
        } catch {}
        deleteMap.run(String(row.itemId));
      }
    }
    const insertFts = db.prepare(
      "INSERT INTO workspace_semantic_fts (item_id, title, text, meta) VALUES (?, ?, ?, ?)",
    );
    const insertMap = db.prepare(
      "INSERT OR REPLACE INTO workspace_semantic_fts_map (item_id, text_hash, model, fts_rowid) VALUES (?, ?, ?, ?)",
    );
    for (const item of index.items) {
      const title = String(item.title || item.sourceId || "");
      const text = String(item.text || "");
      const metaText = buildMetaText(item);
      const lexicalHash = textHash(`${title}\n${text}\n${metaText}`);
      const previous = mapped.get(String(item.id));
      if (previous && previous.textHash === lexicalHash) continue;
      if (previous) {
        try {
          deleteFts.run(Number(previous.ftsRowid));
        } catch {}
        deleteMap.run(String(item.id));
      }
      const result = insertFts.run(String(item.id), title, text, metaText);
      const ftsRowid = Number(result?.lastInsertRowid || 0);
      if (ftsRowid > 0)
        insertMap.run(String(item.id), lexicalHash, model, ftsRowid);
    }
    meta.run("sqliteFtsEnabled", "true");
    meta.run("sqliteFtsEngine", SQLITE_FTS_ENGINE_VERSION);
    meta.run("sqliteFtsModel", model);
    meta.run(
      "sqliteFtsRevision",
      String(index.revision || index.generatedAt || ""),
    );
    meta.run("sqliteFtsLastSyncAt", new Date().toISOString());
  }

  private searchFtsCandidates(
    query: string,
    index: SemanticWorkspaceIndex,
    limit: number,
  ): Array<{ id: string }> | null {
    if (!this.ftsCapability?.available) return null;
    const match = buildFtsMatchQuery(query);
    if (!match) return [];
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db || !this.ftsCapability?.available) return null;
      const metaRows = db
        .prepare(
          "SELECT key, value FROM workspace_semantic_meta WHERE key IN ('sqliteFtsModel', 'sqliteFtsRevision')",
        )
        .all() as Array<{ key: string; value: string }>;
      const meta = Object.fromEntries(
        metaRows.map((row) => [row.key, row.value]),
      );
      const expectedRevision = String(
        index.revision || index.generatedAt || "",
      );
      if (
        meta.sqliteFtsModel !== String(index.model || "") ||
        meta.sqliteFtsRevision !== expectedRevision
      )
        return null;
      const rows = db
        .prepare(
          `
        SELECT map.item_id AS itemId
        FROM workspace_semantic_fts
        JOIN workspace_semantic_fts_map AS map ON map.fts_rowid = workspace_semantic_fts.rowid
        WHERE workspace_semantic_fts MATCH ? AND map.model = ?
        ORDER BY bm25(workspace_semantic_fts, 7.0, 2.2, 1.4)
        LIMIT ?
      `,
        )
        .all(
          match,
          String(index.model || getActiveTransformerModelId()),
          Math.max(1, Math.min(500, limit)),
        ) as Array<{ itemId: string }>;
      return rows.map((row) => ({ id: String(row.itemId) }));
    } catch {
      return null;
    } finally {
      this.releaseCacheDb(db);
    }
  }

  /** Remove stale local-only cache maps and resolved failure diagnostics. */
  private runCacheMaintenance(
    db: any,
    options: { vacuum?: boolean; reason?: string } = {},
  ): {
    removedItems: number;
    removedVectorMaps: number;
    removedFtsMaps: number;
    removedFailures: number;
    vectorOrphans: number;
    ftsOrphans: number;
    vacuumed: boolean;
    completedAt: string;
  } {
    const before = {
      items: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_items")
            .get() as any
        )?.count || 0,
      ),
      vectorMaps: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_vec_map")
            .get() as any
        )?.count || 0,
      ),
      ftsMaps: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_fts_map")
            .get() as any
        )?.count || 0,
      ),
      failures: Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM workspace_semantic_failures",
            )
            .get() as any
        )?.count || 0,
      ),
    };
    const activeItemSql = "SELECT id FROM workspace_semantic_items";
    const vectorRows = db
      .prepare(
        `SELECT item_id AS itemId, vec_rowid AS vecRowid FROM workspace_semantic_vec_map WHERE item_id NOT IN (${activeItemSql})`,
      )
      .all() as Array<{ itemId: string; vecRowid: number }>;
    const ftsRows = db
      .prepare(
        `SELECT item_id AS itemId, fts_rowid AS ftsRowid FROM workspace_semantic_fts_map WHERE item_id NOT IN (${activeItemSql})`,
      )
      .all() as Array<{ itemId: string; ftsRowid: number }>;
    const dimension = Number(
      (
        db
          .prepare(
            "SELECT value FROM workspace_semantic_meta WHERE key = 'sqliteVecDimension'",
          )
          .get() as any
      )?.value || 0,
    );
    const vectorTable = dimension > 0 ? this.vectorTableName(dimension) : null;
    db.transaction(() => {
      if (vectorTable) {
        const removeVector = db.prepare(
          `DELETE FROM ${vectorTable} WHERE rowid = ?`,
        );
        for (const row of vectorRows) {
          try {
            removeVector.run(row.vecRowid);
          } catch {}
        }
      }
      const removeVectorMap = db.prepare(
        "DELETE FROM workspace_semantic_vec_map WHERE item_id = ?",
      );
      for (const row of vectorRows) removeVectorMap.run(row.itemId);
      try {
        const removeFts = db.prepare(
          "DELETE FROM workspace_semantic_fts WHERE rowid = ?",
        );
        for (const row of ftsRows) removeFts.run(row.ftsRowid);
      } catch {}
      const removeFtsMap = db.prepare(
        "DELETE FROM workspace_semantic_fts_map WHERE item_id = ?",
      );
      for (const row of ftsRows) removeFtsMap.run(row.itemId);
      // A map-less virtual row can only occur after an interrupted low-level
      // write. Remove it during explicit capacity maintenance; automatic runs
      // merely report it to avoid an unexpected large write during editing.
      if (options.vacuum && vectorTable) {
        try {
          db.prepare(
            `DELETE FROM ${vectorTable} WHERE rowid NOT IN (SELECT vec_rowid FROM workspace_semantic_vec_map)`,
          ).run();
        } catch {}
      }
      if (options.vacuum) {
        try {
          db.prepare(
            "DELETE FROM workspace_semantic_fts WHERE rowid NOT IN (SELECT fts_rowid FROM workspace_semantic_fts_map)",
          ).run();
        } catch {}
      }
      db.prepare(
        `DELETE FROM workspace_semantic_failures WHERE id NOT IN (${activeItemSql})`,
      ).run();
      db.prepare(
        "DELETE FROM workspace_semantic_runs WHERE id NOT IN (SELECT id FROM workspace_semantic_runs ORDER BY started_at DESC LIMIT 50)",
      ).run();
    })();
    let vectorOrphans = 0;
    if (vectorTable) {
      try {
        vectorOrphans = Number(
          (
            db
              .prepare(
                `SELECT COUNT(*) AS count FROM ${vectorTable} WHERE rowid NOT IN (SELECT vec_rowid FROM workspace_semantic_vec_map)`,
              )
              .get() as any
          )?.count || 0,
        );
      } catch {}
    }
    let ftsOrphans = 0;
    try {
      ftsOrphans = Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM workspace_semantic_fts WHERE rowid NOT IN (SELECT fts_rowid FROM workspace_semantic_fts_map)",
            )
            .get() as any
        )?.count || 0,
      );
    } catch {}
    const completedAt = new Date().toISOString();
    let vacuumed = false;
    if (options.vacuum) {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {}
      db.exec("VACUUM");
      vacuumed = true;
    }
    const after = {
      items: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_items")
            .get() as any
        )?.count || 0,
      ),
      vectorMaps: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_vec_map")
            .get() as any
        )?.count || 0,
      ),
      ftsMaps: Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_fts_map")
            .get() as any
        )?.count || 0,
      ),
      failures: Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM workspace_semantic_failures",
            )
            .get() as any
        )?.count || 0,
      ),
    };
    const meta = db.prepare(
      "INSERT OR REPLACE INTO workspace_semantic_meta (key, value) VALUES (?, ?)",
    );
    meta.run("maintenanceLastAt", completedAt);
    meta.run(
      "maintenanceReason",
      String(
        options.reason ||
          (options.vacuum ? "manual-compact" : "automatic-sync"),
      ),
    );
    meta.run(
      "maintenanceRemovedItems",
      String(Math.max(0, before.items - after.items)),
    );
    meta.run(
      "maintenanceRemovedVectorMaps",
      String(Math.max(0, before.vectorMaps - after.vectorMaps)),
    );
    meta.run(
      "maintenanceRemovedFtsMaps",
      String(Math.max(0, before.ftsMaps - after.ftsMaps)),
    );
    meta.run(
      "maintenanceRemovedFailures",
      String(Math.max(0, before.failures - after.failures)),
    );
    meta.run("maintenanceVectorOrphans", String(vectorOrphans));
    meta.run("maintenanceFtsOrphans", String(ftsOrphans));
    if (vacuumed) meta.run("maintenanceVacuumedAt", completedAt);
    return {
      removedItems: Math.max(0, before.items - after.items),
      removedVectorMaps: Math.max(0, before.vectorMaps - after.vectorMaps),
      removedFtsMaps: Math.max(0, before.ftsMaps - after.ftsMaps),
      removedFailures: Math.max(0, before.failures - after.failures),
      vectorOrphans,
      ftsOrphans,
      vacuumed,
      completedAt,
    };
  }

  private scheduleCacheMaintenance(): void {
    if (
      this.maintenanceQueued ||
      this.maintenanceRunning ||
      !this.cacheDbPath()
    )
      return;
    this.maintenanceQueued = true;
    const timer = setTimeout(() => {
      this.maintenanceQueued = false;
      if (this.maintenanceRunning) return;
      const db = this.openCacheDb();
      if (!db) return;
      this.maintenanceRunning = true;
      try {
        this.runCacheMaintenance(db, { reason: "automatic-sync" });
      } catch {
      } finally {
        this.maintenanceRunning = false;
      }
    }, 1800);
    (timer as any).unref?.();
  }

  async maintainCache(options: { vacuum?: boolean } = {}): Promise<any> {
    const dbPath = this.cacheDbPath();
    if (!dbPath)
      return {
        ok: false,
        enabled: false,
        message: "ローカルSQLiteキャッシュ保存先が未設定です。",
      };
    const db = this.openCacheDb();
    if (!db)
      return {
        ok: false,
        enabled: false,
        message: "SQLiteキャッシュを開けません。",
      };
    if (this.maintenanceRunning)
      return {
        ok: false,
        busy: true,
        message: "別のキャッシュ保守処理を実行中です。",
      };
    this.maintenanceRunning = true;
    const beforeBytes = Number(
      (await fs.stat(dbPath).catch(() => ({ size: 0 }) as any)).size || 0,
    );
    try {
      const result = this.runCacheMaintenance(db, {
        vacuum: options.vacuum === true,
        reason: options.vacuum ? "manual-compact" : "manual-cleanup",
      });
      const afterBytes = Number(
        (await fs.stat(dbPath).catch(() => ({ size: 0 }) as any)).size || 0,
      );
      return {
        ok: true,
        enabled: true,
        ...result,
        beforeBytes,
        afterBytes,
        reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
      };
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private async writeIndexToCache(
    index: SemanticWorkspaceIndex,
  ): Promise<void> {
    let db: any;
    try {
      db = this.openCacheDb();
      if (!db) return;
      const activeIds = new Set(index.items.map((item) => String(item.id)));
      const tx = db.transaction(() => {
        const meta = db.prepare(
          "INSERT OR REPLACE INTO workspace_semantic_meta (key, value) VALUES (?, ?)",
        );
        meta.run("version", String(WORKSPACE_SEMANTIC_INDEX_VERSION));
        meta.run("engine", WORKSPACE_SEMANTIC_ENGINE);
        meta.run(
          "embeddingProfile",
          index.embeddingProfile || "legacy-title-weighted",
        );
        meta.run("model", index.model || getActiveTransformerModelId());
        meta.run("dimension", String(index.dimension || 0));
        meta.run("generatedAt", index.generatedAt || new Date().toISOString());
        meta.run(
          "revision",
          index.revision || index.generatedAt || new Date().toISOString(),
        );
        meta.run(
          "indexedCount",
          String(index.indexedCount || index.items.length),
        );
        meta.run("available", String(Boolean(index.available)));
        meta.run("error", index.error || "");
        meta.run("sharedRoot", this.sharedRoot);
        const buildStats = (index as any).buildStats || {};
        meta.run("lastBuildMode", String(buildStats.mode || "unknown"));
        meta.run(
          "lastEmbeddedThisRun",
          String(buildStats.embeddedThisRun ?? ""),
        );
        meta.run("lastReusedCount", String(buildStats.reusedCount ?? ""));
        meta.run("lastPendingCount", String(buildStats.pendingCount ?? ""));
        meta.run("lastStaleKeptCount", String(buildStats.staleKeptCount ?? ""));
        meta.run(
          "lastMaxNewEmbeddings",
          String(buildStats.maxNewEmbeddings ?? ""),
        );
        meta.run(
          "lastNormalizedCount",
          String(buildStats.normalizedCount ?? ""),
        );
        meta.run(
          "lastFailedEmbeddingCount",
          String(buildStats.failedEmbeddingCount ?? 0),
        );
        const upsert = db.prepare(`
          INSERT OR REPLACE INTO workspace_semantic_items (
            id, type, source_id, parent_page_id, database_id, row_id, title, text,
            keywords_json, tags_json, intent_id, semantic_meta_text, updated_at, chunk_index, chunk_count,
            text_hash, embedding_json, dimension, model
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of index.items) {
          upsert.run(
            item.id,
            item.type,
            item.sourceId,
            item.parentPageId || "",
            item.databaseId || "",
            item.rowId || "",
            item.title || item.sourceId,
            item.text || "",
            JSON.stringify(item.keywords || []),
            JSON.stringify(item.tags || []),
            item.intentId || "",
            item.semanticMetaText || "",
            item.updatedAt || "",
            Number(item.chunkIndex || 0),
            Math.max(1, Number(item.chunkCount || 1)),
            item.textHash || "",
            JSON.stringify(item.embedding || []),
            Number(item.dimension || index.dimension || 0),
            index.model || getActiveTransformerModelId(),
          );
        }
        const failureEntries = Array.isArray(buildStats.failedEmbeddingEntries)
          ? buildStats.failedEmbeddingEntries
          : [];
        const resolvedFailureIds = Array.isArray(buildStats.resolvedFailureIds)
          ? buildStats.resolvedFailureIds.map(String)
          : [];
        const failureUpsert = db.prepare(`
          INSERT INTO workspace_semantic_failures (id, source_id, type, title, chunk_index, chunk_count, error, failed_at, occurrence_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            source_id = excluded.source_id,
            type = excluded.type,
            title = excluded.title,
            chunk_index = excluded.chunk_index,
            chunk_count = excluded.chunk_count,
            error = excluded.error,
            failed_at = excluded.failed_at,
            occurrence_count = workspace_semantic_failures.occurrence_count + 1
        `);
        for (const failure of failureEntries) {
          failureUpsert.run(
            String(failure.id || ""),
            String(failure.sourceId || ""),
            String(failure.type || ""),
            String(failure.title || failure.sourceId || ""),
            Number(failure.chunkIndex || 0),
            Math.max(1, Number(failure.chunkCount || 1)),
            String(failure.error || "embedding unavailable").slice(0, 4000),
            String(
              failure.failedAt || index.generatedAt || new Date().toISOString(),
            ),
          );
        }
        if (resolvedFailureIds.length) {
          const clearFailure = db.prepare(
            "DELETE FROM workspace_semantic_failures WHERE id = ?",
          );
          for (const id of resolvedFailureIds) clearFailure.run(id);
        }
        const existing = db
          .prepare("SELECT id FROM workspace_semantic_items WHERE model = ?")
          .all(index.model || getActiveTransformerModelId()) as Array<{
          id: string;
        }>;
        const remove = db.prepare(
          "DELETE FROM workspace_semantic_items WHERE id = ? AND model = ?",
        );
        for (const row of existing) {
          if (!activeIds.has(String(row.id)))
            remove.run(row.id, index.model || getActiveTransformerModelId());
        }
        this.syncVectorIndex(db, index);
        this.syncFtsIndex(db, index);
      });
      tx();
      this.scheduleCacheMaintenance();
    } finally {
      this.releaseCacheDb(db);
    }
  }

  async readIndex(): Promise<SemanticWorkspaceIndex | null> {
    if (this.memoryIndex) return this.memoryIndex;
    const cached = await this.readIndexFromCache().catch(() => null);
    if (cached) {
      if (!cached.revision) cached.revision = cached.generatedAt;
      this.memoryIndex = cached;
      return cached;
    }
    const file = indexPath(this.sharedRoot);
    const raw = await fs.readJson(file).catch(() => null);
    if (
      !raw ||
      raw.version !== WORKSPACE_SEMANTIC_INDEX_VERSION ||
      raw.engine !== WORKSPACE_SEMANTIC_ENGINE ||
      !Array.isArray(raw.items)
    )
      return null;
    const index = raw as SemanticWorkspaceIndex;
    if (!index.revision) index.revision = index.generatedAt;
    this.memoryIndex = index;
    await this.writeIndexToCache(index).catch(() => undefined);
    return index;
  }

  async getCacheInfo(): Promise<any> {
    const dbPath = this.cacheDbPath();
    if (!dbPath)
      return {
        enabled: false,
        dbPath: null,
        itemCount: 0,
        typeCounts: {},
        databaseRowPolicy: "text-fields-only-v322",
      };
    let db: any;
    try {
      db = this.openCacheDb();
      const itemCount = Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_items")
            .get() as any
        )?.count || 0,
      );
      const rows = db
        .prepare(
          "SELECT type, COUNT(*) AS count FROM workspace_semantic_items GROUP BY type",
        )
        .all() as Array<{ type: string; count: number }>;
      const typeCounts = rows.reduce((acc: Record<string, number>, row) => {
        acc[String(row.type)] = Number(row.count || 0);
        return acc;
      }, {});
      const metaRows = db
        .prepare("SELECT key, value FROM workspace_semantic_meta")
        .all() as Array<{ key: string; value: string }>;
      const meta = Object.fromEntries(
        metaRows.map((row) => [row.key, row.value]),
      );
      const rawRecentRuns = db
        .prepare(
          `
        SELECT id, started_at AS startedAt, ended_at AS endedAt, status, mode,
          embedded_this_run AS embeddedThisRun, reused_count AS reusedCount,
          pending_count AS pendingCount, stale_kept_count AS staleKeptCount,
          normalized_count AS normalizedCount, item_count AS itemCount, error
        FROM workspace_semantic_runs
        ORDER BY started_at DESC
        LIMIT 20
      `,
        )
        .all() as any[];
      // Keep diagnostics local and derived from existing run metadata. No timing
      // instrumentation is added to the indexing hot path.
      const recentRuns = rawRecentRuns.slice(0, 8).map((run) => {
        const startedMs = Date.parse(String(run.startedAt || ""));
        const endedMs = Date.parse(String(run.endedAt || ""));
        const durationMs =
          Number.isFinite(startedMs) && Number.isFinite(endedMs)
            ? Math.max(0, endedMs - startedMs)
            : null;
        const embedded = Math.max(0, Number(run.embeddedThisRun || 0));
        return {
          ...run,
          durationMs,
          embeddingMsPerItem:
            durationMs !== null && embedded > 0
              ? Math.round(durationMs / embedded)
              : null,
        };
      });
      const measuredRuns = rawRecentRuns
        .map((run) => {
          const startedMs = Date.parse(String(run.startedAt || ""));
          const endedMs = Date.parse(String(run.endedAt || ""));
          const durationMs =
            Number.isFinite(startedMs) && Number.isFinite(endedMs)
              ? Math.max(0, endedMs - startedMs)
              : null;
          const embedded = Math.max(0, Number(run.embeddedThisRun || 0));
          return { durationMs, embedded };
        })
        .filter((run) => run.durationMs !== null);
      const lastMeasured = measuredRuns[0] || null;
      const lastFive = measuredRuns.slice(0, 5);
      const timing = {
        lastRunDurationMs: lastMeasured?.durationMs ?? null,
        lastRunEmbeddedCount: lastMeasured?.embedded ?? 0,
        lastEmbeddingMsPerItem:
          lastMeasured && lastMeasured.embedded > 0
            ? Math.round(
                Number(lastMeasured.durationMs || 0) / lastMeasured.embedded,
              )
            : null,
        averageLastFiveRunMs: lastFive.length
          ? Math.round(
              lastFive.reduce(
                (sum, run) => sum + Number(run.durationMs || 0),
                0,
              ) / lastFive.length,
            )
          : null,
        measuredRunCount: measuredRuns.length,
      };
      const failureRows = db
        .prepare(
          `
        SELECT id, source_id AS sourceId, type, title, chunk_index AS chunkIndex, chunk_count AS chunkCount,
          error, failed_at AS failedAt, occurrence_count AS occurrenceCount
        FROM workspace_semantic_failures
        ORDER BY failed_at DESC
        LIMIT 80
      `,
        )
        .all();
      const failureCount = Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM workspace_semantic_failures",
            )
            .get() as any
        )?.count || 0,
      );
      const vectorMapCount = Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_vec_map")
            .get() as any
        )?.count || 0,
      );
      const vector = {
        requested: true,
        mode: Boolean(this.vectorCapability?.available)
          ? "primary-with-js-fallback"
          : "js-fallback-only",
        available: Boolean(this.vectorCapability?.available),
        error: this.vectorCapability?.error || null,
        indexedCount: vectorMapCount,
        model: meta.sqliteVecModel || null,
        dimension: Number(meta.sqliteVecDimension || 0) || null,
        revision: meta.sqliteVecRevision || null,
        lastSyncAt: meta.sqliteVecLastSyncAt || null,
        telemetry: { ...this.searchTelemetry },
      };
      const ftsMapCount = Number(
        (
          db
            .prepare("SELECT COUNT(*) AS count FROM workspace_semantic_fts_map")
            .get() as any
        )?.count || 0,
      );
      const fts = {
        requested: true,
        mode: Boolean(this.ftsCapability?.available)
          ? "candidate-injection"
          : "disabled",
        available: Boolean(this.ftsCapability?.available),
        error: this.ftsCapability?.error || null,
        indexedCount: ftsMapCount,
        model: meta.sqliteFtsModel || null,
        revision: meta.sqliteFtsRevision || null,
        lastSyncAt: meta.sqliteFtsLastSyncAt || null,
        telemetry: {
          lexicalSearchCount: this.searchTelemetry.lexicalSearchCount,
          lastLexicalCandidateCount:
            this.searchTelemetry.lastLexicalCandidateCount,
        },
      };
      const exists = await fs.pathExists(dbPath);
      const sizeBytes = exists ? (await fs.stat(dbPath)).size : 0;
      const connection = {
        mode: "process-reused",
        openCount: this.cacheDbOpenCount,
        openedAt: this.cacheDbOpenedAt,
        active: Boolean(this.cacheDb),
      };
      const maintenance = {
        automatic: true,
        running: this.maintenanceRunning,
        queued: this.maintenanceQueued,
        lastAt: meta.maintenanceLastAt || null,
        reason: meta.maintenanceReason || null,
        removedItems: Number(meta.maintenanceRemovedItems || 0),
        removedVectorMaps: Number(meta.maintenanceRemovedVectorMaps || 0),
        removedFtsMaps: Number(meta.maintenanceRemovedFtsMaps || 0),
        removedFailures: Number(meta.maintenanceRemovedFailures || 0),
        vectorOrphans: Number(meta.maintenanceVectorOrphans || 0),
        ftsOrphans: Number(meta.maintenanceFtsOrphans || 0),
        lastVacuumedAt: meta.maintenanceVacuumedAt || null,
        manualCompactRecommended:
          sizeBytes >= 256 * 1024 * 1024 ||
          Number(meta.maintenanceVectorOrphans || 0) > 0 ||
          Number(meta.maintenanceFtsOrphans || 0) > 0,
      };
      return {
        enabled: true,
        dbPath,
        itemCount,
        typeCounts,
        meta,
        vector,
        fts,
        connection,
        maintenance,
        recentRuns,
        timing,
        failures: failureRows,
        failureCount,
        sizeBytes,
        databaseRowPolicy: "text-fields-only-v322",
        diagnostics: "v450-cache-hygiene",
      };
    } catch (error: any) {
      return {
        enabled: true,
        dbPath,
        ok: false,
        error: String(error?.message || error),
        databaseRowPolicy: "text-fields-only-v322",
      };
    } finally {
      this.releaseCacheDb(db);
    }
  }

  estimateDiff(
    chunks: SemanticChunk[],
    previous?: SemanticWorkspaceIndex | null,
  ): SemanticDiffInfo {
    const model = getActiveTransformerModelId();
    const normalized = chunks
      .map(normalizeChunk)
      .filter((item): item is SemanticChunk => Boolean(item));
    const previousItems = previous?.model === model ? previous.items || [] : [];
    const previousById = new Map(previousItems.map((item) => [item.id, item]));
    const activeIds = new Set(normalized.map((item) => item.id));
    let reusable = 0;
    let changed = 0;
    let newItems = 0;
    let missingEmbedding = 0;
    for (const chunk of normalized) {
      const hash = embeddingTextHash(chunk);
      const previousItem = previousById.get(chunk.id);
      if (!previousItem) {
        newItems += 1;
        continue;
      }
      if (!previousItem.embedding?.length) {
        missingEmbedding += 1;
        changed += 1;
        continue;
      }
      if (previousItem.textHash === hash) reusable += 1;
      else changed += 1;
    }
    const deleted = previousItems.filter(
      (item) => !activeIds.has(item.id),
    ).length;
    return {
      total: normalized.length,
      reusable,
      changed,
      newItems,
      deleted,
      missingEmbedding,
      pending: changed + newItems,
      model,
    };
  }

  async buildIndex(
    chunks: SemanticChunk[],
    previous?: SemanticWorkspaceIndex | null,
    options: SemanticBuildOptions = {},
  ): Promise<SemanticWorkspaceIndex> {
    const startedAt = new Date().toISOString();
    const model = getActiveTransformerModelId();
    const normalized = chunks
      .map(normalizeChunk)
      .filter((item): item is SemanticChunk => Boolean(item));
    const preferredIds = new Set(
      (options.preferredChunkIds || []).map(String).filter(Boolean),
    );
    const onlySourceIds = new Set(
      (options.onlySourceIds || []).map(String).filter(Boolean),
    );
    const forceSourceIds = new Set(
      (options.forceSourceIds || []).map(String).filter(Boolean),
    );
    // Stable priority: interactive saves are handled first, while all other
    // chunks retain their original order. This matters when a diff run has a
    // bounded embedding budget.
    if (preferredIds.size) {
      const isPreferred = (id: string) =>
        Array.from(preferredIds).some(
          (preferred) =>
            id === preferred || id.startsWith(`${preferred}:chunk:`),
        );
      normalized.sort(
        (left, right) =>
          Number(isPreferred(right.id)) - Number(isPreferred(left.id)),
      );
    }
    const previousItems =
      (previous?.model === model ? previous.items : []) || [];
    const previousById = new Map(previousItems.map((item) => [item.id, item]));
    const replaceSourceKeys = new Set(
      (options.replaceSourceKeys || []).map(String).filter(Boolean),
    );
    // A save-time update supplies chunks for only the edited page/DB row. Keep
    // unrelated existing chunks without re-reading their source files.
    const retainedItems: SemanticIndexItem[] = replaceSourceKeys.size
      ? previousItems.filter(
          (item) => !replaceSourceKeys.has(sourceKeyOf(item)),
        )
      : [];
    const items: SemanticIndexItem[] = [...retainedItems];
    const expectedItemCount = retainedItems.length + normalized.length;
    let dimension = previous?.dimension || 0;
    let available = true;
    let error = "";
    const maxNewEmbeddings =
      Number.isFinite(Number(options.maxNewEmbeddings)) &&
      Number(options.maxNewEmbeddings) > 0
        ? Math.floor(Number(options.maxNewEmbeddings))
        : Number.POSITIVE_INFINITY;
    let embeddedThisRun = 0;
    let reusedCount = 0;
    let pendingCount = 0;
    let staleKeptCount = 0;
    let failedEmbeddingCount = 0;
    const failedEmbeddingIds: string[] = [];
    const failedEmbeddingEntries: Array<{
      id: string;
      sourceId: string;
      type: string;
      title: string;
      chunkIndex: number;
      chunkCount: number;
      error: string;
      failedAt: string;
    }> = [];
    const resolvedFailureIds: string[] = [];

    for (const chunk of normalized) {
      const hash = embeddingTextHash(chunk);
      const previousItem = previousById.get(chunk.id);
      const isTargetedSource =
        !onlySourceIds.size || onlySourceIds.has(String(chunk.sourceId));
      const forceEmbedding = forceSourceIds.has(String(chunk.sourceId));
      if (!isTargetedSource) {
        if (previousItem?.embedding?.length) {
          items.push({
            ...chunk,
            textHash: previousItem.textHash || "",
            embedding: previousItem.embedding,
            dimension: previousItem.dimension,
          });
          dimension = previousItem.dimension || dimension;
        }
        continue;
      }
      if (
        !forceEmbedding &&
        previousItem &&
        previousItem.textHash === hash &&
        previousItem.embedding?.length
      ) {
        items.push({
          ...chunk,
          textHash: hash,
          embedding: previousItem.embedding,
          dimension: previousItem.dimension,
        });
        dimension = previousItem.dimension || dimension;
        reusedCount += 1;
        continue;
      }
      if (embeddedThisRun >= maxNewEmbeddings) {
        pendingCount += 1;
        if (previousItem?.embedding?.length) {
          // Keep the previous embedding so search remains usable, but keep the old hash.
          // The next diff run will still see this chunk as pending because the hash differs.
          items.push({
            ...chunk,
            textHash: previousItem.textHash || "",
            embedding: previousItem.embedding,
            dimension: previousItem.dimension,
          });
          dimension = previousItem.dimension || dimension;
          staleKeptCount += 1;
        }
        continue;
      }
      // A background diff build must yield to active document editing before
      // starting another expensive embedding. A currently running embedding is
      // allowed to finish, then the next chunk waits without blocking Electron.
      if (options.waitForPermit) await options.waitForPermit();
      const embeddingText = buildEmbeddingText(chunk);
      const embedded = await embedTextWithTransformer(embeddingText, model);
      if (!embedded.available || !embedded.embedding.length) {
        // One malformed/oversized source must not make the whole workspace index
        // disappear. Keep an older usable embedding when available and record a
        // compact diagnostic for the admin screen.
        available = false;
        failedEmbeddingCount += 1;
        if (failedEmbeddingIds.length < 20) failedEmbeddingIds.push(chunk.id);
        failedEmbeddingEntries.push({
          id: chunk.id,
          sourceId: chunk.sourceId,
          type: chunk.type,
          title: chunk.title,
          chunkIndex: Number(chunk.chunkIndex || 0),
          chunkCount: Math.max(1, Number(chunk.chunkCount || 1)),
          error: String(
            embedded.error || "workspace semantic embedding unavailable",
          ),
          failedAt: new Date().toISOString(),
        });
        error =
          error || embedded.error || "workspace semantic embedding unavailable";
        if (previousItem?.embedding?.length) {
          items.push({
            ...chunk,
            textHash: previousItem.textHash || "",
            embedding: previousItem.embedding,
            dimension: previousItem.dimension,
          });
          dimension = previousItem.dimension || dimension;
          staleKeptCount += 1;
        }
        continue;
      }
      dimension = embedded.dimension || dimension;
      embeddedThisRun += 1;
      items.push({
        ...chunk,
        textHash: hash,
        embedding: embedded.embedding,
        dimension: embedded.dimension,
      });
      resolvedFailureIds.push(chunk.id);
      // Let Electron/Node process pending IPC and paint work during a long full build.
      if (embeddedThisRun % 4 === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const builtAt = new Date().toISOString();
    const index: SemanticWorkspaceIndex = {
      version: WORKSPACE_SEMANTIC_INDEX_VERSION,
      engine: WORKSPACE_SEMANTIC_ENGINE,
      model,
      dimension,
      generatedAt: builtAt,
      revision: builtAt,
      embeddingProfile: EMBEDDING_PROFILE,
      indexedCount: items.length,
      available: available && items.length === expectedItemCount,
      error: error || undefined,
      items,
    };
    (index as any).buildStats = {
      mode:
        options.mode || (Number.isFinite(maxNewEmbeddings) ? "diff" : "full"),
      maxNewEmbeddings: Number.isFinite(maxNewEmbeddings)
        ? maxNewEmbeddings
        : null,
      embeddedThisRun,
      reusedCount,
      pendingCount,
      staleKeptCount,
      normalizedCount: normalized.length,
      retainedCount: retainedItems.length,
      partialSourceUpdate: replaceSourceKeys.size > 0,
      failedEmbeddingCount,
      failedEmbeddingIds,
      failedEmbeddingEntries,
      resolvedFailureIds,
    };
    await this.atomicWriteIndex(index);
    await this.writeIndexToCache(index).catch(() => undefined);
    this.memoryIndex = index;
    this.recordBuildRun(
      index,
      pendingCount > 0 || !available ? "partial" : "success",
      startedAt,
      error,
    );
    return index;
  }

  async search(
    query: string,
    index: SemanticWorkspaceIndex | null,
    options: SemanticSearchOptions = {},
  ): Promise<{
    available: boolean;
    results: SemanticSearchResult[];
    error?: string;
  }> {
    const startedAt = Date.now();
    const finishTelemetry = (
      engine: "sqlite-vec" | "js-fallback" | "embedding-unavailable",
      candidateCount: number,
      resultCount: number,
    ) => {
      if (engine === "sqlite-vec") this.searchTelemetry.vectorSearchCount += 1;
      else if (engine === "js-fallback")
        this.searchTelemetry.fallbackSearchCount += 1;
      this.searchTelemetry.lastEngine = engine;
      this.searchTelemetry.lastElapsedMs = Math.max(0, Date.now() - startedAt);
      this.searchTelemetry.lastCandidateCount = Math.max(0, candidateCount);
      this.searchTelemetry.lastResultCount = Math.max(0, resultCount);
      this.searchTelemetry.lastAt = new Date().toISOString();
    };
    if (!index || !index.items.length) {
      finishTelemetry("js-fallback", 0, 0);
      return {
        available: false,
        results: [],
        error: "workspace semantic index is missing",
      };
    }
    const embedded = await embedTextWithTransformer(query, index.model);
    if (!embedded.available || !embedded.embedding.length) {
      finishTelemetry("embedding-unavailable", 0, 0);
      return { available: false, results: [], error: embedded.error };
    }
    const exclude = new Set((options.excludeIds || []).map(String));
    const types = new Set((options.types || []).map(String));
    const limit = Math.max(1, Math.min(80, options.limit || 20));
    const byId = new Map(index.items.map((item) => [String(item.id), item]));
    // sqlite-vec is deliberately the first path. The larger pool leaves room for
    // existing lexical, tag, and relation-aware reranking without reintroducing
    // an all-item JavaScript cosine pass.
    const vectorLimit = Math.max(180, limit * 18);
    const vectorCandidates = this.searchVectorCandidates(
      embedded.embedding,
      index,
      vectorLimit,
    );
    const usedVector = Boolean(vectorCandidates);
    const ftsCandidates = vectorCandidates
      ? this.searchFtsCandidates(query, index, Math.max(60, limit * 8))
      : null;
    if (ftsCandidates && ftsCandidates.length) {
      this.searchTelemetry.lexicalSearchCount += 1;
      this.searchTelemetry.lastLexicalCandidateCount = ftsCandidates.length;
    } else {
      this.searchTelemetry.lastLexicalCandidateCount = 0;
    }
    const candidateScores = new Map<string, number>();
    if (vectorCandidates) {
      for (const candidate of vectorCandidates)
        candidateScores.set(candidate.id, candidate.semanticScore);
    }
    // Exact terms, tags, and administrative words may be weak in embeddings.
    // Inject FTS hits into the vec candidate pool, then preserve the established
    // semantic/title/body/meta reranking rather than treating FTS as a replacement.
    if (vectorCandidates && ftsCandidates) {
      for (const candidate of ftsCandidates) {
        if (candidateScores.has(candidate.id)) continue;
        const chunk = byId.get(candidate.id);
        if (!chunk) continue;
        candidateScores.set(
          candidate.id,
          Math.round(cosine(embedded.embedding, chunk.embedding) * 100),
        );
      }
    }
    const candidateRows = vectorCandidates
      ? Array.from(candidateScores.entries()).map(([id, semanticScore]) => ({
          chunk: byId.get(id),
          semanticScore,
        }))
      : index.items.map((item) => ({
          chunk: item,
          semanticScore: Math.round(
            cosine(embedded.embedding, item.embedding) * 100,
          ),
        }));
    const candidates = candidateRows
      .filter(
        (
          candidate,
        ): candidate is { chunk: SemanticIndexItem; semanticScore: number } =>
          Boolean(candidate.chunk),
      )
      .filter(
        ({ chunk }) =>
          !exclude.has(chunk.id) && (!types.size || types.has(chunk.type)),
      )
      .map(({ chunk, semanticScore }) => ({
        chunk,
        semanticScore,
        relationBoost: relationBoost(options.target, chunk),
      }));

    // Passive related-page recommendations must never make page navigation wait for
    // full-text scoring of every indexed chunk. First select a generous semantic
    // pool, then apply the existing lexical and tag-aware ranking only to that pool.
    const lexicalPool = options.prefilterBySemantic
      ? candidates
          .sort(
            (a, b) =>
              b.semanticScore +
              b.relationBoost -
              (a.semanticScore + a.relationBoost),
          )
          .slice(0, Math.max(120, limit * 10))
      : candidates;
    const results = lexicalPool
      .map(({ chunk, semanticScore, relationBoost: boost }) => {
        const title = lexicalScore(query, chunk.title || "");
        const body = lexicalScore(query, chunk.text || "");
        const meta = lexicalScore(query, buildMetaText(chunk));
        const isRelatedRanking = options.rankingProfile === "related";
        // Explicit workspace search remains balanced for short query lookups.
        // Passive related recommendations use body evidence as the primary
        // lexical signal so title similarity cannot dominate the result list.
        const lex = Math.round(
          isRelatedRanking
            ? title * 0.16 + body * 0.66 + meta * 0.18
            : title * 0.48 + body * 0.34 + meta * 0.18,
        );
        const score = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              isRelatedRanking
                ? semanticScore * 0.61 +
                    title * 0.06 +
                    body * 0.22 +
                    meta * 0.05 +
                    boost
                : semanticScore * 0.58 +
                    title * 0.18 +
                    body * 0.12 +
                    meta * 0.07 +
                    boost,
            ),
          ),
        );
        const reasons = [
          semanticScore >= 45 ? `意味類似 ${semanticScore}%` : "",
          title >= 28 ? `タイトル一致 ${title}%` : "",
          body >= 28 ? `本文一致 ${body}%` : "",
          meta >= 28 ? `メタ一致 ${meta}%` : "",
          boost ? `関連補正 +${boost}` : "",
        ].filter(Boolean);
        return {
          chunk,
          score,
          semanticScore,
          lexicalScore: lex,
          titleScore: title,
          bodyScore: body,
          metaScore: meta,
          relationBoost: boost,
          reasons,
        };
      })
      .filter((item) => item.score >= (options.minScore ?? 30))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    finishTelemetry(
      usedVector ? "sqlite-vec" : "js-fallback",
      candidates.length,
      results.length,
    );
    return { available: true, results };
  }

  groupRelated(
    target: SemanticChunk | null,
    results: SemanticSearchResult[],
    index: SemanticWorkspaceIndex | null,
    warning?: string,
    options: { warming?: boolean } = {},
  ): SemanticRelatedResult {
    // A long source now has multiple chunks. Related-page UI should still show
    // one card per page/FAQ/row, retaining the best matching passage.
    const bestBySource = new Map<string, SemanticSearchResult>();
    for (const item of results) {
      const key = `${item.chunk.type}:${item.chunk.databaseId || ""}:${item.chunk.sourceId}`;
      const current = bestBySource.get(key);
      if (!current || item.score > current.score) bestBySource.set(key, item);
    }
    const compactResults = Array.from(bestBySource.values()).sort(
      (a, b) => b.score - a.score,
    );
    return {
      ok: true,
      target,
      generatedAt: new Date().toISOString(),
      indexRevision: index?.revision || index?.generatedAt || undefined,
      indexedCount: index?.indexedCount || 0,
      available: Boolean(index?.available),
      warming: options.warming === true,
      warning,
      results: compactResults,
      groups: {
        pages: compactResults
          .filter((item) => item.chunk.type === "page")
          .slice(0, 8),
        faqs: compactResults
          .filter((item) => item.chunk.type === "faq")
          .slice(0, 8),
        databaseRows: compactResults
          .filter((item) => item.chunk.type === "database_row")
          .slice(0, 8),
        journals: compactResults
          .filter((item) => item.chunk.type === "journal")
          .slice(0, 8),
        attachments: compactResults
          .filter((item) => item.chunk.type === "attachment_summary")
          .slice(0, 8),
      },
    };
  }
}
