import { COLORS, clamp, type FreeformBoard, type FreeformLink, type FreeformNode } from "./freeformCanvasModel";

export function exportFreeformBoard(board: FreeformBoard): string {
  return JSON.stringify({
    format: "local-notion-freeform-board",
    exportedAt: new Date().toISOString(),
    board,
  }, null, 2);
}

export function importFreeformBoard(value: string): FreeformBoard {
  const parsed = JSON.parse(value) as { format?: string; board?: Partial<FreeformBoard> };
  if (parsed.format !== "local-notion-freeform-board" || !parsed.board || !Array.isArray(parsed.board.nodes)) {
    throw new Error("Unsupported freeform board file");
  }
  const now = Date.now();
  const nodes = parsed.board.nodes
    .filter((node): node is FreeformNode => Boolean(node) && typeof node.id === "string")
    .map((node) => ({
      ...node,
      title: typeof node.title === "string" ? node.title : "無題",
      body: typeof node.body === "string" ? node.body : "",
      x: Number.isFinite(node.x) ? Number(node.x) : 120,
      y: Number.isFinite(node.y) ? Number(node.y) : 120,
      w: clamp(Number(node.w) || 240, 40, 1600),
      h: clamp(Number(node.h) || 140, 24, 1200),
      color: COLORS.includes(node.color) ? node.color : "paper",
      createdAt: Number(node.createdAt) || now,
      updatedAt: Number(node.updatedAt) || now,
    }));
  const ids = new Set(nodes.map((node) => node.id));
  const links = (Array.isArray(parsed.board.links) ? parsed.board.links : [])
    .filter((link): link is FreeformLink => Boolean(link) && typeof link.id === "string" && ids.has(link.fromId) && ids.has(link.toId));
  return {
    version: 1,
    title: typeof parsed.board.title === "string" ? parsed.board.title : "Freeform Canvas",
    nodes,
    links,
    updatedAt: now,
  };
}
