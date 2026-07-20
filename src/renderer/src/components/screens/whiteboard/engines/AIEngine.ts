import type { PageWithLock } from "../../../../../../shared/types";
import {
  nowId,
  type FreeformLink,
  type FreeformNode,
} from "../../freeformCanvasModel";

export type KnowledgeGraphResult = {
  nodes: FreeformNode[];
  links: FreeformLink[];
};

const STOP_WORDS = new Set([
  "について", "ため", "こと", "これ", "それ", "ページ", "資料", "情報", "the", "and", "for",
]);

function tokens(value: string) {
  return new Set(
    value
      .toLocaleLowerCase("ja-JP")
      .replace(/[\s\p{P}\p{S}]+/gu, " ")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token)),
  );
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function pageTerms(page: PageWithLock) {
  return tokens([
    page.title,
    page.previewSnippet || "",
    ...(page.properties.tags || []),
    page.properties.status || "",
  ].join(" "));
}

export const AIEngine = {

  buildExistingNodeKnowledgeLinks(
    inputNodes: readonly FreeformNode[],
    existingLinks: readonly FreeformLink[] = [],
  ): FreeformLink[] {
    const candidates = inputNodes.filter((node) =>
      (node.kind === "page" || node.kind === "google-drive") &&
      Boolean(node.title.trim() || node.body?.trim()),
    );
    const existingPairs = new Set(existingLinks.map((link) =>
      [link.fromId, link.toId].sort().join("::"),
    ));
    const termsByNode = new Map(candidates.map((node) => [
      node.id,
      tokens(`${node.title} ${node.body || ""}`),
    ]));
    const scored: Array<{ left: FreeformNode; right: FreeformNode; score: number }> = [];
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const left = candidates[i];
        const right = candidates[j];
        const pair = [left.id, right.id].sort().join("::");
        if (existingPairs.has(pair)) continue;
        const score = overlap(termsByNode.get(left.id)!, termsByNode.get(right.id)!);
        if (score < 2) continue;
        scored.push({ left, right, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const degree = new Map<string, number>();
    const now = Date.now();
    const links: FreeformLink[] = [];
    for (const item of scored) {
      if ((degree.get(item.left.id) || 0) >= 4 || (degree.get(item.right.id) || 0) >= 4) continue;
      links.push({
        id: nowId("kg-edge"),
        fromId: item.left.id,
        toId: item.right.id,
        label: `共通語 ${item.score}件 · ${Math.min(98, 52 + item.score * 7)}%`,
        color: "#64748b",
        width: 2,
        dashed: item.score < 4,
        edgeType: "smoothstep",
        createdAt: now,
      });
      degree.set(item.left.id, (degree.get(item.left.id) || 0) + 1);
      degree.set(item.right.id, (degree.get(item.right.id) || 0) + 1);
    }
    return links;
  },
  buildKnowledgeGraph(
    inputPages: readonly PageWithLock[],
    origin = { x: 240, y: 180 },
    maxPages = 32,
  ): KnowledgeGraphResult {
    const pages = inputPages.filter((page) => !page.trashed).slice(0, maxPages);
    const now = Date.now();
    const nodeByPage = new Map<string, FreeformNode>();
    const termsByPage = new Map(pages.map((page) => [page.id, pageTerms(page)]));

    pages.forEach((page, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      nodeByPage.set(page.id, {
        id: nowId("kg-node"),
        kind: "page",
        title: page.title || "無題",
        body: page.previewSnippet || "",
        targetId: page.id,
        icon: page.icon || "📄",
        x: origin.x + column * 360,
        y: origin.y + row * 230,
        w: 300,
        h: 180,
        color: column % 2 ? "paper" : "blue",
        createdAt: now,
        updatedAt: now,
      });
    });

    const candidates: Array<{ left: PageWithLock; right: PageWithLock; score: number; reason: string }> = [];
    for (let i = 0; i < pages.length; i += 1) {
      for (let j = i + 1; j < pages.length; j += 1) {
        const left = pages[i];
        const right = pages[j];
        const sharedTerms = overlap(termsByPage.get(left.id)!, termsByPage.get(right.id)!);
        const sharedTags = (left.properties.tags || []).filter((tag) =>
          (right.properties.tags || []).includes(tag),
        );
        const sameStatus = Boolean(
          left.properties.status && left.properties.status === right.properties.status,
        );
        const score = sharedTags.length * 4 + sharedTerms * 2 + (sameStatus ? 1 : 0);
        if (score < 3) continue;
        const reason = sharedTags.length
          ? `共通タグ: ${sharedTags.slice(0, 2).join("・")}`
          : `共通語 ${sharedTerms}件`;
        candidates.push({ left, right, score, reason });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const degree = new Map<string, number>();
    const links: FreeformLink[] = [];
    for (const candidate of candidates) {
      if ((degree.get(candidate.left.id) || 0) >= 4 || (degree.get(candidate.right.id) || 0) >= 4) continue;
      const from = nodeByPage.get(candidate.left.id);
      const to = nodeByPage.get(candidate.right.id);
      if (!from || !to) continue;
      links.push({
        id: nowId("kg-edge"),
        fromId: from.id,
        toId: to.id,
        label: `${candidate.reason} · ${Math.min(99, 55 + candidate.score * 5)}%`,
        color: "#64748b",
        width: 2,
        dashed: candidate.score < 6,
        edgeType: "smoothstep",
        createdAt: now,
      });
      degree.set(candidate.left.id, (degree.get(candidate.left.id) || 0) + 1);
      degree.set(candidate.right.id, (degree.get(candidate.right.id) || 0) + 1);
    }

    return { nodes: [...nodeByPage.values()], links };
  },
};
