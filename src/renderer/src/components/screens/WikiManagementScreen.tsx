import React, { useEffect, useMemo, useState } from "react";
import type { PageWithLock, PageProperties, WikiUpdateDigest } from "../../../../shared/types";
import type { ApiClient } from "../../lib/api";

type Props = {
  api: ApiClient | null;
  pages: PageWithLock[];
  onOpenPage: (id: string) => void;
  onAskAi: (pageId: string, digest: WikiUpdateDigest) => void;
  onUpdateProperties: (page: PageWithLock, properties: PageProperties) => Promise<void>;
  onBack: () => void;
};

type FilterKey = "all" | "verified" | "review" | "overdue" | "archived" | "missing";

const labels = {
  draft: ["下書き", "draft"], verified: ["正式版", "verified"], review: ["確認待ち", "review"], archived: ["廃止", "archived"],
} as const;

function getWiki(p: PageWithLock) {
  const x = p.properties || ({} as PageProperties);
  return { wikiStatus: x.wikiStatus || "draft", wikiVerifiedAt: x.wikiVerifiedAt || "", wikiReviewDue: x.wikiReviewDue || "", wikiOwner: x.wikiOwner || "", wikiSource: x.wikiSource || "", wikiSuccessorId: x.wikiSuccessorId || "" } as const;
}
function overdue(p: PageWithLock) { const due = getWiki(p).wikiReviewDue; return Boolean(due && due < new Date().toISOString().slice(0, 10)); }
function dateLabel(value: string) { return value ? new Date(value).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }

export function WikiManagementScreen({ api, pages, onOpenPage, onAskAi, onUpdateProperties, onBack }: Props) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [updates, setUpdates] = useState<WikiUpdateDigest[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(true);
  const refreshUpdates = async () => {
    if (!api) return;
    setLoadingUpdates(true);
    try { setUpdates(await api.listWikiUpdates(8)); } catch { setUpdates([]); } finally { setLoadingUpdates(false); }
  };
  useEffect(() => { void refreshUpdates(); }, [api, pages.length]);
  const counts = useMemo(() => ({
    all: pages.length, verified: pages.filter(p => getWiki(p).wikiStatus === "verified").length, review: pages.filter(p => getWiki(p).wikiStatus === "review").length,
    overdue: pages.filter(overdue).length, archived: pages.filter(p => getWiki(p).wikiStatus === "archived").length, missing: pages.filter(p => !getWiki(p).wikiSource).length,
  }), [pages]);
  const list = useMemo(() => pages.filter(p => {
    const w = getWiki(p); const q = query.trim().toLowerCase();
    if (q && !`${p.title} ${w.wikiOwner} ${w.wikiSource}`.toLowerCase().includes(q)) return false;
    if (filter === "all") return true; if (filter === "overdue") return overdue(p); if (filter === "missing") return !w.wikiSource; return w.wikiStatus === filter;
  }).sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || b.updatedAt.localeCompare(a.updatedAt)), [pages, filter, query]);
  const quickSet = async (page: PageWithLock, wikiStatus: "verified" | "review" | "archived") => {
    setSaving(page.id); try { const today = new Date().toISOString().slice(0, 10); await onUpdateProperties(page, { ...page.properties, wikiStatus, wikiVerifiedAt: wikiStatus === "verified" ? today : page.properties.wikiVerifiedAt || "", wikiReviewDue: wikiStatus === "verified" && !page.properties.wikiReviewDue ? `${new Date().getFullYear() + 1}-${today.slice(5)}` : page.properties.wikiReviewDue || "" }); await refreshUpdates(); } finally { setSaving(null); }
  };
  return <section className="wiki-management-screen-v469 wiki-management-screen-v471">
    <header className="wiki-hero-v469"><div><span className="wiki-eyebrow-v469">WORKSPACE WIKI</span><h1>Wiki管理</h1><p>正式情報・確認期限・根拠資料を管理します。更新内容は履歴から要約し、必要なときだけAIで確認できます。</p></div><button className="secondary" onClick={onBack}>戻る</button></header>
    <section className="wiki-updates-v471" aria-label="正式版の更新">
      <div className="wiki-updates-header-v471"><div><span className="wiki-updates-kicker-v471">VERIFIED PAGE UPDATES</span><h2>正式版の更新</h2><p>履歴との差分から、最近変更された正式情報を確認できます。</p></div><div><button className="secondary wiki-update-refresh-v471" onClick={() => void refreshUpdates()} disabled={loadingUpdates}>{loadingUpdates ? "確認中…" : "更新"}</button><button className="wiki-update-collapse-v471" onClick={() => setUpdatesOpen(v => !v)}>{updatesOpen ? "折りたたむ" : "表示する"}</button></div></div>
      {updatesOpen && <div className="wiki-update-list-v471">{loadingUpdates ? <div className="wiki-update-empty-v471">更新履歴を確認しています…</div> : updates.length ? updates.map(update => <article className="wiki-update-item-v471" key={update.pageId}><button className="wiki-update-title-v471" onClick={() => onOpenPage(update.pageId)}><span>{update.icon || "📘"}</span><strong>{update.title}</strong><small>{dateLabel(update.updatedAt)} 更新</small></button><div className="wiki-update-content-v471"><div className="wiki-update-counts-v471"><b>+{update.addedCount}</b><span>追加</span><b>−{update.removedCount}</b><span>削除・変更</span></div><ul>{update.summary.slice(0, 3).map((line, index) => <li key={index}>{line}</li>)}</ul></div><div className="wiki-update-actions-v471"><button onClick={() => onOpenPage(update.pageId)}>差分を見る</button><button className="primary" onClick={() => onAskAi(update.pageId, update)}>AIで要約</button></div></article>) : <div className="wiki-update-empty-v471">最近の正式版更新はありません。正式版ページを更新すると、ここに変更の要点が表示されます。</div>}</div>}
    </section>
    <div className="wiki-stat-grid-v469">{([['all','すべて','📚'],['verified','正式版','✓'],['review','確認待ち','◌'],['overdue','期限切れ','!'],['missing','根拠未設定','⌁']] as [FilterKey,string,string][]).map(([key,label,icon]) => <button key={key} onClick={() => setFilter(key)} className={`wiki-stat-card-v469 ${filter === key ? 'active' : ''}`}><span>{icon}</span><strong>{counts[key]}</strong><small>{label}</small></button>)}</div>
    <div className="wiki-toolbar-v469"><div className="wiki-filter-pills-v469">{([['all','すべて'],['verified','正式版'],['review','確認待ち'],['overdue','期限切れ'],['archived','廃止'],['missing','根拠未設定']] as [FilterKey,string][]).map(([key,label])=><button key={key} onClick={() => setFilter(key)} className={filter === key ? 'active' : ''}>{label}<b>{counts[key]}</b></button>)}</div><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ページ名・責任者・根拠で検索" /></div>
    <div className="wiki-list-card-v469"><div className="wiki-list-head-v469"><span>ページ</span><span>状態</span><span>最終確認</span><span>次回確認</span><span>責任者 / 根拠</span><span>操作</span></div>{list.length ? list.map(page => { const w=getWiki(page); const [label,kind]=labels[w.wikiStatus as keyof typeof labels] || labels.draft; const successor=pages.find(x=>x.id===w.wikiSuccessorId); return <div className={`wiki-row-v469 ${overdue(page) ? 'is-overdue' : ''}`} key={page.id}><button className="wiki-page-title-v469" onClick={() => onOpenPage(page.id)}><span>{page.icon || '📄'}</span><b>{page.title || '無題'}</b>{successor&&<small>後継：{successor.title}</small>}</button><span className={`wiki-status-badge-v469 ${kind}`}>{label}</span><span>{w.wikiVerifiedAt || '—'}</span><span className={overdue(page) ? 'wiki-date-warning-v469' : ''}>{w.wikiReviewDue || '—'}</span><div className="wiki-owner-source-v469"><b>{w.wikiOwner || '未設定'}</b><small>{w.wikiSource || '根拠未設定'}</small></div><div className="wiki-row-actions-v469"><button disabled={saving === page.id} title="正式版にする" onClick={() => void quickSet(page,'verified')}>✓</button><button disabled={saving === page.id} title="確認待ちにする" onClick={() => void quickSet(page,'review')}>◌</button><button disabled={saving === page.id} title="廃止にする" onClick={() => void quickSet(page,'archived')}>⌫</button></div></div>}) : <div className="wiki-empty-v469">条件に合うページはありません。</div>}</div>
    <section className="wiki-guide-v469"><div><span>1</span><b>正式版にする</b><p>内容を確認したページを正式版にします。</p></div><div><span>2</span><b>更新を確認する</b><p>差分の要点を確認し、必要ならAIで深掘りします。</p></div><div><span>3</span><b>根拠を記録する</b><p>PDFや規程名を残し、AIの回答品質を上げます。</p></div></section>
  </section>;
}
