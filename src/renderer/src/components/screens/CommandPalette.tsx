import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import type { InboxItem, JournalSummary, PageWithLock, TaskItem, WorkspaceDatabase } from '../../../../shared/types';
import { readRecentWorkspaceItems } from '../../lib/recentWorkspace';
import { addCollectionItemToDefaultShelf } from '../../lib/collectionShelves';
import { buildWorkspaceExplorerItems, recordExplorerRecent } from '../../workspace/explorerService';
import { readWebProjects } from '../../webBuilder/store';

type AppSettings = { density: 'comfortable' | 'compact'; theme: 'light' | 'soft'; autoSaveDelayMs: number; journalStart: 'today' | 'last'; commandHints: boolean };
type CommandKind = 'recent' | 'action' | 'page' | 'database' | 'journal' | 'inbox' | 'task' | 'file' | 'workspace';
type CommandItem = {
  id: string;
  kind: CommandKind;
  icon: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  primary?: boolean;
  run: () => void;
};

const KIND_LABEL: Record<CommandKind, string> = {
  recent: '最近開いたもの',
  action: '操作',
  page: 'ページ',
  database: 'データベース',
  journal: 'Journal',
  inbox: 'Inbox',
  task: 'Tasks',
  file: 'Files',
  workspace: 'Workspace Explorer',
};

function isMatch(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const text = [item.title, item.subtitle, ...(item.keywords || [])].join(' ').toLocaleLowerCase('ja-JP');
  return query.split(/\s+/).every((word) => text.includes(word));
}

function getInitialsBadge(kind: CommandKind): string {
  if (kind === 'recent') return '◷';
  if (kind === 'action') return '⌘';
  if (kind === 'database') return 'DB';
  if (kind === 'journal') return 'JN';
  if (kind === 'inbox') return 'IN';
  if (kind === 'task') return 'TO';
  if (kind === 'file') return 'FI';
  if (kind === 'workspace') return 'WS';
  return 'PG';
}

export function CommandPalette({ open, query, api, pages, databases, journals, inboxItems, tasks, attachments, settings, onQuery, onClose, onOpenPage, onOpenDatabase, onOpenJournal, onOpenInbox, onOpenOcrCenter, onOpenTasks, onOpenAttachments, onOpenLinks, onOpenKnowledgeMap, onOpenFreeformCanvas, onOpenAdmin, onOpenSettings, onOpenWorkspaceAiSearch, onOpenExplorer, onOpenWebProject, onQuickCapture, onCreatePage, onCreateDatabase, onSync, onTrash }: {
  open: boolean;
  query: string;
  api: ApiClient | null;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  journals: JournalSummary[];
  inboxItems: InboxItem[];
  tasks: TaskItem[];
  attachments: any[];
  settings: AppSettings;
  onQuery: (value: string) => void;
  onClose: () => void;
  onOpenPage: (id: string) => void;
  onOpenDatabase: (id: string) => void;
  onOpenJournal: (date: string) => void;
  onOpenInbox: () => void;
  onOpenOcrCenter: () => void;
  onOpenTasks: () => void;
  onOpenAttachments: () => void;
  onOpenLinks: () => void;
  onOpenKnowledgeMap: () => void;
  onOpenFreeformCanvas?: () => void;
  onOpenAdmin: () => void;
  onOpenSettings: () => void;
  onOpenWorkspaceAiSearch?: (query?: string) => void;
  onOpenExplorer?: () => void;
  onOpenWebProject?: (id: string) => void;
  onQuickCapture: () => void;
  onCreatePage: () => void;
  onCreateDatabase: () => void;
  onSync: () => void;
  onTrash: () => void;
}) {
  void api;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeResultRef = useRef<HTMLButtonElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLocaleLowerCase('ja-JP');
  const commandKey = navigator.platform.toLowerCase().includes('mac') ? '⌘K' : 'Ctrl K';

  const allItems = useMemo<CommandItem[]>(() => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const recentItems = readRecentWorkspaceItems().map<CommandItem>((item) => ({
      id: `recent:${item.key}`,
      kind: 'recent',
      icon: item.icon,
      title: item.title,
      subtitle: item.kind === 'database' ? '最近開いたデータベース' : item.kind === 'journal' ? '最近開いたJournal' : '最近開いたページ',
      keywords: [item.kind, item.id, 'recent', '最近'],
      run: () => {
        if (item.kind === 'database') onOpenDatabase(item.id);
        else if (item.kind === 'journal') onOpenJournal(item.id);
        else onOpenPage(item.id);
      },
    }));
    const queryAction: CommandItem[] = normalizedQuery ? [{
      id: `action:workspace-ai-search:${normalizedQuery}`,
      kind: 'action',
      icon: '✦',
      title: `「${query.trim()}」をAI横断検索`,
      subtitle: 'ページ本文・PDF・OCR結果を含めて検索',
      keywords: ['ai', '検索', '全文検索', 'ocr', 'pdf'],
      primary: true,
      run: () => onOpenWorkspaceAiSearch?.(query.trim()),
    }] : [];
    const actions: CommandItem[] = [
      { id: 'action:new-page', kind: 'action', icon: '＋', title: '新規ページ', subtitle: '空のページを作成', keywords: ['page', '作成', '新規'], primary: true, run: onCreatePage },
      { id: 'action:new-database', kind: 'action', icon: '▦', title: '新規データベース', subtitle: '共有DBを作成', keywords: ['database', 'db', '作成', '新規'], primary: true, run: onCreateDatabase },
      { id: 'action:quick-capture', kind: 'action', icon: '⚡', title: 'クイックメモ', subtitle: '素早くInboxへ記録', keywords: ['capture', 'inbox', 'メモ'], primary: true, run: onQuickCapture },
      { id: 'action:today-journal', kind: 'action', icon: '📅', title: '今日のJournal', subtitle: today, keywords: ['journal', '日記', '今日'], primary: true, run: () => onOpenJournal(today) },
      { id: 'action:tasks', kind: 'action', icon: '☑', title: 'Tasksを開く', subtitle: '未完了タスクを確認', keywords: ['task', 'todo', 'タスク'], primary: true, run: onOpenTasks },
      { id: 'action:inbox', kind: 'action', icon: '📥', title: 'Inboxを開く', subtitle: '未整理メモを確認', keywords: ['inbox', '受信箱'], primary: true, run: onOpenInbox },
      { id: 'action:ocr-center', kind: 'action', icon: '⌁', title: 'OCRセンターを開く', subtitle: '画像・PDFの文字抽出を一元管理', keywords: ['ocr', '文字抽出', 'pdf', '画像'], primary: true, run: onOpenOcrCenter },
      { id: 'action:ai-search', kind: 'action', icon: '✦', title: 'AI横断検索', subtitle: 'ワークスペース全体を検索', keywords: ['ai', '検索', 'faq'], run: () => onOpenWorkspaceAiSearch?.() },
      { id: 'action:files', kind: 'action', icon: '📎', title: '添付ファイルを開く', subtitle: 'Filesを管理', keywords: ['file', '添付'], run: onOpenAttachments },
      { id: 'action:links', kind: 'action', icon: '🔗', title: 'リンク管理を開く', subtitle: 'リンク切れ・孤立ページを確認', keywords: ['link', 'リンク'], run: onOpenLinks },
      { id: 'action:knowledge-map', kind: 'action', icon: '✦', title: '現在のページの関係図', subtitle: 'リンク・タグ・親子関係を星座図で表示', keywords: ['map', 'graph', '星座', '関係図', 'ナレッジマップ'], run: onOpenKnowledgeMap },
      { id: 'action:workspace-explorer', kind: 'action', icon: '⌘', title: 'Workspace Explorerを開く', subtitle: 'ページ・DB・Web資産を横断管理', keywords: ['workspace', 'explorer', '素材', '部品', 'テンプレート'], primary: true, run: () => onOpenExplorer?.() },
      { id: 'action:freeform-canvas', kind: 'action', icon: '▧', title: 'ホワイトボードを開く', subtitle: 'ページ・DB・付箋を自由に配置', keywords: ['canvas', 'freeform', 'whiteboard', 'ホワイトボード', 'キャンバス'], run: () => onOpenFreeformCanvas?.() },
      { id: 'action:sync', kind: 'action', icon: '↻', title: '共有フォルダから再同期', subtitle: '最新の共有データを読み込む', keywords: ['sync', '同期', '更新'], run: onSync },
      { id: 'action:settings', kind: 'action', icon: '⚙', title: '設定を開く', subtitle: 'アプリと保存先を設定', keywords: ['settings', '設定'], run: onOpenSettings },
      { id: 'action:admin', kind: 'action', icon: '🛠', title: '共有フォルダ管理', subtitle: '競合・バックアップを確認', keywords: ['admin', '管理', '競合'], run: onOpenAdmin },
      { id: 'action:trash', kind: 'action', icon: '🗑', title: 'ゴミ箱を開く', subtitle: '削除済みデータを確認', keywords: ['trash', 'ゴミ箱', '削除'], run: onTrash },
    ];
    const pageItems = pages.map<CommandItem>((page) => ({
      id: `page:${page.id}`,
      kind: 'page',
      icon: page.icon || '📄',
      title: page.title || '無題のページ',
      subtitle: [page.properties.status, page.properties.priority, ...(page.properties.tags || []).slice(0, 2)].filter(Boolean).join(' · ') || 'ページ',
      keywords: [page.id, page.properties.assignee || '', ...(page.properties.tags || [])],
      run: () => onOpenPage(page.id),
    }));
    const databaseItems = databases.map<CommandItem>((database) => ({
      id: `database:${database.id}`,
      kind: 'database',
      icon: '▦',
      title: database.title || '無題のデータベース',
      subtitle: `${database.rows.length} 行 · ${database.properties.length} プロパティ`,
      keywords: [database.id, ...database.properties.map((property) => property.name)],
      run: () => onOpenDatabase(database.id),
    }));
    const journalItems = journals.map<CommandItem>((journal) => ({
      id: `journal:${journal.date}`,
      kind: 'journal',
      icon: journal.icon || '📅',
      title: journal.title || journal.date,
      subtitle: journal.previewSnippet || journal.mood || journal.weather || journal.date,
      keywords: [journal.date, journal.mood || '', journal.weather || '', ...(journal.tags || [])],
      run: () => onOpenJournal(journal.date),
    }));
    const inboxEntries = inboxItems.filter((item) => item.status !== 'archived').map<CommandItem>((item) => ({
      id: `inbox:${item.id}`,
      kind: 'inbox',
      icon: '📥',
      title: item.title || '無題のInbox',
      subtitle: item.text?.replace(/\s+/g, ' ').slice(0, 96) || item.priority || 'Inbox',
      keywords: [item.priority || '', ...(item.tags || [])],
      run: onOpenInbox,
    }));
    const taskItems = tasks.map<CommandItem>((task) => ({
      id: `task:${task.id}`,
      kind: 'task',
      icon: task.completed ? '✓' : '☐',
      title: task.text || '無題のタスク',
      subtitle: [task.sourceTitle || task.sourceType, task.dueDate].filter(Boolean).join(' · ') || (task.completed ? '完了' : '未完了'),
      keywords: [task.sourceType || '', task.dueDate || '', task.completed ? '完了 done' : '未完了 todo'],
      run: onOpenTasks,
    }));
    const workspaceItems = buildWorkspaceExplorerItems({ pages, databases, screens: [], webProjects: readWebProjects() })
      .filter((item) => !['page', 'database'].includes(item.kind))
      .map<CommandItem>((item) => ({
        id: `workspace:${item.key}`,
        kind: 'workspace',
        icon: item.icon,
        title: item.title,
        subtitle: item.subtitle,
        keywords: [item.kind, item.searchText, 'workspace', 'explorer'],
        run: () => {
          recordExplorerRecent(item.key);
          if (item.kind === 'website') onOpenWebProject?.(item.id);
          else if (item.projectId) onOpenWebProject?.(item.projectId);
          else onOpenExplorer?.();
        },
      }));
    const fileItems = attachments.map<CommandItem>((file: any) => ({
      id: `file:${file.id || `${file.pageId}-${file.fileName}`}`,
      kind: 'file',
      icon: '📎',
      title: file.fileName || '添付ファイル',
      subtitle: file.pageTitle || file.mimeType || '添付ファイル',
      keywords: [file.mimeType || '', file.pageTitle || '', file.pageId || ''],
      run: () => file.pageId ? onOpenPage(file.pageId) : onOpenAttachments(),
    }));
    return [...recentItems, ...queryAction, ...actions, ...pageItems, ...databaseItems, ...workspaceItems, ...journalItems, ...inboxEntries, ...taskItems, ...fileItems];
  }, [attachments, databases, inboxItems, journals, normalizedQuery, onCreateDatabase, onCreatePage, onOpenAdmin, onOpenAttachments, onOpenDatabase, onOpenInbox, onOpenJournal, onOpenLinks, onOpenKnowledgeMap, onOpenPage, onOpenSettings, onOpenTasks, onOpenWorkspaceAiSearch, onOpenExplorer, onOpenWebProject, onQuickCapture, onSync, onTrash, pages, query, tasks]);

  const filtered = useMemo(() => {
    const matching = allItems.filter((item) => isMatch(item, normalizedQuery));
    const limited: CommandItem[] = [];
    const perKindLimit: Record<CommandKind, number> = normalizedQuery ? {
      recent: 5, action: 10, page: 10, database: 8, workspace: 10, journal: 6, inbox: 6, task: 6, file: 6,
    } : {
      recent: 8, action: 6, page: 6, database: 4, workspace: 5, journal: 3, inbox: 3, task: 4, file: 3,
    };
    const count: Partial<Record<CommandKind, number>> = {};
    for (const item of matching) {
      const used = count[item.kind] || 0;
      if (used >= perKindLimit[item.kind]) continue;
      count[item.kind] = used + 1;
      limited.push(item);
    }
    return limited;
  }, [allItems, normalizedQuery]);

  const grouped = useMemo(() => {
    const groups = new Map<CommandKind, CommandItem[]>();
    for (const item of filtered) {
      const entries = groups.get(item.kind) || [];
      entries.push(item);
      groups.set(item.kind, entries);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, Math.max(0, filtered.length - 1))));
  }, [filtered.length, normalizedQuery]);

  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const activate = (item: CommandItem) => {
    item.run();
    onClose();
  };
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((value) => Math.min(Math.max(0, filtered.length - 1), value + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault();
      activate(filtered[activeIndex]);
    }
  };

  let resultIndex = 0;
  return (
    <div className="command-overlay" onMouseDown={onClose} role="presentation">
      <section className="command-palette command-palette-v93 command-palette-v556" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="コマンドパレット">
        <header className="command-input-shell-v93 command-input-shell-v556">
          <span aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="ページ、DB、操作を検索…"
            aria-label="コマンドを検索"
            aria-controls="command-results-v556"
            aria-activedescendant={filtered[activeIndex] ? `command-result-${filtered[activeIndex].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </header>

        {!normalizedQuery ? (
          <div className="command-quick-actions-v556" aria-label="よく使う操作">
            {filtered.filter((item) => item.kind === 'action' && item.primary).slice(0, 6).map((item) => (
              <button key={item.id} type="button" onClick={() => activate(item)}>
                <span aria-hidden="true">{item.icon}</span><b>{item.title}</b>
              </button>
            ))}
          </div>
        ) : null}

        <div className="command-result-summary-v556">
          <span>{normalizedQuery ? `「${query.trim()}」の検索結果` : 'すべてのワークスペースから検索'}</span>
          <small>{filtered.length} 件</small>
        </div>

        <div className="command-results-v556" id="command-results-v556" role="listbox" aria-label="コマンド候補">
          {grouped.length === 0 ? (
            <div className="command-empty-v556"><b>該当する項目がありません</b><span>別の言葉で検索するか、新規ページ・DBを作成してください。</span></div>
          ) : grouped.map(([kind, items]) => (
            <section className="command-group-v556" key={kind} aria-label={KIND_LABEL[kind]}>
              <div className="command-group-heading-v556"><span>{getInitialsBadge(kind)}</span>{KIND_LABEL[kind]}</div>
              {items.map((item) => {
                const index = resultIndex++;
                const active = index === activeIndex;
                return (
                  <button
                    ref={active ? activeResultRef : undefined}
                    key={item.id}
                    id={`command-result-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`command-result-v556 ${active ? 'is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => activate(item)}
                  >
                    <span className={`command-result-icon-v556 kind-${item.kind}`} aria-hidden="true">{item.icon}</span>
                    <span className="command-result-copy-v556"><b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}</span>
                    <span className="command-result-meta-v556">{active ? '↵' : KIND_LABEL[item.kind]}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="command-footer-v556">
          <span><kbd>↑↓</kbd> 移動</span><span><kbd>Enter</kbd> 開く</span>
          {settings.commandHints ? <span><kbd>{commandKey}</kbd> いつでも開く</span> : null}
        </footer>
      </section>
    </div>
  );
}
