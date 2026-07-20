import React, { useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "../../lib/api";

type SemanticDocumentType =
  | "faq"
  | "page"
  | "database_row"
  | "journal"
  | "attachment_summary";

type SemanticChunk = {
  id: string;
  type: SemanticDocumentType;
  sourceId: string;
  parentPageId?: string;
  databaseId?: string;
  rowId?: string;
  title: string;
  text: string;
  keywords?: string[];
  tags?: string[];
  intentId?: string;
  semanticMetaText?: string;
  updatedAt?: string;
};

type SemanticSearchResult = {
  chunk: SemanticChunk;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  titleScore?: number;
  metaScore?: number;
  relationBoost?: number;
  reasons?: string[];
};

type SemanticRelatedResult = {
  ok: true;
  target: SemanticChunk | null;
  generatedAt: string;
  indexRevision?: string;
  indexedCount: number;
  available: boolean;
  warming?: boolean;
  warning?: string;
  hiddenLowScoreCount?: number;
  qualityPolicy?: { minScore: number; minSemanticScore: number; mode: string };
  groups: {
    pages: SemanticSearchResult[];
    faqs: SemanticSearchResult[];
    databaseRows: SemanticSearchResult[];
    journals: SemanticSearchResult[];
    attachments: SemanticSearchResult[];
  };
  results: SemanticSearchResult[];
};

type RelatedGroupKey = keyof SemanticRelatedResult["groups"];

const RELATED_FETCH_LIMIT = 32;

// Related results are derived from an immutable semantic index between rebuilds.
// Keep a small process-local cache so revisiting a page never repeats the same
// semantic search or competes with the editor paint.
const RELATED_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const RELATED_RESULT_CACHE_MAX = 48;
type RelatedCacheEntry = { value: SemanticRelatedResult; cachedAt: number; indexRevision: string | null };
const relatedResultCache = new Map<string, RelatedCacheEntry>();

function getCachedRelatedResult(key: string, indexRevision: string | null): SemanticRelatedResult | null {
  const entry = relatedResultCache.get(key);
  if (!entry) return null;
  if (entry.indexRevision !== indexRevision || Date.now() - entry.cachedAt > RELATED_RESULT_CACHE_TTL_MS) {
    relatedResultCache.delete(key);
    return null;
  }
  // LRU touch: recently revisited pages stay warm.
  relatedResultCache.delete(key);
  relatedResultCache.set(key, entry);
  return entry.value;
}

function cacheRelatedResult(key: string, value: SemanticRelatedResult, indexRevision: string | null): void {
  relatedResultCache.delete(key);
  relatedResultCache.set(key, { value, cachedAt: Date.now(), indexRevision });
  while (relatedResultCache.size > RELATED_RESULT_CACHE_MAX) {
    const oldest = relatedResultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    relatedResultCache.delete(oldest);
  }
}

function clearRelatedResultCache(): void {
  relatedResultCache.clear();
}
const RELATED_GROUP_LIMIT = 8;
const RELATED_INITIAL_VISIBLE = 4;

type WorkspaceRelatedTarget =
  | { type: "page"; id: string | null }
  | { type: "database_row"; id: string | null; databaseId: string | null }
  | { type: "journal"; id: string | null }
  | { type: "faq"; id: string | null };

type WorkspaceRelatedPanelProps = {
  api: ApiClient | null;
  pageId?: string | null;
  target?: WorkspaceRelatedTarget;
  active?: boolean;
  compact?: boolean;
  description?: string;
  /** Unsaved page text used only for a read-only, debounced draft suggestion search. */
  draftContent?: { title: string; text: string; tags?: string[]; enabled?: boolean } | null;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
};

const GROUP_LABELS: Record<RelatedGroupKey, { title: string; icon: string; empty: string }> = {
  pages: { title: "関連ページ", icon: "📄", empty: "関連ページはまだありません" },
  faqs: { title: "関連FAQ", icon: "💬", empty: "関連FAQはまだありません" },
  databaseRows: { title: "関連DB", icon: "🗃️", empty: "関連するDB行はまだありません" },
  journals: { title: "関連ジャーナル", icon: "📅", empty: "関連ジャーナルはまだありません" },
  attachments: { title: "関連資料", icon: "📎", empty: "関連資料はまだありません" },
};

const GROUP_ORDER: RelatedGroupKey[] = ["pages", "faqs", "databaseRows", "journals", "attachments"];

function clampText(value: string | undefined, max = 96): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "内容プレビューなし";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function scoreLabel(score: number): string {
  if (score >= 82) return "関連度 高";
  if (score >= 62) return "関連度 中";
  return "関連度 低";
}

function scoreClass(score: number): string {
  if (score >= 82) return "high";
  if (score >= 62) return "medium";
  return "low";
}


function uniqueTokens(values: Array<string | undefined>, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    for (const token of String(value || "").split(/[、,\s#]+/)) {
      const trimmed = token.trim();
      if (!trimmed || trimmed.length < 2 || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function evidenceTerms(item: SemanticSearchResult): string[] {
  const chunk = item.chunk;
  // Keep chips to real business clues only. Score explanations are rendered once
  // in the breakdown row below, so including `reasons` here creates duplication
  // such as "意味類似" appearing both as chips and as score details.
  return uniqueTokens([
    ...(chunk.tags || []),
    ...(chunk.keywords || []),
    chunk.intentId,
  ], 7);
}

function metricChips(item: SemanticSearchResult): Array<{ key: string; label: string; value: string }> {
  const chips: Array<{ key: string; label: string; value: string }> = [];
  if (Number.isFinite(item.semanticScore) && item.semanticScore > 0) chips.push({ key: "semantic", label: "意味", value: `${item.semanticScore}%` });
  if (Number.isFinite(item.lexicalScore) && item.lexicalScore > 0) chips.push({ key: "lexical", label: "本文", value: `${item.lexicalScore}%` });
  if (Number.isFinite(item.metaScore || 0) && (item.metaScore || 0) > 0) chips.push({ key: "meta", label: "メタ", value: `${item.metaScore}%` });
  if (Number.isFinite(item.relationBoost || 0) && (item.relationBoost || 0) > 0) chips.push({ key: "relation", label: "補正", value: `+${item.relationBoost}` });
  return chips.slice(0, 4);
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function targetDateFromJournalChunk(chunk: SemanticChunk): string {
  return chunk.sourceId || chunk.id.replace(/^journal_/, "");
}

function WorkspaceRelatedItem({
  item,
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onOpenJournal,
}: {
  item: SemanticSearchResult;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
}) {
  const chunk = item.chunk;
  const open = () => {
    if (chunk.type === "page") onOpenPage(chunk.sourceId);
    if (chunk.type === "journal") onOpenJournal(targetDateFromJournalChunk(chunk));
    if (chunk.type === "database_row") {
      if (chunk.databaseId && (chunk.rowId || chunk.sourceId)) {
        onOpenDatabaseRow(chunk.databaseId, chunk.rowId || chunk.sourceId);
      } else if (chunk.databaseId) {
        onOpenDatabase(chunk.databaseId);
      }
    }
  };
  const canOpen = chunk.type === "page" || chunk.type === "journal" || chunk.type === "database_row";
  const terms = evidenceTerms(item);
  const metrics = metricChips(item);
  const dateText = formatDate(chunk.updatedAt);
  return (
    <button
      className="related-item-v285 related-evidence-card-v729"
      onClick={canOpen ? open : undefined}
      disabled={!canOpen}
      title={chunk.title}
    >
      <span className={`related-score-v285 score-${scoreClass(item.score)}`}>{item.score}</span>
      <span className="related-item-main-v285">
        <span className="related-title-row-v729"><b>{chunk.title || "Untitled"}</b><em className={`related-degree-v729 score-${scoreClass(item.score)}`}>{scoreLabel(item.score)}</em></span>
        <small className="related-evidence-snippet-v729">{clampText(chunk.text, 112)}</small>
        {terms.length ? <span className="related-evidence-terms-v729" aria-label="一致したタグ・キーワード">{terms.map((term) => <i key={term}>{term}</i>)}</span> : null}
        <span className="related-evidence-footer-v730">
          {metrics.length ? (
            <span className="related-metrics-v730" aria-label="関連度の内訳">
              {metrics.map((metric) => <em key={metric.key}><span>{metric.label}</span><b>{metric.value}</b></em>)}
            </span>
          ) : null}
          {dateText ? <time dateTime={chunk.updatedAt}>{dateText}</time> : null}
        </span>
      </span>
    </button>
  );
}

function WorkspaceRelatedGroup({
  groupKey,
  items,
  collapsed,
  onToggle,
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onOpenJournal,
}: {
  groupKey: RelatedGroupKey;
  items: SemanticSearchResult[];
  collapsed: boolean;
  onToggle: () => void;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
}) {
  const meta = GROUP_LABELS[groupKey];
  const [expanded, setExpanded] = useState(false);
  const visibleLimit = expanded ? RELATED_GROUP_LIMIT : RELATED_INITIAL_VISIBLE;
  const visible = items.slice(0, visibleLimit);
  const hasMore = items.length > visible.length;
  return (
    <section className="related-group-v285">
      <button className="related-group-head-v285" onClick={onToggle}>
        <span>{collapsed ? "▸" : "▾"} {meta.icon} {meta.title}</span>
        <small>{items.length ? `上位${Math.min(items.length, RELATED_GROUP_LIMIT)}件` : "0"}</small>
      </button>
      {!collapsed ? (
        visible.length ? (
          <div className="related-list-v285">
            {visible.map((item) => (
              <WorkspaceRelatedItem
                key={item.chunk.id}
                item={item}
                onOpenPage={onOpenPage}
                onOpenDatabase={onOpenDatabase}
                onOpenDatabaseRow={onOpenDatabaseRow}
                onOpenJournal={onOpenJournal}
              />
            ))}
            {hasMore ? (
              <button type="button" className="related-more-v288" onClick={() => setExpanded(true)}>
                さらに表示（{Math.min(items.length, RELATED_GROUP_LIMIT) - visible.length}件）
              </button>
            ) : expanded && items.length > RELATED_INITIAL_VISIBLE ? (
              <button type="button" className="related-more-v288" onClick={() => setExpanded(false)}>
                折りたたむ
              </button>
            ) : null}
          </div>
        ) : (
          <p className="related-empty-row-v285">{meta.empty}</p>
        )
      ) : null}
    </section>
  );
}

export function WorkspaceRelatedPanel({
  api,
  pageId,
  target,
  active = true,
  compact = false,
  description,
  draftContent,
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onOpenJournal,
}: WorkspaceRelatedPanelProps) {
  const [related, setRelated] = useState<SemanticRelatedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [targetIndexPending, setTargetIndexPending] = useState(false);
  const [draftRelated, setDraftRelated] = useState<SemanticRelatedResult | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [error, setError] = useState("");
  const warmingRetryCountRef = useRef(0);
  const [collapsed, setCollapsed] = useState<Partial<Record<RelatedGroupKey, boolean>>>(() => {
    try {
      return JSON.parse(localStorage.getItem("local-notion:related-panel-collapsed") || "{}");
    } catch {
      return {};
    }
  });

  const resolvedTarget = useMemo<WorkspaceRelatedTarget>(() => {
    if (target) return target;
    return { type: "page", id: pageId || null };
  }, [target, pageId]);
  const targetKey = useMemo(() => `${resolvedTarget.type}:${resolvedTarget.type === "database_row" ? resolvedTarget.databaseId || "" : ""}:${resolvedTarget.id || ""}`, [resolvedTarget]);
  const total = useMemo(() => related?.results?.length || 0, [related]);

  async function fetchRelatedForTarget() {
    if (!api || !resolvedTarget.id) return null;
    if (resolvedTarget.type === "page") return api.getRelatedForPage(resolvedTarget.id, RELATED_FETCH_LIMIT);
    if (resolvedTarget.type === "database_row") {
      if (!resolvedTarget.databaseId) return null;
      return api.getRelatedForDatabaseRow(resolvedTarget.databaseId, resolvedTarget.id, RELATED_FETCH_LIMIT);
    }
    if (resolvedTarget.type === "journal") return api.getRelatedForJournal(resolvedTarget.id, RELATED_FETCH_LIMIT);
    if (resolvedTarget.type === "faq") return api.getRelatedForFaq(resolvedTarget.id, RELATED_FETCH_LIMIT);
    return null;
  }

  async function loadRelated(signal?: AbortSignal, options: { force?: boolean } = {}) {
    if (!api || !resolvedTarget.id || !active) return;
    setLoading(true);
    setError("");
    try {
      // Revision is a very small, in-memory server read. It makes the 10-minute
      // client cache safe across full/diff reindex runs and other app windows.
      const revisionInfo = await api.getWorkspaceSemanticIndexRevision();
      if (signal?.aborted) return;
      const indexRevision = revisionInfo.revision || null;
      const cacheKey = targetKey;
      const cached = options.force ? null : getCachedRelatedResult(cacheKey, indexRevision);
      if (cached) {
        setRelated(cached);
        return;
      }
      const result = await fetchRelatedForTarget();
      if (!result || signal?.aborted) return;
      // Prefer the revision carried by the related result. The preflight value
      // still protects a cache lookup when an older server build is in use.
      const resultRevision = result.indexRevision || indexRevision;
      cacheRelatedResult(cacheKey, result, resultRevision || null);
      setRelated(result);
    } catch (e: any) {
      if (signal?.aborted) return;
      setError(e?.message || "関連情報の取得に失敗しました");
      setRelated(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  async function rebuildAndReload() {
    if (!api) return;
    setReindexing(true);
    setError("");
    try {
      const rebuilt = await api.rebuildWorkspaceSemanticIndex();
      clearRelatedResultCache();
      window.dispatchEvent(new CustomEvent('local-notion:semantic-index-updated', { detail: { revision: rebuilt?.revision || rebuilt?.generatedAt || null, mode: 'full' } }));
    } catch (e: any) {
      setError(e?.message || "Semantic Indexの再構築に失敗しました");
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    let idleId: number | null = null;
    const run = () => {
      // Keep the first editor paint responsive. requestIdleCallback is not
      // guaranteed on all Electron builds, so a bounded timeout remains.
      const requestIdle = (window as any).requestIdleCallback as undefined | ((callback: () => void, options?: { timeout?: number }) => number);
      if (requestIdle) {
        idleId = requestIdle(() => void loadRelated(controller.signal), { timeout: compact ? 600 : 1800 });
      } else {
        void loadRelated(controller.signal);
      }
    };
    const timer = window.setTimeout(run, compact ? 250 : 850);
    return () => {
      window.clearTimeout(timer);
      if (idleId !== null) {
        const cancelIdle = (window as any).cancelIdleCallback as undefined | ((id: number) => void);
        cancelIdle?.(idleId);
      }
      controller.abort();
    };
  }, [api, targetKey, active, compact]);

  useEffect(() => {
    // The first passive request may intentionally return "warming" while the
    // server hydrates its local Index cache after responding. Retry only a few
    // times and never block the editor or page navigation while waiting.
    if (!related?.warming || !api || !active || !resolvedTarget.id) {
      warmingRetryCountRef.current = 0;
      return;
    }
    if (warmingRetryCountRef.current >= 6) return;
    warmingRetryCountRef.current += 1;
    const timer = window.setTimeout(() => {
      void loadRelated(undefined, { force: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [related?.warming, api, active, targetKey]);

  useEffect(() => {
    const handleTargetDirty = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (detail?.targetKey !== targetKey) return;
      relatedResultCache.delete(targetKey);
      setTargetIndexPending(true);
    };
    const handleIndexUpdated = () => {
      clearRelatedResultCache();
      setTargetIndexPending(false);
      if (active && resolvedTarget.id) void loadRelated(undefined, { force: true });
    };
    window.addEventListener('local-notion:semantic-target-dirty', handleTargetDirty);
    window.addEventListener("local-notion:semantic-index-updated", handleIndexUpdated);
    return () => {
      window.removeEventListener('local-notion:semantic-target-dirty', handleTargetDirty);
      window.removeEventListener("local-notion:semantic-index-updated", handleIndexUpdated);
    };
  }, [api, targetKey, active]);

  useEffect(() => {
    setTargetIndexPending(false);
  }, [targetKey]);

  useEffect(() => {
    const draft = draftContent;
    const enabled = Boolean(active && api && resolvedTarget.type === "page" && resolvedTarget.id && draft?.enabled !== false);
    const text = String(draft?.text || "").replace(/\s+/g, " ").trim();
    const title = String(draft?.title || "").trim();
    const tags = Array.isArray(draft?.tags) ? draft!.tags! : [];
    if (!enabled || (title + text).trim().length < 24) {
      setDraftRelated(null);
      setDraftLoading(false);
      return;
    }
    let cancelled = false;
    setDraftLoading(false);
    const timer = window.setTimeout(() => {
      setDraftLoading(true);
      void api!.getRelatedForDraft({ pageId: resolvedTarget.id!, title, text: text.slice(0, 4_000), tags, limit: 5 })
        .then((result) => { if (!cancelled) setDraftRelated(result || null); })
        .catch(() => { if (!cancelled) setDraftRelated(null); })
        .finally(() => { if (!cancelled) setDraftLoading(false); });
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, active, resolvedTarget.type, resolvedTarget.id, draftContent?.title, draftContent?.text, JSON.stringify(draftContent?.tags || []), draftContent?.enabled]);

  useEffect(() => {
    localStorage.setItem("local-notion:related-panel-collapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  return (
    <aside className={`workspace-related-panel-v285${compact ? " workspace-related-panel-compact-v286" : ""}`} aria-label="関連情報">
      <div className="related-panel-head-v285">
        <div>
          <span className="related-kicker-v285">ruri-v3</span>
          <h3>関連情報</h3>
          <p>{description || "開いているページに近い情報をワークスペース全体から抽出します。"}</p>
        </div>
        <button className="related-refresh-v285" onClick={() => loadRelated(undefined, { force: true })} disabled={loading || reindexing || !resolvedTarget.id} title="更新">
          {loading ? "…" : "↻"}
        </button>
      </div>

      <div className="related-index-status-v285">
        <span>{related?.warming ? "Index準備中" : related?.available ? "Index ready" : "Index未作成"}</span>
        <small>{related?.warming ? "初回キャッシュを準備しています。ページ操作はそのまま続けられます。" : related ? `${related.indexedCount} chunks / ${total} hits / 厳選表示${related.hiddenLowScoreCount ? ` / 低関連${related.hiddenLowScoreCount}件非表示` : ""}` : loading ? "読み込み中" : "未取得"}</small>
      </div>

      {error ? <div className="related-alert-v285 danger">{error}</div> : null}
      {related?.warning ? <div className="related-alert-v285">{related.warning}</div> : null}
      {targetIndexPending ? <div className="related-alert-v285">このページの変更を関連Indexへ反映しています。完了後に候補を自動更新します。</div> : null}
      {draftLoading ? <div className="related-alert-v285">編集中の本文から候補を確認しています…</div> : null}
      {draftRelated?.available && draftRelated.results.length > 0 ? (
        <section className="related-draft-suggestions-v442">
          <div className="related-draft-head-v442"><strong>✎ 編集中の候補</strong><small>未保存の本文をもとにした仮候補です</small></div>
          <div className="related-list-v285">
            {draftRelated.results.slice(0, 5).map((item) => (
              <WorkspaceRelatedItem key={`draft-${item.chunk.id}`} item={item} onOpenPage={onOpenPage} onOpenDatabase={onOpenDatabase} onOpenDatabaseRow={onOpenDatabaseRow} onOpenJournal={onOpenJournal} />
            ))}
          </div>
        </section>
      ) : null}
      {related?.available && !related.target && !related?.warning ? <div className="related-alert-v285">関連ページを準備中です。Semantic Indexの差分更新または再構築が完了すると、自動で候補を表示します。</div> : null}

      {related?.warming ? (
        <div className="related-empty-v285">
          <strong>関連Indexを準備しています</strong>
          <p>最初の読み込みだけをバックグラウンドで行っています。ページ編集やタブ移動はそのまま続けられます。</p>
        </div>
      ) : !related?.available ? (
        <div className="related-empty-v285">
          <strong>関連情報を表示するにはIndexが必要です</strong>
          <p>FAQ・ページ・DB・ジャーナルをruri-v3で検索できる形に再構築します。</p>
          <button onClick={rebuildAndReload} disabled={reindexing || loading || !api}>
            {reindexing ? "再構築中…" : "Semantic Indexを作成"}
          </button>
        </div>
      ) : (
        <div className="related-groups-v285">
          {total === 0 ? <p className="related-empty-row-v285">関連度が十分な候補はありません。必要な場合はSemantic Indexを更新するか、検索欄で直接検索してください。</p> : null}
          {GROUP_ORDER.map((key) => (
            <WorkspaceRelatedGroup
              key={key}
              groupKey={key}
              items={related.groups?.[key] || []}
              collapsed={Boolean(collapsed[key])}
              onToggle={() => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))}
              onOpenPage={onOpenPage}
              onOpenDatabase={onOpenDatabase}
              onOpenDatabaseRow={onOpenDatabaseRow}
              onOpenJournal={onOpenJournal}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
