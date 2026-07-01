import React, { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceDatabase } from "../../../../shared/types";
import { viewIcon } from "../database/DatabaseHelpers";

type DatabaseTab = {
  key: string;
  databaseId: string;
  viewId?: string;
  rowId?: string;
  pinned?: boolean;
};

type StoredDatabaseWorkbench = { tabs: DatabaseTab[] };
type TabPresentation = { icon: string; label: string; title: string };

/* The DB workbench intentionally shares the exact DOM/CSS contract used by
   WorkspaceWorkbench's BlockNote page tabs. Do not introduce a DB-only tab
   layout here: page and database tabs must look and behave identically. */
const STORAGE_KEY = "local-notion:database-workbench-tabs-v517";
const LEGACY_STORAGE_KEYS = [
  "local-notion:database-workbench-tabs-v516",
  "local-notion:database-workbench-tabs-v515",
  "local-notion:database-workbench-tabs-v514",
] as const;
const MAX_TABS = 12;

function isDatabaseTab(value: unknown): value is DatabaseTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  return typeof tab.key === "string"
    && typeof tab.databaseId === "string"
    && (tab.viewId === undefined || typeof tab.viewId === "string")
    && (tab.rowId === undefined || typeof tab.rowId === "string")
    && (tab.pinned === undefined || typeof tab.pinned === "boolean");
}

function readStored(): StoredDatabaseWorkbench {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
      || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean)
      || "{}";
    const parsed = JSON.parse(raw) as { tabs?: unknown };
    return { tabs: Array.isArray(parsed.tabs) ? parsed.tabs.filter(isDatabaseTab) : [] };
  } catch {
    return { tabs: [] };
  }
}

function writeStored(value: StoredDatabaseWorkbench) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* desktop preference only */ }
}

function tabKey(databaseId: string, viewId?: string, rowId?: string) {
  return rowId ? `row:${databaseId}:${rowId}` : `db:${databaseId}:${viewId || "source"}`;
}

function getTabPresentation(tab: DatabaseTab, database?: WorkspaceDatabase): TabPresentation {
  if (!database) return { icon: "⚠️", label: "見つからないデータベース", title: "見つからないデータベース" };

  if (tab.rowId) {
    const row = database.rows.find((item) => item.id === tab.rowId);
    const titleProperty = database.properties[0];
    const rowTitle = row && titleProperty ? String(row.cells[titleProperty.id] ?? "").trim() : "";
    const label = rowTitle || "行の詳細";
    return { icon: "🧾", label, title: `${label} — ${database.title || "データベース"} / 行の詳細` };
  }

  if (tab.viewId) {
    const view = database.views?.find((item) => item.id === tab.viewId);
    const label = view?.name || database.title || "データベース";
    return { icon: view ? viewIcon(view.type) : "🗃️", label, title: `${label} — ${database.title || "データベース"}` };
  }

  const label = database.title || "無題のデータベース";
  return { icon: "🗃️", label, title: `${label} — データベース` };
}

export function DatabaseWorkbenchTabs({
  current,
  databases,
  currentRowId,
  onOpenDatabase,
}: {
  current: WorkspaceDatabase;
  databases: WorkspaceDatabase[];
  currentRowId?: string | null;
  onOpenDatabase: (databaseId: string, viewId?: string, rowId?: string) => void;
}) {
  const initial = useMemo(readStored, []);
  const [tabs, setTabs] = useState<DatabaseTab[]>(initial.tabs);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const databaseMap = useMemo(() => new Map(databases.map((database) => [database.id, database])), [databases]);
  const activeViewId = current.activeViewId || current.views?.[0]?.id;
  const currentKey = currentRowId
    ? tabKey(current.id, undefined, currentRowId)
    : tabKey(current.id, activeViewId);

  const persist = (next: DatabaseTab[]) => {
    setTabs(next);
    writeStored({ tabs: next });
  };

  useEffect(() => {
    const nextTab: DatabaseTab = currentRowId
      ? { key: tabKey(current.id, undefined, currentRowId), databaseId: current.id, rowId: currentRowId }
      : { key: tabKey(current.id, activeViewId), databaseId: current.id, viewId: activeViewId };

    setTabs((previous) => {
      const valid = previous.filter((tab) => databaseMap.has(tab.databaseId));
      const existing = valid.find((tab) => tab.key === nextTab.key);
      const next = existing ? valid : [...valid, nextTab].slice(-MAX_TABS);
      writeStored({ tabs: next });
      return next;
    });
  }, [current.id, activeViewId, currentRowId, databaseMap]);

  const visibleTabs = useMemo(
    () => tabs.filter((tab) => databaseMap.has(tab.databaseId)),
    [tabs, databaseMap],
  );
  const open = (tab: DatabaseTab) => onOpenDatabase(tab.databaseId, tab.viewId, tab.rowId);

  const close = (key: string) => {
    if (key === currentKey && visibleTabs.length === 1) return;
    const next = visibleTabs.filter((tab) => tab.key !== key);
    persist(next);
    if (key === currentKey) {
      const fallback = next[next.length - 1];
      if (fallback) open(fallback);
    }
  };

  const togglePin = (key: string) => {
    persist(visibleTabs.map((tab) => tab.key === key ? { ...tab, pinned: !tab.pinned } : tab));
  };

  const reorder = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return;
    const next = [...visibleTabs];
    const from = next.findIndex((tab) => tab.key === sourceKey);
    const to = next.findIndex((tab) => tab.key === targetKey);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  };

  return (
    <section className="workspace-workbench-v476 database-workbench-tabs-v517" aria-label="開いているデータベース">
      <div className="workspace-tabs-v476" role="tablist" aria-label="開いているデータベース">
        <button
          type="button"
          className="workspace-tab-scroll-v478"
          onClick={() => scrollRef.current?.scrollBy({ left: -220, behavior: "smooth" })}
          title="前のタブを表示"
          aria-label="前のタブを表示"
        >
          ‹
        </button>
        <div
          className="workspace-tabs-scroll-v476"
          ref={scrollRef}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            event.currentTarget.scrollLeft += event.deltaY;
          }}
        >
          {visibleTabs.map((tab) => {
            const presentation = getTabPresentation(tab, databaseMap.get(tab.databaseId));
            const active = tab.key === currentKey;
            return (
              <div
                key={tab.key}
                draggable
                className={`workspace-tab-v476 ${active ? "is-active" : ""} ${tab.pinned ? "is-pinned-tab-v478" : ""} ${draggedKey === tab.key ? "is-dragging-v478" : ""}`}
                onDragStart={() => setDraggedKey(tab.key)}
                onDragEnd={() => setDraggedKey(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); if (draggedKey) reorder(draggedKey, tab.key); setDraggedKey(null); }}
                title={presentation.title}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="workspace-tab-open-v476"
                  onClick={() => open(tab)}
                  title={presentation.title}
                >
                  <span className="workspace-tab-icon-v486" aria-hidden="true">{presentation.icon}</span>
                  <span className="workspace-tab-title-v486">{presentation.label}</span>
                </button>
                <button
                  type="button"
                  className={`workspace-tab-pin-v476 ${tab.pinned ? "is-pinned" : ""}`}
                  onClick={() => togglePin(tab.key)}
                  aria-label={tab.pinned ? "ピン留めを外す" : "ピン留め"}
                  title={tab.pinned ? "ピン留めを外す" : "ピン留め"}
                >
                  {tab.pinned ? "●" : "○"}
                </button>
                <button
                  type="button"
                  className="workspace-tab-close-v476"
                  onClick={() => close(tab.key)}
                  disabled={active && visibleTabs.length === 1}
                  aria-label="タブを閉じる"
                  title="タブを閉じる"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="workspace-tab-scroll-v478"
          onClick={() => scrollRef.current?.scrollBy({ left: 220, behavior: "smooth" })}
          title="次のタブを表示"
          aria-label="次のタブを表示"
        >
          ›
        </button>
      </div>
    </section>
  );
}
