import type { GlossaryStatus, GlossaryTerm } from "../../../shared/types";
import { findGlossaryNameConflicts, normalizeGlossaryText } from "./glossary";

const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_TERMS = 500;

export type GlossaryImportIssue = {
  row?: number;
  message: string;
};

export type GlossaryImportPayload = {
  format: "csv" | "json";
  terms: GlossaryTerm[];
  issues: GlossaryImportIssue[];
};

export type GlossaryImportPlan = {
  nextTerms: GlossaryTerm[];
  added: number;
  updates: number;
  skipped: number;
  conflicts: ReturnType<typeof findGlossaryNameConflicts>;
};

type ImportRecord = Record<string, unknown>;

const HEADER_ALIASES: Record<string, string[]> = {
  id: ["id", "用語id"],
  term: ["term", "name", "用語", "正式名称"],
  aliases: ["aliases", "alias", "別名", "別名・略称", "略称"],
  summary: ["summary", "definition", "説明", "説明文", "定義"],
  category: ["category", "分類"],
  status: ["status", "状態", "定義の状態"],
  sourcePageIds: ["sourcepageids", "source_page_ids", "補足資料id", "補足資料・関連ページid"],
  verifiedAt: ["verifiedat", "verified_at", "確認日", "定義を確認した日"],
  reviewDue: ["reviewdue", "review_due", "見直し期限", "定義を見直す期限"],
  owner: ["owner", "管理担当"],
};

function valueOf(record: ImportRecord, key: string): string {
  const aliases = HEADER_ALIASES[key] ?? [key];
  const found = Object.keys(record).find((column) => aliases.includes(normalizeHeader(column)));
  return found ? String(record[found] ?? "") : "";
}

function normalizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/[\s_-]+/g, "")
    .trim();
}

function splitValues(value: string): string[] {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/[、,;\n]/)
        .map((item) => item.normalize("NFKC").trim())
        .filter(Boolean),
    ),
  );
}

function toStatus(value: string): GlossaryStatus {
  const normalized = normalizeHeader(value);
  if (["verified", "確認済み", "定義を確認済み"].includes(normalized)) return "verified";
  if (["deprecated", "旧用語", "廃止"].includes(normalized)) return "deprecated";
  return "draft";
}

function createTerm(record: ImportRecord, now: string): GlossaryTerm | null {
  const term = valueOf(record, "term").normalize("NFKC").trim();
  const summary = valueOf(record, "summary").trim();
  if (term.length < 2 || !summary) return null;
  const requestedId = valueOf(record, "id").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return {
    id: requestedId || `term_import_${crypto.randomUUID()}`,
    term: term.slice(0, 120),
    aliases: splitValues(valueOf(record, "aliases"))
      .filter((item) => item.length >= 2 && item.length <= 120 && item !== term)
      .slice(0, 30),
    summary: summary.slice(0, 1_000),
    ...(valueOf(record, "category").trim() ? { category: valueOf(record, "category").trim().slice(0, 80) } : {}),
    status: toStatus(valueOf(record, "status")),
    sourcePageIds: splitValues(valueOf(record, "sourcePageIds")).slice(0, 30),
    ...(valueOf(record, "verifiedAt").trim() ? { verifiedAt: valueOf(record, "verifiedAt").trim().slice(0, 80) } : {}),
    ...(valueOf(record, "reviewDue").trim() ? { reviewDue: valueOf(record, "reviewDue").trim().slice(0, 80) } : {}),
    ...(valueOf(record, "owner").trim() ? { owner: valueOf(record, "owner").trim().slice(0, 120) } : {}),
    updatedAt: now,
    updatedBy: "import",
  };
}

/** RFC4180-style CSV parser for small glossary imports. */
export function parseGlossaryCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(cell); cell = ""; continue; }
    if (char === "\r" && text[index + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; index += 1; continue; }
    if (char === "\n" || char === "\r") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += char;
  }
  if (quoted) throw new Error("CSVの引用符が閉じられていません。");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((line) => line.some((value) => String(value).trim()));
}

function parseCsv(text: string): ImportRecord[] {
  const rows = parseGlossaryCsv(text);
  if (rows.length < 2) throw new Error("CSVにはヘッダー行と1件以上の用語が必要です。");
  const headers = rows[0].map((value) => String(value).replace(/^\uFEFF/, "").trim());
  if (!headers.some((header) => HEADER_ALIASES.term.includes(normalizeHeader(header))) || !headers.some((header) => HEADER_ALIASES.summary.includes(normalizeHeader(header)))) {
    throw new Error("CSVには「term（または用語）」と「summary（または説明文・定義）」列が必要です。");
  }
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function isImportRecord(item: unknown): item is ImportRecord {
  return Boolean(item) && typeof item === "object" && !Array.isArray(item);
}

function parseJson(text: string): ImportRecord[] {
  const parsed: unknown = JSON.parse(text);
  const terms: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown }).terms)
      ? (parsed as { terms: unknown[] }).terms
      : null;
  if (!terms) throw new Error("JSONは用語の配列、または { terms: [...] } 形式にしてください。");
  return terms.filter(isImportRecord);
}

export async function parseGlossaryImportFile(file: File): Promise<GlossaryImportPayload> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error("取込ファイルは2MB以下にしてください。");
  const name = file.name.toLocaleLowerCase("en-US");
  const format = name.endsWith(".json") || file.type.includes("json") ? "json" : name.endsWith(".csv") || file.type.includes("csv") || file.type === "text/plain" ? "csv" : null;
  if (!format) throw new Error("CSVまたはJSONファイルを選択してください。");
  const text = await file.text();
  const records = format === "json" ? parseJson(text) : parseCsv(text);
  const now = new Date().toISOString();
  const terms: GlossaryTerm[] = [];
  const issues: GlossaryImportIssue[] = [];
  for (const [index, record] of records.slice(0, MAX_IMPORT_TERMS).entries()) {
    const term = createTerm(record, now);
    if (!term) issues.push({ row: index + (format === "csv" ? 2 : 1), message: "正式名称（2文字以上）と説明文が必要です。" });
    else terms.push(term);
  }
  if (records.length > MAX_IMPORT_TERMS) issues.push({ message: `先頭${MAX_IMPORT_TERMS}件だけを読み込みました。` });
  return { format, terms, issues };
}

/**
 * Produces a safe import plan without mutating the current glossary. Existing terms
 * are matched by stable id first, then by normalized official term.
 */
export function planGlossaryImport(existing: GlossaryTerm[], imported: GlossaryTerm[], updateExisting: boolean): GlossaryImportPlan {
  const byId = new Map(existing.map((term) => [term.id, term]));
  const byName = new Map(existing.map((term) => [normalizeGlossaryText(term.term), term]));
  const next = [...existing];
  let added = 0;
  let updates = 0;
  let skipped = 0;
  for (const incoming of imported) {
    const previous = byId.get(incoming.id) ?? byName.get(normalizeGlossaryText(incoming.term));
    if (previous) {
      if (!updateExisting) { skipped += 1; continue; }
      const replacement = { ...incoming, id: previous.id };
      const index = next.findIndex((term) => term.id === previous.id);
      if (index >= 0) next[index] = replacement;
      byId.set(previous.id, replacement);
      byName.set(normalizeGlossaryText(replacement.term), replacement);
      updates += 1;
      continue;
    }
    next.push(incoming);
    byId.set(incoming.id, incoming);
    byName.set(normalizeGlossaryText(incoming.term), incoming);
    added += 1;
  }
  const sorted = [...next].sort((a, b) => a.term.localeCompare(b.term, "ja-JP"));
  return { nextTerms: sorted, added, updates, skipped, conflicts: findGlossaryNameConflicts(sorted) };
}

export const GLOSSARY_IMPORT_COLUMNS = "term,summary,aliases,category,status,owner,verifiedAt,reviewDue,sourcePageIds";

/** Display-only examples. Keep them aligned with the parser's accepted field names. */
export const GLOSSARY_IMPORT_CSV_SAMPLE = [
  GLOSSARY_IMPORT_COLUMNS,
  '延長保育,"通常の利用時間を超えて実施する保育。利用条件や終了時刻は年度の案内に従う。","延長利用,延長保育利用",制度,verified,青少年育成課,2026-04-01,2027-03-31,"page_001,page_002"',
].join("\n");

export const GLOSSARY_IMPORT_JSON_SAMPLE = JSON.stringify({
  terms: [{
    term: "延長保育",
    summary: "通常の利用時間を超えて実施する保育。利用条件や終了時刻は年度の案内に従う。",
    aliases: ["延長利用", "延長保育利用"],
    category: "制度",
    status: "verified",
    owner: "青少年育成課",
    verifiedAt: "2026-04-01",
    reviewDue: "2027-03-31",
    sourcePageIds: ["page_001", "page_002"],
  }],
}, null, 2);
