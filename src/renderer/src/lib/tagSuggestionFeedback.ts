export type TagSuggestionFeedback = {
  accepted: number;
  dismissed: number;
  updatedAt: string;
};

export type TagSuggestionFeedbackMap = Record<string, TagSuggestionFeedback>;

const STORAGE_KEY = "local-notion:tag-suggestion-feedback:v1";

function normalizeTag(value: string): string {
  return value.replace(/^#+/, "").trim().normalize("NFKC").toLocaleLowerCase("ja-JP");
}

function emptyFeedback(): TagSuggestionFeedback {
  return { accepted: 0, dismissed: 0, updatedAt: new Date(0).toISOString() };
}

export function loadTagSuggestionFeedback(): TagSuggestionFeedbackMap {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    const result: TagSuggestionFeedbackMap = {};
    for (const [rawTag, rawValue] of Object.entries(raw as Record<string, unknown>)) {
      if (!rawValue || typeof rawValue !== "object") continue;
      const value = rawValue as Partial<TagSuggestionFeedback>;
      const tag = normalizeTag(rawTag);
      if (!tag) continue;
      result[tag] = {
        accepted: Math.max(0, Number(value.accepted) || 0),
        dismissed: Math.max(0, Number(value.dismissed) || 0),
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
      };
    }
    return result;
  } catch {
    return {};
  }
}

function persist(feedback: TagSuggestionFeedbackMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
  } catch {
    // Tag ranking remains usable even when browser storage is unavailable.
  }
}

export function recordTagSuggestionFeedback(
  current: TagSuggestionFeedbackMap,
  tag: string,
  kind: "accepted" | "dismissed",
): TagSuggestionFeedbackMap {
  const key = normalizeTag(tag);
  if (!key) return current;
  const previous = current[key] ?? emptyFeedback();
  const next: TagSuggestionFeedbackMap = {
    ...current,
    [key]: {
      ...previous,
      [kind]: previous[kind] + 1,
      updatedAt: new Date().toISOString(),
    },
  };
  persist(next);
  return next;
}

/**
 * A deliberately small adjustment: direct title/body matches always dominate.
 * Accepted suggestions rise slightly; repeated dismissals sink and can disappear.
 */
export function getTagSuggestionFeedbackScore(value: TagSuggestionFeedback | undefined): number {
  if (!value) return 0;
  return Math.min(value.accepted, 8) * 1.2 - Math.min(value.dismissed, 8) * 1.6;
}

export function shouldHideDismissedSuggestion(value: TagSuggestionFeedback | undefined): boolean {
  return Boolean(value && value.dismissed >= 3 && value.dismissed > value.accepted * 2);
}
