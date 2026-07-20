import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  clamp,
  nowId,
  type FreeformBoard,
  type FreeformLink,
  type FreeformNode,
} from "./freeformCanvasModel";

export type FreeformClipboardPayload = {
  version: 1;
  nodes: FreeformNode[];
  links: FreeformLink[];
};

export function createClipboardPayload(
  board: FreeformBoard,
  selectedIds: readonly string[],
): FreeformClipboardPayload | null {
  if (!selectedIds.length) return null;
  const selected = new Set(selectedIds);
  const nodes = board.nodes.filter((node) => selected.has(node.id));
  if (!nodes.length) return null;
  const links = board.links.filter(
    (link) => selected.has(link.fromId) && selected.has(link.toId),
  );
  return { version: 1, nodes, links };
}

export function cloneClipboardPayload(
  payload: FreeformClipboardPayload,
  offset = 34,
): { nodes: FreeformNode[]; links: FreeformLink[] } {
  const timestamp = Date.now();
  const idMap = new Map<string, string>();
  const groupIdMap = new Map<string, string>();
  const frameIdMap = new Map<string, string>();

  for (const node of payload.nodes) idMap.set(node.id, nowId("node"));
  for (const node of payload.nodes) {
    if (node.groupId && !groupIdMap.has(node.groupId)) {
      groupIdMap.set(node.groupId, nowId("logical-group"));
    }
    if (node.kind === "group") frameIdMap.set(node.id, idMap.get(node.id)!);
  }

  const nodes = payload.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id)!,
    parentFrameId: node.parentFrameId
      ? frameIdMap.get(node.parentFrameId)
      : undefined,
    groupId: node.groupId ? groupIdMap.get(node.groupId) : undefined,
    x: clamp(node.x + offset, 0, CANVAS_WIDTH - node.w),
    y: clamp(node.y + offset, 0, CANVAS_HEIGHT - node.h),
    title: `${node.title} コピー`,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const links = payload.links
    .map<FreeformLink | null>((link) => {
      const fromId = idMap.get(link.fromId);
      const toId = idMap.get(link.toId);
      if (!fromId || !toId) return null;
      const clonedLink: FreeformLink = {
        ...link,
        id: nowId("link"),
        fromId,
        toId,
        proxyLinkIds: undefined,
        proxyCount: undefined,
        createdAt: timestamp,
      };
      return clonedLink;
    })
    .filter((link): link is FreeformLink => link !== null);

  return { nodes, links };
}

export function serializeClipboardPayload(payload: FreeformClipboardPayload) {
  return JSON.stringify({ type: "local-notion-freeform", ...payload });
}

export function parseClipboardPayload(value: string): FreeformClipboardPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<FreeformClipboardPayload> & { type?: string };
    if (parsed.type !== "local-notion-freeform" || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) {
      return null;
    }
    return { version: 1, nodes: parsed.nodes, links: parsed.links };
  } catch {
    return null;
  }
}
