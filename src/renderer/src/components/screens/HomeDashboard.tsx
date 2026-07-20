import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readRecentWorkspaceItems } from '../../lib/recentWorkspace';
import { addCollectionItemToDefaultShelf, addCollectionItemToShelf, readCollectionShelves, removeCollectionShelfById, writeCollectionShelves, type CollectionShelf, type CollectionShelfItem } from '../../lib/collectionShelves';
import { AiActivityLogPanel, useAiActivityLog } from './AiActivityLogPanel';

type RecentDatabase = {
  id: string;
  title: string;
  scope?: 'shared' | 'private' | string;
  updatedAt?: string;
  rowCount?: number;
  propertyCount?: number;
  viewCount?: number;
};

type StoredWorkbench = {
  tabs?: string[];
  pinned?: string[];
  closedTabs?: Array<{ key?: string; pinned?: boolean; closedAt?: number; title?: string; icon?: string }>;
  tabMeta?: Record<string, { title?: string; icon?: string }>;
};

const WORKBENCH_STORAGE_KEY = 'local-notion:workspace-workbench-v518';
type CollectionItem = CollectionShelfItem;

const COLLECTION_SHELF_THEMES = ['violet', 'forest', 'amber', 'ocean', 'rose'] as const;
type CollectionShelfTheme = typeof COLLECTION_SHELF_THEMES[number];

/**
 * Returns a stable visual theme for each local-only shelf.
 * This intentionally depends only on the shelf ID: opening, editing, or
 * reordering shelves must never make their bookcase colour unexpectedly change.
 */
function getCollectionShelfTheme(shelfId: string): CollectionShelfTheme {
  let hash = 0;
  for (let index = 0; index < shelfId.length; index += 1) {
    hash = ((hash * 31) + shelfId.charCodeAt(index)) | 0;
  }
  return COLLECTION_SHELF_THEMES[Math.abs(hash) % COLLECTION_SHELF_THEMES.length];
}

function formatShortDate(value?: string) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value).slice(0, 16);
  }
}

function formatRelativeDate(value?: string) {
  if (!value) return '更新日時なし';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return formatShortDate(value);
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 2) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days}日前`;
  return formatShortDate(value);
}

function getStoredWorkbench(): StoredWorkbench {
  try {
    const raw = localStorage.getItem(WORKBENCH_STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredWorkbench : {};
  } catch {
    return {};
  }
}

function parseWorkspaceKey(value?: string): { kind: 'page' | 'database'; id: string } | null {
  const match = /^(page|database):(.*)$/.exec(String(value || ''));
  if (!match || !match[2]) return null;
  return { kind: match[1] as 'page' | 'database', id: match[2] };
}

export function HomeDashboard({ data, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, onOpenInbox, onOpenTasks, onOpenAttachments, onOpenLinks, onOpenAdmin, onOpenNotifications, onOpenFreeformCanvas, recentRevision }: {
  data: any;
  onOpenPage: (id: string) => void;
  onOpenDatabase: (id: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
  onOpenInbox: () => void;
  onOpenTasks: () => void;
  onOpenAttachments: () => void;
  onOpenLinks: () => void;
  onOpenAdmin: () => void;
  onOpenNotifications: () => void;
  onOpenFreeformCanvas?: () => void;
  recentRevision?: number;
}) {
  const counts = data?.counts || {};
  const recentPages = data?.recentPages || [];
  const recentDatabases: RecentDatabase[] = data?.recentDatabases || [];
  const recentJournals = data?.recentJournals || [];
  const tasks = data?.tasks || [];
  const inboxItems = data?.inboxItems || [];
  const attachments = data?.recentAttachments || [];
  const conflicts = data?.conflicts || [];
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const overdueTasks = tasks.filter((task: any) => !task.completed && task.dueDate && String(task.dueDate) < today);
  const dueTodayTasks = tasks.filter((task: any) => !task.completed && String(task.dueDate || '') === today);
  const attentionCount = overdueTasks.length + dueTodayTasks.length + Number(counts.inbox || 0) + Number(counts.conflicts || 0);

  const resumeItems = useMemo(() => {
    const stored = getStoredWorkbench();
    const meta = stored.tabMeta || {};
    const pinned = new Set(stored.pinned || []);
    return (stored.tabs || [])
      .map((key) => {
        const parsed = parseWorkspaceKey(key);
        if (!parsed) return null;
        const details = meta[key] || {};
        return {
          key,
          ...parsed,
          title: details.title || (parsed.kind === 'database' ? 'データベース' : 'ページ'),
          icon: details.icon || (parsed.kind === 'database' ? '▦' : '📄'),
          pinned: pinned.has(key),
        };
      })
      .filter(Boolean)
      .slice(-6)
      .reverse() as Array<{ key: string; kind: 'page' | 'database'; id: string; title: string; icon: string; pinned: boolean }>;
  }, [data?.counts?.pages, data?.counts?.databases]);

  const openResumeItem = (item: { kind: 'page' | 'database'; id: string }) => {
    if (item.kind === 'database') onOpenDatabase(item.id);
    else onOpenPage(item.id);
  };

  const recentWorkspaceItems = useMemo(() => readRecentWorkspaceItems().slice(0, 6), [recentRevision]);
  const [collectionShelves, setCollectionShelves] = useState<CollectionShelf[]>(() => readCollectionShelves());
  const [shelfSearch, setShelfSearch] = useState('');
  const [activeShelfId, setActiveShelfId] = useState<string | null>(() => readCollectionShelves()[0]?.id || null);
  const [shelfDialog, setShelfDialog] = useState<{ mode: 'create' | 'rename' | 'delete'; shelfId?: string; value: string } | null>(null);
  const activeShelf = useMemo(() => collectionShelves.find((shelf) => shelf.id === activeShelfId) || collectionShelves[0] || null, [activeShelfId, collectionShelves]);

  useEffect(() => { writeCollectionShelves(collectionShelves); }, [collectionShelves]);
  useEffect(() => { const refresh = () => { const next = readCollectionShelves(); setCollectionShelves((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next); }; window.addEventListener('local-notion:collection-shelves-changed', refresh); return () => window.removeEventListener('local-notion:collection-shelves-changed', refresh); }, []);
  useEffect(() => {
    if (!collectionShelves.length) {
      if (activeShelfId !== null) setActiveShelfId(null);
      return;
    }
    if (!collectionShelves.some((shelf) => shelf.id === activeShelfId)) setActiveShelfId(collectionShelves[0].id);
  }, [activeShelfId, collectionShelves]);

  const addRecentToShelf = (shelfId: string, item: { key: string; kind: 'page' | 'database' | 'journal' | 'attachment'; id: string; title: string; icon: string }) => {
    addCollectionItemToShelf(shelfId, item);
  };
  const createCollectionShelf = () => setShelfDialog({ mode: 'create', value: '新しい資料棚' });
  const removeFromShelf = (shelfId: string, itemKey: string) => setCollectionShelves((current) => current.map((shelf) => shelf.id === shelfId ? { ...shelf, items: shelf.items.filter((item) => item.key !== itemKey) } : shelf));
  const renameCollectionShelf = (shelfId: string) => {
    const shelf = collectionShelves.find((candidate) => candidate.id === shelfId);
    if (shelf) setShelfDialog({ mode: 'rename', shelfId, value: shelf.name });
  };
  const removeCollectionShelf = (shelfId: string) => {
    const shelf = collectionShelves.find((candidate) => candidate.id === shelfId);
    if (shelf) setShelfDialog({ mode: 'delete', shelfId, value: shelf.name });
  };
  const submitShelfDialog = () => {
    if (!shelfDialog) return;
    const name = shelfDialog.value.trim();
    if (shelfDialog.mode === 'create') {
      if (!name) return;
      const nextShelf: CollectionShelf = { id: `shelf:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`, name, items: [], createdAt: Date.now() };
      setCollectionShelves((current) => [nextShelf, ...current].slice(0, 12));
      setActiveShelfId(nextShelf.id);
    } else if (shelfDialog.mode === 'rename' && shelfDialog.shelfId && name) {
      setCollectionShelves((current) => current.map((candidate) => candidate.id === shelfDialog.shelfId ? { ...candidate, name } : candidate));
    } else if (shelfDialog.mode === 'delete' && shelfDialog.shelfId) {
      // Persist immediately through the shared shelf store. This avoids relying on
      // a later React effect, which could otherwise make the delete appear to do nothing
      // when the dashboard rerenders or receives a shelf-change event.
      const deletedShelfId = shelfDialog.shelfId;
      const nextShelves = removeCollectionShelfById(deletedShelfId);
      setCollectionShelves(nextShelves);
      setActiveShelfId((current) => {
        if (current !== deletedShelfId) return current;
        return nextShelves[0]?.id || null;
      });
    }
    setShelfDialog(null);
  };

  const openRecentWorkspaceItem = (item: { kind: 'page' | 'database' | 'journal' | 'attachment'; id: string }) => {
    const id = String(item.id || '').trim();
    if (!id) return;
    if (item.kind === 'attachment') {
      onOpenAttachments();
      return;
    }
    if (item.kind === 'database') onOpenDatabase(id);
    else if (item.kind === 'journal') onOpenJournal(id);
    else onOpenPage(id);
  };


  const shelfSearchItems = useMemo(() => {
    const q = shelfSearch.trim().toLocaleLowerCase('ja-JP');
    const candidates = [
      ...recentPages.map((item: any) => ({ key: `page:${item.id}`, kind: 'page' as const, id: item.id, title: item.title || '無題のページ', icon: item.icon || '📄' })),
      ...recentDatabases.map((item: any) => ({ key: `database:${item.id}`, kind: 'database' as const, id: item.id, title: item.title || '無題のデータベース', icon: '▦' })),
      ...recentJournals.map((item: any) => ({ key: `journal:${item.date}`, kind: 'journal' as const, id: item.date, title: item.title || item.date, icon: item.icon || '📅' })),
      ...attachments.map((item: any) => ({ key: `attachment:${item.id || item.path || item.fileName}`, kind: 'attachment' as const, id: String(item.id || item.path || item.fileName), title: item.name || item.fileName || '添付ファイル', icon: '📎' })),
    ];
    const unique = new Map(candidates.map((item) => [item.key, item]));
    return [...unique.values()].filter((item) => !q || `${item.title} ${item.kind}`.toLocaleLowerCase('ja-JP').includes(q)).slice(0, 14);
  }, [attachments, recentDatabases, recentJournals, recentPages, shelfSearch]);


  useEffect(() => {
    if (!shelfDialog) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShelfDialog(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shelfDialog]);

  const shelfDialogModal = shelfDialog && typeof document !== 'undefined'
    ? createPortal(
      <div className="collection-shelf-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShelfDialog(null); }}>
        <section className="collection-shelf-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-shelf-dialog-title">
          <header><span>▤ 資料コレクション棚</span><button type="button" aria-label="閉じる" onClick={() => setShelfDialog(null)}>×</button></header>
          <h2 id="collection-shelf-dialog-title">{shelfDialog.mode === 'create' ? '新しい本棚を作る' : shelfDialog.mode === 'rename' ? '本棚の名前を変える' : 'この本棚を削除しますか？'}</h2>
          {shelfDialog.mode === 'delete' ? <p><b>「{shelfDialog.value || '資料棚'}」</b>を削除します。本棚の中の資料そのものは削除されません。</p> : <label>本棚の名前<input autoFocus value={shelfDialog.value} maxLength={40} onChange={(event) => setShelfDialog((current) => current ? { ...current, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === 'Enter') submitShelfDialog(); }} placeholder="例: 会議準備" /></label>}
          <footer><button type="button" className="secondary" onClick={() => setShelfDialog(null)}>キャンセル</button><button type="button" className={shelfDialog.mode === 'delete' ? 'danger' : 'primary'} onClick={submitShelfDialog} disabled={shelfDialog.mode !== 'delete' && !shelfDialog.value.trim()}>{shelfDialog.mode === 'create' ? '本棚を作る' : shelfDialog.mode === 'rename' ? '変更を保存' : '本棚を削除'}</button></footer>
        </section>
      </div>,
      document.body,
    )
    : null;

  const overviewCards = [
    { key: 'tasks', icon: '☑', value: counts.tasksOpen ?? 0, label: '未完了タスク', tone: 'task', onClick: onOpenTasks },
    { key: 'inbox', icon: '📥', value: counts.inbox ?? 0, label: '未整理 Inbox', tone: 'inbox', onClick: onOpenInbox },
    { key: 'alerts', icon: '🔔', value: attentionCount, label: '要確認', tone: 'alert', onClick: onOpenNotifications },
    { key: 'files', icon: '📎', value: counts.attachments ?? 0, label: 'ファイル', tone: 'file', onClick: onOpenAttachments },
  ];
  const aiActivities = useAiActivityLog(3);
  const cockpitSignals = [
    { key: 'resume', label: '続きから', value: resumeItems.length || recentWorkspaceItems.length, detail: resumeItems[0]?.title || recentWorkspaceItems[0]?.title || '最近の作業はまだありません', action: () => { const first = resumeItems[0]; if (first) openResumeItem(first); } },
    { key: 'inbox', label: '未整理', value: Number(counts.inbox || 0), detail: inboxItems[0]?.title || 'Inboxを空に近づけます', action: onOpenInbox },
    { key: 'ai', label: 'AIの動き', value: aiActivities.length, detail: aiActivities[0]?.title || '関連・用語・Index更新を記録します', action: onOpenNotifications },
  ];

  return (
    <section className="work-home-v562">
      <header className="work-home-hero-v562">
        <div className="work-home-title-v562">
          <span className="work-home-kicker-v562">WORKSPACE HOME</span>
          <h1>今日の作業</h1>
          <p>次に確認するもの、続きから再開するもの、最近更新した情報をひとつにまとめています。</p>
        </div>
        <div className="work-home-hero-actions-v562">
          <button type="button" className="primary" onClick={() => onOpenJournal(today)}><span>✦</span> 今日のJournal</button>
          <button type="button" onClick={onOpenNotifications}><span>🔔</span> 確認事項</button>
          {onOpenFreeformCanvas && <button type="button" onClick={onOpenFreeformCanvas}><span>▧</span> ホワイトボード</button>}
        </div>
      </header>

      <nav className="work-home-overview-v562" aria-label="作業状況">
        {overviewCards.map((card) => (
          <button key={card.key} type="button" className={`work-home-overview-card-v562 ${card.tone}`} onClick={card.onClick}>
            <span className="work-home-overview-icon-v562">{card.icon}</span>
            <span><b>{card.value}</b><small>{card.label}</small></span>
            <i>›</i>
          </button>
        ))}
      </nav>

      <section className="knowledge-cockpit-v729" aria-label="ナレッジ・コックピット">
        <div className="knowledge-cockpit-main-v729">
          <span className="knowledge-cockpit-kicker-v729">KNOWLEDGE COCKPIT</span>
          <h2>次に見るべき情報</h2>
          <p>未整理・続きの作業・AIが更新した情報を、ホームで一度に確認できます。</p>
          <div className="knowledge-cockpit-signals-v729">
            {cockpitSignals.map((signal) => (
              <button key={signal.key} type="button" onClick={signal.action}>
                <b>{signal.value}</b><span>{signal.label}</span><small>{signal.detail}</small>
              </button>
            ))}
          </div>
        </div>
        <AiActivityLogPanel compact limit={4} />
      </section>

      <div className="work-home-layout-v562">
        <div className="work-home-main-v562">
          <section className="work-home-card-v562 work-home-attention-v562">
            <div className="work-home-card-head-v562">
              <div><span className="work-home-section-icon-v562">◎</span><div><h2>優先して確認</h2><p>期限と共有作業の状況</p></div></div>
              <button type="button" className="text-action-v562" onClick={onOpenNotifications}>すべて見る</button>
            </div>
            <div className="work-home-attention-grid-v562">
              <button type="button" className={overdueTasks.length ? 'danger' : ''} onClick={onOpenTasks}><b>{overdueTasks.length}</b><span>期限切れ</span><small>{overdueTasks.length ? '優先して対応してください' : '対応が必要なものはありません'}</small></button>
              <button type="button" className={dueTodayTasks.length ? 'today' : ''} onClick={onOpenTasks}><b>{dueTodayTasks.length}</b><span>今日が期限</span><small>{dueTodayTasks.length ? '今日中に確認するタスク' : '今日の期限はありません'}</small></button>
              <button type="button" className={Number(counts.conflicts || 0) ? 'danger' : ''} onClick={onOpenAdmin}><b>{counts.conflicts ?? 0}</b><span>共有の競合</span><small>{counts.conflicts ? '保存内容を確認してください' : '競合はありません'}</small></button>
            </div>
            {tasks.slice(0, 4).length ? <div className="work-home-task-list-v562">{tasks.slice(0, 4).map((task: any) => <button key={task.id} type="button" onClick={() => { if (task.sourceType === 'journal') return onOpenJournal(task.sourceId); if (task.sourceType === 'page') return onOpenPage(task.sourceId); if (task.sourceType === 'database-row' && onOpenDatabaseRow) { const [databaseId, rowId] = String(task.sourceId || '').split('/'); if (databaseId && rowId) { try { return onOpenDatabaseRow(decodeURIComponent(databaseId), decodeURIComponent(rowId)); } catch {} } } return onOpenInbox(); }}><span className={task.dueDate && String(task.dueDate) < today ? 'late' : ''}>☐</span><b>{task.text || '無題のタスク'}</b><small>{task.dueDate ? `期限 ${task.dueDate}` : task.sourceTitle || '期限未設定'}</small></button>)}</div> : <div className="work-home-empty-v562">現在、未完了のタスクはありません。</div>}
          </section>

          <section className="work-home-card-v562 work-home-reopen-v636">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">◷</span><div><h2>最近開いたもの</h2><p>閉じたタブも含めて、最後に作業した場所を再開できます。</p></div></div></div>
            <div className="work-home-reopen-grid-v636">
              {recentWorkspaceItems.length ? recentWorkspaceItems.map((item) => <button key={item.key} type="button" onClick={() => openRecentWorkspaceItem(item)}><span>{item.icon}</span><div><b>{item.title}</b><small>{item.kind === 'database' ? 'データベース' : item.kind === 'journal' ? 'Journal' : 'ページ'} ・ {formatRelativeDate(new Date(item.openedAt).toISOString())}</small></div><i>›</i></button>) : <p className="work-home-empty-v562">まだ作業履歴はありません。ページ、データベース、Journalを開くとここから再開できます。</p>}
            </div>
          </section>

          <section className="work-home-card-v562 work-home-collection">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">▤</span><div><h2>資料コレクション棚</h2><p>本棚を開き、よく使う資料を背表紙から取り出せます。棚の中身はこの端末だけに保存されます。</p></div></div><button type="button" className="text-action-v562" onClick={createCollectionShelf}>＋ 棚を作る</button></div>
            <div className="work-home-collection__layout">
              <div className="work-home-bookcase" aria-label="資料コレクション棚">
                {collectionShelves.length ? collectionShelves.map((shelf) => {
                  const theme = getCollectionShelfTheme(shelf.id);
                  const isActive = activeShelf?.id === shelf.id;
                  return <article key={shelf.id} className={`work-home-bookshelf theme-${theme}${isActive ? ' is-active' : ''}`}>
                    <button type="button" className="work-home-bookshelf__label" onClick={() => setActiveShelfId(shelf.id)} aria-pressed={isActive}>
                      <span>▰</span><b>{shelf.name}</b><small>{shelf.items.length} 冊</small><i>{shelf.items.length ? '本を選ぶ' : '空の本棚'}</i>
                    </button>
                    <div className="work-home-bookshelf__board">
                      {shelf.items.length ? shelf.items.slice(0, 8).map((item, index) => <button key={item.key} type="button" className={`work-home-book spine-${index % 5}`} onClick={(event) => { event.stopPropagation(); openRecentWorkspaceItem(item); }} title={`${item.title} を開く`} aria-label={`${item.title} を開く`}>
                        <span className="book-icon" aria-hidden="true">{item.icon}</span><span className="book-title" title={item.title}>{item.title}</span>
                      </button>) : <span className="work-home-bookshelf__empty">資料を並べると、ここに本の背表紙が並びます。</span>}
                    </div>
                    <div className="work-home-bookshelf__footer"><button type="button" onClick={() => renameCollectionShelf(shelf.id)} aria-label={`${shelf.name}の名前を変更`}>名前を変える</button><button type="button" className="danger" onClick={() => removeCollectionShelf(shelf.id)} aria-label={`${shelf.name}を削除`}>棚を削除</button></div>
                  </article>;
                }) : <div className="work-home-collection__empty"><b>最初の本棚を作りましょう</b><span>会議準備、引継ぎ、根拠資料などを、自分だけの本棚として並べられます。</span><button type="button" onClick={createCollectionShelf}>最初の棚を作る</button></div>}
              </div>
              <aside className="work-home-collection__add"><b>最近開いた資料を並べる</b><small>棚を選んで「＋」を押すと、本棚に背表紙として追加されます。</small>{collectionShelves.length && recentWorkspaceItems.length ? recentWorkspaceItems.slice(0, 5).map((item) => <div key={item.key}><span>{item.icon}</span><b>{item.title}</b><select aria-label={`${item.title}を追加する棚`} defaultValue=""><option value="" disabled>棚を選択</option>{collectionShelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement | null; if (select?.value) addRecentToShelf(select.value, item); }}>＋</button></div>) : <p>最近開いた資料があると、ここから本棚へ追加できます。</p>}<section className="work-home-shelf-search" aria-label="資料を探して本棚に追加"><header><div><b>資料を探して追加</b><small>ページ・DB・Journal・添付を名前で検索できます。</small></div></header><label className="work-home-shelf-search__input"><span aria-hidden="true">⌕</span><input value={shelfSearch} onChange={(event) => setShelfSearch(event.target.value)} placeholder="資料名を入力して検索" /></label>{shelfSearch.trim() ? <div className="work-home-shelf-search__results">{shelfSearchItems.length ? shelfSearchItems.map((item) => <div key={item.key} className="work-home-shelf-search__row"><span className="item-icon">{item.icon}</span><div className="item-copy"><b title={item.title}>{item.title}</b><small>{item.kind === 'database' ? 'データベース' : item.kind === 'journal' ? 'Journal' : item.kind === 'attachment' ? '添付ファイル' : 'ページ'}</small></div><select aria-label={`${item.title}を追加する棚`} defaultValue=""><option value="" disabled>追加先</option>{collectionShelves.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select><button type="button" title={`${item.title}を本棚に追加`} onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement | null; if (select?.value) addRecentToShelf(select.value, item); }}>＋</button></div>) : <p className="work-home-shelf-search__empty">該当する資料はありません。</p>}</div> : <p className="work-home-shelf-search__hint">資料名を入力すると、追加できる候補を表示します。</p>}</section></aside>
            </div>
          </section>

          <section className="work-home-card-v562">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">↗</span><div><h2>最近の更新</h2><p>ページとデータベースの変更履歴</p></div></div></div>
            <div className="work-home-recent-grid-v562">
              <div>
                <h3>ページ</h3>
                {recentPages.length ? recentPages.slice(0, 5).map((page: any) => <button className="work-home-recent-item-v562" key={page.id} type="button" onClick={() => onOpenPage(page.id)}><span>{page.icon || '📄'}</span><b>{page.title || '無題のページ'}</b><small>{formatRelativeDate(page.updatedAt)}</small></button>) : <p className="work-home-empty-v562">まだページがありません。</p>}
              </div>
              <div>
                <h3>データベース</h3>
                {recentDatabases.length ? recentDatabases.slice(0, 5).map((database) => <button className="work-home-recent-item-v562 database" key={database.id} type="button" onClick={() => onOpenDatabase(database.id)}><span>▦</span><b>{database.title || '無題のデータベース'}</b><small>{database.rowCount ?? 0} 行・{formatRelativeDate(database.updatedAt)}</small></button>) : <p className="work-home-empty-v562">まだデータベースがありません。</p>}
              </div>
            </div>
          </section>
        </div>

        <aside className="work-home-side-v562">
          <section className="work-home-card-v562 work-home-resume-v562">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">◷</span><div><h2>作業を再開</h2><p>開いていたタブ</p></div></div></div>
            {resumeItems.length ? <div className="work-home-resume-list-v562">{resumeItems.map((item) => <button key={item.key} type="button" onClick={() => openResumeItem(item)}><span>{item.icon}</span><b>{item.title}</b>{item.pinned ? <i title="ピン留め">⌁</i> : null}</button>)}</div> : <div className="work-home-empty-v562">最近開いたタブはまだありません。</div>}
          </section>

          <section className="work-home-card-v562">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">▣</span><div><h2>クイックアクセス</h2><p>よく使う機能</p></div></div></div>
            <div className="work-home-shortcuts-v562">
              <button type="button" onClick={onOpenInbox}><span>📥</span><b>Inboxを整理</b><small>{counts.inbox ?? 0} 件</small></button>
              <button type="button" onClick={onOpenTasks}><span>☑</span><b>タスクを確認</b><small>{counts.tasksOpen ?? 0} 件</small></button>
              <button type="button" onClick={onOpenAttachments}><span>📎</span><b>添付を探す</b><small>{counts.attachments ?? 0} 件</small></button>
              <button type="button" onClick={onOpenLinks}><span>🔗</span><b>リンク状態</b><small>リンク切れを確認</small></button>
              {onOpenFreeformCanvas && <button type="button" onClick={onOpenFreeformCanvas}><span>▧</span><b>ホワイトボード</b><small>自由に並べる</small></button>}
            </div>
          </section>

          <section className="work-home-card-v562 work-home-journal-v562">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">✎</span><div><h2>Journal</h2><p>最近の記録</p></div></div></div>
            {recentJournals.length ? recentJournals.slice(0, 3).map((journal: any) => <button className="work-home-journal-item-v562" key={journal.date} type="button" onClick={() => onOpenJournal(journal.date)} onContextMenu={(event) => { event.preventDefault(); addCollectionItemToDefaultShelf({ key: `journal:${journal.date}`, kind: 'journal', id: journal.date, title: journal.title || journal.date, icon: journal.icon || '📅' }); }}><b>{journal.date}</b><small>{journal.previewSnippet || 'Daily note を開く'}</small></button>) : <button className="work-home-empty-action-v562" type="button" onClick={() => onOpenJournal(today)}>今日のJournalを作成</button>}
          </section>
        </aside>
      </div>

      {shelfDialogModal}

      <footer className="work-home-footnote-v562">
        <span>Pages {counts.pages ?? 0}</span><span>Databases {counts.databases ?? 0}</span><span>Journal {counts.journals ?? 0}</span><span>Files {counts.attachments ?? 0}</span>
        {conflicts.length ? <button type="button" onClick={onOpenAdmin}>共有の競合 {conflicts.length} 件を確認</button> : null}
      </footer>
    </section>
  );
}
