import React, { useMemo, useState } from 'react';
import type { PageProperties, PageWithLock, TaskItem } from '../../../../shared/types';

type Props = {
  pages: PageWithLock[];
  tasks: TaskItem[];
  onOpenPage: (id: string) => void;
  onCreateProject: (title: string) => Promise<void>;
  onAssignPage: (page: PageWithLock, projectId: string) => Promise<void>;
  onBack: () => void;
};

type ProjectStatus = '計画中' | '進行中' | '確認待ち' | '完了' | '保留';
const STATUS: ProjectStatus[] = ['計画中','進行中','確認待ち','完了','保留'];
function propsOf(p: PageWithLock) { return p.properties || ({} as PageProperties); }
function projectPages(pages: PageWithLock[]) { return pages.filter(p => propsOf(p).projectRole === 'project'); }
function statusOf(p: PageWithLock): ProjectStatus { const s = propsOf(p).projectStatus; return STATUS.includes(s as ProjectStatus) ? s as ProjectStatus : '計画中'; }
function dueOf(p: PageWithLock) { return propsOf(p).projectDueDate || propsOf(p).dueDate || ''; }
function iconForStatus(status: ProjectStatus) { return ({ '計画中':'◌','進行中':'↗','確認待ち':'◐','完了':'✓','保留':'—' } as Record<ProjectStatus,string>)[status]; }

export function ProjectHubScreen({ pages, tasks, onOpenPage, onCreateProject, onAssignPage, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignQuery, setAssignQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const projects = useMemo(() => projectPages(pages).filter(p => !query.trim() || `${p.title} ${propsOf(p).projectSummary || ''}`.toLowerCase().includes(query.toLowerCase())), [pages, query]);
  const selected = projects.find(p => p.id === selectedId) || projects[0] || null;
  const members = useMemo(() => selected ? pages.filter(p => propsOf(p).projectId === selected.id && p.id !== selected.id).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) : [], [pages, selected]);
  const linkedTasks = useMemo(() => selected ? tasks.filter(t => members.some(p => p.id === t.sourceId) || t.sourceId === selected.id) : [], [tasks, members, selected]);
  const remaining = linkedTasks.filter(t => !t.completed);
  const candidates = useMemo(() => selected ? pages.filter(p => p.id !== selected.id && propsOf(p).projectRole !== 'project' && !propsOf(p).projectId && (!assignQuery.trim() || p.title.toLowerCase().includes(assignQuery.toLowerCase()))).slice(0, 18) : [], [pages, selected, assignQuery]);
  const countByStatus = (status: ProjectStatus) => projects.filter(p => statusOf(p) === status).length;
  const create = async () => { const title = newTitle.trim(); if (!title) return; try { await onCreateProject(title); setNewTitle(''); setCreating(false); } catch { /* parent reports the operational error */ } };
  const assign = async (page: PageWithLock) => { if (!selected) return; setSavingId(page.id); try { await onAssignPage(page, selected.id); } finally { setSavingId(null); } };

  return <section className="project-hub-screen-v472">
    <header className="project-hub-hero-v472">
      <div><span className="project-hub-eyebrow-v472">WORKSPACE PROJECTS</span><h1>案件・プロジェクト</h1><p>ページ、Wiki、タスク、資料を案件単位でまとめ、今やることと更新状況を一画面で把握します。</p></div>
      <div className="project-hub-hero-actions-v472"><button className="secondary" onClick={onBack}>戻る</button><button className="primary project-new-button-v472" onClick={() => setCreating(v => !v)}>＋ 新しい案件</button></div>
    </header>
    {creating && <div className="project-create-bar-v472"><input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="例：夏休み運営 2026" onKeyDown={e => { if (e.key === 'Enter') void create(); }}/><button className="primary" disabled={!newTitle.trim()} onClick={() => void create()}>作成</button><button onClick={() => { setCreating(false); setNewTitle(''); }}>キャンセル</button></div>}
    <div className="project-overview-v472">
      <button className="project-metric-v472 active"><span>◈</span><b>{projects.length}</b><small>すべての案件</small></button>
      {STATUS.slice(0,4).map(s => <button key={s} className="project-metric-v472"><span>{iconForStatus(s)}</span><b>{countByStatus(s)}</b><small>{s}</small></button>)}
      <div className="project-search-v472"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="案件を検索" /></div>
    </div>
    <div className="project-layout-v472">
      <aside className="project-rail-v472"><div className="project-rail-heading-v472"><b>案件一覧</b><small>{projects.length}件</small></div>{projects.length ? projects.map(p => { const active = selected?.id === p.id; const m = pages.filter(x => propsOf(x).projectId === p.id).length; return <button key={p.id} className={`project-rail-item-v472 ${active ? 'active' : ''}`} onClick={() => setSelectedId(p.id)}><span className={`project-status-dot-v472 ${statusOf(p)}`}>{iconForStatus(statusOf(p))}</span><span><b>{p.title || '無題の案件'}</b><small>{m}件の関連ページ {dueOf(p) ? `・期限 ${dueOf(p)}` : ''}</small></span></button>; }) : <div className="project-empty-rail-v472">まだ案件がありません。<br/>「新しい案件」から作成できます。</div>}</aside>
      <main className="project-detail-v472">{selected ? <>
        <div className="project-detail-head-v472"><div><div className="project-title-line-v472"><span className={`project-status-badge-v472 ${statusOf(selected)}`}>{iconForStatus(statusOf(selected))} {statusOf(selected)}</span><span className="project-scope-v472">{selected.scope === 'private' ? 'このPCだけ' : '共有'}</span></div><h2>{selected.icon || '◈'} {selected.title}</h2><p>{propsOf(selected).projectSummary || propsOf(selected).summary || '案件の概要を追加すると、チームや引継ぎ時に目的が伝わりやすくなります。'}</p></div><button className="secondary" onClick={() => onOpenPage(selected.id)}>案件ページを開く</button></div>
        <div className="project-detail-stats-v472"><div><small>関連ページ</small><b>{members.length}</b></div><div><small>未完了タスク</small><b>{remaining.length}</b></div><div><small>期限</small><b>{dueOf(selected) || '未設定'}</b></div><div><small>最終更新</small><b>{new Date(selected.updatedAt).toLocaleDateString('ja-JP')}</b></div></div>
        <section className="project-section-v472"><div className="project-section-head-v472"><div><span>RELATED WORKSPACE</span><h3>関連ページ・資料</h3></div><button onClick={() => setAssignOpen(v => !v)}>＋ ページを追加</button></div>
          {assignOpen && <div className="project-assign-v472"><input value={assignQuery} onChange={e => setAssignQuery(e.target.value)} placeholder="ページ名で検索して案件へ追加" />{candidates.length ? <div className="project-assign-list-v472">{candidates.map(p => <button key={p.id} disabled={savingId === p.id} onClick={() => void assign(p)}><span>{p.icon || '📄'}</span><span><b>{p.title || '無題'}</b><small>{p.properties?.tags?.slice(0,3).join(' · ') || 'タグなし'}</small></span><em>{savingId === p.id ? '追加中…' : '追加'}</em></button>)}</div> : <small className="project-assign-empty-v472">追加できる未紐付けページがありません。</small>}</div>}
          {members.length ? <div className="project-member-grid-v472">{members.map(p => <button key={p.id} className="project-member-card-v472" onClick={() => onOpenPage(p.id)}><span>{p.icon || '📄'}</span><div><b>{p.title || '無題'}</b><small>{p.properties?.wikiStatus === 'verified' ? '正式版' : p.properties?.status || '未着手'} {p.properties?.dueDate ? `・${p.properties.dueDate}` : ''}</small></div><i>›</i></button>)}</div> : <div className="project-empty-panel-v472">関連ページはまだありません。<br/>「ページを追加」から既存ページを案件に紐付けられます。</div>}
        </section>
        <section className="project-section-v472 project-task-section-v472"><div className="project-section-head-v472"><div><span>NEXT ACTIONS</span><h3>未完了タスク</h3></div><small>{remaining.length}件</small></div>{remaining.length ? <div className="project-task-list-v472">{remaining.slice(0,8).map(t => <button key={t.id} onClick={() => { const page = pages.find(p => p.id === t.sourceId); if (page) onOpenPage(page.id); }}><span>□</span><div><b>{t.text}</b><small>{t.sourceTitle}{t.dueDate ? ` ・期限 ${t.dueDate}` : ''}</small></div></button>)}</div> : <div className="project-empty-panel-v472">この案件に紐づく未完了タスクはありません。</div>}</section>
        <section className="project-ai-callout-v472"><div><span>✦</span><div><b>AIで案件を整理</b><p>案件ページから、進捗要約・未完了事項・次に行うこと・関連FAQ候補をAIに依頼できます。</p></div></div><button onClick={() => onOpenPage(selected.id)}>案件ページでAIを開く</button></section>
      </> : <div className="project-empty-main-v472"><span>◈</span><h2>案件を選択してください</h2><p>案件を作成すると、既存ページやタスクを業務単位でまとめられます。</p></div>}</main>
    </div>
  </section>;
}
