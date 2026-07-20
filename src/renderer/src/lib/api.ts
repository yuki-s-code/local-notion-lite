import {
  base64AttachmentLimitMessage,
  isBase64AttachmentWithinLimit,
} from "../../../shared/persistence/attachmentUploadPolicy";
import type {
  WorkspaceScope,
  AttachmentInfo,
  BacklinkInfo,
  KnowledgeGraphResult,
  ConflictInfo,
  HealthInfo,
  HistoryDiffResult,
  HistoryEntry,
  LockInfo,
  LockAcquireResult,
  DatabaseLockAcquireResult,
  PageBundle,
  PageMeta,
  PageTreeNode,
  PageWithLock,
  WorkspaceDatabase,
  DatabaseRowPatch,
  DatabaseRowPatchResult,
  DatabaseRowsCreateRequest,
  DatabaseRowsCreateResult,
  DatabaseRowsDeleteResult,
  DatabasePropertyType,
  DatabaseQueryResult,
  DatabaseAggregateRequest,
  DatabaseAggregateResult,
  DatabasePerformanceInfo,
  DatabaseRowContent,
  SaveDatabaseRowContentInput,
  ResourceLinkInfo,
  DatabaseSidebarRowsResult,
  DatabaseSidebarChildPagesResult,
  PageProperties,
  JournalEntry,
  JournalSummary,
  InboxItem,
  TaskItem,
  PageComment,
  PageActivityItem,
  PageSidebarCounts,
  WikiUpdateDigest,
  GlossaryTerm,
  GlossaryTermInsight,
  GlossaryCandidate,
} from "../../../shared/types";
import { PageApi } from "./api/pageApi";
import { DatabaseApi } from "./api/databaseApi";
import { SemanticApi } from "./api/semanticApi";
import { JournalApi } from "./api/journalApi";
import type { ApiTransport } from "./api/transport";
import type {
  AnalysisDataDictionary,
  AnalysisNotebook,
  AnalysisNotebookSummary,
  AnalysisParameter,
  AnalysisQueryResult,
  AnalysisStatus,
  AnalysisWorkspaceSettings,
} from "../../../shared/analysisTypes";

export class ApiError extends Error {
  status: number;
  payload: any;
  code?: string;

  constructor(status: number, payload: any, fallbackMessage: string) {
    super(payload?.message ?? fallbackMessage);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.code = payload?.code;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError ||
    (typeof error === "object" &&
      error !== null &&
      "payload" in error &&
      "status" in error)
  );
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export class ApiClient implements ApiTransport {
  readonly pages = new PageApi(this);
  readonly databases = new DatabaseApi(this);
  readonly semantic = new SemanticApi(this);
  readonly journals = new JournalApi(this);
  constructor(
    private baseUrl: string,
    private apiToken = "",
  ) {}

  /** Current local API origin, used by read-only BlockNote surfaces to rebind attachment URLs after restart. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  async health(): Promise<HealthInfo> {
    return this.get("/health");
  }

  async getAnalysisStatus(): Promise<AnalysisStatus> {
    return this.get("/analysis/status");
  }

  async syncAnalysisData(): Promise<AnalysisStatus> {
    return this.post("/analysis/sync", {});
  }

  async runAnalysisSql(
    sql: string,
    parameters: AnalysisParameter[] = [],
    namedResults: import("../../../shared/analysisTypes").AnalysisNamedResult[] = [],
    signal?: AbortSignal,
  ): Promise<AnalysisQueryResult> {
    return this.post(
      "/analysis/query",
      { sql, parameters, namedResults },
      signal,
    );
  }

  async runAnalysisPivot(
    pivot: import("../../../shared/analysisTypes").AnalysisPivotTransform,
    namedSource: import("../../../shared/analysisTypes").AnalysisNamedResult,
    signal?: AbortSignal,
  ): Promise<AnalysisQueryResult> {
    return this.post("/analysis/pivot", { pivot, namedSource }, signal);
  }

  async getAnalysisResultPage(
    resultId: string,
    page = 0,
    pageSize = 500,
    signal?: AbortSignal,
  ): Promise<AnalysisQueryResult> {
    return this.get(
      `/analysis/results/${encodeURIComponent(resultId)}?page=${page}&pageSize=${pageSize}`,
      signal ? { signal } : undefined,
    );
  }

  async getAnalysisResultAll(
    resultId: string,
    signal?: AbortSignal,
  ): Promise<AnalysisQueryResult> {
    return this.get(`/analysis/results/${encodeURIComponent(resultId)}/all`, {
      signal,
    });
  }
  async releaseAnalysisResult(
    resultId: string,
  ): Promise<{ released: boolean }> {
    return this.delete(`/analysis/results/${encodeURIComponent(resultId)}`);
  }

  async getAnalysisResultCacheStatus(): Promise<{
    entries: number;
    estimatedBytes: number;
    ttlMs: number;
    maxEntries: number;
    maxBytes: number;
  }> {
    return this.get("/analysis/results-cache/status");
  }

  async downloadAnalysisResultCsv(resultId: string): Promise<Blob> {
    const headers = new Headers();
    if (this.apiToken) headers.set("x-local-notion-token", this.apiToken);
    const res = await fetch(
      `${this.baseUrl}/analysis/results/${encodeURIComponent(resultId)}/export.csv`,
      { headers },
    );
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(res.status, payload, res.statusText);
    }
    return res.blob();
  }

  async generateAnalysisAiDraft(instruction: string): Promise<{
    ok: boolean;
    generated: boolean;
    message?: string;
    elapsedMs?: number;
    draft?: import("../../../shared/analysisTypes").AnalysisAiDraft;
  }> {
    return this.post("/analysis/ai-draft", { instruction });
  }

  async getAnalysisDataDictionary(): Promise<AnalysisDataDictionary> {
    return this.get("/analysis/data-dictionary");
  }

  async getAnalysisWorkspaceSettings(): Promise<AnalysisWorkspaceSettings> {
    return this.get("/analysis/settings");
  }

  async saveAnalysisWorkspaceSettings(
    settings: AnalysisWorkspaceSettings,
  ): Promise<AnalysisWorkspaceSettings> {
    return this.put("/analysis/settings", settings);
  }

  async listAnalysisNotebooks(): Promise<AnalysisNotebookSummary[]> {
    return this.get("/analysis/notebooks");
  }

  async getAnalysisNotebook(id: string): Promise<AnalysisNotebook> {
    return this.get(`/analysis/notebooks/${encodeURIComponent(id)}`);
  }

  async saveAnalysisNotebook(
    notebook: AnalysisNotebook,
  ): Promise<AnalysisNotebook> {
    return this.put(
      `/analysis/notebooks/${encodeURIComponent(notebook.id)}`,
      notebook,
    );
  }

  async deleteAnalysisNotebook(id: string): Promise<{ ok: true }> {
    return this.delete(`/analysis/notebooks/${encodeURIComponent(id)}`);
  }

  async listAnalysisDashboardPins(): Promise<
    import("../../../shared/analysisTypes").AnalysisDashboardPin[]
  > {
    return this.get("/analysis/dashboard");
  }

  async saveAnalysisDashboardPin(
    pin: import("../../../shared/analysisTypes").AnalysisDashboardPin,
  ): Promise<import("../../../shared/analysisTypes").AnalysisDashboardPin> {
    return this.put(`/analysis/dashboard/${encodeURIComponent(pin.id)}`, pin);
  }

  async deleteAnalysisDashboardPin(id: string): Promise<{ ok: true }> {
    return this.delete(`/analysis/dashboard/${encodeURIComponent(id)}`);
  }

  async listPages(): Promise<PageWithLock[]> {
    return this.get("/pages");
  }

  async listPageTree(): Promise<PageTreeNode[]> {
    return this.get("/pages/tree");
  }

  async getPage(id: string, signal?: AbortSignal): Promise<PageBundle> {
    return this.pages.get(id, signal);
  }

  async createPage(
    title: string,
    parentId: string | null = null,
    scope: WorkspaceScope = "shared",
  ): Promise<PageBundle> {
    return this.pages.create(title, parentId, scope);
  }

  async savePage(page: {
    id: string;
    title: string;
    markdown: string;
    blocksuite: unknown;
    baseUpdatedAt?: string;
    properties?: PageProperties;
    icon?: string | null;
    scope?: WorkspaceScope;
    historyReason?: "manual" | "auto_checkpoint" | "metadata_changed";
  }): Promise<PageBundle> {
    return this.put(`/pages/${page.id}`, page);
  }

  async searchPages(query: string): Promise<PageWithLock[]> {
    return this.get(`/pages/search?q=${encodeURIComponent(query)}`);
  }

  async listLocks(): Promise<LockInfo[]> {
    return this.get("/locks");
  }

  async duplicatePage(id: string): Promise<PageBundle> {
    return this.post(`/pages/${id}/duplicate`, {});
  }

  async trashPage(
    id: string,
  ): Promise<PageMeta & { affectedPageIds?: string[] }> {
    return this.delete(`/pages/${id}`);
  }

  async listTrash(): Promise<PageWithLock[]> {
    return this.get("/trash");
  }

  async restoreTrashedPage(
    id: string,
  ): Promise<PageMeta & { affectedPageIds?: string[] }> {
    return this.post(`/trash/${id}/restore`, {});
  }

  async deletePagePermanently(
    id: string,
  ): Promise<{ ok: true; deletedIds: string[] }> {
    return this.delete(`/trash/${id}/permanent`);
  }

  async emptyTrash(): Promise<{ ok: true; deletedIds: string[] }> {
    return this.delete("/trash");
  }

  async movePage(id: string, parentId: string | null): Promise<PageMeta> {
    return this.patch(`/pages/${id}/move`, { parentId });
  }

  async updatePageOrder(id: string, sortOrder: number): Promise<PageMeta> {
    return this.patch(`/pages/${id}/order`, { sortOrder });
  }

  async toggleFavorite(id: string): Promise<PageMeta> {
    return this.post(`/pages/${id}/favorite`, {});
  }

  async acquireLock(id: string): Promise<LockAcquireResult> {
    return this.post(`/pages/${id}/lock`, {});
  }

  async renewLock(id: string): Promise<LockAcquireResult> {
    return this.post(`/pages/${id}/lock/renew`, {});
  }

  async releaseLock(id: string) {
    return this.delete(`/pages/${id}/lock`);
  }

  async importFromShared() {
    return this.post("/sync/import", {});
  }

  async listAttachments(pageId: string): Promise<AttachmentInfo[]> {
    return this.get(`/pages/${pageId}/attachments`);
  }

  async addAttachment(
    pageId: string,
    sourcePath: string,
  ): Promise<AttachmentInfo> {
    return this.post(`/pages/${pageId}/attachments`, { sourcePath });
  }

  attachmentFileUrl(pageId: string, attachmentId: string): string {
    return `${this.baseUrl}/pages/${encodeURIComponent(pageId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
  }

  attachmentPrettyFileUrl(
    pageId: string,
    attachmentId: string,
    fileName: string,
  ): string {
    // BlockNote標準のファイルブロックはURLからファイル名/拡張子を表示・判定するため、
    // 末尾に元ファイル名を含むURLを返す。実ファイルはattachmentIdで解決する。
    return `${this.baseUrl}/pages/${encodeURIComponent(pageId)}/attachments/${encodeURIComponent(attachmentId)}/name/${encodeURIComponent(fileName || "attachment")}`;
  }

  attachmentDownloadUrl(pageId: string, attachmentId: string): string {
    return `${this.baseUrl}/pages/${encodeURIComponent(pageId)}/attachments/${encodeURIComponent(attachmentId)}/download`;
  }

  async uploadAttachmentFile(pageId: string, file: File): Promise<string> {
    if (!isBase64AttachmentWithinLimit(file.size)) {
      throw new Error(
        base64AttachmentLimitMessage(file.name || "このファイル"),
      );
    }
    const base64 = await fileToBase64(file);
    const info: AttachmentInfo = await this.post(
      `/pages/${pageId}/attachments/upload`,
      {
        fileName: file.name,
        base64,
      },
    );
    return this.attachmentPrettyFileUrl(
      pageId,
      info.id,
      info.fileName || file.name,
    );
  }

  async listDatabaseRowAttachments(
    databaseId: string,
    rowId: string,
    scope: "shared" | "private" = "shared",
  ): Promise<AttachmentInfo[]> {
    const params = scope === "private" ? "?scope=private" : "";
    return this.get(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/attachments${params}`,
    );
  }

  databaseRowAttachmentPrettyFileUrl(
    databaseId: string,
    rowId: string,
    attachmentId: string,
    fileName: string,
    scope: "shared" | "private" = "shared",
  ): string {
    const params = scope === "private" ? "?scope=private" : "";
    return `${this.baseUrl}/databases/${encodeURIComponent(databaseId)}/rows/${encodeURIComponent(rowId)}/attachments/${encodeURIComponent(attachmentId)}/name/${encodeURIComponent(fileName || "attachment")}${params}`;
  }

  async uploadDatabaseRowAttachmentFile(
    databaseId: string,
    rowId: string,
    file: File,
    scope: "shared" | "private" = "shared",
  ): Promise<string> {
    if (!isBase64AttachmentWithinLimit(file.size))
      throw new Error(
        base64AttachmentLimitMessage(file.name || "このファイル"),
      );
    const base64 = await fileToBase64(file);
    const info: AttachmentInfo = await this.post(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/attachments/upload`,
      { fileName: file.name, base64, scope },
    );
    return this.databaseRowAttachmentPrettyFileUrl(
      databaseId,
      rowId,
      info.id,
      info.fileName || file.name,
      scope,
    );
  }

  async getWorkspaceTagAliases(): Promise<{
    revision: number;
    aliases: Record<string, string[]>;
  }> {
    return this.get("/workspace/tag-aliases");
  }

  async saveWorkspaceTagAliases(input: {
    aliases: Record<string, string[]>;
    baseAliases?: Record<string, string[]>;
    baseRevision?: number;
  }): Promise<{
    revision: number;
    aliases: Record<string, string[]>;
    conflictTags: string[];
    merged: boolean;
  }> {
    return this.put("/workspace/tag-aliases", input);
  }

  async getWorkspaceGlossaryInsight(termId: string): Promise<GlossaryTermInsight> {
    return this.get(`/workspace/glossary/${encodeURIComponent(termId)}/insight`);
  }

  async getWorkspaceGlossaryCandidates(): Promise<{ candidates: GlossaryCandidate[] }> {
    return this.post("/workspace/glossary/candidates", {});
  }

  async getWorkspaceGlossary(): Promise<{
    revision: number;
    terms: GlossaryTerm[];
  }> {
    return this.get("/workspace/glossary");
  }

  async saveWorkspaceGlossary(input: {
    terms: GlossaryTerm[];
    baseTerms?: GlossaryTerm[];
    baseRevision?: number;
  }): Promise<{ revision: number; terms: GlossaryTerm[]; merged: boolean }> {
    return this.put("/workspace/glossary", input);
  }

  async getWorkspaceTagPresentation(): Promise<{
    revision: number;
    settings: Record<string, { group?: string; color?: string }>;
  }> {
    return this.get("/workspace/tag-presentation");
  }

  async saveWorkspaceTagPresentation(
    settings: Record<string, { group?: string; color?: string }>,
  ): Promise<{
    revision: number;
    settings: Record<string, { group?: string; color?: string }>;
  }> {
    return this.put("/workspace/tag-presentation", { settings });
  }

  async listHistory(pageId: string): Promise<HistoryEntry[]> {
    return this.get(`/pages/${pageId}/history`);
  }

  async getLocalKnowledgeGraph(
    pageId: string,
    maxNodes = 80,
  ): Promise<KnowledgeGraphResult> {
    return this.get(
      `/pages/${encodeURIComponent(pageId)}/knowledge-graph?maxNodes=${Math.max(20, Math.min(120, Math.floor(maxNodes)))}`,
    );
  }

  async getGlobalKnowledgeGraph(
    maxNodes = 320,
    expansion: "pages" | "database_rows" | "attachments" | "journals" = "pages",
  ): Promise<KnowledgeGraphResult> {
    return this.get(
      `/knowledge-graph?maxNodes=${Math.max(60, Math.min(500, Math.floor(maxNodes)))}&expansion=${encodeURIComponent(expansion)}`,
    );
  }

  async listBacklinks(pageId: string): Promise<BacklinkInfo[]> {
    return this.get(`/pages/${encodeURIComponent(pageId)}/backlinks`);
  }

  async getPageSidebarCounts(pageId: string): Promise<PageSidebarCounts> {
    return this.get(`/pages/${encodeURIComponent(pageId)}/sidebar-counts`);
  }

  async listPageComments(pageId: string): Promise<PageComment[]> {
    return this.get(`/pages/${encodeURIComponent(pageId)}/comments`);
  }

  async addPageComment(
    pageId: string,
    input: string | { body: string; blockId?: string; blockPreview?: string },
  ): Promise<PageComment[]> {
    const payload = typeof input === "string" ? { body: input } : input;
    return this.post(`/pages/${encodeURIComponent(pageId)}/comments`, payload);
  }

  async listPageActivity(pageId: string): Promise<PageActivityItem[]> {
    return this.get(`/pages/${encodeURIComponent(pageId)}/activity`);
  }

  async updatePageComment(
    pageId: string,
    commentId: string,
    patch: Partial<Pick<PageComment, "body" | "resolved">>,
  ): Promise<PageComment[]> {
    return this.patch(
      `/pages/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`,
      patch,
    );
  }

  async deletePageComment(
    pageId: string,
    commentId: string,
  ): Promise<PageComment[]> {
    return this.delete(
      `/pages/${encodeURIComponent(pageId)}/comments/${encodeURIComponent(commentId)}`,
    );
  }

  async getHistoryBundle(
    pageId: string,
    historyId: string,
  ): Promise<PageBundle> {
    return this.get(`/pages/${pageId}/history/${historyId}`);
  }

  async diffHistory(
    pageId: string,
    historyId: string,
  ): Promise<HistoryDiffResult> {
    return this.get(`/pages/${pageId}/history/${historyId}/diff`);
  }

  async listWikiUpdates(limit = 12): Promise<WikiUpdateDigest[]> {
    return this.get(
      `/wiki/updates?limit=${Math.max(1, Math.min(30, Number(limit) || 12))}`,
    );
  }

  async restoreHistory(pageId: string, historyId: string): Promise<PageBundle> {
    return this.post(`/pages/${pageId}/history/${historyId}/restore`, {});
  }

  async listConflicts(pageId?: string): Promise<ConflictInfo[]> {
    return this.get(
      `/conflicts${pageId ? `?pageId=${encodeURIComponent(pageId)}` : ""}`,
    );
  }

  async listBackups(): Promise<any[]> {
    return this.get("/backups");
  }

  async restoreBackup(
    id: string,
  ): Promise<{ ok: true; id: string; type: string }> {
    return this.post(`/backups/${encodeURIComponent(id)}/restore`, {});
  }

  async listInboxItems(): Promise<InboxItem[]> {
    return this.get("/inbox");
  }

  async getDashboard(): Promise<any> {
    return this.get("/dashboard");
  }

  async getUiDisplayCacheStatus(): Promise<any> {
    return this.get("/ui-cache/status");
  }

  async rebuildUiDisplayCache(): Promise<any> {
    return this.post("/ui-cache/rebuild", {});
  }

  async getWorkspaceDerivedIndexStatus(): Promise<any> {
    return this.get("/workspace-derived-index/status");
  }

  async rebuildWorkspaceDerivedIndex(): Promise<any> {
    return this.post("/workspace-derived-index/rebuild", {});
  }

  async getWorkspaceSummaryIndexStatus(): Promise<any> {
    return this.get("/workspace-summary-index/status");
  }

  async rebuildWorkspaceSummaryIndex(): Promise<any> {
    return this.post("/workspace-summary-index/rebuild", {});
  }

  async getDatabaseIndexStatus(): Promise<any> {
    return this.get("/database-index/status");
  }

  async rebuildDatabaseIndexAll(): Promise<any> {
    return this.post("/database-index/rebuild", {});
  }

  async listAllAttachments(): Promise<any[]> {
    return this.get("/attachments");
  }

  async getAttachmentIndexRebuildStatus(): Promise<any> {
    return this.get("/attachments/index-rebuild/status");
  }

  async startAttachmentIndexRebuild(): Promise<any> {
    return this.post("/attachments/index-rebuild", {});
  }

  async cancelAttachmentIndexRebuild(): Promise<any> {
    return this.post("/attachments/index-rebuild/cancel", {});
  }

  async listBrokenLinks(): Promise<any[]> {
    return this.get("/links/broken");
  }

  async listTasks(): Promise<TaskItem[]> {
    return this.get("/tasks");
  }

  async updateTask(
    taskId: string,
    patch: { completed?: boolean; dueDate?: string | null },
  ): Promise<TaskItem[]> {
    return this.patch(`/tasks/${encodeURIComponent(taskId)}`, patch);
  }

  async createInboxItem(
    text: string,
    title?: string,
    source: InboxItem["source"] = "quick",
  ): Promise<InboxItem> {
    const safeText = String(text ?? "").trim();
    const safeTitle =
      String(title ?? safeText.split(/\r?\n/).find(Boolean) ?? "Quick memo")
        .trim()
        .slice(0, 80) || "Quick memo";
    return this.post("/inbox", { text: safeText, title: safeTitle, source });
  }

  async updateInboxItem(
    id: string,
    patch: Partial<InboxItem>,
  ): Promise<InboxItem> {
    return this.patch(`/inbox/${encodeURIComponent(id)}`, patch);
  }

  async deleteInboxItem(id: string): Promise<{ ok: true; id: string }> {
    return this.delete(`/inbox/${encodeURIComponent(id)}`);
  }

  inboxAttachmentFileUrl(inboxId: string, attachmentId: string): string {
    return `${this.baseUrl}/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
  }

  inboxAttachmentDownloadUrl(inboxId: string, attachmentId: string): string {
    return `${this.baseUrl}/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/download`;
  }

  async runInboxAttachmentOcr(
    inboxId: string,
    attachmentId: string,
    options: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    } = {},
  ): Promise<InboxItem> {
    return this.post(
      `/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/ocr`,
      options,
    );
  }

  async enqueueInboxAttachmentOcr(
    inboxId: string,
    attachmentId: string,
    options: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    } = {},
  ): Promise<InboxItem> {
    return this.post(
      `/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/ocr/queue`,
      options,
    );
  }

  async cancelInboxAttachmentOcrQueue(
    inboxId: string,
    attachmentId: string,
  ): Promise<InboxItem> {
    return this.post(
      `/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/ocr/cancel`,
      {},
    );
  }

  async retryInboxAttachmentOcrQueue(
    inboxId: string,
    attachmentId: string,
  ): Promise<InboxItem> {
    return this.post(
      `/inbox/${encodeURIComponent(inboxId)}/attachments/${encodeURIComponent(attachmentId)}/ocr/retry`,
      {},
    );
  }

  async sendAttachmentToOcrCenter(input: {
    sourceType: "page" | "journal" | "database-row";
    attachmentId: string;
    pageId?: string;
    date?: string;
    databaseId?: string;
    rowId?: string;
    scope?: WorkspaceScope;
    sourceTitle?: string;
  }): Promise<InboxItem> {
    return this.post("/ocr-center/import-attachment", input);
  }

  async uploadInboxAttachmentFile(
    inboxId: string,
    file: File,
  ): Promise<InboxItem> {
    if (!isBase64AttachmentWithinLimit(file.size)) {
      throw new Error(
        base64AttachmentLimitMessage(file.name || "このファイル"),
      );
    }
    const base64 = await fileToBase64(file);
    return this.post(
      `/inbox/${encodeURIComponent(inboxId)}/attachments/upload`,
      {
        fileName: file.name,
        base64,
        mimeType: file.type || undefined,
      },
    );
  }

  async askSmartAssist(
    message: string,
    debug = false,
    context: any[] = [],
    useContext = false,
  ): Promise<any> {
    return this.post("/smart-assist/chat/ask", {
      message,
      debug,
      context: useContext ? context : [],
      useContext,
    });
  }

  async deleteSmartAssistChatLogs(): Promise<any> {
    return this.delete("/smart-assist/chat/logs");
  }

  async listSmartFaqRecords(): Promise<any[]> {
    return this.get("/smart-assist/faqs");
  }

  async querySmartFaqRecords(
    options: {
      q?: string;
      status?: string;
      category?: string;
      pdf?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<any> {
    const qs = new URLSearchParams();
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== "")
        qs.set(key, String(value));
    });
    return this.get(
      `/smart-assist/faqs/query${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async getSmartFaqSearchStats(): Promise<any> {
    return this.get("/smart-assist/faqs/search-stats");
  }

  async getGenerationSettings(): Promise<any> {
    return this.get("/smart-assist/generation-settings");
  }

  async saveGenerationSettings(settings: any): Promise<any> {
    return this.post("/smart-assist/generation-settings", settings);
  }

  async checkGenerationEngine(): Promise<any> {
    return this.get("/smart-assist/generation-check");
  }

  async testGenerationEngine(): Promise<any> {
    return this.post("/smart-assist/generation-test", {});
  }

  async getGenerationServerStatus(): Promise<any> {
    return this.get("/smart-assist/generation-server/status");
  }

  async startGenerationServer(options: any = {}): Promise<any> {
    return this.post("/smart-assist/generation-server/start", options || {});
  }

  async stopGenerationServer(): Promise<any> {
    return this.post("/smart-assist/generation-server/stop", {});
  }

  async generateFaqImprovementDraft(record: any): Promise<any> {
    return this.post("/smart-assist/faqs/improve-draft", { record });
  }

  async getTransformerRuntimeInfo(): Promise<any> {
    return this.get("/smart-assist/transformer-runtime");
  }

  async getSemanticCacheInfo(): Promise<any> {
    return this.get("/smart-assist/semantic-cache");
  }

  async getCacheTopology(): Promise<any> {
    return this.get("/smart-assist/cache-topology");
  }

  async clearSemanticQueryCache(): Promise<any> {
    return this.post("/smart-assist/semantic-cache/clear-query", {});
  }

  async getTransformerSettings(): Promise<any> {
    return this.get("/smart-assist/transformer-settings");
  }

  async saveTransformerSettings(settings: any): Promise<any> {
    return this.post("/smart-assist/transformer-settings", settings);
  }

  async checkTransformerModel(): Promise<any> {
    return this.get("/smart-assist/transformer-model-check");
  }

  async downloadTransformerModel(settings: any): Promise<any> {
    return this.post("/smart-assist/transformer-model-download", settings);
  }

  async rebuildSmartFaqIndex(): Promise<any> {
    return this.post("/smart-assist/faqs/reindex", {});
  }

  // Backward-compatible endpoint name. The server now rebuilds the Transformers.js semantic index, not node-nlp.
  async retrainSmartAssistNlp(): Promise<any> {
    return this.post("/smart-assist/nlp/retrain", {});
  }

  async listSmartAssistChatLogs(): Promise<any[]> {
    return this.get("/smart-assist/chat/logs");
  }

  async listLowConfidenceSmartAssistLogs(): Promise<any[]> {
    return this.get("/smart-assist/chat/low-confidence");
  }

  async testSmartFaqRecord(
    faqId: string,
    questions: string[] = [],
  ): Promise<any> {
    return this.post("/smart-assist/faq/test", { faqId, questions });
  }

  async listSmartAssistSynonyms(): Promise<any[]> {
    return this.get("/smart-assist/synonyms");
  }

  async saveSmartAssistSynonyms(items: any[]): Promise<any[]> {
    return this.put("/smart-assist/synonyms", items);
  }

  async upsertSmartAssistSynonym(item: any): Promise<any[]> {
    return this.post("/smart-assist/synonyms", item);
  }

  async deleteSmartAssistSynonym(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    const query = baseUpdatedAt
      ? `?baseUpdatedAt=${encodeURIComponent(baseUpdatedAt)}`
      : "";
    return this.delete(
      `/smart-assist/synonyms/${encodeURIComponent(id)}${query}`,
    );
  }

  async listSmartAssistRuleProfiles(): Promise<any[]> {
    return this.get("/smart-assist/rule-profiles");
  }

  async saveSmartAssistRuleProfiles(items: any[]): Promise<any[]> {
    return this.put("/smart-assist/rule-profiles", items);
  }

  async upsertSmartAssistRuleProfile(item: any): Promise<any[]> {
    return this.post("/smart-assist/rule-profiles", item);
  }

  async deleteSmartAssistRuleProfile(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    const query = baseUpdatedAt
      ? `?baseUpdatedAt=${encodeURIComponent(baseUpdatedAt)}`
      : "";
    return this.delete(
      `/smart-assist/rule-profiles/${encodeURIComponent(id)}${query}`,
    );
  }

  async saveSmartFaqRecords(records: any[]): Promise<any[]> {
    return this.put("/smart-assist/faqs", records);
  }

  async upsertSmartFaqRecord(record: any): Promise<any[]> {
    return this.post("/smart-assist/faqs", record);
  }

  async deleteSmartFaqRecord(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    const query = baseUpdatedAt
      ? `?baseUpdatedAt=${encodeURIComponent(baseUpdatedAt)}`
      : "";
    return this.delete(`/smart-assist/faqs/${encodeURIComponent(id)}${query}`);
  }

  async listSmartAssistImprovementQueue(): Promise<any[]> {
    return this.get("/smart-assist/improvement-queue");
  }

  async addSmartAssistImprovementQueue(item: any): Promise<any[]> {
    return this.post("/smart-assist/improvement-queue", item);
  }

  async updateSmartAssistImprovementQueue(
    id: string,
    item: any,
  ): Promise<any[]> {
    return this.put(
      `/smart-assist/improvement-queue/${encodeURIComponent(id)}`,
      item,
    );
  }

  async deleteSmartAssistImprovementQueue(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    const query = baseUpdatedAt
      ? `?baseUpdatedAt=${encodeURIComponent(baseUpdatedAt)}`
      : "";
    return this.delete(
      `/smart-assist/improvement-queue/${encodeURIComponent(id)}${query}`,
    );
  }

  async listSmartAssistEvaluationSet(): Promise<any[]> {
    return this.get("/smart-assist/evaluation-set");
  }

  async saveSmartAssistEvaluationSet(items: any[]): Promise<any[]> {
    return this.put("/smart-assist/evaluation-set", items);
  }

  async upsertSmartAssistEvaluationEntry(item: any): Promise<any[]> {
    return this.post("/smart-assist/evaluation-set", item);
  }

  async deleteSmartAssistEvaluationEntry(
    id: string,
    baseUpdatedAt?: string,
  ): Promise<any[]> {
    const query = baseUpdatedAt
      ? `?baseUpdatedAt=${encodeURIComponent(baseUpdatedAt)}`
      : "";
    return this.delete(
      `/smart-assist/evaluation-set/${encodeURIComponent(id)}${query}`,
    );
  }

  async runSmartAssistEvaluationSet(): Promise<any> {
    return this.post("/smart-assist/evaluation-set/run", {});
  }

  async listSmartAssistEvaluationReports(limit = 20): Promise<any[]> {
    return this.get(
      `/smart-assist/evaluation-reports?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async listSmartAssistQueryNormalizationRules(): Promise<any> {
    return this.get("/smart-assist/query-normalization");
  }

  async saveSmartAssistQueryNormalizationRules(payload: any): Promise<any> {
    return this.put("/smart-assist/query-normalization", payload);
  }

  async listSmartAssistFallbackContacts(): Promise<any> {
    return this.get("/smart-assist/fallback-contacts");
  }

  async saveSmartAssistFallbackContacts(payload: any): Promise<any> {
    return this.put("/smart-assist/fallback-contacts", payload);
  }

  async listSmartAssistFeedback(): Promise<any[]> {
    return this.get("/smart-assist/feedback");
  }

  async saveSmartAssistFeedback(items: any[]): Promise<any[]> {
    return this.put("/smart-assist/feedback", items);
  }

  async addSmartAssistFeedback(item: any): Promise<any[]> {
    return this.post("/smart-assist/feedback", item);
  }

  async listJournals(month?: string): Promise<JournalSummary[]> {
    return this.get(
      `/journals${month ? `?month=${encodeURIComponent(month)}` : ""}`,
    );
  }

  async searchJournals(query: string, limit = 30): Promise<JournalSummary[]> {
    return this.get(
      `/journals/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async getJournal(date: string): Promise<JournalEntry> {
    return this.get(`/journals/${encodeURIComponent(date)}`);
  }

  async saveJournal(
    journal: JournalEntry,
    options?: { force?: boolean },
  ): Promise<JournalEntry> {
    return this.put(`/journals/${encodeURIComponent(journal.date)}`, {
      ...journal,
      baseUpdatedAt: journal.updatedAt,
      force: Boolean(options?.force),
    });
  }

  async deleteJournal(date: string): Promise<{ ok: true; date: string }> {
    return this.delete(`/journals/${encodeURIComponent(date)}`);
  }

  async listJournalAttachments(date: string): Promise<AttachmentInfo[]> {
    return this.get(`/journals/${encodeURIComponent(date)}/attachments`);
  }

  async addJournalAttachment(
    date: string,
    sourcePath: string,
  ): Promise<AttachmentInfo> {
    return this.post(`/journals/${encodeURIComponent(date)}/attachments`, {
      sourcePath,
    });
  }

  journalAttachmentPrettyFileUrl(
    date: string,
    attachmentId: string,
    fileName: string,
  ): string {
    return `${this.baseUrl}/journals/${encodeURIComponent(date)}/attachments/${encodeURIComponent(attachmentId)}/name/${encodeURIComponent(fileName || "attachment")}`;
  }

  journalAttachmentFileUrl(date: string, attachmentId: string): string {
    return `${this.baseUrl}/journals/${encodeURIComponent(date)}/attachments/${encodeURIComponent(attachmentId)}/file`;
  }

  journalAttachmentDownloadUrl(date: string, attachmentId: string): string {
    return `${this.baseUrl}/journals/${encodeURIComponent(date)}/attachments/${encodeURIComponent(attachmentId)}/download`;
  }

  async uploadJournalAttachmentFile(date: string, file: File): Promise<string> {
    if (!isBase64AttachmentWithinLimit(file.size)) {
      throw new Error(
        base64AttachmentLimitMessage(file.name || "このファイル"),
      );
    }
    const base64 = await fileToBase64(file);
    const info: AttachmentInfo = await this.post(
      `/journals/${encodeURIComponent(date)}/attachments/upload`,
      { fileName: file.name, base64 },
    );
    return this.journalAttachmentPrettyFileUrl(
      date,
      info.id,
      info.fileName || file.name,
    );
  }

  async listDatabases(): Promise<WorkspaceDatabase[]> {
    return this.get("/databases");
  }

  async createDatabase(
    title: string,
    scope: WorkspaceScope = "shared",
  ): Promise<WorkspaceDatabase> {
    return this.post("/databases", { title, scope });
  }

  async getDatabase(id: string): Promise<WorkspaceDatabase> {
    return this.get(`/databases/${id}`);
  }

  async queryDatabaseRows(
    id: string,
    params: {
      viewId?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<DatabaseQueryResult> {
    const qs = new URLSearchParams();
    if (params.viewId) qs.set("viewId", params.viewId);
    if (params.q) qs.set("q", params.q);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    return this.get(
      `/databases/${id}/query${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async aggregateDatabaseRows(
    id: string,
    input: DatabaseAggregateRequest,
  ): Promise<DatabaseAggregateResult> {
    return this.post(`/databases/${id}/aggregates`, input);
  }

  async getDatabasePerformance(id: string): Promise<DatabasePerformanceInfo> {
    return this.get(`/databases/${id}/performance`);
  }

  async rebuildDatabaseIndex(id: string): Promise<DatabasePerformanceInfo> {
    return this.post(`/databases/${id}/reindex`, {});
  }

  async acquireDatabaseLock(id: string): Promise<DatabaseLockAcquireResult> {
    return this.post(`/databases/${id}/lock`, {});
  }

  async renewDatabaseLock(id: string): Promise<DatabaseLockAcquireResult> {
    return this.post(`/databases/${id}/lock/renew`, {});
  }

  async releaseDatabaseLock(id: string): Promise<{ ok: true }> {
    return this.delete(`/databases/${id}/lock`);
  }

  async saveDatabase(database: WorkspaceDatabase): Promise<WorkspaceDatabase> {
    return this.put(`/databases/${database.id}`, database);
  }

  async patchDatabaseRows(
    databaseId: string,
    input: { baseUpdatedAt?: string; patches: DatabaseRowPatch[] },
  ): Promise<DatabaseRowPatchResult> {
    return this.patch(`/databases/${this.pathId(databaseId)}/rows`, input);
  }

  async deleteDatabase(id: string): Promise<{ ok: true; id: string }> {
    return this.delete(`/databases/${id}`);
  }

  async listTrashedDatabases(): Promise<WorkspaceDatabase[]> {
    return this.get("/databases-trash");
  }

  async restoreTrashedDatabase(id: string): Promise<WorkspaceDatabase> {
    return this.post(`/databases-trash/${id}/restore`, {});
  }

  async deleteTrashedDatabase(
    id: string,
  ): Promise<{ ok: true; id: string; deletedRowIds: string[] }> {
    return this.delete(`/databases-trash/${id}`);
  }

  async emptyTrashedDatabases(): Promise<{
    ok: true;
    deletedIds: string[];
    failedIds: string[];
  }> {
    return this.delete("/databases-trash");
  }

  async addDatabaseRow(id: string): Promise<WorkspaceDatabase> {
    return this.post(`/databases/${id}/rows`, {});
  }

  async createDatabaseRows(
    id: string,
    input: { baseUpdatedAt?: string; rows?: DatabaseRowsCreateRequest[] },
  ): Promise<DatabaseRowsCreateResult> {
    return this.post(`/databases/${this.pathId(id)}/rows/batch`, input);
  }

  async deleteDatabaseRows(
    id: string,
    input: { baseUpdatedAt?: string; rowIds: string[] },
  ): Promise<DatabaseRowsDeleteResult> {
    return this.post(`/databases/${this.pathId(id)}/rows/delete`, input);
  }

  public pathId(value: string): string {
    return encodeURIComponent(value);
  }

  async getDatabaseRowContent(
    databaseId: string,
    rowId: string,
    params: { title?: string; scope?: WorkspaceScope } = {},
  ): Promise<DatabaseRowContent> {
    const qs = new URLSearchParams();
    if (params.title) qs.set("title", params.title);
    if (params.scope) qs.set("scope", params.scope);
    return this.get(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/content${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async saveDatabaseRowContent(
    input: SaveDatabaseRowContentInput,
  ): Promise<DatabaseRowContent> {
    return this.put(
      `/databases/${this.pathId(input.databaseId)}/rows/${this.pathId(input.rowId)}/content`,
      input,
    );
  }

  async listDatabaseSidebarRows(
    databaseId: string,
    params: { limit?: number; offset?: number } = {},
  ): Promise<DatabaseSidebarRowsResult> {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    return this.get(
      `/databases/${this.pathId(databaseId)}/sidebar-rows${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async listDatabaseRowSidebarChildren(
    databaseId: string,
    rowId: string,
  ): Promise<DatabaseSidebarChildPagesResult> {
    return this.get(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/sidebar-children`,
    );
  }

  async listWorkspaceDatabaseChildPages(): Promise<
    Array<{
      databaseId: string;
      rowId: string;
      databaseTitle: string;
      rowTitle: string;
      page: PageWithLock;
    }>
  > {
    return this.get("/workspace/database-child-pages");
  }

  async listDatabaseRowLinks(
    databaseId: string,
    rowId: string,
    params: { scope?: WorkspaceScope } = {},
  ): Promise<{
    childPages: PageWithLock[];
    outboundLinks: ResourceLinkInfo[];
    backlinks: ResourceLinkInfo[];
  }> {
    const qs = new URLSearchParams();
    if (params.scope) qs.set("scope", params.scope);
    return this.get(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/links${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async createDatabaseRowChildPage(
    databaseId: string,
    rowId: string,
    input: { title?: string; scope?: WorkspaceScope } = {},
  ): Promise<PageBundle> {
    return this.post(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/child-pages`,
      input,
    );
  }

  async deleteDatabaseRowChildPage(
    databaseId: string,
    rowId: string,
    pageId: string,
    options: { trashPage?: boolean } = {},
  ): Promise<{
    ok: true;
    databaseId: string;
    rowId: string;
    pageId: string;
    trashed: boolean;
    links: {
      childPages: PageWithLock[];
      outboundLinks: ResourceLinkInfo[];
      backlinks: ResourceLinkInfo[];
    };
  }> {
    const qs = new URLSearchParams();
    if (options.trashPage === false) qs.set("trashPage", "false");
    return this.delete(
      `/databases/${this.pathId(databaseId)}/rows/${this.pathId(rowId)}/child-pages/${this.pathId(pageId)}${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  }

  async getWorkspaceSemanticIndexInfo(): Promise<any> {
    return this.get("/semantic/index");
  }

  async getWorkspaceSemanticIndexRevision(): Promise<{
    ok: boolean;
    revision: string | null;
    indexedCount: number;
    available: boolean;
    generatedAt: string | null;
    warming?: boolean;
  }> {
    return this.get("/semantic/index-revision");
  }

  async getWorkspaceSemanticRecoveryBackups(): Promise<any[]> {
    return this.get("/semantic/recovery-backups");
  }

  async createWorkspaceSemanticRecoveryBackup(reason = "manual"): Promise<any> {
    return this.post("/semantic/recovery-backups", { reason });
  }

  async resetWorkspaceSemanticLocalCache(): Promise<any> {
    return this.post("/semantic/cache-reset", {});
  }

  async maintainWorkspaceSemanticCache(
    options: { vacuum?: boolean } = {},
  ): Promise<any> {
    return this.post("/semantic/cache-maintenance", {
      vacuum: options.vacuum === true,
    });
  }

  async rebuildWorkspaceSemanticIndex(
    options: { mode?: "full" | "diff"; maxNewEmbeddings?: number } = {},
  ): Promise<any> {
    return this.post("/semantic/reindex", options);
  }

  async getWorkspaceSemanticRebuildJob(): Promise<any> {
    return this.get("/semantic/rebuild-job");
  }

  async startWorkspaceSemanticRebuildJob(
    options: { mode?: "full" | "diff"; maxNewEmbeddings?: number } = {},
  ): Promise<any> {
    return this.post("/semantic/rebuild-job", options);
  }

  async controlWorkspaceSemanticRebuildJob(
    action: "pause" | "resume" | "cancel",
  ): Promise<any> {
    return this.post("/semantic/rebuild-job/control", { action });
  }

  async diffUpdateWorkspaceSemanticIndex(
    limit = 20,
    options: {
      preferredChunkIds?: string[];
      background?: boolean;
      targets?: Array<{
        type: "page" | "database_row" | "journal";
        sourceId: string;
        databaseId?: string;
      }>;
    } = {},
  ): Promise<any> {
    return this.post("/semantic/diff-update", {
      limit,
      preferredChunkIds: Array.from(
        new Set((options.preferredChunkIds || []).map(String).filter(Boolean)),
      ).slice(0, 100),
      targets: (options.targets || [])
        .map((target) => ({
          type: target.type,
          sourceId: String(target.sourceId || ""),
          databaseId: target.databaseId ? String(target.databaseId) : undefined,
        }))
        .filter((target) => target.sourceId)
        .slice(0, 100),
      background: options.background === true,
    });
  }

  async reindexWorkspaceSemanticSource(
    sourceId: string,
    type?: string,
    databaseId?: string,
  ): Promise<any> {
    return this.post("/semantic/reindex-source", {
      sourceId: String(sourceId || ""),
      type: type ? String(type) : undefined,
      databaseId: databaseId ? String(databaseId) : undefined,
    });
  }

  async noteSemanticEditorActivity(
    holdMs = 10_000,
  ): Promise<{ ok: boolean; pausedUntil?: string }> {
    return this.post("/semantic/editor-activity", {
      holdMs: Math.max(2_000, Math.min(60_000, Number(holdMs) || 10_000)),
    });
  }

  async getWorkspaceSemanticUpdateHistory(limit = 20): Promise<any[]> {
    return this.get(
      `/semantic/history?limit=${encodeURIComponent(String(limit))}`,
    );
  }

  async generateWorkspaceAiChatAnswer(input: any): Promise<any> {
    return this.post("/semantic/chat-answer", input);
  }

  async generateWorkspaceAiChatAnswerStream(
    input: any,
    onEvent: (event: any) => void,
  ): Promise<void> {
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    });
    if (this.apiToken) headers.set("x-local-notion-token", this.apiToken);
    const res = await fetch(`${this.baseUrl}/semantic/chat-answer/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    if (!res.ok || !res.body) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(
        res.status,
        payload,
        res.statusText || "AI stream failed",
      );
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* ignore malformed keepalive */
        }
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      try {
        onEvent(JSON.parse(pending));
      } catch {}
    }
  }

  /**
   * Editor-only generation intentionally bypasses workspace retrieval.
   * It receives only the selected/current text and must return replacement text.
   */
  async generateEditorAiEdit(input: {
    operation: "summary" | "rewrite" | "bullets" | "todo" | "custom";
    instruction?: string;
    text: string;
  }): Promise<any> {
    return this.post("/editor-ai/edit", input);
  }

  async searchWorkspaceSemantic(
    query: string,
    params: { limit?: number; types?: string[] } = {},
  ): Promise<any> {
    const qs = new URLSearchParams();
    qs.set("q", query);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.types?.length) qs.set("types", params.types.join(","));
    return this.get(`/semantic/search?${qs.toString()}`);
  }

  async getRelatedForPage(pageId: string, limit = 32): Promise<any> {
    return this.get(
      `/semantic/related/page/${this.pathId(pageId)}?limit=${limit}`,
    );
  }

  async getRelatedForDraft(input: {
    pageId: string;
    title: string;
    text: string;
    tags?: string[];
    limit?: number;
  }): Promise<any> {
    return this.post("/semantic/related/draft", {
      pageId: String(input.pageId || ""),
      title: String(input.title || ""),
      text: String(input.text || ""),
      tags: Array.isArray(input.tags)
        ? input.tags.map(String).slice(0, 40)
        : [],
      limit: Math.max(1, Math.min(8, Number(input.limit || 5))),
    });
  }

  async getRelatedForDatabaseRow(
    databaseId: string,
    rowId: string,
    limit = 32,
  ): Promise<any> {
    return this.get(
      `/semantic/related/database/${this.pathId(databaseId)}/row/${this.pathId(rowId)}?limit=${limit}`,
    );
  }

  async getRelatedForJournal(date: string, limit = 32): Promise<any> {
    return this.get(
      `/semantic/related/journal/${this.pathId(date)}?limit=${limit}`,
    );
  }

  async getRelatedForFaq(faqId: string, limit = 32): Promise<any> {
    return this.get(
      `/semantic/related/faq/${this.pathId(faqId)}?limit=${limit}`,
    );
  }

  async addDatabaseProperty(
    id: string,
    name: string,
    type: DatabasePropertyType,
  ): Promise<WorkspaceDatabase> {
    return this.post(`/databases/${id}/properties`, { name, type });
  }

  /** Feature API transport surface. Existing method names remain as compatibility facades. */
  public getJson<T = any>(path: string, init?: RequestInit): Promise<T> {
    return this.get(path, init) as Promise<T>;
  }
  public postJson<T = any>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.post(path, body, signal) as Promise<T>;
  }
  public putJson<T = any>(path: string, body: unknown): Promise<T> {
    return this.put(path, body) as Promise<T>;
  }
  public patchJson<T = any>(path: string, body: unknown): Promise<T> {
    return this.patch(path, body) as Promise<T>;
  }
  public deleteJson<T = any>(path: string): Promise<T> {
    return this.delete(path) as Promise<T>;
  }

  private async get(path: string, init?: RequestInit) {
    return this.request(path, init);
  }
  private async post(path: string, body: unknown, signal?: AbortSignal) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    });
  }
  private async put(path: string, body: unknown) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  }
  private async patch(path: string, body: unknown) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  }
  private async delete(path: string) {
    return this.request(path, { method: "DELETE" });
  }

  private async request(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers || {});
    headers.set("Content-Type", "application/json");
    if (this.apiToken) headers.set("x-local-notion-token", this.apiToken);
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(res.status, payload, res.statusText);
    }
    return res.json();
  }
}
