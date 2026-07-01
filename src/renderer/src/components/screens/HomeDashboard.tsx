import React, { useMemo } from 'react';

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

export function HomeDashboard({ data, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, onOpenInbox, onOpenTasks, onOpenAttachments, onOpenLinks, onOpenAdmin, onOpenNotifications }: {
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

  const overviewCards = [
    { key: 'tasks', icon: '☑', value: counts.tasksOpen ?? 0, label: '未完了タスク', tone: 'task', onClick: onOpenTasks },
    { key: 'inbox', icon: '📥', value: counts.inbox ?? 0, label: '未整理 Inbox', tone: 'inbox', onClick: onOpenInbox },
    { key: 'alerts', icon: '🔔', value: attentionCount, label: '要確認', tone: 'alert', onClick: onOpenNotifications },
    { key: 'files', icon: '📎', value: counts.attachments ?? 0, label: 'ファイル', tone: 'file', onClick: onOpenAttachments },
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
            </div>
          </section>

          <section className="work-home-card-v562 work-home-journal-v562">
            <div className="work-home-card-head-v562"><div><span className="work-home-section-icon-v562">✎</span><div><h2>Journal</h2><p>最近の記録</p></div></div></div>
            {recentJournals.length ? recentJournals.slice(0, 3).map((journal: any) => <button className="work-home-journal-item-v562" key={journal.date} type="button" onClick={() => onOpenJournal(journal.date)}><b>{journal.date}</b><small>{journal.previewSnippet || 'Daily note を開く'}</small></button>) : <button className="work-home-empty-action-v562" type="button" onClick={() => onOpenJournal(today)}>今日のJournalを作成</button>}
          </section>
        </aside>
      </div>

      <footer className="work-home-footnote-v562">
        <span>Pages {counts.pages ?? 0}</span><span>Databases {counts.databases ?? 0}</span><span>Journal {counts.journals ?? 0}</span><span>Files {counts.attachments ?? 0}</span>
        {conflicts.length ? <button type="button" onClick={onOpenAdmin}>共有の競合 {conflicts.length} 件を確認</button> : null}
      </footer>
    </section>
  );
}
