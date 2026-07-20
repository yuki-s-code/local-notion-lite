import type { AttachmentInfo, WorkspaceDatabase } from "../../../../shared/types";

export type FreeformNodeKind =
  | "note"
  | "page"
  | "database"
  | "pdf"
  | "group"
  | "text"
  | "shape"
  | "image"
  | "drawing"
  | "google-drive"
  | "google-calendar"
  | "google-gmail"
  | "web-project";
export type FreeformShapeKind = "rect" | "round" | "ellipse" | "diamond";
export type FreeformCanvasTool =
  | "select"
  | "hand"
  | "sticky"
  | "text"
  | "shape"
  | "frame"
  | "connector"
  | "draw"
  | "eraser"
  | "ruler"
  | "image";

export type FreeformNode = {
  id: string;
  kind: FreeformNodeKind;
  title: string;
  body?: string;
  targetId?: string;
  icon?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: "paper" | "blue" | "green" | "amber" | "rose" | "violet";
  shape?: FreeformShapeKind;
  cropX?: number;
  cropY?: number;
  cropScale?: number;
  strokeColor?: string;
  strokeWidth?: number;
  parentFrameId?: string;
  groupId?: string;
  collapsed?: boolean;
  collapsedChildCount?: number;
  collapsedExternalCount?: number;
  createdAt: number;
  updatedAt: number;
  externalUrl?: string;
  mimeType?: string;
  sourceDriveId?: string;
};

export type FreeformLink = {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  color?: string;
  width?: number;
  dashed?: boolean;
  edgeType?: "bezier" | "smoothstep" | "straight";
  bidirectional?: boolean;
  fromHandle?: FreeformAnchor;
  toHandle?: FreeformAnchor;
  proxyCount?: number;
  proxyLinkIds?: string[];
  createdAt: number;
};

export type FreeformBoard = {
  version: 1;
  title: string;
  nodes: FreeformNode[];
  links: FreeformLink[];
  updatedAt: number;
};

export type AddPanelMode = "note" | "page" | "database" | "pdf" | "group";
export type CanvasTemplate = "brainstorm" | "workflow" | "comparison";

export const STORAGE_KEY = "local-notion:freeform-canvas-v735";
export const LEGACY_STORAGE_KEY = "local-notion:freeform-canvas-v733";
export const COLORS: FreeformNode["color"][] = [
  "paper",
  "blue",
  "green",
  "amber",
  "rose",
  "violet",
];
export const CANVAS_WIDTH = 3600;
export const CANVAS_HEIGHT = 2400;
export const GRID_SIZE = 24;


export const LOW_DETAIL_NODE_HEIGHT = 54;

/**
 * Returns display-only node geometry for low-detail zoom. The persisted node
 * keeps its full size, while links and viewport culling use the same compact
 * height that CSS renders on screen.
 */
export function projectLowDetailNodes(
  nodes: FreeformNode[],
  lowDetail: boolean,
  selectedIds: ReadonlySet<string>,
): FreeformNode[] {
  if (!lowDetail) return nodes;
  return nodes.map((node) => {
    if (selectedIds.has(node.id)) return node;
    if (node.kind === "group" && node.collapsed) return node;
    return node.h === LOW_DETAIL_NODE_HEIGHT
      ? node
      : { ...node, h: LOW_DETAIL_NODE_HEIGHT };
  });
}

export function nowId(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function createDefaultBoard(): FreeformBoard {
  const now = Date.now();
  return {
    version: 1,
    title: "Freeform Canvas",
    updatedAt: now,
    nodes: [
      {
        id: nowId("node"),
        kind: "note",
        title: "自由キャンバス",
        body: "ページ、DB、付箋を自由に並べて、考えを整理できます。左から追加し、Shiftで2件選択して接続できます。",
        icon: "✦",
        x: 180,
        y: 160,
        w: 290,
        h: 160,
        color: "blue",
        createdAt: now,
        updatedAt: now,
      },
    ],
    links: [],
  };
}

export function safeLoadBoard(): FreeformBoard {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return createDefaultBoard();
    const parsed = JSON.parse(raw) as Partial<FreeformBoard>;
    if (!Array.isArray(parsed.nodes)) return createDefaultBoard();
    const nodes = parsed.nodes
      .filter(
        (node): node is FreeformNode =>
          Boolean(node) &&
          typeof node === "object" &&
          typeof (node as FreeformNode).id === "string",
      )
      .map((node) => ({
        id: node.id,
        kind: (
          [
            "note",
            "page",
            "database",
            "pdf",
            "group",
            "text",
            "shape",
            "image",
            "drawing",
            "google-drive",
            "google-calendar",
            "google-gmail",
            "web-project",
          ] as FreeformNodeKind[]
        ).includes(node.kind)
          ? node.kind
          : "note",
        title: node.title || "無題",
        body: node.body || "",
        targetId: node.targetId,
        icon: node.icon,
        x: Number.isFinite(node.x) ? node.x : 120,
        y: Number.isFinite(node.y) ? node.y : 120,
        w: Number.isFinite(node.w) ? node.w : 240,
        h: Number.isFinite(node.h) ? node.h : 140,
        color: COLORS.includes(node.color) ? node.color : "paper",
        shape: (
          ["rect", "round", "ellipse", "diamond"] as FreeformShapeKind[]
        ).includes((node as FreeformNode).shape || "rect")
          ? (node as FreeformNode).shape || "rect"
          : "rect",
        cropX: Number.isFinite((node as FreeformNode).cropX)
          ? clamp(Number((node as FreeformNode).cropX), 0, 100)
          : 50,
        cropY: Number.isFinite((node as FreeformNode).cropY)
          ? clamp(Number((node as FreeformNode).cropY), 0, 100)
          : 50,
        cropScale: Number.isFinite((node as FreeformNode).cropScale)
          ? clamp(Number((node as FreeformNode).cropScale), 1, 3)
          : 1,
        strokeColor:
          typeof (node as FreeformNode).strokeColor === "string"
            ? (node as FreeformNode).strokeColor
            : "#2563eb",
        strokeWidth: Number.isFinite((node as FreeformNode).strokeWidth)
          ? clamp(Number((node as FreeformNode).strokeWidth), 1, 12)
          : 3,
        parentFrameId:
          typeof (node as FreeformNode).parentFrameId === "string"
            ? (node as FreeformNode).parentFrameId
            : undefined,
        groupId:
          typeof (node as FreeformNode).groupId === "string"
            ? (node as FreeformNode).groupId
            : undefined,
        collapsed: Boolean((node as FreeformNode).collapsed),
        externalUrl: typeof (node as FreeformNode).externalUrl === "string" ? (node as FreeformNode).externalUrl : undefined,
        mimeType: typeof (node as FreeformNode).mimeType === "string" ? (node as FreeformNode).mimeType : undefined,
        sourceDriveId: typeof (node as FreeformNode).sourceDriveId === "string" ? (node as FreeformNode).sourceDriveId : undefined,
        createdAt: Number(node.createdAt) || Date.now(),
        updatedAt: Number(node.updatedAt) || Date.now(),
      }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links = Array.isArray(parsed.links)
      ? parsed.links
          .filter((link): link is FreeformLink => {
            if (!link || typeof link !== "object") return false;
            const item = link as FreeformLink;
            return (
              typeof item.fromId === "string" &&
              typeof item.toId === "string" &&
              nodeIds.has(item.fromId) &&
              nodeIds.has(item.toId)
            );
          })
          .map((link) => ({
            ...link,
            color: typeof link.color === "string" ? link.color : "#64748b",
            width: Number.isFinite(link.width) ? clamp(Number(link.width), 1, 6) : 2,
            dashed: Boolean(link.dashed),
            edgeType: (["bezier", "smoothstep", "straight"] as const).includes(link.edgeType as "bezier" | "smoothstep" | "straight") ? link.edgeType : "bezier",
            bidirectional: Boolean(link.bidirectional),
            fromHandle: (["top", "right", "bottom", "left"] as FreeformAnchor[]).includes(link.fromHandle as FreeformAnchor) ? link.fromHandle : undefined,
            toHandle: (["top", "right", "bottom", "left"] as FreeformAnchor[]).includes(link.toHandle as FreeformAnchor) ? link.toHandle : undefined,
          }))
      : [];
    return {
      version: 1,
      title: parsed.title || "Freeform Canvas",
      updatedAt: Number(parsed.updatedAt) || Date.now(),
      nodes,
      links,
    };
  } catch {
    return createDefaultBoard();
  }
}

export function formatUpdatedAt(value: number) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function colorLabel(color: FreeformNode["color"]) {
  if (color === "paper") return "白";
  if (color === "blue") return "青";
  if (color === "green") return "緑";
  if (color === "amber") return "黄";
  if (color === "rose") return "赤";
  return "紫";
}

export function toolLabel(tool: FreeformCanvasTool) {
  if (tool === "select") return "選択";
  if (tool === "hand") return "移動";
  if (tool === "sticky") return "付箋";
  if (tool === "text") return "テキスト";
  if (tool === "shape") return "図形";
  if (tool === "frame") return "フレーム";
  if (tool === "draw") return "ペン";
  if (tool === "eraser") return "消しゴム";
  if (tool === "ruler") return "定規";
  if (tool === "image") return "画像";
  return "接続";
}

export function kindLabel(kind: FreeformNodeKind) {
  if (kind === "note") return "付箋";
  if (kind === "page") return "ページ";
  if (kind === "database") return "DB";
  if (kind === "pdf") return "PDF";
  if (kind === "group") return "フレーム";
  if (kind === "text") return "テキスト";
  if (kind === "image") return "画像";
  if (kind === "drawing") return "描画";
  if (kind === "google-drive") return "Google Drive";
  if (kind === "google-calendar") return "Google Calendar";
  if (kind === "google-gmail") return "Gmail";
  if (kind === "web-project") return "Webプロジェクト";
  return "図形";
}

export function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

export function isPdfAttachment(file: AttachmentInfo) {
  return /\.pdf$/i.test(file.fileName || "");
}

export function buildAttachmentFileUrl(
  apiUrl: string | undefined,
  attachment: AttachmentInfo,
) {
  if (!apiUrl) return "";
  return `${apiUrl}/pages/${encodeURIComponent(attachment.pageId)}/attachments/${encodeURIComponent(attachment.id)}/file`;
}

export function stringifyCell(
  value: string | number | boolean | string[] | null | undefined,
) {
  if (Array.isArray(value)) return value.slice(0, 3).join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  if (value == null) return "";
  return String(value);
}

export function previewLinesFromText(text: string | undefined, limit = 4) {
  return (text || "")
    .replace(/[#*_`>\[\]()]/g, " ")
    .split(/\n|。|！|？/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export type CanvasPagePreviewLine = {
  kind: "heading" | "paragraph" | "list" | "quote" | "code";
  text: string;
};

export type CanvasPagePreviewState = {
  loading: boolean;
  markdown: string;
  loadedAt: number;
  error?: string;
};

export function stripMarkdownInline(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "画像")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPagePreviewBlocks(
  markdown: string | undefined,
  fallback: string | undefined,
  limit = 8,
): CanvasPagePreviewLine[] {
  const source = (markdown || fallback || "").replace(/\r\n/g, "\n");
  const lines: CanvasPagePreviewLine[] = [];
  let inCode = false;
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^```/.test(line)) {
      inCode = !inCode;
      if (inCode && lines.length < limit)
        lines.push({ kind: "code", text: "コードブロック" });
      continue;
    }
    if (inCode) {
      const text = stripMarkdownInline(line);
      if (text) lines.push({ kind: "code", text });
    } else if (/^#{1,6}\s+/.test(line)) {
      lines.push({
        kind: "heading",
        text: stripMarkdownInline(line.replace(/^#{1,6}\s+/, "")),
      });
    } else if (/^[-*+]\s+|^\d+[.)]\s+/.test(line)) {
      lines.push({
        kind: "list",
        text: stripMarkdownInline(line.replace(/^[-*+]\s+|^\d+[.)]\s+/, "")),
      });
    } else if (/^>\s?/.test(line)) {
      lines.push({
        kind: "quote",
        text: stripMarkdownInline(line.replace(/^>\s?/, "")),
      });
    } else if (!/^\|?\s*[-:]{3,}/.test(line)) {
      lines.push({ kind: "paragraph", text: stripMarkdownInline(line) });
    }
    if (lines.length >= limit) break;
  }
  if (lines.length) return lines.filter((item) => item.text).slice(0, limit);
  return previewLinesFromText(fallback, Math.min(4, limit)).map((text) => ({
    kind: "paragraph",
    text,
  }));
}

export function pickDatabasePreviewColumns(
  database: WorkspaceDatabase | undefined,
  limit = 4,
) {
  if (!database) return [];
  const preferred = [
    "title",
    "text",
    "status",
    "select",
    "multi_select",
    "relation",
    "date",
    "number",
    "checkbox",
  ];
  return [...database.properties]
    .sort((a, b) => {
      const ai = preferred.indexOf(a.type);
      const bi = preferred.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .slice(0, limit);
}

export function distancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}



export function simplifyStrokePoints(
  points: Array<{ x: number; y: number }>,
  tolerance = 1.25,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points.slice();
  const result = [points[0]];
  let last = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (Math.hypot(point.x - last.x, point.y - last.y) < tolerance) continue;
    result.push(point);
    last = point;
  }
  const end = points[points.length - 1];
  if (result[result.length - 1] !== end) result.push(end);
  return result;
}
export function buildSmoothPath(
  points: Array<{ x: number; y: number }>,
): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    commands.push(`Q ${current.x} ${current.y} ${midX} ${midY}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

export function drawingHitTest(
  node: FreeformNode,
  point: { x: number; y: number },
  radius = 14,
) {
  if (node.kind !== "drawing" || !node.body) return false;
  try {
    const local = { x: point.x - node.x, y: point.y - node.y };
    const points = JSON.parse(node.body) as Array<{ x: number; y: number }>;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (
        distancePointToSegment(local, points[index], points[index + 1]) <=
        radius + (node.strokeWidth || 3) / 2
      )
        return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getBounds(nodes: FreeformNode[]) {
  if (!nodes.length) return null;
  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.x),
      minY: Math.min(bounds.minY, node.y),
      maxX: Math.max(bounds.maxX, node.x + node.w),
      maxY: Math.max(bounds.maxY, node.y + node.h),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: 0,
      maxY: 0,
    },
  );
}

export function makeNode(
  partial: Omit<FreeformNode, "id" | "createdAt" | "updatedAt">,
  timestamp: number,
): FreeformNode {
  return {
    ...partial,
    id: nowId("node"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}



export type FreeformAnchor = "top" | "right" | "bottom" | "left";

export function nodeContainsNode(frame: FreeformNode, node: FreeformNode, padding = 12) {
  if (frame.kind !== "group" || frame.id === node.id) return false;
  const centerX = node.x + node.w / 2;
  const centerY = node.y + node.h / 2;
  return (
    centerX >= frame.x + padding &&
    centerX <= frame.x + frame.w - padding &&
    centerY >= frame.y + padding &&
    centerY <= frame.y + frame.h - padding
  );
}

export function resolveParentFrameId(node: FreeformNode, nodes: FreeformNode[]) {
  const frames = nodes
    .filter((candidate) => nodeContainsNode(candidate, node))
    .sort((a, b) => a.w * a.h - b.w * b.h);
  return frames[0]?.id;
}

export function getAnchorPoint(node: FreeformNode, anchor: FreeformAnchor) {
  if (anchor === "top") return { x: node.x + node.w / 2, y: node.y };
  if (anchor === "right") return { x: node.x + node.w, y: node.y + node.h / 2 };
  if (anchor === "bottom") return { x: node.x + node.w / 2, y: node.y + node.h };
  return { x: node.x, y: node.y + node.h / 2 };
}


export function nearestAnchor(node: FreeformNode, point: { x: number; y: number }): FreeformAnchor {
  const candidates: Array<[FreeformAnchor, number]> = (["top", "right", "bottom", "left"] as FreeformAnchor[]).map((anchor) => {
    const anchorPoint = getAnchorPoint(node, anchor);
    return [anchor, Math.hypot(point.x - anchorPoint.x, point.y - anchorPoint.y)];
  });
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][0];
}

export function chooseLinkAnchors(from: FreeformNode, to: FreeformNode): [FreeformAnchor, FreeformAnchor] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export function getLinkPoints(from: FreeformNode, to: FreeformNode, link?: Pick<FreeformLink, "fromHandle" | "toHandle">) {
  const automatic = chooseLinkAnchors(from, to);
  const fromAnchor = link?.fromHandle || automatic[0];
  const toAnchor = link?.toHandle || automatic[1];
  return {
    fromAnchor,
    toAnchor,
    start: getAnchorPoint(from, fromAnchor),
    end: getAnchorPoint(to, toAnchor),
  };
}

export function buildLinkPath(from: FreeformNode, to: FreeformNode, link?: Pick<FreeformLink, "fromHandle" | "toHandle" | "edgeType">) {
  const { fromAnchor, start, end } = getLinkPoints(from, to, link);
  if (link?.edgeType === "straight") return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const horizontal = fromAnchor === "left" || fromAnchor === "right";
  if (link?.edgeType === "smoothstep") {
    if (horizontal) {
      const middleX = (start.x + end.x) / 2;
      return `M ${start.x} ${start.y} L ${middleX} ${start.y} Q ${middleX} ${start.y} ${middleX} ${start.y + Math.sign(end.y - start.y || 1) * 12} L ${middleX} ${end.y - Math.sign(end.y - start.y || 1) * 12} Q ${middleX} ${end.y} ${middleX + Math.sign(end.x - start.x || 1) * 12} ${end.y} L ${end.x} ${end.y}`;
    }
    const middleY = (start.y + end.y) / 2;
    return `M ${start.x} ${start.y} L ${start.x} ${middleY} Q ${start.x} ${middleY} ${start.x + Math.sign(end.x - start.x || 1) * 12} ${middleY} L ${end.x - Math.sign(end.x - start.x || 1) * 12} ${middleY} Q ${end.x} ${middleY} ${end.x} ${middleY + Math.sign(end.y - start.y || 1) * 12} L ${end.x} ${end.y}`;
  }
  if (horizontal) {
    const middleX = (start.x + end.x) / 2;
    return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
  }
  const middleY = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`;
}

export function getLinkLabelPoint(from: FreeformNode, to: FreeformNode, link?: Pick<FreeformLink, "fromHandle" | "toHandle">) {
  const { start, end } = getLinkPoints(from, to, link);
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 8 };
}
