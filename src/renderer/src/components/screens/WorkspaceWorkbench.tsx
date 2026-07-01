import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { PageBundle, PageWithLock, WorkspaceDatabase, JournalSummary, WorkspaceScope } from "../../../../shared/types";
import { BlockNotePageEditor, type BlockNoteDoc } from "../BlockNoteEditor";
import { DatabaseTable } from "../DatabaseTable";

type WorkbenchMode = "tabs" | "compare" | "split";
type WorkbenchItemKind = "page" | "database";
type WorkbenchItem = { kind: WorkbenchItemKind; id: string };
type ActiveWorkspaceItem = { kind: WorkbenchItemKind; id: string; rowId?: string | null; parentId?: string | null };
type TabContextMenu = { key: string; x: number; y: number } | null;
type DatabaseChildPageReference = {
  databaseId: string;
  rowId: string;
  databaseTitle: string;
  rowTitle: string;
  page: PageWithLock;
};

type ClosedTabSnapshot = {
  key: string;
  pinned?: boolean;
  closedAt: number;
  title?: string;
  icon?: string;
};

type StoredWorkbench = {
  tabs: string[];
  pinned: string[];
  /** Recently closed items for safe one-click / shortcut recovery. */
  closedTabs?: ClosedTabSnapshot[];
  /** Keeps tab labels stable for DB-row child pages which are not part of the normal page tree. */
  tabMeta?: Record<string, { title?: string; icon?: string }>;
  activeItemKey?: string;
  splitItemKey?: string;
  compareLeftKey?: string;
  compareRightKey?: string;
  splitWidth?: number;
  compareRatio?: number;
};

const STORAGE_KEY = "local-notion:workspace-workbench-v518";
const LEGACY_STORAGE_KEY = "local-notion:workspace-workbench-v476";
const keyOf = (item: WorkbenchItem) => `${item.kind}:${item.id}`;
const pageItem = (id: string): WorkbenchItem => ({ kind: "page", id });
const databaseItem = (id: string): WorkbenchItem => ({ kind: "database", id });

function getItemSafe(key: string | undefined, items: Map<string, WorkbenchItem>): WorkbenchItem | undefined {
  return key ? items.get(key) : undefined;
}

function parseItem(value?: string): WorkbenchItem | null {
  if (!value || typeof value !== "string") return null;
  const match = /^(page|database):(.*)$/.exec(value);
  if (!match || !match[2]) return null;
  return { kind: match[1] as WorkbenchItemKind, id: match[2] };
}

function addTabWithLimit(tabs: string[], pinned: string[], itemKey: string, limit = 14): string[] {
  if (tabs.includes(itemKey)) return tabs;
  const pinnedSet = new Set(pinned);
  const next = [...tabs, itemKey];
  const regular = next.filter((key) => !pinnedSet.has(key));
  const overflow = Math.max(0, regular.length - limit);
  if (!overflow) return next;
  const remove = new Set(regular.slice(0, overflow));
  return next.filter((key) => !remove.has(key));
}

function getSafeMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 12;
  const viewportWidth = typeof window === "undefined" ? width + margin * 2 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? height + margin * 2 : window.innerHeight;
  return {
    x: Math.max(margin, Math.min(x, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(y, viewportHeight - height - margin)),
  };
}

function sanitizeStored(raw: any): StoredWorkbench {
  const normalize = (value: unknown) => typeof value === "string"
    ? (parseItem(value) ? value : keyOf(pageItem(value)))
    : null;
  const tabMeta: Record<string, { title?: string; icon?: string }> = {};
  if (raw?.tabMeta && typeof raw.tabMeta === "object") {
    for (const [rawKey, rawValue] of Object.entries(raw.tabMeta as Record<string, unknown>)) {
      const key = normalize(rawKey);
      if (!key || !rawValue || typeof rawValue !== "object") continue;
      const value = rawValue as { title?: unknown; icon?: unknown };
      tabMeta[key] = {
        title: typeof value.title === "string" ? value.title : undefined,
        icon: typeof value.icon === "string" ? value.icon : undefined,
      };
    }
  }
  return {
    tabs: Array.from(new Set(Array.isArray(raw?.tabs) ? raw.tabs.map(normalize).filter(Boolean) as string[] : [])),
    pinned: Array.from(new Set(Array.isArray(raw?.pinned) ? raw.pinned.map(normalize).filter(Boolean) as string[] : [])),
    closedTabs: Array.isArray(raw?.closedTabs)
      ? raw.closedTabs
        .map((entry: any): ClosedTabSnapshot | null => {
          const key = normalize(entry?.key);
          if (!key) return null;
          return {
            key,
            pinned: Boolean(entry?.pinned),
            closedAt: typeof entry?.closedAt === "number" && Number.isFinite(entry.closedAt) ? entry.closedAt : 0,
            title: typeof entry?.title === "string" ? entry.title : undefined,
            icon: typeof entry?.icon === "string" ? entry.icon : undefined,
          };
        })
        .filter(Boolean)
        .filter((entry: ClosedTabSnapshot, index: number, items: ClosedTabSnapshot[]) => items.findIndex((candidate) => candidate.key === entry.key) === index)
        .slice(0, 12)
      : [],
    tabMeta,
    activeItemKey: normalize(raw?.activeItemKey) ?? undefined,
    splitItemKey: normalize(raw?.splitItemKey ?? raw?.splitPageId) ?? undefined,
    compareLeftKey: normalize(raw?.compareLeftKey ?? raw?.compareLeftId) ?? undefined,
    compareRightKey: normalize(raw?.compareRightKey ?? raw?.compareRightId) ?? undefined,
    splitWidth: typeof raw?.splitWidth === "number" && Number.isFinite(raw.splitWidth) ? raw.splitWidth : undefined,
    compareRatio: typeof raw?.compareRatio === "number" && Number.isFinite(raw.compareRatio) ? raw.compareRatio : undefined,
  };
}

function readStored(): StoredWorkbench {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return sanitizeStored(JSON.parse(current));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    return legacy ? sanitizeStored(JSON.parse(legacy)) : { tabs: [], pinned: [], closedTabs: [] };
  } catch {
    return { tabs: [], pinned: [], closedTabs: [] };
  }
}

function writeStored(value: StoredWorkbench): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* UI preference only */ }
}

function previewBlocks(page: PageBundle | null): BlockNoteDoc {
  const stored = page?.blocksuite as { kind?: string; blocks?: unknown } | null;
  if (stored?.kind === "blocknote" && Array.isArray(stored.blocks) && stored.blocks.length > 0) return stored.blocks as BlockNoteDoc;
  const markdown = String(page?.markdown || "").trim();
  return markdown
    ? markdown.split(/\n{2,}/).map((text) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] })) as BlockNoteDoc
    : [{ type: "paragraph", content: [] }] as BlockNoteDoc;
}


function PanePage({ api, pageId, pages, databases, onOpenPage, onOpenDatabase }: { api: ApiClient | null; pageId?: string; pages: PageWithLock[]; databases: WorkspaceDatabase[]; onOpenPage: (pageId: string) => void; onOpenDatabase: (databaseId: string) => void }) {
  const [page, setPage] = useState<PageBundle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!api || !pageId) { setPage(null); setError(""); return; }
    setPage(null); setError("");
    void api.getPage(pageId).then((next) => { if (active) setPage(next); }).catch((e: any) => { if (active) setError(e?.message || "ページを読み込めませんでした"); });
    return () => { active = false; };
  }, [api, pageId]);
  if (error) return <div className="workspace-workbench-error-v476">{error}</div>;
  if (!pageId) return <div className="workspace-workbench-empty-v476">参照するページを選択してください。</div>;
  return <article className="workspace-workbench-document-v476">
    <header><span>{page?.meta.icon || "📄"}</span><strong>{page?.meta.title || "ページを読み込み中…"}</strong><small>閲覧専用</small></header>
    {page ? <div className="workspace-blocknote-preview-v512" aria-label={`${page.meta.title || "ページ"} の閲覧専用本文`}>
      <BlockNotePageEditor
        key={`workspace-preview:${page.meta.id}:${page.meta.updatedAt}`}
        pageId={`workspace-preview:${page.meta.id}`}
        initialContent={previewBlocks(page)}
        editing={false}
        previewMode={true}
        deferEditorMount={true}
        pages={pages}
        databases={databases}
        onChange={() => undefined}
        onOpenPage={onOpenPage}
        onOpenDatabase={onOpenDatabase}
        attachmentApiBaseUrl={api?.getBaseUrl() || ''}
      />
    </div> : <div className="workspace-workbench-loading-v512">本文を読み込んでいます…</div>}
  </article>;
}

function PaneDatabase({ api, database, databases, pages, journals, onOpenPage, onOpenDatabase, editing = false, initialSelectedRowId = null, onChangeDatabase, showHeader = true }: {
  api: ApiClient | null;
  database?: WorkspaceDatabase;
  databases: WorkspaceDatabase[];
  pages: PageWithLock[];
  journals: JournalSummary[];
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  editing?: boolean;
  initialSelectedRowId?: string | null;
  onChangeDatabase?: (database: WorkspaceDatabase) => void;
  showHeader?: boolean;
}) {
  if (!database) return <div className="workspace-workbench-empty-v476">データベースを読み込めませんでした。</div>;
  return <article className={`workspace-workbench-document-v476 workspace-database-preview-v518 ${editing ? "is-editable-v521" : ""} ${showHeader ? "has-workspace-db-header-v539" : "is-embedded-workspace-db-v539"}`}>
    {showHeader ? <header><span>▦</span><strong>{database.title || "無題のデータベース"}</strong><small>{editing ? `編集中・${database.rows.length} 行` : `閲覧専用・${database.rows.length} 行`}</small></header> : null}
    <div className="workspace-database-table-v518">
      <DatabaseTable
        key={`workspace-database:${database.id}:${editing ? "edit" : "preview"}`}
        database={database}
        editing={editing}
        onChange={(next) => onChangeDatabase?.(next)}
        allDatabases={databases}
        pages={pages}
        journals={journals}
        api={api}
        initialSelectedRowId={initialSelectedRowId}
        onOpenPage={onOpenPage}
        onOpenDatabase={onOpenDatabase}
      />
    </div>
  </article>;
}

export function WorkspaceWorkbench({ api, current, pages, databases, journals = [], dirty, toolbar, onOpenPage, onOpenDatabase, onSaveDatabase, onChangeDatabaseScope, onDeleteDatabase, onActiveItemChange }: {
  api: ApiClient | null;
  current: PageBundle;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  journals?: JournalSummary[];
  dirty: boolean;
  /** Page-specific actions for the active workspace item. Rendered below the tab strip. */
  toolbar?: React.ReactNode;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onSaveDatabase?: (database: WorkspaceDatabase) => void;
  onChangeDatabaseScope?: (databaseId: string, scope: WorkspaceScope) => void;
  onDeleteDatabase?: (databaseId: string) => void;
  onActiveItemChange?: (item: ActiveWorkspaceItem | null) => void;
}) {
  const initial = useMemo(readStored, []);
  const [mode, setMode] = useState<WorkbenchMode>("tabs");
  const [stored, setStored] = useState<StoredWorkbench>(initial);
  const [draggedTabKey, setDraggedTabKey] = useState<string | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenu>(null);
  const [splitWidth, setSplitWidth] = useState(() => initial.splitWidth ?? 460);
  const [compareRatio, setCompareRatio] = useState(() => initial.compareRatio ?? 0.5);
  const [rowFocus, setRowFocus] = useState<{ databaseId: string; rowId: string } | null>(null);
  const [databaseChildPageReferences, setDatabaseChildPageReferences] = useState<DatabaseChildPageReference[]>([]);
  const [databaseChildPageReferencesLoading, setDatabaseChildPageReferencesLoading] = useState(false);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const compareGridRef = useRef<HTMLDivElement | null>(null);
  const splitResizeRef = useRef({ active: false, width: initial.splitWidth ?? 460 });
  const compareResizeRef = useRef({ active: false, ratio: initial.compareRatio ?? 0.5 });

  const pageMap = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const databaseMap = useMemo(() => new Map(databases.map((database) => [database.id, database])), [databases]);
  const databaseChildPageReferenceMap = useMemo(
    () => new Map(databaseChildPageReferences.map((reference) => [reference.page.id, reference])),
    [databaseChildPageReferences],
  );
  const currentKey = keyOf(pageItem(current.meta.id));

  // DB-row child pages are not part of the ordinary page tree.  Fetch them only
  // while a reference picker is visible, using the server-side relationship
  // index rather than one shared-folder request per database row.
  useEffect(() => {
    if (!api || (mode !== "compare" && mode !== "split")) return;
    let active = true;
    setDatabaseChildPageReferencesLoading(true);
    void api.listWorkspaceDatabaseChildPages()
      .then((next) => { if (active) setDatabaseChildPageReferences(next); })
      .catch((error) => {
        // Keep the last successful candidate list visible during a transient
        // shared-folder/API failure instead of making the picker appear empty.
        console.warn("[workspace] database child-page reference load failed", error);
      })
      .finally(() => { if (active) setDatabaseChildPageReferencesLoading(false); });
    return () => { active = false; };
  }, [api, mode]);
  const availableItems = useMemo<Map<string, WorkbenchItem>>(() => {
    const value = new Map<string, WorkbenchItem>();
    value.set(currentKey, pageItem(current.meta.id));
    pages.forEach((page) => value.set(keyOf(pageItem(page.id)), pageItem(page.id)));
    databases.forEach((database) => value.set(keyOf(databaseItem(database.id)), databaseItem(database.id)));
    databaseChildPageReferences.forEach((reference) => {
      value.set(keyOf(pageItem(reference.page.id)), pageItem(reference.page.id));
    });
    // DB-row child pages intentionally do not appear in the ordinary page tree.
    // Preserve their already-open tabs so switching away never silently drops them.
    stored.tabs.forEach((tabKey) => {
      const item = parseItem(tabKey);
      if (item?.kind === "page" && !value.has(tabKey)) value.set(tabKey, item);
    });
    // Recently closed DB-row child pages are not present in the normal page tree.
    // Keep them eligible for immediate recovery without putting them back in the tab rail.
    (stored.closedTabs || []).forEach((snapshot) => {
      const item = parseItem(snapshot.key);
      if (item?.kind === "page" && !value.has(snapshot.key)) value.set(snapshot.key, item);
    });
    return value;
  }, [currentKey, current.meta.id, pages, databases, databaseChildPageReferences, stored.tabs, stored.closedTabs]);
  const validTabs = useMemo(() => {
    const available = stored.tabs.filter((key) => availableItems.has(key));
    const pinned = available.filter((key) => stored.pinned.includes(key));
    const regular = available.filter((key) => !stored.pinned.includes(key));
    return [...pinned, ...regular];
  }, [stored.tabs, stored.pinned, availableItems]);
  // Do not silently fall back to `currentKey` when every tab was closed.
  // The old fallback kept the last editor visible even after its tab disappeared.
  const hasOpenTabs = validTabs.length > 0;
  const selectedTabKey = hasOpenTabs
    ? (stored.activeItemKey && availableItems.has(stored.activeItemKey) ? stored.activeItemKey : validTabs[validTabs.length - 1])
    : undefined;
  const selectedItem = getItemSafe(selectedTabKey, availableItems);
  const defaultReferenceKey = stored.splitItemKey && availableItems.has(stored.splitItemKey)
    ? stored.splitItemKey
    : (selectedTabKey || currentKey);
  useEffect(() => {
    const databaseActive = mode === "tabs" && selectedItem?.kind === "database";
    document.body.classList.toggle("workspace-database-tab-active-v521", databaseActive);
    return () => document.body.classList.remove("workspace-database-tab-active-v521");
  }, [mode, selectedItem?.kind, selectedItem?.id]);

  useEffect(() => {
    // The active workbench item is also the single source of truth for sidebar
    // highlighting. When no tabs remain, explicitly clear the sidebar selection.
    if (!selectedItem) {
      onActiveItemChange?.(null);
      return;
    }
    onActiveItemChange?.({
      kind: selectedItem.kind,
      id: selectedItem.id,
      rowId: selectedItem.kind === "database" && rowFocus?.databaseId === selectedItem.id
        ? rowFocus.rowId
        : null,
    });
    // The parent callback is intentionally not a dependency: Main renders it inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.kind, selectedItem?.id, rowFocus?.databaseId, rowFocus?.rowId]);

  // Register a page only when navigation changes the current page.  Do not depend on
  // availableItems here: closing a tab mutates availableItems, and the old dependency
  // immediately re-added the tab the user had just closed.
  useEffect(() => {
    setStored((prev) => {
      if (prev.tabs.includes(currentKey)) return prev;
      const tabs = addTabWithLimit(prev.tabs, prev.pinned, currentKey);
      const next = rememberTab({
        ...prev,
        tabs,
        activeItemKey: prev.activeItemKey && prev.tabs.includes(prev.activeItemKey) ? prev.activeItemKey : currentKey,
        splitItemKey: prev.splitItemKey || currentKey,
        compareLeftKey: prev.compareLeftKey || currentKey,
        compareRightKey: prev.compareRightKey || currentKey,
      }, pageItem(current.meta.id));
      writeStored(next);
      return next;
    });
    // currentKey changes only when the main page navigation changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const updateStored = (updater: (value: StoredWorkbench) => StoredWorkbench) => setStored((previous) => {
    const next = updater(previous);
    writeStored(next);
    return next;
  });
  const selectTab = (item: WorkbenchItem, modeToUse: WorkbenchMode = "tabs") => {
    const itemKey = keyOf(item);
    updateStored((value) => {
      const next = rememberTab({
        ...value,
        tabs: addTabWithLimit(value.tabs, value.pinned, itemKey),
        activeItemKey: itemKey,
      }, item);
      return next;
    });
    setMode(modeToUse);
  };
  const chooseReference = (item: WorkbenchItem, modeToUse: WorkbenchMode = "split") => {
    const itemKey = keyOf(item);
    updateStored((value) => rememberTab({
      ...value,
      tabs: addTabWithLimit(value.tabs, value.pinned, itemKey),
      activeItemKey: itemKey,
      splitItemKey: itemKey,
    }, item));
    setMode(modeToUse);
  };
  const itemTitle = (item: WorkbenchItem) => {
    const remembered = stored.tabMeta?.[keyOf(item)]?.title;
    const childPage = item.kind === "page" ? databaseChildPageReferenceMap.get(item.id)?.page : undefined;
    return item.kind === "page"
      ? (item.id === current.meta.id ? current.meta.title : pageMap.get(item.id)?.title || childPage?.title) || remembered || "Untitled"
      : databaseMap.get(item.id)?.title || remembered || "無題のデータベース";
  };
  const itemIcon = (item: WorkbenchItem) => {
    const remembered = stored.tabMeta?.[keyOf(item)]?.icon;
    const childPage = item.kind === "page" ? databaseChildPageReferenceMap.get(item.id)?.page : undefined;
    return item.kind === "page"
      ? ((item.id === current.meta.id ? current.meta.icon : pageMap.get(item.id)?.icon || childPage?.icon) || remembered || "📄")
      : remembered || "▦";
  };
  const referenceLabel = (item: WorkbenchItem) => {
    if (item.kind !== "page") return itemTitle(item);
    const childPage = databaseChildPageReferenceMap.get(item.id);
    return childPage
      ? `${childPage.databaseTitle} › ${childPage.rowTitle} › ${childPage.page.title || "Untitled"}`
      : itemTitle(item);
  };
  const getItem = (key?: string): WorkbenchItem | undefined => key ? availableItems.get(key) : undefined;
  const rememberTab = (value: StoredWorkbench, item: WorkbenchItem): StoredWorkbench => {
    const itemKey = keyOf(item);
    return {
      ...value,
      tabMeta: {
        ...(value.tabMeta || {}),
        [itemKey]: { title: itemTitle(item), icon: itemIcon(item) },
      },
    };
  };

  const closeTab = (key: string) => {
    const closingActive = selectedTabKey === key;
    const remainingKeys = validTabs.filter((tabKey) => tabKey !== key);
    const fallback = closingActive ? getItem(remainingKeys[remainingKeys.length - 1]) : undefined;
    const closingItem = getItem(key);

    updateStored((value) => {
      const tabMeta = { ...(value.tabMeta || {}) };
      const snapshot: ClosedTabSnapshot = {
        key,
        pinned: value.pinned.includes(key),
        closedAt: Date.now(),
        title: closingItem ? itemTitle(closingItem) : tabMeta[key]?.title,
        icon: closingItem ? itemIcon(closingItem) : tabMeta[key]?.icon,
      };
      delete tabMeta[key];
      const tabs = value.tabs.filter((valueKey) => valueKey !== key);
      const closedTabs = [snapshot, ...(value.closedTabs || []).filter((entry) => entry.key !== key)].slice(0, 12);
      return {
        ...value,
        tabs,
        pinned: value.pinned.filter((valueKey) => valueKey !== key),
        closedTabs,
        tabMeta,
        activeItemKey: closingActive ? (fallback ? keyOf(fallback) : undefined) : value.activeItemKey,
        splitItemKey: value.splitItemKey === key ? (fallback ? keyOf(fallback) : undefined) : value.splitItemKey,
        compareLeftKey: value.compareLeftKey === key ? (fallback ? keyOf(fallback) : undefined) : value.compareLeftKey,
        compareRightKey: value.compareRightKey === key ? (fallback ? keyOf(fallback) : undefined) : value.compareRightKey,
      };
    });

    if (closingActive && !fallback) setMode("tabs");
    // A page tab owns the main editor. After closing the active one, navigate once to
    // the fallback page; DB fallbacks are rendered directly by the workbench.
    if (fallback?.kind === "page" && fallback.id !== current.meta.id) onOpenPage(fallback.id);
  };
  const reopenClosedTab = (snapshot?: ClosedTabSnapshot) => {
    const candidate = snapshot || (stored.closedTabs || [])[0];
    if (!candidate) return;
    const item = parseItem(candidate.key);
    if (!item) return;
    updateStored((value) => {
      const tabs = addTabWithLimit(value.tabs, value.pinned, candidate.key);
      const tabMeta = {
        ...(value.tabMeta || {}),
        [candidate.key]: {
          title: candidate.title || value.tabMeta?.[candidate.key]?.title,
          icon: candidate.icon || value.tabMeta?.[candidate.key]?.icon,
        },
      };
      return {
        ...value,
        tabs,
        pinned: candidate.pinned && !value.pinned.includes(candidate.key)
          ? [...value.pinned, candidate.key]
          : value.pinned,
        tabMeta,
        activeItemKey: candidate.key,
        closedTabs: (value.closedTabs || []).filter((entry) => entry.key !== candidate.key),
      };
    });
    setMode("tabs");
    if (item.kind === "page" && item.id !== current.meta.id) onOpenPage(item.id);
  };

  const cycleTab = (direction: 1 | -1) => {
    if (validTabs.length < 2) return;
    const currentIndex = selectedTabKey ? validTabs.indexOf(selectedTabKey) : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + validTabs.length) % validTabs.length;
    const next = getItem(validTabs[nextIndex]);
    if (next) openTab(next);
  };

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest("input, textarea, select, [contenteditable='true'], .bn-editor"));
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isEditable(event.target)) return;
      if (event.key.toLowerCase() === "w" && selectedTabKey) {
        event.preventDefault();
        closeTab(selectedTabKey);
        return;
      }
      if (event.key.toLowerCase() === "t" && event.shiftKey) {
        event.preventDefault();
        reopenClosedTab();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        cycleTab(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  // closeTab/openTab intentionally derive the latest state from this render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTabKey, validTabs, stored.closedTabs, current.meta.id]);

  const reorderTab = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    updateStored((value) => { const tabs = value.tabs.filter((key) => key !== sourceKey); const index = tabs.indexOf(targetKey); if (index < 0) return value; tabs.splice(index, 0, sourceKey); return { ...value, tabs }; });
  };
  const togglePin = (key: string) => updateStored((value) => ({ ...value, pinned: value.pinned.includes(key) ? value.pinned.filter((valueKey) => valueKey !== key) : [...value.pinned, key] }));
  const scrollTabs = (direction: number) => tabsScrollRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  const clampSplitWidth = (value: number) => Math.round(Math.max(360, Math.min(Math.max(390, Math.min(860, window.innerWidth - 420)), value)));

  const openTab = (item: WorkbenchItem) => {
    if (item.kind === "database") setRowFocus(null);
    selectTab(item, "tabs");
    if (item.kind === "page" && item.id !== current.meta.id) { onOpenPage(item.id); }
  };

  const beginSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (window.innerWidth <= 900) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId);
    splitResizeRef.current = { active: true, width: splitWidth }; document.body.classList.add("workspace-resizing-v513");
    const move = (next: PointerEvent) => { if (!splitResizeRef.current.active) return; const width = clampSplitWidth(window.innerWidth - next.clientX - 14); splitResizeRef.current.width = width; setSplitWidth(width); };
    const end = () => { if (!splitResizeRef.current.active) return; splitResizeRef.current.active = false; document.body.classList.remove("workspace-resizing-v513"); updateStored((value) => ({ ...value, splitWidth: splitResizeRef.current.width })); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };
  const beginCompareResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const grid = compareGridRef.current; if (!grid || window.innerWidth <= 900) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); compareResizeRef.current = { active: true, ratio: compareRatio }; document.body.classList.add("workspace-resizing-v513");
    const setRatio = (clientX: number) => { const rect = grid.getBoundingClientRect(); if (!rect.width) return; const ratio = Math.max(.25, Math.min(.75, (clientX - rect.left) / rect.width)); compareResizeRef.current.ratio = ratio; setCompareRatio(ratio); };
    setRatio(event.clientX);
    const move = (next: PointerEvent) => { if (compareResizeRef.current.active) setRatio(next.clientX); };
    const end = () => { if (!compareResizeRef.current.active) return; compareResizeRef.current.active = false; document.body.classList.remove("workspace-resizing-v513"); updateStored((value) => ({ ...value, compareRatio: Math.round(compareResizeRef.current.ratio * 1000) / 1000 })); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };

  useEffect(() => {
    const handleWorkspaceOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: WorkbenchItemKind; id?: string; rowId?: string; mode?: "tabs" | "split" | "compare" }>).detail;
      if (!detail?.id || (detail.kind !== "database" && detail.kind !== "page")) return;
      const item: WorkbenchItem = { kind: detail.kind, id: detail.id };
      if (detail.kind === "database") setRowFocus(detail.rowId ? { databaseId: detail.id, rowId: detail.rowId } : null);
      const itemKey = keyOf(item);
      if (!availableItems.has(itemKey)) return;
      updateStored((value) => {
        const tabs = addTabWithLimit(value.tabs, value.pinned, itemKey);
        if (detail.mode === "compare") {
          return rememberTab({
            ...value,
            tabs,
            activeItemKey: itemKey,
            compareLeftKey: value.compareLeftKey && availableItems.has(value.compareLeftKey) ? value.compareLeftKey : currentKey,
            compareRightKey: itemKey,
          }, item);
        }
        return rememberTab({ ...value, tabs, activeItemKey: itemKey, splitItemKey: itemKey }, item);
      });
      setMode(detail.mode === "compare" ? "compare" : detail.mode === "split" ? "split" : "tabs");
    };
    window.addEventListener("local-notion:workspace-open-item", handleWorkspaceOpen as EventListener);
    return () => window.removeEventListener("local-notion:workspace-open-item", handleWorkspaceOpen as EventListener);
  }, [availableItems, currentKey]);

  useEffect(() => {
    const refreshChildPageReferenceCandidates = (event: Event) => {
      if (!api || (mode !== "compare" && mode !== "split")) return;
      const detail = (event as CustomEvent<{ pageId?: string; action?: string }>).detail;
      const action = detail?.action || "";
      if (!detail?.pageId || !["trashed", "deleted", "empty-trash", "removed"].includes(action)) return;

      // Remove the candidate immediately so a just-deleted child page cannot be
      // selected while the authoritative index refresh is still in flight.
      setDatabaseChildPageReferences((current) =>
        current.filter((reference) => reference.page.id !== detail.pageId),
      );
      setDatabaseChildPageReferencesLoading(true);
      void api.listWorkspaceDatabaseChildPages()
        .then((next) => setDatabaseChildPageReferences(next))
        .catch((error) => {
          console.warn("[workspace] database child-page reference refresh failed", error);
        })
        .finally(() => setDatabaseChildPageReferencesLoading(false));
    };

    window.addEventListener(
      "local-notion:page-tree-mutated",
      refreshChildPageReferenceCandidates as EventListener,
    );
    window.addEventListener(
      "local-notion:database-row-child-page-removed",
      refreshChildPageReferenceCandidates as EventListener,
    );
    return () => {
      window.removeEventListener(
        "local-notion:page-tree-mutated",
        refreshChildPageReferenceCandidates as EventListener,
      );
      window.removeEventListener(
        "local-notion:database-row-child-page-removed",
        refreshChildPageReferenceCandidates as EventListener,
      );
    };
  }, [api, mode]);

  useEffect(() => {
    const handlePageTreeMutation = (event: Event) => {
      const custom = event as CustomEvent<{ pageId?: string; action?: string; workspaceFallbackKey?: string; workspaceHasFallback?: boolean }> ;
      const detail = custom.detail;
      if (!detail?.pageId || !["trashed", "deleted", "empty-trash"].includes(detail.action || "")) return;
      const closingKey = keyOf(pageItem(detail.pageId));
      const closingActive = selectedTabKey === closingKey;
      const remainingKeys = validTabs.filter((tabKey) => tabKey !== closingKey);
      const fallbackKey = closingActive ? remainingKeys[remainingKeys.length - 1] : undefined;
      const fallback = getItem(fallbackKey);

      // The main screen reads this synchronously after dispatching the mutation event.
      // It must not clear the whole workspace while another tab can be activated.
      if (closingActive) {
        detail.workspaceFallbackKey = fallbackKey;
        detail.workspaceHasFallback = Boolean(fallback);
      }

      updateStored((value) => {
        if (!value.tabs.includes(closingKey)) return value;
        const tabs = value.tabs.filter((key) => key !== closingKey);
        const tabMeta = { ...(value.tabMeta || {}) };
        delete tabMeta[closingKey];
        return {
          ...value,
          tabs,
          pinned: value.pinned.filter((key) => key !== closingKey),
          tabMeta,
          activeItemKey: value.activeItemKey === closingKey ? fallbackKey : value.activeItemKey,
          splitItemKey: value.splitItemKey === closingKey ? fallbackKey : value.splitItemKey,
          compareLeftKey: value.compareLeftKey === closingKey ? fallbackKey : value.compareLeftKey,
          compareRightKey: value.compareRightKey === closingKey ? fallbackKey : value.compareRightKey,
        };
      });

      if (!closingActive) return;
      if (!fallback) {
        setMode("tabs");
        return;
      }
      if (fallback.kind === "page" && fallback.id !== current.meta.id) onOpenPage(fallback.id);
    };
    window.addEventListener("local-notion:page-tree-mutated", handlePageTreeMutation as EventListener);
    return () => window.removeEventListener("local-notion:page-tree-mutated", handlePageTreeMutation as EventListener);
  }, [selectedTabKey, validTabs, availableItems, current.meta.id]);

  useEffect(() => {
    if (!tabContextMenu) return;
    const close = () => setTabContextMenu(null);
    window.addEventListener("click", close); window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [tabContextMenu]);

  const renderPane = (itemKey?: string) => {
    const item = getItem(itemKey) || pageItem(current.meta.id);
    return item.kind === "page"
      ? <PanePage api={api} pageId={item.id} pages={pages} databases={databases} onOpenPage={onOpenPage} onOpenDatabase={(id) => chooseReference(databaseItem(id))} />
      : <PaneDatabase api={api} database={databaseMap.get(item.id)} databases={databases} pages={pages} journals={journals} onOpenPage={onOpenPage} onOpenDatabase={(id) => chooseReference(databaseItem(id))} editing={false} initialSelectedRowId={rowFocus?.databaseId === item.id ? rowFocus.rowId : null} />;
  };
  // Reference candidates include ordinary pages, databases, and DB-row child pages.
  // DB-row child pages are intentionally absent from `pageMap`, so filtering only
  // by the ordinary tree silently removed every child page except the currently
  // selected one. Use the relationship-index result as an equally valid page source.
  const referenceOptions = (Array.from(availableItems.values()) as WorkbenchItem[]).filter((item) => {
    if (item.kind === "database") return Boolean(databaseMap.get(item.id));
    return Boolean(
      pageMap.get(item.id)
      || item.id === current.meta.id
      || databaseChildPageReferenceMap.has(item.id),
    );
  });

  return <section className="workspace-workbench-v476" aria-label="作業スペース">
    <div className="workspace-tabs-v476" role="tablist" aria-label="ページとデータベースのタブ">
      <button type="button" className="workspace-tab-scroll-v478" onClick={() => scrollTabs(-1)} title="前のタブを表示" aria-label="前のタブを表示">‹</button>
      <div className="workspace-tabs-scroll-v476" ref={tabsScrollRef} onWheel={(event) => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
        {validTabs.map((key) => {
          const item = getItem(key); if (!item) return null;
          const active = key === selectedTabKey;
          const pinned = stored.pinned.includes(key);
          return <div key={key} draggable onDragStart={(event) => { setDraggedTabKey(key); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedTabKey(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedTabKey) reorderTab(draggedTabKey, key); setDraggedTabKey(null); }} onContextMenu={(event) => { event.preventDefault(); const position = getSafeMenuPosition(event.clientX, event.clientY, 268, 240); setTabContextMenu({ key, x: position.x, y: position.y }); }} className={`workspace-tab-v476 ${active ? "is-active" : ""} ${pinned ? "is-pinned-tab-v478" : ""} ${draggedTabKey === key ? "is-dragging-v478" : ""}`} role="tab" aria-selected={active}>
            <button type="button" className="workspace-tab-open-v476" onClick={() => openTab(item)} title={`${itemTitle(item)} を開く`}>
              <span className="workspace-tab-icon-v486" aria-hidden="true">{itemIcon(item)}</span><span className="workspace-tab-title-v486">{itemTitle(item)}</span>{active && dirty ? <span className="workspace-tab-dirty-v486" title="未保存" aria-label="未保存" /> : null}
            </button>
            <button type="button" className={`workspace-tab-pin-v476 ${pinned ? "is-pinned" : ""}`} title={pinned ? "ピン留めを外す" : "ピン留め"} onClick={() => togglePin(key)}>⌖</button>
            <button type="button" className="workspace-tab-close-v476" title="タブを閉じる" aria-label={`${itemTitle(item)} のタブを閉じる`} onClick={() => closeTab(key)}>×</button>
          </div>;
        })}
      </div>
      <button type="button" className="workspace-tab-scroll-v478" onClick={() => scrollTabs(1)} title="次のタブを表示" aria-label="次のタブを表示">›</button>
      <div className="workspace-workbench-actions-v476">
        <button type="button" className="workspace-reopen-tab-v555" disabled={!(stored.closedTabs || []).length} onClick={() => reopenClosedTab()} title="閉じたタブを再度開く（Ctrl / ⌘ + Shift + T）">↶ <span>復元</span></button>
        <button type="button" className={mode === "compare" ? "is-active" : ""} onClick={() => setMode(mode === "compare" ? "tabs" : "compare")} title="ページ・データベースを左右で比較">⇄ <span>比較</span></button>
        <button type="button" className={mode === "split" ? "is-active" : ""} onClick={() => setMode(mode === "split" ? "tabs" : "split")} title="ページ・データベースを横に表示">▯ <span>分割</span></button>
      </div>
    </div>
    {tabContextMenu ? (() => { const item = getItem(tabContextMenu.key); if (!item) return null; const pinned = stored.pinned.includes(tabContextMenu.key); return <div className="workspace-tab-menu-v478" role="menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} onClick={(event) => event.stopPropagation()}><div className="workspace-tab-menu-title-v489"><span>{itemIcon(item)}</span><div><strong>{itemTitle(item)}</strong><small>{item.kind === "database" ? "データベース" : "ページ"}</small></div></div><div className="workspace-tab-menu-group-v489"><button type="button" onClick={() => { openTab(item); setTabContextMenu(null); }}>↗ このタブを開く</button><button type="button" onClick={() => { togglePin(tabContextMenu.key); setTabContextMenu(null); }}>⌖ {pinned ? "ピン留めを外す" : "ピン留め"}</button></div><div className="workspace-tab-menu-separator-v489"/><div className="workspace-tab-menu-group-v489"><button type="button" onClick={() => { closeTab(tabContextMenu.key); setTabContextMenu(null); }}>× タブを閉じる</button></div></div>; })() : null}
    {hasOpenTabs && toolbar ? <div className="workspace-item-toolbar-v533">{toolbar}</div> : null}
    {mode === "tabs" && selectedItem?.kind === "database" ? (() => {
      const database = databaseMap.get(selectedItem.id);
      const scope = database?.scope === "private" ? "private" : "shared";
      return <section className="workspace-focus-database-v520 workspace-focus-database-editable-v521" aria-label={`${itemTitle(selectedItem)} のデータベースタブ`}>
        <header>
          <div>
            <span className="workspace-kicker-v476">DATABASE</span>
            <strong>{itemTitle(selectedItem)}</strong>
            <small>ページと同じように、このタブで表を編集できます。行を開くと、その行のBlockNote本文を編集できます。</small>
          </div>
          <div className="workspace-database-header-actions-v524">
            <div className="db-scope-toggle-v163 workspace-db-scope-toggle-v524" title={scope === "private" ? "このPCだけに保存されています" : "共有フォルダに保存されています"}>
              <button className={scope === "private" ? "active private" : ""} onClick={() => onChangeDatabaseScope?.(selectedItem.id, "private")}>🔒 Private</button>
              <button className={scope === "shared" ? "active shared" : ""} onClick={() => onChangeDatabaseScope?.(selectedItem.id, "shared")}>🌐 Shared</button>
            </div>
            <button type="button" onClick={() => chooseReference(selectedItem, "split")}>右に分割</button>
            <button type="button" onClick={() => { updateStored((value) => ({ ...value, compareLeftKey: selectedTabKey, compareRightKey: value.compareRightKey || currentKey })); setMode("compare"); }}>比較</button>
            <button type="button" className="workspace-database-delete-v523" onClick={() => onDeleteDatabase?.(selectedItem.id)} title="このデータベースをゴミ箱へ移動">🗑️ 削除</button>
          </div>
        </header>
        <PaneDatabase api={api} database={database} databases={databases} pages={pages} journals={journals} onOpenPage={onOpenPage} onOpenDatabase={(id) => selectTab(databaseItem(id))} editing={true} initialSelectedRowId={rowFocus?.databaseId === selectedItem.id ? rowFocus.rowId : null} onChangeDatabase={(next) => onSaveDatabase?.(next)} showHeader={false} />
      </section>;
    })() : null}
    {mode === "compare" ? <div className="workspace-compare-v476"><div className="workspace-compare-head-v476"><div><span className="workspace-kicker-v476">COMPARE</span><strong>ページとデータベースを比較</strong><small>ページ・DB・DB行の子ページを左右に並べて確認できます。</small></div><button type="button" onClick={() => setMode("tabs")}>閉じる</button></div><div className="workspace-compare-selectors-v476"><label>左側<select value={stored.compareLeftKey || currentKey} onChange={(e) => updateStored((value) => ({ ...value, compareLeftKey: e.target.value }))}>{referenceOptions.map((item) => <option key={keyOf(item)} value={keyOf(item)}>{itemIcon(item)} {referenceLabel(item)}</option>)}</select></label><label>右側<select value={stored.compareRightKey || defaultReferenceKey} onChange={(e) => updateStored((value) => ({ ...value, compareRightKey: e.target.value }))}>{referenceOptions.map((item) => <option key={keyOf(item)} value={keyOf(item)}>{itemIcon(item)} {referenceLabel(item)}</option>)}</select></label></div>{databaseChildPageReferencesLoading ? <div className="workspace-reference-loading-v548">DB子ページを比較候補へ読み込んでいます…</div> : null}<div className="workspace-compare-grid-v476 workspace-compare-grid-resizable-v513" ref={compareGridRef} style={{ "--workspace-compare-left-v513": `${Math.round(compareRatio * 1000) / 10}%` } as React.CSSProperties}>{renderPane(stored.compareLeftKey || currentKey)}<div className="workspace-compare-resizer-v513" title="ドラッグして左右の幅を変更" role="separator" aria-orientation="vertical" onPointerDown={beginCompareResize}/>{renderPane(stored.compareRightKey || defaultReferenceKey)}</div></div> : null}
    {mode === "split" ? <aside className="workspace-split-pane-v476 workspace-split-pane-resizable-v513 workspace-split-pane-database-v518" style={{ width: `${clampSplitWidth(splitWidth)}px` }}><div className="workspace-split-handle-v476 workspace-split-handle-v513" title="ドラッグして幅を変更" role="separator" aria-orientation="vertical" onPointerDown={beginSplitResize}/><header><div><span className="workspace-kicker-v476">REFERENCE</span><strong>参照ペイン</strong></div><button type="button" onClick={() => setMode("tabs")}>×</button></header><label className="workspace-split-select-v476">参照先<select value={defaultReferenceKey} onChange={(e) => updateStored((value) => ({ ...value, splitItemKey: e.target.value }))}>{referenceOptions.map((item) => <option key={keyOf(item)} value={keyOf(item)}>{itemIcon(item)} {referenceLabel(item)}</option>)}</select></label>{databaseChildPageReferencesLoading ? <div className="workspace-reference-loading-v548">DB子ページを参照候補へ読み込んでいます…</div> : null}{renderPane(defaultReferenceKey)}<footer>{getItem(defaultReferenceKey)?.kind === "page" ? <button type="button" onClick={() => onOpenPage(getItem(defaultReferenceKey)!.id)}>このページを開く ↗</button> : <span>データベースは閲覧専用です</span>}</footer></aside> : null}
    {mode === "tabs" && hasOpenTabs ? <div className="workspace-workbench-hint-v476">{current.meta.title || "このページ"} を編集中です。サイドバーのページ・データベースは同じタブ列に開きます。DBはページと同じように表を編集でき、各行の本文はBlockNoteで編集できます。分割・比較は閲覧専用の参照ペインとして開きます。</div> : null}
    {!hasOpenTabs ? <div className="workspace-workbench-empty-v476 workspace-workbench-no-tabs-v544">
      <span className="workspace-no-tabs-icon-v555">◫</span>
      <strong>開いているタブはありません</strong>
      <p>サイドバーからページまたはデータベースを選択できます。</p>
      {(stored.closedTabs || []).length ? <button type="button" onClick={() => reopenClosedTab()}>↶ 最後に閉じたタブを復元</button> : null}
      <small>Ctrl / ⌘ + Shift + T で最後に閉じたタブを復元できます。</small>
    </div> : null}
  </section>;
}
