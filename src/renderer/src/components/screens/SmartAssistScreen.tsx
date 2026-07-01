import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import type { PageBundle, PageWithLock, WorkspaceDatabase, JournalSummary, InboxItem, TaskItem } from '../../../../shared/types';
import { dbText } from '../database/DatabaseCoreHelpers';
import { WorkspaceAiSearch } from '../search/WorkspaceAiSearch';
import type { TagAliasMap } from '../../lib/tagAliases';
import { tagPresentationFor, type TagPresentationMap } from '../../lib/tagPresentation';
import { MarkdownAnswer } from '../common/MarkdownAnswer';

function formatShortDate(value?: string) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit' }).format(new Date(value)); } catch { return String(value).slice(0, 10); }
}


function formatSemanticGeneratedAt(value?: string | null): string {
  if (!value) return '未生成';
  try { return new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return String(value); }
}

function fileNameFromPath(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\\/g, '/').split('/').filter(Boolean).pop() || text;
}

function looksLikeGgufModelPath(value?: string): boolean {
  return /\.gguf$/i.test(String(value || '').trim());
}

function looksLikeLlamaExecutablePath(value?: string): boolean {
  const text = String(value || '').trim();
  if (!text || looksLikeGgufModelPath(text)) return false;
  const name = fileNameFromPath(text).toLowerCase();
  return /\.exe$/i.test(name) || ['llama-cli', 'llama', 'llama-run'].includes(name);
}

function semanticTypeLabel(type: string): string {
  switch (type) {
    case 'faq': return 'FAQ';
    case 'page': return 'ページ';
    case 'database_row': return 'DB行';
    case 'journal': return 'Journal';
    case 'attachment_summary': return '資料';
    default: return type;
  }
}

function dateKeyJst(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

type SmartDocKind = 'page' | 'database' | 'row' | 'journal' | 'inbox' | 'task' | 'faq';
type SmartDoc = {
  id: string;
  kind: SmartDocKind;
  title: string;
  body: string;
  tags: string[];
  date?: string;
  sourceId?: string;
  databaseId?: string;
  rowId?: string;
  databaseTitle?: string;
  rowTitle?: string;
  propertySummary?: string;
  sourceKey?: string;
  searchText?: string;
  tokenText?: string;
  tokenSet?: string[];
  score?: number;
  reasons?: string[];
};

type SmartSuggestion = {
  id: string;
  kind: 'tag' | 'todo' | 'relation' | 'duplicate' | 'cleanup' | 'summary' | 'property';
  title: string;
  detail: string;
  confidence: number;
  target?: SmartDoc;
  related?: SmartDoc;
};

const SMART_KEYWORD_RULES: Array<{ tag: string; terms: string[] }> = [
  { tag: '放課後児童クラブ', terms: ['学童', '放課後児童', '児童クラブ', '留守家庭', '育成室'] },
  { tag: '会計年度任用職員', terms: ['会計年度', '任用職員', '報酬', '期末手当', '勤勉手当', '勤務条件'] },
  { tag: '給与', terms: ['給与', '給料', '報酬', '手当', '賞与', '年収', '控除'] },
  { tag: '休暇', terms: ['休暇', '年休', '病休', '特別休暇', '育休', '介護休暇'] },
  { tag: '議会', terms: ['議会', '答弁', '委員会', '本会議', '質問', '議案'] },
  { tag: '契約', terms: ['契約', '仕様書', '見積', '入札', '委託', '業者'] },
  { tag: '予算', terms: ['予算', '決算', '歳入', '歳出', '補正', '執行'] },
  { tag: 'PDF', terms: ['PDF', '資料', '添付', '文書', 'マニュアル', '手引'] },
  { tag: 'Notion', terms: ['Notion', 'ノーション', 'データベース', 'Relation', 'Rollup'] },
  { tag: 'Obsidian', terms: ['Obsidian', 'Vault', 'Markdown', 'Git', 'Working Copy'] },
  { tag: 'Omi.ai', terms: ['Omi', 'Omi.ai', '会話ログ', 'Webhook'] },
  { tag: 'AWS', terms: ['AWS', 'Lambda', 'Bedrock', 'S3', 'CloudWatch'] },
  { tag: '育児', terms: ['子ども', '息子', '離乳食', '発熱', '保育', '育児'] },
  { tag: '健康', terms: ['咳', '痰', '鼻水', '薬', '発熱', '病院'] },
];


const SMART_STOP_WORDS = new Set([
  'こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'あれ', 'ここ', 'そこ', 'いる', 'ある', 'する', 'できる', 'です', 'ます', 'した', 'して', 'から', 'まで', 'について', 'として', 'また', 'この', 'その', 'the', 'and', 'for', 'with', 'from', 'true', 'false', 'null', 'undefined'
]);

const SMART_SYNONYM_GROUPS = [
  ['学童', '放課後児童', '児童クラブ', '育成室', '留守家庭'],
  ['会計年度', '任用職員', '会計年度任用職員', '非常勤'],
  ['給与', '報酬', '給料', '手当', '賞与'],
  ['休暇', '年休', '有給', '病休', '特別休暇'],
  ['期限', '締切', '期日', '納期', 'due'],
  ['タスク', 'todo', 'to-do', '作業', '対応事項'],
  ['資料', 'pdf', '文書', '添付', 'マニュアル'],
  ['会議', '打合せ', 'ミーティング', '協議'],
  ['契約', '見積', '入札', '委託', '仕様書'],
  ['予算', '決算', '補正', '執行'],
  ['notion', 'ノーション'],
  ['obsidian', 'vault', 'markdown'],
  ['relation', 'リレーション', '関連'],
  ['rollup', 'ロールアップ', '集計'],
];

const SMART_SYNONYM_MAP = SMART_SYNONYM_GROUPS.reduce<Record<string, string[]>>((acc, group) => {
  const normalized = group.map(normalizeSmartText);
  for (const item of normalized) acc[item] = normalized.filter(other => other !== item);
  return acc;
}, {});

function expandSmartSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const synonym of SMART_SYNONYM_MAP[token] || []) expanded.add(synonym);
  }
  return Array.from(expanded);
}

function smartDateSignals(text: string): string[] {
  const normalized = normalizeSmartText(text);
  const signals: string[] = [];
  if (/(今日|本日|today)/.test(normalized)) signals.push('date:today');
  if (/(明日|tomorrow)/.test(normalized)) signals.push('date:tomorrow');
  if (/(昨日|yesterday)/.test(normalized)) signals.push('date:yesterday');
  if (/(今週|this week)/.test(normalized)) signals.push('date:this-week');
  if (/(来週|next week)/.test(normalized)) signals.push('date:next-week');
  if (/(今月|this month)/.test(normalized)) signals.push('date:this-month');
  if (/(期限切れ|過ぎ|超過|overdue)/.test(normalized)) signals.push('date:overdue');
  const absoluteDates = normalized.match(/20\d{2}[\/\-.年]\s*\d{1,2}[\/\-.月]\s*\d{1,2}日?/g) || [];
  signals.push(...absoluteDates.map(v => `date:${v.replace(/\s+/g, '')}`));
  return signals;
}

function smartPrioritySignals(text: string): string[] {
  const normalized = normalizeSmartText(text);
  const signals: string[] = [];
  if (/(至急|緊急|急ぎ|重要|高|high|urgent)/.test(normalized)) signals.push('priority:high');
  if (/(未整理|未入力|空欄|確認|要確認|review)/.test(normalized)) signals.push('state:needs-review');
  if (/(完了|済|done|closed)/.test(normalized)) signals.push('state:done');
  if (/(未完了|未対応|todo|open)/.test(normalized)) signals.push('state:open');
  return signals;
}

function normalizeSmartText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

function smartTokens(text: string): string[] {
  const normalized = normalizeSmartText(text);
  const words = normalized.match(/[a-z0-9_#@.+-]+|[ぁ-んー]{2,}|[一-龠々〆ヵヶ]{1,}/g) || [];
  const grams: string[] = [];
  const compact = normalized.replace(/\s+/g, '');
  for (let i = 0; i < compact.length - 1; i++) grams.push(compact.slice(i, i + 2));
  for (let i = 0; i < compact.length - 2; i++) grams.push(compact.slice(i, i + 3));
  const base = [...words, ...grams, ...smartDateSignals(normalized), ...smartPrioritySignals(normalized)]
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !SMART_STOP_WORDS.has(token));
  return expandSmartSynonyms(Array.from(new Set(base))).slice(0, 900);
}

function buildSmartDocIndex(doc: SmartDoc): SmartDoc {
  const raw = `${doc.title}
${doc.body}
${doc.tags.join(' ')}`;
  const tokens = smartTokens(raw);
  return {
    ...doc,
    searchText: normalizeSmartText(raw),
    tokenSet: tokens,
    tokenText: tokens.join(' '),
  };
}

function tokenOverlapScore(aTokens: string[] = [], bTokens: string[] = []): number {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let weightedOverlap = 0;
  let weightedUnion = 0;
  const union = new Set([...a, ...b]);
  union.forEach(token => {
    const weight = token.startsWith('date:') || token.startsWith('priority:') || token.startsWith('state:') ? 4 : token.length >= 4 ? 2 : 1;
    weightedUnion += weight;
    if (a.has(token) && b.has(token)) weightedOverlap += weight;
  });
  return weightedUnion ? weightedOverlap / weightedUnion : 0;
}

function keywordTagsForText(text: string): Array<{ tag: string; score: number; hits: string[] }> {
  const normalized = normalizeSmartText(text);
  return SMART_KEYWORD_RULES.map(rule => {
    const hits = rule.terms.filter(term => normalized.includes(normalizeSmartText(term)));
    return { tag: rule.tag, score: hits.length / Math.max(1, rule.terms.length), hits };
  }).filter(item => item.hits.length > 0).sort((a, b) => b.hits.length - a.hits.length || b.score - a.score);
}

function extractPlainBlockText(blocks: any[]): string {
  const out: string[] = [];
  const walk = (items: any[]) => {
    for (const block of Array.isArray(items) ? items : []) {
      const content = block?.content;
      if (typeof content === 'string') out.push(content);
      else if (Array.isArray(content)) out.push(content.map(part => typeof part === 'string' ? part : String(part?.text || '')).join(''));
      if (Array.isArray(block?.children)) walk(block.children);
    }
  };
  walk(blocks);
  return out.join('\n');
}

function buildSmartDocs(args: { pages: PageWithLock[]; databases: WorkspaceDatabase[]; journals: JournalSummary[]; inboxItems: InboxItem[]; tasks: TaskItem[]; currentPage?: PageBundle | null }): SmartDoc[] {
  const docs: SmartDoc[] = [];
  for (const page of args.pages) {
    const isCurrent = args.currentPage?.meta.id === page.id;
    const currentBody = isCurrent ? [args.currentPage?.markdown || '', extractPlainBlockText(Array.isArray((args.currentPage as any)?.blocksuite?.blocks) ? (args.currentPage as any).blocksuite.blocks : [])].filter(Boolean).join('\n') : '';
    docs.push({ id: `page:${page.id}`, kind: 'page', title: `${page.icon || '📄'} ${page.title}`, body: [currentBody, page.previewSnippet, page.properties.status, page.properties.priority, page.properties.assignee, ...(page.properties.tags || [])].filter(Boolean).join('\n'), tags: page.properties.tags || [], sourceId: page.id, date: dateKeyJst(page.updatedAt) });
  }
  for (const db of args.databases) {
    docs.push({ id: `database:${db.id}`, kind: 'database', title: `🗃️ ${db.title}`, body: db.properties.map(p => `${p.name} ${p.type} ${(p.options || []).join(' ')}`).join('\n'), tags: ['Database'], sourceId: db.id, date: dateKeyJst(db.updatedAt) });
    const titleProp = db.properties[0];
    for (const row of db.rows.slice(0, 5000)) {
      const rowText = db.properties.map(prop => `${prop.name}: ${dbText(row.cells[prop.id])}`).join('\n');
      docs.push({ id: `row:${db.id}:${row.id}`, kind: 'row', title: `▫ ${titleProp ? dbText(row.cells[titleProp.id]) || 'Untitled row' : 'Untitled row'} / ${db.title}`, body: rowText, tags: ['DB行', db.title], databaseId: db.id, rowId: row.id, sourceId: db.id, date: dateKeyJst(row.updatedAt) });
    }
  }
  for (const journal of args.journals) {
    docs.push({ id: `journal:${journal.date}`, kind: 'journal', title: `${journal.icon || '📅'} ${journal.date} ${journal.title}`, body: [journal.previewSnippet, journal.mood, journal.weather, ...(journal.tags || [])].filter(Boolean).join('\n'), tags: journal.tags || [], sourceId: journal.date, date: journal.date });
  }
  for (const item of args.inboxItems.filter(i => i.status !== 'archived')) {
    docs.push({ id: `inbox:${item.id}`, kind: 'inbox', title: `📥 ${item.title}`, body: [item.text, item.priority, ...(item.tags || [])].filter(Boolean).join('\n'), tags: item.tags || [], sourceId: item.id, date: dateKeyJst(item.updatedAt || item.createdAt) });
  }
  for (const task of args.tasks) {
    docs.push({ id: `task:${task.id}`, kind: 'task', title: `${task.completed ? '✅' : '☑️'} ${task.text}`, body: [task.text, task.sourceTitle, task.dueDate, task.completed ? '完了' : '未完了'].filter(Boolean).join('\n'), tags: ['Task'], sourceId: task.sourceId || task.id, date: task.dueDate || undefined });
  }
  return docs.map(doc => buildSmartDocIndex({ ...doc, body: doc.body || doc.title }));
}

function scoreDocSimilarity(a: SmartDoc, b: SmartDoc): number {
  const tokenScore = tokenOverlapScore(a.tokenSet || smartTokens(`${a.title}\n${a.body}`), b.tokenSet || smartTokens(`${b.title}\n${b.body}`));
  const titleScore = tokenOverlapScore(smartTokens(a.title), smartTokens(b.title));
  const tagScore = a.tags.length || b.tags.length ? a.tags.filter(tag => b.tags.includes(tag)).length / Math.max(1, new Set([...a.tags, ...b.tags]).size) : 0;
  const sameKindBonus = a.kind === b.kind ? 0.04 : 0;
  const sameDateBonus = a.date && b.date && a.date === b.date ? 0.06 : 0;
  const score = tokenScore * 0.56 + titleScore * 0.24 + tagScore * 0.14 + sameKindBonus + sameDateBonus;
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function scoreSmartSearchQuery(query: string, doc: SmartDoc): { boost: number; reasons: string[] } {
  const qTokens = smartTokens(query);
  if (!qTokens.length) return { boost: 0, reasons: [] };
  const overlap = tokenOverlapScore(qTokens, doc.tokenSet || []);
  const q = normalizeSmartText(query);
  const titleHit = doc.searchText?.includes(q) || normalizeSmartText(doc.title).includes(q);
  const reasons: string[] = [];
  if (overlap >= 0.12) reasons.push(`token ${Math.round(overlap * 100)}`);
  if (titleHit) reasons.push('title/body exact');
  const boost = Math.min(45, Math.round(overlap * 120) + (titleHit ? 18 : 0));
  return { boost, reasons };
}


function extractTodoCandidates(text: string): string[] {
  const lines = text.split(/\r?\n|。/).map(v => v.trim()).filter(Boolean);
  const actionPattern = /(要対応|確認する|確認|提出|作成|修正|連絡|調整|検討|依頼|期限|までに|TODO|ToDo|タスク|お願いします|必要|実施|対応|送付|共有|レビュー|承認)/i;
  const negativePattern = /(不要|済み|完了済|対応済|参考|例|サンプル)/;
  return Array.from(new Set(lines
    .filter(line => actionPattern.test(line) && !negativePattern.test(line))
    .map(line => line.replace(/^[-*・\s\[\]x]+/i, '').replace(/^(todo|to-do)[:：]?/i, '').slice(0, 140))))
    .slice(0, 16);
}

function importantExtractiveSummary(text: string): string[] {
  const lines = text.split(/\r?\n|。/).map(v => v.trim()).filter(v => v.length >= 8 && v.length <= 220);
  const important = /(重要|結論|決定|課題|対応|期限|理由|注意|要点|概要|目的|次回|確認|未完了|方針|原因|影響|リスク|改善|問題|依頼)/;
  const scored = lines.map((line, index) => {
    let score = 0;
    if (important.test(line)) score += 16;
    if (/[:：]/.test(line)) score += 4;
    if (/\d{4}|\d{1,2}月|期限|まで/.test(line)) score += 5;
    if (/[-・]/.test(line)) score += 2;
    score += Math.max(0, 8 - index * 0.25);
    score += Math.min(8, smartTokens(line).length / 5);
    return { line, score };
  });
  return scored.sort((a, b) => b.score - a.score)
    .map(item => item.line)
    .filter((line, index, arr) => arr.indexOf(line) === index)
    .slice(0, 7);
}

function smartQualityMetrics(docs: SmartDoc[]) {
  const tokenCount = docs.reduce((sum, doc) => sum + (doc.tokenSet?.length || 0), 0);
  const tagged = docs.filter(doc => doc.tags.length > 0).length;
  const rows = docs.filter(doc => doc.kind === 'row').length;
  return {
    avgTokens: docs.length ? Math.round(tokenCount / docs.length) : 0,
    taggedRate: docs.length ? Math.round((tagged / docs.length) * 100) : 0,
    rows,
  };
}


function normalizeSmartRelatedEvidence(result: any): SmartRelatedEvidenceItem[] {
  const rawItems = Array.isArray(result?.results) ? result.results : [];
  const seen = new Set<string>();
  const items: SmartRelatedEvidenceItem[] = [];
  for (const item of rawItems) {
    const chunk = item?.chunk || {};
    const type = String(chunk.type || '') as SmartRelatedEvidenceItem['type'];
    if (!['faq', 'page', 'database_row', 'journal', 'attachment_summary'].includes(type)) continue;
    const sourceId = String(chunk.sourceId || chunk.id || '').trim();
    const title = String(chunk.title || '').trim();
    if (!sourceId || !title) continue;
    const key = `${type}:${chunk.databaseId || ''}:${chunk.rowId || sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: String(chunk.id || key),
      type,
      sourceId,
      parentPageId: chunk.parentPageId ? String(chunk.parentPageId) : undefined,
      databaseId: chunk.databaseId ? String(chunk.databaseId) : undefined,
      rowId: chunk.rowId ? String(chunk.rowId) : undefined,
      databaseTitle: chunk.databaseTitle ? String(chunk.databaseTitle) : undefined,
      rowTitle: chunk.rowTitle ? String(chunk.rowTitle) : undefined,
      propertySummary: chunk.propertySummary ? String(chunk.propertySummary).slice(0, 1200) : undefined,
      title,
      text: String(chunk.text || '').replace(/\s+/g, ' ').trim(),
      score: Number.isFinite(Number(item?.score)) ? Math.round(Number(item.score)) : 0,
      semanticScore: Number.isFinite(Number(item?.semanticScore)) ? Math.round(Number(item.semanticScore)) : undefined,
      lexicalScore: Number.isFinite(Number(item?.lexicalScore)) ? Math.round(Number(item.lexicalScore)) : undefined,
      titleScore: Number.isFinite(Number(item?.titleScore)) ? Math.round(Number(item.titleScore)) : undefined,
      metaScore: Number.isFinite(Number(item?.metaScore)) ? Math.round(Number(item.metaScore)) : undefined,
      relationBoost: Number.isFinite(Number(item?.relationBoost)) ? Math.round(Number(item.relationBoost)) : undefined,
      reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean).slice(0, 4) : undefined,
      updatedAt: chunk.updatedAt ? String(chunk.updatedAt) : undefined,
    });
  }
  return items.filter(item => item.score >= 38).sort((a, b) => b.score - a.score).slice(0, 12);
}

function smartEvidenceTypeLabel(type: SmartRelatedEvidenceItem['type']): string {
  if (type === 'page') return 'ページ';
  if (type === 'faq') return 'FAQ';
  if (type === 'database_row') return 'DB';
  if (type === 'journal') return 'Journal';
  return '資料';
}

function smartEvidenceTypeIcon(type: SmartRelatedEvidenceItem['type']): string {
  if (type === 'page') return '📄';
  if (type === 'faq') return '💬';
  if (type === 'database_row') return '🗃️';
  if (type === 'journal') return '📅';
  return '📎';
}


type SmartRelatedEvidenceItem = {
  id: string;
  type: 'faq' | 'page' | 'database_row' | 'journal' | 'attachment_summary';
  sourceId: string;
  parentPageId?: string;
  databaseId?: string;
  rowId?: string;
  databaseTitle?: string;
  rowTitle?: string;
  propertySummary?: string;
  title: string;
  text: string;
  score: number;
  semanticScore?: number;
  lexicalScore?: number;
  titleScore?: number;
  metaScore?: number;
  relationBoost?: number;
  reasons?: string[];
  updatedAt?: string;
};

type SmartChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: SmartDoc[];
  relatedEvidence?: SmartRelatedEvidenceItem[];
  mode?: 'answer' | 'faq' | 'todo' | 'unknown' | 'summary' | 'procedure' | 'compare' | 'list' | 'deadline';
  confidence?: number;
  confidenceLevel?: SmartAnswerConfidenceLevel;
  warnings?: string[];
  followUpQuestions?: string[];
  suggestedActions?: string[];
  nextQuestions?: string[];
  clarificationChips?: string[];
  /** v315: why the FAQ was selected. Shown as a compact explanation under the answer. */
  selectionReasons?: string[];
  matchedTerms?: string[];
  /** v315: close FAQ candidates used when confidence is not high or the user wants to verify. */
  candidateFaqs?: Array<{ id?: string; question: string; category?: string; score?: number; reasons?: string[] }>;
  uxLevel?: 'high' | 'medium' | 'low';
  answerPolicy?: string;
  engine?: 'workspace-ai' | 'faq-search' | 'local-fallback';
  workspaceSourceItems?: any[];
  sourceMode?: 'auto' | 'pinned_only';
  answerStatus?: {
    generated: boolean;
    planLabel?: string;
    templateLabel?: string;
    sourceMode?: 'auto' | 'pinned_only';
    sourceCount?: number;
    verificationLabel?: string;
    elapsedMs?: number;
    warning?: string;
    dbFilterUsed?: boolean;
    dbFilterCount?: number;
    dbFilterReasons?: string[];
  };
  matchedFaqId?: string;
  matchedFaqTitle?: string;
  feedbackState?: 'good' | 'bad' | 'queued';
  relatedTags?: Array<{ tag: string; pageCount: number; reason: string; group?: string }>;
};

function normalizeSmartTagKey(value: unknown): string {
  return normalizeSmartText(value).replace(/^#/, '').replace(/[\s　]+/g, '');
}

function resolveSmartCanonicalTag(rawTag: string, aliases: TagAliasMap): string {
  const key = normalizeSmartTagKey(rawTag);
  if (!key) return '';
  for (const [tag, values] of Object.entries(aliases || {})) {
    if (normalizeSmartTagKey(tag) === key) return tag;
    if ((values || []).some((value) => normalizeSmartTagKey(value) === key)) return tag;
  }
  return String(rawTag || '').trim().replace(/^#/, '');
}

function inferSmartRelatedTags(args: {
  question: string;
  sources?: SmartDoc[];
  pages: PageWithLock[];
  faqRecords: SmartFaqRecord[];
  aliases: TagAliasMap;
  presentation?: TagPresentationMap;
}): Array<{ tag: string; pageCount: number; reason: string; group?: string }> {
  const { question, sources = [], pages, faqRecords, aliases, presentation = {} } = args;
  const canonicalCounts = new Map<string, number>();
  const sourceTags = new Set<string>();
  const register = (raw: string, source = false) => {
    const canonical = resolveSmartCanonicalTag(raw, aliases);
    if (!canonical || canonical.length < 2) return;
    if (source) sourceTags.add(normalizeSmartTagKey(canonical));
    canonicalCounts.set(canonical, canonicalCounts.get(canonical) || 0);
  };
  for (const page of pages) {
    const seen = new Set<string>();
    for (const raw of page.properties?.tags || []) {
      const canonical = resolveSmartCanonicalTag(raw, aliases);
      const key = normalizeSmartTagKey(canonical);
      if (!canonical || !key || seen.has(key)) continue;
      seen.add(key);
      canonicalCounts.set(canonical, (canonicalCounts.get(canonical) || 0) + 1);
    }
  }
  for (const tag of Object.keys(aliases || {})) register(tag);
  for (const record of faqRecords) for (const tag of record.tags || []) register(tag);
  for (const source of sources) for (const tag of source.tags || []) register(tag, true);

  const normalizedQuestion = normalizeSmartText(question);
  const rows: Array<{ tag: string; pageCount: number; reason: string; group?: string; score: number }> = [];
  for (const [tag, pageCount] of canonicalCounts) {
    const variants = [tag, ...((aliases || {})[tag] || [])]
      .map(normalizeSmartTagKey)
      .filter((value, index, array) => value.length >= 2 && array.indexOf(value) === index);
    const questionHit = variants.some((variant) => normalizedQuestion.includes(variant));
    const sourceHit = sourceTags.has(normalizeSmartTagKey(tag));
    if (!questionHit && !sourceHit) continue;
    const group = tagPresentationFor(presentation, tag).group;
    const reasonBase = questionHit && sourceHit ? '質問・根拠に一致' : questionHit ? '質問に一致' : '根拠に一致';
    const reason = group ? `${reasonBase}・${group}` : reasonBase;
    rows.push({ tag, pageCount, reason, group, score: (questionHit ? 10 : 0) + (sourceHit ? 6 : 0) + Math.min(4, pageCount / 5) });
  }
  return rows.sort((a, b) => b.score - a.score || b.pageCount - a.pageCount || a.tag.localeCompare(b.tag, 'ja')).slice(0, 6)
    .map(({ tag, pageCount, reason, group }) => ({ tag, pageCount, reason, group }));
}

type SmartFaqItem = {
  id: string;
  question: string;
  answer: string;
  sources: SmartDoc[];
};

type SmartFaqStatus = 'draft' | 'reviewed' | 'approved' | 'hidden';

type SmartFaqRecord = {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  status: SmartFaqStatus;
  sourceDocIds: string[];
  sourceTitles: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
  sourceType?: 'manual' | 'page' | 'database' | 'row' | 'journal' | 'pdf' | 'chat' | 'import';
  sourcePdfName?: string;
  sourcePage?: number | string;
  sourceText?: string;
  intent?: string | string[];
  intentId?: string;
  intentIds?: string[];
  intentLabel?: string;
  domain?: string;
  domainId?: string;
  testQuestions?: string[];
  likelyQuestions?: string[];
  paraphrases?: string[];
  negativeTerms?: string[];
  source?: any;
  suggestedActions?: string[];
  nextQuestions?: string[];
  improvementBackups?: any[];
  improvementAppliedAt?: string;
  improvementAppliedBy?: string;
};

type SmartAnswerConfidenceLevel = 'high' | 'medium' | 'low' | 'insufficient';

type SmartAnswerFeedback = {
  id: string;
  question: string;
  answerPreview: string;
  rating: 'good' | 'bad';
  reason?: string;
  sourceIds: string[];
  sourceTitles: string[];
  createdAt: string;
};

type SmartOperationProgress = {
  busy: boolean;
  label: string;
  detail: string;
  phase: 'idle' | 'running' | 'success' | 'error';
  startedAt?: number;
  completedAt?: string;
};

const SMART_FAQ_STORAGE_KEY = 'local-smart-assist:faq-records:v1';

const SMART_PINNED_QUESTIONS_KEY = 'local-smart-assist:pinned-questions:v153';
const SMART_CHAT_HISTORY_KEY = 'local-smart-assist:chat-history:v153';
const DEFAULT_PINNED_QUESTIONS = ['この資料の要点は？', '期限切れの未完了は？', '未整理FAQを確認して', 'PDF由来FAQを探して'];
type SmartAnswerMode = 'balanced' | 'short' | 'detail' | 'steps' | 'evidence' | 'faq';
function loadSmartPinnedQuestions(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SMART_PINNED_QUESTIONS_KEY) || '[]');
    return Array.isArray(parsed) && parsed.length ? parsed.map(String).filter(Boolean).slice(0, 12) : DEFAULT_PINNED_QUESTIONS;
  } catch { return DEFAULT_PINNED_QUESTIONS; }
}
function saveSmartPinnedQuestions(items: string[]) {
  try { window.localStorage.setItem(SMART_PINNED_QUESTIONS_KEY, JSON.stringify(items.slice(0, 12))); } catch {}
}
function loadSmartChatMessages(fallback: SmartChatMessage[]): SmartChatMessage[] {
  try {
    const enabled = window.localStorage.getItem(`${SMART_CHAT_HISTORY_KEY}:enabled`) !== 'false';
    if (!enabled) return fallback;
    const parsed = JSON.parse(window.localStorage.getItem(SMART_CHAT_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) && parsed.length ? parsed.slice(-40) : fallback;
  } catch { return fallback; }
}
function saveSmartChatMessages(items: SmartChatMessage[], enabled: boolean) {
  try {
    window.localStorage.setItem(`${SMART_CHAT_HISTORY_KEY}:enabled`, enabled ? 'true' : 'false');
    if (enabled) window.localStorage.setItem(SMART_CHAT_HISTORY_KEY, JSON.stringify(items.slice(-40)));
  } catch {}
}
function applySmartAnswerMode(text: string, mode: SmartAnswerMode): string {
  if (mode === 'balanced') return text;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const header = lines.find(line => line.startsWith('Local Generative Assist')) || 'Local Generative Assist';
  const question = lines.find(line => line.startsWith('質問:')) || '';
  const bullets = lines.filter(line => /^\d+[.．]/.test(line) || line.startsWith('・')).slice(0, mode === 'short' ? 3 : mode === 'detail' ? 10 : 7);
  const refs = lines.filter(line => /（(page|database|row|journal|task|inbox)|参照元|PDF|score/i.test(line)).slice(0, 8);
  if (mode === 'short') return [header, question, '', '短くまとめると:', ...(bullets.length ? bullets : lines.slice(2, 6)), '', '※詳細は根拠カードを確認してください。'].join('\n');
  if (mode === 'steps') return [header, question, '', '手順として整理:', ...(bullets.length ? bullets.map((b, i) => `${i + 1}. ${b.replace(/^\d+[.．]\s*/, '')}`) : ['1. 関連FAQ・参照元を確認する', '2. 期限・対象・必要書類を確認する', '3. 必要ならFAQとして保存する'])].join('\n');
  if (mode === 'evidence') return [header, question, '', '根拠重視の確認:', ...(bullets.length ? bullets : lines.slice(2, 9)), '', '参照元:', ...(refs.length ? refs : ['参照元が少ないため、FAQまたはPDF由来JSONの追加がおすすめです。'])].join('\n');
  if (mode === 'faq') return [header, question, '', 'FAQ形式:', `Q. ${question.replace(/^質問:\s*/, '') || '質問'}`, 'A.', ...(bullets.length ? bullets : lines.slice(2, 8))].join('\n');
  return [header, question, '', '詳しく見る:', ...lines.slice(2, 18)].join('\n');
}
function suggestSmartFaqCategory(record: SmartFaqRecord): string {
  const text = `${record.question}\n${record.answer}\n${record.tags.join(' ')}`;
  const hit = keywordTagsForText(text)[0]?.tag;
  if (hit) return hit;
  if (record.sourcePdfName) return 'PDF';
  if (/期限|締切|期日|まで/.test(text)) return '期限・手続き';
  if (/休暇|給与|報酬|手当|会計年度/.test(text)) return '人事労務';
  return record.category || '未分類';
}
function duplicateFaqCandidates(records: SmartFaqRecord[]): Array<{ a: SmartFaqRecord; b: SmartFaqRecord; score: number }> {
  const usable = records.filter(r => r.status !== 'hidden').slice(0, 600);
  const out: Array<{ a: SmartFaqRecord; b: SmartFaqRecord; score: number }> = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < Math.min(usable.length, i + 120); j++) {
      const score = Math.round(tokenOverlapScore(smartTokens(usable[i].question), smartTokens(usable[j].question)) * 100);
      if (score >= 58) out.push({ a: usable[i], b: usable[j], score });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, 12);
}

function smartFaqDedupKey(record: Pick<SmartFaqRecord, 'question'> & Partial<SmartFaqRecord>): string {
  const normalizedQuestion = normalizeSmartText(record.question || '');
  return normalizedQuestion.replace(/\s+/g, '');
}

function dedupeImportedFaqRecords(imported: SmartFaqRecord[], existing: SmartFaqRecord[]) {
  const existingIds = new Set(existing.map(item => item.id).filter(Boolean));
  const existingQuestionKeys = new Set(existing.map(smartFaqDedupKey).filter(Boolean));
  const batchIds = new Set<string>();
  const batchQuestionKeys = new Set<string>();
  const unique: SmartFaqRecord[] = [];
  const duplicates: SmartFaqRecord[] = [];

  for (const item of imported) {
    const id = item.id;
    const qKey = smartFaqDedupKey(item);
    const duplicated = Boolean(
      (id && (existingIds.has(id) || batchIds.has(id))) ||
      (qKey && (existingQuestionKeys.has(qKey) || batchQuestionKeys.has(qKey)))
    );

    if (duplicated) {
      duplicates.push(item);
      continue;
    }

    if (id) batchIds.add(id);
    if (qKey) batchQuestionKeys.add(qKey);
    unique.push(item);
  }

  return { unique, duplicates };
}

function formatSmartOperationSeconds(startedAt?: number): string {
  if (!startedAt) return '';
  const sec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return sec <= 0 ? '' : `${sec}秒`;
}

function scoreFaqQuality(record: SmartFaqRecord): { score: number; label: string; reasons: string[]; missing: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
  const miss = (reason: string) => { missing.push(reason); };
  if (record.question.trim().length >= 8) add(16, '質問あり'); else miss('質問が短い');
  if (record.answer.trim().length >= 24) add(22, '回答あり'); else miss('回答が未入力または短い');
  if (record.category && record.category !== '未分類') add(10, 'カテゴリあり'); else miss('カテゴリ未整理');
  if (record.tags.length) add(10, 'タグあり'); else miss('タグなし');
  if (record.sourceTitles.length || record.sourceText || record.sourcePdfName) add(16, '根拠あり'); else miss('根拠なし');
  if (record.sourcePdfName && record.sourcePage) add(8, 'PDFページあり');
  if (record.status === 'approved') add(18, '承認済み');
  else if (record.status === 'reviewed') add(12, '確認済み');
  else if (record.status === 'draft') miss('未確認');
  if (record.answer.length > 1200) { score -= 6; missing.push('回答が長すぎる可能性'); }
  const normalized = Math.max(0, Math.min(100, score));
  const label = normalized >= 85 ? '高品質' : normalized >= 65 ? '確認推奨' : '要改善';
  return { score: normalized, label, reasons: reasons.slice(0, 5), missing: missing.slice(0, 5) };
}

function safeFaqStatus(value: unknown): SmartFaqStatus {
  return value === 'reviewed' || value === 'approved' || value === 'hidden' ? value : 'draft';
}

function loadLocalSmartFaqRecordsForMigration(): SmartFaqRecord[] {
  try {
    const raw = window.localStorage.getItem(SMART_FAQ_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => ({
      id: String(item.id || `faq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      question: String(item.question || '').trim(),
      answer: String(item.answer || '').trim(),
      category: String(item.category || '未分類'),
      tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
      status: safeFaqStatus(item.status),
      sourceDocIds: Array.isArray(item.sourceDocIds) ? item.sourceDocIds.map(String) : [],
      sourceTitles: Array.isArray(item.sourceTitles) ? item.sourceTitles.map(String) : [],
      confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(100, Number(item.confidence))) : 70,
      createdAt: String(item.createdAt || new Date().toISOString()),
      updatedAt: String(item.updatedAt || new Date().toISOString()),
      sourceType: item.sourceType,
      sourcePdfName: item.sourcePdfName,
      sourcePage: item.sourcePage,
      sourceText: item.sourceText,
    })).filter(item => item.question && item.answer);
  } catch {
    return [];
  }
}

function clearLocalSmartFaqMigrationCache() {
  window.localStorage.removeItem(SMART_FAQ_STORAGE_KEY);
}

function smartFaqToDoc(record: SmartFaqRecord): SmartDoc {
  return buildSmartDocIndex({
    id: `faq-record:${record.id}`,
    kind: 'faq',
    title: `❓ ${record.question}`,
    body: [`FAQ`, `カテゴリ: ${record.category}`, `回答: ${record.answer}`, `参照元: ${record.sourceTitles.join(' / ')}`, record.intentId ? `Intent: ${record.intentId}` : '', record.domain ? `Domain: ${record.domain}` : '', record.sourcePdfName ? `PDF: ${record.sourcePdfName}` : '', record.sourcePage ? `ページ: ${record.sourcePage}` : '', record.sourceText ? `根拠抜粋: ${record.sourceText}` : ''].filter(Boolean).join('\n'),
    tags: ['FAQ', record.category, ...record.tags].filter(Boolean),
    sourceId: record.id,
    date: dateKeyJst(record.updatedAt),
  });
}

function scoreFaqRecord(question: string, record: SmartFaqRecord): number {
  const qTokens = smartTokens(question);
  const rTokens = smartTokens(`${record.question}\n${record.answer}\n${record.category}\n${record.tags.join(' ')}`);
  const overlap = tokenOverlapScore(qTokens, rTokens);
  const exact = normalizeSmartText(record.question).includes(normalizeSmartText(question)) || normalizeSmartText(question).includes(normalizeSmartText(record.question));
  const statusBoost = record.status === 'approved' ? 18 : record.status === 'reviewed' ? 10 : record.status === 'draft' ? 2 : -100;
  return Math.max(0, Math.min(100, Math.round(overlap * 120 + (exact ? 30 : 0) + statusBoost)));
}

function buildFaqRecordFromItem(item: SmartFaqItem, status: SmartFaqStatus = 'draft'): SmartFaqRecord {
  const now = new Date().toISOString();
  const sourceTitles = item.sources.map(source => source.title);
  const tags = Array.from(new Set(item.sources.flatMap(source => source.tags).filter(Boolean))).slice(0, 8);
  return {
    id: `faq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    question: item.question,
    answer: item.answer,
    category: tags[0] || item.sources[0]?.kind || '未分類',
    tags,
    status,
    sourceDocIds: item.sources.map(source => source.id),
    sourceTitles,
    confidence: 72,
    createdAt: now,
    updatedAt: now,
    sourceType: 'page',
    sourceText: item.answer.slice(0, 800),
  };
}

function buildFaqRecordFromDoc(doc: SmartDoc, status: SmartFaqStatus = 'draft'): SmartFaqRecord {
  const lines = importantExtractiveSummary(`${doc.title}\n${doc.body}`).slice(0, 5);
  const keyword = (doc.tags[0] || smartTokens(doc.title).find(t => !t.includes(':')) || doc.title).replace(/^#/, '');
  return buildFaqRecordFromItem({
    id: `faq-auto:${doc.id}`,
    question: `${keyword}について何を確認すればよいですか？`,
    answer: lines.length ? lines.join('\n') : `${doc.title} を開いて本文・プロパティ・関連情報を確認してください。`,
    sources: [doc],
  }, status);
}


function normalizeServerFaqRecord(raw: any): SmartFaqRecord | null {
  if (!raw) return null;
  const question = String(raw.question || '').trim();
  const answer = String(raw.answer || '').trim();
  if (!question || !answer) return null;
  return {
    id: String(raw.id || `faq_server_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    question,
    answer,
    category: String(raw.category || '未分類'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
    status: safeFaqStatus(raw.status || 'reviewed'),
    sourceDocIds: Array.isArray(raw.sourceDocIds) ? raw.sourceDocIds.map(String) : [],
    sourceTitles: Array.isArray(raw.sourceTitles) ? raw.sourceTitles.map(String) : [raw.sourceTitle, raw.sourcePdfName].filter(Boolean).map(String),
    confidence: Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(100, Number(raw.confidence))) : 80,
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    sourceType: raw.sourceType,
    sourcePdfName: raw.sourcePdfName,
    sourcePage: raw.sourcePage,
    sourceText: raw.sourceText,
    intent: raw.intent,
    intentId: raw.intentId,
    intentIds: Array.isArray(raw.intentIds) ? raw.intentIds.map(String) : undefined,
    intentLabel: raw.intentLabel,
    domain: raw.domain,
    domainId: raw.domainId,
    testQuestions: Array.isArray(raw.testQuestions) ? raw.testQuestions.map(String).filter(Boolean) : Array.isArray(raw.examples) ? raw.examples.map(String).filter(Boolean) : undefined,
  };
}

function confidenceLevelFromFaqScore(score: number): SmartAnswerConfidenceLevel {
  if (score >= 85) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  return 'insufficient';
}


function normalizeSmartChatText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ん]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSmartLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = normalizeSmartChatText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}


function dedupeSmartLowConfidenceLogs(logs: any[]): any[] {
  const priority = (item: any) => String(item?.sourceType || '').includes('feedback') ? 3 : String(item?.sourceType || '').includes('queue') ? 2 : 1;
  const map = new Map<string, any>();
  for (const item of Array.isArray(logs) ? logs : []) {
    const questionKey = normalizeSmartChatText(item?.question || '');
    if (!questionKey) continue;
    const key = [questionKey, String(item?.expectedFaqId || ''), String(item?.matchedFaqId || '')].join('::');
    const current = map.get(key);
    if (!current) {
      map.set(key, item);
      continue;
    }
    const timeCurrent = String(current?.createdAt || '');
    const timeNext = String(item?.createdAt || '');
    if (priority(item) > priority(current) || (priority(item) === priority(current) && timeNext >= timeCurrent)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values()).sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
}

function buildPersonalizedFaqAnswer(question: string, record: SmartFaqRecord): { lead: string; bullets: string[]; followups: string[] } {
  const q = normalizeSmartChatText(question);
  const answer = String(record.answer || '').trim();
  const haystack = normalizeSmartChatText([record.question, record.answer, record.category, record.tags?.join(' ')].join(' '));
  const bullets: string[] = [];
  const followups: string[] = [];

  const strictIntent = detectStrictFaqIntent(question);
  const isAnnualLeave = strictIntent.isAnnualLeave;
  const isChildCareLeave = strictIntent.isChildCareLeave;
  const isWork = !isAnnualLeave && !isChildCareLeave && /就労|仕事|勤務|働|16時|午後4時|週何日|週3日|条件|要件/.test(q + ' ' + haystack);
  const isFee = /料金|費用|利用料|育成料|保育料|減免|免除|兄弟|割引|いくら|お金|安く/.test(q + ' ' + haystack);
  const isApplication = /申請|申込|申し込み|手続|期限|いつまで|電子申請|ロゴフォーム|logo|どうしたら|どうすれば|やり方|方法|流れ/.test(q + ' ' + haystack);
  const isDocument = /書類|証明|就労証明|勤務証明|添付|写真|シフト|自営業|フリーランス|いるもの|必要なもの|提出物/.test(q + ' ' + haystack);
  const isSchedule = /延長|土曜|土曜日|夏休み|春休み|冬休み|長期休業|時間/.test(q + ' ' + haystack);
  const isWithdrawal = /退会|やめ|辞め|利用停止/.test(q + ' ' + haystack);
  const isVagueEligibility = /できる|可能|いける|大丈夫|使える|利用できる|入れる|申し込める|対象|誰|どんな人|該当|条件|要件/.test(q);
  const isHelp = /困った|わからない|不安|相談|問い合わせ|聞きたい|確認したい/.test(q);

  let lead = answer || '該当FAQの内容を確認してください。';

  if (strictIntent.isMissedDeadlineIntent) {
    lead = '申請期限を過ぎてしまった場合は、まず担当窓口や所属へ連絡し、受付可否・再申請・次回受付・必要書類の扱いを確認してください。';
    bullets.push('期限後は通常どおり受け付けられない場合があるため、自己判断で放置せず早めに確認します。');
    bullets.push('事情説明が必要な場合や、次回受付・随時受付に回る場合があります。');
    bullets.push('提出済み・未提出・書類不備のどれかで対応が変わるため、申請状況を確認します。');
    followups.push('期限後でも受け付けてもらえますか？');
    followups.push('再申請は必要ですか？');
    followups.push('問い合わせ先を教えて');
  } else if (strictIntent.isChangeIntent) {
    lead = '申請内容や勤務時間などを変更したい場合は、変更内容を整理し、事前承認や変更届・証明書類の提出が必要かを確認してください。';
    bullets.push('勤務時間・勤務先・住所・利用内容など、何を変更するかで必要書類が変わります。');
    bullets.push('変更後の条件が制度の対象要件を満たすかも確認します。');
    bullets.push('反映時期や提出期限がある場合は、担当窓口へ早めに確認します。');
    followups.push('勤務時間を変更したい場合は？');
    followups.push('変更届は必要ですか？');
    followups.push('必要書類を教えて');
  } else if (isAnnualLeave) {
    if (/いつから|付与|使える|使用|取得/.test(q)) lead = '年次有給休暇をいつから使用できるかは、採用日・勤務日数・勤務時間・継続勤務期間などの勤務条件により確認します。';
    else lead = '年次有給休暇は、勤務条件や任用形態に応じて付与・使用の条件を確認します。';
    bullets.push('まず、勤務条件通知書や所属の運用で、付与日・付与日数・使用開始時期を確認します。');
    bullets.push('パートタイムや会計年度任用職員の場合は、勤務日数・勤務時間・継続勤務期間により扱いが変わることがあります。');
    followups.push('有給の付与日数を教えて');
    followups.push('会計年度任用職員の有給はいつから？');
    followups.push('年休の申請方法を教えて');
  } else if (isChildCareLeave) {
    lead = '子どもの発熱などで休む場合は、まず所属へ連絡し、子の看護休暇など対象となる休暇・必要書類・事後提出の扱いを確認してください。';
    bullets.push('急な発熱などの場合は、まず所属へ連絡します。');
    bullets.push('後から必要書類を提出する運用になる場合があります。');
    followups.push('子どもの看護で休みたい場合はどうすればよいですか？');
    followups.push('必要書類は何ですか？');
  } else if (isWork) {
    if (/週何日|何日|週3|週三/.test(q)) lead = '週3日以上の勤務が、就労要件の中心条件です。';
    else if (/16時|午後4時|4時|何時|終わる|終業|退勤/.test(q)) lead = '原則は勤務終了時間が午後4時以降であることです。16時前に終わる場合でも、通勤時間などにより午後4時までに帰宅できないことが確認できれば対象になり得ます。';
    else if (/何か月|何ヶ月|3か月|三か月|期間|継続/.test(q)) lead = '3か月以上、継続勤務または勤務予定であることが求められます。';
    else lead = '就労要件は、勤務終了時間・勤務日数・勤務期間をまとめて確認します。';
    bullets.push('原則：勤務終了時間が午後4時以降');
    bullets.push('勤務日数：週3日以上');
    bullets.push('勤務期間：3か月以上継続勤務、または勤務予定');
    bullets.push('例外的に、通勤時間等で午後4時までに帰宅困難な場合も確認対象');
    followups.push('就労証明書は必要ですか？');
    followups.push('16時前に終わる場合の扱いは？');
  } else if (isFee) {
    lead = /兄弟|きょうだい|割引/.test(q) ? '兄弟で利用する場合は、兄弟減額の対象になる可能性があります。' : '育成料・利用料は、減額や免除の対象になる場合があります。';
    bullets.push('兄弟減額のみの場合は、別途の減額・免除申請書が不要な場合があります。');
    bullets.push('兄弟減額以外の減額・免除は、必要書類の提出が必要です。');
    bullets.push('減額・免除は年度ごとの申請で、原則として遡及適用できません。');
    followups.push('兄弟減額の条件は？');
    followups.push('減免の必要書類は？');
  } else if (isApplication) {
    lead = /どうしたら|どうすれば|何をすれば|やり方|方法|流れ/.test(q)
      ? 'まず、利用したい内容に該当するかを確認し、必要書類をそろえて申請します。放課後児童クラブでは、就労状況などを確認する書類が重要です。'
      : /いつまで|期限|何日前/.test(q) ? '随時入会は、利用開始希望日の2週間前までの申請が目安です。' : '申請は、電子申請または指定された方法で行います。';
    bullets.push('随時入会は、利用開始希望日の2週間前までに申請します。');
    bullets.push('電子申請は、夜間・休日でも手続きできます。');
    bullets.push('添付書類は、スマホで撮影した画像を提出できる場合があります。');
    followups.push('電子申請の方法は？');
    followups.push('必要書類は何ですか？');
  } else if (isDocument) {
    lead = '申請内容に応じて、就労証明書などの添付書類が必要です。';
    bullets.push('就労証明書は、入会希望日の3か月以内に発行されたものが必要です。');
    bullets.push('証明書だけで確認できない場合は、直近1か月のシフト表などを添付します。');
    bullets.push('自営業・内職の場合は、事業内容が分かる資料と1週間の平均スケジュール表が必要です。');
    followups.push('自営業の場合の書類は？');
    followups.push('シフト表は必要ですか？');
  } else if (isSchedule) {
    lead = '利用時間や延長・土曜利用は、通常利用と別に条件や手続きが設定されている場合があります。';
    bullets.push('延長利用や土曜利用は、通常の入会とは別に確認が必要です。');
    bullets.push('長期休業中の利用可否や申請方法は、年度の案内で確認します。');
    followups.push('土曜日も利用できますか？');
    followups.push('延長利用はできますか？');
  } else if (isWithdrawal) {
    lead = '利用をやめる場合は、退会・利用停止の手続きが必要です。';
    bullets.push('退会日や提出期限は、案内・担当窓口で確認してください。');
    bullets.push('利用料の扱いが変わる場合があるため、早めの手続きが安全です。');
    followups.push('退会届は必要ですか？');
  } else if (isVagueEligibility) {
    lead = '対象になるか・利用できるかを確認する質問として判断しました。まずは、対象者・入会要件・必要書類の3点を確認するのが安全です。';
    bullets.push('対象者：市内在住の小学生など、制度ごとの対象範囲を確認します。');
    bullets.push('条件：保護者の就労・看護・疾病など、家庭での育成が難しい理由を確認します。');
    bullets.push('手続き：申請期限、必要書類、電子申請の可否を確認します。');
    bullets.push(answer);
    followups.push('対象になる条件は？');
    followups.push('必要書類は何ですか？');
    followups.push('申請はどうしたらいいですか？');
  } else if (isHelp) {
    lead = '困りごと・確認事項として判断しました。該当しそうなFAQを根拠に、まず確認すべき点を整理します。';
    bullets.push(answer);
    followups.push('対象になる条件は？');
    followups.push('必要書類は何ですか？');
    followups.push('問い合わせ先は？');
  } else {
    const sentences = answer.split(/(?<=[。！？!?])/).map((line) => line.trim()).filter(Boolean);
    lead = sentences[0] || answer || '該当FAQの内容を確認してください。';
    bullets.push(...sentences.slice(1, 4));
    followups.push('必要書類は何ですか？');
    followups.push('申請期限はいつですか？');
  }

  const normalizedAnswer = normalizeSmartChatText(answer);
  const normalizedLead = normalizeSmartChatText(lead);
  if (answer && normalizedAnswer !== normalizedLead && !normalizedAnswer.includes(normalizedLead)) {
    bullets.push(answer);
  }

  return {
    lead,
    bullets: uniqueSmartLines(bullets).slice(0, 6),
    followups: uniqueSmartLines(followups).slice(0, 3),
  };
}



type FaqAnswerIntentSummary = {
  labels: string[];
  isAmbiguous: boolean;
  needsCondition: boolean;
  needsProcedure: boolean;
  needsDocument: boolean;
  needsFee: boolean;
  needsDeadline: boolean;
  needsAvailability: boolean;
};

function analyzeFaqAnswerIntent(question: string, top?: SmartFaqRecord): FaqAnswerIntentSummary {
  const q = normalizeSmartChatText(`${question}\n${top?.question || ''}\n${top?.category || ''}\n${top?.tags?.join(' ') || ''}`);
  const labels: string[] = [];
  const has = (terms: string[]) => terms.some(term => q.includes(normalizeSmartChatText(term)));
  const needsCondition = has(['条件', '要件', '対象', '入れる', '使える', '利用できる', '可能', 'いける', '大丈夫', '該当', '就労', '仕事', '勤務']);
  const needsProcedure = has(['申請', '申込', '申し込み', '手続', '方法', 'やり方', 'どうしたら', 'どうすれば', '流れ']);
  const needsDocument = has(['書類', '証明', '添付', 'シフト', '写真', '必要なもの', 'いるもの', '勤務証明', '就労証明']);
  const needsFee = has(['料金', '費用', '利用料', '育成料', '保育料', '減免', '免除', '兄弟', '安く', '割引']);
  const needsDeadline = has(['いつ', '期限', '締切', '何日前', 'いつまで', '開始', '随時']);
  const needsAvailability = has(['空き', '待機', '定員', '空いて', '入れるか']);
  if (needsCondition) labels.push('対象・条件');
  if (needsProcedure) labels.push('申請手続き');
  if (needsDocument) labels.push('必要書類');
  if (needsFee) labels.push('料金・減免');
  if (needsDeadline) labels.push('期限');
  if (needsAvailability) labels.push('空き状況');
  const isAmbiguous = labels.length === 0 || /どう|なに|何|これ|それ|大丈夫|いける|できる|使える|よくわから|困っ/.test(q);
  return { labels: labels.length ? labels : ['関連情報'], isAmbiguous, needsCondition, needsProcedure, needsDocument, needsFee, needsDeadline, needsAvailability };
}



type GenericFaqIntentProfile = {
  id: string;
  label: string;
  queryTerms: string[];
  answerTerms: string[];
  leadHint: string;
  followups: string[];
  genericFallback: string;
};

const GENERIC_FAQ_INTENT_PROFILES: GenericFaqIntentProfile[] = [
  {
    id: 'eligibility',
    label: '対象・条件',
    queryTerms: ['対象', '条件', '要件', '基準', '資格', '使える', '利用できる', '入れる', '申し込める', '可能', 'いける', '大丈夫', '該当', 'できる'],
    answerTerms: ['対象', '条件', '要件', '基準', '資格', '利用できる', '申込', '入会', '対象者', '該当', '可能', '必要'],
    leadHint: '対象・条件に関する質問として整理します。',
    followups: ['対象になる条件を詳しく教えて', '例外や注意点はありますか？', '必要書類も教えて'],
    genericFallback: '対象になるかは、対象者・条件・必要書類・期限を順に確認すると判断しやすいです。',
  },
  {
    id: 'procedure',
    label: '手続き・申請',
    queryTerms: ['手続', '手続き', '申請', '申込', '申し込み', '方法', 'やり方', 'どうしたら', 'どうすれば', '流れ', '登録', '提出'],
    answerTerms: ['申請', '申込', '手続', '提出', '登録', 'フォーム', '電子申請', '窓口', '郵送', '流れ', '方法', '届出'],
    leadHint: '手続き・申請に関する質問として整理します。',
    followups: ['必要書類は何ですか？', '期限はいつですか？', '電子申請できますか？'],
    genericFallback: '手続きは、申請先・提出方法・必要書類・期限を確認するのが基本です。',
  },
  {
    id: 'documents',
    label: '必要書類',
    queryTerms: ['書類', '証明', '証明書', '添付', '必要なもの', 'いるもの', '提出物', '写真', 'データ', 'ファイル'],
    answerTerms: ['書類', '証明書', '添付', '提出', '写真', '写し', '様式', '資料', 'シフト', '確認書類', '必要'],
    leadHint: '必要書類に関する質問として整理します。',
    followups: ['提出方法を教えて', '不足した場合はどうなりますか？', '期限はいつですか？'],
    genericFallback: '必要書類は、本人確認・条件確認・申請内容確認に分けて確認すると漏れにくいです。',
  },
  {
    id: 'fee',
    label: '料金・費用',
    queryTerms: ['料金', '費用', '金額', 'いくら', '支払い', '負担', '安く', '減免', '免除', '割引', '無料', '月額'],
    answerTerms: ['料金', '費用', '金額', '月額', '支払い', '負担', '減免', '免除', '割引', '無料', '加算', '徴収'],
    leadHint: '料金・費用に関する質問として整理します。',
    followups: ['減免はありますか？', '支払い方法を教えて', '兄弟・複数利用の扱いは？'],
    genericFallback: '料金は、基本料金・追加料金・減免条件・支払い方法を分けて確認すると分かりやすいです。',
  },
  {
    id: 'deadline',
    label: '期限・時期',
    queryTerms: ['いつ', 'いつまで', '期限', '締切', '期日', '開始', '終了', '何日前', '随時', '今日', '今月', '今年'],
    answerTerms: ['期限', '締切', '期日', '開始', '終了', 'まで', '随時', '何日前', '受付', '年度', '利用開始'],
    leadHint: '期限・時期に関する質問として整理します。',
    followups: ['申請方法も教えて', '必要書類は何ですか？', '間に合わない場合は？'],
    genericFallback: '期限は、利用開始日・受付期間・提出締切・不備対応期限を分けて確認してください。',
  },
  {
    id: 'change',
    label: '変更・取消',
    queryTerms: ['変更', '変えたい', '変わった', '修正', '訂正', '取消', 'キャンセル', 'やめたい', '退会', '停止', '転職', '引越し'],
    answerTerms: ['変更', '修正', '訂正', '取消', 'キャンセル', '退会', '停止', '届出', '変更届', '転職', '住所変更'],
    leadHint: '変更・取消に関する質問として整理します。',
    followups: ['いつまでに変更できますか？', '必要書類はありますか？', '連絡先を教えて'],
    genericFallback: '変更や取消は、変更内容・届出期限・必要書類・連絡先を確認してください。',
  },
  {
    id: 'trouble',
    label: '困りごと・相談',
    queryTerms: ['困った', 'わからない', '不安', '相談', '問い合わせ', '聞きたい', '確認したい', 'できない', 'エラー', '失敗'],
    answerTerms: ['問い合わせ', '相談', '確認', '連絡', '窓口', '担当', 'エラー', '不備', '再提出', '対応'],
    leadHint: '困りごと・相談に関する質問として整理します。',
    followups: ['問い合わせ先を教えて', 'よくある原因は？', '次に何をすればいい？'],
    genericFallback: '困った場合は、状況・必要な手続き・問い合わせ先を確認すると次の行動を決めやすいです。',
  },
  {
    id: 'definition',
    label: '意味・概要',
    queryTerms: ['とは', '何', 'なに', '意味', '概要', 'どんな', '説明', '違い', '比較'],
    answerTerms: ['とは', '概要', '目的', '意味', '説明', '違い', '比較', '対象', '内容'],
    leadHint: '意味・概要に関する質問として整理します。',
    followups: ['対象や条件も教えて', '手続きも教えて', '注意点はありますか？'],
    genericFallback: '概要だけでなく、対象・条件・手続き・注意点をあわせて確認すると実務で使いやすくなります。',
  },
];

function normalizeForGenericIntent(input: string): string {
  return normalizeSmartChatText(input).replace(/\s+/g, ' ');
}

type FaqDomainId =
  | 'annual_leave'
  | 'child_care_leave'
  | 'missed_deadline'
  | 'change_request'
  | 'work_requirement'
  | 'allowance'
  | 'commute'
  | 'fee'
  | 'document'
  | 'procedure'
  | 'consultation'
  | 'unknown';

type FaqDomainProfile = {
  id: FaqDomainId;
  label: string;
  queryTerms: string[];
  evidenceTerms: string[];
  negativeTerms: string[];
  fallbackLead: string;
  fallbackBullets: string[];
  followups: string[];
  domain?: string;
};

const FAQ_DOMAIN_PROFILES: FaqDomainProfile[] = [
  {
    id: 'annual_leave',
    label: '年次有給休暇',
    queryTerms: ['有給', '有休', '年休', '年次有給', '有給休暇', '年次休暇', 'いつから使える', 'いつから使用', '付与', '取得'],
    evidenceTerms: ['有給', '有休', '年休', '年次有給', '有給休暇', '年次休暇', '付与', '取得', '使用', '採用日', '勤務条件', '継続勤務', '付与日数'],
    negativeTerms: ['扶養手当', '扶養対象', '通勤手当', '交通費', '子の看護', '看護休暇', '忌引', '服喪', '育成料', '減免', '就労要件', '就労条件'],
    fallbackLead: '年次有給休暇をいつから使用できるかは、採用日・勤務日数・勤務時間・継続勤務期間などの勤務条件により確認します。',
    fallbackBullets: ['勤務条件通知書や所属の運用で、付与日・付与日数・使用開始時期を確認してください。', '任用形態や勤務日数により扱いが変わる場合があります。'],
    followups: ['有給の付与日数を教えて', '年休の申請方法を教えて', '会計年度任用職員の有給はいつから？'],
  },
  {
    id: 'child_care_leave',
    label: '子の看護・休暇',
    queryTerms: ['子ども', '子供', 'こども', '子の看護', '看護休暇', '発熱', '熱', '病気', '体調不良', '休みたい', '休む', '欠勤'],
    evidenceTerms: ['子の看護', '看護休暇', '子どもの看護', '子供の看護', '発熱', '病気', '体調不良', '休暇', '休む', '所属へ連絡', '必要書類', '事後提出'],
    negativeTerms: ['育成料', '利用料', '保育料', '減免', '免除', '兄弟減額', '料金', '費用', '扶養手当', '通勤手当', '就労要件', '就労条件', '有給', '年休', '忌引'],
    fallbackLead: '子どもの発熱などで休む場合は、まず所属へ連絡し、子の看護休暇など対象となる休暇・必要書類・事後提出の扱いを確認してください。',
    fallbackBullets: ['急な発熱などの場合は、まず所属へ連絡します。', '後から必要書類を提出する運用になる場合があります。'],
    followups: ['子の看護休暇の必要書類は？', '事後提出できますか？'],
  },
  {
    id: 'missed_deadline',
    label: '期限超過・申請遅れ',
    queryTerms: ['期限が過ぎた', '締切が過ぎた', '期日が過ぎた', '申請遅れ', '間に合わない', '忘れた', '期限切れ', '遅れた'],
    evidenceTerms: ['期限', '締切', '期日', '申請期限', '提出期限', '過ぎ', '遅れ', '間に合わ', '期限後', '再申請', '随時受付', '担当窓口', '問い合わせ'],
    negativeTerms: ['子の看護', '看護休暇', '発熱', '扶養手当', '通勤手当', '就労要件', '年次有給', '有給休暇', '育成料', '減免'],
    fallbackLead: '申請期限を過ぎてしまった場合は、まず担当窓口や所属へ連絡し、受付可否・再申請・次回受付・必要書類の扱いを確認してください。',
    fallbackBullets: ['期限後は通常どおり受け付けられない場合があるため、自己判断で放置せず早めに確認します。', '提出済み・未提出・書類不備のどれかで対応が変わるため、申請状況を確認します。'],
    followups: ['期限後でも受け付けてもらえますか？', '再申請は必要ですか？'],
  },
  {
    id: 'change_request',
    label: '変更・修正',
    queryTerms: ['変更', '変えたい', '修正', '訂正', '間違えた', '勤務時間を変更', '勤務先変更', '住所変更', '内容変更', '変更届'],
    evidenceTerms: ['変更', '変更届', '修正', '訂正', '勤務時間', '勤務先', '住所変更', '内容変更', '事前承認', '届出', '反映時期'],
    negativeTerms: ['子の看護', '看護休暇', '発熱', '扶養手当', '通勤手当', '年次有給', '育成料', '減免'],
    fallbackLead: '申請内容や勤務時間などを変更したい場合は、変更内容を整理し、事前承認や変更届・証明書類の提出が必要かを確認してください。',
    fallbackBullets: ['何を変更するかで必要書類が変わります。', '反映時期や提出期限がある場合は、担当窓口へ早めに確認します。'],
    followups: ['変更届は必要ですか？', '必要書類を教えて'],
  },
  {
    id: 'work_requirement',
    label: '就労要件',
    queryTerms: ['就労要件', '就労条件', '勤務終了時間', '午後4時', '16時', '週3日', '3か月', '働いていたら', '勤務条件'],
    evidenceTerms: ['就労要件', '就労条件', '勤務終了時間', '勤務日数', '勤務期間', '週3日', '3か月', '午後4時', '16時', '通勤時間', '継続勤務'],
    negativeTerms: ['有給', '年休', '扶養手当', '通勤手当', '子の看護', '看護休暇', '育成料', '減免'],
    fallbackLead: '就労要件は、勤務終了時間・勤務日数・勤務期間をまとめて確認します。',
    fallbackBullets: ['原則として勤務終了時間、週の勤務日数、継続勤務期間を確認します。', '通勤時間により帰宅時刻の扱いが変わる場合があります。'],
    followups: ['勤務時間が何時までなら対象？', '週何日必要ですか？'],
  },
  {
    id: 'allowance',
    label: '扶養手当',
    queryTerms: ['扶養手当', '扶養対象', '扶養', '配偶者', '被扶養', '続柄', '同居', '別居'],
    evidenceTerms: ['扶養手当', '扶養対象', '収入状況', '続柄', '同居', '別居', '届出書', '証明書類'],
    negativeTerms: ['有給', '年休', '通勤手当', '子の看護', '看護休暇', '育成料'],
    fallbackLead: '扶養手当は、扶養対象者の収入状況・続柄・同居別居などを確認し、必要な届出書や証明書類を提出します。',
    fallbackBullets: ['対象者の収入状況と続柄を確認します。', '必要書類は所属や担当窓口へ確認してください。'],
    followups: ['扶養手当の必要書類は？', '収入条件を教えて'],
  },
  {
    id: 'commute',
    label: '通勤手当',
    queryTerms: ['通勤手当', '交通費', '通勤方法', '公共交通', '自転車', '自動車', '定期券'],
    evidenceTerms: ['通勤手当', '通勤方法', '交通費', '公共交通機関', '自転車', '自動車', '定期券', '必要書類'],
    negativeTerms: ['有給', '年休', '扶養手当', '子の看護', '看護休暇', '育成料'],
    fallbackLead: '通勤手当は、通勤方法に応じて必要書類や確認事項が異なります。',
    fallbackBullets: ['公共交通機関・自転車・自動車など、通勤方法ごとに確認します。', '変更がある場合は届出が必要になる場合があります。'],
    followups: ['通勤手当の必要書類は？', '通勤方法を変更したい'],
  },
  {
    id: 'fee',
    label: '料金・減免',
    queryTerms: ['料金', '費用', '利用料', '育成料', '保育料', '減免', '免除', '割引', '安く', '支払い', '月額'],
    evidenceTerms: ['料金', '費用', '利用料', '育成料', '保育料', '減免', '免除', '減額', '兄弟減額', '支払い', '月額'],
    negativeTerms: ['有給', '年休', '扶養手当', '通勤手当', '子の看護', '看護休暇', '就労要件'],
    fallbackLead: '料金・費用は、基本料金・追加料金・減免条件・支払い方法を分けて確認します。',
    fallbackBullets: ['減免や割引は制度ごとの条件により異なります。', '必要書類や申請期限もあわせて確認してください。'],
    followups: ['減免はありますか？', '支払い方法を教えて'],
  },
  {
    id: 'document',
    label: '必要書類',
    queryTerms: ['書類', '証明', '証明書', '添付', '必要なもの', 'いるもの', '提出物', '写真'],
    evidenceTerms: ['書類', '証明書', '添付', '提出', '必要書類', '確認書類', '様式', '資料'],
    negativeTerms: [],
    fallbackLead: '必要書類は、申請内容・対象条件・提出方法により異なります。',
    fallbackBullets: ['まず、どの手続きの書類かを確認してください。', '不足書類がある場合の扱いも確認すると安全です。'],
    followups: ['提出方法を教えて', '不足した場合はどうなりますか？'],
  },
  {
    id: 'procedure',
    label: '手続き・申請',
    queryTerms: ['申請', '申込', '申し込み', '手続', '方法', 'どうしたら', 'どうすれば', '提出', '連絡', '流れ'],
    evidenceTerms: ['申請', '申込', '手続', '提出', '連絡', 'フォーム', '電子申請', '窓口', '郵送', '届出'],
    negativeTerms: [],
    fallbackLead: '手続きは、申請先・提出方法・必要書類・期限を確認するのが基本です。',
    fallbackBullets: ['必要書類と提出期限を確認してください。', '電子申請・窓口・郵送など提出方法を確認してください。'],
    followups: ['必要書類は何ですか？', '期限はいつですか？'],
  },
];

type FaqDomainClassification = {
  profile: FaqDomainProfile | null;
  score: number;
  runnerUpScore: number;
  confident: boolean;
};

function countDomainTerms(text: string, terms: string[]): number {
  return terms.reduce((sum, term) => sum + (text.includes(normalizeForGenericIntent(term)) ? 1 : 0), 0);
}

function classifyFaqDomain(question: string): FaqDomainClassification {
  const q = normalizeForGenericIntent(question);
  const scored = FAQ_DOMAIN_PROFILES.map(profile => ({
    profile,
    score: countDomainTerms(q, profile.queryTerms) * 12 + countDomainTerms(q, profile.evidenceTerms) * 5 - countDomainTerms(q, profile.negativeTerms) * 10,
  })).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const confident = Boolean(top && top.score >= 12 && top.score - Math.max(0, second?.score || 0) >= 5);
  return { profile: confident ? top.profile : null, score: Math.max(0, top?.score || 0), runnerUpScore: Math.max(0, second?.score || 0), confident };
}

function getFaqIntentMetadata(record: SmartFaqRecord): string[] {
  return uniqueSmartLines([
    record.intentId,
    ...(Array.isArray(record.intentIds) ? record.intentIds : []),
    ...(Array.isArray(record.intent) ? record.intent : [record.intent]),
    record.intentLabel,
    record.domain,
    record.domainId,
  ].filter(Boolean).map(String).map(normalizeForGenericIntent));
}

function scoreFaqRecordForDomain(question: string, record: SmartFaqRecord): number {
  const classification = classifyFaqDomain(question);
  if (!classification.profile) return 0;
  const meta = getFaqIntentMetadata(record);
  const profileKeys = [classification.profile.id, classification.profile.label, classification.profile.domain ?? classification.profile.id].map(normalizeForGenericIntent);
  const hasExplicitMatch = meta.some(item => profileKeys.includes(item));
  const hasExplicitMismatch = meta.length > 0 && !hasExplicitMatch;
  const text = normalizeForGenericIntent(`${record.question}
${record.answer}
${record.category}
${record.tags.join(' ')}
${record.sourceText || ''}`);
  const positive = countDomainTerms(text, classification.profile.evidenceTerms);
  const negative = countDomainTerms(text, classification.profile.negativeTerms);
  const directQuestion = countDomainTerms(normalizeForGenericIntent(record.question || ''), classification.profile.evidenceTerms);
  return positive * 14 + directQuestion * 10 - negative * 30 + (hasExplicitMatch ? 90 : 0) - (hasExplicitMismatch ? 110 : 0);
}

function isFaqRecordDomainConsistent(question: string, record: SmartFaqRecord): boolean {
  const classification = classifyFaqDomain(question);
  if (!classification.profile) return true;
  return scoreFaqRecordForDomain(question, record) >= 12;
}

function buildInsufficientEvidenceFaqAnswer(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>): SmartChatMessage {
  const classification = classifyFaqDomain(question);
  const profile = classification.profile;
  const fallback = profile || FAQ_DOMAIN_PROFILES.find(item => item.id === 'procedure');
  const text = [
    fallback?.fallbackLead || '現在のFAQだけでは、断定できる回答を作成できませんでした。',
    '',
    ...(fallback?.fallbackBullets || ['近いFAQはありますが、質問意図と完全に一致しない可能性があります。']).map(line => `・${line}`),
    '・正確性を優先するため、根拠が弱い場合は断定せず、関連候補の確認を促します。',
  ].join('\n');
  return {
    id: `assistant:${Date.now()}`,
    role: 'assistant',
    mode: 'faq',
    text,
    sources: matches.slice(0, 4).map(item => ({ ...smartFaqToDoc(item.record), score: item.score })),
    confidence: 48,
    confidenceLevel: 'insufficient',
    warnings: ['質問意図と一致する根拠FAQが十分ではありません。'],
  };
}

function detectStrictFaqIntent(question: string): {
  isChildCareLeave: boolean;
  isAnnualLeave: boolean;
  isAllowanceIntent: boolean;
  isCommuteIntent: boolean;
  isWorkRequirement: boolean;
  isFeeIntent: boolean;
  isDocumentIntent: boolean;
  isProcedureIntent: boolean;
  isMissedDeadlineIntent: boolean;
  isChangeIntent: boolean;
} {
  const q = normalizeForGenericIntent(question);
  const isMissedDeadlineIntent = /(申請|申込|申し込み|手続|提出|届出|期限|締切|しめきり|期日).*(過ぎ|すぎ|遅れ|間に合わ|忘れ|超過|期限切れ)|((過ぎ|すぎ|遅れ|間に合わ|忘れ|期限切れ).*(申請|申込|申し込み|手続|提出|届出|期限|締切|期日))/.test(q);
  const isChangeIntent = /(変更|変えたい|変える|修正|訂正|間違え|誤り|勤務時間|勤務先|住所|内容変更|変更届)/.test(q)
    && !isMissedDeadlineIntent;
  const isAnnualLeave = /(有給|有休|年休|年次有給|有給休暇|年次休暇|いつから.*使|いつから.*使用|付与.*いつ|取得.*いつ)/.test(q)
    && !/(扶養|扶養手当|通勤手当|交通費|子の看護|看護休暇|忌引|育成料|減免)/.test(q);
  const isAllowanceIntent = /(扶養手当|扶養対象|扶養|配偶者|被扶養|続柄|同居|別居)/.test(q)
    && !/(有給|有休|年休|年次有給|通勤手当|子の看護|看護休暇)/.test(q);
  const isCommuteIntent = /(通勤手当|交通費|通勤方法|公共交通|自転車|自動車|定期券)/.test(q)
    && !/(有給|有休|年休|扶養手当|子の看護|看護休暇)/.test(q);
  const isChildCareLeave = /(子供|子ども|こども|子|児童|子の看護|看護|発熱|熱|病気|体調不良|休みたい|休む|休暇|欠勤|休ませ)/.test(q)
    && !/(料金|費用|育成料|利用料|保育料|減免|免除|割引|安く|支払い|月額|有給|年休|扶養手当|通勤手当)/.test(q);
  const isWorkRequirement = !isChildCareLeave && !isAnnualLeave && /(就労要件|就労条件|勤務終了時間|午後4時|16時|週3日|3か月|働|勤務.*条件|仕事.*条件)/.test(q);
  return {
    isChildCareLeave,
    isAnnualLeave,
    isAllowanceIntent,
    isCommuteIntent,
    isWorkRequirement,
    isFeeIntent: /(料金|費用|育成料|利用料|保育料|減免|免除|割引|安く|支払い|月額)/.test(q),
    isDocumentIntent: /(書類|証明|証明書|添付|必要なもの|いるもの|提出物)/.test(q),
    isProcedureIntent: /(申請|申込|申し込み|手続|方法|どうしたら|どうすれば|提出|連絡)/.test(q),
    isMissedDeadlineIntent,
    isChangeIntent,
  };
}

function scoreFaqRecordForStrictIntent(question: string, record: SmartFaqRecord, baseScore = 0): number {
  const intent = detectStrictFaqIntent(question);
  const text = normalizeForGenericIntent(`${record.question}\n${record.answer}\n${record.category}\n${record.tags.join(' ')}\n${record.sourceText || ''}`);
  let score = baseScore + scoreFaqRecordForDomain(question, record);
  if (intent.isMissedDeadlineIntent) {
    if (/(期限|締切|期日|受付期間|申請期限|提出期限|過ぎ|遅れ|間に合わ|期限後|再申請|随時受付|担当窓口|問い合わせ)/.test(text)) score += 70;
    if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|就労要件|勤務終了時間|年次有給|育成料|減免)/.test(text)) score -= 85;
  }
  if (intent.isChangeIntent) {
    if (/(変更|変更届|修正|訂正|勤務時間|勤務先|住所変更|内容変更|事前承認|届出|反映時期)/.test(text)) score += 62;
    if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|年次有給|育成料|減免)/.test(text)) score -= 70;
  }
  if (intent.isAnnualLeave) {
    if (/(有給|有休|年休|年次有給|有給休暇|年次休暇)/.test(text)) score += 58;
    if (/(付与|取得|使用|使える|いつから|採用日|勤務条件|継続勤務|付与日数)/.test(text)) score += 34;
    if (/(扶養手当|扶養対象|収入状況|通勤手当|通勤方法|交通費|公共交通|子の看護|看護休暇|忌引|服喪|育成料|減免|就労要件|就労条件)/.test(text)) score -= 90;
  }
  if (intent.isAllowanceIntent) {
    if (/(扶養手当|扶養対象|収入状況|続柄|同居|別居|届出書)/.test(text)) score += 48;
    if (/(有給|年休|通勤手当|子の看護|看護休暇|育成料)/.test(text)) score -= 72;
  }
  if (intent.isCommuteIntent) {
    if (/(通勤手当|通勤方法|交通費|公共交通機関|自転車|自動車|定期券|必要書類)/.test(text)) score += 48;
    if (/(有給|年休|扶養手当|子の看護|看護休暇|育成料)/.test(text)) score -= 72;
  }
  if (intent.isWorkRequirement) {
    if (/(就労要件|就労条件|勤務終了時間|勤務日数|勤務期間|週3日|3か月|午後4時|16時|通勤時間)/.test(text)) score += 42;
    if (/(有給|年休|扶養手当|通勤手当|子の看護|看護休暇|育成料)/.test(text)) score -= 60;
  }
  if (intent.isChildCareLeave) {
    if (/(子の看護|看護休暇|子どもの看護|子供の看護|発熱|熱|病気|休暇|休む|所属へ連絡|後から必要書類|証明書類)/.test(text)) score += 45;
    if (/(休暇|勤務条件|人事|労務|看護)/.test(text)) score += 16;
    if (/(料金|費用|育成料|利用料|保育料|減免|免除|兄弟|割引|支払い|月額|扶養手当|通勤手当|就労要件)/.test(text)) score -= 70;
    if (/(電子申請|logoフォーム|減額|減免申請)/.test(text)) score -= 35;
  }
  if (intent.isFeeIntent && /(料金|費用|育成料|利用料|保育料|減免|免除|兄弟|割引|支払い|月額)/.test(text)) score += 24;
  if (intent.isDocumentIntent && /(書類|証明|証明書|添付|提出物|必要書類)/.test(text)) score += 18;
  if (intent.isProcedureIntent && /(申請|申込|手続|提出|連絡|方法|流れ)/.test(text)) score += 14;
  return Math.max(0, Math.min(100, Math.round(score)));
}


function isStrictlyRelevantFaqRecord(question: string, record: SmartFaqRecord): boolean {
  const intent = detectStrictFaqIntent(question);
  const text = normalizeForGenericIntent(`${record.question}\n${record.answer}\n${record.category}\n${record.tags.join(' ')}\n${record.sourceText || ''}`);
  if (intent.isMissedDeadlineIntent) {
    return /(期限|締切|期日|受付期間|申請期限|提出期限|過ぎ|遅れ|間に合わ|期限後|再申請|随時受付|担当窓口|問い合わせ)/.test(text)
      && !/(子の看護|看護休暇|発熱|扶養手当|通勤手当|就労要件|勤務終了時間|年次有給|有給休暇|育成料|減免)/.test(text);
  }
  if (intent.isChangeIntent) {
    return /(変更|変更届|修正|訂正|勤務時間|勤務先|住所変更|内容変更|事前承認|届出|反映時期)/.test(text)
      && !/(子の看護|看護休暇|発熱|扶養手当|通勤手当|年次有給|育成料|減免)/.test(text);
  }
  if (intent.isAnnualLeave) {
    return /(有給|有休|年休|年次有給|有給休暇|年次休暇|付与|取得|使用|採用日)/.test(text)
      && !/(扶養手当|扶養対象|通勤手当|通勤方法|交通費|子の看護|看護休暇|忌引|育成料|減免|就労要件)/.test(text);
  }
  if (intent.isAllowanceIntent) {
    return /(扶養手当|扶養対象|収入状況|続柄|同居|別居|届出書)/.test(text)
      && !/(有給|年休|通勤手当|子の看護|看護休暇)/.test(text);
  }
  if (intent.isCommuteIntent) {
    return /(通勤手当|通勤方法|交通費|公共交通機関|自転車|自動車|定期券)/.test(text)
      && !/(有給|年休|扶養手当|子の看護|看護休暇)/.test(text);
  }
  if (intent.isWorkRequirement) {
    return /(就労要件|就労条件|勤務終了時間|勤務日数|勤務期間|週3日|3か月|午後4時|16時|通勤時間)/.test(text)
      && !/(有給|年休|扶養手当|通勤手当|子の看護|看護休暇|育成料)/.test(text);
  }
  if (intent.isChildCareLeave) {
    return /(子の看護|看護休暇|子どもの看護|子供の看護|子供|子ども|こども|発熱|熱|病気|体調不良)/.test(text)
      && !/(育成料|利用料|保育料|減免申請|減額・免除|兄弟減額|料金|費用|月額|扶養手当|通勤手当|就労要件)/.test(text);
  }
  if (intent.isFeeIntent) return /(料金|費用|育成料|利用料|保育料|減免|免除|兄弟|割引|支払い|月額)/.test(text);
  if (intent.isDocumentIntent) return /(書類|証明|証明書|添付|提出物|必要書類)/.test(text);
  return true;
}

function isHardStrictFaqIntent(question: string): boolean {
  const intent = detectStrictFaqIntent(question);
  return Boolean(
    intent.isMissedDeadlineIntent
    || intent.isAnnualLeave
    || intent.isChildCareLeave
    || intent.isAllowanceIntent
    || intent.isCommuteIntent
    || intent.isWorkRequirement
    || intent.isFeeIntent
  );
}

function filterMatchesByStrictIntent(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>) {
  const classification = classifyFaqDomain(question);
  const domainConsistent = classification.confident
    ? matches.filter(item => isFaqRecordDomainConsistent(question, item.record))
    : matches;
  const strict = domainConsistent.filter(item => isStrictlyRelevantFaqRecord(question, item.record));

  // 正確性優先: 明確な分野意図がある質問では、該当分野FAQが無ければ
  // 別分野FAQで無理に回答しない。フォールバック回答へ回す。
  if (isHardStrictFaqIntent(question) && strict.length === 0) return [];

  const selected = strict.length ? strict : domainConsistent;
  return selected
    .map(item => ({ ...item, score: Math.max(0, Math.min(100, item.score + scoreFaqRecordForStrictIntent(question, item.record, 0) / 5)) }))
    .sort((a, b) => b.score - a.score);
}

function cleanGeneratedAnswerLines(question: string, lines: string[]): string[] {
  const strict = detectStrictFaqIntent(question);
  const seen = new Set<string>();
  return lines
    .map(line => line.replace(/^[-・\s]+/, '').trim())
    .filter(Boolean)
    .filter(line => {
      const normalized = normalizeForGenericIntent(line);
      const domain = classifyFaqDomain(question).profile;
      if (domain) {
        const pos = countDomainTerms(normalized, domain.evidenceTerms);
        const neg = countDomainTerms(normalized, domain.negativeTerms);
        if (neg > 0 && pos === 0) return false;
      }
      if (strict.isMissedDeadlineIntent) {
        if (/(子の看護|看護休暇|発熱|熱|病気|扶養手当|扶養対象|通勤手当|通勤方法|交通費|就労要件|就労条件|勤務終了時間|週3日|3か月|年次有給|有給休暇|育成料|保育料|減免|免除)/.test(normalized)) return false;
      }
      if (strict.isChangeIntent) {
        if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|年次有給|有給休暇|育成料|保育料|減免|免除)/.test(normalized)) return false;
      }
      if (strict.isAnnualLeave) {
        if (/(扶養手当|扶養対象|収入状況|続柄|同居|別居|通勤手当|通勤方法|交通費|公共交通|子の看護|看護休暇|発熱|忌引|服喪|育成料|保育料|減免|免除|兄弟減額|就労要件|就労条件|勤務終了時間|週3日|3か月|午後4時|16時)/.test(normalized)) return false;
      }
      if (strict.isAllowanceIntent) {
        if (/(有給|有休|年休|年次有給|通勤手当|子の看護|看護休暇|育成料|保育料|減免)/.test(normalized)) return false;
      }
      if (strict.isCommuteIntent) {
        if (/(有給|有休|年休|年次有給|扶養手当|子の看護|看護休暇|育成料|保育料|減免)/.test(normalized)) return false;
      }
      if (strict.isWorkRequirement) {
        if (/(有給|有休|年休|年次有給|扶養手当|通勤手当|子の看護|看護休暇|育成料|保育料|減免)/.test(normalized)) return false;
      }
      if (strict.isChildCareLeave) {
        if (/(年次有給|年休|有給休暇|忌引|服喪|育成料|保育料|減免|免除|兄弟減額|料金|費用|就労要件|就労条件|勤務終了時間|勤務日数|勤務期間|週3日|3か月|午後4時|16時|通勤時間|扶養手当|通勤手当)/.test(normalized)) return false;
      }
      const key = normalized.replace(/[\s、。]/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, strict.isChildCareLeave ? 3 : 5);
}

function detectGenericFaqProfiles(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>): GenericFaqIntentProfile[] {
  const q = normalizeForGenericIntent(`${question}\n${matches.slice(0, 3).map(item => `${item.record.question} ${item.record.category} ${item.record.tags.join(' ')}`).join('\n')}`);
  const scored = GENERIC_FAQ_INTENT_PROFILES.map(profile => {
    const queryHits = profile.queryTerms.filter(term => q.includes(normalizeForGenericIntent(term))).length;
    const topAnswerText = normalizeForGenericIntent(matches.slice(0, 4).map(item => `${item.record.question} ${item.record.answer} ${item.record.category} ${item.record.tags.join(' ')}`).join('\n'));
    const answerHits = profile.answerTerms.filter(term => topAnswerText.includes(normalizeForGenericIntent(term))).length;
    return { profile, score: queryHits * 10 + answerHits * 2 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  return (scored.length ? scored : [{ profile: GENERIC_FAQ_INTENT_PROFILES[7], score: 1 }]).slice(0, 3).map(item => item.profile);
}

function scoreSentenceForGenericProfiles(sentence: string, question: string, profiles: GenericFaqIntentProfile[]): number {
  const s = normalizeForGenericIntent(sentence);
  const q = normalizeForGenericIntent(question);
  const strict = detectStrictFaqIntent(question);
  let score = 0;
  if (strict.isMissedDeadlineIntent) {
    if (/(期限|締切|期日|受付期間|申請期限|提出期限|過ぎ|遅れ|間に合わ|期限後|再申請|随時受付|担当窓口|問い合わせ|確認)/.test(s)) score += 70;
    if (/(子の看護|看護休暇|発熱|熱|病気|扶養手当|通勤手当|就労要件|勤務終了時間|年次有給|有給休暇|育成料|減免)/.test(s)) score -= 95;
  }
  if (strict.isChangeIntent) {
    if (/(変更|変更届|修正|訂正|勤務時間|勤務先|住所変更|内容変更|事前承認|届出|反映時期|確認)/.test(s)) score += 58;
    if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|年次有給|育成料|減免)/.test(s)) score -= 82;
  }
  if (strict.isAnnualLeave) {
    if (/(有給|有休|年休|年次有給|有給休暇|年次休暇|付与|取得|使用|使える|いつから|採用日|勤務条件|継続勤務)/.test(s)) score += 52;
    if (/(扶養手当|扶養対象|通勤手当|通勤方法|交通費|子の看護|看護休暇|忌引|育成料|減免|就労要件)/.test(s)) score -= 90;
  }
  if (strict.isAllowanceIntent) {
    if (/(扶養手当|扶養対象|収入状況|続柄|同居|別居|届出書)/.test(s)) score += 44;
    if (/(有給|年休|通勤手当|子の看護|看護休暇)/.test(s)) score -= 80;
  }
  if (strict.isCommuteIntent) {
    if (/(通勤手当|通勤方法|交通費|公共交通機関|自転車|自動車|定期券)/.test(s)) score += 44;
    if (/(有給|年休|扶養手当|子の看護|看護休暇)/.test(s)) score -= 80;
  }
  if (strict.isWorkRequirement) {
    if (/(就労要件|就労条件|勤務終了時間|勤務日数|勤務期間|週3日|3か月|午後4時|16時|通勤時間)/.test(s)) score += 44;
    if (/(有給|年休|扶養手当|通勤手当|子の看護|看護休暇)/.test(s)) score -= 80;
  }
  if (strict.isChildCareLeave) {
    if (/(子の看護|看護休暇|子どもの看護|子供の看護|発熱|熱|病気|休暇|休む|所属へ連絡|後から必要書類|証明書類)/.test(s)) score += 42;
    if (/(料金|費用|育成料|利用料|保育料|減免|免除|兄弟|割引|支払い|月額|減額|扶養手当|通勤手当|就労要件)/.test(s)) score -= 80;
  }
  for (const token of q.split(/\s+/).filter(token => token.length >= 2)) {
    if (s.includes(token)) score += 3;
  }
  for (const profile of profiles) {
    for (const term of profile.answerTerms) {
      if (s.includes(normalizeForGenericIntent(term))) score += 6;
    }
  }
  if (/概要|目的|事業です|について説明/.test(s) && !profiles.some(profile => profile.id === 'definition')) score -= 10;
  if (/必要|確認|対象|条件|申請|提出|期限|書類|料金|変更|問い合わせ/.test(s)) score += 3;
  return score;
}

function buildGenericFaqGeneratedAnswer(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>): { lead: string; bullets: string[]; followups: string[]; caveat?: string } {
  const profiles = detectGenericFaqProfiles(question, matches);
  const rawSentences = matches.flatMap(item => extractFaqSentences(item.record).map(sentence => ({ sentence, score: item.score, record: item.record })));
  const rankedSentences = cleanGeneratedAnswerLines(question, uniqueSmartLines(rawSentences
    .sort((a, b) => (scoreSentenceForGenericProfiles(b.sentence, question, profiles) + b.score / 25) - (scoreSentenceForGenericProfiles(a.sentence, question, profiles) + a.score / 25))
    .map(item => item.sentence))
    .filter(line => line.length >= 8)
    .slice(0, 10));

  const lead = rankedSentences[0] || profiles[0]?.genericFallback || '関連FAQをもとに整理します。';
  const bullets = uniqueSmartLines(rankedSentences.slice(1)).slice(0, 4);
  const followups = uniqueSmartLines(profiles.flatMap(profile => profile.followups)).slice(0, 4);
  const closeScores = matches.slice(0, 3).map(item => item.score);
  const caveat = closeScores.length >= 2 && Math.max(...closeScores) - Math.min(...closeScores) <= 8
    ? `近い候補が複数あります。${profiles.map(profile => profile.label).join('・')}のどれを知りたいか追加するとさらに絞れます。`
    : undefined;
  return { lead, bullets, followups, caveat };
}
function extractFaqSentences(record: SmartFaqRecord | undefined): string[] {
  if (!record) return [];
  return uniqueSmartLines(String(record.answer || '')
    .split(/(?<=[。！？!?])|\n+/)
    .map(line => line.replace(/^[-・\s]+/, '').trim())
    .filter(line => line.length >= 8));
}

function collectBestFaqPoints(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>): string[] {
  const intent = analyzeFaqAnswerIntent(question, matches[0]?.record);
  const pool = matches.flatMap(item => extractFaqSentences(item.record).map(sentence => ({ sentence, record: item.record, score: item.score })));
  const normQ = normalizeSmartChatText(question);
  const priority = (sentence: string): number => {
    const s = normalizeSmartChatText(sentence);
    let score = 0;
    for (const term of normQ.split(/\s+/).filter(Boolean)) if (term.length >= 2 && s.includes(term)) score += 3;
    const strict = detectStrictFaqIntent(question);
    if (strict.isMissedDeadlineIntent) {
      if (/(期限|締切|期日|受付期間|申請期限|提出期限|過ぎ|遅れ|間に合わ|期限後|再申請|随時受付|担当窓口|問い合わせ)/.test(s)) score += 55;
      if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|就労要件|年次有給|育成料|減免)/.test(s)) score -= 90;
    }
    if (strict.isChangeIntent) {
      if (/(変更|変更届|修正|訂正|勤務時間|勤務先|住所変更|内容変更|事前承認|届出|反映時期)/.test(s)) score += 48;
      if (/(子の看護|看護休暇|発熱|扶養手当|通勤手当|年次有給|育成料|減免)/.test(s)) score -= 75;
    }
    if (strict.isAnnualLeave) {
      if (/(有給|有休|年休|年次有給|有給休暇|年次休暇|付与|取得|使用|使える|いつから|採用日|勤務条件|継続勤務)/.test(s)) score += 40;
      if (/(扶養手当|扶養対象|通勤手当|通勤方法|交通費|子の看護|看護休暇|忌引|育成料|減免|就労要件)/.test(s)) score -= 70;
    }
    if (intent.needsCondition && !strict.isAnnualLeave && /(要件|条件|対象|勤務|就労|週3日|3か月|午後4時|16時|通勤)/.test(s)) score += 18;
    if (intent.needsProcedure && /(申請|申込|申し込み|手続|提出|電子申請|logo|フォーム)/i.test(s)) score += 16;
    if (intent.needsDocument && /(書類|証明書|添付|シフト|自営業|内職|写真)/.test(s)) score += 16;
    if (intent.needsFee && /(育成料|利用料|料金|減額|免除|減免|兄弟)/.test(s)) score += 16;
    if (intent.needsDeadline && /(期限|2週間|二週間|いつまで|開始希望日|随時)/.test(s)) score += 14;
    if (intent.needsAvailability && /(空き|待機|定員|入会可否)/.test(s)) score += 14;
    if (/(概要|目的|キッズスクエア|事業です)/.test(s) && intent.labels.some(label => label !== '関連情報')) score -= 12;
    return score;
  };
  return cleanGeneratedAnswerLines(question, uniqueSmartLines(pool
    .sort((a, b) => (priority(b.sentence) + b.score / 20) - (priority(a.sentence) + a.score / 20))
    .map(item => item.sentence))
    .slice(0, 8));
}

function buildBestEffortFaqAnswer(question: string, matches: Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>): { lead: string; bullets: string[]; followups: string[]; caveat?: string } {
  const gatedMatches = filterMatchesByStrictIntent(question, matches);
  const generic = buildGenericFaqGeneratedAnswer(question, gatedMatches);
  const top = gatedMatches[0]?.record;
  const personalized = top ? buildPersonalizedFaqAnswer(question, top) : { lead: '', bullets: [], followups: [] };
  const bestPoints = collectBestFaqPoints(question, gatedMatches);

  const candidateLines = cleanGeneratedAnswerLines(question, uniqueSmartLines([
    generic.lead,
    personalized.lead,
    ...generic.bullets,
    ...personalized.bullets,
    ...bestPoints,
  ].filter(Boolean)));

  const profiles = detectGenericFaqProfiles(question, matches);
  const lead = candidateLines
    .sort((a, b) => scoreSentenceForGenericProfiles(b, question, profiles) - scoreSentenceForGenericProfiles(a, question, profiles))[0]
    || generic.lead
    || personalized.lead
    || '関連FAQをもとに整理します。';

  const bullets = uniqueSmartLines(candidateLines.filter(line => line !== lead))
    .sort((a, b) => scoreSentenceForGenericProfiles(b, question, profiles) - scoreSentenceForGenericProfiles(a, question, profiles))
    .slice(0, 5);

  const followups = uniqueSmartLines([
    ...generic.followups,
    ...personalized.followups,
  ].filter(Boolean)).slice(0, 4);

  return {
    lead,
    bullets,
    followups,
    caveat: generic.caveat,
  };
}

function calibrateFaqConfidence(matches: Array<{ record: SmartFaqRecord; score: number }>, answer: { bullets: string[]; caveat?: string }, question = ''): { confidence: number; level: SmartAnswerConfidenceLevel } {
  const topScore = Math.max(0, Math.min(100, Number(matches[0]?.score || matches[0]?.record?.confidence || 0)));
  const secondScore = Math.max(0, Math.min(100, Number(matches[1]?.score || 0)));
  const margin = topScore - secondScore;
  let confidence = topScore;
  if (question) {
    const classification = classifyFaqDomain(question);
    const domainScore = matches[0]?.record ? scoreFaqRecordForDomain(question, matches[0].record) : 0;
    if (classification.confident && domainScore < 12) confidence = Math.min(confidence, 58);
  }
  if (matches.length >= 2 && margin < 8) confidence -= 6;
  if (answer.bullets.length >= 3) confidence += 4;
  if (answer.caveat) confidence -= 4;
  confidence = Math.max(30, Math.min(97, Math.round(confidence)));
  return { confidence, level: confidenceLevelFromFaqScore(confidence) };
}


function composeSmartAssistChatAnswer(question: string, result: any): SmartChatMessage | null {
  const answer = String(result?.answer || '').trim();
  if (!answer) return null;

  const confidence = Math.max(0, Math.min(100, Number(result?.confidence || 0)));
  const confidenceLevel = confidenceLevelFromFaqScore(confidence);
  const sourceTitle = String(result?.matchedFaqTitle || result?.sources?.[0]?.title || 'FAQ');
  const sourceDoc: SmartDoc = buildSmartDocIndex({
    id: `faq-record:${String(result?.matchedFaqId || result?.id || 'smart-assist')}`,
    kind: 'faq',
    title: sourceTitle.startsWith('❓') ? sourceTitle : `❓ ${sourceTitle}`,
    body: [`FAQ`, `回答: ${answer}`, result?.intent ? `Intent: ${result.intent}` : '', result?.faqScore ? `FAQ Score: ${result.faqScore}` : ''].filter(Boolean).join('\n'),
    tags: ['FAQ', result?.intent, result?.confidenceLabel].filter(Boolean).map(String),
    sourceId: String(result?.matchedFaqId || result?.id || 'smart-assist'),
  });

  const followUps = Array.isArray(result?.followUpQuestions)
    ? result.followUpQuestions.map(String).filter(Boolean).slice(0, 4)
    : [];
  const suggestedActions = Array.isArray(result?.suggestedActions)
    ? result.suggestedActions.map(String).filter(Boolean).slice(0, 6)
    : [];
  const nextQuestions = Array.isArray(result?.nextQuestions)
    ? result.nextQuestions.map(String).filter(Boolean).slice(0, 6)
    : [];
  const clarificationChips = Array.isArray(result?.clarificationChips)
    ? result.clarificationChips.map(String).filter(Boolean).slice(0, 6)
    : [];
  const selectionReasons = Array.isArray(result?.reasons)
    ? result.reasons.map(String).filter(Boolean).slice(0, 6)
    : [];
  const matchedTerms = Array.isArray(result?.matchedTerms)
    ? result.matchedTerms.map(String).filter(Boolean).slice(0, 10)
    : [];
  const candidateFaqs = Array.isArray(result?.candidates)
    ? result.candidates.map((item: any) => ({
      id: String(item?.id || ''),
      question: String(item?.question || '').trim(),
      category: String(item?.category || '').trim(),
      score: Number.isFinite(Number(item?.score)) ? Math.round(Number(item.score)) : undefined,
      reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean).slice(0, 3) : [],
    })).filter((item: any) => item.question).slice(0, 4)
    : [];
  const shouldAvoidAssertion = confidence < 70 || confidenceLevel === 'low' || confidenceLevel === 'insufficient';
  const text = shouldAvoidAssertion
    ? [`このFAQが近い候補ですが、完全一致とは断定していません。`, '', answer].join('\n')
    : answer;

  return {
    id: `assistant:${Date.now()}`,
    role: 'assistant',
    mode: 'faq',
    text,
    sources: [sourceDoc],
    confidence,
    confidenceLevel,
    warnings: shouldAvoidAssertion
      ? ['低〜中信頼度のため、断定せず候補として表示しています。']
      : [],
    followUpQuestions: followUps,
    suggestedActions,
    nextQuestions,
    clarificationChips,
    selectionReasons,
    matchedTerms,
    candidateFaqs,
    uxLevel: result?.uxLevel,
    answerPolicy: result?.answerPolicy,
    matchedFaqId: String(result?.matchedFaqId || result?.id || ''),
    matchedFaqTitle: sourceTitle,
  };
}


function workspaceSourceKeyFromResult(item: any): string {
  const chunk = item?.chunk || item || {};
  return `${chunk.type || 'unknown'}:${chunk.databaseId || ''}:${chunk.rowId || chunk.sourceId || chunk.id || ''}`;
}

function workspaceSourceKeyFromDoc(source: SmartDoc): string {
  if (source.sourceKey) return source.sourceKey;
  const rawType = source.kind === 'row' ? 'database_row' : source.kind;
  return `${rawType || 'unknown'}:${source.databaseId || ''}:${source.rowId || source.sourceId || source.id || ''}`;
}

function compactWorkspaceSourceItem(item: any): any | null {
  const chunk = item?.chunk || {};
  const sourceKey = workspaceSourceKeyFromResult(item);
  if (!sourceKey || !chunk) return null;
  return {
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : 0,
    reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean).slice(0, 6) : [],
    chunk: {
      id: chunk.id ? String(chunk.id) : undefined,
      type: chunk.type ? String(chunk.type) : 'unknown',
      sourceId: chunk.sourceId ? String(chunk.sourceId) : undefined,
      databaseId: chunk.databaseId ? String(chunk.databaseId) : undefined,
      rowId: chunk.rowId ? String(chunk.rowId) : undefined,
      databaseTitle: chunk.databaseTitle ? String(chunk.databaseTitle) : undefined,
      rowTitle: chunk.rowTitle ? String(chunk.rowTitle) : undefined,
      propertySummary: chunk.propertySummary ? String(chunk.propertySummary).slice(0, 1800) : undefined,
      title: chunk.title ? String(chunk.title) : '参照元',
      text: chunk.text ? String(chunk.text).slice(0, 4000) : '',
      semanticMetaText: chunk.semanticMetaText ? String(chunk.semanticMetaText).slice(0, 1200) : '',
      tags: Array.isArray(chunk.tags) ? chunk.tags.map(String).filter(Boolean).slice(0, 12) : [],
      updatedAt: chunk.updatedAt ? String(chunk.updatedAt) : undefined,
    },
  };
}

function workspaceAiConfidenceFromResult(result: any, rawResults: any[]): { confidence: number; confidenceLevel: SmartAnswerConfidenceLevel } {
  const groundingConfidence = String(result?.grounding?.confidence || '').trim();
  const topScore = rawResults.length && Number.isFinite(Number(rawResults[0]?.score)) ? Math.round(Number(rawResults[0].score)) : 0;
  let confidence = 0;
  if (groundingConfidence === 'high') confidence = Math.max(topScore, 86);
  else if (groundingConfidence === 'medium') confidence = Math.max(topScore, 68);
  else if (groundingConfidence === 'low') confidence = Math.max(topScore, 42);
  else if (groundingConfidence === 'none') confidence = Math.min(topScore, 25);
  else if (rawResults.length) confidence = Math.max(38, Math.min(82, topScore));
  else if (result?.warning || result?.clarificationNeeded) confidence = 25;
  else confidence = 0;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));
  return { confidence, confidenceLevel: confidenceLevelFromFaqScore(confidence) };
}

function composeWorkspaceAiChatAnswer(question: string, result: any): SmartChatMessage | null {
  const answer = String(result?.answer || '').trim();
  if (!answer) return null;

  const rawResults = Array.isArray(result?.results) ? result.results : [];
  const compactSourceItems = rawResults.map(compactWorkspaceSourceItem).filter(Boolean).slice(0, 8);
  const sourceDocs: SmartDoc[] = rawResults
    .map((item: any) => {
      const chunk = item?.chunk || {};
      const rawType = String(chunk.type || '').trim();
      const sourceKey = workspaceSourceKeyFromResult(item);
      const kind: SmartDocKind = rawType === 'faq'
        ? 'faq'
        : rawType === 'database_row'
          ? 'row'
          : rawType === 'journal'
            ? 'journal'
            : 'page';
      const databaseTitle = String(chunk.databaseTitle || '').trim();
      const rowTitle = String(chunk.rowTitle || '').trim();
      const rawTitle = String(chunk.title || chunk.sourceId || chunk.id || '参照元').trim();
      const title = rawType === 'database_row'
        ? [databaseTitle, rowTitle || rawTitle].filter(Boolean).join(' / ') || rawTitle
        : rawTitle;
      const sourceId = String(chunk.sourceId || chunk.id || '').trim();
      const propertySummary = String(chunk.propertySummary || '').trim();
      const body = [
        rawType ? `種類: ${rawType}` : '',
        rawType === 'database_row' && databaseTitle ? `データベース: ${databaseTitle}` : '',
        rawType === 'database_row' && rowTitle ? `行: ${rowTitle}` : '',
        propertySummary ? `主要プロパティ: ${propertySummary.slice(0, 1200)}` : '',
        chunk.text ? `本文: ${String(chunk.text).slice(0, rawType === 'database_row' ? 2000 : 1600)}` : '',
        chunk.semanticMetaText ? `メタ: ${String(chunk.semanticMetaText).slice(0, 700)}` : '',
      ].filter(Boolean).join('\n');
      return buildSmartDocIndex({
        id: `workspace-ai:${rawType || 'source'}:${sourceId || chunk.id || Math.random().toString(36).slice(2)}`,
        kind,
        title: kind === 'faq' && !title.startsWith('❓') ? `❓ ${title}` : title,
        body,
        tags: ['Workspace AI', rawType, databaseTitle, ...(Array.isArray(chunk.tags) ? chunk.tags : [])].filter(Boolean).map(String).slice(0, 12),
        sourceId,
        databaseId: chunk.databaseId ? String(chunk.databaseId) : undefined,
        rowId: chunk.rowId ? String(chunk.rowId) : undefined,
        databaseTitle: databaseTitle || undefined,
        rowTitle: rowTitle || undefined,
        propertySummary: propertySummary || undefined,
        sourceKey,
        score: Number.isFinite(Number(item?.score)) ? Math.round(Number(item.score)) : undefined,
        reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean).slice(0, 4) : [],
      });
    })
    .filter((doc: SmartDoc) => doc.title)
    .slice(0, 8);

  const { confidence, confidenceLevel } = workspaceAiConfidenceFromResult(result, rawResults);
  const planIntent = String(result?.answerPlan?.intent || '').trim();
  const mode: SmartChatMessage['mode'] = planIntent === 'procedure'
    ? 'procedure'
    : planIntent === 'compare'
      ? 'compare'
      : planIntent === 'page_summary'
        ? 'summary'
        : planIntent === 'faq'
          ? 'faq'
          : 'answer';

  const warnings = [
    result?.warning ? String(result.warning) : '',
    rawResults.length ? '' : '根拠候補が見つからないため、断定回答を避けています。',
    result?.answerVerification?.quality === 'review' ? '回答検証で要確認の項目を検出しました。根拠欄も確認してください。' : '',
  ].filter(Boolean);

  const nextQuestions = Array.isArray(result?.suggestions)
    ? result.suggestions.map(String).filter(Boolean).slice(0, 6)
    : [];

  const dbFilterReasons = Array.isArray(result?.grounding?.dbFilter?.topReasons)
    ? result.grounding.dbFilter.topReasons.map(String).filter(Boolean).slice(0, 6)
    : [];
  const selectionReasons = [
    ...(Array.isArray(result?.grounding?.notes) ? result.grounding.notes.map(String).filter(Boolean).slice(0, 6) : []),
    ...(result?.grounding?.dbFilter?.used ? [`DB条件抽出を使用: ${dbFilterReasons.slice(0, 3).join(' / ') || '自然言語条件'}`] : []),
  ].filter(Boolean).slice(0, 8);

  return {
    id: `assistant:${Date.now()}`,
    role: 'assistant',
    mode,
    text: answer,
    sources: sourceDocs,
    relatedEvidence: normalizeSmartRelatedEvidence({ results: rawResults }),
    confidence,
    confidenceLevel,
    warnings,
    nextQuestions,
    selectionReasons,
    answerPolicy: result?.generated ? '生成AI: 検索結果を根拠に回答を生成' : '検索結果ベース回答',
    engine: 'workspace-ai',
    workspaceSourceItems: compactSourceItems,
    sourceMode: result?.grounding?.sourceMode === 'pinned_only' ? 'pinned_only' : 'auto',
    answerStatus: {
      generated: Boolean(result?.generated),
      planLabel: String(result?.answerPlan?.label || result?.answerPlan?.intent || '').trim() || undefined,
      templateLabel: String(result?.answerTemplate?.label || result?.answerTemplate?.id || '').trim() || undefined,
      sourceMode: result?.grounding?.sourceMode === 'pinned_only' ? 'pinned_only' : 'auto',
      sourceCount: rawResults.length,
      verificationLabel: String(result?.answerVerification?.label || result?.answerVerification?.quality || '').trim() || undefined,
      elapsedMs: Number.isFinite(Number(result?.elapsedMs)) ? Number(result.elapsedMs) : undefined,
      warning: result?.warning ? String(result.warning) : undefined,
      dbFilterUsed: Boolean(result?.grounding?.dbFilter?.used),
      dbFilterCount: Number.isFinite(Number(result?.grounding?.dbFilter?.count)) ? Number(result.grounding.dbFilter.count) : undefined,
      dbFilterReasons,
    },
  };
}

function composeServerFaqSearchAnswer(question: string, result: any): SmartChatMessage | null {
  const rawItems = Array.isArray(result?.items) ? result.items : [];
  const matches = rawItems
    .map((item: any) => {
      const record = normalizeServerFaqRecord(item?.record || item);
      const baseScore = Math.max(0, Math.min(100, Number(item?.score || item?.record?.confidence || 0)));
      const score = record ? scoreFaqRecordForStrictIntent(question, record, baseScore) : baseScore;
      return {
        record,
        score,
        reasons: Array.isArray(item?.reasons) ? item.reasons.map(String).filter(Boolean) : [],
        matchedTerms: Array.isArray(item?.matchedTerms) ? item.matchedTerms.map(String).filter(Boolean) : [],
        confidenceLabel: String(item?.confidenceLabel || ''),
      };
    })
    .filter((item: { record: SmartFaqRecord | null; score: number }) => item.record && item.score >= 20)
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .slice(0, 8) as Array<{ record: SmartFaqRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel: string }>;

  const focusedMatches = filterMatchesByStrictIntent(question, matches).slice(0, 4);
  if (!focusedMatches.length) {
    const classification = classifyFaqDomain(question);
    if (classification.confident && matches.length) return buildInsufficientEvidenceFaqAnswer(question, matches);
    return null;
  }

  const classification = classifyFaqDomain(question);
  const topDomainScore = scoreFaqRecordForDomain(question, focusedMatches[0].record);
  if (classification.confident && topDomainScore < 12) return buildInsufficientEvidenceFaqAnswer(question, matches);

  const top = focusedMatches[0];
  const sources = focusedMatches.map(item => ({ ...smartFaqToDoc(item.record), score: item.score }));
  const bestAnswer = buildBestEffortFaqAnswer(question, focusedMatches);
  const calibrated = calibrateFaqConfidence(focusedMatches, bestAnswer, question);
  const confidence = calibrated.confidence;
  const confidenceLevel = calibrated.level;
  const intent = analyzeFaqAnswerIntent(question, top.record);
  const answerLines = cleanGeneratedAnswerLines(question, uniqueSmartLines([
    bestAnswer.lead,
    ...bestAnswer.bullets.filter((line) => line && line !== bestAnswer.lead),
  ].filter(Boolean)));

  const sections = answerLines.length
    ? [answerLines[0], ...(answerLines.length > 1 ? ['', ...answerLines.slice(1).map((line) => `・${line}`)] : [])]
    : ['該当FAQをもとに回答を作成できませんでした。関連候補を確認してください。'];

  const related = focusedMatches.slice(0, 4);
  const sourceDocs = related.map(item => ({ ...smartFaqToDoc(item.record), score: item.score }));

  return {
    id: `assistant:${Date.now()}`,
    role: 'assistant',
    mode: 'faq',
    text: sections.join('\n'),
    sources,
    confidence,
    confidenceLevel,
    warnings: confidenceLevel === 'low' ? ['近いFAQはありますが、完全一致ではない可能性があります。'] : [],
  };
}

function composeLocalFaqAnswerWithRecords(question: string, docs: SmartDoc[], records: SmartFaqRecord[]): SmartChatMessage {
  const usableRecords = records.filter(record => record.status === 'approved' || record.status === 'reviewed');
  const matches = usableRecords
    .map(record => ({ record, score: scoreFaqRecordForStrictIntent(question, record, scoreFaqRecord(question, record)) }))
    .filter(item => item.score >= 32)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (matches.length) {
    const expandedMatches = matches.map(item => ({ ...item, reasons: [], matchedTerms: [], confidenceLabel: '' }));
    const focusedMatches = filterMatchesByStrictIntent(question, expandedMatches).slice(0, 4);
    if (!focusedMatches.length) return buildInsufficientEvidenceFaqAnswer(question, expandedMatches);
    const faqDocs = focusedMatches.map(item => smartFaqToDoc(item.record));
    const bestAnswer = buildBestEffortFaqAnswer(question, focusedMatches);
    const lines = cleanGeneratedAnswerLines(question, [bestAnswer.lead, ...bestAnswer.bullets].filter(Boolean));
    const text = lines.length ? [lines[0], ...(lines.length > 1 ? ['', ...lines.slice(1).map(line => `・${line}`)] : [])].join('\n') : focusedMatches[0].record.answer;
    const calibrated = calibrateFaqConfidence(focusedMatches, bestAnswer, question);
    return { id: `assistant:${Date.now()}`, role: 'assistant', mode: 'faq', text, sources: faqDocs, confidence: calibrated.confidence, confidenceLevel: calibrated.level };
  }
  return composeLocalGenerativeAnswer(question, docs, records);
}

function pickEvidenceSentences(question: string, doc: SmartDoc, limit = 4): string[] {
  const qTokens = smartTokens(question);
  const body = `${doc.title}\n${doc.body}`;
  const sentences = body
    .split(/\r?\n|。|！|!|？|\?/) 
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length >= 6 && line.length <= 260);
  const scored = sentences.map((line, index) => {
    const lineTokens = smartTokens(line);
    let score = tokenOverlapScore(qTokens, lineTokens) * 120;
    if (normalizeSmartText(line).includes(normalizeSmartText(question))) score += 25;
    if (/(結論|概要|目的|対応|期限|原因|注意|決定|課題|方法|手順|必要|できる|できない)/.test(line)) score += 8;
    score += Math.max(0, 6 - index * 0.1);
    return { line, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score >= 4)
    .map(item => item.line)
    .filter((line, index, arr) => arr.indexOf(line) === index)
    .slice(0, limit);
}

function retrieveSmartAnswerDocs(question: string, docs: SmartDoc[], limit = 7): SmartDoc[] {
  const q = question.trim();
  if (!q) return [];
  const qTokens = smartTokens(q);
  return docs
    .map(doc => {
      const queryScore = scoreSmartSearchQuery(q, doc);
      const overlap = tokenOverlapScore(qTokens, doc.tokenSet || []);
      const importantBonus = /(faq|質問|回答|q[:：]|a[:：]|手順|方法|対応|結論)/i.test(`${doc.title}\n${doc.body}`) ? 8 : 0;
      const score = queryScore.boost + Math.round(overlap * 100) + importantBonus;
      return { doc, score };
    })
    .filter(item => item.score >= 10)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => ({ ...item.doc, score: item.score }));
}

function composeLocalFaqAnswer(question: string, docs: SmartDoc[]): SmartChatMessage {
  const q = question.trim();
  const sources = retrieveSmartAnswerDocs(q, docs, 6);
  if (!sources.length) {
    return {
      id: `assistant:${Date.now()}`,
      role: 'assistant',
      mode: 'unknown',
      text: [
        '該当しそうなローカル情報を見つけられませんでした。',
        '',
        '試すと良いこと:',
        '・キーワードを短くする',
        '・正式名称と略称の両方で検索する',
        '・ページやDB行にタグ・タイトル・本文を追加する',
        '',
        '※この回答は外部AIを使わず、ローカル検索結果だけで作成しています。'
      ].join('\n'),
      sources: [],
    };
  }
  const evidence = sources.flatMap((doc, docIndex) =>
    pickEvidenceSentences(q, doc, docIndex === 0 ? 5 : 3).map(line => ({ doc, line }))
  ).slice(0, 10);
  const todos = extractTodoCandidates(evidence.map(item => item.line).join('\n')).slice(0, 5);
  const summary = evidence.length
    ? evidence.slice(0, 5).map((item, index) => `${index + 1}. ${item.line}`).join('\n')
    : sources.slice(0, 4).map((doc, index) => `${index + 1}. ${doc.title}`).join('\n');
  const answerType = /(todo|タスク|やること|対応|期限|未完了)/i.test(q) ? 'todo' : /(faq|質問|q&a|qa|よくある)/i.test(q) ? 'faq' : 'answer';
  const sections = [
    `回答候補：${q}`,
    '',
    '根拠から見る要点:',
    summary,
  ];
  if (todos.length) {
    sections.push('', 'TODO候補:', ...todos.map((todo, index) => `${index + 1}. ${todo}`));
  }
  sections.push('', '参照元:', ...sources.slice(0, 5).map((doc, index) => `${index + 1}. ${doc.title}（${doc.kind}${doc.score ? ` / score ${doc.score}` : ''}）`));
  sections.push('', '※ローカル検索・抽出による回答です。生成AIではないため、最終判断は参照元を開いて確認してください。');
  return {
    id: `assistant:${Date.now()}`,
    role: 'assistant',
    mode: answerType,
    text: sections.join('\n'),
    sources,
  };
}


type LocalAnswerIntent = 'definition' | 'procedure' | 'summary' | 'compare' | 'todo' | 'deadline' | 'list' | 'faq' | 'unknown';

type LocalAnswerPlan = {
  intent: LocalAnswerIntent;
  label: string;
  evidenceLimit: number;
  confidenceBias: number;
};

function classifyLocalQuestionIntent(question: string): LocalAnswerPlan {
  const q = normalizeSmartText(question);
  if (/(todo|to-do|タスク|やること|対応事項|未完了|宿題)/i.test(q)) return { intent: 'todo', label: 'TODO抽出', evidenceLimit: 10, confidenceBias: 6 };
  if (/(手順|方法|どうすれば|やり方|操作|設定|作成|登録|申請|流れ)/.test(q)) return { intent: 'procedure', label: '手順回答', evidenceLimit: 9, confidenceBias: 5 };
  if (/(要約|要点|まとめ|概要|ポイント|重要)/.test(q)) return { intent: 'summary', label: '要約回答', evidenceLimit: 8, confidenceBias: 4 };
  if (/(違い|比較|どちら|メリット|デメリット|差|vs|VS)/.test(q)) return { intent: 'compare', label: '比較回答', evidenceLimit: 10, confidenceBias: 2 };
  if (/(いつ|期限|締切|期日|今日|今週|今月|期限切れ)/.test(q)) return { intent: 'deadline', label: '期限回答', evidenceLimit: 10, confidenceBias: 4 };
  if (/(一覧|リスト|全部|すべて|抽出して|列挙)/.test(q)) return { intent: 'list', label: '一覧回答', evidenceLimit: 12, confidenceBias: 2 };
  if (/(faq|q&a|qa|よくある|質問|回答)/i.test(q)) return { intent: 'faq', label: 'FAQ回答', evidenceLimit: 8, confidenceBias: 4 };
  if (/(とは|何|なに|意味|定義)/.test(q)) return { intent: 'definition', label: '定義回答', evidenceLimit: 7, confidenceBias: 3 };
  return { intent: 'unknown', label: '根拠付き回答', evidenceLimit: 8, confidenceBias: 0 };
}

function localAnswerConfidence(sources: SmartDoc[], faqMatches: number, evidenceCount: number, plan: LocalAnswerPlan): number {
  const topScore = Math.max(0, ...sources.map(doc => Number(doc.score || 0)));
  const sourceDiversity = new Set(sources.map(doc => doc.kind)).size;
  const avgSourceScore = sources.length ? sources.reduce((sum, doc) => sum + Number(doc.score || 0), 0) / sources.length : 0;
  let score = plan.confidenceBias + Math.min(34, sources.length * 5) + Math.min(24, evidenceCount * 3) + faqMatches * 16;
  score += Math.min(18, topScore * 0.18);
  score += Math.min(10, avgSourceScore * 0.10);
  score += Math.min(8, sourceDiversity * 2);
  if (sources.some(doc => doc.kind === 'page')) score += 3;
  if (sources.some(doc => doc.title.includes('❓'))) score += 8;
  if (!sources.length || !evidenceCount) score -= 18;
  return Math.max(0, Math.min(98, Math.round(score)));
}

function confidenceLevelFor(score: number): SmartAnswerConfidenceLevel {
  if (score >= 78) return 'high';
  if (score >= 58) return 'medium';
  if (score >= 38) return 'low';
  return 'insufficient';
}

function confidenceLabelJa(level: SmartAnswerConfidenceLevel): string {
  if (level === 'high') return '高';
  if (level === 'medium') return '中';
  if (level === 'low') return '低';
  return '根拠不足';
}

function buildAnswerWarnings(confidence: number, sources: SmartDoc[], evidenceCount: number, faqMatches: number): string[] {
  const warnings: string[] = [];
  if (confidence < 38) warnings.push('根拠が弱いため、断定回答を避けています。検索語を増やすか、FAQを追加してください。');
  if (!faqMatches) warnings.push('承認済み/確認済みFAQには強い一致がありません。');
  if (sources.length < 2) warnings.push('参照元が少ないため、回答の網羅性は限定的です。');
  if (evidenceCount < 2) warnings.push('抽出できた根拠文が少ないです。');
  return warnings.slice(0, 4);
}

function feedbackBiasForSource(question: string, source: SmartDoc, feedback: SmartAnswerFeedback[]): number {
  if (!feedback.length) return 0;
  const qTokens = smartTokens(question);
  return feedback.reduce((sum, item) => {
    if (!item.sourceIds.includes(source.id)) return sum;
    const overlap = tokenOverlapScore(qTokens, smartTokens(item.question));
    if (overlap < 0.08 && !normalizeSmartText(item.question).includes(normalizeSmartText(question).slice(0, 8))) return sum;
    return sum + (item.rating === 'good' ? 8 : -14);
  }, 0);
}

function applyAnswerFeedbackBias(question: string, sources: SmartDoc[], feedback: SmartAnswerFeedback[]): SmartDoc[] {
  if (!feedback.length) return sources;
  return sources
    .map(source => ({ ...source, score: Math.max(0, Math.min(100, Number(source.score || 0) + feedbackBiasForSource(question, source, feedback))) }))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function formatLocalGeneratedAnswer(question: string, plan: LocalAnswerPlan, evidence: Array<{ doc: SmartDoc; line: string }>, sources: SmartDoc[], faqRecords: SmartFaqRecord[], confidence: number, level: SmartAnswerConfidenceLevel, warnings: string[]): string {
  const lines = evidence.map(item => item.line).filter(Boolean);
  const todos = extractTodoCandidates(lines.join('\n')).slice(0, 8);
  const topBullets = lines.slice(0, plan.evidenceLimit).map((line, index) => `${index + 1}. ${line}`);
  const faqHint = faqRecords
    .filter(record => record.status === 'approved' || record.status === 'reviewed')
    .map(record => ({ record, score: scoreFaqRecordForStrictIntent(question, record, scoreFaqRecord(question, record)) }))
    .filter(item => item.score >= 24)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const sections: string[] = [`Local Generative Assist（${plan.label} / 信頼度 ${confidence}%・${confidenceLabelJa(level)}）`, `質問: ${question}`, ''];
  if (warnings.length) sections.push('信頼度メモ:', ...warnings.map((warning, index) => `${index + 1}. ${warning}`), '');
  if (faqHint.length) sections.push('優先FAQ:', ...faqHint.map((item, index) => `${index + 1}. ${item.record.question}\n   → ${item.record.answer}`), '');
  if (plan.intent === 'procedure') sections.push('手順として見ると:', ...(topBullets.length ? topBullets : ['1. 参照元を開いて手順・条件・期限を確認してください。']));
  else if (plan.intent === 'todo') sections.push('TODO候補:', ...(todos.length ? todos.map((todo, index) => `${index + 1}. ${todo}`) : topBullets));
  else if (plan.intent === 'deadline') {
    const deadlineLines = lines.filter(line => /(期限|締切|期日|まで|\d{1,2}月|\d{4}|今日|今週|今月)/.test(line));
    sections.push('期限・日付に関係する情報:', ...((deadlineLines.length ? deadlineLines : lines).slice(0, 8).map((line, index) => `${index + 1}. ${line}`)));
  } else if (plan.intent === 'compare') sections.push('比較材料:', ...(topBullets.length ? topBullets : ['1. 比較できる根拠が少ないため、キーワードを追加して再質問してください。']));
  else if (plan.intent === 'definition') sections.push('定義・意味として確認できる内容:', ...(topBullets.length ? topBullets.slice(0, 5) : ['1. 明確な定義文は見つかりませんでした。']));
  else sections.push('根拠から組み立てた回答:', ...(topBullets.length ? topBullets : ['1. 直接該当する根拠は少なめです。']));
  sections.push('', '参照元:', ...sources.slice(0, 6).map((doc, index) => `${index + 1}. ${doc.title}（${doc.kind}${doc.score ? ` / score ${doc.score}` : ''}）`));
  sections.push('', '※これは大型生成AIではなく、FAQ・ページ・DB・PDF由来テキストを検索し、テンプレートで回答を組み立てる完全ローカル方式です。重要事項は参照元で確認してください。');
  return sections.join('\n');
}

function composeLocalGenerativeAnswer(question: string, docs: SmartDoc[], records: SmartFaqRecord[], feedback: SmartAnswerFeedback[] = []): SmartChatMessage {
  const plan = classifyLocalQuestionIntent(question);
  const faqDocs = records
    .filter(record => record.status === 'approved' || record.status === 'reviewed')
    .map(record => ({ record, score: scoreFaqRecordForStrictIntent(question, record, scoreFaqRecord(question, record)) }))
    .filter(item => item.score >= 26)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => ({ ...smartFaqToDoc(item.record), score: item.score }));
  const retrieved = retrieveSmartAnswerDocs(question, docs, 8);
  const mergedSources = [...faqDocs, ...retrieved.filter(doc => !faqDocs.some(faq => faq.id === doc.id))].slice(0, 10);
  const sources = applyAnswerFeedbackBias(question, mergedSources, feedback).slice(0, 8);
  if (!sources.length) return composeLocalFaqAnswer(question, docs);
  const evidence = sources.flatMap((doc, docIndex) => pickEvidenceSentences(question, doc, docIndex === 0 ? 6 : 3).map(line => ({ doc, line }))).slice(0, 16);
  const confidence = localAnswerConfidence(sources, faqDocs.length, evidence.length, plan);
  const level = confidenceLevelFor(confidence);
  const warnings = buildAnswerWarnings(confidence, sources, evidence.length, faqDocs.length);
  const text = level === 'insufficient'
    ? [`Local Generative Assist（${plan.label} / 信頼度 ${confidence}%・${confidenceLabelJa(level)}）`, `質問: ${question}`, '', 'この質問に対して、現在のローカル資料だけでは十分な根拠を確認できませんでした。', '', '確認できた関連候補:', ...sources.slice(0, 5).map((doc, index) => `${index + 1}. ${doc.title}（${doc.kind}${doc.score ? ` / score ${doc.score}` : ''}）`), '', '次の対応がおすすめです:', '1. PDF由来FAQ JSONを追加する', '2. 質問語を具体化する', '3. 参照元ページをFAQ化する', '', ...warnings.map(w => `・${w}`)].join('\n')
    : formatLocalGeneratedAnswer(question, plan, evidence, sources, records, confidence, level, warnings);
  return { id: `assistant:${Date.now()}`, role: 'assistant', mode: plan.intent === 'definition' ? 'answer' : plan.intent, text, sources, confidence, confidenceLevel: level, warnings };
}

function buildFaqRecordFromChatAnswer(question: string, answer: SmartChatMessage, status: SmartFaqStatus = 'draft'): SmartFaqRecord {
  const now = new Date().toISOString();
  const cleaned = answer.text.replace(/^Local Generative Assist.*$/m, '').replace(/^質問:.*$/m, '').replace(/※これは大型生成AI[\s\S]*$/m, '').trim().slice(0, 2400);
  return { id: `faq_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, question, answer: cleaned || answer.text.slice(0, 1800), category: 'チャット由来', tags: ['FAQ', 'チャット回答'], status, sourceDocIds: answer.sources?.map(source => source.id) || [], sourceTitles: answer.sources?.map(source => source.title) || [], confidence: 76, createdAt: now, updatedAt: now, sourceType: 'chat', sourceText: answer.text.slice(0, 1200) };
}

function normalizeImportedFaqRecord(item: any): SmartFaqRecord | null {
  const q = String(item?.question || item?.q || item?.title || '').trim();
  const a = String(item?.answer || item?.a || item?.body || '').trim();
  if (!q || !a) return null;
  const now = new Date().toISOString();
  return { id: String(item.id || `faq_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`), question: q, answer: a, category: String(item.category || item.topic || item.sourcePdfName || 'インポート'), tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : String(item.tags || '').split(/[、,\s]+/).filter(Boolean), status: safeFaqStatus(item.status || 'reviewed'), sourceDocIds: Array.isArray(item.sourceDocIds) ? item.sourceDocIds.map(String) : [], sourceTitles: Array.isArray(item.sourceTitles) ? item.sourceTitles.map(String) : [item.sourceTitle, item.sourcePdfName].filter(Boolean).map(String), confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(100, Number(item.confidence))) : 86, createdAt: String(item.createdAt || now), updatedAt: String(item.updatedAt || now), sourceType: item.sourceType || (item.sourcePdfName ? 'pdf' : 'import'), sourcePdfName: item.sourcePdfName, sourcePage: item.sourcePage, sourceText: item.sourceText || item.evidence || item.quote, intentId: item.intentId || item.intentName, intentLabel: item.intentLabel, testQuestions: Array.isArray(item.testQuestions) ? item.testQuestions.map(String).filter(Boolean) : Array.isArray(item.examples) ? item.examples.map(String).filter(Boolean) : undefined, suggestedActions: Array.isArray(item.suggestedActions) ? item.suggestedActions.map(String).filter(Boolean) : undefined, nextQuestions: Array.isArray(item.nextQuestions) ? item.nextQuestions.map(String).filter(Boolean) : undefined };
}

function buildSmartFaqItems(docs: SmartDoc[], limit = 16): SmartFaqItem[] {
  const candidates = docs
    .map(doc => {
      const text = `${doc.title}\n${doc.body}`;
      let score = 0;
      if (/(faq|質問|回答|q[:：]|a[:：]|よくある)/i.test(text)) score += 30;
      if (/(方法|手順|どう|なぜ|できる|できない|注意|期限|対応|必要)/.test(text)) score += 16;
      score += Math.min(20, (doc.tokenSet?.length || 0) / 20);
      return { doc, score };
    })
    .filter(item => item.score >= 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return candidates.map(({ doc }, index) => {
    const lines = importantExtractiveSummary(`${doc.title}\n${doc.body}`).slice(0, 4);
    const keyword = (doc.tags[0] || smartTokens(doc.title).find(t => !t.includes(':')) || doc.title).replace(/^#/, '');
    return {
      id: `faq:${doc.id}:${index}`,
      question: `${keyword}について何を確認すればよいですか？`,
      answer: lines.length ? lines.join('\n') : `${doc.title} を開いて本文・プロパティ・関連情報を確認してください。`,
      sources: [doc],
    };
  });
}

function relationReasonFor(a: SmartDoc, b: SmartDoc): string {
  const sharedTags = a.tags.filter(tag => b.tags.includes(tag));
  const sharedTokens = (a.tokenSet || []).filter(token => (b.tokenSet || []).includes(token) && !token.includes(':')).slice(0, 6);
  const parts = [];
  if (sharedTags.length) parts.push(`共通タグ: ${sharedTags.slice(0, 4).join(' / ')}`);
  if (sharedTokens.length) parts.push(`共通語: ${sharedTokens.join(' / ')}`);
  if (a.date && b.date && a.date === b.date) parts.push(`同日: ${a.date}`);
  return parts.join('。') || 'タイトル・本文の類似度から推定。';
}


function previousUserQuestionForMessage(messages: SmartChatMessage[], assistantId: string): string {
  const index = messages.findIndex(message => message.id === assistantId);
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages[i].text;
  }
  return messages.slice().reverse().find(message => message.role === 'user')?.text || '';
}

export function LocalSmartAssistView({ api, pages, databases, journals, inboxItems, tasks, currentPage, currentDb, tagAliases = {}, tagPresentation = {}, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, onOpenInbox, onOpenTasks }: {
  api: ApiClient | null;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  journals: JournalSummary[];
  inboxItems: InboxItem[];
  tasks: TaskItem[];
  currentPage: PageBundle | null;
  currentDb: WorkspaceDatabase | null;
  tagAliases?: TagAliasMap;
  tagPresentation?: TagPresentationMap;
  onOpenPage: (id: string) => void;
  onOpenDatabase: (id: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
  onOpenInbox: () => void;
  onOpenTasks: () => void;
}) {
  const [query, setQuery] = useState('');
  const [deferredQuery, setDeferredQuery] = useState('');
  const [scope, setScope] = useState<'all' | SmartDocKind>('all');
  const [selectedId, setSelectedId] = useState('');
  const [chatQuestion, setChatQuestion] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [showFaqBuilder, setShowFaqBuilder] = useState(false);
  const [faqRecords, setFaqRecords] = useState<SmartFaqRecord[]>([]);
  const [faqSyncStatus, setFaqSyncStatus] = useState('共有FAQを読み込み中...');
  const [answerFeedback, setAnswerFeedback] = useState<SmartAnswerFeedback[]>([]);
  const [answerFeedbackStatus, setAnswerFeedbackStatus] = useState('回答フィードバックを読み込み中...');
  const faqSaveTimerRef = useRef<number | null>(null);
  const faqSaveInFlightRef = useRef(false);
  const queuedFaqSaveRef = useRef<SmartFaqRecord[] | null>(null);
  const faqSaveDrainRef = useRef<Promise<void> | null>(null);
  const faqRetryTimerRef = useRef<number | null>(null);
  const faqRetryAttemptRef = useRef(0);
  const [faqSaveRecovery, setFaqSaveRecovery] = useState<{ attempt: number; exhausted: boolean } | null>(null);
  const [manualFaq, setManualFaq] = useState({ question: '', answer: '', category: '未分類', tags: '' });
  const [faqEditDraft, setFaqEditDraft] = useState<SmartFaqRecord | null>(null);
  const [faqEditMode, setFaqEditMode] = useState<'new' | 'edit'>('new');
  const [evaluationReport, setEvaluationReport] = useState<any | null>(null);
  const [evaluationReports, setEvaluationReports] = useState<any[]>([]);
  const [evaluationEntries, setEvaluationEntries] = useState<any[]>([]);
  const [evaluationDraft, setEvaluationDraft] = useState({ id: '', question: '', expectedFaqId: '', note: '', updatedAt: '' });
  const [faqFilter, setFaqFilter] = useState<'all' | SmartFaqStatus>('all');
  const [faqOverviewQuery, setFaqOverviewQuery] = useState('');
  const [deferredFaqOverviewQuery, setDeferredFaqOverviewQuery] = useState('');
  const [faqDisplayLimit, setFaqDisplayLimit] = useState(120);
  const [selectedFaqIds, setSelectedFaqIds] = useState<string[]>([]);
  const [faqOverviewStatus, setFaqOverviewStatus] = useState<'all' | SmartFaqStatus>('approved');
  const [faqServerResult, setFaqServerResult] = useState<any | null>(null);
  const [faqSearchStats, setFaqSearchStats] = useState<any | null>(null);
  const [faqSearchStatus, setFaqSearchStatus] = useState('FAQ検索エンジンを確認中...');
  const [showFaqLibrary, setShowFaqLibrary] = useState(true);
  const [showFaqJsonImport, setShowFaqJsonImport] = useState(false);
  const [faqJsonText, setFaqJsonText] = useState('');
  const [faqJsonError, setFaqJsonError] = useState('');
  const welcomeMessages: SmartChatMessage[] = [{ id: 'assistant:welcome', role: 'assistant', mode: 'answer', text: 'Local Smart Answerです。FAQ・ページ・DB・Journalを横断し、汎用FAQ回答エンジンで回答本文だけを自然に生成します。関連情報は下のボタンから開けます。' }];
  const [answerMode, setAnswerMode] = useState<SmartAnswerMode>('balanced');
  const [pinnedQuestions, setPinnedQuestions] = useState<string[]>(() => loadSmartPinnedQuestions());
  const [chatHistoryEnabled, setChatHistoryEnabled] = useState(() => window.localStorage.getItem(`${SMART_CHAT_HISTORY_KEY}:enabled`) !== 'false');
  const [pinnedWorkspaceSourceItems, setPinnedWorkspaceSourceItems] = useState<any[]>([]);
  const [excludedWorkspaceSourceKeys, setExcludedWorkspaceSourceKeys] = useState<string[]>([]);
  const [showImproveAnswer, setShowImproveAnswer] = useState(false);
  const [improvedAnswerText, setImprovedAnswerText] = useState('');
  const [chatMessages, setChatMessages] = useState<SmartChatMessage[]>(() => loadSmartChatMessages(welcomeMessages));
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatMessageRefs = useRef<Record<string, HTMLElement | null>>({});
  const [focusMessageId, setFocusMessageId] = useState('');
  const [operationStatus, setOperationStatus] = useState('準備完了');
  const [operationProgress, setOperationProgress] = useState<SmartOperationProgress>({ busy: false, label: '準備完了', detail: '待機中', phase: 'idle' });
  const [lowConfidenceLogs, setLowConfidenceLogs] = useState<any[]>([]);
  const [showLowConfidenceLogs, setShowLowConfidenceLogs] = useState(false);
  const [faqTestResult, setFaqTestResult] = useState<any | null>(null);
  const [testingFaqId, setTestingFaqId] = useState('');
  const [smartSynonyms, setSmartSynonyms] = useState<any[]>([]);
  const [showSmartSynonymEditor, setShowSmartSynonymEditor] = useState(false);
  const [smartSynonymJsonText, setSmartSynonymJsonText] = useState('');
  const [smartSynonymStatus, setSmartSynonymStatus] = useState('言い換え: 読込中');
  const [smartRuleProfiles, setSmartRuleProfiles] = useState<any[]>([]);
  const [showSmartRuleProfileEditor, setShowSmartRuleProfileEditor] = useState(false);
  const [smartRuleProfileJsonText, setSmartRuleProfileJsonText] = useState('');
  const [smartRuleProfileStatus, setSmartRuleProfileStatus] = useState('ルール: 読込中');
  const [showSmartAssistControlPanel, setShowSmartAssistControlPanel] = useState(false);
  const [smartAdminTab, setSmartAdminTab] = useState<'overview' | 'faq' | 'workspace-search' | 'model' | 'generation' | 'semantic' | 'data' | 'stats' | 'improvement' | 'ops'>('overview');
  const [showSmartMiniManager, setShowSmartMiniManager] = useState(false);
  const [showFaqCsvImport, setShowFaqCsvImport] = useState(false);
  const [faqCsvText, setFaqCsvText] = useState('');
  const [faqCsvError, setFaqCsvError] = useState('');
  const [aiDataImport, setAiDataImport] = useState<{ open: boolean; kind: string; format: 'json' | 'csv'; text: string; error: string }>({ open: false, kind: 'faq', format: 'json', text: '', error: '' });
  const [modelLoadProgress, setModelLoadProgress] = useState<{ active: boolean; label: string; percent: number }>({ active: false, label: '待機中', percent: 0 });
  const [transformerRuntimeInfo, setTransformerRuntimeInfo] = useState<any | null>(null);
  const [transformerSettings, setTransformerSettings] = useState<any>({ modelId: 'sirasagi62/ruri-v3-70m-ONNX', modelRoot: '', localCacheDir: '' });
  const [semanticCacheInfo, setSemanticCacheInfo] = useState<any>(null);
  const [cacheTopologyInfo, setCacheTopologyInfo] = useState<any>(null);
  const [uiDisplayCacheInfo, setUiDisplayCacheInfo] = useState<any>(null);
  const [workspaceDerivedIndexInfo, setWorkspaceDerivedIndexInfo] = useState<any>(null);
  const [workspaceSummaryIndexInfo, setWorkspaceSummaryIndexInfo] = useState<any>(null);
  const [databaseIndexInfo, setDatabaseIndexInfo] = useState<any>(null);
  const [transformerModelCheck, setTransformerModelCheck] = useState<any | null>(null);
  const [transformerModelBusy, setTransformerModelBusy] = useState(false);
  const [transformerModelMessage, setTransformerModelMessage] = useState('');
  const [generationSettings, setGenerationSettings] = useState<any>({ enabled: false, provider: 'none', modelRoot: '', selectedModelPath: '', contextSize: 1024, maxTokens: 128, temperature: 0.1, timeoutMs: 45000, totalTimeoutMs: 60000, preset: 'fast', performanceMode: 'fast', retryMode: 'off', generationRuntimeMode: 'oneshot', llamaServerHost: '127.0.0.1', llamaServerPort: 18080, llamaServerAutoStart: true, llamaServerFallback: true });
  const [generationCheck, setGenerationCheck] = useState<any | null>(null);
  const [generationServerStatus, setGenerationServerStatus] = useState<any | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationMessage, setGenerationMessage] = useState('');
  const [faqImprovementGenerating, setFaqImprovementGenerating] = useState(false);
  const [faqImprovementDraft, setFaqImprovementDraft] = useState<any | null>(null);
  const [faqImprovementOriginalSnapshot, setFaqImprovementOriginalSnapshot] = useState<SmartFaqRecord | null>(null);
  const [faqImprovementMessage, setFaqImprovementMessage] = useState('');
  const [faqImprovementStartedAt, setFaqImprovementStartedAt] = useState<number | null>(null);
  const [faqImprovementElapsedSec, setFaqImprovementElapsedSec] = useState(0);
  const [workspaceSemanticInfo, setWorkspaceSemanticInfo] = useState<any | null>(null);
  const [workspaceSemanticStatus, setWorkspaceSemanticStatus] = useState('Workspace Semantic Indexを確認中...');
  const [semanticBackgroundJob, setSemanticBackgroundJob] = useState<any | null>(null);
  const [semanticRecoveryBackups, setSemanticRecoveryBackups] = useState<any[]>([]);
  const [semanticIdleEnabled, setSemanticIdleEnabled] = useState(false);
  const [semanticIdleBatchSize, setSemanticIdleBatchSize] = useState(10);
  const [semanticIdleDelaySec, setSemanticIdleDelaySec] = useState(8);
  // Activity time is not rendered. Keep it in a ref so mouse movement does not
  // trigger a full Smart Assist re-render.
  const semanticIdleLastActivityRef = useRef(Date.now());
  const [semanticIdleRunning, setSemanticIdleRunning] = useState(false);
  const semanticIdleRunningRef = useRef(false);
  const semanticIdleLastRunRef = useRef(0);
  useEffect(() => {
    if (!focusMessageId) return;
    const target = chatMessageRefs.current[focusMessageId];
    const timer = window.setTimeout(() => {
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.add('smart-chat-focus-pulse-v152');
        window.setTimeout(() => target.classList.remove('smart-chat-focus-pulse-v152'), 1400);
      } else if (chatLogRef.current) {
        chatLogRef.current.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: 'smooth' });
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusMessageId, chatMessages.length]);

  useEffect(() => {
    saveSmartPinnedQuestions(pinnedQuestions);
  }, [pinnedQuestions]);
  useEffect(() => {
    saveSmartChatMessages(chatMessages, chatHistoryEnabled);
  }, [chatMessages, chatHistoryEnabled]);
  useEffect(() => {
    if (!faqImprovementGenerating || !faqImprovementStartedAt) return;
    const timer = window.setInterval(() => {
      setFaqImprovementElapsedSec(Math.max(0, Math.round((Date.now() - faqImprovementStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [faqImprovementGenerating, faqImprovementStartedAt]);


  useEffect(() => {
    const mark = () => { semanticIdleLastActivityRef.current = Date.now(); };
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((eventName) => window.addEventListener(eventName, mark, { passive: true } as any));
    return () => events.forEach((eventName) => window.removeEventListener(eventName, mark as any));
  }, []);

  useEffect(() => {
    if (!api || !semanticIdleEnabled) return;
    const timer = window.setInterval(async () => {
      if (!semanticIdleEnabled || semanticIdleRunningRef.current || operationProgress.busy || transformerModelBusy || document.visibilityState !== 'visible') return;
      const pending = Number(workspaceSemanticInfo?.diff?.pending || 0);
      if (!pending) return;
      const idleMs = Date.now() - semanticIdleLastActivityRef.current;
      const delayMs = Math.max(5, Number(semanticIdleDelaySec || 8)) * 1000;
      if (idleMs < delayMs) return;
      if (Date.now() - semanticIdleLastRunRef.current < 15_000) return;
      const limit = Math.max(1, Math.min(50, Number(semanticIdleBatchSize || 10)));
      semanticIdleRunningRef.current = true;
      semanticIdleLastRunRef.current = Date.now();
      setSemanticIdleRunning(true);
      setWorkspaceSemanticStatus(`アイドル差分更新中... 最大${limit}件`);
      try {
        const result = await api.diffUpdateWorkspaceSemanticIndex(limit, { background: true });
        const info = await api.getWorkspaceSemanticIndexInfo();
        setWorkspaceSemanticInfo(info);
        const stats = result?.buildStats || info?.cache?.meta || {};
        const embedded = Number(stats.embeddedThisRun ?? stats.lastEmbeddedThisRun ?? 0);
        const pendingNext = Number(stats.pendingCount ?? stats.lastPendingCount ?? info?.diff?.pending ?? 0);
        setWorkspaceSemanticStatus(`アイドル差分更新完了: ${embedded}件更新 / 残り${pendingNext}件`);
      } catch (err: any) {
        setWorkspaceSemanticStatus(`アイドル差分更新に失敗: ${err?.message ?? 'unknown error'}`);
      } finally {
        semanticIdleRunningRef.current = false;
        setSemanticIdleRunning(false);
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [api, semanticIdleEnabled, semanticIdleBatchSize, semanticIdleDelaySec, workspaceSemanticInfo?.diff?.pending, operationProgress.busy, transformerModelBusy]);

  // The editor can update currentPage.markdown on every keystroke. Keep the local
  // fallback corpus responsive, but do not rebuild all Smart Assist token indexes
  // in the same render as typing.
  const deferredCurrentPageMarkdown = useDeferredValue(currentPage?.markdown || '');
  const deferredCurrentPageBlocksuite = useDeferredValue(currentPage?.blocksuite);
  const smartDocsCurrentPage = useMemo(() => {
    const pageId = currentPage?.meta.id;
    if (!pageId) return null;
    // buildSmartDocs only needs these fields for its current-page overlay.
    return { meta: { id: pageId }, markdown: deferredCurrentPageMarkdown, blocksuite: deferredCurrentPageBlocksuite } as PageBundle;
  }, [currentPage?.meta.id, deferredCurrentPageMarkdown, deferredCurrentPageBlocksuite]);
  const docs = useMemo(
    () => buildSmartDocs({ pages, databases, journals, inboxItems, tasks, currentPage: smartDocsCurrentPage }),
    [pages, databases, journals, inboxItems, tasks, smartDocsCurrentPage],
  );
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await api.getTransformerRuntimeInfo();
        if (!cancelled) setTransformerRuntimeInfo(info);
      } catch {
        if (!cancelled) setTransformerRuntimeInfo(null);
      }
      try {
        const settingsResult = await api.getTransformerSettings();
        if (!cancelled && settingsResult?.settings) {
          setTransformerSettings(settingsResult.settings);
          setSemanticIdleEnabled(Boolean(settingsResult.settings.semanticIdleEnabled));
          setSemanticIdleBatchSize(Number(settingsResult.settings.semanticIdleBatchSize || 10));
          setSemanticIdleDelaySec(Number(settingsResult.settings.semanticIdleDelaySec || 8));
        }
      } catch {}
      try {
        const cacheInfo = await api.getSemanticCacheInfo();
        if (!cancelled) setSemanticCacheInfo(cacheInfo);
      } catch {
        if (!cancelled) setSemanticCacheInfo(null);
      }
      try {
        const topology = await api.getCacheTopology();
        if (!cancelled) setCacheTopologyInfo(topology);
      } catch {
        if (!cancelled) setCacheTopologyInfo(null);
      }
      try {
        const genSettingsResult = await api.getGenerationSettings();
        if (!cancelled && genSettingsResult?.settings) setGenerationSettings(genSettingsResult.settings);
      } catch {}
      try {
        const genCheck = await api.checkGenerationEngine();
        if (!cancelled) setGenerationCheck(genCheck);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [api]);

  async function refreshTransformerModelStatus() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('モデル状態を確認しています...');
    try {
      const check = await api.checkTransformerModel();
      const runtime = await api.getTransformerRuntimeInfo();
      setTransformerModelCheck(check);
      setTransformerRuntimeInfo(runtime);
      setTransformerModelMessage(check?.ok ? 'モデルを確認しました。利用できます。' : 'モデルが不足しています。モデル取得を実行してください。');
    } catch (err: any) {
      setTransformerModelMessage(`モデル確認に失敗しました: ${err?.message || err}`);
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function chooseTransformerModelRootFromDialog() {
    if (!window.localNotion?.chooseTransformerModelRoot) {
      setTransformerModelMessage('この環境ではフォルダ選択ダイアログを使用できません。モデル保存先を直接入力してください。');
      return;
    }
    try {
      const selected = await window.localNotion.chooseTransformerModelRoot();
      if (!selected) return;
      setTransformerSettings((prev: any) => ({
        ...(prev || {}),
        modelRoot: selected,
      }));
      setTransformerModelMessage('モデル保存先フォルダを選択しました。設定を保存してからモデル確認を実行してください。');
    } catch (err: any) {
      setTransformerModelMessage(`フォルダ選択に失敗しました: ${err?.message || err}`);
    }
  }



  async function chooseSemanticCacheDirFromDialog() {
    if (!window.localNotion?.chooseSemanticCacheDir) {
      setTransformerModelMessage('この環境ではフォルダ選択ダイアログを使用できません。ローカルキャッシュ保存先を直接入力してください。');
      return;
    }
    try {
      const selected = await window.localNotion.chooseSemanticCacheDir();
      if (!selected) return;
      setTransformerSettings((prev: any) => ({ ...(prev || {}), localCacheDir: selected }));
      setTransformerModelMessage('ローカルキャッシュ保存先を選択しました。設定を保存してから差分更新を実行してください。');
    } catch (err: any) {
      setTransformerModelMessage(`キャッシュ保存先の選択に失敗しました: ${err?.message || err}`);
    }
  }

  async function refreshSemanticCacheInfo() {
    if (!api) return;
    try {
      const info = await api.getSemanticCacheInfo();
      setSemanticCacheInfo(info);
      return info;
    } catch (err: any) {
      setTransformerModelMessage(`ローカルキャッシュ状態の取得に失敗しました: ${err?.message || err}`);
      return null;
    }
  }


  async function refreshCacheTopologyInfo() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('キャッシュ構造を確認しています...');
    try {
      const [semantic, topology] = await Promise.all([
        api.getSemanticCacheInfo().catch(() => null),
        api.getCacheTopology(),
      ]);
      if (semantic) setSemanticCacheInfo(semantic);
      setCacheTopologyInfo(topology);
      setTransformerModelMessage('キャッシュ構造を更新しました。既存SQLとRuri-v3用SQLiteの役割を確認できます。');
      return topology;
    } catch (err: any) {
      setTransformerModelMessage(`キャッシュ構造の取得に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }


  async function refreshUiDisplayCacheInfo() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('UI表示キャッシュを確認しています...');
    try {
      const info = await api.getUiDisplayCacheStatus();
      setUiDisplayCacheInfo(info);
      setTransformerModelMessage(info?.sidebarTreeFresh ? 'UI表示キャッシュは最新です。' : 'UI表示キャッシュは未作成または更新が必要です。');
      return info;
    } catch (err: any) {
      setTransformerModelMessage(`UI表示キャッシュの確認に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function rebuildUiDisplayCacheFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('UI表示キャッシュを再構築しています...');
    try {
      const result = await api.rebuildUiDisplayCache();
      const info = await api.getUiDisplayCacheStatus().catch(() => null);
      if (info) setUiDisplayCacheInfo(info);
      setTransformerModelMessage(`UI表示キャッシュを再構築しました。ページ ${result?.pageCount ?? 0}件 / ルート ${result?.treeCount ?? 0}件`);
      return result;
    } catch (err: any) {
      setTransformerModelMessage(`UI表示キャッシュ再構築に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function refreshWorkspaceDerivedIndexInfo() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('リンク・添付インデックスを確認しています...');
    try {
      const info = await api.getWorkspaceDerivedIndexStatus();
      setWorkspaceDerivedIndexInfo(info);
      setTransformerModelMessage('リンク・添付インデックスの状態を取得しました。');
      return info;
    } catch (err: any) {
      setTransformerModelMessage(`リンク・添付インデックス確認に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function rebuildWorkspaceDerivedIndexFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('リンク・添付インデックスを再構築しています...');
    try {
      const result = await api.rebuildWorkspaceDerivedIndex();
      const info = await api.getWorkspaceDerivedIndexStatus().catch(() => null);
      if (info) setWorkspaceDerivedIndexInfo(info);
      setTransformerModelMessage(`リンク・添付インデックスを再構築しました。ページ ${result?.pagesIndexed ?? 0}件 / DB行 ${result?.rowLinksIndexed ?? 0}件 / 添付 ${result?.attachmentsIndexed ?? 0}件`);
      return result;
    } catch (err: any) {
      setTransformerModelMessage(`リンク・添付インデックス再構築に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }


  async function refreshWorkspaceSummaryIndexInfo() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('Task・Journal・Dashboardインデックスを確認しています...');
    try {
      const info = await api.getWorkspaceSummaryIndexStatus();
      setWorkspaceSummaryIndexInfo(info);
      setTransformerModelMessage('Task・Journal・Dashboardインデックスの状態を取得しました。');
      return info;
    } catch (err: any) {
      setTransformerModelMessage(`Task・Journal・Dashboardインデックス確認に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function rebuildWorkspaceSummaryIndexFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('Task・Journal・Dashboardインデックスを再構築しています...');
    try {
      const result = await api.rebuildWorkspaceSummaryIndex();
      const info = await api.getWorkspaceSummaryIndexStatus().catch(() => null);
      if (info) setWorkspaceSummaryIndexInfo(info);
      setTransformerModelMessage(`Task・Journal・Dashboardインデックスを再構築しました。Journal ${result?.journalsIndexed ?? 0}件 / Task対象 ${result?.taskSourcesIndexed ?? 0}件`);
      return result;
    } catch (err: any) {
      setTransformerModelMessage(`Task・Journal・Dashboardインデックス再構築に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }


  async function refreshDatabaseIndexInfo() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('Database Indexを確認しています...');
    try {
      const info = await api.getDatabaseIndexStatus();
      setDatabaseIndexInfo(info);
      setTransformerModelMessage('Database Indexの状態を取得しました。');
      return info;
    } catch (err: any) {
      setTransformerModelMessage(`Database Index確認に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function rebuildDatabaseIndexFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('Database Indexを再構築しています...');
    try {
      const result = await api.rebuildDatabaseIndexAll();
      const info = await api.getDatabaseIndexStatus().catch(() => null);
      if (info) setDatabaseIndexInfo(info);
      setTransformerModelMessage(`Database Indexを再構築しました。DB ${result?.databasesIndexed ?? 0}件 / 行 ${result?.rowsIndexed ?? 0}件`);
      return result;
    } catch (err: any) {
      setTransformerModelMessage(`Database Index再構築に失敗しました: ${err?.message || err}`);
      return null;
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function clearSemanticQueryCacheFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('検索結果キャッシュを削除しています...');
    try {
      const result = await api.clearSemanticQueryCache();
      await refreshSemanticCacheInfo();
      setTransformerModelMessage(result?.ok ? `検索結果キャッシュを削除しました: ${result.deletedCount || 0}件` : (result?.message || '削除できませんでした。'));
    } catch (err: any) {
      setTransformerModelMessage(`検索結果キャッシュ削除に失敗しました: ${err?.message || err}`);
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function chooseGenerationModelRootFromDialog() {
    if (!window.localNotion?.chooseGenerationModelRoot) {
      setGenerationMessage('この環境ではフォルダ選択ダイアログを使用できません。モデルフォルダを直接入力してください。');
      return;
    }
    try {
      const selected = await window.localNotion.chooseGenerationModelRoot();
      if (!selected) return;
      setGenerationSettings((prev: any) => ({ ...(prev || {}), modelRoot: selected, provider: prev?.provider === 'llama-cpp' ? prev.provider : 'llama-cpp' }));
      setGenerationMessage('生成モデルフォルダを選択しました。設定を保存してからモデル確認を実行してください。');
    } catch (err: any) {
      setGenerationMessage(`フォルダ選択に失敗しました: ${err?.message || err}`);
    }
  }

  async function chooseGenerationExecutableFromDialog() {
    if (!window.localNotion?.chooseGenerationExecutable) {
      setGenerationMessage('この環境ではファイル選択ダイアログを使用できません。llama実行ファイルパスを直接入力してください。');
      return;
    }
    try {
      const selected = await window.localNotion.chooseGenerationExecutable();
      if (!selected) return;
      if (looksLikeGgufModelPath(selected)) {
        setGenerationMessage('選択されたファイルはGGUFモデルです。llama実行ファイル欄には llama-cli.exe / llama.exe / llama-cli を指定してください。');
        return;
      }
      setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaExecutablePath: selected, provider: 'llama-cpp' }));
      setGenerationMessage(looksLikeLlamaExecutablePath(selected) ? 'llama実行ファイルを選択しました。設定を保存してから確認してください。' : '実行ファイルらしくない名前です。保存後のモデル確認で利用可否を確認してください。');
    } catch (err: any) {
      setGenerationMessage(`実行ファイル選択に失敗しました: ${err?.message || err}`);
    }
  }


  async function chooseGenerationRuntimeDirFromDialog() {
    if (!window.localNotion?.chooseGenerationRuntimeDir) {
      setGenerationMessage('この環境ではフォルダ選択ダイアログを使用できません。llamaフォルダを直接入力してください。');
      return;
    }
    try {
      const selected = await window.localNotion.chooseGenerationRuntimeDir();
      if (!selected) return;
      setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaRuntimeDir: selected, llamaExecutablePath: '', provider: 'llama-cpp' }));
      setGenerationMessage('llamaフォルダを選択しました。設定を保存してからモデル確認を実行してください。');
    } catch (err: any) {
      setGenerationMessage(`llamaフォルダ選択に失敗しました: ${err?.message || err}`);
    }
  }

  function applyRecommendedGenerationPresetV317() {
    setGenerationSettings((prev: any) => ({
      ...(prev || {}),
      enabled: true,
      provider: 'llama-cpp',
      preset: 'fast',
      performanceMode: 'fast',
      retryMode: 'off',
      contextSize: 1024,
      maxTokens: 128,
      temperature: 0.1,
      timeoutMs: 45000,
      totalTimeoutMs: 60000,
      generationRuntimeMode: 'oneshot',
      llamaServerHost: prev?.llamaServerHost || '127.0.0.1',
      llamaServerPort: prev?.llamaServerPort || 18080,
      llamaServerAutoStart: true,
      llamaServerFallback: true,
    }));
    setGenerationMessage('会社端末向けの高速推奨設定を適用しました。自動リトライを止め、Context 1024 / 最大生成128 / 全体上限60秒にします。');
  }

  async function saveGenerationEngineSettings() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('生成AI設定を保存しています...');
    try {
      const result = await api.saveGenerationSettings({ ...(generationSettings || {}), baseUpdatedAt: generationSettings?.updatedAt });
      if (!result?.ok) throw new Error(result?.error || '保存に失敗しました');
      setGenerationSettings(result.settings);
      setGenerationMessage('生成AI設定を保存しました。モデル確認を実行してください。');
    } catch (err: any) {
      setGenerationMessage(`保存に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }

  async function refreshGenerationEngineStatus() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('生成AIモデルフォルダを確認しています...');
    try {
      const check = await api.checkGenerationEngine();
      setGenerationCheck(check);
      setGenerationMessage(check?.message || (check?.ok ? '生成AIを確認しました。' : '生成AIはまだ利用準備ができていません。'));
      if (check?.selectedModelPath) setGenerationSettings((prev: any) => ({ ...(prev || {}), selectedModelPath: prev?.selectedModelPath || check.selectedModelPath }));
      if (check?.llamaServer) setGenerationServerStatus(check.llamaServer);
    } catch (err: any) {
      setGenerationMessage(`生成AI確認に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }



  async function refreshGenerationServerStatus() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('llama-serverの状態を確認しています...');
    try {
      const status = await api.getGenerationServerStatus();
      setGenerationServerStatus(status);
      setGenerationMessage(status?.reachable ? `高速AI常駐モード: 起動済み PID ${status.pid || '-'} / ${status.memoryMb ? `${status.memoryMb}MB` : 'メモリ取得中'}` : '高速AI常駐モード: 停止中です。');
    } catch (err: any) {
      setGenerationMessage(`llama-server状態確認に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }

  async function startGenerationServerStatus() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('llama-serverを起動しています。初回はモデル読込で時間がかかる場合があります...');
    try {
      const status = await api.startGenerationServer({ contextSize: Number(generationSettings?.contextSize || 1024), forceRestart: false });
      setGenerationServerStatus(status);
      setGenerationMessage(status?.message || `llama-serverを起動しました。PID ${status?.pid || '-'}`);
    } catch (err: any) {
      setGenerationMessage(`llama-server起動に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }

  async function stopGenerationServerStatus() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('llama-serverを停止しています...');
    try {
      const status = await api.stopGenerationServer();
      setGenerationServerStatus(status);
      setGenerationMessage('llama-serverを停止しました。');
    } catch (err: any) {
      setGenerationMessage(`llama-server停止に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }


  function formatGenerationElapsedMs(elapsedMs: unknown): string {
    const ms = Number(elapsedMs || 0);
    if (!Number.isFinite(ms) || ms <= 0) return '0秒';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 10000) return `${(ms / 1000).toFixed(1)}秒`;
    return `${Math.round(ms / 1000)}秒`;
  }

  async function testGenerationEngineStatus() {
    if (!api) return;
    setGenerationBusy(true);
    setGenerationMessage('軽量テスト生成を実行しています。v344では1回だけ実行し、約12秒で停止します...');
    try {
      const result = await api.testGenerationEngine();
      if (!result?.ok) throw new Error(result?.error || 'テスト生成に失敗しました');
      setGenerationMessage(`テスト生成OK: ${result.text || '(出力あり)'} / ${formatGenerationElapsedMs(result.elapsedMs)} / ${result.command || 'llama実行'}`);
      if (result?.check) setGenerationCheck(result.check);
    } catch (err: any) {
      setGenerationMessage(`テスト生成に失敗しました: ${err?.message || err}`);
    } finally {
      setGenerationBusy(false);
    }
  }


  async function saveTransformerModelSettings() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('モデル設定を保存しています...');
    try {
      const result = await api.saveTransformerSettings({ ...(transformerSettings || {}), baseUpdatedAt: transformerSettings?.updatedAt });
      if (!result?.ok) throw new Error(result?.error || '保存に失敗しました');
      setTransformerSettings(result.settings);
      await refreshSemanticCacheInfo();
      // v459: re-read Workspace Semantic status after the server recreates the
      // service with the newly saved local cache directory.
      try { setWorkspaceSemanticInfo(await api.getWorkspaceSemanticIndexInfo()); } catch {}
      setTransformerModelMessage('モデル設定を保存しました。Semantic IndexのローカルSQLite接続も設定内容で再初期化しました。差分更新または全件再生成を実行してください。');
    } catch (err: any) {
      setTransformerModelMessage(`保存に失敗しました: ${err?.message || err}`);
    } finally {
      setTransformerModelBusy(false);
    }
  }

  async function downloadTransformerModelFromAdmin() {
    if (!api) return;
    setTransformerModelBusy(true);
    setTransformerModelMessage('モデルを取得しています。ネットワーク状況により数分かかります...');
    setModelLoadProgress({ active: true, label: 'モデル取得中', percent: 40 });
    try {
      const result = await api.downloadTransformerModel(transformerSettings);
      if (!result?.ok) throw new Error(result?.error || 'モデル取得に失敗しました');
      setTransformerSettings(result.settings);
      setTransformerModelCheck(result.check);
      const runtime = await api.getTransformerRuntimeInfo();
      setTransformerRuntimeInfo(runtime);
      setModelLoadProgress({ active: false, label: '完了', percent: 100 });
      setTransformerModelMessage('モデル取得が完了しました。FAQ管理で検索を再生成してください。');
    } catch (err: any) {
      setModelLoadProgress({ active: false, label: '失敗', percent: 0 });
      setTransformerModelMessage(`モデル取得に失敗しました: ${err?.message || err}`);
    } finally {
      setTransformerModelBusy(false);
    }
  }

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const sharedRecords = await api.listSmartFaqRecords();
        if (cancelled) return;
        const localRecords = loadLocalSmartFaqRecordsForMigration();
        if (sharedRecords.length === 0 && localRecords.length > 0) {
          const migrated = await api.saveSmartFaqRecords(localRecords);
          if (!cancelled) {
            setFaqRecords(migrated as SmartFaqRecord[]);
            setFaqSyncStatus(`共有フォルダへFAQを移行しました（${migrated.length}件）`);
            clearLocalSmartFaqMigrationCache();
          }
          return;
        }
        setFaqRecords(sharedRecords as SmartFaqRecord[]);
        setFaqSyncStatus(`共有FAQ ${sharedRecords.length}件`);
      } catch (err: any) {
        if (!cancelled) setFaqSyncStatus(`FAQ共有保存を読み込めません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listSmartAssistFeedback();
        if (!cancelled) {
          setAnswerFeedback(items as SmartAnswerFeedback[]);
          setAnswerFeedbackStatus(`回答フィードバック ${items.length}件`);
        }
      } catch (err: any) {
        if (!cancelled) setAnswerFeedbackStatus(`回答フィードバックを読み込めません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const [items, reports] = await Promise.all([api.listSmartAssistEvaluationSet(), api.listSmartAssistEvaluationReports()]);
        if (!cancelled) {
          setEvaluationEntries(Array.isArray(items) ? items : []);
          setEvaluationReports(Array.isArray(reports) ? reports : []);
        }
      } catch (err: any) {
        if (!cancelled) setOperationStatus(`評価データを読み込めません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listSmartAssistSynonyms();
        if (!cancelled) {
          setSmartSynonyms(items);
          setSmartSynonymJsonText(JSON.stringify(items, null, 2));
          setSmartSynonymStatus(`言い換え ${items.length}件`);
        }
      } catch (err: any) {
        if (!cancelled) setSmartSynonymStatus(`言い換え辞書を読み込めません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const items = await api.listSmartAssistRuleProfiles();
        if (!cancelled) {
          setSmartRuleProfiles(items);
          setSmartRuleProfileJsonText(JSON.stringify(items, null, 2));
          setSmartRuleProfileStatus(`ルール ${items.length}件`);
        }
      } catch (err: any) {
        if (!cancelled) setSmartRuleProfileStatus(`汎用ヒットルールを読み込めません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query), 160);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredFaqOverviewQuery(faqOverviewQuery), 180);
    return () => window.clearTimeout(timer);
  }, [faqOverviewQuery]);
  useEffect(() => {
    setFaqDisplayLimit(80);
    setSelectedFaqIds([]);
  }, [deferredFaqOverviewQuery, faqOverviewStatus]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.getSmartFaqSearchStats();
        if (!cancelled) {
          setFaqSearchStats(stats);
          setFaqSearchStatus(`SQLite FAQ検索: ${stats.indexedCount}/${stats.faqCount}件 indexed`);
        }
      } catch (err: any) {
        if (!cancelled) setFaqSearchStatus(`FAQ検索エンジン未使用: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api, faqRecords.length]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const info = await api.getWorkspaceSemanticIndexInfo();
        if (!cancelled) {
          setWorkspaceSemanticInfo(info);
          setWorkspaceSemanticStatus(info?.ok ? `Workspace Semantic: ${info.indexedCount || 0}件 indexed` : 'Workspace Semantic Indexは未生成です');
        }
      } catch (err: any) {
        if (!cancelled) setWorkspaceSemanticStatus(`Workspace Semanticを確認できません: ${err?.message ?? 'unknown error'}`);
      }
    })();
    return () => { cancelled = true; };
  }, [api, faqRecords.length, pages.length, databases.length, journals.length]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.querySmartFaqRecords({ q: deferredFaqOverviewQuery, status: faqOverviewStatus, limit: 500, offset: 0 });
        if (!cancelled) setFaqServerResult(result);
      } catch {
        if (!cancelled) setFaqServerResult(null);
      }
    })();
    return () => { cancelled = true; };
  }, [api, deferredFaqOverviewQuery, faqOverviewStatus, faqRecords.length]);
  // These diagnostic tools are only visible in the Details modal. Avoid full
  // corpus filters, ranking and all-pairs similarity work while the user is
  // simply chatting or editing a page.
  const detailToolsActive = showDetails;
  const filteredDocs = useMemo(
    () => !detailToolsActive ? [] : (scope === 'all' ? docs : docs.filter(doc => doc.kind === scope)),
    [detailToolsActive, docs, scope],
  );
  const results = useMemo(() => {
    if (!detailToolsActive) return [] as Array<SmartDoc & { score: number; reasons: string[] }>;
    const q = deferredQuery.trim();
    const normalizedQ = normalizeSmartText(q);
    const base = q ? filteredDocs.map(doc => {
      const queryScore = scoreSmartSearchQuery(q, doc);
      const haystack = normalizeSmartText(`${doc.title} ${doc.body} ${doc.tags.join(' ')} ${doc.tokenText}`);
      const surfaceBoost = normalizedQ && haystack.includes(normalizedQ) ? 38 : 0;
      const score = Math.max(0, Math.min(100, Math.round(queryScore.boost + surfaceBoost)));
      return { ...doc, score, reasons: [...queryScore.reasons, ...(surfaceBoost ? ['表層一致'] : []), ...keywordTagsForText(`${doc.title}\n${doc.body}`).slice(0, 3).map(r => `#${r.tag}`)] };
    }).filter(item => item.score >= 12) : filteredDocs.slice(0, 60).map(item => ({ ...item, score: 0, reasons: [] }));
    return base.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 100);
  }, [detailToolsActive, deferredQuery, filteredDocs]);
  const selected = detailToolsActive ? (docs.find(doc => doc.id === selectedId) || results[0] || docs[0] || null) : null;
  const suggestions = useMemo<SmartSuggestion[]>(() => {
    if (!detailToolsActive || !selected) return [];
    const text = `${selected.title}\n${selected.body}`;
    const tagSuggestions = keywordTagsForText(text).filter(item => !selected.tags.includes(item.tag)).slice(0, 8).map(item => ({ id: `tag:${item.tag}`, kind: 'tag' as const, title: `タグ候補：${item.tag}`, detail: `検出語: ${item.hits.join(' / ')}`, confidence: Math.min(98, 55 + item.hits.length * 12), target: selected }));
    const todos = extractTodoCandidates(text).map((todo, i) => ({ id: `todo:${i}`, kind: 'todo' as const, title: `TODO候補：${todo}`, detail: 'ルールベース抽出：期限・確認・作成・連絡などの表現を検出しました。', confidence: 72, target: selected }));
    const similar = docs.filter(doc => doc.id !== selected.id).map(doc => ({ doc, score: scoreDocSimilarity(selected, doc) })).filter(item => item.score >= 34).sort((a, b) => b.score - a.score).slice(0, 12);
    const relations = similar.map(item => ({ id: `relation:${item.doc.id}`, kind: 'relation' as const, title: `Relation候補：${item.doc.title}`, detail: `類似度 ${item.score}。${relationReasonFor(selected, item.doc)}`, confidence: Math.min(96, item.score), target: selected, related: item.doc }));
    const duplicates = similar.filter(item => item.score >= 72 && item.doc.kind === selected.kind).slice(0, 5).map(item => ({ id: `dup:${item.doc.id}`, kind: 'duplicate' as const, title: `重複候補：${item.doc.title}`, detail: `類似度 ${item.score}。同じ内容の可能性があります。`, confidence: item.score, target: selected, related: item.doc }));
    const cleanup: SmartSuggestion[] = [];
    if (selected.kind === 'row' && selected.body.match(/:\s*(\n|$)/)) cleanup.push({ id: 'cleanup:empty', kind: 'cleanup', title: '空欄が多いDB行かもしれません', detail: '未入力プロパティを確認してください。', confidence: 64, target: selected });
    if (selected.kind === 'page' && selected.tags.length === 0) cleanup.push({ id: 'cleanup:no-tags', kind: 'cleanup', title: 'タグ未設定ページ', detail: '候補タグを設定すると検索・Relation候補が強くなります。', confidence: 70, target: selected });
    const summary = importantExtractiveSummary(text).length ? [{ id: 'summary:extract', kind: 'summary' as const, title: '重要文抽出', detail: importantExtractiveSummary(text).join(' / '), confidence: 68, target: selected }] : [];
    return [...tagSuggestions, ...todos, ...relations, ...duplicates, ...cleanup, ...summary].sort((a, b) => b.confidence - a.confidence).slice(0, 36);
  }, [detailToolsActive, selected, docs]);
  const tokenPreview = selected ? smartTokens(`${selected.title}\n${selected.body}`).slice(0, 40) : [];
  const summaryLines = selected ? importantExtractiveSummary(`${selected.title}\n${selected.body}`) : [];
  const topSources = useMemo(() => chatMessages.slice().reverse().find(message => message.role === 'assistant' && message.sources?.length)?.sources || [], [chatMessages]);
  const faqStats = useMemo(() => ({
    total: faqRecords.length,
    approved: faqRecords.filter(r => r.status === 'approved').length,
    reviewed: faqRecords.filter(r => r.status === 'reviewed').length,
    draft: faqRecords.filter(r => r.status === 'draft').length,
    hidden: faqRecords.filter(r => r.status === 'hidden').length,
    pdf: faqRecords.filter(r => r.sourceType === 'pdf' || r.sourcePdfName).length,
    categories: Array.from(new Set(faqRecords.map(r => r.category).filter(Boolean))).slice(0, 12),
  }), [faqRecords]);

  const faqKnowledgeBase = useMemo(() => {
    const categories = Array.from(faqRecords.reduce((map, record) => {
      const key = record.category || '未分類';
      const current = map.get(key) || { name: key, total: 0, approved: 0, reviewed: 0, draft: 0 };
      current.total += 1;
      if (record.status === 'approved') current.approved += 1;
      if (record.status === 'reviewed') current.reviewed += 1;
      if (record.status === 'draft') current.draft += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { name: string; total: number; approved: number; reviewed: number; draft: number }>() ).values()).sort((a, b) => b.total - a.total).slice(0, 8);
    const pdfs = Array.from(faqRecords.reduce((map, record) => {
      const key = record.sourcePdfName || (record.sourceType === 'pdf' ? record.sourceTitles?.[0] || 'PDF由来FAQ' : '');
      if (!key) return map;
      const current = map.get(key) || { name: key, total: 0, approved: 0, reviewed: 0 };
      current.total += 1;
      if (record.status === 'approved') current.approved += 1;
      if (record.status === 'reviewed') current.reviewed += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { name: string; total: number; approved: number; reviewed: number }>() ).values()).sort((a, b) => b.total - a.total).slice(0, 6);
    return { categories, pdfs };
  }, [faqRecords]);
  const unansweredFaqRecords = useMemo(() => faqRecords.filter(record => record.category === '未回答FAQ' || record.tags.includes('未回答')), [faqRecords]);
  const faqQualityMap = useMemo(() => new Map(faqRecords.map(record => [record.id, scoreFaqQuality(record)])), [faqRecords]);
  const faqReviewQueue = useMemo(() => {
    const draft = faqRecords.filter(record => record.status === 'draft' && !record.tags.includes('未回答')).slice(0, 12);
    const unanswered = faqRecords.filter(record => record.category === '未回答FAQ' || record.tags.includes('未回答')).slice(0, 12);
    const lowQuality = faqRecords
      .filter(record => record.status !== 'hidden' && (faqQualityMap.get(record.id)?.score ?? 0) < 65)
      .sort((a, b) => (faqQualityMap.get(a.id)?.score ?? 0) - (faqQualityMap.get(b.id)?.score ?? 0))
      .slice(0, 12);
    const noSource = faqRecords.filter(record => record.status !== 'hidden' && !record.sourceTitles.length && !record.sourceText && !record.sourcePdfName).slice(0, 12);
    return { draft, unanswered, lowQuality, noSource };
  }, [faqRecords, faqQualityMap]);

  const popularQuestionChips = useMemo(() => {
    const fromFaq = faqRecords
      .filter(record => record.status !== 'hidden')
      .flatMap(record => [
        ...(Array.isArray(record.likelyQuestions) ? record.likelyQuestions : []),
        ...(Array.isArray(record.testQuestions) ? record.testQuestions : []),
        record.question,
      ])
      .map(text => String(text || '').trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return fromFaq.filter(text => {
      const key = normalizeSmartText(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12);
  }, [faqRecords]);

  const questionRankingStats = useMemo(() => {
    const counts = new Map<string, { question: string; count: number; good: number; bad: number }>();
    const add = (question: string, kind?: 'good' | 'bad') => {
      const q = String(question || '').trim();
      if (!q) return;
      const key = normalizeSmartText(q);
      const current = counts.get(key) || { question: q, count: 0, good: 0, bad: 0 };
      current.count += 1;
      if (kind === 'good') current.good += 1;
      if (kind === 'bad') current.bad += 1;
      counts.set(key, current);
    };
    chatMessages.forEach(message => { if (message.role === 'user') add(message.text); });
    answerFeedback.forEach(item => add(item.question, item.rating));
    return Array.from(counts.values()).sort((a, b) => (b.count + b.bad * 2) - (a.count + a.bad * 2)).slice(0, 20);
  }, [chatMessages, answerFeedback]);

  const csvEscape = (value: unknown) => {
    const text = Array.isArray(value) ? value.join('、') : String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const exportFaqCsv = async () => {
    const headers = ['id', 'status', 'category', 'question', 'answer', 'tags', 'likelyQuestions', 'paraphrases', 'negativeTerms', 'sourceTitle', 'sourcePage'];
    const rows = faqRecords.map(record => [
      record.id,
      record.status,
      record.category,
      record.question,
      record.answer,
      record.tags,
      record.likelyQuestions || record.testQuestions || [],
      record.paraphrases || [],
      record.negativeTerms || [],
      record.sourceTitles?.[0] || record.sourcePdfName || record.source?.title || '',
      record.sourcePage || record.source?.page || '',
    ].map(csvEscape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(csv);
      setFaqSyncStatus('FAQ CSVをクリップボードにコピーしました');
    } catch {
      setFaqCsvText(csv);
      setFaqCsvError('クリップボードにコピーできないため、下のCSVをコピーしてください。');
      setShowFaqCsvImport(true);
    }
  };

  const parseFaqCsv = (csv: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < csv.length; i += 1) {
      const ch = csv[i];
      const next = csv[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    row.push(cell);
    if (row.some(v => v.trim())) rows.push(row);
    return rows;
  };

  const splitCsvList = (value: unknown) => String(value || '').split(/[、;；|]/).map(v => v.trim()).filter(Boolean);

  const runFaqCsvImport = async () => {
    const raw = faqCsvText.trim();
    if (!raw) { setFaqCsvError('CSVを貼り付けてください。'); return; }
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: 'FAQ CSV取込', detail: 'CSVを解析しています...', phase: 'running', startedAt });
    try {
      const rows = parseFaqCsv(raw);
      const header = rows.shift()?.map(v => v.trim()) || [];
      if (!header.length) throw new Error('ヘッダー行がありません。');
      const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
      const now = new Date().toISOString();
      const imported = rows.map((row, index) => {
        const get = (name: string) => { const i = idx(name); return i >= 0 ? row[i] : ''; };
        const question = get('question').trim();
        const answer = get('answer').trim();
        if (!question || !answer) return null;
        return {
          id: get('id').trim() || `faq_csv_${Date.now()}_${index}`,
          status: (get('status').trim() as SmartFaqStatus) || 'reviewed',
          category: get('category').trim() || '未分類',
          question,
          answer,
          tags: splitCsvList(get('tags')),
          likelyQuestions: splitCsvList(get('likelyQuestions')),
          paraphrases: splitCsvList(get('paraphrases')),
          negativeTerms: splitCsvList(get('negativeTerms')),
          sourceTitles: get('sourceTitle').trim() ? [get('sourceTitle').trim()] : [],
          sourcePage: get('sourcePage').trim(),
          sourceDocIds: [],
          confidence: 88,
          createdAt: now,
          updatedAt: now,
          sourceType: 'import' as const,
        } as SmartFaqRecord;
      }).filter(Boolean) as SmartFaqRecord[];
      const { unique, duplicates } = dedupeImportedFaqRecords(imported, faqRecords);
      await saveFaqRecordsShared([...unique, ...faqRecords].slice(0, 10000), `FAQ CSVを${unique.length}件インポートしました（重複 ${duplicates.length}件）`);
      setFaqCsvError('');
      setShowFaqCsvImport(false);
      setFaqCsvText('');
      setOperationProgress({ busy: false, label: 'FAQ CSV取込', detail: `新規 ${unique.length}件 / 重複 ${duplicates.length}件 ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `CSV取込に失敗しました: ${err?.message ?? 'CSV形式を確認してください'}`;
      setFaqCsvError(message);
      setOperationProgress({ busy: false, label: 'FAQ CSV取込', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };


  const aiDataLabels: Record<string, { title: string; description: string; json: boolean; csv: boolean; columns?: string; jsonShape: string; sample: string; whenToUse: string }> = {
    faq: {
      title: 'FAQ本体',
      description: 'ユーザーに返す質問・回答・想定質問・出典を管理します。通常はこのデータが一番重要です。',
      json: true,
      csv: true,
      columns: 'id,status,category,question,answer,tags,likelyQuestions,paraphrases,negativeTerms,sourceTitle,sourcePage',
      jsonShape: '[{ id, question, answer, category, tags[], likelyQuestions[], paraphrases[], negativeTerms[], source }]',
      sample: '[{"id":"faq_001","question":"学童の費用は？","answer":"利用案内で確認します。","category":"放課後児童クラブ","likelyQuestions":["学童クラブの費用はどれくらいですか"],"source":{"title":"利用案内","page":"p.1"}}]',
      whenToUse: 'FAQを増やす・回答本文を修正する・想定質問を追加する時に使います。'
    },
    evaluation: {
      title: '評価セット',
      description: '検索精度を自動測定するための「質問」と「正解FAQ ID」の一覧です。',
      json: true,
      csv: true,
      columns: 'question,expectedFaqId,note',
      jsonShape: '[{ question, expectedFaqId, note? }]',
      sample: '[{"question":"学童クラブの費用はどれくらいですか","expectedFaqId":"faq_001","note":"費用FAQに当たること"}]',
      whenToUse: '検索ロジック変更後に正答率を測るためのテスト問題を増やす時に使います。'
    },
    normalization: {
      title: '表記揺れ辞書',
      description: '入力された言葉を検索前に正規化します。例：有休→有給休暇、ロゴフォーム→LoGoフォーム。',
      json: true,
      csv: true,
      columns: 'from,to',
      jsonShape: '{ version, rules: [{ from, to }] } または [{ from, to }]',
      sample: '{"version":226,"rules":[{"from":"有休","to":"有給休暇"},{"from":"ロゴフォーム","to":"LoGoフォーム"}]}',
      whenToUse: '同じ意味なのに表記が違う言葉を、検索前に統一したい時に使います。'
    },
    fallback: {
      title: '担当先・フォールバック',
      description: '該当FAQが見つからない時に表示する担当係・部署・内線です。',
      json: true,
      csv: true,
      columns: 'category,label,department,extension,note',
      jsonShape: '{ defaultContact, categories: [{ category, label, department, extension, note }] }',
      sample: '{"defaultContact":{"label":"担当係","department":"担当課","extension":"内線未設定"},"categories":[{"category":"放課後児童クラブ","label":"学童担当","department":"青少年育成課","extension":"0000"}]}',
      whenToUse: '0件・低信頼時に「誰に確認すればよいか」を表示したい時に使います。'
    },
    synonyms: {
      title: '言い換え辞書',
      description: '旧互換用の同義語データです。通常は表記揺れ辞書と likelyQuestions を優先してください。',
      json: true,
      csv: true,
      columns: 'id,base,variants,intentId,category',
      jsonShape: '[{ id, base, variants[], intentId?, category? }]',
      sample: '[{"id":"syn_001","base":"費用","variants":["料金","利用料"],"category":"放課後児童クラブ"}]',
      whenToUse: '古い同義語データを移行・バックアップする時だけ使います。'
    },
    rules: {
      title: '汎用ルール',
      description: '短文補正やカテゴリ補正用の高度な設定です。通常運用では触らなくて大丈夫です。',
      json: true,
      csv: true,
      columns: 'id,label,category,intentId,queryTerms',
      jsonShape: '[{ id, label, category, intentId, queryTerms[] }]',
      sample: '[{"id":"rule_fee","label":"費用系","category":"放課後児童クラブ","intentId":"afterschool.fee.general","queryTerms":["費用","料金","利用料"]}]',
      whenToUse: '短文質問の補正など、FAQだけでは制御しにくい時に使います。'
    },
    feedback: {
      title: '回答フィードバック',
      description: '👍👎と質問ログです。改善候補の確認やバックアップに使います。',
      json: true,
      csv: true,
      columns: 'question,rating,answer,createdAt',
      jsonShape: '[{ question, rating, answer, createdAt, faqId? }]',
      sample: '[{"question":"費用を教えて","rating":"bad","answer":"誤回答本文","createdAt":"2026-06-11T00:00:00.000Z"}]',
      whenToUse: '利用者の評価ログをバックアップ・分析したい時に使います。'
    },
  };

  const downloadTextFile = async (filename: string, text: string, mime = 'application/json;charset=utf-8') => {
    try {
      await navigator.clipboard.writeText(text);
      setFaqSyncStatus(`${filename} をクリップボードにコピーしました`);
      return;
    } catch {}
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFaqSyncStatus(`${filename} を書き出しました`);
  };

  const getAiDataPayload = async (kind: string): Promise<any> => {
    if (!api) throw new Error('API未接続です');
    if (kind === 'faq') return { version: 225, exportedAt: new Date().toISOString(), items: faqRecords };
    if (kind === 'evaluation') return { version: 225, exportedAt: new Date().toISOString(), items: await api.listSmartAssistEvaluationSet() };
    if (kind === 'normalization') return await api.listSmartAssistQueryNormalizationRules();
    if (kind === 'fallback') return await api.listSmartAssistFallbackContacts();
    if (kind === 'synonyms') return { version: 225, exportedAt: new Date().toISOString(), items: await api.listSmartAssistSynonyms() };
    if (kind === 'rules') return { version: 225, exportedAt: new Date().toISOString(), items: await api.listSmartAssistRuleProfiles() };
    if (kind === 'feedback') return { version: 225, exportedAt: new Date().toISOString(), items: await api.listSmartAssistFeedback() };
    throw new Error('未対応のデータ種別です');
  };

  const arrayToCsv = (items: any[], headers: string[]) => {
    const rows = items.map(item => headers.map(h => csvEscape(Array.isArray(item?.[h]) ? item[h].join('、') : item?.[h] ?? '')).join(','));
    return [headers.join(','), ...rows].join('\n');
  };

  const payloadToCsv = (kind: string, payload: any) => {
    if (kind === 'faq') {
      const headers = ['id', 'status', 'category', 'question', 'answer', 'tags', 'likelyQuestions', 'paraphrases', 'negativeTerms', 'sourceTitle', 'sourcePage'];
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const rows = items.map((record: any) => [record.id, record.status, record.category, record.question, record.answer, record.tags, record.likelyQuestions || record.testQuestions || [], record.paraphrases || [], record.negativeTerms || [], record.sourceTitles?.[0] || record.sourcePdfName || record.source?.title || '', record.sourcePage || record.source?.page || ''].map(csvEscape).join(','));
      return [headers.join(','), ...rows].join('\n');
    }
    if (kind === 'evaluation') return arrayToCsv(Array.isArray(payload?.items) ? payload.items : [], ['question', 'expectedFaqId', 'note']);
    if (kind === 'normalization') return arrayToCsv(Array.isArray(payload?.rules) ? payload.rules : Array.isArray(payload) ? payload : [], ['from', 'to']);
    if (kind === 'fallback') return arrayToCsv(Array.isArray(payload?.categories) ? payload.categories : [], ['category', 'label', 'department', 'extension', 'note']);
    if (kind === 'synonyms') return arrayToCsv(Array.isArray(payload?.items) ? payload.items : [], ['id', 'base', 'variants', 'intentId', 'category']);
    if (kind === 'rules') return arrayToCsv(Array.isArray(payload?.items) ? payload.items : [], ['id', 'label', 'category', 'intentId', 'queryTerms']);
    if (kind === 'feedback') return arrayToCsv(Array.isArray(payload?.items) ? payload.items : [], ['question', 'rating', 'answer', 'createdAt']);
    return '';
  };

  const exportAiData = async (kind: string, format: 'json' | 'csv') => {
    try {
      const payload = await getAiDataPayload(kind);
      const label = aiDataLabels[kind]?.title || kind;
      if (format === 'csv') {
        await downloadTextFile(`smart-assist-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, payloadToCsv(kind, payload), 'text/csv;charset=utf-8');
      } else {
        await downloadTextFile(`smart-assist-${kind}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      }
      setOperationProgress({ busy: false, label: `${label}出力`, detail: `${format.toUpperCase()}を書き出しました`, phase: 'success', completedAt: new Date().toISOString() });
    } catch (err: any) {
      setOperationProgress({ busy: false, label: 'AIデータ出力', detail: err?.message ?? '出力に失敗しました', phase: 'error', completedAt: new Date().toISOString() });
    }
  };

  const openAiDataImport = (kind: string, format: 'json' | 'csv') => {
    setAiDataImport({ open: true, kind, format, text: '', error: '' });
  };

  const parseGenericCsvObjects = (csv: string) => {
    const rows = parseFaqCsv(csv);
    const header = rows.shift()?.map(v => v.trim()) || [];
    return rows.map(row => Object.fromEntries(header.map((h, i) => [h, row[i] ?? ''])));
  };

  const saveAiDataPayload = async (kind: string, payload: any, format: 'json' | 'csv') => {
    if (!api) throw new Error('API未接続です');
    if (kind === 'faq') {
      if (format === 'csv') {
        const rows = parseFaqCsv(aiDataImport.text);
        const header = rows.shift()?.map(v => v.trim()) || [];
        const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
        const now = new Date().toISOString();
        const imported = rows.map((row, index) => {
          const get = (name: string) => { const i = idx(name); return i >= 0 ? row[i] : ''; };
          const question = get('question').trim();
          const answer = get('answer').trim();
          if (!question || !answer) return null;
          return { id: get('id').trim() || `faq_csv_${Date.now()}_${index}`, status: (get('status').trim() as SmartFaqStatus) || 'reviewed', category: get('category').trim() || '未分類', question, answer, tags: splitCsvList(get('tags')), likelyQuestions: splitCsvList(get('likelyQuestions')), paraphrases: splitCsvList(get('paraphrases')), negativeTerms: splitCsvList(get('negativeTerms')), sourceTitles: get('sourceTitle').trim() ? [get('sourceTitle').trim()] : [], sourcePage: get('sourcePage').trim(), sourceDocIds: [], confidence: 88, createdAt: now, updatedAt: now, sourceType: 'import' as const } as SmartFaqRecord;
        }).filter(Boolean) as SmartFaqRecord[];
        const { unique, duplicates } = dedupeImportedFaqRecords(imported, faqRecords);
        await saveFaqRecordsShared([...unique, ...faqRecords].slice(0, 10000), `FAQ CSVを${unique.length}件インポートしました（重複 ${duplicates.length}件）`);
        return;
      }
      const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
      const imported = items.map(normalizeImportedFaqRecord).filter(Boolean) as SmartFaqRecord[];
      const { unique, duplicates } = dedupeImportedFaqRecords(imported, faqRecords);
      await saveFaqRecordsShared([...unique, ...faqRecords].slice(0, 10000), `FAQ JSONを${unique.length}件インポートしました（重複 ${duplicates.length}件）`);
      return;
    }
    if (kind === 'evaluation') {
      const items = format === 'csv' ? parseGenericCsvObjects(aiDataImport.text) : (Array.isArray(payload) ? payload : payload.items || []);
      await api.saveSmartAssistEvaluationSet(items);
      return;
    }
    if (kind === 'normalization') {
      const next = format === 'csv' ? { version: 225, rules: parseGenericCsvObjects(aiDataImport.text).filter((r: any) => r.from && r.to) } : payload;
      await api.saveSmartAssistQueryNormalizationRules(next);
      return;
    }
    if (kind === 'fallback') {
      const next = format === 'csv' ? { version: 225, categories: parseGenericCsvObjects(aiDataImport.text), defaultContact: { label: '担当係', department: '担当課', extension: '内線未設定' } } : payload;
      await api.saveSmartAssistFallbackContacts(next);
      return;
    }
    if (kind === 'synonyms') {
      const items = format === 'csv' ? parseGenericCsvObjects(aiDataImport.text).map((r: any) => ({ ...r, variants: splitCsvList(r.variants) })) : (Array.isArray(payload) ? payload : payload.items || []);
      const saved = await api.saveSmartAssistSynonyms(items); setSmartSynonyms(saved); setSmartSynonymJsonText(JSON.stringify(saved, null, 2));
      return;
    }
    if (kind === 'rules') {
      const items = format === 'csv' ? parseGenericCsvObjects(aiDataImport.text).map((r: any) => ({ ...r, queryTerms: splitCsvList(r.queryTerms) })) : (Array.isArray(payload) ? payload : payload.items || []);
      const saved = await api.saveSmartAssistRuleProfiles(items); setSmartRuleProfiles(saved); setSmartRuleProfileJsonText(JSON.stringify(saved, null, 2));
      return;
    }
    if (kind === 'feedback') {
      const items = format === 'csv' ? parseGenericCsvObjects(aiDataImport.text) : (Array.isArray(payload) ? payload : payload.items || []);
      const saved = await api.saveSmartAssistFeedback(items); setAnswerFeedback(saved);
      return;
    }
  };

  const runAiDataImport = async () => {
    const raw = aiDataImport.text.trim();
    if (!raw) { setAiDataImport(prev => ({ ...prev, error: '取り込むデータを貼り付けてください。' })); return; }
    const label = aiDataLabels[aiDataImport.kind]?.title || aiDataImport.kind;
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: `${label}取込`, detail: `${aiDataImport.format.toUpperCase()}を解析しています...`, phase: 'running', startedAt });
    try {
      const payload = aiDataImport.format === 'json' ? JSON.parse(raw) : null;
      await saveAiDataPayload(aiDataImport.kind, payload, aiDataImport.format);
      setAiDataImport(prev => ({ ...prev, open: false, text: '', error: '' }));
      setOperationProgress({ busy: false, label: `${label}取込`, detail: `${label}を取り込みました。必要に応じて検索・意味ベクトル再生成を実行してください。`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      setAiDataImport(prev => ({ ...prev, error: err?.message ?? '取込に失敗しました。形式を確認してください。' }));
      setOperationProgress({ busy: false, label: `${label}取込`, detail: err?.message ?? '取込に失敗しました', phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };


  const quickQuestions = ['この情報の要点は？', '手順として教えて', 'TODOだけ抽出して', '期限・日付だけ確認して', '関連しそうなページは？', 'FAQ化できる内容は？'];
  // おすすめ質問・固定質問はv159で削除し、必要な導線はFAQレビューと見つからない時の提案へ集約。
  type WorkspaceAiAskOptions = {
    sourceMode?: 'auto' | 'pinned_only';
    pinnedSourceKeys?: string[];
    pinnedSourceItems?: any[];
    excludedSourceKeys?: string[];
    statusPrefix?: string;
  };

  const autoQueueAssistantAnswerIfNeeded = async (question: string, assistant: SmartChatMessage) => {
    if (!api || assistant.feedbackState === 'good' || assistant.feedbackState === 'bad' || assistant.feedbackState === 'queued') return;
    const sourceCount = assistant.sources?.length || assistant.answerStatus?.sourceCount || 0;
    const confidence = Number.isFinite(Number(assistant.confidence)) ? Number(assistant.confidence) : 0;
    const reasons: string[] = [];
    if (!sourceCount) reasons.push('根拠0件');
    if (assistant.confidenceLevel === 'insufficient') reasons.push('信頼度不足');
    if (confidence > 0 && confidence < 43) reasons.push(`低信頼度${Math.round(confidence)}%`);
    if (assistant.answerStatus?.warning) reasons.push(`警告:${assistant.answerStatus.warning}`);
    if (assistant.engine === 'workspace-ai' && assistant.answerStatus && !assistant.answerStatus.generated && (sourceCount < 2 || confidence < 58)) reasons.push('生成AIフォールバック');
    if (!reasons.length) return;
    const payload = {
      id: `auto_improve_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question,
      confidence: confidence || undefined,
      confidenceLevel: assistant.confidenceLevel,
      reason: `auto-v370:${reasons.join('/')}`,
      matchedFaqId: assistant.matchedFaqId || assistant.sources?.[0]?.sourceId || '',
      matchedFaqTitle: assistant.matchedFaqTitle || assistant.sources?.[0]?.title || '',
      candidates: assistant.candidateFaqs || [],
      response: {
        trigger: 'auto-low-confidence-v370',
        engine: assistant.engine || 'unknown',
        answerPreview: assistant.text.slice(0, 1200),
        answerStatus: assistant.answerStatus || undefined,
        sourceIds: assistant.sources?.map(source => source.id).slice(0, 12) || [],
        sourceTitles: assistant.sources?.map(source => source.title).slice(0, 12) || [],
      },
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    try {
      await api.addSmartAssistImprovementQueue(payload);
      setChatMessages(prev => prev.map(message => message.id === assistant.id ? { ...message, feedbackState: 'queued' } : message));
      setAnswerFeedbackStatus(`低信頼回答を改善キューへ自動登録しました（${reasons.join(' / ')}）`);
      try { setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(await api.listLowConfidenceSmartAssistLogs())); } catch {}
    } catch {
      // 自動登録は回答表示を妨げない。手動の👎で再登録できる。
    }
  };

  const askLocalFaq = async (question?: string, options: WorkspaceAiAskOptions = {}) => {
    const q = (question ?? chatQuestion).trim();
    if (!q) return;
    const stamp = Date.now();
    const userMessage: SmartChatMessage = { id: `user:${stamp}`, role: 'user', text: q };
    setChatMessages(prev => [...prev, userMessage].slice(-40));
    setChatQuestion('');
    setQuery(q);

    let rawAnswer: SmartChatMessage | null = null;
    let usedWorkspaceAi = false;
    if (api) {
      try {
        const recentContext = chatMessages.slice(-8).map(message => ({ role: message.role, text: message.text.slice(0, 700) }));
        const pinnedItems = options.pinnedSourceItems?.length ? options.pinnedSourceItems : pinnedWorkspaceSourceItems;
        const pinnedKeys = options.pinnedSourceKeys?.length ? options.pinnedSourceKeys : pinnedItems.map(workspaceSourceKeyFromResult).filter(Boolean);
        const excludedKeys = options.excludedSourceKeys?.length ? options.excludedSourceKeys : excludedWorkspaceSourceKeys;
        const inferredTagHints = inferSmartRelatedTags({ question: q, pages, faqRecords, aliases: tagAliases, presentation: tagPresentation });
        const tagHints = inferredTagHints.map((item) => item.tag);
        const tagHintGroups = Object.fromEntries(inferredTagHints.filter((item) => item.group).map((item) => [item.tag, item.group]));
        const result = await api.generateWorkspaceAiChatAnswer({
          question: q,
          tagHints,
          tagHintGroups,
          answerMode: answerMode === 'steps' ? 'steps' : answerMode === 'detail' ? 'detail' : answerMode === 'evidence' ? 'evidence' : 'standard',
          answerLength: answerMode === 'short' ? 'short' : answerMode === 'detail' || answerMode === 'evidence' ? 'long' : 'standard',
          pageReadMode: answerMode === 'detail' || answerMode === 'evidence' ? 'standard' : 'fast',
          tonePreset: 'smart',
          recentMessages: chatHistoryEnabled ? recentContext : [],
          pinnedSourceKeys: pinnedKeys,
          pinnedSourceItems: pinnedItems,
          excludedSourceKeys: excludedKeys,
          sourceMode: options.sourceMode || 'auto',
        });
        rawAnswer = composeWorkspaceAiChatAnswer(q, result);
        usedWorkspaceAi = Boolean(rawAnswer);
        if (result) {
          const planLabel = result.answerPlan?.label || result.answerPlan?.intent || 'ワークスペース回答';
          const sourceCount = Array.isArray(result.results) ? result.results.length : 0;
          const modeLabel = result.grounding?.sourceMode === 'pinned_only' ? '固定根拠のみ' : pinnedKeys.length ? '固定根拠あり' : '自動根拠';
          setFaqSearchStatus(`${options.statusPrefix || '生成AI回答'}: ${planLabel} / 根拠 ${sourceCount}件 / ${modeLabel} / ${result.generated ? '生成あり' : '検索ベース'}`);
        }
      } catch {
        rawAnswer = null;
        usedWorkspaceAi = false;
      }

      if (!rawAnswer) {
        try {
          const result = await api.querySmartFaqRecords({ q, status: 'all', limit: 8, offset: 0 });
          rawAnswer = composeServerFaqSearchAnswer(q, result);
          if (result) {
            setFaqServerResult(result);
            setFaqSearchStatus(`FAQ検索: ${result.items?.length || 0}/${result.faqCount || faqRecords.length}件 hit`);
          }
        } catch {
          rawAnswer = null;
        }
      }
    }

    if (!rawAnswer) rawAnswer = { ...composeLocalFaqAnswerWithRecords(q, docs, faqRecords), engine: 'local-fallback' };
    let relatedEvidence: SmartRelatedEvidenceItem[] = rawAnswer.relatedEvidence || [];
    if (api && !usedWorkspaceAi) {
      try {
        const semantic = await api.searchWorkspaceSemantic(q, { limit: 24 });
        relatedEvidence = normalizeSmartRelatedEvidence(semantic);
      } catch {
        relatedEvidence = [];
      }
    }
    const answer = {
      ...rawAnswer,
      id: `assistant:${stamp}:answer`,
      text: rawAnswer.engine === 'workspace-ai' ? rawAnswer.text : applySmartAnswerMode(rawAnswer.text, answerMode),
      relatedEvidence,
      relatedTags: inferSmartRelatedTags({ question: q, sources: rawAnswer.sources, pages, faqRecords, aliases: tagAliases, presentation: tagPresentation }),
    };
    setChatMessages(prev => [...prev, answer].slice(-40));
    setFocusMessageId(answer.id);
    void autoQueueAssistantAnswerIfNeeded(q, answer);
  };
  const lastAssistant = [...chatMessages].reverse().find(message => message.role === 'assistant' && message.sources?.length);
  const lastUser = [...chatMessages].reverse().find(message => message.role === 'user');
  const weakAnswer = Boolean(lastAssistant && ((lastAssistant.confidenceLevel === 'insufficient') || ((lastAssistant.confidence ?? 100) < 42)));
  const saveLastAnswerAsFaq = async () => {
    if (!lastAssistant || !lastUser) return;
    await addFaqRecord(buildFaqRecordFromChatAnswer(lastUser.text, lastAssistant, 'draft'));
  };

  const saveChatAnswerAsFaqDraft = async (question: string, assistant: SmartChatMessage) => {
    const q = String(question || '').trim();
    if (!q || !assistant) return;
    await addFaqRecord(buildFaqRecordFromChatAnswer(q, assistant, 'draft'));
    setFaqSyncStatus('チャット回答をFAQ下書きとして保存しました。内容を確認して承認してください。');
    setSmartAdminTab('faq');
    setShowSmartAssistControlPanel(true);
    setFaqOverviewStatus('draft');
  };

  const saveLastQuestionAsUnansweredFaq = async () => {
    if (!lastUser) return;
    const now = new Date().toISOString();
    await addFaqRecord({
      id: `faq_unanswered_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: lastUser.text,
      answer: '',
      category: '未回答FAQ',
      tags: ['未回答', '要確認'],
      status: 'draft',
      sourceDocIds: lastAssistant?.sources?.map(source => source.id) || [],
      sourceTitles: lastAssistant?.sources?.map(source => source.title) || [],
      confidence: 0,
      createdAt: now,
      updatedAt: now,
      sourceType: 'chat',
      sourceText: lastAssistant?.text.slice(0, 1200) || '',
    });
    setFaqSyncStatus('未回答FAQとして保存しました。あとで回答を追記して承認FAQへ育てられます。');
    setSmartAdminTab('faq');
    setShowSmartAssistControlPanel(true);
    setFaqOverviewStatus('draft');
  };

  const handleSuggestionClick = (label: string, kind: 'question' | 'action' | 'clarify' = 'question') => {
    const text = label.trim();
    if (!text) return;
    if (text === 'この回答をFAQとして保存する') { saveLastAnswerAsFaq(); return; }
    if (text === 'この質問を未回答FAQとして保存する') { saveLastQuestionAsUnansweredFaq(); return; }
    const actionQuestionMap: Record<string, string> = {
      '詳しく教えて': lastUser?.text ? `${lastUser.text} について詳しく教えて` : text,
      '手順で教えて': lastUser?.text ? `${lastUser.text} を手順で教えて` : text,
      '問い合わせ文を作成する': lastUser?.text ? `${lastUser.text} について担当課への問い合わせ文を作成して` : text,
      '担当者に確認するための文面を作成する': lastUser?.text ? `${lastUser.text} について担当者に確認する文面を作成して` : text,
      'この候補で合っている': lastUser?.text ? `${lastUser.text} についてこの候補で詳しく教えて` : text,
      '別の候補を表示する': lastUser?.text ? `${lastUser.text} の別候補を表示して` : text,
      'もう少し詳しく回答する': lastUser?.text ? `${lastUser.text} についてもう少し詳しく回答して` : text,
    };
    const next = actionQuestionMap[text] || text;
    if (kind === 'action' && !/[？?]$/.test(next) && !/(教えて|確認|作成|ありますか|できますか|ですか|ください|して)$/.test(next)) {
      setChatQuestion(lastUser?.text ? `${lastUser.text} ${next}` : next);
      return;
    }
    askLocalFaq(next);
  };

  const pinQuestion = (question: string) => {
    const q = question.trim();
    if (!q) return;
    setPinnedQuestions(prev => [q, ...prev.filter(item => item !== q)].slice(0, 12));
  };
  const unpinQuestion = (question: string) => setPinnedQuestions(prev => prev.filter(item => item !== question));
  const openImproveAnswer = () => {
    if (!lastAssistant) return;
    setImprovedAnswerText(lastAssistant.text.replace(/^Local Generative Assist.*$/m, '').replace(/^質問:.*$/m, '').trim());
    setShowImproveAnswer(true);
  };
  const saveImprovedAnswerAsFaq = async () => {
    if (!lastUser || !improvedAnswerText.trim()) return;
    const now = new Date().toISOString();
    await addFaqRecord({
      id: `faq_improved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: lastUser.text,
      answer: improvedAnswerText.trim(),
      category: '改善済み回答',
      tags: ['FAQ', '回答改善'],
      status: 'approved',
      sourceDocIds: lastAssistant?.sources?.map(source => source.id) || [],
      sourceTitles: lastAssistant?.sources?.map(source => source.title) || [],
      confidence: 95,
      createdAt: now,
      updatedAt: now,
      sourceType: 'chat',
      sourceText: lastAssistant?.text.slice(0, 1200) || '',
    });
    setShowImproveAnswer(false);
    setFaqSyncStatus('改善した回答を承認済みFAQとして保存しました');
  };
  const generateFaqImprovementDraft = async () => {
    if (!api || !faqEditDraft) return;
    setFaqImprovementGenerating(true);
    setFaqImprovementStartedAt(Date.now());
    setFaqImprovementElapsedSec(0);
    setFaqImprovementMessage('生成AIを起動しています。モデル読み込み後、回答生成に進みます。会社PCでは1〜3分かかる場合があります。');
    setFaqImprovementOriginalSnapshot({ ...faqEditDraft });
    setFaqImprovementDraft(null);
    try {
      const result = await api.generateFaqImprovementDraft(faqEditDraft);
      const draft = result?.draft || null;
      setFaqImprovementDraft(draft);
      const diagnostics = draft?.diagnostics || result?.diagnostics;
      if (result?.generated) {
        const similarityNote = diagnostics && Number(diagnostics.answerSimilarity || 0) >= 92
          ? ' ただし回答本文は元FAQと近いため、検索ヒント・確認観点の補強を中心に確認してください。'
          : '';
        setFaqImprovementMessage(`生成AIで改善案を作成しました。${draft?.model ? `モデル: ${draft.model}。` : ''}${similarityNote}`);
      } else {
        setFaqImprovementMessage(result?.reason || result?.error || 'テンプレート改善案を作成しました。');
      }
    } catch (err: any) {
      setFaqImprovementMessage(`改善案生成に失敗しました: ${err?.message || err}`);
    } finally {
      setFaqImprovementGenerating(false);
      setFaqImprovementStartedAt(null);
    }
  };

  const normalizeImprovementList = (value: any) => Array.isArray(value) ? value.map(String).map(x => x.trim()).filter(Boolean) : String(value || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
  const updateFaqImprovementDraftField = (field: string, value: any) => {
    setFaqImprovementDraft((prev: any) => prev ? { ...prev, [field]: value } : prev);
  };
  const buildFaqImprovementQualityChecks = (draft: any, original: SmartFaqRecord | null) => {
    const checks: { level: 'ok' | 'warn' | 'bad'; text: string }[] = [];
    if (!draft) return checks;
    const originalQuestion = String(original?.question || faqEditDraft?.question || '').trim();
    const originalAnswer = String(original?.answer || faqEditDraft?.answer || '').trim();
    const improvedQuestion = String(draft.improvedQuestion || '').trim();
    const improvedAnswer = String(draft.improvedAnswer || '').trim();
    const likely = normalizeImprovementList(draft.likelyQuestions);
    const paraphrases = normalizeImprovementList(draft.paraphrases);
    const suggested = normalizeImprovementList(draft.suggestedActions);
    const duplicatedLikely = likely.filter((item, index) => likely.indexOf(item) !== index);
    if (improvedQuestion && improvedQuestion !== originalQuestion) checks.push({ level: 'ok', text: '代表質問は元質問から言い換え済みです。' });
    else checks.push({ level: 'warn', text: '代表質問が元質問と同じです。必要に応じて編集してください。' });
    if (improvedAnswer && improvedAnswer !== originalAnswer) checks.push({ level: 'ok', text: '回答本文は改善案として変更されています。' });
    else checks.push({ level: 'warn', text: '回答本文が元回答と近い可能性があります。検索ヒント中心の改善として確認してください。' });
    if (likely.length >= 5) checks.push({ level: 'ok', text: `想定質問が${likely.length}件あります。` });
    else checks.push({ level: 'warn', text: '想定質問は5件以上あると検索に強くなります。' });
    if (duplicatedLikely.length) checks.push({ level: 'warn', text: `想定質問に重複があります: ${Array.from(new Set(duplicatedLikely)).slice(0, 3).join('、')}` });
    if (paraphrases.length >= 5) checks.push({ level: 'ok', text: `短文キーワードが${paraphrases.length}件あります。` });
    else checks.push({ level: 'warn', text: '短文キーワードは5件以上を推奨します。' });
    if (suggested.length) checks.push({ level: 'ok', text: '確認アクションがあります。窓口FAQとして使いやすくなります。' });
    const riskyDateMoney = /\d{4}年|令和\d+年|平成\d+年|月額|年額|\d+[,.]?\d*円|無料|有料/.test(improvedAnswer);
    const originalHasDateMoney = /\d{4}年|令和\d+年|平成\d+年|月額|年額|\d+[,.]?\d*円|無料|有料/.test(originalAnswer);
    if (riskyDateMoney && !originalHasDateMoney) checks.push({ level: 'warn', text: '元回答にない日付・金額・有料/無料表現が追加されていないか確認してください。' });
    if (!improvedQuestion || !improvedAnswer) checks.push({ level: 'bad', text: '改善質問または改善回答が空です。反映前に入力してください。' });
    return checks;
  };
  const faqImprovementQualityChecks = useMemo(() => buildFaqImprovementQualityChecks(faqImprovementDraft, faqImprovementOriginalSnapshot), [faqImprovementDraft, faqImprovementOriginalSnapshot, faqEditDraft?.question, faqEditDraft?.answer]);
  const buildFaqRecordFromImprovementDraft = (base: SmartFaqRecord, draft: any, scope: 'all' | 'hints'): SmartFaqRecord => {
    const unique = (values: any[], max: number) => Array.from(new Set(values.map(String).map(x => x.trim()).filter(Boolean))).slice(0, max);
    const now = new Date().toISOString();
    const backup = {
      backedUpAt: now,
      reason: 'faq-improvement-draft-apply',
      question: base.question,
      answer: base.answer,
      likelyQuestions: base.likelyQuestions || [],
      paraphrases: base.paraphrases || [],
      negativeTerms: base.negativeTerms || [],
      suggestedActions: base.suggestedActions || [],
    };
    const next: SmartFaqRecord = {
      ...base,
      likelyQuestions: unique([...(base.likelyQuestions || []), ...normalizeImprovementList(draft.likelyQuestions)], 50),
      paraphrases: unique([...(base.paraphrases || []), ...normalizeImprovementList(draft.paraphrases)], 50),
      negativeTerms: unique([...(base.negativeTerms || []), ...normalizeImprovementList(draft.negativeTerms)], 60),
      suggestedActions: unique([...(base.suggestedActions || []), ...normalizeImprovementList(draft.suggestedActions)], 20),
      improvementBackups: [backup, ...((base.improvementBackups || []) as any[])].slice(0, 10),
      improvementAppliedAt: now,
      improvementAppliedBy: 'local-generation-ai',
      updatedAt: now,
    };
    if (scope === 'all') {
      const improvedQuestion = String(draft.improvedQuestion || '').trim();
      const improvedAnswer = String(draft.improvedAnswer || '').trim();
      if (improvedQuestion) next.question = improvedQuestion;
      if (improvedAnswer) next.answer = improvedAnswer;
    }
    return next;
  };

  const applyFaqImprovementDraft = (scope: 'all' | 'hints') => {
    if (!faqEditDraft || !faqImprovementDraft) return;
    const next = buildFaqRecordFromImprovementDraft(faqEditDraft, faqImprovementDraft, scope);
    setFaqEditDraft(next);
    setFaqImprovementMessage(scope === 'all' ? '改善案をFAQ本文と検索ヒントへ反映しました。保存すると確定します。反映前の内容はバックアップに保持しています。' : '検索ヒントだけ反映しました。保存すると確定します。反映前の内容はバックアップに保持しています。');
  };
  const saveFaqImprovementDraftNow = async (scope: 'all' | 'hints') => {
    if (!faqEditDraft || !faqImprovementDraft) return;
    const nextRecord = buildFaqRecordFromImprovementDraft(faqEditDraft, faqImprovementDraft, scope);
    const next = [nextRecord, ...faqRecords.filter(item => item.id !== nextRecord.id)].slice(0, 5000);
    await saveFaqRecordsShared(next, scope === 'all' ? '改善案をFAQへ反映して保存しました' : '改善案の検索ヒントをFAQへ反映して保存しました');
    setFaqEditDraft(nextRecord);
    setFaqImprovementMessage('改善案を共有FAQへ保存しました。必要なら通常の保存ボタンで追加編集も保存できます。');
  };

  const clearChatHistory = () => {
    setChatMessages(welcomeMessages);
    try { window.localStorage.removeItem(SMART_CHAT_HISTORY_KEY); } catch {}
  };
  const clearSharedSmartAssistLogs = async () => {
    if (!api) return;
    if (!confirm('共有フォルダのSmart Assist会話ログを削除しますか？他の端末の運用ログにも影響します。')) return;
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: '共有ログ削除', detail: '共有フォルダの会話ログを削除しています...', phase: 'running', startedAt });
    try {
      const result = await api.deleteSmartAssistChatLogs();
      setLowConfidenceLogs([]);
      const message = `共有履歴を削除: ${result?.deleted ?? 0}件`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '共有ログ削除', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `共有履歴削除に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '共有ログ削除', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };
  const addAnswerFeedback = async (rating: 'good' | 'bad', targetAssistant?: SmartChatMessage, targetQuestion?: string, expectedFaqId?: string) => {
    const assistant = targetAssistant || lastAssistant;
    const question = String(targetQuestion || lastUser?.text || '').trim();
    if (!assistant || !question) return;
    const reason = rating === 'good' ? '役に立つ回答' : '回答が不正確・根拠不足';
    const item: SmartAnswerFeedback & any = {
      id: `assist_feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question,
      answerPreview: assistant.text.slice(0, 900),
      rating,
      reason,
      matchedFaqId: assistant.matchedFaqId || assistant.sources?.[0]?.sourceId || '',
      matchedFaqTitle: assistant.matchedFaqTitle || assistant.sources?.[0]?.title || '',
      expectedFaqId: expectedFaqId || '',
      confidence: assistant.confidence,
      confidenceLevel: assistant.confidenceLevel,
      candidates: assistant.candidateFaqs || [],
      sourceIds: assistant.sources?.map(source => source.id) || [],
      sourceTitles: assistant.sources?.map(source => source.title) || [],
      status: rating === 'bad' ? 'open' : 'done',
      createdAt: new Date().toISOString(),
    };
    const previousFeedback = answerFeedback;
    const optimistic = [item, ...answerFeedback].slice(0, 3000);
    setAnswerFeedback(optimistic);
    setChatMessages(prev => prev.map(message => message.id === assistant.id ? { ...message, feedbackState: rating } : message));
    if (!api) return;
    try {
      const saved = await api.addSmartAssistFeedback(item);
      setAnswerFeedback(saved as SmartAnswerFeedback[]);
      setAnswerFeedbackStatus(rating === 'good' ? '正しい回答として記録しました' : '不正確な回答として未回答・改善ログへ登録しました');
      if (rating === 'bad') {
        try { setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(await api.listLowConfidenceSmartAssistLogs())); } catch {}
        setShowLowConfidenceLogs(true);
      }
    } catch (err: any) {
      setAnswerFeedback(previousFeedback);
      setChatMessages(prev => prev.map(message => message.id === assistant.id ? { ...message, feedbackState: undefined } : message));
      setAnswerFeedbackStatus(`フィードバック保存に失敗しました: ${err?.message ?? 'unknown error'}`);
    }
  };
  const importFaqJson = () => {
    setFaqJsonText('');
    setFaqJsonError('');
    setShowFaqJsonImport(true);
  };
  const runFaqJsonImport = async () => {
    const raw = faqJsonText.trim();
    if (!raw) { setFaqJsonError('FAQ JSONを貼り付けてください。'); return; }
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: 'FAQ JSON取込', detail: 'JSONを解析しています...', phase: 'running', startedAt });
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
      const imported = items.map(normalizeImportedFaqRecord).filter(Boolean) as SmartFaqRecord[];
      if (!imported.length) {
        setFaqJsonError('インポートできるFAQが見つかりませんでした。配列または { items: [...] } 形式を確認してください。');
        setOperationProgress({ busy: false, label: 'FAQ JSON取込', detail: '取込対象がありませんでした', phase: 'error', completedAt: new Date().toISOString(), startedAt });
        return;
      }
      const { unique, duplicates } = dedupeImportedFaqRecords(imported, faqRecords);
      if (!unique.length) {
        const message = `すべて重複のため取込をスキップしました（重複 ${duplicates.length}件）`;
        setFaqJsonError(message);
        setFaqSyncStatus(message);
        setOperationStatus(message);
        setOperationProgress({ busy: false, label: 'FAQ JSON取込', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
        return;
      }
      setOperationProgress({ busy: true, label: 'FAQ JSON取込', detail: `新規 ${unique.length}件を保存中...（重複 ${duplicates.length}件はスキップ）`, phase: 'running', startedAt });
      await saveFaqRecordsShared([...unique, ...faqRecords].slice(0, 10000), `FAQ JSONを${unique.length}件インポートしました（重複 ${duplicates.length}件はスキップ）`);
      const message = `FAQ JSON取込完了: 新規 ${unique.length}件 / 重複スキップ ${duplicates.length}件`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: 'FAQ JSON取込', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
      setShowFaqJsonImport(false);
      setFaqJsonText('');
      setFaqJsonError('');
    } catch (err: any) {
      const message = `FAQ JSONインポートに失敗しました: ${err?.message ?? 'JSON形式を確認してください'}`;
      setFaqJsonError(message);
      setFaqSyncStatus(message);
      setOperationProgress({ busy: false, label: 'FAQ JSON取込', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };
  const exportFaqJson = async () => {
    const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: faqRecords }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setFaqSyncStatus('FAQ JSONをクリップボードにコピーしました');
      return;
    } catch {}
    try {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smart-assist-faq-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFaqSyncStatus('FAQ JSONを書き出しました');
    } catch (err: any) {
      setFaqJsonText(json);
      setFaqJsonError('クリップボードコピーとファイル出力が使えないため、下のJSONをコピーしてください。');
      setShowFaqJsonImport(true);
      setFaqSyncStatus(`FAQ JSON出力に失敗しました: ${err?.message ?? 'unknown error'}`);
    }
  };
  const saveFaqRecordsShared = async (next: SmartFaqRecord[], message = '共有FAQを保存しました') => {
    setFaqServerResult(null);
    setSelectedFaqIds(prev => prev.filter(id => next.some(record => record.id === id)));
    setFaqRecords(next);
    if (!api) return;
    try {
      const saved = await api.saveSmartFaqRecords(next);
      setFaqRecords(saved as SmartFaqRecord[]);
      setFaqSyncStatus(`${message}（${saved.length}件）`);
    } catch (err: any) {
      setFaqSyncStatus(`FAQ保存に失敗しました: ${err?.message ?? 'unknown error'}`);
      throw err;
    }
  };
  const saveFaqRecordIndividually = async (record: SmartFaqRecord, message: string) => {
    if (!api) return;
    const current = faqRecords.find(item => item.id === record.id);
    const payload = {
      ...record,
      ...(current?.updatedAt ? { baseUpdatedAt: current.updatedAt } : {}),
    };
    const saved = await api.upsertSmartFaqRecord(payload);
    setFaqRecords(saved as SmartFaqRecord[]);
    setSelectedFaqIds(prev => prev.filter(id => (saved as SmartFaqRecord[]).some(item => item.id === id)));
    setFaqSyncStatus(`${message}（${saved.length}件）`);
  };

  const addFaqRecord = async (record: SmartFaqRecord) => {
    await saveFaqRecordIndividually(record, '共有FAQに追加しました');
  };
  const clearFaqSaveRecovery = () => {
    if (faqRetryTimerRef.current) window.clearTimeout(faqRetryTimerRef.current);
    faqRetryTimerRef.current = null;
    faqRetryAttemptRef.current = 0;
    setFaqSaveRecovery(null);
  };
  const scheduleFaqSaveRetry = () => {
    if (faqRetryTimerRef.current) return;
    const attempt = faqRetryAttemptRef.current + 1;
    faqRetryAttemptRef.current = attempt;
    const exhausted = attempt > 3;
    setFaqSaveRecovery({ attempt, exhausted });
    if (exhausted) {
      setFaqSyncStatus('FAQの保存に繰り返し失敗しています。未保存の内容を保持しています。［今すぐ再試行］を押してください。');
      return;
    }
    const delay = [2000, 5000, 10000][attempt - 1] || 10000;
    setFaqSyncStatus(`FAQ保存に失敗しました。${Math.ceil(delay / 1000)}秒後に自動再試行します（${attempt}/3）。`);
    faqRetryTimerRef.current = window.setTimeout(() => {
      faqRetryTimerRef.current = null;
      void flushFaqSaveQueue().catch(() => undefined);
    }, delay);
  };
  const flushFaqSaveQueue = async (next?: SmartFaqRecord[]) => {
    const snapshot = next || queuedFaqSaveRef.current || faqRecords;
    if (!api) return;
    queuedFaqSaveRef.current = snapshot;
    if (faqSaveInFlightRef.current) return faqSaveDrainRef.current ?? Promise.resolve();
    faqSaveInFlightRef.current = true;
    const drain = (async () => {
      let failedSnapshot: SmartFaqRecord[] | null = null;
      try {
        while (queuedFaqSaveRef.current) {
          const latest = queuedFaqSaveRef.current;
          queuedFaqSaveRef.current = null;
          failedSnapshot = latest;
          const saved = await api.saveSmartFaqRecords(latest);
          failedSnapshot = null;
          clearFaqSaveRecovery();
          setFaqRecords(saved as SmartFaqRecord[]);
          setFaqSyncStatus(`共有FAQを自動保存しました（${saved.length}件）`);
        }
      } catch (err: any) {
        if (failedSnapshot && !queuedFaqSaveRef.current) queuedFaqSaveRef.current = failedSnapshot;
        scheduleFaqSaveRetry();
        setFaqSyncStatus(`FAQ自動保存に失敗しました。未保存状態を保持しています: ${err?.message ?? 'unknown error'}`);
      } finally {
        faqSaveInFlightRef.current = false;
        faqSaveDrainRef.current = null;
      }
    })();
    faqSaveDrainRef.current = drain;
    return drain;
  };

  useEffect(() => {
    (window as any).__localNotionFlushSmartAssistSaves = async () => {
      if (faqSaveTimerRef.current) {
        window.clearTimeout(faqSaveTimerRef.current);
        faqSaveTimerRef.current = null;
      }
      if (queuedFaqSaveRef.current || faqSaveInFlightRef.current) {
        await flushFaqSaveQueue();
      }
    };
    return () => {
      if (faqRetryTimerRef.current) window.clearTimeout(faqRetryTimerRef.current);
      delete (window as any).__localNotionFlushSmartAssistSaves;
    };
  }, [api, faqRecords]);

  const updateFaqRecord = (id: string, patch: Partial<SmartFaqRecord>) => {
    setFaqServerResult(null);
    const next = faqRecords.map(record => record.id === id ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record);
    setFaqRecords(next);
    queuedFaqSaveRef.current = next;
    setFaqSyncStatus('FAQ編集中... 共有フォルダへ自動保存します');
    if (!api) return;
    if (faqSaveTimerRef.current) window.clearTimeout(faqSaveTimerRef.current);
    faqSaveTimerRef.current = window.setTimeout(() => {
      faqSaveTimerRef.current = null;
      void flushFaqSaveQueue(next);
    }, 650);
  };
  const deleteFaqRecord = async (id: string) => {
    setFaqServerResult(null);
    const current = faqRecords.find(record => record.id === id);
    if (!current || !window.confirm('このFAQを削除しますか？共有FAQから削除し、サーバー側のFAQゴミ箱に退避します。')) return;
    if (!api) return;
    try {
      const saved = await api.deleteSmartFaqRecord(id, String(current.updatedAt || ''));
      setSelectedFaqIds(prev => prev.filter(item => item !== id));
      setFaqRecords(saved as SmartFaqRecord[]);
      setFaqSyncStatus(`FAQを削除しました（${saved.length}件）`);
    } catch (err: any) {
      setFaqSyncStatus(`FAQ削除に失敗しました: ${err?.message ?? 'unknown error'}。必要なら再読み込みしてから操作してください。`);
    }
  };
  const addManualFaq = async () => {
    if (!manualFaq.question.trim() || !manualFaq.answer.trim()) return;
    const now = new Date().toISOString();
    await addFaqRecord({
      id: `faq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: manualFaq.question.trim(),
      answer: manualFaq.answer.trim(),
      category: manualFaq.category.trim() || '未分類',
      tags: manualFaq.tags.split(/[、,\s]+/).map(v => v.trim()).filter(Boolean),
      status: 'reviewed',
      sourceDocIds: selected ? [selected.id] : [],
      sourceTitles: selected ? [selected.title] : [],
      confidence: 90,
      createdAt: now,
      updatedAt: now,
    });
    setManualFaq({ question: '', answer: '', category: '未分類', tags: '' });
  };

  const openNewFaqEditor = () => {
    setFaqImprovementDraft(null);
    setFaqImprovementOriginalSnapshot(null);
    setFaqImprovementMessage('');
    const now = new Date().toISOString();
    setFaqEditMode('new');
    setFaqEditDraft({
      id: `faq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: '',
      answer: '',
      category: '未分類',
      tags: [],
      status: 'reviewed',
      sourceDocIds: selected ? [selected.id] : [],
      sourceTitles: selected ? [selected.title] : [],
      confidence: 90,
      createdAt: now,
      updatedAt: now,
      likelyQuestions: [],
      paraphrases: [],
      negativeTerms: [],
      testQuestions: [],
    });
  };

  const openFaqEditor = (record: SmartFaqRecord) => {
    setFaqImprovementDraft(null);
    setFaqImprovementOriginalSnapshot(null);
    setFaqImprovementMessage('');
    setFaqEditMode('edit');
    setFaqEditDraft({ ...record });
  };

  const saveFaqEditDraft = async () => {
    if (!faqEditDraft || !faqEditDraft.question.trim() || !faqEditDraft.answer.trim()) return;
    const nextRecord: SmartFaqRecord = {
      ...faqEditDraft,
      question: faqEditDraft.question.trim(),
      answer: faqEditDraft.answer.trim(),
      category: faqEditDraft.category?.trim() || '未分類',
      tags: Array.isArray(faqEditDraft.tags) ? faqEditDraft.tags.map(String).map(v => v.trim()).filter(Boolean) : [],
      updatedAt: new Date().toISOString(),
    };
    await saveFaqRecordIndividually(nextRecord, faqEditMode === 'new' ? 'FAQを追加しました' : 'FAQを更新しました');
    setFaqEditDraft(null);
  };

  const generateEvaluationSetFromFaqRecords = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: '評価セット自動生成', detail: 'FAQの質問・想定質問・テスト質問から評価セットを作成しています...', phase: 'running', startedAt });
    try {
      const seen = new Set<string>();
      const items = faqRecords
        .filter(record => record.status !== 'hidden' && record.question.trim() && record.answer.trim())
        .flatMap(record => {
          const questions = [
            record.question,
            ...(record.likelyQuestions || []),
            ...(record.testQuestions || []),
            ...(record.paraphrases || []),
          ].map(v => String(v || '').trim()).filter(Boolean);
          return questions.slice(0, 8).map(question => ({
            question,
            expectedFaqId: record.id,
            note: `FAQから自動生成: ${record.category || '未分類'} / ${record.question.slice(0, 40)}`,
          }));
        })
        .filter(item => {
          const key = `${normalizeSmartText(item.question)}::${item.expectedFaqId}`;
          if (!normalizeSmartText(item.question) || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 1000);
      const saved = await api.saveSmartAssistEvaluationSet(items);
      setOperationStatus(`評価セットを自動生成しました（${saved.length}問）`);
      setOperationProgress({ busy: false, label: '評価セット自動生成', detail: `${saved.length}問を faq-evaluation-set.json に保存しました`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `評価セット自動生成に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '評価セット自動生成', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };
  const promoteAutoFaq = async (item: SmartFaqItem, status: SmartFaqStatus = 'draft') => addFaqRecord(buildFaqRecordFromItem(item, status));
  const makeFaqFromSelected = async () => { if (selected) await addFaqRecord(buildFaqRecordFromDoc(selected, 'draft')); };
  const rebuildFaqSearchIndex = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setFaqSearchStatus('FAQ検索インデックスを再構築中...');
    setModelLoadProgress({ active: true, label: 'Transformers.jsモデル確認中', percent: 18 });
    setOperationProgress({ busy: true, label: '検索・意味ベクトル再生成', detail: 'FAQ検索インデックスと意味ベクトルを再生成しています...', phase: 'running', startedAt });
    setOperationStatus('検索・意味ベクトル再生成中...');
    try {
      setModelLoadProgress({ active: true, label: '埋め込みモデルロード・ベクトル生成中', percent: 64 });
      const result = await api.rebuildSmartFaqIndex();
      setModelLoadProgress({ active: true, label: '検索インデックス統計を確認中', percent: 86 });
      setOperationProgress({ busy: true, label: '検索・意味ベクトル再生成', detail: '統計情報を読み込んでいます...', phase: 'running', startedAt });
      const stats = await api.getSmartFaqSearchStats();
      setFaqSearchStats(stats);
      const indexed = Number(result?.indexedCount ?? stats?.indexedCount ?? 0);
      const message = `検索・意味ベクトル再生成完了: ${indexed}件`;
      setFaqSearchStatus(message);
      setOperationStatus(message);
      setModelLoadProgress({ active: false, label: 'モデル・インデックス準備完了', percent: 100 });
      setOperationProgress({ busy: false, label: '検索・意味ベクトル再生成', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `FAQ検索インデックス再構築に失敗: ${err?.message ?? 'unknown error'}`;
      setFaqSearchStatus(message);
      setOperationStatus(message);
      setModelLoadProgress({ active: false, label: 'モデルロードまたは再生成に失敗', percent: 0 });
      setOperationProgress({ busy: false, label: '検索・意味ベクトル再生成', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const refreshWorkspaceSemanticIndexInfo = async () => {
    if (!api) return;
    try {
      const info = await api.getWorkspaceSemanticIndexInfo();
      setWorkspaceSemanticInfo(info);
      setWorkspaceSemanticStatus(info?.ok ? `Workspace Semantic: ${info.indexedCount || 0}件 indexed` : 'Workspace Semantic Indexは未生成です');
    } catch (err: any) {
      setWorkspaceSemanticStatus(`Workspace Semanticを確認できません: ${err?.message ?? 'unknown error'}`);
    }
  };

  const refreshWorkspaceSemanticRecoveryBackups = async () => {
    if (!api) return;
    try { setSemanticRecoveryBackups(await api.getWorkspaceSemanticRecoveryBackups()); } catch { setSemanticRecoveryBackups([]); }
  };

  const createWorkspaceSemanticRecoveryBackup = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: '共有JSONバックアップ', detail: '共有フォルダの正本データを読み取り専用でスナップショットしています。添付ファイルとローカルSQLiteは含めません。', phase: 'running', startedAt });
    try {
      const result = await api.createWorkspaceSemanticRecoveryBackup('manual');
      setSemanticRecoveryBackups(Array.isArray(result?.backups) ? result.backups : await api.getWorkspaceSemanticRecoveryBackups());
      const detail = `共有JSONバックアップを作成しました（${Number(result?.fileCount || 0)}ファイル）`;
      setWorkspaceSemanticStatus(detail); setOperationStatus(detail);
      setOperationProgress({ busy: false, label: '共有JSONバックアップ', detail, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const detail = `共有JSONバックアップに失敗: ${err?.message ?? 'unknown error'}`;
      setOperationProgress({ busy: false, label: '共有JSONバックアップ', detail, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const resetWorkspaceSemanticLocalCacheFromAdmin = async () => {
    if (!api || operationProgress.busy) return;
    if (!window.confirm('ローカルSQLite・sqlite-vec・FTS5キャッシュを削除します。共有フォルダのページ・タグ・添付・JSON正本は削除されません。次回、差分更新または全件再生成が必要です。続けますか？')) return;
    const startedAt = Date.now();
    setOperationProgress({ busy: true, label: 'ローカルSemanticキャッシュ再構築準備', detail: 'ローカルSQLite／sqlite-vec／FTS5だけを削除しています。', phase: 'running', startedAt });
    try {
      const result = await api.resetWorkspaceSemanticLocalCache();
      await refreshWorkspaceSemanticIndexInfo();
      const detail = result?.message || 'ローカルSemanticキャッシュを削除しました。';
      setWorkspaceSemanticStatus(detail); setOperationStatus(detail);
      setOperationProgress({ busy: false, label: 'ローカルSemanticキャッシュ再構築準備', detail, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const detail = `ローカルSemanticキャッシュ削除に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationProgress({ busy: false, label: 'ローカルSemanticキャッシュ再構築準備', detail, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const maintainWorkspaceSemanticCacheFromAdmin = async (vacuum = false) => {
    if (!api || operationProgress.busy) return;
    if (vacuum && !window.confirm('SQLiteキャッシュを整理します。数秒〜数分、関連検索が一時的に待機する場合があります。共有フォルダの正本データは変更しません。続けますか？')) return;
    const startedAt = Date.now();
    const label = vacuum ? 'SQLiteキャッシュ容量整理' : 'Semantic Index不要データ掃除';
    setWorkspaceSemanticStatus(`${label}を実行中...`);
    setOperationProgress({ busy: true, label, detail: vacuum ? 'SQLiteのWALを整理してからキャッシュ容量を最適化しています。' : '削除済みページ・旧FTS・旧sqlite-vec対応データを照合しています。', phase: 'running', startedAt });
    try {
      const result = await api.maintainWorkspaceSemanticCache({ vacuum });
      const info = await api.getWorkspaceSemanticIndexInfo();
      setWorkspaceSemanticInfo(info);
      const removed = Number(result?.removedItems || 0) + Number(result?.removedVectorMaps || 0) + Number(result?.removedFtsMaps || 0) + Number(result?.removedFailures || 0);
      const reclaimed = Number(result?.reclaimedBytes || 0);
      const detail = `${vacuum ? '容量整理' : '不要データ掃除'}完了: ${removed}件整理${reclaimed > 0 ? ` / ${Math.round(reclaimed / 1024)}KB削減` : ''}`;
      setWorkspaceSemanticStatus(detail);
      setOperationStatus(detail);
      setOperationProgress({ busy: false, label, detail, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const detail = `${label}に失敗: ${err?.message ?? 'unknown error'}`;
      setWorkspaceSemanticStatus(detail);
      setOperationStatus(detail);
      setOperationProgress({ busy: false, label, detail, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const startWorkspaceSemanticBackgroundRebuild = async () => {
    if (!api) return;
    try {
      const job = await api.startWorkspaceSemanticRebuildJob({ mode: 'full' });
      setSemanticBackgroundJob(job);
      setWorkspaceSemanticStatus('Workspace Semanticのバックグラウンド再生成を開始しました。');
      setOperationStatus('Workspace Semanticのバックグラウンド再生成を開始しました。');
    } catch (err: any) {
      setWorkspaceSemanticStatus(`バックグラウンド再生成を開始できません: ${err?.message ?? 'unknown error'}`);
    }
  };

  const controlWorkspaceSemanticBackgroundJob = async (action: 'pause' | 'resume' | 'cancel') => {
    if (!api) return;
    try {
      const job = await api.controlWorkspaceSemanticRebuildJob(action);
      setSemanticBackgroundJob(job);
      setWorkspaceSemanticStatus(job?.message || 'バックグラウンドIndexの状態を更新しました。');
    } catch (err: any) {
      setWorkspaceSemanticStatus(`バックグラウンドIndex操作に失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const job = await api.getWorkspaceSemanticRebuildJob();
        if (disposed) return;
        setSemanticBackgroundJob(job);
        if (['completed', 'cancelled', 'error'].includes(String(job?.state || ''))) {
          await refreshWorkspaceSemanticIndexInfo();
        }
      } catch {}
    };
    void refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [api]);

  useEffect(() => { void refreshWorkspaceSemanticRecoveryBackups(); }, [api]);

  const rebuildWorkspaceSemanticIndexFromAdmin = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setWorkspaceSemanticStatus('Workspace Semantic Indexを再生成中...');
    setModelLoadProgress({ active: true, label: 'Workspace Semantic再生成中', percent: 28 });
    setOperationProgress({ busy: true, label: 'Workspace Semantic再生成', detail: 'FAQ・ページ・DB行・Journalを横断する関連表示用インデックスを作成しています...', phase: 'running', startedAt });
    setOperationStatus('Workspace Semantic再生成中...');
    try {
      const result = await api.rebuildWorkspaceSemanticIndex({ mode: 'full' });
      const info = await api.getWorkspaceSemanticIndexInfo();
      setWorkspaceSemanticInfo(info);
      const indexed = Number(result?.indexedCount ?? info?.indexedCount ?? 0);
      const message = `Workspace Semantic再生成完了: ${indexed}件`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      window.dispatchEvent(new CustomEvent('local-notion:semantic-index-updated', { detail: { revision: info?.revision || result?.revision || info?.generatedAt || null, mode: 'full' } }));
      setModelLoadProgress({ active: false, label: 'Workspace Semantic準備完了', percent: 100 });
      setOperationProgress({ busy: false, label: 'Workspace Semantic再生成', detail: `${message} ・ 関連表示に反映されます`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `Workspace Semantic再生成に失敗: ${err?.message ?? 'unknown error'}`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      setModelLoadProgress({ active: false, label: 'Workspace Semantic再生成失敗', percent: 0 });
      setOperationProgress({ busy: false, label: 'Workspace Semantic再生成', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };


  const diffUpdateWorkspaceSemanticIndexFromAdmin = async (limit = 20) => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setWorkspaceSemanticStatus(`Workspace Semantic差分更新中... 最大${limit}件`);
    setModelLoadProgress({ active: true, label: 'Workspace Semantic差分更新中', percent: 34 });
    setOperationProgress({ busy: true, label: 'Workspace Semantic差分更新', detail: `変更分だけ最大${limit}件までembeddingを更新します。保存操作は重くしません。`, phase: 'running', startedAt });
    setOperationStatus('Workspace Semantic差分更新中...');
    try {
      const result = await api.diffUpdateWorkspaceSemanticIndex(limit);
      const info = await api.getWorkspaceSemanticIndexInfo();
      setWorkspaceSemanticInfo(info);
      const stats = result?.buildStats || info?.cache?.meta || {};
      const embedded = Number(stats.embeddedThisRun ?? stats.lastEmbeddedThisRun ?? 0);
      const pending = Number(stats.pendingCount ?? stats.lastPendingCount ?? info?.diff?.pending ?? 0);
      const message = `Workspace Semantic差分更新完了: ${embedded}件更新 / 残り${pending}件`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      window.dispatchEvent(new CustomEvent('local-notion:semantic-index-updated', { detail: { revision: info?.revision || result?.revision || info?.generatedAt || null, mode: 'diff' } }));
      setModelLoadProgress({ active: false, label: 'Workspace Semantic差分更新完了', percent: 100 });
      setOperationProgress({ busy: false, label: 'Workspace Semantic差分更新', detail: message, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `Workspace Semantic差分更新に失敗: ${err?.message ?? 'unknown error'}`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      setModelLoadProgress({ active: false, label: 'Workspace Semantic差分更新失敗', percent: 0 });
      setOperationProgress({ busy: false, label: 'Workspace Semantic差分更新', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const reindexWorkspaceSemanticFailureFromAdmin = async (failure: any) => {
    if (!api || operationProgress.busy) return;
    const sourceId = String(failure?.sourceId || '').trim();
    if (!sourceId) return;
    const startedAt = Date.now();
    const title = String(failure?.title || sourceId);
    setWorkspaceSemanticStatus(`対象を再Index中: ${title}`);
    setModelLoadProgress({ active: true, label: '対象ページを再Index中', percent: 42 });
    setOperationProgress({ busy: true, label: '対象ページを再Index', detail: `${title} のチャンクだけを再生成します。`, phase: 'running', startedAt });
    try {
      const result = await api.reindexWorkspaceSemanticSource(sourceId, failure?.type ? String(failure.type) : undefined);
      const info = await api.getWorkspaceSemanticIndexInfo();
      setWorkspaceSemanticInfo(info);
      const remaining = Number(info?.cache?.failureCount || 0);
      const message = `対象ページを再Indexしました: ${title}${remaining ? ` / 残り失敗 ${remaining}件` : ''}`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      window.dispatchEvent(new CustomEvent('local-notion:semantic-index-updated', { detail: { revision: info?.revision || result?.revision || null, mode: 'targeted-retry', sourceId } }));
      setModelLoadProgress({ active: false, label: '対象ページの再Index完了', percent: 100 });
      setOperationProgress({ busy: false, label: '対象ページを再Index', detail: message, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `対象ページの再Indexに失敗: ${err?.message ?? 'unknown error'}`;
      setWorkspaceSemanticStatus(message);
      setOperationStatus(message);
      setModelLoadProgress({ active: false, label: '対象ページの再Index失敗', percent: 0 });
      setOperationProgress({ busy: false, label: '対象ページを再Index', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const saveSemanticIdleSettings = async () => {
    if (!api) return;
    try {
      const next = {
        ...transformerSettings,
        semanticIdleEnabled,
        semanticIdleBatchSize: Math.max(1, Math.min(50, Number(semanticIdleBatchSize || 10))),
        semanticIdleDelaySec: Math.max(5, Math.min(120, Number(semanticIdleDelaySec || 8))),
      };
      const result = await api.saveTransformerSettings(next);
      if (result?.settings) setTransformerSettings(result.settings);
      setTransformerModelMessage('Semantic Indexのアイドル更新設定を保存しました。');
    } catch (err: any) {
      setTransformerModelMessage(`アイドル更新設定の保存に失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const reloadSmartAssistSynonyms = async () => {
    if (!api) return;
    try {
      setSmartSynonymStatus('言い換え: 再読込中');
      const items = await api.listSmartAssistSynonyms();
      setSmartSynonyms(items);
      setSmartSynonymJsonText(JSON.stringify(items, null, 2));
      setSmartSynonymStatus(`言い換え ${items.length}件`);
    } catch (err: any) {
      setSmartSynonymStatus(`言い換え辞書の再読み込みに失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const saveSmartAssistSynonymsFromJson = async () => {
    if (!api) return;
    try {
      const parsed = JSON.parse(smartSynonymJsonText);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      if (!Array.isArray(items)) throw new Error('JSONは配列、または { items: [...] } にしてください。');
      setSmartSynonymStatus('言い換え: 保存中');
      const saved = await api.saveSmartAssistSynonyms(items);
      setSmartSynonyms(saved);
      setSmartSynonymJsonText(JSON.stringify(saved, null, 2));
      setSmartSynonymStatus(`保存しました: ${saved.length}件 ・ 次回質問から反映されます`);
    } catch (err: any) {
      setSmartSynonymStatus(`保存できません: ${err?.message ?? 'JSON形式を確認してください'}`);
    }
  };

  const upsertSmartAssistSynonymItem = async (event: React.FormEvent<HTMLFormElement>, existingId?: string) => {
    event.preventDefault();
    if (!api) return;
    const form = new FormData(event.currentTarget);
    const item = {
      id: existingId || `syn_custom_${Date.now()}`,
      base: String(form.get('base') || '').trim(),
      variants: String(form.get('variants') || '').split(/[\n,、]/).map(value => value.trim()).filter(Boolean),
      category: String(form.get('category') || '').trim(),
      intentId: String(form.get('intentId') || '').trim(),
      enabled: form.get('enabled') === 'on',
      ...(existingId ? { baseUpdatedAt: smartSynonyms.find((entry: any) => String(entry.id) === existingId)?.updatedAt } : {}),
    };
    if (!item.base) { setSmartSynonymStatus('言い換え辞書: 基準語を入力してください'); return; }
    try {
      setSmartSynonymStatus('言い換え: 保存中');
      const saved = await api.upsertSmartAssistSynonym(item);
      setSmartSynonyms(saved);
      setSmartSynonymJsonText(JSON.stringify(saved, null, 2));
      setSmartSynonymStatus(`保存しました: ${saved.length}件`);
    } catch (err: any) {
      setSmartSynonymStatus(`個別保存に失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const deleteSmartAssistSynonymItem = async (id: string, baseUpdatedAt?: string) => {
    if (!api || !window.confirm('この言い換え辞書項目を削除しますか？')) return;
    try {
      const saved = await api.deleteSmartAssistSynonym(id, baseUpdatedAt);
      setSmartSynonyms(saved);
      setSmartSynonymJsonText(JSON.stringify(saved, null, 2));
      setSmartSynonymStatus(`削除しました: ${saved.length}件`);
    } catch (err: any) { setSmartSynonymStatus(`削除に失敗: ${err?.message ?? 'unknown error'}`); }
  };

  const addSmartAssistSynonymTemplate = () => {
    const next = [
      {
        id: `syn_custom_${Date.now()}`,
        base: '新しい言い換え',
        variants: ['別の言い方', '表記ゆれ'],
        category: '未分類',
        intentId: '',
        enabled: true,
      },
      ...smartSynonyms,
    ];
    setSmartSynonymJsonText(JSON.stringify(next, null, 2));
    setShowSmartSynonymEditor(true);
  };


  const reloadSmartAssistRuleProfiles = async () => {
    if (!api) return;
    try {
      setSmartRuleProfileStatus('ルール: 再読込中');
      const items = await api.listSmartAssistRuleProfiles();
      setSmartRuleProfiles(items);
      setSmartRuleProfileJsonText(JSON.stringify(items, null, 2));
      setSmartRuleProfileStatus(`ルール ${items.length}件`);
    } catch (err: any) {
      setSmartRuleProfileStatus(`汎用ヒットルールの再読み込みに失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const saveSmartAssistRuleProfilesFromJson = async () => {
    if (!api) return;
    try {
      const parsed = JSON.parse(smartRuleProfileJsonText);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      if (!Array.isArray(items)) throw new Error('JSONは配列、または { items: [...] } にしてください。');
      setSmartRuleProfileStatus('ルール: 保存中');
      const saved = await api.saveSmartAssistRuleProfiles(items);
      setSmartRuleProfiles(saved);
      setSmartRuleProfileJsonText(JSON.stringify(saved, null, 2));
      setSmartRuleProfileStatus(`保存しました: ${saved.length}件 ・ 次回質問から反映されます`);
    } catch (err: any) {
      setSmartRuleProfileStatus(`保存できません: ${err?.message ?? 'JSON形式を確認してください'}`);
    }
  };

  const upsertSmartAssistRuleProfileItem = async (event: React.FormEvent<HTMLFormElement>, existingId?: string) => {
    event.preventDefault();
    if (!api) return;
    const form = new FormData(event.currentTarget);
    const split = (value: FormDataEntryValue | null) => String(value || '').split(/[\n,、]/).map(item => item.trim()).filter(Boolean);
    const item = {
      id: existingId || `rule_custom_${Date.now()}`,
      label: String(form.get('label') || '').trim(),
      description: String(form.get('description') || '').trim(),
      enabled: form.get('enabled') === 'on',
      category: String(form.get('category') || '').trim(),
      intentId: String(form.get('intentId') || '').trim(),
      terms: split(form.get('terms')),
      boostTerms: split(form.get('boostTerms')),
      questionTypes: split(form.get('questionTypes')),
      negativeTerms: split(form.get('negativeTerms')),
      parentIntentIds: split(form.get('parentIntentIds')),
      weight: Math.max(0, Number(form.get('weight') || 1)),
      ...(existingId ? { baseUpdatedAt: smartRuleProfiles.find((entry: any) => String(entry.id) === existingId)?.updatedAt } : {}),
    };
    if (!item.label || !item.terms.length) { setSmartRuleProfileStatus('ルール: 名前と主要語を入力してください'); return; }
    try {
      setSmartRuleProfileStatus('ルール: 保存中');
      const saved = await api.upsertSmartAssistRuleProfile(item);
      setSmartRuleProfiles(saved);
      setSmartRuleProfileJsonText(JSON.stringify(saved, null, 2));
      setSmartRuleProfileStatus(`保存しました: ${saved.length}件`);
    } catch (err: any) { setSmartRuleProfileStatus(`個別保存に失敗: ${err?.message ?? 'unknown error'}`); }
  };

  const deleteSmartAssistRuleProfileItem = async (id: string, baseUpdatedAt?: string) => {
    if (!api || !window.confirm('このルールを削除しますか？')) return;
    try {
      const saved = await api.deleteSmartAssistRuleProfile(id, baseUpdatedAt);
      setSmartRuleProfiles(saved);
      setSmartRuleProfileJsonText(JSON.stringify(saved, null, 2));
      setSmartRuleProfileStatus(`削除しました: ${saved.length}件`);
    } catch (err: any) { setSmartRuleProfileStatus(`削除に失敗: ${err?.message ?? 'unknown error'}`); }
  };

  const addSmartAssistRuleProfileTemplate = () => {
    const next = [
      {
        id: `rule_custom_${Date.now()}`,
        label: '短文ヒットルール',
        description: '短い質問を特定カテゴリ・Intentへ寄せるための汎用ルールです。',
        enabled: true,
        category: '未分類',
        intentId: '',
        terms: ['主要語'],
        boostTerms: ['いつから', '方法', '必要書類'],
        questionTypes: [],
        negativeTerms: [],
        parentIntentIds: [],
        weight: 1,
      },
      ...smartRuleProfiles,
    ];
    setSmartRuleProfileJsonText(JSON.stringify(next, null, 2));
    setShowSmartRuleProfileEditor(true);
  };

  const rebuildSmartAssistSemanticModel = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setOperationStatus('意味検索インデックスを再生成中...');
    setOperationProgress({ busy: true, label: '意味検索再生成', detail: 'FAQ examples / testQuestions を意味ベクトルに反映しています...', phase: 'running', startedAt });
    try {
      const result = await api.retrainSmartAssistNlp();
      const message = `意味検索再生成完了: FAQ ${result?.faqCount ?? '-'} / インデックス ${result?.indexedCount ?? '-'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '意味検索再生成', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `意味検索再生成に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '意味検索再生成', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const loadLowConfidenceSmartAssistLogs = async (openPanel = true) => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setOperationStatus('低信頼ログを読み込み中...');
    setOperationProgress({ busy: true, label: '低信頼ログ読込', detail: '共有ログから低信頼の会話を抽出しています...', phase: 'running', startedAt });
    try {
      const logs = await api.listLowConfidenceSmartAssistLogs();
      setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(Array.isArray(logs) ? logs : []));
      if (openPanel) setShowLowConfidenceLogs(true);
      const message = `低信頼ログ ${Array.isArray(logs) ? logs.length : 0}件を読み込みました`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '低信頼ログ読込', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `低信頼ログの読込に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '低信頼ログ読込', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const loadSmartAssistEvaluationData = async () => {
    if (!api) return;
    const [items, reports] = await Promise.all([api.listSmartAssistEvaluationSet(), api.listSmartAssistEvaluationReports()]);
    setEvaluationEntries(Array.isArray(items) ? items : []);
    setEvaluationReports(Array.isArray(reports) ? reports : []);
  };

  const saveEvaluationEntry = async () => {
    if (!api) return;
    const question = evaluationDraft.question.trim();
    const expectedFaqId = evaluationDraft.expectedFaqId.trim();
    if (!question || !expectedFaqId) {
      setOperationStatus('評価問題と正解FAQ IDを入力してください。');
      return;
    }
    try {
      const saved = await api.upsertSmartAssistEvaluationEntry({
        ...evaluationDraft,
        id: evaluationDraft.id || `eval_${Date.now()}`,
        question,
        expectedFaqId,
        note: evaluationDraft.note.trim(),
        baseUpdatedAt: evaluationDraft.updatedAt || undefined,
      });
      setEvaluationEntries(saved);
      setEvaluationDraft({ id: '', question: '', expectedFaqId: '', note: '', updatedAt: '' });
      setOperationStatus('評価問題を保存しました。');
    } catch (err: any) {
      setOperationStatus(err?.code === 'ITEM_CONFLICT' ? '別の更新があるため保存できません。再読込して確認してください。' : `評価問題の保存に失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const deleteEvaluationEntry = async (entry: any) => {
    if (!api || !window.confirm(`評価問題「${String(entry?.question || '').slice(0, 60)}」を削除しますか？`)) return;
    try {
      const saved = await api.deleteSmartAssistEvaluationEntry(String(entry.id), entry.updatedAt);
      setEvaluationEntries(saved);
      if (evaluationDraft.id === entry.id) setEvaluationDraft({ id: '', question: '', expectedFaqId: '', note: '', updatedAt: '' });
      setOperationStatus('評価問題を削除しました。');
    } catch (err: any) {
      setOperationStatus(err?.code === 'ITEM_CONFLICT' ? '別の更新があるため削除できません。再読込して確認してください。' : `評価問題の削除に失敗: ${err?.message ?? 'unknown error'}`);
    }
  };

  const runSmartAssistEvaluationSet = async () => {
    if (!api || operationProgress.busy) return;
    const startedAt = Date.now();
    setOperationStatus('正答率を自動測定中...');
    setOperationProgress({ busy: true, label: '正答率自動測定', detail: 'faq-evaluation-set.json の質問を一括テストしています...', phase: 'running', startedAt });
    try {
      const result = await api.runSmartAssistEvaluationSet();
      setEvaluationReport(result);
      setEvaluationReports(prev => [result, ...prev.filter((item: any) => String(item?.reportId || item?.updatedAt) !== String(result?.reportId || result?.updatedAt))].slice(0, 30));
      const tested = Number(result?.testedCount ?? 0);
      const passed = Number(result?.passedCount ?? 0);
      const accuracy = Number(result?.accuracy ?? 0);
      const highWrong = Number(result?.highWrongCount ?? 0);
      const message = `正答率 ${accuracy}%（${passed}/${tested}）・高信頼誤答 ${highWrong}件`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '正答率自動測定', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: highWrong ? 'error' : 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `正答率自動測定に失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: '正答率自動測定', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    }
  };

  const runSmartFaqTest = async (record: SmartFaqRecord) => {
    if (!api || operationProgress.busy) return;
    const questions = Array.from(new Set([record.question, ...(record.testQuestions || [])].map(String).map(v => v.trim()).filter(Boolean))).slice(0, 12);
    const startedAt = Date.now();
    setTestingFaqId(record.id);
    setOperationStatus(`FAQテスト実行中: ${record.question}`);
    setOperationProgress({ busy: true, label: 'FAQテスト', detail: `${questions.length}問をテストしています...`, phase: 'running', startedAt });
    try {
      const result = await api.testSmartFaqRecord(record.id, questions);
      setFaqTestResult({ record, result });
      const message = `FAQテスト完了: ${questions.length}問`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: 'FAQテスト', detail: `${message} ・ 完了 ${new Date().toLocaleTimeString()}`, phase: 'success', completedAt: new Date().toISOString(), startedAt });
    } catch (err: any) {
      const message = `FAQテストに失敗: ${err?.message ?? 'unknown error'}`;
      setOperationStatus(message);
      setOperationProgress({ busy: false, label: 'FAQテスト', detail: message, phase: 'error', completedAt: new Date().toISOString(), startedAt });
    } finally {
      setTestingFaqId('');
    }
  };
  const visibleFaqRecords = faqRecords.filter(record => faqFilter === 'all' || record.status === faqFilter);
  const duplicateFaqs = useMemo(() => duplicateFaqCandidates(faqRecords), [faqRecords]);
  const autoCategorizeFaqs = async () => {
    const next = faqRecords.map(record => ({ ...record, category: suggestSmartFaqCategory(record), updatedAt: new Date().toISOString() }));
    await saveFaqRecordsShared(next, 'FAQカテゴリを自動整理しました');
  };
  const mergeDuplicateFaq = async (a: SmartFaqRecord, b: SmartFaqRecord) => {
    const merged: SmartFaqRecord = {
      ...a,
      question: a.question.length <= b.question.length ? a.question : b.question,
      answer: [a.answer, b.answer].filter(Boolean).join('\n\n--- 統合元FAQ ---\n\n'),
      tags: Array.from(new Set([...a.tags, ...b.tags, '統合済み'])).slice(0, 12),
      sourceDocIds: Array.from(new Set([...a.sourceDocIds, ...b.sourceDocIds])),
      sourceTitles: Array.from(new Set([...a.sourceTitles, ...b.sourceTitles])),
      status: a.status === 'approved' || b.status === 'approved' ? 'approved' : a.status === 'reviewed' || b.status === 'reviewed' ? 'reviewed' : 'draft',
      updatedAt: new Date().toISOString(),
    };
    await saveFaqRecordsShared([merged, ...faqRecords.filter(r => r.id !== a.id && r.id !== b.id)], '重複FAQを統合しました');
  };
  const faqLibraryRecords = useMemo(() => {
    if (faqServerResult?.items?.length) return faqServerResult.items;
    const q = deferredFaqOverviewQuery.trim();
    const base = faqRecords
      .filter(record => faqOverviewStatus === 'all' || record.status === faqOverviewStatus)
      .filter(record => record.status !== 'hidden' || faqOverviewStatus === 'hidden' || faqOverviewStatus === 'all');
    const scored = base.map(record => ({ record, score: q ? scoreFaqRecord(q, record) : (record.status === 'approved' ? 90 : record.status === 'reviewed' ? 74 : record.status === 'draft' ? 42 : 10), reasons: q ? ['ローカルメタ情報検索'] : ['ステータス優先'] }))
      .filter(item => !q || item.score >= 16 || normalizeSmartText(`${item.record.question} ${item.record.answer} ${item.record.category} ${item.record.tags.join(' ')}`).includes(normalizeSmartText(q)))
      .sort((a, b) => b.score - a.score);
    return scored;
  }, [faqRecords, deferredFaqOverviewQuery, faqOverviewStatus, faqServerResult]);
  const visibleFaqLibraryRecords = useMemo(() => faqLibraryRecords.slice(0, faqDisplayLimit), [faqLibraryRecords, faqDisplayLimit]);
  const selectedFaqCount = selectedFaqIds.length;
  const visibleFaqRecordIds = useMemo<string[]>(() => visibleFaqLibraryRecords.map((item: any) => String(item.record?.id || '')).filter(Boolean), [visibleFaqLibraryRecords]);
  const allVisibleFaqSelected = visibleFaqRecordIds.length > 0 && visibleFaqRecordIds.every((id: string) => selectedFaqIds.includes(id));
  const toggleFaqSelection = (id: string) => {
    setSelectedFaqIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };
  const toggleVisibleFaqSelection = () => {
    setSelectedFaqIds(prev => allVisibleFaqSelected ? prev.filter((id: string) => !visibleFaqRecordIds.includes(id)) : Array.from(new Set([...prev, ...visibleFaqRecordIds])));
  };
  const approveFaqIds = async (ids: string[], label = '選択FAQを承認済みにしました') => {
    const targetIds = Array.from(new Set(ids)).filter(Boolean);
    if (!targetIds.length) {
      setFaqSyncStatus('承認対象のFAQが選択されていません');
      return;
    }
    const now = new Date().toISOString();
    const next = faqRecords.map(record => targetIds.includes(record.id) ? { ...record, status: 'approved' as SmartFaqStatus, updatedAt: now } : record);
    await saveFaqRecordsShared(next, `${label}（${targetIds.length}件）`);
    setSelectedFaqIds(prev => prev.filter(id => !targetIds.includes(id)));
  };
  const approveSelectedFaqRecords = async () => approveFaqIds(selectedFaqIds, '選択FAQを承認済みにしました');
  const approveCurrentReviewedFaqRecords = async () => {
    const ids = faqLibraryRecords
      .map((item: any) => item.record as SmartFaqRecord)
      .filter((record: SmartFaqRecord | undefined): record is SmartFaqRecord => Boolean(record && record.status === 'reviewed'))
      .map((record: SmartFaqRecord) => record.id);
    await approveFaqIds(ids, '現在の一覧の確認済みFAQを承認済みにしました');
  };

  const openDoc = (doc?: SmartDoc) => {
    if (!doc) return;
    if (doc.kind === 'faq') {
      const faqId = doc.sourceId || doc.id.replace(/^faq-record:/, '');
      const record = faqRecords.find(item => item.id === faqId);
      const nextQuestion = record?.question || doc.title.replace(/^❓\s*/, '');
      setChatQuestion(nextQuestion);
      askLocalFaq(nextQuestion).catch(() => undefined);
      return;
    }
    if (doc.kind === 'page' && doc.sourceId) onOpenPage(doc.sourceId);
    else if (doc.kind === 'database' && doc.sourceId) onOpenDatabase(doc.sourceId);
    else if (doc.kind === 'row' && doc.databaseId && doc.rowId && onOpenDatabaseRow) onOpenDatabaseRow(doc.databaseId, doc.rowId);
    else if (doc.kind === 'row' && doc.databaseId) onOpenDatabase(doc.databaseId);
    else if (doc.kind === 'journal' && doc.sourceId) onOpenJournal(doc.sourceId);
    else if (doc.kind === 'inbox') onOpenInbox();
    else if (doc.kind === 'task') onOpenTasks();
  };

  const openRelatedEvidence = (item: SmartRelatedEvidenceItem) => {
    if (item.type === 'page') onOpenPage(item.sourceId);
    else if (item.type === 'journal') onOpenJournal(item.sourceId.replace(/^journal_/, ''));
    else if (item.type === 'database_row' && item.databaseId && item.rowId && onOpenDatabaseRow) onOpenDatabaseRow(item.databaseId, item.rowId);
    else if (item.type === 'database_row' && item.databaseId) onOpenDatabase(item.databaseId);
    else if (item.type === 'attachment_summary' && item.parentPageId) onOpenPage(item.parentPageId);
  };

  const sourceItemForDoc = (message: SmartChatMessage, source: SmartDoc): any | null => {
    const sourceKey = workspaceSourceKeyFromDoc(source);
    return (message.workspaceSourceItems || []).find(item => workspaceSourceKeyFromResult(item) === sourceKey) || null;
  };

  const pinSourceFromMessage = (message: SmartChatMessage, source: SmartDoc) => {
    const item = sourceItemForDoc(message, source);
    if (!item) return;
    const key = workspaceSourceKeyFromResult(item);
    setPinnedWorkspaceSourceItems(prev => {
      const keys = new Set(prev.map(workspaceSourceKeyFromResult));
      if (keys.has(key)) return prev;
      return [item, ...prev].slice(0, 6);
    });
    setExcludedWorkspaceSourceKeys(prev => prev.filter(existing => existing !== key));
    setFaqSearchStatus(`根拠を固定しました: ${source.title}`);
  };

  const excludeSourceFromMessage = (source: SmartDoc) => {
    const key = workspaceSourceKeyFromDoc(source);
    if (!key) return;
    setExcludedWorkspaceSourceKeys(prev => Array.from(new Set([key, ...prev])).slice(0, 20));
    setPinnedWorkspaceSourceItems(prev => prev.filter(item => workspaceSourceKeyFromResult(item) !== key));
    setFaqSearchStatus(`根拠を除外しました: ${source.title}`);
  };

  const rerunWithOnlySource = (question: string, message: SmartChatMessage, source: SmartDoc) => {
    const item = sourceItemForDoc(message, source);
    if (!item) return;
    const key = workspaceSourceKeyFromResult(item);
    askLocalFaq(question, {
      sourceMode: 'pinned_only',
      pinnedSourceKeys: [key],
      pinnedSourceItems: [item],
      excludedSourceKeys: [],
      statusPrefix: '固定根拠で再回答',
    }).catch(() => undefined);
  };

  const compactSmartSuggestions = (message: SmartChatMessage) => {
    const seen = new Set<string>();
    const push = (items?: string[]) => (items || [])
      .map(item => String(item || '').trim())
      .filter(item => {
        const key = normalizeSmartText(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const confidence = message.confidence ?? 100;
    const needsClarification = message.confidenceLevel === 'low' || message.confidenceLevel === 'insufficient' || confidence < 70;
    return {
      primaryChecks: needsClarification ? push(message.followUpQuestions).slice(0, 2) : [],
      primaryActions: confidence < 58 ? push(message.suggestedActions).slice(0, 2) : [],
      extras: [...push(message.nextQuestions), ...push(message.clarificationChips), ...push(message.suggestedActions)].slice(0, 8),
    };
  };

  const compactRelatedEvidence = (message: SmartChatMessage) => {
    const sourceIds = new Set((message.sources || []).map(source => normalizeSmartText(`${source.sourceId || source.id} ${source.title}`)));
    const seen = new Set<string>();
    return (message.relatedEvidence || [])
      .filter(item => item.score >= 45)
      .filter(item => {
        const itemKey = normalizeSmartText(`${item.sourceId || item.id} ${item.title}`);
        if (!itemKey || seen.has(itemKey)) return false;
        seen.add(itemKey);
        for (const sourceKey of sourceIds) {
          if (sourceKey && (itemKey.includes(sourceKey) || sourceKey.includes(itemKey))) return false;
        }
        return true;
      })
      .slice(0, 8);
  };

  return (
    <section className="smart-chat-page-v137 smart-chat-page-v223">
      <header className="smart-chat-hero-v137 smart-chat-hero-v222">
        <div className="smart-chat-title-v222">
          <span className="smart-eyebrow-v134">Local Smart Assist</span>
          <h1>ローカルAIチャット</h1>
        </div>
        <div className="smart-chat-status-v137 smart-chat-status-v220 smart-chat-status-v222">
          <div><strong>{faqStats.total}</strong><span>FAQ</span></div>
          <div><strong>{faqStats.approved}</strong><span>承認</span></div>
          <div><strong>{faqStats.draft}</strong><span>下書き</span></div>
          <button type="button" className="smart-hero-admin-button-v220 smart-hero-admin-button-v222" onClick={() => { setSmartAdminTab('overview'); setShowSmartAssistControlPanel(true); }}>⚙️ 管理</button>
        </div>
      </header>

      {docs.length ? <div className="smart-chat-shell-v137">
        <main className="smart-chat-main-v137 smart-chat-main-v220">
          <section className="smart-chat-topbar-v221" aria-label="Smart Assist controls">
            <div className="smart-chat-topbar-title-v221">
              <strong>AIチャット</strong>
              <span>ワークスペース横断検索を根拠に生成AIで回答</span>
              <small className="smart-generation-inline-status-v367">生成AI: {generationSettings?.enabled ? (generationCheck?.ok ? 'ON・利用可能' : 'ON・要確認') : 'OFF'} / 回答方式: {generationSettings?.enabled && generationCheck?.ok ? '生成あり優先' : '検索ベース優先'} / DB行Index: {Number(workspaceSemanticInfo?.typeCounts?.database_row || 0)}件</small>
            </div>
            <div className="smart-chat-topbar-actions-v221">
              <button type="button" className="primary" onClick={() => { setSmartAdminTab('overview'); setShowSmartAssistControlPanel(true); }}>⚙️ 管理画面</button>
              <button type="button" onClick={() => { setSmartAdminTab('stats'); setShowSmartAssistControlPanel(true); }}>📊 統計</button>
              <button type="button" disabled={operationProgress.busy} onClick={rebuildFaqSearchIndex}>🔁 再生成</button>
            </div>
          </section>
          {(pinnedWorkspaceSourceItems.length || excludedWorkspaceSourceKeys.length) ? <section className="smart-source-control-v365" aria-label="根拠コントロール">
            <strong>根拠コントロール</strong>
            <span>固定 {pinnedWorkspaceSourceItems.length}件 / 除外 {excludedWorkspaceSourceKeys.length}件</span>
            <button type="button" onClick={() => { setPinnedWorkspaceSourceItems([]); setExcludedWorkspaceSourceKeys([]); setFaqSearchStatus('根拠の固定・除外をリセットしました'); }}>リセット</button>
          </section> : null}
          {popularQuestionChips.length ? <section className="smart-popular-chips-v219 smart-popular-chips-v220" aria-label="よくある質問">
            <div><strong>質問例</strong></div>
            <div>{popularQuestionChips.slice(0, 8).map(q => <button key={q} type="button" title={q} onClick={() => askLocalFaq(q)}>{q}</button>)}</div>
          </section> : null}
          <div className="smart-chat-log-v137" ref={chatLogRef}>
            {chatMessages.map(message => <article key={message.id} ref={node => { chatMessageRefs.current[message.id] = node; }} onClick={() => message.role === 'assistant' ? setFocusMessageId(message.id) : undefined} className={`smart-chat-message-v136 ${message.role} ${focusMessageId === message.id ? 'is-focused-v152' : ''}`}>
              {message.role === 'assistant' && typeof message.confidence === 'number' ? <div className={`smart-answer-quality-v142 level-${message.confidenceLevel || 'medium'}`}>
                <strong>信頼度 {message.confidence}%</strong><span>{confidenceLabelJa(message.confidenceLevel || 'medium')}</span>
                {message.warnings?.length ? <small>{message.warnings[0]}</small> : <small>根拠付きローカル回答</small>}
                {message.answerStatus ? <div className="smart-answer-runtime-v367">
                  <span>{message.answerStatus.generated ? '生成AI回答' : '検索ベース'}</span>
                  {message.answerStatus.planLabel ? <span>{message.answerStatus.planLabel}</span> : null}
                  {message.answerStatus.sourceCount !== undefined ? <span>根拠 {message.answerStatus.sourceCount}件</span> : null}
                  {message.answerStatus.dbFilterUsed ? <span>DB条件 {message.answerStatus.dbFilterCount || 0}件</span> : null}
                  {message.answerStatus.sourceMode === 'pinned_only' ? <span>固定根拠のみ</span> : null}
                  {message.answerStatus.verificationLabel ? <span>検証 {message.answerStatus.verificationLabel}</span> : null}
                  {message.answerStatus.elapsedMs ? <span>{Math.round(message.answerStatus.elapsedMs / 100) / 10}秒</span> : null}
                </div> : null}
              </div> : null}
              <div className="smart-chat-bubble-v136"><MarkdownAnswer markdown={message.text} /></div>
              {message.role === 'assistant' ? (() => {
                const suggestions = compactSmartSuggestions(message);
                const evidence = compactRelatedEvidence(message);
                const hasExtras = suggestions.extras.length > 0;
                const showSupport = suggestions.primaryChecks.length > 0 || suggestions.primaryActions.length > 0;
                return <>
                  {showSupport ? <div className="smart-answer-support-v290">
                    {suggestions.primaryChecks.length ? <div>
                      <strong>確認ポイント</strong>
                      <div>{suggestions.primaryChecks.map(q => <button key={q} type="button" onClick={(event) => { event.stopPropagation(); handleSuggestionClick(q, 'clarify'); }}>❓ {q}</button>)}</div>
                    </div> : null}
                    {suggestions.primaryActions.length ? <div>
                      <strong>次の操作</strong>
                      <div>{suggestions.primaryActions.map(action => <button key={action} type="button" onClick={(event) => { event.stopPropagation(); handleSuggestionClick(action, 'action'); }}>✨ {action}</button>)}</div>
                    </div> : null}
                  </div> : null}
                  <div className="smart-forced-evidence-v219 smart-forced-evidence-v290">
                    <strong>根拠</strong>
                    {message.sources?.length ? message.sources.slice(0, 4).map(source => {
                      const previousQuestion = previousUserQuestionForMessage(chatMessages, message.id);
                      const sourceKey = workspaceSourceKeyFromDoc(source);
                      const isPinned = pinnedWorkspaceSourceItems.some(item => workspaceSourceKeyFromResult(item) === sourceKey);
                      const isExcluded = excludedWorkspaceSourceKeys.includes(sourceKey);
                      return <div key={source.id} className="smart-source-card-v365" onClick={(event) => event.stopPropagation()}>
                        <button type="button" onClick={() => openDoc(source)}>📎 {source.title}</button>
                        <small>{source.kind === 'row' ? `DB行${source.databaseTitle ? ` ・ ${source.databaseTitle}` : ''}` : source.kind.toUpperCase()}{typeof source.score === 'number' ? ` ・ score ${source.score}` : ''}{isPinned ? ' ・ 固定中' : ''}{isExcluded ? ' ・ 除外中' : ''}</small>
                        {source.kind === 'row' && source.propertySummary ? <p className="smart-db-source-summary-v368">{source.propertySummary}</p> : null}
                        {message.engine === 'workspace-ai' ? <span className="smart-source-actions-v365">
                          {source.kind === 'row' && source.databaseId ? <button type="button" onClick={() => onOpenDatabase(source.databaseId!)}>DBを開く</button> : null}
                          <button type="button" disabled={!sourceItemForDoc(message, source)} onClick={() => rerunWithOnlySource(previousQuestion, message, source)}>この根拠だけで再回答</button>
                          <button type="button" disabled={!sourceItemForDoc(message, source) || isPinned} onClick={() => pinSourceFromMessage(message, source)}>固定</button>
                          <button type="button" disabled={isExcluded} onClick={() => excludeSourceFromMessage(source)}>除外</button>
                        </span> : null}
                      </div>;
                    }) : <span>明確な根拠を特定できませんでした。断定回答を避け、候補確認または担当確認を推奨します。</span>}
                  </div>
                  {(message.selectionReasons?.length || message.matchedTerms?.length || message.candidateFaqs?.length) ? <div className="smart-answer-why-v315">
                    <div className="smart-answer-why-head-v315">
                      <strong>{message.engine === 'workspace-ai' ? 'この根拠を選んだ理由' : 'このFAQを選んだ理由'}</strong>
                      <small>確認しやすいように、判定材料を表示しています。</small>
                    </div>
                    {message.selectionReasons?.length ? <ul>
                      {message.selectionReasons.slice(0, 5).map(reason => <li key={reason}>{reason}</li>)}
                    </ul> : null}
                    {message.matchedTerms?.length ? <div className="smart-answer-term-tags-v315">
                      {message.matchedTerms.slice(0, 8).map(term => <span key={term}>{term}</span>)}
                    </div> : null}
                    {message.candidateFaqs?.length ? <details className="smart-answer-candidates-v315">
                      <summary onClick={(event) => event.stopPropagation()}>近いFAQ候補を表示</summary>
                      <div>
                        {message.candidateFaqs.slice(0, 4).map(item => <button key={`${item.id || item.question}:${item.score || ''}`} type="button" onClick={(event) => { event.stopPropagation(); handleSuggestionClick(item.question, 'question'); }}>
                          <b>{item.question}</b>
                          <small>{item.category || 'FAQ'}{typeof item.score === 'number' ? ` ・ 信頼度 ${item.score}%` : ''}{item.reasons?.length ? ` ・ ${item.reasons[0]}` : ''}</small>
                        </button>)}
                      </div>
                    </details> : null}
                  </div> : null}

                  {message.relatedTags?.length ? <div className="smart-related-tags-v422" onClick={(event) => event.stopPropagation()}>
                    <strong>関連タグ</strong>
                    <span>{message.relatedTags.map((item) => <button key={item.tag} type="button" title={`${item.reason}・${item.pageCount}ページ`} onClick={() => setChatQuestion(`${item.tag} `)}>#{item.tag}{item.group ? <em>{item.group}</em> : null}<small>{item.pageCount}</small></button>)}</span>
                  </div> : null}

                  <div className="smart-answer-feedback-v316" onClick={(event) => event.stopPropagation()}>
                    <span>{message.feedbackState === 'good' ? '👍 役に立ったとして記録済み' : message.feedbackState === 'bad' ? '👎 改善ログに登録済み' : message.feedbackState === 'queued' ? '📝 改善キューへ自動登録済み' : 'この回答は役に立ちましたか？'}</span>
                    <button type="button" disabled={message.feedbackState === 'good'} onClick={() => addAnswerFeedback('good', message, previousUserQuestionForMessage(chatMessages, message.id))}>👍 役に立った</button>
                    <button type="button" disabled={message.feedbackState === 'bad'} onClick={() => addAnswerFeedback('bad', message, previousUserQuestionForMessage(chatMessages, message.id))}>👎 違う</button>
                    <button type="button" onClick={() => saveChatAnswerAsFaqDraft(previousUserQuestionForMessage(chatMessages, message.id), message)}>📝 FAQ下書き</button>
                    {message.candidateFaqs?.length ? <details>
                      <summary>正しそうな候補を選んで記録</summary>
                      <div>{message.candidateFaqs.slice(0, 4).map(item => <button key={`fb:${message.id}:${item.id || item.question}`} type="button" onClick={() => addAnswerFeedback('bad', message, previousUserQuestionForMessage(chatMessages, message.id), item.id)}>{item.question}</button>)}</div>
                    </details> : null}
                  </div>
                  {evidence.length ? <div className="smart-related-evidence-v289 smart-related-evidence-v290">
                    <div className="smart-related-evidence-head-v289">
                      <strong>参考候補</strong>
                      <small>上位{Math.min(3, evidence.length)}件を表示。追加確認用です。</small>
                    </div>
                    <div className="smart-related-evidence-list-v289">
                      {evidence.slice(0, 3).map(item => {
                        const canOpen = item.type === 'page' || item.type === 'journal' || item.type === 'database_row' || (item.type === 'attachment_summary' && item.parentPageId);
                        return <button key={item.id} type="button" disabled={!canOpen} onClick={(event) => { event.stopPropagation(); openRelatedEvidence(item); }}>
                          <span className="smart-related-evidence-score-v289">{item.score}</span>
                          <span className="smart-related-evidence-body-v289">
                            <b>{smartEvidenceTypeIcon(item.type)} {item.title}</b>
                            <small>{smartEvidenceTypeLabel(item.type)}{item.type === 'database_row' && item.databaseTitle ? ` ・ ${item.databaseTitle}` : ''}{item.titleScore ? ` ・ タイトル${item.titleScore}%` : item.semanticScore ? ` ・ 意味${item.semanticScore}%` : ''}</small>
                            {item.type === 'database_row' && item.propertySummary ? <em className="smart-db-source-summary-v368">{item.propertySummary}</em> : null}
                          </span>
                        </button>;
                      })}
                    </div>
                    {evidence.length > 3 ? <details className="smart-related-more-v290">
                      <summary onClick={(event) => event.stopPropagation()}>ほかの候補を表示</summary>
                      <div>
                        {evidence.slice(3, 8).map(item => {
                          const canOpen = item.type === 'page' || item.type === 'journal' || item.type === 'database_row' || (item.type === 'attachment_summary' && item.parentPageId);
                          return <button key={item.id} type="button" disabled={!canOpen} onClick={(event) => { event.stopPropagation(); openRelatedEvidence(item); }}>
                            {smartEvidenceTypeIcon(item.type)} {item.title}
                            <small>{smartEvidenceTypeLabel(item.type)}{item.type === 'database_row' && item.databaseTitle ? ` ・ ${item.databaseTitle}` : ''} ・ score {item.score}{item.titleScore ? ` ・ タイトル${item.titleScore}%` : ''}{item.metaScore ? ` ・ メタ${item.metaScore}%` : ''}</small>
                            {item.type === 'database_row' && item.propertySummary ? <em className="smart-db-source-summary-v368">{item.propertySummary}</em> : null}
                          </button>;
                        })}
                      </div>
                    </details> : null}
                  </div> : null}
                  {hasExtras ? <details className="smart-suggestion-more-v290">
                    <summary onClick={(event) => event.stopPropagation()}>質問候補・絞り込みを表示</summary>
                    <div>{suggestions.extras.map(item => <button key={item} type="button" onClick={(event) => { event.stopPropagation(); handleSuggestionClick(item, 'question'); }}>💬 {item}</button>)}</div>
                  </details> : null}
                </>;
              })() : null}
            </article>)}
          </div>

          <div className="smart-chat-composer-v137">
            {weakAnswer ? <div className="smart-no-answer-actions-v158 smart-no-answer-suggestions-v159 smart-no-answer-suggestions-v160">
              <div><strong>⚠️ 見つからない時</strong><small>質問を言い換えるか、未回答FAQとして残せます。</small></div>
              <button type="button" onClick={() => setChatQuestion((lastUser?.text || '').split(/[、。\s]/).filter(Boolean).slice(0, 3).join(' '))}>短くする</button>
              <button type="button" onClick={() => setChatQuestion(`${lastUser?.text || ''} カテゴリ`) }>カテゴリ追加</button>
              <button type="button" onClick={() => setChatQuestion(`${lastUser?.text || ''} PDF`) }>PDF名追加</button>
              <button type="button" onClick={saveLastQuestionAsUnansweredFaq} disabled={!lastUser}>未回答FAQへ</button>
            </div> : null}
            <div className="smart-chat-compact-options-v223">
              <label><input type="checkbox" checked={chatHistoryEnabled} onChange={e => setChatHistoryEnabled(e.target.checked)} /> 履歴を元に続ける</label>
              <button type="button" onClick={() => { setSmartAdminTab('overview'); setShowSmartAssistControlPanel(true); }}>管理画面</button>
              <button type="button" onClick={clearChatHistory}>履歴削除</button>
            </div>
            <form className="smart-chat-form-v136 smart-chat-form-v155 smart-chat-form-v156" onSubmit={e => { e.preventDefault(); askLocalFaq(); }}>
              <input value={chatQuestion} onChange={e => setChatQuestion(e.target.value)} placeholder="質問してください。例：学童クラブの費用はどれくらいですか" autoFocus />
              <button type="submit" className="smart-ask-submit-v224" title="質問する"><span>質問する</span><small>↵</small></button>
            </form>
          </div>
        </main>

        {/* v221: right-side manager removed. Admin functions now live only in the dedicated modal. */}
      </div> : <div className="empty"><h1>対象データがありません</h1><p>ページやDBを作成するとLocal Smart Assistが使えます。</p></div>}


      {showSmartAssistControlPanel ? <div className="smart-modal-backdrop-v141" role="dialog" aria-modal="true" aria-label="Smart Assist 運用パネル">
        <section className="smart-assist-control-modal-v196 smart-admin-modal-v224 smart-admin-modal-v229 smart-admin-modal-v232" onMouseDown={e => e.stopPropagation()}>
          <div className="smart-faq-json-modal-head-v141">
            <strong>Smart Assist 管理画面</strong>
            <button type="button" onClick={() => setShowSmartAssistControlPanel(false)}>閉じる</button>
          </div>
          <p className="muted-small smart-admin-lead-v224">FAQ・評価セット・辞書・担当先など、AI回答に関係するデータを一箇所で管理します。日常運用で迷わないよう、編集・入出力・統計・再生成を分けています。</p>
          <div className="smart-admin-tabs-v219 smart-admin-tabs-v229 smart-admin-tabs-v232">
            {[['overview','概要'],['faq','FAQ管理'],['workspace-search','AI横断検索'],['model','検索AI'],['generation','生成AI'],['semantic','関連Index'],['data','AIデータ'],['stats','質問統計'],['improvement','改善キュー'],['ops','運用']].map(([key,label]) => <button key={key} type="button" className={smartAdminTab === key ? 'active' : ''} onClick={() => setSmartAdminTab(key as any)}><span>{label}</span></button>)}
          </div>
          <div className={`smart-operation-progress-v210 ${operationProgress.phase}`}>
            <div className="smart-operation-progress-main-v210">
              <span className="smart-operation-dot-v210" aria-hidden="true" />
              <div>
                <strong>{operationProgress.busy ? `${operationProgress.label}中` : operationProgress.label}</strong>
                <small>{operationProgress.detail}{operationProgress.busy && operationProgress.startedAt ? `（${formatSmartOperationSeconds(operationProgress.startedAt)}）` : ''}</small>
              </div>
            </div>
            {operationProgress.busy ? <div className="smart-operation-bar-v210"><span /></div> : null}
          </div>
          {smartAdminTab === 'overview' ? <div className="smart-admin-dashboard-v219 smart-admin-dashboard-v224">
            <div><b>{faqStats.total}</b><span>FAQ総数</span><small>登録されているFAQの件数です。</small></div>
            <div><b>{faqStats.approved}</b><span>承認済み</span><small>回答に使える状態のFAQです。</small></div>
            <div><b>{faqReviewQueue.lowQuality.length}</b><span>品質要改善</span><small>見直し候補として残っているFAQです。</small></div>
            <div><b>{questionRankingStats.length}</b><span>質問統計</span><small>利用者が聞いた質問の集計です。</small></div>
            <div className={transformerRuntimeInfo?.modelExists ? 'smart-runtime-ok-v235' : 'smart-runtime-warn-v235'}><b>{transformerRuntimeInfo?.modelExists ? 'OK' : '未配置'}</b><span>外部モデル</span><small>{transformerRuntimeInfo?.modelExists ? '任意フォルダのローカルモデルを使用します。' : 'AIモデル設定でモデル保存先を指定してください。'}</small></div>
            <div className={transformerRuntimeInfo?.wasmExists ? 'smart-runtime-ok-v235' : 'smart-runtime-warn-v235'}><b>{transformerRuntimeInfo?.wasmExists ? 'OK' : '未配置'}</b><span>WASM</span><small>{transformerRuntimeInfo?.wasmExists ? 'CPU/WASM実行に必要なファイルがあります。' : 'npm run prepare:transformer-resources を実行してください。'}</small></div>
            <div className={workspaceSemanticInfo?.ok ? 'smart-runtime-ok-v235' : 'smart-runtime-warn-v235'}><b>{workspaceSemanticInfo?.indexedCount || 0}</b><span>関連Index</span><small>{workspaceSemanticInfo?.ok ? `最終生成 ${formatSemanticGeneratedAt(workspaceSemanticInfo.generatedAt)}` : 'ページ・DB・Journal関連表示用のIndexが未生成です。'}</small></div>
            <div className={generationCheck?.ok ? 'smart-runtime-ok-v235' : 'smart-runtime-warn-v235'}><b>{generationSettings?.enabled ? (generationCheck?.ok ? 'OK' : '確認') : 'OFF'}</b><span>生成AI</span><small>{generationSettings?.enabled ? (generationCheck?.selectedModelPath ? fileNameFromPath(generationCheck.selectedModelPath) : 'モデルフォルダを確認してください。') : '必要時だけONにします。'}</small></div>
          </div> : null}
          {smartAdminTab === 'workspace-search' ? <div className="smart-admin-workspace-search-v323">
            <WorkspaceAiSearch
              api={api}
              autoFocus
              onOpenPage={onOpenPage}
              onOpenDatabase={onOpenDatabase}
              onOpenDatabaseRow={onOpenDatabaseRow}
              onOpenJournal={onOpenJournal}
            />
          </div> : null}
          {smartAdminTab === 'faq' ? <div className="smart-faq-workspace-v240">
            <section className="smart-faq-hero-v240">
              <div className="smart-faq-hero-copy-v240">
                <span>FAQ Studio</span>
                <h3>FAQを作成・確認・承認する</h3>
                <p>質問と回答をカードで整理し、確認済みFAQをまとめて承認できます。編集後のステータスは一覧へ即時反映されます。</p>
              </div>
              <div className="smart-faq-hero-actions-v240">
                <button type="button" className="primary" onClick={openNewFaqEditor}>＋ 新しいFAQを作成</button>
                <button type="button" onClick={rebuildFaqSearchIndex} disabled={operationProgress.busy}>検索を再生成</button>
              </div>
            </section>

            <section className="smart-faq-summary-grid-v240">
              <article><span>全FAQ</span><b>{faqStats.total}</b><small>登録済み</small></article>
              <article><span>承認済み</span><b>{faqStats.approved}</b><small>回答に使用</small></article>
              <article><span>確認済み</span><b>{faqRecords.filter(record => record.status === 'reviewed').length}</b><small>承認待ち</small></article>
              <article><span>未回答</span><b>{faqReviewQueue.unanswered.length}</b><small>育成候補</small></article>
              <article><span>要改善</span><b>{faqReviewQueue.lowQuality.length}</b><small>品質チェック</small></article>
            </section>

            <section className="smart-faq-control-panel-v240">
              <div className="smart-faq-searchbox-v240">
                <label>検索</label>
                <input value={faqOverviewQuery} onChange={e => setFaqOverviewQuery(e.target.value)} placeholder="例：費用、減免、申請期限、放課後児童クラブ" />
              </div>
              <div className="smart-faq-status-filter-v240">
                <label>表示</label>
                <select value={faqOverviewStatus} onChange={e => { setFaqOverviewStatus(e.target.value as any); setSelectedFaqIds([]); setFaqDisplayLimit(120); }}>
                  <option value="approved">承認済み</option>
                  <option value="reviewed">確認済み</option>
                  <option value="draft">下書き</option>
                  <option value="hidden">非表示</option>
                  <option value="all">すべて</option>
                </select>
              </div>
              <button type="button" onClick={generateEvaluationSetFromFaqRecords} disabled={!faqRecords.length || operationProgress.busy}>評価セット生成</button>
              <button type="button" onClick={runSmartAssistEvaluationSet} disabled={operationProgress.busy}>正答率測定</button>
              <button type="button" onClick={() => setSmartAdminTab('data')}>AIデータ</button>
            </section>

            <section className="smart-faq-bulk-panel-v240">
              <div>
                <strong>{faqLibraryRecords.length}件中 {visibleFaqLibraryRecords.length}件表示</strong>
                <small>{selectedFaqCount ? `${selectedFaqCount}件選択中` : 'チェックを入れるとまとめて操作できます。'}</small>
              </div>
              <div className="smart-faq-bulk-actions-v240">
                <button type="button" onClick={toggleVisibleFaqSelection}>{allVisibleFaqSelected ? '表示中の選択を解除' : '表示中をすべて選択'}</button>
                <button type="button" className="primary" onClick={approveSelectedFaqRecords} disabled={!selectedFaqCount}>選択を承認済みにする</button>
                <button type="button" onClick={approveCurrentReviewedFaqRecords} disabled={!faqLibraryRecords.some((item: any) => item.record?.status === 'reviewed')}>確認済みを一括承認</button>
              </div>
            </section>

            {evaluationReport ? <section className="smart-evaluation-report-v227 smart-evaluation-report-v228">
              <div className="smart-evaluation-report-head-v227"><div><strong>正答率レポート</strong><small>高信頼誤答と未回答を優先して直します。</small></div><b>{evaluationReport.accuracy ?? 0}%</b></div>
              <div className="smart-evaluation-metrics-v227"><span>テスト {evaluationReport.testedCount ?? 0}問</span><span>正解 {evaluationReport.passedCount ?? 0}問</span><span>不正解 {evaluationReport.failedCount ?? 0}問</span><span>高信頼誤答 {evaluationReport.highWrongCount ?? 0}件</span><span>未回答 {evaluationReport.noAnswerCount ?? 0}件</span></div>
            </section> : null}

            <div className="smart-faq-card-list-v240">
              {visibleFaqLibraryRecords.length === 0 ? <div className="smart-faq-empty-v240"><b>表示できるFAQがありません</b><span>検索条件やステータスを変更するか、新しいFAQを作成してください。</span><button type="button" className="primary" onClick={openNewFaqEditor}>＋ FAQを作成</button></div> : visibleFaqLibraryRecords.map((item: any) => {
                const record = item.record;
                const quality = faqQualityMap.get(record.id) || scoreFaqQuality(record);
                const selected = selectedFaqIds.includes(record.id);
                return <article key={record.id} className={`smart-faq-card-v240 ${selected ? 'is-selected' : ''}`}>
                  <div className="smart-faq-card-select-v240">
                    <input aria-label={`${record.question}を選択`} type="checkbox" checked={selected} onChange={() => toggleFaqSelection(record.id)} />
                  </div>
                  <div className="smart-faq-card-content-v240">
                    <div className="smart-faq-card-meta-v240">
                      <span className={`smart-faq-status-pill-v240 status-${record.status}`}>{record.status === 'approved' ? '承認済み' : record.status === 'reviewed' ? '確認済み' : record.status === 'draft' ? '下書き' : record.status === 'hidden' ? '非表示' : record.status}</span>
                      <span className={`smart-faq-quality-pill-v240 score-${quality.score >= 85 ? 'high' : quality.score >= 65 ? 'mid' : 'low'}`}>品質 {quality.score}</span>
                      <span>{record.category || '未分類'}</span>
                      {record.sourceTitles?.length || record.source?.title ? <span>根拠あり</span> : <span className="warn">出典なし</span>}
                    </div>
                    <h4>{record.question || '質問未入力'}</h4>
                    <p>{record.answer?.slice(0, 220) || '回答未入力'}{record.answer && record.answer.length > 220 ? '…' : ''}</p>
                    <div className="smart-faq-card-tags-v240">{(record.tags || []).slice(0, 8).map((tag: string) => <span key={tag}>{tag}</span>)}{quality.missing.length ? <em>改善: {quality.missing.slice(0, 3).join(' / ')}</em> : <em>検索ヒント設定済み</em>}</div>
                  </div>
                  <div className="smart-faq-card-actions-v240">
                    <button type="button" className="primary" onClick={() => openFaqEditor(record)}>編集</button>
                    {record.status !== 'approved' ? <button type="button" onClick={() => approveFaqIds([record.id], 'FAQを承認済みにしました')}>承認</button> : null}
                    <button type="button" onClick={() => runSmartFaqTest(record)} disabled={testingFaqId === record.id}>{testingFaqId === record.id ? 'テスト中' : 'テスト'}</button>
                    <button type="button" onClick={() => askLocalFaq(record.question)}>質問</button>
                    <button type="button" className="danger" onClick={() => deleteFaqRecord(record.id)}>削除</button>
                  </div>
                </article>;
              })}
            </div>

            {faqLibraryRecords.length > visibleFaqLibraryRecords.length ? <div className="smart-faq-load-more-v240"><button type="button" onClick={() => setFaqDisplayLimit(prev => prev + 120)}>さらに120件表示</button><span>{visibleFaqLibraryRecords.length} / {faqLibraryRecords.length}</span></div> : null}
          </div> : null}

          {smartAdminTab === 'model' ? <div className="smart-admin-model-panel-v236">
            <div className="smart-admin-section-head-v225"><div><strong>AIモデル設定</strong><small>既定モデルは sirasagi62/ruri-v3-70m-ONNX です。Ruri v3 30M/70M と multilingual-e5-small を任意フォルダから切り替えできます。</small></div></div>
            <section className="smart-model-settings-card-v236">
              <label>モデルID</label>
              <select value={transformerSettings?.modelId || ''} onChange={e => setTransformerSettings((prev: any) => ({ ...(prev || {}), modelId: e.target.value }))}>
                <option value="sirasagi62/ruri-v3-70m-ONNX">Ruri v3 70M ONNX（標準・日本語高精度）</option>
                <option value="onnx-community/ruri-v3-30m-ONNX">Ruri v3 30M ONNX（軽量・日本語）</option>
                <option value="Xenova/multilingual-e5-small">multilingual-e5-small（多言語）</option>
              </select>
              <input value={transformerSettings?.modelId || ''} onChange={e => setTransformerSettings((prev: any) => ({ ...(prev || {}), modelId: e.target.value }))} placeholder="sirasagi62/ruri-v3-70m-ONNX" />
              <label>モデル保存先フォルダ</label>
              <div className="smart-model-root-picker-v244">
                <input value={transformerSettings?.modelRoot || ''} onChange={e => setTransformerSettings((prev: any) => ({ ...(prev || {}), modelRoot: e.target.value }))} placeholder="D:\LocalNotionModels または /Users/name/Desktop/LocalNotionModels" />
                <button type="button" onClick={chooseTransformerModelRootFromDialog} disabled={transformerModelBusy}>フォルダを選択</button>
              </div>
              <p className="muted-small">モデル保存先にはモデル提供者フォルダの親フォルダを指定します。例: D:\LocalNotionModels。Ruri70Mは sirasagi62\ruri-v3-70m-ONNX\onnx\model_quantized.onnx または model.onnx を使用します。</p>
              <label>ローカルSQLiteキャッシュ保存先</label>
              <div className="smart-model-root-picker-v244">
                <input value={transformerSettings?.localCacheDir || ''} onChange={e => setTransformerSettings((prev: any) => ({ ...(prev || {}), localCacheDir: e.target.value }))} placeholder="各PCのローカルフォルダを指定。例: /Users/name/LocalNotionCache または D:\LocalNotionCache" />
                <button type="button" onClick={chooseSemanticCacheDirFromDialog} disabled={transformerModelBusy}>フォルダを選択</button>
              </div>
              <p className="muted-small">共有フォルダは正本、ここで指定するSQLiteは高速キャッシュです。壊れても再構築できます。会社PCでは書込可能なローカルフォルダを指定してください。</p>
              <div className="smart-model-actions-v236">
                <button type="button" onClick={saveTransformerModelSettings} disabled={transformerModelBusy}>設定を保存</button>
                <button type="button" onClick={refreshTransformerModelStatus} disabled={transformerModelBusy}>モデル確認</button>
                <button type="button" className="primary" onClick={downloadTransformerModelFromAdmin} disabled={transformerModelBusy}>モデル取得</button>
                <button type="button" onClick={rebuildFaqSearchIndex} disabled={operationProgress.busy || transformerModelBusy}>FAQ検索差分更新</button>
                <button type="button" onClick={refreshSemanticCacheInfo} disabled={transformerModelBusy}>キャッシュ状態</button>
                <button type="button" onClick={refreshCacheTopologyInfo} disabled={transformerModelBusy}>キャッシュ構造を確認</button>
                <button type="button" onClick={refreshUiDisplayCacheInfo} disabled={transformerModelBusy}>UI表示キャッシュ確認</button>
                <button type="button" onClick={rebuildUiDisplayCacheFromAdmin} disabled={transformerModelBusy}>UI表示キャッシュ再構築</button>
                <button type="button" onClick={refreshWorkspaceDerivedIndexInfo} disabled={transformerModelBusy}>リンク・添付Index確認</button>
                <button type="button" onClick={rebuildWorkspaceDerivedIndexFromAdmin} disabled={transformerModelBusy}>リンク・添付Index再構築</button>
                <button type="button" onClick={refreshWorkspaceSummaryIndexInfo} disabled={transformerModelBusy}>Task・Journal Index確認</button>
                <button type="button" onClick={rebuildWorkspaceSummaryIndexFromAdmin} disabled={transformerModelBusy}>Task・Journal Index再構築</button>
                <button type="button" onClick={refreshDatabaseIndexInfo} disabled={transformerModelBusy}>Database Index確認</button>
                <button type="button" onClick={rebuildDatabaseIndexFromAdmin} disabled={transformerModelBusy}>Database Index再構築</button>
                <button type="button" onClick={clearSemanticQueryCacheFromAdmin} disabled={transformerModelBusy}>検索結果キャッシュ削除</button>
                <button type="button" onClick={rebuildWorkspaceSemanticIndexFromAdmin} disabled={operationProgress.busy || transformerModelBusy}>関連Index再生成</button>
              </div>
              {transformerModelMessage ? <p className="smart-model-message-v236">{transformerModelMessage}</p> : null}
            </section>
            <section className="smart-model-status-grid-v236">
              <article><strong>現在のモデル</strong><span>{transformerRuntimeInfo?.model || transformerSettings?.modelId || '未設定'}</span></article>
              <article><strong>取得元</strong><span>{transformerRuntimeInfo?.modelSource || '未確認'}</span></article>
              <article><strong>ローカルキャッシュ</strong><span>{semanticCacheInfo?.enabled ? (semanticCacheInfo?.needsUpdate ? '差分更新が必要' : '最新') : '未設定'}</span></article>
              <article><strong>Semantic件数</strong><span>{semanticCacheInfo?.semanticCount ?? 0} / {semanticCacheInfo?.expectedCount ?? '-'}</span></article>
              <article><strong>Query Cache</strong><span>{semanticCacheInfo?.queryCount ?? 0}件</span></article>
              <article><strong>キャッシュDB</strong><span title={semanticCacheInfo?.dbPath || ''}>{semanticCacheInfo?.dbPath ? String(semanticCacheInfo.dbPath).split(/[\/]/).slice(-2).join('/') : '未設定'}</span></article>
              <article><strong>ONNX</strong><span>{transformerRuntimeInfo?.onnxSizeMb ? `${transformerRuntimeInfo.onnxSizeMb} MB` : transformerModelCheck?.onnxSizeMb ? `${transformerModelCheck.onnxSizeMb} MB` : '未確認'}</span></article>
              <article><strong>状態</strong><span>{transformerRuntimeInfo?.ok || transformerModelCheck?.ok ? '利用可能' : '未確認 / 不足あり'}</span></article>
            </section>
            {cacheTopologyInfo ? <section className="smart-cache-topology-v320">
              <div className="smart-admin-section-head-v225"><div><strong>キャッシュ構造</strong><small>既存SQLとRuri-v3用ローカルSQLiteの役割を分けて表示します。</small></div></div>
              <div className="smart-cache-explain-v320">
                <p><b>現在のSQL:</b> {cacheTopologyInfo?.explanation?.existingSql || 'アプリ既存のローカルDBです。'}</p>
                <p><b>Ruri-v3キャッシュ:</b> {cacheTopologyInfo?.explanation?.semanticCache || 'Semantic Index専用DBです。'}</p>
                <p><b>正本:</b> {cacheTopologyInfo?.explanation?.sourceOfTruth || '共有フォルダのデータが正本です。'}</p>
              </div>
              <div className="smart-model-status-grid-v236">
                <article><strong>共有フォルダ Pages</strong><span>{cacheTopologyInfo?.sharedSource?.counts?.pages ?? 0}件</span></article>
                <article><strong>共有フォルダ DB</strong><span>{cacheTopologyInfo?.sharedSource?.counts?.databases ?? 0}件</span></article>
                <article><strong>共有フォルダ Journal</strong><span>{cacheTopologyInfo?.sharedSource?.counts?.journals ?? 0}件</span></article>
                <article><strong>FAQ正本</strong><span>{cacheTopologyInfo?.sharedSource?.counts?.faqRecords ?? 0}件</span></article>
                <article><strong>Ruri SQLite</strong><span>{cacheTopologyInfo?.aiSemanticSqlite?.enabled ? '有効' : '未設定'}</span></article>
                <article><strong>Ruri DBサイズ</strong><span>{cacheTopologyInfo?.aiSemanticSqlite?.dbSizeMb !== null && cacheTopologyInfo?.aiSemanticSqlite?.dbSizeMb !== undefined ? `${cacheTopologyInfo.aiSemanticSqlite.dbSizeMb} MB` : '-'}</span></article>
              </div>
              <div className="smart-cache-table-v320">
                <strong>既存ローカルSQLの主なテーブル</strong>
                {(cacheTopologyInfo?.existingLocalSqlite?.tables || []).map((row: any) => <div key={row.name} className="smart-cache-row-v320">
                  <span><b>{row.label}</b><small>{row.name}</small></span>
                  <em>{row.count ?? 0}{row.expected !== null && row.expected !== undefined ? ` / ${row.expected}` : ''}</em>
                  <mark className={row.status === 'ok' ? 'ok' : row.status === 'needs-rebuild' || row.status === 'needs-sync' ? 'warn' : ''}>{row.status}</mark>
                </div>)}
              </div>
              <details className="smart-model-debug-v236"><summary>次にキャッシュ化できる対象</summary><pre>{JSON.stringify(cacheTopologyInfo?.nextCacheTargets || [], null, 2)}</pre></details>
            </section> : null}
            {uiDisplayCacheInfo ? <section className="smart-cache-topology-v320">
              <div className="smart-admin-section-head-v225"><div><strong>UI表示キャッシュ</strong><small>サイドバー・最近のページなど、画面遷移を速く見せるためのローカルSQLiteキャッシュです。</small></div></div>
              <div className="smart-model-status-grid-v236">
                <article><strong>サイドバー</strong><span>{uiDisplayCacheInfo?.sidebarTreeFresh ? '最新' : uiDisplayCacheInfo?.sidebarTreeCached ? '更新必要' : '未作成'}</span></article>
                <article><strong>ページ件数</strong><span>{uiDisplayCacheInfo?.pageCount ?? 0}件</span></article>
                <article><strong>キャッシュ行</strong><span>{uiDisplayCacheInfo?.cacheRows ?? 0}件</span></article>
                <article><strong>更新日時</strong><span>{uiDisplayCacheInfo?.sidebarTreeUpdatedAt ? String(uiDisplayCacheInfo.sidebarTreeUpdatedAt).slice(0, 19).replace('T', ' ') : '-'}</span></article>
              </div>
              <p className="muted-small">これは正本ではありません。共有フォルダのデータを元に再構築できるため、壊れた場合は再構築してください。</p>
            </section> : null}
            {workspaceDerivedIndexInfo ? <section className="smart-cache-topology-v320">
              <div className="smart-admin-section-head-v225"><div><strong>リンク・添付インデックス</strong><small>バックリンク、添付一覧、リンク切れ、ページ候補を全件スキャンせずに表示するためのSQLite派生インデックスです。</small></div></div>
              <div className="smart-model-status-grid-v236">
                <article><strong>ページ検索</strong><span>{workspaceDerivedIndexInfo?.pageSearchRows ?? 0}件</span></article>
                <article><strong>バックリンク</strong><span>{workspaceDerivedIndexInfo?.pageLinks ?? 0}件</span></article>
                <article><strong>添付</strong><span>{workspaceDerivedIndexInfo?.attachments ?? 0}件</span></article>
                <article><strong>リンク切れ</strong><span>{workspaceDerivedIndexInfo?.brokenLinks ?? 0}件</span></article>
              </div>
              <p className="muted-small">これは正本ではありません。古い・空の場合は「リンク・添付Index再構築」を実行してください。</p>
            </section> : null}
            {workspaceSummaryIndexInfo ? <section className="smart-cache-topology-v320">
              <div className="smart-admin-section-head-v225"><div><strong>Task・Journal・Dashboardインデックス</strong><small>タスク一覧、Journal一覧、Dashboardを全件走査せずに表示するためのSQLiteサマリーインデックスです。</small></div></div>
              <div className="smart-model-status-grid-v236">
                <article><strong>Task</strong><span>{workspaceSummaryIndexInfo?.tasks ?? 0}件</span></article>
                <article><strong>未完了Task</strong><span>{workspaceSummaryIndexInfo?.openTasks ?? 0}件</span></article>
                <article><strong>Journal</strong><span>{workspaceSummaryIndexInfo?.journals ?? 0}件</span></article>
                <article><strong>Dashboard</strong><span>{workspaceSummaryIndexInfo?.dashboardCached ? 'キャッシュあり' : '未作成'}</span></article>
                <article><strong>更新日時</strong><span>{workspaceSummaryIndexInfo?.dashboardUpdatedAt ? String(workspaceSummaryIndexInfo.dashboardUpdatedAt).slice(0, 19).replace('T', ' ') : '-'}</span></article>
                <article><strong>サイズ</strong><span>{workspaceSummaryIndexInfo?.dashboardBytes ?? 0} bytes</span></article>
              </div>
              <p className="muted-small">これは正本ではありません。古い・空の場合は「Task・Journal Index再構築」を実行してください。</p>
            </section> : null}
            {databaseIndexInfo ? <section className="smart-cache-topology-v320">
              <div className="smart-admin-section-head-v225"><div><strong>Database Index</strong><small>DB一覧、行ページング、検索、フィルタ、ソートをJSON全読込に寄せすぎないためのSQLiteインデックスです。</small></div></div>
              <div className="smart-model-status-grid-v236">
                <article><strong>DB Summary</strong><span>{databaseIndexInfo?.summaries ?? 0}件</span></article>
                <article><strong>DB Rows</strong><span>{databaseIndexInfo?.rows ?? 0}件</span></article>
                <article><strong>Property Values</strong><span>{databaseIndexInfo?.propertyValues ?? 0}件</span></article>
                <article><strong>FTS</strong><span>{databaseIndexInfo?.ftsRows ?? 0}件</span></article>
                <article><strong>更新必要</strong><span>{databaseIndexInfo?.staleOrMissing ?? 0}件</span></article>
                <article><strong>最終更新</strong><span>{databaseIndexInfo?.lastIndexedAt ? String(databaseIndexInfo.lastIndexedAt).slice(0, 19).replace('T', ' ') : '-'}</span></article>
              </div>
              <p className={databaseIndexInfo?.staleOrMissing ? 'muted-small warning' : 'muted-small'}>{databaseIndexInfo?.recommendation || 'これは正本ではありません。古い・空の場合は「Database Index再構築」を実行してください。'}</p>
            </section> : null}
            <details className="smart-model-debug-v236"><summary>詳細パス</summary><pre>{JSON.stringify({ runtime: transformerRuntimeInfo, check: transformerModelCheck, uiDisplayCache: uiDisplayCacheInfo, workspaceDerivedIndex: workspaceDerivedIndexInfo, workspaceSummaryIndex: workspaceSummaryIndexInfo, databaseIndex: databaseIndexInfo }, null, 2)}</pre></details>
          </div> : null}

          {smartAdminTab === 'generation' ? <div className="smart-generation-panel-v294 smart-admin-model-panel-v236 smart-admin-data-panel-v293">
            <div className="smart-admin-section-head-v225"><div><strong>生成AIエンジン</strong><small>GGUFモデルはアプリに同梱せず、ユーザーが選択した外部フォルダから読み込みます。標準はOFFで、まずFAQ改善案・要約・下書き用途に限定します。</small></div></div>
            <section className="smart-generation-hero-v294">
              <div>
                <span className={generationCheck?.ok ? 'smart-semantic-state ok' : 'smart-semantic-state warn'}>{generationCheck?.ok ? '利用準備OK' : generationSettings?.enabled ? '要確認' : 'OFF'}</span>
                <h3>{generationCheck?.selectedModelPath ? 'GGUFモデルを検出しました' : 'モデルフォルダを選択してください'}</h3>
                <p>{generationMessage || generationCheck?.message || 'Qwen2.5 1.5B/3Bなどの .gguf ファイルを置いたフォルダを指定します。会社PCではexe起動だけで使えるよう、モデルは外部フォルダ参照にします。'}</p>
              </div>
              <div className="smart-semantic-actions-v292">
                <button type="button" onClick={applyRecommendedGenerationPresetV317} disabled={generationBusy}>推奨設定を適用</button>
                <button type="button" onClick={saveGenerationEngineSettings} disabled={generationBusy}>設定を保存</button>
                <button type="button" className="primary" onClick={refreshGenerationEngineStatus} disabled={generationBusy}>モデル確認</button>
                <button type="button" onClick={testGenerationEngineStatus} disabled={generationBusy || !generationSettings?.enabled}>軽量テスト生成</button>
                <button type="button" onClick={refreshGenerationServerStatus} disabled={generationBusy || !generationSettings?.enabled}>常駐状態</button>
                <button type="button" onClick={startGenerationServerStatus} disabled={generationBusy || !generationSettings?.enabled || generationSettings?.generationRuntimeMode !== 'server'}>常駐起動</button>
                <button type="button" onClick={stopGenerationServerStatus} disabled={generationBusy}>常駐停止</button>
              </div>
            </section>
            <section className="smart-generation-config-v294">
              <label><span>使用</span><select value={generationSettings?.provider || 'none'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), provider: e.target.value, enabled: e.target.value !== 'none' }))}>
                <option value="none">使用しない</option>
                <option value="llama-cpp">llama.cpp / GGUF</option>
              </select></label>
              <label><span>モデルフォルダ</span><div className="smart-model-path-row-v236"><input value={generationSettings?.modelRoot || ''} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), modelRoot: e.target.value, provider: 'llama-cpp' }))} placeholder="例: D:\\LocalNotionModels\\generation" /><button type="button" onClick={chooseGenerationModelRootFromDialog} disabled={generationBusy}>フォルダを選択</button></div></label>
              <label><span>使用モデル</span><select value={generationSettings?.selectedModelPath || ''} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), selectedModelPath: e.target.value }))}>
                <option value="">自動選択（軽いGGUFを優先）</option>
                {(generationCheck?.detectedModels || []).map((model: any) => <option key={model.path} value={model.path}>{model.fileName}（{model.sizeMb} MB）</option>)}
              </select></label>
              <label><span>llamaフォルダ</span><div className="smart-model-path-row-v236"><input value={generationSettings?.llamaRuntimeDir || ''} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaRuntimeDir: e.target.value, llamaExecutablePath: '', provider: 'llama-cpp' }))} placeholder="例: SmartAssistModels/llama ※ 解凍したフォルダをそのまま指定" /><button type="button" onClick={chooseGenerationRuntimeDirFromDialog} disabled={generationBusy}>llamaフォルダを選択</button></div></label>
              <p className="smart-generation-help-v298">llama-completion / llama-cli だけを移動せず、llama.cppを解凍したフォルダをそのまま選んでください。アプリは非対話生成用に llama-completion を優先します。</p>
              <details className="smart-generation-advanced-v298"><summary>詳細: 実行ファイルを手動指定する</summary>
                <label><span>llama実行ファイル</span><div className="smart-model-path-row-v236"><input value={generationSettings?.llamaExecutablePath || ''} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaExecutablePath: e.target.value, provider: 'llama-cpp' }))} placeholder="通常は空欄。例: llama-completion.exe / llama-completion" /><button type="button" onClick={chooseGenerationExecutableFromDialog} disabled={generationBusy}>実行ファイルを選択</button></div></label>
              </details>
              {looksLikeGgufModelPath(generationSettings?.llamaExecutablePath) ? <div className="smart-generation-warning-v297">llama実行ファイル欄にGGUFモデルが入っています。ここにはモデルではなく、llamaフォルダまたは llama-completion を指定してください。</div> : null}
              {generationCheck?.llamaRuntimeWarning ? <div className="smart-generation-warning-v297">{generationCheck.llamaRuntimeWarning}</div> : null}
              {generationCheck?.llamaExecutableError ? <div className="smart-generation-warning-v297">{generationCheck.llamaExecutableError}</div> : null}
            </section>
            <section className="smart-generation-tuning-v294">
              <label><span>プリセット</span><select value={generationSettings?.preset || 'fast'} onChange={e => setGenerationSettings((prev: any) => { const value = e.target.value; return ({ ...(prev || {}), preset: value, performanceMode: value === 'balanced' ? 'quality' : value === 'fast' ? 'fast' : prev?.performanceMode || 'standard', retryMode: value === 'fast' ? 'off' : prev?.retryMode || 'on-error', contextSize: value === 'balanced' ? 4096 : value === 'fast' ? 1024 : prev?.contextSize || 2048, maxTokens: value === 'balanced' ? 768 : value === 'fast' ? 128 : prev?.maxTokens || 256, timeoutMs: value === 'fast' ? 45000 : prev?.timeoutMs || 120000, totalTimeoutMs: value === 'fast' ? 60000 : prev?.totalTimeoutMs || 180000 }); })}>
                <option value="fast">会社PC高速（1回実行）</option>
                <option value="light">軽量・標準（1.5B向け）</option>
                <option value="balanced">高品質・やや重い（3B向け）</option>
                <option value="manual">手動</option>
              </select></label>
              <label><span>性能モード</span><select value={generationSettings?.performanceMode || 'fast'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), performanceMode: e.target.value, retryMode: e.target.value === 'fast' ? 'off' : prev?.retryMode || 'on-error' }))}>
                <option value="fast">高速: 会社PC向け</option>
                <option value="standard">標準</option>
                <option value="quality">品質重視</option>
              </select></label>
              <label><span>自動リトライ</span><select value={generationSettings?.retryMode || 'off'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), retryMode: e.target.value }))}>
                <option value="off">OFF（1回だけ）</option>
                <option value="on-error">失敗時のみ1回</option>
                <option value="full">詳細リトライ</option>
              </select></label>
              <label><span>実行方式</span><select value={generationSettings?.generationRuntimeMode || 'oneshot'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), generationRuntimeMode: e.target.value }))}>
                <option value="oneshot">標準: 1回起動方式</option>
                <option value="server">高速AI常駐: llama-server</option>
              </select></label>
              <label><span>常駐Host</span><input value={generationSettings?.llamaServerHost || '127.0.0.1'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaServerHost: e.target.value || '127.0.0.1' }))} /></label>
              <label><span>常駐Port</span><input type="number" min={1024} max={65535} step={1} value={generationSettings?.llamaServerPort || 18080} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaServerPort: Number(e.target.value) || 18080 }))} /></label>
              <label><span>常駐自動起動</span><select value={generationSettings?.llamaServerAutoStart === false ? 'off' : 'on'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaServerAutoStart: e.target.value === 'on' }))}>
                <option value="on">ON: 生成時に未起動なら起動</option>
                <option value="off">OFF: 手動起動のみ</option>
              </select></label>
              <label><span>失敗時Fallback</span><select value={generationSettings?.llamaServerFallback === false ? 'off' : 'on'} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), llamaServerFallback: e.target.value === 'on' }))}>
                <option value="on">ON: 1回起動方式へ戻す</option>
                <option value="off">OFF: エラーで止める</option>
              </select></label>
              <label><span>Context</span><input type="number" min={512} max={8192} step={512} value={generationSettings?.contextSize || 2048} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), contextSize: Number(e.target.value) }))} /></label>
              <label><span>最大生成</span><input type="number" min={64} max={2048} step={64} value={generationSettings?.maxTokens || 512} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), maxTokens: Number(e.target.value) }))} /></label>
              <label><span>温度</span><input type="number" min={0} max={1} step={0.1} value={generationSettings?.temperature ?? 0.2} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), temperature: Number(e.target.value) }))} /></label>
              <label><span>1回タイムアウト秒</span><input type="number" min={5} max={300} step={5} value={Math.round(Number(generationSettings?.timeoutMs || 45000) / 1000)} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), timeoutMs: Number(e.target.value) * 1000 }))} /></label>
              <label><span>全体上限秒</span><input type="number" min={5} max={300} step={5} value={Math.round(Number(generationSettings?.totalTimeoutMs || 60000) / 1000)} onChange={e => setGenerationSettings((prev: any) => ({ ...(prev || {}), totalTimeoutMs: Number(e.target.value) * 1000 }))} /></label>
            </section>
            <section className="smart-model-status-grid-v236 smart-generation-status-grid-v294">
              <article><strong>検出モデル</strong><span>{generationCheck?.detectedModels?.length || 0}件</span></article>
              <article><strong>選択モデル</strong><span>{generationCheck?.selectedModelPath ? fileNameFromPath(generationCheck.selectedModelPath) : '未選択'}</span></article>
              <article><strong>llamaフォルダ</strong><span>{generationCheck?.llamaExecutableExists ? '確認済み' : '未配置'}</span></article>
              <article><strong>ライブラリ</strong><span>{generationCheck?.llamaRuntimeLibraryCount || 0}件</span></article>
              <article><strong>実行ファイル</strong><span>{generationCheck?.llamaExecutablePath ? fileNameFromPath(generationCheck.llamaExecutablePath) : '-'}</span></article>
              <article><strong>設定</strong><span>{generationSettings?.performanceMode || 'fast'} / retry {generationSettings?.retryMode || 'off'}</span></article>
              <article><strong>実行方式</strong><span>{generationSettings?.generationRuntimeMode === 'server' ? '高速常駐' : '1回起動'}</span></article>
              <article><strong>常駐状態</strong><span>{generationServerStatus?.reachable ? '起動済み' : generationServerStatus?.state || '停止中'}</span></article>
              <article><strong>常駐PID</strong><span>{generationServerStatus?.pid || '-'}</span></article>
              <article><strong>使用メモリ</strong><span>{generationServerStatus?.memoryMb ? `${generationServerStatus.memoryMb} MB` : '-'}</span></article>
              <article><strong>常駐ctx</strong><span>{generationServerStatus?.contextSize || '不明'}</span></article>
              <article><strong>推奨ctx</strong><span>{generationSettings?.contextSize || 1024}</span></article>
              <article><strong>ctx診断</strong><span>{generationServerStatus?.reachable && generationServerStatus?.contextSize && Number(generationServerStatus.contextSize) < Number(generationSettings?.contextSize || 1024) ? '不足の可能性' : generationServerStatus?.reachable ? 'OK/不明' : '-'}</span></article>
              <article><strong>状態</strong><span>{generationCheck?.ok ? '利用可能' : '未準備'}</span></article>
            </section>
            <section className="smart-semantic-guide-v292">
              <strong>モデル配置例</strong>
              <p>会社PCでは、Local Notion Lite本体とは別にモデルフォルダを置き、ここで選択します。例: <code>SmartAssistModels/generation/qwen2.5-1.5b-instruct-q4_k_m.gguf</code></p>
              <ul>
                <li>会社PCでは Qwen2.5 1.5B の軽量量子化、Context 1024、最大生成128、自動リトライOFFを標準にします。</li>
                <li>7B以上は会社PCの標準にはしません。手動選択は可能ですが、動作が重くなります。</li>
                <li>生成は回答の断定ではなく、FAQ改善案・要約・下書きから使います。</li>
              </ul>
            </section>
            <details className="smart-model-debug-v236"><summary>詳細</summary><pre>{JSON.stringify({ settings: generationSettings, check: generationCheck, server: generationServerStatus }, null, 2)}</pre></details>
          </div> : null}

          {smartAdminTab === 'semantic' ? <div className="smart-admin-semantic-panel-v292">
            <div className="smart-admin-section-head-v225"><div><strong>Workspace Semantic Index</strong><small>関連ページ・関連FAQ・関連DB・関連Journalの表示に使う、ワークスペース横断のruri-v3インデックスです。</small></div></div>
            <section className="smart-semantic-hero-v292">
              <div>
                <span className={workspaceSemanticInfo?.ok ? 'smart-semantic-state ok' : 'smart-semantic-state warn'}>{workspaceSemanticInfo?.ok ? '利用可能' : '未生成 / 要確認'}</span>
                <h3>{workspaceSemanticInfo?.indexedCount || 0}件を関連表示に使用</h3>
                <p>{workspaceSemanticStatus}{semanticIdleRunning ? ' ・ 自動更新中' : ''}</p>
              </div>
              <div className="smart-semantic-actions-v292">
                <button type="button" onClick={refreshWorkspaceSemanticIndexInfo} disabled={operationProgress.busy}>状態を更新</button>
                <button type="button" className="primary" onClick={() => diffUpdateWorkspaceSemanticIndexFromAdmin(20)} disabled={operationProgress.busy || transformerModelBusy}>差分更新 20件</button>
                <button type="button" onClick={() => diffUpdateWorkspaceSemanticIndexFromAdmin(100)} disabled={operationProgress.busy || transformerModelBusy}>差分更新 100件</button>
                <button type="button" onClick={startWorkspaceSemanticBackgroundRebuild} disabled={transformerModelBusy || ['queued', 'running', 'paused'].includes(String(semanticBackgroundJob?.state || ''))}>バックグラウンド全件再生成</button>
              </div>
            </section>
            <section className="smart-semantic-guide-v292">
              <strong>v448 バックグラウンド再生成</strong>
              <p>{semanticBackgroundJob?.message || '全件再生成は、ページ編集・閲覧を止めずにバックグラウンドで処理します。'}</p>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>状態</span><b>{semanticBackgroundJob?.state || 'idle'}</b></article>
                <article><span>収集件数</span><b>{Number(semanticBackgroundJob?.collectedCount || 0)}件</b></article>
                <article><span>処理目安</span><b>{Number(semanticBackgroundJob?.processedEstimate || 0)}件</b></article>
                <article><span>開始</span><b>{formatSemanticGeneratedAt(semanticBackgroundJob?.startedAt)}</b></article>
              </div>
              {semanticBackgroundJob?.state === 'interrupted' ? <div className="smart-semantic-actions-v292">
                <button type="button" onClick={() => controlWorkspaceSemanticBackgroundJob('resume')}>前回の続きから再開</button>
                <button type="button" onClick={() => controlWorkspaceSemanticBackgroundJob('cancel')}>復元状態を破棄</button>
              </div> : ['queued', 'running', 'paused'].includes(String(semanticBackgroundJob?.state || '')) ? <div className="smart-semantic-actions-v292">
                {semanticBackgroundJob?.state === 'paused' ? <button type="button" onClick={() => controlWorkspaceSemanticBackgroundJob('resume')}>再開</button> : <button type="button" onClick={() => controlWorkspaceSemanticBackgroundJob('pause')}>一時停止</button>}
                <button type="button" onClick={() => controlWorkspaceSemanticBackgroundJob('cancel')}>中止</button>
              </div> : null}
              <small>中止・一時停止は、実行中のEmbedding 1件が終わった次の安全な区切りで反映されます。既存Indexはそのまま検索に使えます。</small>
            </section>
            <section className="smart-model-status-grid-v236 smart-semantic-status-grid-v292">
              <article><strong>エンジン</strong><span>{workspaceSemanticInfo?.engine || '未確認'}</span></article>
              <article><strong>モデル</strong><span>{workspaceSemanticInfo?.model || transformerSettings?.modelId || '未確認'}</span></article>
              <article><strong>最終生成</strong><span>{formatSemanticGeneratedAt(workspaceSemanticInfo?.generatedAt)}</span></article>
              <article><strong>状態</strong><span>{workspaceSemanticInfo?.available ? '全件利用可能' : workspaceSemanticInfo?.ok ? '一部不足あり' : '未生成'}</span></article>
              <article><strong>SQLiteキャッシュ</strong><span>{workspaceSemanticInfo?.cache?.enabled ? `${workspaceSemanticInfo?.cache?.itemCount || 0}件` : '未設定'}</span></article>
              <article><strong>キャッシュDB</strong><span title={workspaceSemanticInfo?.cache?.dbPath || ''}>{workspaceSemanticInfo?.cache?.dbPath ? String(workspaceSemanticInfo.cache.dbPath).split(/[\/]/).slice(-1)[0] : 'ローカル保存先未指定'}</span></article>
              <article><strong>更新待ち</strong><span>{Number(workspaceSemanticInfo?.diff?.pending || 0)}件</span></article>
              <article><strong>再利用可能</strong><span>{Number(workspaceSemanticInfo?.diff?.reusable || 0)}件</span></article>
              <article><strong>新規/変更</strong><span>{Number(workspaceSemanticInfo?.diff?.newItems || 0)} / {Number(workspaceSemanticInfo?.diff?.changed || 0)}件</span></article>
              <article><strong>削除検知</strong><span>{Number(workspaceSemanticInfo?.diff?.deleted || 0)}件</span></article>
            </section>
            {workspaceSemanticInfo?.cache?.enabled ? <section className="smart-semantic-guide-v292">
              <strong>v326 負荷制御つきローカルSQLiteキャッシュ</strong>
              <p>保存時にはembedding生成を走らせず、差分更新ボタンで変更分だけ処理します。通常は「差分更新 20件」、大量更新後のみ「差分更新 100件」または「全件再生成」を使います。</p>
              <small>{workspaceSemanticInfo?.cache?.dbPath || ''}</small>
            </section> : null}
            {workspaceSemanticInfo?.cache?.enabled ? <section className="smart-semantic-guide-v292">
              <strong>v444 sqlite-vec 既定検索</strong>
              <p>{workspaceSemanticInfo?.cache?.vector?.available
                ? `sqlite-vecを候補抽出の既定経路として利用しています。${Number(workspaceSemanticInfo?.cache?.vector?.indexedCount || 0)}件を同期済みで、既存のタグ・本文・タイトル再順位付けはそのままです。障害時のみJavaScript総当たりへ自動で戻ります。`
                : 'sqlite-vecを利用できないため、従来のJavaScript総当たり検索を継続しています。検索機能自体は停止しません。'} </p>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>状態</span><b>{workspaceSemanticInfo?.cache?.vector?.available ? '利用可能' : 'フォールバック'}</b></article>
                <article><span>同期済み</span><b>{Number(workspaceSemanticInfo?.cache?.vector?.indexedCount || 0)}件</b></article>
                <article><span>次元数</span><b>{workspaceSemanticInfo?.cache?.vector?.dimension || '未生成'}</b></article>
                <article><span>最終同期</span><b>{formatSemanticGeneratedAt(workspaceSemanticInfo?.cache?.vector?.lastSyncAt)}</b></article>
                <article><span>直近の検索経路</span><b>{workspaceSemanticInfo?.cache?.vector?.telemetry?.lastEngine === 'sqlite-vec' ? 'sqlite-vec' : workspaceSemanticInfo?.cache?.vector?.telemetry?.lastEngine === 'js-fallback' ? 'JSフォールバック' : workspaceSemanticInfo?.cache?.vector?.telemetry?.lastEngine === 'embedding-unavailable' ? 'Embedding未生成' : '未実行'}</b></article>
                <article><span>直近の検索時間</span><b>{workspaceSemanticInfo?.cache?.vector?.telemetry?.lastElapsedMs == null ? '未計測' : `${Number(workspaceSemanticInfo.cache.vector.telemetry.lastElapsedMs)}ms`}</b></article>
                <article><span>sqlite-vec利用回数</span><b>{Number(workspaceSemanticInfo?.cache?.vector?.telemetry?.vectorSearchCount || 0)}回</b></article>
                <article><span>JSフォールバック</span><b>{Number(workspaceSemanticInfo?.cache?.vector?.telemetry?.fallbackSearchCount || 0)}回</b></article>
                <article><span>SQLite接続</span><b>{workspaceSemanticInfo?.cache?.connection?.active ? `常駐（起動 ${Number(workspaceSemanticInfo?.cache?.connection?.openCount || 0)}回）` : '未接続'}</b></article>
              </div>
              {workspaceSemanticInfo?.cache?.vector?.error ? <small>読み込み情報: {String(workspaceSemanticInfo.cache.vector.error).slice(0, 220)}</small> : null}
            </section> : null}
            {workspaceSemanticInfo?.cache?.enabled ? <section className="smart-semantic-guide-v292">
              <strong>v445 SQLite FTS5 ハイブリッド候補補強</strong>
              <p>{workspaceSemanticInfo?.cache?.fts?.available
                ? `sqlite-vecの意味候補へ、SQLite FTS5のタイトル・本文・タグ一致候補を補強しています。検索語が明確な規程名、年度、受付区分などを取りこぼしにくくします。`
                : 'SQLite FTS5を利用できないため、sqlite-vecと既存の再順位付けだけで検索しています。検索機能自体は停止しません。'}</p>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>状態</span><b>{workspaceSemanticInfo?.cache?.fts?.available ? '利用可能' : '未使用'}</b></article>
                <article><span>同期済み</span><b>{Number(workspaceSemanticInfo?.cache?.fts?.indexedCount || 0)}件</b></article>
                <article><span>最終同期</span><b>{formatSemanticGeneratedAt(workspaceSemanticInfo?.cache?.fts?.lastSyncAt)}</b></article>
                <article><span>FTS補強回数</span><b>{Number(workspaceSemanticInfo?.cache?.fts?.telemetry?.lexicalSearchCount || 0)}回</b></article>
                <article><span>直近のFTS候補</span><b>{Number(workspaceSemanticInfo?.cache?.fts?.telemetry?.lastLexicalCandidateCount || 0)}件</b></article>
              </div>
              {workspaceSemanticInfo?.cache?.fts?.error ? <small>読み込み情報: {String(workspaceSemanticInfo.cache.fts.error).slice(0, 220)}</small> : null}
            </section> : null}
            {workspaceSemanticInfo?.cache?.enabled ? <section className="smart-semantic-guide-v292">
              <strong>v451 バックアップ・復旧センター</strong>
              <p>共有JSONの正本は、端末ローカルへ世代スナップショットを作成できます。SQLite／sqlite-vec／FTS5は正本ではないため、破損時は削除して再構築します。</p>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>保存世代</span><b>{semanticRecoveryBackups.length}件</b></article>
                <article><span>最新バックアップ</span><b>{formatSemanticGeneratedAt(semanticRecoveryBackups[0]?.createdAt)}</b></article>
                <article><span>保持上限</span><b>7世代</b></article>
                <article><span>ローカルIndex復旧</span><b>再構築可能</b></article>
              </div>
              <div className="smart-semantic-actions-v292">
                <button type="button" disabled={operationProgress.busy} onClick={createWorkspaceSemanticRecoveryBackup}>共有JSONをバックアップ</button>
                <button type="button" disabled={operationProgress.busy} onClick={resetWorkspaceSemanticLocalCacheFromAdmin}>ローカルIndexを再構築</button>
              </div>
              <small>{semanticRecoveryBackups[0] ? `最新: ${formatSemanticGeneratedAt(semanticRecoveryBackups[0].createdAt)} / ${Number(semanticRecoveryBackups[0].fileCount || 0)}ファイル。添付ファイル・ローカルSQLiteは含めません。` : 'バックアップはまだありません。大きな変更前や運用開始前に1世代作成してください。'}</small>
            </section> : null}
            {workspaceSemanticInfo?.cache?.enabled ? <section className="smart-semantic-guide-v292">
              <strong>v450 Indexの自動掃除・容量整理</strong>
              <p>同期後に、共有JSONの現行Indexに存在しないローカルSQLite・FTS5・sqlite-vec対応データを自動確認します。共有フォルダの正本データは変更しません。</p>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>最終掃除</span><b>{formatSemanticGeneratedAt(workspaceSemanticInfo?.cache?.maintenance?.lastAt)}</b></article>
                <article><span>直近の整理件数</span><b>{Number(workspaceSemanticInfo?.cache?.maintenance?.removedItems || 0) + Number(workspaceSemanticInfo?.cache?.maintenance?.removedVectorMaps || 0) + Number(workspaceSemanticInfo?.cache?.maintenance?.removedFtsMaps || 0) + Number(workspaceSemanticInfo?.cache?.maintenance?.removedFailures || 0)}件</b></article>
                <article><span>未対応vec行</span><b>{Number(workspaceSemanticInfo?.cache?.maintenance?.vectorOrphans || 0)}件</b></article>
                <article><span>未対応FTS行</span><b>{Number(workspaceSemanticInfo?.cache?.maintenance?.ftsOrphans || 0)}件</b></article>
                <article><span>キャッシュ容量</span><b>{Math.max(0, Math.round(Number(workspaceSemanticInfo?.cache?.sizeBytes || 0) / 1024))}KB</b></article>
                <article><span>最終VACUUM</span><b>{formatSemanticGeneratedAt(workspaceSemanticInfo?.cache?.maintenance?.lastVacuumedAt)}</b></article>
              </div>
              <div className="smart-semantic-actions-v292">
                <button type="button" disabled={operationProgress.busy} onClick={() => maintainWorkspaceSemanticCacheFromAdmin(false)}>不要データを掃除</button>
                <button type="button" disabled={operationProgress.busy} onClick={() => maintainWorkspaceSemanticCacheFromAdmin(true)}>{workspaceSemanticInfo?.cache?.maintenance?.manualCompactRecommended ? '容量を整理（推奨）' : '容量を整理'}</button>
              </div>
              <small>通常は自動掃除だけで十分です。「容量を整理」は削除後もSQLiteファイルが大きい場合、または未対応行が残った場合だけ実行してください。</small>
            </section> : null}
            <section className="smart-semantic-idle-card-v327">
              <div className="smart-admin-section-head-v225"><div><strong>v327 アイドル時の自動差分更新</strong><small>操作していない時間だけ、少量ずつSemantic Indexを更新します。保存時にはembedding生成を走らせません。</small></div></div>
              <div className="smart-semantic-idle-row-v327">
                <label><input type="checkbox" checked={semanticIdleEnabled} onChange={(event) => setSemanticIdleEnabled(event.target.checked)} /> アイドル時に自動で差分更新する</label>
                <label>1回の件数<input type="number" min={1} max={50} value={semanticIdleBatchSize} onChange={(event) => setSemanticIdleBatchSize(Number(event.target.value || 10))} /></label>
                <label>待機秒数<input type="number" min={5} max={120} value={semanticIdleDelaySec} onChange={(event) => setSemanticIdleDelaySec(Number(event.target.value || 8))} /></label>
                <button type="button" onClick={saveSemanticIdleSettings} disabled={operationProgress.busy}>設定を保存</button>
              </div>
              <p>推奨は「ON / 10件 / 8秒」です。大量取込直後は手動の「差分更新 100件」、日常運用は自動更新に任せる構成が軽く安定します。</p>
              <small>現在: {semanticIdleEnabled ? 'ON' : 'OFF'} / {semanticIdleRunning ? '自動更新中' : '待機中'} / 更新待ち {Number(workspaceSemanticInfo?.diff?.pending || 0)}件</small>
            </section>
            <section className="smart-semantic-performance-card-v441">
              <div className="smart-admin-section-head-v225"><div><strong>v441 実機性能の目安</strong><small>この端末で実行したSemantic Index更新の実測値です。ページ本文の編集速度ではなく、Index処理の負荷確認に使います。</small></div></div>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>直近の更新時間</span><b>{workspaceSemanticInfo?.cache?.timing?.lastRunDurationMs == null ? '未計測' : `${(Number(workspaceSemanticInfo.cache.timing.lastRunDurationMs) / 1000).toFixed(1)}秒`}</b></article>
                <article><span>直近の生成件数</span><b>{Number(workspaceSemanticInfo?.cache?.timing?.lastRunEmbeddedCount || 0)}件</b></article>
                <article><span>1件あたりEmbedding</span><b>{workspaceSemanticInfo?.cache?.timing?.lastEmbeddingMsPerItem == null ? '未計測' : `${(Number(workspaceSemanticInfo.cache.timing.lastEmbeddingMsPerItem) / 1000).toFixed(2)}秒`}</b></article>
                <article><span>直近5回の平均</span><b>{workspaceSemanticInfo?.cache?.timing?.averageLastFiveRunMs == null ? '未計測' : `${(Number(workspaceSemanticInfo.cache.timing.averageLastFiveRunMs) / 1000).toFixed(1)}秒`}</b></article>
              </div>
              <p>目安: 1件あたりの時間が急に増えた場合は、長文・画像埋込み・モデル初期化・端末負荷を確認してください。更新中に編集が重い場合は、自動更新の待機秒数を長くします。</p>
            </section>
            <section className="smart-semantic-diagnostics-card-v328">
              <div className="smart-admin-section-head-v225"><div><strong>v328 更新履歴・診断</strong><small>差分更新やアイドル更新がいつ・何件処理したかを確認できます。失敗時も原因をここに残します。</small></div></div>
              <div className="smart-semantic-diagnostics-grid-v328">
                <article><span>直近モード</span><b>{workspaceSemanticInfo?.cache?.meta?.lastBuildMode || '未記録'}</b></article>
                <article><span>今回生成</span><b>{workspaceSemanticInfo?.cache?.meta?.lastEmbeddedThisRun || '0'}件</b></article>
                <article><span>再利用</span><b>{workspaceSemanticInfo?.cache?.meta?.lastReusedCount || '0'}件</b></article>
                <article><span>残り待ち</span><b>{workspaceSemanticInfo?.cache?.meta?.lastPendingCount || '0'}件</b></article>
              </div>
              <div className="smart-semantic-history-list-v328">
                {(workspaceSemanticInfo?.cache?.recentRuns || []).length ? (workspaceSemanticInfo.cache.recentRuns || []).slice(0, 6).map((run: any) => <article key={run.id || run.startedAt} className={`smart-semantic-history-item-v328 ${run.status || ''}`}>
                  <div><strong>{run.status === 'success' ? '成功' : run.status === 'partial' ? '一部更新' : run.status || '記録'}</strong><small>{formatSemanticGeneratedAt(run.endedAt || run.startedAt)}</small></div>
                  <p>{run.mode || 'unknown'} / 生成 {Number(run.embeddedThisRun || 0)}件 / 再利用 {Number(run.reusedCount || 0)}件 / 残り {Number(run.pendingCount || 0)}件{run.durationMs == null ? '' : ` / ${(Number(run.durationMs) / 1000).toFixed(1)}秒`}{run.embeddingMsPerItem == null ? '' : ` (${(Number(run.embeddingMsPerItem) / 1000).toFixed(2)}秒/件)`}</p>
                  {run.error ? <code>{String(run.error).slice(0, 240)}</code> : null}
                </article>) : <p className="smart-muted">まだ更新履歴はありません。差分更新または全件再生成を実行するとここに記録されます。</p>}
              </div>
              <p>検索が古いと感じた場合は、まず「差分更新 20件」を実行してください。キャッシュ破損やモデル変更時だけ「全件再生成」を使います。</p>
            </section>
            <section className="smart-semantic-failures-card-v440">
              <div className="smart-admin-section-head-v225"><div><strong>Index失敗・再Index</strong><small>Embeddingに失敗した対象です。ページ内容を確認し、対象だけを再Indexできます。全件再生成は不要です。</small></div><b className={Number(workspaceSemanticInfo?.cache?.failureCount || 0) ? 'smart-semantic-failure-count-v440 has-failures' : 'smart-semantic-failure-count-v440'}>{Number(workspaceSemanticInfo?.cache?.failureCount || 0)}件</b></div>
              {(workspaceSemanticInfo?.cache?.failures || []).length ? <div className="smart-semantic-failure-list-v440">
                {(workspaceSemanticInfo.cache.failures || []).slice(0, 30).map((failure: any) => <article key={failure.id}>
                  <div className="smart-semantic-failure-main-v440"><strong>{failure.title || failure.sourceId}</strong><small>{semanticTypeLabel(String(failure.type || ''))} / チャンク {Number(failure.chunkIndex || 0) + 1}/{Math.max(1, Number(failure.chunkCount || 1))} / 最終失敗 {formatSemanticGeneratedAt(failure.failedAt)}</small><code title={String(failure.error || '')}>{String(failure.error || 'embedding unavailable').slice(0, 180)}</code></div>
                  <div className="smart-semantic-failure-actions-v440">
                    {failure.type === 'page' ? <button type="button" onClick={() => onOpenPage(String(failure.sourceId || ''))}>ページを開く</button> : null}
                    <button type="button" className="primary" onClick={() => void reindexWorkspaceSemanticFailureFromAdmin(failure)} disabled={operationProgress.busy || transformerModelBusy}>この対象だけ再Index</button>
                  </div>
                </article>)}
              </div> : <p className="smart-muted">失敗中の対象はありません。長文や画像を含むページも、安全なチャンク化でIndex済みです。</p>}
            </section>
            <section className="smart-semantic-type-card-v292">
              <div className="smart-admin-section-head-v225"><div><strong>種別ごとの件数</strong><small>関連表示の対象に入っているデータ種別です。FAQだけでなく、ページ・DB行・Journalもここに入ります。</small></div></div>
              <div className="smart-semantic-type-grid-v292">
                {['faq','page','database_row','journal','attachment_summary'].map(type => <article key={type}>
                  <span>{semanticTypeLabel(type)}</span>
                  <b>{Number(workspaceSemanticInfo?.typeCounts?.[type] || 0)}</b>
                </article>)}
              </div>
            </section>
            <section className="smart-semantic-guide-v292">
              <strong>実務運用の目安</strong>
              <p>FAQ・ページ・DB行・Journalを追加または大きく更新した後は、まず差分更新を実行してください。差分検知により変更なしの項目は再embeddingされません。</p>
              <ul>
                <li>日常運用: 差分更新 20件。画面が固まりにくく、変更分だけ反映します。</li>
                <li>大量取込後: 差分更新 100件を数回、または全件再生成を使用します。</li>
                <li>ページ保存・DB保存・Journal保存そのものは重くしない方針です。</li>
                <li>FAQ回答の正確性を優先する場合は、FAQ管理の検索再生成も併用します。</li>
              </ul>
            </section>
            {workspaceSemanticInfo?.error ? <details className="smart-model-debug-v236"><summary>エラー詳細</summary><pre>{String(workspaceSemanticInfo.error)}</pre></details> : null}
          </div> : null}

          {smartAdminTab === 'data' ? <div className="smart-admin-data-panel-v225 smart-admin-data-panel-v229">
            <div className="smart-admin-section-head-v225"><div><strong>AIデータ管理</strong><small>FAQ、評価セット、表記揺れ辞書、担当先、改善ログをここで一括管理します。入力欄で迷わないよう、各データの用途と列を表示しています。</small></div></div>
            <section className="smart-evaluation-editor-v390">
              <div className="smart-panel-head-v134"><div><strong>評価セットを個別に管理</strong><small>質問と正解FAQ IDを1件ずつ保存します。誤答の評価結果は改善キューへ送られます。</small></div><div><button type="button" onClick={() => void loadSmartAssistEvaluationData()} disabled={operationProgress.busy}>再読込</button><button type="button" onClick={() => { setEvaluationDraft({ id: '', question: '', expectedFaqId: '', note: '', updatedAt: '' }); }}>新規</button></div></div>
              <div className="smart-evaluation-editor-form-v390">
                <input value={evaluationDraft.question} onChange={e => setEvaluationDraft(prev => ({ ...prev, question: e.target.value }))} placeholder="評価する質問" />
                <input value={evaluationDraft.expectedFaqId} onChange={e => setEvaluationDraft(prev => ({ ...prev, expectedFaqId: e.target.value }))} placeholder="正解FAQ ID（例: faq_001）" />
                <input value={evaluationDraft.note} onChange={e => setEvaluationDraft(prev => ({ ...prev, note: e.target.value }))} placeholder="メモ（任意）" />
                <button type="button" className="primary" onClick={() => void saveEvaluationEntry()}>{evaluationDraft.id ? '更新' : '追加'}</button>
              </div>
              <div className="smart-evaluation-entry-list-v390">
                {evaluationEntries.slice(0, 80).map((entry: any) => <article key={entry.id}><div><b>{entry.question}</b><small>正解: {entry.expectedFaqId}{entry.note ? ` / ${entry.note}` : ''}</small></div><div><button type="button" onClick={() => setEvaluationDraft({ id: String(entry.id || ''), question: String(entry.question || ''), expectedFaqId: String(entry.expectedFaqId || ''), note: String(entry.note || ''), updatedAt: String(entry.updatedAt || '') })}>編集</button><button type="button" className="danger" onClick={() => void deleteEvaluationEntry(entry)}>削除</button></div></article>)}
                {!evaluationEntries.length ? <p className="muted-small">評価問題はまだありません。FAQ管理の「評価セット生成」または上の入力欄から追加してください。</p> : null}
              </div>
              <div className="smart-evaluation-history-v390"><strong>評価レポート履歴</strong>{evaluationReports.length ? evaluationReports.slice(0, 8).map((report: any) => <button key={report.reportId || report.updatedAt} type="button" onClick={() => setEvaluationReport(report)}>{String(report.updatedAt || '').replace('T', ' ').slice(0, 16)} / 正答率 {report.accuracy ?? 0}% / {report.passedCount ?? 0}/{report.testedCount ?? 0}</button>) : <small>まだ評価レポートはありません。</small>}</div>
            </section>
            <div className="smart-ai-data-grid-v225 smart-ai-data-grid-v229">
              {Object.entries(aiDataLabels).map(([kind, meta]) => <article key={kind} className="smart-ai-data-card-v225 smart-ai-data-card-v226 smart-ai-data-card-v229">
                <div className="smart-ai-data-card-main-v226"><strong>{meta.title}</strong><p>{meta.description}</p><em>{meta.whenToUse}</em></div>
                <details className="smart-ai-data-schema-v226">
                  <summary>データ構造とサンプルを見る</summary>
                  <div><b>JSON構造</b><code>{meta.jsonShape}</code></div>
                  {meta.columns ? <div><b>CSV列</b><code>{meta.columns}</code></div> : null}
                  <div><b>サンプル</b><pre>{meta.sample}</pre></div>
                </details>
                <div className="smart-ai-data-actions-v225 smart-ai-data-actions-v226">
                  {meta.json ? <><button type="button" onClick={() => openAiDataImport(kind, 'json')}><span>JSON取込</span><small>構造に沿ったJSONを貼り付け</small></button><button type="button" onClick={() => exportAiData(kind, 'json')}><span>JSON出力</span><small>バックアップ・編集用にコピー</small></button></> : null}
                  {meta.csv ? <><button type="button" onClick={() => openAiDataImport(kind, 'csv')}><span>CSV取込</span><small>Excel編集後に取り込み</small></button><button type="button" onClick={() => exportAiData(kind, 'csv')}><span>CSV出力</span><small>Excelで編集できる形式</small></button></> : null}
                </div>
              </article>)}
            </div>
          </div> : null}
          {smartAdminTab === 'stats' ? <div className="smart-admin-stats-v219 smart-admin-stats-v229"><div className="smart-panel-head-v134"><strong>質問ランキング</strong><span>{questionRankingStats.length}</span></div>{questionRankingStats.length ? questionRankingStats.map(item => <article key={item.question}><b>{item.question}</b><span>{item.count}回 / 👍{item.good} / 👎{item.bad}</span><button type="button" onClick={() => askLocalFaq(item.question)}>再質問</button></article>) : <p className="muted-small">まだ質問統計がありません。</p>}</div> : null}
          {smartAdminTab === 'improvement' ? <div className="smart-admin-stats-v219 smart-admin-stats-v229 smart-improvement-queue-v370">
            <div className="smart-panel-head-v134"><strong>AI改善キュー</strong><span>{lowConfidenceLogs.length}</span></div>
            <p className="muted-small">低信頼・根拠不足・👎評価の質問を集約します。回答精度を上げるため、ここから再質問・FAQ下書き化を行います。</p>
            <div className="smart-answer-feedback-v316"><button type="button" onClick={() => loadLowConfidenceSmartAssistLogs(false)} disabled={operationProgress.busy}>改善キューを再読込</button><button type="button" onClick={() => setShowLowConfidenceLogs(true)}>別画面で開く</button></div>
            {lowConfidenceLogs.length ? lowConfidenceLogs.slice(0, 40).map((log: any, index) => <article key={log.id || index}>
              <b>{String(log.question || '質問なし')}</b>
              <span>{String(log.sourceType || log.uxLevel || log.status || 'open')} ・ 信頼度 {Number(log.confidence || 0)}% ・ {String(log.reason || '要確認')}</span>
              {Array.isArray(log.candidates) && log.candidates.length ? <small>候補: {log.candidates.slice(0, 3).map((item: any) => String(item.question || item.id || '')).filter(Boolean).join(' / ')}</small> : null}
              <div className="smart-low-actions-v316"><button type="button" onClick={() => askLocalFaq(String(log.question || ''))}>再質問</button><button type="button" onClick={() => { setManualFaq({ question: String(log.question || ''), answer: '', category: '未回答FAQ', tags: '未回答,要確認' }); setFaqEditMode('new'); setFaqEditDraft(null); setSmartAdminTab('faq'); setShowSmartAssistControlPanel(true); }}>FAQ下書き化</button><button type="button" onClick={async () => { if (!api || !log.id) return; const saved = await api.updateSmartAssistImprovementQueue(String(log.id), { ...log, baseUpdatedAt: String(log.updatedAt || ''), status: 'resolved', resolvedAt: new Date().toISOString() }); setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(saved)); }}>対応済み</button><button type="button" onClick={async () => { if (!api || !log.id || !window.confirm('この改善キュー項目を削除しますか？')) return; const saved = await api.deleteSmartAssistImprovementQueue(String(log.id), String(log.updatedAt || '')); setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(saved)); }}>削除</button></div>
            </article>) : <p className="muted-small">まだ改善キューを読み込んでいません。「改善キューを再読込」を押してください。</p>}
          </div> : null}
          {smartAdminTab === 'ops' ? <div className="smart-admin-ops-v219 smart-admin-ops-v229 smart-admin-ops-v230 smart-admin-ops-v232">
            <div className="smart-admin-section-head-v225 smart-admin-section-head-v230"><div><strong>運用メンテナンス</strong><small>日常運用で必要な確認だけに絞りました。FAQ追加・正答率測定・検索再生成は「FAQ管理」、JSON/CSV入出力は「AIデータ」に集約しています。</small></div></div>
            <div className="smart-ops-maintenance-grid-v230 smart-ops-maintenance-grid-v232">
              <button type="button" className="smart-op-card-v224 smart-op-card-v230" disabled={operationProgress.busy} onClick={() => loadLowConfidenceSmartAssistLogs(true)}><span>低信頼ログを確認</span><small>答えられなかった質問を読み込み、FAQ改善の材料にします。</small></button>
              <button type="button" className="smart-op-card-v224 smart-op-card-v230" onClick={() => setSmartAdminTab('faq')}><span>FAQ管理へ</span><small>FAQ追加・編集・評価セット生成・正答率測定・検索再生成を行います。</small></button>
              <button type="button" className="smart-op-card-v224 smart-op-card-v230" onClick={() => setSmartAdminTab('data')}><span>AIデータへ</span><small>FAQ本体、評価セット、表記揺れ辞書、担当先をJSON/CSVで管理します。</small></button>
            </div>
            <div className="smart-ops-note-v232"><strong>整理済み</strong><p>重複していた「検索再生成」「正答率測定」はFAQ管理へ移動しました。運用タブはログ確認と主要画面への導線だけにしています。</p></div>
            <div className="smart-assist-mini-status-v199 modal"><span>{operationStatus}</span><span>{faqSyncStatus}</span>{faqSaveRecovery ? <button type="button" className="save-recovery-action" onClick={() => { if (faqRetryTimerRef.current) { window.clearTimeout(faqRetryTimerRef.current); faqRetryTimerRef.current = null; } faqRetryAttemptRef.current = 0; setFaqSaveRecovery(null); void flushFaqSaveQueue(); }}>FAQ未保存・再試行</button> : null}</div>
          </div> : null}
          {showSmartSynonymEditor ? <div className="smart-synonym-editor-v195 smart-synonym-editor-modal-v196">
            <div className="smart-synonym-editor-head-v195"><strong>📝 言い換え辞書</strong><span>{smartSynonymStatus}</span></div>
            <p className="muted-small">項目ごとに保存・削除します。JSON編集は一括取込などの上級者向けに残しています。</p>
            <form className="smart-item-editor-v382" onSubmit={event => upsertSmartAssistSynonymItem(event)}><input name="base" placeholder="基準語（例：有給）" /><input name="variants" placeholder="言い換え（例：有休, 年休）" /><input name="category" placeholder="カテゴリ" /><input name="intentId" placeholder="Intent ID" /><label><input name="enabled" type="checkbox" defaultChecked />有効</label><button type="submit">追加</button></form>
            <div className="smart-item-list-v382">{smartSynonyms.slice(0, 100).map((item: any) => <form className="smart-item-card-v382" key={item.id} onSubmit={event => upsertSmartAssistSynonymItem(event, String(item.id))}><input name="base" defaultValue={String(item.base || '')} /><input name="variants" defaultValue={(item.variants || []).join(', ')} /><input name="category" defaultValue={String(item.category || '')} /><input name="intentId" defaultValue={String(item.intentId || '')} /><label><input name="enabled" type="checkbox" defaultChecked={item.enabled !== false} />有効</label><button type="submit">保存</button><button type="button" onClick={() => deleteSmartAssistSynonymItem(String(item.id), String(item.updatedAt || ''))}>削除</button></form>)}</div>
            <details><summary>JSON一括編集（上級者向け）</summary><textarea value={smartSynonymJsonText} onChange={e => setSmartSynonymJsonText(e.target.value)} spellCheck={false} /><div className="smart-synonym-actions-v195"><button type="button" onClick={saveSmartAssistSynonymsFromJson}>一括保存</button><button type="button" onClick={reloadSmartAssistSynonyms}>再読込</button><button type="button" onClick={addSmartAssistSynonymTemplate}>JSONテンプレ追加</button></div></details>
          </div> : null}
          {showSmartRuleProfileEditor ? <div className="smart-synonym-editor-v195 smart-synonym-editor-modal-v196">
            <div className="smart-synonym-editor-head-v195"><strong>🎯 汎用ヒットルール</strong><span>{smartRuleProfileStatus}</span></div>
            <p className="muted-small">主要語・補助語・除外語を項目ごとに管理します。複数語はカンマ区切りで入力してください。</p>
            <form className="smart-rule-editor-v382" onSubmit={event => upsertSmartAssistRuleProfileItem(event)}><input name="label" placeholder="ルール名" /><input name="terms" placeholder="主要語（例：見学, 予約）" /><input name="category" placeholder="カテゴリ" /><input name="intentId" placeholder="Intent ID" /><input name="weight" type="number" min="0" step="0.1" defaultValue="1" /><label><input name="enabled" type="checkbox" defaultChecked />有効</label><button type="submit">追加</button></form>
            <div className="smart-item-list-v382">{smartRuleProfiles.slice(0, 100).map((item: any) => <form className="smart-item-card-v382 smart-rule-card-v382" key={item.id} onSubmit={event => upsertSmartAssistRuleProfileItem(event, String(item.id))}><input name="label" defaultValue={String(item.label || '')} /><input name="terms" defaultValue={(item.terms || []).join(', ')} /><input name="boostTerms" defaultValue={(item.boostTerms || []).join(', ')} placeholder="補助語" /><input name="negativeTerms" defaultValue={(item.negativeTerms || []).join(', ')} placeholder="除外語" /><input name="category" defaultValue={String(item.category || '')} /><input name="intentId" defaultValue={String(item.intentId || '')} /><input name="weight" type="number" min="0" step="0.1" defaultValue={String(item.weight ?? 1)} /><input name="description" defaultValue={String(item.description || '')} placeholder="説明" /><label><input name="enabled" type="checkbox" defaultChecked={item.enabled !== false} />有効</label><button type="submit">保存</button><button type="button" onClick={() => deleteSmartAssistRuleProfileItem(String(item.id), String(item.updatedAt || ''))}>削除</button></form>)}</div>
            <details><summary>JSON一括編集（上級者向け）</summary><textarea value={smartRuleProfileJsonText} onChange={e => setSmartRuleProfileJsonText(e.target.value)} spellCheck={false} /><div className="smart-synonym-actions-v195"><button type="button" onClick={saveSmartAssistRuleProfilesFromJson}>一括保存</button><button type="button" onClick={reloadSmartAssistRuleProfiles}>再読込</button><button type="button" onClick={addSmartAssistRuleProfileTemplate}>JSONテンプレ追加</button></div></details>
          </div> : null}
          {showLowConfidenceLogs ? <div className="smart-low-confidence-panel-v194 smart-low-confidence-modal-v196 smart-low-confidence-modal-v316">
            <div><strong>未回答・要改善ログ</strong><button type="button" onClick={() => setShowLowConfidenceLogs(false)}>閉じる</button></div>
            <p className="muted-small">低信頼回答と「違う」フィードバックを集約します。質問を再実行したり、FAQ候補として下書き登録できます。</p>
            {lowConfidenceLogs.length ? lowConfidenceLogs.slice(0, 24).map((log: any, index) => <article key={log.id || index}>
              <button type="button" onClick={() => { setChatQuestion(String(log.question || '')); setShowSmartAssistControlPanel(false); }}>{String(log.question || '質問なし')}</button>
              <small>信頼度 {Number(log.confidence || 0)}% ・ {String(log.uxLevel || log.status || 'open')} ・ {String(log.reason || '要確認')} ・ {String(log.createdAt || '').slice(0, 16)}</small>
              {Array.isArray(log.candidates) && log.candidates.length ? <div className="smart-low-candidate-list-v316">{log.candidates.slice(0, 3).map((item: any) => <span key={String(item.id || item.question)}>{String(item.question || item.id || '')}</span>)}</div> : null}
              <div className="smart-low-actions-v316"><button type="button" onClick={() => askLocalFaq(String(log.question || ''))}>再質問</button><button type="button" onClick={() => { setManualFaq({ question: String(log.question || ''), answer: '', category: '未回答FAQ', tags: '未回答,要確認' }); setFaqEditMode('new'); setFaqEditDraft(null); setSmartAdminTab('faq'); setShowSmartAssistControlPanel(true); }}>FAQ下書き化</button><button type="button" onClick={async () => { if (!api || !log.id) return; const saved = await api.updateSmartAssistImprovementQueue(String(log.id), { ...log, baseUpdatedAt: String(log.updatedAt || ''), status: 'resolved', resolvedAt: new Date().toISOString() }); setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(saved)); }}>対応済み</button><button type="button" onClick={async () => { if (!api || !log.id || !window.confirm('この改善キュー項目を削除しますか？')) return; const saved = await api.deleteSmartAssistImprovementQueue(String(log.id), String(log.updatedAt || '')); setLowConfidenceLogs(dedupeSmartLowConfidenceLogs(saved)); }}>削除</button></div>
            </article>) : <p className="muted-small">未回答・要改善ログはありません。</p>}
          </div> : null}
          {faqTestResult ? <div className="smart-faq-test-panel-v194 smart-faq-test-modal-v196">
            <div><strong>FAQテスト結果</strong><button type="button" onClick={() => setFaqTestResult(null)}>閉じる</button></div>
            <p className="muted-small">{faqTestResult.record?.question}</p>
            <pre>{JSON.stringify(faqTestResult.result, null, 2).slice(0, 2400)}</pre>
          </div> : null}
        </section>
      </div> : null}

      {showFaqJsonImport ? <div className="smart-modal-backdrop-v141" role="dialog" aria-modal="true">
        <div className="smart-faq-json-modal-v141">
          <div className="smart-faq-json-modal-head-v141">
            <div><span className="smart-eyebrow-v134">FAQ JSON</span><h3>FAQ JSONを取り込む</h3><p>配列形式、または <code>{'{ items: [...] }'}</code> 形式に対応します。ChatGPTで作成したPDF FAQ JSONをここに貼り付けてください。</p></div>
            <button type="button" onClick={() => setShowFaqJsonImport(false)}>×</button>
          </div>
          <textarea className="smart-faq-json-textarea-v141" value={faqJsonText} onChange={e => { setFaqJsonText(e.target.value); setFaqJsonError(''); }} placeholder={'[{\n  "question": "...",\n  "answer": "...",\n  "category": "...",\n  "tags": ["..."]\n}]'} />
          {faqJsonError ? <p className="smart-faq-json-error-v141">{faqJsonError}</p> : <p className="muted-small">取り込むと共有フォルダ <strong>smart-assist/faq-items.json</strong> に保存されます。</p>}
          <div className="smart-faq-json-actions-v141">
            <button type="button" onClick={() => setShowFaqJsonImport(false)}>キャンセル</button>
            <button type="button" onClick={runFaqJsonImport} disabled={!faqJsonText.trim() || operationProgress.busy}>{operationProgress.busy && operationProgress.label === 'FAQ JSON取込' ? '取り込み中...' : '取り込む'}</button>
          </div>
        </div>
      </div> : null}


      {showFaqCsvImport ? <div className="smart-modal-backdrop-v141" role="dialog" aria-modal="true">
        <div className="smart-faq-json-modal-v141">
          <div className="smart-faq-json-modal-head-v141">
            <div><span className="smart-eyebrow-v134">FAQ CSV</span><h3>FAQ CSVを取り込む</h3><p>Excel等で編集したCSVを貼り付けてください。likelyQuestions等は「、」区切りで指定できます。</p></div>
            <button type="button" onClick={() => setShowFaqCsvImport(false)}>×</button>
          </div>
          <textarea className="smart-faq-json-textarea-v141" value={faqCsvText} onChange={e => { setFaqCsvText(e.target.value); setFaqCsvError(''); }} placeholder={'id,status,category,question,answer,tags,likelyQuestions,paraphrases,negativeTerms,sourceTitle,sourcePage\nfaq_001,approved,放課後児童クラブ,学童の費用は？,回答本文,学童、費用,学童クラブの費用は？,月額利用料,減免、免除,利用案内,p.1'} />
          {faqCsvError ? <p className="smart-faq-json-error-v141">{faqCsvError}</p> : <p className="muted-small">取り込むと共有フォルダ <strong>smart-assist/faq-items.json</strong> に保存されます。</p>}
          <div className="smart-faq-json-actions-v141"><button type="button" onClick={() => setShowFaqCsvImport(false)}>キャンセル</button><button type="button" onClick={runFaqCsvImport} disabled={!faqCsvText.trim() || operationProgress.busy}>取り込む</button></div>
        </div>
      </div> : null}

      {aiDataImport.open ? <div className="smart-modal-backdrop-v141" role="dialog" aria-modal="true" aria-label="AIデータ取込">
        <div className="smart-faq-json-modal-v141 smart-ai-data-import-modal-v225">
          <div className="smart-faq-json-modal-head-v141">
            <div><span className="smart-eyebrow-v134">AI Data Import</span><h3>{aiDataLabels[aiDataImport.kind]?.title || 'AIデータ'}を{aiDataImport.format.toUpperCase()}で取り込む</h3><p>{aiDataLabels[aiDataImport.kind]?.description}</p></div>
            <button type="button" onClick={() => setAiDataImport(prev => ({ ...prev, open: false, error: '' }))}>×</button>
          </div>
          <div className="smart-ai-data-import-hint-v225">
            <strong>入力するもの</strong>
            <span>{aiDataImport.format === 'csv' ? `CSV列: ${aiDataLabels[aiDataImport.kind]?.columns || 'ヘッダー行付きCSV'}` : `${aiDataLabels[aiDataImport.kind]?.jsonShape || 'JSON形式'}`}</span>
          </div>
          <textarea className="smart-faq-json-textarea-v141" value={aiDataImport.text} onChange={e => setAiDataImport(prev => ({ ...prev, text: e.target.value, error: '' }))} placeholder={aiDataImport.format === 'csv' ? (aiDataLabels[aiDataImport.kind]?.columns || 'header1,header2') : '{\n  \"items\": []\n}'} />
          {aiDataImport.error ? <p className="smart-faq-json-error-v141">{aiDataImport.error}</p> : <p className="muted-small">取込後、FAQや辞書を変更した場合は「検索・意味ベクトル再生成」を実行してください。</p>}
          <div className="smart-faq-json-actions-v141">
            <button type="button" onClick={() => setAiDataImport(prev => ({ ...prev, open: false, error: '' }))}>キャンセル</button>
            <button type="button" onClick={runAiDataImport} disabled={!aiDataImport.text.trim() || operationProgress.busy}>取り込む</button>
          </div>
        </div>
      </div> : null}

      {showImproveAnswer ? <div className="smart-modal-backdrop-v141" role="dialog" aria-modal="true" aria-label="回答を改善">
        <div className="smart-improve-modal-v153">
          <div className="smart-faq-json-modal-head-v141">
            <div><span className="smart-eyebrow-v134">Answer Improvement</span><h3>この回答を改善する</h3><p>正しい内容に修正すると、承認済みFAQとして保存され、次回以降の回答精度が上がります。</p></div>
            <button type="button" onClick={() => setShowImproveAnswer(false)}>×</button>
          </div>
          <label className="smart-improve-question-v153">質問<input value={lastUser?.text || ''} readOnly /></label>
          <textarea className="smart-faq-json-textarea-v141" value={improvedAnswerText} onChange={e => setImprovedAnswerText(e.target.value)} placeholder="正しい回答に書き直してください" />
          <div className="smart-faq-json-actions-v141">
            <button type="button" onClick={() => setShowImproveAnswer(false)}>キャンセル</button>
            <button type="button" onClick={saveImprovedAnswerAsFaq} disabled={!improvedAnswerText.trim()}>承認済みFAQとして保存</button>
          </div>
        </div>
      </div> : null}

      {false && docs.length && showFaqBuilder ? <div className="smart-faq-builder-backdrop-v151" role="dialog" aria-modal="true" aria-label="FAQを育てる">
        <section className="smart-faq-builder-panel-v138 smart-faq-builder-modal-v151">
        <div className="smart-faq-builder-head-v138 smart-faq-builder-head-v151">
          <div><span className="smart-eyebrow-v134">FAQ Growth Studio</span><h2>FAQを育てる</h2><p>未回答・低信頼・利用者フィードバックを見ながら、FAQを追加・修正するための改善専用画面です。JSON/CSVの入出力は管理画面の「AIデータ」に集約しています。</p></div>
          <div className="smart-faq-builder-head-actions-v140 smart-faq-builder-head-actions-v151 smart-faq-builder-head-actions-v226"><select value={faqFilter} onChange={e => setFaqFilter(e.target.value as any)}><option value="all">すべて</option><option value="draft">下書き</option><option value="reviewed">確認済み</option><option value="approved">承認済み</option><option value="hidden">非表示</option></select><button type="button" className="smart-secondary-admin-link-v226" onClick={() => { setShowFaqBuilder(false); setSmartAdminTab('data'); setShowSmartAssistControlPanel(true); }}>AIデータ管理へ</button><button type="button" className="smart-faq-builder-close-v151" onClick={() => setShowFaqBuilder(false)} aria-label="FAQ管理を閉じる">×</button></div>
        </div>
        <div className="smart-faq-builder-body-v151">
        <div className="smart-faq-management-summary-v143">
          <div><b>{faqStats.total}</b><span>全FAQ</span></div>
          <div><b>{faqStats.approved}</b><span>チャット優先</span></div>
          <div><b>{faqStats.pdf}</b><span>PDF由来</span></div>
          <div><b>{faqStats.categories.length}</b><span>カテゴリ</span></div>
        </div>

        <section className="smart-faq-quality-tools-v153">
          <div className="smart-panel-head-v134"><strong>🧹 FAQ品質ツール</strong><span>{duplicateFaqs.length}</span></div>
          <div className="smart-faq-quality-actions-v153">
            <button type="button" onClick={autoCategorizeFaqs} disabled={!faqRecords.length}>カテゴリ自動整理</button>
            <button type="button" onClick={() => setFaqFilter('draft')}>要確認FAQを見る</button>
            <button type="button" onClick={() => setFaqOverviewStatus('all')}>全FAQ検索へ</button>
          </div>
          {duplicateFaqs.length ? <div className="smart-duplicate-faqs-v153">
            {duplicateFaqs.slice(0, 4).map(item => <article key={`${item.a.id}:${item.b.id}`}>
              <b>重複候補 {item.score}%</b>
              <span>{item.a.question}</span>
              <span>{item.b.question}</span>
              <button type="button" onClick={() => mergeDuplicateFaq(item.a, item.b)}>統合する</button>
            </article>)}
          </div> : <p className="muted-small">重複FAQ候補はありません。</p>}
        </section>
        {faqKnowledgeBase.pdfs.length ? <section className="smart-pdf-knowledge-view-v153">
          <div className="smart-panel-head-v134"><strong>📄 PDF別FAQビュー</strong><span>{faqKnowledgeBase.pdfs.length}</span></div>
          <div className="smart-pdf-chip-row-v153">
            {faqKnowledgeBase.pdfs.map(pdf => <button key={pdf.name} type="button" onClick={() => { setFaqOverviewQuery(pdf.name); setFaqOverviewStatus('all'); setShowFaqLibrary(true); }}><b>{pdf.name}</b><small>{pdf.total}件 / 承認 {pdf.approved}</small></button>)}
          </div>
        </section> : null}
        <div className="smart-faq-growth-layout-v227">
          <section className="smart-faq-growth-hero-v227">
            <div>
              <span>AIを育てる作業場</span>
              <h3>未回答・低品質・誤答をFAQ改善につなげる</h3>
              <p>ここではJSON/CSV入出力ではなく、実際のFAQを見直して追加・編集・テストします。データの一括取込は「AIデータ」で行います。</p>
            </div>
            <button type="button" onClick={openNewFaqEditor}>＋ FAQを追加</button>
          </section>

          <section className="smart-faq-growth-board-v227">
            <article>
              <strong>下書き</strong><b>{faqReviewQueue.draft.length}</b><small>確認が必要なFAQ</small>
              <button type="button" onClick={() => setFaqFilter('draft')}>見る</button>
            </article>
            <article>
              <strong>未回答</strong><b>{faqReviewQueue.unanswered.length}</b><small>FAQ追加候補</small>
              <button type="button" onClick={() => setFaqFilter('all')}>見る</button>
            </article>
            <article>
              <strong>品質要改善</strong><b>{faqReviewQueue.lowQuality.length}</b><small>想定質問・出典不足など</small>
              <button type="button" onClick={() => setFaqFilter('all')}>確認</button>
            </article>
            <article>
              <strong>出典なし</strong><b>{faqReviewQueue.noSource.length}</b><small>根拠表示を強くする対象</small>
              <button type="button" onClick={() => setFaqFilter('all')}>補う</button>
            </article>
          </section>

          <section className="smart-faq-growth-tools-v227">
            <button type="button" onClick={generateEvaluationSetFromFaqRecords} disabled={!faqRecords.length || operationProgress.busy}><span>評価セットを自動生成</span><small>FAQ内の質問・想定質問・テスト質問から正答率測定用データを作ります。</small></button>
            <button type="button" onClick={runSmartAssistEvaluationSet} disabled={operationProgress.busy}><span>正答率を測定</span><small>現在の検索がどのFAQを当てたか、誤答・未回答を診断します。</small></button>
            <button type="button" onClick={rebuildFaqSearchIndex} disabled={operationProgress.busy}><span>検索を再生成</span><small>FAQを変更した後にEmbeddingと検索索引を作り直します。</small></button>
          </section>

          <section className="smart-faq-growth-list-v227">
            <div className="smart-faq-growth-list-head-v227"><div><h3>FAQ一覧</h3><p>編集はカードを開いて専用モーダルで行います。画面が崩れないよう、一覧では要点だけを表示します。</p></div><span>{visibleFaqRecords.length}件</span></div>
            {visibleFaqRecords.length === 0 ? <p className="muted-small">FAQはまだありません。右上の「FAQを追加」から作成してください。</p> : visibleFaqRecords.slice(0, 80).map(record => {
              const quality = faqQualityMap.get(record.id) || scoreFaqQuality(record);
              return <article key={record.id} className="smart-faq-growth-card-v227">
                <div className="smart-faq-growth-card-main-v227">
                  <div className="smart-faq-growth-meta-v227"><span className={`score-${quality.score >= 85 ? 'high' : quality.score >= 65 ? 'mid' : 'low'}`}>品質 {quality.score}</span><span>{record.status}</span><span>{record.category || '未分類'}</span></div>
                  <h4>{record.question}</h4>
                  <p>{record.answer.slice(0, 150)}{record.answer.length > 150 ? '…' : ''}</p>
                  <small>{quality.missing.length ? `改善: ${quality.missing.slice(0, 3).join(' / ')}` : '想定質問・出典・タグが整っています'}</small>
                </div>
                <div className="smart-faq-growth-card-actions-v227">
                  <button type="button" onClick={() => openFaqEditor(record)}>編集</button>
                  <button type="button" onClick={() => runSmartFaqTest(record)} disabled={testingFaqId === record.id}>{testingFaqId === record.id ? 'テスト中' : 'テスト'}</button>
                  <button type="button" onClick={() => askLocalFaq(record.question)}>質問</button>
                  <button type="button" className="danger" onClick={() => deleteFaqRecord(record.id)}>削除</button>
                </div>
              </article>;
            })}
          </section>
        </div>
        </div>
      </section>
      </div> : null}


      {faqEditDraft ? <div className="smart-faq-editor-backdrop-v240" role="dialog" aria-modal="true" aria-label={faqEditMode === 'new' ? '新しいFAQを作成' : 'FAQ編集'}>
        <section className="smart-faq-editor-modal-v240">
          <header className="smart-faq-editor-header-v240">
            <div>
              <span>{faqEditMode === 'new' ? 'Create FAQ' : 'Edit FAQ'}</span>
              <h3>{faqEditMode === 'new' ? '新しいFAQを作成' : 'FAQを編集'}</h3>
              <p>回答に使う内容、検索に当てる言葉、誤回答を防ぐ条件、出典を一画面で整理します。</p>
            </div>
            <button type="button" onClick={() => setFaqEditDraft(null)} aria-label="閉じる">×</button>
          </header>

          <div className="smart-faq-editor-layout-v240">
            <aside className="smart-faq-editor-guide-v240">
              <article className={faqEditDraft.question.trim() && faqEditDraft.answer.trim() ? 'done' : ''}><b>1</b><div><strong>質問・回答</strong><span>利用者に表示する本文</span></div></article>
              <article className={(faqEditDraft.likelyQuestions?.length || faqEditDraft.paraphrases?.length) ? 'done' : ''}><b>2</b><div><strong>検索ヒント</strong><span>短文・言い換え対策</span></div></article>
              <article className={faqEditDraft.negativeTerms?.length ? 'done' : ''}><b>3</b><div><strong>誤回答ガード</strong><span>当てたくない語句</span></div></article>
              <article className={(faqEditDraft.sourceTitles?.length || faqEditDraft.source?.title) ? 'done' : ''}><b>4</b><div><strong>出典</strong><span>根拠表示に使用</span></div></article>
              <div className="smart-faq-editor-save-state-v240">
                <strong>{faqEditDraft.question?.trim() && faqEditDraft.answer?.trim() ? '保存可能' : '質問と回答が必要'}</strong>
                <span>{faqEditDraft.status === 'approved' ? '承認済みとして保存されます。' : faqEditDraft.status === 'reviewed' ? '確認済みとして保存されます。' : '保存後、一覧に即時反映されます。'}</span>
              </div>
            </aside>

            <div className="smart-faq-editor-form-v240">
              <section className="smart-faq-editor-section-v240 is-primary">
                <div className="smart-faq-editor-section-head-v240"><strong>基本情報</strong><small>まずは代表質問と回答を入力します。</small></div>
                <label>代表質問<input value={faqEditDraft.question} onChange={e => setFaqEditDraft(v => v ? { ...v, question: e.target.value } : v)} placeholder="例：放課後児童クラブの費用はどのように確認しますか？" /></label>
                <label>回答<textarea value={faqEditDraft.answer} onChange={e => setFaqEditDraft(v => v ? { ...v, answer: e.target.value } : v)} placeholder="結論、確認先、必要書類、注意点を簡潔に記載します。" /></label>
                <div className="smart-faq-editor-two-v240">
                  <label>カテゴリ<input value={faqEditDraft.category || ''} onChange={e => setFaqEditDraft(v => v ? { ...v, category: e.target.value } : v)} placeholder="例：放課後児童クラブ" /></label>
                  <label>状態<select value={faqEditDraft.status} onChange={e => setFaqEditDraft(v => v ? { ...v, status: e.target.value as SmartFaqStatus } : v)}><option value="draft">下書き</option><option value="reviewed">確認済み</option><option value="approved">承認済み</option><option value="hidden">非表示</option></select></label>
                </div>
                <label>タグ<input value={(faqEditDraft.tags || []).join('、')} onChange={e => setFaqEditDraft(v => v ? { ...v, tags: e.target.value.split(/[、,\s]+/).map(x => x.trim()).filter(Boolean) } : v)} placeholder="例：学童、費用、利用料、減免" /></label>
              </section>

              <section className="smart-faq-editor-section-v240 smart-faq-generate-section-v295">
                <div className="smart-faq-editor-section-head-v240"><strong>生成AIで改善案</strong><small>GGUFモデルが未準備でも、テンプレート改善案を作れます。自動保存はしません。</small></div>
                <div className="smart-faq-generate-actions-v295">
                  <button type="button" onClick={generateFaqImprovementDraft} disabled={faqImprovementGenerating || !faqEditDraft.question.trim() || !faqEditDraft.answer.trim()}>{faqImprovementGenerating ? '生成中...' : '改善案を作成'}</button>
                  {faqImprovementDraft ? <button type="button" onClick={() => applyFaqImprovementDraft('hints')}>検索ヒントだけ反映</button> : null}
                  {faqImprovementDraft ? <button type="button" onClick={() => saveFaqImprovementDraftNow('hints')}>検索ヒントを保存</button> : null}
                  {faqImprovementDraft ? <button type="button" className="primary" onClick={() => applyFaqImprovementDraft('all')}>本文も含めて反映</button> : null}
                  {faqImprovementDraft ? <button type="button" className="primary" onClick={() => saveFaqImprovementDraftNow('all')}>本文も含めて保存</button> : null}
                </div>
                {faqImprovementMessage ? <p className="smart-faq-generate-message-v295">{faqImprovementMessage}{faqImprovementGenerating ? ` 経過: ${faqImprovementElapsedSec}秒 / 上限: ${Math.round(Number(generationSettings?.timeoutMs || 120000) / 1000)}秒` : ''}</p> : <p>FAQ改善案は、想定質問・言い換え・除外語・確認アクションを補うために使います。回答の最終確定は人が行います。</p>}
                {faqImprovementGenerating ? <div className="smart-generation-progress-v304"><strong>生成中</strong><span>遅い場合でも、タイムアウト時は自動停止して理由を表示します。</span></div> : null}
                {faqImprovementDraft ? <div className="smart-faq-generate-preview-v295 smart-faq-generate-preview-v314">
                  <article className="smart-faq-improvement-editor-v314"><strong>改善質問（編集可）</strong><input value={faqImprovementDraft.improvedQuestion || ''} onChange={e => updateFaqImprovementDraftField('improvedQuestion', e.target.value)} placeholder={faqEditDraft.question} /></article>
                  <article className="smart-faq-improvement-editor-v314"><strong>改善回答（編集可）</strong><textarea value={faqImprovementDraft.improvedAnswer || ''} onChange={e => updateFaqImprovementDraftField('improvedAnswer', e.target.value)} placeholder={faqEditDraft.answer} /></article>
                  <article className="smart-faq-improvement-editor-v314"><strong>想定質問（1行1件）</strong><textarea value={normalizeImprovementList(faqImprovementDraft.likelyQuestions).join('\n')} onChange={e => updateFaqImprovementDraftField('likelyQuestions', normalizeImprovementList(e.target.value))} /></article>
                  <article className="smart-faq-improvement-editor-v314"><strong>言い換え・短文キーワード（1行1件）</strong><textarea value={normalizeImprovementList(faqImprovementDraft.paraphrases).join('\n')} onChange={e => updateFaqImprovementDraftField('paraphrases', normalizeImprovementList(e.target.value))} /></article>
                  <article className="smart-faq-improvement-editor-v314"><strong>除外語 / negativeTerms（1行1件）</strong><textarea value={normalizeImprovementList(faqImprovementDraft.negativeTerms).join('\n')} onChange={e => updateFaqImprovementDraftField('negativeTerms', normalizeImprovementList(e.target.value))} placeholder="似たFAQに誤ヒットしそうな語があれば入力" /></article>
                  <article className="smart-faq-improvement-editor-v314"><strong>確認アクション（1行1件）</strong><textarea value={normalizeImprovementList(faqImprovementDraft.suggestedActions).join('\n')} onChange={e => updateFaqImprovementDraftField('suggestedActions', normalizeImprovementList(e.target.value))} /></article>
                  <article className="smart-faq-improvement-quality-v314"><strong>簡易品質チェック</strong><ul>{faqImprovementQualityChecks.map((check, index) => <li key={`${check.level}-${index}`} className={`is-${check.level}`}>{check.text}</li>)}</ul></article>
                  {faqImprovementDraft.diagnostics ? <article className="smart-faq-generate-diagnostics-v296"><strong>生成確認</strong><div>
                    <span>{faqImprovementDraft.diagnostics.generatedByLlama ? 'llama.cpp使用' : 'テンプレート'}</span>
                    {faqImprovementDraft.diagnostics.model ? <span>{faqImprovementDraft.diagnostics.model}</span> : null}
                    {typeof faqImprovementDraft.diagnostics.answerSimilarity === 'number' ? <span>回答類似度 {faqImprovementDraft.diagnostics.answerSimilarity}%</span> : null}
                    {typeof faqImprovementDraft.diagnostics.questionSimilarity === 'number' ? <span>質問類似度 {faqImprovementDraft.diagnostics.questionSimilarity}%</span> : null}
                    {faqImprovementDraft.diagnostics.parsedJson ? <span>JSON解析OK</span> : <span>JSON解析注意</span>}
                  </div></article> : null}
                  {faqImprovementDraft.rawText ? <details className="smart-faq-generate-raw-v296"><summary>生成AIの生出力を確認</summary><pre>{String(faqImprovementDraft.rawText).slice(0, 2000)}</pre></details> : null}
                </div> : null}
              </section>

              <section className="smart-faq-editor-section-v240">
                <div className="smart-faq-editor-section-head-v240"><strong>検索ヒント</strong><small>利用者が短く聞いても当たりやすくします。1行に1つずつ入力します。</small></div>
                <label>想定質問<textarea value={(faqEditDraft.likelyQuestions || []).join('\n')} onChange={e => setFaqEditDraft(v => v ? { ...v, likelyQuestions: e.target.value.split(/\n+/).map(x => x.trim()).filter(Boolean) } : v)} placeholder={'費用について教えて\n利用料はいくらですか\n放課後児童クラブの料金を知りたい'} /></label>
                <label>言い換え・短文キーワード<textarea value={(faqEditDraft.paraphrases || []).join('\n')} onChange={e => setFaqEditDraft(v => v ? { ...v, paraphrases: e.target.value.split(/\n+/).map(x => x.trim()).filter(Boolean) } : v)} placeholder={'費用\n利用料\n料金\n月額'} /></label>
                <label>正答率測定用の質問<textarea value={(faqEditDraft.testQuestions || []).join('\n')} onChange={e => setFaqEditDraft(v => v ? { ...v, testQuestions: e.target.value.split(/\n+/).map(x => x.trim()).filter(Boolean) } : v)} placeholder={'このFAQに当たってほしい質問を1行ずつ入力します。'} /></label>
              </section>

              <section className="smart-faq-editor-section-v240 is-guard">
                <div className="smart-faq-editor-section-head-v240"><strong>誤回答ガード</strong><small>似たFAQに誤って当てないための除外語です。</small></div>
                <label>除外語 / negativeTerms<textarea value={(faqEditDraft.negativeTerms || []).join('\n')} onChange={e => setFaqEditDraft(v => v ? { ...v, negativeTerms: e.target.value.split(/\n+/).map(x => x.trim()).filter(Boolean) } : v)} placeholder={'例：減免\n免除\n非課税\n※費用FAQなら減免系を入れる'} /></label>
                <p>例：「費用FAQ」と「減免FAQ」が別にある場合、費用FAQの除外語に「減免」を入れると誤ヒットを防ぎやすくなります。</p>
              </section>

              <section className="smart-faq-editor-section-v240">
                <div className="smart-faq-editor-section-head-v240"><strong>出典</strong><small>回答の根拠として表示します。</small></div>
                <label>出典タイトル<input value={faqEditDraft.sourceTitles?.[0] || faqEditDraft.source?.title || ''} onChange={e => setFaqEditDraft(v => v ? { ...v, sourceTitles: e.target.value ? [e.target.value] : [], source: { ...(v.source || {}), title: e.target.value } } : v)} placeholder="例：放課後児童クラブ利用案内" /></label>
                <div className="smart-faq-editor-two-v240">
                  <label>ページ<input value={(faqEditDraft.source as any)?.page || ''} onChange={e => setFaqEditDraft(v => v ? { ...v, source: { ...(v.source || {}), page: e.target.value } } : v)} placeholder="例：p.12" /></label>
                  <label>章・節<input value={(faqEditDraft.source as any)?.section || ''} onChange={e => setFaqEditDraft(v => v ? { ...v, source: { ...(v.source || {}), section: e.target.value } } : v)} placeholder="例：費用・利用料" /></label>
                </div>
                <label>URL<input value={(faqEditDraft.source as any)?.url || ''} onChange={e => setFaqEditDraft(v => v ? { ...v, source: { ...(v.source || {}), url: e.target.value } } : v)} placeholder="任意。公式ページや共有資料のURL" /></label>
              </section>
            </div>
          </div>

          <footer className="smart-faq-editor-footer-v240">
            <button type="button" onClick={() => setFaqEditDraft(null)}>キャンセル</button>
            <button type="button" className="primary" onClick={saveFaqEditDraft} disabled={!faqEditDraft.question.trim() || !faqEditDraft.answer.trim()}>{faqEditMode === 'new' ? 'FAQを作成する' : '変更を保存する'}</button>
          </footer>
        </section>
      </div> : null}

      {docs.length && showDetails ? <div className="smart-detail-modal-backdrop-v150" role="dialog" aria-modal="true" aria-label="詳細ツール">
        <section className="smart-detail-modal-v150">
          <header className="smart-detail-modal-head-v150">
            <div>
              <span className="smart-eyebrow-v134">Local Smart Assist</span>
              <h2>詳細ツール</h2>
              <p>検索・重要文・トークン・候補診断を確認できます。チャット画面には影響せず、この画面だけをスクロールできます。</p>
            </div>
            <button type="button" onClick={() => setShowDetails(false)} aria-label="詳細ツールを閉じる">×</button>
          </header>
          <div className="smart-detail-modal-toolbar-v150">
            <label><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="詳細検索：学童 期限、会計年度 休暇、PDF 未整理" /></label>
            <select value={scope} onChange={e => setScope(e.target.value as any)}>
              <option value="all">すべて</option><option value="page">ページ</option><option value="database">DB</option><option value="row">DB行</option><option value="journal">Journal</option><option value="inbox">Inbox</option><option value="task">Task</option>
            </select>
          </div>
          <div className="smart-detail-modal-body-v150">
            <section className="smart-card-v134 smart-detail-card-v150">
              <div className="smart-panel-head-v134"><strong>スマート検索</strong><span>{results.length}</span></div>
              <div className="smart-compact-results-v137">
                {results.slice(0, 32).map(doc => <button key={doc.id} className={selected?.id === doc.id ? 'selected' : ''} onClick={() => setSelectedId(doc.id)} onDoubleClick={() => openDoc(doc)}>
                  <b>{doc.title}</b><small>{doc.kind} {doc.score ? `・score ${doc.score}` : ''}</small>
                </button>)}
              </div>
            </section>
            <section className="smart-card-v134 smart-detail-card-v150">
              <div className="smart-panel-head-v134"><strong>重要文抽出</strong><span>extractive</span></div>
              <div className="smart-detail-scroll-v150">
                {summaryLines.length ? summaryLines.map((line, i) => <p key={i}>{line}</p>) : <p className="muted-small">重要文候補はまだありません。</p>}
              </div>
            </section>
            <section className="smart-card-v134 smart-detail-card-v150">
              <div className="smart-panel-head-v134"><strong>形態素風トークン</strong><span>{tokenPreview.length}</span></div>
              <div className="smart-token-cloud-v134 smart-detail-scroll-v150">{tokenPreview.map(token => <span key={token}>{token}</span>)}</div>
            </section>
            <section className="smart-card-v134 smart-detail-card-v150">
              <div className="smart-panel-head-v134"><strong>候補・診断</strong><span>{suggestions.length}</span></div>
              <div className="smart-suggestion-list-v134 smart-detail-scroll-v150">
                {suggestions.slice(0, 18).map(item => <article key={item.id} className={`smart-suggestion-v134 kind-${item.kind}`}>
                  <div><b>{item.title}</b><p>{item.detail}</p>{item.related && <button onClick={() => openDoc(item.related)}>関連先を開く</button>}</div>
                  <strong>{item.confidence}%</strong>
                </article>)}
              </div>
            </section>
          </div>
          <footer className="smart-detail-modal-foot-v150">
            <button type="button" onClick={() => setShowDetails(false)}>閉じる</button>
          </footer>
        </section>
      </div> : null}
    </section>
  );
}
