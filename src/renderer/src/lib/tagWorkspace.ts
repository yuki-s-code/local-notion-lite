import type { PageWithLock } from '../../../shared/types';
import type { TagAliasMap } from './tagAliases';

export function normalizeTagKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/^#+/, '').trim();
}

export type WorkspaceTagStat = { tag: string; count: number; aliases: string[] };
export type SimilarWorkspaceTagCandidate = {
  sourceTag: string;
  targetTag: string;
  score: number;
  reasons: string[];
};

export function getWorkspaceTagStats(pages: PageWithLock[], aliases: TagAliasMap): WorkspaceTagStat[] {
  const counts = new Map<string, { count: number; labels: Map<string, number> }>();
  for (const page of pages) {
    const unique = new Set<string>();
    for (const raw of page.properties?.tags ?? []) {
      const tag = raw.replace(/^#+/, '').trim();
      const key = normalizeTagKey(tag);
      if (!key || unique.has(key)) continue;
      unique.add(key);
      const current = counts.get(key) ?? { count: 0, labels: new Map<string, number>() };
      current.count += 1;
      current.labels.set(tag, (current.labels.get(tag) ?? 0) + 1);
      counts.set(key, current);
    }
  }
  // Alias-only definitions are also surfaced with count 0. They are the only
  // persistent representation of an unused tag, so exposing them enables safe
  // cleanup without touching page metadata.
  for (const rawKey of Object.keys(aliases)) {
    const key = normalizeTagKey(rawKey);
    if (!key || counts.has(key)) continue;
    counts.set(key, { count: 0, labels: new Map([[key, 1]]) });
  }

  return Array.from(counts.entries())
    .map(([key, item]) => {
      const tag = Array.from(item.labels.entries())
        .sort(([leftLabel, leftCount], [rightLabel, rightCount]) => rightCount - leftCount || leftLabel.localeCompare(rightLabel, 'ja'))[0]?.[0] ?? key;
      return { tag, count: item.count, aliases: aliases[key] ?? [] };
    })
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}

function bigramDice(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value: string) => {
    const output: string[] = [];
    for (let index = 0; index < value.length - 1; index += 1) output.push(value.slice(index, index + 2));
    return output.length > 0 ? output : [value];
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const rightCounts = new Map<string, number>();
  rightGrams.forEach((gram) => rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1));
  let overlap = 0;
  leftGrams.forEach((gram) => {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(gram, count - 1);
    }
  });
  return (2 * overlap) / (leftGrams.length + rightGrams.length);
}

function candidateDirection(left: WorkspaceTagStat, right: WorkspaceTagStat): [WorkspaceTagStat, WorkspaceTagStat] {
  if (left.count !== right.count) return left.count < right.count ? [left, right] : [right, left];
  const leftKey = normalizeTagKey(left.tag);
  const rightKey = normalizeTagKey(right.tag);
  if (leftKey.length !== rightKey.length) return leftKey.length < rightKey.length ? [left, right] : [right, left];
  return left.tag.localeCompare(right.tag, 'ja') <= 0 ? [right, left] : [left, right];
}

/**
 * Finds conservative merge candidates. It never changes tags automatically:
 * the result is only a review queue for an explicit user-confirmed merge.
 */
export function getSimilarWorkspaceTagCandidates(
  stats: WorkspaceTagStat[],
  aliases: TagAliasMap,
  limit = 12,
): SimilarWorkspaceTagCandidate[] {
  const candidates: SimilarWorkspaceTagCandidate[] = [];
  for (let leftIndex = 0; leftIndex < stats.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < stats.length; rightIndex += 1) {
      const left = stats[leftIndex];
      const right = stats[rightIndex];
      const leftKey = normalizeTagKey(left.tag);
      const rightKey = normalizeTagKey(right.tag);
      if (!leftKey || !rightKey || leftKey === rightKey) continue;

      const leftTerms = [leftKey, ...(aliases[leftKey] ?? []).map(normalizeTagKey)].filter(Boolean);
      const rightTerms = [rightKey, ...(aliases[rightKey] ?? []).map(normalizeTagKey)].filter(Boolean);
      const directAlias = leftTerms.includes(rightKey) || rightTerms.includes(leftKey);
      let contains = false;
      let lexicalScore = 0;
      for (const leftTerm of leftTerms) {
        for (const rightTerm of rightTerms) {
          if (leftTerm === rightTerm) continue;
          if (leftTerm.length >= 3 && rightTerm.length >= 3 && (leftTerm.includes(rightTerm) || rightTerm.includes(leftTerm))) contains = true;
          lexicalScore = Math.max(lexicalScore, bigramDice(leftTerm, rightTerm));
        }
      }

      // Avoid noisy short Japanese terms. Candidate must have explicit alias evidence,
      // a meaningful containment relation, or a very high lexical match.
      if (!directAlias && !contains && lexicalScore < 0.78) continue;
      const reasons: string[] = [];
      if (directAlias) reasons.push('別名辞書で相互に結び付いています');
      if (contains) reasons.push('タグ名または別名に包含関係があります');
      if (lexicalScore >= 0.78) reasons.push(`表記の近さ ${Math.round(lexicalScore * 100)}%`);
      const score = Math.min(99, Math.max(
        directAlias ? 96 : 0,
        contains ? 82 : 0,
        Math.round(lexicalScore * 100),
      ));
      const [source, target] = candidateDirection(left, right);
      candidates.push({ sourceTag: source.tag, targetTag: target.tag, score, reasons });
    }
  }
  return candidates
    .sort((left, right) => right.score - left.score || left.sourceTag.localeCompare(right.sourceTag, 'ja'))
    .slice(0, limit);
}

export function replaceTagInList(tags: string[], from: string, to: string): string[] {
  const fromKey = normalizeTagKey(from);
  const toLabel = to.replace(/^#+/, '').trim();
  if (!fromKey || !toLabel) return tags;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const value = normalizeTagKey(raw) === fromKey ? toLabel : raw.replace(/^#+/, '').trim();
    const key = normalizeTagKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function moveTagAliases(
  current: TagAliasMap,
  from: string,
  to: string,
  options: { preserveSourceAsAlias?: boolean } = {},
): TagAliasMap {
  const fromKey = normalizeTagKey(from);
  const toKey = normalizeTagKey(to);
  if (!fromKey || !toKey || fromKey === toKey) return current;

  const next: TagAliasMap = { ...current };
  const sourceLabel = from.replace(/^#+/, '').trim();
  const combined = [
    ...(next[toKey] ?? []),
    ...(next[fromKey] ?? []),
    ...(options.preserveSourceAsAlias ? [sourceLabel] : []),
  ]
    .map(normalizeTagKey)
    .filter((alias) => alias && alias !== toKey);

  delete next[fromKey];
  if (combined.length > 0) next[toKey] = Array.from(new Set(combined));
  else delete next[toKey];
  return next;
}
