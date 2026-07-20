import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ApiClient } from "../lib/api";
import type {
  DatabaseAggregateResult,
  DatabaseFilterOperator,
  DatabaseQueryResult,
  DatabaseRow,
  DatabaseRowsCreateResult,
  DatabaseRowsDeleteResult,
  DatabaseView,
  WorkspaceDatabase,
  DatabasePropertyType,
  PageWithLock,
  JournalSummary,
  WorkspaceScope,
  GlossaryTerm,
} from "../../../shared/types";
import { GlossaryTermHints } from "./GlossaryTermHints";
import {
  DatabaseBoard,
  DatabaseCalendar,
  DatabaseGallery,
  DatabaseGantt,
  DatabaseTimeline,
} from "./database/DatabaseViews";
import { DatabaseFormView } from "./database/DatabaseFormView";
import { DatabaseToolbar } from "./database/DatabaseToolbar";
import { DatabaseServerPagingControls } from "./database/DatabaseServerPagingControls";
import { DatabaseRowDetailDrawer } from "./database/DatabaseRowDetailDrawer";
import { DatabaseAnalysisPanel } from "./database/DatabaseAnalysisPanel";
import { DatabaseSchemaPanel } from "./database/DatabaseSchemaPanel";
import { DatabaseViewSettingsPanel } from "./database/DatabaseViewSettingsPanel";
import { DatabaseUtilityPanels } from "./database/DatabaseUtilityPanels";
import { FastDatabaseRow } from "./database/DatabaseRows";
import {
  DatabaseBulkEditModal,
  type BulkEditRequest,
} from "./database/DatabaseBulkEditModal";
import {
  analyzeDatabase,
  applyDatabaseView,
  applyAdvancedDatabaseFilter,
  coerceDatabaseCellValue,
  csvToDatabaseRows,
  databaseCellText,
  databaseToCsv,
  dbText,
  defaultDatabaseCellValue,
  downloadTextFile,
  findRowRelationBacklinks,
  formatPercent,
  getActiveView,
  getBoardGroupProperty,
  getComputedCellValue,
  getDateProperty,
  getRelationCandidates,
  getRelationTargetDatabase,
  getRelationTargetTitle,
  getTimelineEndProperty,
  getTimelineStartProperty,
  isCheckedDatabaseValue,
  isFilledDatabaseValue,
  isSameDateKey,
  monthKey,
  pageScope,
  parseLocalDate,
  propertyTypeIcon,
  propertyTypeLabel,
  readJsonLocalStorage,
  renderCellPreview,
  scopeIcon,
  toDatabaseNumber,
  viewIcon,
  viewLabel,
  workspaceScope,
  type RelationBacklink,
} from "./database/DatabaseHelpers";

type DatabaseTableProps = {
  database: WorkspaceDatabase;
  editing: boolean;
  onChange: (database: WorkspaceDatabase) => void;
  /** Targeted row persistence for ordinary cell edits. Schema and row-structure changes keep using onChange. */
  onPatchRows?: (
    databaseId: string,
    patches: Array<{ rowId: string; cells: Record<string, any> }>,
  ) => Promise<void>;
  onCreateRows?: (
    databaseId: string,
    rows: Array<{ sourceRowId?: string; cells?: Record<string, any> }>,
  ) => Promise<DatabaseRowsCreateResult | null | void>;
  onDeleteRows?: (
    databaseId: string,
    rowIds: string[],
  ) => Promise<DatabaseRowsDeleteResult | null | void>;
  allDatabases?: WorkspaceDatabase[];
  pages?: PageWithLock[];
  journals?: JournalSummary[];
  onOpenPage?: (pageId: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenJournal?: (date: string) => void;
  api?: ApiClient | null;
  initialSelectedRowId?: string | null;
  onDatabaseRowChildPageCreated?: () => void;
  glossaryTerms?: GlossaryTerm[];
  onOpenGlossary?: () => void;
};

const LARGE_DB_AUTO_THRESHOLD = 2000;
const NON_TABLE_RENDER_LIMIT = 1200;
const DB_EXACT_STATS_ROW_LIMIT = 2500;
const DB_PREVIEW_MIN_WIDTH = 360;
const DB_PREVIEW_DEFAULT_WIDTH = 520;
const DB_PREVIEW_ABSOLUTE_MAX_WIDTH = 920;
const DB_PREVIEW_MIN_TABLE_WIDTH = 380;
const DB_PREVIEW_LAYOUT_GAP = 16;
// Sticky columns are limited deliberately: every fixed column adds paint work while horizontally scrolling.
// Three leading properties cover the common title/status/deadline use case without degrading large tables.
const MAX_PINNED_DATABASE_COLUMNS = 3;

function clampDatabasePreviewWidth(width: number) {
  if (typeof window === "undefined") {
    return Math.max(
      DB_PREVIEW_MIN_WIDTH,
      Math.min(DB_PREVIEW_ABSOLUTE_MAX_WIDTH, width),
    );
  }
  const available = Math.max(
    DB_PREVIEW_MIN_WIDTH,
    window.innerWidth - DB_PREVIEW_MIN_TABLE_WIDTH - DB_PREVIEW_LAYOUT_GAP - 48,
  );
  const max = Math.max(
    DB_PREVIEW_MIN_WIDTH,
    Math.min(DB_PREVIEW_ABSOLUTE_MAX_WIDTH, available),
  );
  return Math.max(DB_PREVIEW_MIN_WIDTH, Math.min(max, width));
}

export function DatabaseTable({
  database: incomingDatabase,
  editing,
  onChange,
  onPatchRows,
  onCreateRows,
  onDeleteRows,
  allDatabases = [],
  pages = [],
  journals = [],
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  onOpenJournal,
  api = null,
  initialSelectedRowId = null,
  onDatabaseRowChildPageCreated,
  glossaryTerms = [],
  onOpenGlossary,
}: DatabaseTableProps) {
  const isReadonlyTable = !editing;
  const [database, setDatabase] = useState<WorkspaceDatabase>(incomingDatabase);
  const databaseRef = useRef<WorkspaceDatabase>(incomingDatabase);
  const commitTimerRef = useRef<number | null>(null);
  const rowPatchTimerRef = useRef<number | null>(null);
  const pendingRowPatchesRef = useRef(new Map<string, Record<string, any>>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dbSearch, setDbSearch] = useState("");
  const deferredDbSearch = useDeferredValue(dbSearch);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialSelectedRowId &&
      database.rows.some((row) => row.id === initialSelectedRowId)
    ) {
      setSelectedRowId(initialSelectedRowId);
    }
  }, [initialSelectedRowId, database.id]);
  const [editingOptionsPropId, setEditingOptionsPropId] = useState<
    string | null
  >(null);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [draggedPropId, setDraggedPropId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkUndoNotice, setBulkUndoNotice] = useState<string | null>(null);
  const [sortState, setSortState] = useState<{
    propId: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    readJsonLocalStorage(`fast-db-widths:${incomingDatabase.id}`, {}),
  );
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, boolean>>(
    () => readJsonLocalStorage(`fast-db-hidden:${incomingDatabase.id}`, {}),
  );
  // Column order is intentionally per-device, like width and visibility. Reordering a view must not
  // rewrite shared database schema or create a sync/index update for a display-only action.
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    readJsonLocalStorage(`fast-db-order:${incomingDatabase.id}`, []),
  );
  // Fixed columns are a per-device view preference. They never write shared DB data or trigger indexes.
  const [pinnedColumnCount, setPinnedColumnCount] = useState<number>(() =>
    readJsonLocalStorage(`fast-db-pinned-count:${incomingDatabase.id}`, 0),
  );
  // Sub-item expansion is a personal display preference, like column visibility.
  // It intentionally stays out of the shared DB payload to avoid one user's folding
  // state unexpectedly changing another user's table.
  const [collapsedSubItemIds, setCollapsedSubItemIds] = useState<
    Record<string, boolean>
  >(() =>
    readJsonLocalStorage(
      `fast-db-subitems-collapsed:${incomingDatabase.id}`,
      {},
    ),
  );
  // Group expansion is a personal display preference. It is intentionally local so
  // opening/collapsing a section never writes shared DB data or queues index work.
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<
    Record<string, boolean>
  >(() =>
    readJsonLocalStorage(`fast-db-groups-collapsed:${incomingDatabase.id}`, {}),
  );
  type TableFooterAggregate =
    | "none"
    | "count"
    | "filled"
    | "empty"
    | "unique"
    | "sum"
    | "average"
    | "median"
    | "min"
    | "max"
    | "range"
    | "checked"
    | "unchecked"
    | "percent_checked";
  const [footerAggregates, setFooterAggregates] = useState<
    Record<string, TableFooterAggregate>
  >(() =>
    readJsonLocalStorage(
      `fast-db-footer-aggregates:${incomingDatabase.id}`,
      {},
    ),
  );
  const [openColumnMenuPropId, setOpenColumnMenuPropId] = useState<
    string | null
  >(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState<{
    propId: string;
    left: number;
    top: number;
  } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRafRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);

  const closeColumnMenu = () => {
    setOpenColumnMenuPropId(null);
    setColumnMenuAnchor(null);
  };

  const openColumnMenu = (propId: string, target: HTMLElement) => {
    if (openColumnMenuPropId === propId) {
      closeColumnMenu();
      return;
    }
    const rect = target.getBoundingClientRect();
    const menuWidth = 224;
    const estimatedMenuHeight = 286;
    const viewportPadding = 10;
    const left = Math.max(
      viewportPadding,
      Math.min(
        rect.right - menuWidth,
        window.innerWidth - menuWidth - viewportPadding,
      ),
    );
    const below = rect.bottom + 8;
    const top =
      below + estimatedMenuHeight <= window.innerHeight - viewportPadding
        ? below
        : Math.max(viewportPadding, rect.top - estimatedMenuHeight - 8);
    setColumnMenuAnchor({ propId, left, top });
    setOpenColumnMenuPropId(propId);
  };

  // The table viewport follows the visible window instead of keeping a fixed 560px
  // height. This prevents a large blank card area on smaller screens while keeping
  // enough room for virtualized rows on large screens.
  const [viewportHeight, setViewportHeight] = useState(560);
  const [commitState, setCommitState] = useState<
    "idle" | "dirty" | "saving" | "saved"
  >("idle");
  const [undoStack, setUndoStack] = useState<WorkspaceDatabase[]>([]);
  const [redoStack, setRedoStack] = useState<WorkspaceDatabase[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [largeDbMode, setLargeDbMode] = useState<boolean>(() =>
    readJsonLocalStorage(
      `fast-db-large-mode:${incomingDatabase.id}`,
      incomingDatabase.rows.length >= LARGE_DB_AUTO_THRESHOLD,
    ),
  );
  const [serverPerf, setServerPerf] = useState<any | null>(null);
  const [serverPerfLoading, setServerPerfLoading] = useState(false);
  const [serverRows, setServerRows] = useState<DatabaseQueryResult | null>(
    null,
  );
  const [serverRowsLoading, setServerRowsLoading] = useState(false);
  const [serverAggregates, setServerAggregates] =
    useState<DatabaseAggregateResult | null>(null);
  const [serverAggregatesLoading, setServerAggregatesLoading] = useState(false);
  const [serverRowsPage, setServerRowsPage] = useState(1);
  const [serverRowsPageSize, setServerRowsPageSize] = useState<number>(() =>
    readJsonLocalStorage(
      `fast-db-server-page-size:${incomingDatabase.id}`,
      120,
    ),
  );
  const [serverTableEnabled, setServerTableEnabled] = useState<boolean>(() =>
    readJsonLocalStorage(
      `fast-db-server-table:${incomingDatabase.id}`,
      incomingDatabase.rows.length >= LARGE_DB_AUTO_THRESHOLD,
    ),
  );
  const [previewWidth, setPreviewWidth] = useState<number>(() =>
    clampDatabasePreviewWidth(
      readJsonLocalStorage(
        `fast-db-preview-width:${incomingDatabase.id}`,
        DB_PREVIEW_DEFAULT_WIDTH,
      ),
    ),
  );
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!openColumnMenuPropId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".fast-column-menu, .fast-column-menu-trigger, .fast-footer-cell",
        )
      )
        return;
      closeColumnMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeColumnMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openColumnMenuPropId]);

  useEffect(() => {
    setDatabase(incomingDatabase);
    databaseRef.current = incomingDatabase;
    setSelectedIds({});
    setSelectedRowId(null);
    setSortState(null);
    setScrollTop(0);
    setColumnWidths(
      readJsonLocalStorage(`fast-db-widths:${incomingDatabase.id}`, {}),
    );
    setHiddenColumns(
      readJsonLocalStorage(`fast-db-hidden:${incomingDatabase.id}`, {}),
    );
    setColumnOrder(
      readJsonLocalStorage(`fast-db-order:${incomingDatabase.id}`, []),
    );
    setPinnedColumnCount(
      readJsonLocalStorage(`fast-db-pinned-count:${incomingDatabase.id}`, 0),
    );
    setCollapsedSubItemIds(
      readJsonLocalStorage(
        `fast-db-subitems-collapsed:${incomingDatabase.id}`,
        {},
      ),
    );
    setCollapsedGroupKeys(
      readJsonLocalStorage(
        `fast-db-groups-collapsed:${incomingDatabase.id}`,
        {},
      ),
    );
    setFooterAggregates(
      readJsonLocalStorage(
        `fast-db-footer-aggregates:${incomingDatabase.id}`,
        {},
      ),
    );
    setOpenColumnMenuPropId(null);
    setLargeDbMode(
      readJsonLocalStorage(
        `fast-db-large-mode:${incomingDatabase.id}`,
        incomingDatabase.rows.length >= LARGE_DB_AUTO_THRESHOLD,
      ),
    );
    setServerTableEnabled(
      readJsonLocalStorage(
        `fast-db-server-table:${incomingDatabase.id}`,
        incomingDatabase.rows.length >= LARGE_DB_AUTO_THRESHOLD,
      ),
    );
    setServerRowsPageSize(
      readJsonLocalStorage(
        `fast-db-server-page-size:${incomingDatabase.id}`,
        120,
      ),
    );
    setPreviewWidth(
      clampDatabasePreviewWidth(
        readJsonLocalStorage(
          `fast-db-preview-width:${incomingDatabase.id}`,
          DB_PREVIEW_DEFAULT_WIDTH,
        ),
      ),
    );
    setServerRowsPage(1);
    setServerRows(null);
    setServerAggregates(null);
    setServerAggregatesLoading(false);
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    if (rowPatchTimerRef.current) window.clearTimeout(rowPatchTimerRef.current);
    commitTimerRef.current = null;
    rowPatchTimerRef.current = null;
    pendingRowPatchesRef.current.clear();
    setCommitState("idle");
    setUndoStack([]);
    setRedoStack([]);
  }, [incomingDatabase.id]);

  // Same-id updates arrive after a save, a shared-folder refresh, or a server-side
  // normalization (Unique ID / relation repairs). Apply an external revision without
  // resetting selection, layout, history, or scroll position.
  useEffect(() => {
    if (incomingDatabase.id !== databaseRef.current.id) return;
    if (incomingDatabase.updatedAt === databaseRef.current.updatedAt) return;
    if (commitTimerRef.current !== null) return;
    databaseRef.current = incomingDatabase;
    setDatabase(incomingDatabase);
  }, [incomingDatabase.id, incomingDatabase.updatedAt]);

  useEffect(() => {
    const handleResize = () => {
      setPreviewWidth((width) => {
        const next = clampDatabasePreviewWidth(width);
        if (next !== width) {
          window.localStorage.setItem(
            `fast-db-preview-width:${databaseRef.current.id}`,
            JSON.stringify(next),
          );
        }
        return next;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(
    () => () => {
      // Flush only an edit that is still waiting for the debounce timer.
      // Re-saving every changed local snapshot during unmount can race with the
      // server-confirmed save that just completed and create a false conflict.
      if (rowPatchTimerRef.current) {
        window.clearTimeout(rowPatchTimerRef.current);
        rowPatchTimerRef.current = null;
        const pending = [...pendingRowPatchesRef.current.entries()].map(
          ([rowId, cells]) => ({ rowId, cells }),
        );
        pendingRowPatchesRef.current.clear();
        if (pending.length && onPatchRows)
          void onPatchRows(databaseRef.current.id, pending);
      }
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        onChange(databaseRef.current);
      }
      // onChange is intentionally captured for this editor instance.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-widths:${database.id}`,
      JSON.stringify(columnWidths),
    );
  }, [database.id, columnWidths]);

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-hidden:${database.id}`,
      JSON.stringify(hiddenColumns),
    );
  }, [database.id, hiddenColumns]);

  useEffect(() => {
    // Drop ids for properties that no longer exist so localStorage never accumulates stale schema data.
    const allowed = new Set(database.properties.map((prop) => prop.id));
    const normalized = [
      ...new Set(columnOrder.filter((id) => allowed.has(id))),
    ];
    window.localStorage.setItem(
      `fast-db-order:${database.id}`,
      JSON.stringify(normalized),
    );
  }, [database.id, database.properties, columnOrder]);

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-footer-aggregates:${database.id}`,
      JSON.stringify(footerAggregates),
    );
  }, [database.id, footerAggregates]);

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-large-mode:${database.id}`,
      JSON.stringify(largeDbMode),
    );
  }, [database.id, largeDbMode]);

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-server-table:${database.id}`,
      JSON.stringify(serverTableEnabled),
    );
  }, [database.id, serverTableEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      `fast-db-server-page-size:${database.id}`,
      JSON.stringify(serverRowsPageSize),
    );
  }, [database.id, serverRowsPageSize]);

  useEffect(() => {
    let cancelled = false;
    if (!api) return;
    if (database.rows.length < 1000 && !largeDbMode) return;
    setServerPerfLoading(true);
    api
      .getDatabasePerformance(database.id)
      .then((info) => {
        if (!cancelled) setServerPerf(info);
      })
      .catch(() => {
        if (!cancelled) setServerPerf(null);
      })
      .finally(() => {
        if (!cancelled) setServerPerfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, database.id, database.rows.length, database.updatedAt, largeDbMode]);

  async function rebuildServerIndex() {
    if (!api) return;
    setServerPerfLoading(true);
    try {
      const info = await api.rebuildDatabaseIndex(database.id);
      setServerPerf(info);
      window.alert(
        `SQLiteインデックスを再構築しました。\n行数: ${info.indexedRowCount}/${info.rowCount}`,
      );
    } catch (error: any) {
      window.alert(
        `インデックス再構築に失敗しました: ${error?.message ?? error}`,
      );
    } finally {
      setServerPerfLoading(false);
    }
  }

  function nextId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function scheduleCommit(next: WorkspaceDatabase, immediate = false) {
    databaseRef.current = next;
    setDatabase(next);
    if (!editing) return;
    setCommitState("dirty");
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    const run = () => {
      setCommitState("saving");
      onChange(databaseRef.current);
      window.setTimeout(() => setCommitState("saved"), 120);
    };
    if (immediate) {
      run();
    } else {
      commitTimerRef.current = window.setTimeout(run, 900);
    }
  }

  function scheduleRowPatchCommit(
    patches: Map<string, Record<string, any>>,
    immediate = false,
  ) {
    if (!onPatchRows) return false;
    for (const [rowId, cells] of patches) {
      pendingRowPatchesRef.current.set(rowId, {
        ...(pendingRowPatchesRef.current.get(rowId) || {}),
        ...cells,
      });
    }
    if (rowPatchTimerRef.current) window.clearTimeout(rowPatchTimerRef.current);
    const run = () => {
      rowPatchTimerRef.current = null;
      const pending = [...pendingRowPatchesRef.current.entries()].map(
        ([rowId, cells]) => ({ rowId, cells }),
      );
      pendingRowPatchesRef.current.clear();
      if (!pending.length) return;
      setCommitState("saving");
      void onPatchRows(databaseRef.current.id, pending)
        .then(() => setCommitState("saved"))
        .catch(() => {
          // Keep the local edit visible. The parent queue reports the failure and
          // retains a retryable snapshot instead of silently issuing a full DB save.
          setCommitState("dirty");
        });
    };
    if (immediate) run();
    else rowPatchTimerRef.current = window.setTimeout(run, 500);
    return true;
  }

  function applyRowCellPatches(
    patches: Map<string, Record<string, any>>,
    immediate = false,
    recordHistory = true,
  ) {
    const previous = databaseRef.current;
    const now = new Date().toISOString();
    const next: WorkspaceDatabase = {
      ...previous,
      updatedAt: now,
      rows: previous.rows.map((row) => {
        const cells = patches.get(row.id);
        return cells
          ? { ...row, cells: { ...row.cells, ...cells }, updatedAt: now }
          : row;
      }),
    };
    if (recordHistory) {
      setUndoStack((stack) => [...stack.slice(-49), previous]);
      setRedoStack([]);
    }
    databaseRef.current = next;
    setDatabase(next);
    if (!editing) return;
    setCommitState("dirty");
    if (!scheduleRowPatchCommit(patches, immediate))
      scheduleCommit(next, immediate);
  }

  function mutate(
    mutator: (db: WorkspaceDatabase) => WorkspaceDatabase,
    immediate = false,
    recordHistory = true,
  ) {
    const previous = databaseRef.current;
    const next = mutator(previous);
    if (recordHistory && next !== previous) {
      setUndoStack((stack) => [...stack.slice(-49), previous]);
      setRedoStack([]);
    }
    scheduleCommit(next, immediate);
  }

  function applyRemoteRowsCreated(rows: DatabaseRow[], updatedAt?: string, updatedBy?: string) {
    if (!rows.length) return;
    const previous = databaseRef.current;
    const rowIds = new Set(rows.map((row) => row.id));
    const next: WorkspaceDatabase = {
      ...previous,
      updatedAt: updatedAt ?? new Date().toISOString(),
      updatedBy: updatedBy ?? previous.updatedBy,
      rows: [...rows, ...previous.rows.filter((row) => !rowIds.has(row.id))],
    };
    setUndoStack((stack) => [...stack.slice(-49), previous]);
    setRedoStack([]);
    databaseRef.current = next;
    setDatabase(next);
    setCommitState("saved");
  }

  function applyRemoteRowsDeleted(
    rowIds: string[],
    trashedRows: Array<DatabaseRow & { deletedAt: string }> = [],
    updatedAt?: string,
    updatedBy?: string,
  ) {
    if (!rowIds.length) return;
    const previous = databaseRef.current;
    const idSet = new Set(rowIds);
    const next: WorkspaceDatabase = {
      ...previous,
      updatedAt: updatedAt ?? new Date().toISOString(),
      updatedBy: updatedBy ?? previous.updatedBy,
      rows: previous.rows.filter((row) => !idSet.has(row.id)),
      trash: {
        ...previous.trash,
        rows: [...(previous.trash?.rows ?? []), ...trashedRows],
      },
    };
    setUndoStack((stack) => [...stack.slice(-49), previous]);
    setRedoStack([]);
    databaseRef.current = next;
    setDatabase(next);
    setCommitState("saved");
  }

  async function createRowsLightweight(
    rows: Array<{ sourceRowId?: string; cells?: Record<string, any> }>,
    selectFirst = true,
  ): Promise<boolean> {
    if (!editing || !onCreateRows) return false;
    setCommitState("saving");
    try {
      const result = await onCreateRows(databaseRef.current.id, rows);
      if (result && typeof result === "object" && result.rows?.length) {
        applyRemoteRowsCreated(result.rows, result.updatedAt, result.updatedBy);
        if (selectFirst) setSelectedRowId(result.rows[0].id);
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      }
      return true;
    } catch {
      setCommitState("dirty");
      return false;
    }
  }

  async function deleteRowsLightweight(rowIds: string[]): Promise<boolean> {
    if (!editing || !onDeleteRows || !rowIds.length) return false;
    setCommitState("saving");
    try {
      const result = await onDeleteRows(databaseRef.current.id, rowIds);
      if (result && typeof result === "object" && result.deletedRowIds?.length) {
        applyRemoteRowsDeleted(
          result.deletedRowIds,
          result.trashedRows,
          result.updatedAt,
          result.updatedBy,
        );
        const deletedIds = new Set(result.deletedRowIds);
        setSelectedRowId((current) => (current && deletedIds.has(current) ? null : current));
        setSelectedIds((ids) => {
          const next = { ...ids };
          for (const rowId of deletedIds) delete next[rowId];
          return next;
        });
      }
      return true;
    } catch {
      setCommitState("dirty");
      return false;
    }
  }

  function undoDatabaseChange() {
    setUndoStack((stack) => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setRedoStack((redo) => [...redo.slice(-49), databaseRef.current]);
      scheduleCommit(previous, true);
      return stack.slice(0, -1);
    });
  }

  function redoDatabaseChange() {
    setRedoStack((stack) => {
      const next = stack.at(-1);
      if (!next) return stack;
      setUndoStack((undo) => [...undo.slice(-49), databaseRef.current]);
      scheduleCommit(next, true);
      return stack.slice(0, -1);
    });
  }

  useEffect(() => {
    localStorage.setItem(
      `fast-db-subitems-collapsed:${database.id}`,
      JSON.stringify(collapsedSubItemIds),
    );
  }, [database.id, collapsedSubItemIds]);

  useEffect(() => {
    localStorage.setItem(
      `fast-db-groups-collapsed:${database.id}`,
      JSON.stringify(collapsedGroupKeys),
    );
  }, [database.id, collapsedGroupKeys]);

  const activeView = getActiveView(database);
  const orderedProperties = useMemo(() => {
    const rank = new Map<string, number>(
      columnOrder.map((id, index): [string, number] => [id, index]),
    );
    return [...database.properties].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return 1;
      if (bRank == null) return -1;
      return aRank - bRank;
    });
  }, [database.properties, columnOrder]);
  const visibleProperties = useMemo(
    () => orderedProperties.filter((prop) => !hiddenColumns[prop.id]),
    [orderedProperties, hiddenColumns],
  );
  const normalizedSearch = deferredDbSearch.trim().toLowerCase();
  const relationUniverse = useMemo(
    () => [database, ...allDatabases.filter((db) => db.id !== database.id)],
    [database, allDatabases],
  );
  const baseRows = useMemo(
    () => applyDatabaseView(database, relationUniverse),
    [
      database.id,
      database.rows,
      database.properties,
      database.views,
      database.activeViewId,
      relationUniverse,
    ],
  );
  const performanceMode =
    largeDbMode || database.rows.length >= LARGE_DB_AUTO_THRESHOLD;
  const subItemRelation = database.properties.find(
    (prop) => prop.type === "relation" && prop.isSubItemRelation,
  );
  const effectivePinnedColumnCount = Math.max(
    0,
    Math.min(
      MAX_PINNED_DATABASE_COLUMNS,
      visibleProperties.length,
      Number(pinnedColumnCount) || 0,
    ),
  );
  const pinnedPropertyLeftById = useMemo(() => {
    // The checkbox, row number and optional hierarchy cell are always pinned first.
    let left = 42 + 54 + (subItemRelation ? 86 : 0);
    const offsets: Record<string, number> = {};
    for (const prop of visibleProperties.slice(0, effectivePinnedColumnCount)) {
      offsets[prop.id] = left;
      left += columnWidths[prop.id] ?? (prop.type === "url" ? 240 : 190);
    }
    return offsets;
  }, [
    visibleProperties,
    effectivePinnedColumnCount,
    columnWidths,
    subItemRelation,
  ]);

  useEffect(() => {
    // Do not persist an invalid count when columns are hidden/deleted. This keeps restore deterministic.
    const normalized = Math.max(
      0,
      Math.min(
        MAX_PINNED_DATABASE_COLUMNS,
        visibleProperties.length,
        Number(pinnedColumnCount) || 0,
      ),
    );
    window.localStorage.setItem(
      `fast-db-pinned-count:${database.id}`,
      JSON.stringify(normalized),
    );
  }, [database.id, visibleProperties.length, pinnedColumnCount]);
  // Hierarchical ordering must see the complete filtered row set; do not page it on the server.
  const serverTableMode = Boolean(
    api &&
    performanceMode &&
    activeView.type === "table" &&
    serverTableEnabled &&
    !subItemRelation,
  );
  const clientVisibleRows = useMemo(() => {
    // v333: when server table mode is active, avoid expensive client-side full-row filter/sort.
    // The visible rows will be supplied by api.queryDatabaseRows().
    if (serverTableMode) return [];
    let rows = normalizedSearch
      ? baseRows.filter((row) =>
          database.properties.some((prop) =>
            databaseCellText(database, row, prop, relationUniverse)
              .toLowerCase()
              .includes(normalizedSearch),
          ),
        )
      : baseRows;
    if (sortState) {
      const prop = database.properties.find((p) => p.id === sortState.propId);
      if (prop) {
        const factor = sortState.direction === "asc" ? 1 : -1;
        rows = [...rows].sort((a, b) => {
          const av = getComputedCellValue(prop, a, database, relationUniverse);
          const bv = getComputedCellValue(prop, b, database, relationUniverse);
          if (prop.type === "number")
            return (Number(av || 0) - Number(bv || 0)) * factor;
          if (prop.type === "checkbox")
            return (Number(Boolean(av)) - Number(Boolean(bv))) * factor;
          return dbText(av).localeCompare(dbText(bv), "ja") * factor;
        });
      }
    }
    return rows;
  }, [
    serverTableMode,
    baseRows,
    normalizedSearch,
    database,
    database.properties,
    sortState,
    relationUniverse,
  ]);

  useEffect(() => {
    setServerRowsPage(1);
  }, [
    database.id,
    activeView.id,
    normalizedSearch,
    serverRowsPageSize,
    serverTableEnabled,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!api || !serverTableMode) {
      setServerRows(null);
      setServerRowsLoading(false);
      return;
    }
    setServerRowsLoading(true);
    api
      .queryDatabaseRows(database.id, {
        viewId: activeView.id,
        q: normalizedSearch,
        page: serverRowsPage,
        pageSize: serverRowsPageSize,
      })
      .then((result) => {
        if (!cancelled) setServerRows(result);
      })
      .catch(() => {
        if (!cancelled) setServerRows(null);
      })
      .finally(() => {
        if (!cancelled) setServerRowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    serverTableMode,
    database.id,
    database.updatedAt,
    activeView.id,
    normalizedSearch,
    serverRowsPage,
    serverRowsPageSize,
  ]);

  const activeFooterAggregateRequest = useMemo(
    () =>
      Object.fromEntries(
        visibleProperties
          .map(
            (prop) => [prop.id, footerAggregates[prop.id] ?? "none"] as const,
          )
          .filter(([, mode]) => mode !== "none"),
      ) as Record<string, TableFooterAggregate>,
    [visibleProperties, footerAggregates],
  );

  useEffect(() => {
    let cancelled = false;
    const aggregateEntries = Object.entries(activeFooterAggregateRequest);
    if (!api || !serverTableMode || aggregateEntries.length === 0) {
      setServerAggregates(null);
      setServerAggregatesLoading(false);
      return;
    }
    setServerAggregates(null);
    setServerAggregatesLoading(true);
    // Aggregate requests can require a full filtered scan on the server. Debounce
    // column-menu changes and text search so typing never queues one request per key.
    const timer = window.setTimeout(() => {
      api
        .aggregateDatabaseRows(database.id, {
          viewId: activeView.id,
          q: normalizedSearch,
          aggregates: activeFooterAggregateRequest,
        })
        .then((result) => {
          if (!cancelled) setServerAggregates(result);
        })
        .catch(() => {
          if (!cancelled) setServerAggregates(null);
        })
        .finally(() => {
          if (!cancelled) setServerAggregatesLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    api,
    serverTableMode,
    database.id,
    database.updatedAt,
    activeView.id,
    normalizedSearch,
    activeFooterAggregateRequest,
  ]);

  const baseVisibleRows =
    serverTableMode && serverRows ? serverRows.rows : clientVisibleRows;
  const subItemLayout = useMemo(() => {
    if (!subItemRelation || serverTableMode)
      return {
        rows: baseVisibleRows,
        depthById: {} as Record<string, number>,
        childCountById: {} as Record<string, number>,
        childProgressById: {} as Record<
          string,
          { done: number; total: number }
        >,
      };
    const visibleIds = new Set(baseVisibleRows.map((row) => row.id));
    const byParent = new Map<string, typeof baseVisibleRows>();
    const parentById: Record<string, string | undefined> = {};
    const roots: typeof baseVisibleRows = [];
    const statusProperty = database.properties.find(
      (prop) => prop.type === "status",
    );
    for (const row of baseVisibleRows) {
      const rawParentValue = row.cells?.[subItemRelation.id];
      const selected: string[] = Array.isArray(rawParentValue)
        ? rawParentValue.map((value: string) => String(value))
        : [];
      const parentId = selected.find(
        (id: string) => id !== row.id && visibleIds.has(id),
      );
      parentById[row.id] = parentId;
      if (!parentId) roots.push(row);
      else {
        const children = byParent.get(parentId) ?? [];
        children.push(row);
        byParent.set(parentId, children);
      }
    }
    const ordered: typeof baseVisibleRows = [];
    const depthById: Record<string, number> = {};
    const childCountById: Record<string, number> = {};
    const childProgressById: Record<string, { done: number; total: number }> =
      {};
    for (const [parentId, children] of byParent.entries()) {
      childCountById[parentId] = children.length;
      const done = statusProperty
        ? children.filter(
            (child) =>
              String(child.cells[statusProperty.id] ?? "").trim() === "完了",
          ).length
        : 0;
      childProgressById[parentId] = { done, total: children.length };
    }
    const emitted = new Set<string>();
    const visiting = new Set<string>();
    // A row is emitted at most once. This is essential when an older DB contains
    // a cycle or when a parent is changed/cleared while the table is re-rendering.
    const emit = (row: (typeof baseVisibleRows)[number], depth: number) => {
      if (emitted.has(row.id)) return;
      if (visiting.has(row.id)) return;
      visiting.add(row.id);
      emitted.add(row.id);
      depthById[row.id] = depth;
      ordered.push(row);
      // Collapsing is presentation-only: it never changes a relation cell or row order.
      if (!collapsedSubItemIds[row.id]) {
        for (const child of byParent.get(row.id) ?? [])
          emit(child, Math.min(depth + 1, 8));
      }
      visiting.delete(row.id);
    };
    roots.forEach((row) => emit(row, 0));
    const isHiddenByCollapsedAncestor = (rowId: string) => {
      const seen = new Set<string>();
      let cursor = parentById[rowId];
      while (cursor && !seen.has(cursor)) {
        if (collapsedSubItemIds[cursor]) return true;
        seen.add(cursor);
        cursor = parentById[cursor];
      }
      return false;
    };
    // Broken cycles or hidden ancestors remain visible as top-level rows, but
    // descendants of a collapsed visible parent must stay hidden. Without this
    // guard, the fallback below re-emits collapsed children as root rows after
    // the parent icon changes, which makes collapse look broken.
    baseVisibleRows.forEach((row) => {
      if (!emitted.has(row.id) && !isHiddenByCollapsedAncestor(row.id))
        emit(row, 0);
    });
    return { rows: ordered, depthById, childCountById, childProgressById };
  }, [
    baseVisibleRows,
    subItemRelation?.id,
    serverTableMode,
    collapsedSubItemIds,
    database.properties,
  ]);
  const visibleRows = subItemLayout.rows;
  const rowDepthById = subItemLayout.depthById;
  const subItemChildCountById = subItemLayout.childCountById;
  const subItemChildProgressById = subItemLayout.childProgressById;
  // Table groups deliberately stay client-side. Server paging has no group-aware
  // query yet; grouping only a page would create misleading counts/sections.
  const tableGroupProperty =
    activeView.type === "table" &&
    !serverTableMode &&
    !subItemRelation &&
    activeView.groupByPropertyId
      ? database.properties.find(
          (prop) => prop.id === activeView.groupByPropertyId,
        )
      : undefined;
  type TableRenderEntry =
    | {
        kind: "group";
        key: string;
        label: string;
        total: number;
        collapsed: boolean;
      }
    | { kind: "row"; row: WorkspaceDatabase["rows"][number]; rowIndex: number };
  const tableRenderEntries = useMemo<TableRenderEntry[]>(() => {
    if (!tableGroupProperty)
      return visibleRows.map((row, rowIndex) => ({
        kind: "row",
        row,
        rowIndex,
      }));
    const groups = new Map<
      string,
      { label: string; rows: WorkspaceDatabase["rows"] }
    >();
    for (const row of visibleRows) {
      const raw = getComputedCellValue(
        tableGroupProperty,
        row,
        database,
        relationUniverse,
      );
      const text = databaseCellText(
        database,
        row,
        tableGroupProperty,
        relationUniverse,
      ).trim();
      const label = text || "未設定";
      const key = `${tableGroupProperty.id}:${Array.isArray(raw) ? raw.map(String).sort().join("|") : String(raw ?? "")}`;
      const group = groups.get(key) ?? { label, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    const entries: TableRenderEntry[] = [];
    let rowIndex = 0;
    for (const [key, group] of groups) {
      const collapsed = Boolean(collapsedGroupKeys[key]);
      entries.push({
        kind: "group",
        key,
        label: group.label,
        total: group.rows.length,
        collapsed,
      });
      if (!collapsed) {
        for (const row of group.rows)
          entries.push({ kind: "row", row, rowIndex: rowIndex++ });
      } else {
        rowIndex += group.rows.length;
      }
    }
    return entries;
  }, [
    tableGroupProperty?.id,
    visibleRows,
    collapsedGroupKeys,
    database,
    relationUniverse,
  ]);
  const tableRenderIndexByRowId = useMemo(() => {
    const indexes: Record<string, number> = {};
    tableRenderEntries.forEach((entry, index) => {
      if (entry.kind === "row") indexes[entry.row.id] = index;
    });
    return indexes;
  }, [tableRenderEntries]);
  const visibleTotalRows =
    serverTableMode && serverRows ? serverRows.total : clientVisibleRows.length;
  const serverTableOffset =
    serverTableMode && serverRows
      ? (serverRows.page - 1) * serverRows.pageSize
      : 0;
  const tableAggregateRows = visibleRows;
  const getFooterOptions = (
    prop: WorkspaceDatabase["properties"][number],
  ): Array<{ value: TableFooterAggregate; label: string }> => {
    const generic: Array<{ value: TableFooterAggregate; label: string }> = [
      { value: "none", label: "集計なし" },
      { value: "count", label: "件数" },
      { value: "filled", label: "空でない数" },
      { value: "empty", label: "空欄数" },
      { value: "unique", label: "重複なし数" },
    ];
    if (
      prop.type === "number" ||
      prop.type === "formula" ||
      prop.type === "rollup"
    )
      return [
        ...generic,
        { value: "sum", label: "合計" },
        { value: "average", label: "平均" },
        { value: "median", label: "中央値" },
        { value: "min", label: "最小" },
        { value: "max", label: "最大" },
        { value: "range", label: "範囲" },
      ];
    if (prop.type === "checkbox")
      return [
        ...generic,
        { value: "checked", label: "チェック済み" },
        { value: "unchecked", label: "未チェック" },
        { value: "percent_checked", label: "完了率" },
      ];
    return generic;
  };
  const formatAggregate = (value: number) =>
    Number.isInteger(value)
      ? value.toLocaleString("ja-JP")
      : value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const getFooterAggregateText = (
    prop: WorkspaceDatabase["properties"][number],
  ) => {
    const mode = footerAggregates[prop.id] ?? "none";
    if (mode === "none") return "";
    const serverValue = serverTableMode
      ? serverAggregates?.values[prop.id]
      : undefined;
    if (serverValue !== undefined) return serverValue;
    const values = tableAggregateRows.map((row) =>
      getComputedCellValue(prop, row, database, relationUniverse),
    );
    const filled = values.filter((value) => isFilledDatabaseValue(value));
    if (mode === "count") return `${values.length.toLocaleString("ja-JP")}件`;
    if (mode === "filled") return `${filled.length.toLocaleString("ja-JP")}件`;
    if (mode === "empty")
      return `${Math.max(0, values.length - filled.length).toLocaleString("ja-JP")}件`;
    if (mode === "unique")
      return `${new Set(filled.map((value) => dbText(value))).size.toLocaleString("ja-JP")}件`;
    if (mode === "checked")
      return `${values.filter((value) => isCheckedDatabaseValue(value)).length.toLocaleString("ja-JP")}件`;
    if (mode === "unchecked")
      return `${values.filter((value) => !isCheckedDatabaseValue(value)).length.toLocaleString("ja-JP")}件`;
    if (mode === "percent_checked")
      return values.length
        ? `${Math.round((values.filter((value) => isCheckedDatabaseValue(value)).length / values.length) * 100)}%`
        : "0%";
    const numbers = filled
      .map((value) => toDatabaseNumber(value))
      .filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );
    if (!numbers.length) return "—";
    const sorted = [...numbers].sort((a, b) => a - b);
    if (mode === "sum")
      return formatAggregate(
        numbers.reduce((total, value) => total + value, 0),
      );
    if (mode === "average")
      return formatAggregate(
        numbers.reduce((total, value) => total + value, 0) / numbers.length,
      );
    if (mode === "median") {
      const middle = Math.floor(sorted.length / 2);
      return formatAggregate(
        sorted.length % 2
          ? sorted[middle]
          : (sorted[middle - 1] + sorted[middle]) / 2,
      );
    }
    if (mode === "min") return formatAggregate(sorted[0]);
    if (mode === "max") return formatAggregate(sorted[sorted.length - 1]);
    if (mode === "range")
      return formatAggregate(sorted[sorted.length - 1] - sorted[0]);
    return "";
  };

  const rowHeight = density === "compact" ? 42 : 52;
  // Grid navigation is deliberately delegated at the table level. Rendering thousands of
  // cells must not create a key/paste listener for every cell.
  const gridEditableProperties = useMemo(
    () =>
      visibleProperties.filter(
        (prop) =>
          ![
            "rollup",
            "formula",
            "unique_id",
            "button",
            "created_time",
            "last_edited_time",
            "relation",
            "multi_select",
          ].includes(prop.type),
      ),
    [visibleProperties],
  );

  function focusGridCell(rowId: string, propId: string) {
    const targetIndex = visibleRows.findIndex((row) => row.id === rowId);
    if (targetIndex >= 0 && !serverTableMode) {
      const renderIndex = tableRenderIndexByRowId[rowId] ?? targetIndex;
      scrollRef.current?.scrollTo({
        top: Math.max(0, renderIndex * rowHeight - rowHeight * 2),
      });
    }
    requestAnimationFrame(() => {
      const cells =
        scrollRef.current?.querySelectorAll<HTMLElement>(
          "[data-db-row-id][data-db-prop-id]",
        ) ?? [];
      for (const cell of cells) {
        if (
          cell.dataset.dbRowId === rowId &&
          cell.dataset.dbPropId === propId
        ) {
          cell.focus();
          if (cell instanceof HTMLInputElement && cell.type !== "checkbox")
            cell.select();
          break;
        }
      }
    });
  }

  function moveGridFocus(
    rowId: string,
    propId: string,
    rowDelta: number,
    propDelta: number,
  ) {
    const rowIndex = visibleRows.findIndex((row) => row.id === rowId);
    const propIndex = gridEditableProperties.findIndex(
      (prop) => prop.id === propId,
    );
    if (rowIndex < 0 || propIndex < 0) return;
    let nextRow = rowIndex + rowDelta;
    let nextProp = propIndex + propDelta;
    if (propDelta !== 0) {
      while (nextProp < 0 && nextRow > 0) {
        nextProp += gridEditableProperties.length;
        nextRow -= 1;
      }
      while (
        nextProp >= gridEditableProperties.length &&
        nextRow < visibleRows.length - 1
      ) {
        nextProp -= gridEditableProperties.length;
        nextRow += 1;
      }
    }
    if (
      nextRow < 0 ||
      nextRow >= visibleRows.length ||
      nextProp < 0 ||
      nextProp >= gridEditableProperties.length
    )
      return;
    focusGridCell(visibleRows[nextRow].id, gridEditableProperties[nextProp].id);
  }

  function getGridCellFromEventTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest(
      "[data-db-row-id][data-db-prop-id]",
    ) as HTMLElement | null;
    const rowId = cell?.dataset.dbRowId;
    const propId = cell?.dataset.dbPropId;
    if (!rowId || !propId) return null;
    if (!gridEditableProperties.some((prop) => prop.id === propId)) return null;
    return { rowId, propId };
  }

  function onGridKeyDownCapture(event: React.KeyboardEvent<HTMLTableElement>) {
    if (
      !editing ||
      event.nativeEvent.isComposing ||
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const current = getGridCellFromEventTarget(event.target);
    if (!current) return;
    if (event.key === "Enter") {
      event.preventDefault();
      moveGridFocus(current.rowId, current.propId, 1, 0);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveGridFocus(current.rowId, current.propId, 0, event.shiftKey ? -1 : 1);
    }
  }

  function parseGridPaste(text: string): string[][] {
    return text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(
        (row, index, all) =>
          index < all.length - 1 || row.some((value) => value.length > 0),
      );
  }

  function pastedGridValue(raw: string, type: DatabasePropertyType) {
    if (type === "checkbox")
      return /^(true|1|yes|y|on|checked|完了|済|済み)$/i.test(raw.trim());
    if (type === "number") {
      const normalized = raw.trim().replace(/,/g, "");
      if (!normalized) return "";
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    }
    return coerceDatabaseCellValue(raw, type);
  }

  function onGridPasteCapture(event: React.ClipboardEvent<HTMLTableElement>) {
    if (!editing || event.defaultPrevented) return;
    const current = getGridCellFromEventTarget(event.target);
    if (!current) return;
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(text)) return;
    const matrix = parseGridPaste(text);
    if (
      !matrix.length ||
      (!matrix.some((row) => row.length > 1) && matrix.length < 2)
    )
      return;
    const startRow = visibleRows.findIndex((row) => row.id === current.rowId);
    const startProp = gridEditableProperties.findIndex(
      (prop) => prop.id === current.propId,
    );
    if (startRow < 0 || startProp < 0) return;
    const maxCells = 2000;
    let attempted = 0;
    const updates = new Map<string, Record<string, unknown>>();
    let lastTarget: { rowId: string; propId: string } | null = null;
    for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
      const targetRow = visibleRows[startRow + rowOffset];
      if (!targetRow) break;
      for (
        let columnOffset = 0;
        columnOffset < matrix[rowOffset].length;
        columnOffset += 1
      ) {
        const prop = gridEditableProperties[startProp + columnOffset];
        if (!prop || attempted >= maxCells) break;
        attempted += 1;
        const nextValue = pastedGridValue(
          matrix[rowOffset][columnOffset],
          prop.type,
        );
        if (
          nextValue === null &&
          prop.type === "number" &&
          matrix[rowOffset][columnOffset].trim()
        )
          continue;
        const previousValue = targetRow.cells[prop.id];
        if (JSON.stringify(previousValue) === JSON.stringify(nextValue))
          continue;
        const rowUpdates = updates.get(targetRow.id) ?? {};
        rowUpdates[prop.id] = nextValue;
        updates.set(targetRow.id, rowUpdates);
        lastTarget = { rowId: targetRow.id, propId: prop.id };
      }
      if (attempted >= maxCells) break;
    }
    if (!updates.size) return;
    event.preventDefault();
    applyRowCellPatches(updates, true);
    const changedCells = [...updates.values()].reduce(
      (total, cells) => total + Object.keys(cells).length,
      0,
    );
    setBulkUndoNotice(
      `${changedCells.toLocaleString("ja-JP")}セルを貼り付けました${attempted >= maxCells ? "（上限2,000セルまで）" : ""}`,
    );
    if (lastTarget) focusGridCell(lastTarget.rowId, lastTarget.propId);
  }

  useEffect(() => {
    let frame = 0;
    const measureViewport = () => {
      const element = scrollRef.current;
      if (!element || typeof window === "undefined") return;
      const top = element.getBoundingClientRect().top;
      // Leave a small visual gutter below the table while using the remaining
      // visible editor space. The limits preserve a usable virtualized viewport.
      const next = Math.round(
        Math.max(280, Math.min(720, window.innerHeight - top - 24)),
      );
      setViewportHeight((previous) => (previous === next ? previous : next));
    };
    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureViewport);
    };
    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    const observer =
      typeof ResizeObserver === "undefined" || !scrollRef.current
        ? null
        : new ResizeObserver(scheduleMeasure);
    if (observer && scrollRef.current?.parentElement)
      observer.observe(scrollRef.current.parentElement);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      observer?.disconnect();
    };
  }, [
    database.id,
    activeView.id,
    schemaOpen,
    controlsOpen,
    analysisOpen,
    selectedRowId,
  ]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  useEffect(() => {
    latestScrollTopRef.current = 0;
    setScrollTop(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [database.id, activeView.id, deferredDbSearch, serverRowsPage, serverRowsPageSize]);

  useEffect(() => {
    const maxTop = Math.max(
      0,
      tableRenderEntries.length * rowHeight - viewportHeight,
    );
    if (latestScrollTopRef.current <= maxTop) return;
    latestScrollTopRef.current = maxTop;
    setScrollTop(maxTop);
    scrollRef.current?.scrollTo({ top: maxTop });
  }, [tableRenderEntries.length, rowHeight, viewportHeight]);

  const handleTableScroll = (event: React.UIEvent<HTMLDivElement>) => {
    latestScrollTopRef.current = event.currentTarget.scrollTop;
    if (!scrollRafRef.current) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        setScrollTop(latestScrollTopRef.current);
      });
    }
    if (openColumnMenuPropId) closeColumnMenu();
  };

  const overscan = Math.max(8, Math.ceil(viewportHeight / rowHeight));
  const estimatedVirtualHeight = tableRenderEntries.length * rowHeight;
  const safeScrollTop = Math.min(
    scrollTop,
    Math.max(0, estimatedVirtualHeight - viewportHeight),
  );
  const startIndex = Math.max(
    0,
    Math.floor(safeScrollTop / rowHeight) - overscan,
  );
  const endIndex = Math.min(
    tableRenderEntries.length,
    Math.ceil((safeScrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const virtualEntries = useMemo(
    () => tableRenderEntries.slice(startIndex, endIndex),
    [tableRenderEntries, startIndex, endIndex],
  );
  const nonTableRows = performanceMode
    ? visibleRows.slice(0, NON_TABLE_RENDER_LIMIT)
    : visibleRows;
  const nonTableRowsTrimmed =
    performanceMode && visibleRows.length > nonTableRows.length;
  const topPadding = startIndex * rowHeight;
  const bottomPadding = Math.max(
    0,
    (tableRenderEntries.length - endIndex) * rowHeight,
  );
  const virtualizedRowsHidden = Math.max(
    0,
    tableRenderEntries.length - virtualEntries.length,
  );

  const selectedRowsCount = useMemo(
    () => Object.values(selectedIds).filter(Boolean).length,
    [selectedIds],
  );
  const selectedRow = selectedRowId
    ? (database.rows.find((row) => row.id === selectedRowId) ?? null)
    : null;
  const inputProperties = useMemo(
    () =>
      database.properties.filter(
        (prop) =>
          ![
            "rollup",
            "formula",
            "button",
            "created_time",
            "last_edited_time",
          ].includes(prop.type),
      ),
    [database.properties],
  );
  const checkboxProperties = useMemo(
    () => database.properties.filter((prop) => prop.type === "checkbox"),
    [database.properties],
  );
  const databaseStats = useMemo(() => {
    const rows = database.rows;
    const latestUpdated = rows.reduce(
      (latest, row) =>
        row.updatedAt && row.updatedAt > latest ? row.updatedAt : latest,
      database.updatedAt ?? "",
    );
    if (rows.length > DB_EXACT_STATS_ROW_LIMIT) {
      const sample = rows.slice(0, DB_EXACT_STATS_ROW_LIMIT);
      const completed = sample.filter((row) =>
        checkboxProperties.some((prop) => Boolean(row.cells[prop.id])),
      ).length;
      const inputPropertyCount = Math.max(1, inputProperties.length);
      const totalCells = Math.max(1, sample.length * inputPropertyCount);
      let filledCells = 0;
      for (const row of sample) {
        for (const prop of inputProperties) {
          if (isFilledDatabaseValue(row.cells[prop.id])) filledCells += 1;
        }
      }
      return {
        completed,
        fillRate: Math.round((filledCells / totalCells) * 100),
        latestUpdated,
        approximate: true,
      };
    }
    const completed = rows.filter((row) =>
      checkboxProperties.some((prop) => Boolean(row.cells[prop.id])),
    ).length;
    const inputPropertyCount = Math.max(1, inputProperties.length);
    const totalCells = Math.max(1, rows.length * inputPropertyCount);
    let filledCells = 0;
    for (const row of rows) {
      for (const prop of inputProperties) {
        if (isFilledDatabaseValue(row.cells[prop.id])) filledCells += 1;
      }
    }
    return {
      completed,
      fillRate: Math.round((filledCells / totalCells) * 100),
      latestUpdated,
      approximate: false,
    };
  }, [database.rows, database.updatedAt, inputProperties, checkboxProperties]);
  const completed = databaseStats.completed;
  const fillRate = databaseStats.fillRate;
  const latestUpdated = databaseStats.latestUpdated;
  const selectedRowIndex = selectedRow
    ? database.rows.findIndex((row) => row.id === selectedRow.id) + 1
    : "-";
  const selectedRowTitle = selectedRow
    ? database.properties[0]
      ? renderCellPreview(
          selectedRow.cells[database.properties[0].id],
          database.properties[0].type,
        )
      : selectedRow.id
    : "";
  const glossaryText = useMemo(() => {
    // Glossary hints should describe the work currently in view, not scan the whole DB.
    // Prefer the selected row, then a small sample of rows already filtered/sorted by the active view.
    const rows = Array.from(
      new Map(
        [selectedRow, ...visibleRows.slice(0, 48)]
          .filter(Boolean)
          .map((row) => [row!.id, row!] as const),
      ).values(),
    );
    const hintProperties = database.properties.filter(
      (prop) =>
        !["relation", "rollup", "formula", "button", "files"].includes(
          prop.type,
        ),
    );
    return [
      database.title,
      ...hintProperties.map((prop) => prop.name),
      ...rows.flatMap((row) =>
        hintProperties.map((prop) =>
          databaseCellText(database, row, prop, relationUniverse),
        ),
      ),
    ]
      .join("\n")
      .slice(0, 12_000);
  }, [
    database.id,
    database.title,
    database.updatedAt,
    database.properties,
    selectedRow,
    visibleRows,
    relationUniverse,
  ]);
  const analysis = useMemo(
    () =>
      analysisOpen
        ? analyzeDatabase(database)
        : { numeric: [], select: [], date: [], checkbox: [] },
    [analysisOpen, database],
  );
  const selectedIncomingRelations = useMemo(
    () =>
      selectedRow
        ? findRowRelationBacklinks(database, selectedRow.id, relationUniverse)
        : [],
    [selectedRow?.id, database.id, relationUniverse],
  );
  const relationProperties = useMemo(
    () => database.properties.filter((prop) => prop.type === "relation"),
    [database.properties],
  );

  function toggleSubItems(rowId: string) {
    setCollapsedSubItemIds((current) => ({
      ...current,
      [rowId]: !current[rowId],
    }));
  }

  function updateTitle(title: string) {
    mutate((db) => ({ ...db, title, updatedAt: new Date().toISOString() }));
  }

  function updateCell(
    rowId: string,
    propId: string,
    value: any,
    immediate = false,
  ) {
    const prop = databaseRef.current.properties.find(
      (item) => item.id === propId,
    );
    let nextValue = value;
    if (prop?.isSubItemRelation) {
      const requestedParentId = Array.isArray(value)
        ? value.map(String).find(Boolean)
        : undefined;
      const rowById = new Map<string, DatabaseRow>(
        databaseRef.current.rows.map((row): [string, DatabaseRow] => [row.id, row]),
      );
      let cursor = requestedParentId;
      const visited = new Set<string>();
      let createsCycle = cursor === rowId;
      while (cursor && !createsCycle && !visited.has(cursor)) {
        visited.add(cursor);
        const candidate = rowById.get(cursor);
        const parentIds =
          candidate && Array.isArray(candidate.cells[propId])
            ? candidate.cells[propId].map(String)
            : [];
        const parentId = parentIds.find((id) => id !== cursor);
        if (!parentId) break;
        if (parentId === rowId) createsCycle = true;
        cursor = parentId;
      }
      if (createsCycle) {
        nextValue = [];
        window.alert(
          "サブアイテムでは、自分自身または自分の子孫を親に指定できません。親子関係は変更していません。",
        );
      } else {
        nextValue = requestedParentId ? [requestedParentId] : [];
      }
    }
    const patches = new Map<string, Record<string, any>>([
      [rowId, { [propId]: nextValue }],
    ]);
    // Same-DB bidirectional relations may touch several rows. Keep the full set
    // in one patch request, so the server writes and indexes them atomically.
    if (
      prop?.type === "relation" &&
      prop.bidirectionalRelationPropertyId &&
      (prop.relationTargetType ?? "database") === "database" &&
      (prop.relationDatabaseId ?? databaseRef.current.id) ===
        databaseRef.current.id
    ) {
      const reversePropId = prop.bidirectionalRelationPropertyId;
      const nextIds = new Set(
        Array.isArray(nextValue) ? nextValue.map(String) : [],
      );
      for (const row of databaseRef.current.rows) {
        if (row.id === rowId) continue;
        const current = Array.isArray(row.cells[reversePropId])
          ? (row.cells[reversePropId] as string[])
          : [];
        const has = current.includes(rowId);
        if (nextIds.has(row.id) && !has)
          patches.set(row.id, { [reversePropId]: [...current, rowId] });
        if (!nextIds.has(row.id) && has)
          patches.set(row.id, {
            [reversePropId]: current.filter((id) => id !== rowId),
          });
      }
    }
    applyRowCellPatches(patches, immediate);
  }

  function addRowLocal() {
    if (onCreateRows) {
      void createRowsLightweight([{}]);
      return;
    }
    const now = new Date().toISOString();
    const row = {
      id: nextId("row"),
      cells: Object.fromEntries(
        database.properties.map((prop) => [
          prop.id,
          prop.type === "status"
            ? (prop.options?.[0] ?? "未着手")
            : defaultDatabaseCellValue(prop.type),
        ]),
      ),
      createdAt: now,
      updatedAt: now,
    };
    setSelectedRowId(row.id);
    mutate((db) => ({ ...db, updatedAt: now, rows: [row, ...db.rows] }), true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
  }

  function createRowFromForm(cells: Record<string, any>) {
    if (onCreateRows) {
      void createRowsLightweight([{ cells }]);
      return;
    }
    const now = new Date().toISOString();
    const row = {
      id: nextId("row"),
      cells: Object.fromEntries(
        database.properties.map((prop) => [
          prop.id,
          prop.type === "status"
            ? (cells[prop.id] ?? prop.options?.[0] ?? "未着手")
            : (cells[prop.id] ?? defaultDatabaseCellValue(prop.type)),
        ]),
      ),
      createdAt: now,
      updatedAt: now,
    };
    setSelectedRowId(row.id);
    mutate((db) => ({ ...db, updatedAt: now, rows: [row, ...db.rows] }), true);
  }

  function duplicateRow(rowId: string) {
    if (onCreateRows) {
      void createRowsLightweight([{ sourceRowId: rowId }]);
      return;
    }
    const source = database.rows.find((row) => row.id === rowId);
    if (!source) return;
    const now = new Date().toISOString();
    const copy = {
      ...source,
      id: nextId("row"),
      createdAt: now,
      updatedAt: now,
      cells: Object.fromEntries(
        database.properties.map((prop) => [
          prop.id,
          prop.type === "unique_id" ? "" : source.cells[prop.id],
        ]),
      ),
    };
    setSelectedRowId(copy.id);
    mutate((db) => ({ ...db, updatedAt: now, rows: [copy, ...db.rows] }), true);
  }

  function deleteRow(rowId: string) {
    if (onDeleteRows) {
      void deleteRowsLightweight([rowId]).then((handled) => {
        if (!handled) softDeleteRow(rowId);
      });
      return;
    }
    softDeleteRow(rowId);
  }

  function deleteSelectedRows() {
    const ids = Object.keys(selectedIds).filter((id) => selectedIds[id]);
    if (!ids.length) return;
    if (onDeleteRows) {
      void deleteRowsLightweight(ids).then((handled) => {
        if (handled) setSelectedIds({});
      });
      return;
    }
    const now = new Date().toISOString();
    const idSet = new Set(ids);
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        rows: db.rows.filter((row) => !idSet.has(row.id)),
        trash: {
          ...db.trash,
          rows: [
            ...(db.trash?.rows ?? []),
            ...db.rows
              .filter((row) => idSet.has(row.id))
              .map((row) => ({ ...row, deletedAt: now })),
          ],
        },
      }),
      true,
    );
    setSelectedIds({});
  }

  function duplicateSelectedRows() {
    const ids = new Set(
      Object.keys(selectedIds).filter((id) => selectedIds[id]),
    );
    if (onCreateRows && ids.size) {
      const rows = database.rows
        .filter((row) => ids.has(row.id))
        .map((row) => ({ sourceRowId: row.id }));
      void createRowsLightweight(rows, false);
      return;
    }
    const now = new Date().toISOString();
    const copies = database.rows
      .filter((row) => ids.has(row.id))
      .map((row) => ({
        ...row,
        id: nextId("row"),
        createdAt: now,
        updatedAt: now,
        cells: Object.fromEntries(
          database.properties.map((prop) => [
            prop.id,
            prop.type === "unique_id" ? "" : row.cells[prop.id],
          ]),
        ),
      }));
    if (!copies.length) return;
    mutate(
      (db) => ({ ...db, updatedAt: now, rows: [...copies, ...db.rows] }),
      true,
    );
  }

  function moveRowBefore(sourceRowId: string, targetRowId: string) {
    if (!editing || sourceRowId === targetRowId) return;
    const now = new Date().toISOString();
    mutate((db) => {
      const rows = [...db.rows];
      const from = rows.findIndex((row) => row.id === sourceRowId);
      const to = rows.findIndex((row) => row.id === targetRowId);
      if (from < 0 || to < 0) return db;
      const [moved] = rows.splice(from, 1);
      const nextTo = rows.findIndex((row) => row.id === targetRowId);
      rows.splice(Math.max(0, nextTo), 0, moved);
      return {
        ...db,
        updatedAt: now,
        rows: rows.map((row, index) =>
          row.id === moved.id ? { ...row, updatedAt: now } : row,
        ),
      };
    }, true);
  }

  function movePropertyBefore(sourcePropId: string, targetPropId: string) {
    if (!editing || sourcePropId === targetPropId) return;
    const now = new Date().toISOString();
    mutate((db) => {
      const properties = [...db.properties];
      const from = properties.findIndex((prop) => prop.id === sourcePropId);
      const to = properties.findIndex((prop) => prop.id === targetPropId);
      if (from < 0 || to < 0) return db;
      const [moved] = properties.splice(from, 1);
      const nextTo = properties.findIndex((prop) => prop.id === targetPropId);
      properties.splice(Math.max(0, nextTo), 0, moved);
      return { ...db, updatedAt: now, properties };
    }, true);
  }

  function movePropertyToEnd(sourcePropId: string) {
    if (!editing) return;
    const now = new Date().toISOString();
    mutate((db) => {
      const properties = [...db.properties];
      const from = properties.findIndex((prop) => prop.id === sourcePropId);
      if (from < 0) return db;
      const [moved] = properties.splice(from, 1);
      properties.push(moved);
      return { ...db, updatedAt: now, properties };
    }, true);
  }

  function updateRelationCellByDrop(
    rowId: string,
    propId: string,
    relationId: string,
  ) {
    const row = databaseRef.current.rows.find((item) => item.id === rowId);
    if (!row) return;
    const current = Array.isArray(row.cells[propId])
      ? (row.cells[propId] as string[])
      : [];
    if (current.includes(relationId)) return;
    updateCell(rowId, propId, [...current, relationId], true);
  }

  function addPropertyLocal(type: DatabasePropertyType) {
    const now = new Date().toISOString();
    const firstRelation = database.properties.find(
      (p) => p.type === "relation",
    );
    const firstNumber = database.properties.find(
      (p) => p.type === "number" || p.type === "checkbox",
    );
    const firstStatus = database.properties.find((p) => p.type === "status");
    const firstDate = database.properties.find((p) => p.type === "date");
    const property = {
      id: nextId("prop"),
      name: `新しい${propertyTypeLabel(type)}`,
      type,
      options:
        type === "select" || type === "status" || type === "multi_select"
          ? type === "status"
            ? ["未着手", "進行中", "完了"]
            : ["未設定"]
          : undefined,
      buttonAction:
        type === "button"
          ? firstStatus
            ? ("mark_status_done" as const)
            : firstDate
              ? ("set_today" as const)
              : undefined
          : undefined,
      buttonTargetPropertyId:
        type === "button" ? (firstStatus?.id ?? firstDate?.id) : undefined,
      relationTargetType:
        type === "relation" ? ("database" as const) : undefined,
      relationDatabaseId: type === "relation" ? database.id : undefined,
      rollupRelationPropertyId:
        type === "rollup" ? firstRelation?.id : undefined,
      rollupTargetPropertyId: type === "rollup" ? firstNumber?.id : undefined,
      rollupFunction: type === "rollup" ? ("count" as const) : undefined,
      formulaExpression: type === "formula" ? "daysUntil(Date)" : undefined,
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        properties: [...db.properties, property],
        rows: db.rows.map((row) =>
          type === "created_time" ||
          type === "last_edited_time" ||
          type === "unique_id" ||
          type === "button"
            ? row
            : {
                ...row,
                cells: {
                  ...row.cells,
                  [property.id]: defaultDatabaseCellValue(type),
                },
              },
        ),
      }),
      true,
    );
  }

  function addDependencyRelation() {
    if (
      !editing ||
      database.properties.some((prop) => prop.isDependencyRelation)
    )
      return;
    const now = new Date().toISOString();
    const property = {
      id: nextId("prop"),
      name: "依存タスク",
      type: "relation" as const,
      relationTargetType: "database" as const,
      relationDatabaseId: database.id,
      isDependencyRelation: true,
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        properties: [...db.properties, property],
        rows: db.rows.map((row) => ({
          ...row,
          cells: { ...row.cells, [property.id]: [] },
        })),
      }),
      true,
    );
  }

  function addSubItemRelation() {
    if (!editing || database.properties.some((prop) => prop.isSubItemRelation))
      return;
    const now = new Date().toISOString();
    const property = {
      id: nextId("prop"),
      name: "親アイテム",
      type: "relation" as const,
      relationTargetType: "database" as const,
      relationDatabaseId: database.id,
      isSubItemRelation: true,
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        properties: [...db.properties, property],
        rows: db.rows.map((row) => ({
          ...row,
          cells: { ...row.cells, [property.id]: [] },
        })),
      }),
      true,
    );
  }

  function updatePropertyName(propId: string, name: string) {
    mutate((db) => ({
      ...db,
      updatedAt: new Date().toISOString(),
      properties: db.properties.map((prop) =>
        prop.id === propId ? { ...prop, name } : prop,
      ),
    }));
  }

  function updatePropertyDescription(propId: string, description: string) {
    mutate((db) => ({
      ...db,
      updatedAt: new Date().toISOString(),
      properties: db.properties.map((prop) =>
        prop.id === propId ? { ...prop, description } : prop,
      ),
    }));
  }

  function updatePropertyConfig(
    propId: string,
    patch: Partial<WorkspaceDatabase["properties"][number]>,
  ) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId ? { ...prop, ...patch } : prop,
        ),
      }),
      true,
    );
  }

  function updatePropertyType(propId: string, type: DatabasePropertyType) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId
            ? {
                ...prop,
                type,
                options:
                  type === "select" ||
                  type === "status" ||
                  type === "multi_select"
                    ? prop.options?.length
                      ? prop.options
                      : type === "status"
                        ? ["未着手", "進行中", "完了"]
                        : ["未設定"]
                    : undefined,
                relationTargetType:
                  type === "relation"
                    ? (prop.relationTargetType ?? "database")
                    : undefined,
                relationDatabaseId:
                  type === "relation"
                    ? (prop.relationDatabaseId ?? db.id)
                    : undefined,
                rollupRelationPropertyId:
                  type === "rollup"
                    ? (prop.rollupRelationPropertyId ??
                      db.properties.find((p) => p.type === "relation")?.id)
                    : undefined,
                rollupTargetPropertyId:
                  type === "rollup"
                    ? (prop.rollupTargetPropertyId ??
                      db.properties.find(
                        (p) => p.type === "number" || p.type === "checkbox",
                      )?.id)
                    : undefined,
                rollupFunction:
                  type === "rollup"
                    ? (prop.rollupFunction ?? "count")
                    : undefined,
                formulaExpression:
                  type === "formula"
                    ? (prop.formulaExpression ?? "daysUntil(Date)")
                    : undefined,
                buttonAction:
                  type === "button"
                    ? (prop.buttonAction ??
                      (db.properties.some((p) => p.type === "status")
                        ? "mark_status_done"
                        : db.properties.some((p) => p.type === "date")
                          ? "set_today"
                          : undefined))
                    : undefined,
                buttonTargetPropertyId:
                  type === "button"
                    ? (prop.buttonTargetPropertyId ??
                      db.properties.find((p) => p.type === "status")?.id ??
                      db.properties.find((p) => p.type === "date")?.id)
                    : undefined,
              }
            : prop,
        ),
        rows: db.rows.map((row) => {
          if (
            type === "created_time" ||
            type === "last_edited_time" ||
            type === "unique_id" ||
            type === "button"
          ) {
            const { [propId]: _discarded, ...cells } = row.cells;
            return { ...row, cells };
          }
          return {
            ...row,
            cells: {
              ...row.cells,
              [propId]: coerceDatabaseCellValue(row.cells[propId], type),
            },
          };
        }),
      }),
      true,
    );
  }

  function editPropertyOptions(propId: string) {
    const prop = database.properties.find((item) => item.id === propId);
    if (!prop || (prop.type !== "select" && prop.type !== "multi_select"))
      return;
    setEditingOptionsPropId((current) => (current === propId ? null : propId));
  }

  function addPropertyOption(propId: string, optionName: string) {
    const name = optionName.trim();
    if (!name) return;
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) => {
          if (prop.id !== propId) return prop;
          const options = prop.options ?? [];
          return options.includes(name)
            ? prop
            : { ...prop, options: [...options, name] };
        }),
      }),
      true,
    );
  }

  function renamePropertyOption(
    propId: string,
    oldName: string,
    newName: string,
  ) {
    const nextName = newName.trim();
    if (!nextName || nextName === oldName) return;
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId
            ? {
                ...prop,
                options: (prop.options ?? []).map((option) =>
                  option === oldName ? nextName : option,
                ),
              }
            : prop,
        ),
        rows: db.rows.map((row) => {
          const value = row.cells[propId];
          if (Array.isArray(value))
            return {
              ...row,
              cells: {
                ...row.cells,
                [propId]: value.map((item) =>
                  item === oldName ? nextName : item,
                ),
              },
            };
          return {
            ...row,
            cells: {
              ...row.cells,
              [propId]: value === oldName ? nextName : value,
            },
          };
        }),
      }),
      true,
    );
  }

  function deletePropertyOption(propId: string, optionName: string) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId
            ? {
                ...prop,
                options: (prop.options ?? []).filter(
                  (option) => option !== optionName,
                ),
              }
            : prop,
        ),
        rows: db.rows.map((row) => {
          const value = row.cells[propId];
          if (Array.isArray(value))
            return {
              ...row,
              cells: {
                ...row.cells,
                [propId]: value.filter((item) => item !== optionName),
              },
            };
          return {
            ...row,
            cells: {
              ...row.cells,
              [propId]: value === optionName ? "" : value,
            },
          };
        }),
      }),
      true,
    );
  }

  function updateRelationTarget(
    propId: string,
    relationTargetType: "database" | "page" | "journal",
    relationDatabaseId?: string,
  ) {
    const targetDb =
      relationTargetType === "database"
        ? allDatabases.find(
            (item) => item.id === (relationDatabaseId || database.id),
          )
        : null;
    if (
      workspaceScope(database) === "shared" &&
      targetDb &&
      workspaceScope(targetDb) === "private"
    ) {
      window.alert(
        "SharedデータベースからPrivateデータベースへのRelationは作成できません。Private情報が共有側に漏れるのを防ぐためです。",
      );
      return;
    }
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId
            ? {
                ...prop,
                relationTargetType,
                relationDatabaseId:
                  relationTargetType === "database"
                    ? relationDatabaseId || db.id
                    : undefined,
                bidirectionalRelationPropertyId: undefined,
              }
            : prop,
        ),
        rows: db.rows.map((row) => ({
          ...row,
          cells: { ...row.cells, [propId]: [] },
        })),
      }),
      true,
    );
  }

  function updateRelationBidirectional(propId: string, reversePropId: string) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId
            ? {
                ...prop,
                bidirectionalRelationPropertyId: reversePropId || undefined,
              }
            : prop,
        ),
      }),
      true,
    );
  }

  function updateRollupConfig(
    propId: string,
    patch: Partial<WorkspaceDatabase["properties"][number]>,
  ) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId ? { ...prop, ...patch } : prop,
        ),
      }),
      true,
    );
  }

  function updateFormulaExpression(propId: string, formulaExpression: string) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        properties: db.properties.map((prop) =>
          prop.id === propId ? { ...prop, formulaExpression } : prop,
        ),
      }),
      true,
    );
  }

  function removeProperty(propId: string) {
    const prop = database.properties.find((item) => item.id === propId);
    if (!prop) return;
    const impacted = [
      ...(database.views ?? [])
        .filter(
          (view) =>
            view.groupByPropertyId === propId ||
            view.datePropertyId === propId ||
            view.startDatePropertyId === propId ||
            view.endDatePropertyId === propId,
        )
        .map((view) => `ビュー: ${view.name}`),
      ...database.properties
        .filter(
          (item) =>
            item.rollupRelationPropertyId === propId ||
            item.rollupTargetPropertyId === propId ||
            item.bidirectionalRelationPropertyId === propId,
        )
        .map((item) => `参照プロパティ: ${item.name}`),
    ];
    if (
      impacted.length &&
      !window.confirm(
        `このプロパティは他の設定から参照されています。\n${impacted.slice(0, 8).join("\n")}\n\n削除してDBゴミ箱へ移動しますか？`,
      )
    )
      return;
    const now = new Date().toISOString();
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        properties: db.properties.filter((item) => item.id !== propId),
        trash: {
          ...db.trash,
          properties: [
            ...(db.trash?.properties ?? []),
            { ...prop, deletedAt: now },
          ],
        },
      }),
      true,
    );
  }

  function updateView(view: DatabaseView) {
    const views =
      database.views && database.views.length > 0
        ? database.views
        : [activeView];
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        views: views.map((v) => (v.id === view.id ? view : v)),
        activeViewId: view.id,
      }),
      true,
    );
  }

  function createView(type: DatabaseView["type"] = "table") {
    const groupProp =
      type === "board"
        ? getBoardGroupProperty(database, activeView)
        : undefined;
    const dateProp =
      type === "calendar" || type === "timeline" || type === "gantt"
        ? getDateProperty(database, activeView)
        : undefined;
    const title = viewLabel(type);
    const view: DatabaseView = {
      id: nextId("view"),
      name: `${title} ${(database.views?.length ?? 0) + 1}`,
      type,
      filters: [],
      sorts: [],
      groupByPropertyId: groupProp?.id,
      datePropertyId: dateProp?.id,
      startDatePropertyId: dateProp?.id,
      endDatePropertyId: dateProp?.id,
      visiblePropertyIds:
        type === "gallery"
          ? database.properties.slice(0, 4).map((prop) => prop.id)
          : undefined,
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        views: [...(db.views ?? []), view],
        activeViewId: view.id,
      }),
      true,
    );
  }

  function switchOrCreateView(type: DatabaseView["type"]) {
    const existing = (database.views ?? []).find((view) => view.type === type);
    if (existing) {
      mutate(
        (db) => ({
          ...db,
          updatedAt: new Date().toISOString(),
          activeViewId: existing.id,
        }),
        true,
      );
      return;
    }
    createView(type);
  }

  function deleteViewById(viewId: string) {
    const views =
      database.views && database.views.length > 0
        ? database.views
        : [activeView];
    if (views.length <= 1) return;
    const target = views.find((view) => view.id === viewId);
    if (!target) return;
    const ok = window.confirm(
      `ビュー「${target.name}」を削除しますか？\n行データは削除されません。`,
    );
    if (!ok) return;
    const now = new Date().toISOString();
    const nextViews = views.filter((view) => view.id !== viewId);
    const nextActiveViewId =
      activeView.id === viewId ? nextViews[0]?.id : activeView.id;
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        views: nextViews,
        activeViewId: nextActiveViewId,
        trash: {
          ...db.trash,
          views: [...(db.trash?.views ?? []), { ...target, deletedAt: now }],
        },
      }),
      true,
    );
  }

  function resetActiveViewConditions() {
    updateView({ ...activeView, filters: [], filterLogic: "and", sorts: [] });
  }

  function addTodayRow() {
    const now = new Date().toISOString();
    const today = new Date().toISOString().slice(0, 10);
    const cells = Object.fromEntries(
      database.properties.map((prop) => {
        if (prop.type === "date") return [prop.id, today];
        if (
          prop.type === "status" ||
          (prop.type === "select" && prop.name.toLowerCase().includes("status"))
        )
          return [prop.id, prop.options?.[0] ?? "未着手"];
        return [prop.id, defaultDatabaseCellValue(prop.type)];
      }),
    );
    const row = { id: nextId("row"), cells, createdAt: now, updatedAt: now };
    setSelectedRowId(row.id);
    mutate((db) => ({ ...db, updatedAt: now, rows: [row, ...db.rows] }), true);
  }

  function addFilter() {
    const prop = database.properties[0];
    if (!prop) return;
    updateView({
      ...activeView,
      filters: [
        ...activeView.filters,
        {
          id: nextId("filter"),
          propertyId: prop.id,
          operator: "contains",
          value: "",
        },
      ],
    });
  }

  function addSort() {
    const prop = database.properties[0];
    if (!prop) return;
    updateView({
      ...activeView,
      sorts: [
        ...activeView.sorts,
        { id: nextId("sort"), propertyId: prop.id, direction: "asc" },
      ],
    });
  }

  function removeViewFilter(id: string) {
    updateView({
      ...activeView,
      filters: activeView.filters.filter((f) => f.id !== id),
    });
  }

  function removeViewSort(id: string) {
    updateView({
      ...activeView,
      sorts: activeView.sorts.filter((s) => s.id !== id),
    });
  }

  function renameView(name: string) {
    updateView({ ...activeView, name });
  }

  function duplicateActiveView() {
    const copy: DatabaseView = {
      ...activeView,
      id: nextId("view"),
      name: `${activeView.name} コピー`,
      filters: activeView.filters.map((filter) => ({
        ...filter,
        id: nextId("filter"),
      })),
      sorts: activeView.sorts.map((sort) => ({ ...sort, id: nextId("sort") })),
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        views: [...(db.views ?? []), copy],
        activeViewId: copy.id,
      }),
      true,
    );
  }

  function deleteActiveView() {
    deleteViewById(activeView.id);
  }

  function hideEmptyColumns() {
    const next: Record<string, boolean> = { ...hiddenColumns };
    for (const prop of database.properties) {
      const hasValue = database.rows.some(
        (row) =>
          dbText(row.cells[prop.id]).trim() || Boolean(row.cells[prop.id]),
      );
      if (!hasValue) next[prop.id] = true;
    }
    // Keep one column accessible even for an entirely empty database.
    if (
      database.properties.length > 0 &&
      database.properties.every((prop) => next[prop.id])
    ) {
      next[database.properties[0].id] = false;
    }
    setHiddenColumns(next);
  }

  function resetColumnLayout() {
    setHiddenColumns({});
    setColumnWidths({});
    setColumnOrder([]);
    setPinnedColumnCount(0);
  }

  function pinColumnsThrough(propId: string) {
    const index = visibleProperties.findIndex((prop) => prop.id === propId);
    if (index < 0 || index >= MAX_PINNED_DATABASE_COLUMNS) return;
    setPinnedColumnCount(index + 1);
  }

  function clearPinnedColumns() {
    setPinnedColumnCount(0);
  }

  function moveColumnBefore(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    setColumnOrder((current) => {
      const base = current.length
        ? current.filter((id) =>
            database.properties.some((prop) => prop.id === id),
          )
        : database.properties.map((prop) => prop.id);
      for (const prop of database.properties)
        if (!base.includes(prop.id)) base.push(prop.id);
      const from = base.indexOf(sourceId);
      const to = base.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return base;
      const next = [...base];
      next.splice(from, 1);
      next.splice(next.indexOf(targetId), 0, sourceId);
      return next;
    });
  }

  function setColumnVisibility(propId: string, visible: boolean) {
    setHiddenColumns((current) => {
      const visibleCount = database.properties.filter(
        (prop) => !current[prop.id],
      ).length;
      if (!visible && !current[propId] && visibleCount <= 1) return current;
      return { ...current, [propId]: !visible };
    });
  }

  function toggleSort(propId: string) {
    setSortState((current) =>
      current?.propId === propId
        ? { propId, direction: current.direction === "asc" ? "desc" : "asc" }
        : { propId, direction: "asc" },
    );
  }

  function toggleSelected(rowId: string, checked: boolean) {
    setSelectedIds((ids) => ({ ...ids, [rowId]: checked }));
  }

  function toggleAllVisible(checked: boolean) {
    const next: Record<string, boolean> = { ...selectedIds };
    for (const row of visibleRows) next[row.id] = checked;
    setSelectedIds(next);
  }

  function applyBulkEdit(request: BulkEditRequest) {
    const selected = new Set(
      Object.entries(selectedIds)
        .filter(([, checked]) => checked)
        .map(([id]) => id),
    );
    if (!selected.size) return;
    const now = new Date().toISOString();
    mutate((db) => {
      const property = db.properties.find(
        (item) => item.id === request.propertyId,
      );
      if (!property) return db;
      const rows = db.rows.map((row) => {
        if (!selected.has(row.id)) return row;
        const current = row.cells[property.id];
        let nextValue: any = request.value;
        if (request.operation === "clear")
          nextValue = defaultDatabaseCellValue(property.type);
        if (property.type === "multi_select") {
          const currentValues = Array.isArray(current)
            ? current.map(String)
            : [];
          const values = Array.isArray(request.value)
            ? request.value.map(String)
            : [];
          if (request.operation === "add")
            nextValue = [...new Set([...currentValues, ...values])];
          if (request.operation === "remove")
            nextValue = currentValues.filter(
              (value) => !values.includes(value),
            );
          if (request.operation === "set") nextValue = values;
        }
        if (property.type === "number" && request.operation !== "clear") {
          const parsed = Number(request.value);
          nextValue = Number.isFinite(parsed) ? parsed : null;
        }
        return {
          ...row,
          updatedAt: now,
          cells: { ...row.cells, [property.id]: nextValue },
        };
      });
      return { ...db, updatedAt: now, rows };
    }, true);
    setBulkEditOpen(false);
    setBulkUndoNotice(
      `${selected.size}件の「${database.properties.find((prop) => prop.id === request.propertyId)?.name ?? "プロパティ"}」を更新しました`,
    );
  }

  function exportCsv(onlySelected = false) {
    const rows = onlySelected
      ? visibleRows.filter((row) => selectedIds[row.id])
      : visibleRows;
    const csv = databaseToCsv(database, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${database.title || "database"}_${onlySelected ? "selected" : "all"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importCsvFile(file: File) {
    const text = await file.text();
    const next = csvToDatabaseRows(database, text);
    if (next) {
      mutate(() => next, true);
      setSelectedRowId(next.rows[0]?.id ?? null);
    }
  }

  function openRelationTarget(
    prop: WorkspaceDatabase["properties"][number],
    rawId: string,
  ) {
    const targetType = prop.relationTargetType ?? "database";
    if (targetType === "page") {
      onOpenPage?.(rawId);
      return;
    }
    if (targetType === "journal") {
      onOpenJournal?.(rawId);
      return;
    }
    const targetDbId = prop.relationDatabaseId || database.id;
    if (targetDbId === database.id) {
      setSelectedRowId(rawId);
      return;
    }
    onOpenDatabase?.(targetDbId);
  }

  function softDeleteRow(rowId: string) {
    const now = new Date().toISOString();
    const row = databaseRef.current.rows.find((item) => item.id === rowId);
    if (!row) return;
    mutate(
      (db) => ({
        ...db,
        updatedAt: now,
        rows: db.rows.filter((item) => item.id !== rowId),
        trash: {
          ...db.trash,
          rows: [...(db.trash?.rows ?? []), { ...row, deletedAt: now }],
        },
      }),
      true,
    );
    setSelectedRowId((current) => (current === rowId ? null : current));
    setSelectedIds((ids) => {
      const next = { ...ids };
      delete next[rowId];
      return next;
    });
  }

  function restoreTrashedRow(rowId: string) {
    const now = new Date().toISOString();
    mutate((db) => {
      const trashed = (db.trash?.rows ?? []).find((row) => row.id === rowId);
      if (!trashed) return db;
      const { deletedAt, ...row } = trashed as any;
      return {
        ...db,
        updatedAt: now,
        rows: [{ ...row, updatedAt: now }, ...db.rows],
        trash: {
          ...db.trash,
          rows: (db.trash?.rows ?? []).filter((row) => row.id !== rowId),
        },
      };
    }, true);
  }

  function emptyDatabaseTrash() {
    if (!window.confirm("DBゴミ箱を完全に空にしますか？この操作は戻せません。"))
      return;
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        trash: { rows: [], properties: [], views: [] },
      }),
      true,
    );
  }

  function restoreTrashedProperty(propId: string) {
    const now = new Date().toISOString();
    mutate((db) => {
      const prop = (db.trash?.properties ?? []).find(
        (item) => item.id === propId,
      );
      if (!prop) return db;
      const { deletedAt, ...cleanProp } = prop as any;
      return {
        ...db,
        updatedAt: now,
        properties: [...db.properties, cleanProp],
        rows: db.rows.map((row) => ({
          ...row,
          cells: {
            ...row.cells,
            [cleanProp.id]:
              row.cells[cleanProp.id] ??
              defaultDatabaseCellValue(cleanProp.type),
          },
        })),
        trash: {
          ...db.trash,
          properties: (db.trash?.properties ?? []).filter(
            (item) => item.id !== propId,
          ),
        },
      };
    }, true);
  }

  function restoreTrashedView(viewId: string) {
    const now = new Date().toISOString();
    mutate((db) => {
      const view = (db.trash?.views ?? []).find((item) => item.id === viewId);
      if (!view) return db;
      const { deletedAt, ...cleanView } = view as any;
      return {
        ...db,
        updatedAt: now,
        views: [...(db.views ?? []), cleanView],
        activeViewId: cleanView.id,
        trash: {
          ...db.trash,
          views: (db.trash?.views ?? []).filter((item) => item.id !== viewId),
        },
      };
    }, true);
  }

  function addCurrentRowAsTemplate() {
    const baseName = (selectedRowTitle || "新規テンプレート").trim();
    const existingCount = (database.templates ?? []).filter((t) =>
      t.name.startsWith(baseName),
    ).length;
    const name = existingCount ? `${baseName} ${existingCount + 1}` : baseName;
    const cells = selectedRow
      ? { ...selectedRow.cells }
      : Object.fromEntries(
          database.properties.map((prop) => [
            prop.id,
            defaultDatabaseCellValue(prop.type),
          ]),
        );
    const template = {
      id: nextId("tpl"),
      name,
      cells,
      createdAt: new Date().toISOString(),
    };
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        templates: [...(db.templates ?? []), template],
      }),
      true,
    );
    setTemplateOpen(true);
  }

  function addRowFromTemplate(templateId: string) {
    const template = database.templates?.find((item) => item.id === templateId);
    if (!template) return;
    const now = new Date().toISOString();
    const row = {
      id: nextId("row"),
      cells: { ...template.cells },
      createdAt: now,
      updatedAt: now,
    };
    setSelectedRowId(row.id);
    mutate((db) => ({ ...db, updatedAt: now, rows: [row, ...db.rows] }), true);
  }

  function deleteTemplate(templateId: string) {
    mutate(
      (db) => ({
        ...db,
        updatedAt: new Date().toISOString(),
        templates: (db.templates ?? []).filter(
          (item) => item.id !== templateId,
        ),
      }),
      true,
    );
  }

  function installTaskManagementPack() {
    const now = new Date().toISOString();
    mutate((db) => {
      const existingNames = new Set(db.properties.map((prop) => prop.name));
      const newProps: WorkspaceDatabase["properties"] = [];
      const push = (
        name: string,
        type: DatabasePropertyType,
        extra: Partial<WorkspaceDatabase["properties"][number]> = {},
      ) => {
        if (existingNames.has(name)) return undefined;
        const prop = {
          id: nextId("prop"),
          name,
          type,
          ...extra,
        } as WorkspaceDatabase["properties"][number];
        newProps.push(prop);
        existingNames.add(name);
        return prop;
      };
      const existing = (name: string, type: DatabasePropertyType) =>
        [...db.properties, ...newProps].find(
          (prop) => prop.name === name && prop.type === type,
        );
      const ensure = (
        name: string,
        type: DatabasePropertyType,
        extra: Partial<WorkspaceDatabase["properties"][number]> = {},
      ) => existing(name, type) ?? push(name, type, extra);

      // The pack is intentionally idempotent: re-applying it fills only missing
      // components and does not add duplicate Gantt views or duplicate schema.
      // Parent Task is the canonical sub-item pointer; Child Tasks is its inverse
      // relation so a parent Rollup reads only its related children.
      const status = ensure("Status", "status", {
        options: ["未着手", "進行中", "完了"],
      });
      const start = ensure("Start", "date");
      const end = ensure("End", "date");
      const parent = ensure("Parent Task", "relation", {
        relationTargetType: "database",
        relationDatabaseId: db.id,
        isSubItemRelation: true,
      });
      const children = ensure("Child Tasks", "relation", {
        relationTargetType: "database",
        relationDatabaseId: db.id,
      });
      ensure("Depends On", "relation", {
        relationTargetType: "database",
        relationDatabaseId: db.id,
        isDependencyRelation: true,
      });
      ensure("Sub Item Count", "rollup", {
        rollupRelationPropertyId: children?.id,
        rollupTargetPropertyId: status?.id,
        rollupFunction: "count",
      });
      ensure("Completed Sub Items", "rollup", {
        rollupRelationPropertyId: children?.id,
        rollupTargetPropertyId: status?.id,
        rollupFunction: "count_status_done",
      });
      ensure("Progress", "rollup", {
        rollupRelationPropertyId: children?.id,
        rollupTargetPropertyId: status?.id,
        rollupFunction: "percent_status_done",
      });
      ensure("Days Left", "formula", {
        formulaExpression: end ? `daysUntil(${end.name})` : "daysUntil(End)",
      });

      const nextProps = [...db.properties, ...newProps].map((prop) => {
        if (prop.id === parent?.id)
          return {
            ...prop,
            relationTargetType: "database" as const,
            relationDatabaseId: db.id,
            isSubItemRelation: true,
            bidirectionalRelationPropertyId: children?.id,
          };
        if (prop.id === children?.id)
          return {
            ...prop,
            relationTargetType: "database" as const,
            relationDatabaseId: db.id,
            bidirectionalRelationPropertyId: parent?.id,
          };
        return prop;
      });
      const ganttView = {
        id: nextId("view"),
        name: "Gantt Pro",
        type: "gantt" as const,
        filters: [],
        sorts: [],
        datePropertyId: start?.id,
        startDatePropertyId: start?.id,
        endDatePropertyId: end?.id,
      };
      return {
        ...db,
        updatedAt: now,
        properties: nextProps,
        rows: db.rows.map((row) => ({
          ...row,
          cells: {
            ...row.cells,
            ...Object.fromEntries(
              newProps.map((prop) => [
                prop.id,
                prop.type === "status"
                  ? (prop.options?.[0] ?? "未着手")
                  : defaultDatabaseCellValue(prop.type),
              ]),
            ),
          },
        })),
        views: (db.views ?? []).some((view) => view.name === ganttView.name)
          ? (db.views ?? [])
          : [...(db.views ?? []), ganttView],
      };
    }, true);
  }

  function exportDatabaseJson() {
    const blob = new Blob([JSON.stringify(databaseRef.current, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${database.title || "database"}_backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDatabaseJson(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as WorkspaceDatabase;
      if (
        !parsed ||
        !Array.isArray(parsed.properties) ||
        !Array.isArray(parsed.rows)
      )
        throw new Error("invalid");
      mutate(
        (db) => ({
          ...parsed,
          id: db.id,
          title: parsed.title || db.title,
          updatedAt: new Date().toISOString(),
        }),
        true,
      );
    } catch {
      window.alert(
        "復元できませんでした。DBバックアップJSONか確認してください。",
      );
    }
  }

  function getDatabaseIntegrityIssues() {
    const issues: string[] = [];
    const propIds = new Set(database.properties.map((prop) => prop.id));
    for (const view of database.views ?? []) {
      if (view.groupByPropertyId && !propIds.has(view.groupByPropertyId))
        issues.push(`View「${view.name}」のGroup列が見つかりません`);
      if (view.datePropertyId && !propIds.has(view.datePropertyId))
        issues.push(`View「${view.name}」の日付列が見つかりません`);
      for (const filter of view.filters)
        if (!propIds.has(filter.propertyId))
          issues.push(`View「${view.name}」のFilter列が見つかりません`);
      for (const sort of view.sorts)
        if (!propIds.has(sort.propertyId))
          issues.push(`View「${view.name}」のSort列が見つかりません`);
    }
    for (const prop of database.properties) {
      if (
        prop.type === "rollup" &&
        prop.rollupRelationPropertyId &&
        !propIds.has(prop.rollupRelationPropertyId)
      )
        issues.push(`Rollup「${prop.name}」のRelation列が見つかりません`);
      if (prop.type === "rollup" && prop.rollupTargetPropertyId) {
        const relationProp = database.properties.find(
          (p) => p.id === prop.rollupRelationPropertyId,
        );
        const targetDb = relationProp
          ? getRelationTargetDatabase(relationProp, database, relationUniverse)
          : database;
        if (
          !targetDb.properties.some((p) => p.id === prop.rollupTargetPropertyId)
        )
          issues.push(`Rollup「${prop.name}」の集計対象列が見つかりません`);
      }
      if (prop.type === "relation") {
        const targetType = prop.relationTargetType ?? "database";
        const targetDb = getRelationTargetDatabase(
          prop,
          database,
          relationUniverse,
        );
        for (const row of database.rows) {
          const values = Array.isArray(row.cells[prop.id])
            ? (row.cells[prop.id] as string[])
            : [];
          for (const id of values) {
            if (
              targetType === "database" &&
              !targetDb.rows.some((item) => item.id === id)
            )
              issues.push(
                `Relation「${prop.name}」に壊れた行リンクがあります: ${id}`,
              );
            if (targetType === "page" && !pages.some((page) => page.id === id))
              issues.push(
                `Relation「${prop.name}」に壊れたページリンクがあります: ${id}`,
              );
            if (
              targetType === "journal" &&
              !journals.some((journal) => journal.date === id)
            )
              issues.push(
                `Relation「${prop.name}」に壊れたJournalリンクがあります: ${id}`,
              );
          }
        }
      }
    }
    return Array.from(new Set(issues));
  }

  function showIntegrityReport() {
    const issues = getDatabaseIntegrityIssues();
    const message = issues.length
      ? `整合性チェック: ${issues.length}件\n\n${issues.slice(0, 20).join("\n")}${issues.length > 20 ? "\n..." : ""}`
      : "整合性チェックOKです。壊れたRelation / View参照 / Rollup参照は見つかりません。";
    window.alert(message);
  }

  function openIncomingRelation(item: RelationBacklink) {
    if (item.sourceDbId === database.id) {
      setSelectedRowId(item.sourceRowId);
      return;
    }
    onOpenDatabase?.(item.sourceDbId);
  }

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedIds[row.id]);

  const renderColumnMenu = (
    prop: WorkspaceDatabase["properties"][number],
    index: number,
  ) => {
    if (
      openColumnMenuPropId !== prop.id ||
      columnMenuAnchor?.propId !== prop.id ||
      typeof document === "undefined"
    )
      return null;
    const canPinThrough = index < MAX_PINNED_DATABASE_COLUMNS;
    return createPortal(
      <div
        className="fast-column-menu"
        role="menu"
        style={{ left: columnMenuAnchor.left, top: columnMenuAnchor.top }}
        onClick={(event) => event.stopPropagation()}
      >
        <strong>{prop.name}</strong>
        <button
          type="button"
          disabled={visibleProperties.length <= 1}
          onClick={() => {
            setColumnVisibility(prop.id, false);
            closeColumnMenu();
          }}
        >
          {visibleProperties.length <= 1
            ? "最低1列は表示します"
            : "この列を非表示"}
        </button>
        <button
          type="button"
          disabled={visibleProperties[0]?.id === prop.id}
          onClick={() => {
            const first = visibleProperties[0];
            if (first) moveColumnBefore(prop.id, first.id);
            closeColumnMenu();
          }}
        >
          先頭へ移動
        </button>
        <button
          type="button"
          disabled={!canPinThrough}
          onClick={() => {
            pinColumnsThrough(prop.id);
            closeColumnMenu();
          }}
        >
          {canPinThrough
            ? index < effectivePinnedColumnCount
              ? "この列まで固定済み"
              : "この列まで左固定"
            : "左から3列まで固定可能"}
        </button>
        <button
          type="button"
          disabled={effectivePinnedColumnCount === 0}
          onClick={() => {
            clearPinnedColumns();
            closeColumnMenu();
          }}
        >
          左固定を解除
        </button>
        <label>
          集計
          <select
            value={footerAggregates[prop.id] ?? "none"}
            onChange={(event) =>
              setFooterAggregates((current) => ({
                ...current,
                [prop.id]: event.target.value as TableFooterAggregate,
              }))
            }
          >
            {getFooterOptions(prop).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>,
      document.body,
    );
  };

  return (
    <div
      className={`database-editor database-modern database-v58 density-${density}`}
    >
      <DatabaseToolbar
        database={database}
        editing={editing}
        activeView={activeView}
        commitState={commitState}
        latestUpdated={latestUpdated}
        visibleRowsCount={visibleRows.length}
        visibleTotalRows={visibleTotalRows}
        visiblePropertiesCount={visibleProperties.length}
        hiddenPropertiesCount={
          database.properties.filter((prop) => hiddenColumns[prop.id]).length
        }
        selectedRowsCount={selectedRowsCount}
        fillRate={fillRate}
        completed={completed}
        selectedRowIndex={selectedRowIndex}
        hasSelectedRow={Boolean(selectedRow)}
        performanceMode={performanceMode}
        serverTableMode={serverTableMode}
        serverPerf={serverPerf}
        serverPerfLoading={serverPerfLoading}
        apiAvailable={Boolean(api)}
        serverTableEnabled={serverTableEnabled}
        hasSubItemRelation={Boolean(subItemRelation)}
        dbSearch={dbSearch}
        schemaOpen={schemaOpen}
        controlsOpen={controlsOpen}
        density={density}
        fileInputRef={fileInputRef}
        nonTableRenderLimit={NON_TABLE_RENDER_LIMIT}
        onTitleChange={updateTitle}
        onAddRow={addRowLocal}
        onAddTodayRow={addTodayRow}
        onAddProperty={addPropertyLocal}
        onToggleAnalysis={() => setAnalysisOpen((value) => !value)}
        onExportCsv={() => exportCsv(false)}
        onImportCsvFile={importCsvFile}
        onDensityToggle={() =>
          setDensity(density === "comfortable" ? "compact" : "comfortable")
        }
        onLargeDbModeToggle={() => setLargeDbMode((value) => !value)}
        onRebuildServerIndex={rebuildServerIndex}
        onServerTableEnabledChange={setServerTableEnabled}
        onActivateView={(viewId) =>
          mutate((db) => ({ ...db, activeViewId: viewId }), true)
        }
        onDeleteView={deleteViewById}
        onSwitchOrCreateView={switchOrCreateView}
        onDbSearchChange={setDbSearch}
        onSchemaOpenChange={setSchemaOpen}
        onControlsOpenChange={setControlsOpen}
        onAddRowFromTemplate={addRowFromTemplate}
      />

      <GlossaryTermHints
        text={glossaryText}
        terms={glossaryTerms}
        compact
        onOpenSourcePage={onOpenPage}
        onManage={onOpenGlossary}
      />

      <DatabaseUtilityPanels
        database={database}
        editing={editing}
        backupInputRef={backupInputRef}
        dashboardOpen={dashboardOpen}
        templateOpen={templateOpen}
        trashOpen={trashOpen}
        fillRate={fillRate}
        relationPropertiesCount={relationProperties.length}
        onDashboardOpenChange={setDashboardOpen}
        onTemplateOpenChange={setTemplateOpen}
        onTrashOpenChange={setTrashOpen}
        onExportDatabaseJson={exportDatabaseJson}
        onImportDatabaseJson={importDatabaseJson}
        onIntegrityReport={showIntegrityReport}
        onInstallTaskManagementPack={installTaskManagementPack}
        onAddCurrentRowAsTemplate={addCurrentRowAsTemplate}
        onAddRowFromTemplate={addRowFromTemplate}
        onDeleteTemplate={deleteTemplate}
        onEmptyTrash={emptyDatabaseTrash}
        onRestoreTrashedRow={restoreTrashedRow}
        onRestoreTrashedProperty={restoreTrashedProperty}
        onRestoreTrashedView={restoreTrashedView}
      />
      <DatabaseSchemaPanel
        open={schemaOpen}
        database={database}
        allDatabases={allDatabases}
        pages={pages}
        journals={journals}
        relationProperties={relationProperties}
        relationUniverse={relationUniverse}
        editing={editing}
        draggedPropId={draggedPropId}
        hiddenColumns={hiddenColumns}
        editingOptionsPropId={editingOptionsPropId}
        setDraggedPropId={setDraggedPropId}
        setHiddenColumns={setHiddenColumns}
        movePropertyToEnd={movePropertyToEnd}
        movePropertyBefore={movePropertyBefore}
        addPropertyLocal={addPropertyLocal}
        addSubItemRelation={addSubItemRelation}
        addDependencyRelation={addDependencyRelation}
        updatePropertyName={updatePropertyName}
        updatePropertyDescription={updatePropertyDescription}
        updatePropertyType={updatePropertyType}
        updatePropertyConfig={updatePropertyConfig}
        removeProperty={removeProperty}
        editPropertyOptions={editPropertyOptions}
        addPropertyOption={addPropertyOption}
        renamePropertyOption={renamePropertyOption}
        deletePropertyOption={deletePropertyOption}
        updateRelationTarget={updateRelationTarget}
        updateRelationBidirectional={updateRelationBidirectional}
        updateRollupConfig={updateRollupConfig}
        updateFormulaExpression={updateFormulaExpression}
      />

      <DatabaseViewSettingsPanel
        open={controlsOpen}
        activeView={activeView}
        database={database}
        editing={editing}
        visibleRowsCount={visibleRows.length}
        visiblePropertiesCount={visibleProperties.length}
        hiddenColumns={hiddenColumns}
        setHiddenColumns={setHiddenColumns}
        renameView={renameView}
        duplicateActiveView={duplicateActiveView}
        deleteActiveView={deleteActiveView}
        updateView={updateView}
        hideEmptyColumns={hideEmptyColumns}
        resetColumnLayout={resetColumnLayout}
        resetActiveViewConditions={resetActiveViewConditions}
        addFilter={addFilter}
        addSort={addSort}
        removeViewFilter={removeViewFilter}
        removeViewSort={removeViewSort}
      />

      {selectedRowsCount > 0 && (
        <div className="db-bulk-bar">
          <strong>{selectedRowsCount}件選択中</strong>
          <button
            className="db-bulk-edit-trigger"
            disabled={!editing}
            onClick={() => setBulkEditOpen(true)}
          >
            ✦ 一括編集
          </button>
          <button onClick={() => exportCsv(true)}>選択CSV</button>
          <button disabled={!editing} onClick={duplicateSelectedRows}>
            複製
          </button>
          <button disabled={!editing} onClick={deleteSelectedRows}>
            削除
          </button>
          <button onClick={() => setSelectedIds({})}>解除</button>
        </div>
      )}
      {bulkUndoNotice && (
        <div className="db-bulk-undo-toast">
          <span>{bulkUndoNotice}</span>
          <button
            onClick={() => {
              undoDatabaseChange();
              setBulkUndoNotice(null);
            }}
          >
            元に戻す
          </button>
          <button aria-label="閉じる" onClick={() => setBulkUndoNotice(null)}>
            ×
          </button>
        </div>
      )}
      <DatabaseBulkEditModal
        open={bulkEditOpen}
        database={database}
        rowIds={Object.entries(selectedIds)
          .filter(([, checked]) => checked)
          .map(([id]) => id)}
        onClose={() => setBulkEditOpen(false)}
        onApply={applyBulkEdit}
      />

      {nonTableRowsTrimmed && activeView.type !== "table" && (
        <div className="db-large-banner-v131 db-large-warning-v131">
          <strong>表示件数を制限中</strong>
          <span>
            {visibleRows.length}件中、先頭{nonTableRows.length}
            件を表示しています。フィルターや検索で絞り込むと目的の行を見つけやすくなります。
          </span>
        </div>
      )}

      {activeView.type === "board" ? (
        <DatabaseBoard
          database={database}
          rows={nonTableRows}
          view={activeView}
          editing={editing}
          allDatabases={allDatabases}
          pages={pages}
          journals={journals}
          onUpdateCell={updateCell}
          onAddRow={addRowLocal}
          onSelectRow={setSelectedRowId}
        />
      ) : activeView.type === "calendar" ? (
        <DatabaseCalendar
          database={database}
          rows={nonTableRows}
          view={activeView}
          onSelectRow={setSelectedRowId}
        />
      ) : activeView.type === "gallery" ? (
        <DatabaseGallery
          database={database}
          rows={nonTableRows}
          view={activeView}
          onSelectRow={setSelectedRowId}
        />
      ) : activeView.type === "timeline" ? (
        <DatabaseTimeline
          database={database}
          rows={nonTableRows}
          view={activeView}
          onSelectRow={setSelectedRowId}
        />
      ) : activeView.type === "gantt" ? (
        <DatabaseGantt
          database={database}
          rows={nonTableRows}
          view={activeView}
          onSelectRow={setSelectedRowId}
        />
      ) : activeView.type === "form" ? (
        <DatabaseFormView
          database={database}
          editing={editing}
          onCreateRow={createRowFromForm}
          onOpenRow={setSelectedRowId}
        />
      ) : (
        <div
          className={
            selectedRow
              ? "db-fast-layout db-fast-layout-with-preview-v61 db-fast-layout-resizable-preview-v260"
              : "db-fast-layout db-fast-layout-full-v61"
          }
          style={
            selectedRow
              ? ({
                  "--db-row-preview-width": `${previewWidth}px`,
                } as React.CSSProperties)
              : undefined
          }
        >
          <div className="db-fast-table-card">
            {serverTableMode && (
              <DatabaseServerPagingControls
                serverRows={serverRows}
                serverRowsLoading={serverRowsLoading}
                visibleRowsCount={visibleRows.length}
                page={serverRowsPage}
                pageSize={serverRowsPageSize}
                onPageChange={setServerRowsPage}
                onPageSizeChange={setServerRowsPageSize}
              />
            )}
            {activeView.type === "table" && virtualizedRowsHidden > 0 && Boolean((import.meta as any).env?.DEV) && (
              <div className="db-virtual-scroll-status-v716">
                DOM {virtualEntries.length.toLocaleString("ja-JP")} / {tableRenderEntries.length.toLocaleString("ja-JP")}
                <span>仮想スクロール中</span>
              </div>
            )}
            <div
              className="fast-table-scroll"
              ref={scrollRef}
              style={{ height: viewportHeight }}
              onScroll={handleTableScroll}
            >
              <table
                className="fast-db-table"
                onKeyDownCapture={onGridKeyDownCapture}
                onPasteCapture={onGridPasteCapture}
              >
                <thead>
                  <tr>
                    <th className="fast-select-cell">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(e) => toggleAllVisible(e.target.checked)}
                      />
                    </th>
                    <th className="fast-row-number">#</th>
                    {subItemRelation ? (
                      <th
                        className="db-subitem-structure-header"
                        aria-label="サブアイテム"
                        title="サブアイテム"
                      >
                        ↳
                      </th>
                    ) : null}
                    {visibleProperties.map((prop, index) => {
                      const pinnedLeft = pinnedPropertyLeftById[prop.id];
                      const canPinThrough = index < MAX_PINNED_DATABASE_COLUMNS;
                      return (
                        <th
                          key={prop.id}
                          className={
                            pinnedLeft != null
                              ? "fast-pinned-property-head"
                              : undefined
                          }
                          style={{
                            width:
                              columnWidths[prop.id] ??
                              (prop.type === "url" ? 240 : 190),
                            ...(pinnedLeft != null ? { left: pinnedLeft } : {}),
                          }}
                          onDragOver={(event) => {
                            if (editing && draggedPropId)
                              event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (editing && draggedPropId)
                              moveColumnBefore(draggedPropId, prop.id);
                            setDraggedPropId(null);
                          }}
                        >
                          <div className="fast-head-wrap">
                            <span
                              className="fast-column-drag-handle"
                              draggable={editing}
                              onDragStart={(event) => {
                                event.stopPropagation();
                                if (editing) setDraggedPropId(prop.id);
                              }}
                              onDragEnd={() => setDraggedPropId(null)}
                              title="ドラッグして列を並び替え"
                              aria-label={`${prop.name} をドラッグして並び替え`}
                            >
                              ⠿
                            </span>
                            <button
                              className="fast-head-button"
                              onClick={() => toggleSort(prop.id)}
                            >
                              <span>{propertyTypeIcon(prop.type)}</span>
                              <span>{prop.name}</span>
                              {sortState?.propId === prop.id && (
                                <b>
                                  {sortState.direction === "asc" ? "↑" : "↓"}
                                </b>
                              )}
                            </button>
                            <button
                              type="button"
                              className="fast-column-menu-trigger"
                              aria-label={`${prop.name} の列操作`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openColumnMenu(prop.id, event.currentTarget);
                              }}
                            >
                              ⋯
                            </button>
                            {renderColumnMenu(prop, index)}
                          </div>
                          <input
                            className="fast-width-slider"
                            type="range"
                            min={120}
                            max={420}
                            value={
                              columnWidths[prop.id] ??
                              (prop.type === "url" ? 240 : 190)
                            }
                            onChange={(e) =>
                              setColumnWidths((map) => ({
                                ...map,
                                [prop.id]: Number(e.target.value),
                              }))
                            }
                          />
                        </th>
                      );
                    })}
                    <th className="fast-actions-cell">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {topPadding > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={
                          visibleProperties.length + (subItemRelation ? 4 : 3)
                        }
                        style={{ height: topPadding, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {virtualEntries.map((entry) =>
                    entry.kind === "group" ? (
                      <tr
                        key={`group:${entry.key}`}
                        className="db-table-group-row-v614"
                      >
                        <td
                          colSpan={
                            visibleProperties.length +
                            (subItemRelation ? 4 : 3)
                          }
                        >
                          <button
                            type="button"
                            className="db-table-group-toggle-v614"
                            onClick={() =>
                              setCollapsedGroupKeys((current) => ({
                                ...current,
                                [entry.key]: !entry.collapsed,
                              }))
                            }
                            aria-expanded={!entry.collapsed}
                          >
                            <span aria-hidden="true">
                              {entry.collapsed ? "▸" : "▾"}
                            </span>
                            <strong>{entry.label}</strong>
                            <small>
                              {entry.total.toLocaleString("ja-JP")}件
                            </small>
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <FastDatabaseRow
                        key={entry.row.id}
                        row={entry.row}
                        rowIndex={serverTableOffset + entry.rowIndex}
                        rowDepth={rowDepthById[entry.row.id] ?? 0}
                        showSubItemStructure={Boolean(subItemRelation)}
                        hasSubItems={
                          (subItemChildCountById[entry.row.id] ?? 0) > 0
                        }
                        subItemsCollapsed={Boolean(
                          collapsedSubItemIds[entry.row.id],
                        )}
                        subItemProgress={subItemChildProgressById[entry.row.id]}
                        onToggleSubItems={() => toggleSubItems(entry.row.id)}
                        database={database}
                        allDatabases={allDatabases}
                        pages={pages}
                        journals={journals}
                        properties={visibleProperties}
                        selected={Boolean(selectedIds[entry.row.id])}
                        editing={editing}
                        selectedRowId={selectedRowId}
                        onSelect={(checked) =>
                          toggleSelected(entry.row.id, checked)
                        }
                        onFocus={() => setSelectedRowId(entry.row.id)}
                        onUpdateCell={updateCell}
                        onOpenRelationTarget={openRelationTarget}
                        api={api}
                        onDuplicate={() => duplicateRow(entry.row.id)}
                        onDelete={() => deleteRow(entry.row.id)}
                        onDragStartRow={() => setDraggedRowId(entry.row.id)}
                        onDropBeforeRow={() => {
                          if (draggedRowId)
                            moveRowBefore(draggedRowId, entry.row.id);
                          setDraggedRowId(null);
                        }}
                        pinnedPropertyLeftById={pinnedPropertyLeftById}
                      />
                    ),
                  )}
                  {bottomPadding > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={
                          visibleProperties.length + (subItemRelation ? 4 : 3)
                        }
                        style={{ height: bottomPadding, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      className="fast-footer-label"
                      colSpan={subItemRelation ? 3 : 2}
                    >
                      集計
                      {serverTableMode
                        ? serverAggregatesLoading
                          ? "（全件を計算中）"
                          : serverAggregates
                            ? `（全${serverAggregates.total.toLocaleString("ja-JP")}件）`
                            : "（現在ページ）"
                        : "（表示中）"}
                    </td>
                    {visibleProperties.map((prop) => {
                      const pinnedLeft = pinnedPropertyLeftById[prop.id];
                      return (
                        <td
                          key={`footer:${prop.id}`}
                          className={`fast-footer-cell${pinnedLeft != null ? " fast-pinned-property-footer" : ""}`}
                          style={
                            pinnedLeft != null
                              ? { left: pinnedLeft }
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            className={
                              footerAggregates[prop.id] &&
                              footerAggregates[prop.id] !== "none"
                                ? "is-active"
                                : ""
                            }
                            onClick={(event) =>
                              openColumnMenu(prop.id, event.currentTarget)
                            }
                            title={
                              serverAggregates?.unsupportedPropertyIds.includes(
                                prop.id,
                              )
                                ? "Formula / Rollup は現在ページの集計を表示します"
                                : "クリックして集計方法を変更"
                            }
                          >
                            {getFooterAggregateText(prop) || "計算"}
                          </button>
                        </td>
                      );
                    })}
                    <td className="fast-footer-actions" />
                  </tr>
                </tfoot>
              </table>
              {visibleRows.length === 0 && (
                <div className="db-empty-state db-modern-empty">
                  <div>🗃️</div>
                  <strong>まだ行がありません</strong>
                  <span>
                    新規行を追加するか、CSVを読み込んで始めてください。
                  </span>
                  <button disabled={!editing} onClick={addRowLocal}>
                    ＋ 最初の行を追加
                  </button>
                </div>
              )}
            </div>
          </div>

          {selectedRow ? (
            <DatabaseRowDetailDrawer
              selectedRow={selectedRow}
              selectedRowTitle={selectedRowTitle}
              selectedRowIndex={selectedRowIndex}
              selectedIncomingRelations={selectedIncomingRelations}
              database={database}
              allDatabases={allDatabases}
              pages={pages}
              journals={journals}
              editing={editing}
              onClose={() => setSelectedRowId(null)}
              onUpdateCell={updateCell}
              onOpenRelationTarget={openRelationTarget}
              onOpenIncomingRelation={openIncomingRelation}
              onOpenPage={onOpenPage}
              onOpenDatabase={onOpenDatabase}
              onOpenJournal={onOpenJournal}
              onOpenDatabaseRow={(targetDbId, targetRowId) => {
                if (targetDbId === database.id) setSelectedRowId(targetRowId);
                else if (onOpenDatabaseRow) {
                  onOpenDatabaseRow(targetDbId, targetRowId);
                } else if (onOpenDatabase) {
                  onOpenDatabase(targetDbId);
                } else {
                  const target = allDatabases.find(
                    (db) => db.id === targetDbId,
                  );
                  alert(
                    target
                      ? `別データベース「${target.title}」の行です。左のDB一覧から開いてください。`
                      : "リンク先DB行が見つかりません。",
                  );
                }
              }}
              api={api}
              onChildPageCreated={onDatabaseRowChildPageCreated}
              width={previewWidth}
              onWidthChange={(width) => {
                const next = clampDatabasePreviewWidth(width);
                setPreviewWidth(next);
                localStorage.setItem(
                  `fast-db-preview-width:${database.id}`,
                  JSON.stringify(next),
                );
              }}
            />
          ) : null}
        </div>
      )}

      {analysisOpen && <DatabaseAnalysisPanel analysis={analysis} />}
    </div>
  );
}
