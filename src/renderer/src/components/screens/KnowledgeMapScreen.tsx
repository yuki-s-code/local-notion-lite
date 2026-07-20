import { addCollectionItemToDefaultShelf } from '../../lib/collectionShelves';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResult,
  KnowledgeGraphScope,
} from "../../../../shared/types";
import type { ApiClient } from "../../lib/api";

import { subscribeWorkspaceMutations } from "../../../../shared/workspace/subscribeWorkspaceMutations";
type Props = {
  api: ApiClient | null;
  pageId: string;
  onOpenPage: (pageId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onBack: () => void;
};

type Point = { x: number; y: number };
type NodePosition = Record<string, Point>;
type RelationFilter = Record<KnowledgeGraphEdge["kind"], boolean>;
type TimeRange = "all" | "7d" | "30d" | "90d" | "365d";
type VisualMode = "standard" | "garden" | "universe";
type SavedMapView = {
  id: string;
  name: string;
  scope: KnowledgeGraphScope;
  filters: RelationFilter;
  zoom: number;
  pan: Point;
  focusEnabled: boolean;
  focusDepth: number;
  searchQuery: string;
  selectedId: string | null;
  visualMode?: VisualMode;
  createdAt: string;
};

const STORAGE_PREFIX = "local-notion:knowledge-map-layout:v3:";
const SAVED_VIEWS_KEY = "local-notion:knowledge-map-saved-views:v1";
const FIXED_NODES_PREFIX = "local-notion:knowledge-map-fixed-nodes:v1:";
const MINIMAP_POSITION_KEY = "local-notion:knowledge-map-minimap-position:v1";
const CLUSTER_NAMES_PREFIX = "local-notion:knowledge-map-cluster-names:v1:";
const COLLAPSED_CLUSTERS_PREFIX = "local-notion:knowledge-map-collapsed-clusters:v1:";
const GARDEN_MODE_PREFIX = "local-notion:knowledge-map-garden-mode:v1:";
const VISUAL_MODE_PREFIX = "local-notion:knowledge-map-visual-mode:v1:";
const DRAG_THRESHOLD = 7;
const MAP_MOVE_FRAME_MS = 16;
const TIMELINE_STEPS: TimeRange[] = ["365d", "90d", "30d", "7d", "all"];
const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  all: "すべて",
  "7d": "7日",
  "30d": "30日",
  "90d": "90日",
  "365d": "1年",
};
const MINIMAP_MARGIN = 10;
const DEFAULT_FILTERS: RelationFilter = {
  link: true,
  backlink: true,
  parent: true,
  child: true,
  tag: true,
  attachment: true,
};
const KIND_LABEL: Record<KnowledgeGraphEdge["kind"], string> = {
  link: "リンク",
  backlink: "バックリンク",
  parent: "親ページ",
  child: "子ページ",
  tag: "共通タグ",
  attachment: "添付",
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clusterGardenTheme(clusterId: string) {
  // Deterministic theme: no persisted or runtime-random work is needed while panning.
  return ["violet", "mint", "amber", "sky", "rose"][stableHash(clusterId) % 5];
}

function gardenAccentCount(clusterSize: number) {
  // Decorative elements are strictly bounded, so a large graph does not inflate the SVG tree.
  return Math.min(4, Math.max(1, Math.floor(clusterSize / 4)));
}


const COSMIC_STAR_POINTS = Array.from({ length: 64 }, (_, index) => {
  const seed = stableHash(`knowledge-universe:${index}`);
  return {
    id: index,
    x: 18 + (seed % 1160),
    y: 16 + (Math.floor(seed / 37) % 728),
    r: 0.7 + ((seed >> 9) % 3) * 0.35,
    opacity: 0.22 + ((seed >> 17) % 5) * 0.11,
  };
});

function visualModeDescription(mode: VisualMode) {
  if (mode === "garden") return "資料の島をやわらかな庭園風に表示します。関係や配置は変わりません。";
  if (mode === "universe") return "資料の島を星系として表示します。索引の再取得やAI処理は行いません。";
  return "通常の関係図です。資料のつながりを最も見やすく表示します。";
}

function edgeIdealDistance(edge: KnowledgeGraphEdge) {
  // 根拠が強いほど短く、タグの共通性は補助的な関係として少し離す。
  if (edge.kind === "link" || edge.kind === "backlink") return 145;
  if (edge.kind === "parent" || edge.kind === "child") return 175;
  if (edge.kind === "attachment") return 115;
  return 235;
}

function edgeTraversalCost(edge: KnowledgeGraphEdge) {
  // 中心ページからの配置で、直接リンクを最も近く、タグを最も遠く扱う。
  if (edge.kind === "link" || edge.kind === "backlink") return 1;
  if (edge.kind === "parent" || edge.kind === "child") return 1.25;
  return 1.75;
}

function initialLayout(graph: KnowledgeGraphResult): NodePosition {
  const center = graph.nodes.find((node) => node.isCenter);
  const positions: NodePosition = {};
  if (!graph.nodes.length) return positions;

  const nodeIds = graph.nodes.map((node) => node.id);
  const adjacency = new Map<string, KnowledgeGraphEdge[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) || []), edge]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) || []), edge]);
  }

  // Dijkstraで中心からの関係距離を求め、強い関係ほど中心に寄せる。
  const distance = new Map<string, number>();
  if (center) {
    distance.set(center.id, 0);
    const queue = new Set<string>([center.id]);
    while (queue.size) {
      let currentId = "";
      let currentDistance = Number.POSITIVE_INFINITY;
      for (const id of queue) {
        const candidate = distance.get(id) ?? Number.POSITIVE_INFINITY;
        if (candidate < currentDistance) {
          currentId = id;
          currentDistance = candidate;
        }
      }
      queue.delete(currentId);
      for (const edge of adjacency.get(currentId) || []) {
        const nextId = edge.source === currentId ? edge.target : edge.source;
        const nextDistance = currentDistance + edgeTraversalCost(edge);
        if (nextDistance < (distance.get(nextId) ?? Number.POSITIVE_INFINITY)) {
          distance.set(nextId, nextDistance);
          queue.add(nextId);
        }
      }
    }
  }

  const byDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    byDegree.set(edge.source, (byDegree.get(edge.source) || 0) + 1);
    byDegree.set(edge.target, (byDegree.get(edge.target) || 0) + 1);
  }
  const nodes = graph.nodes
    .filter((node) => node.id !== center?.id)
    .sort((a, b) =>
      (distance.get(a.id) ?? 99) - (distance.get(b.id) ?? 99) ||
      (byDegree.get(b.id) || 0) - (byDegree.get(a.id) || 0) ||
      a.title.localeCompare(b.title, "ja"),
    );

  if (center) positions[center.id] = { x: 0, y: 0 };
  nodes.forEach((node, index) => {
    const seed = stableHash(node.id);
    const angle =
      (index / Math.max(nodes.length, 1)) * Math.PI * 2 +
      ((seed % 360) * Math.PI) / 1800;
    const graphDistance = distance.get(node.id) ?? 3;
    const radius = 115 + graphDistance * 125 + (seed % 22);
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  // 少数回の安定した力学緩和で、直接つながるノードを近づけ、重なりを避ける。
  // 初期化・「配置を整える」時だけ実行し、クリックや選択中に配置は変えない。
  const movable = nodeIds.filter((id) => id !== center?.id);
  const iterations = graph.nodes.length > 180 ? 28 : 46;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const delta: NodePosition = Object.fromEntries(
      movable.map((id) => [id, { x: 0, y: 0 }]),
    );
    for (let left = 0; left < nodeIds.length; left += 1) {
      for (let right = left + 1; right < nodeIds.length; right += 1) {
        const aId = nodeIds[left];
        const bId = nodeIds[right];
        const a = positions[aId];
        const b = positions[bId];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const squared = Math.max(dx * dx + dy * dy, 1);
        const length = Math.sqrt(squared);
        const repulsion = Math.min(28, 7800 / squared);
        const ux = dx / length;
        const uy = dy / length;
        if (delta[aId]) {
          delta[aId].x -= ux * repulsion;
          delta[aId].y -= uy * repulsion;
        }
        if (delta[bId]) {
          delta[bId].x += ux * repulsion;
          delta[bId].y += uy * repulsion;
        }
      }
    }
    for (const edge of graph.edges) {
      const a = positions[edge.source];
      const b = positions[edge.target];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(Math.hypot(dx, dy), 1);
      const target = edgeIdealDistance(edge);
      const pull = Math.max(-18, Math.min(18, (length - target) * 0.045));
      const ux = dx / length;
      const uy = dy / length;
      if (delta[edge.source]) {
        delta[edge.source].x += ux * pull;
        delta[edge.source].y += uy * pull;
      }
      if (delta[edge.target]) {
        delta[edge.target].x -= ux * pull;
        delta[edge.target].y -= uy * pull;
      }
    }
    for (const id of movable) {
      positions[id] = {
        x: positions[id].x + delta[id].x,
        y: positions[id].y + delta[id].y,
      };
    }
  }
  return positions;
}

function nodeClass(node: KnowledgeGraphNode) {
  if (node.isCenter) return "knowledge-map-node is-center";
  return `knowledge-map-node type-${node.type}`;
}

function edgeClass(edge: KnowledgeGraphEdge) {
  return `knowledge-map-edge kind-${edge.kind}`;
}


function loadMiniMapPosition(): Point | null {
  try {
    const value = JSON.parse(localStorage.getItem(MINIMAP_POSITION_KEY) || "null");
    if (!value || typeof value !== "object") return null;
    const x = Number((value as Point).x);
    const y = Number((value as Point).y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  } catch {
    return null;
  }
}

function loadLayout(pageId: string): NodePosition | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(`${STORAGE_PREFIX}${pageId}`) || "null",
    );
    if (!value || typeof value !== "object") return null;
    return value as NodePosition;
  } catch {
    return null;
  }
}

function loadFixedNodes(pageId: string): Record<string, boolean> {
  try {
    const value = JSON.parse(
      localStorage.getItem(`${FIXED_NODES_PREFIX}${pageId}`) || "{}",
    );
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, fixed]) => fixed === true),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function loadSavedViews(): SavedMapView[] {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((view): view is SavedMapView =>
      Boolean(
        view &&
          typeof view.name === "string" &&
          (view.scope === "local" || view.scope === "global"),
      ),
    );
  } catch {
    return [];
  }
}

function saveSavedViews(views: SavedMapView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, 24)));
  } catch {
    /* local-only preference */
  }
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase("ja-JP");
}

function collectFocusedIds(
  edges: KnowledgeGraphEdge[],
  startId: string | null,
  depth: number,
) {
  if (!startId) return null;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const from = adjacency.get(edge.source) || [];
    from.push(edge.target);
    adjacency.set(edge.source, from);
    const to = adjacency.get(edge.target) || [];
    to.push(edge.source);
    adjacency.set(edge.target, to);
  }
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return visited;
}

function findShortestPath(
  edges: KnowledgeGraphEdge[],
  startId: string | null,
  endId: string | null,
) {
  if (!startId || !endId || startId === endId)
    return { nodeIds: new Set<string>(), edgeIds: new Set<string>() };
  const adjacency = new Map<string, Array<{ id: string; edgeId: string }>>();
  for (const edge of edges) {
    const from = adjacency.get(edge.source) || [];
    from.push({ id: edge.target, edgeId: edge.id });
    adjacency.set(edge.source, from);
    const to = adjacency.get(edge.target) || [];
    to.push({ id: edge.source, edgeId: edge.id });
    adjacency.set(edge.target, to);
  }
  const queue = [startId];
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const visited = new Set<string>([startId]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === endId) break;
    for (const next of adjacency.get(current) || [])
      if (!visited.has(next.id)) {
        visited.add(next.id);
        previous.set(next.id, { nodeId: current, edgeId: next.edgeId });
        queue.push(next.id);
      }
  }
  if (!visited.has(endId))
    return { nodeIds: new Set<string>(), edgeIds: new Set<string>() };
  const nodeIds = new Set<string>([endId]);
  const edgeIds = new Set<string>();
  let cursor = endId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) break;
    edgeIds.add(step.edgeId);
    nodeIds.add(step.nodeId);
    cursor = step.nodeId;
  }
  return { nodeIds, edgeIds };
}


type ClusterInfo = { id: string; nodeIds: Set<string>; label: string; size: number };
type ClusterSuggestion = { name: string; reason: string };
type HealthAssessment = { score: number; label: string; reasons: string[] };
type GraphComparison = {
  sharedTags: KnowledgeGraphNode[];
  sharedNeighbors: KnowledgeGraphNode[];
  leftOnly: KnowledgeGraphNode[];
  rightOnly: KnowledgeGraphNode[];
};

function getClusterSuggestions(
  cluster: ClusterInfo,
  nodesById: Map<string, KnowledgeGraphNode>,
  edges: KnowledgeGraphEdge[],
): ClusterSuggestion[] {
  const tagCounts = new Map<string, number>();
  const parentTitles = new Map<string, number>();
  for (const edge of edges) {
    const sourceIn = cluster.nodeIds.has(edge.source);
    const targetIn = cluster.nodeIds.has(edge.target);
    if (!sourceIn && !targetIn) continue;
    if (edge.kind === "tag") {
      const tagId = edge.source.startsWith("tag:") ? edge.source : edge.target.startsWith("tag:") ? edge.target : null;
      const contentId = tagId === edge.source ? edge.target : edge.source;
      if (tagId && cluster.nodeIds.has(contentId)) {
        const title = (nodesById.get(tagId)?.title || tagId.replace(/^tag:/, "")).replace(/^#/, "");
        tagCounts.set(title, (tagCounts.get(title) || 0) + 1);
      }
    }
    if ((edge.kind === "parent" || edge.kind === "child") && sourceIn && targetIn) {
      const parentId = edge.kind === "parent" ? edge.target : edge.source;
      const parentTitle = nodesById.get(parentId)?.title;
      if (parentTitle) parentTitles.set(parentTitle, (parentTitles.get(parentTitle) || 0) + 1);
    }
  }
  const candidates: ClusterSuggestion[] = [];
  for (const [name, count] of Array.from(tagCounts.entries()).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 3)) {
    candidates.push({ name, reason: `共通タグ ${count}件` });
  }
  for (const [name, count] of Array.from(parentTitles.entries()).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 2)) {
    if (!candidates.some((candidate) => candidate.name === name)) candidates.push({ name, reason: `親子関係 ${count}件` });
  }
  const firstTitle = Array.from(cluster.nodeIds).map((id) => nodesById.get(id)?.title).find(Boolean);
  if (firstTitle && !candidates.some((candidate) => candidate.name === firstTitle)) candidates.push({ name: `${firstTitle} 関連`, reason: "代表資料名" });
  return candidates.slice(0, 4);
}

function assessNodeHealth(node: KnowledgeGraphNode, degree: number): HealthAssessment {
  if (node.type === "tag") return { score: 0, label: "対象外", reasons: [] };
  const reasons: string[] = [];
  let score = 0;
  const updated = node.updatedAt ? new Date(node.updatedAt).getTime() : Number.NaN;
  const ageDays = Number.isFinite(updated) ? (Date.now() - updated) / 86400000 : null;
  if (degree === 0) { score += 55; reasons.push("関係がありません"); }
  if (!node.updatedAt || !Number.isFinite(updated)) { score += 10; reasons.push("更新日が不明です"); }
  if (degree >= 4 && ageDays !== null && ageDays >= 365) { score += 35; reasons.push("参照が多いのに1年以上更新されていません"); }
  if (degree <= 1 && ageDays !== null && ageDays >= 730) { score += 15; reasons.push("長期間更新されていません"); }
  if (score >= 60) return { score, label: "要確認", reasons };
  if (score >= 25) return { score, label: "見直し候補", reasons };
  return { score, label: "良好", reasons };
}

function compareGraphNodes(
  edges: KnowledgeGraphEdge[],
  nodeById: Map<string, KnowledgeGraphNode>,
  leftId: string | null,
  rightId: string | null,
): GraphComparison | null {
  if (!leftId || !rightId || leftId === rightId) return null;
  const neighbors = (id: string) => {
    const set = new Set<string>();
    const tags = new Set<string>();
    for (const edge of edges) {
      if (edge.source !== id && edge.target !== id) continue;
      const other = edge.source === id ? edge.target : edge.source;
      if (other.startsWith("tag:")) tags.add(other); else set.add(other);
    }
    return { set, tags };
  };
  const left = neighbors(leftId); const right = neighbors(rightId);
  const asNodes = (ids: Iterable<string>) => Array.from(ids).map((id) => nodeById.get(id)).filter(Boolean) as KnowledgeGraphNode[];
  const sharedNeighbors = asNodes(Array.from(left.set).filter((id) => right.set.has(id))).slice(0, 8);
  const sharedTags = asNodes(Array.from(left.tags).filter((id) => right.tags.has(id))).slice(0, 8);
  const leftOnly = asNodes(Array.from(left.set).filter((id) => !right.set.has(id))).slice(0, 6);
  const rightOnly = asNodes(Array.from(right.set).filter((id) => !left.set.has(id))).slice(0, 6);
  return { sharedTags, sharedNeighbors, leftOnly, rightOnly };
}

function buildClusters(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]): ClusterInfo[] {
  const content = nodes.filter((node) => node.type !== "tag");
  const contentIds = new Set(content.map((node) => node.id));
  const parent = new Map(content.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    const root = parent.get(id) || id;
    if (root === id) return root;
    const next = find(root);
    parent.set(id, next);
    return next;
  };
  const join = (a: string, b: string) => {
    if (!contentIds.has(a) || !contentIds.has(b)) return;
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  // Direct and hierarchy edges define durable work clusters. Small tag groups may join them,
  // while high-cardinality tags are intentionally not allowed to merge the entire map.
  for (const edge of edges) {
    if (edge.kind !== "tag") join(edge.source, edge.target);
  }
  const tagMembers = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "tag") continue;
    const contentId = contentIds.has(edge.source) ? edge.source : contentIds.has(edge.target) ? edge.target : null;
    const tagId = edge.source.startsWith("tag:") ? edge.source : edge.target.startsWith("tag:") ? edge.target : null;
    if (!contentId || !tagId) continue;
    const members = tagMembers.get(tagId) || [];
    members.push(contentId);
    tagMembers.set(tagId, members);
  }
  for (const members of tagMembers.values()) {
    if (members.length < 2 || members.length > 12) continue;
    for (let index = 1; index < members.length; index += 1) join(members[0], members[index]);
  }
  const groups = new Map<string, string[]>();
  for (const node of content) {
    const root = find(node.id);
    const members = groups.get(root) || [];
    members.push(node.id);
    groups.set(root, members);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const clusterTagLabels = new Map<string, string[]>();
  for (const [tagId, members] of tagMembers) {
    const title = nodeById.get(tagId)?.title || tagId.replace(/^tag:/, "#");
    for (const member of members) {
      const groupId = find(member);
      const labels = clusterTagLabels.get(groupId) || [];
      if (!labels.includes(title)) labels.push(title);
      clusterTagLabels.set(groupId, labels);
    }
  }
  return Array.from(groups.entries())
    .filter(([, members]) => members.length >= 3)
    .map(([id, members]) => ({
      id,
      nodeIds: new Set(members),
      label: (clusterTagLabels.get(id) || ["関連資料"])[0],
      size: members.length,
    }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);
}

function nodeVisualMeta(node: KnowledgeGraphNode, degree: number) {
  const updated = node.updatedAt ? new Date(node.updatedAt).getTime() : Number.NaN;
  const ageDays = Number.isFinite(updated) ? (Date.now() - updated) / 86400000 : null;
  return {
    degree,
    isHub: !node.isCenter && node.type !== "tag" && degree >= 5,
    isIsolated: node.type !== "tag" && degree === 0,
    isRecent: node.type !== "tag" && ageDays !== null && ageDays <= 14,
    isStaleHub: !node.isCenter && node.type !== "tag" && degree >= 4 && ageDays !== null && ageDays >= 365,
  };
}

function relationStrength(edge: KnowledgeGraphEdge) {
  if (edge.kind === "link" || edge.kind === "backlink") return "strength-high";
  if (edge.kind === "parent" || edge.kind === "child") return "strength-medium";
  return "strength-low";
}

function timeRangeToDays(range: TimeRange) {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  if (range === "90d") return 90;
  if (range === "365d") return 365;
  return null;
}

function isNodeWithinTimeRange(node: KnowledgeGraphNode, range: TimeRange) {
  const days = timeRangeToDays(range);
  if (!days || node.type === "tag" || !node.updatedAt) return true;
  const updatedAt = new Date(node.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return true;
  return updatedAt >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function relationEvidence(
  edge: KnowledgeGraphEdge,
  source: KnowledgeGraphNode | undefined,
  target: KnowledgeGraphNode | undefined,
) {
  const sourceTitle = source?.title || "この項目";
  const targetTitle = target?.title || "この項目";
  if (edge.kind === "link")
    return `「${sourceTitle}」から「${targetTitle}」への${edge.label || "直接リンク"}です。`;
  if (edge.kind === "backlink")
    return `「${sourceTitle}」が「${targetTitle}」を参照しているバックリンクです。`;
  if (edge.kind === "parent")
    return `「${sourceTitle}」は「${targetTitle}」の親ページです。`;
  if (edge.kind === "child")
    return `「${targetTitle}」は「${sourceTitle}」の子ページです。`;
  return `「${sourceTitle}」と「${targetTitle}」は共通タグ「${target?.tag || source?.tag || edge.label || "タグ"}」でつながっています。`;
}

export function KnowledgeMapScreen({
  api,
  pageId,
  onOpenPage,
  onOpenDatabaseRow,
  onBack,
}: Props) {
  const [graph, setGraph] = useState<KnowledgeGraphResult | null>(null);
  const [scope, setScope] = useState<KnowledgeGraphScope>("local");
  const [globalExpansion, setGlobalExpansion] = useState<"pages" | "database_rows" | "attachments" | "journals">("pages");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<RelationFilter>(DEFAULT_FILTERS);
  const [positions, setPositions] = useState<NodePosition>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [fixedNodes, setFixedNodes] = useState<Record<string, boolean>>({});
  const [pathStartId, setPathStartId] = useState<string | null>(null);
  const [focusEnabled, setFocusEnabled] = useState(false);
  const [focusDepth, setFocusDepth] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [organizeParentId, setOrganizeParentId] = useState<string | null>(null);
  const [organizeBusy, setOrganizeBusy] = useState(false);
  const [organizeMessage, setOrganizeMessage] = useState("");
  const [clusterNames, setClusterNames] = useState<Record<string, string>>({});
  const [collapsedClusterIds, setCollapsedClusterIds] = useState<Record<string, boolean>>({});
  const [showHealthPanel, setShowHealthPanel] = useState(true);
  const [showMapGuide, setShowMapGuide] = useState(false);
  const [visualMode, setVisualMode] = useState<VisualMode>("standard");
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [shelfNodeId, setShelfNodeId] = useState<string | null>(null);
  const [miniMapPosition, setMiniMapPosition] = useState<Point | null>(() =>
    loadMiniMapPosition(),
  );
  const [savedViews, setSavedViews] = useState<SavedMapView[]>(() =>
    loadSavedViews(),
  );
  const graphRequestRef = useRef(0);
  const moveFrameRef = useRef<number | null>(null);
  const pendingNodeMoveRef = useRef<{ nodeId: string; point: Point } | null>(null);
  const pendingPanRef = useRef<Point | null>(null);
  const pointerStart = useRef<{ x: number; y: number; pan: Point } | null>(
    null,
  );
  const nodePointerStart = useRef<{
    nodeId: string;
    x: number;
    y: number;
    point: Point;
    moved: boolean;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const miniMapRef = useRef<HTMLDivElement | null>(null);
  const miniMapDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    canvasWidth: number;
    canvasHeight: number;
    mapWidth: number;
    mapHeight: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (!api || !pageId) return;
    const requestId = ++graphRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const next =
        scope === "global"
          ? await api.getGlobalKnowledgeGraph(320, globalExpansion)
          : await api.getLocalKnowledgeGraph(pageId, 80);
      // 範囲切替や再試行が重なった場合、古い通信結果で新しい地図を上書きしない。
      if (requestId !== graphRequestRef.current) return;
      setGraph(next);
      const persisted = loadLayout(`${scope}:${pageId}`);
      setFixedNodes(loadFixedNodes(`${scope}:${pageId}`));
      try {
        setClusterNames(JSON.parse(localStorage.getItem(`${CLUSTER_NAMES_PREFIX}${scope}:${pageId}`) || "{}"));
        setCollapsedClusterIds(JSON.parse(localStorage.getItem(`${COLLAPSED_CLUSTERS_PREFIX}${scope}:${pageId}`) || "{}"));
        const storedMode = localStorage.getItem(`${VISUAL_MODE_PREFIX}${scope}:${pageId}`);
        // v700以前の「知識庭園」設定は、そのまま庭園モードとして引き継ぐ。
        setVisualMode(
          storedMode === "standard" || storedMode === "garden" || storedMode === "universe"
            ? storedMode
            : localStorage.getItem(`${GARDEN_MODE_PREFIX}${scope}:${pageId}`) === "1"
              ? "garden"
              : "standard",
        );
      } catch {
        setClusterNames({});
        setCollapsedClusterIds({});
        setVisualMode("standard");
      }
      const base = initialLayout(next);
      setPositions({ ...base, ...(persisted || {}) });
      setSelectedEdgeId(null);
      setSelectedId((current) =>
        current && next.nodes.some((node) => node.id === current)
          ? current
          : next.nodes.find((node) => node.isCenter)?.id ||
            next.nodes[0]?.id ||
            null,
      );
    } catch (cause: unknown) {
      if (requestId !== graphRequestRef.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "関係図を読み込めませんでした。",
      );
      setGraph(null);
    } finally {
      if (requestId === graphRequestRef.current) setLoading(false);
    }
  }, [api, globalExpansion, pageId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // One shared subscription utility keeps debounce/cancellation semantics
  // consistent with other cache consumers. The map only refreshes for changes
  // that can alter its currently visible resource graph.
  useEffect(() => subscribeWorkspaceMutations({
    eventName: "local-notion:workspace-graph-mutated",
    debounceMs: 650,
    accepts: (detail) => {
      if (detail.cacheScopes.length && !detail.cacheScopes.includes("graph")) return false;
      if (scope === "global") return true;
      const pageIds = new Set(detail.pageIds);
      const databaseIds = new Set(detail.databaseIds);
      const databaseRowIds = new Set(detail.databaseRowIds);
      const identitiesUnknown = !pageIds.size && !databaseIds.size && !databaseRowIds.size && !detail.journalDates.length;
      if (identitiesUnknown || pageIds.has(pageId)) return true;
      return (graph?.nodes || []).some((node: any) =>
        (node.pageId && pageIds.has(node.pageId)) ||
        (node.databaseId && databaseIds.has(node.databaseId)) ||
        (node.databaseId && node.rowId && databaseRowIds.has(`${node.databaseId}:${node.rowId}`)),
      );
    },
    onAccepted: () => { void load(); },
  }), [graph, globalExpansion, load, pageId, scope]);

  useEffect(() => {
    if (!timelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimeRange((current) => TIMELINE_STEPS[(TIMELINE_STEPS.indexOf(current) + 1) % TIMELINE_STEPS.length]);
    }, 1300);
    return () => window.clearInterval(timer);
  }, [timelinePlaying]);

  useEffect(() => {
    if (!graph) return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          `${STORAGE_PREFIX}${scope}:${pageId}`,
          JSON.stringify(positions),
        );
      } catch {
        /* local-only preference */
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [graph, pageId, positions, scope]);

  useEffect(() => {
    try {
      localStorage.setItem(
        `${FIXED_NODES_PREFIX}${scope}:${pageId}`,
        JSON.stringify(fixedNodes),
      );
    } catch {
      /* local-only preference */
    }
  }, [fixedNodes, pageId, scope]);

  useEffect(() => {
    try {
      localStorage.setItem(`${CLUSTER_NAMES_PREFIX}${scope}:${pageId}`, JSON.stringify(clusterNames));
      localStorage.setItem(`${COLLAPSED_CLUSTERS_PREFIX}${scope}:${pageId}`, JSON.stringify(collapsedClusterIds));
      localStorage.setItem(`${VISUAL_MODE_PREFIX}${scope}:${pageId}`, visualMode);
      // 旧バージョンへ戻した場合も庭園設定だけは自然に引き継げるよう残す。
      localStorage.setItem(`${GARDEN_MODE_PREFIX}${scope}:${pageId}`, visualMode === "garden" ? "1" : "0");
    } catch {
      /* local-only preference */
    }
  }, [clusterNames, collapsedClusterIds, pageId, scope, visualMode]);

  const exportMapSvg = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
    const url = URL.createObjectURL(new Blob([content], { type: "image/svg+xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scope === "global" ? "knowledge-map" : "page-map"}-${new Date().toISOString().slice(0, 10)}.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [scope]);

  useEffect(() => {
    try {
      if (miniMapPosition)
        localStorage.setItem(MINIMAP_POSITION_KEY, JSON.stringify(miniMapPosition));
      else localStorage.removeItem(MINIMAP_POSITION_KEY);
    } catch {
      /* local-only preference */
    }
  }, [miniMapPosition]);

  const nodeById = useMemo(
    () => new Map((graph?.nodes || []).map((node) => [node.id, node])),
    [graph],
  );
  const visibleEdges = useMemo(
    () => (graph?.edges || []).filter((edge) => filters[edge.kind]),
    [graph, filters],
  );
  const timeEligibleIds = useMemo(() => {
    const eligible = new Set<string>();
    for (const node of graph?.nodes || []) {
      if (node.isCenter || node.id === selectedId || isNodeWithinTimeRange(node, timeRange))
        eligible.add(node.id);
    }
    // タグは、期間内の資料とつながる場合だけ残す。タグ単独で地図を埋めない。
    // Map参照にして、全体マップで edge ごとの nodes.find を避ける。
    for (const edge of visibleEdges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (source?.type === "tag" && eligible.has(edge.target)) eligible.add(source.id);
      if (target?.type === "tag" && eligible.has(edge.source)) eligible.add(target.id);
    }
    return eligible;
  }, [graph, nodeById, selectedId, timeRange, visibleEdges]);
  const timeFilteredEdges = useMemo(
    () =>
      visibleEdges.filter(
        (edge) => timeEligibleIds.has(edge.source) && timeEligibleIds.has(edge.target),
      ),
    [timeEligibleIds, visibleEdges],
  );
  const focusedIds = useMemo(
    () =>
      focusEnabled
        ? collectFocusedIds(timeFilteredEdges, selectedId, focusDepth)
        : null,
    [focusDepth, focusEnabled, selectedId, timeFilteredEdges],
  );
  const displayNodeIds = useMemo(() => {
    const base = new Set<string>();
    for (const edge of timeFilteredEdges) {
      base.add(edge.source);
      base.add(edge.target);
    }
    // 全体マップでは、線がないページも「孤立資料」として表示対象に残す。
    // 以前は線の両端だけを描画していたため、リンク索引が空の環境や
    // 縮退マップでは、候補に含まれるページまで見えなくなっていた。
    // タグは接続がある場合だけ残し、ページ・DB行は期間条件を満たせば表示する。
    for (const node of graph?.nodes || []) {
      const keepAsContent =
        node.type !== "tag" &&
        (node.isCenter ||
          node.id === selectedId ||
          isNodeWithinTimeRange(node, timeRange));
      if (keepAsContent) base.add(node.id);
      if (node.isCenter || node.id === selectedId) base.add(node.id);
    }
    // フォーカス時だけは、選択中ノードから到達できる関係へ明示的に絞り込む。
    if (!focusedIds) return base;
    return new Set(Array.from(base).filter((id) => focusedIds.has(id)));
  }, [focusedIds, graph, selectedId, timeFilteredEdges, timeRange]);
  const displayNodes = useMemo(
    () => (graph?.nodes || []).filter((node) => displayNodeIds.has(node.id)),
    [displayNodeIds, graph],
  );
  const displayEdges = useMemo(
    () =>
      timeFilteredEdges.filter(
        (edge) => displayNodeIds.has(edge.source) && displayNodeIds.has(edge.target),
      ),
    [displayNodeIds, timeFilteredEdges],
  );
  const nodeDegrees = useMemo(() => {
    const next = new Map<string, number>();
    for (const edge of displayEdges) {
      next.set(edge.source, (next.get(edge.source) || 0) + 1);
      next.set(edge.target, (next.get(edge.target) || 0) + 1);
    }
    return next;
  }, [displayEdges]);
  const clusters = useMemo(
    () => buildClusters(displayNodes, displayEdges),
    [displayEdges, displayNodes],
  );
  const clusterSuggestions = useMemo(() => {
    const result = new Map<string, ClusterSuggestion[]>();
    for (const cluster of clusters) result.set(cluster.id, getClusterSuggestions(cluster, nodeById, displayEdges));
    return result;
  }, [clusters, displayEdges, nodeById]);
  const nodeHealth = useMemo(() => {
    const values = new Map<string, HealthAssessment>();
    for (const node of displayNodes) values.set(node.id, assessNodeHealth(node, nodeDegrees.get(node.id) || 0));
    return values;
  }, [displayNodes, nodeDegrees]);
  const clusterBounds = useMemo(() => clusters.map((cluster) => {
    const points = Array.from(cluster.nodeIds)
      .map((id) => positions[id])
      .filter(Boolean) as Point[];
    if (points.length < 3) return null;
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    return { ...cluster, label: clusterNames[cluster.id]?.trim() || cluster.label, x: (minX + maxX) / 2, y: (minY + maxY) / 2, rx: Math.max(70, (maxX - minX) / 2 + 38), ry: Math.max(56, (maxY - minY) / 2 + 34) };
  }).filter(Boolean) as Array<ClusterInfo & { x: number; y: number; rx: number; ry: number }>, [clusters, positions]);

  const collapsedNodeIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const cluster of clusters) {
      if (!collapsedClusterIds[cluster.id]) continue;
      for (const id of cluster.nodeIds) hidden.add(id);
    }
    return hidden;
  }, [clusters, collapsedClusterIds]);
  const healthCandidates = useMemo(() =>
    displayNodes
      .filter((node) => node.type !== "tag")
      .map((node) => ({ node, health: nodeHealth.get(node.id) || assessNodeHealth(node, 0) }))
      .filter(({ health }) => health.score >= 25)
      .sort((a, b) => b.health.score - a.health.score || a.node.title.localeCompare(b.node.title, "ja"))
      .slice(0, 20),
    [displayNodes, nodeHealth],
  );

  const sharedTags = useMemo(() => {
    if (!pathStartId || !selectedId || pathStartId === selectedId) return [] as KnowledgeGraphNode[];
    const first = new Set<string>();
    const second = new Set<string>();
    for (const edge of displayEdges) {
      const tagId = edge.source.startsWith("tag:") ? edge.source : edge.target.startsWith("tag:") ? edge.target : null;
      if (!tagId) continue;
      const other = edge.source === tagId ? edge.target : edge.source;
      if (other === pathStartId) first.add(tagId);
      if (other === selectedId) second.add(tagId);
    }
    return Array.from(first).filter((id) => second.has(id)).map((id) => nodeById.get(id)).filter(Boolean) as KnowledgeGraphNode[];
  }, [displayEdges, nodeById, pathStartId, selectedId]);

  const path = useMemo(
    () => findShortestPath(displayEdges, pathStartId, selectedId),
    [displayEdges, pathStartId, selectedId],
  );
  const comparison = useMemo(
    () => compareGraphNodes(displayEdges, nodeById, pathStartId, selectedId),
    [displayEdges, nodeById, pathStartId, selectedId],
  );

  const connectedIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set<string>([selectedId]);
    for (const edge of displayEdges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [displayEdges, selectedId]);
  const selected = graph?.nodes.find((node) => node.id === selectedId) || null;
  const selectedEdge = useMemo(
    () => displayEdges.find((edge) => edge.id === selectedEdgeId) || null,
    [displayEdges, selectedEdgeId],
  );
  const displayedRecentCount = useMemo(
    () => displayNodes.filter((node) => node.type !== "tag" && isNodeWithinTimeRange(node, timeRange)).length,
    [displayNodes, timeRange],
  );
  const isolatedNodeCount = useMemo(() => {
    const connected = new Set<string>();
    for (const edge of displayEdges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    return displayNodes.filter((node) => node.type !== "tag" && !connected.has(node.id)).length;
  }, [displayEdges, displayNodes]);
  const selectedRelations = useMemo(() => {
    if (!selectedId || !graph)
      return [] as Array<{
        edge: KnowledgeGraphEdge;
        node: KnowledgeGraphNode;
      }>;
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    return displayEdges
      .filter(
        (edge) => edge.source === selectedId || edge.target === selectedId,
      )
      .map((edge) => ({
        edge,
        node: nodes.get(edge.source === selectedId ? edge.target : edge.source),
      }))
      .filter(
        (
          value,
        ): value is { edge: KnowledgeGraphEdge; node: KnowledgeGraphNode } =>
          Boolean(value.node),
      )
      .sort((a, b) => a.node.title.localeCompare(b.node.title, "ja"));
  }, [displayEdges, graph, selectedId]);
  const normalizedQuery = useMemo(
    () => normalizeSearch(searchQuery),
    [searchQuery],
  );
  const searchMatchIds = useMemo(() => {
    if (!normalizedQuery) return new Set<string>();
    return new Set(
      (graph?.nodes || [])
        .filter((node) =>
          `${node.title} ${node.tag || ""}`
            .toLocaleLowerCase("ja-JP")
            .includes(normalizedQuery),
        )
        .map((node) => node.id),
    );
  }, [graph, normalizedQuery]);
  const searchMatchCount = searchMatchIds.size;

  const toMapPoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: (clientX - rect.left - rect.width / 2 - pan.x) / zoom,
        y: (clientY - rect.top - rect.height / 2 - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  const flushMapMove = useCallback(() => {
    moveFrameRef.current = null;
    const nodeMove = pendingNodeMoveRef.current;
    const nextPan = pendingPanRef.current;
    pendingNodeMoveRef.current = null;
    pendingPanRef.current = null;
    if (nodeMove) {
      setPositions((current) => ({ ...current, [nodeMove.nodeId]: nodeMove.point }));
    }
    if (nextPan) setPan(nextPan);
  }, []);

  const scheduleMapMove = useCallback(() => {
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = window.requestAnimationFrame(flushMapMove);
  }, [flushMapMove]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const candidate = nodePointerStart.current;
      if (candidate && !fixedNodes[candidate.nodeId]) {
        const delta = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
        if (!candidate.moved && delta >= DRAG_THRESHOLD) {
          candidate.moved = true;
          setDraggingNode(candidate.nodeId);
        }
        if (candidate.moved) {
          const point = toMapPoint(event.clientX, event.clientY);
          if (point) {
            pendingNodeMoveRef.current = { nodeId: candidate.nodeId, point };
            scheduleMapMove();
          }
        }
        return;
      }
      if (panning && pointerStart.current) {
        pendingPanRef.current = {
          x: pointerStart.current.pan.x + event.clientX - pointerStart.current.x,
          y: pointerStart.current.pan.y + event.clientY - pointerStart.current.y,
        };
        scheduleMapMove();
      }
    },
    [fixedNodes, panning, scheduleMapMove, toMapPoint],
  );

  useEffect(() => () => {
    if (moveFrameRef.current !== null) window.cancelAnimationFrame(moveFrameRef.current);
  }, []);

  const toggleFixedNode = useCallback((nodeId: string) => {
    setFixedNodes((current) => ({ ...current, [nodeId]: !current[nodeId] }));
  }, []);

  const arrangeUnfixedNodes = useCallback(() => {
    if (!graph) return;
    const base = initialLayout(graph);
    setPositions((current) => {
      const next = { ...base };
      for (const [id, point] of Object.entries(current) as Array<[string, Point]>)
        if (fixedNodes[id]) next[id] = point;
      return next;
    });
  }, [fixedNodes, graph]);

  const beginMiniMapDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const canvas = svgRef.current?.parentElement;
      const miniMap = miniMapRef.current;
      if (!canvas || !miniMap) return;
      const canvasRect = canvas.getBoundingClientRect();
      const miniMapRect = miniMap.getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      miniMapDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: miniMapRect.left - canvasRect.left,
        startY: miniMapRect.top - canvasRect.top,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        mapWidth: miniMapRect.width,
        mapHeight: miniMapRect.height,
      };
    },
    [],
  );

  const moveMiniMap = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = miniMapDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const maxX = Math.max(MINIMAP_MARGIN, drag.canvasWidth - drag.mapWidth - MINIMAP_MARGIN);
      const maxY = Math.max(MINIMAP_MARGIN, drag.canvasHeight - drag.mapHeight - MINIMAP_MARGIN);
      setMiniMapPosition({
        x: Math.max(MINIMAP_MARGIN, Math.min(maxX, drag.startX + event.clientX - drag.startClientX)),
        y: Math.max(MINIMAP_MARGIN, Math.min(maxY, drag.startY + event.clientY - drag.startClientY)),
      });
    },
    [],
  );

  const endMiniMapDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (miniMapDragRef.current?.pointerId === event.pointerId) {
        miniMapDragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    },
    [],
  );

  const recenterFromMiniMap = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect || !displayNodes.length) return;
      const points = displayNodes
        .map((node) => positions[node.id])
        .filter(Boolean) as Point[];
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxY = Math.max(...points.map((point) => point.y));
      const x =
        ((event.clientX - rect.left) / rect.width) * (maxX - minX || 1) + minX;
      const y =
        ((event.clientY - rect.top) / rect.height) * (maxY - minY || 1) + minY;
      setPan({ x: -x * zoom, y: -y * zoom });
    },
    [displayNodes, positions, zoom],
  );

  const openSelected = useCallback(() => {
    if (!selected) return;
    if (selected.type === "page" && selected.pageId)
      onOpenPage(selected.pageId);
    if (
      selected.type === "database-row" &&
      selected.databaseId &&
      selected.rowId
    )
      onOpenDatabaseRow(selected.databaseId, selected.rowId);
  }, [onOpenDatabaseRow, onOpenPage, selected]);

  const moveSelectedUnderOrganizeParent = useCallback(async () => {
    if (!api || !selected || selected.type !== "page" || !selected.pageId || !organizeParentId) return;
    const parent = nodeById.get(organizeParentId);
    if (!parent || parent.type !== "page" || !parent.pageId || parent.id === selected.id) return;
    if (!window.confirm(`「${selected.title}」を「${parent.title}」の子ページへ移動します。`)) return;
    setOrganizeBusy(true);
    setOrganizeMessage("");
    try {
      await api.movePage(selected.pageId, parent.pageId);
      setOrganizeMessage("親子関係を更新しました。関係図を再読み込みしています。");
      setOrganizeParentId(null);
      await load();
    } catch (cause: unknown) {
      setOrganizeMessage(cause instanceof Error ? cause.message : "ページの整理に失敗しました。");
    } finally {
      setOrganizeBusy(false);
    }
  }, [api, load, nodeById, organizeParentId, selected]);

  const createChildFromSelected = useCallback(async (summary = false) => {
    if (!api || !selected || selected.type !== "page" || !selected.pageId) return;
    const defaultTitle = summary ? `${selected.title} 関連資料まとめ` : "新しい子ページ";
    const title = window.prompt(summary ? "まとめページの名前" : "子ページの名前", defaultTitle)?.trim();
    if (!title) return;
    setCreateBusy(true); setCreateMessage("");
    try {
      const created = await api.createPage(title, selected.pageId);
      setCreateMessage(summary ? "まとめページを作成しました。" : "子ページを作成しました。");
      await load();
      onOpenPage(created.meta.id);
    } catch (cause: unknown) {
      setCreateMessage(cause instanceof Error ? cause.message : "ページを作成できませんでした。");
    } finally { setCreateBusy(false); }
  }, [api, load, onOpenPage, selected]);

  const resetLayout = useCallback(() => {
    if (!graph) return;
    setPositions(initialLayout(graph));
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPathStartId(null);
    setSelectedEdgeId(null);
    setCollapsedClusterIds({});
  }, [graph]);

  const saveCurrentView = useCallback(() => {
    const raw = window.prompt(
      "保存するビュー名",
      scope === "local" ? "現在ページの関係図" : "全体ナレッジマップ",
    );
    const name = raw?.trim();
    if (!name) return;
    const view: SavedMapView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      scope,
      filters: { ...filters },
      zoom,
      pan: { ...pan },
      focusEnabled,
      focusDepth,
      searchQuery,
      selectedId,
      visualMode,
      createdAt: new Date().toISOString(),
    };
    setSavedViews((current) => {
      const next = [
        view,
        ...current.filter((item) => item.name !== view.name),
      ].slice(0, 24);
      saveSavedViews(next);
      return next;
    });
  }, [
    filters,
    focusDepth,
    focusEnabled,
    pan,
    scope,
    searchQuery,
    selectedId,
    visualMode,
    zoom,
  ]);

  const applySavedView = useCallback(
    (id: string) => {
      const view = savedViews.find((item) => item.id === id);
      if (!view) return;
      setScope(view.scope);
      setFilters({ ...view.filters });
      setZoom(view.zoom);
      setPan({ ...view.pan });
      setFocusEnabled(view.focusEnabled);
      setFocusDepth(view.focusDepth);
      setSearchQuery(view.searchQuery || "");
      setSelectedId(view.selectedId);
      setVisualMode(view.visualMode || "standard");
    },
    [savedViews],
  );

  const deleteSavedView = useCallback((id: string) => {
    setSavedViews((current) => {
      const next = current.filter((view) => view.id !== id);
      saveSavedViews(next);
      return next;
    });
  }, []);

  return (
    <section className={`knowledge-map-screen-v638 knowledge-map-screen-v640 is-visual-${visualMode}`}>
      <header className="knowledge-map-header-v638">
        <div>
          <span className="knowledge-map-eyebrow-v638">
            {visualMode === "universe"
              ? "KNOWLEDGE UNIVERSE"
              : scope === "global"
                ? "WORKSPACE KNOWLEDGE MAP"
                : "LOCAL KNOWLEDGE MAP"}
          </span>
          <h1>{visualMode === "universe" ? "知識宇宙" : scope === "global" ? "全体ナレッジマップ" : "ページ関係図"}</h1>
          <p>
            {visualMode === "universe"
              ? "ページ・タグ・資料のつながりを星と星系として探索します。表示だけを切り替えるため、索引の再取得やAI処理は増えません。"
              : scope === "global"
                ? "リンク索引をもとに、関係が多いページと共通タグを星座のように表示します。検索・フォーカス・保存ビューで、必要な資料群だけを追えます。"
                : "現在のページを中心に、リンク・バックリンク・親子・タグ・DB行を星座のように表示します。本文やOCRを全件走査せず、既存のSQLite索引だけで生成します。"}
          </p>
        </div>
        <div className="knowledge-map-actions-v638">
          <div
            className="knowledge-map-mode-switch-v639"
            role="group"
            aria-label="関係図の範囲"
          >
            <button
              className={scope === "local" ? "is-active" : ""}
              onClick={() => setScope("local")}
            >
              現在のページ
            </button>
            <button
              className={scope === "global" ? "is-active" : ""}
              onClick={() => setScope("global")}
            >
              全体マップ
            </button>
          </div>
          {scope === "global" && (
            <label className="knowledge-map-expansion-v655" title="必要な対象だけ追加して、全体図の負荷を抑えます。">
              <span>展開</span>
              <select value={globalExpansion} onChange={(event) => setGlobalExpansion(event.target.value as typeof globalExpansion)}>
                <option value="pages">ページ中心</option>
                <option value="database_rows">DB行を展開</option>
                <option value="attachments">添付を展開</option>
                <option value="journals">Journalを展開</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className={`secondary knowledge-map-guide-toggle-v642 ${showMapGuide ? "is-active" : ""}`}
            onClick={() => setShowMapGuide((current) => !current)}
            aria-expanded={showMapGuide}
            aria-controls="knowledge-map-operation-guide"
          >
            ? 操作ガイド
          </button>
          <button className="secondary" onClick={onBack}>
            戻る
          </button>
          <button onClick={() => void load()} disabled={loading}>
            ↻ 更新
          </button>
        </div>
      </header>

      <div className="knowledge-map-searchbar-v640">
        <label>
          <span>⌕</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="地図内を検索（タイトル・タグ）"
          />
          {searchQuery && (
            <button
              type="button"
              className="knowledge-map-search-clear-v640"
              onClick={() => setSearchQuery("")}
            >
              ×
            </button>
          )}
        </label>
        {normalizedQuery && (
          <span>
            {searchMatchCount
              ? `${searchMatchCount}件を強調表示`
              : "一致する項目はありません"}
          </span>
        )}
      </div>

      {showMapGuide && (
        <section
          id="knowledge-map-operation-guide"
          className="knowledge-map-guide-v642"
          aria-label="関係図の操作ガイド"
        >
          <div>
            <span>選択</span>
            <b>ノードをクリック</b>
            <small>右側に概要と関係先を表示します。</small>
          </div>
          <div>
            <span>移動</span>
            <b>背景をドラッグ</b>
            <small>地図全体の位置を動かします。</small>
          </div>
          <div>
            <span>配置</span>
            <b>7px以上ドラッグ</b>
            <small>ノードの位置だけを変更します。</small>
          </div>
          <div>
            <span>開く</span>
            <b>ノードをダブルクリック</b>
            <small>ページまたはDB行を開きます。</small>
          </div>
          <div>
            <span>線の根拠</span>
            <b>関係線をクリック</b>
            <small>リンク・親子・タグなど、つながる理由を表示します。</small>
          </div>
          <div>
            <span>拡大・縮小</span>
            <b>マウスホイール</b>
            <small>右下のミニマップで表示位置も移せます。</small>
          </div>
        </section>
      )}

      <div className="knowledge-map-layout-v638">
        <aside className="knowledge-map-filter-v638">
          <section>
            <span className="knowledge-map-section-label-v638">
              表示する関係
            </span>
            {(Object.keys(DEFAULT_FILTERS) as KnowledgeGraphEdge["kind"][]).map(
              (kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={filters[kind]}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        [kind]: event.target.checked,
                      }))
                    }
                  />
                  <i className={`knowledge-map-legend-line kind-${kind}`} />
                  <span>{KIND_LABEL[kind]}</span>
                </label>
              ),
            )}
          </section>
          <section className="knowledge-map-focus-v640">
            <span className="knowledge-map-section-label-v638">フォーカス</span>
            <label>
              <input
                type="checkbox"
                checked={focusEnabled}
                disabled={!selectedId}
                onChange={(event) => setFocusEnabled(event.target.checked)}
              />
              <span>選択中の項目に絞る</span>
            </label>
            <div
              className="knowledge-map-focus-depth-v640"
              aria-disabled={!focusEnabled}
            >
              {[1, 2, 3].map((depth) => (
                <button
                  key={depth}
                  disabled={!focusEnabled}
                  className={focusDepth === depth ? "is-active" : ""}
                  onClick={() => setFocusDepth(depth)}
                >
                  {depth}階層
                </button>
              ))}
            </div>
            {!selectedId && (
              <small>星を選ぶと、関係する資料だけに絞り込めます。</small>
            )}
          </section>
          <section className="knowledge-map-time-filter-v645">
            <span className="knowledge-map-section-label-v638">更新時期</span>
            <small>最終更新日で表示する資料を絞ります。タグと選択中の資料は残します。</small>
            <div role="group" aria-label="更新時期で絞り込み">
              {(Object.keys(TIME_RANGE_LABEL) as TimeRange[]).map((range) => (
                <button
                  key={range}
                  type="button"
                  className={timeRange === range ? "is-active" : ""}
                  onClick={() => { setTimelinePlaying(false); setTimeRange(range); }}
                >
                  {TIME_RANGE_LABEL[range]}
                </button>
              ))}
            </div>
            <button type="button" className={`knowledge-map-timeline-play-v650${timelinePlaying ? " is-active" : ""}`} onClick={() => setTimelinePlaying((current) => !current)}>
              {timelinePlaying ? "Ⅱ 時間軸を停止" : "▶ 時間軸を再生"}
            </button>
          </section>
          <section>
            <span className="knowledge-map-section-label-v638">
              保存したビュー
            </span>
            <button onClick={saveCurrentView}>現在の表示を保存</button>
            {savedViews.length > 0 && (
              <div className="knowledge-map-saved-views-v640">
                {savedViews.slice(0, 6).map((view) => (
                  <div key={view.id}>
                    <button
                      title={view.name}
                      onClick={() => applySavedView(view.id)}
                    >
                      {view.name}
                    </button>
                    <button
                      className="delete"
                      aria-label={`${view.name}を削除`}
                      onClick={() => deleteSavedView(view.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="knowledge-map__visual-mode-v701">
            <span className="knowledge-map-section-label-v638">探索スタイル</span>
            <div role="group" aria-label="知識地図の表示スタイル">
              {([
                ["standard", "◌ 地図"],
                ["garden", "✿ 庭園"],
                ["universe", "✦ 宇宙"],
              ] as Array<[VisualMode, string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={visualMode === mode ? "is-active" : ""}
                  aria-pressed={visualMode === mode}
                  onClick={() => setVisualMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <small>{visualModeDescription(visualMode)}</small>
          </section>
          <section className="knowledge-map-cluster-controls-v649">
            <span className="knowledge-map-section-label-v638">資料の島</span>
            <small>島を折りたたむと、全体の構造を見やすくできます。名前はこの端末だけに保存されます。</small>
            {clusters.length ? clusters.map((cluster) => {
              const name = clusterNames[cluster.id]?.trim() || cluster.label;
              return <div key={cluster.id}>
                <button type="button" title={name} onClick={() => { setSelectedId(Array.from(cluster.nodeIds)[0] || null); setFocusEnabled(false); }}>◉ {name} <small>{cluster.size}</small></button>
                <button type="button" aria-label={`${name}の名前を変更`} onClick={() => { const next = window.prompt("資料の島の名前", name); if (next?.trim()) setClusterNames((current) => ({ ...current, [cluster.id]: next.trim() })); }}>✎</button>
                {clusterSuggestions.get(cluster.id)?.[0] && (
                  <button type="button" className="knowledge-map-cluster-suggest-v650" title={`候補: ${clusterSuggestions.get(cluster.id)?.[0]?.name}（${clusterSuggestions.get(cluster.id)?.[0]?.reason}）`} onClick={() => { const suggested = clusterSuggestions.get(cluster.id)?.[0]; if (suggested) setClusterNames((current) => ({ ...current, [cluster.id]: suggested.name })); }}>✦</button>
                )}
                <button type="button" aria-label={`${name}を${collapsedClusterIds[cluster.id] ? "展開" : "折りたたみ"}`} onClick={() => setCollapsedClusterIds((current) => ({ ...current, [cluster.id]: !current[cluster.id] }))}>{collapsedClusterIds[cluster.id] ? "＋" : "−"}</button>
              </div>;
            }) : <small>表示中の資料には、3件以上のまとまりがありません。</small>}
          </section>
          <section className="knowledge-map-health-v649">
            <span className="knowledge-map-section-label-v638">整理候補</span>
            <button type="button" className="knowledge-map-health-toggle-v649" onClick={() => setShowHealthPanel((current) => !current)}>{showHealthPanel ? "一覧を隠す" : `一覧を表示（${healthCandidates.length}件）`}</button>
            {showHealthPanel && (healthCandidates.length ? <div>{healthCandidates.map(({ node, health }) => <button key={node.id} type="button" onClick={() => { setSelectedId(node.id); setFocusEnabled(false); }}><b>{health.score >= 60 ? "!" : "○"}</b><span>{node.title}</span><small>{health.label} · {health.score}点</small></button>)}</div> : <small>孤立資料・見直し候補はありません。</small>)}
          </section>
          <section>
            <span className="knowledge-map-section-label-v638">出力</span>
            <button type="button" onClick={exportMapSvg}>SVGとして保存</button>
          </section>
          <section>
            <span className="knowledge-map-section-label-v638">操作</span>
            <button onClick={arrangeUnfixedNodes}>未固定ノードを整列</button>
            <button onClick={resetLayout}>配置をリセット</button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              表示位置を戻す
            </button>
          </section>
          <section className="knowledge-map-visual-legend-v648">
            <span className="knowledge-map-section-label-v638">資料の状態</span>
            <div><b className="hub" />参照が多い基幹資料</div>
            <div><b className="recent" />最近更新</div>
            <div><b className="stale" />見直し候補（古い基幹資料）</div>
            <div><b className="isolated" />孤立資料</div>
          </section>
          <section className="knowledge-map-legend-v638">
            <span className="knowledge-map-section-label-v638">ノード</span>
            <div>
              <b className="dot center" />
              {scope === "global" ? "重要ページ" : "現在のページ"}
            </div>
            <div>
              <b className="dot page" />
              ページ
            </div>
            <div>
              <b className="dot row" />
              DB行
            </div>
            <div>
              <b className="dot tag" />
              タグ
            </div>
          </section>
        </aside>

        <div className="knowledge-map-canvas-wrap-v638">
          {loading ? (
            <div className="knowledge-map-loading-v638">
              <span>✦</span>
              <b>関係図を準備しています…</b>
              <small>
                {scope === "global"
                  ? "ワークスペースのリンク索引を整理しています"
                  : "既存のリンク索引を確認しています"}
              </small>
            </div>
          ) : error ? (
            <div className="knowledge-map-loading-v638 is-error">
              <span>!</span>
              <b>{error}</b>
              <button onClick={() => void load()}>再試行</button>
            </div>
          ) : (
            graph && (
              <>
                <div className="knowledge-map-canvas-status-v638">
                  <span>
                    {scope === "global" ? "全体" : "現在ページ中心"} ·{" "}
                    {displayNodes.length}/{graph.nodes.length} ノード・
                    {displayEdges.length} 関係
                  </span>
                  {timeRange !== "all" && <em>直近{TIME_RANGE_LABEL[timeRange]} · {displayedRecentCount}件</em>}
                  {focusEnabled && <em>フォーカス {focusDepth}階層</em>}
                  {clusters.length > 0 && <em>資料の島 {clusters.length}件</em>}
                  {scope === "global" && isolatedNodeCount > 0 && (
                    <em>孤立資料 {isolatedNodeCount}件</em>
                  )}
                  {graph.truncated && (
                    <em>表示上限により一部を省略しています</em>
                  )}
                </div>
                <svg
                  ref={svgRef}
                  className="knowledge-map-canvas-v638"
                  viewBox="0 0 1200 760"
                  onWheel={(event) => {
                    event.preventDefault();
                    setZoom((current) =>
                      Math.max(
                        0.45,
                        Math.min(
                          2.2,
                          current + (event.deltaY > 0 ? -0.1 : 0.1),
                        ),
                      ),
                    );
                  }}
                  onPointerMove={onPointerMove}
                  onPointerUp={(event) => {
                    flushMapMove();
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    setDraggingNode(null);
                    setPanning(false);
                    pointerStart.current = null;
                    nodePointerStart.current = null;
                  }}
                  onPointerCancel={(event) => {
                    flushMapMove();
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    setDraggingNode(null);
                    setPanning(false);
                    pointerStart.current = null;
                    nodePointerStart.current = null;
                  }}
                  onPointerDown={(event) => {
                    // ノードは個別に stopPropagation するため、それ以外（背景・線・余白）は
                    // すべて地図移動の開始地点として扱う。背景rectを押した場合も確実にパンできる。
                    if (event.button !== 0) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setPanning(true);
                    pointerStart.current = {
                      x: event.clientX,
                      y: event.clientY,
                      pan,
                    };
                  }}
                >
                  <defs>
                    <radialGradient id="knowledgeMapGlowV638">
                      <stop offset="0" stopColor="rgba(138,114,255,.25)" />
                      <stop offset="1" stopColor="rgba(138,114,255,0)" />
                    </radialGradient>
                    <filter id="knowledgeMapShadowV638">
                      <feDropShadow
                        dx="0"
                        dy="5"
                        stdDeviation="6"
                        floodOpacity=".2"
                      />
                    </filter>
                  </defs>
                  <rect
                    width="1200"
                    height="760"
                    className="knowledge-map-backdrop-v638"
                  />
                  {visualMode === "universe" && (
                    <g className="knowledge-map__universe-stars-v701" pointerEvents="none">
                      {COSMIC_STAR_POINTS.map((star) => (
                        <circle key={star.id} cx={star.x} cy={star.y} r={star.r} opacity={star.opacity} />
                      ))}
                    </g>
                  )}
                  <g
                    transform={`translate(${600 + pan.x} ${380 + pan.y}) scale(${zoom})`}
                  >
                    <circle
                      cx="0"
                      cy="0"
                      r="360"
                      fill="url(#knowledgeMapGlowV638)"
                    />
                    {clusterBounds.map((cluster) => {
                      const collapsed = Boolean(collapsedClusterIds[cluster.id]);
                      return (
                        <g key={`cluster:${cluster.id}`} className={`knowledge-map-cluster-v648${collapsed ? " is-collapsed-v649" : ""}${visualMode === "garden" ? ` garden-${clusterGardenTheme(cluster.id)}` : ""}${visualMode === "universe" ? ` universe-${clusterGardenTheme(cluster.id)}` : ""}`}>
                          {!collapsed && <ellipse cx={cluster.x} cy={cluster.y} rx={cluster.rx} ry={cluster.ry} pointerEvents="none" />}
                          {!collapsed && visualMode === "garden" && Array.from({ length: gardenAccentCount(cluster.size) }).map((_, accentIndex) => {
                            const angle = ((stableHash(`${cluster.id}:${accentIndex}`) % 360) * Math.PI) / 180;
                            const x = cluster.x + Math.cos(angle) * Math.max(30, cluster.rx - 18);
                            const y = cluster.y + Math.sin(angle) * Math.max(24, cluster.ry - 15);
                            return <circle key={`garden:${cluster.id}:${accentIndex}`} className="knowledge-map__garden-petal" cx={x} cy={y} r={3 + (accentIndex % 2)} pointerEvents="none" />;
                          })}
                          {!collapsed && visualMode === "universe" && <ellipse className="knowledge-map__universe-orbit-v701" cx={cluster.x} cy={cluster.y} rx={Math.max(24, cluster.rx - 13)} ry={Math.max(20, cluster.ry - 12)} pointerEvents="none" />}
                          {!collapsed && <text x={cluster.x - cluster.rx + 14} y={cluster.y - cluster.ry + 19} pointerEvents="none">{visualMode === "standard" ? cluster.label : `✦ ${cluster.label}`} · {cluster.size}</text>}
                          {collapsed && <g className="knowledge-map-collapsed-cluster-v649" transform={`translate(${cluster.x} ${cluster.y})`} onPointerDown={(event) => { event.stopPropagation(); setCollapsedClusterIds((current) => ({ ...current, [cluster.id]: false })); }}><circle r="27"/><text y="-2" textAnchor="middle">{cluster.size}</text><text y="12" textAnchor="middle">{cluster.label.slice(0, 8)}</text></g>}
                        </g>
                      );
                    })}
                    {displayEdges.filter((edge) => !collapsedNodeIds.has(edge.source) && !collapsedNodeIds.has(edge.target)).map((edge) => {
                      const a = positions[edge.source];
                      const b = positions[edge.target];
                      if (!a || !b) return null;
                      const highlighted =
                        !selectedId ||
                        (connectedIds.has(edge.source) &&
                          connectedIds.has(edge.target));
                      return (
                        <line
                          key={edge.id}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          className={`${edgeClass(edge)} ${relationStrength(edge)} ${highlighted ? "is-highlighted" : "is-muted"} ${path.edgeIds.has(edge.id) ? "is-path" : ""} ${selectedEdgeId === edge.id ? "is-selected-edge" : ""}`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            setSelectedEdgeId(edge.id);
                          }}
                        />
                      );
                    })}
                    {displayNodes.filter((node) => !collapsedNodeIds.has(node.id)).map((node) => {
                      const point = positions[node.id];
                      if (!point) return null;
                      const active = node.id === selectedId;
                      const related = !selectedId || connectedIds.has(node.id);
                      const searchMatch =
                        normalizedQuery && searchMatchIds.has(node.id);
                      const searchMuted = Boolean(
                        normalizedQuery && !searchMatch,
                      );
                      const visual = nodeVisualMeta(node, nodeDegrees.get(node.id) || 0);
                      const radius = node.isCenter
                        ? 28
                        : node.type === "tag"
                          ? 17
                          : node.type === "database-row"
                            ? 20
                            : 22;
                      const visualRadius = radius + (visual.isHub ? 6 : 0) + (visual.isIsolated ? -3 : 0);
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${point.x} ${point.y})`}
                          className={`${nodeClass(node)} ${active ? "is-selected" : ""} ${related ? "is-related" : "is-muted"} ${searchMatch ? "is-search-match" : ""} ${searchMuted ? "is-search-muted" : ""} ${path.nodeIds.has(node.id) ? "is-path" : ""} ${fixedNodes[node.id] ? "is-fixed" : ""} ${visual.isHub ? "is-hub-v648" : ""} ${visual.isIsolated ? "is-isolated-v648" : ""} ${visual.isRecent ? "is-recent-v648" : ""} ${visual.isStaleHub ? "is-stale-hub-v648" : ""}`}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            setSelectedId(node.id);
                            setSelectedEdgeId(null);
                            const point = positions[node.id];
                            if (point && !fixedNodes[node.id])
                              nodePointerStart.current = {
                                nodeId: node.id,
                                x: event.clientX,
                                y: event.clientY,
                                point,
                                moved: false,
                              };
                          }}
                          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedId(node.id); setShelfNodeId(node.id); }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(node.id);
                            setSelectedEdgeId(null);
                            if (node.type === "page" && node.pageId)
                              onOpenPage(node.pageId);
                            if (
                              node.type === "database-row" &&
                              node.databaseId &&
                              node.rowId
                            )
                              onOpenDatabaseRow(node.databaseId, node.rowId);
                          }}
                        >
                          {visualMode === "universe" && node.type !== "tag" && (
                            <ellipse
                              className="knowledge-map__universe-node-orbit-v701"
                              rx={visualRadius + 9}
                              ry={Math.max(8, visualRadius * 0.42)}
                              transform="rotate(-18)"
                              pointerEvents="none"
                            />
                          )}
                          <circle
                            r={visualRadius + (active ? 8 : 4)}
                            className="knowledge-map-node-halo"
                          />
                          <circle
                            r={visualRadius}
                            className="knowledge-map-node-dot"
                            filter="url(#knowledgeMapShadowV638)"
                          />
                          <text
                            y={5}
                            textAnchor="middle"
                            className="knowledge-map-node-icon"
                          >
                            {node.type === "tag" ? "#" : node.icon || "📄"}
                          </text>
                          {visual.isRecent && <circle className="knowledge-map-node-recent-badge-v648" cx={visualRadius - 2} cy={-visualRadius + 2} r="4" />}
                          {visual.isStaleHub && <text className="knowledge-map-node-stale-badge-v648" x={visualRadius - 4} y={-visualRadius + 6}>!</text>}
                          <text
                            y={visualRadius + 21}
                            textAnchor="middle"
                            className="knowledge-map-node-label"
                          >
                            {node.title.length > 15
                              ? `${node.title.slice(0, 15)}…`
                              : node.title}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
                <div
                  ref={miniMapRef}
                  className={`knowledge-map-minimap-shell-v643${miniMapPosition ? " is-positioned" : ""}`}
                  style={miniMapPosition ? { left: miniMapPosition.x, top: miniMapPosition.y } : undefined}
                >
                  <div
                    className="knowledge-map-minimap-handle-v643"
                    role="button"
                    tabIndex={0}
                    aria-label="ミニマップをドラッグして移動"
                    title="ここをドラッグしてミニマップを移動"
                    onPointerDown={beginMiniMapDrag}
                    onPointerMove={moveMiniMap}
                    onPointerUp={endMiniMapDrag}
                    onPointerCancel={endMiniMapDrag}
                    onDoubleClick={() => setMiniMapPosition(null)}
                  >
                    <span aria-hidden="true">⠿</span> ミニマップ
                    <small>ドラッグで移動・ダブルクリックで右下へ戻す</small>
                  </div>
                  <svg
                    className="knowledge-map-minimap-v641"
                    viewBox="0 0 160 100"
                    aria-label="地図全体のミニマップ。クリックして表示位置を移動"
                    onPointerDown={recenterFromMiniMap}
                  >
                  {(() => {
                    const points = displayNodes
                      .map((node) => positions[node.id])
                      .filter(Boolean) as Point[];
                    const minX = Math.min(
                      ...points.map((point) => point.x),
                      -1,
                    );
                    const maxX = Math.max(...points.map((point) => point.x), 1);
                    const minY = Math.min(
                      ...points.map((point) => point.y),
                      -1,
                    );
                    const maxY = Math.max(...points.map((point) => point.y), 1);
                    const pad = 8;
                    const project = (point: Point) => ({
                      x:
                        pad +
                        ((point.x - minX) / (maxX - minX || 1)) *
                          (160 - pad * 2),
                      y:
                        pad +
                        ((point.y - minY) / (maxY - minY || 1)) *
                          (100 - pad * 2),
                    });
                    return (
                      <>
                        {displayEdges.filter((edge) => !collapsedNodeIds.has(edge.source) && !collapsedNodeIds.has(edge.target)).map((edge) => {
                          const a = positions[edge.source];
                          const b = positions[edge.target];
                          if (!a || !b) return null;
                          const pa = project(a);
                          const pb = project(b);
                          return (
                            <line
                              key={edge.id}
                              x1={pa.x}
                              y1={pa.y}
                              x2={pb.x}
                              y2={pb.y}
                            />
                          );
                        })}
                        {displayNodes.map((node) => {
                          const point = positions[node.id];
                          if (!point) return null;
                          const p = project(point);
                          return (
                            <circle
                              key={node.id}
                              cx={p.x}
                              cy={p.y}
                              r={node.id === selectedId ? 3.5 : 2.2}
                              className={
                                node.id === selectedId ? "is-selected" : ""
                              }
                            />
                          );
                        })}
                      </>
                    );
                  })()}
                  </svg>
                </div>
              </>
            )
          )}
        </div>

        <aside className="knowledge-map-inspector-v638 knowledge-map-inspector-v640">
          <span className="knowledge-map-section-label-v638">選択中</span>
          {selectedEdge ? (
            <section className="knowledge-map-edge-evidence-v645">
              <span className="knowledge-map-edge-kind-v645">{KIND_LABEL[selectedEdge.kind]}</span>
              <h2>この線の根拠</h2>
              <p>{relationEvidence(selectedEdge, nodeById.get(selectedEdge.source), nodeById.get(selectedEdge.target))}</p>
              <div>
                <button type="button" onClick={() => { setSelectedId(selectedEdge.source); setSelectedEdgeId(null); }}>
                  {nodeById.get(selectedEdge.source)?.title || "起点を選択"}
                </button>
                <span>→</span>
                <button type="button" onClick={() => { setSelectedId(selectedEdge.target); setSelectedEdgeId(null); }}>
                  {nodeById.get(selectedEdge.target)?.title || "終点を選択"}
                </button>
              </div>
              <button type="button" className="knowledge-map-edge-close-v645" onClick={() => setSelectedEdgeId(null)}>線の選択を解除</button>
            </section>
          ) : selected ? (
            <>
              <div
                className={`knowledge-map-selected-icon-v638 type-${selected.type}`}
              >
                {selected.type === "tag" ? "#" : selected.icon || "📄"}
              </div>
              <h2>{selected.title}</h2>
              <p>
                {selected.type === "page"
                  ? "ページ"
                  : selected.type === "database-row"
                    ? "データベース行"
                    : "タグ"}
              </p>
              {selected.updatedAt && (
                <small>
                  最終更新{" "}
                  {new Date(selected.updatedAt).toLocaleString("ja-JP")}
                </small>
              )}
              {(selected.type === "page" ||
                selected.type === "database-row") && (
                <button className="primary" onClick={openSelected}>
                  開く
                </button>
              )}
              <div className="knowledge-map-node-actions-v641">
                <button
                  type="button"
                  onClick={() => toggleFixedNode(selected.id)}
                >
                  {fixedNodes[selected.id]
                    ? "🔒 位置の固定を解除"
                    : "📌 この位置を固定"}
                </button>
                {!pathStartId ? (
                  <button
                    type="button"
                    onClick={() => setPathStartId(selected.id)}
                  >
                    ◎ 経路の始点にする
                  </button>
                ) : pathStartId === selected.id ? (
                  <button type="button" onClick={() => setPathStartId(null)}>
                    経路選択を解除
                  </button>
                ) : (
                  <small className="knowledge-map-path-guide-v641">
                    始点を選択済みです。別の星をクリックすると経路を表示します。
                  </small>
                )}
              </div>
              {pathStartId && selectedId && pathStartId !== selectedId && (
                <div className="knowledge-map-path-status-v641">
                  {path.edgeIds.size
                    ? `${path.edgeIds.size}段階の経路を強調中`
                    : "表示中の関係では経路が見つかりません"}
                  {sharedTags.length > 0 && <small>共通タグ: {sharedTags.slice(0, 3).map((tag) => tag.title).join(" · ")}</small>}
                </div>
              )}
              {comparison && pathStartId && selectedId && pathStartId !== selectedId && (
                <section className="knowledge-map-comparison-v650">
                  <span>2資料の比較</span>
                  <small>共通タグ {comparison.sharedTags.length}件・共通の関係先 {comparison.sharedNeighbors.length}件</small>
                  {comparison.sharedTags.length > 0 && <p>共通タグ: {comparison.sharedTags.slice(0, 4).map((node) => node.title).join(" · ")}</p>}
                  {comparison.sharedNeighbors.length > 0 && <p>共通資料: {comparison.sharedNeighbors.slice(0, 3).map((node) => node.title).join(" · ")}</p>}
                  <div><em>始点のみ: {comparison.leftOnly.length}件</em><em>選択中のみ: {comparison.rightOnly.length}件</em></div>
                </section>
              )}
              {selected.type === "page" && selected.pageId && (
                <section className="knowledge-map-direct-organize-v648">
                  <span>関係図から整理</span>
                  {!organizeParentId ? (
                    <button type="button" onClick={() => { setOrganizeParentId(selected.id); setOrganizeMessage(""); }}>
                      ⇲ このページを親として選ぶ
                    </button>
                  ) : organizeParentId === selected.id ? (
                    <button type="button" onClick={() => setOrganizeParentId(null)}>親ページの選択を解除</button>
                  ) : (
                    <>
                      <small>「{nodeById.get(organizeParentId)?.title || "選択したページ"}」の子ページにします。</small>
                      <button type="button" disabled={organizeBusy} onClick={() => void moveSelectedUnderOrganizeParent()}>
                        {organizeBusy ? "移動中…" : "↳ 選択中のページを子ページへ移動"}
                      </button>
                      <button type="button" className="secondary" onClick={() => setOrganizeParentId(null)}>キャンセル</button>
                    </>
                  )}
                  {organizeMessage && <small className="knowledge-map-organize-message-v648">{organizeMessage}</small>}
                </section>
              )}
              {selected.type === "page" && selected.pageId && (
                <section className="knowledge-map-create-from-map-v650">
                  <span>関係図から作成</span>
                  <button type="button" disabled={createBusy} onClick={() => void createChildFromSelected(false)}>
                    ＋ このページの子ページを作成
                  </button>
                  <button type="button" disabled={createBusy} onClick={() => void createChildFromSelected(true)}>
                    ✦ 関連資料のまとめページを作成
                  </button>
                  {createMessage && <small>{createMessage}</small>}
                </section>
              )}
              <div className="knowledge-map-related-count-v638">
                <b>{selectedRelations.length}</b>
                <span>直接つながる項目</span>
              </div>
              {selectedRelations.length > 0 && (
                <section className="knowledge-map-relation-preview-v640">
                  <span>関係する資料</span>
                  {selectedRelations.slice(0, 8).map(({ edge, node }) => (
                    <button
                      key={edge.id}
                      onClick={() => { setSelectedId(node.id); setSelectedEdgeId(null); }}
                    >
                      <i
                        className={`knowledge-map-legend-line kind-${edge.kind}`}
                      />
                      <b>{node.type === "tag" ? "#" : node.icon || "📄"}</b>
                      <em>{node.title}</em>
                      <small>{KIND_LABEL[edge.kind]}</small>
                    </button>
                  ))}
                  {selectedRelations.length > 8 && (
                    <small>ほか {selectedRelations.length - 8} 件</small>
                  )}
                </section>
              )}
            </>
          ) : (
            <p className="knowledge-map-inspector-empty-v638">
              星をクリックすると、概要と操作を表示します。
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
