import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResult,
  PageProperties,
} from "../../../../shared/types";
import type { ApiClient } from "../../lib/api";

type Props = {
  api: ApiClient | null;
  pageId: string;
  pageTitle: string;
  pageIcon?: string | null;
  properties: PageProperties;
  onOpenPage: (pageId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenKnowledgeMap: () => void;
};

type CachedGraph = { value: KnowledgeGraphResult; loadedAt: number };
const graphCache = new Map<string, CachedGraph>();
const GRAPH_CACHE_LIMIT = 24;
const GRAPH_CACHE_TTL_MS = 45_000;

function cacheGraph(pageId: string, value: KnowledgeGraphResult) {
  graphCache.delete(pageId);
  graphCache.set(pageId, { value, loadedAt: Date.now() });
  while (graphCache.size > GRAPH_CACHE_LIMIT) {
    const oldest = graphCache.keys().next().value;
    if (typeof oldest !== "string") break;
    graphCache.delete(oldest);
  }
}

function directEdges(graph: KnowledgeGraphResult, pageId: string) {
  const centerId = `page:${pageId}`;
  return graph.edges.filter((edge) => edge.source === centerId || edge.target === centerId);
}

function counterpart(edge: KnowledgeGraphEdge, pageId: string) {
  const centerId = `page:${pageId}`;
  return edge.source === centerId ? edge.target : edge.source;
}

function storyLines(graph: KnowledgeGraphResult, pageId: string, fallbackTitle: string) {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = directEdges(graph, pageId);
  const targetNodes = (kind: KnowledgeGraphEdge["kind"]) =>
    edges
      .filter((edge) => edge.kind === kind)
      .map((edge) => nodeMap.get(counterpart(edge, pageId)))
      .filter((node): node is KnowledgeGraphNode => Boolean(node));
  const label = (nodes: KnowledgeGraphNode[], limit = 3) =>
    nodes
      .slice(0, limit)
      .map((node) => `「${node.title}」`)
      .join("、");

  const parents = targetNodes("parent");
  const children = targetNodes("child");
  const outgoing = targetNodes("link");
  const incoming = targetNodes("backlink");
  const tags = targetNodes("tag");
  const lines: Array<{ tone: "origin" | "flow" | "signal"; text: string }> = [];

  if (parents.length) {
    lines.push({ tone: "origin", text: `${fallbackTitle} は ${label(parents, 1)} の流れにあります。` });
  }
  if (incoming.length) {
    lines.push({ tone: "origin", text: `${label(incoming)} から参照され、このページへ話題が集まっています。` });
  }
  if (outgoing.length) {
    lines.push({ tone: "flow", text: `ここから ${label(outgoing)} へ内容がつながります。` });
  }
  if (children.length) {
    lines.push({ tone: "flow", text: `次の整理先として ${label(children)} が続いています。` });
  }
  if (tags.length) {
    lines.push({ tone: "signal", text: `${label(tags)} という共通テーマの中で見つけやすくなっています。` });
  }
  if (!lines.length) {
    lines.push({
      tone: "signal",
      text: "まだ直接のつながりは少なめです。リンク・子ページ・タグを追加すると、ここから知識の流れが育ちます。",
    });
  }
  return lines.slice(0, 4);
}

function relationLabel(kind: KnowledgeGraphEdge["kind"]) {
  return {
    link: "リンク先",
    backlink: "参照元",
    parent: "親ページ",
    child: "子ページ",
    tag: "共通タグ",
    attachment: "添付",
  }[kind];
}

export function PageContextStoryPanel({
  api,
  pageId,
  pageTitle,
  pageIcon,
  properties,
  onOpenPage,
  onOpenDatabaseRow,
  onOpenKnowledgeMap,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [graph, setGraph] = useState<KnowledgeGraphResult | null>(null);
  const requestRef = useRef(0);
  const direct = useMemo(() => (graph ? directEdges(graph, pageId) : []), [graph, pageId]);
  const nodeMap = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) || []), [graph]);

  useEffect(() => {
    setExpanded(false);
    setError("");
    setLoading(false);
    const cached = graphCache.get(pageId);
    if (cached && Date.now() - cached.loadedAt < GRAPH_CACHE_TTL_MS) setGraph(cached.value);
    else setGraph(null);
  }, [pageId]);

  const loadGraph = async (force = false) => {
    if (!api || loading) return;
    const cached = graphCache.get(pageId);
    if (!force && cached && Date.now() - cached.loadedAt < GRAPH_CACHE_TTL_MS) {
      setGraph(cached.value);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const next = await api.getLocalKnowledgeGraph(pageId, 48);
      if (requestRef.current !== requestId) return;
      cacheGraph(pageId, next);
      setGraph(next);
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      setError("関係情報を読み込めませんでした。");
      console.warn("PAGE_CONTEXT_GRAPH_LOAD_FAILED", pageId, cause);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !graph) void loadGraph();
  };

  const grouped = useMemo(() => {
    const result = new Map<KnowledgeGraphEdge["kind"], KnowledgeGraphNode[]>();
    for (const edge of direct) {
      const node = nodeMap.get(counterpart(edge, pageId));
      if (!node) continue;
      const group = result.get(edge.kind) || [];
      if (!group.some((item) => item.id === node.id)) group.push(node);
      result.set(edge.kind, group);
    }
    return Array.from(result.entries()).sort(([a], [b]) => relationLabel(a).localeCompare(relationLabel(b), "ja"));
  }, [direct, nodeMap, pageId]);

  return (
    <section className="page-context" aria-label="ページの関係">
      <div className="page-context__header">
        <div className="page-context__meta" aria-label="ページの状態とタグ">
          {(properties.status !== "未着手" || properties.tags.length > 0) && (
            <span className="page-context__label">{pageIcon || "📄"} 文脈</span>
          )}
          {properties.status !== "未着手" && <span className="page-context__status">{properties.status}</span>}
          {properties.tags.slice(0, 3).map((tag) => <span className="page-context__tag" key={tag}>#{tag}</span>)}
          {properties.tags.length > 3 && <span className="page-context__tag">+{properties.tags.length - 3}</span>}
        </div>
        <div className="page-context__actions">
          <button type="button" className="secondary page-context__story-toggle" onClick={toggleExpanded} aria-expanded={expanded}>
            <span aria-hidden="true">{expanded ? "⌃" : "✦"}</span>
            {expanded ? "閉じる" : "関係を見る"}
          </button>
          <button type="button" className="secondary page-context__map-button" onClick={onOpenKnowledgeMap} title="ナレッジマップで関係を確認" aria-label="ナレッジマップで関係を確認">
            ↗
          </button>
        </div>
      </div>

      {expanded && (
        <div className="page-context__story">
          {loading && !graph ? <div className="page-context__loading">関係を整理しています…</div> : null}
          {error ? (
            <div className="page-context__error">
              <span>{error}</span>
              <button type="button" className="secondary" onClick={() => void loadGraph(true)}>再試行</button>
            </div>
          ) : null}
          {graph ? (
            <>
              <ol className="page-context__story-lines">
                {storyLines(graph, pageId, pageTitle).map((line, index) => (
                  <li key={`${line.tone}:${index}`} className={line.tone}>{line.text}</li>
                ))}
              </ol>
              {grouped.length > 0 && (
                <div className="page-context__relations">
                  {grouped.map(([kind, nodes]) => (
                    <div key={kind} className="page-context__relation-row">
                      <span>{relationLabel(kind)}</span>
                      <div>
                        {nodes.slice(0, 5).map((node) => {
                          const interactive = node.type === "page" || node.type === "database-row";
                          return (
                            <button
                              key={node.id}
                              type="button"
                              className="page-context__relation-chip"
                              title={node.title}
                              disabled={!interactive}
                              onClick={() => {
                                if (node.type === "page" && node.pageId) onOpenPage(node.pageId);
                                if (node.type === "database-row" && node.databaseId && node.rowId) onOpenDatabaseRow(node.databaseId, node.rowId);
                              }}
                            >
                              <span>{node.icon || "•"}</span>
                              {node.title}
                            </button>
                          );
                        })}
                        {nodes.length > 5 && <small>+{nodes.length - 5}</small>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {graph.truncated && <small className="page-context__truncated">関係が多いため、近い関係から表示しています。</small>}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
