import React, { useMemo, useState } from 'react';

export function PageOutlinePanel({ markdown }: { markdown: string }) {
  const [query, setQuery] = useState('');
  const [maxLevel, setMaxLevel] = useState<1 | 2 | 3>(3);
  const headings = useMemo(() => markdown
    .split(/\r?\n/)
    .map((line, index) => {
      const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      return { index, level: match[1].length as 1 | 2 | 3, title: match[2].trim() };
    })
    .filter((h): h is { index: number; level: 1 | 2 | 3; title: string } => Boolean(h)), [markdown]);
  if (headings.length === 0) return null;
  const filtered = headings
    .filter(h => h.level <= maxLevel)
    .filter(h => !query.trim() || h.title.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 80);
  const counts = [1, 2, 3].map(level => headings.filter(h => h.level === level).length);
  return (
    <section className="outline-panel-v105 outline-panel-v118" aria-label="ページアウトライン">
      <div className="outline-head-v118">
        <div><h3>アウトライン</h3><small>H1 {counts[0]} ・ H2 {counts[1]} ・ H3 {counts[2]}</small></div>
        <select value={maxLevel} onChange={e => setMaxLevel(Number(e.target.value) as 1 | 2 | 3)} title="表示する見出し階層">
          <option value={1}>H1</option>
          <option value={2}>H1-H2</option>
          <option value={3}>H1-H3</option>
        </select>
      </div>
      <input className="outline-search-v118" value={query} onChange={e => setQuery(e.target.value)} placeholder="見出しを検索" />
      <div className="outline-list-v118">
        {filtered.map(h => <button key={h.index} className={`level-${h.level}`} title={h.title}><span>H{h.level}</span><b>{h.title}</b></button>)}
        {filtered.length === 0 && <p className="muted-small">該当する見出しはありません。</p>}
      </div>
    </section>
  );
}


