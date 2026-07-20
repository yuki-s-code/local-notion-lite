import type { Db } from "../../db/sqlite";
import type { BacklinkInfo, PageBundle } from "../../../shared/types";

/**
 * Bounded link-index queries. These methods must never trigger a workspace
 * rebuild while a page is opening; an absent index simply returns no matches.
 */
export class WorkspaceLinkQueryService {
  constructor(
    private readonly deps: { db: Db; getPage: (pageId: string) => PageBundle | null },
  ) {}

  async listBacklinks(pageId: string): Promise<BacklinkInfo[]> {
    const target = this.deps.getPage(pageId);
    if (!target) throw new Error("Page not found");
    const rows = this.deps.db.prepare(`
      SELECT source_type as sourceType, source_page_id as sourcePageId, source_database_id as sourceDatabaseId,
             source_row_id as sourceRowId, source_title as sourceTitle, source_icon as sourceIcon, snippet, updated_at as updatedAt
      FROM workspace_link_index
      WHERE target_page_id = ?
      ORDER BY updated_at DESC
      LIMIT 200
    `).all(pageId) as any[];
    const unique = new Map<string, BacklinkInfo>();
    for (const row of rows) {
      const sourceType = row.sourceType === "database-row" ? "database-row" : "page";
      const sourceKey = sourceType === "database-row"
        ? `database-row:${row.sourceDatabaseId || ""}:${row.sourceRowId || ""}`
        : `page:${row.sourcePageId || ""}`;
      if (unique.has(sourceKey)) continue;
      unique.set(sourceKey, {
        sourceType,
        sourcePageId: row.sourcePageId || undefined,
        sourceDatabaseId: row.sourceDatabaseId || undefined,
        sourceRowId: row.sourceRowId || undefined,
        sourceTitle: row.sourceTitle || "Untitled",
        sourceIcon: row.sourceIcon || (sourceType === "database-row" ? "🧾" : "📄"),
        snippet: row.snippet || "",
        updatedAt: row.updatedAt || "",
      });
    }
    return Array.from(unique.values());
  }

  async listBrokenLinks(): Promise<any[]> {
    const rows = this.deps.db.prepare(`
      SELECT source_page_id as sourcePageId, source_title as sourceTitle, source_icon as sourceIcon,
             target_id as targetId, snippet, updated_at as updatedAt
      FROM broken_link_index
      UNION ALL
      SELECT source_page_id as sourcePageId, source_title as sourceTitle, source_icon as sourceIcon,
             target_page_id as targetId, snippet, updated_at as updatedAt
      FROM workspace_link_index
      WHERE target_type = 'page'
        AND target_page_id <> ''
        AND target_page_id NOT IN (SELECT id FROM pages WHERE trashed = 0)
      ORDER BY updatedAt DESC
      LIMIT 1000
    `).all() as any[];
    const unique = new Map<string, any>();
    for (const row of rows) {
      const key = `${row.sourcePageId || ""}:${row.targetId || ""}:${row.snippet || ""}`;
      if (!unique.has(key)) unique.set(key, row);
    }
    return Array.from(unique.values());
  }
}
