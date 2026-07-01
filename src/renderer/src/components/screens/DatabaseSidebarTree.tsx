import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  DatabaseSidebarChildPagesResult,
  DatabaseSidebarRowsResult,
  WorkspaceDatabase,
} from "../../../../shared/types";
import type { ApiClient } from "../../lib/api";
import { getDatabaseRowTitle } from "../database/DatabaseCoreHelpers";

const PAGE_SIZE = 30;

type Props = {
  api: ApiClient | null;
  databases: WorkspaceDatabase[];
  currentDatabaseId?: string | null;
  currentDatabaseRowId?: string | null;
  activePageId?: string | null;
  activePageParentId?: string | null;
  refreshKey?: number;
  onOpenDatabase: (databaseId: string) => void;
  onOpenDatabaseInWorkspace?: (
    databaseId: string,
    mode?: "tabs" | "split" | "compare",
  ) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenDatabaseRowInWorkspace?: (
    databaseId: string,
    rowId: string,
    mode?: "tabs" | "split" | "compare",
  ) => void;
  onOpenPage: (pageId: string) => void;
  onDeleteDatabase: (databaseId: string) => void;
  scopeIcon: (scope: "shared" | "private") => string;
  scopeLabel: (scope: "shared" | "private") => string;
  scopeNotice: (scope?: "shared" | "private") => string;
  workspaceScope: (item: {
    scope?: "shared" | "private";
  }) => "shared" | "private";
};

type RowsState = DatabaseSidebarRowsResult & {
  loading?: boolean;
  error?: string;
};
type ChildrenState = DatabaseSidebarChildPagesResult & {
  loading?: boolean;
  error?: string;
};

type SidebarPreview =
  | { kind: "database"; databaseId: string; left: number; top: number }
  | {
      kind: "row";
      databaseId: string;
      rowId: string;
      left: number;
      top: number;
    }
  | {
      kind: "child-page";
      databaseId: string;
      rowId: string;
      pageId: string;
      left: number;
      top: number;
    };

function formatPreviewDate(value?: string): string {
  if (!value) return "更新日なし";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value.slice(0, 16);
  }
}

function previewAnchorFromElement(element: Element): {
  left: number;
  top: number;
} {
  const rect = element.getBoundingClientRect();
  const width = 390;
  const margin = 14;
  const viewportMargin = 14;
  // The quick preview is vertically centered on its anchor. Clamp against the
  // *actual maximum card height*, rather than a fixed 118px offset, so a
  // database preview near the bottom never extends below the viewport.
  const previewMaxHeight = Math.min(430, window.innerHeight - viewportMargin * 2);
  const previewHalfHeight = Math.max(0, previewMaxHeight / 2);
  const availableRight = window.innerWidth - rect.right;
  const preferredTop = rect.top + rect.height / 2;
  const minTop = viewportMargin + previewHalfHeight;
  const maxTop = Math.max(minTop, window.innerHeight - viewportMargin - previewHalfHeight);

  return {
    left:
      availableRight >= width + margin
        ? rect.right + margin
        : Math.max(viewportMargin, rect.left - width - margin),
    top: Math.min(Math.max(preferredTop, minTop), maxTop),
  };
}

function readExpandedSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function writeExpandedSet(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {}
}

export function DatabaseSidebarTree({
  api,
  databases,
  currentDatabaseId,
  currentDatabaseRowId = null,
  activePageId = null,
  activePageParentId = null,
  refreshKey = 0,
  onOpenDatabase,
  onOpenDatabaseInWorkspace,
  onOpenDatabaseRow,
  onOpenDatabaseRowInWorkspace,
  onOpenPage,
  onDeleteDatabase,
  scopeIcon,
  scopeLabel,
  scopeNotice,
  workspaceScope,
}: Props) {
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(() =>
    readExpandedSet("local-notion:sidebar-expanded-databases"),
  );
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() =>
    readExpandedSet("local-notion:sidebar-expanded-dbrows"),
  );
  const [rowsByDatabase, setRowsByDatabase] = useState<
    Record<string, RowsState>
  >({});
  const [childrenByRow, setChildrenByRow] = useState<
    Record<string, ChildrenState>
  >({});
  const [databaseMenu, setDatabaseMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [quickPreview, setQuickPreview] = useState<SidebarPreview | null>(null);
  const previewCloseTimerRef = useRef<number | null>(null);
  // Ignore late shared-folder responses. Without a request generation, a slow
  // older read can overwrite a newer forced refresh after save/delete.
  const rowsRequestVersionRef = useRef<Record<string, number>>({});
  const childrenRequestVersionRef = useRef<Record<string, number>>({});

  const databaseIds = useMemo(
    () => new Set(databases.map((db) => db.id)),
    [databases],
  );

  function clearPreviewCloseTimer() {
    if (previewCloseTimerRef.current !== null) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  }

  function showDatabasePreview(
    event: React.MouseEvent<HTMLElement>,
    databaseId: string,
  ) {
    clearPreviewCloseTimer();
    const anchor = previewAnchorFromElement(event.currentTarget);
    setQuickPreview({ kind: "database", databaseId, ...anchor });
  }

  function showRowPreview(
    event: React.MouseEvent<HTMLElement>,
    databaseId: string,
    rowId: string,
  ) {
    clearPreviewCloseTimer();
    const anchor = previewAnchorFromElement(event.currentTarget);
    setQuickPreview({ kind: "row", databaseId, rowId, ...anchor });
  }

  function showChildPagePreview(
    event: React.MouseEvent<HTMLElement>,
    databaseId: string,
    rowId: string,
    pageId: string,
  ) {
    clearPreviewCloseTimer();
    const anchor = previewAnchorFromElement(event.currentTarget);
    setQuickPreview({
      kind: "child-page",
      databaseId,
      rowId,
      pageId,
      ...anchor,
    });
  }

  function scheduleQuickPreviewClose() {
    clearPreviewCloseTimer();
    previewCloseTimerRef.current = window.setTimeout(() => {
      setQuickPreview(null);
      previewCloseTimerRef.current = null;
    }, 140);
  }

  useEffect(() => () => clearPreviewCloseTimer(), []);

  useEffect(() => {
    if (!databaseMenu) return;
    const close = () => setDatabaseMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [databaseMenu]);
  const databaseRealtimeSignatures = useMemo(
    () =>
      Object.fromEntries(
        databases.map((db) => {
          const rows = Array.isArray(db.rows) ? db.rows : [];
          const rowSignature = rows
            .slice(0, 80)
            .map(
              (row) =>
                `${row.id}:${row.updatedAt || ""}:${Object.values(
                  row.cells || {},
                )
                  .slice(0, 4)
                  .map((value) =>
                    typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value ?? ""),
                  )
                  .join("|")}`,
            )
            .join(",");
          return [
            db.id,
            `${db.title}:${db.updatedAt}:${rows.length}:${rowSignature}`,
          ];
        }),
      ),
    [databases],
  );
  const previousDatabaseRealtimeSignaturesRef = useRef<Record<string, string>>(
    {},
  );

  useEffect(() => {
    setExpandedDatabases((prev) => {
      const next = new Set(
        Array.from(prev).filter((id) => databaseIds.has(id)),
      );
      if (next.size !== prev.size)
        writeExpandedSet("local-notion:sidebar-expanded-databases", next);
      return next;
    });
  }, [databaseIds]);

  useEffect(() => {
    if (!api) return;
    const previous = previousDatabaseRealtimeSignaturesRef.current;
    const changedIds = Array.from(expandedDatabases).filter(
      (databaseId) =>
        databaseIds.has(databaseId) &&
        previous[databaseId] !== databaseRealtimeSignatures[databaseId],
    );
    previousDatabaseRealtimeSignaturesRef.current = databaseRealtimeSignatures;
    // Refresh only the expanded databases whose own content changed.  Previously,
    // saving one database caused a shared-folder read for every expanded database.
    changedIds.forEach((databaseId) => {
      const current = rowsByDatabase[databaseId];
      const limit = Math.max(PAGE_SIZE, current?.rows?.length || PAGE_SIZE);
      loadRows(databaseId, { force: true, offset: 0, limit });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, databaseRealtimeSignatures, databaseIds, expandedDatabases]);

  async function loadRows(
    databaseId: string,
    options: {
      append?: boolean;
      offset?: number;
      force?: boolean;
      limit?: number;
    } = {},
  ) {
    if (!api) return;
    const current = rowsByDatabase[databaseId];
    if (current?.loading && !options.force) return;
    const requestVersion = (rowsRequestVersionRef.current[databaseId] || 0) + 1;
    rowsRequestVersionRef.current[databaseId] = requestVersion;
    const offset =
      options.offset ??
      (options.append ? (current?.nextOffset ?? current?.rows.length ?? 0) : 0);
    const limit = Math.max(
      PAGE_SIZE,
      Math.min(150, Number(options.limit ?? PAGE_SIZE) || PAGE_SIZE),
    );
    setRowsByDatabase((prev) => ({
      ...prev,
      [databaseId]: {
        ...(prev[databaseId] || {
          databaseId,
          rows: [],
          offset: 0,
          limit,
          total: 0,
          hasMore: false,
          nextOffset: null,
        }),
        loading: true,
        error: undefined,
      },
    }));
    try {
      const result = await api.listDatabaseSidebarRows(databaseId, {
        limit,
        offset,
      });
      if (rowsRequestVersionRef.current[databaseId] !== requestVersion) return;
      setRowsByDatabase((prev) => {
        const existing = options.append ? prev[databaseId]?.rows || [] : [];
        const known = new Set(existing.map((row) => row.rowId));
        const merged = [
          ...existing,
          ...result.rows.filter((row) => !known.has(row.rowId)),
        ];
        return {
          ...prev,
          [databaseId]: { ...result, rows: merged, loading: false },
        };
      });
    } catch (error) {
      if (rowsRequestVersionRef.current[databaseId] !== requestVersion) return;
      setRowsByDatabase((prev) => ({
        ...prev,
        [databaseId]: {
          ...(prev[databaseId] || {
            databaseId,
            rows: [],
            offset: 0,
            limit,
            total: 0,
            hasMore: false,
            nextOffset: null,
          }),
          loading: false,
          error:
            error instanceof Error ? error.message : "行を取得できませんでした",
        },
      }));
    }
  }

  async function loadChildren(
    databaseId: string,
    rowId: string,
    force = false,
  ) {
    if (!api) return;
    const key = `${databaseId}:${rowId}`;
    const current = childrenByRow[key];
    if (!force && current && !current.error) return;
    if (current?.loading && !force) return;
    const requestVersion = (childrenRequestVersionRef.current[key] || 0) + 1;
    childrenRequestVersionRef.current[key] = requestVersion;
    setChildrenByRow((prev) => ({
      ...prev,
      [key]: {
        databaseId,
        rowId,
        childPages: current?.childPages || [],
        loading: true,
        error: undefined,
      },
    }));
    try {
      const result = await api.listDatabaseRowSidebarChildren(
        databaseId,
        rowId,
      );
      if (childrenRequestVersionRef.current[key] !== requestVersion) return;
      setChildrenByRow((prev) => ({
        ...prev,
        [key]: { ...result, loading: false },
      }));
    } catch (error) {
      if (childrenRequestVersionRef.current[key] !== requestVersion) return;
      setChildrenByRow((prev) => ({
        ...prev,
        [key]: {
          databaseId,
          rowId,
          childPages: current?.childPages || [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "子ページを取得できませんでした",
        },
      }));
    }
  }

  useEffect(() => {
    if (!api) return;
    expandedDatabases.forEach((databaseId) =>
      loadRows(databaseId, { force: true }),
    );
    expandedRows.forEach((key) => {
      const [databaseId, rowId] = key.split(":");
      if (databaseId && rowId) loadChildren(databaseId, rowId, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, refreshKey]);

  // A DB-row child page is not part of the ordinary page tree.  When its tab
  // becomes active, automatically reveal its owning database and row so the
  // sidebar can reflect the same selection instead of appearing unselected.
  useEffect(() => {
    if (!api || !activePageId || !activePageParentId) return;
    const match = /^database-row:([^:]+):(.+)$/.exec(activePageParentId);
    if (!match) return;
    const [, databaseId, rowId] = match;
    if (!databaseIds.has(databaseId)) return;
    const rowKey = `${databaseId}:${rowId}`;
    setExpandedDatabases((prev) => {
      if (prev.has(databaseId)) return prev;
      const next = new Set(prev);
      next.add(databaseId);
      writeExpandedSet("local-notion:sidebar-expanded-databases", next);
      return next;
    });
    setExpandedRows((prev) => {
      if (prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.add(rowKey);
      writeExpandedSet("local-notion:sidebar-expanded-dbrows", next);
      return next;
    });
    const current = rowsByDatabase[databaseId];
    const limit = Math.max(PAGE_SIZE, current?.rows?.length || PAGE_SIZE);
    void loadRows(databaseId, { force: true, offset: 0, limit });
    void loadChildren(databaseId, rowId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, activePageId, activePageParentId, databaseIds]);

  function refreshExpandedTree(
    options: { pageId?: string; action?: string; title?: string } = {},
  ) {
    const pageId = options.pageId;
    const shouldRemove =
      options.action === "trashed" ||
      options.action === "deleted" ||
      options.action === "removed" ||
      options.action === "empty-trash";
    if (pageId) {
      setChildrenByRow((prev) => {
        const next: Record<string, ChildrenState> = {};
        for (const [key, state] of Object.entries(prev)) {
          const childPages = (state.childPages || [])
            .map((page) =>
              !shouldRemove && page.id === pageId && options.title
                ? { ...page, title: options.title }
                : page,
            )
            .filter((page) => !shouldRemove || page.id !== pageId);
          next[key] = { ...state, childPages };
        }
        return next;
      });
    }
    // A normal page title/save event does not change DB rows. Reloading every
    // expanded DB here caused expensive shared-folder reads on each page save.
    // Manual refresh keeps the explicit all-expanded-database behavior.
    if (options.pageId) return;
    expandedDatabases.forEach((databaseId) => {
      if (!databaseIds.has(databaseId)) return;
      const current = rowsByDatabase[databaseId];
      const limit = Math.max(PAGE_SIZE, current?.rows?.length || PAGE_SIZE);
      void loadRows(databaseId, { force: true, offset: 0, limit });
    });
    expandedRows.forEach((key) => {
      const [databaseId, rowId] = key.split(":");
      if (databaseId && rowId) void loadChildren(databaseId, rowId, true);
    });
  }

  useEffect(() => {
    function handleChildPageCreated(event: Event) {
      const detail =
        (event as CustomEvent<{ databaseId?: string; rowId?: string }>)
          .detail || {};
      const databaseId = detail.databaseId;
      const rowId = detail.rowId;
      if (!databaseId || !rowId) return;
      const rowKey = `${databaseId}:${rowId}`;
      setExpandedDatabases((prev) => {
        const next = new Set(prev);
        next.add(databaseId);
        writeExpandedSet("local-notion:sidebar-expanded-databases", next);
        return next;
      });
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.add(rowKey);
        writeExpandedSet("local-notion:sidebar-expanded-dbrows", next);
        return next;
      });
      const current = rowsByDatabase[databaseId];
      const limit = Math.max(PAGE_SIZE, current?.rows?.length || PAGE_SIZE);
      loadRows(databaseId, { force: true, offset: 0, limit });
      loadChildren(databaseId, rowId, true);
    }
    window.addEventListener(
      "local-notion:database-row-child-page-created",
      handleChildPageCreated as EventListener,
    );
    window.addEventListener(
      "local-notion:database-row-child-page-removed",
      handleChildPageCreated as EventListener,
    );
    return () => {
      window.removeEventListener(
        "local-notion:database-row-child-page-created",
        handleChildPageCreated as EventListener,
      );
      window.removeEventListener(
        "local-notion:database-row-child-page-removed",
        handleChildPageCreated as EventListener,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, rowsByDatabase]);

  useEffect(() => {
    function handleTreeMutated(event: Event) {
      const detail =
        (
          event as CustomEvent<{
            pageId?: string;
            action?: string;
            title?: string;
          }>
        ).detail || {};
      refreshExpandedTree({
        pageId: detail.pageId,
        action: detail.action,
        title: detail.title,
      });
    }
    window.addEventListener(
      "local-notion:page-tree-mutated",
      handleTreeMutated as EventListener,
    );
    window.addEventListener(
      "local-notion:database-sidebar-refresh",
      handleTreeMutated as EventListener,
    );
    return () => {
      window.removeEventListener(
        "local-notion:page-tree-mutated",
        handleTreeMutated as EventListener,
      );
      window.removeEventListener(
        "local-notion:database-sidebar-refresh",
        handleTreeMutated as EventListener,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, expandedDatabases, expandedRows, rowsByDatabase, databaseIds]);

  async function deleteChildPageFromTree(
    databaseId: string,
    rowId: string,
    pageId: string,
    title: string,
  ) {
    if (!api) return;
    if (!confirm(`子ページ「${title || "無題"}」をゴミ箱に移動しますか？`))
      return;
    const key = `${databaseId}:${rowId}`;
    setChildrenByRow((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { databaseId, rowId, childPages: [] }),
        childPages: (prev[key]?.childPages || []).filter(
          (page) => page.id !== pageId,
        ),
        loading: false,
      },
    }));
    try {
      await api.deleteDatabaseRowChildPage(databaseId, rowId, pageId, {
        trashPage: true,
      });
      window.dispatchEvent(
        new CustomEvent("local-notion:database-row-child-page-removed", {
          detail: { databaseId, rowId, pageId, action: "removed" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("local-notion:page-tree-mutated", {
          detail: { pageId, action: "trashed" },
        }),
      );
      const current = rowsByDatabase[databaseId];
      const limit = Math.max(PAGE_SIZE, current?.rows?.length || PAGE_SIZE);
      loadRows(databaseId, { force: true, offset: 0, limit });
      loadChildren(databaseId, rowId, true);
    } catch (error) {
      setChildrenByRow((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || { databaseId, rowId, childPages: [] }),
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "子ページを削除できませんでした",
        },
      }));
      loadChildren(databaseId, rowId, true);
    }
  }

  function toggleDatabase(databaseId: string) {
    setExpandedDatabases((prev) => {
      const next = new Set(prev);
      if (next.has(databaseId)) next.delete(databaseId);
      else {
        next.add(databaseId);
        if (!rowsByDatabase[databaseId]) loadRows(databaseId);
      }
      writeExpandedSet("local-notion:sidebar-expanded-databases", next);
      return next;
    });
  }

  function toggleRow(databaseId: string, rowId: string) {
    const key = `${databaseId}:${rowId}`;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        loadChildren(databaseId, rowId);
      }
      writeExpandedSet("local-notion:sidebar-expanded-dbrows", next);
      return next;
    });
  }

  return (
    <div className="page-list database-list database-list-v61 db-sidebar-tree-v264">
      <div className="database-list-head-v61">
        <div>
          <span className="section-kicker-v61">Workspace</span>
          <strong>データベース</strong>
        </div>
        <button
          className="db-sidebar-tree-refresh-v268"
          onClick={() => refreshExpandedTree()}
          title="データベースツリーを更新"
        >
          ↻
        </button>
      </div>
      {databases.length === 0 ? (
        <div className="db-sidebar-empty-v61">
          <span>🗃️</span>
          <b>まだありません</b>
          <small>＋からデータベースを作成できます。</small>
        </div>
      ) : (
        databases.map((db) => {
          const scope = workspaceScope(db);
          const expanded = expandedDatabases.has(db.id);
          const rowState = rowsByDatabase[db.id];
          return (
            <div key={db.id} className="db-tree-db-block-v264">
              <div
                className={
                  currentDatabaseId === db.id
                    ? "db-tree-database-node-v265 selected"
                    : "db-tree-database-node-v265"
                }
                onMouseEnter={(event) => showDatabasePreview(event, db.id)}
                onMouseLeave={scheduleQuickPreviewClose}
              >
                <button
                  className="db-tree-toggle-v264"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleDatabase(db.id);
                  }}
                  title={expanded ? "折りたたむ" : "DB行を表示"}
                >
                  {expanded ? "▾" : "▸"}
                </button>
                <button
                  className="db-tree-database-open-v265"
                  onClick={() => {
                    if (onOpenDatabaseInWorkspace)
                      onOpenDatabaseInWorkspace(db.id, "tabs");
                    else onOpenDatabase(db.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDatabaseMenu({
                      id: db.id,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  title={`${db.title} を作業スペースのタブで開く`}
                >
                  <span className="db-tree-database-icon-v265">🗃️</span>
                  <span className="db-tree-database-copy-v265">
                    <span className="db-tree-database-title-v265">
                      <span
                        className={`tree-scope-mini ${scope}`}
                        title={scopeLabel(scope)}
                      >
                        {scopeIcon(scope)}
                      </span>
                      <b>{db.title || "Untitled database"}</b>
                    </span>
                    <small>
                      {db.rows.length} 行 ・ {db.properties.length} プロパティ
                    </small>
                  </span>
                </button>
                <button
                  className="db-tree-database-menu-v265"
                  title="データベースを削除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDatabase(db.id);
                  }}
                >
                  …
                </button>
              </div>
              {expanded && (
                <div className="db-tree-rows-v264">
                  {rowState?.loading &&
                  (!rowState.rows || rowState.rows.length === 0) ? (
                    <div className="db-tree-muted-v264">行を読み込み中...</div>
                  ) : null}
                  {rowState?.error ? (
                    <div className="db-tree-error-v264">{rowState.error}</div>
                  ) : null}
                  {(rowState?.rows || []).map((row) => {
                    const rowKey = `${db.id}:${row.rowId}`;
                    const rowExpanded = expandedRows.has(rowKey);
                    const children = childrenByRow[rowKey];
                    return (
                      <div key={row.rowId} className="db-tree-row-block-v264">
                        <div
                          className={
                            currentDatabaseId === db.id &&
                            currentDatabaseRowId === row.rowId
                              ? "db-tree-row-v264 selected"
                              : "db-tree-row-v264"
                          }
                          onMouseEnter={(event) =>
                            showRowPreview(event, db.id, row.rowId)
                          }
                          onMouseLeave={scheduleQuickPreviewClose}
                        >
                          <button
                            className="db-tree-toggle-v264"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleRow(db.id, row.rowId);
                            }}
                            title={
                              rowExpanded ? "子ページを隠す" : "子ページを表示"
                            }
                          >
                            {rowExpanded ? "▾" : "▸"}
                          </button>
                          <button
                            className="db-tree-row-open-v264"
                            onClick={() => {
                              if (onOpenDatabaseRowInWorkspace)
                                onOpenDatabaseRowInWorkspace(
                                  db.id,
                                  row.rowId,
                                  "tabs",
                                );
                              else onOpenDatabaseRow(db.id, row.rowId);
                            }}
                            title={`${row.title} をデータベースタブで開く`}
                          >
                            <span>🧾</span>
                            <b>{row.title}</b>
                            {row.childCount > 0 ? (
                              <small>{row.childCount}</small>
                            ) : null}
                          </button>
                        </div>
                        {rowExpanded && (
                          <div className="db-tree-children-v264">
                            {children?.loading &&
                            !children.childPages.length ? (
                              <div className="db-tree-muted-v264">
                                子ページを読み込み中...
                              </div>
                            ) : null}
                            {children?.error ? (
                              <div className="db-tree-error-v264">
                                {children.error}
                              </div>
                            ) : null}
                            {(children?.childPages || []).length === 0 &&
                            !children?.loading ? (
                              <div className="db-tree-muted-v264">
                                子ページなし
                              </div>
                            ) : null}
                            {(children?.childPages || []).map((page) => (
                              <div
                                key={page.id}
                                className="db-tree-child-page-line-v269"
                              >
                                <button
                                  className={
                                    activePageId === page.id
                                      ? "db-tree-child-page-v264 selected"
                                      : "db-tree-child-page-v264"
                                  }
                                  onClick={() => onOpenPage(page.id)}
                                  onMouseEnter={(event) =>
                                    showChildPagePreview(
                                      event,
                                      db.id,
                                      row.rowId,
                                      page.id,
                                    )
                                  }
                                  onMouseLeave={scheduleQuickPreviewClose}
                                  title={`${page.title} のプレビューを表示`}
                                >
                                  <span>{page.icon || "📄"}</span>
                                  <b>{page.title}</b>
                                </button>
                                <button
                                  className="db-tree-child-page-delete-v269"
                                  title="子ページをゴミ箱へ"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteChildPageFromTree(
                                      db.id,
                                      row.rowId,
                                      page.id,
                                      page.title,
                                    );
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {rowState?.hasMore ? (
                    <button
                      className="db-tree-more-v264"
                      onClick={() => loadRows(db.id, { append: true })}
                    >
                      {rowState.loading ? "読み込み中..." : "さらに表示"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })
      )}
      {quickPreview && typeof document !== "undefined"
        ? (() => {
            const database = databases.find(
              (item) => item.id === quickPreview.databaseId,
            );
            if (!database) return null;
            const scope = workspaceScope(database);
            const row =
              quickPreview.kind === "row" || quickPreview.kind === "child-page"
                ? (rowsByDatabase[database.id]?.rows || []).find(
                    (item) => item.rowId === quickPreview.rowId,
                  )
                : null;
            const childPage =
              quickPreview.kind === "child-page"
                ? (childrenByRow[`${quickPreview.databaseId}:${quickPreview.rowId}`]
                    ?.childPages || []
                  ).find((item) => item.id === quickPreview.pageId) || null
                : null;
            const propertyNames = database.properties
              .slice(0, 5)
              .map((property) => property.name || "無題のプロパティ");
            const recentRows = (
              rowsByDatabase[database.id]?.rows ||
              database.rows
                .slice(0, 4)
                .map((item) => ({
                  rowId: item.id,
                  title: getDatabaseRowTitle(database, item.id),
                  updatedAt: item.updatedAt || "",
                  childCount: 0,
                  hasChildren: false,
                }))
            ).slice(0, 4);
            const isRow = quickPreview.kind === "row";
            const isChildPage = quickPreview.kind === "child-page";
            if (isChildPage && !childPage) return null;
            return createPortal(
              <section
                className="db-quick-preview-portal-v557"
                role="dialog"
                aria-label={
                  isChildPage
                    ? "データベース子ページのクイックプレビュー"
                    : isRow
                      ? "データベース行のクイックプレビュー"
                      : "データベースのクイックプレビュー"
                }
                style={{ left: quickPreview.left, top: quickPreview.top }}
                onMouseEnter={clearPreviewCloseTimer}
                onMouseLeave={scheduleQuickPreviewClose}
              >
                <header className="db-quick-preview-head-v557">
                  <span className="db-quick-preview-icon-v557">
                    {isChildPage
                      ? childPage?.icon || "📄"
                      : isRow
                        ? "🧾"
                        : "🗃️"}
                  </span>
                  <div>
                    <strong>
                      {isChildPage
                        ? childPage?.title || "無題の子ページ"
                        : isRow
                          ? row?.title || "無題の行"
                          : database.title || "無題のデータベース"}
                    </strong>
                    <small>
                      {isChildPage
                        ? `${database.title || "データベース"} › ${row?.title || "無題の行"} ・ 更新 ${formatPreviewDate(childPage?.updatedAt)}`
                        : isRow
                          ? `${database.title || "データベース"} ・ 更新 ${formatPreviewDate(row?.updatedAt)}`
                          : `${scopeIcon(scope)} ${scopeLabel(scope)} ・ 更新 ${formatPreviewDate(database.updatedAt)}`}
                    </small>
                  </div>
                </header>
                {isChildPage ? (
                  <>
                    <div className="db-quick-preview-child-path-v559">
                      <span>🗃️ {database.title || "無題のデータベース"}</span>
                      <span>›</span>
                      <span>🧾 {row?.title || "無題の行"}</span>
                    </div>
                    <div className="db-quick-preview-summary-v557 db-quick-preview-child-summary-v559">
                      <small>本文の概要</small>
                      <p>
                        {childPage?.previewSnippet?.trim() ||
                          "本文はまだありません。クリックすると子ページを開けます。"}
                      </p>
                    </div>
                    {childPage?.properties?.tags?.length ? (
                      <div className="db-quick-preview-child-tags-v559">
                        {childPage.properties.tags.slice(0, 5).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    <div className="db-quick-preview-foot-v557">
                      クリックすると、この子ページをタブで開きます
                    </div>
                  </>
                ) : isRow ? (
                  <>
                    <div className="db-quick-preview-summary-v557">
                      {row?.childCount
                        ? `子ページ ${row.childCount} 件`
                        : "子ページはありません"}
                    </div>
                    <div className="db-quick-preview-foot-v557">
                      クリックすると、この行をタブで開きます
                    </div>
                  </>
                ) : (
                  <>
                    <div className="db-quick-preview-metrics-v557">
                      <span>
                        <b>{database.rows.length}</b> 行
                      </span>
                      <span>
                        <b>{database.properties.length}</b> プロパティ
                      </span>
                      <span>
                        <b>{database.views?.length || 0}</b> ビュー
                      </span>
                    </div>
                    <div className="db-quick-preview-block-v557">
                      <small>プロパティ</small>
                      <div className="db-quick-preview-chips-v557">
                        {propertyNames.length ? (
                          propertyNames.map((name) => (
                            <span key={name}>{name}</span>
                          ))
                        ) : (
                          <em>プロパティなし</em>
                        )}
                      </div>
                    </div>
                    <div className="db-quick-preview-block-v557">
                      <small>最近の行</small>
                      <ul className="db-quick-preview-rows-v557">
                        {recentRows.length ? (
                          recentRows.map((item) => (
                            <li key={item.rowId}>
                              <span>🧾</span>
                              <b>{item.title || "無題の行"}</b>
                              {item.childCount ? (
                                <small>子 {item.childCount}</small>
                              ) : null}
                            </li>
                          ))
                        ) : (
                          <li className="is-empty">まだ行はありません</li>
                        )}
                      </ul>
                    </div>
                    <div className="db-quick-preview-foot-v557">
                      クリックすると、データベースを新しいタブで開きます
                    </div>
                  </>
                )}
              </section>,
              document.body,
            );
          })()
        : null}
      {databaseMenu
        ? (() => {
            const database = databases.find(
              (item) => item.id === databaseMenu.id,
            );
            if (!database) return null;
            return (
              <div
                className="db-sidebar-context-menu-v519"
                style={{ left: databaseMenu.x, top: databaseMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="db-sidebar-context-title-v519">
                  <span>▦</span>
                  <strong title={database.title}>
                    {database.title || "無題のデータベース"}
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenDatabaseInWorkspace)
                      onOpenDatabaseInWorkspace(database.id, "tabs");
                    else onOpenDatabase(database.id);
                    setDatabaseMenu(null);
                  }}
                >
                  ↗ タブで開く
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenDatabaseInWorkspace)
                      onOpenDatabaseInWorkspace(database.id, "compare");
                    else onOpenDatabase(database.id);
                    setDatabaseMenu(null);
                  }}
                >
                  ⇄ 比較表示で開く
                </button>
                <div className="db-sidebar-context-separator-v519" />
                <button
                  type="button"
                  onClick={() => {
                    onOpenDatabase(database.id);
                    setDatabaseMenu(null);
                  }}
                >
                  ✎ 編集画面を開く
                </button>
              </div>
            );
          })()
        : null}
    </div>
  );
}
