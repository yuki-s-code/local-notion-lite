import fs from "fs-extra";
import path from "node:path";
import { promises as nodeFs } from "node:fs";
import os from "node:os";
import https from "node:https";
import http from "node:http";
import { createHash } from "node:crypto";
import SQLiteDatabase from "better-sqlite3";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { pipeline as streamPipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { nanoid } from "nanoid";
import {
  createCommittedPageCommit,
  createWritingPageCommit,
  isCommittedPageMarker,
} from "../../shared/persistence/pageCommit";
import {
  editorLockFileName,
  lockBelongsToCurrentHostUser,
  lockIsActive,
  lockMatchesCurrentProcess,
  lockTargetsResource,
} from "../../shared/persistence/editorLockPolicy";
import { selectScopedRoot } from "../../shared/persistence/scopeBoundary";
import type { Db } from "../db/sqlite";
import { deletePageFts, upsertPageFts } from "../db/sqlite";
import { sanitizeSegment, vaultPaths } from "../utils/paths";
import { withResourceMutex } from "../utils/resourceMutex";
import {
  analyzeJapaneseQuery,
  buildSmartFaqSearchText,
  normalizeJapaneseText,
  rankSmartFaqRecords,
  type RankedFaqSearchResult,
  type SmartFaqSearchRecord,
} from "./japaneseFaqSearch";
import {
  buildLightweightSearchIndex,
  type LightweightSearchIndex,
} from "./lightweightHybridRetrieval";
import {
  buildSemanticIdentityText,
  buildTransformerSemanticIndex,
  TRANSFORMER_SEMANTIC_ENGINE,
  TRANSFORMER_SEMANTIC_INDEX_VERSION,
  getTransformerRuntimeInfo,
  type TransformerSemanticIndex,
} from "./transformerSemanticRetrieval";
import { buildTransformerFirstSmartAssistResponse } from "./smartAssist/transformerFirstPipeline";
import { SmartAssistStore } from "./smartAssist/smartAssistStore";
import { ItemCollection } from "./sharedData/itemCollection";
import { SemanticIndexService } from "./semantic/semanticIndexService";
import type {
  SemanticChunk,
  SemanticRelatedResult,
  SemanticSearchResult,
  SemanticWorkspaceIndex,
} from "./semantic/semanticTypes";
import { DatabaseLockService } from "./database/databaseLockService";
import { DatabaseConflictService } from "./database/databaseConflictService";
import { DatabaseWorkspaceService } from "./database/databaseWorkspaceService";
import { DatabaseRowContentService } from "./database/databaseRowContentService";
import { AttachmentService } from "./attachment/attachmentService";
import { CommentService } from "./comments/commentService";
import { PageHistoryService } from "./history/pageHistoryService";
import { JournalService } from "./journal/journalService";
import { InboxService } from "./inbox/inboxService";
import { AnalysisNotebookService } from "./analysisNotebookService";
import { cloneSampleSmartFaqRecords } from "./sampleSmartFaqRecords";
import type {
  AttachmentInfo,
  ConflictInfo,
  DatabaseFilter,
  DatabaseSort,
  DatabaseProperty,
  DatabasePropertyType,
  DatabaseRow,
  DatabaseView,
  DatabaseQueryResult,
  DatabaseAggregateRequest,
  DatabaseAggregateResult,
  DatabasePerformanceInfo,
  HistoryDiffLine,
  HistoryDiffResult,
  WikiUpdateDigest,
  HistoryEntry,
  InboxItem,
  JournalEntry,
  JournalSummary,
  LockInfo,
  PageBundle,
  PageComment,
  PageActivityItem,
  BacklinkInfo,
  PageMeta,
  PageProperties,
  PageHistoryReason,
  PageSidebarCounts,
  PageTreeNode,
  PageWithLock,
  WorkspaceDatabase,
  WorkspaceScope,
  DatabaseRowContent,
  SaveDatabaseRowContentInput,
  ResourceLinkInfo,
  ResourceRef,
  DatabaseSidebarRow,
  DatabaseSidebarRowsResult,
  DatabaseSidebarChildPagesResult,
} from "../../shared/types";

type SmartAssistTransformerSettings = {
  enabled?: boolean;
  modelId: string;
  modelRoot?: string;
  localModelPath?: string;
  provider?: string;
  localCacheDir?: string;
  semanticIdleEnabled?: boolean;
  semanticIdleBatchSize?: number;
  semanticIdleDelaySec?: number;
  dtype?: "q8";
  localFilesOnly?: true;
  updatedAt?: string;
  updatedBy?: string;
};

type SmartAssistGenerationSettings = {
  enabled?: boolean;
  provider?: "none" | "llama-cpp";
  modelRoot?: string;
  selectedModelPath?: string;
  llamaExecutablePath?: string;
  llamaRuntimeDir?: string;
  preset?: "fast" | "light" | "balanced" | "manual";
  performanceMode?: "fast" | "standard" | "quality";
  retryMode?: "off" | "on-error" | "full";
  generationRuntimeMode?: "oneshot" | "server";
  llamaServerExecutablePath?: string;
  llamaServerHost?: string;
  llamaServerPort?: number;
  llamaServerAutoStart?: boolean;
  llamaServerFallback?: boolean;
  contextSize?: number;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  updatedAt?: string;
  updatedBy?: string;
};

function dbCellTextForTitle(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

function databaseRowTitle(
  database: WorkspaceDatabase,
  row: DatabaseRow,
): string {
  const preferred = database.properties.find((prop) =>
    /^(title|name|名前|件名|項目)$/i.test(prop.name),
  );
  const firstText = database.properties.find((prop) => prop.type === "text");
  const prop = preferred || firstText || database.properties[0];
  const text = prop ? dbCellTextForTitle(row.cells[prop.id]).trim() : "";
  return text || row.id;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeRegExpText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textSnippetAround(text: string, needle: string): string {
  const source = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "";
  const index = needle ? source.indexOf(needle) : -1;
  if (index < 0) return source.slice(0, 180);
  return source.slice(
    Math.max(0, index - 70),
    Math.min(source.length, index + needle.length + 90),
  );
}

const DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID = "sirasagi62/ruri-v3-70m-ONNX";
const execFileAsync = promisify(execFile);

function smartAssistModelParts(modelId: string): string[] {
  return String(modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID)
    .split("/")
    .filter(Boolean);
}

function resolveSmartAssistModelDir(
  modelRoot: string,
  modelId: string,
): string {
  // Accept either a root folder (D:/Models) or the model folder itself
  // (D:/Models/sirasagi62/ruri-v3-70m-ONNX).
  if (
    fs.existsSync(path.join(modelRoot, "config.json")) &&
    fs.existsSync(path.join(modelRoot, "onnx"))
  ) {
    return modelRoot;
  }
  return path.join(modelRoot, ...smartAssistModelParts(modelId));
}

async function downloadFile(url: string, destination: string): Promise<void> {
  await fs.ensureDir(path.dirname(destination));
  const downloadUrl = new URL(url);
  await new Promise<void>((resolve, reject) => {
    const request = https.get(
      downloadUrl,
      {
        headers: {
          // Hugging Face/Xet redirects can reject default Node clients in some environments.
          "User-Agent": "local-notion-lite/1.0 (+https://huggingface.co)",
          Accept: "application/octet-stream,*/*",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          const redirected = new URL(
            response.headers.location,
            downloadUrl,
          ).toString();
          downloadFile(redirected, destination).then(resolve).catch(reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(
            new Error(
              `Download failed: ${status} ${response.statusMessage || ""} ${downloadUrl.toString()}`,
            ),
          );
          return;
        }
        const file = fs.createWriteStream(destination);
        streamPipeline(response, file).then(resolve).catch(reject);
      },
    );
    request.on("error", reject);
  });
}

const EMPTY_BLOCKSUITE = { version: 1, blocks: [] };

const DEFAULT_PAGE_PROPERTIES: PageProperties = {
  tags: [],
  status: "未着手",
  assignee: "",
  dueDate: "",
  priority: "Mid",
};

function pageScopeFrom(input: unknown): "private" | "shared" {
  const raw = (input && typeof input === "object" ? input : {}) as any;
  return raw.scope === "private" || raw.__scope === "private"
    ? "private"
    : "shared";
}

function normalizeFaqDedupText(input: unknown): string {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[、。,.!！?？「」『』（）()"'`]/g, "")
    .trim();
}

function workspaceScopeFrom(input: unknown): WorkspaceScope {
  const raw = (input && typeof input === "object" ? input : {}) as any;
  return raw.scope === "private" || raw.__scope === "private"
    ? "private"
    : "shared";
}

function propertiesForStorage(
  properties: PageProperties,
  scope: "private" | "shared",
): Record<string, unknown> {
  return { ...properties, __scope: scope };
}

function normalizeProperties(input: unknown): PageProperties {
  const raw = (
    input && typeof input === "object" ? input : {}
  ) as Partial<PageProperties>;
  return {
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
    status: ["未着手", "進行中", "確認待ち", "完了", "保留"].includes(
      String(raw.status),
    )
      ? (raw.status as PageProperties["status"])
      : "未着手",
    assignee: raw.assignee ? String(raw.assignee) : "",
    dueDate: raw.dueDate ? String(raw.dueDate) : "",
    priority: ["Low", "Mid", "High"].includes(String(raw.priority))
      ? (raw.priority as PageProperties["priority"])
      : "Mid",
    wikiStatus: ["draft", "verified", "review", "archived"].includes(
      String(raw.wikiStatus),
    )
      ? (raw.wikiStatus as PageProperties["wikiStatus"])
      : "draft",
    wikiVerifiedAt: raw.wikiVerifiedAt ? String(raw.wikiVerifiedAt) : "",
    wikiReviewDue: raw.wikiReviewDue ? String(raw.wikiReviewDue) : "",
    wikiOwner: raw.wikiOwner ? String(raw.wikiOwner) : "",
    wikiSource: raw.wikiSource ? String(raw.wikiSource) : "",
    wikiSuccessorId: raw.wikiSuccessorId ? String(raw.wikiSuccessorId) : "",
    projectRole: raw.projectRole === "project" ? "project" : undefined,
    projectId: raw.projectId ? String(raw.projectId) : "",
    projectStatus: ["計画中", "進行中", "確認待ち", "完了", "保留"].includes(
      String(raw.projectStatus),
    )
      ? (raw.projectStatus as PageProperties["projectStatus"])
      : "計画中",
    projectDueDate: raw.projectDueDate ? String(raw.projectDueDate) : "",
    projectSummary: raw.projectSummary
      ? String(raw.projectSummary).slice(0, 2000)
      : "",
  };
}

/**
 * Server-side defence against duplicate page saves.  The renderer already
 * suppresses identical BlockNote change events, but a no-op here prevents a
 * repeated request from changing updatedAt or creating another history entry.
 */
function pageSaveMatchesCurrent(
  current: PageBundle,
  input: {
    title: string;
    markdown: string;
    blocksuite: unknown;
    properties?: PageProperties;
    icon?: string | null;
    scope?: "private" | "shared";
  },
): boolean {
  const requestedProperties = normalizeProperties(
    input.properties ?? current.meta.properties,
  );
  const currentProperties = normalizeProperties(current.meta.properties);
  const requestedScope =
    input.scope === "private"
      ? "private"
      : input.scope === "shared"
        ? "shared"
        : current.meta.scope === "private"
          ? "private"
          : "shared";
  const currentScope = current.meta.scope === "private" ? "private" : "shared";
  const requestedIcon = input.icon ?? current.meta.icon ?? "📄";
  const currentIcon = current.meta.icon ?? "📄";
  try {
    return (
      current.meta.title === input.title &&
      currentIcon === requestedIcon &&
      currentScope === requestedScope &&
      JSON.stringify(currentProperties) ===
        JSON.stringify(requestedProperties) &&
      current.markdown === input.markdown &&
      JSON.stringify(current.blocksuite ?? EMPTY_BLOCKSUITE) ===
        JSON.stringify(input.blocksuite ?? EMPTY_BLOCKSUITE)
    );
  } catch {
    return false;
  }
}

/**
 * Tags are lightweight classification metadata. They should persist immediately
 * but must not create a version-history checkpoint on every add/remove/merge.
 * Other page metadata remains a meaningful checkpoint.
 */
function propertiesExceptTags(
  properties: PageProperties,
): Omit<PageProperties, "tags"> {
  const { tags: _tags, ...rest } = normalizeProperties(properties);
  return rest;
}

/** Returns true when meaningful page-level metadata changes, excluding tags. */
function pageMetadataChanged(
  current: PageBundle,
  input: {
    title: string;
    properties?: PageProperties;
    icon?: string | null;
    scope?: "private" | "shared";
  },
): boolean {
  const requestedProperties = propertiesExceptTags(
    input.properties ?? current.meta.properties,
  );
  const currentProperties = propertiesExceptTags(current.meta.properties);
  const requestedScope =
    input.scope === "private"
      ? "private"
      : input.scope === "shared"
        ? "shared"
        : current.meta.scope === "private"
          ? "private"
          : "shared";
  const currentScope = current.meta.scope === "private" ? "private" : "shared";
  return (
    current.meta.title !== input.title ||
    (current.meta.icon ?? "📄") !== (input.icon ?? current.meta.icon ?? "📄") ||
    currentScope !== requestedScope ||
    JSON.stringify(currentProperties) !== JSON.stringify(requestedProperties)
  );
}

function normalizeMeta(input: Partial<PageMeta>, fallbackId: string): PageMeta {
  const now = new Date().toISOString();
  return {
    id: input.id || fallbackId,
    title: input.title || "Untitled",
    parentId: input.parentId ?? null,
    icon: input.icon || "📄",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || input.createdAt || now,
    updatedBy: input.updatedBy || os.hostname(),
    sortOrder: Number.isFinite(input.sortOrder)
      ? Number(input.sortOrder)
      : Date.now(),
    favorite: Boolean((input as any).favorite),
    trashed: Boolean(input.trashed),
    properties: normalizeProperties((input as any).properties),
    scope: pageScopeFrom(input) || pageScopeFrom((input as any).properties),
  };
}

function normalizeDatabaseViewType(value: unknown): DatabaseView["type"] {
  return [
    "table",
    "board",
    "calendar",
    "gallery",
    "timeline",
    "gantt",
    "form",
  ].includes(String(value))
    ? (String(value) as DatabaseView["type"])
    : "table";
}

function normalizeDatabaseFilterOperator(
  value: unknown,
): DatabaseFilterOperatorCompat {
  if (value === "empty") return "is_empty";
  if (value === "not_empty") return "is_not_empty";
  const allowed = [
    "contains",
    "not_contains",
    "equals",
    "not_equals",
    "starts_with",
    "ends_with",
    "greater_than",
    "less_than",
    "before",
    "after",
    "today",
    "this_week",
    "this_month",
    "overdue",
    "is_empty",
    "is_not_empty",
  ];
  return allowed.includes(String(value))
    ? (String(value) as DatabaseFilterOperatorCompat)
    : "contains";
}

type DatabaseFilterOperatorCompat = DatabaseView["filters"][number]["operator"];

function safeJsonParseObject(
  value: string | null | undefined,
): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function dbCellPlainText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(" ");
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function dbCellNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = dbCellPlainText(value)
    .replace(/,/g, "")
    .replace(/%$/g, "")
    .trim();
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

function dbCellDateText(value: unknown): string {
  return dbCellPlainText(value).slice(0, 10);
}

function dbCellIsEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    dbCellPlainText(value).length === 0 ||
    (Array.isArray(value) && value.length === 0)
  );
}

const JST_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function jstYmd(date: Date = new Date()): string {
  return JST_YMD_FORMATTER.format(date);
}

function addDaysToYmd(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return ymd;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return date.toISOString().slice(0, 10);
}

function weekdayOfYmd(ymd: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return 0;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  ).getUTCDay();
}

function dbCellBoolean(value: unknown): number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = dbCellPlainText(value).trim().toLowerCase();
  if (!text) return null;
  if (["true", "1", "yes", "on", "checked", "完了"].includes(text)) return 1;
  if (["false", "0", "no", "off", "unchecked", "未完了"].includes(text))
    return 0;
  return null;
}

function dbFilterMatches(
  value: unknown,
  operator: string,
  expected: unknown,
): boolean {
  const text = dbCellPlainText(value).toLowerCase();
  const exp = dbCellPlainText(expected).toLowerCase();
  const todayYmd = jstYmd();
  const valueDate = dbCellPlainText(value).slice(0, 10);
  switch (operator) {
    case "contains":
      return text.includes(exp);
    case "not_contains":
      return !text.includes(exp);
    case "equals":
      return text === exp;
    case "not_equals":
      return text !== exp;
    case "starts_with":
      return text.startsWith(exp);
    case "ends_with":
      return text.endsWith(exp);
    case "greater_than":
      return dbCellNumber(value) > dbCellNumber(expected);
    case "less_than":
      return dbCellNumber(value) < dbCellNumber(expected);
    case "before":
      return (
        Boolean(valueDate) && valueDate < dbCellPlainText(expected).slice(0, 10)
      );
    case "after":
      return (
        Boolean(valueDate) && valueDate > dbCellPlainText(expected).slice(0, 10)
      );
    case "today":
      return valueDate === todayYmd;
    case "this_week": {
      if (!valueDate) return false;
      const start = addDaysToYmd(todayYmd, -weekdayOfYmd(todayYmd));
      const end = addDaysToYmd(start, 7);
      return valueDate >= start && valueDate < end;
    }
    case "this_month":
      return valueDate.startsWith(todayYmd.slice(0, 7));
    case "overdue":
      return Boolean(valueDate) && valueDate < todayYmd;
    case "is_empty":
      return text.length === 0 || (Array.isArray(value) && value.length === 0);
    case "is_not_empty":
      return text.length > 0 || (Array.isArray(value) && value.length > 0);
    default:
      return true;
  }
}

function normalizeSmartIntentForRouting(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9_\-.\u30a0-\u30ff\u3040-\u309f\u4e00-\u9faf]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function smartIntentGroup(value: unknown): string {
  const normalized = normalizeSmartIntentForRouting(value);
  return normalized.split(/[._-]/)[0] || normalized;
}

function getSmartRecordIntentCandidates(
  record: SmartFaqSearchRecord,
): string[] {
  return [
    record.intentId,
    ...(Array.isArray(record.intentIds) ? record.intentIds : []),
    ...(Array.isArray(record.intent) ? record.intent : [record.intent]),
  ]
    .map(normalizeSmartIntentForRouting)
    .filter(Boolean);
}

function isSameSmartFaqFamily(
  base: SmartFaqSearchRecord,
  other: SmartFaqSearchRecord,
): boolean {
  if (base.id === other.id) return false;
  const baseIntents = getSmartRecordIntentCandidates(base);
  const otherIntents = getSmartRecordIntentCandidates(other);
  if (baseIntents.length && otherIntents.length) {
    if (baseIntents.some((intent) => otherIntents.includes(intent)))
      return true;
    const baseGroups = baseIntents.map(smartIntentGroup).filter(Boolean);
    const otherGroups = otherIntents.map(smartIntentGroup).filter(Boolean);
    if (baseGroups.some((group) => group && otherGroups.includes(group)))
      return true;
  }
  const baseCategory = String(base.category || "").trim();
  const otherCategory = String(other.category || "").trim();
  return Boolean(
    baseCategory && otherCategory && baseCategory === otherCategory,
  );
}

type SmartAssistUxLevel = "high" | "medium" | "low";

function buildSmartAssistSuggestions(args: {
  message: string;
  record?: SmartFaqSearchRecord | null;
  related?: Array<{ record: SmartFaqSearchRecord }>;
  categoryHints?: string[];
  level?: SmartAssistUxLevel;
}): {
  suggestedActions: string[];
  nextQuestions: string[];
  clarificationChips: string[];
} {
  const message = String(args.message || "");
  const record = args.record || null;
  const category = String(
    record?.category || args.categoryHints?.[0] || "",
  ).trim();
  const answerText = String(record?.answer || "");
  const q = String(record?.question || "").trim();
  const explicitActions = Array.isArray((record as any)?.suggestedActions)
    ? (record as any).suggestedActions
    : [];
  const explicitNext = Array.isArray((record as any)?.nextQuestions)
    ? (record as any).nextQuestions
    : [];
  const followups = Array.isArray((record as any)?.followUpQuestions)
    ? (record as any).followUpQuestions
    : [];

  const actions: string[] = [...explicitActions];
  const next: string[] = [...explicitNext];
  const clarifications: string[] = [];

  if (category) actions.push(`${category}の関連FAQを確認する`);
  if (q)
    actions.push(
      "この回答をFAQとして保存する",
      "担当者に確認するための文面を作成する",
    );

  const text = `${message} ${q} ${answerText} ${category}`;
  if (/費用|料金|利用料|金額|いくら|減免|支払|口座|月額/.test(text)) {
    actions.push(
      "月額料金を確認する",
      "減免制度を確認する",
      "支払方法を確認する",
      "担当課への問い合わせ文を作成する",
    );
    next.push(
      "延長利用料はいくらですか？",
      "減免制度はありますか？",
      "長期休業期間の追加費用はありますか？",
    );
  }
  if (/申請|手続|提出|期限|取消|取り消|キャンセル|変更/.test(text)) {
    actions.push(
      "必要書類を確認する",
      "提出先を確認する",
      "申請期限を確認する",
    );
    next.push(
      "必要書類は何ですか？",
      "申請方法を教えてください",
      "期限を過ぎた場合はどうすればよいですか？",
    );
  }
  if (/休暇|有給|有休|年休|年次休暇|看護|休み/.test(text)) {
    actions.push(
      "取得条件を確認する",
      "申請方法を確認する",
      "残日数や付与日を確認する",
    );
    next.push(
      "有給はいつから取得できますか？",
      "時間単位で休暇を取れますか？",
      "急に休む場合はどうすればよいですか？",
    );
  }
  if (/給与|給料|手当|通勤|交通費|報酬/.test(text)) {
    actions.push(
      "支給条件を確認する",
      "対象期間を確認する",
      "必要な届出を確認する",
    );
    next.push(
      "通勤手当は支給されますか？",
      "給与の支給日はいつですか？",
      "手当の申請方法を教えてください",
    );
  }

  for (const item of args.related || []) {
    if (item?.record?.question) next.push(String(item.record.question));
  }
  next.push(...followups);

  if (args.level === "low") {
    clarifications.push(
      ...(args.categoryHints || []).map((cat) => `${cat}について確認する`),
    );
    clarifications.push(
      "手続き名を追加して質問する",
      "対象者や期間を追加して質問する",
      "この質問を未回答FAQとして保存する",
    );
  } else if (args.level === "medium") {
    clarifications.push(
      "この候補で合っている",
      "別の候補を表示する",
      "もう少し詳しく回答する",
    );
  } else {
    clarifications.push(
      "詳しく教えて",
      "手順で教えて",
      "問い合わせ文を作成する",
    );
  }

  return {
    suggestedActions: uniqueSmartAssistStrings(actions, 6),
    nextQuestions: uniqueSmartAssistStrings(next, 6),
    clarificationChips: uniqueSmartAssistStrings(clarifications, 6),
  };
}

function smartAssistConfidenceLevel(confidence: number): SmartAssistUxLevel {
  // v201: カテゴリ・キーワードが合っているFAQは、50%以上で「候補回答」を出す。
  // ただし85以上だけを高信頼として扱い、誤回答を避ける。
  if (confidence >= 85) return "high";
  if (confidence >= 50) return "medium";
  return "low";
}

function smartAssistConfidenceLabel(confidence: number): "高" | "中" | "低" {
  return confidence >= 85 ? "高" : confidence >= 50 ? "中" : "低";
}

function uniqueSmartAssistStrings(
  values: Array<unknown>,
  limit = 20,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value || "").trim();
    const key = text.normalize("NFKC").toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

type SmartAssistSynonymEntry = {
  id: string;
  base: string;
  variants: string[];
  category?: string;
  intentId?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

const DEFAULT_SMART_ASSIST_SYNONYMS: SmartAssistSynonymEntry[] = [
  {
    id: "syn_leave_paid",
    base: "年次有給休暇",
    variants: [
      "有給",
      "有休",
      "年休",
      "年次休暇",
      "有給休暇",
      "年次有給休暇",
      "有給付与",
      "年休付与",
    ],
    category: "休暇",
    intentId: "leave.paid_start",
    enabled: true,
  },
  {
    id: "syn_leave_child_sick",
    base: "子の看護休暇",
    variants: [
      "子どもが熱",
      "子供が熱",
      "発熱",
      "保育園から呼び出し",
      "急に休む",
      "看護休暇",
    ],
    category: "休暇",
    intentId: "leave.child_sick",
    enabled: true,
  },
  {
    id: "syn_application_cancel",
    base: "申請取消",
    variants: [
      "取り消し",
      "取消",
      "キャンセル",
      "取り下げ",
      "間違えて申請",
      "訂正",
      "変更申請",
    ],
    category: "申請・手続き",
    intentId: "application.cancel",
    enabled: true,
  },
  {
    id: "syn_deadline_missed",
    base: "申請期限超過",
    variants: [
      "締切過ぎた",
      "期限過ぎた",
      "提出期限超過",
      "間に合わない",
      "申請忘れ",
      "期限後",
    ],
    category: "申請・手続き",
    intentId: "application.deadline_missed",
    enabled: true,
  },
  {
    id: "syn_commuting_allowance",
    base: "通勤手当",
    variants: ["交通費", "通勤費", "定期代", "電車代", "バス代", "通勤経路"],
    category: "給与・手当",
    intentId: "allowance.commuting",
    enabled: true,
  },
  {
    id: "syn_afterschool_fee",
    base: "放課後児童クラブ利用料",
    variants: [
      "学童費用",
      "学童の費用",
      "学童料金",
      "学童の料金",
      "放課後児童クラブ費用",
      "放課後児童クラブ利用料",
      "月額料金",
      "月額利用料",
      "延長料金",
    ],
    category: "放課後児童クラブ",
    intentId: "afterschool.fee",
    enabled: true,
  },
  {
    id: "syn_afterschool_reduction",
    base: "放課後児童クラブ減免",
    variants: [
      "学童減免",
      "減免制度",
      "利用料減免",
      "免除",
      "安くなる",
      "兄弟減免",
    ],
    category: "放課後児童クラブ",
    intentId: "afterschool.reduction",
    enabled: true,
  },
  {
    id: "syn_lgwan",
    base: "LGWAN",
    variants: [
      "庁内ネットワーク",
      "情報セキュリティ",
      "外部サービス",
      "クラウド利用",
      "USB",
    ],
    category: "情報システム",
    intentId: "system.lgwan_external_service",
    enabled: true,
  },
];

type SmartAssistRuleProfileEntry = {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  category?: string;
  intentId?: string;
  terms: string[];
  boostTerms?: string[];
  questionTypes?: string[];
  negativeTerms?: string[];
  parentIntentIds?: string[];
  weight?: number;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

const DEFAULT_SMART_ASSIST_RULE_PROFILES: SmartAssistRuleProfileEntry[] = [
  {
    id: "rule_leave_paid_start",
    label: "有給・年休の取得開始",
    description:
      "「有給はいつから」「年休はいつ付与」など短い質問を年休・有給系FAQへ寄せる汎用ルール。",
    enabled: true,
    category: "休暇",
    intentId: "leave.paid_start",
    terms: ["有給", "有休", "年休", "年次休暇", "有給休暇"],
    boostTerms: [
      "いつから",
      "付与",
      "付与日",
      "使える",
      "使えます",
      "取得開始",
      "開始",
    ],
    questionTypes: ["start_or_grant"],
    negativeTerms: ["子ども", "子供", "発熱", "保育園", "看護休暇", "子の看護"],
    parentIntentIds: ["leave.annual", "leave_vacation", "annual_leave"],
    weight: 1.2,
  },
  {
    id: "rule_application_cancel",
    label: "申請取消・取り下げ",
    enabled: true,
    category: "申請・手続き",
    intentId: "application.cancel",
    terms: ["申請", "手続き"],
    boostTerms: [
      "取消",
      "取り消し",
      "取り下げ",
      "キャンセル",
      "訂正",
      "間違えて申請",
    ],
    questionTypes: ["cancel_or_correction"],
    weight: 1,
  },
  {
    id: "rule_required_documents",
    label: "必要書類・添付書類",
    enabled: true,
    category: "申請・手続き",
    intentId: "application.required_documents",
    terms: ["申請", "手続き", "書類"],
    boostTerms: ["必要書類", "添付", "様式", "証明書", "何が必要"],
    questionTypes: ["required_documents"],
    weight: 1,
  },
  {
    id: "rule_method_howto",
    label: "方法・手順",
    enabled: true,
    category: "申請・手続き",
    intentId: "application.method",
    terms: ["申請", "手続き", "方法"],
    boostTerms: ["どうやって", "どこに", "提出方法", "申請方法", "手順"],
    questionTypes: ["method"],
    weight: 1,
  },
  {
    id: "rule_afterschool_fee",
    label: "学童・放課後児童クラブ費用",
    description:
      "「学童の費用」「利用料を確認」「月額料金」など短い質問を学童費用FAQへ寄せる汎用ルール。",
    enabled: true,
    category: "放課後児童クラブ",
    intentId: "afterschool.fee",
    terms: ["学童", "放課後児童クラブ", "児童クラブ"],
    boostTerms: [
      "費用",
      "料金",
      "利用料",
      "月額",
      "確認",
      "いくら",
      "支払",
      "延長料金",
    ],
    questionTypes: ["fee_or_price"],
    negativeTerms: ["有給", "年休", "LGWAN", "通勤手当"],
    parentIntentIds: ["afterschool.fee"],
    weight: 1.35,
  },
  {
    id: "rule_afterschool_reduction",
    label: "学童・放課後児童クラブ減免",
    enabled: true,
    category: "放課後児童クラブ",
    intentId: "afterschool.reduction",
    terms: ["学童", "放課後児童クラブ", "減免"],
    boostTerms: ["減免", "免除", "安く", "非課税", "兄弟", "生活保護"],
    questionTypes: ["reduction_or_exemption"],
    weight: 1.25,
  },
];

function normalizeSmartAssistRuleProfileEntry(
  item: any,
  userLabel = "system",
): SmartAssistRuleProfileEntry | null {
  const label = String(item?.label ?? item?.name ?? item?.title ?? "").trim();
  const terms = Array.isArray(item?.terms)
    ? item.terms
        .map(String)
        .map((v: string) => v.trim())
        .filter(Boolean)
    : [];
  const boostTerms = Array.isArray(item?.boostTerms)
    ? item.boostTerms
        .map(String)
        .map((v: string) => v.trim())
        .filter(Boolean)
    : [];
  if (!label || (!terms.length && !boostTerms.length)) return null;
  const now = new Date().toISOString();
  return {
    id: String(item?.id || `rule_${nanoid(10)}`),
    label,
    description: item?.description ? String(item.description) : undefined,
    enabled: item?.enabled !== false,
    category: item?.category ? String(item.category) : undefined,
    intentId: item?.intentId
      ? String(item.intentId)
      : item?.intent
        ? String(item.intent)
        : undefined,
    terms: uniqueSmartAssistStrings(terms, 80),
    boostTerms: uniqueSmartAssistStrings(boostTerms, 80),
    questionTypes: Array.isArray(item?.questionTypes)
      ? uniqueSmartAssistStrings(item.questionTypes.map(String), 20)
      : undefined,
    negativeTerms: Array.isArray(item?.negativeTerms)
      ? uniqueSmartAssistStrings(item.negativeTerms.map(String), 40)
      : undefined,
    parentIntentIds: Array.isArray(item?.parentIntentIds)
      ? uniqueSmartAssistStrings(item.parentIntentIds.map(String), 20)
      : undefined,
    weight: Number.isFinite(Number(item?.weight))
      ? Math.max(0.2, Math.min(3, Number(item.weight)))
      : 1,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    updatedBy: String(item?.updatedBy || userLabel),
  };
}

function analyzeSmartAssistRuleProfiles(
  message: string,
  expandedTerms: string[],
  profiles: SmartAssistRuleProfileEntry[],
): {
  matchedProfiles: SmartAssistRuleProfileEntry[];
  categories: string[];
  intents: string[];
  questionTypes: string[];
  boostTerms: string[];
} {
  const text = normalizeJapaneseText([message, ...expandedTerms].join(" "));
  const matched: SmartAssistRuleProfileEntry[] = [];
  const categories: string[] = [];
  const intents: string[] = [];
  const questionTypes: string[] = [];
  const boostTerms: string[] = [];
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const requiredTerms = (profile.terms || [])
      .map(normalizeJapaneseText)
      .filter(Boolean);
    const boostTerms = (profile.boostTerms || [])
      .map(normalizeJapaneseText)
      .filter(Boolean);
    const termHit =
      requiredTerms.length === 0 ||
      requiredTerms.some((term) => text.includes(term));
    const boostHit = boostTerms.some((term) => text.includes(term));
    const looseReverseHit =
      !boostTerms.length &&
      requiredTerms.some((term) => term.length >= 2 && term.includes(text));
    const hit = boostTerms.length
      ? termHit && boostHit
      : termHit || looseReverseHit;
    if (!hit) continue;
    matched.push(profile);
    if (profile.category) categories.push(profile.category);
    if (profile.intentId) intents.push(profile.intentId);
    if (Array.isArray(profile.parentIntentIds))
      intents.push(...profile.parentIntentIds);
    if (Array.isArray(profile.questionTypes))
      questionTypes.push(...profile.questionTypes);
    boostTerms.push(...(profile.terms || []), ...(profile.boostTerms || []));
  }
  return {
    matchedProfiles: matched,
    categories: uniqueSmartAssistStrings(categories, 12),
    intents: uniqueSmartAssistStrings(intents, 20),
    questionTypes: uniqueSmartAssistStrings(questionTypes, 20),
    boostTerms: uniqueSmartAssistStrings(boostTerms, 120),
  };
}

function applySmartAssistRuleProfileBoost(params: {
  record: SmartFaqSearchRecord;
  profiles: SmartAssistRuleProfileEntry[];
  message: string;
  expandedTerms: string[];
}): { bonus: number; reasons: string[]; forceMargin?: boolean } {
  const { record, profiles, message, expandedTerms } = params;
  const text = smartAssistRecordText(record);
  const recordIntents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const queryText = normalizeJapaneseText(
    [message, ...expandedTerms].join(" "),
  );
  const reasons: string[] = [];
  let bonus = 0;
  let forceMargin = false;
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const weight = Number.isFinite(Number(profile.weight))
      ? Number(profile.weight)
      : 1;
    const profileIntent = profile.intentId
      ? normalizeSmartIntentForRouting(profile.intentId)
      : "";
    const parentIntents = (profile.parentIntentIds || []).map(
      normalizeSmartIntentForRouting,
    );
    const negativeHit = (profile.negativeTerms || []).some((term) =>
      text.includes(normalizeJapaneseText(term)),
    );
    if (negativeHit) {
      bonus -= Math.round(38 * weight);
      reasons.push(`汎用ルール除外: ${profile.label}`);
      continue;
    }
    const exactIntent =
      !!profileIntent && recordIntents.includes(profileIntent);
    const parentIntent = parentIntents.some((intent) =>
      recordIntents.includes(intent),
    );
    const categoryHit =
      profile.category &&
      normalizeJapaneseText(String(record.category || "")) ===
        normalizeJapaneseText(profile.category);
    const recordTermHit = [
      ...(profile.terms || []),
      ...(profile.boostTerms || []),
    ].some((term) => text.includes(normalizeJapaneseText(term)));
    const queryBoostHit = (profile.boostTerms || []).some((term) =>
      queryText.includes(normalizeJapaneseText(term)),
    );
    if (exactIntent) {
      bonus += Math.round(58 * weight);
      forceMargin = true;
      reasons.push(`汎用ルールIntent一致: ${profile.label}`);
    } else if (parentIntent) {
      bonus += Math.round(34 * weight);
      forceMargin = true;
      reasons.push(`汎用ルール親Intent一致: ${profile.label}`);
    } else if (categoryHit && recordTermHit) {
      bonus += Math.round(22 * weight);
      reasons.push(`汎用ルールカテゴリ一致: ${profile.label}`);
    } else if (queryBoostHit && profile.category && !categoryHit) {
      bonus -= Math.round(26 * weight);
      reasons.push(`汎用ルールカテゴリ不一致: ${profile.label}`);
    }
  }
  return { bonus, reasons: uniqueSmartAssistStrings(reasons, 8), forceMargin };
}

function normalizeSmartAssistSynonymEntry(
  item: any,
  userLabel = "system",
): SmartAssistSynonymEntry | null {
  const base = String(item?.base ?? item?.name ?? "").trim();
  const variants = Array.isArray(item?.variants)
    ? item.variants
        .map(String)
        .map((v: string) => v.trim())
        .filter(Boolean)
    : [];
  if (!base || variants.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: String(item?.id || `syn_${nanoid(10)}`),
    base,
    variants: uniqueSmartAssistStrings(variants, 80),
    category: item?.category ? String(item.category) : undefined,
    intentId: item?.intentId
      ? String(item.intentId)
      : item?.intent
        ? String(item.intent)
        : undefined,
    enabled: item?.enabled !== false,
    createdAt: String(item?.createdAt || now),
    updatedAt: String(item?.updatedAt || now),
    updatedBy: String(item?.updatedBy || userLabel),
  };
}

function expandByCustomSmartAssistSynonyms(
  message: string,
  synonyms: SmartAssistSynonymEntry[],
): { terms: string[]; categories: string[]; intents: string[] } {
  const text = normalizeJapaneseText(message);
  const terms: string[] = [];
  const categories: string[] = [];
  const intents: string[] = [];
  for (const entry of synonyms) {
    if (!entry.enabled) continue;
    const group = [entry.base, ...entry.variants];
    const hit = group.some((term) => {
      const normalized = normalizeJapaneseText(term);
      return (
        normalized && (text.includes(normalized) || normalized.includes(text))
      );
    });
    if (!hit) continue;
    terms.push(...group);
    if (entry.category) categories.push(entry.category);
    if (entry.intentId) intents.push(entry.intentId);
  }
  return {
    terms: uniqueSmartAssistStrings(terms, 80),
    categories: uniqueSmartAssistStrings(categories, 8),
    intents: uniqueSmartAssistStrings(intents, 8),
  };
}

const SMART_CATEGORY_GUARDS: Array<{
  category: string;
  terms: string[];
  negativeCategories?: string[];
}> = [
  {
    category: "休暇",
    terms: [
      "有給",
      "有休",
      "年休",
      "年次有給休暇",
      "有給休暇",
      "年次休暇",
      "休暇",
      "休み",
      "子の看護",
      "看護休暇",
      "発熱",
    ],
  },
  {
    category: "申請・手続き",
    terms: [
      "申請",
      "手続",
      "手続き",
      "提出",
      "期限",
      "締切",
      "取消",
      "取り消し",
      "キャンセル",
      "取り下げ",
      "必要書類",
    ],
  },
  {
    category: "給与・手当",
    terms: [
      "給与",
      "給料",
      "報酬",
      "手当",
      "通勤手当",
      "交通費",
      "定期代",
      "扶養手当",
    ],
  },
  {
    category: "勤務条件",
    terms: [
      "勤務時間",
      "勤務日数",
      "勤務条件",
      "就労要件",
      "シフト",
      "出勤",
      "退勤",
    ],
  },
  {
    category: "情報システム",
    terms: [
      "LGWAN",
      "庁内ネットワーク",
      "情報セキュリティ",
      "外部サービス",
      "クラウド",
      "USB",
    ],
  },
  {
    category: "放課後児童クラブ",
    terms: [
      "放課後児童クラブ",
      "学童",
      "児童クラブ",
      "利用料",
      "育成料",
      "延長利用",
    ],
  },
];

function detectSmartAssistCategoryGuards(
  message: string,
  synonymCategories: string[] = [],
): string[] {
  const text = normalizeJapaneseText(message);
  const categories: string[] = [...synonymCategories];
  for (const guard of SMART_CATEGORY_GUARDS) {
    if (guard.terms.some((term) => text.includes(normalizeJapaneseText(term))))
      categories.push(guard.category);
  }
  return uniqueSmartAssistStrings(categories, 8);
}

function recordIntentValues(record: SmartFaqSearchRecord): string[] {
  return uniqueSmartAssistStrings(
    [
      record.intentId,
      ...(Array.isArray(record.intentIds) ? record.intentIds : []),
      ...(Array.isArray(record.intent)
        ? record.intent
        : record.intent
          ? [record.intent]
          : []),
      record.domainId,
      record.domain,
    ],
    20,
  );
}

function smartKeywordOverlap(
  queryTerms: string[],
  record: SmartFaqSearchRecord,
): number {
  const haystack = normalizeJapaneseText(
    [
      record.question,
      record.category,
      Array.isArray(record.tags) ? record.tags.join(" ") : "",
      record.intentId,
      Array.isArray(record.intentIds) ? record.intentIds.join(" ") : "",
      record.intentLabel,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const terms = uniqueSmartAssistStrings(queryTerms, 80)
    .map(normalizeJapaneseText)
    .filter((t) => t.length >= 2);
  if (!terms.length || !haystack) return 0;
  const hits = terms.filter((term) => haystack.includes(term));
  return Math.min(1, hits.length / Math.min(8, Math.max(1, terms.length)));
}

function detectSmartAssistQuestionTypes(
  message: string,
  expandedTerms: string[] = [],
  profileQuestionTypes: string[] = [],
): string[] {
  const text = normalizeJapaneseText([message, ...expandedTerms].join(" "));
  const types: string[] = [...profileQuestionTypes];
  if (
    /(いつから|何日から|取得開始|使えます|使える|付与|付与日|発生|開始)/.test(
      text,
    )
  )
    types.push("start_or_grant");
  if (/(急に|今日|明日|発熱|熱|保育園|呼び出し|子ども|子供|看護)/.test(text))
    types.push("urgent_child_care");
  if (/(費用|料金|利用料|金額|いくら|月額|支払|支払い)/.test(text))
    types.push("fee_or_price");
  if (/(減免|免除|非課税|生活保護|兄弟|割引|安く|減額)/.test(text))
    types.push("reduction_or_exemption");
  if (/(方法|どうやって|どこに|提出|申請方法|手順)/.test(text))
    types.push("method");
  if (/(必要書類|添付|様式|証明書|書類)/.test(text))
    types.push("required_documents");
  if (/(取り消|取消|キャンセル|取り下げ|訂正|変更申請)/.test(text))
    types.push("cancel_or_correction");
  return uniqueSmartAssistStrings(types, 8);
}

function smartAssistRecordText(record: SmartFaqSearchRecord): string {
  return normalizeJapaneseText(
    [
      record.question,
      record.category,
      record.intentId,
      Array.isArray(record.intentIds) ? record.intentIds.join(" ") : "",
      Array.isArray(record.intent) ? record.intent.join(" ") : record.intent,
      record.intentLabel,
      Array.isArray(record.tags) ? record.tags.join(" ") : "",
      Array.isArray((record as any).keywords)
        ? (record as any).keywords.join(" ")
        : "",
      Array.isArray((record as any).examples)
        ? (record as any).examples.join(" ")
        : "",
      Array.isArray((record as any).testQuestions)
        ? (record as any).testQuestions.join(" ")
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function smartAssistRecordMetadataText(record: SmartFaqSearchRecord): string {
  return normalizeJapaneseText(
    [
      record.question,
      record.category,
      record.intentId,
      Array.isArray(record.intentIds) ? record.intentIds.join(" ") : "",
      Array.isArray(record.intent) ? record.intent.join(" ") : record.intent,
      record.intentLabel,
      Array.isArray(record.tags) ? record.tags.join(" ") : "",
      Array.isArray((record as any).keywords)
        ? (record as any).keywords.join(" ")
        : "",
      Array.isArray((record as any).examples)
        ? (record as any).examples.join(" ")
        : "",
      Array.isArray((record as any).testQuestions)
        ? (record as any).testQuestions.join(" ")
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function smartAssistRecordNegativeTerms(
  record: SmartFaqSearchRecord,
): string[] {
  return uniqueSmartAssistStrings(
    Array.isArray((record as any).negativeTerms)
      ? (record as any).negativeTerms.map(String)
      : [],
    80,
  )
    .map(normalizeJapaneseText)
    .filter((term) => term.length >= 2);
}

function smartAssistNegativeHitPenalty(
  message: string,
  expandedTerms: string[],
  record: SmartFaqSearchRecord,
): { penalty: number; cap?: number; reasons: string[] } {
  const queryText = normalizeJapaneseText(
    [message, ...expandedTerms].join(" "),
  );
  const negatives = smartAssistRecordNegativeTerms(record);
  if (!queryText || !negatives.length) return { penalty: 0, reasons: [] };
  const hits = negatives.filter((term) => queryText.includes(term));
  if (!hits.length) return { penalty: 0, reasons: [] };
  return {
    penalty: Math.min(70, 34 + hits.length * 8),
    cap: 54,
    reasons: [`FAQ除外語に一致: ${hits.slice(0, 3).join(" / ")}`],
  };
}

type SmartAssistSubjectGateResult = {
  querySubjects: string[];
  recordSubjects: string[];
  matched: boolean;
  penalty: number;
  cap?: number;
  reasons: string[];
};

const SMART_SUBJECT_DEFINITIONS = [
  {
    id: "fee.general",
    terms: [
      "費用",
      "料金",
      "利用料",
      "金額",
      "いくら",
      "月額",
      "支払",
      "支払い",
      "確認",
      "延長料金",
    ],
    negativeTerms: [
      "減免",
      "免除",
      "非課税",
      "生活保護",
      "ひとり親",
      "兄弟",
      "割引",
      "安く",
      "減額",
    ],
    intentIncludes: ["fee", "price", "charge"],
  },
  {
    id: "fee.reduction",
    terms: [
      "減免",
      "免除",
      "非課税",
      "生活保護",
      "ひとり親",
      "兄弟",
      "割引",
      "安く",
      "減額",
    ],
    negativeTerms: [],
    intentIncludes: ["reduction", "discount", "exemption"],
  },
  {
    id: "leave.paid_start",
    terms: [
      "有給",
      "有休",
      "年休",
      "年次休暇",
      "有給休暇",
      "いつから",
      "付与",
      "付与日",
      "取得開始",
      "使える",
    ],
    negativeTerms: ["子ども", "子供", "看護", "発熱", "保育園"],
    intentIncludes: ["leave.paid_start", "leave_paid_start"],
  },
  {
    id: "leave.annual",
    terms: ["年休", "有休", "有給", "休暇申請", "時間休", "残日数", "休みたい"],
    negativeTerms: ["いつから", "付与日", "子ども", "看護"],
    intentIncludes: ["leave.annual", "annual_leave"],
  },
  {
    id: "application.cancel",
    terms: [
      "取消",
      "取り消し",
      "キャンセル",
      "取り下げ",
      "訂正",
      "間違えて申請",
    ],
    negativeTerms: [],
    intentIncludes: ["application.cancel"],
  },
  {
    id: "application.documents",
    terms: ["必要書類", "添付", "様式", "証明書", "書類"],
    negativeTerms: [],
    intentIncludes: ["required_documents"],
  },
];

function inferSmartAssistQuerySubjects(
  message: string,
  expandedTerms: string[] = [],
  intentHints: string[] = [],
  questionTypes: string[] = [],
): string[] {
  const text = normalizeJapaneseText([message, ...expandedTerms].join(" "));
  const intents = intentHints.map(normalizeSmartIntentForRouting);
  const subjects: string[] = [];
  if (
    questionTypes.includes("reduction_or_exemption") ||
    SMART_SUBJECT_DEFINITIONS[1].terms.some((term) =>
      text.includes(normalizeJapaneseText(term)),
    )
  ) {
    subjects.push("fee.reduction");
  }
  if (
    !subjects.includes("fee.reduction") &&
    (questionTypes.includes("fee_or_price") ||
      SMART_SUBJECT_DEFINITIONS[0].terms.some((term) =>
        text.includes(normalizeJapaneseText(term)),
      ))
  ) {
    subjects.push("fee.general");
  }
  if (
    questionTypes.includes("start_or_grant") ||
    intents.some(
      (intent) =>
        intent.includes("leave.paid_start") ||
        intent.includes("leave_paid_start"),
    )
  ) {
    subjects.push("leave.paid_start");
  }
  if (
    !subjects.includes("leave.paid_start") &&
    intents.some(
      (intent) =>
        intent.includes("leave.annual") || intent.includes("annual_leave"),
    )
  ) {
    subjects.push("leave.annual");
  }
  if (
    questionTypes.includes("cancel_or_correction") ||
    intents.some((intent) => intent.includes("application.cancel"))
  )
    subjects.push("application.cancel");
  if (
    questionTypes.includes("required_documents") ||
    intents.some((intent) => intent.includes("required_documents"))
  )
    subjects.push("application.documents");
  for (const intent of intents) {
    if (
      intent.includes("reduction") ||
      intent.includes("discount") ||
      intent.includes("exemption")
    )
      subjects.push("fee.reduction");
    else if (
      intent.includes("fee") ||
      intent.includes("price") ||
      intent.includes("charge")
    )
      subjects.push("fee.general");
  }
  return uniqueSmartAssistStrings(subjects, 8);
}

function inferSmartAssistRecordSubjects(
  record: SmartFaqSearchRecord,
): string[] {
  const metadata = smartAssistRecordMetadataText(record);
  const intents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const subjects: string[] = [];
  if (
    intents.some(
      (intent) =>
        intent.includes("reduction") ||
        intent.includes("discount") ||
        intent.includes("exemption"),
    ) ||
    /(減免|免除|非課税|生活保護|ひとり親|兄弟|割引|減額)/.test(metadata)
  ) {
    subjects.push("fee.reduction");
  }
  if (
    !subjects.includes("fee.reduction") &&
    (intents.some(
      (intent) =>
        intent.includes("fee") ||
        intent.includes("price") ||
        intent.includes("charge"),
    ) ||
      /(費用|料金|利用料|金額|月額|支払|支払い|延長料金)/.test(metadata))
  ) {
    subjects.push("fee.general");
  }
  if (
    intents.some(
      (intent) =>
        intent.includes("leave.paid_start") ||
        intent.includes("leave_paid_start"),
    ) ||
    (/(有給|有休|年休|年次休暇)/.test(metadata) &&
      /(いつから|付与|付与日|取得開始|使える)/.test(metadata))
  ) {
    subjects.push("leave.paid_start");
  }
  if (
    !subjects.includes("leave.paid_start") &&
    (intents.some(
      (intent) =>
        intent.includes("leave.annual") || intent.includes("annual_leave"),
    ) ||
      /(年休|有休|有給|年次休暇|時間休|休暇申請|残日数)/.test(metadata))
  ) {
    subjects.push("leave.annual");
  }
  if (
    intents.some((intent) => intent.includes("application.cancel")) ||
    /(取消|取り消し|キャンセル|取り下げ|訂正|間違えて申請)/.test(metadata)
  )
    subjects.push("application.cancel");
  if (
    intents.some((intent) => intent.includes("required_documents")) ||
    /(必要書類|添付|様式|証明書|書類)/.test(metadata)
  )
    subjects.push("application.documents");
  return uniqueSmartAssistStrings(subjects, 8);
}

function smartAssistSubjectGate(params: {
  message: string;
  expandedTerms: string[];
  intentHints: string[];
  questionTypes: string[];
  record: SmartFaqSearchRecord;
}): SmartAssistSubjectGateResult {
  const querySubjects = inferSmartAssistQuerySubjects(
    params.message,
    params.expandedTerms,
    params.intentHints,
    params.questionTypes,
  );
  const recordSubjects = inferSmartAssistRecordSubjects(params.record);
  if (!querySubjects.length)
    return {
      querySubjects,
      recordSubjects,
      matched: true,
      penalty: 0,
      reasons: [],
    };
  const matched = querySubjects.some((subject) =>
    recordSubjects.includes(subject),
  );
  if (matched) {
    return {
      querySubjects,
      recordSubjects,
      matched: true,
      penalty: 0,
      reasons: [
        `主題一致: ${querySubjects.filter((s) => recordSubjects.includes(s)).join(" / ")}`,
      ],
    };
  }
  const feeGeneralVsReduction =
    querySubjects.includes("fee.general") &&
    recordSubjects.includes("fee.reduction");
  const reductionVsFeeGeneral =
    querySubjects.includes("fee.reduction") &&
    recordSubjects.includes("fee.general");
  if (feeGeneralVsReduction || reductionVsFeeGeneral) {
    return {
      querySubjects,
      recordSubjects,
      matched: false,
      penalty: 78,
      cap: 49,
      reasons: [
        `主題不一致: 質問=${querySubjects.join("/")} FAQ=${recordSubjects.join("/") || "未特定"}`,
      ],
    };
  }
  return {
    querySubjects,
    recordSubjects,
    matched: false,
    penalty: recordSubjects.length ? 42 : 18,
    cap: recordSubjects.length ? 58 : 68,
    reasons: [
      `主題ゲート不一致: 質問=${querySubjects.join("/")} FAQ=${recordSubjects.join("/") || "未特定"}`,
    ],
  };
}

function shouldUseSmartAssistConversationContext(
  message: string,
  conversationContext: Array<{ role: string; text: string }>,
  requested = false,
): boolean {
  if (!requested || !conversationContext.length) return false;
  const text = normalizeJapaneseText(message);
  if (!text) return false;

  // 文脈を使うのは「それ」「その」「さっきの続き」など、単独では対象が不明な質問だけ。
  // 「学童クラブの費用」「減免について」のように主題語がある質問には、直前履歴を混ぜない。
  const hasReference =
    /(それ|その|これ|この|さっき|先ほど|前の|上記|続き|同じ|詳しく|もっと詳しく|もう少し|どうですか|どうなる|いつですか|どこですか|いくらですか)/.test(
      text,
    );
  if (!hasReference) return false;

  const hasExplicitTopic =
    /(学童|クラブ|放課後児童クラブ|費用|料金|利用料|月額|減免|免除|割引|有給|有休|年休|申請|取消|取り消し|必要書類|書類|LGWAN|通勤手当|給与|休暇|延長|支払|支払い)/.test(
      text,
    );
  if (hasExplicitTopic) return false;

  return text.length <= 24;
}

function smartAssistMetadataEvidenceScore(
  message: string,
  expandedTerms: string[],
  record: SmartFaqSearchRecord,
): { score: number; reasons: string[] } {
  const queryTerms = uniqueSmartAssistStrings([message, ...expandedTerms], 80)
    .map(normalizeJapaneseText)
    .filter(
      (term) =>
        term.length >= 2 &&
        !["確認", "教えて", "について", "したい", "ください"].includes(term),
    );
  const metadata = smartAssistRecordMetadataText(record);
  if (!queryTerms.length || !metadata) return { score: 0, reasons: [] };
  const hits = queryTerms.filter((term) => metadata.includes(term));
  const score = Math.min(1, hits.length / Math.min(5, queryTerms.length));
  return {
    score,
    reasons: hits.length
      ? [`メタ情報一致: ${hits.slice(0, 4).join(" / ")}`]
      : [],
  };
}

function smartAssistQuestionTypeScore(
  types: string[],
  record: SmartFaqSearchRecord,
): { score: number; penalty: number; reasons: string[] } {
  if (!types.length) return { score: 0.5, penalty: 0, reasons: [] };
  const text = smartAssistRecordText(record);
  const metadataText = smartAssistRecordMetadataText(record);
  const intents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const reasons: string[] = [];
  let score = 0;
  let penalty = 0;

  if (types.includes("start_or_grant")) {
    const hit =
      /いつから|取得開始|付与|付与日|使えます|使える|開始/.test(metadataText) ||
      intents.includes("leave.paid_start");
    if (hit) {
      score += 1;
      reasons.push("質問タイプ一致: 取得開始/付与");
    } else {
      penalty += 24;
      reasons.push("質問タイプ不一致: 取得開始/付与");
    }
    if (
      /子ども|子供|看護|発熱|保育園|急に休/.test(metadataText) &&
      !/付与|いつから|取得開始/.test(metadataText)
    ) {
      penalty += 28;
      reasons.push("子の看護FAQは取得開始質問から除外");
    }
  }
  if (types.includes("urgent_child_care")) {
    const hit =
      /子ども|子供|看護|発熱|保育園|急に休|呼び出し/.test(metadataText) ||
      intents.includes("leave.child_sick");
    if (hit) {
      score += 1;
      reasons.push("質問タイプ一致: 急な看護/休暇");
    } else penalty += 14;
  }
  if (types.includes("method")) {
    const hit =
      /方法|手順|提出|申請方法|どこに/.test(metadataText) ||
      intents.some((i) => i.endsWith(".method"));
    if (hit) {
      score += 0.8;
      reasons.push("質問タイプ一致: 方法");
    } else penalty += 10;
  }
  if (types.includes("required_documents")) {
    const hit =
      /必要書類|添付|様式|証明書|書類/.test(metadataText) ||
      intents.some((i) => i.includes("required_documents"));
    if (hit) {
      score += 0.8;
      reasons.push("質問タイプ一致: 必要書類");
    } else penalty += 14;
  }
  if (types.includes("cancel_or_correction")) {
    const hit =
      /取り消|取消|キャンセル|取り下げ|訂正|変更申請/.test(metadataText) ||
      intents.includes("application.cancel");
    if (hit) {
      score += 0.9;
      reasons.push("質問タイプ一致: 取消/訂正");
    } else penalty += 16;
  }
  if (types.includes("fee_or_price")) {
    const hit =
      /費用|料金|利用料|金額|月額|支払|支払い|延長料金/.test(metadataText) ||
      intents.some(
        (i) => i.includes("fee") || i.includes("price") || i.includes("charge"),
      );
    if (hit) {
      score += 0.9;
      reasons.push("質問タイプ一致: 費用/料金");
    } else penalty += 12;
  }
  if (types.includes("reduction_or_exemption")) {
    const hit =
      /減免|免除|非課税|生活保護|兄弟|割引|安く|減額/.test(metadataText) ||
      intents.some(
        (i) =>
          i.includes("reduction") ||
          i.includes("discount") ||
          i.includes("exemption"),
      );
    if (hit) {
      score += 0.9;
      reasons.push("質問タイプ一致: 減免/免除");
    } else penalty += 20;
  }
  return {
    score: Math.min(1, score / Math.max(1, types.length)),
    penalty,
    reasons,
  };
}

function isExplicitFeeOrPriceQuery(message: string): boolean {
  const text = normalizeJapaneseText(message);
  return /(費用|料金|利用料|金額|いくら|月額|支払|支払い|確認)/.test(text);
}

function isExplicitReductionQuery(message: string): boolean {
  const text = normalizeJapaneseText(message);
  return /(減免|免除|非課税|生活保護|兄弟|割引|安く|減額)/.test(text);
}

function isReductionSpecificRecord(record: SmartFaqSearchRecord): boolean {
  const intents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const text = smartAssistRecordText(record);
  return (
    intents.some(
      (intent) =>
        intent.includes("reduction") ||
        intent.includes("discount") ||
        intent.includes("exemption"),
    ) || /(減免制度|減免申請|免除|非課税|生活保護|兄弟減免|減額)/.test(text)
  );
}

function isGeneralFeeRecord(record: SmartFaqSearchRecord): boolean {
  const intents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const text = smartAssistRecordText(record);
  if (isReductionSpecificRecord(record)) return false;
  return (
    intents.some(
      (intent) =>
        intent.includes("fee") ||
        intent.includes("price") ||
        intent.includes("charge"),
    ) || /(費用|料金|利用料|月額|延長料金|支払|支払い)/.test(text)
  );
}

function isAnnualLeaveStartQuery(
  message: string,
  expandedTerms: string[] = [],
): boolean {
  const text = normalizeJapaneseText([message, ...expandedTerms].join(" "));
  const hasAnnualLeave = /有給|有休|年休|年次休暇|年次有給休暇|有給休暇/.test(
    text,
  );
  const hasStartOrUse =
    /いつから|何日から|取得|取れ|使え|使用|付与|付与日|発生|開始/.test(text);
  return hasAnnualLeave && hasStartOrUse;
}

function smartAssistShortQuerySemanticBoost(
  message: string,
  expandedTerms: string[],
  record: SmartFaqSearchRecord,
): { bonus: number; forceMargin?: boolean; reasons: string[] } {
  const text = smartAssistRecordText(record);
  const intents = recordIntentValues(record).map(
    normalizeSmartIntentForRouting,
  );
  const reasons: string[] = [];
  let bonus = 0;
  let forceMargin = false;

  if (isAnnualLeaveStartQuery(message, expandedTerms)) {
    const explicitPaidStart =
      intents.includes("leave.paid_start") ||
      intents.includes("leave_paid_start");
    const genericAnnualLeave =
      /有給|有休|年休|年次休暇|年次有給休暇|有給休暇/.test(text);
    const genericLeaveProcedure =
      genericAnnualLeave && /取得|申請|残日数|勤務予定|休暇/.test(text);
    const childCare = /子ども|子供|子の看護|看護休暇|発熱|保育園|呼び出し/.test(
      text,
    );

    if (explicitPaidStart) {
      bonus += 92;
      forceMargin = true;
      reasons.push("短文強一致: 有給の取得開始");
    } else if (genericLeaveProcedure) {
      // If there is no exact “いつから/付与” FAQ in the data, the parent annual-leave FAQ is still the safest fallback.
      bonus += 66;
      forceMargin = true;
      reasons.push("短文フォールバック: 年休/有休FAQ");
    }
    if (childCare) {
      bonus -= 96;
      reasons.push("短文除外: 子の看護FAQではない");
    }
  }

  return { bonus, forceMargin, reasons };
}

function guardedSmartAssistRerank(params: {
  message: string;
  candidates: RankedFaqSearchResult[];
  expandedTerms: string[];
  categoryHints: string[];
  intentHints: string[];
  matchedProfiles?: SmartAssistRuleProfileEntry[];
  profileQuestionTypes?: string[];
  nlp: any;
}): {
  candidates: RankedFaqSearchResult[];
  detectedCategories: string[];
  detectedQuestionTypes: string[];
  margin: number;
  topRawScore: number;
} {
  const detectedCategories = detectSmartAssistCategoryGuards(
    params.message,
    params.categoryHints,
  );
  const detectedQuestionTypes = detectSmartAssistQuestionTypes(
    params.message,
    params.expandedTerms,
    params.profileQuestionTypes || [],
  );
  const nlpIntent = String(params.nlp?.intent || "");
  const nlpGroup = smartIntentGroup(nlpIntent);
  const queryTerms = uniqueSmartAssistStrings(
    [
      params.message,
      ...params.expandedTerms,
      ...detectedCategories,
      ...detectedQuestionTypes,
    ],
    120,
  );
  const normalizedIntentHints = uniqueSmartAssistStrings(
    params.intentHints.map(normalizeSmartIntentForRouting),
    12,
  );
  const rescored = params.candidates
    .map((item) => {
      const record = item.record;
      let score = Number(item.score || 0);
      const reasons = [...(item.reasons || [])];
      const recordCategory = String(record.category || "");
      const normalizedRecordCategory = normalizeJapaneseText(recordCategory);
      const normalizedDetected = detectedCategories.map(normalizeJapaneseText);
      if (detectedCategories.length) {
        if (normalizedDetected.includes(normalizedRecordCategory)) {
          score += 16;
          reasons.push("カテゴリガード一致");
        } else {
          score -= 55;
          reasons.push(
            `カテゴリガード不一致: ${detectedCategories.join(" / ")}`,
          );
        }
      }
      const overlap = smartKeywordOverlap(queryTerms, record);
      score += Math.round(overlap * 22);
      if (overlap >= 0.25) reasons.push("キーワード重なり確認");

      // v211: never let answer-body semantic similarity override explicit FAQ metadata.
      // If the user's query contains a term listed in this FAQ's negativeTerms, the FAQ is a bad match
      // even when its answer body mentions that term as a related/secondary topic.
      const negativeGuard = smartAssistNegativeHitPenalty(
        params.message,
        params.expandedTerms,
        record,
      );
      if (negativeGuard.penalty > 0) {
        score -= negativeGuard.penalty;
        if (typeof negativeGuard.cap === "number")
          score = Math.min(score, negativeGuard.cap);
        reasons.push(...negativeGuard.reasons);
      }

      const subjectGate = smartAssistSubjectGate({
        message: params.message,
        expandedTerms: params.expandedTerms,
        intentHints: params.intentHints,
        questionTypes: detectedQuestionTypes,
        record,
      });
      if (subjectGate.matched && subjectGate.querySubjects.length) {
        score += 24;
        reasons.push(...subjectGate.reasons);
      } else if (!subjectGate.matched && subjectGate.querySubjects.length) {
        score -= subjectGate.penalty;
        if (typeof subjectGate.cap === "number")
          score = Math.min(score, subjectGate.cap);
        reasons.push(...subjectGate.reasons);
      }

      const metadataEvidence = smartAssistMetadataEvidenceScore(
        params.message,
        params.expandedTerms,
        record,
      );
      score += Math.round(metadataEvidence.score * 18);
      reasons.push(...metadataEvidence.reasons);
      if (
        metadataEvidence.score <= 0.05 &&
        (item.reasons || []).some((reason) =>
          String(reason).includes("Transformer"),
        )
      ) {
        score = Math.min(score, 58);
        reasons.push("意味検索のみでメタ情報一致なし: 高信頼抑制");
      }
      const intents = recordIntentValues(record);
      const normalizedRecordIntents = intents.map(
        normalizeSmartIntentForRouting,
      );
      if (normalizedIntentHints.length) {
        const exactHint = normalizedRecordIntents.some((intent) =>
          normalizedIntentHints.includes(intent),
        );
        const sameHintGroup = normalizedRecordIntents.some((intent) =>
          normalizedIntentHints.some(
            (hint) => smartIntentGroup(hint) === smartIntentGroup(intent),
          ),
        );
        if (exactHint) {
          score += 30;
          reasons.push("言い換え辞書Intent完全一致");
        } else if (sameHintGroup) {
          score += 8;
          reasons.push("言い換え辞書Intent同一グループ");
        } else {
          score -= 48;
          reasons.push("言い換え辞書Intent不一致を強減点");
        }
      }
      const qType = smartAssistQuestionTypeScore(detectedQuestionTypes, record);
      score += Math.round(qType.score * 18);
      score -= qType.penalty;
      reasons.push(...qType.reasons);
      const shortBoost = smartAssistShortQuerySemanticBoost(
        params.message,
        params.expandedTerms,
        record,
      );
      score += shortBoost.bonus;
      reasons.push(...shortBoost.reasons);
      const profileBoost = applySmartAssistRuleProfileBoost({
        record,
        profiles: params.matchedProfiles || [],
        message: params.message,
        expandedTerms: params.expandedTerms,
      });
      score += profileBoost.bonus;
      reasons.push(...profileBoost.reasons);
      const forceShortQueryMargin =
        shortBoost.forceMargin === true || profileBoost.forceMargin === true;
      if (nlpIntent && nlpIntent !== "None" && intents.length) {
        const exact = intents.some(
          (v) => normalizeJapaneseText(v) === normalizeJapaneseText(nlpIntent),
        );
        const sameGroup = intents.some(
          (v) => smartIntentGroup(v) && smartIntentGroup(v) === nlpGroup,
        );
        if (exact) {
          score += 22;
          reasons.push("Intent完全一致");
        } else if (sameGroup) {
          score += 8;
          reasons.push("Intent同一グループ");
        } else if (Number(params.nlp?.score || 0) >= 0.72) {
          score -= 35;
          reasons.push("Intent不一致を減点");
        }
      }
      if (score >= 98) score = 96;
      return {
        ...item,
        score: Math.max(1, Math.min(96, Math.round(score))),
        reasons: uniqueSmartAssistStrings(reasons, 8),
        confidenceLabel:
          score >= 85
            ? ("高" as const)
            : score >= 60
              ? ("中" as const)
              : ("低" as const),
        __forceShortQueryMargin: forceShortQueryMargin,
      } as RankedFaqSearchResult & { __forceShortQueryMargin?: boolean };
    })
    .sort((a, b) => b.score - a.score);
  const topRawScore = rescored[0]?.score ?? 0;
  const second = rescored[1]?.score ?? 0;
  const diff = Math.max(0, topRawScore - second);
  let margin = diff >= 25 ? 1 : diff >= 15 ? 0.92 : diff >= 8 ? 0.78 : 0.55;
  if ((rescored[0] as any)?.__forceShortQueryMargin)
    margin = Math.max(margin, 0.94);
  if (rescored[0]) {
    const { __forceShortQueryMargin, ...cleanTop } = rescored[0] as any;
    rescored[0] = {
      ...cleanTop,
      score: Math.max(1, Math.min(96, Math.round(topRawScore * margin))),
      reasons: uniqueSmartAssistStrings(
        [...(rescored[0].reasons || []), `候補差分補正: ${diff}pt`],
        8,
      ),
    };
  }

  // v207: margin correction can lower only the provisional top candidate.
  // Always sort again after the final score is written; otherwise the answer
  // can be built from candidate #1 even when candidate #2 has the higher score.
  const finalCandidates = rescored
    .map((item) => {
      const { __forceShortQueryMargin, ...clean } = item as any;
      return clean as RankedFaqSearchResult;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.record?.question || "").localeCompare(
        String(b.record?.question || ""),
        "ja",
      );
    });

  return {
    candidates: finalCandidates,
    detectedCategories,
    detectedQuestionTypes,
    margin,
    topRawScore,
  };
}

function inferSmartAssistCategoryHints(
  records: SmartFaqSearchRecord[],
): string[] {
  return uniqueSmartAssistStrings(
    records.map((item) => item.category).filter(Boolean),
    8,
  );
}

async function expandSmartAssistQueryForSearch(
  message: string,
  records: SmartFaqSearchRecord[],
  customSynonyms: SmartAssistSynonymEntry[] = [],
  ruleProfiles: SmartAssistRuleProfileEntry[] = [],
): Promise<{
  query: string;
  terms: string[];
  categoryHints: string[];
  guardCategoryHints: string[];
  intentHints: string[];
  matchedProfiles: SmartAssistRuleProfileEntry[];
  profileQuestionTypes: string[];
}> {
  const analysis = await analyzeJapaneseQuery(message);
  const normalizedMessage = analysis.normalized || message;
  const synonymExpansion = expandByCustomSmartAssistSynonyms(
    message,
    customSynonyms,
  );
  const profileExpansion = analyzeSmartAssistRuleProfiles(
    message,
    synonymExpansion.terms,
    ruleProfiles,
  );
  const categoryHints = uniqueSmartAssistStrings(
    [
      ...inferSmartAssistCategoryHints(records),
      ...synonymExpansion.categories,
      ...profileExpansion.categories,
    ],
    12,
  );
  const recordTerms: string[] = [];
  const normalized = normalizedMessage.toLowerCase();
  for (const record of records) {
    const haystack = [
      record.question,
      record.category,
      Array.isArray(record.tags) ? record.tags.join(" ") : "",
      record.intentLabel,
      record.intentId,
      Array.isArray(record.intentIds) ? record.intentIds.join(" ") : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack) continue;
    const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
    const candidates = [
      record.category,
      record.intentLabel,
      record.intentId,
      ...tags,
    ]
      .filter(Boolean)
      .map(String);
    if (
      candidates.some(
        (term) =>
          normalized.includes(term.toLowerCase()) ||
          haystack.includes(normalized),
      )
    ) {
      recordTerms.push(...candidates);
    }
  }
  const terms = uniqueSmartAssistStrings(
    [
      ...analysis.importantTerms,
      ...analysis.expandedTerms,
      ...synonymExpansion.terms,
      ...profileExpansion.boostTerms,
      ...recordTerms,
    ],
    120,
  );
  const query = uniqueSmartAssistStrings(
    [message, normalizedMessage, ...terms],
    120,
  ).join(" ");
  return {
    query: query || message,
    terms,
    categoryHints,
    guardCategoryHints: uniqueSmartAssistStrings(
      [...synonymExpansion.categories, ...profileExpansion.categories],
      12,
    ),
    intentHints: uniqueSmartAssistStrings(
      [...synonymExpansion.intents, ...profileExpansion.intents],
      20,
    ),
    matchedProfiles: profileExpansion.matchedProfiles,
    profileQuestionTypes: profileExpansion.questionTypes,
  };
}

function formatSmartAssistAnswer(params: {
  level: SmartAssistUxLevel;
  record?: SmartFaqSearchRecord;
  answer: string;
  confidence: number;
  candidates?: Array<{ record: SmartFaqSearchRecord; score: number }>;
  categoryHints?: string[];
}): string {
  const {
    level,
    record,
    answer,
    confidence,
    candidates = [],
    categoryHints = [],
  } = params;
  if (level === "high" && record) {
    const lines = [
      `結論: ${answer}`,
      "",
      "確認するとよいこと:",
      ...uniqueSmartAssistStrings(
        [
          ...(Array.isArray(record.followUpQuestions)
            ? record.followUpQuestions
            : []),
          "対象の手続き名・申請日・申請番号を確認してください。",
        ],
        4,
      ).map((item) => `・${item.replace(/[？?]$/, "")}`),
    ];
    return lines.join("\n");
  }
  if (level === "medium") {
    const candidateLines = candidates
      .slice(0, 3)
      .map(
        (item, index) =>
          `・候補${index + 1}: ${item.record.question || item.record.id}（一致度 ${Math.round(item.score)}%）`,
      );
    return [
      "おそらく次のFAQが近いです。内容が違う場合は、候補を選ぶか、手続き名を追加してください。",
      "",
      `結論: ${answer}`,
      "",
      ...(candidateLines.length ? ["候補:", ...candidateLines] : []),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "まだ十分な信頼度でFAQを特定できませんでした。無理に回答せず、カテゴリや手続き名を確認してください。",
    "",
    categoryHints.length
      ? `選べるカテゴリ候補: ${categoryHints.join(" / ")}`
      : "",
    confidence > 0 ? `現在の推定信頼度: ${confidence}%` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

type StableSmartAssistCandidate = RankedFaqSearchResult & {
  stableSubject?: string;
  stableNegativeHit?: boolean;
  confidence?: number;
};

function smartAssistIdentityMetadataText(record: SmartFaqSearchRecord): string {
  // v215: FAQ識別用のメタ情報だけを使う。answer本文とnegativeTermsは混ぜない。
  return [
    record.title,
    record.question,
    record.category,
    record.intentId,
    record.intentLabel,
    ...(Array.isArray((record as any).intentIds)
      ? (record as any).intentIds
      : []),
    ...(Array.isArray((record as any).intent)
      ? (record as any).intent
      : [(record as any).intent].filter(Boolean)),
    ...(Array.isArray(record.tags) ? record.tags : []),
    ...(Array.isArray((record as any).keywords)
      ? (record as any).keywords
      : []),
    ...(Array.isArray((record as any).examples)
      ? (record as any).examples
      : []),
    ...(Array.isArray((record as any).testQuestions)
      ? (record as any).testQuestions
      : []),
  ]
    .filter(Boolean)
    .join(" ");
}

function inferStableSmartAssistSubjectFromText(input: string): string {
  const text = normalizeJapaneseText(input);
  if (!text) return "";
  if (
    /(減免|免除|非課税|生活保護|ひとり親|割引|減額|安く|兄弟.*(安|減|免)|兄弟割)/.test(
      text,
    )
  )
    return "fee.reduction";
  if (
    /(費用|料金|利用料|金額|月額|いくら|どれくらい|支払|支払い|口座振替|延長料金|おやつ代|教材費)/.test(
      text,
    )
  )
    return "fee.general";
  if (
    /(有給|有休|年休|年次休暇|有給休暇)/.test(text) &&
    /(いつから|付与|付与日|取得開始|使える|発生)/.test(text)
  )
    return "leave.paid_start";
  if (/(年休|有休|有給|年次休暇|休暇申請|時間休|残日数|休みたい)/.test(text))
    return "leave.annual";
  if (
    /(取消|取り消し|キャンセル|取り下げ|訂正|間違えて申請|申請後.*変更)/.test(
      text,
    )
  )
    return "application.cancel";
  if (/(必要書類|添付|様式|証明書|書類|必要なもの)/.test(text))
    return "application.documents";
  if (/(LGWAN|外部サービス|クラウド|ネットワーク|セキュリティ)/i.test(text))
    return "system.lgwan";
  return "";
}

function inferStableSmartAssistRecordSubject(
  record: SmartFaqSearchRecord,
): string {
  const identity = smartAssistIdentityMetadataText(record);
  const intentText = [
    record.intentId,
    record.intentLabel,
    ...(Array.isArray((record as any).intentIds)
      ? (record as any).intentIds
      : []),
  ]
    .filter(Boolean)
    .join(" ");
  const text = normalizeJapaneseText(`${intentText} ${identity}`);
  if (
    /(reduction|discount|exemption|減免|免除|非課税|生活保護|ひとり親|割引|減額)/.test(
      text,
    )
  )
    return "fee.reduction";
  if (
    /(afterschool\.fee|fee\.general|費用|料金|利用料|金額|月額|支払|口座振替|延長料金)/.test(
      text,
    )
  )
    return "fee.general";
  if (/(leave\.paid_start|有給取得開始|いつから|付与日|取得開始)/.test(text))
    return "leave.paid_start";
  if (/(leave\.annual|年休取得|年次休暇|時間休|残日数|休暇申請)/.test(text))
    return "leave.annual";
  if (
    /(application\.cancel|申請取消|取り消し|取消|キャンセル|取り下げ)/.test(
      text,
    )
  )
    return "application.cancel";
  if (/(required_documents|必要書類|添付|様式|証明書)/.test(text))
    return "application.documents";
  if (/(lgwan|外部サービス|ネットワーク|セキュリティ)/.test(text))
    return "system.lgwan";
  return "";
}

function tokenizeStableSmartAssistQuery(input: string): string[] {
  const normalized = normalizeJapaneseText(input).replace(/\s+/g, "");
  const important = [
    "放課後児童クラブ",
    "学童クラブ",
    "学童",
    "クラブ",
    "費用",
    "料金",
    "利用料",
    "月額",
    "金額",
    "いくら",
    "どれくらい",
    "支払",
    "支払い",
    "延長料金",
    "減免",
    "免除",
    "非課税",
    "生活保護",
    "ひとり親",
    "兄弟",
    "割引",
    "減額",
    "有給",
    "有休",
    "年休",
    "年次休暇",
    "いつから",
    "付与",
    "付与日",
    "取得開始",
    "使える",
    "申請",
    "取消",
    "取り消し",
    "キャンセル",
    "必要書類",
    "添付",
    "様式",
    "証明書",
    "LGWAN",
    "外部サービス",
  ];
  const terms: string[] = [];
  for (const term of important) {
    if (normalized.includes(normalizeJapaneseText(term))) terms.push(term);
  }
  const cleaned = normalized
    .replace(
      /について|教えて|ください|したい|するか|ですか|ますか|どのように|確認|方法|場合/g,
      " ",
    )
    .replace(/[はをがにでとのやかもへ]/g, " ");
  terms.push(...cleaned.split(/\s+/).filter((t) => t.length >= 2));
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= normalized.length - n; i++) {
      const gram = normalized.slice(i, i + n);
      if (/[ぁ-んァ-ン一-龥A-Za-z0-9]/.test(gram)) terms.push(gram);
    }
  }
  return uniqueSmartAssistStrings(terms, 160)
    .map(normalizeJapaneseText)
    .filter(Boolean);
}

function stableSmartAssistNegativeHit(
  message: string,
  record: SmartFaqSearchRecord,
): string[] {
  const text = normalizeJapaneseText(message);
  const negativeTerms = Array.isArray((record as any).negativeTerms)
    ? (record as any).negativeTerms.map(String)
    : [];
  return negativeTerms.filter((term: string) => {
    const key = normalizeJapaneseText(term);
    return key.length >= 2 && text.includes(key);
  });
}

function stableSmartAssistRankRecords(
  message: string,
  records: SmartFaqSearchRecord[],
): StableSmartAssistCandidate[] {
  const querySubject = inferStableSmartAssistSubjectFromText(message);
  const queryTerms = tokenizeStableSmartAssistQuery(message);
  const normalizedQuery = normalizeJapaneseText(message).replace(/\s+/g, "");
  const candidates = records
    .map((record) => {
      const identityTextRaw = smartAssistIdentityMetadataText(record);
      const identityText = normalizeJapaneseText(identityTextRaw).replace(
        /\s+/g,
        "",
      );
      const recordSubject = inferStableSmartAssistRecordSubject(record);
      const reasons: string[] = [];
      let score = 0;

      const exactFields = [
        record.question,
        record.title,
        ...(Array.isArray((record as any).testQuestions)
          ? (record as any).testQuestions
          : []),
        ...(Array.isArray((record as any).examples)
          ? (record as any).examples
          : []),
      ]
        .filter(Boolean)
        .map((x) => normalizeJapaneseText(x).replace(/\s+/g, ""));
      if (
        normalizedQuery &&
        exactFields.some(
          (field) =>
            field === normalizedQuery ||
            field.includes(normalizedQuery) ||
            normalizedQuery.includes(field),
        )
      ) {
        score += 46;
        reasons.push("質問/テスト質問の強一致");
      }

      const termHits = queryTerms.filter(
        (term) => term.length >= 2 && identityText.includes(term),
      );
      const hitRatio = queryTerms.length
        ? termHits.length / Math.min(queryTerms.length, 12)
        : 0;
      score += Math.min(34, Math.round(hitRatio * 46));
      if (termHits.length)
        reasons.push(`メタ語一致: ${termHits.slice(0, 5).join(" / ")}`);

      if (querySubject && recordSubject) {
        if (querySubject === recordSubject) {
          score += 34;
          reasons.push(`主題一致: ${querySubject}`);
        } else {
          score -= 70;
          reasons.push(`主題不一致: 質問=${querySubject} FAQ=${recordSubject}`);
        }
      } else if (querySubject && !recordSubject) {
        score -= 24;
        reasons.push(`FAQ主題未特定: 質問=${querySubject}`);
      }

      // FAQ自身のkeywords/testQuestionsに含まれる語が質問に直接入っていれば追加。
      const keyFields = [
        ...(Array.isArray((record as any).keywords)
          ? (record as any).keywords
          : []),
        ...(Array.isArray(record.tags) ? record.tags : []),
        ...(Array.isArray((record as any).testQuestions)
          ? (record as any).testQuestions
          : []),
      ]
        .map((x) => normalizeJapaneseText(x))
        .filter((x) => x.length >= 2);
      const directKeyHits = keyFields
        .filter(
          (key) =>
            normalizeJapaneseText(message).includes(key) ||
            key.includes(normalizeJapaneseText(message)),
        )
        .slice(0, 8);
      if (directKeyHits.length) {
        score += Math.min(20, directKeyHits.length * 5);
        reasons.push(
          `キーワード直接一致: ${directKeyHits.slice(0, 4).join(" / ")}`,
        );
      }

      const negativeHits = stableSmartAssistNegativeHit(message, record);
      if (negativeHits.length) {
        score -= 90;
        reasons.push(`除外語一致: ${negativeHits.slice(0, 4).join(" / ")}`);
      }

      // 主題不一致または除外語一致は高信頼禁止。
      let cap = 96;
      if (negativeHits.length) cap = 34;
      if (querySubject && recordSubject && querySubject !== recordSubject)
        cap = Math.min(cap, 44);
      if (querySubject && !recordSubject) cap = Math.min(cap, 58);
      if (
        querySubject &&
        recordSubject === querySubject &&
        termHits.length >= 2
      )
        cap = Math.max(cap, 96);

      const finalScore = Math.max(1, Math.min(cap, Math.round(score)));
      return {
        record,
        score: finalScore,
        confidence: finalScore,
        confidenceLabel: smartAssistConfidenceLabel(finalScore),
        matchedTerms: termHits.slice(0, 12),
        reasons: uniqueSmartAssistStrings(reasons, 10),
        stableSubject: recordSubject,
        stableNegativeHit: negativeHits.length > 0,
      } as StableSmartAssistCandidate;
    })
    .filter((item) => item.score >= 8)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aSubject = a.stableSubject === querySubject ? 1 : 0;
      const bSubject = b.stableSubject === querySubject ? 1 : 0;
      return bSubject - aSubject;
    });

  const top = candidates[0];
  const second = candidates[1];
  if (top && second) {
    const diff = top.score - second.score;
    if (diff < 8 && top.score >= 85) {
      top.score = 84;
      top.confidence = 84;
      top.confidenceLabel = "中";
      top.reasons = uniqueSmartAssistStrings(
        [...(top.reasons || []), `候補差が小さいため高信頼抑制: ${diff}pt`],
        10,
      );
    }
  }
  return candidates.slice(0, 12);
}

function buildStableSmartAssistResponse(params: {
  message: string;
  records: SmartFaqSearchRecord[];
  inputDebug?: boolean;
}): any | null {
  const candidates = stableSmartAssistRankRecords(
    params.message,
    params.records,
  );
  const top = candidates[0];
  if (!top) return null;
  const confidence = Math.max(0, Math.min(96, Math.round(top.score || 0)));
  const level = smartAssistConfidenceLevel(confidence);
  const record = top.record;
  const categoryOptions = inferSmartAssistCategoryHints(params.records);

  if (confidence < 45) return null;

  const answer = formatSmartAssistAnswer({
    level,
    record,
    answer: String(record.answer || ""),
    confidence,
    candidates: candidates.slice(0, 4),
    categoryHints: categoryOptions,
  });
  const relatedCandidates =
    level === "high"
      ? []
      : candidates
          .slice(1)
          .filter((item) => isSameSmartFaqFamily(record, item.record))
          .slice(0, 3);
  const suggestions = buildSmartAssistSuggestions({
    message: params.message,
    record,
    related: relatedCandidates,
    categoryHints: categoryOptions,
    level,
  });
  return {
    answer,
    rawAnswer: record.answer,
    confidence,
    confidenceLabel: smartAssistConfidenceLabel(confidence),
    uxLevel: level,
    intent: record.intentId || record.intentLabel || "metadata-first",
    matchedFaqId: record.id,
    matchedFaqTitle: record.question,
    faqScore: confidence,
    reasons: top.reasons,
    matchedTerms: top.matchedTerms,
    followUpQuestions: uniqueSmartAssistStrings(
      Array.isArray(record.followUpQuestions) ? record.followUpQuestions : [],
      4,
    ),
    suggestedActions: suggestions.suggestedActions,
    nextQuestions: suggestions.nextQuestions,
    clarificationChips: suggestions.clarificationChips,
    categoryOptions: level === "low" ? categoryOptions : [],
    sources: [
      {
        title: record.category || "FAQ",
        type: record.sourceType || "faq",
        page: record.sourcePage,
      },
    ],
    related: relatedCandidates.map((item) => ({
      id: item.record.id,
      question: item.record.question,
      category: item.record.category,
      score: item.score,
      reasons: item.reasons,
    })),
    candidates:
      level === "high"
        ? []
        : candidates.slice(0, 4).map((item) => ({
            id: item.record.id,
            question: item.record.question,
            category: item.record.category,
            score: item.score,
            reasons: item.reasons,
            subject: item.stableSubject,
          })),
    answerPolicy:
      level === "high"
        ? "stable-metadata-first-high-confidence"
        : "stable-metadata-first-candidate-answer",
    mode: "stable-metadata-first-v215",
    debug: params.inputDebug
      ? {
          stableCandidates: candidates.slice(0, 8).map((item) => ({
            id: item.record.id,
            question: item.record.question,
            score: item.score,
            subject: item.stableSubject,
            reasons: item.reasons,
            matchedTerms: item.matchedTerms,
          })),
        }
      : undefined,
  };
}

export class VaultService {
  private llamaServerProcess: any = null;
  private llamaServerState: any = {
    state: "stopped",
    pid: null,
    startedAt: null,
    lastError: null,
    modelPath: null,
    executablePath: null,
    host: "127.0.0.1",
    port: 18080,
  };
  private sharedImportPromise: Promise<void> | null = null;
  /** Directory/bootstrap work is immutable for the lifetime of one process. */
  private vaultInitPromise: Promise<void> | null = null;
  /** One-time local migration that rebuilds the typed page/DB-row relationship graph. */
  private unifiedResourceLinkIndexPromise: Promise<void> | null = null;
  private sharedImportStatus = {
    state: "idle" as "idle" | "running" | "success" | "error",
    reason: null as string | null,
    startedAt: null as string | null,
    finishedAt: null as string | null,
    error: null as string | null,
  };
  /** Serializes small shared JSON resources (Inbox, Journal, Smart Assist) before taking the cross-process write lease. */
  private sharedJsonWriteQueues = new Map<string, Promise<unknown>>();
  private readonly attachmentService: AttachmentService;
  private readonly commentService: CommentService;
  private readonly pageHistoryService: PageHistoryService;
  private readonly journalService: JournalService;
  private readonly inboxService: InboxService;
  private readonly analysisNotebookService: AnalysisNotebookService;
  /** Reuses the hydrated local Semantic Index across page opens. */
  private semanticIndexServiceInstance: SemanticIndexService | null = null;
  /** Background semantic work yields while a user is actively editing. */
  private semanticBackgroundPauseUntil = 0;
  /** Runtime-only job state for long semantic rebuilds. The shared JSON index remains the source of truth. */
  private semanticRebuildJob: {
    id: string;
    state:
      | "idle"
      | "queued"
      | "running"
      | "paused"
      | "interrupted"
      | "completed"
      | "cancelled"
      | "error";
    mode: "full" | "diff";
    startedAt: string | null;
    finishedAt: string | null;
    collectedCount: number;
    processedEstimate: number;
    message: string;
    error: string | null;
    pauseRequested: boolean;
    cancelRequested: boolean;
    result: SemanticWorkspaceIndex | null;
  } | null = null;
  /** Restores only local, disposable job progress. Shared JSON remains the semantic source of truth. */
  private semanticJobRestorePromise: Promise<void> | null = null;

  constructor(
    private db: Db,
    private sharedRoot: string,
    private appInstanceId: string,
    private readonly localDbPath?: string,
    private readonly appStartedAt = Date.now(),
  ) {
    this.analysisNotebookService = new AnalysisNotebookService(this.db, this.localDbPath);
    this.attachmentService = new AttachmentService({
      db: this.db,
      sharedRoot: this.sharedRoot,
      appInstanceId: this.appInstanceId,
      getPage: (pageId) => this.getPage(pageId),
      getLock: (pageId) => this.getLock(pageId),
      pageScope: (pageId) => this.pageScope(pageId),
      userLabel: () => this.userLabel(),
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
    });
    this.commentService = new CommentService({
      getPage: (pageId) => this.getPage(pageId),
      pageScope: (pageId) => this.pageScope(pageId),
      commentsPath: (pageId, scope) => this.pageCommentsPath(pageId, scope),
      userLabel: () => this.userLabel(),
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
    });
    this.pageHistoryService = new PageHistoryService({
      sharedRoot: this.sharedRoot,
      userLabel: () => this.userLabel(),
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
      atomicWriteText: (file, text) => this.atomicWriteText(file, text),
      normalizeMeta: (raw, pageId) =>
        normalizeMeta(
          (raw && typeof raw === "object" ? raw : {}) as Partial<PageMeta>,
          pageId,
        ),
      emptyBlocksuite: EMPTY_BLOCKSUITE,
    });
    this.inboxService = new InboxService({
      sharedRoot: this.sharedRoot,
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
      withSharedJsonMutation: (file, task) =>
        this.withSharedJsonMutation(file, task),
      onSaved: async (item) => {
        this.upsertTaskIndexForSource(
          "inbox",
          item.id,
          item.title,
          "📥",
          item.updatedAt,
          item.text || "",
        );
        void this.updateWorkspaceSummaryCache().catch((error) => {
          console.warn("[workspace summary] background refresh failed", error);
        });
      },
      onDeleted: async (id) => {
        try {
          this.db
            .prepare(
              "DELETE FROM task_index WHERE source_type = ? AND source_id = ?",
            )
            .run("inbox", id);
        } catch {}
        void this.updateWorkspaceSummaryCache().catch((error) => {
          console.warn("[workspace summary] background refresh failed", error);
        });
      },
    });
    this.journalService = new JournalService({
      sharedRoot: this.sharedRoot,
      userLabel: () => this.userLabel(),
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
      withSharedJsonMutation: (file, task) =>
        this.withSharedJsonMutation(file, task),
      onSaved: async (journal) => {
        this.upsertJournalSummaryIndex(journal);
        this.upsertTaskIndexForSource(
          "journal",
          journal.date,
          journal.title,
          journal.icon,
          journal.updatedAt,
          journal.markdown || "",
        );
        void this.updateWorkspaceSummaryCache().catch((error) => {
          console.warn("[workspace summary] background refresh failed", error);
        });
      },
      onDeleted: async (date) => {
        try {
          this.db
            .prepare("DELETE FROM journal_summary_index WHERE date = ?")
            .run(date);
          this.db
            .prepare(
              "DELETE FROM task_index WHERE source_type = ? AND source_id = ?",
            )
            .run("journal", date);
          void this.updateWorkspaceSummaryCache().catch((error) => {
          console.warn("[workspace summary] background refresh failed", error);
        });
        } catch {}
      },
    });
  }

  private async withSharedJsonMutation<T>(
    file: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = path.resolve(file);
    const previous = this.sharedJsonWriteQueues.get(key) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const lockPath = `${key}.mutation.lock`;
        const owner = `${this.appInstanceId}:${nanoid(8)}`;
        // Shared-folder metadata updates are intentionally small.  A longer lease
        // avoids a second PC treating a slow SMB/NAS write as abandoned, while the
        // bounded acquisition deadline keeps the UI responsive when another writer
        // is legitimately active.
        const expiresMs = 120_000;
        const deadline = Date.now() + 12_000;
        let acquired = false;

        while (!acquired) {
          const now = Date.now();
          try {
            await fs.ensureDir(path.dirname(lockPath));
            await fs.writeFile(
              lockPath,
              JSON.stringify(
                {
                  owner,
                  createdAt: new Date(now).toISOString(),
                  expiresAt: new Date(now + expiresMs).toISOString(),
                },
                null,
                2,
              ),
              { encoding: "utf8", flag: "wx" },
            );
            acquired = true;
            break;
          } catch (error: any) {
            if (error?.code !== "EEXIST") throw error;
            const existing = await fs.readJson(lockPath).catch(() => null);
            const expiresAt = Date.parse(String(existing?.expiresAt || ""));
            if (!Number.isFinite(expiresAt) || expiresAt <= now) {
              await fs.remove(lockPath).catch(() => undefined);
              continue;
            }
            if (Date.now() >= deadline) {
              const locked = new Error(
                `Shared data is locked by another writer: ${path.basename(key)}`,
              );
              (locked as any).code = "SHARED_DATA_LOCKED";
              throw locked;
            }
            await new Promise((resolve) => setTimeout(resolve, 140));
          }
        }

        try {
          return await task();
        } finally {
          const current = await fs.readJson(lockPath).catch(() => null);
          if (current?.owner === owner)
            await fs.remove(lockPath).catch(() => undefined);
        }
      });
    this.sharedJsonWriteQueues.set(
      key,
      operation.catch(() => undefined),
    );
    return operation;
  }

  getSharedImportStatus(): any {
    return {
      ...this.sharedImportStatus,
      running: this.sharedImportStatus.state === "running",
    };
  }

  startBackgroundImportFromShared(reason = "background"): void {
    void this.runImportFromShared(reason).catch((error) => {
      console.warn(
        "BACKGROUND_IMPORT_FROM_SHARED_FAILED",
        error?.message ?? error,
      );
    });
  }

  async runImportFromShared(reason = "manual"): Promise<any> {
    if (this.sharedImportPromise) {
      await this.sharedImportPromise;
      return this.getSharedImportStatus();
    }
    const startedAt = new Date().toISOString();
    this.sharedImportStatus = {
      state: "running",
      reason,
      startedAt,
      finishedAt: null,
      error: null,
    };
    this.sharedImportPromise = this.importFromShared();
    try {
      await this.sharedImportPromise;
      this.sharedImportStatus = {
        state: "success",
        reason,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error: any) {
      this.sharedImportStatus = {
        state: "error",
        reason,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error?.message ?? String(error),
      };
      throw error;
    } finally {
      this.sharedImportPromise = null;
    }
    return this.getSharedImportStatus();
  }

  private databaseLockService(): DatabaseLockService {
    return new DatabaseLockService(
      this.sharedRoot,
      this.appInstanceId,
      5 * 60_000,
      this.appStartedAt,
    );
  }

  private databaseConflictService(): DatabaseConflictService {
    return new DatabaseConflictService(this.sharedRoot, () => this.userLabel());
  }

  private databaseWorkspaceService(): DatabaseWorkspaceService {
    return new DatabaseWorkspaceService(this);
  }

  private databaseRowContentService(): DatabaseRowContentService {
    return new DatabaseRowContentService(this.sharedRoot, () =>
      this.userLabel(),
    );
  }

  private smartAssistStore(): SmartAssistStore {
    return new SmartAssistStore({
      sharedRoot: this.sharedRoot,
      userLabel: () => this.userLabel(),
      atomicWriteJson: (file, data) => this.atomicWriteJson(file, data),
      withSharedJsonMutation: (file, task) =>
        this.withSharedJsonMutation(file, task),
      onBadFeedback: async (feedback) => {
        await this.addSmartAssistImprovementQueue({
          id: `feedback_${feedback.id}`,
          question: feedback.question,
          expectedFaqId: feedback.expectedFaqId || undefined,
          matchedFaqId: feedback.matchedFaqId || undefined,
          confidence: feedback.confidence,
          candidates: feedback.candidates || [],
          reason: "user-feedback-bad",
          response: {
            answerPreview: feedback.answerPreview,
            matchedFaqTitle: feedback.matchedFaqTitle,
            feedbackId: feedback.id,
          },
          status: "open",
          createdAt: feedback.createdAt,
          createdBy: feedback.createdBy,
        });
      },
    });
  }

  private async semanticIndexService(): Promise<SemanticIndexService> {
    if (this.semanticIndexServiceInstance)
      return this.semanticIndexServiceInstance;
    const localCacheDir = await this.getSmartAssistLocalCacheDir().catch(
      () => null,
    );
    this.semanticIndexServiceInstance = new SemanticIndexService(
      this.sharedRoot,
      localCacheDir,
    );
    return this.semanticIndexServiceInstance;
  }

  private workspaceTagAliasesPath(): string {
    return path.join(vaultPaths(this.sharedRoot).workspace, "tag-aliases.json");
  }

  private workspaceTagPresentationPath(): string {
    return path.join(
      vaultPaths(this.sharedRoot).workspace,
      "tag-presentation.json",
    );
  }

  private normalizeWorkspaceTagPresentation(
    input: unknown,
  ): Record<string, { group?: string; color?: string }> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const groups = new Set(["業務分野", "年度", "対象者", "状態", "その他"]);
    const colors = new Set([
      "slate",
      "blue",
      "cyan",
      "green",
      "amber",
      "orange",
      "red",
      "purple",
      "pink",
    ]);
    const result: Record<string, { group?: string; color?: string }> = {};
    for (const [rawTag, rawValue] of Object.entries(
      input as Record<string, unknown>,
    ).slice(0, 500)) {
      const tag = String(rawTag)
        .normalize("NFKC")
        .toLocaleLowerCase("ja-JP")
        .replace(/^#+/, "")
        .trim();
      if (
        !tag ||
        !rawValue ||
        typeof rawValue !== "object" ||
        Array.isArray(rawValue)
      )
        continue;
      const item = rawValue as Record<string, unknown>;
      const group =
        typeof item.group === "string" && groups.has(item.group)
          ? item.group
          : undefined;
      const color =
        typeof item.color === "string" && colors.has(item.color)
          ? item.color
          : undefined;
      if (group || color)
        result[tag] = {
          ...(group ? { group } : {}),
          ...(color ? { color } : {}),
        };
    }
    return Object.fromEntries(
      Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "ja-JP")),
    );
  }

  private async readWorkspaceTagPresentationDocument(): Promise<{
    revision: number;
    settings: Record<string, { group?: string; color?: string }>;
  }> {
    const raw = await fs
      .readJson(this.workspaceTagPresentationPath())
      .catch(() => ({}));
    const revision =
      Number.isSafeInteger(raw?.revision) && raw.revision >= 0
        ? raw.revision
        : 0;
    return {
      revision,
      settings: this.normalizeWorkspaceTagPresentation(raw?.settings ?? raw),
    };
  }

  async getWorkspaceTagPresentation(): Promise<{
    revision: number;
    settings: Record<string, { group?: string; color?: string }>;
  }> {
    return this.readWorkspaceTagPresentationDocument();
  }

  /** Tag color/group settings are presentation-only: no page metadata is changed. */
  async updateWorkspaceTagPresentation(input: { settings: unknown }): Promise<{
    revision: number;
    settings: Record<string, { group?: string; color?: string }>;
  }> {
    const file = this.workspaceTagPresentationPath();
    const settings = this.normalizeWorkspaceTagPresentation(input.settings);
    return this.withSharedJsonMutation(file, async () => {
      const current = await this.readWorkspaceTagPresentationDocument();
      if (JSON.stringify(current.settings) === JSON.stringify(settings))
        return current;
      const revision = current.revision + 1;
      await this.atomicWriteJson(file, {
        version: 1,
        revision,
        settings,
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      });
      return { revision, settings };
    });
  }

  private normalizeWorkspaceTagAliases(
    input: unknown,
  ): Record<string, string[]> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const normalized: Record<string, string[]> = {};
    for (const [rawTag, rawAliases] of Object.entries(
      input as Record<string, unknown>,
    ).slice(0, 500)) {
      const tag = String(rawTag)
        .normalize("NFKC")
        .toLocaleLowerCase("ja-JP")
        .replace(/^#+/, "")
        .trim();
      if (!tag) continue;
      const aliases = Array.isArray(rawAliases) ? rawAliases : [];
      const cleaned = Array.from(
        new Set(
          aliases
            .filter((value): value is string => typeof value === "string")
            .map((value) =>
              value
                .normalize("NFKC")
                .toLocaleLowerCase("ja-JP")
                .replace(/^#+/, "")
                .trim(),
            )
            .filter(
              (value) =>
                value.length >= 2 && value.length <= 200 && value !== tag,
            ),
        ),
      )
        .sort()
        .slice(0, 80);
      if (cleaned.length > 0) normalized[tag] = cleaned;
    }
    return Object.fromEntries(
      Object.entries(normalized).sort(([a], [b]) =>
        a.localeCompare(b, "ja-JP"),
      ),
    );
  }

  private async readWorkspaceTagAliasesDocument(): Promise<{
    revision: number;
    aliases: Record<string, string[]>;
  }> {
    const raw = await fs
      .readJson(this.workspaceTagAliasesPath())
      .catch(() => ({}));
    const revision =
      Number.isSafeInteger(raw?.revision) && raw.revision >= 0
        ? raw.revision
        : 0;
    return {
      revision,
      aliases: this.normalizeWorkspaceTagAliases(raw?.aliases ?? raw),
    };
  }

  private tagAliasListsEqual(a?: string[], b?: string[]): boolean {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }

  private changedTagAliasKeys(
    base: Record<string, string[]>,
    next: Record<string, string[]>,
  ): string[] {
    const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
    return [...keys].filter(
      (key) => !this.tagAliasListsEqual(base[key], next[key]),
    );
  }

  async getWorkspaceTagAliases(): Promise<{
    revision: number;
    aliases: Record<string, string[]>;
  }> {
    return this.readWorkspaceTagAliasesDocument();
  }

  /**
   * Optimistic concurrency for the shared alias dictionary.
   * Independent tag edits are merged. A conflict is returned only when two devices changed
   * the same tag from the same baseline to different values.
   */
  async updateWorkspaceTagAliases(input: {
    aliases: unknown;
    baseAliases?: unknown;
    baseRevision?: number;
  }): Promise<{
    revision: number;
    aliases: Record<string, string[]>;
    conflictTags: string[];
    merged: boolean;
  }> {
    const file = this.workspaceTagAliasesPath();
    const desired = this.normalizeWorkspaceTagAliases(input.aliases);
    const base = this.normalizeWorkspaceTagAliases(
      input.baseAliases ?? desired,
    );
    const baseRevision =
      Number.isSafeInteger(input.baseRevision) &&
      Number(input.baseRevision) >= 0
        ? Number(input.baseRevision)
        : undefined;

    return this.withSharedJsonMutation(file, async () => {
      const current = await this.readWorkspaceTagAliasesDocument();
      const changedByClient = this.changedTagAliasKeys(base, desired);

      // Backward-compatible callers from v417 did not send a baseline. Preserve remote aliases
      // by unioning their additions instead of replacing the entire shared document.
      if (baseRevision === undefined || input.baseAliases === undefined) {
        const mergedAliases = { ...current.aliases };
        for (const [tag, aliases] of Object.entries(desired)) {
          mergedAliases[tag] = Array.from(
            new Set([...(mergedAliases[tag] ?? []), ...aliases]),
          )
            .sort()
            .slice(0, 80);
        }
        const normalized = this.normalizeWorkspaceTagAliases(mergedAliases);
        if (JSON.stringify(normalized) === JSON.stringify(current.aliases)) {
          return {
            revision: current.revision,
            aliases: current.aliases,
            conflictTags: [],
            merged: current.revision !== baseRevision,
          };
        }
        const revision = current.revision + 1;
        await this.atomicWriteJson(file, {
          version: 2,
          revision,
          aliases: normalized,
          updatedAt: new Date().toISOString(),
          updatedBy: this.userLabel(),
        });
        return {
          revision,
          aliases: normalized,
          conflictTags: [],
          merged: true,
        };
      }

      const conflictTags =
        baseRevision === current.revision
          ? []
          : changedByClient.filter((tag) => {
              const remoteChanged = !this.tagAliasListsEqual(
                base[tag],
                current.aliases[tag],
              );
              return (
                remoteChanged &&
                !this.tagAliasListsEqual(current.aliases[tag], desired[tag])
              );
            });
      if (conflictTags.length > 0) {
        return {
          revision: current.revision,
          aliases: current.aliases,
          conflictTags,
          merged: false,
        };
      }

      const mergedAliases = { ...current.aliases };
      for (const tag of changedByClient) {
        if (desired[tag]?.length) mergedAliases[tag] = desired[tag];
        else delete mergedAliases[tag];
      }
      const normalized = this.normalizeWorkspaceTagAliases(mergedAliases);
      if (JSON.stringify(normalized) === JSON.stringify(current.aliases)) {
        return {
          revision: current.revision,
          aliases: current.aliases,
          conflictTags: [],
          merged: current.revision !== baseRevision,
        };
      }
      const revision = current.revision + 1;
      await this.atomicWriteJson(file, {
        version: 2,
        revision,
        aliases: normalized,
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      });
      return {
        revision,
        aliases: normalized,
        conflictTags: [],
        merged: current.revision !== baseRevision,
      };
    });
  }

  async initVault(): Promise<void> {
    if (this.vaultInitPromise) return this.vaultInitPromise;
    this.vaultInitPromise = (async () => {
      const p = vaultPaths(this.sharedRoot);
      await fs.ensureDir(p.pages);
      await fs.ensureDir(p.privatePages);
      await fs.ensureDir(p.attachments);
      await fs.ensureDir(p.locks);
      await fs.ensureDir(p.backups);
      await fs.ensureDir(p.databases);
      await fs.ensureDir(p.privateDatabases);
      await this.databaseRowContentService().ensureDirs();
      await fs.ensureDir(p.journals);
      await fs.ensureDir(p.inbox);
      await fs.ensureDir(p.smartAssist);
      await fs.ensureDir(p.privateSmartAssist);
      await fs.ensureDir(p.workspace);
      await fs.ensureDir(p.conflicts);
      if (!(await fs.pathExists(p.manifest))) {
        await fs.writeJson(
          p.manifest,
          { version: 1, updatedAt: new Date().toISOString(), pages: [] },
          { spaces: 2 },
        );
      }
    })();
    try {
      await this.vaultInitPromise;
    } catch (error) {
      // A transient shared-folder error must be retryable on the next request.
      this.vaultInitPromise = null;
      throw error;
    }
  }

  private async ensureUnifiedResourceLinkIndex(): Promise<void> {
    const versionKey = "resource-link-index-version";
    const wanted = "529";
    const current = this.db
      .prepare("SELECT value_json as valueJson FROM workspace_summary_cache WHERE cache_key = ?")
      .get(versionKey) as { valueJson?: string } | undefined;
    if (current?.valueJson === wanted) return;
    if (this.unifiedResourceLinkIndexPromise) return this.unifiedResourceLinkIndexPromise;
    const rebuildPromise = (async () => {
      try {
        await this.rebuildWorkspaceDerivedIndexes();
        this.db
          .prepare("INSERT OR REPLACE INTO workspace_summary_cache(cache_key,value_json,content_hash,updated_at) VALUES(?,?,?,?)")
          .run(versionKey, wanted, wanted, new Date().toISOString());
      } catch (error) {
        console.warn("UNIFIED_RESOURCE_LINK_INDEX_REBUILD_FAILED", error);
      } finally {
        this.unifiedResourceLinkIndexPromise = null;
      }
    })();
    this.unifiedResourceLinkIndexPromise = rebuildPromise;
    return rebuildPromise;
  }

  private pageBundleFileSignature(input: {
    metaStat?: fs.Stats | null;
    contentStat?: fs.Stats | null;
    blocksuiteStat?: fs.Stats | null;
  }): string {
    const part = (stat?: fs.Stats | null) =>
      stat ? `${Math.round(stat.mtimeMs)}:${stat.size}` : "0:0";
    return [
      part(input.metaStat),
      part(input.contentStat),
      part(input.blocksuiteStat),
    ].join("|");
  }

  private hasLocalPageAndDerivedIndexes(pageId: string): boolean {
    const page = this.db
      .prepare("SELECT id, trashed FROM pages WHERE id = ?")
      .get(pageId) as { id: string; trashed: number } | undefined;
    if (!page) return false;
    const search = this.db
      .prepare(
        "SELECT page_id FROM page_search_index WHERE page_id = ? LIMIT 1",
      )
      .get(pageId) as { page_id: string } | undefined;
    if (!search) return false;
    if (page.trashed) return true;
    const fts = this.db
      .prepare("SELECT id FROM page_fts WHERE id = ? LIMIT 1")
      .get(pageId) as { id: string } | undefined;
    return Boolean(fts);
  }

  async importFromShared(): Promise<void> {
    await this.initVault();
    const p = vaultPaths(this.sharedRoot);
    const pageSources = [
      { dir: p.pages, scope: "shared" as const },
      { dir: p.privatePages, scope: "private" as const },
    ];
    const upsert = this.db.prepare(`
      INSERT INTO pages(id,title,parent_id,icon,created_at,updated_at,updated_by,sort_order,favorite,trashed,markdown,blocksuite_json,properties_json)
      VALUES(@id,@title,@parentId,@icon,@createdAt,@updatedAt,@updatedBy,@sortOrder,@favorite,@trashed,@markdown,@blocksuiteJson,@propertiesJson)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,
        parent_id=excluded.parent_id,
        icon=excluded.icon,
        updated_at=excluded.updated_at,
        updated_by=excluded.updated_by,
        sort_order=excluded.sort_order,
        favorite=excluded.favorite,
        trashed=excluded.trashed,
        markdown=excluded.markdown,
        blocksuite_json=excluded.blocksuite_json,
        properties_json=excluded.properties_json
    `);
    const upsertState = this.db.prepare(`
      INSERT INTO shared_page_file_state(page_id,scope,signature,meta_mtime_ms,content_mtime_ms,blocksuite_mtime_ms,indexed_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(page_id) DO UPDATE SET
        scope=excluded.scope,
        signature=excluded.signature,
        meta_mtime_ms=excluded.meta_mtime_ms,
        content_mtime_ms=excluded.content_mtime_ms,
        blocksuite_mtime_ms=excluded.blocksuite_mtime_ms,
        indexed_at=excluded.indexed_at
    `);

    const bundles: Array<
      PageBundle & {
        blocksuiteJson: string;
        propertiesJson: string;
        signature: string;
        metaMtimeMs: number;
        contentMtimeMs: number;
        blocksuiteMtimeMs: number;
      }
    > = [];
    let skippedUnchanged = 0;
    // Avoid one SQLite lookup per directory entry during shared-folder scans.
    const cachedSignatures = new Map(
      (this.db.prepare("SELECT page_id, signature FROM shared_page_file_state").all() as Array<{ page_id: string; signature: string }>)
        .map((row) => [row.page_id, row.signature] as const),
    );
    for (const source of pageSources) {
      const entries = await fs.readdir(source.dir).catch(() => []);
      for (const entry of entries) {
        const dir = path.join(source.dir, entry);
        const metaPath = path.join(dir, "meta.json");
        if (!(await fs.pathExists(metaPath))) continue;

        const contentPath = path.join(dir, "content.md");
        const blocksuitePath = path.join(dir, "blocksuite.json");
        // New bundles expose commit.json only after all three files are durable.
        // Legacy bundles without commit.json remain supported.
        if (!(await this.isCommittedPageBundle(dir, entry))) {
          console.info(`IMPORT_FROM_SHARED_PENDING page=${entry}`);
          continue;
        }
        const metaStat = await fs.stat(metaPath).catch(() => null);
        const contentStat = await fs.stat(contentPath).catch(() => null);
        const blocksuiteStat = await fs.stat(blocksuitePath).catch(() => null);
        const signature = this.pageBundleFileSignature({
          metaStat,
          contentStat,
          blocksuiteStat,
        });
        const cachedSignature = cachedSignatures.get(entry);
        if (
          cachedSignature === signature &&
          this.hasLocalPageAndDerivedIndexes(entry)
        ) {
          skippedUnchanged += 1;
          continue;
        }

        const meta = normalizeMeta(
          {
            ...((await fs.readJson(metaPath)) as Partial<PageMeta>),
            scope: source.scope,
          },
          entry,
        );
        const markdown = await fs.readFile(contentPath, "utf8").catch(() => "");
        const blocksuite = await fs
          .readJson(blocksuitePath)
          .catch(() => EMPTY_BLOCKSUITE);
        bundles.push({
          meta,
          markdown,
          blocksuite,
          blocksuiteJson: JSON.stringify(blocksuite),
          propertiesJson: JSON.stringify(
            propertiesForStorage(meta.properties, meta.scope),
          ),
          signature,
          metaMtimeMs: Math.round(metaStat?.mtimeMs || 0),
          contentMtimeMs: Math.round(contentStat?.mtimeMs || 0),
          blocksuiteMtimeMs: Math.round(blocksuiteStat?.mtimeMs || 0),
        });
      }
    }

    const tx = this.db.transaction((items: typeof bundles) => {
      const now = new Date().toISOString();
      for (const b of items) {
        upsert.run({
          ...b.meta,
          markdown: b.markdown,
          blocksuiteJson: b.blocksuiteJson,
          propertiesJson: b.propertiesJson,
          favorite: b.meta.favorite ? 1 : 0,
          trashed: b.meta.trashed ? 1 : 0,
        });
        upsertPageFts(this.db, {
          id: b.meta.id,
          title: b.meta.title,
          markdown: b.markdown,
          trashed: b.meta.trashed ? 1 : 0,
        });
        upsertState.run(
          b.meta.id,
          b.meta.scope || "shared",
          b.signature,
          b.metaMtimeMs,
          b.contentMtimeMs,
          b.blocksuiteMtimeMs,
          now,
        );
      }
    });
    tx(bundles);
    for (const bundle of bundles) this.upsertPageDerivedIndexes(bundle);
    if (bundles.length || skippedUnchanged) {
      console.info(
        `IMPORT_FROM_SHARED_DIFF pagesChanged=${bundles.length} pagesSkipped=${skippedUnchanged}`,
      );
    }
  }

  async listPages(
    options: { includeLocks?: boolean } = {},
  ): Promise<PageWithLock[]> {
    const includeLocks = options.includeLocks !== false;
    const rows = this.db
      .prepare(
        `SELECT id,title,parent_id as parentId,icon,created_at as createdAt,updated_at as updatedAt,updated_by as updatedBy,sort_order as sortOrder,favorite,trashed,properties_json as propertiesJson,substr(replace(replace(markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM pages ORDER BY sort_order, updated_at DESC`,
      )
      .all() as any[];
    const metas = rows.map((r) => ({ ...r, trashed: Boolean(r.trashed) }));
    if (!includeLocks) return metas.map((meta) => this.withoutLock(meta));
    const lockMap = await this.readActiveLockMap();
    return metas.map((meta) => this.withLockFromMap(meta, lockMap));
  }

  /**
   * DB行の子ページは作成時から `database-row:<databaseId>:<rowId>` を
   * parent_id に持つため、サイドバー構築のために全DB・全行本文を開く必要はない。
   *
   * 以前の実装は初回ツリー表示のたびに共有フォルダ上の全DB行コンテンツを
   * 走査していた。DB行が多い環境では、Tab導入後の最初の画面表示と競合して
   * 起動が著しく遅くなるため、SQLiteのページメタデータだけで判定する。
   */
  private async listDatabaseRowChildPageIdSet(): Promise<Set<string>> {
    const rows = this.db
      .prepare(
        "SELECT id FROM pages WHERE parent_id LIKE 'database-row:%'",
      )
      .all() as Array<{ id?: string }>;
    return new Set(rows.map((row) => String(row.id || "")).filter(Boolean));
  }

  private isDatabaseRowParentId(parentId: string | null | undefined): boolean {
    return typeof parentId === "string" && parentId.startsWith("database-row:");
  }

  private uiViewCacheHash(rows: any[]): string {
    const normalized = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        parentId: row.parentId ?? null,
        icon: row.icon ?? null,
        updatedAt: row.updatedAt,
        sortOrder: Number(row.sortOrder || 0),
        favorite: Boolean(row.favorite),
        trashed: Boolean(row.trashed),
        scope: (() => {
          try {
            return pageScopeFrom(JSON.parse(row.propertiesJson || "{}"));
          } catch {
            return "shared";
          }
        })(),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private readUiViewCache<T = any>(
    cacheKey: string,
    contentHash: string,
  ): T | null {
    try {
      const row = this.db
        .prepare(
          "SELECT value_json, content_hash FROM ui_view_cache WHERE cache_key = ?",
        )
        .get(cacheKey) as any;
      if (!row || String(row.content_hash || "") !== contentHash) return null;
      return JSON.parse(String(row.value_json || "null")) as T;
    } catch {
      return null;
    }
  }

  private writeUiViewCache(
    cacheKey: string,
    contentHash: string,
    value: any,
  ): void {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO ui_view_cache (cache_key, value_json, content_hash, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          cacheKey,
          JSON.stringify(value),
          contentHash,
          new Date().toISOString(),
        );
    } catch {
      // UI表示キャッシュは壊れても再生成できるため、保存失敗で本処理を止めない。
    }
  }

  private rowsToFastPageTree(rows: any[]): PageTreeNode[] {
    const pages = rows
      .map((r) => {
        let rawProps: any = {};
        try {
          rawProps = JSON.parse(r.propertiesJson || "{}");
        } catch {
          rawProps = {};
        }
        const meta = {
          id: String(r.id),
          title: String(r.title || "Untitled"),
          parentId: r.parentId ?? null,
          icon: r.icon ?? null,
          createdAt: String(r.createdAt || ""),
          updatedAt: String(r.updatedAt || ""),
          updatedBy: String(r.updatedBy || ""),
          sortOrder: Number(r.sortOrder || 0),
          favorite: Boolean(r.favorite),
          trashed: Boolean(r.trashed),
          scope: pageScopeFrom(rawProps),
          properties: normalizeProperties(rawProps),
          previewSnippet: String(r.previewSnippet || ""),
          lock: null,
          isLocked: false,
        } as PageWithLock;
        return meta;
      })
      .filter((p) => !p.trashed && !this.isDatabaseRowParentId(p.parentId));

    const nodes = new Map<string, PageTreeNode>();
    for (const p of pages) nodes.set(p.id, { ...p, children: [] });
    const roots: PageTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId))
        nodes.get(node.parentId)!.children.push(node);
      else roots.push(node);
    }
    const sortNodes = (items: PageTreeNode[]) => {
      items.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          String(b.updatedAt).localeCompare(String(a.updatedAt)),
      );
      items.forEach((item) => sortNodes(item.children));
    };
    sortNodes(roots);
    return roots;
  }

  private getUiPageSummaryRows(): any[] {
    return this.db
      .prepare(
        `SELECT id,title,parent_id as parentId,icon,created_at as createdAt,updated_at as updatedAt,updated_by as updatedBy,sort_order as sortOrder,favorite,trashed,properties_json as propertiesJson,substr(replace(replace(markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM pages ORDER BY sort_order, updated_at DESC`,
      )
      .all() as any[];
  }

  private workspaceIndexText(markdown: string, title = ""): string {
    return `${title}\n${String(markdown || "")}`.replace(/\s+/g, " ").trim();
  }

  private extractPageLinkRefs(
    text: string,
  ): Array<{ targetPageId: string; kind: string; snippet: string }> {
    const source = String(text || "");
    const found: Array<{
      targetPageId: string;
      kind: string;
      snippet: string;
    }> = [];
    const add = (raw: string, kind: string, index: number) => {
      let targetPageId = safeDecodeURIComponent(String(raw || ""))
        .split("&")[0]
        .trim();
      if (!targetPageId) return;
      found.push({
        targetPageId,
        kind,
        snippet: source
          .slice(Math.max(0, index - 70), Math.min(source.length, index + 120))
          .replace(/\s+/g, " ")
          .trim(),
      });
    };
    const patterns: Array<{ re: RegExp; kind: string }> = [
      { re: /@\[\[[^|\]]+\|([^\]]+)\]\]/g, kind: "at-page-link" },
      { re: /local-page:\/\/([^\s)\]\"']+)/g, kind: "local-page-url" },
      { re: /#local-page=([^\s)\]\"']+)/g, kind: "hash-local-page" },
      { re: /page:([^\s)\]\"']+)/g, kind: "page-token" },
    ];
    for (const { re, kind } of patterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source))) add(match[1] || "", kind, match.index);
    }
    return found;
  }

  private extractDatabaseRowLinkRefs(
    text: string,
  ): Array<{ targetDatabaseId: string; targetRowId: string; kind: string; snippet: string }> {
    const source = String(text || "");
    const found: Array<{
      targetDatabaseId: string;
      targetRowId: string;
      kind: string;
      snippet: string;
    }> = [];
    const add = (rawDatabaseId: string, rawRowId: string, kind: string, index: number) => {
      const targetDatabaseId = safeDecodeURIComponent(String(rawDatabaseId || "")).trim();
      const targetRowId = safeDecodeURIComponent(String(rawRowId || "")).split("&")[0].trim();
      if (!targetDatabaseId || !targetRowId) return;
      found.push({
        targetDatabaseId,
        targetRowId,
        kind,
        snippet: source
          .slice(Math.max(0, index - 70), Math.min(source.length, index + 140))
          .replace(/\s+/g, " ")
          .trim(),
      });
    };
    const patterns: Array<{ re: RegExp; kind: string; database: number; row: number }> = [
      { re: /dbrow:([^:\s)\]\"']+):([^\s)\]\"']+)/g, kind: "dbrow-token", database: 1, row: 2 },
      { re: /local-dbrow:\/\/([^\/\s)\]\"']+)\/([^\s)\]\"']+)/g, kind: "local-dbrow-url", database: 1, row: 2 },
      { re: /#local-dbrow=([^&\s)\]\"']+)&row=([^\s)\]\"']+)/g, kind: "hash-local-dbrow", database: 1, row: 2 },
    ];
    for (const { re, kind, database, row } of patterns) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source))) add(match[database] || "", match[row] || "", kind, match.index);
    }
    return found;
  }

  /** Resolves only the page IDs referenced by the source being indexed. */
  private existingActivePageIds(pageIds: Iterable<string>): Set<string> {
    const ids = Array.from(new Set(Array.from(pageIds).filter(Boolean)));
    const existing = new Set<string>();
    // SQLite limits bound parameters; chunking keeps malformed imported content from
    // turning one save into a failed index update.
    for (let offset = 0; offset < ids.length; offset += 800) {
      const chunk = ids.slice(offset, offset + 800);
      if (!chunk.length) continue;
      const placeholders = chunk.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT id FROM pages WHERE trashed = 0 AND id IN (${placeholders})`)
        .all(...chunk) as Array<{ id: string }>;
      for (const row of rows) existing.add(row.id);
    }
    return existing;
  }

  private upsertPageDerivedIndexes(bundle: PageBundle): void {
    const meta = bundle.meta;
    const pageId = meta.id;
    const markdown = String(bundle.markdown || "");
    const searchText = this.workspaceIndexText(markdown, meta.title);
    const preview = searchText.slice(0, 240);
    const now = meta.updatedAt || new Date().toISOString();
    // Parse the source once. The old implementation loaded every active page on each
    // save merely to validate a handful of link targets.
    const linkSource = `${markdown}\n${JSON.stringify(bundle.blocksuite || {})}`;
    const pageLinkRefs = this.extractPageLinkRefs(linkSource);
    const databaseRowLinkRefs = this.extractDatabaseRowLinkRefs(linkSource);
    const existingReferencedPageIds = this.existingActivePageIds(
      pageLinkRefs.map((link) => link.targetPageId),
    );
    const tx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM page_search_index WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM page_search_fts WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM workspace_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM broken_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare(
          `INSERT INTO page_search_index(page_id,title,icon,parent_id,updated_at,search_text,preview_snippet,trashed) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          pageId,
          meta.title || "",
          meta.icon || null,
          meta.parentId || null,
          now,
          searchText,
          preview,
          meta.trashed ? 1 : 0,
        );
      this.db
        .prepare(
          `INSERT INTO page_search_fts(page_id,title,search_text) VALUES(?,?,?)`,
        )
        .run(pageId, meta.title || "", searchText);

      const existingIds = existingReferencedPageIds;
      const insertLink = this.db.prepare(
        `INSERT OR REPLACE INTO workspace_link_index(id,source_type,source_page_id,source_title,source_icon,target_page_id,target_type,target_database_id,target_row_id,link_kind,snippet,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const insertBroken = this.db.prepare(
        `INSERT OR REPLACE INTO broken_link_index(id,source_page_id,source_title,source_icon,target_id,snippet,updated_at) VALUES(?,?,?,?,?,?,?)`,
      );
      const indexedPageTargets = new Set<string>();
      for (const link of pageLinkRefs) {
        if (indexedPageTargets.has(link.targetPageId)) continue;
        indexedPageTargets.add(link.targetPageId);
        const stable = createHash("sha1")
          .update(`${pageId}|${link.targetPageId}|${link.kind}|${link.snippet}`)
          .digest("hex");
        if (existingIds.has(link.targetPageId)) {
          insertLink.run(
            `page:${stable}`,
            "page",
            pageId,
            meta.title || "",
            meta.icon || "📄",
            link.targetPageId,
            "page",
            null,
            null,
            link.kind,
            link.snippet,
            now,
          );
        } else {
          insertBroken.run(
            `page:${stable}`,
            pageId,
            meta.title || "",
            meta.icon || "📄",
            link.targetPageId,
            link.snippet,
            now,
          );
        }
      }

      // Database-row targets share the same workspace graph as ordinary page links.
      // This makes page -> DB row backlinks incremental instead of requiring a full workspace scan.
      const indexedDatabaseRowTargets = new Set<string>();
      for (const link of databaseRowLinkRefs) {
        const targetKey = `${link.targetDatabaseId}:${link.targetRowId}`;
        if (indexedDatabaseRowTargets.has(targetKey)) continue;
        indexedDatabaseRowTargets.add(targetKey);
        const stable = createHash("sha1")
          .update(`${pageId}|${targetKey}|${link.kind}|${link.snippet}`)
          .digest("hex");
        insertLink.run(
          `page-dbrow:${stable}`,
          "page",
          pageId,
          meta.title || "",
          meta.icon || "📄",
          "",
          "database-row",
          link.targetDatabaseId,
          link.targetRowId,
          link.kind,
          link.snippet,
          now,
        );
      }

      // Legacy title cards are retained for compatibility. First let SQLite narrow
      // candidates by literal occurrence, then run the boundary-safe regex only on
      // those candidates. This avoids creating one regex per workspace page on every save.
      const titleRows = this.db
        .prepare(
          "SELECT id,title FROM pages WHERE trashed = 0 AND id <> ? AND instr(?, '📄 ' || title) > 0",
        )
        .all(pageId, markdown) as Array<{ id: string; title: string }>;
      for (const target of titleRows) {
        const title = String(target.title || "").trim();
        if (!title) continue;
        const re = new RegExp(
          `(?:^|\n|\s)📄\s+${escapeRegExpText(title)}(?=$|\n|\s)`,
          "u",
        );
        const match = re.exec(markdown);
        if (!match) continue;
        const snippet = markdown
          .slice(
            Math.max(0, match.index - 70),
            Math.min(markdown.length, match.index + 120),
          )
          .replace(/\s+/g, " ")
          .trim();
        const stable = createHash("sha1")
          .update(`${pageId}|${target.id}|title-card|${snippet}`)
          .digest("hex");
        insertLink.run(
          `page-title:${stable}`,
          "page",
          pageId,
          meta.title || "",
          meta.icon || "📄",
          target.id,
          "page",
          null,
          null,
          "title-card",
          snippet,
          now,
        );
      }
    });
    try {
      tx();
    } catch (error) {
      console.warn("UPSERT_PAGE_DERIVED_INDEX_FAILED", pageId, error);
    }
    try {
      this.upsertTaskIndexForSource(
        "page",
        pageId,
        meta.title || "",
        meta.icon || "📄",
        now,
        markdown,
      );
    } catch (error) {
      console.warn("UPSERT_PAGE_TASK_INDEX_FAILED", pageId, error);
    }
  }

  private upsertDatabaseRowLinkIndex(
    database: WorkspaceDatabase,
    rowContent: DatabaseRowContent,
    rowTitle?: string,
  ): void {
    const haystack = `${rowContent.markdown || ""}\n${JSON.stringify(rowContent.blocksuite || {})}`;
    const now = rowContent.updatedAt || new Date().toISOString();
    const title = rowTitle || rowContent.title || rowContent.rowId;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM workspace_link_index WHERE source_type = ? AND source_database_id = ? AND source_row_id = ?",
        )
        .run("database-row", database.id, rowContent.rowId);
      // Resolve only targets referenced by this row. Loading every page ID on each
      // DB-row body save made row editing slower as the workspace grew.
      const pageLinkRefs = this.extractPageLinkRefs(haystack);
      const insertLink = this.db.prepare(
        `INSERT OR REPLACE INTO workspace_link_index(id,source_type,source_database_id,source_row_id,source_title,source_icon,target_page_id,target_type,target_database_id,target_row_id,link_kind,snippet,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const sourceTitle = `${database.title} / ${title}`;
      const indexedPageTargets = new Set<string>();
      const structuralChildPageIds = new Set<string>(rowContent.childPageIds || []);
      for (const item of this.db
        .prepare("SELECT id FROM pages WHERE trashed = 0 AND parent_id = ?")
        .all(`database-row:${database.id}:${rowContent.rowId}`) as Array<{ id: string }>) {
        structuralChildPageIds.add(item.id);
      }
      const existingIds = this.existingActivePageIds(
        pageLinkRefs
          .map((link) => link.targetPageId)
          .concat(Array.from(structuralChildPageIds)),
      );
      // Child pages are structural links, not merely editor text. Index them first so
      // backlinks and graph traversal work even when a user removes the generated text link.
      for (const pageId of structuralChildPageIds) {
        if (!existingIds.has(pageId)) continue;
        indexedPageTargets.add(pageId);
        const stable = createHash("sha1")
          .update(`${database.id}|${rowContent.rowId}|${pageId}|database-child-page`)
          .digest("hex");
        insertLink.run(
          `dbrow-child:${stable}`,
          "database-row",
          database.id,
          rowContent.rowId,
          sourceTitle,
          "🧾",
          pageId,
          "page",
          null,
          null,
          "database-child-page",
          "DB行の子ページ",
          now,
        );
      }
      for (const link of pageLinkRefs) {
        if (!existingIds.has(link.targetPageId) || indexedPageTargets.has(link.targetPageId)) continue;
        indexedPageTargets.add(link.targetPageId);
        const stable = createHash("sha1")
          .update(`${database.id}|${rowContent.rowId}|${link.targetPageId}|${link.kind}|${link.snippet}`)
          .digest("hex");
        insertLink.run(
          `dbrow:${stable}`,
          "database-row",
          database.id,
          rowContent.rowId,
          sourceTitle,
          "🧾",
          link.targetPageId,
          "page",
          null,
          null,
          link.kind,
          link.snippet || textSnippetAround(haystack, link.targetPageId),
          now,
        );
      }
      const indexedDatabaseRowTargets = new Set<string>();
      for (const link of this.extractDatabaseRowLinkRefs(haystack)) {
        const targetKey = `${link.targetDatabaseId}:${link.targetRowId}`;
        if (indexedDatabaseRowTargets.has(targetKey)) continue;
        indexedDatabaseRowTargets.add(targetKey);
        const stable = createHash("sha1")
          .update(`${database.id}|${rowContent.rowId}|${targetKey}|${link.kind}|${link.snippet}`)
          .digest("hex");
        insertLink.run(
          `dbrow-dbrow:${stable}`,
          "database-row",
          database.id,
          rowContent.rowId,
          sourceTitle,
          "🧾",
          "",
          "database-row",
          link.targetDatabaseId,
          link.targetRowId,
          link.kind,
          link.snippet,
          now,
        );
      }
    });
    try {
      tx();
    } catch (error) {
      console.warn(
        "UPSERT_DB_ROW_LINK_INDEX_FAILED",
        database.id,
        rowContent.rowId,
        error,
      );
    }
  }

  async rebuildWorkspaceDerivedIndexes(): Promise<any> {
    const startedAt = Date.now();
    const pageRows = this.db.prepare("SELECT id FROM pages").all() as Array<{
      id: string;
    }>;
    let pagesIndexed = 0;
    for (const row of pageRows) {
      const bundle = this.getPage(row.id);
      if (!bundle) continue;
      this.upsertPageDerivedIndexes(bundle);
      pagesIndexed += 1;
    }

    let rowLinksIndexed = 0;
    try {
      for (const db of await this.listDatabases()) {
        const scope = db.scope === "private" ? "private" : "shared";
        for (const rowContent of await this.databaseRowContentService().listExistingRowContents(
          db.id,
          scope,
        )) {
          const row = db.rows.find((item) => item.id === rowContent.rowId);
          this.upsertDatabaseRowLinkIndex(
            db,
            rowContent,
            row ? databaseRowTitle(db, row) : rowContent.title,
          );
          rowLinksIndexed += 1;
        }
      }
    } catch (error) {
      console.warn("REBUILD_DB_ROW_LINK_INDEX_FAILED", error);
    }

    const attachmentsIndexed = await this.rebuildAttachmentIndex().catch(
      () => 0,
    );
    return {
      ok: true,
      mode: "workspace-derived-index-v529-resource-graph",
      pagesIndexed,
      rowLinksIndexed,
      attachmentsIndexed,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async rebuildAttachmentIndex(): Promise<number> {
    const pages = await this.listPages();
    const tx = this.db.transaction((items: any[]) => {
      this.db.prepare("DELETE FROM attachment_index").run();
      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO attachment_index(id,page_id,attachment_id,file_name,mime_type,size,created_at,relative_path,page_title,page_icon,page_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const item of items) {
        insert.run(
          item.id,
          item.pageId,
          item.attachmentId,
          item.fileName,
          item.mimeType,
          item.size,
          item.createdAt,
          item.relativePath,
          item.pageTitle,
          item.pageIcon,
          item.pageUpdatedAt,
        );
      }
    });
    const items: any[] = [];
    for (const page of pages) {
      if (page.trashed) continue;
      const attachments = await this.listAttachments(page.id).catch(() => []);
      for (const item of attachments) {
        items.push({
          id: `${page.id}:${item.id}`,
          pageId: page.id,
          attachmentId: item.id,
          fileName: item.fileName || "",
          mimeType: (item as any).mimeType || "",
          size: Number(item.size || 0),
          createdAt: item.createdAt || page.updatedAt || "",
          relativePath: item.relativePath || "",
          pageTitle: page.title,
          pageIcon: page.icon || "📄",
          pageUpdatedAt: page.updatedAt || "",
        });
      }
    }
    tx(items);
    return items.length;
  }

  async getWorkspaceDerivedIndexInfo(): Promise<any> {
    const count = (table: string) => {
      try {
        return (
          (
            this.db
              .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
              .get() as any
          ).count || 0
        );
      } catch {
        return 0;
      }
    };
    return {
      ok: true,
      mode: "workspace-derived-index-v529-resource-graph",
      pageSearchRows: count("page_search_index"),
      pageLinks: count("workspace_link_index"),
      attachments: count("attachment_index"),
      brokenLinks: count("broken_link_index"),
      note: "バックリンク・添付・ページ候補・リンク切れをSQLiteインデックスから表示するための派生キャッシュです。正本ではないため再構築できます。",
    };
  }

  async getWorkspaceSummaryIndexInfo(): Promise<any> {
    const count = (table: string) => {
      try {
        return (
          (
            this.db
              .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
              .get() as any
          ).count || 0
        );
      } catch {
        return 0;
      }
    };
    const dashboard = this.db
      .prepare(
        "SELECT updated_at as updatedAt, length(value_json) as bytes FROM workspace_summary_cache WHERE cache_key = ?",
      )
      .get("dashboard") as any;
    return {
      ok: true,
      mode: "workspace-summary-index-v336",
      tasks: count("task_index"),
      openTasks: (() => {
        try {
          return (
            (
              this.db
                .prepare(
                  "SELECT COUNT(*) AS count FROM task_index WHERE completed = 0",
                )
                .get() as any
            ).count || 0
          );
        } catch {
          return 0;
        }
      })(),
      journals: count("journal_summary_index"),
      dashboardCached: Boolean(dashboard),
      dashboardUpdatedAt: dashboard?.updatedAt || null,
      dashboardBytes: dashboard?.bytes || 0,
      note: "Tasks / Journal / Dashboardを全件走査せずに表示するためのSQLiteサマリーインデックスです。正本ではなく再構築できます。",
    };
  }

  async getUiDisplayCacheInfo(): Promise<any> {
    const rows = this.getUiPageSummaryRows();
    const hash = this.uiViewCacheHash(rows);
    const existing = this.db
      .prepare(
        "SELECT cache_key, content_hash, updated_at, length(value_json) AS bytes FROM ui_view_cache ORDER BY cache_key",
      )
      .all() as any[];
    const sidebar = existing.find(
      (row) => row.cache_key === "sidebar_tree_v330",
    );
    return {
      ok: true,
      mode: "local-sqlite-ui-view-cache-v330",
      pageCount: rows.filter((row) => !row.trashed).length,
      cacheRows: existing.length,
      sidebarTreeCached: Boolean(sidebar),
      sidebarTreeFresh: Boolean(sidebar && sidebar.content_hash === hash),
      sidebarTreeUpdatedAt: sidebar?.updated_at || null,
      pageHash: hash,
      entries: existing,
      note: "UI表示キャッシュは画面遷移・サイドバー初期表示用です。正本ではないため、壊れても再構築できます。",
    };
  }

  async rebuildUiDisplayCache(): Promise<any> {
    const rows = this.getUiPageSummaryRows();
    const hash = this.uiViewCacheHash(rows);
    const tree = this.rowsToFastPageTree(rows);
    const recentPages = rows
      .filter((row) => !row.trashed)
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 20)
      .map((row) => ({
        id: row.id,
        title: row.title,
        icon: row.icon ?? null,
        updatedAt: row.updatedAt,
        previewSnippet: row.previewSnippet || "",
      }));
    this.writeUiViewCache("sidebar_tree_v330", hash, tree);
    this.writeUiViewCache("recent_pages_v330", hash, recentPages);
    return {
      ok: true,
      mode: "rebuilt-ui-view-cache-v330",
      pageCount: rows.filter((row) => !row.trashed).length,
      treeCount: tree.length,
      recentCount: recentPages.length,
      hash,
      updatedAt: new Date().toISOString(),
    };
  }

  async listPageTree(): Promise<PageTreeNode[]> {
    // v330: サイドバー初期表示はUI表示キャッシュを優先する。
    // 共有フォルダやDB行子ページの確認は重くなりやすいため、ページ一覧のハッシュが同じなら
    // 前回作成したツリーを即返す。キャッシュが古い場合だけ従来方式で再構築する。
    const rows = this.getUiPageSummaryRows();
    const hash = this.uiViewCacheHash(rows);
    const cached = this.readUiViewCache<PageTreeNode[]>(
      "sidebar_tree_v330",
      hash,
    );
    if (cached && Array.isArray(cached)) return cached;

    // `parent_id` is the canonical relation for DB-row child pages.  Do not
    // inspect every row-content JSON file while serving the first sidebar tree.
    const pages = (await this.listPages({ includeLocks: false })).filter(
      (p) => !p.trashed && !this.isDatabaseRowParentId(p.parentId),
    );
    const nodes = new Map<string, PageTreeNode>();
    for (const p of pages) nodes.set(p.id, { ...p, children: [] });

    const roots: PageTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortNodes = (items: PageTreeNode[]) => {
      items.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt),
      );
      items.forEach((i) => sortNodes(i.children));
    };
    sortNodes(roots);
    this.writeUiViewCache("sidebar_tree_v330", hash, roots);
    return roots;
  }

  async listLocks(): Promise<LockInfo[]> {
    return Array.from((await this.readActiveLockMap()).values());
  }

  /** Called during API shutdown as a final safeguard when renderer teardown is interrupted. */
  async releaseAllLocksForCurrentInstance(): Promise<void> {
    const locksDir = vaultPaths(this.sharedRoot).locks;
    const entries = await fs.readdir(locksDir).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".lock"))
        .map(async (entry) => {
          const file = path.join(locksDir, entry);
          const lock = (await fs
            .readJson(file)
            .catch(() => null)) as LockInfo | null;
          if (lock?.appInstanceId === this.appInstanceId) {
            await fs.remove(file).catch(() => undefined);
          }
        }),
    );
  }

  private async readActiveLockMap(): Promise<Map<string, LockInfo>> {
    const locksDir = vaultPaths(this.sharedRoot).locks;
    const entries = await fs.readdir(locksDir).catch(() => []);
    const locks = new Map<string, LockInfo>();
    const now = Date.now();
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.endsWith(".lock")) return;
        const full = path.join(locksDir, entry);
        const lock = (await fs
          .readJson(full)
          .catch(() => null)) as LockInfo | null;
        if (!lock) return;
        if (!lockIsActive(lock, now) || this.isOrphanedLocalLock(lock)) {
          await fs.remove(full).catch(() => undefined);
          return;
        }
        const pageId = (lock as any).pageId || entry.replace(/\.lock$/, "");
        if (pageId) locks.set(pageId, lock);
      }),
    );
    return locks;
  }

  getPage(id: string): PageBundle | null {
    const row = this.db
      .prepare(
        `SELECT id,title,parent_id as parentId,icon,created_at as createdAt,updated_at as updatedAt,updated_by as updatedBy,sort_order as sortOrder,favorite,trashed,markdown,blocksuite_json as blocksuiteJson,properties_json as propertiesJson FROM pages WHERE id = ?`,
      )
      .get(id) as any;
    if (!row) return null;
    return {
      meta: {
        id: row.id,
        title: row.title,
        parentId: row.parentId,
        icon: row.icon,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        sortOrder: row.sortOrder,
        favorite: Boolean(row.favorite),
        trashed: Boolean(row.trashed),
        properties: normalizeProperties(JSON.parse(row.propertiesJson || "{}")),
        scope: pageScopeFrom(JSON.parse(row.propertiesJson || "{}")),
      },
      markdown: row.markdown,
      blocksuite: JSON.parse(row.blocksuiteJson || "{}"),
    };
  }

  /**
   * Comments follow the page storage boundary. Private-page comments must never be
   * written beneath the shared vault. Legacy private comments stored in the shared
   * location are read once for compatibility and moved on the next write.
   */
  private pageCommentsPath(pageId: string, scope: WorkspaceScope): string {
    const paths = vaultPaths(this.sharedRoot);
    const pagesRoot = selectScopedRoot(scope, paths.pages, paths.privatePages);
    return path.join(pagesRoot, sanitizeSegment(pageId), "comments.json");
  }

  private pageScope(pageId: string): WorkspaceScope {
    const page = this.getPage(pageId);
    if (!page) throw new Error("Page not found");
    return page.meta.scope === "private" ? "private" : "shared";
  }

  async listPageComments(pageId: string): Promise<PageComment[]> {
    return this.commentService.list(pageId);
  }

  /**
   * Returns small, accurate tab counters without loading history metadata,
   * backlink rows, or the activity timeline into the renderer.
   */
  async getPageSidebarCounts(pageId: string): Promise<PageSidebarCounts> {
    if (!this.getPage(pageId)) throw new Error("Page not found");
    const [comments, history, backlinkRow] = await Promise.all([
      this.commentService.list(pageId).catch(() => [] as PageComment[]),
      this.pageHistoryService.count(pageId).catch(() => 0),
      Promise.resolve(
        this.db
          .prepare(
            `
        SELECT COUNT(*) as count
        FROM workspace_link_index
        WHERE target_page_id = ?
      `,
          )
          .get(pageId) as { count?: number } | undefined,
      ),
    ]);
    return {
      commentsOpen: comments.filter((comment) => !comment.resolved).length,
      commentsTotal: comments.length,
      history,
      backlinks: Number(backlinkRow?.count || 0),
    };
  }

  async addPageComment(
    pageId: string,
    input: string | { body?: string; blockId?: string; blockPreview?: string },
  ): Promise<PageComment[]> {
    return this.commentService.add(pageId, input);
  }

  async updatePageComment(
    pageId: string,
    commentId: string,
    patch: Partial<Pick<PageComment, "body" | "resolved">>,
  ): Promise<PageComment[]> {
    return this.commentService.update(pageId, commentId, patch);
  }

  async deletePageComment(
    pageId: string,
    commentId: string,
  ): Promise<PageComment[]> {
    return this.commentService.remove(pageId, commentId);
  }

  async listPageActivity(pageId: string): Promise<PageActivityItem[]> {
    const current = this.getPage(pageId);
    if (!current) throw new Error("Page not found");
    const [history, comments] = await Promise.all([
      this.listHistory(pageId).catch(() => []),
      this.listPageComments(pageId).catch(() => []),
    ]);
    const items: PageActivityItem[] = [];
    items.push({
      id: `current_${pageId}`,
      pageId,
      type: "saved",
      title: "現在のページ",
      description: `${current.meta.title} / 最終更新 ${current.meta.updatedBy}`,
      createdAt: current.meta.updatedAt,
      createdBy: current.meta.updatedBy,
    });
    for (const h of history) {
      const historyTitle =
        h.reason === "manual"
          ? "手動保存"
          : h.reason === "auto_checkpoint"
            ? "自動チェックポイント"
            : h.reason === "metadata_changed"
              ? "ページ情報を変更"
              : h.reason === "restore_before"
                ? "復元前バックアップ"
                : "保存履歴";
      items.push({
        id: `history_${h.id}`,
        pageId,
        type: "saved",
        title: historyTitle,
        description: h.title || "ページを保存しました",
        createdAt: h.createdAt,
        createdBy: h.createdBy,
        historyId: h.id,
      });
    }
    for (const c of comments) {
      items.push({
        id: `comment_${c.id}`,
        pageId,
        type: c.resolved ? "comment_resolved" : "comment",
        title: c.resolved ? "コメントを解決" : "コメントを追加",
        description: `${c.blockPreview ? `「${c.blockPreview}」へのコメント: ` : ""}${c.body}`,
        createdAt: c.updatedAt || c.createdAt,
        createdBy: c.author,
        commentId: c.id,
        blockId: c.blockId,
      });
    }
    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async createPage(
    title = "Untitled",
    parentId: string | null = null,
    scope: "private" | "shared" = "shared",
  ): Promise<PageBundle> {
    const now = new Date().toISOString();
    const id = `page_${nanoid(12)}`;
    const meta: PageMeta = {
      id,
      title,
      parentId,
      createdAt: now,
      updatedAt: now,
      updatedBy: this.userLabel(),
      icon: "📄",
      sortOrder: Date.now(),
      favorite: false,
      trashed: false,
      properties: { ...DEFAULT_PAGE_PROPERTIES },
      scope,
    };
    const bundle: PageBundle = {
      meta,
      markdown: "",
      blocksuite: EMPTY_BLOCKSUITE,
    };
    await this.writeBundle(bundle);
    this.db
      .prepare(
        `INSERT INTO pages(id,title,parent_id,icon,created_at,updated_at,updated_by,sort_order,favorite,trashed,markdown,blocksuite_json,properties_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        meta.id,
        meta.title,
        meta.parentId,
        meta.icon,
        meta.createdAt,
        meta.updatedAt,
        meta.updatedBy,
        meta.sortOrder,
        meta.favorite ? 1 : 0,
        0,
        bundle.markdown,
        JSON.stringify(bundle.blocksuite),
        JSON.stringify(propertiesForStorage(meta.properties, meta.scope)),
      );
    upsertPageFts(this.db, {
      id: meta.id,
      title: meta.title,
      markdown: bundle.markdown,
      trashed: meta.trashed ? 1 : 0,
    });
    this.upsertPageDerivedIndexes(bundle);
    return bundle;
  }

  async duplicatePage(id: string): Promise<PageBundle> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    const copy = await this.createPage(
      `${current.meta.title} コピー`,
      current.meta.parentId,
      current.meta.scope,
    );
    return this.savePage({
      id: copy.meta.id,
      title: copy.meta.title,
      markdown: current.markdown,
      blocksuite: current.blocksuite,
      properties: current.meta.properties,
    });
  }

  async movePage(id: string, parentId: string | null): Promise<PageMeta> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    if (id === parentId) throw new Error("自分自身を親ページにはできません。");
    const meta: PageMeta = {
      ...current.meta,
      parentId,
      updatedAt: new Date().toISOString(),
      updatedBy: this.userLabel(),
    };
    const bundle: PageBundle = { ...current, meta };
    await this.writeBundle(bundle);
    this.db
      .prepare(
        `UPDATE pages SET parent_id=?, updated_at=?, updated_by=? WHERE id=?`,
      )
      .run(parentId, meta.updatedAt, meta.updatedBy, id);
    return meta;
  }

  async updatePageOrder(id: string, sortOrder: number): Promise<PageMeta> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    const meta: PageMeta = {
      ...current.meta,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : Date.now(),
      updatedAt: new Date().toISOString(),
      updatedBy: this.userLabel(),
    };
    const bundle: PageBundle = { ...current, meta };
    await this.writeBundle(bundle);
    this.db
      .prepare(
        `UPDATE pages SET sort_order=?, updated_at=?, updated_by=? WHERE id=?`,
      )
      .run(meta.sortOrder, meta.updatedAt, meta.updatedBy, id);
    return meta;
  }

  async toggleFavorite(id: string): Promise<PageMeta> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    const meta: PageMeta = {
      ...current.meta,
      favorite: !current.meta.favorite,
      updatedAt: new Date().toISOString(),
      updatedBy: this.userLabel(),
    };
    const bundle: PageBundle = { ...current, meta };
    await this.writeBundle(bundle);
    this.db
      .prepare(
        `UPDATE pages SET favorite=?, updated_at=?, updated_by=? WHERE id=?`,
      )
      .run(meta.favorite ? 1 : 0, meta.updatedAt, meta.updatedBy, id);
    return meta;
  }

  async listTrash(): Promise<PageWithLock[]> {
    const rows = this.db
      .prepare(
        `SELECT id,title,parent_id as parentId,icon,created_at as createdAt,updated_at as updatedAt,updated_by as updatedBy,sort_order as sortOrder,favorite,trashed,properties_json as propertiesJson,substr(replace(replace(markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM pages WHERE trashed = 1 ORDER BY updated_at DESC`,
      )
      .all() as any[];
    return Promise.all(
      rows.map(async (r) =>
        this.withLock({ ...r, trashed: Boolean(r.trashed) }),
      ),
    );
  }

  private getDescendantPageIds(id: string): string[] {
    const rows = this.db
      .prepare(`SELECT id,parent_id as parentId FROM pages`)
      .all() as Array<{ id: string; parentId: string | null }>;
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.parentId) continue;
      const list = children.get(row.parentId) ?? [];
      list.push(row.id);
      children.set(row.parentId, list);
    }
    const result: string[] = [];
    const walk = (pageId: string) => {
      for (const childId of children.get(pageId) ?? []) {
        result.push(childId);
        walk(childId);
      }
    };
    walk(id);
    return result;
  }

  private async removeDatabaseChildReferencesAndRefreshIndex(pageId: string): Promise<void> {
    // A DB-row child page can be removed while a row editor is stale or while a
    // shared-folder write is delayed.  Remove its structural index entries first
    // so reference pickers never keep offering a deleted/trashed child page.
    this.db
      .prepare(
        "DELETE FROM workspace_link_index WHERE target_page_id = ? AND link_kind = 'database-child-page'",
      )
      .run(pageId);

    const result = await this.databaseRowContentService()
      .removeChildPageReference(pageId)
      .catch(() => ({ updated: 0, updatedRows: [] as Array<{ databaseId: string; rowId: string; scope: WorkspaceScope }> }));
    for (const changed of result.updatedRows || []) {
      try {
        const database = await this.getDatabase(changed.databaseId);
        const row = database?.rows.find((item) => item.id === changed.rowId);
        if (!database || !row) continue;
        const content = await this.getDatabaseRowContent(changed.databaseId, changed.rowId, {
          title: databaseRowTitle(database, row),
          scope: changed.scope,
        });
        this.upsertDatabaseRowLinkIndex(database, content, databaseRowTitle(database, row));
      } catch (error) {
        console.warn("REFRESH_DB_ROW_LINK_INDEX_AFTER_CHILD_REMOVAL_FAILED", changed.databaseId, changed.rowId, error);
      }
    }
  }

  async trashPage(id: string): Promise<PageMeta> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    const lock = await this.getLock(id);
    if (
      lock &&
      lock.appInstanceId !== this.appInstanceId &&
      new Date(lock.expiresAt).getTime() > Date.now()
    ) {
      throw new Error(`Page is locked by ${lock.userName} / ${lock.lockedBy}`);
    }

    const ids = [id, ...this.getDescendantPageIds(id)];
    // A parent page can own descendants. Check every target before writing any
    // bundle so a locked child never leaves the tree half-trashed on another PC.
    for (const pageId of ids) {
      if (pageId === id) continue;
      const childLock = await this.getLock(pageId);
      if (
        childLock &&
        childLock.appInstanceId !== this.appInstanceId &&
        new Date(childLock.expiresAt).getTime() > Date.now()
      ) {
        throw new Error(`Page is locked by ${childLock.userName} / ${childLock.lockedBy}`);
      }
    }

    const now = new Date().toISOString();
    for (const pageId of ids) {
      const page = this.getPage(pageId);
      if (!page) continue;
      const meta: PageMeta = {
        ...page.meta,
        trashed: true,
        updatedAt: now,
        updatedBy: this.userLabel(),
      };
      await this.backupPage(page);
      await this.writeBundle({ ...page, meta });
      this.db
        .prepare(
          `UPDATE pages SET trashed=1, updated_at=?, updated_by=? WHERE id=?`,
        )
        .run(meta.updatedAt, meta.updatedBy, pageId);
      await this.releaseLock(pageId);
      await this.removeDatabaseChildReferencesAndRefreshIndex(pageId);
    }
    for (const pageId of ids) {
      deletePageFts(this.db, pageId);
      this.db
        .prepare("DELETE FROM page_search_index WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM page_search_fts WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM workspace_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM broken_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM attachment_index WHERE page_id = ?")
        .run(pageId);
    }
    return {
      ...current.meta,
      trashed: true,
      updatedAt: now,
      updatedBy: this.userLabel(),
    };
  }

  async restoreTrashedPage(id: string): Promise<PageMeta> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");

    // Trashing a parent moves its descendants too. Restore the complete subtree
    // in one operation so users do not get an apparently restored empty folder.
    const ids = [id, ...this.getDescendantPageIds(id)].filter((pageId) =>
      Boolean(this.getPage(pageId)?.meta.trashed),
    );
    const now = new Date().toISOString();
    let restoredRoot: PageMeta | null = null;

    for (const pageId of ids) {
      const page = this.getPage(pageId);
      if (!page) continue;
      const parent = page.meta.parentId ? this.getPage(page.meta.parentId) : null;
      const meta: PageMeta = {
        ...page.meta,
        // The root may have had a deleted parent. Descendants retain their
        // restored parent relationship because their parent is restored first.
        parentId: parent?.meta.trashed ? null : page.meta.parentId,
        trashed: false,
        updatedAt: now,
        updatedBy: this.userLabel(),
      };
      await this.backupPage(page);
      await this.writeBundle({ ...page, meta });
      this.db
        .prepare(
          `UPDATE pages SET parent_id=?, trashed=0, updated_at=?, updated_by=? WHERE id=?`,
        )
        .run(meta.parentId, meta.updatedAt, meta.updatedBy, pageId);
      upsertPageFts(this.db, {
        id: meta.id,
        title: meta.title,
        markdown: page.markdown,
        trashed: 0,
      });
      this.upsertPageDerivedIndexes({ ...page, meta });
      if (pageId === id) restoredRoot = meta;
    }

    if (!restoredRoot) throw new Error("Page could not be restored");
    return restoredRoot;
  }

  async deletePagePermanently(
    id: string,
  ): Promise<{ ok: true; deletedIds: string[] }> {
    const current = this.getPage(id);
    if (!current) throw new Error("Page not found");
    if (!current.meta.trashed) {
      throw new Error("完全削除する前にページをゴミ箱へ移動してください。");
    }

    const paths = vaultPaths(this.sharedRoot);
    const safeId = sanitizeSegment(id);
    const ids = [
      id,
      ...this.getDescendantPageIds(id).filter(
        (pageId) => this.getPage(pageId)?.meta.trashed,
      ),
    ];
    const deletedRoot = path.join(
      paths.backups,
      `deleted_${safeId}_${Date.now()}`,
    );
    await fs.ensureDir(deletedRoot);

    const unique = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean)));

    for (const pageId of ids) {
      const page = this.getPage(pageId);
      const safePageId = sanitizeSegment(pageId);
      const scope = page?.meta.scope === "private" ? "private" : "shared";

      // v161+ ではページ本体が Shared/Private のどちらにも存在し得ます。
      // ゴミ箱の完全削除では、現在の scope だけでなく両方の保存先候補を確認して削除します。
      const pageDirs = unique([
        path.join(
          scope === "private" ? paths.privatePages : paths.pages,
          safePageId,
        ),
        path.join(paths.pages, safePageId),
        path.join(paths.privatePages, safePageId),
      ]);
      const attachmentDirs = unique([
        path.join(paths.attachments, safePageId),
        path.join(paths.privateAttachments, safePageId),
      ]);

      for (const pageDir of pageDirs) {
        if (await fs.pathExists(pageDir)) {
          const bucket = pageDir.startsWith(paths.privatePages)
            ? "private-pages"
            : "shared-pages";
          await fs
            .copy(pageDir, path.join(deletedRoot, bucket, safePageId), {
              overwrite: true,
            })
            .catch(() => undefined);
        }
      }
      for (const attachmentDir of attachmentDirs) {
        if (await fs.pathExists(attachmentDir)) {
          const bucket = attachmentDir.startsWith(paths.privateAttachments)
            ? "private-attachments"
            : "attachments";
          await fs
            .copy(attachmentDir, path.join(deletedRoot, bucket, safePageId), {
              overwrite: true,
            })
            .catch(() => undefined);
        }
      }

      for (const pageDir of pageDirs) {
        await fs.remove(pageDir).catch(() => undefined);
      }
      for (const attachmentDir of attachmentDirs) {
        await fs.remove(attachmentDir).catch(() => undefined);
      }
      await fs.remove(this.lockPath(pageId)).catch(() => undefined);
      await this.removeDatabaseChildReferencesAndRefreshIndex(pageId);
      this.db.prepare(`DELETE FROM pages WHERE id=?`).run(pageId);
    }
    for (const pageId of ids) {
      deletePageFts(this.db, pageId);
      this.db
        .prepare("DELETE FROM page_search_index WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM page_search_fts WHERE page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM workspace_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM broken_link_index WHERE source_page_id = ?")
        .run(pageId);
      this.db
        .prepare("DELETE FROM attachment_index WHERE page_id = ?")
        .run(pageId);
    }
    return { ok: true, deletedIds: ids };
  }

  async emptyTrash(): Promise<{
    ok: true;
    deletedIds: string[];
    failedIds: string[];
  }> {
    const trashed = await this.listTrash();
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    for (const page of trashed) {
      if (!this.getPage(page.id)) continue;
      try {
        const result = await this.deletePagePermanently(page.id);
        deletedIds.push(...result.deletedIds);
      } catch {
        failedIds.push(page.id);
      }
    }
    if (failedIds.length > 0 && deletedIds.length === 0) {
      throw new Error(
        `ゴミ箱を空にできませんでした。削除できないページ: ${failedIds.length}件`,
      );
    }
    return {
      ok: true,
      deletedIds: Array.from(new Set(deletedIds)),
      failedIds: Array.from(new Set(failedIds)),
    };
  }

  async savePage(input: {
    id: string;
    title: string;
    markdown: string;
    blocksuite: unknown;
    baseUpdatedAt?: string;
    properties?: PageProperties;
    icon?: string | null;
    scope?: "private" | "shared";
    /** History is a checkpoint, not a side-effect of every autosave. */
    historyReason?: PageHistoryReason;
  }): Promise<PageBundle> {
    const current = this.getPage(input.id);
    if (!current) throw new Error("Page not found");
    // v397: Opening a document no longer takes a long-lived hard editor lock.
    // SMB/Windows shares can acknowledge an exclusive lock file but expose it
    // inconsistently to the same Electron process, which made brand-new pages
    // appear read-only.  Page writes are protected by the persisted
    // baseUpdatedAt check below and commit-based atomic writes instead.
    const sharedMeta = await this.readSharedMeta(input.id);
    if (
      input.baseUpdatedAt &&
      sharedMeta &&
      sharedMeta.updatedAt !== input.baseUpdatedAt
    ) {
      await this.writeConflictBundle(
        {
          meta: {
            ...current.meta,
            title: input.title,
            updatedAt: new Date().toISOString(),
            updatedBy: this.userLabel(),
            properties: normalizeProperties(
              input.properties ?? current.meta.properties,
            ),
            scope: input.scope ?? current.meta.scope,
          },
          markdown: input.markdown,
          blocksuite: input.blocksuite ?? EMPTY_BLOCKSUITE,
        },
        `共有フォルダ側の更新日時が編集中に変更されました。shared=${sharedMeta.updatedAt}, base=${input.baseUpdatedAt}`,
      );
      throw new Error(
        "競合を検出しました。あなたの編集内容は conflicts フォルダに退避しました。共有フォルダから再読み込みしてください。",
      );
    }
    // Do not rewrite a page, bump updatedAt, or create a history snapshot
    // when the request is identical to the persisted bundle.
    const historyReason =
      input.historyReason ??
      (pageMetadataChanged(current, input) ? "metadata_changed" : undefined);
    if (pageSaveMatchesCurrent(current, input)) {
      // Cmd/Ctrl+S can intentionally create a named checkpoint even when
      // autosave has already persisted the current content.  Deduplicate
      // against the latest checkpoint so repeated shortcuts do not flood history.
      if (historyReason)
        await this.pageHistoryService.backup(current, historyReason, {
          deduplicate: true,
        });
      return current;
    }

    // Autosave persists the latest document without creating a history entry.
    // A history snapshot is only made for an explicit checkpoint or a page-level
    // metadata change, so one-character edits do not flood the history list.
    const meta: PageMeta = {
      ...current.meta,
      title: input.title,
      icon: input.icon ?? current.meta.icon ?? "📄",
      updatedAt: new Date().toISOString(),
      updatedBy: this.userLabel(),
      properties: normalizeProperties(
        input.properties ?? current.meta.properties,
      ),
      scope: input.scope ?? current.meta.scope,
    };
    const bundle: PageBundle = {
      meta,
      markdown: input.markdown,
      blocksuite: input.blocksuite ?? EMPTY_BLOCKSUITE,
    };
    await this.writeBundle(bundle);
    this.db
      .prepare(
        `UPDATE pages SET title=?, icon=?, updated_at=?, updated_by=?, markdown=?, blocksuite_json=?, properties_json=? WHERE id=?`,
      )
      .run(
        meta.title,
        meta.icon,
        meta.updatedAt,
        meta.updatedBy,
        bundle.markdown,
        JSON.stringify(bundle.blocksuite),
        JSON.stringify(propertiesForStorage(meta.properties, meta.scope)),
        meta.id,
      );
    upsertPageFts(this.db, {
      id: meta.id,
      title: meta.title,
      markdown: bundle.markdown,
      trashed: meta.trashed ? 1 : 0,
    });
    this.upsertPageDerivedIndexes(bundle);

    // A DB-row child page stores its display title in the row body as well as
    // in page metadata.  Keep that generated notation in sync after a rename.
    // The sidebar child list already reads page metadata, so without this step
    // only the body could show a stale title.
    if (current.meta.title !== meta.title && this.isDatabaseRowParentId(meta.parentId)) {
      const parentMatch = /^database-row:([^:]+):(.+)$/.exec(meta.parentId || "");
      if (parentMatch) {
        const [, databaseId, rowId] = parentMatch;
        try {
          const scope = meta.scope === "private" ? "private" : "shared";
          const result = await this.databaseRowContentService().updateChildPageReferenceTitle(
            meta.id,
            meta.title,
            { databaseId, rowId, scope },
          );
          if (result.updated) {
            const database = await this.getDatabase(databaseId);
            const row = database?.rows.find((item) => item.id === rowId);
            if (database && row) {
              const rowContent = await this.getDatabaseRowContent(databaseId, rowId, {
                title: databaseRowTitle(database, row),
                scope,
              });
              this.upsertDatabaseRowLinkIndex(
                database,
                rowContent,
                databaseRowTitle(database, row),
              );
            }
          }
        } catch (error) {
          // A page rename must remain durable even if an optional DB-row body
          // cannot be refreshed immediately.  The child page relationship is
          // still intact and the next normal row save will rebuild its index.
          console.warn("DATABASE_CHILD_PAGE_TITLE_SYNC_FAILED", meta.id, error);
        }
      }
    }
    // Checkpoints represent the saved version itself, not the state before a
    // save. This makes manual saves intuitive to preview and restore.
    if (historyReason)
      await this.pageHistoryService.backup(bundle, historyReason, {
        deduplicate: true,
      });
    return bundle;
  }

  async search(query: string): Promise<PageWithLock[]> {
    if (!query.trim()) return this.listPages();
    const safeQuery = query
      .trim()
      .split(/\s+/)
      .map((term) => `${term.replace(/[\"']/g, "")}*`)
      .join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT p.id,p.title,p.parent_id as parentId,p.icon,p.created_at as createdAt,p.updated_at as updatedAt,p.updated_by as updatedBy,p.sort_order as sortOrder,p.favorite as favorite,p.trashed,p.properties_json as propertiesJson,substr(replace(replace(p.markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM page_fts f JOIN pages p ON p.id=f.id WHERE page_fts MATCH ? LIMIT 50`,
      )
      .all(safeQuery) as any[];
    return Promise.all(
      rows.map(async (r) =>
        this.withLock({ ...r, trashed: Boolean(r.trashed) }),
      ),
    );
  }

  async listBacklinks(pageId: string): Promise<BacklinkInfo[]> {
    const target = this.getPage(pageId);
    if (!target) throw new Error("Page not found");

    const rows = this.db
      .prepare(
        `
      SELECT source_type as sourceType, source_page_id as sourcePageId, source_database_id as sourceDatabaseId,
             source_row_id as sourceRowId, source_title as sourceTitle, source_icon as sourceIcon, snippet, updated_at as updatedAt
      FROM workspace_link_index
      WHERE target_page_id = ?
      ORDER BY updated_at DESC
      LIMIT 200
    `,
      )
      .all(pageId) as any[];

    // Never rebuild the complete workspace index while a page is opening.
    // A missing index yields an empty list and can be rebuilt explicitly from settings.

    const unique = new Map<string, BacklinkInfo>();
    for (const row of rows) {
      const sourceType = row.sourceType === "database-row" ? "database-row" : "page";
      const sourceKey = sourceType === "database-row"
        ? `database-row:${row.sourceDatabaseId || ""}:${row.sourceRowId || ""}`
        : `page:${row.sourcePageId || ""}`;
      // One source can contain several representations of the same link
      // (BlockNote JSON + generated Markdown).  The UI should show one backlink.
      if (unique.has(sourceKey)) continue;
      unique.set(sourceKey, {
        sourceType,
        sourcePageId: row.sourcePageId || undefined,
        sourceDatabaseId: row.sourceDatabaseId || undefined,
        sourceRowId: row.sourceRowId || undefined,
        sourceTitle: row.sourceTitle || "Untitled",
        sourceIcon: row.sourceIcon || (sourceType === "database-row" ? "🧾" : "📄"),
        snippet: row.snippet || "",
        updatedAt: row.updatedAt || "",
      });
    }
    return Array.from(unique.values());
  }

  async acquireLock(pageId: string): Promise<LockInfo> {
    const lockFile = this.lockPath(pageId);
    return withResourceMutex(`page-editor:${lockFile}`, async () => {
      await fs.ensureDir(vaultPaths(this.sharedRoot).locks);
      const existing = await this.getLock(pageId);
      if (lockMatchesCurrentProcess(existing, this.appInstanceId))
        return this.extendOwnedPageLock(lockFile, existing!);
      if (lockIsActive(existing)) throw this.pageLockedError(existing);

      const lock = this.createPageLock(pageId);
      try {
        await this.createExclusiveLock(lockFile, lock);
        return lock;
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
        const winner = await this.getLock(pageId);
        if (lockMatchesCurrentProcess(winner, this.appInstanceId))
          return winner!;
        if (lockIsActive(winner)) throw this.pageLockedError(winner);
        // An EEXIST file without valid JSON can be a failed or interrupted old
        // lease.  It is safe to recover only while this API process serializes
        // all operations for this exact resource.
        await fs.remove(lockFile).catch(() => undefined);
        const retry = this.createPageLock(pageId);
        await this.createExclusiveLock(lockFile, retry);
        return retry;
      }
    });
  }

  async renewLock(pageId: string): Promise<LockInfo> {
    const lockFile = this.lockPath(pageId);
    return withResourceMutex(`page-editor:${lockFile}`, async () => {
      await fs.ensureDir(vaultPaths(this.sharedRoot).locks);
      const existing = await this.getLock(pageId);
      if (!existing)
        throw new Error("Page editor lock was lost. Reopen the page to edit.");
      if (!lockMatchesCurrentProcess(existing, this.appInstanceId))
        throw this.pageLockedError(existing);
      return this.extendOwnedPageLock(lockFile, existing);
    });
  }

  async releaseLock(pageId: string): Promise<void> {
    const lockFile = this.lockPath(pageId);
    return withResourceMutex(`page-editor:${lockFile}`, async () => {
      const lock = await this.getLock(pageId);
      if (
        !lock ||
        lockMatchesCurrentProcess(lock, this.appInstanceId) ||
        !lockIsActive(lock)
      ) {
        await fs.remove(lockFile).catch(() => undefined);
        await fs.remove(this.legacyLockPath(pageId)).catch(() => undefined);
      }
    });
  }

  async getLock(pageId: string): Promise<LockInfo | null> {
    const canonical = this.lockPath(pageId);
    const legacy = this.legacyLockPath(pageId);
    for (const lockFile of Array.from(new Set([canonical, legacy]))) {
      if (!(await fs.pathExists(lockFile))) continue;
      const lock = await this.readLockJsonWithRetry(lockFile);
      if (!lock) continue;
      // Never let a stale/colliding legacy filename lock a different page.
      // The previous filename scheme lower-cased IDs and was unsafe on SMB/Windows.
      if (!lockTargetsResource(lock, "page", pageId)) continue;
      if (!lockIsActive(lock) || this.isOrphanedLocalLock(lock)) {
        await fs.remove(lockFile).catch(() => undefined);
        continue;
      }
      return lock;
    }
    return null;
  }

  private async readLockJsonWithRetry(
    lockFile: string,
  ): Promise<LockInfo | null> {
    // The initial O_EXCL create and the JSON write are separate filesystem
    // operations.  On SMB a second reader can observe the file in-between;
    // wait briefly instead of treating our own in-flight lock as malformed.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const lock = (await fs
        .readJson(lockFile)
        .catch(() => null)) as LockInfo | null;
      if (lock) return lock;
      if (!(await fs.pathExists(lockFile))) return null;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  private createPageLock(pageId: string): LockInfo {
    const now = Date.now();
    return {
      pageId,
      lockedBy: os.hostname(),
      userName: os.userInfo().username,
      appInstanceId: this.appInstanceId,
      processId: process.pid,
      leaseId: nanoid(12),
      lockedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
    };
  }

  private pageLockedError(lock: LockInfo): Error {
    return new Error(`Locked by ${lock.userName} / ${lock.lockedBy}`);
  }

  private async createExclusiveLock(
    lockFile: string,
    lock: LockInfo,
  ): Promise<void> {
    const handle = await nodeFs.open(lockFile, "wx");
    try {
      await handle.writeFile(JSON.stringify(lock, null, 2), "utf8");
    } finally {
      await handle.close();
    }
  }

  private async extendOwnedPageLock(
    lockFile: string,
    expected: LockInfo,
  ): Promise<LockInfo> {
    const current = (await fs
      .readJson(lockFile)
      .catch(() => null)) as LockInfo | null;
    if (
      !current ||
      !lockMatchesCurrentProcess(current, this.appInstanceId) ||
      (expected.leaseId &&
        current.leaseId &&
        expected.leaseId !== current.leaseId)
    ) {
      throw new Error(
        "Page editor lock was replaced. Reopen the page to edit.",
      );
    }
    const renewed: LockInfo = {
      ...current,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    await this.atomicWriteJson(lockFile, renewed);
    return renewed;
  }

  private isOrphanedLocalLock(lock: LockInfo): boolean {
    if (
      !lockBelongsToCurrentHostUser(lock, os.hostname(), os.userInfo().username)
    )
      return false;
    // A lock written by an earlier API session in this very Electron process is
    // never another editor. This can occur after a renderer/API restart while
    // the process itself remains alive, so process.kill(pid, 0) alone is not
    // sufficient to distinguish it.
    if (
      lock.appInstanceId !== this.appInstanceId &&
      Number(lock.processId) === process.pid
    )
      return true;
    // v392 and older have no PID. Electron's same-user single-instance guard
    // means a legacy lease from this host/user is a leftover, not another editor.
    if (!Number.isInteger(lock.processId) || (lock.processId as number) <= 0) {
      const lockedAt = Date.parse(lock.lockedAt || "");
      return !Number.isFinite(lockedAt) || lockedAt < this.appStartedAt;
    }
    try {
      process.kill(lock.processId as number, 0);
      return false;
    } catch (error: any) {
      return error?.code === "ESRCH";
    }
  }

  /** Attachment I/O is implemented in AttachmentService; keep this public facade stable. */
  async listAttachments(pageId: string): Promise<AttachmentInfo[]> {
    return this.attachmentService.listAttachments(pageId);
  }

  async addAttachment(
    pageId: string,
    sourcePath: string,
  ): Promise<AttachmentInfo> {
    return this.attachmentService.addAttachment(pageId, sourcePath);
  }

  async addAttachmentFromBase64(
    pageId: string,
    fileName: string,
    base64: string,
  ): Promise<AttachmentInfo> {
    return this.attachmentService.addAttachmentFromBase64(
      pageId,
      fileName,
      base64,
    );
  }

  async getAttachmentInfo(
    pageId: string,
    attachmentId: string,
  ): Promise<AttachmentInfo> {
    return this.attachmentService.getAttachmentInfo(pageId, attachmentId);
  }

  async getAttachmentFilePath(
    pageId: string,
    attachmentId: string,
  ): Promise<string> {
    return this.attachmentService.getAttachmentFilePath(pageId, attachmentId);
  }

  async listHistory(pageId: string): Promise<HistoryEntry[]> {
    return this.pageHistoryService.list(pageId);
  }

  async getHistoryBundle(
    pageId: string,
    historyId: string,
  ): Promise<PageBundle> {
    return this.pageHistoryService.getBundle(pageId, historyId);
  }

  async diffHistory(
    pageId: string,
    historyId: string,
  ): Promise<HistoryDiffResult> {
    const current = this.getPage(pageId);
    if (!current) throw new Error("Page not found");
    const history = await this.getHistoryBundle(pageId, historyId);
    const diff = this.pageHistoryService.diff(
      history.markdown,
      current.markdown,
    );
    return {
      pageId,
      historyId,
      historyCreatedAt: history.meta.updatedAt,
      currentUpdatedAt: current.meta.updatedAt,
      addedCount: diff.addedCount,
      removedCount: diff.removedCount,
      lines: diff.lines,
    };
  }

  /**
   * Derives Wiki update notifications from existing page history. No additional
   * persistence is created: verified pages are compared with their latest
   * meaningful checkpoint (or the checkpoint before it when the latest equals
   * the current version).
   */
  async listWikiUpdateDigests(limit = 30): Promise<WikiUpdateDigest[]> {
    const pages = (await this.listPages({ includeLocks: false }))
      .filter(
        (page) => !page.trashed && page.properties?.wikiStatus === "verified",
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(120, Number(limit) || 30)));
    const digests: WikiUpdateDigest[] = [];
    for (const page of pages) {
      const current = this.getPage(page.id);
      if (!current) continue;
      const histories = await this.listHistory(page.id);
      if (!histories.length) continue;
      const latest = histories[0];
      let baselineEntry = latest;
      // A metadata checkpoint is usually a snapshot of the current state.
      // In that case compare against the preceding history so the notification
      // describes the actual update that led to the current formal version.
      if (latest.createdAt >= current.meta.updatedAt && histories[1])
        baselineEntry = histories[1];
      const baseline = await this.getHistoryBundle(
        page.id,
        baselineEntry.id,
      ).catch(() => null);
      if (!baseline) continue;
      const diff = this.pageHistoryService.diff(
        baseline.markdown,
        current.markdown,
      );
      const metaChanged =
        baseline.meta.title !== current.meta.title ||
        JSON.stringify(baseline.meta.properties || {}) !==
          JSON.stringify(current.meta.properties || {});
      if (!diff.addedCount && !diff.removedCount && !metaChanged) continue;
      const added = diff.lines
        .filter((line) => line.type === "added" && line.text.trim())
        .map((line) => line.text.trim());
      const removed = diff.lines
        .filter((line) => line.type === "removed" && line.text.trim())
        .map((line) => line.text.trim());
      const summary = [
        ...added.slice(0, 3).map((text) => `追加：${text.slice(0, 90)}`),
        ...removed
          .slice(0, 2)
          .map((text) => `削除・変更：${text.slice(0, 90)}`),
      ];
      if (metaChanged && !summary.length)
        summary.push("ページのWiki情報またはタイトルが更新されました。");
      digests.push({
        pageId: page.id,
        title: current.meta.title,
        icon: current.meta.icon,
        updatedAt: current.meta.updatedAt,
        baselineCreatedAt: baselineEntry.createdAt,
        addedCount: diff.addedCount,
        removedCount: diff.removedCount,
        summary: summary.length
          ? summary
          : ["本文の構成または書式が更新されました。"],
        changed: true,
      });
    }
    return digests
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(30, Number(limit) || 30)));
  }

  async restoreHistory(pageId: string, historyId: string): Promise<PageBundle> {
    const backupDir = path.join(
      vaultPaths(this.sharedRoot).backups,
      sanitizeSegment(pageId),
      sanitizeSegment(historyId),
    );
    const metaPath = path.join(backupDir, "meta.json");
    if (!(await fs.pathExists(metaPath)))
      throw new Error("履歴が見つかりません。");
    const current = this.getPage(pageId);
    if (current) await this.backupPage(current, "restore_before");
    const meta = normalizeMeta(await fs.readJson(metaPath), pageId);
    const markdown = await fs
      .readFile(path.join(backupDir, "content.md"), "utf8")
      .catch(() => "");
    const blocksuite = await fs
      .readJson(path.join(backupDir, "blocksuite.json"))
      .catch(() => EMPTY_BLOCKSUITE);
    const restored: PageBundle = {
      meta: {
        ...meta,
        id: pageId,
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      },
      markdown,
      blocksuite,
    };
    await this.writeBundle(restored);
    this.db
      .prepare(
        `UPDATE pages SET title=?, parent_id=?, icon=?, updated_at=?, updated_by=?, sort_order=?, trashed=?, markdown=?, blocksuite_json=?, properties_json=? WHERE id=?`,
      )
      .run(
        restored.meta.title,
        restored.meta.parentId,
        restored.meta.icon,
        restored.meta.updatedAt,
        restored.meta.updatedBy,
        restored.meta.sortOrder,
        restored.meta.trashed ? 1 : 0,
        restored.markdown,
        JSON.stringify(restored.blocksuite),
        JSON.stringify(restored.meta.properties),
        pageId,
      );
    upsertPageFts(this.db, {
      id: restored.meta.id,
      title: restored.meta.title,
      markdown: restored.markdown,
      trashed: restored.meta.trashed ? 1 : 0,
    });
    this.upsertPageDerivedIndexes(restored);
    return restored;
  }

  async listBackupCenter(): Promise<any[]> {
    const root = vaultPaths(this.sharedRoot).backups;
    const exists = await fs.pathExists(root).catch(() => false);
    if (!exists) return [];
    const out: any[] = [];
    const entries = await fs.readdir(root).catch(() => []);
    for (const entry of entries) {
      const full = path.join(root, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;

      if (entry.startsWith("deleted_database_")) {
        const files = (await fs.readdir(full).catch(() => [])).filter((name) =>
          name.endsWith(".json"),
        );
        out.push({
          id: entry,
          type: "deleted_database",
          title: files[0]?.replace(/\.json$/, "") || entry,
          createdAt: stat.mtime.toISOString(),
          size: await this.directorySize(full),
          restoreable: files.length > 0,
          path: entry,
        });
        continue;
      }

      if (entry.startsWith("deleted_journal_")) {
        out.push({
          id: entry,
          type: "deleted_journal",
          title: entry.replace(/^deleted_journal_/, "").replace(/_\d.*$/, ""),
          createdAt: stat.mtime.toISOString(),
          size: await this.directorySize(full),
          restoreable: await fs
            .pathExists(path.join(full, "journal.json"))
            .catch(() => false),
          path: entry,
        });
        continue;
      }

      if (entry.startsWith("deleted_")) {
        const pagesDir = path.join(full, "pages");
        const pageIds = await fs.readdir(pagesDir).catch(() => []);
        let title = entry;
        if (pageIds[0]) {
          const meta = await fs
            .readJson(path.join(pagesDir, pageIds[0], "meta.json"))
            .catch(() => null);
          title = meta?.title || pageIds[0];
        }
        out.push({
          id: entry,
          type: "deleted_page",
          title,
          createdAt: stat.mtime.toISOString(),
          count: pageIds.length,
          size: await this.directorySize(full),
          restoreable: pageIds.length > 0,
          path: entry,
        });
        continue;
      }

      const nested = await fs.readdir(full).catch(() => []);
      for (const historyId of nested) {
        const hdir = path.join(full, historyId);
        const hstat = await fs.stat(hdir).catch(() => null);
        if (!hstat || !hstat.isDirectory()) continue;
        const meta = await fs
          .readJson(path.join(hdir, "meta.json"))
          .catch(() => null);
        if (!meta) continue;
        out.push({
          id: `${entry}/${historyId}`,
          type: "page_history",
          title: meta.title || entry,
          pageId: entry,
          historyId,
          createdAt: meta.backupCreatedAt || hstat.mtime.toISOString(),
          updatedBy: meta.backupCreatedBy || meta.updatedBy,
          size: await this.directorySize(hdir),
          restoreable: true,
          path: `${entry}/${historyId}`,
        });
      }
    }
    return out.sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );
  }

  async restoreBackupCenterItem(
    id: string,
  ): Promise<{ ok: true; id: string; type: string }> {
    const root = vaultPaths(this.sharedRoot).backups;
    const safeId = id.split("/").map(sanitizeSegment).join("/");
    const full = path.join(root, safeId);
    if (!(await fs.pathExists(full).catch(() => false)))
      throw new Error("Backup not found");

    if (safeId.includes("/")) {
      const [pageId, historyId] = safeId.split("/");
      await this.restoreHistory(pageId, historyId);
      return { ok: true, id, type: "page_history" };
    }

    if (safeId.startsWith("deleted_database_")) {
      const files = (await fs.readdir(full).catch(() => [])).filter((name) =>
        name.endsWith(".json"),
      );
      if (!files[0]) throw new Error("Database backup file not found");
      const dbId = files[0].replace(/\.json$/, "");
      await fs.copy(path.join(full, files[0]), this.databasePath(dbId), {
        overwrite: true,
      });
      return { ok: true, id, type: "deleted_database" };
    }

    if (safeId.startsWith("deleted_journal_")) {
      const sourceFile = path.join(full, "journal.json");
      const source = await fs.readJson(sourceFile).catch(() => null);
      if (!source || typeof source !== "object") {
        throw new Error("Journal backup file not found");
      }

      const fallbackDate = safeId
        .replace(/^deleted_journal_/, "")
        .slice(0, 10);
      const journal = this.normalizeJournal(source, fallbackDate);
      const dest = this.journalDir(journal.date);

      // Restore the complete Journal directory, not only journal.json. This keeps
      // the restore path forward-compatible with Journal-local assets and metadata.
      await fs.ensureDir(dest);
      await fs.copy(full, dest, { overwrite: true, errorOnExist: false });
      await this.atomicWriteJson(path.join(dest, "journal.json"), journal);

      // listJournals() intentionally prefers the lightweight SQLite index once it
      // exists. Rebuild the affected entries immediately so a restored Journal is
      // visible in the Journal list, task view and work-home dashboard without a
      // manual resync or a full index rebuild.
      this.upsertJournalSummaryIndex(journal);
      this.upsertTaskIndexForSource(
        "journal",
        journal.date,
        journal.title,
        journal.icon,
        journal.updatedAt,
        journal.markdown || "",
      );
      await this.updateWorkspaceSummaryCache();

      return { ok: true, id, type: "deleted_journal" };
    }

    if (safeId.startsWith("deleted_")) {
      const pagesDir = path.join(full, "pages");
      const attachmentsDir = path.join(full, "attachments");
      const pageIds = await fs.readdir(pagesDir).catch(() => []);
      for (const pageId of pageIds) {
        await fs.copy(
          path.join(pagesDir, pageId),
          path.join(vaultPaths(this.sharedRoot).pages, pageId),
          { overwrite: true },
        );
      }
      if (await fs.pathExists(attachmentsDir).catch(() => false)) {
        const attachmentPageIds = await fs
          .readdir(attachmentsDir)
          .catch(() => []);
        for (const pageId of attachmentPageIds) {
          await fs.copy(
            path.join(attachmentsDir, pageId),
            path.join(vaultPaths(this.sharedRoot).attachments, pageId),
            { overwrite: true },
          );
        }
      }
      await this.importFromShared();
      return { ok: true, id, type: "deleted_page" };
    }

    throw new Error("Unsupported backup type");
  }

  private async directorySize(dir: string): Promise<number> {
    let total = 0;
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) total += await this.directorySize(full);
      else total += stat.size;
    }
    return total;
  }

  async listAllAttachments(): Promise<any[]> {
    const rows = this.db
      .prepare(
        `
      SELECT page_id as pageId, attachment_id as id, file_name as fileName, mime_type as mimeType, size, created_at as createdAt,
             relative_path as relativePath, page_title as pageTitle, page_icon as pageIcon, page_updated_at as pageUpdatedAt
      FROM attachment_index
      ORDER BY created_at DESC
      LIMIT 5000
    `,
      )
      .all() as any[];
    if (rows.length > 0) return rows;
    await this.rebuildAttachmentIndex().catch(() => 0);
    return this.db
      .prepare(
        `
      SELECT page_id as pageId, attachment_id as id, file_name as fileName, mime_type as mimeType, size, created_at as createdAt,
             relative_path as relativePath, page_title as pageTitle, page_icon as pageIcon, page_updated_at as pageUpdatedAt
      FROM attachment_index
      ORDER BY created_at DESC
      LIMIT 5000
    `,
      )
      .all() as any[];
  }

  async listBrokenLinks(): Promise<any[]> {
    // Do not prefer a cached broken-link table over live graph rows. A target can
    // be moved to Trash after the source was indexed, and that relationship must
    // appear immediately even when unrelated cached broken links already exist.
    const rows = this.db
      .prepare(
        `
      SELECT source_page_id as sourcePageId, source_title as sourceTitle, source_icon as sourceIcon,
             target_id as targetId, snippet, updated_at as updatedAt
      FROM broken_link_index
      UNION ALL
      SELECT source_page_id as sourcePageId, source_title as sourceTitle, source_icon as sourceIcon,
             target_page_id as targetId, snippet, updated_at as updatedAt
      FROM workspace_link_index
      WHERE target_type = 'page'
        AND target_page_id <> ''
        AND target_page_id NOT IN (SELECT id FROM pages WHERE trashed = 0)
      ORDER BY updatedAt DESC
      LIMIT 1000
    `,
      )
      .all() as any[];

    const unique = new Map<string, any>();
    for (const row of rows) {
      const key = `${row.sourcePageId || ''}:${row.targetId || ''}:${row.snippet || ''}`;
      if (!unique.has(key)) unique.set(key, row);
    }
    return Array.from(unique.values());
  }

  async closeAnalysisNotebook(): Promise<void> { await this.analysisNotebookService.close(); }

  async getAnalysisStatus() { return this.analysisNotebookService.status(); }

  async syncAnalysisData() { return this.analysisNotebookService.sync(); }

  async queryAnalysis(sql: string, parameters: any[] = [], namedResults: any[] = []) { return this.analysisNotebookService.query(sql, parameters, namedResults); }
  getAnalysisResultPage(resultId: string, page = 0, pageSize = 500) { return this.analysisNotebookService.getResultPage(resultId, page, pageSize); }
  getAnalysisResultAll(resultId: string) { return this.analysisNotebookService.getResultAll(resultId); }

  async generateAnalysisAiDraft(input: any): Promise<any> {
    const instruction = String(input?.instruction || '').replace(/\r\n/g, '\n').trim();
    if (!instruction) return { ok: false, generated: false, message: '作りたい分析を文章で入力してください。' };
    if (instruction.length > 1_500) return { ok: false, generated: false, message: '指示は1,500文字以内にしてください。' };

    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== 'llama-cpp' || !check?.ok) {
      return { ok: false, generated: false, message: check?.message || 'ローカル生成AIが有効になっていません。生成AI設定を確認してください。' };
    }

    const dictionary = this.getAnalysisDataDictionary();
    const schema = dictionary.datasets.map((dataset: any) => {
      const columns = (dataset.columns || []).slice(0, 60).map((column: any) => `${column.name} (${column.type}: ${column.description || ''})`).join(', ');
      return `- ${dataset.name}: ${dataset.description || ''}\n  columns: ${columns}`;
    }).join('\n');
    const prompt = [
      'あなたはローカル業務分析ノートブック専用AIです。利用者の日本語の希望から、DuckDBで実行可能な読み取り専用SQLと初心者向けのグラフ設定を提案します。',
      '必ず次のJSONオブジェクトだけを返してください。Markdown、説明文、コードブロックは不要です。',
      '{"title":"短い分析名","description":"分析の目的","sql":"SELECT または WITH で始まる1文のSQL","chart":{"type":"table|bar|line|dot|area|histogram|box|heatmap","x":"列名または空文字","y":"列名または空文字"},"explanation":"何を確認する分析か","warnings":["確認事項"]}',
      'SQLは必ずSELECTまたはWITHで始め、1文だけにしてください。INSERT/UPDATE/DELETE/CREATE/DROP/EXPORT/IMPORT/PRAGMAは絶対に使わないでください。',
      '下のデータ辞書にあるテーブル名・列名だけを使用してください。テーブル名と列名は必ず二重引用符で囲んでください。列名を推測しないでください。データにない情報は作らないでください。',
      'グラフは、時系列はline、分類比較はbar、数値2列の関係はdot、分布はhistogramを基本に選んでください。不要ならtableにしてください。',
      '利用者は分析初心者です。explanationとwarningsは簡潔な日本語にしてください。',
      `【データ辞書】\n${schema}`,
      `【利用者の依頼】\n${instruction}`,
      '【JSON】',
    ].join('\n\n');

    try {
      const generated = await this.runLlamaGeneration(prompt, {
        ...settings,
        maxTokens: Math.max(256, Math.min(900, Number(settings.maxTokens || 512))),
        contextSize: Math.max(2048, Math.min(6144, Number(settings.contextSize || 4096))),
        temperature: Math.max(0, Math.min(0.25, Number(settings.temperature ?? 0.1))),
      } as any, check);
      const raw = String(this.cleanLlamaGeneratedText(generated.text, prompt) || generated.text || '').trim()
        .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('AIが分析案のJSONを返しませんでした。もう一度お試しください。');
      const parsed = JSON.parse(match[0]);
      const candidateSql = String(parsed.sql || '');
      const allowedChartTypes = new Set(['table', 'bar', 'line', 'dot', 'area', 'histogram', 'box', 'heatmap']);
      const chartType = allowedChartTypes.has(String(parsed?.chart?.type || '')) ? String(parsed.chart.type) : 'table';
      const chart = { type: chartType, x: String(parsed?.chart?.x || ''), y: String(parsed?.chart?.y || '') };
      const validation = await this.analysisNotebookService.validateAiDraft(candidateSql, chart);
      const sql = validation.sql;
      return {
        ok: true,
        generated: true,
        elapsedMs: generated.elapsedMs,
        draft: {
          title: String(parsed.title || 'AI分析案').slice(0, 120),
          description: String(parsed.description || '').slice(0, 1000),
          sql,
          chart,
          explanation: String(parsed.explanation || '').slice(0, 2000),
          warnings: [...(Array.isArray(parsed.warnings) ? parsed.warnings.map((value: any) => String(value).slice(0, 300)).slice(0, 6) : []), ...validation.warnings].slice(0, 8),
          validation: { columns: validation.columns, checkedAt: new Date().toISOString() },
        },
      };
    } catch (error: any) {
      return { ok: false, generated: false, message: String(error?.message || 'AIによる分析コードの作成に失敗しました。') };
    }
  }

  getAnalysisDataDictionary() { return this.analysisNotebookService.getDataDictionary(); }

  getAnalysisWorkspaceSettings() { return this.analysisNotebookService.getWorkspaceSettings(); }

  saveAnalysisWorkspaceSettings(input: any) { return this.analysisNotebookService.saveWorkspaceSettings(input); }

  listAnalysisNotebooks() { return this.analysisNotebookService.listNotebooks(); }

  getAnalysisNotebook(id: string) { return this.analysisNotebookService.getNotebook(id); }

  saveAnalysisNotebook(input: any) { return this.analysisNotebookService.saveNotebook(input); }

  deleteAnalysisNotebook(id: string) { return this.analysisNotebookService.deleteNotebook(id); }

  listAnalysisDashboardPins() { return this.analysisNotebookService.listDashboardPins(); }
  saveAnalysisDashboardPin(input: any) { return this.analysisNotebookService.saveDashboardPin(input); }
  deleteAnalysisDashboardPin(id: string) { return this.analysisNotebookService.deleteDashboardPin(id); }

  async getWorkspaceDashboard(): Promise<any> {
    const cached = this.db
      .prepare(
        "SELECT value_json as valueJson FROM workspace_summary_cache WHERE cache_key = ?",
      )
      .get("dashboard") as any;
    if (cached?.valueJson) {
      try {
        const parsed = JSON.parse(cached.valueJson);
        // v562 adds lightweight database recents for the work home. Older cache
        // records are refreshed once instead of leaving the new panel empty.
        if (Array.isArray(parsed?.recentDatabases)) return parsed;
      } catch {}
    }

    await this.updateWorkspaceSummaryCache().catch(() => undefined);
    const fresh = this.db
      .prepare(
        "SELECT value_json as valueJson FROM workspace_summary_cache WHERE cache_key = ?",
      )
      .get("dashboard") as any;
    if (fresh?.valueJson) {
      try {
        return JSON.parse(fresh.valueJson);
      } catch {}
    }

    const [
      pages,
      databases,
      journals,
      inboxItems,
      tasks,
      attachments,
      conflicts,
    ] = await Promise.all([
      this.listPages({ includeLocks: false }),
      this.listDatabases(),
      this.listJournals().catch(() => []),
      this.listInboxItems().catch(() => []),
      this.listTasks().catch(() => []),
      this.listAllAttachments().catch(() => []),
      this.listConflicts().catch(() => []),
    ]);
    const visiblePages = pages.filter((page) => !page.trashed);
    const recentDatabases = databases
      .filter((database: any) => !database.trashed)
      .slice()
      .sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, 6)
      .map((database: any) => ({
        id: database.id,
        title: database.title,
        scope: database.scope,
        updatedAt: database.updatedAt,
        rowCount: Array.isArray(database.rows) ? database.rows.length : 0,
        propertyCount: Array.isArray(database.properties) ? database.properties.length : 0,
        viewCount: Array.isArray(database.views) ? database.views.length : 0,
      }));
    return {
      counts: {
        pages: visiblePages.length,
        databases: databases.length,
        journals: journals.length,
        inbox: inboxItems.filter((item: any) => item.status !== "archived")
          .length,
        tasksOpen: tasks.filter((task: any) => !task.completed).length,
        attachments: attachments.length,
        conflicts: conflicts.length,
        trashed: pages.filter((page) => page.trashed).length,
      },
      recentPages: visiblePages
        .slice()
        .sort((a: any, b: any) =>
          String(b.updatedAt).localeCompare(String(a.updatedAt)),
        )
        .slice(0, 8),
      recentDatabases,
      recentJournals: journals
        .slice()
        .sort((a: any, b: any) =>
          String(b.updatedAt).localeCompare(String(a.updatedAt)),
        )
        .slice(0, 6),
      recentAttachments: attachments.slice(0, 6),
      inboxItems: inboxItems
        .filter((item: any) => item.status !== "archived")
        .slice(0, 6),
      tasks: tasks.filter((task: any) => !task.completed).slice(0, 8),
      conflicts: conflicts.slice(0, 8),
    };
  }

  async listConflicts(pageId?: string): Promise<ConflictInfo[]> {
    const root = vaultPaths(this.sharedRoot).conflicts;
    const entries = await fs.readdir(root).catch(() => []);
    const result: ConflictInfo[] = [];
    for (const entry of entries) {
      const dir = path.join(root, entry);
      const pageInfo = await fs
        .readJson(path.join(dir, "conflict.json"))
        .catch(() => null);
      const meta = (await fs
        .readJson(path.join(dir, "meta.json"))
        .catch(() => null)) as any;
      const info =
        pageInfo ??
        (meta
          ? {
              id: String(meta.id || entry),
              pageId:
                meta.pageId ||
                meta.rowId ||
                meta.databaseId ||
                `database:${meta.databaseId || "unknown"}`,
              conflictDir: path.relative(this.sharedRoot, dir),
              createdAt: String(meta.createdAt || new Date(0).toISOString()),
              createdBy: String(meta.createdBy || "unknown"),
              reason: String(meta.reason || "保存競合"),
            }
          : null);
      if (!info) continue;
      if (pageId && info.pageId !== pageId) continue;
      result.push(info as ConflictInfo);
    }
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return result;
  }

  async listDatabases(): Promise<WorkspaceDatabase[]> {
    return this.databaseWorkspaceService().listDatabases();
  }

  async listTrashedDatabases(): Promise<WorkspaceDatabase[]> {
    return this.databaseWorkspaceService().listTrashedDatabases();
  }

  async getDatabase(id: string): Promise<WorkspaceDatabase | null> {
    return this.databaseWorkspaceService().getDatabase(id);
  }

  async createDatabase(
    title = "新規データベース",
    scope: WorkspaceScope = "shared",
  ): Promise<WorkspaceDatabase> {
    return this.databaseWorkspaceService().createDatabase(title, scope);
  }

  async saveDatabase(input: WorkspaceDatabase): Promise<WorkspaceDatabase> {
    return this.databaseWorkspaceService().saveDatabase(input);
  }

  async patchDatabaseRows(
    id: string,
    input: { baseUpdatedAt?: string; patches: Array<{ rowId: string; cells: Record<string, any> }> },
  ): Promise<{ databaseId: string; rows: DatabaseRow[]; updatedAt: string; updatedBy: string }> {
    return this.patchDatabaseRowsCore(id, input);
  }

  async addDatabaseRow(id: string): Promise<WorkspaceDatabase> {
    return this.databaseWorkspaceService().addDatabaseRow(id);
  }

  async addDatabaseProperty(
    id: string,
    name: string,
    type: DatabasePropertyType,
  ): Promise<WorkspaceDatabase> {
    return this.databaseWorkspaceService().addDatabaseProperty(id, name, type);
  }

  async deleteDatabase(id: string): Promise<{ ok: true; id: string }> {
    return this.databaseWorkspaceService().deleteDatabase(id);
  }

  async restoreTrashedDatabase(id: string): Promise<WorkspaceDatabase> {
    return this.databaseWorkspaceService().restoreTrashedDatabase(id);
  }

  async deleteTrashedDatabasePermanently(
    id: string,
  ): Promise<{ ok: true; id: string }> {
    return this.databaseWorkspaceService().deleteTrashedDatabasePermanently(id);
  }

  async emptyTrashedDatabases(): Promise<{
    ok: true;
    deletedIds: string[];
    failedIds: string[];
  }> {
    return this.databaseWorkspaceService().emptyTrashedDatabases();
  }

  async rebuildDatabaseIndex(id: string): Promise<DatabasePerformanceInfo> {
    return this.databaseWorkspaceService().rebuildDatabaseIndex(id);
  }

  async getDatabasePerformance(id: string): Promise<DatabasePerformanceInfo> {
    return this.databaseWorkspaceService().getDatabasePerformance(id);
  }

  async queryDatabaseRows(
    id: string,
    input: {
      viewId?: string;
      q?: string;
      page?: number;
      pageSize?: number;
      cursor?: string;
    },
  ): Promise<DatabaseQueryResult> {
    return this.databaseWorkspaceService().queryDatabaseRows(id, input);
  }

  async aggregateDatabaseRows(
    id: string,
    input: DatabaseAggregateRequest,
  ): Promise<DatabaseAggregateResult> {
    return this.databaseWorkspaceService().aggregateDatabaseRows(id, input);
  }

  async getDatabaseRowContent(
    databaseId: string,
    rowId: string,
    options: { title?: string; scope?: WorkspaceScope } = {},
  ): Promise<DatabaseRowContent> {
    return this.databaseRowContentService().getRowContent(
      databaseId,
      rowId,
      options,
    );
  }

  async saveDatabaseRowContent(
    input: SaveDatabaseRowContentInput,
  ): Promise<DatabaseRowContent> {
    const saved = await this.databaseRowContentService().saveRowContent(input);
    try {
      const db = await this.getDatabase(input.databaseId);
      if (db) {
        const row = db.rows.find((item) => item.id === input.rowId);
        const rowTitle = row ? databaseRowTitle(db, row) : saved.title;
        this.upsertDatabaseRowLinkIndex(db, saved, rowTitle);
        this.upsertTaskIndexForSource(
          "database-row",
          this.databaseRowTaskSourceId(db.id, input.rowId),
          `${db.title} / ${rowTitle}`,
          "🧾",
          saved.updatedAt,
          saved.markdown || "",
        );
      }
    } catch (error) {
      console.warn(
        "SAVE_DB_ROW_CONTENT_INDEX_UPDATE_FAILED",
        input.databaseId,
        input.rowId,
        error,
      );
    }
    return saved;
  }

  async listDatabaseRowAttachments(databaseId: string, rowId: string, scope: WorkspaceScope = 'shared'): Promise<AttachmentInfo[]> {
    return this.databaseRowContentService().listRowAttachments(databaseId, rowId, scope === 'private' ? 'private' : 'shared');
  }

  async addDatabaseRowAttachmentFromBase64(databaseId: string, rowId: string, fileName: string, base64: string, scope: WorkspaceScope = 'shared'): Promise<AttachmentInfo> {
    return this.databaseRowContentService().addRowAttachmentFromBase64(databaseId, rowId, fileName, base64, scope === 'private' ? 'private' : 'shared');
  }

  async getDatabaseRowAttachmentFile(databaseId: string, rowId: string, attachmentId: string, scope: WorkspaceScope = 'shared'): Promise<{ info: AttachmentInfo; filePath: string }> {
    return this.databaseRowContentService().getRowAttachmentFilePath(databaseId, rowId, attachmentId, scope === 'private' ? 'private' : 'shared');
  }

  async createDatabaseRowChildPage(
    databaseId: string,
    rowId: string,
    input: { title?: string; scope?: WorkspaceScope } = {},
  ): Promise<PageBundle> {
    const db = await this.getDatabase(databaseId);
    if (!db) throw new Error("Database not found");
    const row = db.rows.find((item) => item.id === rowId);
    if (!row) throw new Error("Database row not found");
    const scope =
      input.scope === "private" || db.scope === "private"
        ? "private"
        : "shared";
    const rowTitle = databaseRowTitle(db, row);
    const title = (input.title || `${rowTitle} の子ページ`).trim();
    const bundle = await this.createPage(
      title,
      `database-row:${databaseId}:${rowId}`,
      scope,
    );
    const current = await this.getDatabaseRowContent(databaseId, rowId, {
      title: rowTitle,
      scope,
    });
    const childPageIds = Array.from(
      new Set([...(current.childPageIds || []), bundle.meta.id]),
    );
    const markdown = current.markdown || "";
    const linkLine = `@[[${bundle.meta.title}|${bundle.meta.id}]]`;
    let blocksuite = current.blocksuite as any;
    try {
      const blocks = Array.isArray(blocksuite?.blocks)
        ? [...blocksuite.blocks]
        : [];
      blocks.push({
        type: "paragraph",
        content: [
          {
            type: "link",
            href: `local-page://${bundle.meta.id}`,
            content: [{ type: "text", text: bundle.meta.title, styles: {} }],
          },
        ],
      });
      blocksuite = {
        ...(blocksuite && typeof blocksuite === "object" ? blocksuite : {}),
        version: 1,
        kind: "blocknote",
        blocks,
      };
    } catch {}
    await this.saveDatabaseRowContent({
      databaseId,
      rowId,
      title: current.title || rowTitle,
      markdown: markdown.includes(linkLine)
        ? markdown
        : `${markdown}${markdown.trim() ? "\n" : ""}${linkLine}`,
      blocksuite,
      baseUpdatedAt: current.updatedAt,
      scope,
      childPageIds,
    });
    return bundle;
  }

  async deleteDatabaseRowChildPage(
    databaseId: string,
    rowId: string,
    pageId: string,
    input: { trashPage?: boolean } = {},
  ): Promise<{
    ok: true;
    databaseId: string;
    rowId: string;
    pageId: string;
    trashed: boolean;
    links: {
      childPages: PageWithLock[];
      outboundLinks: ResourceLinkInfo[];
      backlinks: ResourceLinkInfo[];
    };
  }> {
    const db = await this.getDatabase(databaseId).catch(() => null);
    const row = db?.rows.find((item) => item.id === rowId) ?? null;
    const scope = db?.scope === "private" ? "private" : "shared";
    const trashPage = input.trashPage !== false;

    // V270: make child-page deletion idempotent.  The sidebar can hold a stale row/page
    // reference after a rename, trash, reload, or import.  Deleting from the tree should
    // still clean every DB-row content reference and trash the page if it exists instead
    // of failing with a 400.
    await this.removeDatabaseChildReferencesAndRefreshIndex(pageId);

    if (trashPage) {
      // V271: this endpoint must be fully idempotent.  V269/V270 accidentally
      // called a non-existing deletePage() method here, which surfaced as a
      // 400 from the child-page delete route.  Use the existing trashPage()
      // workflow and swallow stale-page failures after the DB-row reference has
      // already been removed.
      try {
        const page = this.getPage(pageId);
        if (page && !page.meta.trashed) await this.trashPage(pageId);
      } catch {
        // Stale sidebar entries should not make unlink/delete fail.
      }
    } else {
      try {
        const page = this.getPage(pageId);
        if (
          page &&
          page.meta.parentId === `database-row:${databaseId}:${rowId}`
        ) {
          const meta = {
            ...page.meta,
            parentId: null,
            updatedAt: new Date().toISOString(),
            updatedBy: this.userLabel(),
          };
          await this.writeBundle({ ...page, meta });
          this.db
            .prepare(
              `UPDATE pages SET parent_id=?, updated_at=?, updated_by=? WHERE id=?`,
            )
            .run(null, meta.updatedAt, meta.updatedBy, pageId);
          upsertPageFts(this.db, {
            id: meta.id,
            title: meta.title,
            markdown: page.markdown,
            trashed: meta.trashed ? 1 : 0,
          });
          this.upsertPageDerivedIndexes({ ...page, meta });
        }
      } catch {
        // Stale page reference: unlink from row content was already attempted.
      }
    }

    const links =
      db && row
        ? await this.listDatabaseRowLinks(databaseId, rowId, { scope }).catch(
            () => ({ childPages: [], outboundLinks: [], backlinks: [] }),
          )
        : { childPages: [], outboundLinks: [], backlinks: [] };
    return { ok: true, databaseId, rowId, pageId, trashed: trashPage, links };
  }

  async listDatabaseSidebarRows(
    databaseId: string,
    input: { limit?: number; offset?: number } = {},
  ): Promise<DatabaseSidebarRowsResult> {
    const db = await this.getDatabase(databaseId);
    if (!db) throw new Error("Database not found");
    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 30) || 30));
    const offset = Math.max(0, Number(input.offset ?? 0) || 0);
    const rows = db.rows.slice(offset, offset + limit);
    const scope = db.scope === "private" ? "private" : "shared";
    const childCountByParent = new Map<string, number>();
    try {
      for (const page of await this.listPages()) {
        if (!page.trashed && this.isDatabaseRowParentId(page.parentId)) {
          childCountByParent.set(
            page.parentId!,
            (childCountByParent.get(page.parentId!) || 0) + 1,
          );
        }
      }
    } catch {}
    const result: DatabaseSidebarRow[] = [];
    for (const row of rows) {
      const rowTitle = databaseRowTitle(db, row);
      let childCount = 0;
      try {
        const content = await this.getDatabaseRowContent(databaseId, row.id, {
          title: rowTitle,
          scope,
        });
        const explicitChildIds = Array.isArray(content.childPageIds)
          ? content.childPageIds.filter(Boolean)
          : [];
        let liveExplicitChildCount = 0;
        for (const pageId of explicitChildIds) {
          try {
            const bundle = this.getPage(pageId);
            if (bundle && !bundle.meta.trashed) liveExplicitChildCount += 1;
          } catch {}
        }
        const parentChildCount =
          childCountByParent.get(`database-row:${databaseId}:${row.id}`) || 0;
        childCount = Math.max(liveExplicitChildCount, parentChildCount);
      } catch {}
      result.push({
        databaseId,
        rowId: row.id,
        title: rowTitle,
        updatedAt: row.updatedAt || db.updatedAt,
        hasChildren: childCount > 0,
        childCount,
      });
    }
    return {
      databaseId,
      rows: result,
      offset,
      limit,
      total: db.rows.length,
      hasMore: offset + rows.length < db.rows.length,
      nextOffset:
        offset + rows.length < db.rows.length ? offset + rows.length : null,
    };
  }

  async listDatabaseRowSidebarChildren(
    databaseId: string,
    rowId: string,
  ): Promise<DatabaseSidebarChildPagesResult> {
    const db = await this.getDatabase(databaseId).catch(() => null);
    if (!db) return { databaseId, rowId, childPages: [] };
    const row = db.rows.find((item) => item.id === rowId);
    if (!row) return { databaseId, rowId, childPages: [] };
    const scope = db.scope === "private" ? "private" : "shared";
    const content = await this.getDatabaseRowContent(databaseId, rowId, {
      title: databaseRowTitle(db, row),
      scope,
    });
    const childPageIds = new Set<string>(
      (content.childPageIds || []).filter(Boolean),
    );
    const parentKey = `database-row:${databaseId}:${rowId}`;
    try {
      for (const page of await this.listPages()) {
        if (!page.trashed && page.parentId === parentKey)
          childPageIds.add(page.id);
      }
    } catch {}
    const childPages: PageWithLock[] = [];
    const staleIds: string[] = [];
    for (const pageId of childPageIds) {
      try {
        const bundle = this.getPage(pageId);
        if (bundle && !bundle.meta.trashed) {
          // Sidebar child-page previews must use the real stored markdown.
          // `withLock(bundle.meta)` intentionally returns only metadata, so
          // attach a compact plain-text excerpt here rather than treating an
          // existing body as empty in the renderer.
          const previewSnippet = String(bundle.markdown || "")
            .replace(/\r?\n+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
          childPages.push({
            ...(await this.withLock(bundle.meta)),
            previewSnippet,
          });
        } else staleIds.push(pageId);
      } catch {
        staleIds.push(pageId);
      }
    }
    if (staleIds.length) {
      for (const pageId of staleIds)
        await this.removeDatabaseChildReferencesAndRefreshIndex(pageId);
    }
    childPages.sort((a, b) =>
      (a.title || "").localeCompare(b.title || "", "ja"),
    );
    return { databaseId, rowId, childPages };
  }

  /**
   * Lightweight workspace-wide list of database-row child pages for reference
   * pickers.  This reads the already-maintained relationship index rather than
   * opening every row body from the shared folder.
   */
  async listWorkspaceDatabaseChildPages(): Promise<Array<{
    databaseId: string;
    rowId: string;
    databaseTitle: string;
    rowTitle: string;
    page: PageWithLock;
  }>> {
    // Never make a compare/split picker wait for a whole-workspace index rebuild.
    // The existing incremental index is sufficient when present; a missing or
    // outdated index is rebuilt asynchronously and the next open observes it.
    void this.ensureUnifiedResourceLinkIndex();
    const indexRows = this.db.prepare(
      `SELECT DISTINCT source_database_id as databaseId, source_row_id as rowId, target_page_id as pageId
       FROM workspace_link_index
       WHERE source_type = 'database-row'
         AND link_kind = 'database-child-page'
         AND target_page_id IS NOT NULL
       ORDER BY updated_at DESC`,
    ).all() as Array<{ databaseId?: string; rowId?: string; pageId?: string }> ;

    const databaseCache = new Map<string, WorkspaceDatabase | null>();
    const result: Array<{ databaseId: string; rowId: string; databaseTitle: string; rowTitle: string; page: PageWithLock }> = [];
    const seen = new Set<string>();

    for (const item of indexRows) {
      if (!item.databaseId || !item.rowId || !item.pageId) continue;
      const identity = `${item.databaseId}:${item.rowId}:${item.pageId}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      let database = databaseCache.get(item.databaseId);
      if (database === undefined) {
        database = await this.getDatabase(item.databaseId).catch(() => null);
        databaseCache.set(item.databaseId, database);
      }
      const row = database?.rows.find((candidate) => candidate.id === item.rowId);
      const bundle = this.getPage(item.pageId);
      const expectedParentId = `database-row:${item.databaseId}:${item.rowId}`;
      if (
        !database ||
        !row ||
        !bundle ||
        bundle.meta.trashed ||
        bundle.meta.parentId !== expectedParentId
      ) {
        // Defensive self-healing for an index left behind by an interrupted
        // delete/unlink operation.  The next compare picker must not expose it.
        this.db
          .prepare(
            "DELETE FROM workspace_link_index WHERE source_type = 'database-row' AND source_database_id = ? AND source_row_id = ? AND target_page_id = ? AND link_kind = 'database-child-page'",
          )
          .run(item.databaseId, item.rowId, item.pageId);
        continue;
      }

      result.push({
        databaseId: item.databaseId,
        rowId: item.rowId,
        databaseTitle: database.title || '無題のデータベース',
        rowTitle: databaseRowTitle(database, row),
        page: await this.withLock(bundle.meta),
      });
    }

    return result.sort((a, b) =>
      `${a.databaseTitle} ${a.rowTitle} ${a.page.title}`.localeCompare(
        `${b.databaseTitle} ${b.rowTitle} ${b.page.title}`,
        'ja',
      ),
    );
  }

  async listDatabaseRowLinks(
    databaseId: string,
    rowId: string,
    options: { scope?: WorkspaceScope } = {},
  ): Promise<{
    childPages: PageWithLock[];
    outboundLinks: ResourceLinkInfo[];
    backlinks: ResourceLinkInfo[];
  }> {
    // Backlink/row-detail requests must remain responsive even after an index
    // schema update.  Rebuild in the background instead of blocking this request.
    void this.ensureUnifiedResourceLinkIndex();
    const db = await this.getDatabase(databaseId);
    if (!db) throw new Error("Database not found");
    const row = db.rows.find((item) => item.id === rowId);
    if (!row) throw new Error("Database row not found");
    const scope =
      options.scope === "private" || db.scope === "private"
        ? "private"
        : "shared";
    const rowTitle = databaseRowTitle(db, row);
    const content = await this.getDatabaseRowContent(databaseId, rowId, {
      title: rowTitle,
      scope,
    });
    const linkChildPageIds = new Set<string>(
      (content.childPageIds || []).filter(Boolean),
    );
    const parentKey = `database-row:${databaseId}:${rowId}`;
    try {
      for (const page of await this.listPages()) {
        if (!page.trashed && page.parentId === parentKey)
          linkChildPageIds.add(page.id);
      }
    } catch {}
    const childPages: PageWithLock[] = [];
    for (const pageId of linkChildPageIds) {
      try {
        const bundle = this.getPage(pageId);
        if (bundle && !bundle.meta.trashed)
          childPages.push(await this.withLock(bundle.meta));
      } catch {}
    }

    // Page and DB-row links are read from the same incremental resource graph that
    // ordinary pages use.  This avoids scanning every page and every DB-row body
    // whenever a row detail panel opens.
    const outboundIndexRows = this.db
      .prepare(
        `SELECT target_page_id as targetPageId, COALESCE(target_type, 'page') as targetType,
                target_database_id as targetDatabaseId, target_row_id as targetRowId,
                source_title as sourceTitle, source_icon as sourceIcon, link_kind as linkKind,
                snippet, updated_at as updatedAt
         FROM workspace_link_index
         WHERE source_type = 'database-row' AND source_database_id = ? AND source_row_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(databaseId, rowId) as Array<{
        targetPageId?: string;
        targetType?: string;
        targetDatabaseId?: string;
        targetRowId?: string;
        sourceTitle?: string;
        sourceIcon?: string | null;
        linkKind?: string;
        snippet?: string;
        updatedAt?: string;
      }>;
    const backlinkIndexRows = this.db
      .prepare(
        `SELECT source_type as sourceType, source_page_id as sourcePageId,
                source_database_id as sourceDatabaseId, source_row_id as sourceRowId,
                source_title as sourceTitle, source_icon as sourceIcon, snippet, updated_at as updatedAt
         FROM workspace_link_index
         WHERE COALESCE(target_type, 'page') = 'database-row'
           AND target_database_id = ? AND target_row_id = ?
         ORDER BY updated_at DESC
         LIMIT 200`,
      )
      .all(databaseId, rowId) as Array<{
        sourceType?: string;
        sourcePageId?: string;
        sourceDatabaseId?: string;
        sourceRowId?: string;
        sourceTitle?: string;
        sourceIcon?: string | null;
        snippet?: string;
        updatedAt?: string;
      }>;

    const databaseCache = new Map<string, WorkspaceDatabase | null>();
    const getIndexedDatabase = async (id: string): Promise<WorkspaceDatabase | null> => {
      if (databaseCache.has(id)) return databaseCache.get(id) || null;
      const value = await this.getDatabase(id).catch(() => null);
      databaseCache.set(id, value);
      return value;
    };
    const outboundLinks: ResourceLinkInfo[] = [];
    for (const item of outboundIndexRows) {
      if (item.linkKind === 'database-child-page') continue;
      if (item.targetType === 'database-row') {
        const targetDb = item.targetDatabaseId
          ? await getIndexedDatabase(item.targetDatabaseId)
          : null;
        const targetRow = targetDb?.rows.find((candidate) => candidate.id === item.targetRowId);
        if (!targetDb || !targetRow || !item.targetDatabaseId || !item.targetRowId) continue;
        outboundLinks.push({
          from: { type: 'database-row', databaseId, rowId },
          to: { type: 'database-row', databaseId: item.targetDatabaseId, rowId: item.targetRowId },
          sourceTitle: item.sourceTitle || `${db.title} / ${rowTitle}`,
          sourceIcon: item.sourceIcon || '🧾',
          targetTitle: `${targetDb.title} / ${databaseRowTitle(targetDb, targetRow)}`,
          snippet: item.snippet || '',
          updatedAt: item.updatedAt || content.updatedAt,
        });
      } else if (item.targetPageId) {
        const bundle = this.getPage(item.targetPageId);
        if (!bundle || bundle.meta.trashed) continue;
        outboundLinks.push({
          from: { type: 'database-row', databaseId, rowId },
          to: { type: 'page', pageId: item.targetPageId },
          sourceTitle: item.sourceTitle || `${db.title} / ${rowTitle}`,
          sourceIcon: item.sourceIcon || '🧾',
          targetTitle: bundle.meta.title,
          snippet: item.snippet || '',
          updatedAt: item.updatedAt || content.updatedAt,
        });
      }
    }

    const backlinks: ResourceLinkInfo[] = [];
    for (const item of backlinkIndexRows) {
      if (item.sourceType === 'database-row') {
        if (!item.sourceDatabaseId || !item.sourceRowId) continue;
        const sourceDb = await getIndexedDatabase(item.sourceDatabaseId);
        const sourceRow = sourceDb?.rows.find((candidate) => candidate.id === item.sourceRowId);
        if (!sourceDb || !sourceRow) continue;
        backlinks.push({
          from: { type: 'database-row', databaseId: item.sourceDatabaseId, rowId: item.sourceRowId },
          to: { type: 'database-row', databaseId, rowId },
          sourceTitle: item.sourceTitle || `${sourceDb.title} / ${databaseRowTitle(sourceDb, sourceRow)}`,
          sourceIcon: item.sourceIcon || '🧾',
          targetTitle: `${db.title} / ${rowTitle}`,
          snippet: item.snippet || '',
          updatedAt: item.updatedAt || '',
        });
      } else if (item.sourcePageId) {
        const sourcePage = this.getPage(item.sourcePageId);
        if (!sourcePage || sourcePage.meta.trashed) continue;
        backlinks.push({
          from: { type: 'page', pageId: item.sourcePageId },
          to: { type: 'database-row', databaseId, rowId },
          sourceTitle: item.sourceTitle || sourcePage.meta.title,
          sourceIcon: item.sourceIcon || sourcePage.meta.icon || '📄',
          targetTitle: `${db.title} / ${rowTitle}`,
          snippet: item.snippet || '',
          updatedAt: item.updatedAt || sourcePage.meta.updatedAt,
        });
      }
    }

    const resourceKey = (resource: ResourceRef): string => {
      if (resource.type === 'page') return `page:${resource.pageId}`;
      if (resource.type === 'database') return `database:${resource.databaseId}`;
      return `database-row:${resource.databaseId}:${resource.rowId}`;
    };
    const uniqueOutbound = Array.from(new Map(outboundLinks.map((link) => [resourceKey(link.to), link] as const)).values());
    const uniqueBacklinks = Array.from(new Map(backlinks.map((link) => [resourceKey(link.from), link] as const)).values());
    return {
      childPages: Array.from(new Map(childPages.map((page) => [page.id, page])).values()),
      outboundLinks: uniqueOutbound,
      backlinks: uniqueBacklinks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  private databaseSummaryHash(database: WorkspaceDatabase): string {
    const normalized = {
      id: database.id,
      title: database.title,
      scope: database.scope ?? "shared",
      trashed: Boolean((database as any).trashed),
      deletedAt: (database as any).deletedAt ?? null,
      createdAt: database.createdAt,
      updatedAt: database.updatedAt,
      updatedBy: database.updatedBy,
      rowCount: database.rows?.length ?? 0,
      properties: database.properties ?? [],
      views: database.views ?? [],
      activeViewId: database.activeViewId ?? null,
      templates: database.templates ?? [],
    };
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private upsertDatabaseSummaryIndex(database: WorkspaceDatabase): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
      INSERT INTO database_summary_index(
        database_id,title,scope,icon,trashed,deleted_at,created_at,updated_at,updated_by,row_count,
        properties_json,views_json,active_view_id,templates_json,content_hash,indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(database_id) DO UPDATE SET
        title = excluded.title,
        scope = excluded.scope,
        icon = excluded.icon,
        trashed = excluded.trashed,
        deleted_at = excluded.deleted_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        row_count = excluded.row_count,
        properties_json = excluded.properties_json,
        views_json = excluded.views_json,
        active_view_id = excluded.active_view_id,
        templates_json = excluded.templates_json,
        content_hash = excluded.content_hash,
        indexed_at = excluded.indexed_at
    `,
      )
      .run(
        database.id,
        database.title,
        database.scope ?? "shared",
        (database as any).icon ?? null,
        (database as any).trashed ? 1 : 0,
        (database as any).deletedAt ?? null,
        database.createdAt ?? "",
        database.updatedAt ?? "",
        database.updatedBy ?? "",
        database.rows?.length ?? 0,
        JSON.stringify(database.properties ?? []),
        JSON.stringify(database.views ?? []),
        database.activeViewId ?? null,
        JSON.stringify(database.templates ?? []),
        this.databaseSummaryHash(database),
        now,
      );
  }

  private databaseFromSummaryRow(row: any): WorkspaceDatabase {
    const parse = <T>(value: string | null | undefined, fallback: T): T => {
      try {
        return value ? (JSON.parse(value) as T) : fallback;
      } catch {
        return fallback;
      }
    };
    return {
      id: String(row.database_id),
      title: String(row.title || ""),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
      updatedBy: String(row.updated_by || ""),
      properties: parse<DatabaseProperty[]>(row.properties_json, []),
      rows: [],
      views: parse<DatabaseView[]>(row.views_json, []),
      activeViewId: row.active_view_id ? String(row.active_view_id) : undefined,
      templates: parse<any[]>(row.templates_json, []),
      scope: row.scope === "private" ? "private" : "shared",
      trashed: Boolean(row.trashed),
      deletedAt: row.deleted_at ?? null,
    };
  }

  private listDatabaseSummariesFromIndex(
    options: { includeTrashed?: boolean } = {},
  ): WorkspaceDatabase[] {
    const includeTrashed = Boolean(options.includeTrashed);
    const rows = this.db
      .prepare(
        `
      SELECT *
      FROM database_summary_index
      ${includeTrashed ? "" : "WHERE trashed = 0"}
      ORDER BY updated_at DESC
    `,
      )
      .all() as any[];
    return rows.map((row) => this.databaseFromSummaryRow(row));
  }

  private countDatabasesFromSummaryIndex(includeTrashed = false): number {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM database_summary_index
      ${includeTrashed ? "" : "WHERE trashed = 0"}
    `,
      )
      .get() as { count?: number } | undefined;
    return Number(row?.count || 0);
  }

  private privateDatabaseIdsFromSummaryIndex(): Set<string> {
    const rows = this.db
      .prepare(
        `
      SELECT database_id
      FROM database_summary_index
      WHERE scope = 'private' AND trashed = 0
    `,
      )
      .all() as { database_id?: string }[];
    return new Set(
      rows.map((row) => String(row.database_id || "")).filter(Boolean),
    );
  }

  private privatePageIdsFromSqlite(): Set<string> {
    const rows = this.db
      .prepare(
        `
      SELECT id, properties_json as propertiesJson
      FROM pages
      WHERE trashed = 0
    `,
      )
      .all() as { id: string; propertiesJson?: string }[];
    const ids = new Set<string>();
    for (const row of rows) {
      try {
        const props = row.propertiesJson ? JSON.parse(row.propertiesJson) : {};
        if (props?.__scope === "private" || props?.scope === "private")
          ids.add(String(row.id));
      } catch {}
    }
    return ids;
  }

  private getDatabaseSummary(id: string): WorkspaceDatabase | null {
    const row = this.db
      .prepare("SELECT * FROM database_summary_index WHERE database_id = ?")
      .get(id) as any;
    return row ? this.databaseFromSummaryRow(row) : null;
  }

  private databaseRowFromIndex(row: any): DatabaseRow {
    let cells: Record<string, any> = {};
    try {
      cells = JSON.parse(String(row.cells_json || "{}"));
    } catch {
      cells = {};
    }
    return {
      id: String(row.row_id),
      cells,
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || ""),
    };
  }

  async listDatabasesCore(): Promise<WorkspaceDatabase[]> {
    const paths = vaultPaths(this.sharedRoot);
    await fs.ensureDir(paths.databases);
    await fs.ensureDir(paths.privateDatabases);

    // v166: Private DBs must never disappear after restart.
    // Scan the configured Private DB folder plus legacy/default locations so that
    // a DB created before changing the Private DB path is still discoverable.
    const sources = this.databaseSourceDirs();
    const byId = new Map<string, WorkspaceDatabase>();

    for (const source of sources) {
      const entries = await fs.readdir(source.dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const file = path.join(source.dir, entry);
        const raw = await fs.readJson(file).catch(() => null);
        if (!raw) continue;
        const db = this.normalizeDatabase(
          { ...raw, scope: raw.scope ?? source.scope },
          entry.replace(/\.json$/, ""),
        );
        const existing = byId.get(db.id);
        if (!existing || db.updatedAt.localeCompare(existing.updatedAt) >= 0) {
          byId.set(db.id, db);
        }
      }
    }

    const databases = Array.from(byId.values()).filter(
      (db) => !(db as any).trashed,
    );
    for (const db of databases) {
      try {
        this.upsertDatabaseSummaryIndex(db);
      } catch {
        /* cache only */
      }
    }
    databases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return databases;
  }

  async listTrashedDatabasesCore(): Promise<WorkspaceDatabase[]> {
    const sources = this.databaseSourceDirs();
    const byId = new Map<string, WorkspaceDatabase>();
    for (const source of sources) {
      const entries = await fs.readdir(source.dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const file = path.join(source.dir, entry);
        const raw = await fs.readJson(file).catch(() => null);
        if (!raw || !raw.trashed) continue;
        const db = this.normalizeDatabase(
          { ...raw, scope: raw.scope ?? source.scope },
          entry.replace(/\.json$/, ""),
        );
        const existing = byId.get(db.id);
        if (!existing || db.updatedAt.localeCompare(existing.updatedAt) >= 0)
          byId.set(db.id, db);
      }
    }
    const databases = Array.from(byId.values());
    for (const db of databases) {
      try {
        this.upsertDatabaseSummaryIndex(db);
      } catch {
        /* cache only */
      }
    }
    databases.sort((a, b) =>
      String((b as any).deletedAt ?? b.updatedAt).localeCompare(
        String((a as any).deletedAt ?? a.updatedAt),
      ),
    );
    return databases;
  }

  async getDatabaseCore(id: string): Promise<WorkspaceDatabase | null> {
    const candidates = [
      ...this.databasePathCandidates(id, "shared"),
      ...this.databasePathCandidates(id, "private"),
    ];
    let best: WorkspaceDatabase | null = null;
    for (const candidate of candidates) {
      if (!(await fs.pathExists(candidate.file))) continue;
      const raw = await fs.readJson(candidate.file).catch(() => null);
      if (!raw) continue;
      const db = this.normalizeDatabase(
        { ...raw, scope: raw.scope ?? candidate.scope },
        id,
      );
      if (!best || db.updatedAt.localeCompare(best.updatedAt) >= 0) best = db;
    }
    return best;
  }

  async createDatabaseCore(
    title = "新規データベース",
    scope: WorkspaceScope = "shared",
  ): Promise<WorkspaceDatabase> {
    const now = new Date().toISOString();
    const id = `db_${nanoid(12)}`;
    const database: WorkspaceDatabase = {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      updatedBy: this.userLabel(),
      properties: [
        { id: "prop_name", name: "Name", type: "text" },
        {
          id: "prop_status",
          name: "Status",
          type: "select",
          options: ["未着手", "進行中", "完了"],
        },
        { id: "prop_date", name: "Date", type: "date" },
      ],
      rows: [],
      views: [
        {
          id: "view_default",
          name: "Default Table",
          type: "table",
          filters: [],
          sorts: [],
        },
      ],
      activeViewId: "view_default",
      scope,
    };
    await this.saveDatabaseFile(database);
    return database;
  }

  async saveDatabaseCore(input: WorkspaceDatabase): Promise<WorkspaceDatabase> {
    const current = await this.getDatabase(input.id);
    // v397: Database editing also uses optimistic concurrency at save time.
    // Do not make opening a database depend on a long-lived SMB lock lease.
    const baseUpdatedAt = (input as any).baseUpdatedAt;
    if (
      current &&
      baseUpdatedAt &&
      current.updatedAt &&
      current.updatedAt !== baseUpdatedAt
    ) {
      const currentTime = Date.parse(current.updatedAt);
      const baseTime = Date.parse(baseUpdatedAt);
      // V259: The renderer may carry an optimistic updatedAt generated before the server save.
      // That can make baseUpdatedAt newer than the persisted file even when no other client edited it.
      // Treat it as a true conflict only when the persisted database is newer than the base snapshot.
      const isTrueConflict =
        Number.isFinite(currentTime) && Number.isFinite(baseTime)
          ? currentTime > baseTime
          : current.updatedAt !== baseUpdatedAt;
      if (isTrueConflict) {
        await this.databaseConflictService()
          .writeSnapshot(input, current, "baseUpdatedAt_mismatch")
          .catch(() => undefined);
        throw new Error(
          `Database conflict detected. 他の端末または別ウィンドウで更新されています。再読み込みしてから保存してください。current=${current.updatedAt}, base=${baseUpdatedAt}`,
        );
      }
    }
    const now = new Date().toISOString();
    let database = this.normalizeDatabase(
      {
        ...input,
        baseUpdatedAt: undefined,
        scope: input.scope ?? current?.scope ?? "shared",
        createdAt: current?.createdAt ?? input.createdAt,
        updatedAt: now,
        updatedBy: this.userLabel(),
      },
      input.id,
    );
    database = await this.enforceDatabaseScopeRules(database);
    const previousScope = current?.scope ?? undefined;
    const currentRows = current?.rows || [];
    const currentRowById = new Map(currentRows.map((row) => [row.id, row]));
    const nextRowIds = new Set(database.rows.map((row) => row.id));
    // Renderer cell edits always stamp row.updatedAt. This lets ordinary edits
    // update one SQLite row instead of re-hashing every row in the database.
    const changedRowIds = database.rows
      .filter((row) => {
        const before = currentRowById.get(row.id);
        return !before || String(before.updatedAt || "") !== String(row.updatedAt || "");
      })
      .map((row) => row.id);
    const deletedRowIds = currentRows
      .filter((row) => !nextRowIds.has(row.id))
      .map((row) => row.id);
    const orderChanged =
      currentRows.length === database.rows.length &&
      currentRows.some((row, index) => row.id !== database.rows[index]?.id);
    const schemaChanged = current
      ? this.databaseIndexSchemaHash(current) !== this.databaseIndexSchemaHash(database)
      : true;
    await this.saveDatabaseFile(database, {
      changedRowIds,
      deletedRowIds,
      orderChanged,
      forceFull: schemaChanged,
    });
    if (previousScope && previousScope !== database.scope) {
      for (const candidate of this.databasePathCandidates(
        database.id,
        previousScope,
      )) {
        await fs.remove(candidate.file).catch(() => undefined);
      }
    }
    return database;
  }

  async acquireDatabaseLock(databaseId: string): Promise<LockInfo> {
    return this.databaseLockService().acquire(databaseId);
  }

  async renewDatabaseLock(databaseId: string): Promise<LockInfo> {
    return this.databaseLockService().renew(databaseId);
  }

  async releaseDatabaseLock(databaseId: string): Promise<void> {
    return this.databaseLockService().release(databaseId);
  }

  async getDatabaseLock(databaseId: string): Promise<LockInfo | null> {
    return this.databaseLockService().get(databaseId);
  }

  private nextDatabaseUniqueId(database: WorkspaceDatabase, property: DatabaseProperty): string {
    const prefix = String(property.uniqueIdPrefix || property.name || "ID").trim().slice(0, 24) || "ID";
    const digits = Math.max(1, Math.min(10, Number(property.uniqueIdDigits || 4)));
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
    let max = 0;
    for (const row of database.rows || []) {
      const match = String(row.cells?.[property.id] || "").match(pattern);
      if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return `${prefix}-${String(max + 1).padStart(digits, "0")}`;
  }

  private backfillDatabaseUniqueIds(database: WorkspaceDatabase, property: DatabaseProperty): void {
    const prefix = String(property.uniqueIdPrefix || property.name || "ID").trim().slice(0, 24) || "ID";
    const digits = Math.max(1, Math.min(10, Number(property.uniqueIdDigits || 4)));
    const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
    let next = 1;
    for (const row of database.rows || []) {
      const match = String(row.cells?.[property.id] || "").match(pattern);
      if (match) next = Math.max(next, (Number(match[1]) || 0) + 1);
    }
    for (const row of database.rows || []) {
      if (!String(row.cells?.[property.id] || "").trim()) {
        row.cells[property.id] = `${prefix}-${String(next++).padStart(digits, "0")}`;
      }
    }
  }

  async patchDatabaseRowsCore(
    id: string,
    input: { baseUpdatedAt?: string; patches: Array<{ rowId: string; cells: Record<string, any> }> },
  ): Promise<{ databaseId: string; rows: DatabaseRow[]; updatedAt: string; updatedBy: string }> {
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");
    const baseUpdatedAt = input.baseUpdatedAt;
    if (baseUpdatedAt && database.updatedAt && database.updatedAt !== baseUpdatedAt) {
      const currentTime = Date.parse(database.updatedAt);
      const baseTime = Date.parse(baseUpdatedAt);
      const isTrueConflict = Number.isFinite(currentTime) && Number.isFinite(baseTime)
        ? currentTime > baseTime
        : database.updatedAt !== baseUpdatedAt;
      if (isTrueConflict) {
        const error: any = new Error(`Database conflict detected. current=${database.updatedAt}, base=${baseUpdatedAt}`);
        error.code = "DATABASE_CONFLICT";
        error.statusCode = 409;
        error.payload = { currentUpdatedAt: database.updatedAt, baseUpdatedAt };
        throw error;
      }
    }
    const patchesByRowId = new Map<string, Record<string, any>>();
    for (const patch of input.patches || []) {
      if (!patch?.rowId || !patch.cells || typeof patch.cells !== "object") continue;
      patchesByRowId.set(String(patch.rowId), { ...(patchesByRowId.get(String(patch.rowId)) || {}), ...patch.cells });
    }
    if (!patchesByRowId.size) return { databaseId: id, rows: [], updatedAt: database.updatedAt, updatedBy: database.updatedBy };
    const now = new Date().toISOString();
    const changedRows: DatabaseRow[] = [];
    const rowIds = new Set(patchesByRowId.keys());
    const validPropertyIds = new Set(database.properties.map((property) => property.id));
    database.rows = database.rows.map((row) => {
      const patch = patchesByRowId.get(row.id);
      if (!patch) return row;
      const cells: Record<string, any> = { ...row.cells };
      let changed = false;
      for (const [propertyId, value] of Object.entries(patch)) {
        if (!validPropertyIds.has(propertyId)) continue;
        const property = database.properties.find((candidate) => candidate.id === propertyId);
        if (property?.type === "unique_id" || property?.type === "button" || property?.type === "created_time" || property?.type === "last_edited_time" || property?.type === "formula" || property?.type === "rollup") continue;
        if (JSON.stringify(cells[propertyId]) === JSON.stringify(value)) continue;
        cells[propertyId] = value as any;
        changed = true;
      }
      if (!changed) return row;
      const next = { ...row, cells, updatedAt: now };
      changedRows.push(next);
      return next;
    });
    if (!changedRows.length) return { databaseId: id, rows: [], updatedAt: database.updatedAt, updatedBy: database.updatedBy };
    database.updatedAt = now;
    database.updatedBy = this.userLabel();
    await this.saveDatabaseFile(database, { changedRowIds: changedRows.map((row) => row.id) });
    return { databaseId: id, rows: changedRows, updatedAt: database.updatedAt, updatedBy: database.updatedBy };
  }

  async addDatabaseRowCore(id: string): Promise<WorkspaceDatabase> {
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");
    const now = new Date().toISOString();
    const cells: DatabaseRow["cells"] = {};
    for (const prop of database.properties) {
      if (prop.type === "created_time" || prop.type === "last_edited_time") continue;
      cells[prop.id] =
        prop.type === "status"
          ? (prop.options?.[0] || "未着手")
          : prop.type === "unique_id"
            ? this.nextDatabaseUniqueId(database, prop)
            : prop.type === "checkbox"
              ? false
              : prop.type === "relation" || prop.type === "multi_select"
                ? []
                : "";
    }
    const newRowId = `row_${nanoid(12)}`;
    database.rows.push({
      id: newRowId,
      cells,
      createdAt: now,
      updatedAt: now,
    });
    database.updatedAt = now;
    database.updatedBy = this.userLabel();
    await this.saveDatabaseFile(database, { changedRowIds: [newRowId] });
    return database;
  }

  async addDatabasePropertyCore(
    id: string,
    name: string,
    type: DatabasePropertyType,
  ): Promise<WorkspaceDatabase> {
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");
    const prop: DatabaseProperty = {
      id: `prop_${nanoid(10)}`,
      name: name || "Property",
      type,
      options:
        type === "status" ? ["未着手", "進行中", "完了"] : type === "select" || type === "multi_select" ? ["未設定"] : undefined,
    };
    database.properties.push(prop);
    if (type === "unique_id") {
      prop.uniqueIdPrefix = name || "ID";
      prop.uniqueIdDigits = 4;
      this.backfillDatabaseUniqueIds(database, prop);
    }
    if (type !== "created_time" && type !== "last_edited_time" && type !== "unique_id" && type !== "button") {
      for (const row of database.rows) {
        row.cells[prop.id] =
          type === "checkbox"
            ? false
            : type === "relation" || type === "multi_select"
              ? []
              : "";
      }
    }
    database.updatedAt = new Date().toISOString();
    database.updatedBy = this.userLabel();
    await this.saveDatabaseFile(database);
    return database;
  }

  async deleteDatabaseCore(id: string): Promise<{ ok: true; id: string }> {
    // v169: Deleting a database is now a soft delete.
    // This is especially important for Private DBs because users expect the DB
    // to appear in the global Trash and be restorable, just like pages.
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");
    const now = new Date().toISOString();
    const trashed = this.normalizeDatabase(
      {
        ...database,
        trashed: true,
        deletedAt: now,
        updatedAt: now,
        updatedBy: this.userLabel(),
      } as any,
      id,
    );
    await this.saveDatabaseFile(trashed);
    return { ok: true, id };
  }

  async restoreTrashedDatabaseCore(id: string): Promise<WorkspaceDatabase> {
    const database = await this.getDatabase(id);
    if (!database || !(database as any).trashed) {
      const trashed = (await this.listTrashedDatabases()).find(
        (db) => db.id === id,
      );
      if (!trashed) throw new Error("Trashed database not found");
      const now = new Date().toISOString();
      const restored = this.normalizeDatabase(
        {
          ...trashed,
          trashed: false,
          deletedAt: null,
          updatedAt: now,
          updatedBy: this.userLabel(),
        } as any,
        id,
      );
      await this.saveDatabaseFile(restored);
      return restored;
    }
    const now = new Date().toISOString();
    const restored = this.normalizeDatabase(
      {
        ...database,
        trashed: false,
        deletedAt: null,
        updatedAt: now,
        updatedBy: this.userLabel(),
      } as any,
      id,
    );
    await this.saveDatabaseFile(restored);
    return restored;
  }

  async deleteTrashedDatabasePermanentlyCore(
    id: string,
  ): Promise<{ ok: true; id: string }> {
    const database =
      (await this.listTrashedDatabases()).find((db) => db.id === id) ??
      (await this.getDatabase(id));
    if (!database) throw new Error("Database not found");
    if (!(database as any).trashed)
      throw new Error(
        "完全削除する前にデータベースをゴミ箱へ移動してください。",
      );

    const paths = vaultPaths(this.sharedRoot);
    const deletedRoot = path.join(
      paths.backups,
      `deleted_database_${sanitizeSegment(id)}_${Date.now()}`,
    );
    await fs.ensureDir(deletedRoot);
    const candidates = [
      ...this.databasePathCandidates(id, "shared"),
      ...this.databasePathCandidates(id, "private"),
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate.file);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (await fs.pathExists(candidate.file)) {
        const bucket =
          candidate.scope === "private"
            ? "private-databases"
            : "shared-databases";
        const suffix = candidate.primary ? "" : `_legacy_${nanoid(4)}`;
        await fs
          .copy(
            candidate.file,
            path.join(
              deletedRoot,
              bucket,
              `${sanitizeSegment(id)}${suffix}.json`,
            ),
            { overwrite: true },
          )
          .catch(() => undefined);
        await fs.remove(candidate.file).catch(() => undefined);
      }
    }
    return { ok: true, id };
  }

  async emptyTrashedDatabasesCore(): Promise<{
    ok: true;
    deletedIds: string[];
    failedIds: string[];
  }> {
    const trashed = await this.listTrashedDatabases();
    const deletedIds: string[] = [];
    const failedIds: string[] = [];
    for (const db of trashed) {
      try {
        await this.deleteTrashedDatabasePermanently(db.id);
        deletedIds.push(db.id);
      } catch {
        failedIds.push(db.id);
      }
    }
    if (failedIds.length > 0 && deletedIds.length === 0) {
      throw new Error(
        `DBゴミ箱を空にできませんでした。削除できないDB: ${failedIds.length}件`,
      );
    }
    return { ok: true, deletedIds, failedIds };
  }

  private databasePath(id: string, scope: WorkspaceScope = "shared"): string {
    return this.databasePathCandidates(id, scope)[0].file;
  }

  private databaseSourceDirs(): Array<{
    dir: string;
    scope: WorkspaceScope;
    primary: boolean;
  }> {
    const paths = vaultPaths(this.sharedRoot);
    const defaults = vaultPaths(this.sharedRoot);
    const dirs: Array<{
      dir: string;
      scope: WorkspaceScope;
      primary: boolean;
    }> = [
      { dir: paths.databases, scope: "shared", primary: true },
      { dir: paths.privateDatabases, scope: "private", primary: true },
    ];

    // Legacy/default fallback for Private DBs. This protects users who created a
    // Private DB, then changed Private DB storage settings or relaunched after a
    // settings mismatch.
    const legacyPrivateDirs = [
      defaults.privateDatabases,
      path.join(this.sharedRoot, "private-vault", "databases"),
    ];
    for (const dir of legacyPrivateDirs) {
      if (!dirs.some((item) => path.resolve(item.dir) === path.resolve(dir))) {
        dirs.push({ dir, scope: "private", primary: false });
      }
    }
    return dirs;
  }

  private databasePathCandidates(
    id: string,
    scope: WorkspaceScope = "shared",
  ): Array<{ file: string; scope: WorkspaceScope; primary: boolean }> {
    const filename = `${sanitizeSegment(id)}.json`;
    return this.databaseSourceDirs()
      .filter((source) => source.scope === scope)
      .map((source) => ({
        file: path.join(source.dir, filename),
        scope: source.scope,
        primary: source.primary,
      }));
  }

  private async saveDatabaseFile(
    database: WorkspaceDatabase,
    indexMutation?: {
      changedRowIds?: string[];
      deletedRowIds?: string[];
      orderChanged?: boolean;
      forceFull?: boolean;
    },
  ): Promise<void> {
    const scope = database.scope === "private" ? "private" : "shared";
    const primary = this.databasePathCandidates(database.id, scope)[0];
    await fs.ensureDir(path.dirname(primary.file));
    await this.atomicWriteJson(primary.file, { ...database, scope });

    // Remove duplicate stale copies in non-primary folders for the same scope.
    // This prevents restart-time ambiguity while keeping the newly saved primary file.
    for (const candidate of this.databasePathCandidates(
      database.id,
      scope,
    ).slice(1)) {
      await fs.remove(candidate.file).catch(() => undefined);
    }
    this.upsertDatabaseSummaryIndex(database);
    if (indexMutation) {
      this.upsertDatabaseRowIndexForKnownChanges(database, indexMutation);
    } else {
      // Import/recovery callers without a reliable changed-row set retain the
      // hash-based safety path. Interactive saves use the targeted path below.
      this.upsertDatabaseRowIndexIncremental(database);
    }
  }

  private databaseIndexSchemaHash(database: WorkspaceDatabase): string {
    const normalized = {
      properties: database.properties ?? [],
      firstPropId: database.properties?.[0]?.id ?? null,
    };
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private databaseRowIndexHash(row: DatabaseRow): string {
    const normalized = {
      id: row.id,
      cells: row.cells ?? {},
      createdAt: row.createdAt ?? "",
      updatedAt: row.updatedAt ?? "",
    };
    return createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  private buildDatabaseRowIndexPayload(
    database: WorkspaceDatabase,
    row: DatabaseRow,
    rowOrder: number,
  ): {
    titleText: string;
    searchText: string;
    cellsJson: string;
    rowHash: string;
  } {
    const firstPropId = database.properties[0]?.id;
    const titleText = firstPropId
      ? dbCellPlainText(row.cells[firstPropId])
      : row.id;
    const searchText = database.properties
      .map((prop) => `${prop.name} ${dbCellPlainText(row.cells[prop.id])}`)
      .join(" ")
      .slice(0, 20000);
    return {
      titleText,
      searchText,
      cellsJson: JSON.stringify(row.cells ?? {}),
      rowHash: this.databaseRowIndexHash(row),
    };
  }

  private upsertDatabaseRowIndexEntry(
    database: WorkspaceDatabase,
    row: DatabaseRow,
    rowOrder: number,
  ): void {
    const payload = this.buildDatabaseRowIndexPayload(database, row, rowOrder);
    this.db
      .prepare(
        "DELETE FROM database_row_index WHERE database_id = ? AND row_id = ?",
      )
      .run(database.id, row.id);
    this.db
      .prepare(
        "DELETE FROM database_row_property_index WHERE database_id = ? AND row_id = ?",
      )
      .run(database.id, row.id);
    this.db
      .prepare(
        "DELETE FROM database_row_fts WHERE database_id = ? AND row_id = ?",
      )
      .run(database.id, row.id);
    this.db
      .prepare(
        `
      INSERT INTO database_row_index(database_id, row_id, row_order, title_text, search_text, cells_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        database.id,
        row.id,
        rowOrder,
        payload.titleText,
        payload.searchText,
        payload.cellsJson,
        row.createdAt,
        row.updatedAt,
      );

    const insertProp = this.db.prepare(`
      INSERT INTO database_row_property_index(database_id, row_id, property_id, text_value, text_value_lower, number_value, date_value, boolean_value, empty_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const prop of database.properties) {
      const rawValue = row.cells?.[prop.id];
      const textValue = dbCellPlainText(rawValue).slice(0, 4000);
      const numberValue = ["number", "formula"].includes(prop.type)
        ? dbCellNumber(rawValue)
        : null;
      const dateValue =
        prop.type === "date" ? dbCellDateText(rawValue) || null : null;
      const booleanValue =
        prop.type === "checkbox" ? dbCellBoolean(rawValue) : null;
      const emptyValue = dbCellIsEmpty(rawValue) ? 1 : 0;
      insertProp.run(
        database.id,
        row.id,
        prop.id,
        textValue,
        textValue.toLowerCase(),
        numberValue,
        dateValue,
        booleanValue,
        emptyValue,
      );
    }
    this.db
      .prepare(
        `
      INSERT INTO database_row_fts(database_id, row_id, search_text)
      VALUES (?, ?, ?)
    `,
      )
      .run(database.id, row.id, payload.searchText);
    this.db
      .prepare(
        `
      INSERT INTO database_row_hash_index(database_id, row_id, row_hash, row_order, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(database_id, row_id) DO UPDATE SET
        row_hash = excluded.row_hash,
        row_order = excluded.row_order,
        updated_at = excluded.updated_at
    `,
      )
      .run(database.id, row.id, payload.rowHash, rowOrder, row.updatedAt ?? "");
  }

  private deleteDatabaseRowIndexEntry(databaseId: string, rowId: string): void {
    this.db
      .prepare(
        "DELETE FROM database_row_index WHERE database_id = ? AND row_id = ?",
      )
      .run(databaseId, rowId);
    this.db
      .prepare(
        "DELETE FROM database_row_property_index WHERE database_id = ? AND row_id = ?",
      )
      .run(databaseId, rowId);
    this.db
      .prepare(
        "DELETE FROM database_row_fts WHERE database_id = ? AND row_id = ?",
      )
      .run(databaseId, rowId);
    this.db
      .prepare(
        "DELETE FROM database_row_hash_index WHERE database_id = ? AND row_id = ?",
      )
      .run(databaseId, rowId);
  }

  private rebuildDatabaseRowIndex(database: WorkspaceDatabase): void {
    const now = new Date().toISOString();
    const schemaHash = this.databaseIndexSchemaHash(database);
    const tx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM database_row_index WHERE database_id = ?")
        .run(database.id);
      this.db
        .prepare(
          "DELETE FROM database_row_property_index WHERE database_id = ?",
        )
        .run(database.id);
      this.db
        .prepare("DELETE FROM database_row_fts WHERE database_id = ?")
        .run(database.id);
      this.db
        .prepare("DELETE FROM database_row_hash_index WHERE database_id = ?")
        .run(database.id);
      database.rows.forEach((row, index) =>
        this.upsertDatabaseRowIndexEntry(database, row, index),
      );
      this.db
        .prepare(
          `
        INSERT INTO database_index_meta(database_id, row_count, indexed_at)
        VALUES (?, ?, ?)
        ON CONFLICT(database_id) DO UPDATE SET row_count = excluded.row_count, indexed_at = excluded.indexed_at
      `,
        )
        .run(database.id, database.rows.length, now);
      this.db
        .prepare(
          `
        INSERT INTO database_index_state(database_id, schema_hash, row_count, indexed_at, mode)
        VALUES (?, ?, ?, ?, 'full')
        ON CONFLICT(database_id) DO UPDATE SET
          schema_hash = excluded.schema_hash,
          row_count = excluded.row_count,
          indexed_at = excluded.indexed_at,
          mode = excluded.mode
      `,
        )
        .run(database.id, schemaHash, database.rows.length, now);
    });
    tx();
  }

  private upsertDatabaseRowIndexForKnownChanges(
    database: WorkspaceDatabase,
    mutation: {
      changedRowIds?: string[];
      deletedRowIds?: string[];
      orderChanged?: boolean;
      forceFull?: boolean;
    },
  ): void {
    const now = new Date().toISOString();
    const schemaHash = this.databaseIndexSchemaHash(database);
    const state = this.db
      .prepare("SELECT schema_hash FROM database_index_state WHERE database_id = ?")
      .get(database.id) as { schema_hash?: string } | undefined;
    const indexedCount = Number(
      (this.db
        .prepare("SELECT COUNT(*) as count FROM database_row_index WHERE database_id = ?")
        .get(database.id) as { count?: number })?.count || 0,
    );
    const hashCount = Number(
      (this.db
        .prepare("SELECT COUNT(*) as count FROM database_row_hash_index WHERE database_id = ?")
        .get(database.id) as { count?: number })?.count || 0,
    );
    if (
      mutation.forceFull ||
      !state ||
      state.schema_hash !== schemaHash ||
      (database.rows.length > 0 && (indexedCount === 0 || hashCount !== indexedCount))
    ) {
      this.rebuildDatabaseRowIndex(database);
      return;
    }

    const changed = new Set((mutation.changedRowIds || []).map(String).filter(Boolean));
    const deleted = new Set((mutation.deletedRowIds || []).map(String).filter(Boolean));
    const tx = this.db.transaction(() => {
      for (const rowId of deleted) this.deleteDatabaseRowIndexEntry(database.id, rowId);
      database.rows.forEach((row, rowOrder) => {
        if (changed.has(row.id)) {
          this.upsertDatabaseRowIndexEntry(database, row, rowOrder);
          return;
        }
        if (mutation.orderChanged) {
          this.db
            .prepare(
              "UPDATE database_row_index SET row_order = ? WHERE database_id = ? AND row_id = ?",
            )
            .run(rowOrder, database.id, row.id);
          this.db
            .prepare(
              "UPDATE database_row_hash_index SET row_order = ? WHERE database_id = ? AND row_id = ?",
            )
            .run(rowOrder, database.id, row.id);
        }
      });
      this.db
        .prepare(
          `INSERT INTO database_index_meta(database_id, row_count, indexed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(database_id) DO UPDATE SET row_count = excluded.row_count, indexed_at = excluded.indexed_at`,
        )
        .run(database.id, database.rows.length, now);
      this.db
        .prepare(
          `INSERT INTO database_index_state(database_id, schema_hash, row_count, indexed_at, mode)
           VALUES (?, ?, ?, ?, 'targeted')
           ON CONFLICT(database_id) DO UPDATE SET
             schema_hash = excluded.schema_hash,
             row_count = excluded.row_count,
             indexed_at = excluded.indexed_at,
             mode = excluded.mode`,
        )
        .run(database.id, schemaHash, database.rows.length, now);
    });
    try {
      tx();
    } catch (error) {
      console.warn("TARGETED_DATABASE_ROW_INDEX_UPDATE_FAILED", database.id, error);
      this.rebuildDatabaseRowIndex(database);
    }
  }

  private upsertDatabaseRowIndexIncremental(database: WorkspaceDatabase): void {
    const now = new Date().toISOString();
    const schemaHash = this.databaseIndexSchemaHash(database);
    const state = this.db
      .prepare(
        "SELECT schema_hash FROM database_index_state WHERE database_id = ?",
      )
      .get(database.id) as { schema_hash?: string } | undefined;
    const indexedCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM database_row_index WHERE database_id = ?",
        )
        .get(database.id) as { count: number }
    ).count;
    const hashCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM database_row_hash_index WHERE database_id = ?",
        )
        .get(database.id) as { count: number }
    ).count;

    if (
      !state ||
      state.schema_hash !== schemaHash ||
      indexedCount === 0 ||
      hashCount !== indexedCount
    ) {
      this.rebuildDatabaseRowIndex(database);
      return;
    }

    const existingRows = this.db
      .prepare(
        "SELECT row_id, row_hash, row_order FROM database_row_hash_index WHERE database_id = ?",
      )
      .all(database.id) as Array<{
      row_id: string;
      row_hash: string;
      row_order: number;
    }>;
    const existing = new Map(existingRows.map((row) => [row.row_id, row]));
    const incomingIds = new Set(database.rows.map((row) => row.id));

    const tx = this.db.transaction(() => {
      for (const row of existingRows) {
        if (!incomingIds.has(row.row_id))
          this.deleteDatabaseRowIndexEntry(database.id, row.row_id);
      }

      database.rows.forEach((row, index) => {
        const rowHash = this.databaseRowIndexHash(row);
        const prev = existing.get(row.id);
        if (!prev || prev.row_hash !== rowHash) {
          this.upsertDatabaseRowIndexEntry(database, row, index);
          return;
        }
        if (prev.row_order !== index) {
          this.db
            .prepare(
              "UPDATE database_row_index SET row_order = ? WHERE database_id = ? AND row_id = ?",
            )
            .run(index, database.id, row.id);
          this.db
            .prepare(
              "UPDATE database_row_hash_index SET row_order = ?, updated_at = ? WHERE database_id = ? AND row_id = ?",
            )
            .run(index, row.updatedAt ?? "", database.id, row.id);
        }
      });

      this.db
        .prepare(
          `
        INSERT INTO database_index_meta(database_id, row_count, indexed_at)
        VALUES (?, ?, ?)
        ON CONFLICT(database_id) DO UPDATE SET row_count = excluded.row_count, indexed_at = excluded.indexed_at
      `,
        )
        .run(database.id, database.rows.length, now);
      this.db
        .prepare(
          `
        INSERT INTO database_index_state(database_id, schema_hash, row_count, indexed_at, mode)
        VALUES (?, ?, ?, ?, 'incremental')
        ON CONFLICT(database_id) DO UPDATE SET
          schema_hash = excluded.schema_hash,
          row_count = excluded.row_count,
          indexed_at = excluded.indexed_at,
          mode = excluded.mode
      `,
        )
        .run(database.id, schemaHash, database.rows.length, now);
    });
    tx();
  }

  async rebuildDatabaseIndexCore(id: string): Promise<DatabasePerformanceInfo> {
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");
    this.upsertDatabaseSummaryIndex(database);
    this.rebuildDatabaseRowIndex(database);
    return this.getDatabasePerformance(id);
  }

  async getDatabasePerformanceCore(
    id: string,
  ): Promise<DatabasePerformanceInfo> {
    const summary = this.getDatabaseSummary(id);
    const database = summary ?? (await this.getDatabase(id));
    if (!database) throw new Error("Database not found");
    const indexed = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM database_row_index WHERE database_id = ?",
      )
      .get(id) as { count: number };
    const meta = this.db
      .prepare(
        "SELECT indexed_at FROM database_index_meta WHERE database_id = ?",
      )
      .get(id) as { indexed_at?: string } | undefined;
    const rowCount = summary
      ? ((
          this.db
            .prepare(
              "SELECT row_count FROM database_summary_index WHERE database_id = ?",
            )
            .get(id) as { row_count?: number } | undefined
        )?.row_count ??
        indexed?.count ??
        0)
      : database.rows.length;
    return {
      databaseId: id,
      rowCount,
      indexedRowCount: indexed?.count ?? 0,
      lastIndexedAt: meta?.indexed_at ?? null,
      recommendedMode:
        rowCount >= 10000 ? "server" : rowCount >= 2000 ? "large" : "normal",
      indexes: [
        "database_summary_index",
        "database_id + row_order",
        "database_id + updated_at",
        "database_id + title_text",
        "FTS5 search_text",
      ],
    };
  }

  async getDatabaseIndexInfo(): Promise<any> {
    const tableExists = (name: string) =>
      this.sqliteTableExistsSafe(this.db, name);
    const count = (name: string, where = "") =>
      tableExists(name) ? this.sqliteCountSafe(this.db, name, where) : 0;
    const summaries = count("database_summary_index");
    const rows = count("database_row_index");
    const props = count("database_row_property_index");
    const fts = count("database_row_fts");
    const meta = count("database_index_meta");
    const rowHashes = count("database_row_hash_index");
    const indexStates = count("database_index_state");
    let staleOrMissing = 0;
    let totalExpectedRows = 0;
    if (tableExists("database_summary_index")) {
      const items = this.db
        .prepare(
          `
        SELECT s.database_id, s.title, s.row_count,
          COALESCE((SELECT COUNT(*) FROM database_row_index r WHERE r.database_id = s.database_id), 0) AS indexed_rows,
          COALESCE((SELECT COUNT(*) FROM database_row_property_index p WHERE p.database_id = s.database_id), 0) AS indexed_props
        FROM database_summary_index s
        WHERE COALESCE(s.trashed, 0) = 0
      `,
        )
        .all() as any[];
      totalExpectedRows = items.reduce(
        (sum, item) => sum + Number(item.row_count || 0),
        0,
      );
      staleOrMissing = items.filter(
        (item) =>
          Number(item.indexed_rows || 0) !== Number(item.row_count || 0) ||
          (Number(item.row_count || 0) > 0 &&
            Number(item.indexed_props || 0) <= 0),
      ).length;
    }
    const lastIndexed = tableExists("database_index_meta")
      ? ((
          this.db
            .prepare(
              "SELECT MAX(indexed_at) as lastIndexedAt FROM database_index_meta",
            )
            .get() as any
        )?.lastIndexedAt ?? null)
      : null;
    return {
      ok: true,
      mode: "database-index-v340-incremental-save",
      summaries,
      rows,
      propertyValues: props,
      ftsRows: fts,
      metaRows: meta,
      rowHashes,
      indexStates,
      totalExpectedRows,
      staleOrMissing,
      lastIndexedAt: lastIndexed,
      tables: [
        "database_summary_index",
        "database_row_index",
        "database_row_property_index",
        "database_row_fts",
        "database_index_meta",
        "database_row_hash_index",
        "database_index_state",
      ],
      recommendation:
        staleOrMissing > 0 || summaries <= 0
          ? "DB Index再構築を実行してください。"
          : "DB Indexは利用可能です。",
    };
  }

  async rebuildAllDatabaseIndexes(): Promise<any> {
    const started = Date.now();
    const databases = await this.listDatabasesCore();
    let databasesIndexed = 0;
    let rowsIndexed = 0;
    for (const database of databases) {
      try {
        this.upsertDatabaseSummaryIndex(database);
        this.rebuildDatabaseRowIndex(database);
        databasesIndexed += 1;
        rowsIndexed += database.rows?.length ?? 0;
      } catch (error) {
        // Continue rebuilding other DBs; the UI can inspect status after completion.
        console.warn("Failed to rebuild database index", database.id, error);
      }
    }
    const info = await this.getDatabaseIndexInfo();
    return {
      ok: true,
      mode: "database-index-rebuild-v339",
      databasesIndexed,
      rowsIndexed,
      propertyValues: info.propertyValues,
      elapsedMs: Date.now() - started,
      info,
    };
  }

  private isSqliteIndexableDatabaseFilter(
    filter: DatabaseFilter,
    property?: DatabaseProperty,
  ): boolean {
    if (!property) return false;
    if (["relation", "rollup"].includes(property.type)) return false;
    return [
      "contains",
      "not_contains",
      "equals",
      "not_equals",
      "starts_with",
      "ends_with",
      "greater_than",
      "less_than",
      "before",
      "after",
      "today",
      "this_week",
      "this_month",
      "overdue",
      "is_empty",
      "is_not_empty",
    ].includes(filter.operator);
  }

  private isSqliteIndexableDatabaseSort(
    sort: DatabaseSort,
    property?: DatabaseProperty,
  ): boolean {
    if (!property) return false;
    return !["relation", "rollup"].includes(property.type);
  }

  private databaseFilterSql(
    filter: DatabaseFilter,
    property: DatabaseProperty,
    params: any[],
  ): string | null {
    const propertyId = String(filter.propertyId);
    const operator = String(filter.operator);
    const expectedText = dbCellPlainText(filter.value).toLowerCase();
    const escapedLike = (value: string) =>
      value.replace(/[\\%_]/g, (m) => `\\${m}`);
    const existsBase = (condition: string) =>
      `EXISTS (SELECT 1 FROM database_row_property_index p WHERE p.database_id = r.database_id AND p.row_id = r.row_id AND p.property_id = ? AND ${condition})`;
    const notExistsBase = (condition: string) =>
      `NOT EXISTS (SELECT 1 FROM database_row_property_index p WHERE p.database_id = r.database_id AND p.row_id = r.row_id AND p.property_id = ? AND ${condition})`;
    const pushProp = () => params.push(propertyId);
    const todayYmd = jstYmd();
    switch (operator) {
      case "contains":
        pushProp();
        params.push(`%${escapedLike(expectedText)}%`);
        return existsBase(`p.text_value_lower LIKE ? ESCAPE '\\'`);
      case "not_contains":
        pushProp();
        params.push(`%${escapedLike(expectedText)}%`);
        return notExistsBase(`p.text_value_lower LIKE ? ESCAPE '\\'`);
      case "equals":
        pushProp();
        if (property.type === "checkbox") {
          params.push(dbCellBoolean(filter.value));
          return existsBase("p.boolean_value IS ?");
        }
        if (property.type === "number") {
          params.push(dbCellNumber(filter.value));
          return existsBase("p.number_value = ?");
        }
        params.push(expectedText);
        return existsBase("p.text_value_lower = ?");
      case "not_equals":
        pushProp();
        if (property.type === "checkbox") {
          params.push(dbCellBoolean(filter.value));
          return notExistsBase("p.boolean_value IS ?");
        }
        if (property.type === "number") {
          params.push(dbCellNumber(filter.value));
          return notExistsBase("p.number_value = ?");
        }
        params.push(expectedText);
        return notExistsBase("p.text_value_lower = ?");
      case "starts_with":
        pushProp();
        params.push(`${escapedLike(expectedText)}%`);
        return existsBase(`p.text_value_lower LIKE ? ESCAPE '\\'`);
      case "ends_with":
        pushProp();
        params.push(`%${escapedLike(expectedText)}`);
        return existsBase(`p.text_value_lower LIKE ? ESCAPE '\\'`);
      case "greater_than":
        pushProp();
        params.push(dbCellNumber(filter.value));
        return existsBase("p.number_value > ?");
      case "less_than":
        pushProp();
        params.push(dbCellNumber(filter.value));
        return existsBase("p.number_value < ?");
      case "before":
        pushProp();
        params.push(dbCellDateText(filter.value));
        return existsBase("p.date_value IS NOT NULL AND p.date_value < ?");
      case "after":
        pushProp();
        params.push(dbCellDateText(filter.value));
        return existsBase("p.date_value IS NOT NULL AND p.date_value > ?");
      case "today":
        pushProp();
        params.push(todayYmd);
        return existsBase("p.date_value = ?");
      case "this_week": {
        const start = addDaysToYmd(todayYmd, -weekdayOfYmd(todayYmd));
        const end = addDaysToYmd(start, 7);
        pushProp();
        params.push(start, end);
        return existsBase("p.date_value >= ? AND p.date_value < ?");
      }
      case "this_month":
        pushProp();
        params.push(`${todayYmd.slice(0, 7)}%`);
        return existsBase("p.date_value LIKE ?");
      case "overdue":
        pushProp();
        params.push(todayYmd);
        return existsBase("p.date_value IS NOT NULL AND p.date_value < ?");
      case "is_empty":
        pushProp();
        return existsBase("p.empty_value = 1");
      case "is_not_empty":
        pushProp();
        return existsBase("p.empty_value = 0");
      default:
        return null;
    }
  }

  private databaseSortSql(
    sort: DatabaseSort,
    property: DatabaseProperty,
    params: any[],
  ): string | null {
    params.push(String(sort.propertyId));
    const direction = sort.direction === "desc" ? "DESC" : "ASC";
    const column =
      property.type === "number"
        ? "p.number_value"
        : property.type === "date"
          ? "p.date_value"
          : property.type === "checkbox"
            ? "p.boolean_value"
            : "p.text_value_lower";
    return `(SELECT ${column} FROM database_row_property_index p WHERE p.database_id = r.database_id AND p.row_id = r.row_id AND p.property_id = ?) ${direction}`;
  }

  private canQueryDatabaseRowsWithSqliteView(
    view: DatabaseView | undefined,
    database: WorkspaceDatabase,
  ): boolean {
    const props = new Map(
      (database.properties ?? []).map((prop) => [prop.id, prop]),
    );
    const filters = view?.filters ?? [];
    const sorts = view?.sorts ?? [];
    if (filters.length > 8 || sorts.length > 4) return false;
    return (
      filters.every((filter) =>
        this.isSqliteIndexableDatabaseFilter(
          filter,
          props.get(filter.propertyId),
        ),
      ) &&
      sorts.every((sort) =>
        this.isSqliteIndexableDatabaseSort(sort, props.get(sort.propertyId)),
      )
    );
  }

  private queryDatabaseRowsWithSqliteView(
    id: string,
    database: WorkspaceDatabase,
    view: DatabaseView | undefined,
    page: number,
    pageSize: number,
    offset: number,
    started: number,
  ): DatabaseQueryResult | null {
    if (!view || !this.canQueryDatabaseRowsWithSqliteView(view, database))
      return null;
    const propIndexCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM database_row_property_index WHERE database_id = ?",
        )
        .get(id) as { count: number }
    ).count;
    if (
      propIndexCount <= 0 &&
      ((view.filters?.length ?? 0) > 0 || (view.sorts?.length ?? 0) > 0)
    )
      return null;
    const props = new Map(
      (database.properties ?? []).map((prop) => [prop.id, prop]),
    );
    const params: any[] = [id];
    const whereParts: string[] = [];
    for (const filter of view.filters ?? []) {
      const prop = props.get(filter.propertyId);
      if (!prop) return null;
      const sql = this.databaseFilterSql(filter, prop, params);
      if (!sql) return null;
      whereParts.push(sql);
    }
    const orderParams: any[] = [];
    const orderParts: string[] = [];
    for (const sort of view.sorts ?? []) {
      const prop = props.get(sort.propertyId);
      if (!prop) return null;
      const sql = this.databaseSortSql(sort, prop, orderParams);
      if (!sql) return null;
      orderParts.push(sql);
    }
    orderParts.push("r.row_order ASC");
    const filterJoin = view.filterLogic === "or" ? " OR " : " AND ";
    const where = whereParts.length ? ` AND (${whereParts.join(filterJoin)})` : "";
    const orderBy = orderParts.join(", ");
    const rows = this.db
      .prepare(
        `
      SELECT r.row_id, r.cells_json, r.created_at, r.updated_at
      FROM database_row_index r
      WHERE r.database_id = ?${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, ...orderParams, pageSize, offset) as any[];
    const total = (
      this.db
        .prepare(
          `
      SELECT COUNT(*) as count
      FROM database_row_index r
      WHERE r.database_id = ?${where}
    `,
        )
        .get(...params) as { count: number }
    ).count;
    return {
      databaseId: id,
      viewId: view.id,
      rows: rows.map((row) => this.databaseRowFromIndex(row)),
      total,
      page,
      pageSize,
      hasMore: offset + rows.length < total,
      nextCursor: offset + rows.length < total ? String(page + 1) : null,
      mode: "sqlite-index",
      elapsedMs: Date.now() - started,
    };
  }

  async queryDatabaseRowsCore(
    id: string,
    input: {
      viewId?: string;
      q?: string;
      page?: number;
      pageSize?: number;
      cursor?: string;
    },
  ): Promise<DatabaseQueryResult> {
    const started = Date.now();
    let database = this.getDatabaseSummary(id);
    let loadedFullDatabase = false;
    if (!database) {
      database = await this.getDatabase(id);
      loadedFullDatabase = true;
    }
    if (!database) throw new Error("Database not found");

    const pageSize = Math.max(
      25,
      Math.min(500, Number(input.pageSize ?? 100) || 100),
    );
    const page = Math.max(1, Number(input.page ?? 1) || 1);
    const offset = (page - 1) * pageSize;
    const activeViewId = database.activeViewId;
    const view =
      database.views?.find((v) => v.id === (input.viewId ?? activeViewId)) ??
      database.views?.[0];
    const q = String(input.q ?? "").trim();
    const indexedCount = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM database_row_index WHERE database_id = ?",
        )
        .get(id) as { count: number }
    ).count;
    const summaryRow = this.db
      .prepare(
        "SELECT row_count FROM database_summary_index WHERE database_id = ?",
      )
      .get(id) as { row_count?: number } | undefined;
    const expectedRowCount =
      summaryRow?.row_count ??
      (loadedFullDatabase ? database.rows.length : indexedCount);

    if (indexedCount !== expectedRowCount) {
      // Index is stale. Load the full JSON only for repair, then retry on the index.
      const full = loadedFullDatabase ? database : await this.getDatabase(id);
      if (!full) throw new Error("Database not found");
      database = full;
      loadedFullDatabase = true;
      this.upsertDatabaseSummaryIndex(full);
      this.rebuildDatabaseRowIndex(full);
    }

    let mode: DatabaseQueryResult["mode"] = "sqlite-index";

    if (q) {
      // CJK-friendly server-side search. LIKE over indexed search_text is reliable for Japanese terms.
      const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
      const whereParts = words.map(() => "LOWER(search_text) LIKE ?");
      const params = words.map((word) => `%${word.replace(/[%_]/g, "")}%`);
      const where = whereParts.length ? ` AND (${whereParts.join(" AND ")})` : "";
      const indexedRows = this.db
        .prepare(
          `
        SELECT row_id, cells_json, created_at, updated_at FROM database_row_index
        WHERE database_id = ?${where}
        ORDER BY row_order ASC
        LIMIT ? OFFSET ?
      `,
        )
        .all(id, ...params, pageSize, offset) as any[];
      const rows = indexedRows.map((row) => this.databaseRowFromIndex(row));
      const total = (
        this.db
          .prepare(
            `SELECT COUNT(*) as count FROM database_row_index WHERE database_id = ?${where}`,
          )
          .get(id, ...params) as { count: number }
      ).count;
      return {
        databaseId: id,
        viewId: view?.id,
        rows,
        total,
        page,
        pageSize,
        hasMore: offset + rows.length < total,
        nextCursor: offset + rows.length < total ? String(page + 1) : null,
        mode,
        elapsedMs: Date.now() - started,
      };
    }

    if (!view?.filters?.length && !view?.sorts?.length) {
      const indexedRows = this.db
        .prepare(
          `
        SELECT row_id, cells_json, created_at, updated_at FROM database_row_index
        WHERE database_id = ?
        ORDER BY row_order ASC
        LIMIT ? OFFSET ?
      `,
        )
        .all(id, pageSize, offset) as any[];
      const rows = indexedRows.map((row) => this.databaseRowFromIndex(row));
      const total = expectedRowCount;
      return {
        databaseId: id,
        viewId: view?.id,
        rows,
        total,
        page,
        pageSize,
        hasMore: offset + rows.length < total,
        nextCursor: offset + rows.length < total ? String(page + 1) : null,
        mode,
        elapsedMs: Date.now() - started,
      };
    }

    const sqliteViewResult = this.queryDatabaseRowsWithSqliteView(
      id,
      database,
      view,
      page,
      pageSize,
      offset,
      started,
    );
    if (sqliteViewResult) return sqliteViewResult;

    // Complex filters/sorts still need the full DB. Unsupported relation/rollup or very complex views fall back safely.
    if (!loadedFullDatabase) {
      const full = await this.getDatabase(id);
      if (!full) throw new Error("Database not found");
      database = full;
      loadedFullDatabase = true;
    }

    let rows = database.rows;
    mode = "json-fallback";
    if (view?.filters?.length) {
      rows = rows.filter((row) =>
        view.filters!.every((filter) =>
          dbFilterMatches(
            row.cells[filter.propertyId],
            filter.operator,
            filter.value,
          ),
        ),
      );
    }
    if (view?.sorts?.length) {
      rows = [...rows].sort((a, b) => {
        for (const sort of view.sorts ?? []) {
          const prop = database!.properties.find(
            (p) => p.id === sort.propertyId,
          );
          const factor = sort.direction === "desc" ? -1 : 1;
          const av = a.cells[sort.propertyId];
          const bv = b.cells[sort.propertyId];
          const result =
            prop?.type === "number"
              ? dbCellNumber(av) - dbCellNumber(bv)
              : dbCellPlainText(av).localeCompare(dbCellPlainText(bv), "ja");
          if (result !== 0) return result * factor;
        }
        return 0;
      });
    }
    const total = rows.length;
    const pagedRows = rows.slice(offset, offset + pageSize);
    return {
      databaseId: id,
      viewId: view?.id,
      rows: pagedRows,
      total,
      page,
      pageSize,
      hasMore: offset + pagedRows.length < total,
      nextCursor: offset + pagedRows.length < total ? String(page + 1) : null,
      mode,
      elapsedMs: Date.now() - started,
    };
  }

  /**
   * Exact table footer aggregates for server-paged tables.
   *
   * The renderer deliberately receives only one page of rows in large-table
   * mode. Computing a footer from that page is misleading, so this method
   * applies the active view/search on the server and returns only compact
   * aggregate values. It is intentionally read-only and never rebuilds an
   * index as part of a normal table render.
   */
  async aggregateDatabaseRowsCore(
    id: string,
    input: DatabaseAggregateRequest,
  ): Promise<DatabaseAggregateResult> {
    const started = Date.now();
    const database = await this.getDatabase(id);
    if (!database) throw new Error("Database not found");

    const view =
      database.views?.find((item) => item.id === (input.viewId ?? database.activeViewId)) ??
      database.views?.[0];
    const searchWords = String(input.q ?? "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8);

    let rows = database.rows;
    if (view?.filters?.length) {
      rows = rows.filter((row) =>
        view.filters!.every((filter) =>
          dbFilterMatches(row.cells[filter.propertyId], filter.operator, filter.value),
        ),
      );
    }
    if (searchWords.length) {
      rows = rows.filter((row) => {
        const text = database.properties
          .filter((property) => property.type !== "formula" && property.type !== "rollup")
          .map((property) => dbCellPlainText(row.cells[property.id]).toLowerCase())
          .join(" ");
        return searchWords.every((word) => text.includes(word));
      });
    }

    const values: Record<string, string> = {};
    const unsupportedPropertyIds: string[] = [];
    const requested = Object.entries(input.aggregates ?? {}).slice(0, 100);
    const format = (value: number) =>
      Number.isInteger(value)
        ? value.toLocaleString("ja-JP")
        : value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
    const isFilled = (value: unknown) => {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value;
      return dbCellPlainText(value).trim().length > 0;
    };
    const isChecked = (value: unknown) => dbCellBoolean(value) === 1;

    for (const [propertyId, mode] of requested) {
      if (!mode || mode === "none") continue;
      const property = database.properties.find((item) => item.id === propertyId);
      if (!property) continue;
      // Formula/Rollup values are computed in the renderer and may reference
      // another DB. Returning a fabricated server value is worse than showing
      // the current-page fallback, so callers can label these explicitly.
      if (property.type === "formula" || property.type === "rollup") {
        unsupportedPropertyIds.push(propertyId);
        continue;
      }
      const rawValues = rows.map((row) => row.cells[propertyId]);
      const filled = rawValues.filter(isFilled);
      if (mode === "count") { values[propertyId] = `${rawValues.length.toLocaleString("ja-JP")}件`; continue; }
      if (mode === "filled") { values[propertyId] = `${filled.length.toLocaleString("ja-JP")}件`; continue; }
      if (mode === "empty") { values[propertyId] = `${Math.max(0, rawValues.length - filled.length).toLocaleString("ja-JP")}件`; continue; }
      if (mode === "unique") { values[propertyId] = `${new Set(filled.map((value) => dbCellPlainText(value))).size.toLocaleString("ja-JP")}件`; continue; }
      if (mode === "checked") { values[propertyId] = `${rawValues.filter(isChecked).length.toLocaleString("ja-JP")}件`; continue; }
      if (mode === "unchecked") { values[propertyId] = `${rawValues.filter((value) => !isChecked(value)).length.toLocaleString("ja-JP")}件`; continue; }
      if (mode === "percent_checked") {
        values[propertyId] = rawValues.length ? `${Math.round((rawValues.filter(isChecked).length / rawValues.length) * 100)}%` : "0%";
        continue;
      }
      const numbers = filled.map((value) => dbCellNumber(value)).filter((value): value is number => Number.isFinite(value));
      if (!numbers.length) { values[propertyId] = "—"; continue; }
      const sorted = [...numbers].sort((a, b) => a - b);
      if (mode === "sum") values[propertyId] = format(numbers.reduce((total, value) => total + value, 0));
      else if (mode === "average") values[propertyId] = format(numbers.reduce((total, value) => total + value, 0) / numbers.length);
      else if (mode === "median") { const middle = Math.floor(sorted.length / 2); values[propertyId] = format(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2); }
      else if (mode === "min") values[propertyId] = format(sorted[0]);
      else if (mode === "max") values[propertyId] = format(sorted[sorted.length - 1]);
      else if (mode === "range") values[propertyId] = format(sorted[sorted.length - 1] - sorted[0]);
    }

    return {
      databaseId: id,
      viewId: view?.id,
      total: rows.length,
      values,
      unsupportedPropertyIds,
      elapsedMs: Date.now() - started,
    };
  }

  private async enforceDatabaseScopeRules(
    database: WorkspaceDatabase,
  ): Promise<WorkspaceDatabase> {
    if (database.scope !== "shared") return database;

    // v341: avoid reading every database JSON and checking every page lock during DB save.
    // Scope safety only needs IDs, so use lightweight SQLite indexes. If the summary
    // index has not been built yet, fall back to the previous full read path.
    let privateDatabaseIds = this.privateDatabaseIdsFromSummaryIndex();
    if (
      privateDatabaseIds.size === 0 &&
      this.countDatabasesFromSummaryIndex(true) === 0
    ) {
      const allDatabases = await this.listDatabases().catch(() => []);
      privateDatabaseIds = new Set(
        allDatabases.filter((db) => db.scope === "private").map((db) => db.id),
      );
    }
    const privatePageIds = this.privatePageIdsFromSqlite();

    const properties = database.properties.map((prop) => {
      if (prop.type !== "relation") return prop;
      const targetType = prop.relationTargetType ?? "database";
      if (
        targetType === "database" &&
        prop.relationDatabaseId &&
        privateDatabaseIds.has(prop.relationDatabaseId)
      ) {
        return {
          ...prop,
          relationDatabaseId: database.id,
          bidirectionalRelationPropertyId: undefined,
        };
      }
      return prop;
    });

    const rows = database.rows.map((row) => {
      let cells = row.cells;
      for (const prop of properties) {
        if (prop.type !== "relation") continue;
        const targetType = prop.relationTargetType ?? "database";
        const rawValue = cells[prop.id];
        const value = Array.isArray(rawValue) ? rawValue.map(String) : [];
        let next = value;
        if (targetType === "page")
          next = value.filter((id) => !privatePageIds.has(id));
        if (
          targetType === "database" &&
          prop.relationDatabaseId &&
          privateDatabaseIds.has(prop.relationDatabaseId)
        )
          next = [];
        if (next.length !== value.length) cells = { ...cells, [prop.id]: next };
      }
      return cells === row.cells
        ? row
        : { ...row, cells, updatedAt: database.updatedAt };
    });

    return { ...database, properties, rows };
  }

  private normalizeDatabase(
    input: Partial<WorkspaceDatabase>,
    fallbackId: string,
  ): WorkspaceDatabase {
    const now = new Date().toISOString();
    const properties = Array.isArray(input.properties)
      ? input.properties.map((p: any) => ({
          id: p.id || `prop_${nanoid(10)}`,
          name: p.name || "Property",
          type: [
            "text",
            "number",
            "select",
            "status",
            "multi_select",
            "unique_id",
            "button",
            "date",
            "checkbox",
            "url",
            "phone",
            "email",
            "created_time",
            "last_edited_time",
            "relation",
            "rollup",
            "formula",
          ].includes(p.type)
            ? p.type
            : "text",
          relationTargetType: ["database", "page", "journal"].includes(
            p.relationTargetType,
          )
            ? p.relationTargetType
            : undefined,
          relationDatabaseId: p.relationDatabaseId || undefined,
          isSubItemRelation: p.isSubItemRelation === true && p.type === "relation" && (p.relationTargetType ?? "database") === "database" && (p.relationDatabaseId || input.id || fallbackId) === (input.id || fallbackId),
          isDependencyRelation: p.isDependencyRelation === true && p.type === "relation" && (p.relationTargetType ?? "database") === "database" && (p.relationDatabaseId || input.id || fallbackId) === (input.id || fallbackId),
          bidirectionalRelationPropertyId:
            p.bidirectionalRelationPropertyId || undefined,
          rollupRelationPropertyId: p.rollupRelationPropertyId || undefined,
          rollupTargetPropertyId: p.rollupTargetPropertyId || undefined,
          rollupFunction: [
            "count",
            "count_checked",
            "count_unchecked",
            "percent_checked",
            "count_status_done",
            "count_status_open",
            "percent_status_done",
            "sum",
            "average",
            "min",
            "max",
            "show_unique",
          ].includes(p.rollupFunction)
            ? p.rollupFunction
            : undefined,
          formulaExpression:
            typeof p.formulaExpression === "string"
              ? p.formulaExpression
              : undefined,
          options: Array.isArray(p.options) ? p.options : (p.type === "status" ? ["未着手", "進行中", "完了"] : undefined),
          uniqueIdPrefix: typeof p.uniqueIdPrefix === "string" ? p.uniqueIdPrefix.slice(0, 24) : undefined,
          uniqueIdDigits: Number.isFinite(Number(p.uniqueIdDigits)) ? Math.max(1, Math.min(10, Number(p.uniqueIdDigits))) : undefined,
          buttonAction: p.buttonAction === "set_today" ? "set_today" : p.buttonAction === "mark_status_done" ? "mark_status_done" : undefined,
          buttonTargetPropertyId: typeof p.buttonTargetPropertyId === "string" ? p.buttonTargetPropertyId : undefined,
        }))
      : [];
    const rows = Array.isArray(input.rows)
      ? input.rows.map((r: any) => ({
          id: r.id || `row_${nanoid(10)}`,
          cells: r.cells || {},
          createdAt: r.createdAt || now,
          updatedAt: r.updatedAt || r.createdAt || now,
        }))
      : [];
    // Canonicalize sub-item links at the persistence boundary. Legacy/imported files
    // can contain multiple parents or cycles; keeping only one valid parent prevents
    // duplicate hierarchy rendering and makes a row update deterministic.
    const subItemProperty = properties.find((item) => item.type === "relation" && item.isSubItemRelation);
    if (subItemProperty) {
      const rowById = new Map(rows.map((row) => [row.id, row]));
      for (const row of rows) {
        const rawParentValue = row.cells?.[subItemProperty.id];
        const raw: string[] = Array.isArray(rawParentValue)
          ? rawParentValue.map((value: string) => String(value))
          : [];
        const parentId = raw.find((id: string) => id && id !== row.id && rowById.has(id));
        row.cells[subItemProperty.id] = parentId ? [parentId] : [];
      }
      for (const row of rows) {
        const seen = new Set<string>([row.id]);
        let cursor = String((row.cells[subItemProperty.id] || [])[0] || "");
        let invalid = false;
        while (cursor) {
          if (seen.has(cursor)) { invalid = true; break; }
          seen.add(cursor);
          const nextRow = rowById.get(cursor);
          cursor = String((nextRow?.cells?.[subItemProperty.id] || [])[0] || "");
        }
        if (invalid) row.cells[subItemProperty.id] = [];
      }
    }

    for (const property of properties.filter((item) => item.type === "unique_id")) {
      const prefix = String(property.uniqueIdPrefix || property.name || "ID").trim().slice(0, 24) || "ID";
      const digits = Math.max(1, Math.min(10, Number(property.uniqueIdDigits || 4)));
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`^${escaped}-(\\d+)$`);
      let next = 1;
      for (const row of rows) {
        const match = String(row.cells?.[property.id] || "").match(pattern);
        if (match) next = Math.max(next, (Number(match[1]) || 0) + 1);
      }
      for (const row of rows) {
        if (!String(row.cells?.[property.id] || "").trim()) {
          row.cells[property.id] = `${prefix}-${String(next++).padStart(digits, "0")}`;
        }
      }
    }
    const views: DatabaseView[] =
      Array.isArray((input as any).views) && (input as any).views.length > 0
        ? (input as any).views.map((v: any) => ({
            id: v.id || `view_${nanoid(10)}`,
            name: v.name || "Table",
            type: normalizeDatabaseViewType(v.type),
            groupByPropertyId: v.groupByPropertyId || undefined,
            visiblePropertyIds: Array.isArray(v.visiblePropertyIds)
              ? v.visiblePropertyIds
              : undefined,
            datePropertyId: v.datePropertyId || undefined,
            startDatePropertyId: v.startDatePropertyId || undefined,
            endDatePropertyId: v.endDatePropertyId || undefined,
            collapsedGroupIds: Array.isArray(v.collapsedGroupIds)
              ? v.collapsedGroupIds.map(String)
              : undefined,
            filterLogic: v.filterLogic === "or" ? "or" : "and",
            filters: Array.isArray(v.filters)
              ? v.filters.map((f: any) => ({
                  id: f.id || `filter_${nanoid(10)}`,
                  propertyId: f.propertyId || properties[0]?.id || "",
                  operator: normalizeDatabaseFilterOperator(f.operator),
                  value: f.value ?? "",
                }))
              : [],
            sorts: Array.isArray(v.sorts)
              ? v.sorts.map((sort: any) => ({
                  id: sort.id || `sort_${nanoid(10)}`,
                  propertyId: sort.propertyId || properties[0]?.id || "",
                  direction: sort.direction === "desc" ? "desc" : "asc",
                }))
              : [],
          }))
        : [
            {
              id: "view_default",
              name: "Default Table",
              type: "table",
              filters: [],
              sorts: [],
            },
          ];
    const activeViewId =
      (input as any).activeViewId &&
      views.some((v) => v.id === (input as any).activeViewId)
        ? (input as any).activeViewId
        : views[0]?.id;
    return {
      id: input.id || fallbackId,
      title: input.title || "Untitled Database",
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || input.createdAt || now,
      updatedBy: input.updatedBy || this.userLabel(),
      properties,
      rows,
      views,
      activeViewId,
      templates: Array.isArray((input as any).templates)
        ? (input as any).templates.map((t: any) => ({
            id: t.id || `tpl_${nanoid(10)}`,
            name: t.name || "Template",
            cells: t.cells || {},
            createdAt: t.createdAt || now,
          }))
        : undefined,
      trash:
        (input as any).trash && typeof (input as any).trash === "object"
          ? {
              rows: Array.isArray((input as any).trash.rows)
                ? (input as any).trash.rows
                : undefined,
              properties: Array.isArray((input as any).trash.properties)
                ? (input as any).trash.properties
                : undefined,
              views: Array.isArray((input as any).trash.views)
                ? (input as any).trash.views
                : undefined,
            }
          : undefined,
      scope: workspaceScopeFrom(input),
      trashed: Boolean((input as any).trashed),
      deletedAt:
        typeof (input as any).deletedAt === "string"
          ? (input as any).deletedAt
          : null,
    } as WorkspaceDatabase;
  }

  private pageCommitPath(dir: string): string {
    return path.join(dir, "commit.json");
  }

  private async isCommittedPageBundle(
    dir: string,
    expectedPageId?: string,
  ): Promise<boolean> {
    const commitPath = this.pageCommitPath(dir);
    if (!(await fs.pathExists(commitPath))) return true; // Legacy pages remain readable.
    const commit = (await fs.readJson(commitPath).catch(() => null)) as any;
    const meta = (await fs
      .readJson(path.join(dir, "meta.json"))
      .catch(() => null)) as any;
    return isCommittedPageMarker(commit, meta, expectedPageId);
  }

  private async writeBundle(bundle: PageBundle): Promise<void> {
    const p = vaultPaths(this.sharedRoot);
    const scope = bundle.meta.scope === "private" ? "private" : "shared";
    const dir = path.join(
      scope === "private" ? p.privatePages : p.pages,
      sanitizeSegment(bundle.meta.id),
    );
    const otherDir = path.join(
      scope === "private" ? p.pages : p.privatePages,
      sanitizeSegment(bundle.meta.id),
    );
    await fs.ensureDir(dir);
    await fs.remove(otherDir).catch(() => undefined);
    // A pending marker is intentionally written *before* the three files.
    // Legacy folders have no marker, but a new-style folder in the middle of a
    // write must never look like a legacy committed folder to another PC.
    await this.atomicWriteJson(
      this.pageCommitPath(dir),
      createWritingPageCommit(
        bundle.meta.id,
        bundle.meta.updatedAt,
        new Date().toISOString(),
      ),
    );
    await this.atomicWriteJson(path.join(dir, "meta.json"), bundle.meta);
    await this.atomicWriteText(path.join(dir, "content.md"), bundle.markdown);
    await this.atomicWriteJson(
      path.join(dir, "blocksuite.json"),
      bundle.blocksuite,
    );
    await this.atomicWriteJson(
      this.pageCommitPath(dir),
      createCommittedPageCommit(
        bundle.meta.id,
        bundle.meta.updatedAt,
        new Date().toISOString(),
      ),
    );
  }

  private async readSharedMeta(pageId: string): Promise<PageMeta | null> {
    const p = vaultPaths(this.sharedRoot);
    for (const source of [
      { dir: p.pages, scope: "shared" as const },
      { dir: p.privatePages, scope: "private" as const },
    ]) {
      const dir = path.join(source.dir, sanitizeSegment(pageId));
      const metaPath = path.join(dir, "meta.json");
      if (await fs.pathExists(metaPath)) {
        if (!(await this.isCommittedPageBundle(dir, pageId))) return null;
        return normalizeMeta(
          { ...(await fs.readJson(metaPath)), scope: source.scope },
          pageId,
        );
      }
    }
    return null;
  }

  private diffMarkdownLines(
    oldText: string,
    newText: string,
  ): HistoryDiffLine[] {
    return this.pageHistoryService.diff(oldText, newText).lines;
  }

  private dueDateFromTaskText(text: string): string | undefined {
    const m = String(text || "").match(
      /(?:期限|due|Due)?\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/,
    );
    return m?.[1];
  }

  private databaseRowTaskSourceId(databaseId: string, rowId: string): string {
    return `${encodeURIComponent(databaseId)}/${encodeURIComponent(rowId)}`;
  }

  private parseDatabaseRowTaskSourceId(sourceId: string): { databaseId: string; rowId: string } | null {
    const [rawDatabaseId, rawRowId, ...rest] = String(sourceId || "").split("/");
    if (!rawDatabaseId || !rawRowId || rest.length) return null;
    try {
      const databaseId = decodeURIComponent(rawDatabaseId);
      const rowId = decodeURIComponent(rawRowId);
      return databaseId && rowId ? { databaseId, rowId } : null;
    } catch {
      return null;
    }
  }

  private extractTasksFromMarkdown(
    sourceType: "page" | "journal" | "inbox" | "database-row",
    sourceId: string,
    sourceTitle: string,
    sourceIcon: string | null | undefined,
    updatedAt: string,
    raw: string,
  ): import("../../shared/types").TaskItem[] {
    const tasks: import("../../shared/types").TaskItem[] = [];
    const lines = String(raw || "").split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(/^\s*[-*]\s*\[( |x|X)\]\s+(.+)$/);
      if (!match) return;
      const text = match[2].trim();
      if (!text) return;
      tasks.push({
        id: `${sourceType}:${sourceId}:${index}`,
        sourceType,
        sourceId,
        sourceTitle,
        sourceIcon,
        text,
        completed: match[1].toLowerCase() === "x",
        dueDate: this.dueDateFromTaskText(text),
        updatedAt,
        context: line.trim(),
      });
    });
    return tasks;
  }

  private upsertTaskIndexForSource(
    sourceType: "page" | "journal" | "inbox" | "database-row",
    sourceId: string,
    sourceTitle: string,
    sourceIcon: string | null | undefined,
    updatedAt: string,
    raw: string,
  ): void {
    const tasks = this.extractTasksFromMarkdown(
      sourceType,
      sourceId,
      sourceTitle,
      sourceIcon,
      updatedAt,
      raw,
    );
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM task_index WHERE source_type = ? AND source_id = ?",
        )
        .run(sourceType, sourceId);
      const insert = this.db.prepare(
        `INSERT OR REPLACE INTO task_index(id,source_type,source_id,source_title,source_icon,text,completed,due_date,line_index,context,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const task of tasks) {
        const parts = task.id.split(":");
        const lineIndex = Number(parts[parts.length - 1] || 0) || 0;
        insert.run(
          task.id,
          task.sourceType,
          task.sourceId,
          task.sourceTitle,
          task.sourceIcon || null,
          task.text,
          task.completed ? 1 : 0,
          task.dueDate || null,
          lineIndex,
          task.context || "",
          task.updatedAt,
        );
      }
    });
    try {
      tx();
    } catch (error) {
      console.warn("UPSERT_TASK_INDEX_FAILED", sourceType, sourceId, error);
    }
  }

  private listTasksFromIndex(): import("../../shared/types").TaskItem[] {
    const rows = this.db
      .prepare(
        `SELECT id,source_type as sourceType,source_id as sourceId,source_title as sourceTitle,source_icon as sourceIcon,text,completed,due_date as dueDate,updated_at as updatedAt,context FROM task_index ORDER BY completed ASC, updated_at DESC LIMIT 5000`,
      )
      .all() as any[];
    return rows.map((row) => ({
      ...row,
      completed: Boolean(row.completed),
      dueDate: row.dueDate || undefined,
    }));
  }

  private async rebuildTaskIndex(): Promise<number> {
    const txClear = this.db.transaction(() => {
      this.db.prepare("DELETE FROM task_index").run();
    });
    try {
      txClear();
    } catch {}
    let indexed = 0;
    const pageRows = this.db
      .prepare(
        `SELECT id,title,icon,updated_at as updatedAt,markdown FROM pages WHERE trashed = 0 ORDER BY updated_at DESC`,
      )
      .all() as any[];
    for (const row of pageRows) {
      this.upsertTaskIndexForSource(
        "page",
        row.id,
        row.title,
        row.icon,
        row.updatedAt,
        row.markdown || "",
      );
      indexed += 1;
    }
    const journals = await this.listJournalsFromDisk();
    for (const journal of journals) {
      const full = await this.getJournal(journal.date).catch(() => null);
      if (!full) continue;
      this.upsertTaskIndexForSource(
        "journal",
        full.date,
        full.title,
        full.icon,
        full.updatedAt,
        full.markdown || "",
      );
      indexed += 1;
    }
    const inboxItems = await this.listInboxItems().catch(
      () => [] as InboxItem[],
    );
    for (const item of inboxItems) {
      this.upsertTaskIndexForSource(
        "inbox",
        item.id,
        item.title,
        "📥",
        item.updatedAt,
        item.text || "",
      );
      indexed += 1;
    }
    // Database-row body tasks are indexed only for persisted row documents.
    // Empty rows do not need an on-disk read or a task-index entry.
    const databases = await this.listDatabases().catch(() => [] as WorkspaceDatabase[]);
    for (const database of databases) {
      if ((database as any).trashed) continue;
      const scope = database.scope === "private" ? "private" : "shared";
      const rowMap = new Map((database.rows || []).map((row) => [row.id, row]));
      const rowContents = await this.databaseRowContentService()
        .listExistingRowContents(database.id, scope)
        .catch(() => [] as DatabaseRowContent[]);
      for (const rowContent of rowContents) {
        const row = rowMap.get(rowContent.rowId);
        const rowTitle = row ? databaseRowTitle(database, row) : rowContent.title;
        this.upsertTaskIndexForSource(
          "database-row",
          this.databaseRowTaskSourceId(database.id, rowContent.rowId),
          `${database.title} / ${rowTitle}`,
          "🧾",
          rowContent.updatedAt || database.updatedAt,
          rowContent.markdown || "",
        );
        indexed += 1;
      }
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO workspace_summary_cache(cache_key,value_json,content_hash,updated_at) VALUES(?,?,?,?)`,
        )
        .run(
          "task_index_built_v600",
          JSON.stringify({ indexed }),
          String(indexed),
          new Date().toISOString(),
        );
    } catch {}
    return indexed;
  }

  private upsertJournalSummaryIndex(journal: JournalEntry): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO journal_summary_index(date,title,icon,updated_at,preview_snippet,mood,weather,tags_json,full_text) VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          journal.date,
          journal.title || `${journal.date} のジャーナル`,
          journal.icon || "📅",
          journal.updatedAt || new Date().toISOString(),
          String(journal.markdown || "")
            .replace(/\s+/g, " ")
            .slice(0, 180),
          journal.mood || "",
          journal.weather || "",
          JSON.stringify(Array.isArray(journal.tags) ? journal.tags : []),
          [journal.date, journal.title, journal.mood, journal.weather, ...(Array.isArray(journal.tags) ? journal.tags : []), journal.markdown]
            .filter(Boolean)
            .join("\n"),
        );
    } catch (error) {
      console.warn("UPSERT_JOURNAL_SUMMARY_INDEX_FAILED", journal.date, error);
    }
  }

  private listJournalsFromIndex(month?: string): JournalSummary[] {
    const rows = month
      ? (this.db
          .prepare(
            `SELECT date,title,icon,updated_at as updatedAt,preview_snippet as previewSnippet,mood,weather,tags_json as tagsJson FROM journal_summary_index WHERE date LIKE ? ORDER BY date DESC`,
          )
          .all(`${month}%`) as any[])
      : (this.db
          .prepare(
            `SELECT date,title,icon,updated_at as updatedAt,preview_snippet as previewSnippet,mood,weather,tags_json as tagsJson FROM journal_summary_index ORDER BY date DESC`,
          )
          .all() as any[]);
    return rows.map((row) => ({
      date: row.date,
      title: row.title,
      icon: row.icon,
      updatedAt: row.updatedAt,
      previewSnippet: row.previewSnippet || "",
      mood: row.mood || "",
      weather: row.weather || "",
      tags: (() => {
        try {
          return JSON.parse(row.tagsJson || "[]");
        } catch {
          return [];
        }
      })(),
    }));
  }

  private async listJournalsFromDisk(
    month?: string,
  ): Promise<JournalSummary[]> {
    await this.initVault();
    const journalsDir = vaultPaths(this.sharedRoot).journals;
    const entries = await fs.readdir(journalsDir).catch(() => []);
    const items: JournalSummary[] = [];
    for (const entry of entries) {
      if (month && !entry.startsWith(month)) continue;
      const dir = path.join(journalsDir, entry);
      const metaPath = path.join(dir, "journal.json");
      if (!(await fs.pathExists(metaPath))) continue;
      const journal = this.normalizeJournal(
        await fs.readJson(metaPath).catch(() => ({})),
        entry,
      );
      this.upsertJournalSummaryIndex(journal);
      items.push({
        date: journal.date,
        title: journal.title,
        icon: journal.icon,
        updatedAt: journal.updatedAt,
        previewSnippet: journal.markdown.replace(/\s+/g, " ").slice(0, 180),
        mood: journal.mood,
        weather: journal.weather,
        tags: journal.tags,
      });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }

  async rebuildWorkspaceSummaryIndexes(): Promise<any> {
    const startedAt = Date.now();
    const journals = await this.listJournalsFromDisk();
    const taskSourcesIndexed = await this.rebuildTaskIndex();
    await this.updateWorkspaceSummaryCache().catch(() => undefined);
    return {
      ok: true,
      mode: "workspace-summary-index-v336",
      journalsIndexed: journals.length,
      taskSourcesIndexed,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async updateWorkspaceSummaryCache(): Promise<void> {
    try {
      const pagesCount = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) as count FROM pages WHERE trashed = 0")
            .get() as any
        )?.count || 0,
      );
      const databasesCount = this.countDatabasesFromSummaryIndex(false);
      const journalsCount = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) as count FROM journal_summary_index")
            .get() as any
        )?.count || 0,
      );
      const inboxCount = (
        await this.listInboxItems().catch(() => [] as InboxItem[])
      ).filter((item) => item.status !== "archived").length;
      const openTasks = Number(
        (
          this.db
            .prepare(
              "SELECT COUNT(*) as count FROM task_index WHERE completed = 0",
            )
            .get() as any
        )?.count || 0,
      );
      const attachments = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) as count FROM attachment_index")
            .get() as any
        )?.count || 0,
      );
      const conflicts = (await this.listConflicts().catch(() => [])).length;
      const recentPages = this.db
        .prepare(
          `SELECT id,title,parent_id as parentId,icon,created_at as createdAt,updated_at as updatedAt,updated_by as updatedBy,sort_order as sortOrder,favorite,trashed,substr(replace(replace(markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM pages WHERE trashed = 0 ORDER BY updated_at DESC LIMIT 8`,
        )
        .all() as any[];
      const recentJournals = this.listJournalsFromIndex().slice(0, 6);
      const tasks = this.listTasksFromIndex()
        .filter((task) => !task.completed)
        .slice(0, 8);
      const recentAttachments = this.db
        .prepare(
          `SELECT page_id as pageId, attachment_id as id, file_name as fileName, mime_type as mimeType, size, created_at as createdAt, relative_path as relativePath, page_title as pageTitle, page_icon as pageIcon, page_updated_at as pageUpdatedAt FROM attachment_index ORDER BY created_at DESC LIMIT 6`,
        )
        .all() as any[];
      const recentDatabases = (this.db
        .prepare(
          `SELECT database_id as id, title, scope, updated_at as updatedAt, row_count as rowCount,
                  properties_json as propertiesJson, views_json as viewsJson
           FROM database_summary_index
           WHERE trashed = 0
           ORDER BY updated_at DESC
           LIMIT 6`,
        )
        .all() as any[])
        .map((database) => {
          const safeLength = (value: unknown) => {
            try {
              const parsed = JSON.parse(String(value || '[]'));
              return Array.isArray(parsed) ? parsed.length : 0;
            } catch {
              return 0;
            }
          };
          return {
            id: database.id,
            title: database.title,
            scope: database.scope,
            updatedAt: database.updatedAt,
            rowCount: Number(database.rowCount || 0),
            propertyCount: safeLength(database.propertiesJson),
            viewCount: safeLength(database.viewsJson),
          };
        });
      const value = {
        counts: {
          pages: pagesCount,
          databases: databasesCount,
          journals: journalsCount,
          inbox: inboxCount,
          tasksOpen: openTasks,
          attachments,
          conflicts,
          trashed: Number(
            (
              this.db
                .prepare(
                  "SELECT COUNT(*) as count FROM pages WHERE trashed = 1",
                )
                .get() as any
            )?.count || 0,
          ),
        },
        recentPages,
        recentDatabases,
        recentJournals,
        recentAttachments,
        inboxItems: (await this.listInboxItems().catch(() => [] as InboxItem[]))
          .filter((item) => item.status !== "archived")
          .slice(0, 6),
        tasks,
        conflicts: (await this.listConflicts().catch(() => [])).slice(0, 8),
      };
      const json = JSON.stringify(value);
      const hash = createHash("sha256").update(json).digest("hex");
      this.db
        .prepare(
          `INSERT OR REPLACE INTO workspace_summary_cache(cache_key,value_json,content_hash,updated_at) VALUES(?,?,?,?)`,
        )
        .run("dashboard", json, hash, new Date().toISOString());
    } catch (error) {
      console.warn("UPDATE_WORKSPACE_SUMMARY_CACHE_FAILED", error);
    }
  }

  async listTasks(): Promise<import("../../shared/types").TaskItem[]> {
    await this.initVault();
    let tasks = this.listTasksFromIndex();
    const built = this.db
      .prepare(
        "SELECT cache_key FROM workspace_summary_cache WHERE cache_key = ?",
      )
      .get("task_index_built_v600") as any;
    // v600 adds database-row bodies to the task Index. Rebuild once even when
    // page/journal tasks already exist, otherwise older rows would never migrate.
    if (!built) {
      await this.rebuildTaskIndex().catch(() => 0);
      tasks = this.listTasksFromIndex();
    }
    return tasks;
  }

  async updateTask(
    taskId: string,
    patch: { completed?: boolean; dueDate?: string | null },
  ): Promise<import("../../shared/types").TaskItem[]> {
    await this.initVault();
    const parts = String(taskId).split(":");
    const sourceType = parts[0] as "page" | "journal" | "inbox" | "database-row";
    const sourceId = parts.slice(1, -1).join(":");
    const lineIndex = Number(parts[parts.length - 1]);
    if (
      !["page", "journal", "inbox", "database-row"].includes(sourceType) ||
      !sourceId ||
      !Number.isFinite(lineIndex)
    ) {
      throw new Error("Invalid task id");
    }
    const updateMarkdownLine = (raw: string): string => {
      const lines = String(raw || "").split(/\r?\n/);
      if (!lines[lineIndex]) throw new Error("Task line not found");
      const match = lines[lineIndex].match(
        /^(\s*[-*]\s*\[)( |x|X)(\]\s+)(.+)$/,
      );
      if (!match) throw new Error("Task line is not editable");
      let text = match[4].trim();
      if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) {
        text = text
          .replace(/\s*(?:期限|due|Due)?\s*[:：]?\s*\d{4}-\d{2}-\d{2}\s*$/g, "")
          .trim();
        if (patch.dueDate) text = `${text} due: ${patch.dueDate}`;
      }
      const mark =
        typeof patch.completed === "boolean"
          ? patch.completed
            ? "x"
            : " "
          : match[2];
      lines[lineIndex] = `${match[1]}${mark}${match[3]}${text}`;
      return lines.join("\n");
    };

    if (sourceType === "page") {
      const current = this.getPage(sourceId);
      if (!current) throw new Error("Page not found");
      const markdown = updateMarkdownLine(current.markdown || "");
      const meta: PageMeta = {
        ...current.meta,
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      };
      const bundle: PageBundle = { ...current, meta, markdown };
      await this.writeBundle(bundle);
      this.db
        .prepare(
          `UPDATE pages SET updated_at=?, updated_by=?, markdown=? WHERE id=?`,
        )
        .run(meta.updatedAt, meta.updatedBy, markdown, sourceId);
      upsertPageFts(this.db, {
        id: meta.id,
        title: meta.title,
        markdown: bundle.markdown,
        trashed: meta.trashed ? 1 : 0,
      });
      this.upsertPageDerivedIndexes(bundle);
    } else if (sourceType === "journal") {
      const journal = await this.getJournal(sourceId);
      const markdown = updateMarkdownLine(journal.markdown || "");
      await this.saveJournal({ ...journal, markdown });
    } else if (sourceType === "database-row") {
      const parsed = this.parseDatabaseRowTaskSourceId(sourceId);
      if (!parsed) throw new Error("Invalid database row task source");
      const database = await this.getDatabase(parsed.databaseId);
      if (!database) throw new Error("Database not found");
      const row = database.rows.find((item) => item.id === parsed.rowId);
      const scope = database.scope === "private" ? "private" : "shared";
      const current = await this.getDatabaseRowContent(parsed.databaseId, parsed.rowId, {
        title: row ? databaseRowTitle(database, row) : undefined,
        scope,
      });
      const markdown = updateMarkdownLine(current.markdown || "");
      await this.saveDatabaseRowContent({
        databaseId: parsed.databaseId,
        rowId: parsed.rowId,
        title: row ? databaseRowTitle(database, row) : current.title,
        markdown,
        blocksuite: current.blocksuite,
        childPageIds: current.childPageIds,
        baseUpdatedAt: current.updatedAt,
        scope,
      });
    } else {
      const items = await this.readInboxItems();
      const item = items.find((v) => v.id === sourceId);
      if (!item) throw new Error("Inbox item not found");
      const text = updateMarkdownLine(item.text || "");
      await this.updateInboxItem(sourceId, { text });
    }
    return this.listTasks();
  }

  private inboxFile(): string {
    return this.inboxService.file();
  }

  private normalizeInboxItem(input: Partial<InboxItem>): InboxItem {
    return this.inboxService.normalize(input);
  }

  private async readInboxItems(): Promise<InboxItem[]> {
    await this.initVault();
    return this.inboxService.read();
  }

  private async writeInboxItems(items: InboxItem[]): Promise<void> {
    await this.initVault();
    // Legacy internal helper. Item mutations should use InboxService methods below.
    await this.withSharedJsonMutation(this.inboxFile(), () =>
      this.atomicWriteJson(this.inboxFile(), items),
    );
  }

  async listInboxItems(): Promise<InboxItem[]> {
    await this.initVault();
    return this.inboxService.list();
  }

  async createInboxItem(input: Partial<InboxItem>): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.create(input);
  }

  async updateInboxItem(
    id: string,
    patch: Partial<InboxItem>,
  ): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.update(id, patch);
  }

  async deleteInboxItem(id: string): Promise<{ ok: true; id: string }> {
    await this.initVault();
    return this.inboxService.remove(id);
  }

  async addInboxAttachmentFromBase64(
    id: string,
    fileName: string,
    base64: string,
    mimeType?: string,
  ): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.addAttachmentFromBase64(
      id,
      fileName,
      base64,
      mimeType,
    );
  }

  /**
   * Registers a page, Journal, or database-row attachment in the one OCR Inbox.
   * Source files remain in their original location; the OCR queue receives a
   * controlled working copy so its durable cross-PC lease model stays intact.
   */
  async sendAttachmentToOcrCenter(input: {
    sourceType: "page" | "journal" | "database-row";
    attachmentId: string;
    pageId?: string;
    date?: string;
    databaseId?: string;
    rowId?: string;
    scope?: WorkspaceScope;
    sourceTitle?: string;
  }): Promise<InboxItem> {
    await this.initVault();
    let fileName = "attachment";
    let filePath = "";
    let sourceLabel = input.sourceTitle?.trim() || "添付ファイル";

    if (input.sourceType === "page") {
      if (!input.pageId) throw new Error("ページIDがありません");
      const info = await this.getAttachmentInfo(input.pageId, input.attachmentId);
      fileName = info.fileName;
      filePath = await this.getAttachmentFilePath(input.pageId, input.attachmentId);
      sourceLabel = input.sourceTitle?.trim() || this.getPage(input.pageId)?.meta.title || "ページ添付";
    } else if (input.sourceType === "journal") {
      if (!input.date) throw new Error("Journal日付がありません");
      const source = await this.getJournalAttachmentFile(input.date, input.attachmentId);
      fileName = source.attachment.fileName;
      filePath = source.filePath;
      sourceLabel = input.sourceTitle?.trim() || `${input.date} Journal`;
    } else {
      if (!input.databaseId || !input.rowId) throw new Error("データベース行情報がありません");
      const source = await this.getDatabaseRowAttachmentFile(
        input.databaseId,
        input.rowId,
        input.attachmentId,
        input.scope === "private" ? "private" : "shared",
      );
      fileName = source.info.fileName;
      filePath = source.filePath;
      const db = await this.getDatabase(input.databaseId);
      const row = db?.rows.find((candidate) => candidate.id === input.rowId);
      sourceLabel = input.sourceTitle?.trim() || (db && row ? `${db.title} › ${databaseRowTitle(db, row)}` : "データベース行添付");
    }

    const ocrSource = {
      sourceType: input.sourceType,
      attachmentId: input.attachmentId,
      pageId: input.pageId,
      date: input.date,
      databaseId: input.databaseId,
      rowId: input.rowId,
      scope: input.scope,
      sourceTitle: sourceLabel,
    } as const;
    const existing = (await this.inboxService.list()).find((candidate) => {
      const source = candidate.ocrSource;
      return source?.sourceType === ocrSource.sourceType
        && source.attachmentId === ocrSource.attachmentId
        && source.pageId === ocrSource.pageId
        && source.date === ocrSource.date
        && source.databaseId === ocrSource.databaseId
        && source.rowId === ocrSource.rowId
        && source.scope === ocrSource.scope;
    });
    if (existing) return existing;
    const item = await this.inboxService.create({
      title: `OCR: ${fileName}`.slice(0, 120),
      text: [`OCRセンター処理対象`, `元の場所: ${sourceLabel}`, `元ファイル: ${fileName}`].join("\n"),
      source: "manual",
      ocrSource,
    });
    return this.inboxService.addAttachmentFromFile(item.id, fileName, filePath);
  }

  async getInboxAttachmentFile(
    id: string,
    attachmentId: string,
  ): Promise<{
    attachment: import("../../shared/types").InboxAttachment;
    filePath: string;
  }> {
    await this.initVault();
    return this.inboxService.getAttachmentFilePath(id, attachmentId);
  }

  /**
   * Kept for backward-compatible API callers. OCR must always enter the
   * durable queue; direct execution can bypass the cross-PC claim lease.
   */
  async recognizeInboxAttachment(
    id: string,
    attachmentId: string,
    options?: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    },
  ): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.enqueueOcrAttachment(id, attachmentId, options);
  }

  async enqueueInboxAttachmentOcr(
    id: string,
    attachmentId: string,
    options?: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    },
  ): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.enqueueOcrAttachment(id, attachmentId, options);
  }

  async cancelInboxAttachmentOcrQueue(id: string, attachmentId: string): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.cancelOcrQueueAttachment(id, attachmentId);
  }

  async retryInboxAttachmentOcrQueue(id: string, attachmentId: string): Promise<InboxItem> {
    await this.initVault();
    return this.inboxService.retryOcrQueueAttachment(id, attachmentId);
  }

  private normalizeJournal(
    input: Partial<JournalEntry>,
    fallbackDate: string,
  ): JournalEntry {
    return this.journalService.normalize(input, fallbackDate);
  }

  private journalDir(date: string): string {
    return this.journalService.journalDir(date);
  }

  async listJournals(month?: string): Promise<JournalSummary[]> {
    await this.initVault();
    const indexed = this.listJournalsFromIndex(month);
    if (indexed.length > 0 || month) return indexed;
    return this.listJournalsFromDisk(month);
  }

  async searchJournals(query: string, limit = 30): Promise<JournalSummary[]> {
    await this.initVault();
    const normalized = String(query || "").trim().replace(/\s+/g, " " );
    if (!normalized) return this.listJournals();

    // Fill older indexes once. New saves already keep full_text current.
    const hasText = this.db.prepare("SELECT COUNT(*) as count FROM journal_summary_index WHERE full_text <> ''").get() as { count?: number };
    if (!Number(hasText?.count || 0)) await this.listJournalsFromDisk();

    const terms = normalized.toLowerCase().split(" " ).filter(Boolean).slice(0, 8);
    const where = terms.map(() => "LOWER(full_text) LIKE ?").join(" AND " );
    const rows = this.db.prepare(
      `SELECT date,title,icon,updated_at as updatedAt,preview_snippet as previewSnippet,mood,weather,tags_json as tagsJson,full_text as fullText FROM journal_summary_index WHERE ${where} ORDER BY updated_at DESC LIMIT ?`,
    ).all(...terms.map((term) => `%${term}%`), Math.max(1, Math.min(limit, 100))) as any[];
    return rows.map((row) => {
      const fullText = String(row.fullText || "").replace(/\s+/g, " " );
      const first = terms[0] || "";
      const hitAt = first ? fullText.toLowerCase().indexOf(first) : -1;
      const previewSnippet = hitAt >= 0
        ? `${hitAt > 48 ? "…" : ""}${fullText.slice(Math.max(0, hitAt - 48), hitAt + 172)}${hitAt + 172 < fullText.length ? "…" : ""}`
        : String(row.previewSnippet || "");
      let tags: string[] = [];
      try { tags = JSON.parse(row.tagsJson || "[]"); } catch { tags = []; }
      return { date: row.date, title: row.title, icon: row.icon, updatedAt: row.updatedAt, previewSnippet, mood: row.mood || "", weather: row.weather || "", tags };
    });
  }

  async getJournal(date: string): Promise<JournalEntry> {
    await this.initVault();
    return this.journalService.get(date);
  }

  async saveJournal(
    input: Partial<JournalEntry> & { date: string; baseUpdatedAt?: string },
  ): Promise<JournalEntry> {
    await this.initVault();
    return this.journalService.save(input);
  }

  async deleteJournal(date: string): Promise<{ ok: true; date: string }> {
    await this.initVault();
    return this.journalService.remove(date);
  }

  async listJournalAttachments(date: string): Promise<AttachmentInfo[]> {
    await this.initVault();
    return this.journalService.listAttachments(date);
  }

  async addJournalAttachment(date: string, sourcePath: string): Promise<AttachmentInfo> {
    await this.initVault();
    return this.journalService.addAttachmentFromSource(date, sourcePath);
  }

  async addJournalAttachmentFromBase64(date: string, fileName: string, base64: string): Promise<AttachmentInfo> {
    await this.initVault();
    return this.journalService.addAttachmentFromBase64(date, fileName, base64);
  }

  async getJournalAttachmentFile(date: string, attachmentId: string): Promise<{ attachment: AttachmentInfo; filePath: string }> {
    await this.initVault();
    const attachment = await this.journalService.getAttachmentInfo(date, attachmentId);
    const filePath = await this.journalService.getAttachmentFilePath(date, attachmentId);
    return { attachment, filePath };
  }

  private async backupPage(
    bundle: PageBundle,
    reason?: PageHistoryReason,
  ): Promise<void> {
    await this.pageHistoryService.backup(bundle, reason);
  }

  private async writeConflictBundle(
    bundle: PageBundle,
    reason: string,
  ): Promise<ConflictInfo> {
    const id = `conflict_${new Date().toISOString().replace(/[:.]/g, "-")}_${sanitizeSegment(os.hostname())}`;
    const dir = path.join(vaultPaths(this.sharedRoot).conflicts, id);
    await fs.ensureDir(dir);
    const info: ConflictInfo = {
      id,
      pageId: bundle.meta.id,
      conflictDir: path.relative(this.sharedRoot, dir),
      createdAt: new Date().toISOString(),
      createdBy: this.userLabel(),
      reason,
    };
    await this.atomicWriteJson(path.join(dir, "conflict.json"), info);
    await this.atomicWriteJson(path.join(dir, "meta.json"), bundle.meta);
    await this.atomicWriteText(path.join(dir, "content.md"), bundle.markdown);
    await this.atomicWriteJson(
      path.join(dir, "blocksuite.json"),
      bundle.blocksuite,
    );
    return info;
  }

  private smartAssistSynonymsPath(): string {
    return this.smartAssistStore().synonymsPath();
  }

  /** Keep semantic extraction bounded and exclude editor binary payloads. */
  private semanticPlainText(value: unknown, depth = 0): string {
    if (depth > 5 || value === null || value === undefined) return "";
    const clean = (input: unknown, max = 1600) =>
      String(input ?? "")
        .replace(/!\[([^\]]{0,240})\]\((?:[^)]*)\)/g, "$1")
        .replace(
          /<(?:img|image|video|audio|source|object|embed|iframe)\b[^>]*>/gi,
          " ",
        )
        .replace(
          /\bdata:[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+(?:;[^,\s]*)?,[^\s)>'"]+/gi,
          " ",
        )
        .replace(/\b(?:blob|file):[^\s)>'"]+/gi, " ")
        .replace(/\S{512,}/g, " ")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return clean(value);
    if (Array.isArray(value))
      return value
        .slice(0, 30)
        .map((item) => this.semanticPlainText(item, depth + 1))
        .filter(Boolean)
        .join(" ")
        .slice(0, 4000);
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.title === "string") return clean(obj.title);
      if (typeof obj.name === "string") return clean(obj.name);
      if (typeof obj.label === "string") return clean(obj.label);
      if (typeof obj.text === "string") return clean(obj.text);
      if (
        typeof obj.value === "string" ||
        typeof obj.value === "number" ||
        typeof obj.value === "boolean"
      )
        return clean(obj.value);
      const skipped =
        /^(?:data|base64|src|image|images|file|files|blob|binary|bytes|thumbnail|preview)$/i;
      return Object.entries(obj)
        .filter(([key]) => !skipped.test(key))
        .slice(0, 30)
        .map(([, item]) => this.semanticPlainText(item, depth + 1))
        .filter(Boolean)
        .join(" ")
        .slice(0, 4000);
    }
    return "";
  }

  /**
   * Keeps prose from long pages while excluding binary/editor payloads.
   * semanticPlainText is intentionally small for metadata; page bodies use this
   * separate path and are split into bounded chunks before embedding.
   */
  private semanticTextForIndex(value: unknown, max = 64_000): string {
    const clean = (input: unknown, limit: number) =>
      String(input ?? "")
        .replace(/!\[([^\]]{0,240})\]\((?:[^)]*)\)/g, "$1")
        .replace(
          /<(?:img|image|video|audio|source|object|embed|iframe)\b[^>]*>/gi,
          " ",
        )
        .replace(
          /\bdata:[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+(?:;[^,\s]*)?,[^\s)>'"]+/gi,
          " ",
        )
        .replace(/\b(?:blob|file):[^\s)>'"]+/gi, " ")
        .replace(/\S{512,}/g, " ")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, limit);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return clean(value, max);
    return clean(this.semanticPlainText(value), max);
  }

  private splitSemanticTextForIndex(
    value: string,
    options: {
      chunkChars?: number;
      overlapChars?: number;
      maxChunks?: number;
    } = {},
  ): string[] {
    const chunkChars = Math.max(
      700,
      Math.min(1_300, Number(options.chunkChars || 1_080)),
    );
    const overlapChars = Math.max(
      80,
      Math.min(260, Number(options.overlapChars || 160)),
    );
    const maxChunks = Math.max(
      1,
      Math.min(48, Number(options.maxChunks || 40)),
    );
    const text = String(value || "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (!text) return [];
    const paragraphs = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const pieces: string[] = [];
    let current = "";
    const pushCurrent = () => {
      const ready = current.trim();
      if (ready) pieces.push(ready);
      const tail = ready.slice(Math.max(0, ready.length - overlapChars));
      current = tail ? `${tail}\n` : "";
    };
    const addPiece = (part: string) => {
      let remaining = part.trim();
      while (remaining) {
        const room = Math.max(1, chunkChars - current.length);
        if (remaining.length <= room) {
          current += (current.trim() ? "\n\n" : "") + remaining;
          return;
        }
        const slice = remaining.slice(0, room);
        const boundary = Math.max(
          slice.lastIndexOf("。"),
          slice.lastIndexOf("\n"),
          slice.lastIndexOf(" "),
          Math.floor(room * 0.72),
        );
        const take = Math.max(1, boundary + 1);
        current +=
          (current.trim() ? "\n\n" : "") + remaining.slice(0, take).trim();
        pushCurrent();
        remaining = remaining.slice(take).trim();
        if (pieces.length >= maxChunks) return;
      }
    };
    for (const paragraph of paragraphs.length ? paragraphs : [text]) {
      if (pieces.length >= maxChunks) break;
      if (current.trim() && current.length + paragraph.length + 2 > chunkChars)
        pushCurrent();
      addPiece(paragraph);
    }
    if (pieces.length < maxChunks && current.trim())
      pieces.push(current.trim());
    // Preserve the end of an exceptionally long source even when capped.
    if (
      pieces.length >= maxChunks &&
      text.length > pieces.join("").length + 800
    ) {
      const tail = text.slice(-chunkChars).trim();
      if (tail && !pieces.includes(tail)) pieces[pieces.length - 1] = tail;
    }
    return pieces.slice(0, maxChunks);
  }

  private makeSemanticSourceChunks(
    input: Omit<SemanticChunk, "id" | "text" | "chunkIndex" | "chunkCount"> & {
      baseId: string;
      sourceText: string;
      prefix?: string;
    },
  ): SemanticChunk[] {
    const textParts = this.splitSemanticTextForIndex(input.sourceText);
    const parts = textParts.length
      ? textParts
      : [String(input.prefix || "").trim()];
    const count = parts.filter(Boolean).length;
    if (!count) return [];
    return parts.filter(Boolean).map((part, index) => ({
      id: `${input.baseId}:chunk:${String(index + 1).padStart(3, "0")}`,
      type: input.type,
      sourceId: input.sourceId,
      parentPageId: input.parentPageId,
      databaseId: input.databaseId,
      rowId: input.rowId,
      databaseTitle: input.databaseTitle,
      rowTitle: input.rowTitle,
      propertySummary: input.propertySummary,
      title: input.title,
      text: [input.prefix, part].filter(Boolean).join("\n"),
      keywords: input.keywords,
      tags: input.tags,
      intentId: input.intentId,
      semanticMetaText: input.semanticMetaText,
      updatedAt: input.updatedAt,
      chunkIndex: index,
      chunkCount: count,
    }));
  }

  private isSemanticDatabaseTextProperty(property: DatabaseProperty): boolean {
    // v322: Ruri-v3 semantic index should target prose-like fields only.
    // Structured values are better handled by normal SQLite filters/sorts/FTS.
    return ["text", "url", "phone", "email", "formula"].includes(property.type);
  }

  private semanticDatabaseRelationTitle(
    property: DatabaseProperty,
    rawId: string,
    database: WorkspaceDatabase,
    allDatabases: WorkspaceDatabase[],
    pages: PageWithLock[],
    journals: JournalSummary[],
  ): string {
    const id = String(rawId || "").includes(":")
      ? String(rawId || "")
          .split(":")
          .slice(-1)[0]
      : String(rawId || "");
    if (!id) return "";
    const targetType = property.relationTargetType ?? "database";
    if (targetType === "page") {
      const page = pages.find((item) => item.id === id);
      return page ? `ページ:${page.title || id}` : `ページ:${id}`;
    }
    if (targetType === "journal") {
      const journal = journals.find((item) => item.date === id);
      return journal
        ? `Journal:${journal.title || journal.date}`
        : `Journal:${id}`;
    }
    const targetDb =
      allDatabases.find(
        (item) => item.id === (property.relationDatabaseId || database.id),
      ) || database;
    const targetRow = targetDb.rows?.find((item) => item.id === id);
    return targetRow
      ? `${targetDb.title}:${databaseRowTitle(targetDb, targetRow)}`
      : `${targetDb.title}:${id}`;
  }

  private semanticDatabaseRelationValue(
    property: DatabaseProperty,
    rawValue: unknown,
    database: WorkspaceDatabase,
    allDatabases: WorkspaceDatabase[],
    pages: PageWithLock[],
    journals: JournalSummary[],
  ): string {
    const ids = Array.isArray(rawValue)
      ? rawValue.map(String)
      : String(rawValue || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    return ids
      .map((id) =>
        this.semanticDatabaseRelationTitle(
          property,
          id,
          database,
          allDatabases,
          pages,
          journals,
        ),
      )
      .filter(Boolean)
      .join(" / ");
  }

  private semanticDatabaseRollupValue(
    property: DatabaseProperty,
    row: DatabaseRow,
    database: WorkspaceDatabase,
    allDatabases: WorkspaceDatabase[],
  ): string {
    const relationProp = database.properties.find(
      (item) =>
        item.id === property.rollupRelationPropertyId &&
        item.type === "relation",
    );
    if (!relationProp) return "";
    const ids = Array.isArray(row.cells?.[relationProp.id])
      ? (row.cells[relationProp.id] as string[]).map(String)
      : [];
    const targetDb =
      allDatabases.find(
        (item) => item.id === (relationProp.relationDatabaseId || database.id),
      ) || database;
    const targetRows = targetDb.rows.filter((item) => ids.includes(item.id));
    const fn = property.rollupFunction ?? "count";
    if (fn === "count") return String(targetRows.length);
    const targetProp = targetDb.properties.find(
      (item) => item.id === property.rollupTargetPropertyId,
    );
    const values = targetProp
      ? targetRows.map((item) => item.cells?.[targetProp.id])
      : [];
    if (fn === "show_unique")
      return Array.from(
        new Set(
          values
            .flatMap((value) =>
              Array.isArray(value)
                ? value.map(String)
                : [this.semanticPlainText(value)],
            )
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ).join(" / ");
    const isDoneStatus = (value: unknown) =>
      ["完了", "完了済み", "done", "completed"].includes(
        String(value ?? "").trim().toLowerCase(),
      );
    if (fn === "count_checked") return String(values.filter(Boolean).length);
    if (fn === "count_unchecked")
      return String(Math.max(0, values.length - values.filter(Boolean).length));
    if (fn === "percent_checked")
      return values.length
        ? `${Math.round((values.filter(Boolean).length / values.length) * 100)}%`
        : "0%";
    if (fn === "count_status_done") return String(values.filter(isDoneStatus).length);
    if (fn === "count_status_open") return String(values.filter((value) => !isDoneStatus(value)).length);
    if (fn === "percent_status_done")
      return values.length
        ? `${Math.round((values.filter(isDoneStatus).length / values.length) * 100)}%`
        : "0%";
    const nums = values
      .map((value) => Number(this.semanticPlainText(value).replace(/,/g, "")))
      .filter((value) => Number.isFinite(value));
    if (fn === "sum")
      return String(Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100);
    if (fn === "average")
      return nums.length
        ? String(
            Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) /
              100,
          )
        : "0";
    if (fn === "min") return nums.length ? String(Math.min(...nums)) : "";
    if (fn === "max") return nums.length ? String(Math.max(...nums)) : "";
    return String(targetRows.length);
  }

  private workspaceAiDbQuestionPlan(question: string): {
    enabled: boolean;
    reasons: string[];
    statusTerms: string[];
    completion?: "done" | "not_done";
    dateMode?: "today" | "this_week" | "this_month" | "overdue" | "upcoming";
    numberRule?: {
      operator: "greater_than" | "less_than";
      value: number;
      raw: string;
    };
    queryTerms: string[];
  } {
    const q = String(question || "").trim();
    const compact = q.replace(/\s+/g, "");
    const reasons: string[] = [];
    const statusTerms: string[] = [];
    const addStatus = (...items: string[]) => {
      for (const item of items)
        if (item && !statusTerms.includes(item)) statusTerms.push(item);
    };
    const addReason = (item: string) => {
      if (item && !reasons.includes(item)) reasons.push(item);
    };

    let completion: "done" | "not_done" | undefined;
    if (
      /(?:未完了|未対応|未着手|未処理|未解決|未チェック|未済|todo|to\s*do|open|pending)/i.test(
        q,
      )
    ) {
      completion = "not_done";
      addStatus(
        "未完了",
        "未対応",
        "未着手",
        "未処理",
        "対応中",
        "進行中",
        "確認待ち",
        "保留",
        "todo",
        "pending",
        "open",
      );
      addReason("未完了/未対応条件");
    } else if (
      /(?:完了済|対応済|処理済|解決済|完了|済み|close|closed|done)/i.test(q) &&
      !/(?:未完了|未対応|未済)/.test(q)
    ) {
      completion = "done";
      addStatus("完了", "対応済", "処理済", "解決済", "済み", "done", "closed");
      addReason("完了条件");
    }

    if (/(?:対応中|進行中|作業中|確認中)/.test(q)) {
      addStatus("対応中", "進行中", "作業中", "確認中");
      addReason("進行中ステータス");
    }
    if (/(?:保留|ペンディング|pending)/i.test(q)) {
      addStatus("保留", "pending");
      addReason("保留ステータス");
    }
    if (/(?:確認待ち|承認待ち|レビュー待ち|待ち)/.test(q)) {
      addStatus("確認待ち", "承認待ち", "レビュー待ち");
      addReason("待ちステータス");
    }
    if (/(?:高優先|優先度高|重要|緊急)/.test(q)) {
      addStatus("高", "High", "緊急", "重要");
      addReason("優先度条件");
    }

    let dateMode:
      | "today"
      | "this_week"
      | "this_month"
      | "overdue"
      | "upcoming"
      | undefined;
    if (/(?:期限切れ|期限超過|期限過ぎ|締切過ぎ|遅延|overdue)/i.test(q)) {
      dateMode = "overdue";
      addReason("期限切れ条件");
    } else if (/(?:今日|本日|today)/i.test(q)) {
      dateMode = "today";
      addReason("今日条件");
    } else if (/(?:今週|今週中|週内|this\s*week)/i.test(q)) {
      dateMode = "this_week";
      addReason("今週条件");
    } else if (/(?:今月|月内|this\s*month)/i.test(q)) {
      dateMode = "this_month";
      addReason("今月条件");
    } else if (
      /(?:期限が近い|締切が近い|近い期限|近日|そろそろ|upcoming)/i.test(q)
    ) {
      dateMode = "upcoming";
      addReason("期限が近い条件");
    }

    let numberRule:
      | { operator: "greater_than" | "less_than"; value: number; raw: string }
      | undefined;
    const numberMatch = compact.match(
      /([0-9０-９][0-9０-９,，]*)円?(以上|超|より上|以下|未満|より下)/,
    );
    if (numberMatch) {
      const value = Number(
        String(numberMatch[1])
          .replace(/[０-９]/g, (ch) =>
            String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
          )
          .replace(/[,，]/g, ""),
      );
      if (Number.isFinite(value)) {
        numberRule = {
          operator: /以上|超|より上/.test(numberMatch[2])
            ? "greater_than"
            : "less_than",
          value,
          raw: numberMatch[0],
        };
        addReason(`数値条件:${numberMatch[0]}`);
      }
    }

    const dbWords =
      /(?:データベース|DB|行|一覧|表|テーブル|タスク|案件|申請|期限|締切|未完了|完了|担当|ステータス|状態|優先度|金額|費用|チェック|Relation|Rollup|関連)/i.test(
        q,
      );
    const queryTerms = Array.from(
      new Set(
        String(q)
          .replace(/[「」『』（）()\[\]【】、。！？!?,.]/g, " ")
          .split(/\s+/)
          .map((item) => item.trim())
          .filter(
            (item) =>
              item.length >= 2 &&
              !/^(?:について|教えて|ください|もの|こと|一覧|ありますか|ですか)$/.test(
                item,
              ),
          )
          .slice(0, 10),
      ),
    );

    return {
      enabled: dbWords || reasons.length > 0,
      reasons,
      statusTerms,
      completion,
      dateMode,
      numberRule,
      queryTerms,
    };
  }

  private workspaceAiDateWindow(
    mode: "today" | "this_week" | "this_month" | "overdue" | "upcoming",
  ): { start?: string; end?: string; before?: string } {
    const today = jstYmd();
    if (mode === "today") return { start: today, end: addDaysToYmd(today, 1) };
    if (mode === "overdue") return { before: today };
    if (mode === "this_month") {
      const start = `${today.slice(0, 7)}-01`;
      const [year, month] = start.split("-").map(Number);
      const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      return { start, end };
    }
    const start = addDaysToYmd(today, -weekdayOfYmd(today));
    return { start, end: addDaysToYmd(start, mode === "upcoming" ? 14 : 7) };
  }

  private isWorkspaceAiStatusProperty(property: DatabaseProperty): boolean {
    return (
      /(?:ステータス|状態|進捗|対応状況|状況|status|state|progress|優先度|priority)/i.test(
        property.name || "",
      ) ||
      property.type === "select" ||
      property.type === "status" ||
      property.type === "multi_select"
    );
  }

  private isWorkspaceAiDateProperty(property: DatabaseProperty): boolean {
    return (
      property.type === "date" &&
      /(?:期限|締切|期日|日付|予定|実施日|開始|終了|due|date|deadline)/i.test(
        property.name || "",
      )
    );
  }

  private isWorkspaceAiNumberProperty(property: DatabaseProperty): boolean {
    return (
      property.type === "number" &&
      /(?:金額|費用|価格|料金|合計|数|点|件数|amount|price|cost|total|score|count)/i.test(
        property.name || "",
      )
    );
  }

  private async findWorkspaceAiDatabaseFilteredSources(
    question: string,
    options: { limit?: number } = {},
  ): Promise<SemanticSearchResult[]> {
    const plan = this.workspaceAiDbQuestionPlan(question);
    if (!plan.enabled) return [];
    const limit = Math.max(1, Math.min(12, Number(options.limit || 8)));
    const databases = await this.listDatabases().catch(
      () => [] as WorkspaceDatabase[],
    );
    if (!databases.length) return [];
    const pages = await this.listPages().catch(() => [] as PageWithLock[]);
    const journalSummaries = await this.listJournals().catch(
      () => [] as JournalSummary[],
    );
    const preliminary: Array<{
      database: WorkspaceDatabase;
      row: DatabaseRow;
      rowTitle: string;
      score: number;
      finalScore: number;
      reasons: string[];
    }> = [];
    const normalize = (value: unknown) =>
      this.semanticPlainText(value).replace(/\s+/g, " ").trim();
    const lower = (value: unknown) => normalize(value).toLowerCase();
    const dateValue = (value: unknown) => normalize(value).slice(0, 10);
    const numberValue = (value: unknown) =>
      Number(normalize(value).replace(/[,，円]/g, ""));
    const inWindow = (
      ymd: string,
      mode: "today" | "this_week" | "this_month" | "overdue" | "upcoming",
    ) => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(ymd)) return false;
      const window = this.workspaceAiDateWindow(mode);
      if (window.before) return ymd < window.before;
      return (
        (!window.start || ymd >= window.start) &&
        (!window.end || ymd < window.end)
      );
    };

    for (const database of databases) {
      if ((database as any).trashed) continue;
      const props = database.properties || [];
      const statusProps = props.filter((property) =>
        this.isWorkspaceAiStatusProperty(property),
      );
      const checkboxProps = props.filter(
        (property) =>
          property.type === "checkbox" &&
          /(?:完了|済|対応|チェック|done|complete)/i.test(property.name || ""),
      );
      const dateProps = props.filter((property) =>
        this.isWorkspaceAiDateProperty(property),
      );
      const numberProps = props.filter((property) =>
        this.isWorkspaceAiNumberProperty(property),
      );
      const searchableProps = props.filter((property) =>
        [
          "text",
          "url",
          "phone",
          "email",
          "formula",
          "select",
          "status",
          "multi_select",
          "unique_id",
          "relation",
          "rollup",
        ].includes(property.type),
      );

      for (const row of database.rows || []) {
        let score = 0;
        const reasons: string[] = [];
        const rowTitle = databaseRowTitle(database, row);
        const rowTextPieces = [database.title, rowTitle];
        for (const property of searchableProps)
          rowTextPieces.push(
            `${property.name} ${normalize(row.cells?.[property.id])}`,
          );
        const haystack = rowTextPieces.join(" ").toLowerCase();
        for (const term of plan.queryTerms) {
          if (term && haystack.includes(term.toLowerCase())) {
            score += 6;
            reasons.push(`語句一致:${term}`);
          }
        }

        if (plan.statusTerms.length) {
          let matchedStatus = false;
          for (const property of statusProps) {
            const value = lower(row.cells?.[property.id]);
            if (!value) continue;
            if (
              plan.statusTerms.some((term) =>
                value.includes(term.toLowerCase()),
              )
            ) {
              matchedStatus = true;
              score += 28;
              reasons.push(
                `${property.name}:${normalize(row.cells?.[property.id])}`,
              );
              break;
            }
          }
          if (!matchedStatus && plan.completion) {
            for (const property of checkboxProps) {
              const raw = row.cells?.[property.id];
              const checked =
                raw === true ||
                String(raw).toLowerCase() === "true" ||
                String(raw) === "1";
              if (
                (plan.completion === "done" && checked) ||
                (plan.completion === "not_done" && !checked)
              ) {
                matchedStatus = true;
                score += 24;
                reasons.push(`${property.name}:${checked ? "ON" : "OFF"}`);
                break;
              }
            }
          }
          if (
            !matchedStatus &&
            plan.reasons.some((reason) => /未完了|完了|ステータス/.test(reason))
          )
            score -= 12;
        }

        if (plan.dateMode) {
          let matchedDate = false;
          for (const property of dateProps) {
            const ymd = dateValue(row.cells?.[property.id]);
            if (inWindow(ymd, plan.dateMode)) {
              matchedDate = true;
              score += plan.dateMode === "overdue" ? 30 : 24;
              reasons.push(`${property.name}:${ymd}`);
              break;
            }
          }
          if (!matchedDate) score -= 12;
        }

        if (plan.numberRule) {
          let matchedNumber = false;
          for (const property of numberProps) {
            const value = numberValue(row.cells?.[property.id]);
            if (!Number.isFinite(value)) continue;
            if (
              (plan.numberRule.operator === "greater_than" &&
                value >= plan.numberRule.value) ||
              (plan.numberRule.operator === "less_than" &&
                value <= plan.numberRule.value)
            ) {
              matchedNumber = true;
              score += 24;
              reasons.push(
                `${property.name}:${value} (${plan.numberRule.raw})`,
              );
              break;
            }
          }
          if (!matchedNumber) score -= 12;
        }

        if (score <= 0) continue;
        const finalScore = Math.max(
          35,
          Math.min(98, 52 + score + Math.min(10, plan.reasons.length * 3)),
        );
        // Do not load row body files for every match. First rank by DB properties, then load only
        // the small top candidate set that may actually become generation evidence.
        preliminary.push({
          database,
          row,
          rowTitle,
          score,
          finalScore,
          reasons,
        });
      }
    }
    const candidates = preliminary
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, Math.max(limit * 3, 12));
    const scored: SemanticSearchResult[] = [];
    for (const candidate of candidates) {
      const { database, row, rowTitle, score, finalScore, reasons } = candidate;
      const rowContent = await this.getDatabaseRowContent(database.id, row.id, {
        title: rowTitle,
        scope: database.scope === "private" ? "private" : "shared",
      }).catch(() => null);
      const semantic = this.databaseRowSemanticPayload(
        database,
        row,
        rowContent,
        databases,
        pages,
        journalSummaries,
      );
      scored.push({
        chunk: {
          id: `database_row:${database.id}:${row.id}`,
          type: "database_row",
          sourceId: row.id,
          databaseId: database.id,
          rowId: row.id,
          databaseTitle: database.title,
          rowTitle,
          title: `${database.title} / ${rowTitle}`,
          text: semantic.text,
          keywords: semantic.keywords,
          tags: semantic.tags,
          semanticMetaText: [
            semantic.meta,
            `AI DB条件抽出: ${plan.reasons.join(" / ")}`,
          ]
            .filter(Boolean)
            .join(" "),
          propertySummary: semantic.propertySummary,
          updatedAt:
            row.updatedAt || rowContent?.updatedAt || database.updatedAt,
        },
        score: Math.round(finalScore),
        semanticScore: 0,
        lexicalScore: Math.round(Math.min(100, score)),
        titleScore: 0,
        metaScore: Math.round(Math.min(100, score)),
        reasons: [
          `DB条件抽出:${plan.reasons.join("/") || "自然言語条件"}`,
          ...Array.from(new Set(reasons)).slice(0, 5),
        ],
      });
    }
    return scored
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, limit);
  }

  private databaseRowSemanticPayload(
    database: WorkspaceDatabase,
    row: DatabaseRow,
    rowContent?: DatabaseRowContent | null,
    allDatabases: WorkspaceDatabase[] = [database],
    pages: PageWithLock[] = [],
    journals: JournalSummary[] = [],
  ): {
    text: string;
    keywords: string[];
    tags: string[];
    meta: string;
    propertySummary: string;
  } {
    const textLines: string[] = [];
    const metaLines: string[] = [];
    const propertyLines: string[] = [];
    const tags: string[] = [];
    const keywords: string[] = [];
    const rowTitle = databaseRowTitle(database, row);

    textLines.push(`データベース: ${database.title}`);
    if (rowTitle) textLines.push(`DB行: ${database.title} / ${rowTitle}`);
    if (rowTitle) textLines.push(`タイトル: ${rowTitle}`);
    metaLines.push(`データベース: ${database.title}`);
    if (database.scope) metaLines.push(`スコープ: ${database.scope}`);

    for (const property of database.properties || []) {
      const rawValue = row.cells?.[property.id];
      let value = this.semanticPlainText(rawValue).replace(/\s+/g, " ").trim();
      if (property.type === "relation")
        value = this.semanticDatabaseRelationValue(
          property,
          rawValue,
          database,
          allDatabases,
          pages,
          journals,
        )
          .replace(/\s+/g, " ")
          .trim();
      if (property.type === "rollup")
        value =
          this.semanticDatabaseRollupValue(
            property,
            row,
            database,
            allDatabases,
          )
            .replace(/\s+/g, " ")
            .trim() || value;
      if (!value) continue;

      propertyLines.push(`${property.name}: ${value}`);

      if (this.isSemanticDatabaseTextProperty(property)) {
        textLines.push(`${property.name}: ${value}`);
        keywords.push(property.name);
        continue;
      }

      if (property.type === "select" || property.type === "multi_select") {
        textLines.push(`分類: ${property.name}: ${value}`);
        metaLines.push(`${property.name}: ${value}`);
        tags.push(
          ...value
            .split(/[、,\s/]+/)
            .map((item) => item.trim())
            .filter((item) => item.length >= 2)
            .slice(0, 12),
        );
        keywords.push(
          property.name,
          ...value
            .split(/[、,\s/]+/)
            .filter(Boolean)
            .slice(0, 8),
        );
        continue;
      }

      if (property.type === "relation") {
        textLines.push(`Relation: ${property.name}: ${value}`);
        metaLines.push(`${property.name}: ${value}`);
        keywords.push(
          property.name,
          "Relation",
          "関連",
          ...value
            .split(/[、,\s/]+/)
            .filter(Boolean)
            .slice(0, 8),
        );
        continue;
      }

      if (property.type === "rollup") {
        textLines.push(`Rollup: ${property.name}: ${value}`);
        metaLines.push(`${property.name}: ${value}`);
        keywords.push(property.name, "Rollup", "集計");
        continue;
      }

      if (["date", "number", "checkbox"].includes(property.type)) {
        textLines.push(`属性: ${property.name}: ${value}`);
        metaLines.push(`${property.name}: ${value}`);
        keywords.push(
          property.name,
          property.type === "date"
            ? "日付"
            : property.type === "number"
              ? "数値"
              : "チェック",
        );
      }
    }

    if (rowContent?.markdown?.trim()) {
      textLines.push(
        `本文: ${this.semanticTextForIndex(rowContent.markdown, 6000)}`,
      );
      keywords.push("本文", "メモ", "詳細");
    }

    const unique = (items: string[]) =>
      Array.from(
        new Set(items.map((item) => String(item || "").trim()).filter(Boolean)),
      ).slice(0, 48);
    const propertySummary = propertyLines
      .slice(0, 18)
      .join(" / ")
      .slice(0, 1800);
    if (propertySummary) metaLines.push(`主要プロパティ: ${propertySummary}`);
    return {
      text: textLines.join("\n").slice(0, 8000),
      keywords: unique(keywords),
      tags: unique([database.title, rowTitle, ...tags]),
      meta: metaLines.join(" ").slice(0, 3000),
      propertySummary,
    };
  }

  async collectWorkspaceSemanticChunks(): Promise<SemanticChunk[]> {
    const chunks: SemanticChunk[] = [];

    const faqRecords = await this.listSmartFaqRecords().catch(
      () => [] as SmartFaqSearchRecord[],
    );
    for (const record of faqRecords) {
      if (record.status === "hidden") continue;
      const question = this.semanticTextForIndex(record.question, 1400);
      const answer = this.semanticTextForIndex(record.answer, 6000);
      if (!question && !answer) continue;
      chunks.push({
        id: `faq:${record.id}`,
        type: "faq",
        sourceId: String(record.id),
        title: question || String(record.id),
        text: [
          question ? `質問: ${question}` : "",
          answer ? `回答: ${answer}` : "",
          record.sourceText
            ? `根拠: ${this.semanticTextForIndex(record.sourceText, 1200)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        keywords: [
          record.category,
          record.intentId,
          record.intentLabel,
          record.domain,
          ...(Array.isArray(record.tags) ? record.tags : []),
        ]
          .filter(Boolean)
          .map(String),
        tags: Array.isArray(record.tags)
          ? record.tags.map(String).filter(Boolean)
          : undefined,
        intentId:
          String(record.intentId || record.intentLabel || "").trim() ||
          undefined,
        semanticMetaText: [
          record.category,
          record.domain,
          record.intentId,
          record.intentLabel,
          ...(Array.isArray(record.tags) ? record.tags : []),
        ]
          .filter(Boolean)
          .join(" "),
        updatedAt: record.updatedAt,
      });
    }

    const pages = await this.listPages().catch(() => [] as PageWithLock[]);
    for (const page of pages) {
      if ((page as any).trashed) continue;
      // A corrupt or unusually large single page must be skipped, not abort the
      // entire semantic rebuild. The next diff update can retry it after repair.
      let bundle: PageBundle | null = null;
      try {
        bundle = this.getPage(page.id);
      } catch (error) {
        console.warn(
          "[semantic-index] skipped unreadable page",
          page.id,
          error,
        );
        continue;
      }
      if (!bundle) continue;
      const markdown = this.semanticTextForIndex(
        (bundle as any).markdown,
        64_000,
      );
      const props = (bundle.meta as any).properties || {};
      const propText = this.semanticPlainText(props).slice(0, 900);
      const wikiStatus = ["draft", "verified", "review", "archived"].includes(
        String((props as any).wikiStatus),
      )
        ? String((props as any).wikiStatus)
        : "draft";
      const wikiMeta = [
        wikiStatus === "verified" ? "Wiki状態: 正式版 検証済み" : "",
        wikiStatus === "review" ? "Wiki状態: 確認待ち" : "",
        wikiStatus === "archived" ? "Wiki状態: 廃止 旧版 使用注意" : "",
        (props as any).wikiReviewDue
          ? `Wiki次回確認: ${String((props as any).wikiReviewDue)}`
          : "",
        (props as any).wikiSource
          ? `Wiki根拠: ${String((props as any).wikiSource)}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (!markdown && !propText && !wikiMeta && !bundle.meta.title) continue;
      const pageTags = Array.isArray(bundle.meta?.properties?.tags)
        ? bundle.meta.properties.tags
            .map(String)
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 24)
        : [];
      chunks.push(
        ...this.makeSemanticSourceChunks({
          baseId: `page:${bundle.meta.id}`,
          type: "page",
          sourceId: bundle.meta.id,
          parentPageId: bundle.meta.parentId || undefined,
          title: bundle.meta.title || bundle.meta.id,
          sourceText: markdown,
          prefix: [
            pageTags.length
              ? `タグ: ${pageTags.map((tag) => `#${tag}`).join(" ")}`
              : "",
            propText ? `プロパティ: ${propText}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          keywords: pageTags,
          tags: pageTags,
          semanticMetaText: [
            bundle.meta.title,
            ...pageTags,
            propText,
            wikiMeta,
            bundle.meta.icon,
            bundle.meta.parentId,
          ]
            .filter(Boolean)
            .join(" "),
          updatedAt: bundle.meta.updatedAt,
        }),
      );
    }

    const databases = await this.listDatabases().catch(
      () => [] as WorkspaceDatabase[],
    );
    const journalSummaries = await this.listJournals().catch(
      () => [] as JournalSummary[],
    );
    for (const database of databases) {
      if ((database as any).trashed) continue;
      for (const row of database.rows || []) {
        const rowTitle = databaseRowTitle(database, row);
        const scope = database.scope === "private" ? "private" : "shared";
        const rowContent = await this.getDatabaseRowContent(
          database.id,
          row.id,
          { title: rowTitle, scope },
        ).catch(() => null);
        const semantic = this.databaseRowSemanticPayload(
          database,
          row,
          rowContent,
          databases,
          pages,
          journalSummaries,
        );
        if (!semantic.text.trim()) continue;
        chunks.push(
          ...this.makeSemanticSourceChunks({
            baseId: `database_row:${database.id}:${row.id}`,
            type: "database_row",
            sourceId: row.id,
            databaseId: database.id,
            rowId: row.id,
            databaseTitle: database.title,
            rowTitle,
            propertySummary: semantic.propertySummary,
            title: `${database.title} / ${rowTitle}`,
            sourceText: this.semanticTextForIndex(semantic.text, 48_000),
            keywords: semantic.keywords,
            tags: semantic.tags,
            semanticMetaText: semantic.meta,
            updatedAt:
              row.updatedAt || rowContent?.updatedAt || database.updatedAt,
          }),
        );
      }
    }

    for (const summary of journalSummaries) {
      const journal = await this.getJournal(summary.date).catch(() => null);
      if (!journal) continue;
      const markdown = this.semanticTextForIndex(journal.markdown, 64_000);
      if (!markdown && !journal.title) continue;
      chunks.push(
        ...this.makeSemanticSourceChunks({
          baseId: `journal:${journal.date}`,
          type: "journal",
          sourceId: journal.date,
          title: journal.title || `${journal.date} のジャーナル`,
          sourceText: markdown,
          prefix: [
            `日付: ${journal.date}`,
            journal.mood ? `気分: ${journal.mood}` : "",
            journal.weather ? `天気: ${journal.weather}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          tags: Array.isArray(journal.tags)
            ? journal.tags.map(String).filter(Boolean)
            : undefined,
          semanticMetaText: [
            journal.date,
            journal.title,
            journal.mood,
            journal.weather,
            ...(Array.isArray(journal.tags) ? journal.tags : []),
          ]
            .filter(Boolean)
            .join(" "),
          updatedAt: journal.updatedAt,
        }),
      );
    }

    return chunks;
  }

  /**
   * Called by the renderer while a document is being edited. It does not cancel
   * an in-flight model call; background indexing pauses before its next chunk.
   */
  noteSemanticEditorActivity(holdMs = 10_000): {
    ok: true;
    pausedUntil: string;
  } {
    const safeHoldMs = Math.max(
      2_000,
      Math.min(60_000, Math.floor(Number(holdMs) || 10_000)),
    );
    this.semanticBackgroundPauseUntil = Math.max(
      this.semanticBackgroundPauseUntil,
      Date.now() + safeHoldMs,
    );
    return {
      ok: true,
      pausedUntil: new Date(this.semanticBackgroundPauseUntil).toISOString(),
    };
  }

  private async waitForSemanticBackgroundPermit(): Promise<void> {
    // Sleep asynchronously so the main process remains available for page saves,
    // IPC and interactive Smart Assist requests. Continuous typing extends the
    // pause through noteSemanticEditorActivity().
    while (Date.now() < this.semanticBackgroundPauseUntil) {
      const remaining = this.semanticBackgroundPauseUntil - Date.now();
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(750, Math.max(40, remaining))),
      );
    }
  }

  /** v451: local recovery snapshots. Shared data is copied read-only; local SQLite is intentionally rebuilt, not restored. */
  private async workspaceRecoveryBackupRoot(): Promise<string | null> {
    const cacheDir = await this.getSmartAssistLocalCacheDir().catch(() => null);
    if (!cacheDir) return null;
    const root = path.join(cacheDir, "recovery-backups");
    await fs.ensureDir(root);
    return root;
  }

  async listWorkspaceRecoveryBackups(): Promise<any[]> {
    const root = await this.workspaceRecoveryBackupRoot();
    if (!root) return [];
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => [] as any[]);
    const backups: any[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const meta = (await fs
        .readJson(path.join(dir, "backup-meta.json"))
        .catch(() => null)) as any;
      if (!meta) continue;
      backups.push({
        id: entry.name,
        createdAt: meta.createdAt || null,
        reason: meta.reason || "manual",
        fileCount: Number(meta.fileCount || 0),
        source: "shared-json",
        path: dir,
      });
    }
    return backups
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      )
      .slice(0, 12);
  }

  async createWorkspaceRecoveryBackup(reason = "manual"): Promise<any> {
    const root = await this.workspaceRecoveryBackupRoot();
    if (!root)
      throw new Error(
        "ローカルSQLiteキャッシュ保存先を設定してからバックアップしてください。",
      );
    const id = `snapshot-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "")}`;
    const target = path.join(root, id);
    const paths = vaultPaths(this.sharedRoot);
    const sources = [
      ["manifest.json", paths.manifest],
      ["pages", paths.pages],
      ["databases", paths.databases],
      ["journals", paths.journals],
      ["inbox", paths.inbox],
      ["smart-assist", paths.smartAssist],
      ["workspace", paths.workspace],
    ] as const;
    await fs.ensureDir(target);
    let fileCount = 0;
    for (const [name, source] of sources) {
      if (!(await fs.pathExists(source))) continue;
      const destination = path.join(target, "shared-json", name);
      await fs.copy(source, destination, {
        filter: async (file) => {
          const base = path.basename(file);
          if (
            base === ".DS_Store" ||
            base.endsWith(".lock") ||
            base.endsWith(".tmp")
          )
            return false;
          try {
            if ((await fs.stat(file)).isFile()) fileCount += 1;
          } catch {}
          return true;
        },
      });
    }
    const meta = {
      version: 1,
      createdAt: new Date().toISOString(),
      reason: String(reason || "manual"),
      fileCount,
      note: "共有JSONの読み取り専用スナップショット。ローカルSQLite／sqlite-vecは復元せず、正本から再構築します。",
    };
    await fs.outputJson(path.join(target, "backup-meta.json"), meta, {
      spaces: 2,
    });
    const all = await this.listWorkspaceRecoveryBackups();
    for (const old of all.slice(7))
      await fs.remove(path.join(root, old.id)).catch(() => undefined);
    return {
      ok: true,
      id,
      ...meta,
      backups: await this.listWorkspaceRecoveryBackups(),
    };
  }

  async resetWorkspaceSemanticLocalCache(): Promise<any> {
    const cacheDir = await this.getSmartAssistLocalCacheDir().catch(() => null);
    if (!cacheDir)
      throw new Error("ローカルSQLiteキャッシュ保存先が未設定です。");
    const service = await this.semanticIndexService().catch(() => null);
    try {
      service?.dispose?.();
    } catch {}
    this.semanticIndexServiceInstance = null;
    const files = [
      "workspace-semantic-cache.sqlite",
      "workspace-semantic-cache.sqlite-wal",
      "workspace-semantic-cache.sqlite-shm",
      "workspace-semantic-rebuild-job.json",
    ];
    let removed = 0;
    for (const name of files) {
      const file = path.join(cacheDir, name);
      if (await fs.pathExists(file)) {
        await fs.remove(file);
        removed += 1;
      }
    }
    this.semanticRebuildJob = null;
    this.semanticJobRestorePromise = null;
    return {
      ok: true,
      removed,
      message: `ローカルSemanticキャッシュを${removed}件削除しました。共有JSONの正本は変更していません。次回の差分更新または全件再生成で再構築されます。`,
    };
  }

  private async semanticJobStatePath(): Promise<string | null> {
    const cacheDir = await this.getSmartAssistLocalCacheDir().catch(() => null);
    return cacheDir
      ? path.join(cacheDir, "workspace-semantic-rebuild-job.json")
      : null;
  }

  private async persistSemanticJobState(): Promise<void> {
    const file = await this.semanticJobStatePath();
    if (!file || !this.semanticRebuildJob) return;
    const job = this.semanticRebuildJob;
    const persisted = {
      version: 1,
      id: job.id,
      state: job.state,
      mode: job.mode,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      collectedCount: job.collectedCount,
      processedEstimate: job.processedEstimate,
      message: job.message,
      error: job.error,
      pauseRequested: Boolean(job.pauseRequested),
      cancelRequested: Boolean(job.cancelRequested),
      savedAt: new Date().toISOString(),
    };
    await fs.outputJson(file, persisted, { spaces: 2 });
  }

  private async clearSemanticJobState(): Promise<void> {
    const file = await this.semanticJobStatePath();
    if (file) await fs.remove(file).catch(() => undefined);
  }

  private async ensureSemanticJobRestored(): Promise<void> {
    if (this.semanticJobRestorePromise) return this.semanticJobRestorePromise;
    this.semanticJobRestorePromise = (async () => {
      const file = await this.semanticJobStatePath();
      if (!file) return;
      const raw = (await fs.readJson(file).catch(() => null)) as any;
      if (!raw || raw.version !== 1 || !raw.id || !raw.mode) return;
      const previousState = String(raw.state || "");
      const activeBeforeExit = ["queued", "running", "paused"].includes(
        previousState,
      );
      this.semanticRebuildJob = {
        id: String(raw.id),
        state: activeBeforeExit
          ? "interrupted"
          : ((["completed", "cancelled", "error"].includes(previousState)
              ? previousState
              : "interrupted") as any),
        mode: raw.mode === "diff" ? "diff" : "full",
        startedAt: raw.startedAt || null,
        finishedAt: raw.finishedAt || null,
        collectedCount: Math.max(0, Number(raw.collectedCount || 0)),
        processedEstimate: Math.max(0, Number(raw.processedEstimate || 0)),
        message: activeBeforeExit
          ? "前回のバックグラウンド再生成はアプリ終了で中断しました。既に完了したEmbeddingを再利用して続きから再開できます。"
          : String(raw.message || "前回のIndexジョブ状態を復元しました。"),
        error: raw.error ? String(raw.error) : null,
        pauseRequested: false,
        cancelRequested: false,
        result: null,
      };
      if (activeBeforeExit) await this.persistSemanticJobState();
    })();
    return this.semanticJobRestorePromise;
  }

  private semanticJobSnapshot() {
    const job = this.semanticRebuildJob;
    return job
      ? {
          ...job,
          result: job.result
            ? {
                indexedCount: job.result.indexedCount,
                revision: job.result.revision,
                generatedAt: job.result.generatedAt,
              }
            : null,
        }
      : {
          id: null,
          state: "idle",
          mode: null,
          startedAt: null,
          finishedAt: null,
          collectedCount: 0,
          processedEstimate: 0,
          message: "実行中のバックグラウンドIndexジョブはありません。",
          error: null,
          pauseRequested: false,
          cancelRequested: false,
          result: null,
        };
  }

  async getWorkspaceSemanticRebuildJob(): Promise<any> {
    await this.ensureSemanticJobRestored();
    return this.semanticJobSnapshot();
  }

  async startWorkspaceSemanticRebuildJob(
    options: {
      mode?: "full" | "diff";
      maxNewEmbeddings?: number;
      resume?: boolean;
    } = {},
  ): Promise<any> {
    await this.ensureSemanticJobRestored();
    const active = this.semanticRebuildJob;
    if (active && ["queued", "running", "paused"].includes(active.state))
      return this.semanticJobSnapshot();
    const resume = Boolean(options.resume && active?.state === "interrupted");
    const mode: "full" | "diff" = resume
      ? active!.mode
      : options.mode === "diff"
        ? "diff"
        : "full";
    const id = resume
      ? active!.id
      : `semantic-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    type SemanticRebuildJob = NonNullable<typeof this.semanticRebuildJob>;
    const job: SemanticRebuildJob = (this.semanticRebuildJob = resume
      ? {
          ...active!,
          state: "queued",
          finishedAt: null,
          message: "前回の進捗を確認し、未処理のEmbeddingから再開します。",
          error: null,
          pauseRequested: false,
          cancelRequested: false,
        }
      : {
          id,
          state: "queued",
          mode,
          startedAt: new Date().toISOString(),
          finishedAt: null,
          collectedCount: 0,
          processedEstimate: 0,
          message: "再生成の準備中です。",
          error: null,
          pauseRequested: false,
          cancelRequested: false,
          result: null,
        });
    await this.persistSemanticJobState();
    void (async () => {
      try {
        job.state = "running";
        job.message = "対象データを収集中です。";
        await this.persistSemanticJobState();
        const chunks = await this.collectWorkspaceSemanticChunks();
        job.collectedCount = chunks.length;
        if (job.cancelRequested) {
          job.state = "cancelled";
          job.message = "開始前に中止しました。";
          return;
        }
        const service = await this.semanticIndexService();
        // A resumed job reads the last partial local/shared index. Each batch is
        // committed through buildIndex(), so a restart never discards completed embeddings.
        let previous =
          resume || mode === "diff"
            ? await service.readIndex().catch(() => null)
            : null;
        const batchSize = Math.max(
          4,
          Math.min(20, Math.floor(Number(options.maxNewEmbeddings) || 8)),
        );
        job.message = `${chunks.length}件をバックグラウンドで処理中です。`;
        while (!job.cancelRequested) {
          const result = await service.buildIndex(chunks, previous, {
            maxNewEmbeddings: batchSize,
            mode,
            waitForPermit: async () => {
              while (job.pauseRequested && !job.cancelRequested) {
                job.state = "paused";
                job.message = "一時停止中です。";
                await this.persistSemanticJobState();
                await new Promise<void>((resolve) => setTimeout(resolve, 350));
              }
              if (job.cancelRequested)
                throw new Error("__SEMANTIC_JOB_CANCELLED__");
              job.state = "running";
              await this.waitForSemanticBackgroundPermit();
            },
          });
          previous = result;
          const stats = (result as any).buildStats || {};
          job.processedEstimate = Math.max(
            job.processedEstimate,
            Math.min(job.collectedCount, Number(result.indexedCount || 0)),
          );
          job.result = result;
          job.message = `バックグラウンド更新中: ${job.processedEstimate}/${job.collectedCount}件（今回 ${Number(stats.embeddedThisRun || 0)}件処理）`;
          await this.persistSemanticJobState();
          if (job.cancelRequested) break;
          if (Number(stats.pendingCount || 0) <= 0) {
            job.processedEstimate = job.collectedCount;
            job.state = "completed";
            job.message = `${result.indexedCount}件のIndex再生成が完了しました。`;
            await this.clearSemanticJobState();
            break;
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (job.cancelRequested) {
          job.state = "cancelled";
          job.message =
            "中止しました。完了済みのEmbeddingと現在のIndexは利用可能なままです。";
          await this.persistSemanticJobState();
        }
      } catch (error: any) {
        if (
          String(error?.message || error).includes("__SEMANTIC_JOB_CANCELLED__")
        ) {
          job.state = "cancelled";
          job.message =
            "中止しました。完了済みのEmbeddingと現在のIndexは利用可能なままです。";
          await this.persistSemanticJobState();
        } else {
          job.state = "error";
          job.error = String(error?.message || error);
          job.message = "バックグラウンド再生成に失敗しました。";
          await this.persistSemanticJobState();
        }
      } finally {
        job.finishedAt = new Date().toISOString();
        if (job.state !== "completed") await this.persistSemanticJobState();
      }
    })().catch((error) => {
      // Protect the Electron main process from a rejection thrown while reporting
      // a background-job failure (for example, a shared-folder write error).
      console.error("[semantic rebuild] unhandled background failure", error);
    });
    return this.semanticJobSnapshot();
  }

  async controlWorkspaceSemanticRebuildJob(
    action: "pause" | "resume" | "cancel",
  ): Promise<any> {
    await this.ensureSemanticJobRestored();
    const job = this.semanticRebuildJob;
    if (!job) return this.semanticJobSnapshot();
    if (action === "resume" && job.state === "interrupted")
      return this.startWorkspaceSemanticRebuildJob({
        mode: job.mode,
        resume: true,
      });
    if (action === "cancel" && job.state === "interrupted") {
      this.semanticRebuildJob = null;
      await this.clearSemanticJobState();
      return this.semanticJobSnapshot();
    }
    if (!["queued", "running", "paused"].includes(job.state))
      return this.semanticJobSnapshot();
    if (action === "pause") {
      job.pauseRequested = true;
      job.message = "現在のEmbedding完了後に一時停止します。";
    }
    if (action === "resume") {
      job.pauseRequested = false;
      if (!job.cancelRequested) {
        job.state = "running";
        job.message = "再開しました。";
      }
    }
    if (action === "cancel") {
      job.cancelRequested = true;
      job.pauseRequested = false;
      job.message = "現在のEmbedding完了後に中止します。";
    }
    await this.persistSemanticJobState();
    return this.semanticJobSnapshot();
  }

  async rebuildWorkspaceSemanticIndex(
    options: {
      maxNewEmbeddings?: number;
      mode?: "diff" | "full";
      preferredChunkIds?: string[];
      background?: boolean;
    } = {},
  ): Promise<SemanticWorkspaceIndex> {
    const service = await this.semanticIndexService();
    const isFull = options.mode === "full";
    const previous = isFull
      ? null
      : await service.readIndex().catch(() => null);
    const chunks = await this.collectWorkspaceSemanticChunks();
    const maxNewEmbeddings = isFull ? undefined : options.maxNewEmbeddings;
    const preferredChunkIds = Array.from(
      new Set((options.preferredChunkIds || []).map(String).filter(Boolean)),
    ).slice(0, 100);
    return service.buildIndex(chunks, previous, {
      maxNewEmbeddings,
      mode: isFull ? "full" : "diff",
      preferredChunkIds,
      waitForPermit: options.background
        ? () => this.waitForSemanticBackgroundPermit()
        : undefined,
    });
  }

  async diffUpdateWorkspaceSemanticIndex(
    limit = 20,
    options: { preferredChunkIds?: string[]; background?: boolean } = {},
  ): Promise<SemanticWorkspaceIndex> {
    const safeLimit = Math.max(
      1,
      Math.min(100, Math.floor(Number(limit) || 20)),
    );
    return this.rebuildWorkspaceSemanticIndex({
      maxNewEmbeddings: safeLimit,
      mode: "diff",
      preferredChunkIds: options.preferredChunkIds,
      background: Boolean(options.background),
    });
  }

  /**
   * Re-embed a single page/FAQ/DB row/Journal source without making the operator
   * rebuild the entire workspace. Other index entries are retained as-is.
   */
  async reindexWorkspaceSemanticSource(
    sourceId: string,
    type?: string,
  ): Promise<SemanticWorkspaceIndex> {
    const safeSourceId = String(sourceId || "").trim();
    if (!safeSourceId) throw new Error("sourceId is required");
    const service = await this.semanticIndexService();
    const previous = await service.readIndex().catch(() => null);
    const chunks = await this.collectWorkspaceSemanticChunks();
    const matching = chunks.filter(
      (chunk) =>
        String(chunk.sourceId) === safeSourceId &&
        (!type || String(chunk.type) === String(type)),
    );
    if (!matching.length)
      throw new Error(
        "対象のSemantic Indexデータが見つかりません。ページが削除・未保存・対象外の可能性があります。",
      );
    return service.buildIndex(chunks, previous, {
      mode: "diff",
      onlySourceIds: [safeSourceId],
      forceSourceIds: [safeSourceId],
      preferredChunkIds: matching.map((chunk) => chunk.id),
    });
  }

  async getWorkspaceSemanticUpdateHistory(limit = 20): Promise<any[]> {
    const service = await this.semanticIndexService();
    return service.getUpdateHistory(limit);
  }

  async getWorkspaceSemanticIndexRevision(): Promise<{
    ok: boolean;
    revision: string | null;
    indexedCount: number;
    available: boolean;
    generatedAt: string | null;
  }> {
    const service = await this.semanticIndexService();
    const index = await service.readIndex();
    return {
      ok: Boolean(index),
      revision: index?.revision || index?.generatedAt || null,
      indexedCount: index?.indexedCount || 0,
      available: Boolean(index?.available),
      generatedAt: index?.generatedAt || null,
    };
  }

  async maintainWorkspaceSemanticCache(
    options: { vacuum?: boolean } = {},
  ): Promise<any> {
    const service = await this.semanticIndexService();
    return service.maintainCache({ vacuum: options.vacuum === true });
  }

  async getWorkspaceSemanticIndexInfo(): Promise<any> {
    const service = await this.semanticIndexService();
    const index = await service.readIndex();
    const cache = await service.getCacheInfo().catch((error: any) => ({
      enabled: false,
      error: String(error?.message || error),
    }));
    const chunks = await this.collectWorkspaceSemanticChunks().catch(
      () => [] as SemanticChunk[],
    );
    const diff = service.estimateDiff(chunks, index);
    return {
      ok: Boolean(index),
      version: index?.version || null,
      engine: index?.engine || null,
      model: index?.model || null,
      available: Boolean(index?.available),
      indexedCount: index?.indexedCount || 0,
      expectedCount: chunks.length,
      generatedAt: index?.generatedAt || null,
      revision: index?.revision || index?.generatedAt || null,
      error: index?.error || null,
      typeCounts:
        index?.items?.reduce((acc: Record<string, number>, item) => {
          acc[item.type] = (acc[item.type] || 0) + 1;
          return acc;
        }, {}) || {},
      diff,
      updatePolicy: {
        saveBehavior:
          "保存時はembedding生成せず、差分更新時に変更分だけ処理します。",
        defaultBatchLimit: 20,
        maxBatchLimit: 100,
        mode: "manual-diff-first-v326",
      },
      cache,
      backgroundJob: this.semanticJobSnapshot(),
    };
  }

  async searchWorkspaceSemantic(
    query: string,
    options: { limit?: number; types?: string[] } = {},
  ): Promise<{
    ok: true;
    query: string;
    available: boolean;
    indexedCount: number;
    results: SemanticSearchResult[];
    warning?: string;
  }> {
    if (!String(query || "").trim())
      return {
        ok: true,
        query: "",
        available: false,
        indexedCount: 0,
        results: [],
        warning: "query is empty",
      };
    const service = await this.semanticIndexService();
    let index = await service.readIndex();
    if (!index)
      index = await this.rebuildWorkspaceSemanticIndex().catch(() => null);
    const searched = await service
      .search(query, index, {
        limit: options.limit || 20,
        types: options.types,
      })
      .catch((error: any) => ({
        available: false,
        results: [],
        error: String(error?.message || error),
      }));
    return {
      ok: true,
      query,
      available: searched.available,
      indexedCount: index?.indexedCount || 0,
      results: searched.results,
      warning: searched.error,
    };
  }

  /**
   * BlockNote editor-only transformation.
   *
   * This must stay isolated from generateWorkspaceAiChatAnswer(): that method
   * performs semantic retrieval, grounding and related-source explanations,
   * whereas editor editing must transform only user-provided text.
   */
  async generateEditorAiEdit(input: any): Promise<any> {
    const operation = [
      "summary",
      "rewrite",
      "bullets",
      "todo",
      "custom",
    ].includes(String(input?.operation || ""))
      ? String(input.operation)
      : "custom";
    const sourceText = String(input?.text || "")
      .replace(/\r\n/g, "\n")
      .trim();
    const customInstruction = String(input?.instruction || "").trim();
    if (!sourceText)
      return {
        ok: false,
        generated: false,
        message: "編集する文章がありません。",
      };
    if (sourceText.length > 8_000)
      return {
        ok: false,
        generated: false,
        message: "選択範囲が長すぎます。8,000文字以内にしてください。",
      };
    if (operation === "custom" && !customInstruction)
      return {
        ok: false,
        generated: false,
        message: "AIへの指示を入力してください。",
      };

    const action =
      operation === "summary"
        ? "次の文章を、内容・固有名詞・数値を変えずに簡潔に要約してください。"
        : operation === "rewrite"
          ? "次の文章だけを、意味・事実・数値・固有名詞を変えずに、やさしく読みやすい日本語へ書き換えてください。"
          : operation === "bullets"
            ? "次の文章だけを、内容を落とさず、読みやすい箇条書きへ整理してください。"
            : operation === "todo"
              ? "次の文章だけから、実行すべきTODO・確認事項・期限を箇条書きで抽出してください。本文にない内容は追加しないでください。"
              : customInstruction;

    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok) {
      return {
        ok: false,
        generated: false,
        message:
          check?.message ||
          "ローカル生成AIが有効になっていません。生成AI設定を確認してください。",
      };
    }

    const prompt = [
      "あなたは文章編集専用のローカルAIです。",
      "以下の【編集対象】だけを編集してください。ワークスペース検索、関連情報検索、タグ、ページ名、参照候補、根拠、説明、前置き、感想、注意書きは一切出力しないでください。",
      "元の文章にない事実、人物、場所、日付、数値、制度、候補を追加しないでください。",
      "出力は編集後の本文だけにしてください。引用符、Markdownコードブロック、「編集結果:」などの見出しは不要です。",
      operation === "rewrite"
        ? "文章の長さは元文の0.7倍〜1.3倍を目安にし、要約しすぎないでください。"
        : "",
      `【依頼】\n${action}`,
      "",
      `【編集対象】\n${sourceText}`,
      "",
      "【出力】",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const runSettings = {
        ...settings,
        maxTokens: Math.max(
          96,
          Math.min(
            768,
            operation === "summary" ? 320 : Number(settings.maxTokens || 384),
          ),
        ),
        contextSize: Math.max(
          1024,
          Math.min(4096, Number(settings.contextSize || 2048)),
        ),
        temperature: Math.max(
          0,
          Math.min(0.35, Number(settings.temperature ?? 0.15)),
        ),
      } as any;
      const generated = await this.runLlamaGeneration(
        prompt,
        runSettings,
        check,
      );
      // Editor AI must not depend on Smart Assist's answer normalizer: that
      // normalizer intentionally uses workspace grounding state and lives inside
      // the chat-answer flow. Keep editor output isolated and only remove
      // presentation wrappers the local model may add.
      const answer = String(
        this.cleanLlamaGeneratedText(generated.text, prompt) ||
          generated.text ||
          "",
      )
        .replace(/^```(?:markdown|md|text)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .replace(/^(?:編集結果|書き換え後|要約結果|出力)\s*[:：]\s*/i, "")
        .trim();
      if (!answer) throw new Error("生成AIの編集結果が空でした。");
      if (
        /^(?:関連しそうな情報|一番近いのは|関連候補|根拠|参照候補)/.test(answer)
      ) {
        throw new Error(
          "編集専用の回答ではない出力を検出したため、適用を停止しました。もう一度実行してください。",
        );
      }
      return {
        ok: true,
        generated: true,
        answer,
        elapsedMs: generated.elapsedMs,
        operation,
        mode: "editor-only-v453",
      };
    } catch (error: any) {
      return {
        ok: false,
        generated: false,
        message: String(error?.message || "AI編集に失敗しました。"),
      };
    }
  }

  async generateWorkspaceAiChatAnswer(
    input: any,
    onDelta?: (delta: string) => void,
  ): Promise<any> {
    const question = String(input?.question || "").trim();
    if (!question)
      return {
        ok: false,
        generated: false,
        answer: "質問が空です。",
        results: [],
      };
    const answerMode = [
      "standard",
      "short",
      "detail",
      "steps",
      "evidence",
      "faq",
      "document",
    ].includes(String(input?.answerMode || ""))
      ? String(input.answerMode)
      : "standard";
    const isDocumentMode = answerMode === "document";
    const pageReadMode = ["fast", "standard", "detail"].includes(
      String(input?.pageReadMode || ""),
    )
      ? String(input.pageReadMode)
      : "fast";
    const answerLength = isDocumentMode
      ? "long"
      : ["short", "standard", "long"].includes(
            String(input?.answerLength || ""),
          )
        ? String(input.answerLength)
        : answerMode === "short"
          ? "short"
          : answerMode === "detail" || answerMode === "evidence"
            ? "long"
            : "standard";
    const tonePreset = [
      "smart",
      "friendly",
      "business_memo",
      "guardian",
      "staff",
    ].includes(String(input?.tonePreset || ""))
      ? String(input.tonePreset)
      : "smart";
    const recentMessages = Array.isArray(input?.recentMessages)
      ? input.recentMessages
          .slice(-8)
          .map((item: any) => ({
            role: String(item?.role || ""),
            text: String(item?.text || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 700),
          }))
          .filter((item: any) => item.text)
      : [];
    const tagHints: string[] = Array.from(
      new Set<string>(
        (Array.isArray(input?.tagHints) ? input.tagHints : [])
          .map((item: any) =>
            String(item || "")
              .trim()
              .replace(/^#/, ""),
          )
          .filter((item: string) => item.length >= 2),
      ),
    ).slice(0, 8);
    const tagHintGroups = Object.fromEntries(
      Object.entries(
        input?.tagHintGroups &&
          typeof input.tagHintGroups === "object" &&
          !Array.isArray(input.tagHintGroups)
          ? input.tagHintGroups
          : {},
      )
        .map(([rawTag, rawGroup]) => [
          String(rawTag || "")
            .trim()
            .replace(/^#/, ""),
          String(rawGroup || "").trim(),
        ])
        .filter(
          ([tag, group]) =>
            tagHints.includes(tag) &&
            ["業務分野", "年度", "対象者", "状態", "その他"].includes(group),
        ),
    ) as Record<string, string>;
    const pageReadPreset =
      pageReadMode === "detail"
        ? {
            label: "詳細",
            pageChars: 12000,
            chunkSize: 2800,
            maxChunks: 5,
            contextSize: isDocumentMode ? 8192 : 6144,
            maxTokens: isDocumentMode
              ? 2048
              : answerLength === "short"
                ? 384
                : 1024,
          }
        : pageReadMode === "standard"
          ? {
              label: "標準",
              pageChars: 6000,
              chunkSize: 2200,
              maxChunks: 3,
              contextSize: 4096,
              maxTokens: answerLength === "short" ? 256 : 640,
            }
          : {
              label: "高速",
              pageChars: 2400,
              chunkSize: 1600,
              maxChunks: 2,
              contextSize: 2048,
              maxTokens: answerLength === "long" ? 384 : 256,
            };
    const pageContext =
      input?.pageContext && typeof input.pageContext === "object"
        ? input.pageContext
        : null;
    const pageTitle = String(pageContext?.title || "").trim();
    const pageMarkdown = String(pageContext?.markdown || "").trim();
    const hasPageContext = Boolean(
      pageContext?.id && (pageTitle || pageMarkdown),
    );
    const isPageSummaryIntent =
      hasPageContext &&
      /(?:このページ|ページ|本文).*(?:要約|まとめ)|(?:要約|まとめ).*(?:このページ|ページ|本文)|^要約(?:して)?$/.test(
        question,
      );
    const isPageTodoIntent =
      hasPageContext &&
      /(?:TODO|ToDo|タスク|やること|期限|確認事項|要対応|todo|checklist|チェックリスト)/i.test(
        question,
      );
    const isPageRelatedIntent =
      hasPageContext &&
      /(?:関連|近い|似ている|参照|資料|情報).*(?:探|検索|表示|出して)|(?:このページ).*(?:関連)/.test(
        question,
      );
    const pageOnlyIntent = isPageSummaryIntent || isPageTodoIntent;
    const isFollowUpQuestion =
      /^(?:それ|これ|さっき|前の|上の|じゃあ|では|つまり|もう少し|詳しく|短く|続き|要点|手順|TODO|todo)/i.test(
        question,
      );

    // v360: 質問意図ルーター。検索前に「何をすべき質問か」を決める。
    // 小型ローカルLLMは、質問意図が曖昧なまま生成すると根拠外の断定をしやすいため、
    // 検索方法・回答形式・聞き返し判定をここで統一する。
    const normalizedQuestionForIntent = question.replace(
      /[\s　、。！？!?.]/g,
      "",
    );
    const classifyWorkspaceAiQuestion = () => {
      const q = question;
      const hasPage = hasPageContext;
      if (isDocumentMode)
        return {
          intent: "document",
          label: "文書作成",
          searchStrategy: "sources_then_draft",
          needsClarification: false,
          groundingPolicy: "sources_preferred",
        };
      if (isPageSummaryIntent)
        return {
          intent: "page_summary",
          label: "このページの要約",
          searchStrategy: "page_only",
          needsClarification: false,
          groundingPolicy: "current_page",
        };
      if (isPageTodoIntent)
        return {
          intent: "page_todo",
          label: "このページのTODO抽出",
          searchStrategy: "page_only",
          needsClarification: false,
          groundingPolicy: "current_page",
        };
      if (isPageRelatedIntent)
        return {
          intent: "page_related",
          label: "このページの関連情報",
          searchStrategy: "related_to_current_page",
          needsClarification: false,
          groundingPolicy: "related_sources",
        };
      if (isFollowUpQuestion)
        return {
          intent: "follow_up",
          label: "続きの質問",
          searchStrategy: hasPage ? "conversation_and_page" : "conversation",
          needsClarification: false,
          groundingPolicy: "conversation_context",
        };
      if (/(?:比較|違い|どっち|一覧|表に|整理して|まとめて比較)/.test(q))
        return {
          intent: "compare",
          label: "比較・整理",
          searchStrategy: "expanded_workspace_search",
          needsClarification: false,
          groundingPolicy: "sources_required",
        };
      if (/(?:手順|方法|やり方|流れ|どうすれば|申請方法|予約方法)/.test(q))
        return {
          intent: "procedure",
          label: "手順・方法",
          searchStrategy: "expanded_workspace_search",
          needsClarification: false,
          groundingPolicy: "sources_required",
        };
      if (
        /(?:文面|メール|案内文|通知文|保護者向け|文章|ひな形|テンプレ)/.test(q)
      )
        return {
          intent: "draft",
          label: "文面作成",
          searchStrategy: "sources_then_draft",
          needsClarification: false,
          groundingPolicy: "sources_preferred",
        };
      if (/(?:FAQ|よくある質問|質問と回答|Q&A)/i.test(q))
        return {
          intent: "faq",
          label: "FAQ回答",
          searchStrategy: "faq_first",
          needsClarification: false,
          groundingPolicy: "sources_required",
        };
      if (!hasPage && normalizedQuestionForIntent.length <= 8)
        return {
          intent: "ambiguous",
          label: "質問が短い/曖昧",
          searchStrategy: "clarify_first",
          needsClarification: true,
          groundingPolicy: "clarify_before_answer",
        };
      if (
        !hasPage &&
        /^(?:.+について教えて|.+とは|.+って何|.+を教えて)$/.test(q) &&
        normalizedQuestionForIntent.length <= 18
      )
        return {
          intent: "broad_lookup",
          label: "広い質問",
          searchStrategy: "broad_then_clarify",
          needsClarification: true,
          groundingPolicy: "clarify_if_weak",
        };
      return {
        intent: "workspace_lookup",
        label: "ワークスペース質問",
        searchStrategy: "expanded_workspace_search",
        needsClarification: false,
        groundingPolicy: "sources_required",
      };
    };
    const answerPlan = classifyWorkspaceAiQuestion();
    const isVagueQuestion = answerPlan.intent === "ambiguous";

    const expandWorkspaceAiQuery = (raw: string) => {
      const q = String(raw || "").trim();
      const extras: string[] = [];
      const push = (...items: string[]) => {
        for (const item of items)
          if (item && !extras.includes(item) && !q.includes(item))
            extras.push(item);
      };
      if (/(?:学童|児童クラブ|放課後)/.test(q))
        push(
          "放課後児童クラブ",
          "入会",
          "利用料",
          "費用",
          "減免",
          "延長",
          "長期休業",
          "見学予約",
        );
      if (/(?:料金|費用|いくら|利用料|お金)/.test(q))
        push("費用", "利用料", "月額", "おやつ代", "延長利用料", "減免");
      if (/(?:申請|手続|申し込|入会|届出)/.test(q))
        push("申請方法", "手続き", "提出先", "期限", "必要書類", "受付");
      if (/(?:予約|見学)/.test(q))
        push("見学予約", "受付", "予約方法", "対象施設");
      if (/(?:期限|いつまで|締切|日程)/.test(q))
        push("期限", "締切", "受付期間", "日程");
      if (/(?:減免|免除|軽減)/.test(q))
        push("減免制度", "対象要件", "申請", "必要書類");
      return [q, ...extras].join(" ");
    };
    const pinnedKeys = new Set(
      Array.isArray(input?.pinnedSourceKeys)
        ? input.pinnedSourceKeys.map((v: any) => String(v))
        : [],
    );
    const excludedKeys = new Set(
      Array.isArray(input?.excludedSourceKeys)
        ? input.excludedSourceKeys.map((v: any) => String(v))
        : [],
    );
    const pinnedSourceItems = Array.isArray(input?.pinnedSourceItems)
      ? input.pinnedSourceItems.filter((item: any) => item?.chunk)
      : [];
    const sourceMode =
      String(input?.sourceMode || "auto") === "pinned_only"
        ? "pinned_only"
        : "auto";
    const keyOf = (item: any) => {
      const chunk = item?.chunk || item || {};
      return `${chunk.type || "unknown"}:${chunk.databaseId || ""}:${chunk.rowId || chunk.sourceId || chunk.id || ""}`;
    };
    const normalizedPageMarkdown = String(pageMarkdown || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    const totalPageChars = normalizedPageMarkdown.length;
    const compactPageText = normalizedPageMarkdown.slice(
      0,
      pageReadPreset.pageChars,
    );
    const makePageChunks = (
      text: string,
      chunkSize: number,
      maxChunks: number,
    ) => {
      const chunks: string[] = [];
      const source = String(text || "").trim();
      if (!source) return chunks;
      for (
        let start = 0;
        start < source.length && chunks.length < maxChunks;
        start += chunkSize
      ) {
        const part = source.slice(start, start + chunkSize).trim();
        if (part) chunks.push(part);
      }
      return chunks;
    };
    const pageTextChunks = makePageChunks(
      compactPageText,
      pageReadPreset.chunkSize,
      pageReadPreset.maxChunks,
    );
    const pagePlainText = String(pageMarkdown || "")
      .replace(/[#>*_`\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const pageLines = String(pageMarkdown || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const headingLines = pageLines
      .filter((line) => /^#{1,6}\s+/.test(line))
      .slice(0, 8)
      .map((line) => line.replace(/^#{1,6}\s+/, ""));
    const todoLines = pageLines
      .filter((line) =>
        /(?:^- \[ \]|TODO|ToDo|タスク|やること|期限|確認|要対応|提出|連絡|対応)/i.test(
          line,
        ),
      )
      .slice(0, 12);
    const bulletLines = pageLines
      .filter((line) => /^(?:[-*・]|\d+[.)、])\s*/.test(line))
      .slice(0, 10);

    const expandedQuestion = expandWorkspaceAiQuery(question);
    const queryParts = [expandedQuestion];
    if (hasPageContext) queryParts.push(pageTitle);
    if (tagHints.length)
      queryParts.push(
        `関連タグ: ${tagHints.map((tag) => `#${tag}${tagHintGroups[tag] ? `(${tagHintGroups[tag]})` : ""}`).join(" ")}`,
      );
    if (hasPageContext && !pageOnlyIntent)
      queryParts.push(String(pageMarkdown).slice(0, 1200));
    if (recentMessages.length && answerPlan.intent === "follow_up")
      queryParts.push(
        recentMessages
          .slice(-4)
          .map((m: any) => m.text)
          .join("\n"),
      );

    // v361: 検索語展開と候補再ランキング。
    // Semantic scoreだけだと「雰囲気は近いが質問に直接答えていない候補」が混ざるため、
    // 1) 質問そのもの 2) 言い換え済み検索語 3) 意図別タイプ優先 の結果を統合し、
    // 本文・タイトル・メタ情報が質問語に直接反応している候補を上げる。
    const semanticSearches: any[] = [];
    const mergeSemanticSearch = async (
      label: string,
      query: string,
      options: { limit?: number; types?: string[] } = {},
    ) => {
      const normalizedQuery = String(query || "").trim();
      if (!normalizedQuery) return;
      const found = await this.searchWorkspaceSemantic(normalizedQuery, {
        limit: options.limit || 12,
        types: options.types,
      }).catch(
        (error: any) =>
          ({
            ok: true,
            available: false,
            indexedCount: 0,
            results: [],
            warning: String(error?.message || error),
          }) as any,
      );
      semanticSearches.push({ label, query: normalizedQuery, search: found });
    };
    if (!pageOnlyIntent && !(isPageRelatedIntent && pageContext?.id)) {
      await mergeSemanticSearch("expanded", queryParts.join("\n"), {
        limit: 16,
      });
      if (expandedQuestion !== question)
        await mergeSemanticSearch("original", question, { limit: 8 });
      if (answerPlan.intent === "faq")
        await mergeSemanticSearch("faq_first", expandedQuestion, {
          limit: 8,
          types: ["faq"],
        });
      if (answerPlan.intent === "procedure")
        await mergeSemanticSearch("procedure_pages", expandedQuestion, {
          limit: 8,
          types: ["faq", "page", "database_row"],
        });
    }
    const search = pageOnlyIntent
      ? ({
          ok: true,
          available: true,
          indexedCount: 0,
          results: [],
          warning: "",
        } as any)
      : isPageRelatedIntent && pageContext?.id
        ? // v349: 「このページに関連する情報」は質問文検索ではなく、現在ページのSemantic chunkを起点に関連検索する。
          // これにより、ページ本文と弱いFAQが通常検索で混ざる挙動を避ける。
          await this.getWorkspaceSemanticRelated({
            type: "page",
            id: String(pageContext.id),
            limit: 18,
          }).catch(
            (error: any) =>
              ({
                ok: true,
                available: false,
                indexedCount: 0,
                results: [],
                warning: String(error?.message || error),
              }) as any,
          )
        : (() => {
            const merged: any[] = [];
            const seen = new Set<string>();
            let indexedCount = 0;
            const warnings: string[] = [];
            for (const entry of semanticSearches) {
              const found = entry.search || {};
              indexedCount = Math.max(
                indexedCount,
                Number(found.indexedCount || 0),
              );
              if (found.warning) warnings.push(String(found.warning));
              for (const item of found.results || []) {
                if (!item?.chunk) continue;
                const key = keyOf(item);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                merged.push({
                  ...item,
                  reasons: [
                    ...(Array.isArray(item.reasons) ? item.reasons : []),
                    `検索:${entry.label}`,
                  ],
                });
              }
            }
            return {
              ok: true,
              available: semanticSearches.some(
                (entry) => entry.search?.available,
              ),
              indexedCount,
              results: merged,
              warning: warnings[0] || "",
            } as any;
          })();
    let results = ((search as any)?.results || []).filter(
      (item: any) => item?.chunk && !excludedKeys.has(keyOf(item)),
    );

    // v369: DB条件質問（例: 未完了、対応中、今週、期限切れ、5000円以上）は、
    // semantic searchだけではなくDB行の構造化プロパティも使って候補を追加する。
    // LLMにSQLを作らせず、コード側の安全な条件判定で根拠候補へ合流させる。
    const dbFilteredSources =
      !pageOnlyIntent && sourceMode !== "pinned_only"
        ? await this.findWorkspaceAiDatabaseFilteredSources(question, {
            limit: 8,
          }).catch(() => [] as SemanticSearchResult[])
        : [];
    if (dbFilteredSources.length) {
      const merged: any[] = [];
      const seen = new Set<string>();
      for (const item of [...dbFilteredSources, ...results]) {
        const key = keyOf(item);
        if (!key || seen.has(key) || excludedKeys.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      results = merged;
    }

    const normalizedPinnedItems = pinnedSourceItems
      .filter(
        (item: any) =>
          item?.chunk &&
          pinnedKeys.has(keyOf(item)) &&
          !excludedKeys.has(keyOf(item)),
      )
      .map((item: any) => ({
        ...item,
        score: Math.max(Number(item.score || 0), 99),
        reasons: [
          ...(Array.isArray(item.reasons) ? item.reasons : []),
          "ユーザーが参照元として固定",
        ],
      }));
    if (sourceMode === "pinned_only" && normalizedPinnedItems.length) {
      results = normalizedPinnedItems;
    } else {
      const merged: any[] = [];
      const seenKeys = new Set<string>();
      for (const item of [...normalizedPinnedItems, ...results]) {
        const key = keyOf(item);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        merged.push(item);
      }
      results = merged;
    }
    if (
      hasPageContext &&
      pageContext?.id &&
      !isPageRelatedIntent &&
      sourceMode !== "pinned_only"
    ) {
      // 通常の「このページ」質問では、外部候補より現在ページを優先し、検索候補の混入を抑える。
      // ただしv356以降、ユーザーが「使う」で固定した参照元は質問が変わっても文脈に残す。
      results = results.filter(
        (item: any) =>
          item?.chunk?.sourceId === pageContext.id ||
          pinnedKeys.has(keyOf(item)),
      );
    }

    const buildQuestionTermsForRerank = () => {
      const terms = new Set<string>();
      const add = (...items: string[]) => {
        for (const raw of items) {
          const value = String(raw || "")
            .replace(/[「」『』（）()\[\]【】、。！？!?,.]/g, " ")
            .trim();
          if (!value || value.length < 2) continue;
          for (const part of value.split(/\s+/g)) {
            if (
              part &&
              part.length >= 2 &&
              !/^(?:この|その|それ|これ|について|教えて|ください|して|ます|です)$/.test(
                part,
              )
            )
              terms.add(part);
          }
        }
      };
      add(question, expandedQuestion);
      if (/(?:学童|児童クラブ|放課後)/.test(question))
        add(
          "放課後児童クラブ",
          "学童",
          "入会",
          "利用料",
          "費用",
          "減免",
          "延長",
          "長期休業",
          "見学予約",
        );
      if (/(?:料金|費用|いくら|利用料|お金)/.test(question))
        add("費用", "利用料", "月額", "おやつ代", "延長利用料", "減免");
      if (/(?:申請|手続|申し込|入会|届出)/.test(question))
        add("申請", "手続き", "申請方法", "提出先", "期限", "必要書類", "受付");
      if (/(?:予約|見学)/.test(question))
        add("予約", "見学予約", "受付", "予約方法", "対象施設");
      if (/(?:期限|いつまで|締切|日程)/.test(question))
        add("期限", "締切", "受付期間", "日程");
      if (/(?:減免|免除|軽減)/.test(question))
        add("減免", "減免制度", "対象要件", "申請", "必要書類");
      if (
        /(?:データベース|DB|行|一覧|タスク|案件|期限|未完了|完了|担当|ステータス|Relation|Rollup|関連)/i.test(
          question,
        )
      )
        add(
          "データベース",
          "DB行",
          "主要プロパティ",
          "Relation",
          "Rollup",
          "関連",
          "期限",
          "ステータス",
          "担当",
          "未完了",
          "完了",
        );
      return Array.from(terms).slice(0, 34);
    };
    const questionTermsForRerank = buildQuestionTermsForRerank();
    const rerankWorkspaceAiResult = (item: any) => {
      const chunk = item?.chunk || {};
      const title = String(chunk.title || "").toLowerCase();
      const text = String(chunk.text || "").toLowerCase();
      const meta = String(chunk.semanticMetaText || "").toLowerCase();
      const chunkTags: string[] = Array.isArray(chunk.tags)
        ? chunk.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
        : [];
      const haystack = `${title}
${text}
${meta}`;
      const matchedTerms = questionTermsForRerank.filter((term) =>
        haystack.includes(term.toLowerCase()),
      );
      const matchedTagHints = tagHints.filter((tag) => {
        const needle = tag.toLowerCase();
        return (
          chunkTags.some(
            (chunkTag: string) => chunkTag.toLowerCase() === needle,
          ) || meta.includes(needle)
        );
      });
      const titleHits = matchedTerms.filter((term) =>
        title.includes(term.toLowerCase()),
      ).length;
      const textHits = matchedTerms.filter((term) =>
        text.includes(term.toLowerCase()),
      ).length;
      const metaHits = matchedTerms.filter((term) =>
        meta.includes(term.toLowerCase()),
      ).length;
      const directness = Math.min(
        32,
        titleHits * 8 + textHits * 5 + metaHits * 4,
      );
      const matchedTagGroups = Array.from(
        new Set(
          matchedTagHints.map((tag) => tagHintGroups[tag]).filter(Boolean),
        ),
      );
      const tagBoost = Math.min(24, matchedTagHints.length * 12);
      const tagGroupBoost = Math.min(12, matchedTagGroups.length * 4);
      const typeBoost =
        answerPlan.intent === "faq" && chunk.type === "faq"
          ? 12
          : answerPlan.intent === "procedure" &&
              ["faq", "page", "database_row"].includes(String(chunk.type))
            ? 8
            : answerPlan.intent === "compare" &&
                ["page", "database_row", "faq"].includes(String(chunk.type))
              ? 6
              : answerPlan.intent === "draft" &&
                  ["page", "faq"].includes(String(chunk.type))
                ? 5
                : /(?:データベース|DB|行|一覧|タスク|案件|期限|未完了|完了|担当|ステータス|Relation|Rollup|関連)/i.test(
                      question,
                    ) && chunk.type === "database_row"
                  ? 7
                  : 0;
      const titleOnlyPenalty =
        Number(item.semanticScore || 0) >= 60 &&
        textHits === 0 &&
        metaHits === 0 &&
        titleHits <= 1 &&
        !pinnedKeys.has(keyOf(item))
          ? -8
          : 0;
      const weakDirectPenalty =
        answerPlan.groundingPolicy === "sources_required" &&
        matchedTerms.length === 0 &&
        !pinnedKeys.has(keyOf(item))
          ? -12
          : 0;
      const pinnedBoost = pinnedKeys.has(keyOf(item)) ? 80 : 0;
      // v469 Wiki priority: verified pages are safer answer sources; archived pages
      // remain searchable for historical questions but are strongly deprioritized.
      const wikiVerifiedBoost = /wiki状態:\s*正式版|wikistatus\s*verified/.test(
        meta,
      )
        ? 18
        : 0;
      const wikiArchivedPenalty = /wiki状態:\s*廃止|wikistatus\s*archived/.test(
        meta,
      )
        ? -45
        : 0;
      const wikiReviewPenalty = /wiki状態:\s*確認待ち|wikistatus\s*review/.test(
        meta,
      )
        ? -4
        : 0;
      const base = Number(item.score || 0);
      const rerankScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            base * 0.72 +
              directness +
              tagBoost +
              tagGroupBoost +
              typeBoost +
              titleOnlyPenalty +
              weakDirectPenalty +
              pinnedBoost +
              wikiVerifiedBoost +
              wikiArchivedPenalty +
              wikiReviewPenalty,
          ),
        ),
      );
      const reasons = Array.isArray(item.reasons) ? [...item.reasons] : [];
      if (matchedTerms.length)
        reasons.push(`質問語一致:${matchedTerms.slice(0, 4).join("/")}`);
      if (matchedTagHints.length)
        reasons.push(
          `関連タグ一致:${matchedTagHints
            .slice(0, 4)
            .map((tag) => `#${tag}`)
            .join("/")}`,
        );
      if (matchedTagGroups.length)
        reasons.push(`タグ分類一致:${matchedTagGroups.join("/")}`);
      if (typeBoost) reasons.push("意図に合う種類");
      if (wikiVerifiedBoost) reasons.push("Wiki正式版を優先");
      if (wikiArchivedPenalty) reasons.push("Wiki廃止資料を低優先");
      if (wikiReviewPenalty) reasons.push("Wiki確認待ち");
      if (weakDirectPenalty) reasons.push("質問語との直接一致が弱い");
      return {
        ...item,
        originalScore: base,
        score: rerankScore,
        rerankScore,
        answerFitScore: Math.max(
          0,
          Math.min(
            100,
            directness + typeBoost + (matchedTerms.length ? 15 : 0),
          ),
        ),
        matchedQuestionTerms: matchedTerms.slice(0, 8),
        reasons,
      };
    };
    results = results
      .map(rerankWorkspaceAiResult)
      .sort((a: any, b: any) => {
        const pa = pinnedKeys.has(keyOf(a)) ? 1000 : 0;
        const pb = pinnedKeys.has(keyOf(b)) ? 1000 : 0;
        return Number(b.score || 0) + pb - (Number(a.score || 0) + pa);
      })
      .slice(0, 8);
    const resultScores = results
      .map((item: any) => Number(item.score || 0))
      .filter((value: number) => Number.isFinite(value));
    const topScore = resultScores.length ? Math.max(...resultScores) : 0;
    const strongSourceCount = results.filter(
      (item: any) =>
        Number(item.score || 0) >= 60 || pinnedKeys.has(keyOf(item)),
    ).length;
    const groundingConfidence =
      pageOnlyIntent && hasPageContext
        ? "high"
        : normalizedPinnedItems.length && sourceMode === "pinned_only"
          ? "high"
          : topScore >= 68 && strongSourceCount >= 2
            ? "high"
            : topScore >= 54 || strongSourceCount >= 1 || hasPageContext
              ? "medium"
              : topScore >= 38
                ? "low"
                : "none";
    const grounding = {
      confidence: groundingConfidence,
      usedSourceCount: results.length,
      pinnedCount: normalizedPinnedItems.length,
      excludedCount: excludedKeys.size,
      sourceMode,
      topScore: Math.round(topScore),
      strongSourceCount,
      intent: answerPlan.intent,
      intentLabel: answerPlan.label,
      searchStrategy: answerPlan.searchStrategy,
      dbFilter: {
        used: dbFilteredSources.length > 0,
        count: dbFilteredSources.length,
        topReasons: dbFilteredSources
          .slice(0, 4)
          .flatMap((item: any) =>
            Array.isArray(item.reasons) ? item.reasons.slice(0, 2) : [],
          )
          .slice(0, 6),
      },
      rerank: {
        mode: "query-expansion-answer-fit-v361",
        termCount: questionTermsForRerank.length,
        topAnswerFit: Math.round(
          Math.max(
            0,
            ...results.map((item: any) => Number(item.answerFitScore || 0)),
          ),
        ),
      },
    };

    const buildClarificationAnswer = () => {
      const titles = results
        .slice(0, 5)
        .map((item: any) => item?.chunk?.title)
        .filter(Boolean);
      if (answerPlan.intent === "broad_lookup" && titles.length) {
        return [
          `「${question}」は少し範囲が広いので、どの観点で知りたいか選ぶと正確に答えやすいです。`,
          "",
          "ワークスペース内では、近そうな候補として次の情報が見つかっています。",
          ...titles.map(
            (title: string, index: number) => `${index + 1}. ${title}`,
          ),
          "",
          "たとえば「手続きだけ」「費用だけ」「この候補だけで説明して」のように続けて聞いてください。",
        ].join("\n");
      }
      return [
        "少し範囲が広いので、どの情報を知りたいかもう少しだけ教えてください。",
        "",
        "例:",
        "- 手続きだけ知りたい",
        "- 費用や期限だけ知りたい",
        "- このページの内容だけで答えて",
        "- 保護者向けに説明して",
      ].join("\n");
    };

    const shouldClarifyBeforeGeneration =
      !pageOnlyIntent &&
      !isPageRelatedIntent &&
      (answerPlan.intent === "ambiguous" ||
        (answerPlan.intent === "broad_lookup" &&
          groundingConfidence !== "high") ||
        (!hasPageContext &&
          results.length > 0 &&
          groundingConfidence === "low" &&
          answerPlan.groundingPolicy === "sources_required"));

    const contextLines = results
      .map((item: any, index: number) => {
        const c = item.chunk || {};
        const isDbRow = c.type === "database_row";
        return [
          `[#${index + 1}] ${c.type || "unknown"} / score=${Math.round(Number(item.score || 0))}`,
          `title: ${String(c.title || "Untitled").slice(0, 160)}`,
          isDbRow && c.databaseTitle
            ? `database: ${String(c.databaseTitle).slice(0, 120)}`
            : "",
          isDbRow && c.rowTitle
            ? `row: ${String(c.rowTitle).slice(0, 120)}`
            : "",
          isDbRow && c.propertySummary
            ? `properties: ${String(c.propertySummary).replace(/\s+/g, " ").slice(0, 900)}`
            : "",
          isDbRow && c.databaseId ? `database_id: ${String(c.databaseId)}` : "",
          isDbRow && c.rowId ? `row_id: ${String(c.rowId)}` : "",
          `text: ${String(c.text || "")
            .replace(/\s+/g, " ")
            .slice(0, isDbRow ? 950 : 700)}`,
          c.semanticMetaText
            ? `meta: ${String(c.semanticMetaText)
                .replace(/\s+/g, " ")
                .slice(0, isDbRow ? 700 : 400)}`
            : "",
          item.matchedQuestionTerms?.length
            ? `question_terms: ${item.matchedQuestionTerms.slice(0, 6).join(" / ")}`
            : "",
          item.answerFitScore !== undefined
            ? `answer_fit: ${Math.round(Number(item.answerFitScore || 0))}`
            : "",
          item.reasons?.length
            ? `reasons: ${item.reasons.slice(0, 4).join(" / ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    const conversationBlock = recentMessages.length
      ? [
          "【直近の会話】",
          ...recentMessages.map(
            (message: any, index: number) =>
              `${index + 1}. ${message.role === "assistant" ? "AI" : "ユーザー"}: ${message.text}`,
          ),
        ].join("\n")
      : "";

    const toneInstruction =
      tonePreset === "friendly"
        ? "口調はやさしく、難しい言い回しを避けてください。相手に寄り添う短い文で答えてください。"
        : tonePreset === "business_memo"
          ? "口調は業務メモ風に、結論・要点・次にやることがすぐ分かるようにしてください。"
          : tonePreset === "guardian"
            ? "口調は保護者・住民向けに、専門用語を減らして分かりやすくしてください。"
            : tonePreset === "staff"
              ? "口調は職員向けに、確認観点・内部作業・注意点を簡潔に整理してください。"
              : "口調は自然でスマートなチャット回答にしてください。硬い行政文書のような言い回しは避けてください。";

    const pageBlock = hasPageContext
      ? [
          "【現在ページ】",
          `タイトル: ${pageTitle.slice(0, 160) || "無題"}`,
          `読み込み設定: ${pageReadPreset.label} / 読込 ${Math.min(totalPageChars, compactPageText.length)}文字 / 全文 ${totalPageChars}文字 / チャンク ${pageTextChunks.length}件`,
          pageTextChunks.length
            ? pageTextChunks
                .map(
                  (chunk, index) =>
                    `【ページ本文チャンク ${index + 1}/${pageTextChunks.length}】\n${chunk}`,
                )
                .join("\n\n")
            : `本文: ${pagePlainText.slice(0, pageReadPreset.pageChars) || "本文なし"}`,
        ].join("\n")
      : "";

    // v362: 回答テンプレート自動選択。
    // v360の意図分類・v361の候補再ランキングを受けて、回答形式も質問に合わせて切り替える。
    // 小型LLMに毎回同じ「結論/根拠/確認事項」形式を強制すると硬く不自然になるため、
    // 要約・手順・比較・文面・FAQ・聞き返し・通常回答を明示的に選ぶ。
    const selectWorkspaceAiAnswerTemplate = () => {
      const long = answerLength === "long";
      const short = answerLength === "short" || answerMode === "short";
      if (isDocumentMode)
        return {
          id: "document",
          label: "文書作成",
          structure:
            "タイトル案、導入、本文、必要なら見出し・箇条書き、最後に差し替えが必要な箇所。原則としてそのまま保存・編集できる完成原稿にする。",
          instruction:
            "参照元の事実だけを使い、ユーザーの依頼に合う完成原稿を作成してください。通知文・案内文・FAQ原案・会議録・報告メモなど、質問から最も自然な文書形式を選んでください。前置きや解説は最小限にし、本文を十分に作成してください。未確定の固有名詞・日付・金額・連絡先は【要確認】のように明示し、推測で埋めないでください。Markdownの表は使わないでください。",
        };
      if (answerPlan.intent === "page_summary")
        return {
          id: "page_summary",
          label: "ページ要約",
          structure:
            "最初に「つまり何のページか」を1〜2文。その後、大事な点を箇条書き。必要な場合だけ最後に注意点。",
          instruction: `現在ページだけを対象に要約してください。${pageTextChunks.length > 1 ? "複数チャンクを順番に読み、全体を統合してください。" : ""}${long ? "固有名詞・日付・条件を落とさず詳しく整理してください。" : short ? "短く要点だけにしてください。" : "読みやすく要点を整理してください。"}`,
        };
      if (answerPlan.intent === "page_todo")
        return {
          id: "page_todo",
          label: "TODO抽出",
          structure:
            "TODO、期限、確認先、不足情報に分ける。見つからない項目は自然に「このページ内では見つかりません」と書く。",
          instruction: `現在ページだけを対象に、TODO・期限・担当/確認先・確認した方がよいことを抽出してください。${long ? "根拠になった本文表現も短く添えてください。" : ""}`,
        };
      if (answerPlan.intent === "page_related")
        return {
          id: "related_sources",
          label: "関連情報整理",
          structure:
            "関連度が高い順に、何が近いか・どう使えるかを短く説明する。",
          instruction:
            "現在ページと関連する候補を、用途が分かるように整理してください。無理に回答を作らず、候補の見方を案内してください。",
        };
      if (answerPlan.intent === "procedure" || answerMode === "steps")
        return {
          id: "procedure",
          label: "手順化",
          structure:
            "最初に全体像を1文。次に番号付きの手順を3〜6項目。最後に不足情報を1〜2個だけ。",
          instruction:
            "利用者が次に何をすればよいか分かるように、手順を番号付きで整理してください。参照元にない方法を推測して増やさず、同じ確認事項を繰り返さないでください。根拠が弱い場合は断定せず確認を促してください。",
        };
      if (answerPlan.intent === "compare")
        return {
          id: "compare",
          label: "比較・整理",
          structure:
            "比較軸を先に示し、共通点・違い・判断ポイントを分ける。表は使わず箇条書きで整理。",
          instruction:
            "複数候補を比較し、違いと判断ポイントが分かるように整理してください。分からない点は「この資料だけでは不明」と明示してください。",
        };
      if (answerPlan.intent === "document")
        return {
          id: "document",
          label: "文書作成",
          structure:
            "タイトル案、導入、本文、必要なら見出し・箇条書き、最後に差し替えが必要な箇所。原則としてそのまま保存・編集できる完成原稿にする。",
          instruction:
            "参照元の事実だけを使い、ユーザーの依頼に合う完成原稿を作成してください。通知文・案内文・FAQ原案・会議録・報告メモなど、質問から最も自然な文書形式を選んでください。前置きや解説は最小限にし、本文を十分に作成してください。未確定の固有名詞・日付・金額・連絡先は【要確認】のように明示し、推測で埋めないでください。Markdownの表は使わないでください。",
        };
      if (answerPlan.intent === "draft")
        return {
          id: "draft",
          label: "文面作成",
          structure:
            "そのまま使える文面を先に出し、必要なら補足・差し替え箇所を短く添える。",
          instruction:
            "参照元の内容を根拠に、自然で使いやすい文面を作成してください。事実確認が必要な箇所は断定せず、差し替え候補として示してください。",
        };
      if (answerPlan.intent === "faq" || answerMode === "faq")
        return {
          id: "faq",
          label: "FAQ形式",
          structure:
            "質問、回答、補足、参照元の順。行政文書っぽくしすぎず、利用者に分かる言葉で書く。",
          instruction:
            "FAQとして登録しやすい形で、質問と回答を簡潔に整理してください。根拠が弱い部分は補足に回してください。",
        };
      if (answerPlan.needsClarification)
        return {
          id: "clarify",
          label: "聞き返し",
          structure: "分かる範囲を短く示し、選びやすい確認質問を1つだけ出す。",
          instruction:
            "情報が足りない場合は無理に答えず、ユーザーが次に答えやすい聞き返しにしてください。候補があれば選択肢として短く出してください。",
        };
      if (answerMode === "evidence")
        return {
          id: "evidence",
          label: "根拠重視",
          structure:
            "自然な回答を先に書き、その後に「どの参照元から分かるか」を短く示す。",
          instruction:
            "回答と根拠を分け、参照候補番号を使って根拠が追えるようにしてください。",
        };
      if (answerMode === "detail")
        return {
          id: "detailed_explanation",
          label: "詳しい説明",
          structure:
            "最初に短い答え。その後、背景・ポイント・注意点・次に見るべきこと。",
          instruction:
            "詳しく整理しつつ、最初に答えを短く示してください。長くなりすぎる場合は箇条書き中心にしてください。",
        };
      if (answerMode === "short")
        return {
          id: "short_answer",
          label: "短い回答",
          structure: "2〜4文。必要なら箇条書きは最大3点。",
          instruction:
            "短く、会話として自然に答えてください。細かい根拠は必要な場合だけ一言添えてください。",
        };
      return {
        id: "smart_answer",
        label: "スマート回答",
        structure:
          "まず自然な一文で答え、その後に必要なポイントだけ箇条書き。固定見出しを乱用しない。",
        instruction:
          "チャットらしく自然に答え、必要なポイントだけ整理してください。硬い行政文書のような言い回しは避けてください。",
      };
    };
    const answerTemplate = selectWorkspaceAiAnswerTemplate();

    const modeInstruction = isPageSummaryIntent
      ? `現在ページだけを対象に、自然な会話調で要約してください。最初に1〜2文で「つまり何のページか」を書き、その後に大事な点を箇条書きで整理してください。「確認事項」は必要な場合だけ最後に短く書いてください。検索候補や別FAQの内容を混ぜないでください。${pageTextChunks.length > 1 ? "複数チャンクを順番に読み、最後に全体を統合してください。" : ""}${answerLength === "long" ? "できるだけ詳しく、重要な固有名詞・日付・条件を落とさず整理してください。" : answerLength === "short" ? "短く要点だけにしてください。" : ""}`
      : isPageTodoIntent
        ? `現在ページだけを対象に、TODO・期限・担当/確認先・確認した方がよいことを抽出してください。堅い行政文書のようにせず、実際に次に動ける言い方で整理してください。見つからない項目は「記載なし」ではなく「このページ内では見つかりませんでした」と自然に書いてください。${answerLength === "long" ? "根拠になった本文表現も簡潔に添えてください。" : ""}`
        : answerMode === "short"
          ? "2〜4文で、チャットの返答として自然に短く答えてください。"
          : answerMode === "detail"
            ? "詳しく整理しつつ、最初に結論を1〜2文で置き、その後にポイント・注意点・次に見るべきことを分けてください。"
            : answerMode === "steps"
              ? "次にやることが分かるように、番号付きの手順で整理してください。"
              : answerMode === "evidence"
                ? "自然な回答を先に書き、その後に「根拠」として参照番号[#1]を短く示してください。"
                : answerMode === "faq"
                  ? "FAQ形式で、質問・回答・補足に分けてください。「確認事項」は必要な場合だけ書いてください。"
                  : "まず自然な一文で答え、その後に必要なポイントだけ箇条書きで整理してください。重要な断定には参照番号[#1]を添えてください。「結論」「根拠」「確認事項」という見出しを毎回固定で使わないでください。";

    const summarizePageFallback = () => {
      if (!hasPageContext) return "";
      const important = [
        ...headingLines,
        ...bulletLines.map((line) =>
          line.replace(/^(?:[-*・]|\d+[.)、])\s*/, ""),
        ),
      ]
        .filter(Boolean)
        .slice(0, answerLength === "long" ? 12 : 6);
      const excerpt = pagePlainText.slice(
        0,
        answerLength === "long" ? 900 : 360,
      );
      return [
        `現在ページ「${pageTitle || "無題"}」の要約です。`,
        `読み込み: ${pageReadPreset.label} / ${Math.min(totalPageChars, compactPageText.length)}文字${totalPageChars > compactPageText.length ? `（全文${totalPageChars}文字の先頭部分）` : ""}`,
        important.length
          ? `重要ポイント:\n${important.map((line, i) => `${i + 1}. ${line.slice(0, answerLength === "long" ? 180 : 120)}`).join("\n")}`
          : excerpt
            ? `概要: ${excerpt}`
            : "概要: 本文が空、または取得できませんでした。",
        todoLines.length
          ? `TODO/確認事項候補:\n${todoLines
              .slice(0, 5)
              .map((line, i) => `${i + 1}. ${line.slice(0, 140)}`)
              .join("\n")}`
          : "TODO/確認事項候補: 明確なTODO表記は見つかりませんでした。",
      ].join("\n");
    };

    const todoPageFallback = () => {
      if (!hasPageContext) return "";
      if (!todoLines.length)
        return `現在ページ「${pageTitle || "無題"}」から、明確なTODO・期限・要対応の記載は見つかりませんでした。必要であれば本文中の箇条書きを確認してください。`;
      return [
        `現在ページ「${pageTitle || "無題"}」から抽出したTODO/確認事項候補です。`,
        ...todoLines.map(
          (line, index) => `${index + 1}. ${line.slice(0, 180)}`,
        ),
      ].join("\n");
    };

    const templateAnswer = () => {
      if (isPageSummaryIntent) return summarizePageFallback();
      if (isPageTodoIntent) return todoPageFallback();
      if (!results.length && !pageBlock)
        return isVagueQuestion
          ? "少し範囲が広いので、どの情報を知りたいかもう少しだけ教えてください。\n\n例: 「芦屋市の学童について」「申請方法だけ」「費用だけ」のように聞くと、ワークスペース内の情報から探しやすくなります。"
          : "関連する根拠候補が見つかりませんでした。検索語を少し具体的にするか、AI横断検索で別の言葉を試してください。";
      if (hasPageContext && !results.length)
        return [
          `現在ページ「${pageTitle || "無題"}」をもとに回答します。`,
          pagePlainText
            ? `本文の要点: ${pagePlainText.slice(0, 360)}`
            : "本文が取得できませんでした。",
        ].join("\n");
      const top = results[0];
      const topTitle = top?.chunk?.title || pageTitle || "現在のページ";
      const topText = String(top?.chunk?.text || pageMarkdown || "")
        .replace(/\s+/g, " ")
        .slice(0, answerMode === "short" ? 160 : 360);
      if (answerTemplate.id === "procedure" || answerMode === "steps") {
        const sourceText = String(top?.chunk?.text || pageMarkdown || "")
          .replace(/\s+/g, " ")
          .trim();
        const sourceCompact = sourceText.replace(/\s+/g, "");
        const hasPhone = /電話|お電話/.test(sourceText);
        const hasTime = /17時|午後|午前|時/.test(sourceText);
        const methodLine = hasPhone
          ? "通学先の小学校内にある放課後児童クラブへ、電話で見学予約をします。"
          : sourceText
            ? sourceText.slice(0, 180)
            : "参照候補カードで見学予約に関する正式な記載を確認してください。";
        const lines = [
          `参照元から分かる範囲では、「${topTitle}」に見学方法の記載があります。`,
          `1. ${methodLine}`,
          hasTime
            ? "2. 電話する時間帯の指定がある場合は、その時間内に連絡します。"
            : "",
          "3. 対象クラブや受付時間は、参照候補カードの原文で確認してください。",
        ].filter(Boolean);
        if (
          !sourceCompact.includes("メール") &&
          !sourceCompact.includes("インターネット") &&
          !sourceCompact.includes("書類")
        ) {
          lines.push(
            "この参照元だけでは、メール・インターネット・書類で予約できるとは確認できません。",
          );
        }
        return lines.join("\n");
      }
      if (isPageRelatedIntent)
        return [
          `現在ページ「${pageTitle || "無題"}」に関連する情報候補です。`,
          `最も近い候補: ${topTitle}`,
          topText ? `候補の要点: ${topText}` : "",
          results.length
            ? `参照候補: ${results
                .slice(0, 5)
                .map((item: any) => item.chunk?.title || "Untitled")
                .join(" / ")}`
            : "",
          "必要に応じて参照候補カードを開き、原文を確認してください。",
        ]
          .filter(Boolean)
          .join("\n");
      if (answerMode === "evidence")
        return [
          `参照候補から見ると、主に「${topTitle}」が近いです。`,
          topText ? `内容としては、${topText}` : "",
          "必要であれば、参照候補カードを開いて原文も確認できます。",
        ]
          .filter(Boolean)
          .join("\n");
      return [
        `関連しそうな情報が見つかりました。`,
        `一番近いのは「${topTitle}」です。`,
        topText ? `ざっくり言うと、${topText}` : "",
        results.length
          ? `関連候補: ${results
              .slice(0, 5)
              .map((item: any) => item.chunk?.title || "Untitled")
              .join(" / ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    };

    const buildNextSuggestions = () => {
      if (answerTemplate.id === "page_summary")
        return [
          "もっと短くして",
          "TODOだけ抽出して",
          "保護者向けの文面に直して",
          "現在ページに追記したい",
        ];
      if (answerTemplate.id === "page_todo")
        return [
          "期限だけ整理して",
          "タスク化したい",
          "不足している確認事項を出して",
        ];
      if (answerTemplate.id === "related_sources")
        return [
          "この候補だけで答えて",
          "近いFAQだけ見せて",
          "関連ページを開きたい",
        ];
      if (answerTemplate.id === "procedure")
        return [
          "もっと短い手順にして",
          "必要書類も出して",
          "保護者向けにして",
          "FAQ下書きにする",
        ];
      if (answerTemplate.id === "compare")
        return [
          "違いだけにして",
          "判断ポイントだけ出して",
          "表に近い形で整理して",
        ];
      if (answerTemplate.id === "document")
        return [
          "保護者向けに整える",
          "職員向けに整える",
          "FAQ原案にする",
          "新規ページ化",
        ];
      if (answerTemplate.id === "draft")
        return ["もっとやさしく", "職員向けに", "保護者向けに", "新規ページ化"];
      if (answerTemplate.id === "faq")
        return ["FAQ下書きにする", "もっとやさしく説明して", "根拠を見せて"];
      if (answerTemplate.id === "clarify")
        return [
          "手続きだけ知りたい",
          "費用だけ知りたい",
          "この候補だけで説明して",
        ];
      return ["もっと短くして", "詳しく説明して", "手順にして", "根拠を見せて"];
    };

    const normalizeGeneratedChatAnswer = (text: string) => {
      let value = String(text || "").trim();
      if (!value) return value;

      const sourceTextForGrounding = [
        pageOnlyIntent ? compactPageText : "",
        pageOnlyIntent ? pageTitle : "",
        results
          .map(
            (item: any) =>
              `${item?.chunk?.title || ""}\n${item?.chunk?.text || ""}`,
          )
          .join("\n"),
      ]
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
      const sourceCompact = sourceTextForGrounding.replace(/\s+/g, "");
      const sourceHas = (term: string) =>
        sourceCompact.includes(String(term || "").replace(/\s+/g, ""));

      const removeUnsupportedMethodLine = (line: string) => {
        const normalized = String(line || "").replace(/\s+/g, "");
        if (!normalized) return false;
        const unsupportedTerms = [
          "メール",
          "インターネット",
          "オンライン",
          "Web",
          "WEB",
          "ウェブ",
          "書類",
          "フォーム",
        ];
        for (const term of unsupportedTerms) {
          if (normalized.includes(term) && !sourceHas(term)) return true;
        }
        // 予約方法・確認方法を列挙し始めたとき、小型LLMが根拠外の手段を増殖させるため、参照元にない手段は落とす。
        if (
          /(予約|確認).*(方法|手段)/.test(normalized) &&
          /(メール|インターネット|オンライン|書類|フォーム)/.test(normalized)
        )
          return true;
        return false;
      };

      let lines = value.split("\n").map((line) => line.trimEnd());

      // llama.cppの短い出力で同じ回答ブロックが2回連続する場合を抑制する。
      if (lines.length >= 6 && lines.length % 2 === 0) {
        const mid = lines.length / 2;
        const first = lines.slice(0, mid).join("\n").trim();
        const second = lines.slice(mid).join("\n").trim();
        if (first && first === second) lines = first.split("\n");
      }

      // v364: 行単位の重複・根拠外の予約手段を除去する。
      const seenLineCounts = new Map<string, number>();
      const cleaned: string[] = [];
      let numberedCount = 0;
      let repeatedLineCount = 0;
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const key = line
          .replace(/^\s*(?:[-*・]|\d+[.)、]|#+)\s*/, "")
          .replace(/[*_`\s]/g, "");
        if (removeUnsupportedMethodLine(line)) continue;
        if (key.length >= 8) {
          const count = (seenLineCounts.get(key) || 0) + 1;
          seenLineCounts.set(key, count);
          if (count > 1) {
            repeatedLineCount += 1;
            continue;
          }
        }
        if (/^\s*\d+[.)、]/.test(line)) numberedCount += 1;
        if (answerTemplate.id === "procedure" && numberedCount > 7) break;
        cleaned.push(line);
      }
      lines = cleaned;
      value = lines
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const sections = value.split(/\n(?=###\s+)/g);
      if (sections.length > 1) {
        const seen = new Set<string>();
        value = sections
          .filter((section) => {
            const key = section.replace(/\s+/g, " ").trim();
            const title = (section.match(/^###\s*(.+)$/m)?.[1] || "").replace(
              /\s+/g,
              "",
            );
            if (!key) return false;
            if (seen.has(key) || (title && seen.has(`title:${title}`)))
              return false;
            seen.add(key);
            if (title) seen.add(`title:${title}`);
            return true;
          })
          .join("\n")
          .trim();
      }

      // 同じ短い語句が連続増殖している場合は、安全な検索ベース回答へ切り替える。
      const numberedAfter = (value.match(/^\s*\d+[.)、]/gm) || []).length;
      if (
        answerTemplate.id === "procedure" &&
        (numberedAfter > 9 || repeatedLineCount >= 4)
      )
        return templateAnswer();
      if ((value.match(/予約の確認は/g) || []).length >= 3)
        return templateAnswer();
      return value;
    };

    // v363: 生成後の回答検証。生成AIの回答が参照元にない日付・金額・条件を混ぜていないかを軽量に点検する。
    const verifyWorkspaceAiAnswer = (answerText: string) => {
      const sourceText = [
        pageOnlyIntent ? compactPageText : "",
        pageOnlyIntent ? pageTitle : "",
        results
          .map(
            (item: any) =>
              `${item?.chunk?.title || ""}\n${item?.chunk?.text || ""}`,
          )
          .join("\n"),
      ]
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
      const answer = String(answerText || "")
        .replace(/\s+/g, " ")
        .trim();
      const sourceCompact = sourceText.replace(/\s+/g, "");
      const unsupported: string[] = [];
      const addUnsupported = (label: string) => {
        const value = label.trim();
        if (value && !unsupported.includes(value) && unsupported.length < 8)
          unsupported.push(value);
      };
      const collect = (regex: RegExp) => {
        const found = answer.match(regex) || [];
        for (const item of found) {
          const compact = String(item).replace(/\s+/g, "");
          if (compact && !sourceCompact.includes(compact)) addUnsupported(item);
        }
      };
      collect(/令和\s*\d+\s*年(?:度)?/g);
      collect(/20\d{2}\s*年(?:度)?/g);
      collect(/\d{1,2}\s*月\s*\d{1,2}\s*日/g);
      collect(/\d[\d,]*\s*円/g);
      collect(/\d[\d,]*\s*(?:人|名|件|校|箇所|時間|日間|週間|か月|ヶ月)/g);
      const policyTerms = [
        "対象者",
        "対象児童",
        "利用料",
        "費用",
        "減免",
        "延長利用料",
        "必要書類",
        "提出先",
        "受付期間",
        "締切",
        "期限",
        "申請書",
        "入会",
        "見学予約",
        "保護者",
        "小学校",
        "放課後児童クラブ",
      ];
      const sourceHas = (term: string) =>
        sourceCompact.includes(term.replace(/\s+/g, ""));
      const answerHas = (term: string) => answer.includes(term);
      const missingInfo: string[] = [];
      if (/(?:申請|手続|申し込|入会|届出|方法|やり方)/.test(question)) {
        for (const term of ["提出先", "必要書類", "期限", "対象者"])
          if (!sourceHas(term) && !missingInfo.includes(term))
            missingInfo.push(term);
      }
      if (/(?:費用|料金|利用料|いくら|減免|延長)/.test(question)) {
        for (const term of ["利用料", "減免", "延長利用料"])
          if (!sourceHas(term) && !missingInfo.includes(term))
            missingInfo.push(term);
      }
      if (/(?:いつ|期限|締切|日程|年度)/.test(question)) {
        for (const term of ["受付期間", "締切", "期限"])
          if (!sourceHas(term) && !missingInfo.includes(term))
            missingInfo.push(term);
      }
      const importantTermsInAnswer = policyTerms.filter((term) =>
        answerHas(term),
      );
      const unsupportedPolicyTerms = importantTermsInAnswer
        .filter((term) => !sourceHas(term))
        .slice(0, 5);
      for (const term of unsupportedPolicyTerms) addUnsupported(term);
      const quality =
        unsupported.length >= 3 ||
        (groundingConfidence === "low" && unsupported.length)
          ? "review"
          : unsupported.length ||
              missingInfo.length >= 3 ||
              groundingConfidence === "low"
            ? "medium"
            : "high";
      const label =
        quality === "high" ? "高" : quality === "medium" ? "中" : "要確認";
      const summary =
        quality === "high"
          ? "参照元に沿った回答として扱えます。"
          : quality === "medium"
            ? "回答に不足情報または確認した方がよい点があります。"
            : "参照元にない可能性がある断定を検出しました。原文確認を推奨します。";
      return {
        checked: true,
        quality,
        label,
        summary,
        unsupportedClaims: unsupported,
        missingInfo: missingInfo.slice(0, 8),
        sourceChars: sourceText.length,
        policy: "v363_answer_verification",
      };
    };

    // v360: 質問意図と根拠スコアを見て、答えるより聞き返すべき場合は生成AIへ投げない。
    if (shouldClarifyBeforeGeneration) {
      return {
        ok: true,
        generated: false,
        answer: buildClarificationAnswer(),
        results,
        warning:
          "質問意図が広い、または根拠スコアが低いため、回答前に確認を促しています。",
        suggestions: [
          "手続きだけ知りたい",
          "費用だけ知りたい",
          "この候補だけで説明して",
          "保護者向けにして",
        ],
        clarificationNeeded: true,
        indexedCount: (search as any)?.indexedCount || 0,
        usage: {
          pageReadMode,
          answerLength,
          usedPageChars: Math.min(totalPageChars, compactPageText.length),
          totalPageChars,
          pageChunkCount: pageTextChunks.length,
          maxTokens: pageReadPreset.maxTokens,
          contextSize: pageReadPreset.contextSize,
        },
        grounding,
        answerPlan,
        answerTemplate,
      };
    }

    // ワークスペース全体への質問で、根拠候補もページ文脈も無い場合は生成AIに投げない。
    // 小型LLMは根拠0件だと一般知識や偶然の学習内容で断定しやすいため、業務用途では明示的に停止する。
    if (!hasPageContext && !results.length) {
      return {
        ok: true,
        generated: false,
        answer:
          "この質問に使えるワークスペース内の根拠候補が見つかりませんでした。\n\nこのAIはローカルのFAQ・ページ・DB行・Journalを根拠に回答します。一般知識として断定せず、ページやFAQを追加するか、AI横断検索で検索語を変えて確認してください。",
        results: [],
        warning: "根拠候補が0件のため、生成AI回答を停止しました。",
        indexedCount: (search as any)?.indexedCount || 0,
        usage: {
          pageReadMode,
          answerLength,
          usedPageChars: 0,
          totalPageChars: 0,
          pageChunkCount: 0,
          maxTokens: pageReadPreset.maxTokens,
          contextSize: pageReadPreset.contextSize,
        },
        grounding,
        answerPlan,
        answerTemplate,
      };
    }

    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok) {
      {
        const fallbackAnswer = templateAnswer();
        return {
          ok: true,
          generated: false,
          answer: fallbackAnswer,
          results,
          warning:
            check?.message ||
            (search as any)?.warning ||
            "生成AIがOFFまたは未準備のため、検索結果ベースで表示しています。",
          suggestions: buildNextSuggestions(),
          indexedCount: (search as any)?.indexedCount || 0,
          usage: {
            pageReadMode,
            answerLength,
            usedPageChars: Math.min(totalPageChars, compactPageText.length),
            totalPageChars,
            pageChunkCount: pageTextChunks.length,
          },
          grounding,
          answerPlan,
          answerTemplate,
          answerVerification: verifyWorkspaceAiAnswer(fallbackAnswer),
        };
      }
    }

    const prompt = [
      "あなたはローカルワークスペース内の情報だけを根拠に答える業務AIアシスタントです。",
      "根拠にない事実は推測しないでください。不明な場合は「確認が必要」と書いてください。",
      pageOnlyIntent
        ? "この依頼では現在ページだけを根拠にしてください。別FAQ、別ページ、検索候補の内容を混ぜないでください。"
        : sourceMode === "pinned_only"
          ? "ユーザーが固定した参照候補だけを根拠にしてください。固定されていない情報は使わないでください。"
          : "参照候補がある場合は、候補内の情報だけを根拠にしてください。",
      isDocumentMode
        ? "出力は日本語の完成原稿だけ。Markdownの表は使わず、タイトル・見出し・段落・箇条書きを必要に応じて使い、そのままページへ保存できる形にしてください。"
        : "出力は日本語の本文だけ。Markdownの表は使わず、読みやすい短い段落と箇条書きで答えてください。",
      "事実・条件・金額・期限・手順・連絡方法を断定する文には、可能な範囲で参照番号[#1]のような根拠番号を付けてください。根拠番号を付けられない断定は避けてください。",
      "同じ内容・同じ見出し・同じ確認事項を繰り返さないでください。回答は1回で完結させてください。",
      "手順回答は最大6項目まで。参照元にない手段・連絡方法・必要書類・期限を作らないでください。",
      "参照元に「電話」としかない場合、メール・インターネット・書類・窓口など別の方法を推測して列挙しないでください。",
      "DB行が参照候補にある場合は、DB名・行タイトル・主要プロパティ・Relation・Rollupを優先して読み、日付・数値・チェックボックス条件は根拠番号つきで慎重に答えてください。",
      "情報が不足している場合は、無理に断定せず、自然に1つだけ聞き返してください。",
      toneInstruction,
      `質問意図: ${answerPlan.label} (${answerPlan.intent})`,
      `検索方針: ${answerPlan.searchStrategy}`,
      `根拠状態: ${groundingConfidence} / topScore=${Math.round(topScore)} / strongSources=${strongSourceCount}`,
      `候補再ランキング: v361 / 質問語=${questionTermsForRerank.slice(0, 12).join(" / ") || "なし"} / topAnswerFit=${(grounding as any).rerank?.topAnswerFit ?? 0}`,
      `回答モード: ${answerMode}`,
      `口調プリセット: ${tonePreset}`,
      `回答テンプレート: ${answerTemplate.label} (${answerTemplate.id})`,
      `テンプレート構成: ${answerTemplate.structure}`,
      `テンプレート指示: ${answerTemplate.instruction}`,
      `補足指示: ${modeInstruction}`,
      "",
      conversationBlock,
      "",
      `【質問】\n${question.slice(0, 1200)}`,
      "",
      pageBlock,
      "",
      pageOnlyIntent ? "" : `【参照候補】\n${contextLines || "候補なし"}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const baseMaxTokens = isDocumentMode
        ? 2048
        : Math.max(Number(settings.maxTokens || 128), pageReadPreset.maxTokens);
      const hardMaxTokens = isDocumentMode
        ? 2048
        : answerTemplate.id === "procedure"
          ? pageReadMode === "detail"
            ? 520
            : pageReadMode === "standard"
              ? 420
              : 320
          : pageReadMode === "detail"
            ? 1200
            : pageReadMode === "standard"
              ? 768
              : 384;
      const effectiveMaxTokens = Math.min(baseMaxTokens, hardMaxTokens);
      const effectiveContextSize = isDocumentMode
        ? 8192
        : Math.max(
            1024,
            Math.min(
              Math.max(
                Number(settings.contextSize || 1024),
                pageReadPreset.contextSize,
              ),
              pageReadMode === "detail" ? 8192 : 4096,
            ),
          );
      const runSettings = {
        ...settings,
        maxTokens: effectiveMaxTokens,
        contextSize: effectiveContextSize,
      } as any;
      const generated = await this.runLlamaGeneration(
        prompt,
        runSettings,
        check,
        onDelta,
      );
      const answer = normalizeGeneratedChatAnswer(
        this.cleanLlamaGeneratedText(generated.text, prompt) ||
          generated.text ||
          templateAnswer(),
      );
      if (/�{2,}|���/.test(answer)) {
        {
          const fallbackAnswer = templateAnswer();
          return {
            ok: true,
            generated: false,
            answer: fallbackAnswer,
            rawText: generated.text,
            command: generated.command,
            elapsedMs: generated.elapsedMs,
            results,
            warning:
              "生成AI出力に文字化けを検出したため、ページ本文/検索ベース回答に切り替えました。v349以降は日本語出力の分割デコード対策を適用しています。",
            suggestions: buildNextSuggestions(),
            indexedCount: (search as any)?.indexedCount || 0,
            usage: {
              pageReadMode,
              answerLength,
              usedPageChars: Math.min(totalPageChars, compactPageText.length),
              totalPageChars,
              pageChunkCount: pageTextChunks.length,
              maxTokens: runSettings.maxTokens,
              contextSize: runSettings.contextSize,
            },
            grounding,
            answerPlan,
            answerTemplate,
            answerVerification: verifyWorkspaceAiAnswer(fallbackAnswer),
          };
        }
      }
      {
        const answerVerification = verifyWorkspaceAiAnswer(answer);
        if (
          answerTemplate.id === "procedure" &&
          answerVerification.quality === "review"
        ) {
          const fallbackAnswer = templateAnswer();
          const fallbackVerification = verifyWorkspaceAiAnswer(fallbackAnswer);
          return {
            ok: true,
            generated: false,
            answer: fallbackAnswer,
            suggestions: buildNextSuggestions(),
            rawText: generated.text,
            command: generated.command,
            elapsedMs: generated.elapsedMs,
            results,
            warning:
              "生成AI回答に参照元にない可能性がある手段や条件が混ざったため、参照元ベースの安全な手順回答に切り替えました。",
            indexedCount: (search as any)?.indexedCount || 0,
            usage: {
              pageReadMode,
              answerLength,
              usedPageChars: Math.min(totalPageChars, compactPageText.length),
              totalPageChars,
              pageChunkCount: pageTextChunks.length,
              maxTokens: runSettings.maxTokens,
              contextSize: runSettings.contextSize,
            },
            grounding,
            answerPlan,
            answerTemplate,
            answerVerification: fallbackVerification,
          };
        }
        const verificationWarning =
          answerVerification.quality === "review"
            ? "回答検証で要確認の項目を検出しました。日付・金額・条件は参照元を確認してください。"
            : (search as any)?.warning;
        return {
          ok: true,
          generated: true,
          answer,
          suggestions: buildNextSuggestions(),
          rawText: generated.text,
          command: generated.command,
          elapsedMs: generated.elapsedMs,
          results,
          warning: verificationWarning,
          indexedCount: (search as any)?.indexedCount || 0,
          usage: {
            pageReadMode,
            answerLength,
            usedPageChars: Math.min(totalPageChars, compactPageText.length),
            totalPageChars,
            pageChunkCount: pageTextChunks.length,
            maxTokens: runSettings.maxTokens,
            contextSize: runSettings.contextSize,
          },
          grounding,
          answerPlan,
          answerTemplate,
          answerVerification,
        };
      }
    } catch (error: any) {
      const raw = String(error?.message || error);
      const maybeCtxIssue =
        (settings as any).generationRuntimeMode === "server" &&
        (pageReadMode === "standard" ||
          pageReadMode === "detail" ||
          raw.includes("context") ||
          raw.includes("ctx") ||
          raw.includes("llama-server"));
      const ctxHint = maybeCtxIssue
        ? ` 読込「${pageReadPreset.label}」では推奨ctx=${pageReadPreset.contextSize}です。llama-serverを小さいctxで起動している場合は、右下AIまたは生成AI設定から推奨ctxで再起動してください。`
        : "";
      const concise =
        raw.includes("timed out") || raw.includes("timeout")
          ? `生成AIがタイムアウトしたため、検索/ページ本文ベースで表示しました。${ctxHint}`
          : raw.includes("llama.cpp") || raw.includes("llama")
            ? `生成AIの実行に失敗したため、検索/ページ本文ベースで表示しました。生成AI設定の実行ファイル・モデル・常駐モードを確認してください。${ctxHint}`
            : `生成AIに失敗したため、検索/ページ本文ベースで表示しました。${ctxHint}`;
      {
        const fallbackAnswer = templateAnswer();
        return {
          ok: true,
          generated: false,
          answer: fallbackAnswer,
          results,
          suggestions: buildNextSuggestions(),
          warning: concise,
          debugWarning: raw.slice(0, 1200),
          indexedCount: (search as any)?.indexedCount || 0,
          usage: {
            pageReadMode,
            answerLength,
            usedPageChars: Math.min(totalPageChars, compactPageText.length),
            totalPageChars,
            pageChunkCount: pageTextChunks.length,
            maxTokens: pageReadPreset.maxTokens,
            contextSize: pageReadPreset.contextSize,
          },
          grounding,
          answerPlan,
          answerTemplate,
          answerVerification: verifyWorkspaceAiAnswer(fallbackAnswer),
        };
      }
    }
  }

  private findWorkspaceSemanticTargetInIndex(
    index: SemanticWorkspaceIndex | null,
    type: "page" | "database_row" | "journal" | "faq",
    id: string,
    databaseId?: string,
  ): SemanticChunk | null {
    const items = index?.items || [];
    if (type === "database_row") {
      return (
        items.find(
          (item) =>
            item.type === "database_row" &&
            item.rowId === id &&
            Number(item.chunkIndex || 0) === 0 &&
            (!databaseId || item.databaseId === databaseId),
        ) ||
        items.find(
          (item) =>
            item.type === "database_row" &&
            item.rowId === id &&
            (!databaseId || item.databaseId === databaseId),
        ) ||
        null
      );
    }
    return (
      items.find(
        (item) =>
          item.type === type &&
          item.sourceId === id &&
          Number(item.chunkIndex || 0) === 0,
      ) ||
      items.find((item) => item.type === type && item.sourceId === id) ||
      null
    );
  }

  /**
   * Read-only related search for an unsaved page draft. This deliberately does
   * not rebuild or mutate the workspace index; it embeds only the compact draft
   * query and searches the already-persisted index.
   */
  async getWorkspaceSemanticRelatedDraft(input: {
    pageId: string;
    title: string;
    text: string;
    tags?: string[];
    limit?: number;
  }): Promise<SemanticRelatedResult> {
    const service = await this.semanticIndexService();
    const index = await service.readIndex();
    if (!index) {
      return service.groupRelated(
        null,
        [],
        null,
        "Semantic Indexは未作成です。下書きの関連候補はIndex作成後に利用できます。",
      );
    }
    const title = String(input.title || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const text = String(input.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4_000);
    const tags = Array.from(
      new Set(
        (input.tags || [])
          .map((tag) => String(tag || "").trim())
          .filter(Boolean),
      ),
    ).slice(0, 40);
    if ((title + text).trim().length < 24) {
      return service.groupRelated(
        null,
        [],
        index,
        "もう少し入力すると、編集中の関連候補を表示します。",
      );
    }
    const target: SemanticChunk = {
      id: `draft:${String(input.pageId || "page")}`,
      type: "page",
      sourceId: String(input.pageId || "draft"),
      title: title || "無題の下書き",
      text,
      tags,
      keywords: tags,
      semanticMetaText: tags.length ? `タグ ${tags.join(" ")}` : undefined,
      updatedAt: new Date().toISOString(),
    };
    const excluded = (index.items || [])
      .filter(
        (item) => item.type === "page" && item.sourceId === target.sourceId,
      )
      .map((item) => item.id);
    const query = [target.title, target.text, tags.join(" ")]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4_000);
    const searched = await service
      .search(query, index, {
        limit: Math.max(1, Math.min(8, Number(input.limit || 5))),
        excludeIds: excluded,
        target,
        prefilterBySemantic: true,
        minScore: 38,
      })
      .catch((error: any) => ({
        available: false,
        results: [],
        error: String(error?.message || error),
      }));
    return service.groupRelated(
      target,
      searched.results,
      index,
      searched.error,
    );
  }

  async getWorkspaceSemanticRelated(input: {
    type: "page" | "database_row" | "journal" | "faq";
    id: string;
    databaseId?: string;
    limit?: number;
  }): Promise<SemanticRelatedResult> {
    const service = await this.semanticIndexService();
    const index = await service.readIndex();
    // Related information is passive. Never build an index or re-read all pages,
    // database rows and journals just because a page was opened.
    if (!index) {
      return service.groupRelated(
        null,
        [],
        null,
        "Semantic Indexは未作成です。必要な場合は管理画面から作成してください。",
      );
    }
    const target = this.findWorkspaceSemanticTargetInIndex(
      index,
      input.type,
      input.id,
      input.databaseId,
    );
    if (!target) {
      return service.groupRelated(
        null,
        [],
        index,
        "このページはまだSemantic Indexに反映されていません。差分更新後に関連情報を表示できます。",
      );
    }
    const sourceChunks = (index.items || [])
      .filter(
        (item) =>
          item.type === input.type &&
          item.sourceId === input.id &&
          (!input.databaseId || item.databaseId === input.databaseId),
      )
      .sort(
        (left, right) =>
          Number(left.chunkIndex || 0) - Number(right.chunkIndex || 0),
      );
    // Represent a long source by its beginning, middle and end instead of only
    // the first chunk, while keeping the query within the embedding budget.
    const sampleIndexes = Array.from(
      new Set([
        0,
        Math.floor(sourceChunks.length / 2),
        Math.max(0, sourceChunks.length - 1),
      ]),
    );
    const query = [
      target.title,
      ...sampleIndexes.map((position) => sourceChunks[position]?.text || ""),
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4_000);
    const searched = await service
      .search(query, index, {
        limit: input.limit || 32,
        excludeIds: (index.items || [])
          .filter(
            (item) =>
              item.type === input.type &&
              item.sourceId === input.id &&
              (!input.databaseId || item.databaseId === input.databaseId),
          )
          .map((item) => item.id),
        target,
        prefilterBySemantic: true,
      })
      .catch((error: any) => ({
        available: false,
        results: [],
        error: String(error?.message || error),
      }));
    return service.groupRelated(
      target,
      searched.results,
      index,
      searched.error,
    );
  }

  async listSmartAssistSynonyms(): Promise<SmartAssistSynonymEntry[]> {
    return this.smartAssistStore().listSynonyms() as Promise<
      SmartAssistSynonymEntry[]
    >;
  }

  async saveSmartAssistSynonyms(
    input: any[],
  ): Promise<SmartAssistSynonymEntry[]> {
    return this.smartAssistStore().saveSynonyms(input) as Promise<
      SmartAssistSynonymEntry[]
    >;
  }

  async upsertSmartAssistSynonym(
    input: any,
  ): Promise<SmartAssistSynonymEntry[]> {
    return this.smartAssistStore().upsertSynonym(input) as Promise<
      SmartAssistSynonymEntry[]
    >;
  }

  async deleteSmartAssistSynonym(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<SmartAssistSynonymEntry[]> {
    return this.smartAssistStore().deleteSynonym(id, baseUpdatedAt) as Promise<
      SmartAssistSynonymEntry[]
    >;
  }

  private smartAssistRuleProfilesPath(): string {
    return this.smartAssistStore().ruleProfilesPath();
  }

  async listSmartAssistRuleProfiles(): Promise<SmartAssistRuleProfileEntry[]> {
    return this.smartAssistStore().listRuleProfiles() as Promise<
      SmartAssistRuleProfileEntry[]
    >;
  }

  async saveSmartAssistRuleProfiles(
    input: any[],
  ): Promise<SmartAssistRuleProfileEntry[]> {
    return this.smartAssistStore().saveRuleProfiles(input) as Promise<
      SmartAssistRuleProfileEntry[]
    >;
  }

  async upsertSmartAssistRuleProfile(
    input: any,
  ): Promise<SmartAssistRuleProfileEntry[]> {
    return this.smartAssistStore().upsertRuleProfile(input) as Promise<
      SmartAssistRuleProfileEntry[]
    >;
  }

  async deleteSmartAssistRuleProfile(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<SmartAssistRuleProfileEntry[]> {
    return this.smartAssistStore().deleteRuleProfile(
      id,
      baseUpdatedAt,
    ) as Promise<SmartAssistRuleProfileEntry[]>;
  }

  private smartFaqPath(): string {
    return path.join(vaultPaths(this.sharedRoot).smartAssist, "faq-items.json");
  }

  private smartFaqCollection(): ItemCollection<SmartFaqSearchRecord> {
    return new ItemCollection({
      legacyFile: this.smartFaqPath(),
      collectionKey: "faqs",
      normalize: (value) => this.normalizeSmartFaqRecord(value),
      atomicWriteJson: (file, value) => this.atomicWriteJson(file, value),
      mutate: (file, task) => this.withSharedJsonMutation(file, task),
      limit: 5000,
    });
  }

  private smartFaqTrashPath(): string {
    return path.join(vaultPaths(this.sharedRoot).smartAssist, "faq-trash.json");
  }

  private smartAssistImprovementQueuePath(): string {
    return this.smartAssistStore().improvementQueuePath();
  }

  private smartAssistEvaluationSetPath(): string {
    return this.smartAssistStore().evaluationSetPath();
  }

  private smartAssistEvaluationReportPath(): string {
    return this.smartAssistStore().evaluationReportPath();
  }

  private normalizeSmartFaqRecord(item: any): SmartFaqSearchRecord | null {
    const now = new Date().toISOString();
    const question = String(item?.question ?? "").trim();
    const answer = String(item?.answer ?? "").trim();
    if (!question || !answer) return null;
    const rawStatus = String(item?.status || "").trim();
    const status = ["draft", "reviewed", "approved", "hidden"].includes(
      rawStatus,
    )
      ? rawStatus
      : item?.enabled === false
        ? "hidden"
        : "approved";
    return {
      id: String(item?.id || `faq_${nanoid(12)}`),
      title: item?.title ? String(item.title) : undefined,
      question,
      answer,
      category: String(item?.category || "未分類"),
      tags: Array.isArray(item?.tags)
        ? item.tags.map(String).filter(Boolean).slice(0, 30)
        : [],
      keywords: Array.isArray(item?.keywords)
        ? item.keywords.map(String).filter(Boolean).slice(0, 60)
        : undefined,
      negativeTerms: Array.isArray(item?.negativeTerms)
        ? item.negativeTerms.map(String).filter(Boolean).slice(0, 60)
        : undefined,
      status,
      sourceDocIds: Array.isArray(item?.sourceDocIds)
        ? item.sourceDocIds.map(String).filter(Boolean).slice(0, 50)
        : [],
      sourceTitles: Array.isArray(item?.sourceTitles)
        ? item.sourceTitles.map(String).filter(Boolean).slice(0, 50)
        : [],
      confidence: Number.isFinite(Number(item?.confidence))
        ? Math.max(0, Math.min(100, Number(item.confidence)))
        : 70,
      createdAt: String(item?.createdAt || now),
      updatedAt: String(item?.updatedAt || now),
      updatedBy: String(item?.updatedBy || this.userLabel()),
      sourceType: item?.sourceType ? String(item.sourceType) : undefined,
      sourcePdfName: item?.sourcePdfName
        ? String(item.sourcePdfName)
        : undefined,
      sourcePage:
        item?.sourcePage !== undefined && item?.sourcePage !== null
          ? item.sourcePage
          : undefined,
      sourceText: item?.sourceText
        ? String(item.sourceText).slice(0, 3000)
        : undefined,
      followUpQuestions: Array.isArray(item?.followUpQuestions)
        ? item.followUpQuestions.map(String).filter(Boolean).slice(0, 8)
        : undefined,
      examples: Array.isArray(item?.examples)
        ? item.examples.map(String).filter(Boolean).slice(0, 50)
        : undefined,
      // v193: 管理画面・APIからFAQ単位の回帰テスト質問を保持する。
      testQuestions: Array.isArray(item?.testQuestions)
        ? item.testQuestions.map(String).filter(Boolean).slice(0, 30)
        : undefined,
      // v217: FAQごとに想定質問・パラフレーズを複数持たせ、短文・言い換え検索を安定させる。
      likelyQuestions: Array.isArray(item?.likelyQuestions)
        ? item.likelyQuestions.map(String).filter(Boolean).slice(0, 50)
        : undefined,
      paraphrases: Array.isArray(item?.paraphrases)
        ? item.paraphrases.map(String).filter(Boolean).slice(0, 50)
        : undefined,
      suggestedActions: Array.isArray(item?.suggestedActions)
        ? item.suggestedActions.map(String).filter(Boolean).slice(0, 20)
        : undefined,
      nextQuestions: Array.isArray(item?.nextQuestions)
        ? item.nextQuestions.map(String).filter(Boolean).slice(0, 20)
        : undefined,
      // v190: 明示 Intent メタデータ。既存FAQ JSONにあれば保持する。
      intent: Array.isArray(item?.intent)
        ? item.intent.map(String).filter(Boolean).slice(0, 20)
        : item?.intent
          ? String(item.intent)
          : undefined,
      intentId: item?.intentId ? String(item.intentId) : undefined,
      intentIds: Array.isArray(item?.intentIds)
        ? item.intentIds.map(String).filter(Boolean).slice(0, 20)
        : undefined,
      intentLabel: item?.intentLabel ? String(item.intentLabel) : undefined,
      domain: item?.domain ? String(item.domain) : undefined,
      domainId: item?.domainId ? String(item.domainId) : undefined,
    };
  }

  private smartFaqSearchText(item: SmartFaqSearchRecord): string {
    return buildSmartFaqSearchText(item);
  }

  private smartAssistSearchIndexPath(): string {
    return path.join(
      vaultPaths(this.sharedRoot).smartAssist,
      "search-index.json",
    );
  }

  private smartAssistTransformerSettingsPath(): string {
    return this.smartAssistStore().transformerSettingsPath();
  }

  async getSmartAssistGenerationSettings(): Promise<SmartAssistGenerationSettings> {
    return this.smartAssistStore().getGenerationSettings() as unknown as Promise<SmartAssistGenerationSettings>;
  }

  async updateSmartAssistGenerationSettings(
    input: Partial<SmartAssistGenerationSettings>,
  ): Promise<SmartAssistGenerationSettings> {
    return this.smartAssistStore().updateGenerationSettings(
      input as any,
    ) as unknown as Promise<SmartAssistGenerationSettings>;
  }

  private async listGenerationModelFiles(root?: string): Promise<
    Array<{
      path: string;
      fileName: string;
      size: number;
      sizeMb: number;
      recommendedPreset: "light" | "balanced" | "manual";
    }>
  > {
    const base = String(root || "").trim();
    if (!base || !(await fs.pathExists(base))) return [];
    const out: Array<{
      path: string;
      fileName: string;
      size: number;
      sizeMb: number;
      recommendedPreset: "light" | "balanced" | "manual";
    }> = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 3 || out.length >= 80) return;
      const entries = await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => [] as any[]);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (![".git", "node_modules", "onnx"].includes(entry.name))
            await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gguf"))
          continue;
        const stat = await fs.stat(full).catch(() => null);
        const size = stat?.size || 0;
        const sizeMb = Number((size / 1024 / 1024).toFixed(1));
        out.push({
          path: full,
          fileName: entry.name,
          size,
          sizeMb,
          recommendedPreset:
            sizeMb <= 1400 ? "light" : sizeMb <= 2800 ? "balanced" : "manual",
        });
      }
    };
    await walk(base, 0);
    return out.sort((a, b) => a.size - b.size).slice(0, 80);
  }

  private llamaExecutableNames(): string[] {
    // v308: b9632以降の llama-cli は対話REPLとして残り、-p/-f後も終了しない場合がある。
    // 非対話生成には llama-completion が推奨されるため、同梱されていれば最優先で自動検出する。
    return process.platform === "win32"
      ? ["llama-completion.exe", "llama-cli.exe", "llama.exe", "llama-run.exe"]
      : ["llama-completion", "llama-cli", "llama", "llama-run"];
  }

  private llamaCompletionExecutableNames(): string[] {
    return process.platform === "win32"
      ? ["llama-completion.exe"]
      : ["llama-completion"];
  }

  private async findSiblingLlamaCompletionExecutable(
    executable?: string,
  ): Promise<string | undefined> {
    const current = String(executable || "").trim();
    if (!current) return undefined;
    const dir = path.dirname(current);
    for (const name of this.llamaCompletionExecutableNames()) {
      const candidate = path.join(dir, name);
      if (await this.isUsableLlamaExecutable(candidate)) return candidate;
    }
    return undefined;
  }

  private async resolveGenerationLlamaExecutable(
    executable: string,
  ): Promise<{ executable: string; switchedToCompletion: boolean }> {
    const base = path.basename(String(executable || "")).toLowerCase();
    if (/^llama-completion(?:\.exe)?$/i.test(base))
      return { executable, switchedToCompletion: false };
    const completion =
      await this.findSiblingLlamaCompletionExecutable(executable);
    if (completion)
      return { executable: completion, switchedToCompletion: true };
    return { executable, switchedToCompletion: false };
  }

  private async findLlamaExecutableInDir(
    dir?: string,
  ): Promise<string | undefined> {
    const baseDir = String(dir || "").trim();
    if (!baseDir || !(await fs.pathExists(baseDir))) return undefined;
    const stat = await fs.stat(baseDir).catch(() => null);
    if (!stat?.isDirectory()) return undefined;
    const names = this.llamaExecutableNames();
    const directCandidates = names.map((name) => path.join(baseDir, name));
    for (const candidate of directCandidates) {
      if (await this.isUsableLlamaExecutable(candidate)) return candidate;
    }
    const entries = await fs
      .readdir(baseDir, { withFileTypes: true })
      .catch(() => [] as any[]);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (
        !/^(bin|build|release|dist|llama|macos|windows|cpu|metal)$/i.test(
          entry.name,
        )
      )
        continue;
      for (const name of names) {
        const candidate = path.join(baseDir, entry.name, name);
        if (await this.isUsableLlamaExecutable(candidate)) return candidate;
      }
    }
    return undefined;
  }

  private async inspectLlamaRuntimeDir(dir?: string): Promise<any> {
    const baseDir = String(dir || "").trim();
    if (!baseDir)
      return {
        exists: false,
        executable: undefined,
        libraryCount: 0,
        warning: undefined,
      };
    const exists = await fs.pathExists(baseDir);
    if (!exists)
      return {
        exists: false,
        executable: undefined,
        libraryCount: 0,
        warning: "llamaフォルダが見つかりません。",
      };
    const executable = await this.findLlamaExecutableInDir(baseDir);
    const entries = await fs.readdir(baseDir).catch(() => [] as string[]);
    const libraryCount = entries.filter((name) =>
      process.platform === "win32"
        ? /\.dll$/i.test(name)
        : /\.dylib$/i.test(name),
    ).length;
    const warning = !executable
      ? "llamaフォルダ内に llama-completion / llama-cli が見つかりません。llama.cppを解凍したフォルダをそのまま選択してください。"
      : process.platform !== "win32" && libraryCount === 0
        ? "llama実行ファイルは見つかりました。同じフォルダに .dylib がない場合、配布形式によっては実行時に失敗することがあります。"
        : process.platform === "win32" && libraryCount === 0
          ? "llama実行ファイルは見つかりました。同じフォルダに .dll がない場合、配布形式によっては実行時に失敗することがあります。"
          : undefined;
    return { exists, executable, libraryCount, warning };
  }

  private async findBundledLlamaExecutable(): Promise<string | undefined> {
    const candidates = [
      path.join((process as any).resourcesPath || "", "bin"),
      path.join((process as any).resourcesPath || "", "llama"),
      path.join(process.cwd(), "resources", "bin"),
      path.join(process.cwd(), "resources", "llama"),
      path.join(process.cwd(), "bin"),
      path.join(process.cwd(), "llama"),
    ].filter(Boolean);
    for (const dir of candidates) {
      const found = await this.findLlamaExecutableInDir(dir);
      if (found) return found;
    }
    return undefined;
  }

  private isGenerationModelPath(filePath?: string): boolean {
    return /\.gguf$/i.test(String(filePath || "").trim());
  }

  private async isUsableLlamaExecutable(filePath?: string): Promise<boolean> {
    const candidate = String(filePath || "").trim();
    if (!candidate) return false;
    if (this.isGenerationModelPath(candidate)) return false;
    if (!(await fs.pathExists(candidate))) return false;
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isFile()) return false;
    if (process.platform === "win32") return /\.exe$/i.test(candidate);
    const base = path.basename(candidate).toLowerCase();
    if (!this.llamaExecutableNames().includes(base)) return false;
    return Boolean(stat.mode & 0o111);
  }

  private describeInvalidLlamaExecutable(
    filePath?: string,
  ): string | undefined {
    const candidate = String(filePath || "").trim();
    if (!candidate) return undefined;
    if (this.isGenerationModelPath(candidate)) {
      return "llama実行ファイル欄にGGUFモデルファイルが指定されています。v298以降は、llama.cppを解凍した「llamaフォルダ」を選択してください。";
    }
    if (process.platform === "win32" && !/\.exe$/i.test(candidate)) {
      return "Windowsでは llama実行ファイルに .exe が必要です。通常は llamaフォルダを選ぶだけで自動検出します。";
    }
    const base = path.basename(candidate).toLowerCase();
    if (
      process.platform !== "win32" &&
      !this.llamaExecutableNames().includes(base)
    ) {
      return "Mac/Linuxでは llama-completion / llama-cli / llama / llama-run などの実行ファイルが必要です。通常は llamaフォルダを選ぶだけで自動検出します。";
    }
    return undefined;
  }

  async checkSmartAssistGenerationEngine(): Promise<any> {
    const settings = await this.getSmartAssistGenerationSettings();
    const models = await this.listGenerationModelFiles(settings.modelRoot);
    const selectedModelPath =
      settings.selectedModelPath &&
      (await fs.pathExists(settings.selectedModelPath))
        ? settings.selectedModelPath
        : models[0]?.path;
    const runtimeDir = String((settings as any).llamaRuntimeDir || "").trim();
    const runtimeInfo = await this.inspectLlamaRuntimeDir(runtimeDir);
    const configuredLlamaPath = String(
      settings.llamaExecutablePath || "",
    ).trim();
    const configuredLlamaValid =
      await this.isUsableLlamaExecutable(configuredLlamaPath);
    const configuredLlamaError =
      configuredLlamaPath && !configuredLlamaValid
        ? this.describeInvalidLlamaExecutable(configuredLlamaPath) ||
          "指定されたllama実行ファイルを利用できません。"
        : undefined;
    const resolvedLlama =
      runtimeInfo.executable ||
      (configuredLlamaValid ? configuredLlamaPath : undefined) ||
      (await this.findBundledLlamaExecutable());
    const runtimeError =
      runtimeDir && !runtimeInfo.executable ? runtimeInfo.warning : undefined;
    const blockingError =
      runtimeError ||
      (runtimeInfo.executable ? undefined : configuredLlamaError);
    const ok = Boolean(
      settings.provider === "llama-cpp" &&
      selectedModelPath &&
      resolvedLlama &&
      !blockingError,
    );
    const message = !selectedModelPath
      ? "モデルフォルダ内に .gguf が見つかりません。"
      : blockingError
        ? blockingError
        : resolvedLlama
          ? "GGUFモデルとllama実行フォルダを確認しました。"
          : "GGUFモデルは見つかりました。llama.cppを解凍したフォルダを選択してください。";
    return {
      ok,
      available: Boolean(selectedModelPath),
      settings,
      provider: settings.provider || "none",
      modelRootExists: Boolean(
        settings.modelRoot && (await fs.pathExists(settings.modelRoot)),
      ),
      detectedModels: models,
      selectedModelPath,
      selectedModelExists: Boolean(selectedModelPath),
      llamaRuntimeDir: runtimeDir || undefined,
      llamaRuntimeDirExists: Boolean(runtimeInfo.exists),
      llamaRuntimeLibraryCount: runtimeInfo.libraryCount || 0,
      llamaRuntimeWarning: runtimeInfo.warning,
      llamaExecutablePath: resolvedLlama,
      configuredLlamaExecutablePath: configuredLlamaPath || undefined,
      llamaExecutableExists: Boolean(resolvedLlama),
      llamaExecutableValid: Boolean(resolvedLlama && !blockingError),
      llamaExecutableError: blockingError,
      llamaServerExecutablePath: await this.resolveLlamaServerExecutable(
        settings,
        {
          selectedModelPath,
          llamaExecutablePath: resolvedLlama,
          llamaRuntimeDir: runtimeDir,
        },
      ),
      generationRuntimeMode:
        (settings as any).generationRuntimeMode || "oneshot",
      llamaServer: await this.getLlamaServerStatus(settings, {
        selectedModelPath,
        llamaExecutablePath: resolvedLlama,
        llamaRuntimeDir: runtimeDir,
      }).catch(() => null),
      message,
    };
  }

  private compactFaqGeneratedText(value: unknown, maxLength = 3000): string {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  private uniqueStringList(values: unknown, limit: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: unknown) => {
      const text = String(value || "")
        .replace(/^[-・*\d.、\s]+/g, "")
        .trim();
      if (!text || text.length < 2) return;
      const key = normalizeJapaneseText(text).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(text.slice(0, 120));
    };
    if (Array.isArray(values)) values.forEach(push);
    else
      String(values || "")
        .split(/[\n/／,，、]+/)
        .forEach(push);
    return out.slice(0, limit);
  }

  private faqTextSimilarity(a: unknown, b: unknown): number {
    const left = normalizeJapaneseText(String(a || "")).replace(/\s+/g, "");
    const right = normalizeJapaneseText(String(b || "")).replace(/\s+/g, "");
    if (!left && !right) return 100;
    if (!left || !right) return 0;
    if (left === right) return 100;
    const shorter = Math.min(left.length, right.length);
    const longer = Math.max(left.length, right.length);
    const samePrefix = (() => {
      let count = 0;
      while (count < shorter && left[count] === right[count]) count += 1;
      return count;
    })();
    const grams = (text: string) => {
      const set = new Set<string>();
      for (let i = 0; i < text.length - 1; i += 1)
        set.add(text.slice(i, i + 2));
      return set;
    };
    const aSet = grams(left);
    const bSet = grams(right);
    let intersection = 0;
    aSet.forEach((x) => {
      if (bSet.has(x)) intersection += 1;
    });
    const union = Math.max(1, aSet.size + bSet.size - intersection);
    return Math.round(
      ((intersection / union) * 0.82 +
        (samePrefix / Math.max(1, longer)) * 0.18) *
        100,
    );
  }

  private buildVisibleFaqImprovementFallback(record: any): Partial<any> {
    const question = String(record?.question || "")
      .replace(/[？?。]+$/g, "")
      .trim();
    const answer = String(record?.answer || "").trim();
    const category = String(record?.category || "").trim();
    const tags = Array.isArray(record?.tags)
      ? record.tags.map(String).filter(Boolean)
      : [];
    const keyTerms = Array.from(
      new Set(
        [
          ...tags,
          ...question
            .split(/[\s、。・,，!?！？「」『』()（）]+/)
            .filter((x) => x.trim().length >= 2),
          category,
        ]
          .map((x) => String(x || "").trim())
          .filter(Boolean),
      ),
    ).slice(0, 8);
    const likelyQuestions = [
      question ? `${question}について教えてください` : "",
      question ? `${question}を確認したい` : "",
      keyTerms[0] ? `${keyTerms[0]}の対象や条件を確認したい` : "",
      keyTerms[0] ? `${keyTerms[0]}の手続きはどうすればよいですか？` : "",
      keyTerms[1] ? `${keyTerms[1]}について知りたい` : "",
      category ? `${category}で必要な確認事項を教えてください` : "",
    ];
    const improvedAnswer =
      answer.includes("【結論】") || answer.length < 40
        ? answer
        : [
            "【結論】",
            answer,
            "",
            "【確認するとよいこと】",
            "・対象者、手続き名、期限、必要書類などを確認してください。",
            "・条件により取扱いが異なる場合は、担当部署または根拠資料で確認してください。",
          ].join("\n");
    return {
      improvedQuestion: question
        ? `${question}（対象・条件・手続きの確認）`
        : "",
      improvedAnswer,
      likelyQuestions,
      paraphrases: keyTerms,
      suggestedActions: [
        "対象者を確認する",
        "手続き名を確認する",
        "期限・提出先を確認する",
      ],
    };
  }

  private normalizeGeneratedFaqImprovementDraft(
    record: any,
    template: any,
    parsed: any,
    result?: { text?: string; elapsedMs?: number },
    check?: any,
    settings?: SmartAssistGenerationSettings,
  ): any {
    const originalQuestion = String(record?.question || "").trim();
    const originalAnswer = String(record?.answer || "").trim();
    const fallback = this.buildVisibleFaqImprovementFallback(record);
    const parsedObject = parsed && typeof parsed === "object" ? parsed : {};
    const draft: any = {
      ...template,
      ...parsedObject,
      provider: result ? "llama-cpp" : template.provider,
      model: result
        ? path.basename(
            String(
              check?.selectedModelPath || settings?.selectedModelPath || "",
            ),
          )
        : template.model,
      elapsedMs: result?.elapsedMs,
      rawText: result?.text,
    };

    draft.summary = this.compactFaqGeneratedText(
      draft.summary || template.summary,
      400,
    );
    draft.improvedQuestion = this.compactFaqGeneratedText(
      draft.improvedQuestion ||
        fallback.improvedQuestion ||
        template.improvedQuestion,
      300,
    );
    draft.improvedAnswer = this.compactFaqGeneratedText(
      draft.improvedAnswer ||
        fallback.improvedAnswer ||
        template.improvedAnswer,
      4000,
    );
    draft.likelyQuestions = this.uniqueStringList(
      [
        ...this.uniqueStringList(draft.likelyQuestions, 20),
        ...(fallback.likelyQuestions || []),
      ],
      12,
    ).filter((x) => this.faqTextSimilarity(x, originalQuestion) < 96);
    draft.paraphrases = this.uniqueStringList(
      [
        ...this.uniqueStringList(draft.paraphrases, 20),
        ...(fallback.paraphrases || []),
      ],
      16,
    );
    draft.negativeTerms = this.uniqueStringList(draft.negativeTerms, 12);
    draft.suggestedActions = this.uniqueStringList(
      [
        ...this.uniqueStringList(draft.suggestedActions, 20),
        ...(fallback.suggestedActions || []),
      ],
      8,
    );
    draft.notes = this.uniqueStringList(draft.notes, 8);

    const questionSimilarity = this.faqTextSimilarity(
      originalQuestion,
      draft.improvedQuestion,
    );
    const answerSimilarity = this.faqTextSimilarity(
      originalAnswer,
      draft.improvedAnswer,
    );
    const visiblyChanged =
      questionSimilarity < 92 ||
      answerSimilarity < 92 ||
      draft.likelyQuestions.length >= 3 ||
      draft.paraphrases.length >= 3;
    if (!visiblyChanged) {
      draft.improvedQuestion = String(
        fallback.improvedQuestion || draft.improvedQuestion || originalQuestion,
      ).trim();
      draft.improvedAnswer = String(
        fallback.improvedAnswer || draft.improvedAnswer || originalAnswer,
      ).trim();
      draft.likelyQuestions = this.uniqueStringList(
        fallback.likelyQuestions,
        8,
      );
      draft.paraphrases = this.uniqueStringList(fallback.paraphrases, 12);
      draft.suggestedActions = this.uniqueStringList(
        fallback.suggestedActions,
        8,
      );
      draft.notes = [
        "生成AIの出力が既存FAQとほぼ同じだったため、検索ヒントと確認観点を補う形に調整しました。",
        ...draft.notes,
      ];
    }
    draft.diagnostics = {
      generatedByLlama: Boolean(result),
      model: draft.model || "",
      elapsedMs: result?.elapsedMs || null,
      questionSimilarity,
      answerSimilarity,
      changedQuestion: questionSimilarity < 92,
      changedAnswer: answerSimilarity < 92,
      likelyQuestionCount: draft.likelyQuestions.length,
      paraphraseCount: draft.paraphrases.length,
      parsedJson: Boolean(parsed && typeof parsed === "object"),
      rawTextPreview: result?.text ? String(result.text).slice(0, 600) : "",
    };
    return draft;
  }

  private buildTemplateFaqImprovementDraft(record: any): any {
    const question = String(record?.question || "").trim();
    const answer = String(record?.answer || "").trim();
    const category = String(record?.category || "未分類").trim();
    const tags = Array.isArray(record?.tags)
      ? record.tags.map(String).filter(Boolean)
      : [];
    const baseTerms = Array.from(
      new Set([
        ...question
          .split(/[\s、。・,，!?！？「」『』()（）]+/)
          .map((x) => x.trim())
          .filter((x) => x.length >= 2),
        ...tags,
        category,
      ]),
    ).slice(0, 10);
    const likelyQuestions = Array.from(
      new Set(
        [
          question,
          question.replace(/[？?。]+$/g, "").trim() + "について教えてください",
          `${category}について確認したい`,
          baseTerms[0] ? `${baseTerms[0]}はどうすればよいですか？` : "",
          baseTerms[1] ? `${baseTerms[1]}について知りたい` : "",
        ]
          .map((x) => String(x || "").trim())
          .filter(Boolean),
      ),
    ).slice(0, 6);
    const paraphrases = Array.from(
      new Set(baseTerms.filter((x) => x.length <= 20)),
    ).slice(0, 10);
    return {
      mode: "template",
      provider: "template-fallback",
      summary:
        "生成AIが未準備のため、既存FAQから安全な改善候補を作成しました。",
      improvedQuestion: question,
      improvedAnswer: answer,
      likelyQuestions,
      paraphrases,
      negativeTerms: Array.isArray(record?.negativeTerms)
        ? record.negativeTerms
        : [],
      suggestedActions: [
        "代表質問・回答を確認する",
        "想定質問を追加して短文検索に強くする",
        "似たFAQに誤ヒットする場合は除外語を追加する",
      ],
      notes: [
        "この案は自動保存されません。内容を確認してから反映してください。",
      ],
    };
  }

  private formatLlamaExecError(
    err: any,
    executable: string,
    args: string[],
    cwd: string,
    promptFile?: string,
  ): string {
    const stderr = String(err?.stderr || "").trim();
    const stdout = String(err?.stdout || "").trim();
    const lines = [
      stderr
        ? `stderr:
${stderr}`
        : "",
      stdout
        ? `stdout:
${stdout}`
        : "",
      err?.code !== undefined ? `exitCode: ${String(err.code)}` : "",
      err?.signal ? `signal: ${String(err.signal)}` : "",
      err?.killed !== undefined ? `killed: ${String(err.killed)}` : "",
      err?.message ? `message: ${String(err.message)}` : "",
      `executable: ${executable}`,
      `cwd: ${cwd}`,
      `args: ${args.map((x) => (x.includes(" ") ? JSON.stringify(x) : x)).join(" ")}`,
      promptFile ? `promptFile: ${promptFile}` : "",
      err?.stdout ? `stdout: ${String(err.stdout).slice(0, 2000)}` : "",
      err?.stderr ? `stderr: ${String(err.stderr).slice(0, 2000)}` : "",
    ].filter(Boolean);
    return lines.join("\n").slice(0, 5000);
  }

  private buildLlamaExecutionError(
    primaryErr: any,
    retryErr: any,
    executable: string,
    primaryArgs: string[],
    retryArgs: string[],
    cwd: string,
    promptFile: string,
  ): Error {
    const hint =
      process.platform === "darwin"
        ? "Macの場合は、llamaフォルダ全体を指定し、必要に応じて xattr -dr com.apple.quarantine <llamaフォルダ> と chmod +x <llama-completion> または chmod +x <llama-cli> を実行してください。"
        : "llamaフォルダに llama-completion.exe / llama-cli.exe と必要DLLがあるか確認してください。";
    const detail = [
      "primary attempt:",
      this.formatLlamaExecError(
        primaryErr,
        executable,
        primaryArgs,
        cwd,
        promptFile,
      ),
      "",
      "retry without --no-display-prompt:",
      this.formatLlamaExecError(
        retryErr,
        executable,
        retryArgs,
        cwd,
        promptFile,
      ),
    ]
      .join("\n")
      .slice(0, 7000);
    return new Error(`llama.cppの実行に失敗しました。${hint}\n${detail}`);
  }

  private getLlamaSystemPrompt(): string {
    return "あなたはローカルワークスペースの業務支援AIです。必ず日本語で、ユーザーが指定した出力形式に従ってください。根拠にない事実は推測しないでください。";
  }

  private isLlamaCompletionExecutable(executable: string): boolean {
    return /^llama-completion(?:\.exe)?$/i.test(
      path.basename(String(executable || "")),
    );
  }

  private appendIfMissing(args: string[], ...items: string[]): string[] {
    const out = [...args];
    for (const item of items) {
      if (!out.includes(item)) out.push(item);
    }
    return out;
  }

  private buildLlamaPromptForModel(prompt: string, modelPath: string): string {
    const modelName = path.basename(String(modelPath || "")).toLowerCase();
    // Qwen Instruct系は素のプロンプトを -f で渡すと、環境によって即EOSになり空出力になることがある。
    // llama.cpp のchat templateオプション差異を避けるため、QwenのChatML形式をアプリ側で明示的に付与する。
    if (modelName.includes("qwen")) {
      return [
        "<|im_start|>system",
        this.getLlamaSystemPrompt(),
        "<|im_end|>",
        "<|im_start|>user",
        prompt,
        "<|im_end|>",
        "<|im_start|>assistant",
        "",
      ].join("\n");
    }
    return prompt;
  }

  private stripAnsiCodes(text: string): string {
    return String(text || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  }

  private extractLlamaPrimaryAnswer(
    stdout: string,
    stderr: string = "",
  ): string {
    const strip = (value: string) =>
      this.stripAnsiCodes(String(value || ""))
        .replace(/\r/g, "")
        .replace(/\[end of text\]/gi, "")
        .replace(/<\|im_end\|>/g, "")
        .replace(/<\|endoftext\|>/g, "")
        .trim();

    const extractBalancedJson = (value: string): string => {
      const v = strip(value);
      const firstBrace = v.indexOf("{");
      if (firstBrace < 0) return "";
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = firstBrace; i < v.length; i += 1) {
        const ch = v[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) return v.slice(firstBrace, i + 1).trim();
        }
      }
      return "";
    };

    // llama-completion の実回答は stdout、診断ログは stderr に出る。
    // まず stdout だけを見て、JSONコードブロックまたはJSONオブジェクトを最優先で回収する。
    const out = strip(stdout);
    if (out) {
      const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced?.[1]) {
        const json = extractBalancedJson(fenced[1]);
        if (json) return json;
        const body = strip(fenced[1]);
        if (body) return body;
      }
      const json = extractBalancedJson(out);
      if (json) return json;
      const nonLog = out
        .split(/\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !/^\d+(?:\.\d+)*\s+[IWE]\s+/i.test(line) &&
            !/^common_perf_print:/i.test(line),
        )
        .join("\n")
        .trim();
      if (nonLog && /[ぁ-んァ-ヶ一-龠A-Za-z0-9]/.test(nonLog)) return nonLog;
    }

    // まれにstdoutが空でstderrに本文が混ざるビルドへの保険。
    const err = strip(stderr);
    const fenced = err.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      const json = extractBalancedJson(fenced[1]);
      if (json) return json;
    }
    const json = extractBalancedJson(err);
    if (json) return json;
    return "";
  }

  private cleanLlamaGeneratedText(
    text: string,
    originalPrompt: string,
  ): string {
    const rawOutput = this.stripAnsiCodes(String(text || "")).trim();
    if (!rawOutput) return "";

    const extractBalancedJson = (value: string): string => {
      let v = String(value || "")
        .replace(/\[end of text\]/gi, "")
        .replace(/<\|im_end\|>/g, "")
        .replace(/<\|endoftext\|>/g, "")
        .trim();
      const firstBrace = v.indexOf("{");
      const lastBrace = v.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        v = v.slice(firstBrace, lastBrace + 1).trim();
      }
      return v.trim();
    };

    // v310: llama-completion は本文を stdout、詳細ログを stderr に出す。
    // stdoutに ```json ... ``` がある場合、ログ除去より先に本文として確定する。
    const fencedJson = rawOutput.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedJson?.[1]) {
      const extracted = extractBalancedJson(fencedJson[1]);
      if (extracted) return extracted;
    }

    const rawJson = extractBalancedJson(rawOutput);
    if (/^\{[\s\S]*\}$/.test(rawJson)) {
      return rawJson;
    }

    let output = rawOutput;

    // v305: b9632系 llama-cli の対話モード出力から、回答本文だけを安全に取り出す。
    // 例: banner -> available commands -> "> <|im_start|>..." -> assistant回答 -> perf -> ">" -> Exiting...
    const removeInteractiveNoise = (value: string) =>
      value
        .split(/\r?\n/)
        .filter((line) => {
          const t = line.trim();
          if (!t) return true;
          if (/^\d+(?:\.\d+)*\s+[IWE]\s+/i.test(t)) return false;
          if (
            /^(llama_|ggml_|main:|system_info:|sampler seed:|sampler params:|sampler chain:|generate:|model loader:|print_info:)/i.test(
              t,
            )
          )
            return false;
          if (
            /^(common_|build\s*:|model\s*:|modalities\s*:|sampling:|llama_model_loader:|llama_context:|llama_kv_cache:|common_perf_print:)/i.test(
              t,
            )
          )
            return false;
          if (/^==\s*Running in interactive mode\.\s*==/i.test(t)) return false;
          if (/^-\s*(Press|To return|If you want|Not using)/i.test(t))
            return false;
          if (/^MTL\s*:|^CPU\s*:/i.test(t)) return false;
          if (/^load_.*:/i.test(t)) return false;
          if (/^available commands:/i.test(t)) return false;
          if (/is not supported by llama-cli/i.test(t)) return false;
          if (/please use llama-completion instead/i.test(t)) return false;
          if (/^Loading model\.\.\./i.test(t)) return false;
          if (/^\/(exit|regen|clear|read|glob)\b/i.test(t)) return false;
          if (/^\[\s*Prompt:.*Generation:/i.test(t)) return false;
          if (/^Exiting\.\.\.$/i.test(t)) return false;
          if (/^[▄█▀\s]+$/.test(t)) return false;
          // 対話プロンプトだけの行は落とす。"> 回答" のような行は残す。
          if (/^>\s*$/.test(t)) return false;
          return true;
        })
        .join("\n")
        .trim();

    output = removeInteractiveNoise(output);

    // ChatMLのassistant以降を最優先で抜き出す。対話モードでは行頭に "> " が付くことがある。
    const assistantRe = /(?:^|\n)\s*>?\s*<\|im_start\|>assistant\s*/g;
    let lastAssistantEnd = -1;
    for (const match of output.matchAll(assistantRe)) {
      lastAssistantEnd = (match.index || 0) + match[0].length;
    }
    if (lastAssistantEnd >= 0) {
      output = output.slice(lastAssistantEnd).trim();
    }

    output = output
      .replace(/<\|im_start\|>system[\s\S]*?<\|im_end\|>/g, "")
      .replace(/<\|im_start\|>user[\s\S]*?<\|im_end\|>/g, "")
      .replace(/<\|im_start\|>assistant/g, "")
      .replace(/<\|im_end\|>/g, "")
      .replace(/<\|endoftext\|>/g, "")
      .replace(/<\|eot_id\|>/g, "")
      .replace(/<\|end\|>/g, "")
      .replace(/^>\s*/gm, "")
      .trim();

    output = removeInteractiveNoise(output);

    // llama-cliの非対応オプション警告だけが残った場合は回答として扱わない。
    if (
      /is not supported by llama-cli/i.test(output) ||
      /please use llama-completion instead/i.test(output)
    ) {
      return "";
    }

    if (
      /^(?:\d+(?:\.\d+)*\s+[IWE]\s+|system_info:|sampler |generate:|common_perf_print:|== Running)/im.test(
        output,
      ) &&
      !/[ぁ-んァ-ヶ一-龠]{2,}|\{[\s\S]*\}/.test(output)
    ) {
      return "";
    }

    if (originalPrompt && output.startsWith(originalPrompt)) {
      output = output.slice(originalPrompt.length).trim();
    }

    // Markdownコードブロック・[end of text]・余分なログ尾部を除去し、JSONがあればJSONだけを採用する。
    output = output
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```[\s\S]*$/i, "")
      .trim();
    output = extractBalancedJson(output);
    return output.trim();
  }

  private looksLikeLlamaAnswerReady(output: string): boolean {
    const text = this.stripAnsiCodes(String(output || ""));
    if (!text.trim()) return false;
    // b9632系 llama-cli は生成後も対話プロンプトで待機するため、速度ログまたはChatML終了トークンを見たら本文取得可能とみなす。
    if (/\[\s*Prompt:.*Generation:/i.test(text)) return true;
    if (/<\|im_end\|>/.test(text) && /<\|im_start\|>assistant/.test(text))
      return true;
    // compact promptではコードブロックJSONだけが出る場合がある。
    if (/```json[\s\S]*?```/i.test(text)) return true;
    return false;
  }

  private async runLlamaProcessOnce(
    executable: string,
    runArgs: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
  ): Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    killed: boolean;
  }> {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, runArgs, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let settled = false;
      let killedByEarlyReturn = false;
      let earlyTimer: NodeJS.Timeout | undefined;

      const clearAll = () => {
        clearTimeout(timeoutTimer);
        if (earlyTimer) clearTimeout(earlyTimer);
      };

      const finish = (value: {
        stdout: string;
        stderr: string;
        code: number | null;
        signal: NodeJS.Signals | null;
        killed: boolean;
      }) => {
        if (settled) return;
        settled = true;
        clearAll();
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        resolve({ ...value, stdout, stderr });
      };

      const fail = (error: any) => {
        if (settled) return;
        settled = true;
        clearAll();
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      };

      const timeoutTimer = setTimeout(() => {
        const error: any = new Error(
          `llama.cpp timed out after ${Math.round(options.timeoutMs / 1000)}秒`,
        );
        error.killed = true;
        error.signal = "SIGTERM";
        try {
          child.kill("SIGTERM");
        } catch {}
        fail(error);
      }, options.timeoutMs);

      const scheduleEarlyReturn = () => {
        if (
          earlyTimer ||
          !this.looksLikeLlamaAnswerReady(`${stdout}\n${stderr}`)
        )
          return;
        earlyTimer = setTimeout(() => {
          // llama-cli b9632 は回答後に ">" で待つことがある。本文は取得済みなので即座に停止してUIへ返す。
          killedByEarlyReturn = true;
          try {
            child.stdin.write("/exit\n");
          } catch {}
          try {
            child.stdin.end();
          } catch {}
          setTimeout(() => {
            if (!settled) {
              try {
                child.kill("SIGTERM");
              } catch {}
              finish({ stdout, stderr, code: 0, signal: null, killed: true });
            }
          }, 400);
        }, 250);
      };

      child.stdout.on("data", (chunk) => {
        // v349: Buffer.toString('utf8') per chunk can split Japanese multibyte characters
        // and create mojibake like "���約". StringDecoder preserves incomplete bytes
        // across chunks and decodes them only when complete.
        stdout += Buffer.isBuffer(chunk)
          ? stdoutDecoder.write(chunk)
          : String(chunk);
        scheduleEarlyReturn();
      });
      child.stderr.on("data", (chunk) => {
        stderr += Buffer.isBuffer(chunk)
          ? stderrDecoder.write(chunk)
          : String(chunk);
        scheduleEarlyReturn();
      });
      child.on("error", fail);
      child.on("close", (code, signal) => {
        if (code && code !== 0 && !killedByEarlyReturn) {
          const error: any = new Error(`llama.cpp exited with code ${code}`);
          error.code = code;
          error.signal = signal;
          error.killed = false;
          error.stdout = stdout;
          error.stderr = stderr;
          fail(error);
          return;
        }
        finish({ stdout, stderr, code, signal, killed: killedByEarlyReturn });
      });

      // -p/-f でプロンプトは渡している。stdinを閉じると一部ビルドは生成前に終了するため、回答検出までは閉じない。
    });
  }

  private llamaServerExecutableNames(): string[] {
    return process.platform === "win32"
      ? ["llama-server.exe"]
      : ["llama-server"];
  }

  private async isUsableLlamaServerExecutable(
    filePath?: string,
  ): Promise<boolean> {
    const candidate = String(filePath || "").trim();
    if (
      !candidate ||
      this.isGenerationModelPath(candidate) ||
      !(await fs.pathExists(candidate))
    )
      return false;
    const stat = await fs.stat(candidate).catch(() => null);
    if (!stat?.isFile()) return false;
    if (process.platform === "win32")
      return /^llama-server\.exe$/i.test(path.basename(candidate));
    return (
      this.llamaServerExecutableNames().includes(
        path.basename(candidate).toLowerCase(),
      ) && Boolean(stat.mode & 0o111)
    );
  }

  private async findLlamaServerInDir(
    dir?: string,
  ): Promise<string | undefined> {
    const baseDir = String(dir || "").trim();
    if (!baseDir || !(await fs.pathExists(baseDir))) return undefined;
    const names = this.llamaServerExecutableNames();
    for (const name of names) {
      const candidate = path.join(baseDir, name);
      if (await this.isUsableLlamaServerExecutable(candidate)) return candidate;
    }
    const entries = await fs
      .readdir(baseDir, { withFileTypes: true })
      .catch(() => [] as any[]);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (
        !/^(bin|build|release|dist|llama|macos|windows|cpu|server)$/i.test(
          entry.name,
        )
      )
        continue;
      for (const name of names) {
        const candidate = path.join(baseDir, entry.name, name);
        if (await this.isUsableLlamaServerExecutable(candidate))
          return candidate;
      }
    }
    return undefined;
  }

  private async resolveLlamaServerExecutable(
    settings: SmartAssistGenerationSettings,
    check?: any,
  ): Promise<string | undefined> {
    const configured = String(
      (settings as any).llamaServerExecutablePath || "",
    ).trim();
    if (configured && (await this.isUsableLlamaServerExecutable(configured)))
      return configured;
    const runtimeDir = String(
      (settings as any).llamaRuntimeDir || check?.llamaRuntimeDir || "",
    ).trim();
    const fromRuntime = await this.findLlamaServerInDir(runtimeDir);
    if (fromRuntime) return fromRuntime;
    const completionPath = String(
      check?.llamaExecutablePath || settings.llamaExecutablePath || "",
    ).trim();
    if (completionPath) {
      const sibling = await this.findLlamaServerInDir(
        path.dirname(completionPath),
      );
      if (sibling) return sibling;
    }
    return undefined;
  }

  private async requestLocalLlamaServer(
    host: string,
    port: number,
    pathName: string,
    body?: any,
    timeoutMs = 3000,
  ): Promise<any> {
    const payload =
      body === undefined
        ? undefined
        : Buffer.from(JSON.stringify(body), "utf8");
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: host,
          port,
          path: pathName,
          method: payload ? "POST" : "GET",
          timeout: timeoutMs,
          headers: payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": payload.length,
              }
            : undefined,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if ((res.statusCode || 0) >= 400) {
              reject(
                new Error(
                  `llama-server HTTP ${res.statusCode}: ${data.slice(0, 500)}`,
                ),
              );
              return;
            }
            try {
              resolve(data ? JSON.parse(data) : {});
            } catch {
              resolve(data);
            }
          });
        },
      );
      req.on("timeout", () => {
        req.destroy(new Error("llama-server request timeout"));
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async getProcessMemoryMb(
    pid?: number | null,
  ): Promise<number | null> {
    const id = Number(pid || 0);
    if (!id) return null;
    try {
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync(
          "tasklist",
          ["/FI", `PID eq ${id}`, "/FO", "CSV", "/NH"],
          { timeout: 3000 } as any,
        );
        const m = String(stdout || "").match(/"([\d,]+) K"/);
        if (m)
          return Number((Number(m[1].replace(/,/g, "")) / 1024).toFixed(1));
      } else {
        const { stdout } = await execFileAsync(
          "ps",
          ["-o", "rss=", "-p", String(id)],
          { timeout: 3000 } as any,
        );
        const kb = Number(String(stdout || "").trim());
        if (Number.isFinite(kb) && kb > 0)
          return Number((kb / 1024).toFixed(1));
      }
    } catch {}
    return null;
  }

  private async getLlamaServerStatus(
    settings?: SmartAssistGenerationSettings,
    check?: any,
  ): Promise<any> {
    const host = String(
      (settings as any)?.llamaServerHost ||
        this.llamaServerState.host ||
        "127.0.0.1",
    );
    const port = Math.max(
      1024,
      Math.min(
        65535,
        Number(
          (settings as any)?.llamaServerPort ||
            this.llamaServerState.port ||
            18080,
        ) || 18080,
      ),
    );
    const proc = this.llamaServerProcess;
    const pid = proc?.pid || this.llamaServerState.pid || null;
    let reachable = false;
    let health: any = null;
    try {
      health = await this.requestLocalLlamaServer(
        host,
        port,
        "/health",
        undefined,
        1500,
      );
      reachable = true;
    } catch {
      try {
        health = await this.requestLocalLlamaServer(
          host,
          port,
          "/v1/models",
          undefined,
          1500,
        );
        reachable = true;
      } catch {}
    }
    const memoryMb = await this.getProcessMemoryMb(pid);
    const state = reachable
      ? "running"
      : proc
        ? "starting"
        : this.llamaServerState.state || "stopped";
    return {
      ok: reachable,
      state,
      running: Boolean(proc && !proc.killed),
      managedByApp: Boolean(proc && !proc.killed),
      reachable,
      pid,
      memoryMb,
      host,
      port,
      contextSize:
        Number((this.llamaServerState as any).contextSize || 0) || null,
      modelLoaded: reachable,
      startedAt: this.llamaServerState.startedAt,
      lastError: this.llamaServerState.lastError,
      modelPath:
        this.llamaServerState.modelPath ||
        check?.selectedModelPath ||
        settings?.selectedModelPath,
      executablePath:
        this.llamaServerState.executablePath ||
        (await this.resolveLlamaServerExecutable(settings || {}, check)),
      health,
    };
  }

  async getSmartAssistGenerationServerStatus(): Promise<any> {
    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    return this.getLlamaServerStatus(settings, check);
  }

  async stopSmartAssistGenerationServer(): Promise<any> {
    const proc = this.llamaServerProcess;
    if (proc) {
      try {
        proc.kill("SIGTERM");
      } catch {}
    }
    this.llamaServerProcess = null;
    this.llamaServerState = {
      ...this.llamaServerState,
      state: "stopped",
      pid: null,
      lastError: null,
      contextSize: null,
    };
    return this.getSmartAssistGenerationServerStatus();
  }

  async startSmartAssistGenerationServer(
    options: { contextSize?: number; forceRestart?: boolean } = {},
  ): Promise<any> {
    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok)
      throw new Error(check?.message || "生成AIがOFFまたは未準備です。");
    const modelPath = String(
      check.selectedModelPath || settings.selectedModelPath || "",
    ).trim();
    const executable = await this.resolveLlamaServerExecutable(settings, check);
    if (!executable)
      throw new Error(
        "llama-server が見つかりません。llama.cppフォルダに llama-server.exe / llama-server がある場合だけ高速常駐モードを利用できます。",
      );
    const host = String((settings as any).llamaServerHost || "127.0.0.1");
    const port = Math.max(
      1024,
      Math.min(
        65535,
        Number((settings as any).llamaServerPort || 18080) || 18080,
      ),
    );
    const desiredContextSize = Math.max(
      512,
      Math.min(
        8192,
        Number(options.contextSize || settings.contextSize || 1024) || 1024,
      ),
    );
    const current = await this.getLlamaServerStatus(settings, check);
    if (current.reachable) {
      const currentContextSize = Number(current.contextSize || 0) || null;
      const managedByApp = Boolean(
        this.llamaServerProcess && !this.llamaServerProcess.killed,
      );
      const needsRestartForContext =
        managedByApp &&
        currentContextSize &&
        currentContextSize < desiredContextSize;
      if (options.forceRestart || needsRestartForContext) {
        await this.stopSmartAssistGenerationServer().catch(() => null);
      } else {
        return {
          ...current,
          recommendedContextSize: desiredContextSize,
          contextWarning:
            currentContextSize && currentContextSize < desiredContextSize
              ? `現在のllama-server ctx=${currentContextSize} は推奨ctx=${desiredContextSize}より小さいため、長文では失敗する可能性があります。`
              : null,
          message: "llama-server は既に起動済みです。",
        };
      }
    }
    const contextSize = desiredContextSize;
    const args = [
      "-m",
      modelPath,
      "-c",
      String(contextSize),
      "--host",
      host,
      "--port",
      String(port),
    ];
    const executableDir = path.dirname(executable);
    const env = {
      ...process.env,
      PATH: `${executableDir}${path.delimiter}${process.env.PATH || ""}`,
      DYLD_LIBRARY_PATH:
        process.platform === "darwin"
          ? `${executableDir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`
          : process.env.DYLD_LIBRARY_PATH,
      LD_LIBRARY_PATH:
        process.platform !== "win32"
          ? `${executableDir}${path.delimiter}${process.env.LD_LIBRARY_PATH || ""}`
          : process.env.LD_LIBRARY_PATH,
    } as NodeJS.ProcessEnv;
    const child = spawn(executable, args, {
      cwd: executableDir,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.llamaServerProcess = child;
    this.llamaServerState = {
      state: "starting",
      pid: child.pid || null,
      startedAt: new Date().toISOString(),
      lastError: null,
      modelPath,
      executablePath: executable,
      host,
      port,
      contextSize,
    };
    let lastLog = "";
    child.stdout?.on("data", (chunk: any) => {
      lastLog = String(chunk || "").slice(-1000);
    });
    child.stderr?.on("data", (chunk: any) => {
      lastLog = String(chunk || "").slice(-1000);
    });
    child.on("error", (error: any) => {
      this.llamaServerState.lastError = String(error?.message || error);
      this.llamaServerState.state = "error";
    });
    child.on("close", (code: any) => {
      if (this.llamaServerProcess === child) this.llamaServerProcess = null;
      this.llamaServerState.state = code === 0 ? "stopped" : "error";
      this.llamaServerState.lastError =
        code === 0 ? null : `llama-server exited with code ${code}. ${lastLog}`;
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const status = await this.getLlamaServerStatus(settings, check);
      if (status.reachable) {
        this.llamaServerState.state = "running";
        return {
          ...status,
          contextSize,
          recommendedContextSize: contextSize,
          message: `llama-server を ctx=${contextSize} で起動しました。`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(
      `llama-server の起動確認が30秒以内に完了しませんでした。${lastLog ? `\n${lastLog}` : ""}`,
    );
  }

  private async runLlamaServerGeneration(
    prompt: string,
    settings: SmartAssistGenerationSettings,
    check: any,
  ): Promise<{ text: string; command: string; elapsedMs: number }> {
    const started = Date.now();
    const desiredContextSize = Math.max(
      512,
      Math.min(8192, Number(settings.contextSize || 1024) || 1024),
    );
    const status =
      (settings as any).llamaServerAutoStart !== false
        ? await this.startSmartAssistGenerationServer({
            contextSize: desiredContextSize,
          })
        : await this.getLlamaServerStatus(settings, check);
    if (!status.reachable) throw new Error("llama-server が起動していません。");
    const maxTokens = Math.max(
      32,
      Math.min(2048, Number(settings.maxTokens || 128) || 128),
    );
    const temperature = Math.max(
      0,
      Math.min(1, Number(settings.temperature ?? 0.1)),
    );
    const timeoutMs = Math.max(
      5000,
      Math.min(
        300000,
        Number(settings.totalTimeoutMs || settings.timeoutMs || 60000) || 60000,
      ),
    );
    const promptForModel = this.buildLlamaPromptForModel(
      prompt,
      String(check?.selectedModelPath || settings.selectedModelPath || ""),
    );
    const body = {
      prompt: promptForModel,
      n_predict: maxTokens,
      temperature,
      repeat_penalty: 1.15,
      cache_prompt: true,
      stop: ["<|im_end|>", "<|endoftext|>"],
    };
    const response = await this.requestLocalLlamaServer(
      status.host,
      status.port,
      "/completion",
      body,
      timeoutMs,
    );
    const raw = String(
      response?.content ?? response?.response ?? response?.text ?? "",
    );
    const text =
      this.extractLlamaPrimaryAnswer(raw, "") ||
      this.cleanLlamaGeneratedText(raw, promptForModel);
    if (!text) throw new Error("llama-server の生成結果が空でした。");
    return {
      text,
      command: `llama-server http://${status.host}:${status.port}/completion / ctx=${status.contextSize || desiredContextSize} / required=${desiredContextSize} / max=${maxTokens} / resident`,
      elapsedMs: Date.now() - started,
    };
  }

  private async runLlamaServerGenerationStream(
    prompt: string,
    settings: SmartAssistGenerationSettings,
    check: any,
    onDelta: (delta: string) => void,
  ): Promise<{ text: string; command: string; elapsedMs: number }> {
    const started = Date.now();
    const desiredContextSize = Math.max(
      512,
      Math.min(8192, Number(settings.contextSize || 1024) || 1024),
    );
    const status =
      (settings as any).llamaServerAutoStart !== false
        ? await this.startSmartAssistGenerationServer({
            contextSize: desiredContextSize,
          })
        : await this.getLlamaServerStatus(settings, check);
    if (!status.reachable) throw new Error("llama-server が起動していません。");
    const maxTokens = Math.max(
      32,
      Math.min(2048, Number(settings.maxTokens || 128) || 128),
    );
    const temperature = Math.max(
      0,
      Math.min(1, Number(settings.temperature ?? 0.1)),
    );
    const timeoutMs = Math.max(
      5000,
      Math.min(
        300000,
        Number(settings.totalTimeoutMs || settings.timeoutMs || 60000) || 60000,
      ),
    );
    const promptForModel = this.buildLlamaPromptForModel(
      prompt,
      String(check?.selectedModelPath || settings.selectedModelPath || ""),
    );
    const body = {
      prompt: promptForModel,
      n_predict: maxTokens,
      temperature,
      repeat_penalty: 1.15,
      cache_prompt: true,
      stream: true,
      stop: ["<|im_end|>", "<|endoftext|>"],
    };
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const raw = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: status.host,
          port: status.port,
          path: "/completion",
          method: "POST",
          timeout: timeoutMs,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": payload.length,
            Accept: "text/event-stream",
          },
        },
        (res) => {
          if ((res.statusCode || 0) >= 400) {
            let error = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              error += chunk;
            });
            res.on("end", () =>
              reject(
                new Error(
                  `llama-server HTTP ${res.statusCode}: ${error.slice(0, 500)}`,
                ),
              ),
            );
            return;
          }
          const decoder = new StringDecoder("utf8");
          let pending = "";
          let combined = "";
          const consume = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") return;
            const jsonText = trimmed.startsWith("data:")
              ? trimmed.slice(5).trim()
              : trimmed;
            try {
              const event = JSON.parse(jsonText);
              const delta = String(
                event?.content ?? event?.response ?? event?.text ?? "",
              );
              if (delta) {
                combined += delta;
                onDelta(delta);
              }
            } catch {
              /* Ignore non-data diagnostic lines from older llama-server builds. */
            }
          };
          res.on("data", (chunk: Buffer | string) => {
            pending += decoder.write(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            );
            const lines = pending.split(/\r?\n/);
            pending = lines.pop() || "";
            lines.forEach(consume);
          });
          res.on("end", () => {
            pending += decoder.end();
            if (pending.trim()) consume(pending);
            resolve(combined);
          });
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("llama-server stream timeout")),
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    const text =
      this.extractLlamaPrimaryAnswer(raw, "") ||
      this.cleanLlamaGeneratedText(raw, promptForModel);
    if (!text) throw new Error("llama-server のストリーム生成結果が空でした。");
    return {
      text,
      command: `llama-server stream http://${status.host}:${status.port}/completion / ctx=${status.contextSize || desiredContextSize} / required=${desiredContextSize} / max=${maxTokens} / resident`,
      elapsedMs: Date.now() - started,
    };
  }

  private async runLlamaGeneration(
    prompt: string,
    settings: SmartAssistGenerationSettings,
    check: any,
    onDelta?: (delta: string) => void,
  ): Promise<{ text: string; command: string; elapsedMs: number }> {
    if ((settings as any).generationRuntimeMode === "server") {
      try {
        return onDelta
          ? await this.runLlamaServerGenerationStream(
              prompt,
              settings,
              check,
              onDelta,
            )
          : await this.runLlamaServerGeneration(prompt, settings, check);
      } catch (serverError: any) {
        if ((settings as any).llamaServerFallback !== false) {
          console.warn(
            "LLAMA_SERVER_FALLBACK_TO_ONESHOT",
            serverError?.message || serverError,
          );
        } else {
          throw serverError;
        }
      }
    }
    const configuredExecutable = String(
      check?.llamaExecutablePath || settings.llamaExecutablePath || "",
    ).trim();
    const modelPath = String(
      check?.selectedModelPath || settings.selectedModelPath || "",
    ).trim();
    if (!configuredExecutable || !modelPath)
      throw new Error("llama実行ファイルまたはGGUFモデルが未設定です。");

    // v308: b9632系の llama-cli は対話モードで待機し、回答後もプロセスが閉じない。
    // 同じフォルダに llama-completion がある場合は必ずそちらへ切り替え、非対話で即時終了させる。
    const resolvedGenerationExecutable =
      await this.resolveGenerationLlamaExecutable(configuredExecutable);
    const executable = resolvedGenerationExecutable.executable;
    const executableDir = path.dirname(executable);
    const performanceMode =
      settings.performanceMode ||
      (settings.preset === "fast"
        ? "fast"
        : settings.preset === "balanced"
          ? "quality"
          : "standard");
    const retryMode =
      settings.retryMode || (performanceMode === "fast" ? "off" : "on-error");
    const fastMode = performanceMode === "fast";
    let contextSize = Math.max(
      512,
      Math.min(8192, Number(settings.contextSize || (fastMode ? 1024 : 2048))),
    );
    const maxTokens = Math.max(
      32,
      Math.min(2048, Number(settings.maxTokens || (fastMode ? 128 : 512))),
    );
    // v344: 会社端末では長文prompt時の自動2048化が大きな遅延原因になるため、高速モードでは底上げしない。
    if (!fastMode && String(prompt || "").length > 900) {
      contextSize = Math.max(contextSize, 2048);
    }
    const temperature = Math.max(
      0,
      Math.min(1, Number(settings.temperature ?? (fastMode ? 0.1 : 0.2))),
    );
    const timeoutMs = Math.max(
      5000,
      Math.min(
        300000,
        Number(settings.timeoutMs || (fastMode ? 45000 : 120000)),
      ),
    );
    const totalTimeoutMs = Math.max(
      timeoutMs,
      Math.min(
        300000,
        Number(
          settings.totalTimeoutMs ||
            (fastMode ? 60000 : timeoutMs * (retryMode === "full" ? 3 : 2)),
        ),
      ),
    );
    const deadline = Date.now() + totalTimeoutMs;

    // v299: 長い日本語promptをコマンドライン引数 -p に直接渡すと、OS/シェル/llama.cpp 側の制約で失敗原因が分かりにくい。
    // promptは一時ファイルに保存し、llama実行ファイルの -f/--file で渡す。これにより日本語・改行・長文に強くなる。
    const promptDir = path.join(os.tmpdir(), "local-notion-lite-llama-prompts");
    await fs.ensureDir(promptDir);
    const promptFile = path.join(
      promptDir,
      `prompt-${Date.now()}-${nanoid(8)}.txt`,
    );
    const rawPromptFile = path.join(
      promptDir,
      `prompt-raw-${Date.now()}-${nanoid(8)}.txt`,
    );
    const promptForModel = this.buildLlamaPromptForModel(prompt, modelPath);
    const qwenPromptForCli =
      promptForModel.length > 6000
        ? promptForModel.slice(0, 6000)
        : promptForModel;
    await fs.writeFile(promptFile, promptForModel, "utf8");
    await fs.writeFile(rawPromptFile, prompt, "utf8");

    const isQwenModel = path.basename(modelPath).toLowerCase().includes("qwen");
    const isCompletionExecutable = this.isLlamaCompletionExecutable(executable);
    const baseRuntimeArgs = [
      "-m",
      modelPath,
      "-n",
      String(maxTokens),
      "-c",
      String(contextSize),
      "--temp",
      String(temperature),
      "--repeat-penalty",
      "1.15",
    ];
    // v309: llama-completion はチャットテンプレートを自動適用できるため、Qwenでも手書きChatMLを渡さない。
    // -st / --single-turn を付けると、-p で1ターンだけ処理して終了する。
    // --no-perf / --no-display-prompt は本文抽出を安定させるためのログ抑制。
    const args = isCompletionExecutable
      ? isQwenModel
        ? // v312: llama-completion + Qwen は自動chat templateと長文promptが衝突しやすい。
          // 手書きChatMLを -f で渡し、-no-cnv で会話テンプレートを無効化する。
          [
            ...baseRuntimeArgs,
            "-f",
            promptFile,
            "-no-cnv",
            "--no-display-prompt",
            "--no-perf",
            "--no-warmup",
          ]
        : [
            ...baseRuntimeArgs,
            "-sys",
            this.getLlamaSystemPrompt(),
            "-f",
            rawPromptFile,
            "-st",
            "--no-display-prompt",
            "--no-perf",
            "--no-warmup",
          ]
      : isQwenModel
        ? [...baseRuntimeArgs, "-p", qwenPromptForCli]
        : [...baseRuntimeArgs, "-f", promptFile];
    const started = Date.now();
    try {
      const env = {
        ...process.env,
        // Macの配布物ではdylibが実行ファイルと同じフォルダにあることが多い。cwd/envの両方で解決しやすくする。
        PATH: `${executableDir}${path.delimiter}${process.env.PATH || ""}`,
        DYLD_LIBRARY_PATH:
          process.platform === "darwin"
            ? `${executableDir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`
            : process.env.DYLD_LIBRARY_PATH,
        LD_LIBRARY_PATH:
          process.platform !== "win32"
            ? `${executableDir}${path.delimiter}${process.env.LD_LIBRARY_PATH || ""}`
            : process.env.LD_LIBRARY_PATH,
      } as NodeJS.ProcessEnv;
      const runOnce = async (runArgs: string[]) => {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          const error: any = new Error(
            `生成AIの全体上限${Math.round(totalTimeoutMs / 1000)}秒を超えました。`,
          );
          error.killed = true;
          throw error;
        }
        return this.runLlamaProcessOnce(executable, runArgs, {
          cwd: executableDir,
          env,
          timeoutMs: Math.max(5000, Math.min(timeoutMs, remainingMs)),
        });
      };

      let stdout = "";
      let stderr = "";
      let usedArgs = args;
      try {
        const result = await runOnce(args);
        stdout = String(result.stdout || "");
        stderr = String(result.stderr || "");
      } catch (primaryErr: any) {
        if (retryMode === "off") {
          throw primaryErr;
        }
        // v309: llama-completionでは、まず -st 付きの通常chat-template実行を使う。
        // 失敗時だけログ抑制を外す / 手書きChatMLへ戻す。
        const retryArgs = isCompletionExecutable
          ? isQwenModel
            ? [
                "-m",
                modelPath,
                "-n",
                String(maxTokens),
                "-c",
                String(contextSize),
                "--temp",
                String(temperature),
                "-f",
                promptFile,
                "-no-cnv",
                "--no-warmup",
              ]
            : [
                "-m",
                modelPath,
                "-n",
                String(maxTokens),
                "-c",
                String(contextSize),
                "--temp",
                String(temperature),
                "-sys",
                this.getLlamaSystemPrompt(),
                "-f",
                rawPromptFile,
                "-st",
                "--no-warmup",
              ]
          : isQwenModel
            ? [
                "-m",
                modelPath,
                "-p",
                qwenPromptForCli,
                "-n",
                String(maxTokens),
                "-c",
                String(contextSize),
                "--temp",
                String(temperature),
                "-sp",
              ]
            : args;
        try {
          const result = await runOnce(retryArgs);
          stdout = String(result.stdout || "");
          stderr = String(result.stderr || "");
          usedArgs = retryArgs;
        } catch (retryErr: any) {
          if (isQwenModel && retryMode === "full") {
            const fileArgs = isCompletionExecutable
              ? [
                  "-m",
                  modelPath,
                  "-n",
                  String(maxTokens),
                  "-c",
                  String(contextSize),
                  "--temp",
                  String(temperature),
                  "-no-cnv",
                  "-f",
                  promptFile,
                  "--no-display-prompt",
                  "--no-perf",
                  "--no-warmup",
                ]
              : [
                  "-m",
                  modelPath,
                  "-f",
                  promptFile,
                  "-n",
                  String(maxTokens),
                  "-c",
                  String(contextSize),
                  "--temp",
                  String(temperature),
                ];
            try {
              const result = await runOnce(fileArgs);
              stdout = String(result.stdout || "");
              stderr = String(result.stderr || "");
              usedArgs = fileArgs;
            } catch (fileErr: any) {
              throw this.buildLlamaExecutionError(
                retryErr,
                fileErr,
                executable,
                retryArgs,
                fileArgs,
                executableDir,
                promptFile,
              );
            }
          } else {
            throw this.buildLlamaExecutionError(
              primaryErr,
              retryErr,
              executable,
              args,
              retryArgs,
              executableDir,
              promptFile,
            );
          }
        }
      }
      const rawCombined = [stdout, stderr].filter(Boolean).join("\n");
      const primaryAnswer = this.extractLlamaPrimaryAnswer(stdout, stderr);
      const text =
        primaryAnswer ||
        this.cleanLlamaGeneratedText(rawCombined, promptForModel);
      if (!text) {
        if (retryMode === "off") {
          const emptyDetail = this.formatLlamaExecError(
            {
              stdout,
              stderr,
              message:
                "生成結果が空でした。高速モードのため自動リトライは行いません。必要なら再実行または標準/詳細リトライに変更してください。",
            },
            executable,
            usedArgs,
            executableDir,
            promptFile,
          );
          throw new Error(emptyDetail);
        }
        // 空出力でもプロセス自体が成功している場合、Qwen/llama.cppの呼び出し形式不一致が多い。
        // 最後に、ChatMLを使わず短縮promptを -p で渡す安全フォールバックを試す。
        const compactPrompt = [
          "FAQを改善し、JSONだけで出力してください。説明文やMarkdownは禁止。",
          prompt.slice(0, 2500),
        ].join("\n");
        const compactPromptForModel = this.buildLlamaPromptForModel(
          compactPrompt,
          modelPath,
        );
        const compactPromptFile = path.join(
          promptDir,
          `prompt-compact-${Date.now()}-${nanoid(8)}.txt`,
        );
        await fs.writeFile(
          compactPromptFile,
          isQwenModel ? compactPromptForModel : compactPrompt,
          "utf8",
        );
        const lastArgs = isCompletionExecutable
          ? isQwenModel
            ? [
                "-m",
                modelPath,
                "-f",
                compactPromptFile,
                "-n",
                String(Math.min(maxTokens, 512)),
                "-c",
                String(Math.max(2048, Math.min(contextSize, 4096))),
                "--temp",
                String(temperature),
                "-no-cnv",
                "--no-display-prompt",
                "--no-perf",
                "--no-warmup",
              ]
            : [
                "-m",
                modelPath,
                "-sys",
                this.getLlamaSystemPrompt(),
                "-f",
                compactPromptFile,
                "-n",
                String(Math.min(maxTokens, 512)),
                "-c",
                String(Math.max(2048, Math.min(contextSize, 4096))),
                "--temp",
                String(temperature),
                "-st",
                "--no-display-prompt",
                "--no-perf",
                "--no-warmup",
              ]
          : [
              "-m",
              modelPath,
              "-p",
              compactPrompt,
              "-n",
              String(Math.min(maxTokens, 512)),
              "-c",
              String(Math.max(2048, Math.min(contextSize, 4096))),
              "--temp",
              String(temperature),
            ];
        try {
          const last = await runOnce(lastArgs);
          stdout = String(last.stdout || "");
          stderr = String(last.stderr || "");
          usedArgs = lastArgs;
          const lastText =
            this.extractLlamaPrimaryAnswer(stdout, stderr) ||
            this.cleanLlamaGeneratedText(
              [stdout, stderr].filter(Boolean).join("\n"),
              compactPrompt,
            );
          if (lastText) {
            return {
              text: lastText,
              command: `${path.basename(executable)} -f <compact-prompt-file>`,
              elapsedMs: Date.now() - started,
            };
          }
        } catch {
          // 詳細は下のempty errorで表示する。
        }
        const emptyDetail = this.formatLlamaExecError(
          {
            stdout,
            stderr,
            message:
              "生成結果が空でした。-p ChatML / -p ChatML without -sp / -f ChatML / compact -p を試しましたが、回答テキストを取得できませんでした。",
          },
          executable,
          usedArgs,
          executableDir,
          promptFile,
        );
        throw new Error(emptyDetail);
      }
      return {
        text,
        command: `${path.basename(executable)} ${usedArgs.includes("-p") ? "-p <prompt>" : "-f <prompt-file>"} / ctx=${contextSize} / max=${maxTokens} / ${performanceMode} / retry=${retryMode}${resolvedGenerationExecutable.switchedToCompletion ? " (auto-switched from llama-cli)" : ""}`,
        elapsedMs: Date.now() - started,
      };
    } catch (err: any) {
      if (
        String(err?.message || "").includes("llama.cppの実行に失敗しました。")
      )
        throw err;
      if (
        err?.killed ||
        err?.signal === "SIGTERM" ||
        /timed out/i.test(String(err?.message || ""))
      ) {
        throw new Error(
          `生成AIが${Math.round(Math.min(timeoutMs, totalTimeoutMs) / 1000)}秒以内に応答しませんでした。モデルが重すぎる、またはllama.cppが停止している可能性があります。会社PCでは高速モード、最大生成128、Context 1024、自動リトライOFFで再試行してください。\n${this.formatLlamaExecError(err, executable, args, executableDir, promptFile)}`,
        );
      }
      const detail = this.formatLlamaExecError(
        err,
        executable,
        args,
        executableDir,
        promptFile,
      );
      const hint =
        process.platform === "darwin"
          ? "Macの場合は、llamaフォルダ全体を指定し、必要に応じて xattr -dr com.apple.quarantine <llamaフォルダ> と chmod +x <llama-completion> または chmod +x <llama-cli> を実行してください。"
          : "llamaフォルダに llama-completion.exe / llama-cli.exe と必要DLLがあるか確認してください。";
      throw new Error(`llama.cppの実行に失敗しました。${hint}
${detail}`);
    } finally {
      await fs.remove(promptFile).catch(() => undefined);
      await fs.remove(rawPromptFile).catch(() => undefined);
    }
  }

  private extractJsonObjectFromText(text: string): any {
    const raw = this.stripAnsiCodes(String(text || ""))
      .replace(/\r/g, "")
      .replace(/\[end of text\]/gi, "")
      .replace(/<\|im_end\|>/g, "")
      .replace(/<\|endoftext\|>/g, "")
      .trim();
    if (!raw) return null;

    const candidates: string[] = [];
    const fencedRe = /```(?:json)?\s*([\s\S]*?)```/gi;
    let fencedMatch: RegExpExecArray | null;
    while ((fencedMatch = fencedRe.exec(raw))) {
      if (fencedMatch[1]?.trim()) candidates.push(fencedMatch[1].trim());
    }
    candidates.push(raw);

    const extractBalanced = (value: string): string => {
      const v = String(value || "").trim();
      const firstBrace = v.indexOf("{");
      if (firstBrace < 0) return "";
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = firstBrace; i < v.length; i += 1) {
        const ch = v[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) return v.slice(firstBrace, i + 1).trim();
        }
      }
      return "";
    };

    for (const candidate of candidates) {
      const jsonText = extractBalanced(candidate);
      if (!jsonText) continue;
      try {
        return JSON.parse(jsonText);
      } catch {
        // Try next candidate.
      }
    }

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async generateSmartFaqImprovementDraft(input: any): Promise<any> {
    const record =
      this.normalizeSmartFaqRecord(input?.record || input) ||
      input?.record ||
      input ||
      {};
    const template = this.buildTemplateFaqImprovementDraft(record);
    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok) {
      return {
        ok: true,
        generated: false,
        reason: check?.message || "生成AIがOFFまたは未準備です。",
        draft: template,
        check,
      };
    }
    const prompt = [
      "FAQを改善し、JSONだけで出力してください。説明文やMarkdownは禁止。",
      "出力キー: summary, improvedQuestion, improvedAnswer, likelyQuestions, paraphrases, negativeTerms, suggestedActions, notes",
      "条件: 事実を増やさない。元の質問・回答の丸写しは禁止。不明点は確認が必要と書く。",
      "likelyQuestionsは5件、paraphrasesは5〜10件。negativeTermsは必要な場合だけ。",
      "",
      `カテゴリ: ${String((record as any).category || "")}`,
      `タグ: ${Array.isArray((record as any).tags) ? (record as any).tags.slice(0, 8).join("、") : ""}`,
      `元の質問: ${String((record as any).question || "")}`,
      `元の回答: ${String((record as any).answer || "").slice(0, 1200)}`,
      `出典: ${Array.isArray((record as any).sourceTitles) ? (record as any).sourceTitles.slice(0, 3).join(" / ") : ""}`,
      `既存質問例: ${Array.isArray((record as any).likelyQuestions) ? (record as any).likelyQuestions.slice(0, 5).join(" / ") : ""}`,
      `既存キーワード: ${Array.isArray((record as any).paraphrases) ? (record as any).paraphrases.slice(0, 10).join(" / ") : ""}`,
    ].join("\n");
    try {
      const result = await this.runLlamaGeneration(prompt, settings, check);
      const parsed = this.extractJsonObjectFromText(result.text);
      const draft = this.normalizeGeneratedFaqImprovementDraft(
        record,
        template,
        parsed || {
          notes: [
            "JSONとして解析できなかったため、生の生成結果を確認してください。",
          ],
          rawText: result.text,
        },
        result,
        check,
        settings,
      );
      return {
        ok: true,
        generated: true,
        draft,
        rawText: result.text,
        check,
        diagnostics: draft.diagnostics,
      };
    } catch (error: any) {
      return {
        ok: false,
        generated: false,
        error: String(error?.message || error),
        draft: template,
        check,
      };
    }
  }

  async testSmartAssistGenerationEngine(): Promise<any> {
    const settings = await this.getSmartAssistGenerationSettings();
    const check = await this.checkSmartAssistGenerationEngine();
    if (!settings.enabled || settings.provider !== "llama-cpp" || !check?.ok) {
      return {
        ok: false,
        generated: false,
        error: check?.message || "生成AIがOFFまたは未準備です。",
        check,
      };
    }
    try {
      const result = await this.runLlamaGeneration(
        "「こんにちは」と一言だけ返してください。",
        {
          ...settings,
          preset: "fast",
          performanceMode: "fast",
          retryMode: "off",
          contextSize: 512,
          maxTokens: 32,
          temperature: 0,
          timeoutMs: 10000,
          totalTimeoutMs: 12000,
        },
        check,
      );
      let displayText = result.text;
      try {
        const parsed = JSON.parse(String(result.text || ""));
        if (parsed && typeof parsed === "object") {
          displayText = String(
            parsed.answer || parsed.response || parsed.text || result.text,
          ).trim();
        }
      } catch {
        // JSONでない場合は生テキストをそのまま表示する。
      }
      return {
        ok: true,
        generated: true,
        text: displayText,
        rawText: result.text,
        command: result.command,
        elapsedMs: result.elapsedMs,
        check,
      };
    } catch (error: any) {
      return {
        ok: false,
        generated: false,
        error: String(error?.message || error),
        check,
      };
    }
  }

  async getSmartAssistTransformerSettings(): Promise<SmartAssistTransformerSettings> {
    const fallbackRoot =
      process.env.SMART_ASSIST_MODEL_ROOT ||
      path.join(vaultPaths(this.sharedRoot).privateSmartAssist, "models");
    return this.smartAssistStore().getTransformerSettings(
      fallbackRoot,
    ) as unknown as Promise<SmartAssistTransformerSettings>;
  }

  async updateSmartAssistTransformerSettings(
    input: Partial<SmartAssistTransformerSettings>,
  ): Promise<SmartAssistTransformerSettings> {
    const fallbackRoot =
      process.env.SMART_ASSIST_MODEL_ROOT ||
      path.join(vaultPaths(this.sharedRoot).privateSmartAssist, "models");
    const previous = await this.getSmartAssistTransformerSettings().catch(
      () => null as SmartAssistTransformerSettings | null,
    );
    const next = (await this.smartAssistStore().updateTransformerSettings(
      input as any,
      fallbackRoot,
    )) as unknown as SmartAssistTransformerSettings;

    // v459: SemanticIndexService captures localCacheDir when it is created. The
    // settings screen reads index status on mount, so merely saving a new cache
    // folder previously left the already-created service bound to "no cache"
    // until an application restart. Dispose and recreate it on relevant changes.
    const cacheDirChanged =
      String(previous?.localCacheDir || "").trim() !==
      String(next?.localCacheDir || "").trim();
    const modelChanged =
      String(previous?.modelId || "").trim() !==
        String(next?.modelId || "").trim() ||
      String(previous?.modelRoot || "").trim() !==
        String(next?.modelRoot || "").trim();
    if (cacheDirChanged || modelChanged) {
      try {
        this.semanticIndexServiceInstance?.dispose?.();
      } catch {}
      this.semanticIndexServiceInstance = null;
    }

    return next;
  }

  async checkSmartAssistTransformerModel(): Promise<any> {
    const settings = await this.getSmartAssistTransformerSettings();
    const modelId =
      settings.modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID;
    const modelRoot =
      settings.modelRoot ||
      path.join(vaultPaths(this.sharedRoot).privateSmartAssist, "models");
    const modelDir = resolveSmartAssistModelDir(modelRoot, modelId);
    const quantizedOnnxPath = path.join(
      modelDir,
      "onnx",
      "model_quantized.onnx",
    );
    const plainOnnxPath = path.join(modelDir, "onnx", "model.onnx");
    const requiredFiles = [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
    ];
    const optionalFiles = ["special_tokens_map.json"];
    const fileChecks = await Promise.all(
      [...requiredFiles, ...optionalFiles].map(async (file) => ({
        file,
        required: requiredFiles.includes(file),
        exists: await fs.pathExists(path.join(modelDir, file)),
      })),
    );
    const quantizedExists = await fs.pathExists(quantizedOnnxPath);
    const plainExists = await fs.pathExists(plainOnnxPath);
    const quantizedSize = quantizedExists
      ? (await fs.stat(quantizedOnnxPath)).size
      : 0;
    const plainSize = plainExists ? (await fs.stat(plainOnnxPath)).size : 0;
    const hasQuantizedModel = quantizedSize > 10 * 1024 * 1024;
    const hasPlainModel = plainSize > 10 * 1024 * 1024;
    const onnxPath = hasQuantizedModel ? quantizedOnnxPath : plainOnnxPath;
    const onnxSize = hasQuantizedModel ? quantizedSize : plainSize;
    const runtime = getTransformerRuntimeInfo(modelId);
    return {
      ok:
        fileChecks
          .filter((item) => item.required)
          .every((item) => item.exists) &&
        (hasQuantizedModel || hasPlainModel),
      settings,
      modelDir,
      onnxPath,
      onnxFileName: hasQuantizedModel ? "model_quantized.onnx" : "model.onnx",
      onnxExists: hasQuantizedModel || hasPlainModel,
      hasQuantizedModel,
      onnxSize,
      onnxSizeMb: Number((onnxSize / 1024 / 1024).toFixed(2)),
      fileChecks,
      runtime,
    };
  }

  async downloadSmartAssistTransformerModel(input?: {
    modelId?: string;
    modelRoot?: string;
    targetDir?: string;
    localModelPath?: string;
    overwrite?: boolean;
  }): Promise<any> {
    const requestedModelRoot =
      input?.modelRoot || input?.targetDir || input?.localModelPath;
    const settings = await this.updateSmartAssistTransformerSettings({
      ...(input?.modelId ? { modelId: input.modelId } : {}),
      ...(requestedModelRoot ? { modelRoot: requestedModelRoot } : {}),
    });
    const modelRoot =
      settings.modelRoot ||
      path.join(vaultPaths(this.sharedRoot).privateSmartAssist, "models");
    const modelId =
      settings.modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID;
    const modelDir = resolveSmartAssistModelDir(modelRoot, modelId);
    await fs.ensureDir(path.join(modelDir, "onnx"));
    const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;
    const requiredFiles = [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
    ];
    const optionalFiles = [
      "special_tokens_map.json",
      "tokenizer.model",
      "quantize_config.json",
    ];
    const downloaded: Array<{ file: string; size: number }> = [];
    const skipped: Array<{ file: string; reason: string }> = [];
    for (const file of requiredFiles) {
      const destination = path.join(modelDir, file);
      if (!input?.overwrite && (await fs.pathExists(destination))) {
        downloaded.push({ file, size: (await fs.stat(destination)).size });
        continue;
      }
      try {
        await downloadFile(`${baseUrl}/${file}?download=true`, destination);
        downloaded.push({ file, size: (await fs.stat(destination)).size });
      } catch (err: any) {
        throw new Error(
          `必須モデルファイルの取得に失敗しました: ${file} (${err?.message || err})`,
        );
      }
    }
    for (const file of optionalFiles) {
      const destination = path.join(modelDir, file);
      if (!input?.overwrite && (await fs.pathExists(destination))) {
        downloaded.push({ file, size: (await fs.stat(destination)).size });
        continue;
      }
      try {
        await downloadFile(`${baseUrl}/${file}?download=true`, destination);
        downloaded.push({ file, size: (await fs.stat(destination)).size });
      } catch (err: any) {
        skipped.push({ file, reason: String(err?.message || err) });
      }
    }
    let onnxDownloaded = false;
    const onnxCandidates = [
      {
        remote: "onnx/model_quantized.onnx",
        local: "onnx/model_quantized.onnx",
      },
      { remote: "onnx/model_int8.onnx", local: "onnx/model_quantized.onnx" },
      { remote: "onnx/model_uint8.onnx", local: "onnx/model_quantized.onnx" },
      { remote: "onnx/model.onnx", local: "onnx/model.onnx" },
      { remote: "onnx/model_fp16.onnx", local: "onnx/model.onnx" },
      { remote: "onnx/model_q4f16.onnx", local: "onnx/model.onnx" },
    ];
    const onnxErrors: Array<{ file: string; error: string }> = [];
    for (const candidate of onnxCandidates) {
      const destination = path.join(modelDir, candidate.local);
      if (!input?.overwrite && (await fs.pathExists(destination))) {
        const existingSize = (await fs.stat(destination)).size;
        if (existingSize > 10 * 1024 * 1024) {
          downloaded.push({ file: candidate.local, size: existingSize });
          onnxDownloaded = true;
          break;
        }
      }
      try {
        const tmpDestination = `${destination}.download`;
        await fs.remove(tmpDestination).catch(() => undefined);
        await downloadFile(
          `${baseUrl}/${candidate.remote}?download=true`,
          tmpDestination,
        );
        const size = (await fs.stat(tmpDestination)).size;
        if (size > 10 * 1024 * 1024) {
          await fs.move(tmpDestination, destination, { overwrite: true });
          downloaded.push({ file: candidate.local, size });
          if (candidate.remote !== candidate.local)
            downloaded.push({
              file: `${candidate.remote} -> ${candidate.local}`,
              size,
            });
          onnxDownloaded = true;
          break;
        }
        await fs.remove(tmpDestination).catch(() => undefined);
        onnxErrors.push({
          file: candidate.remote,
          error: `file too small (${size} bytes)`,
        });
      } catch (err: any) {
        onnxErrors.push({
          file: candidate.remote,
          error: String(err?.message || err),
        });
      }
    }
    if (!onnxDownloaded) {
      throw new Error(
        `ONNXモデルファイルを取得できませんでした。候補: ${onnxCandidates.map((c) => c.remote).join(", ")} / 詳細: ${JSON.stringify(onnxErrors.slice(0, 4))}`,
      );
    }
    const check = await this.checkSmartAssistTransformerModel();
    if (!check.ok)
      throw new Error(
        `Model download completed, but validation failed. modelDir=${check.modelDir || modelDir}`,
      );
    return {
      ok: true,
      message: "Transformer model downloaded.",
      settings,
      downloaded,
      skipped,
      check,
    };
  }

  private smartAssistSemanticIndexPath(): string {
    return path.join(
      vaultPaths(this.sharedRoot).smartAssist,
      "semantic-index.json",
    );
  }

  private async readSmartAssistSearchIndex(): Promise<LightweightSearchIndex | null> {
    try {
      const raw = await fs.readJson(this.smartAssistSearchIndexPath());
      return raw && raw.version === 206
        ? (raw as LightweightSearchIndex)
        : null;
    } catch {
      return null;
    }
  }

  private async readSmartAssistSemanticIndex(): Promise<TransformerSemanticIndex | null> {
    const cached =
      await this.readSmartAssistSemanticIndexFromLocalCache().catch(() => null);
    if (cached) return cached;
    try {
      const raw = await fs.readJson(this.smartAssistSemanticIndexPath());
      return raw && raw.version === TRANSFORMER_SEMANTIC_INDEX_VERSION
        ? (raw as TransformerSemanticIndex)
        : null;
    } catch {
      return null;
    }
  }

  private async getSmartAssistLocalCacheDir(): Promise<string | null> {
    const settings = await this.getSmartAssistTransformerSettings().catch(
      () => null as any,
    );
    const value = String(settings?.localCacheDir || "").trim();
    if (!value) return null;
    const resolved = path.resolve(value);
    await fs.ensureDir(resolved);
    return resolved;
  }

  private async smartAssistSemanticCacheDbPath(): Promise<string | null> {
    const dir = await this.getSmartAssistLocalCacheDir();
    if (!dir) return null;
    return path.join(dir, "smart-assist-semantic-cache.sqlite");
  }

  private openSmartAssistSemanticCacheDb(dbPath: string): any {
    const db = new SQLiteDatabase(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS semantic_items (
        faq_id TEXT PRIMARY KEY,
        model TEXT NOT NULL DEFAULT '',
        text_hash TEXT NOT NULL DEFAULT '',
        identity_hash TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        intent_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        identity_preview TEXT NOT NULL DEFAULT '',
        content_preview TEXT NOT NULL DEFAULT '',
        identity_embedding_json TEXT NOT NULL DEFAULT '[]',
        content_embedding_json TEXT NOT NULL DEFAULT '[]',
        dimension INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_items_model ON semantic_items(model);
      CREATE INDEX IF NOT EXISTS idx_semantic_items_hash ON semantic_items(text_hash);
      CREATE TABLE IF NOT EXISTS query_cache (
        query_hash TEXT PRIMARY KEY,
        normalized_query TEXT NOT NULL DEFAULT '',
        index_hash TEXT NOT NULL DEFAULT '',
        response_json TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_query_cache_index_hash ON query_cache(index_hash);
      CREATE INDEX IF NOT EXISTS idx_query_cache_created_at ON query_cache(created_at);
    `);
    return db;
  }

  private safeJsonArray(value: any): number[] {
    try {
      const raw = typeof value === "string" ? JSON.parse(value) : value;
      return Array.isArray(raw)
        ? raw.map(Number).filter((item) => Number.isFinite(item))
        : [];
    } catch {
      return [];
    }
  }

  private async readSmartAssistSemanticIndexFromLocalCache(): Promise<TransformerSemanticIndex | null> {
    const dbPath = await this.smartAssistSemanticCacheDbPath();
    if (!dbPath || !(await fs.pathExists(dbPath))) return null;
    const model =
      (await this.getSmartAssistTransformerSettings().catch(() => null as any))
        ?.modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID;
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      const metaRows = db
        .prepare("SELECT key, value FROM semantic_meta")
        .all() as Array<{ key: string; value: string }>;
      const meta = new Map(metaRows.map((row) => [row.key, row.value]));
      if (meta.get("version") !== String(TRANSFORMER_SEMANTIC_INDEX_VERSION))
        return null;
      if ((meta.get("model") || model) !== model) return null;
      const rows = db
        .prepare("SELECT * FROM semantic_items WHERE model = ? ORDER BY faq_id")
        .all(model) as any[];
      if (!rows.length) return null;
      const items = rows
        .map((row) => {
          const identityEmbedding = this.safeJsonArray(
            row.identity_embedding_json,
          );
          const contentEmbedding = this.safeJsonArray(
            row.content_embedding_json,
          );
          return {
            faqId: row.faq_id,
            textHash: row.text_hash,
            identityHash: row.identity_hash,
            contentHash: row.content_hash,
            category: row.category || "",
            intentId: row.intent_id || undefined,
            title: row.title || row.faq_id,
            identityTextPreview: row.identity_preview || undefined,
            contentTextPreview: row.content_preview || undefined,
            identityEmbedding,
            contentEmbedding,
            embedding: identityEmbedding,
            dimension: Number(row.dimension || identityEmbedding.length || 0),
            updatedAt: row.updated_at || undefined,
          };
        })
        .filter(
          (item) =>
            item.identityEmbedding.length && item.contentEmbedding.length,
        );
      if (!items.length) return null;
      return {
        version: TRANSFORMER_SEMANTIC_INDEX_VERSION,
        engine: TRANSFORMER_SEMANTIC_ENGINE,
        model,
        dimension: Number(meta.get("dimension") || items[0]?.dimension || 0),
        generatedAt: meta.get("generatedAt") || new Date().toISOString(),
        indexedCount: items.length,
        available: meta.get("available") !== "false",
        strategy: "identity-content-dual-embedding",
        fusion:
          "transformer-identity+sqlite-fts5-ngram+metadata-guard+eval-queue",
        error: meta.get("error") || undefined,
        items,
      } as TransformerSemanticIndex;
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  private async writeSmartAssistSemanticIndexToLocalCache(
    index: TransformerSemanticIndex,
    records: SmartFaqSearchRecord[],
  ): Promise<void> {
    const dbPath = await this.smartAssistSemanticCacheDbPath();
    if (!dbPath) return;
    await fs.ensureDir(path.dirname(dbPath));
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      const activeIds = new Set(
        index.items.map((item: any) => String(item.faqId)),
      );
      const tx = db.transaction(() => {
        const meta = db.prepare(
          "INSERT OR REPLACE INTO semantic_meta (key, value) VALUES (?, ?)",
        );
        meta.run("version", String(TRANSFORMER_SEMANTIC_INDEX_VERSION));
        meta.run("engine", TRANSFORMER_SEMANTIC_ENGINE);
        meta.run(
          "model",
          index.model || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
        );
        meta.run("dimension", String(index.dimension || 0));
        meta.run("generatedAt", index.generatedAt || new Date().toISOString());
        meta.run(
          "indexedCount",
          String(index.indexedCount || index.items.length),
        );
        meta.run("available", String(Boolean(index.available)));
        meta.run("error", index.error || "");
        meta.run("faqIndexHash", this.smartAssistFaqIndexHash(records));
        meta.run("sharedRoot", this.sharedRoot);
        const upsert = db.prepare(`
          INSERT OR REPLACE INTO semantic_items (
            faq_id, model, text_hash, identity_hash, content_hash, category, intent_id, title,
            identity_preview, content_preview, identity_embedding_json, content_embedding_json, dimension, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of index.items as any[]) {
          upsert.run(
            item.faqId,
            index.model || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
            item.textHash || "",
            item.identityHash || "",
            item.contentHash || "",
            item.category || "",
            item.intentId || "",
            item.title || item.faqId,
            item.identityTextPreview || "",
            item.contentTextPreview || "",
            JSON.stringify(item.identityEmbedding || item.embedding || []),
            JSON.stringify(item.contentEmbedding || item.embedding || []),
            Number(item.dimension || index.dimension || 0),
            item.updatedAt || "",
          );
        }
        const existing = db
          .prepare("SELECT faq_id FROM semantic_items WHERE model = ?")
          .all(
            index.model || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
          ) as Array<{ faq_id: string }>;
        const remove = db.prepare(
          "DELETE FROM semantic_items WHERE faq_id = ? AND model = ?",
        );
        for (const row of existing) {
          if (!activeIds.has(String(row.faq_id)))
            remove.run(
              row.faq_id,
              index.model || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
            );
        }
        db.prepare("DELETE FROM query_cache WHERE index_hash <> ?").run(
          this.smartAssistFaqIndexHash(records),
        );
      });
      tx();
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  private smartAssistFaqIndexHash(records: SmartFaqSearchRecord[]): string {
    const searchable = records
      .filter((record) => record.status !== "hidden")
      .map((record) => ({
        id: String(record.id || ""),
        question: record.question || "",
        answer: record.answer || "",
        category: record.category || "",
        tags: Array.isArray(record.tags) ? record.tags : [],
        likelyQuestions: Array.isArray((record as any).likelyQuestions)
          ? (record as any).likelyQuestions
          : [],
        paraphrases: Array.isArray((record as any).paraphrases)
          ? (record as any).paraphrases
          : [],
        negativeTerms: Array.isArray((record as any).negativeTerms)
          ? (record as any).negativeTerms
          : [],
        suggestedActions: Array.isArray((record as any).suggestedActions)
          ? (record as any).suggestedActions
          : [],
        intentId: (record as any).intentId || "",
        updatedAt: record.updatedAt || "",
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return createHash("sha256")
      .update(JSON.stringify(searchable))
      .digest("hex");
  }

  private async readSmartAssistQueryCache(
    query: string,
    records: SmartFaqSearchRecord[],
  ): Promise<any | null> {
    const dbPath = await this.smartAssistSemanticCacheDbPath();
    if (!dbPath || !(await fs.pathExists(dbPath))) return null;
    const normalized = this.normalizeSmartAssistQueryV217(query);
    if (!normalized) return null;
    const indexHash = this.smartAssistFaqIndexHash(records);
    const queryHash = createHash("sha256")
      .update(
        `${indexHash}
${normalized}`,
      )
      .digest("hex");
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      const row = db
        .prepare(
          "SELECT response_json FROM query_cache WHERE query_hash = ? AND index_hash = ?",
        )
        .get(queryHash, indexHash) as any;
      if (!row?.response_json) return null;
      const parsed = JSON.parse(row.response_json);
      return {
        ...parsed,
        cacheHit: true,
        cacheMode: "local-sqlite-query-cache-v319",
      };
    } catch {
      return null;
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  private async writeSmartAssistQueryCache(
    query: string,
    records: SmartFaqSearchRecord[],
    response: any,
  ): Promise<void> {
    if (!response || response.cacheHit) return;
    const confidence = Number(response?.confidence || 0);
    if (
      (response?.uxLevel === "low" ||
        response?.confidenceLabel === "低" ||
        confidence < 70) &&
      !response?.sources?.length
    )
      return;
    const dbPath = await this.smartAssistSemanticCacheDbPath();
    if (!dbPath) return;
    const normalized = this.normalizeSmartAssistQueryV217(query);
    if (!normalized) return;
    const indexHash = this.smartAssistFaqIndexHash(records);
    const queryHash = createHash("sha256")
      .update(
        `${indexHash}
${normalized}`,
      )
      .digest("hex");
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      db.prepare(
        "INSERT OR REPLACE INTO query_cache (query_hash, normalized_query, index_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        queryHash,
        normalized,
        indexHash,
        JSON.stringify(response),
        new Date().toISOString(),
      );
    } catch {
      // Cache write failure must never break chat.
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  private async writeSmartAssistSearchIndex(
    records: SmartFaqSearchRecord[],
  ): Promise<LightweightSearchIndex> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    const index = await buildLightweightSearchIndex(records);
    await this.atomicWriteJson(this.smartAssistSearchIndexPath(), index);
    return index;
  }

  private async writeSmartAssistSemanticIndex(
    records: SmartFaqSearchRecord[],
  ): Promise<TransformerSemanticIndex> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    const previous = await this.readSmartAssistSemanticIndex();
    const index = await buildTransformerSemanticIndex(records, previous);
    await this.atomicWriteJson(this.smartAssistSemanticIndexPath(), index);
    await this.writeSmartAssistSemanticIndexToLocalCache(index, records).catch(
      () => undefined,
    );
    return index;
  }

  private async ensureSmartAssistIndexes(
    records: SmartFaqSearchRecord[],
  ): Promise<{
    searchIndex: LightweightSearchIndex;
    semanticIndex: TransformerSemanticIndex | null;
  }> {
    const searchIndex = await this.writeSmartAssistSearchIndex(records);
    let semanticIndex: TransformerSemanticIndex | null = null;
    try {
      semanticIndex = await this.writeSmartAssistSemanticIndex(records);
    } catch {
      semanticIndex = await this.readSmartAssistSemanticIndex();
    }
    return { searchIndex, semanticIndex };
  }

  private ensureSmartFaqSqliteTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS smart_faq_index (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        source_type TEXT NOT NULL DEFAULT '',
        source_title TEXT NOT NULL DEFAULT '',
        source_pdf_name TEXT NOT NULL DEFAULT '',
        source_page TEXT NOT NULL DEFAULT '',
        search_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS smart_faq_fts USING fts5(
        id UNINDEXED,
        question,
        answer,
        category,
        tags_text,
        source_text
      );
      CREATE INDEX IF NOT EXISTS idx_smart_faq_status ON smart_faq_index(status);
      CREATE INDEX IF NOT EXISTS idx_smart_faq_category ON smart_faq_index(category);
      CREATE INDEX IF NOT EXISTS idx_smart_faq_pdf ON smart_faq_index(source_pdf_name);
      CREATE INDEX IF NOT EXISTS idx_smart_faq_updated ON smart_faq_index(updated_at);
    `);
  }

  private rebuildSmartFaqIndexSync(records: SmartFaqSearchRecord[]): void {
    this.ensureSmartFaqSqliteTables();
    const now = new Date().toISOString();
    const tx = this.db.transaction((items: SmartFaqSearchRecord[]) => {
      this.db.prepare("DELETE FROM smart_faq_index").run();
      this.db.prepare("DELETE FROM smart_faq_fts").run();
      const insertIndex = this.db.prepare(`
        INSERT OR REPLACE INTO smart_faq_index (
          id, question, answer, category, tags_text, status, source_type, source_title,
          source_pdf_name, source_page, search_text, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO smart_faq_fts (id, question, answer, category, tags_text, source_text)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        const tagsText = Array.isArray(item.tags) ? item.tags.join(" ") : "";
        const sourceTitle = Array.isArray(item.sourceTitles)
          ? item.sourceTitles.join(" / ")
          : String(item.sourceTitle || "");
        const sourcePage =
          item.sourcePage === undefined || item.sourcePage === null
            ? ""
            : String(item.sourcePage);
        const searchText = this.smartFaqSearchText(item);
        insertIndex.run(
          item.id,
          item.question || "",
          item.answer || "",
          item.category || "",
          tagsText,
          item.status || "draft",
          item.sourceType || "",
          sourceTitle,
          item.sourcePdfName || "",
          sourcePage,
          searchText,
          item.updatedAt || now,
        );
        insertFts.run(
          item.id,
          item.question || "",
          item.answer || "",
          item.category || "",
          tagsText,
          [sourceTitle, item.sourcePdfName || "", item.sourceText || ""].join(
            " ",
          ),
        );
      }
    });
    tx(records);
  }

  async rebuildSmartFaqIndex(): Promise<{
    ok: true;
    indexedCount: number;
    updatedAt: string;
  }> {
    const records = await this.listSmartFaqRecords();
    this.rebuildSmartFaqIndexSync(records);
    const updatedAt = new Date().toISOString();
    await this.atomicWriteJson(
      path.join(
        vaultPaths(this.sharedRoot).smartAssist,
        "faq-search-index.json",
      ),
      {
        version: 206,
        indexedCount: records.length,
        updatedAt,
        engine: TRANSFORMER_SEMANTIC_ENGINE,
      },
    );
    await this.ensureSmartAssistIndexes(records);
    return {
      ok: true,
      indexedCount: records.length,
      updatedAt,
      engine: TRANSFORMER_SEMANTIC_ENGINE,
      semanticIndex: "smart-assist/semantic-index.json",
    } as any;
  }

  async getSmartAssistSearchIndexInfo(): Promise<any> {
    const records = await this.listSmartFaqRecords();
    let index = await this.readSmartAssistSearchIndex();
    if (
      !index ||
      index.indexedCount !==
        records.filter((item: SmartFaqSearchRecord) => item.status !== "hidden")
          .length
    ) {
      index = await this.writeSmartAssistSearchIndex(records);
    }
    return {
      ok: true,
      engine: index.engine,
      version: index.version,
      indexedCount: index.indexedCount,
      generatedAt: index.generatedAt,
      topTerms: Object.entries(index.documentFrequency)
        .slice(0, 30)
        .map(([term, count]) => ({ term, count })),
      path: "smart-assist/search-index.json",
      semanticPath: "smart-assist/semantic-index.json",
      semantic: await this.getSmartAssistSemanticIndexInfo(),
      mode: "transformer-first-fts5-eval-v217",
    };
  }

  async getSmartAssistSemanticIndexInfo(): Promise<any> {
    const records = await this.listSmartFaqRecords();
    let index = await this.readSmartAssistSemanticIndex();
    const expectedCount = records.filter(
      (item: SmartFaqSearchRecord) => item.status !== "hidden",
    ).length;
    if (!index || index.indexedCount !== expectedCount) {
      try {
        index = await this.writeSmartAssistSemanticIndex(records);
      } catch {
        index = await this.readSmartAssistSemanticIndex();
      }
    }
    const cache = await this.getSmartAssistSemanticCacheInfo(records).catch(
      (error: any) => ({ ok: false, error: String(error?.message || error) }),
    );
    return {
      ok: Boolean(index),
      engine: index?.engine || TRANSFORMER_SEMANTIC_ENGINE,
      version: index?.version || TRANSFORMER_SEMANTIC_INDEX_VERSION,
      model: index?.model || "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
      dimension: index?.dimension || 0,
      indexedCount: index?.indexedCount || 0,
      generatedAt: index?.generatedAt,
      available: Boolean(index?.available),
      error: index?.error,
      path: "smart-assist/semantic-index.json",
      localCache: cache,
    };
  }

  async getSmartAssistSemanticCacheInfo(
    recordsInput?: SmartFaqSearchRecord[],
  ): Promise<any> {
    const records = recordsInput || (await this.listSmartFaqRecords());
    const settings = await this.getSmartAssistTransformerSettings().catch(
      () => null as any,
    );
    const cacheDir = String(settings?.localCacheDir || "").trim();
    const dbPath = await this.smartAssistSemanticCacheDbPath().catch(
      () => null,
    );
    const expectedCount = records.filter(
      (item) => item.status !== "hidden",
    ).length;
    if (!cacheDir || !dbPath) {
      return {
        ok: false,
        enabled: false,
        message:
          "ローカルキャッシュ保存先が未設定です。検索AI設定でローカルフォルダを指定してください。",
        expectedCount,
      };
    }
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      const semanticCount = Number(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM semantic_items WHERE model = ?",
            )
            .get(
              settings?.modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
            ) as any
        )?.count || 0,
      );
      const queryCount = Number(
        (db.prepare("SELECT COUNT(*) AS count FROM query_cache").get() as any)
          ?.count || 0,
      );
      const metaRows = db
        .prepare("SELECT key, value FROM semantic_meta")
        .all() as Array<{ key: string; value: string }>;
      const meta = Object.fromEntries(
        metaRows.map((row) => [row.key, row.value]),
      );
      const currentHash = this.smartAssistFaqIndexHash(records);
      return {
        ok: true,
        enabled: true,
        cacheDir,
        dbPath,
        model: settings?.modelId || DEFAULT_SMART_ASSIST_TRANSFORMER_MODEL_ID,
        expectedCount,
        semanticCount,
        queryCount,
        generatedAt: meta.generatedAt,
        faqIndexHash: meta.faqIndexHash || "",
        currentFaqIndexHash: currentHash,
        needsUpdate:
          semanticCount !== expectedCount || meta.faqIndexHash !== currentHash,
        mode: "local-sqlite-semantic-cache-v319",
      };
    } catch (error: any) {
      return {
        ok: false,
        enabled: true,
        cacheDir,
        dbPath,
        expectedCount,
        error: String(error?.message || error),
      };
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  async clearSmartAssistQueryCache(): Promise<any> {
    const dbPath = await this.smartAssistSemanticCacheDbPath();
    if (!dbPath)
      return { ok: false, message: "ローカルキャッシュ保存先が未設定です。" };
    let db: any;
    try {
      db = this.openSmartAssistSemanticCacheDb(dbPath);
      const before = Number(
        (db.prepare("SELECT COUNT(*) AS count FROM query_cache").get() as any)
          ?.count || 0,
      );
      db.prepare("DELETE FROM query_cache").run();
      return { ok: true, deletedCount: before, dbPath };
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  private sqliteCountSafe(db: any, table: string, where = ""): number {
    try {
      if (!/^[a-zA-Z0-9_]+$/.test(table)) return 0;
      const row = db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
        .get() as any;
      return Number(row?.count || 0);
    } catch {
      return 0;
    }
  }

  private sqliteTableExistsSafe(db: any, table: string): boolean {
    try {
      const row = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
        )
        .get(table) as any;
      return Boolean(row?.name);
    } catch {
      return false;
    }
  }

  private async fileSizeMbSafe(
    filePath?: string | null,
  ): Promise<number | null> {
    if (!filePath) return null;
    try {
      const stat = await fs.stat(filePath);
      return Math.round((stat.size / 1024 / 1024) * 10) / 10;
    } catch {
      return null;
    }
  }

  async getWorkspaceCacheTopology(): Promise<any> {
    const paths = vaultPaths(this.sharedRoot);
    const pages = await this.listPages().catch(() => [] as PageWithLock[]);
    const databases = await this.listDatabases().catch(
      () => [] as WorkspaceDatabase[],
    );
    const journalSummaries = await this.listJournals().catch(
      () => [] as JournalSummary[],
    );
    const journals = await this.listJournals().catch(
      () => [] as JournalSummary[],
    );
    const faqRecords = await this.listSmartFaqRecords().catch(
      () => [] as SmartFaqSearchRecord[],
    );
    const semanticCache = await this.getSmartAssistSemanticCacheInfo(
      faqRecords,
    ).catch((error: any) => ({
      ok: false,
      error: String(error?.message || error),
    }));

    let localSqlite: any = {
      ok: false,
      role: "アプリ表示・検索用の既存ローカルSQLiteです。ページFTS、DB行Index、FAQ FTSなどを持ちます。",
      tables: [],
    };
    try {
      const pageCount = this.sqliteCountSafe(
        this.db,
        "pages",
        "WHERE trashed = 0",
      );
      const pageFtsCount = this.sqliteTableExistsSafe(this.db, "page_fts")
        ? this.sqliteCountSafe(this.db, "page_fts")
        : 0;
      const dbRowCount = this.sqliteTableExistsSafe(
        this.db,
        "database_row_index",
      )
        ? this.sqliteCountSafe(this.db, "database_row_index")
        : 0;
      const dbRowFtsCount = this.sqliteTableExistsSafe(
        this.db,
        "database_row_fts",
      )
        ? this.sqliteCountSafe(this.db, "database_row_fts")
        : 0;
      const smartFaqCount = this.sqliteTableExistsSafe(
        this.db,
        "smart_faq_index",
      )
        ? this.sqliteCountSafe(this.db, "smart_faq_index")
        : 0;
      const smartFaqFtsCount = this.sqliteTableExistsSafe(
        this.db,
        "smart_faq_fts",
      )
        ? this.sqliteCountSafe(this.db, "smart_faq_fts")
        : 0;
      localSqlite = {
        ok: true,
        role: "既存のSQLです。主に共有フォルダ正本から読み込んだ表示・FTS検索用キャッシュ/インデックスです。",
        tables: [
          {
            name: "pages",
            label: "ページ表示キャッシュ",
            count: pageCount,
            expected: pages.length,
            status: pageCount === pages.length ? "ok" : "needs-sync",
          },
          {
            name: "page_fts",
            label: "ページ全文検索FTS",
            count: pageFtsCount,
            expected: pageCount,
            status: pageFtsCount === pageCount ? "ok" : "needs-rebuild",
          },
          {
            name: "database_row_index",
            label: "DB行表示/検索Index",
            count: dbRowCount,
            expected: null,
            status: dbRowCount > 0 ? "ok" : "unknown",
          },
          {
            name: "database_row_fts",
            label: "DB行全文検索FTS",
            count: dbRowFtsCount,
            expected: null,
            status: dbRowFtsCount > 0 ? "ok" : "unknown",
          },
          {
            name: "smart_faq_index",
            label: "FAQ語彙検索Index",
            count: smartFaqCount,
            expected: faqRecords.length,
            status:
              smartFaqCount === faqRecords.length ? "ok" : "needs-rebuild",
          },
          {
            name: "smart_faq_fts",
            label: "FAQ FTS",
            count: smartFaqFtsCount,
            expected: smartFaqCount,
            status: smartFaqFtsCount === smartFaqCount ? "ok" : "needs-rebuild",
          },
        ],
      };
    } catch (error: any) {
      localSqlite = { ...localSqlite, error: String(error?.message || error) };
    }

    const semanticDbPath =
      semanticCache?.dbPath ||
      (await this.smartAssistSemanticCacheDbPath().catch(() => null));
    const semanticDbSizeMb = await this.fileSizeMbSafe(semanticDbPath);

    return {
      ok: true,
      version: 320,
      generatedAt: new Date().toISOString(),
      sharedRoot: this.sharedRoot,
      explanation: {
        existingSql:
          "現在もSQLは使っています。これはアプリの既存ローカルDBで、ページ、DB行、FAQ FTSなどの表示・検索用インデックスを保持します。",
        semanticCache:
          "v319で追加したSQLiteは別系統です。Ruri-v3のembedding、Semantic Index、同一質問の検索結果をユーザー指定ローカルフォルダに保存します。",
        sourceOfTruth:
          "正本は共有フォルダ内のJSON/ページ/DBデータです。SQLiteは壊れても再構築できる高速化用です。",
      },
      sharedSource: {
        role: "正本データ",
        paths: {
          pages: paths.pages,
          databases: paths.databases,
          journals: paths.journals,
          smartAssist: paths.smartAssist,
        },
        counts: {
          pages: pages.length,
          databases: databases.length,
          journals: journals.length,
          faqRecords: faqRecords.length,
        },
      },
      existingLocalSqlite: localSqlite,
      aiSemanticSqlite: {
        role: "Ruri-v3 / Semantic Index / Query Cache 専用のユーザー指定ローカルSQLiteです。",
        ...semanticCache,
        dbSizeMb: semanticDbSizeMb,
      },
      nextCacheTargets: [
        {
          target: "pages_cache_v2",
          label: "ページ一覧/リンク候補高速化",
          current: "既存pages/page_ftsあり",
          recommendation: "次段階でcontent_hash差分同期を追加",
        },
        {
          target: "journal_cache",
          label: "ジャーナル一覧/タグ検索高速化",
          current: "専用SQLiteキャッシュ未整備",
          recommendation: "日付・タグ・summaryをローカルSQLite化",
        },
        {
          target: "database_catalog_cache",
          label: "DB一覧/Relation候補高速化",
          current: "一部DB行Indexあり",
          recommendation: "DB定義とschema_hashをキャッシュ",
        },
        {
          target: "database_rows_cache_v2",
          label: "DB行フィルタ/ソート高速化",
          current: "database_row_indexあり",
          recommendation: "差分更新・row_hash・Relation候補Indexを追加",
        },
      ],
      recommendedPlan: [
        "v320では現在のSQL/キャッシュ構造を可視化します。",
        "v321でページ・ジャーナル・DB一覧の差分キャッシュを追加します。",
        "v322でDB行・Relation候補・@ページリンク候補の高速化に進むのが安全です。",
      ],
    };
  }

  async getSmartFaqSearchStats(): Promise<any> {
    const records = await this.listSmartFaqRecords();
    let indexedCount = 0;
    try {
      this.ensureSmartFaqSqliteTables();
      indexedCount = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) as count FROM smart_faq_index")
            .get() as any
        )?.count || 0,
      );
    } catch {
      indexedCount = 0;
    }
    if (records.length && indexedCount !== records.length) {
      try {
        this.rebuildSmartFaqIndexSync(records);
        indexedCount = records.length;
      } catch {
        indexedCount = 0;
      }
    }
    return {
      mode: "transformer-first-fts5-eval-v217",
      faqCount: records.length,
      indexedCount,
      approvedCount: records.filter((item) => item.status === "approved")
        .length,
      reviewedCount: records.filter((item) => item.status === "reviewed")
        .length,
      needsReindex: records.length !== indexedCount,
      recommended: "transformer-first-fts5-hybrid-v216",
      features: [
        "transformers-js-embedding",
        "identity-content-dual-embedding",
        "semantic-index-json",
        "sqlite-fts5-trigram-backup",
        "metadata-guard",
        "negative-terms-penalty",
        "exact-test-question-boost",
        "score-breakdown-debug",
        "conversational-suggestions",
        "next-question-chips",
        "suggested-actions",
      ],
    };
  }

  // v216: Transformer-first simplified retrieval.
  // Runtime path intentionally does not use legacy morphological/NLP/fuzzy libraries.
  // It uses: Transformers.js identity embedding + SQLite FTS5 trigram backup + metadata guard.
  private normalizeV216Text(input: unknown): string {
    return String(input ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[ぁ-ん]/g, (char) =>
        String.fromCharCode(char.charCodeAt(0) + 0x60),
      )
      .replace(/[\u3000\t\r\n]+/g, " ")
      .replace(
        /[。、，,.・:：;；!！?？「」『』【】\[\]()（）{}<>＜＞/\\|＿_~〜ー－―]+/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  private compactV216Text(input: unknown): string {
    return this.normalizeV216Text(input).replace(/\s+/g, "");
  }

  private smartFaqFtsV216Ready = false;

  private ensureSmartFaqFtsV216(records: SmartFaqSearchRecord[]): boolean {
    try {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS smart_faq_fts_v216 USING fts5(id UNINDEXED, identity, tokenize='trigram')`,
      );
      const count = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) AS count FROM smart_faq_fts_v216")
            .get() as any
        )?.count || 0,
      );
      if (count !== records.length || !this.smartFaqFtsV216Ready) {
        const insert = this.db.prepare(
          "INSERT INTO smart_faq_fts_v216 (id, identity) VALUES (?, ?)",
        );
        this.db.exec("DELETE FROM smart_faq_fts_v216");
        const tx = this.db.transaction((items: SmartFaqSearchRecord[]) => {
          for (const record of items)
            insert.run(String(record.id), buildSemanticIdentityText(record));
        });
        tx(records);
      }
      this.smartFaqFtsV216Ready = true;
      return true;
    } catch {
      this.smartFaqFtsV216Ready = false;
      return false;
    }
  }

  private searchSmartFaqFtsV216(
    message: string,
    records: SmartFaqSearchRecord[],
    limit = 20,
  ): Array<{ id: string; score: number; reasons: string[] }> {
    const normalized = this.normalizeV216Text(message);
    if (!normalized) return [];
    const recordById = new Map(
      records.map((record) => [String(record.id), record]),
    );
    if (this.ensureSmartFaqFtsV216(records)) {
      try {
        const rows = this.db
          .prepare(
            `
          SELECT id, bm25(smart_faq_fts_v216) AS rank
          FROM smart_faq_fts_v216
          WHERE identity MATCH ?
          ORDER BY rank
          LIMIT ?
        `,
          )
          .all(normalized, Math.max(1, Math.min(50, limit))) as any[];
        if (rows.length) {
          const best = Math.abs(Number(rows[0]?.rank ?? 0)) || 1;
          return rows
            .filter((row) => recordById.has(String(row.id)))
            .map((row, index) => {
              const raw = Math.abs(Number(row.rank ?? 0));
              const score = Math.max(
                1,
                Math.min(
                  100,
                  Math.round(
                    (best / Math.max(best, raw || best)) * 96 - index * 2,
                  ),
                ),
              );
              return {
                id: String(row.id),
                score,
                reasons: ["SQLite FTS5 trigram一致"],
              };
            });
        }
      } catch {
        // fall through to deterministic fallback
      }
    }

    const q = this.compactV216Text(message);
    const grams = new Set<string>();
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i <= q.length - n; i += 1) grams.add(q.slice(i, i + n));
    }
    return records
      .map((record) => {
        const identity = this.compactV216Text(
          buildSemanticIdentityText(record),
        );
        let hits = 0;
        for (const gram of grams) if (identity.includes(gram)) hits += 1;
        const score = grams.size
          ? Math.round(Math.min(86, (hits / grams.size) * 100))
          : 0;
        return {
          id: String(record.id),
          score,
          reasons: hits ? ["N-gram fallback一致"] : [],
        };
      })
      .filter((item) => item.score >= 18)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private exactMetadataScoreV216(
    message: string,
    record: SmartFaqSearchRecord,
  ): { score: number; hits: string[] } {
    const q = this.compactV216Text(message);
    const fields = [
      record.question,
      (record as any).title,
      record.intentId,
      record.intentLabel,
      record.category,
      ...(Array.isArray(record.tags) ? record.tags : []),
      ...(Array.isArray((record as any).keywords)
        ? (record as any).keywords
        : []),
      ...(Array.isArray((record as any).examples)
        ? (record as any).examples
        : []),
      ...(Array.isArray((record as any).testQuestions)
        ? (record as any).testQuestions
        : []),
      ...(Array.isArray((record as any).likelyQuestions)
        ? (record as any).likelyQuestions
        : []),
      ...(Array.isArray((record as any).paraphrases)
        ? (record as any).paraphrases
        : []),
    ]
      .filter(Boolean)
      .map((value) => this.compactV216Text(value));

    const hits: string[] = [];
    let score = 0;
    for (const field of fields) {
      if (!field || field.length < 2) continue;
      if (field === q) {
        score = Math.max(score, 100);
        hits.push(field);
        continue;
      }
      if (field.includes(q) && q.length >= 4) {
        score = Math.max(score, 92);
        hits.push(field);
        continue;
      }
      if (q.includes(field) && field.length >= 3) {
        score = Math.max(score, 86);
        hits.push(field);
        continue;
      }
    }

    // token-level overlap for short natural questions
    const terms = fields
      .flatMap((field) => field.split(/\s+/))
      .filter((term) => term.length >= 2);
    const uniqueTerms = Array.from(new Set(terms)).slice(0, 200);
    const termHits = uniqueTerms
      .filter((term) => q.includes(term) || term.includes(q))
      .slice(0, 12);
    if (termHits.length) {
      score = Math.max(score, Math.min(88, 30 + termHits.length * 9));
      hits.push(...termHits);
    }
    return {
      score: Math.max(0, Math.min(100, score)),
      hits: uniqueSmartAssistStrings(hits, 12),
    };
  }

  private negativePenaltyV216(
    message: string,
    record: SmartFaqSearchRecord,
  ): { penalty: number; hits: string[] } {
    const q = this.compactV216Text(message);
    const negativeTerms = Array.isArray((record as any).negativeTerms)
      ? (record as any).negativeTerms.map(String)
      : [];
    const hits = negativeTerms.filter((term: string) => {
      const key = this.compactV216Text(term);
      return key.length >= 2 && q.includes(key);
    });
    return {
      penalty: hits.length ? 80 : 0,
      hits: uniqueSmartAssistStrings(hits, 8),
    };
  }

  private async normalizeSmartAssistQueryV217(
    message: string,
  ): Promise<{ original: string; normalized: string; replacements: string[] }> {
    const original = String(message || "").trim();
    let normalized = original.normalize("NFKC");
    const defaults: Array<{ from: string; to: string }> = [
      { from: "ロゴフォーム", to: "LoGoフォーム" },
      { from: "logoフォーム", to: "LoGoフォーム" },
      { from: "ＬｏＧｏフォーム", to: "LoGoフォーム" },
      { from: "学童保育", to: "放課後児童クラブ" },
      { from: "学童クラブ", to: "放課後児童クラブ" },
      { from: "学童", to: "放課後児童クラブ" },
      { from: "有休", to: "有給休暇" },
      { from: "年休", to: "年次有給休暇" },
      { from: "利用料金", to: "利用料" },
      { from: "利用費", to: "利用料" },
      { from: "料金", to: "費用" },
      { from: "キャンセル", to: "取消" },
      { from: "取り消し", to: "取消" },
      { from: "取下げ", to: "取消" },
    ];

    const customRaw = await this.smartAssistStore()
      .listQueryNormalizationRules()
      .catch(() => []);
    // v218: array / {items:[]} / {rules:[]} のどれでも読めるようにする。
    const customItems = Array.isArray(customRaw)
      ? customRaw
      : Array.isArray(customRaw?.rules)
        ? customRaw.rules
        : Array.isArray(customRaw?.items)
          ? customRaw.items
          : [];
    const custom = customItems.map((item: any) => ({
      from: String(item?.from || item?.base || item?.variant || "")
        .normalize("NFKC")
        .trim(),
      to: String(item?.to || item?.normalized || item?.canonical || "")
        .normalize("NFKC")
        .trim(),
    }));

    const rules = [...defaults, ...custom]
      .filter((item) => item.from && item.to && item.from !== item.to)
      // longer terms first prevents partial replacements from swallowing precise names.
      .sort((a, b) => b.from.length - a.from.length);

    const replacements: string[] = [];
    for (const rule of rules) {
      if (normalized.includes(rule.from)) {
        normalized = normalized.split(rule.from).join(rule.to);
        replacements.push(`${rule.from}→${rule.to}`);
      }
    }
    return {
      original,
      normalized: normalized.trim(),
      replacements: uniqueSmartAssistStrings(replacements, 30),
    };
  }

  async listSmartAssistQueryNormalizationRules(): Promise<any> {
    return this.smartAssistStore().listQueryNormalizationRules();
  }

  async saveSmartAssistQueryNormalizationRules(input: any): Promise<any> {
    return this.smartAssistStore().saveQueryNormalizationRules(input);
  }

  async listSmartAssistFallbackContacts(): Promise<any> {
    return this.smartAssistStore().listFallbackContacts();
  }

  async saveSmartAssistFallbackContacts(input: any): Promise<any> {
    return this.smartAssistStore().saveFallbackContacts(input);
  }

  private async resolveSmartAssistFallbackContact(
    category?: string,
  ): Promise<any> {
    const config = await this.listSmartAssistFallbackContacts().catch(
      () => null,
    );
    const categories = Array.isArray(config?.categories)
      ? config.categories
      : [];
    const cat = String(category || "").trim();
    const found = categories.find(
      (item: any) =>
        String(item?.category || "").trim() &&
        (cat === String(item.category).trim() ||
          cat.includes(String(item.category).trim()) ||
          String(item.category).trim().includes(cat)),
    );
    return (
      found ||
      config?.defaultContact || {
        label: "担当係",
        department: "担当課",
        extension: "内線未設定",
      }
    );
  }

  private buildNoMatchFallbackAnswerV218(args: {
    message: string;
    candidates: any[];
    contact: any;
    normalizedQuery?: any;
  }): string {
    const candidateLines = (args.candidates || [])
      .slice(0, 3)
      .map((item: any, index: number) => {
        const record = item.record || item;
        const score = Math.round(Number(item.score || item.confidence || 0));
        return `・候補${index + 1}: ${record.question || record.title || record.id || "FAQ候補"}${score ? `（一致度 ${score}%）` : ""}`;
      });
    const contact = args.contact || {};
    const contactLine = `担当: ${contact.label || "担当係"}${contact.department ? `（${contact.department}）` : ""}${contact.extension ? ` / ${contact.extension}` : ""}`;
    return [
      "該当FAQを十分な信頼度で特定できませんでした。誤回答を避けるため、断定回答は行いません。",
      "",
      ...(candidateLines.length ? ["近い候補:", ...candidateLines, ""] : []),
      contactLine,
      contact.note ? `補足: ${contact.note}` : "",
      args.normalizedQuery?.replacements?.length
        ? `表記揺れ補正: ${args.normalizedQuery.replacements.join(" / ")}`
        : "",
      "",
      "次のどれかで再質問すると見つかりやすくなります。",
      "・手続き名を入れる",
      "・制度名を入れる",
      "・対象者や期間を入れる",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async addSmartAssistImprovementQueue(input: any): Promise<any[]> {
    return this.smartAssistStore().addImprovementQueue(input);
  }

  async listSmartAssistImprovementQueue(): Promise<any[]> {
    return this.smartAssistStore().listImprovementQueue();
  }

  async updateSmartAssistImprovementQueue(
    id: string,
    input: any,
  ): Promise<any[]> {
    return this.smartAssistStore().updateImprovementQueue(id, input);
  }

  async deleteSmartAssistImprovementQueue(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    return this.smartAssistStore().deleteImprovementQueue(id, baseUpdatedAt);
  }

  async listSmartAssistEvaluationSet(): Promise<any[]> {
    return this.smartAssistStore().listEvaluationSet();
  }

  async saveSmartAssistEvaluationSet(input: any[]): Promise<any[]> {
    return this.smartAssistStore().saveEvaluationSet(input);
  }

  async upsertSmartAssistEvaluationEntry(input: any): Promise<any[]> {
    return this.smartAssistStore().upsertEvaluationEntry(input);
  }

  async deleteSmartAssistEvaluationEntry(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    return this.smartAssistStore().deleteEvaluationEntry(id, baseUpdatedAt);
  }

  async listSmartAssistEvaluationReports(limit?: number): Promise<any[]> {
    return this.smartAssistStore().listEvaluationReports(limit);
  }

  async runSmartAssistEvaluationSet(): Promise<any> {
    const set = await this.listSmartAssistEvaluationSet();
    const results: any[] = [];
    for (const item of set) {
      const response = await this.askSmartAssist({
        message: item.question,
        debug: true,
      });
      const ok =
        String(response?.matchedFaqId || "") ===
        String(item.expectedFaqId || "");
      if (!ok) {
        await this.addSmartAssistImprovementQueue({
          question: item.question,
          expectedFaqId: item.expectedFaqId,
          matchedFaqId: response?.matchedFaqId,
          confidence: response?.confidence,
          candidates: response?.candidates,
          reason: "evaluation-mismatch",
          response: {
            matchedFaqTitle: response?.matchedFaqTitle,
            confidence: response?.confidence,
          },
        });
      }
      results.push({
        question: item.question,
        expectedFaqId: item.expectedFaqId,
        matchedFaqId: response?.matchedFaqId,
        matchedFaqTitle: response?.matchedFaqTitle,
        confidence: response?.confidence,
        confidenceLabel: response?.confidenceLabel,
        ok,
        mode: response?.mode,
      });
    }
    const passedCount = results.filter((item) => item.ok).length;
    const highWrongCount = results.filter(
      (item) => !item.ok && Number(item.confidence || 0) >= 85,
    ).length;
    const report = {
      testedCount: results.length,
      passedCount,
      failedCount: results.length - passedCount,
      accuracy: results.length
        ? Math.round((passedCount / results.length) * 1000) / 10
        : 0,
      highWrongCount,
      noAnswerCount: results.filter((item) => !item.ok && !item.matchedFaqId)
        .length,
      results,
      mode: "smart-assist-evaluation-v218",
      updatedAt: new Date().toISOString(),
    };
    await this.smartAssistStore()
      .writeEvaluationReport(report)
      .catch(() => undefined);
    return report;
  }

  async askSmartAssist(input: {
    message?: string;
    question?: string;
    debug?: boolean;
  }): Promise<any> {
    const message = String(input?.message || input?.question || "").trim();
    const conversationContext = Array.isArray((input as any)?.context)
      ? (input as any).context
          .slice(-8)
          .map((item: any) => ({
            role: String(item?.role || "").slice(0, 16),
            text: String(item?.text || "").slice(0, 300),
          }))
          .filter((item: any) => item.text)
      : [];
    if (!message) {
      return {
        answer: "質問を入力してください。",
        confidence: 0,
        confidenceLabel: "低",
        uxLevel: "low",
        intent: "None",
        followUpQuestions: [
          "知りたい手続き名や困っている状況を入力してください。",
        ],
        categoryOptions: [],
        sources: [],
        mode: "empty",
      };
    }

    const records = await this.listSmartFaqRecords();
    const searchable = records.filter(
      (item: SmartFaqSearchRecord) => item.status !== "hidden",
    );
    const cachedResponse = await this.readSmartAssistQueryCache(
      message,
      searchable,
    ).catch(() => null);
    if (cachedResponse) {
      await this.addSmartAssistChatLog({
        question: message,
        response: cachedResponse,
      });
      return cachedResponse;
    }

    // v216: The active production path is deliberately simple:
    // Transformers.js semantic identity search + SQLite FTS5 trigram backup + metadata guard.
    // Legacy NLP/fuzzy rankers are bypassed to avoid conflicting rankers.
    const transformerFirstResponse =
      await buildTransformerFirstSmartAssistResponse({
        message,
        records: searchable,
        debug: Boolean(input?.debug),
        deps: {
          normalizeQuery: (value) => this.normalizeSmartAssistQueryV217(value),
          readSemanticIndex: () => this.readSmartAssistSemanticIndex(),
          writeSemanticIndex: (recordsForIndex) =>
            this.writeSmartAssistSemanticIndex(recordsForIndex),
          searchFts: (query, recordsForSearch, limit) =>
            this.searchSmartFaqFtsV216(query, recordsForSearch, limit),
          exactMetadataScore: (query, record) =>
            this.exactMetadataScoreV216(query, record),
          negativePenalty: (query, record) =>
            this.negativePenaltyV216(query, record),
          resolveFallbackContact: (category) =>
            this.resolveSmartAssistFallbackContact(category),
          buildNoMatchFallbackAnswer: (fallbackArgs) =>
            this.buildNoMatchFallbackAnswerV218(fallbackArgs),
          addImprovementQueue: (payload) =>
            this.addSmartAssistImprovementQueue(payload),
        },
      });
    if (transformerFirstResponse) {
      await this.writeSmartAssistQueryCache(
        message,
        searchable,
        transformerFirstResponse,
      ).catch(() => undefined);
      await this.addSmartAssistChatLog({
        question: message,
        response: transformerFirstResponse,
      });
      return transformerFirstResponse;
    }

    // v217: 回答採用経路は Transformers.js + SQLite FTS5 + metadata guard に一本化。
    // ここで旧 NLP/fuzzy 系へフォールバックすると、
    // 以前の誤ランキングが再混入するため、低信頼として改善キューへ送る。
    const lowResponse = {
      answer:
        "該当FAQを十分な信頼度で特定できませんでした。無理に回答せず、近い候補や担当者確認に切り替えてください。",
      confidence: 0,
      confidenceLabel: "低",
      uxLevel: "low",
      intent: "None",
      followUpQuestions: [
        "手続き名を追加してください。",
        "制度名や対象者を追加してください。",
        "この質問をFAQ追加候補にしてください。",
      ],
      categoryOptions: inferSmartAssistCategoryHints(searchable),
      sources: [],
      candidates: [],
      answerPolicy: "no-legacy-fallback-v217",
      mode: "transformer-first-no-match-v217",
    };
    await this.writeSmartAssistQueryCache(
      message,
      searchable,
      lowResponse,
    ).catch(() => undefined);
    await this.addSmartAssistImprovementQueue({
      question: message,
      reason: "no-match",
      response: lowResponse,
    });
    await this.addSmartAssistChatLog({
      question: message,
      response: lowResponse,
    });
    return lowResponse;
  }

  private smartAssistChatLogPath(): string {
    return this.smartAssistStore().chatLogPath();
  }

  private normalizeSmartAssistChatLog(item: any): any | null {
    return this.smartAssistStore().normalizeChatLog(item);
  }

  async listSmartAssistChatLogs(): Promise<any[]> {
    return this.smartAssistStore().listChatLogs();
  }

  async addSmartAssistChatLog(input: any): Promise<any[]> {
    return this.smartAssistStore().addChatLog(input);
  }

  async listLowConfidenceSmartAssistLogs(): Promise<any[]> {
    const [logs, queue, feedback] = await Promise.all([
      this.smartAssistStore()
        .listLowConfidenceChatLogs()
        .catch(() => []),
      this.listSmartAssistImprovementQueue().catch(() => []),
      this.listSmartAssistFeedback().catch(() => []),
    ]);
    const normalizeQuestionKey = (value: any) =>
      String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    const badFeedbackSourceIds = new Set(
      feedback
        .filter((item: any) => item.rating === "bad")
        .map((item: any) => String(item.id || "").trim())
        .filter(Boolean),
    );
    const badFeedback = feedback
      .filter((item: any) => item.rating === "bad")
      .map((item: any) => ({
        id: `feedback:${item.id}`,
        sourceType: "feedback",
        sourceId: item.id,
        question: item.question,
        answerPreview: item.answerPreview,
        matchedFaqId: item.matchedFaqId,
        matchedFaqTitle: item.matchedFaqTitle,
        expectedFaqId: item.expectedFaqId,
        confidence: item.confidence || 0,
        confidenceLabel: item.confidenceLabel || "低",
        uxLevel: "low",
        reason: item.reason || "user-feedback-bad",
        status: item.status || "open",
        candidates: item.candidates || [],
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      }));
    const queueItems = queue
      .filter((item: any) => {
        const feedbackId = String(item?.response?.feedbackId || "").trim();
        return !feedbackId || !badFeedbackSourceIds.has(feedbackId);
      })
      .map((item: any) => ({
        id: `queue:${item.id}`,
        sourceType: "queue",
        sourceId: item.id,
        question: item.question,
        answerPreview:
          item.response?.answerPreview || item.response?.answer || "",
        matchedFaqId: item.matchedFaqId,
        expectedFaqId: item.expectedFaqId,
        confidence: item.confidence || 0,
        confidenceLabel: Number(item.confidence || 0) >= 60 ? "中" : "低",
        uxLevel: "low",
        reason: item.reason || "improvement-queue",
        status: item.status || "open",
        candidates: item.candidates || [],
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      }));
    const merged = [...badFeedback, ...queueItems, ...logs]
      .filter((item: any) => Boolean(normalizeQuestionKey(item.question)))
      .sort((a: any, b: any) => {
        const priority = (item: any) =>
          item.sourceType === "feedback"
            ? 3
            : item.sourceType === "queue"
              ? 2
              : 1;
        const byTime = String(b.createdAt || "").localeCompare(
          String(a.createdAt || ""),
        );
        if (byTime) return byTime;
        return priority(b) - priority(a);
      });
    const seen = new Map<string, any>();
    for (const item of merged) {
      const key = [
        normalizeQuestionKey(item.question),
        String(item.expectedFaqId || ""),
        String(item.matchedFaqId || ""),
      ].join("::");
      const current = seen.get(key);
      if (!current) {
        seen.set(key, item);
        continue;
      }
      // v318: 同一質問が「違うフィードバック」と「改善キュー」の両方に入るため、表示は1件に集約する。
      const currentPriority =
        current.sourceType === "feedback"
          ? 3
          : current.sourceType === "queue"
            ? 2
            : 1;
      const nextPriority =
        item.sourceType === "feedback"
          ? 3
          : item.sourceType === "queue"
            ? 2
            : 1;
      if (nextPriority > currentPriority)
        seen.set(key, { ...current, ...item, id: current.id || item.id });
    }
    return Array.from(seen.values())
      .sort((a: any, b: any) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      )
      .slice(0, 300);
  }

  async clearSmartAssistChatLogs(): Promise<{
    ok: true;
    deleted: number;
    updatedAt: string;
    path: string;
  }> {
    return this.smartAssistStore().clearChatLogs();
  }

  async retrainSmartAssistNlp(): Promise<any> {
    const records = await this.listSmartFaqRecords();
    const searchable = records.filter(
      (item: SmartFaqSearchRecord) => item.status !== "hidden",
    );
    const semanticIndex = await this.writeSmartAssistSemanticIndex(
      searchable,
    ).catch((error: any) => null);
    const summary = {
      ok: Boolean(semanticIndex),
      available: Boolean(semanticIndex),
      faqCount: searchable.length,
      indexedCount: semanticIndex?.indexedCount || 0,
      updatedAt: new Date().toISOString(),
      mode: "transformer-semantic-reindex-v217",
      shared: true,
      sharedFiles: [
        "smart-assist/faq-items.json",
        "smart-assist/semantic-index.json",
      ],
      note: "Transformers.jsの意味ベクトルを再生成します。旧NLP分類器は使用しません。",
    };
    await this.atomicWriteJson(
      path.join(
        vaultPaths(this.sharedRoot).smartAssist,
        "semantic-training-summary.json",
      ),
      summary,
    ).catch(() => undefined);
    return summary;
  }

  async testSmartFaqRecord(input: {
    faqId?: string;
    questions?: string[];
  }): Promise<any> {
    const faqId = String(input?.faqId || "").trim();
    const questions = Array.isArray(input?.questions)
      ? input.questions
          .map(String)
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, 50)
      : [];
    const records = await this.listSmartFaqRecords();
    const target =
      records.find((item: SmartFaqSearchRecord) => item.id === faqId) || null;
    const testQuestions = uniqueSmartAssistStrings(
      [
        ...questions,
        ...(target
          ? [
              target.question,
              ...(Array.isArray((target as any).testQuestions)
                ? (target as any).testQuestions
                : []),
            ]
          : []),
      ],
      50,
    );
    const results: any[] = [];
    for (const question of testQuestions) {
      const response = await this.askSmartAssist({
        message: question,
        debug: false,
      });
      results.push({
        question,
        expectedFaqId: target?.id || undefined,
        matchedFaqId: response.matchedFaqId,
        matchedFaqTitle: response.matchedFaqTitle,
        confidence: response.confidence,
        confidenceLabel: response.confidenceLabel,
        ok: target
          ? response.matchedFaqId === target.id
          : Boolean(response.matchedFaqId),
        answerPolicy: response.answerPolicy,
      });
    }
    return {
      faqId: target?.id || faqId,
      testedCount: results.length,
      passedCount: results.filter((item) => item.ok).length,
      results,
      mode: "smart-faq-test-v193",
    };
  }

  async querySmartFaqRecords(options: {
    q?: string;
    status?: string;
    category?: string;
    pdf?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    const records = await this.listSmartFaqRecords();
    let indexedCount = 0;
    try {
      this.ensureSmartFaqSqliteTables();
      indexedCount = Number(
        (
          this.db
            .prepare("SELECT COUNT(*) as count FROM smart_faq_index")
            .get() as any
        )?.count || 0,
      );
    } catch {
      indexedCount = 0;
    }
    if (records.length && indexedCount !== records.length) {
      try {
        this.rebuildSmartFaqIndexSync(records);
        indexedCount = records.length;
      } catch {}
    }

    const q = String(options.q || "").trim();
    const status = String(options.status || "all");
    const category = String(options.category || "").trim();
    const pdf = String(options.pdf || "").trim();
    const limit = Math.max(1, Math.min(1000, Number(options.limit || 50)));
    const offset = Math.max(0, Number(options.offset || 0));

    const filtered = records.filter((item: SmartFaqSearchRecord) => {
      if (status !== "all" && item.status !== status) return false;
      if (category && item.category !== category) return false;
      if (pdf && item.sourcePdfName !== pdf) return false;
      return true;
    });

    if (!q) {
      const items = filtered.slice(offset, offset + limit);
      return {
        items: items.map((item: SmartFaqSearchRecord, index: number) => ({
          record: item,
          score: Math.max(
            1,
            Math.min(
              100,
              item.status === "approved"
                ? 90 - index
                : item.status === "reviewed"
                  ? 84 - index
                  : 74 - index,
            ),
          ),
          reasons: [
            item.status === "approved"
              ? "承認済みFAQ"
              : item.status === "reviewed"
                ? "確認済みFAQ"
                : "更新順",
            "フィルター一致",
          ],
          matchedTerms: [],
          confidenceLabel:
            item.status === "approved"
              ? "高"
              : item.status === "reviewed"
                ? "中"
                : "低",
        })),
        total: filtered.length,
        limit,
        offset,
        mode: "filtered-updated-order",
        indexedCount,
        faqCount: records.length,
      };
    }

    const ranked = await rankSmartFaqRecords(q, filtered, { limit, offset });
    let items = ranked.results;
    let mode = ranked.mode;

    if (!items.length) {
      const normalizedQ = q.toLowerCase();
      const fallback = filtered
        .filter((item: SmartFaqSearchRecord) =>
          this.smartFaqSearchText(item).toLowerCase().includes(normalizedQ),
        )
        .slice(offset, offset + limit)
        .map((item: SmartFaqSearchRecord, index: number) => ({
          record: item,
          score: Math.max(1, 64 - index * 2),
          reasons: ["LIKE検索フォールバック"],
          matchedTerms: [q].filter(Boolean),
          confidenceLabel: "低" as const,
        }));
      items = fallback;
      mode = "like-fallback";
    }

    return {
      items,
      total: ranked.total || items.length,
      limit,
      offset,
      mode,
      indexedCount,
      faqCount: records.length,
      analysis: {
        engine: ranked.analysis.engine,
        tokens: ranked.analysis.tokens.slice(0, 20),
        expandedTerms: ranked.analysis.expandedTerms.slice(0, 30),
      },
    };
  }

  private async refreshSmartFaqIndexes(
    records: SmartFaqSearchRecord[],
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.atomicWriteJson(
      path.join(vaultPaths(this.sharedRoot).smartAssist, "faq-index.json"),
      {
        version: 2,
        storage: "item-collection",
        count: records.length,
        approvedCount: records.filter((item) => item.status === "approved")
          .length,
        reviewedCount: records.filter((item) => item.status === "reviewed")
          .length,
        updatedAt: now,
        updatedBy: this.userLabel(),
      },
    );
    try {
      this.rebuildSmartFaqIndexSync(records);
    } catch {}
    try {
      await this.ensureSmartAssistIndexes(records);
    } catch {}
  }

  async listSmartFaqRecords(): Promise<SmartFaqSearchRecord[]> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    const hadLegacyFile = await fs.pathExists(this.smartFaqPath());
    const collection = this.smartFaqCollection();
    let records = await collection.list();

    // Seed only a brand-new workspace. An intentionally empty FAQ list must
    // remain empty and must not silently recreate samples after a deletion.
    if (!records.length && !hadLegacyFile) {
      for (const sample of cloneSampleSmartFaqRecords()) {
        await collection.upsert({
          ...sample,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          updatedBy: "default-seed",
        });
      }
      records = await collection.list();
    }
    return records;
  }

  async saveSmartFaqRecords(input: any[]): Promise<SmartFaqSearchRecord[]> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    // Compatibility endpoint for the existing editor. Unlike the old whole-array
    // replacement, omitted records are retained. Deletion must use DELETE /faqs/:id.
    const records = await this.smartFaqCollection().mergeBulk(input);
    await this.refreshSmartFaqIndexes(records);
    return records;
  }

  async upsertSmartFaqRecord(input: any): Promise<SmartFaqSearchRecord[]> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    const normalized = this.normalizeSmartFaqRecord({
      ...input,
      updatedBy: this.userLabel(),
    });
    if (!normalized) return this.listSmartFaqRecords();
    const records = await this.smartFaqCollection().upsert(normalized, {
      baseUpdatedAt: String(input?.baseUpdatedAt || "") || undefined,
    });
    await this.refreshSmartFaqIndexes(records);
    return records;
  }

  async deleteSmartFaqRecord(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<SmartFaqSearchRecord[]> {
    await fs.ensureDir(vaultPaths(this.sharedRoot).smartAssist);
    const existing = (await this.listSmartFaqRecords()).find(
      (item) => item.id === id,
    );
    const records = await this.smartFaqCollection().delete(id, {
      baseUpdatedAt,
    });
    if (existing) {
      await this.withSharedJsonMutation(this.smartFaqTrashPath(), async () => {
        const raw = await fs.readJson(this.smartFaqTrashPath()).catch(() => []);
        const trash = Array.isArray(raw) ? raw : [];
        await this.atomicWriteJson(
          this.smartFaqTrashPath(),
          [
            {
              ...existing,
              deletedAt: new Date().toISOString(),
              deletedBy: this.userLabel(),
            },
            ...trash.filter((item: any) => String(item?.id || "") !== id),
          ].slice(0, 1000),
        );
      });
    }
    await this.refreshSmartFaqIndexes(records);
    return records;
  }

  async listSmartAssistFeedback(): Promise<any[]> {
    return this.smartAssistStore().listFeedback();
  }

  async saveSmartAssistFeedback(input: any[]): Promise<any[]> {
    return this.smartAssistStore().saveFeedback(input);
  }

  async addSmartAssistFeedback(input: any): Promise<any[]> {
    return this.smartAssistStore().addFeedback(input);
  }

  private lockPath(pageId: string): string {
    return path.join(
      vaultPaths(this.sharedRoot).locks,
      editorLockFileName("page", pageId),
    );
  }

  /** v392 and older wrote lowercase lock names. Keep reading them until old leases expire. */
  private legacyLockPath(pageId: string): string {
    return path.join(
      vaultPaths(this.sharedRoot).locks,
      `${sanitizeSegment(pageId)}.lock`,
    );
  }

  private async atomicWriteJson(file: string, data: unknown): Promise<void> {
    await this.atomicWriteText(file, JSON.stringify(data, null, 2));
  }

  private async atomicWriteText(file: string, data: string): Promise<void> {
    await fs.ensureDir(path.dirname(file));
    const tmp = `${file}.${this.appInstanceId}.${Date.now()}.${nanoid(6)}.tmp`;
    await fs.writeFile(tmp, data, "utf8");
    if (await fs.pathExists(file))
      await fs.copy(file, `${file}.bak`, { overwrite: true });
    await fs.move(tmp, file, { overwrite: true });
  }

  private withoutLock(meta: PageMeta): PageWithLock {
    const rawProps =
      (meta as any).properties ??
      JSON.parse((meta as any).propertiesJson || "{}");
    return {
      ...meta,
      scope: (meta as any).scope ?? pageScopeFrom(rawProps),
      favorite: Boolean((meta as any).favorite),
      properties: normalizeProperties(rawProps),
      lock: null,
      isLocked: false,
    };
  }

  private withLockFromMap(
    meta: PageMeta,
    lockMap: Map<string, LockInfo>,
  ): PageWithLock {
    const lock = lockMap.get(meta.id) || null;
    const isLocked = Boolean(
      lock &&
      lock.appInstanceId !== this.appInstanceId &&
      new Date(lock.expiresAt).getTime() > Date.now(),
    );
    const rawProps =
      (meta as any).properties ??
      JSON.parse((meta as any).propertiesJson || "{}");
    return {
      ...meta,
      scope: (meta as any).scope ?? pageScopeFrom(rawProps),
      favorite: Boolean((meta as any).favorite),
      properties: normalizeProperties(rawProps),
      lock,
      isLocked,
    };
  }

  private async withLock(meta: PageMeta): Promise<PageWithLock> {
    const lock = await this.getLock(meta.id);
    const isLocked = Boolean(
      lock &&
      lock.appInstanceId !== this.appInstanceId &&
      new Date(lock.expiresAt).getTime() > Date.now(),
    );
    const rawProps =
      (meta as any).properties ??
      JSON.parse((meta as any).propertiesJson || "{}");
    return {
      ...meta,
      scope: (meta as any).scope ?? pageScopeFrom(rawProps),
      favorite: Boolean((meta as any).favorite),
      properties: normalizeProperties(rawProps),
      lock,
      isLocked,
    };
  }

  private userLabel(): string {
    return `${os.userInfo().username}@${os.hostname()}`;
  }
}
