export type TaggablePage = {
  id: string;
  properties?: { tags?: string[] };
};

export function normalizeTagFilterKey(value: string): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/^#+/, "")
    .trim();
}

/**
 * Returns pages that have every selected tag. Empty filters intentionally return
 * all pages so the caller can use the helper for an unfiltered page browser.
 */
export function filterPagesByTags<T extends TaggablePage>(pages: T[], selectedTags: string[]): T[] {
  const selected = Array.from(new Set(selectedTags.map(normalizeTagFilterKey).filter(Boolean)));
  if (selected.length === 0) return pages;

  return pages.filter((page) => {
    const pageTags = new Set((page.properties?.tags ?? []).map(normalizeTagFilterKey));
    return selected.every((tag) => pageTags.has(tag));
  });
}
