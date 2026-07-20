import type { GlossaryTerm } from "../../../shared/types";

const MAX_TEXT = 12_000;
const MAX_TERMS = 500;
const MAX_MATCHES = 12;
const MIN_TERM_MATCH_LENGTH = 2;
// Short aliases are especially ambiguous in Japanese prose (for example 「延長」).
// They remain storable for search/reference, but are not shown as automatic hints.
const MIN_ALIAS_MATCH_LENGTH = 3;

type CompiledGlossaryCandidate = {
  item: GlossaryTerm;
  names: string[];
  longestNameLength: number;
};

export type CompiledGlossary = {
  candidates: CompiledGlossaryCandidate[];
};

const compiledGlossaries = new WeakMap<GlossaryTerm[], CompiledGlossary>();

export function normalizeGlossaryText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds the small matching index only when the glossary array changes. Editor and
 * database updates then only scan the already-normalized, length-sorted names.
 */
export function compileGlossary(terms: GlossaryTerm[]): CompiledGlossary {
  const cached = compiledGlossaries.get(terms);
  if (cached) return cached;
  const candidates = (Array.isArray(terms) ? terms : [])
    .filter(
      (item) =>
        item.status === "verified" &&
        Boolean(item.term) &&
        Boolean(item.summary),
    )
    .slice(0, MAX_TERMS)
    .map((item) => {
      const names = Array.from(
        new Set([
          normalizeGlossaryText(item.term),
          ...(item.aliases ?? [])
            .map(normalizeGlossaryText)
            .filter((name) => name.length >= MIN_ALIAS_MATCH_LENGTH),
        ]),
      )
        .filter((name, index, all) => {
          if (!name) return false;
          // Official terms can be two characters; aliases need a stricter threshold.
          return (
            (index === all.indexOf(normalizeGlossaryText(item.term)) &&
              name.length >= MIN_TERM_MATCH_LENGTH) ||
            name.length >= MIN_ALIAS_MATCH_LENGTH
          );
        })
        .sort((a, b) => b.length - a.length || a.localeCompare(b, "ja-JP"));
      return {
        item,
        names,
        longestNameLength: names[0]?.length ?? 0,
      };
    })
    .filter((candidate) => candidate.names.length > 0)
    .sort(
      (a, b) =>
        b.longestNameLength - a.longestNameLength ||
        a.item.term.localeCompare(b.item.term, "ja-JP"),
    );
  const compiled = { candidates };
  compiledGlossaries.set(terms, compiled);
  return compiled;
}

/**
 * Small, deterministic matcher for UI hints. It intentionally returns only verified,
 * unique terms and never mutates editor content, so typing and virtualized DB rendering stay cheap.
 */
export function findGlossaryMatches(
  text: unknown,
  glossary: CompiledGlossary | GlossaryTerm[],
): GlossaryTerm[] {
  const haystack = normalizeGlossaryText(text).slice(0, MAX_TEXT);
  if (!haystack) return [];
  const compiled = Array.isArray(glossary) ? compileGlossary(glossary) : glossary;
  if (!compiled.candidates.length) return [];

  const matches: GlossaryTerm[] = [];
  for (const candidate of compiled.candidates) {
    if (candidate.names.some((name) => haystack.includes(name))) {
      matches.push(candidate.item);
      if (matches.length >= MAX_MATCHES) break;
    }
  }
  return matches;
}


export type GlossaryInlineEntry = {
  name: string;
  term: GlossaryTerm;
};

/**
 * Rendering-only entries for read mode. The terms stay in BlockNote as plain text;
 * this list is used to add ephemeral hover affordances after BlockNote has rendered.
 */
export function getGlossaryInlineEntries(terms: GlossaryTerm[]): GlossaryInlineEntry[] {
  const compiled = compileGlossary(terms);
  const entries: GlossaryInlineEntry[] = [];
  const seen = new Set<string>();
  for (const candidate of compiled.candidates) {
    const rawNames = [candidate.item.term, ...(candidate.item.aliases ?? [])]
      .map((name) => String(name ?? "").trim())
      .filter(Boolean)
      .filter((name) => {
        const normalized = normalizeGlossaryText(name);
        return normalized.length >= (normalized === normalizeGlossaryText(candidate.item.term) ? MIN_TERM_MATCH_LENGTH : MIN_ALIAS_MATCH_LENGTH);
      });
    for (const name of rawNames) {
      const key = normalizeGlossaryText(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, term: candidate.item });
    }
  }
  return entries.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, "ja-JP"));
}

export type GlossaryNameConflict = {
  name: string;
  termIds: string[];
  terms: string[];
};

/** Used before saving so a hint never points to multiple definitions. */
export function findGlossaryNameConflicts(
  terms: GlossaryTerm[],
): GlossaryNameConflict[] {
  const owners = new Map<string, Array<{ id: string; term: string; name: string }>>();
  for (const item of terms) {
    const names = Array.from(new Set([item.term, ...(item.aliases ?? [])]));
    for (const rawName of names) {
      const name = normalizeGlossaryText(rawName);
      if (name.length < MIN_TERM_MATCH_LENGTH) continue;
      const list = owners.get(name) ?? [];
      if (!list.some((owner) => owner.id === item.id)) {
        list.push({ id: item.id, term: item.term, name: String(rawName).trim() });
      }
      owners.set(name, list);
    }
  }
  return Array.from(owners.values())
    .filter((ownersForName) => ownersForName.length > 1)
    .map((ownersForName) => ({
      name: ownersForName[0]?.name ?? "",
      termIds: ownersForName.map((owner) => owner.id),
      terms: ownersForName.map((owner) => owner.term),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja-JP"));
}

export function glossarySignature(terms: GlossaryTerm[]): string {
  return terms.map((item) => `${item.id}:${item.updatedAt}`).join("|");
}
