import Database, {
  type Database as BetterSqliteDatabase,
} from "better-sqlite3";
import fs from "fs-extra";
import path from "node:path";

export type Db = BetterSqliteDatabase;

export function openLocalDb(dbPath: string): Db {
  fs.ensureDirSync(path.dirname(dbPath));
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      parent_id TEXT,
      icon TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0,
      trashed INTEGER NOT NULL DEFAULT 0,
      markdown TEXT NOT NULL DEFAULT '',
      blocksuite_json TEXT NOT NULL DEFAULT '{}',
      properties_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
      id UNINDEXED,
      title,
      markdown
    );

    -- DB-row child pages resolve through parent_id on every DB-row body save.
    -- Keep this lookup indexed as workspaces grow.
    CREATE INDEX IF NOT EXISTS idx_pages_parent_id ON pages(parent_id);



    CREATE TABLE IF NOT EXISTS database_summary_index (
      database_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'shared',
      icon TEXT,
      trashed INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      properties_json TEXT NOT NULL DEFAULT '[]',
      views_json TEXT NOT NULL DEFAULT '[]',
      active_view_id TEXT,
      templates_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL DEFAULT '',
      indexed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_database_summary_updated ON database_summary_index(updated_at);
    CREATE INDEX IF NOT EXISTS idx_database_summary_scope ON database_summary_index(scope, trashed);

    CREATE TABLE IF NOT EXISTS database_row_index (
      database_id TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_order INTEGER NOT NULL DEFAULT 0,
      title_text TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      cells_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(database_id, row_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS database_row_fts USING fts5(
      database_id UNINDEXED,
      row_id UNINDEXED,
      search_text
    );

    CREATE TABLE IF NOT EXISTS database_index_meta (
      database_id TEXT PRIMARY KEY,
      row_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS database_row_hash_index (
      database_id TEXT NOT NULL,
      row_id TEXT NOT NULL,
      row_hash TEXT NOT NULL DEFAULT '',
      row_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(database_id, row_id)
    );

    CREATE TABLE IF NOT EXISTS database_index_state (
      database_id TEXT PRIMARY KEY,
      schema_hash TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'full'
    );

    CREATE INDEX IF NOT EXISTS idx_database_row_hash_db_order ON database_row_hash_index(database_id, row_order);

    CREATE TABLE IF NOT EXISTS database_row_property_index (
      database_id TEXT NOT NULL,
      row_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      text_value TEXT NOT NULL DEFAULT '',
      text_value_lower TEXT NOT NULL DEFAULT '',
      number_value REAL,
      date_value TEXT,
      boolean_value INTEGER,
      empty_value INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(database_id, row_id, property_id)
    );

    CREATE INDEX IF NOT EXISTS idx_database_row_prop_lookup ON database_row_property_index(database_id, property_id, row_id);
    CREATE INDEX IF NOT EXISTS idx_database_row_prop_text ON database_row_property_index(database_id, property_id, text_value_lower);
    CREATE INDEX IF NOT EXISTS idx_database_row_prop_number ON database_row_property_index(database_id, property_id, number_value);
    CREATE INDEX IF NOT EXISTS idx_database_row_prop_date ON database_row_property_index(database_id, property_id, date_value);
    CREATE INDEX IF NOT EXISTS idx_database_row_prop_empty ON database_row_property_index(database_id, property_id, empty_value);

    CREATE INDEX IF NOT EXISTS idx_database_row_index_db_order ON database_row_index(database_id, row_order);
    CREATE INDEX IF NOT EXISTS idx_database_row_index_db_updated ON database_row_index(database_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_database_row_index_db_title ON database_row_index(database_id, title_text);

    CREATE TABLE IF NOT EXISTS smart_faq_index (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      tags_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      source_type TEXT NOT NULL DEFAULT '',
      source_title TEXT NOT NULL DEFAULT '',
      source_pdf_name TEXT NOT NULL DEFAULT '',
      source_page TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS smart_faq_fts USING fts5(
      id UNINDEXED,
      question,
      answer,
      category,
      tags_text,
      source_text
    );

    CREATE INDEX IF NOT EXISTS idx_smart_faq_status ON smart_faq_index(status);
    CREATE INDEX IF NOT EXISTS idx_smart_faq_category ON smart_faq_index(category);
    CREATE INDEX IF NOT EXISTS idx_smart_faq_pdf ON smart_faq_index(source_pdf_name);
    CREATE INDEX IF NOT EXISTS idx_smart_faq_updated ON smart_faq_index(updated_at);

    CREATE TABLE IF NOT EXISTS ui_view_cache (
      cache_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ui_view_cache_updated ON ui_view_cache(updated_at);

    CREATE TABLE IF NOT EXISTS page_search_index (
      page_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      parent_id TEXT,
      updated_at TEXT NOT NULL DEFAULT '',
      search_text TEXT NOT NULL DEFAULT '',
      preview_snippet TEXT NOT NULL DEFAULT '',
      trashed INTEGER NOT NULL DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS page_search_fts USING fts5(
      page_id UNINDEXED,
      title,
      search_text
    );

    CREATE TABLE IF NOT EXISTS workspace_link_index (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL DEFAULT 'page',
      source_page_id TEXT,
      source_database_id TEXT,
      source_row_id TEXT,
      source_title TEXT NOT NULL DEFAULT '',
      source_icon TEXT,
      target_page_id TEXT NOT NULL DEFAULT '',
      target_type TEXT NOT NULL DEFAULT 'page',
      target_database_id TEXT,
      target_row_id TEXT,
      link_kind TEXT NOT NULL DEFAULT 'page-link',
      snippet TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_link_target ON workspace_link_index(target_page_id, updated_at);
    -- IMPORTANT: idx_workspace_link_target_row is created after the compatibility
    -- migration below. Existing installations may have the legacy table without
    -- target_type / target_database_id / target_row_id yet.
    CREATE INDEX IF NOT EXISTS idx_workspace_link_source_page ON workspace_link_index(source_page_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_link_source_row ON workspace_link_index(source_database_id, source_row_id);

    CREATE TABLE IF NOT EXISTS attachment_index (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      relative_path TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      page_icon TEXT,
      page_updated_at TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'page',
      source_id TEXT NOT NULL DEFAULT '',
      database_id TEXT,
      row_id TEXT,
      journal_date TEXT,
      source_title TEXT NOT NULL DEFAULT '',
      source_icon TEXT,
      source_updated_at TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'shared'
    );

    CREATE INDEX IF NOT EXISTS idx_attachment_index_page ON attachment_index(page_id);
    CREATE INDEX IF NOT EXISTS idx_attachment_index_created ON attachment_index(created_at);

    CREATE TABLE IF NOT EXISTS broken_link_index (
      id TEXT PRIMARY KEY,
      source_page_id TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      source_icon TEXT,
      target_id TEXT NOT NULL,
      snippet TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_broken_link_source ON broken_link_index(source_page_id);
    CREATE INDEX IF NOT EXISTS idx_broken_link_target ON broken_link_index(target_id);

    CREATE TABLE IF NOT EXISTS shared_page_file_state (
      page_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'shared',
      signature TEXT NOT NULL DEFAULT '',
      meta_mtime_ms INTEGER NOT NULL DEFAULT 0,
      content_mtime_ms INTEGER NOT NULL DEFAULT 0,
      blocksuite_mtime_ms INTEGER NOT NULL DEFAULT 0,
      indexed_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_shared_page_file_state_scope ON shared_page_file_state(scope);


    CREATE TABLE IF NOT EXISTS task_index (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      source_icon TEXT,
      text TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      line_index INTEGER NOT NULL DEFAULT 0,
      context TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_task_index_completed_updated ON task_index(completed, updated_at);
    CREATE INDEX IF NOT EXISTS idx_task_index_source ON task_index(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_task_index_due ON task_index(due_date);

    CREATE TABLE IF NOT EXISTS journal_summary_index (
      date TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      updated_at TEXT NOT NULL DEFAULT '',
      preview_snippet TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      weather TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      full_text TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_journal_summary_updated ON journal_summary_index(updated_at);
    CREATE INDEX IF NOT EXISTS idx_journal_summary_date ON journal_summary_index(date);

    CREATE TABLE IF NOT EXISTS workspace_summary_cache (
      cache_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_summary_updated ON workspace_summary_cache(updated_at);
  `);

  const columns = db.prepare("PRAGMA table_info(pages)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "properties_json")) {
    db.exec(
      "ALTER TABLE pages ADD COLUMN properties_json TEXT NOT NULL DEFAULT '{}'",
    );
  }
  if (!columns.some((column) => column.name === "favorite")) {
    db.exec("ALTER TABLE pages ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }

  // v654: attachments share one derived index regardless of whether the source is a page, Journal, or database row.
  // Keep legacy page columns for old UI/API clients and add source identity lazily for existing SQLite files.
  const attachmentColumns = db.prepare("PRAGMA table_info(attachment_index)").all() as Array<{ name: string }> ;
  const attachmentAdditions: Array<[string, string]> = [
    ["source_type", "TEXT NOT NULL DEFAULT 'page'"],
    ["source_id", "TEXT NOT NULL DEFAULT ''"],
    ["database_id", "TEXT"],
    ["row_id", "TEXT"],
    ["journal_date", "TEXT"],
    ["source_title", "TEXT NOT NULL DEFAULT ''"],
    ["source_icon", "TEXT"],
    ["source_updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["scope", "TEXT NOT NULL DEFAULT 'shared'"],
  ];
  for (const [name, definition] of attachmentAdditions) {
    if (!attachmentColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE attachment_index ADD COLUMN ${name} ${definition}`);
    }
  }
  db.exec("UPDATE attachment_index SET source_type = 'page' WHERE source_type IS NULL OR source_type = ''");
  db.exec("UPDATE attachment_index SET source_id = page_id WHERE (source_id IS NULL OR source_id = '') AND page_id <> ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attachment_index_source ON attachment_index(source_type, source_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attachment_index_row ON attachment_index(database_id, row_id, created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attachment_index_journal ON attachment_index(journal_date, created_at)");

  // Journal summaries are used for fast lists and full-text Journal search.
  // Add the text column lazily so older local SQLite files remain compatible.
  const journalColumns = db
    .prepare("PRAGMA table_info(journal_summary_index)")
    .all() as Array<{ name: string }>;
  if (!journalColumns.some((column) => column.name === "full_text")) {
    db.exec(
      "ALTER TABLE journal_summary_index ADD COLUMN full_text TEXT NOT NULL DEFAULT ''",
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_journal_summary_fulltext_updated ON journal_summary_index(updated_at)",
  );

  // v529: resource links now use one graph for pages, database rows, and DB-row child pages.
  // Existing local databases only have target_page_id, so add the target resource columns lazily.
  const linkColumns = db
    .prepare("PRAGMA table_info(workspace_link_index)")
    .all() as Array<{ name: string }>;
  if (!linkColumns.some((column) => column.name === "target_type")) {
    db.exec(
      "ALTER TABLE workspace_link_index ADD COLUMN target_type TEXT NOT NULL DEFAULT 'page'",
    );
  }
  if (!linkColumns.some((column) => column.name === "target_database_id")) {
    db.exec(
      "ALTER TABLE workspace_link_index ADD COLUMN target_database_id TEXT",
    );
  }
  if (!linkColumns.some((column) => column.name === "target_row_id")) {
    db.exec("ALTER TABLE workspace_link_index ADD COLUMN target_row_id TEXT");
  }
  // The index must be created only after all legacy columns are present.
  // Do not move this into the initial CREATE TABLE block: CREATE TABLE IF NOT
  // NOT EXISTS does not add missing columns to databases created by older versions.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workspace_link_target_row ON workspace_link_index(target_type, target_database_id, target_row_id, updated_at)",
  );
}

export function rebuildFts(db: Db): void {
  db.exec("DELETE FROM page_fts;");
  db.exec(
    `INSERT INTO page_fts(id, title, markdown) SELECT id, title, markdown FROM pages WHERE trashed = 0;`,
  );
}

export function upsertPageFts(
  db: Db,
  page: {
    id: string;
    title?: string | null;
    markdown?: string | null;
    trashed?: boolean | number | null;
  },
): void {
  db.prepare("DELETE FROM page_fts WHERE id = ?").run(page.id);
  if (page.trashed) return;
  db.prepare("INSERT INTO page_fts(id, title, markdown) VALUES(?,?,?)").run(
    page.id,
    String(page.title || ""),
    String(page.markdown || ""),
  );
}

export function deletePageFts(db: Db, pageId: string): void {
  db.prepare("DELETE FROM page_fts WHERE id = ?").run(pageId);
}
