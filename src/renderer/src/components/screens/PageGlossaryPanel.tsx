import React, { useMemo, useState } from "react";
import type { GlossaryTerm } from "../../../../shared/types";
import { compileGlossary, normalizeGlossaryText } from "../../lib/glossary";

function clamp(value: string, max = 120): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function findSnippet(text: string, names: string[]): string {
  const normalized = normalizeGlossaryText(text);
  const name = names.find((candidate) => candidate && normalized.includes(candidate));
  if (!name) return "本文内で一致した用語を検出しました。";
  const index = normalized.indexOf(name);
  const raw = text.replace(/\s+/g, " ");
  const start = Math.max(0, index - 36);
  return clamp(`${start > 0 ? "…" : ""}${raw.slice(start, Math.min(raw.length, index + name.length + 72))}${index + name.length + 72 < raw.length ? "…" : ""}`, 150);
}

type PageGlossaryMatch = {
  term: GlossaryTerm;
  matchedNames: string[];
  snippet: string;
  score: number;
};

type UnregisteredTermCandidate = {
  phrase: string;
  count: number;
  snippet: string;
  reason: string;
};

const CANDIDATE_STOP_WORDS = new Set([
  "このページ", "ページ", "本文", "関連", "目次", "ミニマップ", "プロパティ", "未着手", "進行中", "確認待ち", "完了", "保留",
  "verified", "draft", "deprecated", "status", "priority", "updated", "created", "page", "database", "journal",
  "です", "ます", "する", "した", "して", "ある", "いる", "こと", "ため", "よう", "もの", "それ", "これ", "など",
]);

const DOMAIN_SUFFIXES = [
  "制度", "基準", "要綱", "要領", "条例", "規則", "通知", "手引", "手順", "マニュアル", "申請", "届出", "審査", "認定", "判定",
  "委託料", "補助金", "加算", "減免", "利用料", "人件費", "配置", "支援員", "クラブ", "保育", "事業", "会計", "年度",
  "計画", "方針", "運用", "管理", "対象", "根拠", "資料", "FAQ", "OCR", "Index", "Semantic", "Relation",
];

function plainText(markdown: string): string {
  return String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>\-|\[\]{}]/g, " ")
    .replace(/[\t\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeUsefulCandidate(value: string): boolean {
  const text = value.trim();
  if (text.length < 3 || text.length > 24) return false;
  if (CANDIDATE_STOP_WORDS.has(text) || /^page[_\-]/i.test(text)) return false;
  if (/^\d+$/.test(text) || /^20\d{2}$/.test(text) || /^令和\d+$/.test(text)) return false;
  if (/^[a-z0-9_\-]{10,}$/i.test(text)) return false;
  const hasJapanese = /[一-龠々ァ-ヶー]/.test(text);
  const hasKanji = /[一-龠々]/.test(text);
  const hasKatakana = /[ァ-ヶー]{3,}/.test(text);
  const hasAsciiTerm = /[A-Z]{2,}|[A-Za-z]+(?:\.[A-Za-z]+)+/.test(text);
  const domainLike = DOMAIN_SUFFIXES.some((suffix) => text.includes(suffix));
  return Boolean((hasJapanese && (hasKanji || hasKatakana || domainLike)) || hasAsciiTerm);
}

function candidateSnippet(markdown: string, phrase: string): string {
  const raw = String(markdown || "").replace(/\s+/g, " ");
  const index = raw.indexOf(phrase);
  if (index < 0) return "本文内で複数回使われています。用語として登録するか確認できます。";
  const start = Math.max(0, index - 42);
  const end = Math.min(raw.length, index + phrase.length + 78);
  return clamp(`${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`, 150);
}

function extractUnregisteredCandidates(markdown: string, terms: GlossaryTerm[], matches: PageGlossaryMatch[]): UnregisteredTermCandidate[] {
  const text = plainText(markdown).slice(0, 50_000);
  if (!text) return [];
  const registered = new Set<string>();
  for (const term of terms || []) {
    for (const name of [term.term, ...(term.aliases || [])]) {
      const normalized = normalizeGlossaryText(name);
      if (normalized) registered.add(normalized);
    }
  }
  for (const match of matches) {
    registered.add(normalizeGlossaryText(match.term.term));
    match.matchedNames.forEach((name) => registered.add(normalizeGlossaryText(name)));
  }

  const counts = new Map<string, number>();
  const add = (raw: string) => {
    const phrase = raw
      .replace(/^[\s、。，．・:：;；()（）「」『』【】]+|[\s、。，．・:：;；()（）「」『』【】]+$/g, "")
      .replace(/\s+/g, "")
      .trim();
    if (!looksLikeUsefulCandidate(phrase)) return;
    const normalized = normalizeGlossaryText(phrase);
    if (!normalized || registered.has(normalized)) return;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  };

  const suffixPattern = new RegExp(`([一-龠々ァ-ヶーA-Za-z0-9]{2,18}(?:${DOMAIN_SUFFIXES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "g");
  for (const match of text.matchAll(suffixPattern)) add(match[1] || "");

  const bracketPattern = /[「『【]([^」』】]{3,24})[」』】]/g;
  for (const match of text.matchAll(bracketPattern)) add(match[1] || "");

  const compoundPattern = /([一-龠々ァ-ヶー]{2,10}(?:・[一-龠々ァ-ヶー]{2,10}){1,3})/g;
  for (const match of text.matchAll(compoundPattern)) add(match[1] || "");

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], "ja-JP"))
    .slice(0, 8)
    .map(([phrase, count]) => ({
      phrase,
      count,
      snippet: candidateSnippet(markdown, phrase),
      reason: count >= 2 ? `本文で${count}回出現` : "制度名・基準名らしい表現",
    }));
}

export function PageGlossaryPanel({
  markdown,
  terms,
  onOpenGlossaryManager,
}: {
  markdown: string;
  terms: GlossaryTerm[];
  onOpenGlossaryManager?: (draftTerm?: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const matches = useMemo(() => {
    const text = String(markdown || "").slice(0, 60_000);
    const compiled = compileGlossary(terms || []);
    const haystack = normalizeGlossaryText(text);
    if (!haystack || !compiled.candidates.length) return [];
    return compiled.candidates
      .map((candidate) => {
        const matchedNames = candidate.names.filter((name) => name && haystack.includes(name));
        if (!matchedNames.length) return null;
        return {
          term: candidate.item,
          matchedNames,
          snippet: findSnippet(text, matchedNames),
          score: Math.min(99, 70 + Math.min(20, matchedNames.length * 5) + Math.min(9, candidate.longestNameLength)),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score || a.term.term.localeCompare(b.term.term, "ja-JP"))
      .slice(0, 18) as PageGlossaryMatch[];
  }, [markdown, terms]);

  const candidates = useMemo(() => extractUnregisteredCandidates(markdown, terms || [], matches), [markdown, terms, matches]);

  return (
    <aside className="page-glossary-panel-v729 page-glossary-panel-v731" aria-label="ページ内用語">
      <header>
        <div>
          <span>GLOSSARY</span>
          <h3>このページの用語</h3>
          <p>登録済み用語と、未登録かもしれない候補をカードで確認します。開いている時だけ本文を軽く解析します。</p>
        </div>
        <strong>{matches.length}</strong>
      </header>

      <section className="page-glossary-section-v731">
        <div className="page-glossary-section-head-v731">
          <div><b>登録済み用語</b><small>{matches.length}件</small></div>
          {onOpenGlossaryManager && <button type="button" onClick={() => onOpenGlossaryManager()}>用語辞書</button>}
        </div>
        {matches.length ? (
          <div className="page-glossary-list-v729 page-glossary-list-v731">
            {matches.map(({ term, matchedNames, snippet, score }) => {
              const expanded = expandedId === term.id;
              const sourceCount = term.sourcePageIds?.length ?? 0;
              return (
                <article key={term.id} className={`page-glossary-card-v729 page-glossary-card-v731 status-${term.status}`}>
                  <button type="button" className="page-glossary-card-main-v731" onClick={() => setExpandedId(expanded ? null : term.id)}>
                    <span className="page-glossary-term-mark-v731">{term.status === "verified" ? "✓" : term.status === "deprecated" ? "旧" : "下"}</span>
                    <span className="page-glossary-title-v731"><b>{term.term}</b><small>{term.category || "分類なし"}</small></span>
                    <em>{score}</em>
                  </button>
                  <p>{clamp(term.summary, expanded ? 420 : 110)}</p>
                  <div className="page-glossary-metadata-v731">
                    <span>出現 {matchedNames.length}表記</span>
                    <span>別名 {term.aliases?.length ?? 0}</span>
                    <span>補足 {sourceCount}</span>
                  </div>
                  <div className="page-glossary-chips-v729 page-glossary-chips-v731">
                    {matchedNames.slice(0, 4).map((name) => <i key={name}>一致: {name}</i>)}
                    {term.status === "verified" ? <i className="ok">確認済み</i> : <i>{term.status}</i>}
                  </div>
                  {expanded ? <blockquote>{snippet}</blockquote> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="page-glossary-empty-v729">このページで一致する登録済み用語はまだありません。</p>
        )}
      </section>

      <section className="page-glossary-section-v731 page-glossary-candidates-v731">
        <div className="page-glossary-section-head-v731">
          <div><b>未登録かもしれない用語</b><small>{candidates.length}件</small></div>
        </div>
        {candidates.length ? (
          <div className="page-glossary-candidate-list-v731">
            {candidates.map((candidate) => (
              <article key={candidate.phrase} className="page-glossary-candidate-card-v731">
                <div>
                  <strong>{candidate.phrase}</strong>
                  <small>{candidate.reason}</small>
                </div>
                <p>{candidate.snippet}</p>
                <footer>
                  <span>{candidate.count}回</span>
                  {onOpenGlossaryManager && (
                    <button type="button" onClick={() => onOpenGlossaryManager(candidate.phrase)}>用語として作成</button>
                  )}
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <p className="page-glossary-empty-v729">このページ内で、追加確認が必要そうな未登録候補は見つかりませんでした。</p>
        )}
      </section>
    </aside>
  );
}
