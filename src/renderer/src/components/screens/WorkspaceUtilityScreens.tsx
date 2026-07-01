import React, { useDeferredValue, useMemo, useState } from 'react';
import type { ConflictInfo, HealthInfo, InboxItem, PageWithLock, TaskItem, WorkspaceDatabase, WorkspaceScope } from '../../../../shared/types';

function formatShortDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function fileKind(fileName = ''): { label: string; icon: string } {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return { label: '画像', icon: '🖼️' };
  if (['pdf'].includes(ext)) return { label: 'PDF', icon: '📕' };
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return { label: 'Office', icon: '📊' };
  if (['zip','7z','rar'].includes(ext)) return { label: '圧縮', icon: '🗜️' };
  if (['mp4','mov','webm'].includes(ext)) return { label: '動画', icon: '🎬' };
  if (['mp3','wav','m4a','aac'].includes(ext)) return { label: '音声', icon: '🎧' };
  return { label: 'その他', icon: '📎' };
}

export function AttachmentManagerView({ items, inboxItems, onOpenPage, onSendToOcr, onOpenOcr }: {
  items: any[];
  inboxItems: InboxItem[];
  onOpenPage: (id: string) => void;
  onSendToOcr: (attachment: any) => Promise<void> | void;
  onOpenOcr: (inboxId: string, attachmentId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [busyKey, setBusyKey] = useState('');
  const kinds = Array.from(new Set(items.map(a => fileKind(a.fileName).label))).sort();
  const filtered = items.filter(a => {
    const k = fileKind(a.fileName).label;
    const hay = `${a.fileName} ${a.pageTitle} ${k}`.toLowerCase();
    return (kind === 'all' || k === kind) && hay.includes(q.toLowerCase());
  });
  const totalSize = items.reduce((sum, a) => sum + Number(a.size || 0), 0);
  const fmtSize = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  const supportsOcr = (name: string) => /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(name || ''));
  return <section className="utility-page-v105 attachment-center-v115">
    <div className="utility-hero-v105"><p className="section-kicker-v61">Files</p><h1>添付ファイル管理センター</h1><p>ページ添付を探し、必要な資料だけOCRセンターへ送れます。OCRの実行・結果確認はOCRセンターに集約されています。</p></div>
    <div className="home-metrics-v105"><div><b>{items.length}</b><span>Files</span></div><div><b>{fmtSize(totalSize)}</b><span>Storage</span></div><div><b>{kinds.length}</b><span>Types</span></div></div>
    <div className="utility-toolbar-v115"><input value={q} onChange={e => setQ(e.target.value)} placeholder="ファイル名・添付元で検索" /><select value={kind} onChange={e => setKind(e.target.value)}><option value="all">すべて</option>{kinds.map(k => <option key={k} value={k}>{k}</option>)}</select></div>
    <div className="attachment-grid-v115">{filtered.length === 0 ? <div className="empty-card-v105">添付ファイルはありません。</div> : filtered.map(a => {
      const fk = fileKind(a.fileName);
      const ocrItem = inboxItems.find(item => item.ocrSource?.sourceType === 'page' && item.ocrSource?.pageId === a.pageId && item.ocrSource?.attachmentId === a.id);
      const ocrFile = ocrItem?.attachments?.[0];
      const ready = ocrFile?.ocr?.status === 'ready' || ocrFile?.pdfText?.status === 'ready';
      const active = ['queued', 'running', 'cancelling'].includes(String(ocrFile?.ocrQueue?.status || ''));
      const failed = ['failed', 'cancelled'].includes(String(ocrFile?.ocrQueue?.status || '')) || ocrFile?.ocr?.status === 'failed' || ocrFile?.pdfText?.status === 'failed';
      const key = `${a.pageId}:${a.id}`;
      return <article key={key} className="attachment-card-v115 attachment-card-ocr-v571"><button type="button" className="attachment-card-main-v571" onClick={() => onOpenPage(a.pageId)}><span>{fk.icon}</span><b>{a.fileName}</b><small>{fk.label} ・ {fmtSize(Number(a.size || 0))}</small><em>{a.pageIcon || '📄'} {a.pageTitle} ・ {formatShortDate(a.createdAt)}</em></button>{supportsOcr(a.fileName) ? <button type="button" className={`attachment-ocr-action-v571 ${ready ? 'is-ready' : active ? 'is-active' : failed ? 'is-failed' : ''}`} disabled={Boolean(busyKey)} onClick={async () => { try { setBusyKey(key); if (ocrItem) onOpenOcr(ocrItem.id, ocrFile?.id || ''); else await onSendToOcr(a); } finally { setBusyKey(''); } }}>{ready ? '結果を見る' : active ? '処理中' : failed ? '再試行' : busyKey === key ? '登録中…' : 'OCRへ送る'}</button> : null}</article>;
    })}</div>
  </section>;
}


export function NotificationCenterView({ dashboard, tasks, inboxItems, brokenLinks, conflicts, onOpenPage, onOpenInbox, onOpenTasks, onOpenLinks, onOpenAdmin }: {
  dashboard: any;
  tasks: TaskItem[];
  inboxItems: InboxItem[];
  brokenLinks: any[];
  conflicts: ConflictInfo[];
  onOpenPage: (id: string) => void;
  onOpenInbox: () => void;
  onOpenTasks: () => void;
  onOpenLinks: () => void;
  onOpenAdmin: () => void;
}) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const overdue = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today);
  const dueToday = tasks.filter(t => !t.completed && t.dueDate === today);
  const activeInbox = inboxItems.filter(i => i.status !== 'archived');
  const items = [
    ...overdue.map(t => ({ key: `overdue-${t.id}`, icon: '⏰', title: t.text, desc: `期限切れ ・ ${t.sourceTitle}`, action: onOpenTasks, level: 'danger' })),
    ...dueToday.map(t => ({ key: `today-${t.id}`, icon: '☑️', title: t.text, desc: `今日が期限 ・ ${t.sourceTitle}`, action: onOpenTasks, level: 'warn' })),
    ...activeInbox.slice(0, 10).map(i => ({ key: `inbox-${i.id}`, icon: '📥', title: i.title, desc: i.text.slice(0, 80), action: onOpenInbox, level: 'normal' })),
    ...brokenLinks.slice(0, 10).map((l, idx) => ({ key: `broken-${idx}`, icon: '🔗', title: l.sourceTitle, desc: `リンク切れ: ${l.targetId}`, action: () => onOpenPage(l.sourcePageId), level: 'warn' })),
    ...conflicts.slice(0, 10).map(c => ({ key: `conflict-${c.id}`, icon: '⚠️', title: `競合: ${c.pageId}`, desc: c.reason || c.createdAt, action: onOpenAdmin, level: 'danger' })),
  ];
  return <section className="utility-page-v105 notification-center-v115">
    <div className="utility-hero-v105"><p className="section-kicker-v61">Notifications</p><h1>通知・未読センター</h1><p>期限、Inbox、リンク切れ、競合など、確認すべき項目をまとめて表示します。</p></div>
    <div className="home-metrics-v105"><div><b>{overdue.length}</b><span>Overdue</span></div><div><b>{dueToday.length}</b><span>Today</span></div><div><b>{activeInbox.length}</b><span>Inbox</span></div><div><b>{brokenLinks.length}</b><span>Broken links</span></div><div><b>{conflicts.length}</b><span>Conflicts</span></div></div>
    <div className="utility-list-v105 notification-list-v115">{items.length === 0 ? <div className="empty-card-v105">確認が必要な通知はありません。</div> : items.map(item => <button key={item.key} className={`notification-item-v115 ${item.level}`} onClick={item.action}><span>{item.icon}</span><b>{item.title}</b><small>{item.desc}</small></button>)}</div>
  </section>;
}

export function LinkManagerView({ brokenLinks, pages, onOpenPage }: { brokenLinks: any[]; pages: PageWithLock[]; onOpenPage: (id: string) => void }) {
  const linkedTargets = new Set<string>();
  for (const p of pages) {
    const text = p.previewSnippet || '';
    if (text.includes('local-page') || text.includes('@[[')) linkedTargets.add(p.id);
  }
  const orphanPages = pages.filter(p => !p.trashed && !p.parentId && !p.favorite).slice(0, 20);
  return <section className="utility-page-v105"><div className="utility-hero-v105"><p className="section-kicker-v61">Links</p><h1>リンク管理</h1><p>リンク切れや孤立ページを確認します。</p></div><div className="home-grid-v105 two"><section className="home-card-v105"><h2>リンク切れ</h2>{brokenLinks.length === 0 ? <p className="muted-small">リンク切れはありません。</p> : brokenLinks.map((l, idx) => <button key={`${l.sourcePageId}-${l.targetId}-${idx}`} onClick={() => onOpenPage(l.sourcePageId)}><span>⚠️</span><b>{l.sourceTitle}</b><small>参照先なし: {l.targetId}</small></button>)}</section><section className="home-card-v105"><h2>孤立候補</h2>{orphanPages.length === 0 ? <p className="muted-small">孤立候補はありません。</p> : orphanPages.map(p => <button key={p.id} onClick={() => onOpenPage(p.id)}><span>{p.icon || '📄'}</span><b>{p.title}</b><small>{formatShortDate(p.updatedAt)}</small></button>)}</section></div></section>;
}


function formatTrashDate(value?: string | null) {
  if (!value) return '日時不明';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

export function TrashCenterView({ items, databases, onOpen, onRestore, onDelete, onRestoreDatabase, onDeleteDatabase, onEmpty, onBack }: {
  items: PageWithLock[];
  databases: WorkspaceDatabase[];
  onOpen: (id: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onRestoreDatabase: (id: string) => void;
  onDeleteDatabase: (id: string) => void;
  onEmpty: () => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | WorkspaceScope>('all');
  const [sort, setSort] = useState<'updated' | 'title'>('updated');
  const deferredQ = useDeferredValue(q.trim().toLowerCase());
  const filtered = useMemo(() => {
    const list = items.filter(item => {
      const matchesScope = scope === 'all' || item.scope === scope;
      const haystack = `${item.title} ${item.previewSnippet ?? ''}`.toLowerCase();
      const matchesText = !deferredQ || haystack.includes(deferredQ);
      return matchesScope && matchesText;
    });
    return [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ja');
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [items, scope, sort, deferredQ]);
  const privateCount = items.filter(item => item.scope === 'private').length + databases.filter(db => db.scope === 'private').length;
  const sharedCount = items.filter(item => item.scope !== 'private').length + databases.filter(db => db.scope !== 'private').length;
  const totalTrashCount = items.length + databases.length;
  return <section className="trash-center-v165">
    <div className="trash-hero-v165">
      <div className="trash-hero-copy-v165">
        <span className="section-kicker-v61">Trash</span>
        <h1><span>🗑️</span> ゴミ箱</h1>
        <p>削除済みページを確認し、必要なものは復元できます。完全削除する前に内容と保存範囲を確認してください。</p>
      </div>
      <div className="trash-hero-actions-v165">
        <button className="secondary" onClick={onBack}>← ページツリーへ</button>
        <button className="danger" onClick={onEmpty} disabled={totalTrashCount === 0}>ゴミ箱を空にする</button>
      </div>
    </div>

    <div className="trash-metrics-v165">
      <div><b>{totalTrashCount}</b><span>削除済み</span></div>
      <div><b>{sharedCount}</b><span>🌐 Shared</span></div>
      <div><b>{privateCount}</b><span>🔒 Private</span></div>
      <div><b>{filtered.length}</b><span>表示中</span></div>
    </div>

    <div className="trash-toolbar-v165">
      <label className="trash-search-v165"><span>⌕</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="タイトル・本文プレビューで検索" /></label>
      <div className="trash-filter-pills-v165">
        <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>すべて</button>
        <button className={scope === 'shared' ? 'active' : ''} onClick={() => setScope('shared')}>🌐 Shared</button>
        <button className={scope === 'private' ? 'active' : ''} onClick={() => setScope('private')}>🔒 Private</button>
      </div>
      <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="並び替え">
        <option value="updated">更新が新しい順</option>
        <option value="title">タイトル順</option>
      </select>
    </div>

    {totalTrashCount === 0 ? <div className="trash-empty-v165">
      <span>✨</span><h2>ゴミ箱は空です</h2><p>削除済みページ・データベースはありません。ページツリーから作業を続けられます。</p><button className="primary" onClick={onBack}>ページツリーへ戻る</button>
    </div> : filtered.length === 0 && databases.length === 0 ? <div className="trash-empty-v165 compact"><span>🔎</span><h2>該当する削除済み項目がありません</h2><p>検索語や保存範囲フィルターを変更してください。</p></div> : <>
      {filtered.length > 0 && <div className="trash-grid-v165">
        {filtered.map(page => <article key={page.id} className="trash-card-v165">
          <div className="trash-card-top-v165">
            <div className="trash-card-icon-v165">{page.icon ?? '📄'}</div>
            <div className="trash-card-title-v165">
              <button onClick={() => onOpen(page.id)} title={page.title}>{page.title}</button>
              <div><span className={`trash-scope-badge-v165 ${page.scope === 'private' ? 'private' : 'shared'}`}>{page.scope === 'private' ? '🔒 Private' : '🌐 Shared'}</span><span>更新 {formatTrashDate(page.updatedAt)}</span></div>
            </div>
          </div>
          {page.previewSnippet ? <p className="trash-preview-v165">{page.previewSnippet}</p> : <p className="trash-preview-v165 muted">本文プレビューはありません</p>}
          <div className="trash-card-actions-v165">
            <button className="primary" onClick={() => onRestore(page.id)}>↩ 復元</button>
            <button className="secondary" onClick={() => onOpen(page.id)}>内容を見る</button>
            <button className="danger ghost-danger-v165" onClick={() => onDelete(page.id)}>完全削除</button>
          </div>
        </article>)}
      </div>}
      {databases.length > 0 && <div className="trash-grid-v165">
        {databases.map(db => <article key={db.id} className="trash-card-v165">
          <div className="trash-card-top-v165">
            <div className="trash-card-icon-v165">🗃️</div>
            <div className="trash-card-title-v165">
              <button title={db.title}>{db.title}</button>
              <div><span className={`trash-scope-badge-v165 ${db.scope === 'private' ? 'private' : 'shared'}`}>{db.scope === 'private' ? '🔒 Private DB' : '🌐 Shared DB'}</span><span>削除 {formatTrashDate((db as any).deletedAt ?? db.updatedAt)}</span></div>
            </div>
          </div>
          <p className="trash-preview-v165">{db.rows.length}行・{db.properties.length}プロパティ。復元するとデータベース一覧に戻ります。</p>
          <div className="trash-card-actions-v165">
            <button className="primary" onClick={() => onRestoreDatabase(db.id)}>↩ DBを復元</button>
            <button className="danger ghost-danger-v165" onClick={() => onDeleteDatabase(db.id)}>完全削除</button>
          </div>
        </article>)}
      </div>}
    </>}
  </section>;
}

export function WorkspaceAdminView({ health, conflicts, trashCount, dashboard, onSync, onOpenBackup }: { health: HealthInfo | null; conflicts: ConflictInfo[]; trashCount: number; dashboard: any; onSync: () => void; onOpenBackup?: () => void }) {
  return <section className="utility-page-v105"><div className="utility-hero-v105"><p className="section-kicker-v61">Admin</p><h1>共有フォルダ管理</h1><p>同期状態、SQLite、競合、削除済みデータを確認します。</p></div><div className="home-metrics-v105"><div><b>{health?.ok ? 'OK' : '-'}</b><span>API</span></div><div><b>{health?.sqlite?.available ? 'OK' : '-'}</b><span>SQLite</span></div><div><b>{conflicts.length}</b><span>Conflicts</span></div><div><b>{trashCount}</b><span>Trash</span></div><div><b>{dashboard?.counts?.attachments ?? 0}</b><span>Files</span></div></div><div className="utility-list-v105"><button onClick={onSync}><span>↻</span><b>共有フォルダから再同期</b><small>{health?.sharedRoot || '共有フォルダ未設定'}</small></button>{onOpenBackup && <button onClick={onOpenBackup}><span>🛟</span><b>バックアップ・復元センター</b><small>履歴、削除済みデータ、競合をまとめて確認</small></button>}<div className="empty-card-v105"><b>SQLite</b><small>{health?.sqlite?.path || health?.localDbPath || '確認中'}</small></div>{conflicts.map(c => <div key={c.id} className="empty-card-v105"><b>競合: {c.pageId}</b><small>{c.createdAt} ・ {c.reason}</small></div>)}</div></section>;
}


export function BackupCenterView({ items, trash, conflicts, attachments, dashboard, onRestore, onOpenPage, onOpenAdmin, onSync }: {
  items: any[];
  trash: PageWithLock[];
  conflicts: ConflictInfo[];
  attachments: any[];
  dashboard: any;
  onRestore: (id: string) => void;
  onOpenPage: (id: string) => void;
  onOpenAdmin: () => void;
  onSync: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'page_history' | 'deleted_page' | 'deleted_database' | 'deleted_journal' | 'conflict'>('all');
  const [q, setQ] = useState('');
  const filtered = items.filter(item => (filter === 'all' || item.type === filter) && `${item.title} ${item.id} ${item.type}`.toLowerCase().includes(q.toLowerCase())).slice(0, 120);
  const totalSize = items.reduce((sum, item) => sum + Number(item.size || 0), 0);
  const fmtSize = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
  const label = (type: string) => type === 'page_history' ? 'ページ履歴' : type === 'deleted_page' ? '削除ページ' : type === 'deleted_database' ? '削除DB' : type === 'deleted_journal' ? '削除Journal' : type;
  const icon = (type: string) => type === 'page_history' ? '🕘' : type === 'deleted_page' ? '📄' : type === 'deleted_database' ? '🗃️' : type === 'deleted_journal' ? '📅' : '🧩';
  return (
    <section className="backup-center-v110">
      <div className="backup-hero-v110">
        <div>
          <p className="section-kicker-v61">Recovery center</p>
          <h1>バックアップ・復元センター</h1>
          <p>ページ履歴、削除済みデータ、競合、添付の状態をまとめて確認できます。</p>
        </div>
        <div className="backup-actions-v110">
          <button onClick={onSync} title="再同期">↻</button>
          <button onClick={onOpenAdmin} title="共有フォルダ管理">⚙</button>
        </div>
      </div>
      <div className="backup-metrics-v110">
        <div><b>{items.length}</b><span>Backups</span></div>
        <div><b>{trash.length}</b><span>Trash</span></div>
        <div><b>{conflicts.length}</b><span>Conflicts</span></div>
        <div><b>{attachments.length}</b><span>Files</span></div>
        <div><b>{fmtSize(totalSize)}</b><span>Stored</span></div>
      </div>
      <div className="backup-layout-v110">
        <aside className="backup-sidebar-v110">
          {(['all','page_history','deleted_page','deleted_database','deleted_journal'] as const).map(type => <button key={type} className={filter === type ? 'active' : ''} onClick={() => setFilter(type)}>{type === 'all' ? '✨ すべて' : `${icon(type)} ${label(type)}`}</button>)}
          <div className="backup-hint-v110">復元前の状態は通常の保存処理により必要に応じて履歴へ退避されます。</div>
        </aside>
        <main className="backup-main-v110">
          <div className="backup-search-v110"><input value={q} onChange={e => setQ(e.target.value)} placeholder="バックアップを検索" /></div>
          {filtered.length === 0 ? <div className="empty-card-v105">該当するバックアップはありません。</div> : filtered.map(item => (
            <div className="backup-item-v110" key={item.id}>
              <div className="backup-item-icon-v110">{icon(item.type)}</div>
              <div className="backup-item-body-v110">
                <div><strong>{item.title}</strong><span>{label(item.type)}</span></div>
                <small>{new Date(item.createdAt).toLocaleString()} ・ {fmtSize(Number(item.size || 0))}{item.count ? ` ・ ${item.count} items` : ''}</small>
                <code>{item.path || item.id}</code>
              </div>
              <div className="backup-item-actions-v110">
                {item.pageId && <button className="secondary" onClick={() => onOpenPage(item.pageId)} title="ページを開く">↗</button>}
                <button disabled={!item.restoreable} onClick={() => onRestore(item.id)} title="復元">復元</button>
              </div>
            </div>
          ))}
        </main>
      </div>
    </section>
  );
}


