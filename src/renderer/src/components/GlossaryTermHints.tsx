import { useMemo, useState } from "react";
import type { GlossaryTerm } from "../../../shared/types";
import { compileGlossary, findGlossaryMatches } from "../lib/glossary";

type Props = {
  text: string;
  terms?: GlossaryTerm[];
  compact?: boolean;
  onOpenSourcePage?: (pageId: string) => void;
  onManage?: () => void;
};

export function GlossaryTermHints({
  text,
  terms = [],
  compact = false,
  onOpenSourcePage,
  onManage,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const compiledGlossary = useMemo(() => compileGlossary(terms), [terms]);
  const matches = useMemo(
    () => findGlossaryMatches(text, compiledGlossary),
    [text, compiledGlossary],
  );
  if (!matches.length) return null;
  const active = matches.find((item) => item.id === openId) ?? null;
  return (
    <section
      className={`glossary-term-hints${compact ? " is-compact" : ""}`}
      aria-label="この内容に含まれる用語"
    >
      <div className="glossary-term-hints-head">
        <span aria-hidden="true">✦</span>
        <strong>用語ガイド</strong>
        <small>{matches.length}件</small>
        {onManage && (
          <button type="button" onClick={onManage}>
            辞書を開く
          </button>
        )}
      </div>
      <div className="glossary-term-chip-list">
        {matches.map((item) => (
          <button
            key={item.id}
            type="button"
            className={active?.id === item.id ? "is-active" : ""}
            onClick={() => setOpenId(active?.id === item.id ? null : item.id)}
          >
            {item.term}
          </button>
        ))}
      </div>
      {active && (
        <div className="glossary-term-card" role="status">
          <div>
            <strong>{active.term}</strong>
            <span>{active.status === "verified" ? "確認済み" : "下書き"}</span>
          </div>
          <p>{active.summary}</p>
          {active.aliases.length > 0 && (
            <small>別名：{active.aliases.join("、")}</small>
          )}
          {active.sourcePageIds.length > 0 && onOpenSourcePage && (
            <button
              type="button"
              className="glossary-term-source"
              onClick={() => onOpenSourcePage(active.sourcePageIds[0])}
            >
              補足資料を開く
            </button>
          )}
        </div>
      )}
    </section>
  );
}
