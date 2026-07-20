/**
 * Lightweight, dependency-free mutation contract shared by workspace surfaces.
 * It intentionally carries identities only: consumers decide whether to refresh,
 * invalidate a cache, or schedule a targeted semantic update.
 */
export type WorkspaceMutationKind =
  | "page-created" | "page-saved" | "page-moved" | "page-trashed" | "page-restored" | "page-deleted"
  | "page-attachment-added" | "page-attachments-added"
  | "journal-saved" | "journal-deleted" | "journal-attachments-added"
  | "database-created" | "database-saved" | "database-schema-changed" | "database-scope-changed"
  | "database-trashed" | "database-restored" | "database-deleted" | "database-rows-patched"
  | "database-row-content-saved" | "database-row-child-page-created" | "database-row-child-page-removed"
  | "database-row-attachment-added"
  | "ai-page-appended" | "ai-page-created" | "shared-imported";

export type WorkspaceMutationDetail = {
  kind: WorkspaceMutationKind;
  pageIds: string[];
  databaseIds: string[];
  databaseRowIds: string[];
  journalDates: string[];
  cacheScopes: Array<"workspace" | "graph" | "search" | "tasks" | "attachments" | "notifications">;
  at: number;
};

const unique = (values: ReadonlyArray<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));

export function createWorkspaceMutationDetail(input: Partial<WorkspaceMutationDetail> & { kind: WorkspaceMutationDetail["kind"] }): WorkspaceMutationDetail {
  return {
    kind: input.kind,
    pageIds: unique(input.pageIds || []),
    databaseIds: unique(input.databaseIds || []),
    databaseRowIds: unique(input.databaseRowIds || []),
    journalDates: unique(input.journalDates || []),
    cacheScopes: Array.from(new Set(input.cacheScopes || ["workspace", "graph", "search", "tasks", "attachments", "notifications"])),
    at: Number(input.at || Date.now()),
  };
}
