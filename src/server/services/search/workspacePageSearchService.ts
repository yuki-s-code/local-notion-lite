import type { Db } from "../../db/sqlite";
import type { PageWithLock } from "../../../shared/types";

/**
 * Read-only FTS page search. Kept separate from VaultService so search policy
 * can evolve without coupling it to writes, locks, or shared-folder sync.
 */
export class WorkspacePageSearchService {
  constructor(
    private readonly deps: {
      db: Db;
      listPages: () => Promise<PageWithLock[]>;
      withLock: (page: Omit<PageWithLock, "lock">) => Promise<PageWithLock>;
    },
  ) {}

  async search(query: string): Promise<PageWithLock[]> {
    if (!query.trim()) return this.deps.listPages();
    const safeQuery = query
      .trim()
      .split(/\s+/)
      .map((term) => `${term.replace(/[\"']/g, "")}*`)
      .join(" OR ");
    const rows = this.deps.db
      .prepare(
        `SELECT p.id,p.title,p.parent_id as parentId,p.icon,p.created_at as createdAt,p.updated_at as updatedAt,p.updated_by as updatedBy,p.sort_order as sortOrder,p.favorite as favorite,p.trashed,p.properties_json as propertiesJson,substr(replace(replace(p.markdown, char(13), ' '), char(10), ' '), 1, 220) as previewSnippet FROM page_fts f JOIN pages p ON p.id=f.id WHERE page_fts MATCH ? LIMIT 50`,
      )
      .all(safeQuery) as any[];
    return Promise.all(
      rows.map(async (row) =>
        this.deps.withLock({ ...row, trashed: Boolean(row.trashed) }),
      ),
    );
  }
}
