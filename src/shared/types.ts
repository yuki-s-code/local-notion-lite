export type PageStatus = "未着手" | "進行中" | "確認待ち" | "完了" | "保留";
export type PagePriority = "Low" | "Mid" | "High" | "低" | "中" | "高" | "緊急";
export type WorkspaceScope = "private" | "shared";

/** Shared, lightweight organization glossary. Definitions live outside normal pages so
 * they can be surfaced quickly in editors and database views without loading a page. */
export type GlossaryStatus = "draft" | "verified" | "deprecated";
export type GlossaryTerm = {
  id: string;
  term: string;
  aliases: string[];
  summary: string;
  category?: string;
  status: GlossaryStatus;
  /** Optional pages or source materials that supplement the glossary definition. */
  sourcePageIds: string[];
  /** Optional maintenance metadata. The summary remains the primary definition. */
  verifiedAt?: string;
  reviewDue?: string;
  owner?: string;
  updatedAt: string;
  updatedBy: string;
};

export type GlossaryUsageRef = {
  kind: "page" | "database-row" | "journal";
  id: string;
  title: string;
  updatedAt?: string;
  databaseId?: string;
  rowId?: string;
};

export type GlossaryTermInsight = {
  termId: string;
  usage: { pages: number; databaseRows: number; journals: number; total: number };
  recentUsage: GlossaryUsageRef[];
  aliasUsage: Array<{ alias: string; count: number }>;
  related: Array<{ termId: string; term: string; reason: string }>;
  evidence: {
    state: "healthy" | "review_due" | "review_soon" | "source_updated" | "definition_only";
    message: string;
    sourcePages: Array<{ id: string; title: string; updatedAt: string }>;
  };
};

export type GlossaryCandidate = {
  phrase: string;
  count: number;
  examples: GlossaryUsageRef[];
};

export type WikiStatus = "draft" | "verified" | "review" | "archived";

export type PageProperties = {
  tags: string[];
  status: PageStatus;
  assignee: string;
  dueDate: string;
  priority: PagePriority;
  url?: string;
  summary?: string;
  /** Wiki / knowledge-quality metadata. Kept optional for existing pages. */
  wikiStatus?: WikiStatus;
  wikiVerifiedAt?: string;
  wikiReviewDue?: string;
  wikiOwner?: string;
  wikiSource?: string;
  wikiSuccessorId?: string;
  /** Project Hub metadata. A project is a normal page, so no separate store is needed. */
  projectRole?: "project";
  projectId?: string;
  projectStatus?: "計画中" | "進行中" | "確認待ち" | "完了" | "保留";
  projectDueDate?: string;
  projectSummary?: string;
};

export type PageMeta = {
  id: string;
  title: string;
  parentId: string | null;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  sortOrder: number;
  favorite?: boolean;
  trashed: boolean;
  properties: PageProperties;
  /** private = this PC only, shared = shared folder visible to other devices/users */
  scope: WorkspaceScope;
};

export type PageBundle = {
  meta: PageMeta;
  markdown: string;
  blocksuite: unknown;
};

export type LockInfo = {
  pageId: string;
  lockedBy: string;
  userName: string;
  appInstanceId: string;
  lockedAt: string;
  expiresAt: string;
  /** Process id is optional for compatibility with lock files written before v393. */
  processId?: number;
  /** Unique lease identity; renew/release never overwrite another lease. */
  leaseId?: string;
};

export type LockAcquireResult = {
  ok: boolean;
  editable: boolean;
  lock: LockInfo | null;
  reason?: string;
};

export type PageWithLock = PageMeta & {
  lock: LockInfo | null;
  isLocked: boolean;
  /** Short plain-text excerpt used only for lightweight sidebar previews. */
  previewSnippet?: string;
};

export type ResourceRef =
  | { type: "page"; pageId: string }
  | { type: "database"; databaseId: string }
  | { type: "database-row"; databaseId: string; rowId: string };

export type ResourceLinkInfo = {
  from: ResourceRef;
  to: ResourceRef;
  sourceTitle: string;
  sourceIcon?: string | null;
  targetTitle: string;
  snippet: string;
  updatedAt: string;
};

export type DatabaseRowLinkTarget = {
  type: "database-row";
  databaseId: string;
  databaseTitle: string;
  rowId: string;
  rowTitle: string;
};

export type DatabaseSidebarRow = {
  databaseId: string;
  rowId: string;
  title: string;
  updatedAt: string;
  hasChildren: boolean;
  childCount: number;
};

export type DatabaseSidebarRowsResult = {
  databaseId: string;
  rows: DatabaseSidebarRow[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type DatabaseSidebarChildPagesResult = {
  databaseId: string;
  rowId: string;
  childPages: PageWithLock[];
};

/** Lightweight, accurate counters for page side-panel tabs.
 * Detail lists remain lazy-loaded so opening a page does not read history,
 * comments, and backlinks in full. */
export type PageSidebarCounts = {
  commentsOpen: number;
  commentsTotal: number;
  history: number;
  /** Loaded when the history tab is opened; omitted during the lightweight page-open count request. */
  conflicts?: number;
  backlinks: number;
};

export type KnowledgeGraphNodeType =
  "page" | "database-row" | "journal" | "attachment" | "tag";

/** Lightweight local graph payload. It is built from SQLite indexes only; page bodies are never scanned while opening the map. */
export type KnowledgeGraphNode = {
  id: string;
  type: KnowledgeGraphNodeType;
  title: string;
  icon?: string | null;
  updatedAt?: string;
  pageId?: string;
  databaseId?: string;
  rowId?: string;
  tag?: string;
  journalDate?: string;
  attachmentId?: string;
  isCenter?: boolean;
};

export type KnowledgeGraphEdgeKind =
  "link" | "backlink" | "parent" | "child" | "tag" | "attachment";

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: KnowledgeGraphEdgeKind;
  label?: string;
};

export type KnowledgeGraphScope = "local" | "global";

export type KnowledgeGraphResult = {
  /** Empty for the bounded workspace-wide map. */
  centerPageId: string;
  scope?: KnowledgeGraphScope;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  truncated: boolean;
  generatedAt: string;
};

export type BacklinkInfo = {
  sourcePageId?: string;
  sourceType?: "page" | "database-row";
  sourceDatabaseId?: string;
  sourceRowId?: string;
  sourceTitle: string;
  sourceIcon?: string | null;
  snippet: string;
  updatedAt: string;
};

export type PageTreeNode = PageWithLock & {
  children: PageTreeNode[];
};

export type HealthInfo = {
  ok: boolean;
  sharedRoot: string;
  localDbPath: string;
  privateStorage?: {
    pagesRoot: string | null;
    databasesRoot: string | null;
    customPages: boolean;
    customDatabases: boolean;
  };
  sqlite?: {
    available: boolean;
    path: string;
    fileName: string;
    custom?: boolean;
    location: "appData" | "documents" | "sharedCache" | "temp" | "other";
  };
  startup?: {
    openLocalDbMs: number;
    initVaultMs: number;
    routeRegistrationMs: number;
    totalMs: number;
  };
};

export type AttachmentInfo = {
  id: string;
  pageId: string;
  fileName: string;
  relativePath: string;
  size: number;
  createdAt: string;
  createdBy: string;
  /** Storage boundary. Missing on legacy records means shared. */
  scope?: WorkspaceScope;
};

export type PageHistoryReason =
  "manual" | "auto_checkpoint" | "metadata_changed" | "restore_before";

export type HistoryEntry = {
  id: string;
  pageId: string;
  title: string;
  backupDir: string;
  createdAt: string;
  createdBy: string;
  /** Why this checkpoint was created. Legacy histories do not have a reason. */
  reason?: PageHistoryReason;
};

export type ConflictInfo = {
  id: string;
  pageId: string;
  conflictDir: string;
  createdAt: string;
  createdBy: string;
  reason: string;
};

export type HistoryDiffLine = {
  type: "same" | "added" | "removed";
  text: string;
};

export type HistoryDiffResult = {
  pageId: string;
  historyId: string;
  historyCreatedAt: string;
  currentUpdatedAt: string;
  addedCount: number;
  removedCount: number;
  lines: HistoryDiffLine[];
};

/** A lightweight, derived notification for changes to a verified Wiki page. */
export type WikiUpdateDigest = {
  pageId: string;
  title: string;
  icon?: string | null;
  updatedAt: string;
  baselineCreatedAt: string;
  addedCount: number;
  removedCount: number;
  summary: string[];
  changed: boolean;
};

export type DatabasePropertyType =
  | "text"
  | "number"
  | "select"
  | "status"
  | "multi_select"
  | "unique_id"
  | "button"
  | "date"
  | "checkbox"
  | "url"
  | "phone"
  | "email"
  | "created_time"
  | "last_edited_time"
  | "relation"
  | "rollup"
  | "formula";

export type DatabaseFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "before"
  | "after"
  | "today"
  | "this_week"
  | "this_month"
  | "overdue"
  | "is_empty"
  | "is_not_empty";

export type DatabaseFilter = {
  id: string;
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: string | number | boolean | string[] | null;
};

export type DatabaseSort = {
  id: string;
  propertyId: string;
  direction: "asc" | "desc";
};

export type DatabaseView = {
  id: string;
  name: string;
  type:
    "table" | "board" | "calendar" | "gallery" | "timeline" | "gantt" | "form";
  filters: DatabaseFilter[];
  /** How multiple conditions are combined. Defaults to AND for existing views. */
  filterLogic?: "and" | "or";
  sorts: DatabaseSort[];
  groupByPropertyId?: string;
  visiblePropertyIds?: string[];
  datePropertyId?: string;
  startDatePropertyId?: string;
  endDatePropertyId?: string;
  collapsedGroupIds?: string[];
};

export type DatabaseProperty = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: string[];
  /** Unique ID display prefix, e.g. 案件 / 受付. Values are server-assigned and immutable. */
  uniqueIdPrefix?: string;
  uniqueIdDigits?: number;
  /** Button actions are explicit row-level operations; they never run automatically. */
  buttonAction?: "mark_status_done" | "set_today";
  buttonTargetPropertyId?: string;
  relationTargetType?: "database" | "page" | "journal";
  relationDatabaseId?: string;
  /** Self-relation used as the canonical parent pointer for Notion-like sub-items. */
  isSubItemRelation?: boolean;
  /** Self-relation: this row cannot start until the referenced rows finish. */
  isDependencyRelation?: boolean;
  // v127 Relation Pro / Rollup / Formula
  bidirectionalRelationPropertyId?: string;
  rollupRelationPropertyId?: string;
  rollupTargetPropertyId?: string;
  rollupFunction?:
    | "count"
    | "count_checked"
    | "count_unchecked"
    | "percent_checked"
    /** Count related Status values that are completed (完了 / Done). */
    | "count_status_done"
    /** Count related Status values that are not completed. */
    | "count_status_open"
    /** Completion percentage for related Status values. */
    | "percent_status_done"
    | "sum"
    | "average"
    | "min"
    | "max"
    | "show_unique";
  formulaExpression?: string;
  /** Optional help text shown beside the property wherever it is edited. */
  description?: string;
};

export type DatabaseRow = {
  id: string;
  cells: Record<string, string | number | boolean | string[] | null>;
  createdAt: string;
  updatedAt: string;
};

export type DatabaseRowPatch = {
  rowId: string;
  /** Partial cell map. Omitted cells remain unchanged. */
  cells: Record<string, string | number | boolean | string[] | null>;
};

export type DatabaseRowPatchResult = {
  databaseId: string;
  rows: DatabaseRow[];
  updatedAt: string;
  updatedBy: string;
};

export type DatabaseRowsCreateRequest = {
  cells?: Record<string, string | number | boolean | string[] | null>;
  sourceRowId?: string;
};

export type DatabaseRowsCreateResult = {
  databaseId: string;
  rows: DatabaseRow[];
  updatedAt: string;
  updatedBy: string;
};

export type DatabaseRowsDeleteResult = {
  databaseId: string;
  deletedRowIds: string[];
  trashedRows: Array<DatabaseRow & { deletedAt: string }>;
  updatedAt: string;
  updatedBy: string;
};

export type DatabaseRowContent = {
  databaseId: string;
  rowId: string;
  title: string;
  markdown: string;
  blocksuite?: any;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
  childPageIds?: string[];
};

export type SaveDatabaseRowContentInput = {
  databaseId: string;
  rowId: string;
  title?: string;
  markdown: string;
  blocksuite?: any;
  baseUpdatedAt?: string;
  scope?: WorkspaceScope;
  childPageIds?: string[];
};

export type DatabaseTemplate = {
  id: string;
  name: string;
  cells: Record<string, string | number | boolean | string[] | null>;
  createdAt: string;
};

export type DatabaseTrash = {
  rows?: Array<DatabaseRow & { deletedAt?: string }>;
  properties?: Array<DatabaseProperty & { deletedAt?: string }>;
  views?: Array<DatabaseView & { deletedAt?: string }>;
};

export type WorkspaceDatabase = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  properties: DatabaseProperty[];
  rows: DatabaseRow[];
  views?: DatabaseView[];
  activeViewId?: string;
  templates?: DatabaseTemplate[];
  trash?: DatabaseTrash;
  scope?: WorkspaceScope;
  trashed?: boolean;
  deletedAt?: string | null;
  /** Client-side optimistic concurrency token. Server compares this with the currently saved updatedAt. */
  baseUpdatedAt?: string;
};

export type DatabaseLockAcquireResult = {
  ok: boolean;
  editable: boolean;
  lock: LockInfo | null;
  reason?: string;
};

export type DatabaseQueryRequest = {
  viewId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  cursor?: string;
};

export type DatabaseQueryResult = {
  databaseId: string;
  viewId?: string;
  rows: DatabaseRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string | null;
  mode: "sqlite-index" | "json-fallback";
  elapsedMs: number;
};

export type DatabaseAggregateMode =
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
  | "percent_checked"
  | "count_status_done"
  | "count_status_open"
  | "percent_status_done";

export type DatabaseAggregateRequest = {
  viewId?: string;
  q?: string;
  aggregates: Record<string, DatabaseAggregateMode>;
};

export type DatabaseAggregateResult = {
  databaseId: string;
  viewId?: string;
  total: number;
  values: Record<string, string>;
  unsupportedPropertyIds: string[];
  elapsedMs: number;
};

export type DatabasePerformanceInfo = {
  databaseId: string;
  rowCount: number;
  indexedRowCount: number;
  lastIndexedAt?: string | null;
  recommendedMode: "normal" | "large" | "server";
  indexes: string[];
};

export type JournalEntry = {
  date: string;
  title: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  mood?: string;
  weather?: string;
  tags?: string[];
  markdown: string;
  blocksuite: unknown;
};

export type JournalSummary = {
  date: string;
  title: string;
  icon?: string | null;
  updatedAt: string;
  previewSnippet: string;
  mood?: string;
  weather?: string;
  tags?: string[];
};

export type InboxOcrResult = {
  status: "ready" | "failed";
  text: string;
  language: string;
  updatedAt: string;
  engine?: string;
  error?: string;
  mode?: "image" | "pdf-page" | "pdf-all";
  page?: number;
  pageCount?: number;
  preprocessing?: "standard" | "enhanced";
  preprocessingNote?: string;
  handwritingWarning?: boolean;
};

export type InboxPdfTextResult = {
  status: "ready" | "unavailable" | "failed";
  text: string;
  pageCount?: number;
  updatedAt: string;
  engine?: string;
  error?: string;
};

export type InboxOcrQueueState = {
  status:
    "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  mode: "inspect" | "page" | "all";
  page?: number;
  preprocessing: "standard" | "enhanced";
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempt: number;
  /** Cross-PC execution lease. Only the owner may finalize the claimed job. */
  workerId?: string;
  leaseId?: string;
  leaseExpiresAt?: string;
  heartbeatAt?: string;
  /** Progress is retained so long PDF OCR jobs remain observable and recoverable. */
  totalPages?: number;
  processedPages?: number;
  currentPage?: number;
  error?: string;
};

export type InboxAttachment = {
  id: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  ocr?: InboxOcrResult;
  pdfText?: InboxPdfTextResult;
  ocrQueue?: InboxOcrQueueState;
};

export type OcrSourceRef = {
  sourceType: "page" | "journal" | "database-row";
  attachmentId: string;
  pageId?: string;
  date?: string;
  databaseId?: string;
  rowId?: string;
  scope?: WorkspaceScope;
  sourceTitle?: string;
};

export type InboxItem = {
  id: string;
  title: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  source: "quick" | "manual" | "drop" | "web";
  status: "open" | "archived";
  priority?: "Low" | "Mid" | "High";
  tags?: string[];
  pinned?: boolean;
  attachments?: InboxAttachment[];
  /** Original attachment represented by this OCR working copy. */
  ocrSource?: OcrSourceRef;
};

export type TaskSourceType = "page" | "journal" | "inbox" | "database-row";

export type TaskItem = {
  id: string;
  sourceType: TaskSourceType;
  sourceId: string;
  sourceTitle: string;
  sourceIcon?: string | null;
  text: string;
  completed: boolean;
  dueDate?: string;
  updatedAt: string;
  context?: string;
};

export type PageComment = {
  id: string;
  pageId: string;
  /** Optional BlockNote block id. Missing value means page-level comment. */
  blockId?: string;
  /** Short block preview captured at comment creation time. */
  blockPreview?: string;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
};

export type PageActivityItem = {
  id: string;
  pageId: string;
  type: "saved" | "comment" | "comment_resolved" | "restored";
  title: string;
  description: string;
  createdAt: string;
  createdBy: string;
  historyId?: string;
  commentId?: string;
  blockId?: string;
};
