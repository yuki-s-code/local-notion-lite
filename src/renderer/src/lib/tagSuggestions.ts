export type TagSuggestion = {
  tag: string;
  score: number;
  matchedIn: "title" | "body" | "both" | "alias" | "related";
  /** Number of pages in the visible workspace that already use this tag. */
  usageCount: number;
  /** Number of pages where this tag is used with one of the current page tags. */
  relatedCount: number;
  /** Current page tags that most often occur with this suggestion. */
  relatedTo: string[];
};

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function cleanTag(value: string): string {
  return value.replace(/^#+/, "").trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  let count = 0;
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    count += 1;
    from = index + needle.length;
  }
  return count;
}

/**
 * Scores only tags already used in the workspace. The function deliberately
 * does not invent tags and does not mutate page properties; callers present
 * its output as user-confirmed candidates.
 */
export function suggestTagsFromContent(input: {
  title: string;
  body: string;
  candidates: string[];
  activeTags?: string[];
  /** Usage counts are a weak tie-breaker only; direct content matches stay dominant. */
  usageCounts?: Record<string, number>;
  /** Co-occurrence counts with tags already selected on the current page. */
  relatedTagCounts?: Record<string, number>;
  /** Human-readable selected tags that co-occur with a candidate. */
  relatedTagLabels?: Record<string, string[]>;
  /** Small local ranking adjustment learned from accepted/dismissed candidates. */
  feedbackScores?: Record<string, number>;
  /** Local aliases such as 学童 -> 放課後児童クラブ. Keys and values are normalized by the caller. */
  aliases?: Record<string, string[]>;
  /** Suggestions dismissed repeatedly are hidden until their feedback changes. */
  hiddenCandidates?: string[];
  limit?: number;
}): TagSuggestion[] {
  const title = normalizeText(input.title);
  const body = normalizeText(input.body);
  const active = new Set((input.activeTags ?? []).map((tag) => normalizeText(cleanTag(tag))));
  const seen = new Set<string>();
  const hidden = new Set((input.hiddenCandidates ?? []).map((tag) => normalizeText(cleanTag(tag))));
  const scored: TagSuggestion[] = [];

  for (const rawCandidate of input.candidates) {
    const tag = cleanTag(rawCandidate);
    const normalized = normalizeText(tag);
    if (!normalized || normalized.length < 2 || active.has(normalized) || seen.has(normalized) || hidden.has(normalized)) continue;
    seen.add(normalized);

    const titleHits = countOccurrences(title, normalized);
    const bodyHits = countOccurrences(body, normalized);
    const aliases = Array.from(
      new Set(
        (input.aliases?.[normalized] ?? [])
          .map(normalizeText)
          .filter((alias) => alias.length >= 2),
      ),
    );
    const titleAliasHits = aliases.reduce((total, alias) => total + countOccurrences(title, alias), 0);
    const bodyAliasHits = aliases.reduce((total, alias) => total + countOccurrences(body, alias), 0);
    let score = Math.min(titleHits, 3) * 30 + Math.min(bodyHits, 8) * 8;
    // Alias matches are useful but intentionally weaker than an exact tag match.
    if (score === 0) score += Math.min(titleAliasHits, 3) * 18 + Math.min(bodyAliasHits, 8) * 5;
    const usageCount = Math.max(0, Number(input.usageCounts?.[normalized] ?? 0));
    const relatedCount = Math.max(0, Number(input.relatedTagCounts?.[normalized] ?? 0));
    const relatedTo = Array.from(new Set(input.relatedTagLabels?.[normalized] ?? []));

    // Tags such as "放課後児童クラブ/学童" can still be useful when one of
    // their meaningful words appears. This is intentionally a weak signal;
    // a direct full-tag match always ranks above it.
    if (score === 0) {
      const parts = normalized
        .split(/[\s\-_/／・,，、】【「」()（）]+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2);
      const uniqueParts = Array.from(new Set(parts));
      const titlePartHits = uniqueParts.filter((part) => title.includes(part)).length;
      const bodyPartHits = uniqueParts.filter((part) => body.includes(part)).length;
      if (titlePartHits >= 2) score += titlePartHits * 6;
      if (bodyPartHits >= 2) score += bodyPartHits * 2;
    }

    // Co-occurrence is a supplementary signal. It can suggest a related tag
    // even when its literal text does not appear, but never outranks a direct
    // title match solely because it is commonly paired in older pages.
    if (score === 0 && relatedCount >= 2) {
      score = 7 + Math.min(relatedCount, 10) * 1.5;
    } else if (score > 0 && relatedCount > 0) {
      score += Math.min(relatedCount, 10) * 0.8;
    }

    if (score <= 0) continue;

    // A tag used on several pages is more likely to be part of the workspace
    // vocabulary. Keep this deliberately small so common but irrelevant tags
    // never outrank a direct title/body match.
    score += Math.min(usageCount, 20) * 0.35;
    // Feedback remains intentionally weak so the page content stays the primary signal.
    score += Math.max(-8, Math.min(8, Number(input.feedbackScores?.[normalized] ?? 0)));

    scored.push({
      tag,
      score,
      matchedIn:
        titleHits > 0 && bodyHits > 0
          ? "both"
          : titleHits > 0
            ? "title"
            : bodyHits > 0
              ? "body"
              : titleAliasHits > 0 || bodyAliasHits > 0
                ? "alias"
                : "related",
      usageCount,
      relatedCount,
      relatedTo,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag, "ja"))
    .slice(0, input.limit ?? 5);
}
