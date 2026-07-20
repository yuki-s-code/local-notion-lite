import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import type { Db } from '../db/sqlite';
import type { AnalysisCell, AnalysisCellExecution, AnalysisCellSnapshot, AnalysisDashboardPin, AnalysisDataDictionary, AnalysisNamedResult, AnalysisNotebook, AnalysisNotebookSummary, AnalysisParameter, AnalysisPivotTransform, AnalysisQueryResult, AnalysisStatus, AnalysisWorkspaceSettings, AnalysisMetricDefinition, AnalysisColumnMeaning } from '../../shared/analysisTypes';

/**
 * Analysis data is intentionally bounded so ordinary office PCs can open the
 * application quickly. The cap is applied at sync time, not at query time:
 * aggregates still run across every synchronized row.
 */
const MAX_SYNC_ROWS = 100_000;
/**
 * The analysis cache is capped at 100k rows. Query/named/import results use the
 * same cap so downstream preprocessing is not silently limited to 5k rows.
 * Rendering is virtualized in the renderer and does not create a DOM row per record.
 */
const MAX_QUERY_ROWS = 100_000;
const MAX_NAMED_RESULT_ROWS = 100_000;
const MAX_IMPORT_ROWS = 100_000;
const RESULT_PAGE_SIZE = 500;
const RESULT_CACHE_TTL_MS = 15 * 60_000;
const MAX_RESULT_CACHES = 4;
/** Keeps long-lived analysis sessions bounded even when each result is large. */
const MAX_RESULT_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const SYNC_LIMITS = { pages: 20_000, database_rows: 60_000, databases: 2_000, journals: 10_000, tasks: 8_000 } as const;
const ANALYSIS_SCHEMA_VERSION = '2';

type AnalysisSyncPhase = 'idle' | 'preparing' | 'syncing' | 'indexing' | 'complete' | 'failed';
type AnalysisSyncProgress = { phase: AnalysisSyncPhase; dataset?: string; processedRows?: number; totalRows?: number; message?: string; startedAt?: string | null };

const ANALYSIS_TABLE_COLUMNS = {
  pages: ['id','title','parent_id','icon','created_at','updated_at','updated_by','favorite','trashed','markdown','properties_json'],
  database_rows: ['database_id','row_id','row_order','title_text','search_text','cells_json','created_at','updated_at'],
  databases: ['database_id','title','scope','created_at','updated_at','row_count','properties_json','views_json'],
  journals: ['date','title','icon','updated_at','preview_snippet','mood','weather','tags_json','full_text'],
  tasks: ['id','source_type','source_id','source_title','source_icon','text','completed','due_date','line_index','context','updated_at'],
} as const;

function quote(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeScalar(value: any): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && typeof value.toString === 'function') return value.toString();
  return value ?? null;
}

function normalizeResultName(value: string): string {
  const name = String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48);
  if (!name) throw new Error('名前付き結果の名前を入力してください。');
  return `result_${name}`;
}

function inferredDuckType(rows: Array<Record<string, unknown>>, column: string): string {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== '');
  if (values.length && values.every((value) => typeof value === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(value)))) return 'DOUBLE';
  if (values.length && values.every((value) => typeof value === 'boolean' || ['true', 'false', '0', '1'].includes(String(value).toLowerCase()))) return 'BOOLEAN';
  return 'VARCHAR';
}

function parameterSqlLiteral(parameter: AnalysisParameter): string {
  const value = String(parameter.value ?? '').trim();
  if (!value) return 'NULL';
  if (parameter.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`パラメータ「${parameter.label || parameter.name}」は数値で入力してください。`);
    return String(number);
  }
  // Date values are deliberately passed as DATE literals. Text and select values
  // are quoted server-side so a notebook parameter cannot become executable SQL.
  if (parameter.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`パラメータ「${parameter.label || parameter.name}」は YYYY-MM-DD 形式で入力してください。`);
    return `DATE '${value.replaceAll("'", "''")}'`;
  }
  return quote(value);
}

function injectParameters(sql: string, parameters: AnalysisParameter[] = []): string {
  const byName = new Map(parameters.map((item) => [item.name, item]));
  return String(sql || '').replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_whole, name: string) => {
    const parameter = byName.get(name);
    if (!parameter) throw new Error(`SQL内のパラメータ {{${name}}} が定義されていません。`);
    return parameterSqlLiteral(parameter);
  });
}

function readOnlySql(sql: string, parameters: AnalysisParameter[] = []): string {
  const source = String(sql || '').trim();
  if (!source) throw new Error('SQLを入力してください。');
  // Comments do not participate in parameter resolution. This lets users document
  // placeholders without forcing every comment example to have a parameter cell.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();
  const parameterized = injectParameters(withoutComments, parameters).trim();
  // A trailing semicolon is conventional SQL syntax. Allow one, but reject a second
  // statement or a semicolon embedded before the end of the query.
  const compact = parameterized.replace(/;\s*$/, '').trim();
  if (!compact || compact.includes(';')) throw new Error('分析SQLは1文のみ実行できます。');
  if (!/^(select|with)\b/i.test(compact)) {
    throw new Error('分析ノートでは SELECT / WITH の読み取り専用SQLだけを実行できます。');
  }
  if (/\b(?:insert|update|delete|drop|alter|create|copy|attach|detach|install|load|export|import|call|pragma|vacuum)\b/i.test(compact)) {
    throw new Error('データを書き換えるSQLや拡張機能の操作は分析ノートでは実行できません。');
  }
  return compact;
}

export class AnalysisNotebookService {
  private instance: any | null = null;
  private connection: any | null = null;
  private initialized = false;
  private lastSyncedAt: string | null = null;
  private readonly localDbPath: string;
  private readonly analysisDbPath: string;
  private readonly duckDbDiagnosticPath: string;
  private automationTimer: any = null;
  private automationRunning = false;
  /** Visible from /analysis/status while a manual or scheduled sync is running. */
  private syncProgress: AnalysisSyncProgress = { phase: 'idle', startedAt: null };
  /** SQL result cache: keeps full rows server-side so the renderer receives only pages. */
  private readonly resultCache = new Map<string, { columns: string[]; rows: Array<Record<string, unknown>>; createdAt: number; lastAccessedAt: number; estimatedBytes: number; executedAt: string; elapsedMs: number; truncated: boolean }>();

  constructor(private readonly db: Db, localDbPath?: string) {
    // Do not infer the storage directory from Database#name alone. In a packaged
    // Electron build it can be relative or differ from the resolved local cache path.
    this.localDbPath = localDbPath && localDbPath.trim()
      ? path.resolve(localDbPath)
      : path.resolve(String((db as any).name || 'local.sqlite'));
    this.analysisDbPath = path.join(path.dirname(this.localDbPath), 'analysis.duckdb');
    this.duckDbDiagnosticPath = path.join(path.dirname(this.localDbPath), 'analysis-duckdb-diagnostics.log');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_notebook_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_workspace_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_dashboard_pins (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        notebook_title TEXT NOT NULL,
        cell_id TEXT NOT NULL,
        cell_title TEXT NOT NULL,
        chart_json TEXT NOT NULL DEFAULT '{}',
        columns_json TEXT NOT NULL DEFAULT '[]',
        rows_json TEXT NOT NULL DEFAULT '[]',
        row_count INTEGER NOT NULL DEFAULT 0,
        truncated INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT NOT NULL,
        source_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, cell_id)
      );
    `);
    const storedSync = this.db.prepare(`SELECT value FROM analysis_notebook_meta WHERE key = 'last_synced_at'`).get() as { value?: string } | undefined;
    this.lastSyncedAt = storedSync?.value || null;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_notebooks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sql_text TEXT NOT NULL DEFAULT '',
        chart_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        execution_history_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    // Existing notebooks created in v574 only have one SQL field. Keep the old
    // columns and add a JSON cell collection so saved notebooks remain readable.
    try { this.db.exec(`ALTER TABLE analysis_notebooks ADD COLUMN cells_json TEXT NOT NULL DEFAULT '[]';`); } catch {}
    try { this.db.exec(`ALTER TABLE analysis_notebooks ADD COLUMN execution_history_json TEXT NOT NULL DEFAULT '{}';`); } catch {}
    try { this.db.exec(`ALTER TABLE analysis_notebooks ADD COLUMN snapshots_json TEXT NOT NULL DEFAULT '{}';`); } catch {}
    this.ensureAnalysisChangeTracking();
    // Only runs while the desktop app is open. This never writes to shared workspace data.
    this.automationTimer = setInterval(() => { void this.runScheduledSyncIfDue(); }, 60_000);
  }

  private async runScheduledSyncIfDue(): Promise<void> {
    if (this.automationRunning) return;
    const settings = this.getWorkspaceSettings();
    if (!settings.automation.enabled) return;
    const last = settings.automation.lastRunAt ? new Date(settings.automation.lastRunAt).getTime() : 0;
    const interval = Math.max(15, settings.automation.intervalMinutes) * 60_000;
    if (Date.now() - last < interval) return;
    this.automationRunning = true;
    try {
      await this.sync();
      this.saveWorkspaceSettings({ ...settings, automation: { ...settings.automation, lastRunAt: new Date().toISOString() } });
    } catch {
      // The manual sync button remains available and exposes detailed failures.
    } finally { this.automationRunning = false; }
  }

  private async writeDuckDbDiagnostic(stage: string, details: Record<string, unknown> = {}): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.duckDbDiagnosticPath));
      const entry = {
        at: new Date().toISOString(),
        stage,
        analysisDbPath: this.analysisDbPath,
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron || null,
        ...details,
      };
      await fs.appendFile(this.duckDbDiagnosticPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Diagnostics must never prevent the user from opening the application.
    }
  }

  private async ensureDuckDb(): Promise<any> {
    if (this.connection) return this.connection;
    try {
      // analysis.duckdb is a local cache next to local.sqlite. Create its
      // directory explicitly because packaged Windows deployments can use a
      // custom local SQLite folder that has not been created by DuckDB yet.
      await fs.ensureDir(path.dirname(this.analysisDbPath));
      await this.writeDuckDbDiagnostic('open-start');
      const mod: any = await import('@duckdb/node-api');
      this.instance = await mod.DuckDBInstance.create(this.analysisDbPath);
      this.connection = await this.instance.connect();
      const fileState = await this.databaseFileState();
      if (!fileState.exists) {
        throw new Error(`DuckDB接続は作成されましたが、分析用DBファイルを確認できません。保存先: ${this.analysisDbPath}`);
      }
      await this.connection.run('SET memory_limit = \'512MB\'');
      await this.connection.run('SET threads = 2');
      // Faster bulk synchronization and lower memory pressure on shared-folder PCs.
      await this.connection.run('SET preserve_insertion_order = false');
      await this.ensureTypedViews(this.connection);
      this.initialized = true;
      await this.writeDuckDbDiagnostic('open-success');
      return this.connection;
    } catch (error: any) {
      // A failed first open can leave a half-created connection/instance behind.
      // Release both before surfacing the error so the next manual sync can retry.
      try { this.connection?.closeSync?.(); } catch {}
      try { this.instance?.closeSync?.(); } catch {}
      this.connection = null;
      this.instance = null;
      this.initialized = false;
      await this.writeDuckDbDiagnostic('open-failed', {
        message: String(error?.message || error || ''),
        stack: typeof error?.stack === 'string' ? error.stack : undefined,
      });
      throw new Error(`DuckDBを起動できませんでした。分析用DBの保存先: ${this.analysisDbPath}。診断ログ: ${this.duckDbDiagnosticPath}。本番版では @duckdb/node-bindings のElectron向け再ビルドと @duckdb/** の asarUnpack を確認してください。 ${error?.message || ''}`.trim());
    }
  }

  private setSyncProgress(next: AnalysisSyncProgress): void {
    this.syncProgress = { ...next };
  }

  /**
   * Query/pivot requests receive their own DuckDB connection. TEMP result tables
   * are connection-local, so parallel notebook tabs cannot drop each other's
   * intermediate tables. The shared connection remains reserved for sync/status.
   */
  private async openExecutionConnection(): Promise<any> {
    if (['preparing', 'syncing', 'indexing'].includes(this.syncProgress.phase)) {
      throw new Error('分析データを同期中です。同期が完了してからセルを実行してください。');
    }
    await this.ensureDuckDb();
    if (!this.instance) throw new Error('DuckDBインスタンスを初期化できませんでした。');
    const connection = await this.instance.connect();
    await connection.run("SET memory_limit = '384MB'");
    await connection.run('SET threads = 2');
    await connection.run('SET preserve_insertion_order = false');
    return connection;
  }

  private async closeExecutionConnection(connection: any): Promise<void> {
    try { await connection?.close?.(); } catch {
      try { connection?.closeSync?.(); } catch {}
    }
  }

  private async dropTypedViews(connection: any): Promise<void> {
    for (const view of ['pages_typed', 'databases_typed', 'database_rows_typed', 'journals_typed', 'tasks_typed']) {
      try { await connection.run(`DROP VIEW IF EXISTS ${view}`); } catch {}
    }
  }

  /** Raw tables retain original text for compatibility; typed views expose safe
   * numeric/date/boolean aliases without silently coercing source values. */
  private async ensureTypedViews(connection: any): Promise<void> {
    const views = [
      `CREATE OR REPLACE VIEW pages_typed AS SELECT *, TRY_CAST(created_at AS TIMESTAMP) AS created_at_ts, TRY_CAST(updated_at AS TIMESTAMP) AS updated_at_ts, CASE WHEN lower(CAST(favorite AS VARCHAR)) IN ('1','true','yes') THEN TRUE WHEN lower(CAST(favorite AS VARCHAR)) IN ('0','false','no') THEN FALSE ELSE NULL END AS favorite_bool, CASE WHEN lower(CAST(trashed AS VARCHAR)) IN ('1','true','yes') THEN TRUE WHEN lower(CAST(trashed AS VARCHAR)) IN ('0','false','no') THEN FALSE ELSE NULL END AS trashed_bool FROM pages`,
      `CREATE OR REPLACE VIEW databases_typed AS SELECT *, TRY_CAST(created_at AS TIMESTAMP) AS created_at_ts, TRY_CAST(updated_at AS TIMESTAMP) AS updated_at_ts, TRY_CAST(row_count AS BIGINT) AS row_count_number FROM databases`,
      `CREATE OR REPLACE VIEW database_rows_typed AS SELECT *, TRY_CAST(row_order AS DOUBLE) AS row_order_number, TRY_CAST(created_at AS TIMESTAMP) AS created_at_ts, TRY_CAST(updated_at AS TIMESTAMP) AS updated_at_ts FROM database_rows`,
      `CREATE OR REPLACE VIEW journals_typed AS SELECT *, TRY_CAST(date AS DATE) AS date_value, TRY_CAST(updated_at AS TIMESTAMP) AS updated_at_ts FROM journals`,
      `CREATE OR REPLACE VIEW tasks_typed AS SELECT *, CASE WHEN lower(CAST(completed AS VARCHAR)) IN ('1','true','yes') THEN TRUE WHEN lower(CAST(completed AS VARCHAR)) IN ('0','false','no') THEN FALSE ELSE NULL END AS completed_bool, TRY_CAST(due_date AS DATE) AS due_date_value, TRY_CAST(line_index AS BIGINT) AS line_index_number, TRY_CAST(updated_at AS TIMESTAMP) AS updated_at_ts FROM tasks`,
    ];
    for (const view of views) {
      try { await connection.run(view); } catch {
        // Before the first sync raw tables do not exist yet. A later sync creates
        // them, then calls this method again.
      }
    }
  }

  async close(): Promise<void> {
    if (this.automationTimer) {
      clearInterval(this.automationTimer);
      this.automationTimer = null;
    }
    this.automationRunning = false;
    try { this.connection?.closeSync?.(); } catch {}
    try { this.instance?.closeSync?.(); } catch {}
    this.connection = null;
    this.instance = null;
    this.resultCache.clear();
    this.initialized = false;
  }

  private sqliteRows(sql: string): any[] {
    return this.db.prepare(sql).all() as any[];
  }

  private async replaceTable(connection: any, table: string, columns: string[], rows: any[]): Promise<void> {
    const schema = columns.map((column) => `"${column.replaceAll('"', '""')}" VARCHAR`).join(', ');
    await connection.run(`CREATE OR REPLACE TABLE ${table} (${schema})`);
    await this.appendRows(connection, table, columns, rows);
  }

  /**
   * Rebuilds a raw analysis table in bounded batches. Unlike .all(), iterate()
   * never keeps an entire source dataset plus INSERT strings in JS memory.
   */
  private async replaceTableFromSql(connection: any, table: string, columns: string[], selectSql: string, totalRows: number, dataset: string): Promise<void> {
    const schema = columns.map((column) => `"${column.replaceAll('"', '""')}" VARCHAR`).join(', ');
    await connection.run(`CREATE OR REPLACE TABLE ${table} (${schema})`);
    const statement = this.db.prepare(selectSql);
    const batch: any[] = [];
    let processed = 0;
    const flush = async () => {
      if (!batch.length) return;
      await this.appendRows(connection, table, columns, batch.splice(0, batch.length));
      this.setSyncProgress({ phase: 'syncing', dataset, processedRows: processed, totalRows, message: `${dataset} を同期しています`, startedAt: this.syncProgress.startedAt });
    };
    // better-sqlite3 exposes iterate() at runtime, while the installed type
    // declaration in this project only declares all()/get()/run(). Keep the
    // streaming path without falling back to all(), which would reintroduce
    // a full in-memory copy during analysis synchronization.
    const rowIterator = (statement as any).iterate() as Iterable<any>;
    for (const row of rowIterator) {
      batch.push(row);
      processed += 1;
      if (batch.length >= 150) await flush();
    }
    await flush();
  }

  private ensureAnalysisChangeTracking(): void {
    // The analysis cache is local, but its source indexes are updated by many code paths.
    // Track only keys that changed so ordinary analysis syncs do not rebuild all DuckDB tables.
    try { this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_source_change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        source_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_source_change_log_id ON analysis_source_change_log(id);
      CREATE INDEX IF NOT EXISTS idx_analysis_source_change_log_source_key ON analysis_source_change_log(source, source_key, id);
    `); } catch { return; }
    const upsert = (source: string, key: string) => `INSERT INTO analysis_source_change_log(source, source_key, operation, changed_at) VALUES ('${source}', ${key}, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));`;
    const remove = (source: string, key: string) => `INSERT INTO analysis_source_change_log(source, source_key, operation, changed_at) VALUES ('${source}', ${key}, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));`;
    // Trigger creation is intentionally idempotent. A source update may log more than
    // once in one transaction; sync coalesces the final operation per key.
    try { this.db.exec(`
      DROP TRIGGER IF EXISTS analysis_track_pages_insert;
      DROP TRIGGER IF EXISTS analysis_track_pages_update;
      DROP TRIGGER IF EXISTS analysis_track_pages_delete;
      DROP TRIGGER IF EXISTS analysis_track_db_rows_insert;
      DROP TRIGGER IF EXISTS analysis_track_db_rows_update;
      DROP TRIGGER IF EXISTS analysis_track_db_rows_delete;
      DROP TRIGGER IF EXISTS analysis_track_databases_insert;
      DROP TRIGGER IF EXISTS analysis_track_databases_update;
      DROP TRIGGER IF EXISTS analysis_track_databases_trashed;
      DROP TRIGGER IF EXISTS analysis_track_databases_delete;
      DROP TRIGGER IF EXISTS analysis_track_journals_insert;
      DROP TRIGGER IF EXISTS analysis_track_journals_update;
      DROP TRIGGER IF EXISTS analysis_track_journals_delete;
      DROP TRIGGER IF EXISTS analysis_track_tasks_insert;
      DROP TRIGGER IF EXISTS analysis_track_tasks_update;
      DROP TRIGGER IF EXISTS analysis_track_tasks_delete;
      CREATE TRIGGER analysis_track_pages_insert AFTER INSERT ON pages BEGIN ${upsert('pages', 'NEW.id')} END;
      CREATE TRIGGER analysis_track_pages_update AFTER UPDATE ON pages BEGIN ${upsert('pages', 'NEW.id')} END;
      CREATE TRIGGER analysis_track_pages_delete AFTER DELETE ON pages BEGIN ${remove('pages', 'OLD.id')} END;

      CREATE TRIGGER analysis_track_db_rows_insert AFTER INSERT ON database_row_index BEGIN ${upsert('database_rows', "NEW.database_id || ':' || NEW.row_id")} END;
      CREATE TRIGGER analysis_track_db_rows_update AFTER UPDATE ON database_row_index BEGIN ${upsert('database_rows', "NEW.database_id || ':' || NEW.row_id")} END;
      CREATE TRIGGER analysis_track_db_rows_delete AFTER DELETE ON database_row_index BEGIN ${remove('database_rows', "OLD.database_id || ':' || OLD.row_id")} END;

      CREATE TRIGGER analysis_track_databases_insert AFTER INSERT ON database_summary_index BEGIN
        ${upsert('databases', 'NEW.database_id')}
        ${upsert('database_rows_scope', 'NEW.database_id')}
      END;
      CREATE TRIGGER analysis_track_databases_update AFTER UPDATE ON database_summary_index BEGIN
        ${upsert('databases', 'NEW.database_id')}
      END;
      CREATE TRIGGER analysis_track_databases_trashed AFTER UPDATE OF trashed ON database_summary_index BEGIN
        ${upsert('database_rows_scope', 'NEW.database_id')}
      END;
      CREATE TRIGGER analysis_track_databases_delete AFTER DELETE ON database_summary_index BEGIN
        ${remove('databases', 'OLD.database_id')}
        ${remove('database_rows_scope', 'OLD.database_id')}
      END;

      CREATE TRIGGER analysis_track_journals_insert AFTER INSERT ON journal_summary_index BEGIN ${upsert('journals', 'NEW.date')} END;
      CREATE TRIGGER analysis_track_journals_update AFTER UPDATE ON journal_summary_index BEGIN ${upsert('journals', 'NEW.date')} END;
      CREATE TRIGGER analysis_track_journals_delete AFTER DELETE ON journal_summary_index BEGIN ${remove('journals', 'OLD.date')} END;

      CREATE TRIGGER analysis_track_tasks_insert AFTER INSERT ON task_index BEGIN ${upsert('tasks', 'NEW.id')} END;
      CREATE TRIGGER analysis_track_tasks_update AFTER UPDATE ON task_index BEGIN ${upsert('tasks', 'NEW.id')} END;
      CREATE TRIGGER analysis_track_tasks_delete AFTER DELETE ON task_index BEGIN ${remove('tasks', 'OLD.id')} END;
    `); } catch { /* source index tables may not exist until vault migration completes */ }
  }

  private sourceState(): Record<string, { count: number; latest: string }> {
    const sources = [
      ['pages', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM pages WHERE COALESCE(trashed, 0) = 0`],
      ['database_rows', `SELECT COUNT(*) AS count, COALESCE(MAX(r.updated_at), '') AS latest FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE COALESCE(d.trashed, 0) = 0`],
      ['databases', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM database_summary_index WHERE COALESCE(trashed, 0) = 0`],
      ['journals', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM journal_summary_index`],
      ['tasks', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM task_index`],
    ] as const;
    return Object.fromEntries(sources.map(([name, sql]) => {
      const row = this.db.prepare(sql).get() as { count?: number; latest?: string } | undefined;
      return [name, { count: Number(row?.count || 0), latest: String(row?.latest || '') }];
    }));
  }

  private sourceFingerprint(state = this.sourceState()): string {
    return Object.entries(state).map(([name, item]) => `${name}:${item.count}:${item.latest}`).join('|');
  }

  private readMeta(key: string): string {
    return String((this.db.prepare(`SELECT value FROM analysis_notebook_meta WHERE key = ?`).get(key) as { value?: string } | undefined)?.value || '');
  }

  private writeMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO analysis_notebook_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  private async appendRows(connection: any, table: string, columns: string[], rows: any[]): Promise<void> {
    if (!rows.length) return;
    const batchSize = 150;
    for (let index = 0; index < rows.length; index += batchSize) {
      const values = rows.slice(index, index + batchSize).map((row) => `(${columns.map((key) => quote(row[key])).join(', ')})`).join(',');
      await connection.run(`INSERT INTO ${table} VALUES ${values}`);
    }
  }

  private maxChangeLogId(): number {
    return Number((this.db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM analysis_source_change_log`).get() as { id?: number } | undefined)?.id || 0);
  }

  private readPendingChanges(maxId: number): Array<{ source: string; sourceKey: string; operation: 'upsert' | 'delete' }> {
    const rows = this.db.prepare(`
      SELECT source, source_key AS sourceKey, operation
      FROM analysis_source_change_log
      WHERE id <= ?
      ORDER BY id ASC
    `).all(maxId) as Array<{ source: string; sourceKey: string; operation: string }>;
    const latest = new Map<string, { source: string; sourceKey: string; operation: 'upsert' | 'delete' }>();
    for (const row of rows) {
      const source = String(row.source || ''); const sourceKey = String(row.sourceKey || '');
      if (!source || !sourceKey) continue;
      latest.set(`${source}\u0000${sourceKey}`, { source, sourceKey, operation: row.operation === 'delete' ? 'delete' : 'upsert' });
    }
    return [...latest.values()];
  }

  private async deleteDuckRows(connection: any, table: string, whereSql: string): Promise<void> {
    await connection.run(`DELETE FROM ${table} WHERE ${whereSql}`);
  }

  private async applyIncrementalChanges(connection: any, changes: Array<{ source: string; sourceKey: string; operation: 'upsert' | 'delete' }>): Promise<boolean> {
    // Database metadata changes can affect every row in one database (trash/state),
    // so process their scoped refresh before individual row changes.
    const scoped = new Set(changes.filter((change) => change.source === 'database_rows_scope').map((change) => change.sourceKey));
    const process = async (source: string, columns: string[], table: string, keyColumn: string, queryForKey: (key: string) => string) => {
      for (const change of changes.filter((item) => item.source === source)) {
        if (source === 'database_rows') {
          const separator = change.sourceKey.indexOf(':');
          if (separator < 1) return false;
          const databaseId = change.sourceKey.slice(0, separator);
          const rowId = change.sourceKey.slice(separator + 1);
          if (scoped.has(databaseId)) continue;
          await this.deleteDuckRows(connection, table, `database_id = ${quote(databaseId)} AND row_id = ${quote(rowId)}`);
          if (change.operation === 'upsert') await this.appendRows(connection, table, columns, this.sqliteRows(queryForKey(change.sourceKey)));
          continue;
        }
        await this.deleteDuckRows(connection, table, `${keyColumn} = ${quote(change.sourceKey)}`);
        if (change.operation === 'upsert') await this.appendRows(connection, table, columns, this.sqliteRows(queryForKey(change.sourceKey)));
      }
      return true;
    };

    for (const databaseId of scoped) {
      await this.deleteDuckRows(connection, 'database_rows', `database_id = ${quote(databaseId)}`);
      const rows = this.sqliteRows(`SELECT r.database_id, r.row_id, r.row_order, r.title_text, r.search_text, r.cells_json, r.created_at, r.updated_at FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE r.database_id = ${quote(databaseId)} AND COALESCE(d.trashed, 0) = 0 ORDER BY r.row_order ASC, r.row_id ASC`);
      await this.appendRows(connection, 'database_rows', ['database_id','row_id','row_order','title_text','search_text','cells_json','created_at','updated_at'], rows);
    }

    const okPages = await process('pages', ['id','title','parent_id','icon','created_at','updated_at','updated_by','favorite','trashed','markdown','properties_json'], 'pages', 'id', (id) => `SELECT id, title, parent_id, icon, created_at, updated_at, updated_by, favorite, trashed, substr(markdown, 1, ${MAX_TEXT_CHARS}) AS markdown, properties_json FROM pages WHERE id = ${quote(id)} AND COALESCE(trashed, 0) = 0`);
    const okRows = await process('database_rows', ['database_id','row_id','row_order','title_text','search_text','cells_json','created_at','updated_at'], 'database_rows', 'row_id', (key) => {
      const separator = key.indexOf(':'); const databaseId = key.slice(0, separator); const rowId = key.slice(separator + 1);
      return `SELECT r.database_id, r.row_id, r.row_order, r.title_text, r.search_text, r.cells_json, r.created_at, r.updated_at FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE r.database_id = ${quote(databaseId)} AND r.row_id = ${quote(rowId)} AND COALESCE(d.trashed, 0) = 0`;
    });
    const okDatabases = await process('databases', ['database_id','title','scope','created_at','updated_at','row_count','properties_json','views_json'], 'databases', 'database_id', (id) => `SELECT database_id, title, scope, created_at, updated_at, row_count, properties_json, views_json FROM database_summary_index WHERE database_id = ${quote(id)} AND COALESCE(trashed, 0) = 0`);
    const okJournals = await process('journals', ['date','title','icon','updated_at','preview_snippet','mood','weather','tags_json','full_text'], 'journals', 'date', (date) => `SELECT date, title, icon, updated_at, preview_snippet, mood, weather, tags_json, substr(full_text, 1, ${MAX_TEXT_CHARS}) AS full_text FROM journal_summary_index WHERE date = ${quote(date)}`);
    const okTasks = await process('tasks', ['id','source_type','source_id','source_title','source_icon','text','completed','due_date','line_index','context','updated_at'], 'tasks', 'id', (id) => `SELECT id, source_type, source_id, source_title, source_icon, text, completed, due_date, line_index, context, updated_at FROM task_index WHERE id = ${quote(id)}`);
    return Boolean(okPages && okRows && okDatabases && okJournals && okTasks);
  }

  private finalizeAnalysisSync(fingerprint: string, state: Record<string, { count: number; latest: string }>, mode: 'rebuilt' | 'incremental' | 'unchanged', maxChangeId: number, complete?: boolean): void {
    this.lastSyncedAt = new Date().toISOString();
    this.writeMeta('last_synced_at', this.lastSyncedAt);
    this.writeMeta('source_fingerprint', fingerprint);
    this.writeMeta('source_state', JSON.stringify(state));
    this.writeMeta('analysis_change_tracking_version', '1');
    if (typeof complete === 'boolean') this.writeMeta('analysis_sync_complete', complete ? '1' : '0');
    this.writeMeta('last_sync_mode', mode);
    this.db.prepare(`DELETE FROM analysis_source_change_log WHERE id <= ?`).run(maxChangeId);
  }

  async sync(): Promise<AnalysisStatus> {
    const startedAt = new Date().toISOString();
    this.setSyncProgress({ phase: 'preparing', message: '分析データの変更を確認しています', startedAt });
    try {
      this.ensureAnalysisChangeTracking();
      const connection = await this.ensureDuckDb();
      const state = this.sourceState();
      const fingerprint = this.sourceFingerprint(state);
      const previousFingerprint = this.readMeta('source_fingerprint');
      const trackingReady = this.readMeta('analysis_change_tracking_version') === '1';
      const maxChangeId = this.maxChangeLogId();
      const changes = this.readPendingChanges(maxChangeId);

      if (trackingReady && previousFingerprint === fingerprint && !changes.length && this.lastSyncedAt) {
        this.writeMeta('last_sync_mode', 'unchanged');
        this.setSyncProgress({ phase: 'complete', message: '前回から変更はありません', startedAt });
        return this.status();
      }

      // Incremental sync is safe only after one complete baseline build. The change-log
      // covers writes made by this app; unexpected SQLite changes fall back to rebuild.
      const completeBaseline = this.readMeta('analysis_sync_complete') === '1';
      if (trackingReady && completeBaseline && this.lastSyncedAt && changes.length && previousFingerprint) {
        this.setSyncProgress({ phase: 'syncing', message: `${changes.length.toLocaleString()}件の変更を反映しています`, totalRows: changes.length, startedAt });
        const applied = await this.applyIncrementalChanges(connection, changes);
        if (applied) {
          await this.ensureTypedViews(connection);
          this.finalizeAnalysisSync(fingerprint, state, 'incremental', maxChangeId);
          this.setSyncProgress({ phase: 'complete', message: '変更分の同期が完了しました', startedAt });
          return this.status();
        }
      }

      // Full safe rebuild. Query rows are iterated in bounded batches so source rows,
      // generated INSERT strings and DuckDB buffers are never all retained at once.
      const sourceCounts = Object.fromEntries(Object.entries(state).map(([name, item]) => [name, item.count])) as Record<'pages'|'database_rows'|'databases'|'journals'|'tasks', number>;
      const syncLimits: Record<keyof typeof sourceCounts, number> = {
        pages: Math.min(sourceCounts.pages, SYNC_LIMITS.pages), database_rows: Math.min(sourceCounts.database_rows, SYNC_LIMITS.database_rows), databases: Math.min(sourceCounts.databases, SYNC_LIMITS.databases), journals: Math.min(sourceCounts.journals, SYNC_LIMITS.journals), tasks: Math.min(sourceCounts.tasks, SYNC_LIMITS.tasks),
      };
      let remainingRows = MAX_SYNC_ROWS - Object.values(syncLimits).reduce((sum, count) => sum + count, 0);
      for (const dataset of ['database_rows', 'pages', 'journals', 'tasks', 'databases'] as Array<keyof typeof sourceCounts>) {
        if (remainingRows <= 0) break;
        const additional = Math.min(remainingRows, Math.max(0, sourceCounts[dataset] - syncLimits[dataset]));
        syncLimits[dataset] += additional;
        remainingRows -= additional;
      }

      // Raw tables are replaced below; remove dependent typed views first.
      await this.dropTypedViews(connection);
      const rebuilds: Array<{ dataset: keyof typeof ANALYSIS_TABLE_COLUMNS; sql: string }> = [
        { dataset: 'pages', sql: `SELECT id, title, parent_id AS parent_id, icon, created_at, updated_at, updated_by, favorite, trashed, substr(markdown, 1, ${MAX_TEXT_CHARS}) AS markdown, properties_json FROM pages WHERE COALESCE(trashed, 0) = 0 ORDER BY datetime(updated_at) DESC, id DESC LIMIT ${syncLimits.pages}` },
        { dataset: 'database_rows', sql: `SELECT r.database_id, r.row_id, r.row_order, r.title_text, r.search_text, r.cells_json, r.created_at, r.updated_at FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE COALESCE(d.trashed, 0) = 0 ORDER BY datetime(r.updated_at) DESC, r.row_id DESC LIMIT ${syncLimits.database_rows}` },
        { dataset: 'databases', sql: `SELECT database_id, title, scope, created_at, updated_at, row_count, properties_json, views_json FROM database_summary_index WHERE COALESCE(trashed, 0) = 0 ORDER BY datetime(updated_at) DESC, database_id DESC LIMIT ${syncLimits.databases}` },
        { dataset: 'journals', sql: `SELECT date, title, icon, updated_at, preview_snippet, mood, weather, tags_json, substr(full_text, 1, ${MAX_TEXT_CHARS}) AS full_text FROM journal_summary_index ORDER BY date DESC LIMIT ${syncLimits.journals}` },
        { dataset: 'tasks', sql: `SELECT id, source_type, source_id, source_title, source_icon, text, completed, due_date, line_index, context, updated_at FROM task_index ORDER BY CASE WHEN completed = 0 THEN 0 ELSE 1 END, datetime(updated_at) DESC, id DESC LIMIT ${syncLimits.tasks}` },
      ];
      for (const item of rebuilds) {
        await this.replaceTableFromSql(connection, item.dataset, [...ANALYSIS_TABLE_COLUMNS[item.dataset]], item.sql, syncLimits[item.dataset], item.dataset);
      }
      this.setSyncProgress({ phase: 'indexing', message: '分析用インデックスと型付きビューを準備しています', startedAt });
      for (const statement of ['CREATE INDEX IF NOT EXISTS analysis_pages_updated_idx ON pages(updated_at)', 'CREATE INDEX IF NOT EXISTS analysis_rows_database_idx ON database_rows(database_id)', 'CREATE INDEX IF NOT EXISTS analysis_rows_updated_idx ON database_rows(updated_at)', 'CREATE INDEX IF NOT EXISTS analysis_journals_date_idx ON journals(date)', 'CREATE INDEX IF NOT EXISTS analysis_tasks_due_idx ON tasks(due_date)']) { try { await connection.run(statement); } catch {} }
      await this.ensureTypedViews(connection);
      this.writeMeta('analysis_schema_version', ANALYSIS_SCHEMA_VERSION);
      const complete = Object.keys(syncLimits).every((dataset) => syncLimits[dataset as keyof typeof syncLimits] >= sourceCounts[dataset as keyof typeof sourceCounts]);
      this.finalizeAnalysisSync(fingerprint, state, 'rebuilt', maxChangeId, complete);
      this.setSyncProgress({ phase: 'complete', message: complete ? '全件同期が完了しました' : '同期上限までのデータを準備しました', startedAt });
      return this.status();
    } catch (error: any) {
      this.setSyncProgress({ phase: 'failed', message: String(error?.message || '分析データの同期に失敗しました'), startedAt });
      throw error;
    }
  }

  async validateAiDraft(sql: string, chart: { type?: string; x?: string; y?: string }): Promise<{ sql: string; columns: string[]; warnings: string[] }> {
    const safeSql = this.validateSql(sql, []);
    const dictionary = this.getDataDictionary();
    const datasets = new Map(dictionary.datasets.map((dataset) => [dataset.name.toLowerCase(), new Set(dataset.columns.map((column) => column.name))]));
    const tableReferences = Array.from(safeSql.matchAll(/\b(?:from|join)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)).map((match) => match[1]);
    for (const table of tableReferences) {
      if (!datasets.has(table.toLowerCase())) throw new Error(`AI案に存在しないテーブル「${table}」があります。`);
    }
    const result = await this.query(`SELECT * FROM (${safeSql}) AS ai_draft_validation LIMIT 1`, [], []);
    const warnings: string[] = [];
    const x = String(chart?.x || '').trim();
    const y = String(chart?.y || '').trim();
    if (x && !result.columns.includes(x)) warnings.push(`横軸「${x}」はSQL結果にありません。結果の列から選び直してください。`);
    if (y && !result.columns.includes(y)) warnings.push(`縦軸「${y}」はSQL結果にありません。結果の列から選び直してください。`);
    if (['line', 'area'].includes(String(chart?.type || '')) && x && !/(date|month|year|day|週|月|年度|日付)/i.test(x)) warnings.push('時系列グラフです。横軸が日付・月・年度の列か確認してください。');
    if (['bar', 'line', 'area', 'dot'].includes(String(chart?.type || '')) && y && !result.rows.every((row) => row[y] === null || row[y] === '' || Number.isFinite(Number(row[y])))) warnings.push(`縦軸「${y}」に数値以外が含まれる可能性があります。`);
    return { sql: safeSql, columns: result.columns, warnings };
  }

  validateSql(sql: string, parameters: AnalysisParameter[] = []): string {
    return readOnlySql(sql, parameters);
  }

  private async databaseFileState(): Promise<{ exists: boolean; bytes: number | null; modifiedAt: string | null }> {
    try {
      const info = await fs.stat(this.analysisDbPath);
      return { exists: info.isFile(), bytes: info.isFile() ? info.size : null, modifiedAt: info.mtime.toISOString() };
    } catch {
      return { exists: false, bytes: null, modifiedAt: null };
    }
  }

  async status(): Promise<AnalysisStatus> {
    const available = this.initialized;
    const source = this.sourceState();
    let counts: Record<string, number> = { pages: 0, databases: 0, database_rows: 0, journals: 0, tasks: 0 };
    if (available && this.connection) {
      try {
        const result = await this.connection.runAndReadAll(`
          SELECT
            (SELECT count(*) FROM pages) AS pages,
            (SELECT count(*) FROM databases) AS databases,
            (SELECT count(*) FROM database_rows) AS database_rows,
            (SELECT count(*) FROM journals) AS journals,
            (SELECT count(*) FROM tasks) AS tasks
        `);
        const row = result.getRows?.()[0] || [];
        const names = result.columnNames?.() || Object.keys(counts);
        counts = Object.fromEntries(names.map((name: string, index: number) => [name, Number(row[index] || 0)]));
      } catch {}
    }
    const databaseFile = await this.databaseFileState();
    const lastSyncMode = (this.db.prepare(`SELECT value FROM analysis_notebook_meta WHERE key = 'last_sync_mode'`).get() as { value?: string } | undefined)?.value;
    return {
      available,
      engine: available ? 'duckdb' : 'unavailable',
      // Show the intended path even before the first successful sync. The file
      // itself is deliberately created lazily by ensureDuckDb().
      databasePath: this.analysisDbPath,
      sqlitePath: this.localDbPath,
      databaseFile,
      lastSyncedAt: this.lastSyncedAt,
      lastSyncMode: lastSyncMode === 'rebuilt' || lastSyncMode === 'incremental' || lastSyncMode === 'unchanged' ? lastSyncMode : null,
      datasets: [
        { name: 'pages', rows: counts.pages || 0, sourceRows: source.pages.count, excludedRows: Math.max(0, source.pages.count - (counts.pages || 0)), description: '通常ページとプロパティ' },
        { name: 'databases', rows: counts.databases || 0, sourceRows: source.databases.count, excludedRows: Math.max(0, source.databases.count - (counts.databases || 0)), description: 'データベースの定義' },
        { name: 'database_rows', rows: counts.database_rows || 0, sourceRows: source.database_rows.count, excludedRows: Math.max(0, source.database_rows.count - (counts.database_rows || 0)), description: 'データベース行とセルJSON' },
        { name: 'journals', rows: counts.journals || 0, sourceRows: source.journals.count, excludedRows: Math.max(0, source.journals.count - (counts.journals || 0)), description: 'Journal全文・タグ・気分・天気' },
        { name: 'tasks', rows: counts.tasks || 0, sourceRows: source.tasks.count, excludedRows: Math.max(0, source.tasks.count - (counts.tasks || 0)), description: 'ページ・Journal・Inboxから抽出したタスク' },
      ],
      limits: { syncRows: MAX_SYNC_ROWS, previewRows: MAX_QUERY_ROWS, textChars: MAX_TEXT_CHARS },
      syncComplete: this.readMeta('analysis_sync_complete') === '1',
      syncProgress: this.syncProgress,
      message: available ? undefined : '分析画面を開いて「同期」を実行するとDuckDBを起動します。',
    };
  }

  getWorkspaceSettings(): AnalysisWorkspaceSettings {
    const row = this.db.prepare(`SELECT settings_json AS settingsJson, updated_at AS updatedAt FROM analysis_workspace_settings WHERE id = 1`).get() as { settingsJson?: string; updatedAt?: string } | undefined;
    let parsed: any = {};
    try { parsed = JSON.parse(row?.settingsJson || '{}'); } catch {}
    const columnMeanings: AnalysisColumnMeaning[] = Array.isArray(parsed.columnMeanings) ? parsed.columnMeanings.slice(0, 500).flatMap((item: any) => item && item.dataset && item.column ? [{
      dataset: String(item.dataset).slice(0, 100), column: String(item.column).slice(0, 120), label: String(item.label || item.column).slice(0, 120), description: String(item.description || '').slice(0, 1000), role: ['dimension','measure','date','identifier','exclude'].includes(item.role) ? item.role : 'dimension', updatedAt: String(item.updatedAt || row?.updatedAt || new Date().toISOString()),
    }] : []) : [];
    const metrics: AnalysisMetricDefinition[] = Array.isArray(parsed.metrics) ? parsed.metrics.slice(0, 200).flatMap((item: any) => item && item.id && item.name && item.dataset && item.expression ? [{
      id: String(item.id).slice(0, 120), name: String(item.name).slice(0, 160), description: String(item.description || '').slice(0, 1000), dataset: String(item.dataset).slice(0, 100), expression: String(item.expression).slice(0, 1000), format: ['number','percent','currency'].includes(item.format) ? item.format : 'number', updatedAt: String(item.updatedAt || row?.updatedAt || new Date().toISOString()),
    }] : []) : [];
    const automationRaw = parsed.automation || {};
    const automation = {
      enabled: automationRaw.enabled === true,
      intervalMinutes: Math.max(15, Math.min(1440, Number(automationRaw.intervalMinutes) || 60)),
      lastRunAt: automationRaw.lastRunAt ? String(automationRaw.lastRunAt) : null,
      alertRules: Array.isArray(automationRaw.alertRules) ? automationRaw.alertRules.slice(0, 50).flatMap((rule: any) => rule && rule.id ? [{ id: String(rule.id).slice(0, 100), title: String(rule.title || '分析通知').slice(0, 160), metricId: rule.metricId ? String(rule.metricId).slice(0, 120) : undefined, operator: ['gt','lt','change'].includes(rule.operator) ? rule.operator : 'gt', threshold: Number(rule.threshold) || 0, enabled: rule.enabled !== false }] : []) : [],
    };
    return { columnMeanings, metrics, automation, updatedAt: String(row?.updatedAt || new Date().toISOString()) };
  }

  saveWorkspaceSettings(input: any): AnalysisWorkspaceSettings {
    const current = this.getWorkspaceSettings();
    const now = new Date().toISOString();
    const next: AnalysisWorkspaceSettings = {
      columnMeanings: Array.isArray(input?.columnMeanings) ? input.columnMeanings : current.columnMeanings,
      metrics: Array.isArray(input?.metrics) ? input.metrics : current.metrics,
      automation: input?.automation && typeof input.automation === 'object' ? input.automation : current.automation,
      updatedAt: now,
    };
    // Normalize through the same parser used for reads, then persist the bounded value.
    this.db.prepare(`INSERT INTO analysis_workspace_settings (id, settings_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at`).run(JSON.stringify(next), now);
    return this.getWorkspaceSettings();
  }

  getDataDictionary(): AnalysisDataDictionary {
    return {
      datasets: [
        {
          name: 'pages',
          description: '通常ページ。本文・更新日時・プロパティを分析できます。',
          columns: [
            { name: 'id', type: 'TEXT', description: 'ページID' },
            { name: 'title', type: 'TEXT', description: 'ページタイトル' },
            { name: 'parent_id', type: 'TEXT', description: '親ページID' },
            { name: 'icon', type: 'TEXT', description: 'ページアイコン' },
            { name: 'created_at', type: 'TEXT', description: '作成日時（ISO形式）' },
            { name: 'updated_at', type: 'TEXT', description: '最終更新日時（ISO形式）' },
            { name: 'updated_by', type: 'TEXT', description: '最終更新者' },
            { name: 'favorite', type: 'TEXT', description: 'お気に入り状態' },
            { name: 'trashed', type: 'TEXT', description: 'ゴミ箱状態' },
            { name: 'markdown', type: 'TEXT', description: `本文先頭（最大${MAX_TEXT_CHARS.toLocaleString()}文字）` },
            { name: 'properties_json', type: 'TEXT', description: 'ページプロパティJSON' },
          ],
        },
        {
          name: 'databases',
          description: 'データベース定義。DB別の件数や更新状況に使います。',
          columns: [
            { name: 'database_id', type: 'TEXT', description: 'データベースID' },
            { name: 'title', type: 'TEXT', description: 'データベース名' },
            { name: 'scope', type: 'TEXT', description: 'shared / private' },
            { name: 'created_at', type: 'TEXT', description: '作成日時' },
            { name: 'updated_at', type: 'TEXT', description: '最終更新日時' },
            { name: 'row_count', type: 'TEXT', description: '行数' },
            { name: 'properties_json', type: 'TEXT', description: 'プロパティ定義JSON' },
            { name: 'views_json', type: 'TEXT', description: 'ビュー定義JSON' },
          ],
        },
        {
          name: 'database_rows',
          description: 'データベース行。databases と database_id で結合できます。',
          columns: [
            { name: 'database_id', type: 'TEXT', description: '親データベースID' },
            { name: 'row_id', type: 'TEXT', description: '行ID' },
            { name: 'row_order', type: 'TEXT', description: '並び順' },
            { name: 'title_text', type: 'TEXT', description: '行タイトル' },
            { name: 'search_text', type: 'TEXT', description: '検索用本文' },
            { name: 'cells_json', type: 'TEXT', description: '各プロパティの値JSON' },
            { name: 'created_at', type: 'TEXT', description: '作成日時' },
            { name: 'updated_at', type: 'TEXT', description: '最終更新日時' },
          ],
        },
        {
          name: 'journals',
          description: 'Journal全文。日付・タグ・気分・天気の分析に使います。',
          columns: [
            { name: 'date', type: 'TEXT', description: 'Journal日付（YYYY-MM-DD）' },
            { name: 'title', type: 'TEXT', description: 'タイトル' },
            { name: 'icon', type: 'TEXT', description: 'アイコン' },
            { name: 'updated_at', type: 'TEXT', description: '最終更新日時' },
            { name: 'preview_snippet', type: 'TEXT', description: '本文抜粋' },
            { name: 'mood', type: 'TEXT', description: '気分' },
            { name: 'weather', type: 'TEXT', description: '天気' },
            { name: 'tags_json', type: 'TEXT', description: 'タグJSON' },
            { name: 'full_text', type: 'TEXT', description: `本文先頭（最大${MAX_TEXT_CHARS.toLocaleString()}文字）` },
          ],
        },
        {
          name: 'tasks',
          description: 'ページ・Journal・Inboxから抽出したタスク。',
          columns: [
            { name: 'id', type: 'TEXT', description: 'タスクID' },
            { name: 'source_type', type: 'TEXT', description: 'page / journal / inbox' },
            { name: 'source_id', type: 'TEXT', description: '元データID' },
            { name: 'source_title', type: 'TEXT', description: '元のタイトル' },
            { name: 'source_icon', type: 'TEXT', description: '元のアイコン' },
            { name: 'text', type: 'TEXT', description: 'タスク本文' },
            { name: 'completed', type: 'TEXT', description: '完了状態（0/1等）' },
            { name: 'due_date', type: 'TEXT', description: '期限日' },
            { name: 'line_index', type: 'TEXT', description: '本文内の行位置' },
            { name: 'context', type: 'TEXT', description: '周辺文脈' },
            { name: 'updated_at', type: 'TEXT', description: '最終更新日時' },
          ],
        },
        {
          name: 'pages_typed',
          description: 'pages の型付きビュー。日時・お気に入り・ゴミ箱状態を安全に集計する時はこちらを使います。',
          columns: [
            { name: 'created_at_ts', type: 'TIMESTAMP', description: '作成日時（変換できない値はNULL）' },
            { name: 'updated_at_ts', type: 'TIMESTAMP', description: '最終更新日時（変換できない値はNULL）' },
            { name: 'favorite_bool', type: 'BOOLEAN', description: 'お気に入り状態' },
            { name: 'trashed_bool', type: 'BOOLEAN', description: 'ゴミ箱状態' },
          ],
        },
        {
          name: 'databases_typed',
          description: 'databases の型付きビュー。行数・日時の分析に使います。',
          columns: [
            { name: 'row_count_number', type: 'BIGINT', description: '行数' },
            { name: 'created_at_ts', type: 'TIMESTAMP', description: '作成日時' },
            { name: 'updated_at_ts', type: 'TIMESTAMP', description: '最終更新日時' },
          ],
        },
        {
          name: 'database_rows_typed',
          description: 'database_rows の型付きビュー。並び順・日時の分析に使います。',
          columns: [
            { name: 'row_order_number', type: 'DOUBLE', description: '並び順' },
            { name: 'created_at_ts', type: 'TIMESTAMP', description: '作成日時' },
            { name: 'updated_at_ts', type: 'TIMESTAMP', description: '最終更新日時' },
          ],
        },
        {
          name: 'journals_typed',
          description: 'journals の型付きビュー。日付ごとの推移に使います。',
          columns: [
            { name: 'date_value', type: 'DATE', description: 'Journal日付' },
            { name: 'updated_at_ts', type: 'TIMESTAMP', description: '最終更新日時' },
          ],
        },
        {
          name: 'tasks_typed',
          description: 'tasks の型付きビュー。完了率・期限・更新日の分析に使います。',
          columns: [
            { name: 'completed_bool', type: 'BOOLEAN', description: '完了状態' },
            { name: 'due_date_value', type: 'DATE', description: '期限日' },
            { name: 'line_index_number', type: 'BIGINT', description: '本文内の行位置' },
            { name: 'updated_at_ts', type: 'TIMESTAMP', description: '最終更新日時' },
          ],
        },
      ],
    };
  }

  /**
   * Estimate result memory without serialising every row. Sampling keeps caching
   * cheap even when a query returns 100,000 rows, while conservative overhead
   * prevents a long analysis session from retaining unbounded data.
   */
  private estimateResultBytes(columns: string[], rows: Array<Record<string, unknown>>): number {
    const sampleSize = Math.min(rows.length, 512);
    let sampleBytes = columns.reduce((total, column) => total + column.length * 2 + 24, 0);
    for (let index = 0; index < sampleSize; index += 1) {
      const row = rows[index] || {};
      sampleBytes += 48;
      for (const column of columns) {
        const value = row[column];
        sampleBytes += value === null || value === undefined ? 8 : String(value).length * 2 + 24;
      }
    }
    const rowEstimate = sampleSize ? Math.ceil((sampleBytes / sampleSize) * rows.length) : 0;
    return Math.max(1024, rowEstimate + columns.length * 128);
  }

  private cacheBytes(): number {
    let total = 0;
    for (const entry of this.resultCache.values()) total += entry.estimatedBytes;
    return total;
  }

  private touchResult(resultId: string): { columns: string[]; rows: Array<Record<string, unknown>>; createdAt: number; lastAccessedAt: number; estimatedBytes: number; executedAt: string; elapsedMs: number; truncated: boolean } | undefined {
    const entry = this.resultCache.get(String(resultId || ''));
    if (entry) entry.lastAccessedAt = Date.now();
    return entry;
  }

  private purgeResultCache(): void {
    const now = Date.now();
    for (const [id, entry] of this.resultCache) {
      if (now - entry.createdAt > RESULT_CACHE_TTL_MS) this.resultCache.delete(id);
    }
    // Keep at least the newest result even when it alone exceeds the soft byte
    // budget; otherwise a successful query would return a resultId that cannot
    // be paged or used by downstream cells.
    while ((this.resultCache.size > MAX_RESULT_CACHES || this.cacheBytes() > MAX_RESULT_CACHE_BYTES) && this.resultCache.size > 1) {
      const oldest = Array.from(this.resultCache.entries())
        .sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt)[0]?.[0];
      if (!oldest) break;
      this.resultCache.delete(oldest);
    }
  }

  private cacheResult(columns: string[], rows: Array<Record<string, unknown>>, executedAt: string, elapsedMs: number, truncated: boolean): string {
    this.purgeResultCache();
    const id = randomUUID();
    const now = Date.now();
    this.resultCache.set(id, { columns, rows, createdAt: now, lastAccessedAt: now, estimatedBytes: this.estimateResultBytes(columns, rows), executedAt, elapsedMs, truncated });
    this.purgeResultCache();
    return id;
  }

  releaseResult(resultId: string): boolean {
    return this.resultCache.delete(String(resultId || ''));
  }

  getResultCacheStatus(): { entries: number; estimatedBytes: number; ttlMs: number; maxEntries: number; maxBytes: number } {
    this.purgeResultCache();
    return { entries: this.resultCache.size, estimatedBytes: this.cacheBytes(), ttlMs: RESULT_CACHE_TTL_MS, maxEntries: MAX_RESULT_CACHES, maxBytes: MAX_RESULT_CACHE_BYTES };
  }

  getResultPage(resultId: string, page = 0, pageSize = RESULT_PAGE_SIZE): AnalysisQueryResult {
    this.purgeResultCache();
    const cached = this.touchResult(resultId);
    if (!cached) throw new Error('分析結果の一時キャッシュが期限切れです。もう一度セルを実行してください。');
    const safePageSize = Math.max(50, Math.min(2_000, Number(pageSize) || RESULT_PAGE_SIZE));
    const safePage = Math.max(0, Number(page) || 0);
    const start = safePage * safePageSize;
    const rows = cached.rows.slice(start, start + safePageSize);
    return { columns: cached.columns, rows, rowCount: cached.rows.length, truncated: cached.truncated, executedAt: cached.executedAt, elapsedMs: cached.elapsedMs, resultId, pageSize: safePageSize, hasMore: start + rows.length < cached.rows.length };
  }

  getResultAll(resultId: string): AnalysisQueryResult {
    this.purgeResultCache();
    const cached = this.touchResult(resultId);
    if (!cached) throw new Error('分析結果の一時キャッシュが期限切れです。もう一度セルを実行してください。');
    return { columns: cached.columns, rows: cached.rows, rowCount: cached.rows.length, truncated: cached.truncated, executedAt: cached.executedAt, elapsedMs: cached.elapsedMs, resultId, pageSize: cached.rows.length, hasMore: false };
  }

  /**
   * Streams a cached result as CSV without serializing every row back to the
   * renderer as JSON. The cache already owns the rows; this keeps export
   * memory bounded to one CSV line at a time on the HTTP response path.
   */
  async streamResultCsv(resultId: string, write: (chunk: string) => Promise<void>): Promise<{ rowCount: number; truncated: boolean }> {
    this.purgeResultCache();
    const cached = this.touchResult(resultId);
    if (!cached) throw new Error('分析結果の一時キャッシュが期限切れです。もう一度セルを実行してください。');
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    await write(`\ufeff${cached.columns.map(escape).join(',')}\r\n`);
    for (const row of cached.rows) {
      await write(`${cached.columns.map((column) => escape(row[column])).join(',')}\r\n`);
    }
    return { rowCount: cached.rows.length, truncated: cached.truncated };
  }

  private async materializeNamedResults(connection: any, namedResults: AnalysisNamedResult[] = []): Promise<string[]> {
    const tables: string[] = [];
    for (const item of namedResults.slice(0, 32)) {
      const table = normalizeResultName(item.name);
      const columns = Array.from(new Set((item.columns || []).map(String))).slice(0, 128);
      if (!columns.length) continue;
      await connection.run(`DROP TABLE IF EXISTS \"${table}\"`);
      const cachedRows = item.resultId ? this.touchResult(item.resultId)?.rows : undefined;
      if (item.resultId && !cachedRows) throw new Error('上流SQL結果の一時キャッシュが期限切れです。上流セルをもう一度実行してください。');
      const sourceRows = (cachedRows || item.rows || []).slice(0, MAX_NAMED_RESULT_ROWS);
      const schema = columns.map((column) => `\"${column.replaceAll('\"', '\"\"')}\" ${inferredDuckType(sourceRows, column)}`).join(', ');
      await connection.run(`CREATE TEMP TABLE \"${table}\" (${schema})`);
      const rows = sourceRows;
      for (let index = 0; index < rows.length; index += 100) {
        const values = rows.slice(index, index + 100).map((row) => `(${columns.map((column) => quote(row[column])).join(',')})`).join(',');
        if (values) await connection.run(`INSERT INTO \"${table}\" VALUES ${values}`);
      }
      tables.push(table);
    }
    return tables;
  }

  /**
   * Executes a cross-tab pivot entirely inside DuckDB.  Unlike the legacy
   * renderer implementation, this never sends the source rows to React.  The
   * source result is materialized once, the distinct column labels are bounded,
   * then the generated aggregate query runs over that same temporary table.
   */
  async pivot(transform: AnalysisPivotTransform, namedSource: AnalysisNamedResult): Promise<AnalysisQueryResult> {
    const columns = Array.from(new Set((namedSource?.columns || []).map(String))).slice(0, 128);
    const rowName = String(transform?.rowColumn || '');
    const columnName = String(transform?.columnColumn || '');
    const valueName = String(transform?.valueColumn || '');
    const aggregation = transform?.aggregation === 'sum' || transform?.aggregation === 'average' ? transform.aggregation : 'count';
    if (!rowName || !columnName || !columns.includes(rowName) || !columns.includes(columnName)) {
      throw new Error('クロスタブPivotの行項目と列項目を選択してください。');
    }
    if (aggregation !== 'count' && (!valueName || !columns.includes(valueName))) {
      throw new Error('合計・平均のクロスタブPivotでは数値列を選択してください。');
    }

    const connection = await this.openExecutionConnection();
    const startedAt = Date.now();
    let tempTables: string[] = [];
    try {
      tempTables = await this.materializeNamedResults(connection, [namedSource]);
      const table = normalizeResultName(namedSource.name);
      const row = `COALESCE(CAST("${rowName.replaceAll('"', '""')}" AS VARCHAR), '(空欄)')`;
      const column = `COALESCE(CAST("${columnName.replaceAll('"', '""')}" AS VARCHAR), '(空欄)')`;
      const discovered = await connection.runAndReadAll(`SELECT DISTINCT ${column} AS pivot_value FROM "${table}" ORDER BY pivot_value LIMIT 65`);
      const labels = (discovered.getRows?.() || []).map((item: any[]) => String(normalizeScalar(item[0]) ?? '(空欄)'));
      if (labels.length > 64) {
        throw new Error('クロスタブPivotの列項目は64件までです。フィルターで列項目を絞り込んでください。');
      }
      const value = valueName ? `TRY_CAST("${valueName.replaceAll('"', '""')}" AS DOUBLE)` : '';
      const metrics = labels.map((label: string) => {
        const labelLiteral = quote(label);
        const alias = `"${label.replaceAll('"', '""')}"`;
        if (aggregation === 'count') return `COUNT(*) FILTER (WHERE ${column} = ${labelLiteral}) AS ${alias}`;
        if (aggregation === 'sum') return `SUM(CASE WHEN ${column} = ${labelLiteral} THEN COALESCE(${value}, 0) ELSE 0 END) AS ${alias}`;
        return `AVG(CASE WHEN ${column} = ${labelLiteral} THEN ${value} ELSE NULL END) AS ${alias}`;
      });
      const query = `SELECT ${row} AS "${rowName.replaceAll('"', '""')}", ${metrics.join(', ')} FROM "${table}" GROUP BY ${row} ORDER BY ${row}`;
      const result = await connection.runAndReadAll(`SELECT * FROM (${query}) AS analysis_result LIMIT ${MAX_QUERY_ROWS + 1}`);
      const resultColumns = (result.columnNames?.() || []).map(String);
      const values = result.getRows?.() || [];
      const truncated = values.length > MAX_QUERY_ROWS;
      const allRows = values.slice(0, MAX_QUERY_ROWS).map((valueRow: any[]) => Object.fromEntries(resultColumns.map((key: string, index: number) => [key, normalizeScalar(valueRow[index])])));
      const executedAt = new Date().toISOString();
      const elapsedMs = Date.now() - startedAt;
      const resultId = this.cacheResult(resultColumns, allRows, executedAt, elapsedMs, truncated);
      return { columns: resultColumns, rows: allRows.slice(0, RESULT_PAGE_SIZE), rowCount: allRows.length, truncated, executedAt, elapsedMs, resultId, pageSize: RESULT_PAGE_SIZE, hasMore: allRows.length > RESULT_PAGE_SIZE };
    } finally {
      for (const table of tempTables) {
        try { await connection.run(`DROP TABLE IF EXISTS "${table}"`); } catch {}
      }
      await this.closeExecutionConnection(connection);
    }
  }

  async query(sql: string, parameters: AnalysisParameter[] = [], namedResults: AnalysisNamedResult[] = []): Promise<AnalysisQueryResult> {
    const query = readOnlySql(sql, parameters);
    const connection = await this.openExecutionConnection();
    const startedAt = Date.now();
    let tempTables: string[] = [];
    try {
      tempTables = await this.materializeNamedResults(connection, namedResults);
      const result = await connection.runAndReadAll(`SELECT * FROM (${query}) AS analysis_result LIMIT ${MAX_QUERY_ROWS + 1}`);
      const columns = (result.columnNames?.() || []).map(String);
      const values = result.getRows?.() || [];
      const truncated = values.length > MAX_QUERY_ROWS;
      const allRows = values.slice(0, MAX_QUERY_ROWS).map((valueRow: any[]) => Object.fromEntries(columns.map((column: string, index: number) => [column, normalizeScalar(valueRow[index])])));
      const executedAt = new Date().toISOString();
      const elapsedMs = Date.now() - startedAt;
      const resultId = this.cacheResult(columns, allRows, executedAt, elapsedMs, truncated);
      return { columns, rows: allRows.slice(0, RESULT_PAGE_SIZE), rowCount: allRows.length, truncated, executedAt, elapsedMs, resultId, pageSize: RESULT_PAGE_SIZE, hasMore: allRows.length > RESULT_PAGE_SIZE };
    } finally {
      for (const table of tempTables) {
        try { await connection.run(`DROP TABLE IF EXISTS "${table}"`); } catch {}
      }
      await this.closeExecutionConnection(connection);
    }
  }

  private normalizeCells(input: AnalysisNotebook): AnalysisCell[] {
    const candidate = Array.isArray(input.cells) ? input.cells : [];
    const names = new Set<string>();
    const valid = candidate.filter((cell: any) => cell && (cell.type === 'sql' || cell.type === 'markdown' || cell.type === 'parameter' || cell.type === 'variable' || cell.type === 'section' || cell.type === 'dataframe' || cell.type === 'function' || cell.type === 'pivot' || cell.type === 'summary' || cell.type === 'quality' || cell.type === 'preprocess' || cell.type === 'import' || cell.type === 'chart'))
      .map((cell: any, index: number) => {
        if (cell.type === 'sql') return { id: String(cell.id || `sql-${index}`), type: 'sql' as const, sql: String(cell.sql || ''), chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, outputName: String(cell.outputName || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48) };
        if (cell.type === 'dataframe') { const transform = cell.transform || {}; return { id: String(cell.id || `dataframe-${index}`), type: 'dataframe' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, transform: { sourceCellId: String(transform.sourceCellId || ''), outputName: String(transform.outputName || `frame_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), operation: ['filter','select','sort','limit'].includes(transform.operation) ? transform.operation : 'filter', column: String(transform.column || ''), operator: ['equals','contains','notEmpty','greaterThan','lessThan'].includes(transform.operator) ? transform.operator : 'contains', value: String(transform.value || ''), columns: Array.isArray(transform.columns) ? transform.columns.map(String).slice(0, 128) : [], direction: transform.direction === 'desc' ? 'desc' : 'asc', limit: Math.max(1, Math.min(MAX_QUERY_ROWS, Number(transform.limit || 100))) } }; }
        if (cell.type === 'pivot') { const pivot = cell.pivot || {}; return { id: String(cell.id || `pivot-${index}`), type: 'pivot' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, pivot: { sourceCellId: String(pivot.sourceCellId || ''), rowColumn: String(pivot.rowColumn || ''), columnColumn: String(pivot.columnColumn || ''), valueColumn: String(pivot.valueColumn || ''), aggregation: ['count','sum','average'].includes(pivot.aggregation) ? pivot.aggregation : 'count', outputName: String(pivot.outputName || `pivot_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48) } }; }
        if (cell.type === 'summary') { const summary = cell.summary || {}; return { id: String(cell.id || `summary-${index}`), type: 'summary' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, summary: { sourceCellId: String(summary.sourceCellId || ''), outputName: String(summary.outputName || `summary_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), numericColumn: String(summary.numericColumn || ''), groupColumn: String(summary.groupColumn || '') } }; }
        if (cell.type === 'quality') { const quality = cell.quality || {}; return { id: String(cell.id || `quality-${index}`), type: 'quality' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, quality: { sourceCellId: String(quality.sourceCellId || ''), outputName: String(quality.outputName || `quality_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), columns: Array.isArray(quality.columns) ? quality.columns.map(String).slice(0, 128) : [], checkMissing: quality.checkMissing !== false, checkDuplicates: quality.checkDuplicates !== false, checkNonNumeric: quality.checkNonNumeric === true } }; }
        if (cell.type === 'function') { const transform = cell.transform || {}; const operations = ['yearOverYear','movingAverage','cumulative','shareOfTotal','rank','fillMissing','excludeOutliers','join','unpivot','splitText','dateDiff','conditionalColumn','formula','dropDuplicates','renameColumn','correlation','linearRegression','tTest','chiSquare','anova']; return { id: String(cell.id || `function-${index}`), type: 'function' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, transform: { sourceCellId: String(transform.sourceCellId || ''), outputName: String(transform.outputName || `function_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), operation: operations.includes(transform.operation) ? transform.operation : 'movingAverage', valueColumn: String(transform.valueColumn || ''), periodColumn: String(transform.periodColumn || ''), groupColumn: String(transform.groupColumn || ''), outputColumn: String(transform.outputColumn || ''), windowSize: Math.max(2, Math.min(120, Number(transform.windowSize || 3)),), joinSourceCellId: String(transform.joinSourceCellId || ''), joinLeftColumn: String(transform.joinLeftColumn || ''), joinRightColumn: String(transform.joinRightColumn || ''), joinType: transform.joinType === 'inner' ? 'inner' : 'left', valueColumns: Array.isArray(transform.valueColumns) ? transform.valueColumns.map(String).slice(0,128) : [], delimiter: String(transform.delimiter ?? ','), splitIndex: Math.max(0, Math.min(100, Number(transform.splitIndex || 0))), secondColumn: String(transform.secondColumn || ''), conditionOperator: ['equals','contains','greaterThan','lessThan','notEmpty'].includes(transform.conditionOperator) ? transform.conditionOperator : 'equals', conditionValue: String(transform.conditionValue || ''), trueValue: String(transform.trueValue || ''), falseValue: String(transform.falseValue || ''), formulaKind: ['arithmetic','round','absolute','year','month','coalesce','dateDiff','ifGreater'].includes(transform.formulaKind) ? transform.formulaKind : 'arithmetic', formulaOperator: ['add','subtract','multiply','divide'].includes(transform.formulaOperator) ? transform.formulaOperator : 'add', formulaValue: String(transform.formulaValue || ''), renameTo: String(transform.renameTo || '') } }; }
        if (cell.type === 'preprocess') { const preprocess = cell.preprocess || {}; const operations = ['removeDuplicates','handleMissing','trimText','normalizeText','coerceNumber','coerceDate','replaceValues','excludeOutliers']; return { id: String(cell.id || `preprocess-${index}`), type: 'preprocess' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, preprocess: { sourceCellId: String(preprocess.sourceCellId || ''), outputName: String(preprocess.outputName || `prep_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), operation: operations.includes(preprocess.operation) ? preprocess.operation : 'removeDuplicates', columns: Array.isArray(preprocess.columns) ? preprocess.columns.map(String).slice(0, 128) : [], column: String(preprocess.column || ''), missingStrategy: ['dropRows','custom','zero','mean','median','forwardFill'].includes(preprocess.missingStrategy) ? preprocess.missingStrategy : 'custom', fillValue: String(preprocess.fillValue ?? ''), invalidAction: preprocess.invalidAction === 'dropRows' ? 'dropRows' : 'null', findValue: String(preprocess.findValue ?? ''), replaceValue: String(preprocess.replaceValue ?? ''), outlierMethod: preprocess.outlierMethod === 'threeSigma' ? 'threeSigma' : 'iqr' } }; }
        if (cell.type === 'import') { const imported = cell.imported || {}; const columns = Array.isArray(imported.columns) ? imported.columns.map(String).slice(0, 128) : []; const rows = Array.isArray(imported.rows) ? imported.rows.slice(0, MAX_IMPORT_ROWS).filter((row: any) => row && typeof row === 'object').map((row: any) => Object.fromEntries(columns.map((column: string) => [column, row[column] ?? null]))) : []; return { id: String(cell.id || `import-${index}`), type: 'import' as const, chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'table' }, imported: { sourceName: String(imported.sourceName || ''), columns, rows, truncated: imported.truncated === true, outputName: String(imported.outputName || `import_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48), importedAt: imported.importedAt ? String(imported.importedAt) : '' } }; }
        if (cell.type === 'chart') return { id: String(cell.id || `chart-${index}`), type: 'chart' as const, sourceCellId: String(cell.sourceCellId || ''), chart: cell.chart && typeof cell.chart === 'object' ? cell.chart : { type: 'bar' } };
        if (cell.type === 'section') return { id: String(cell.id || `section-${index}`), type: 'section' as const, title: String(cell.title || 'セクション').slice(0, 160), description: String(cell.description || '').slice(0, 500), collapsed: cell.collapsed === true };
        if (cell.type === 'markdown') return { id: String(cell.id || `markdown-${index}`), type: 'markdown' as const, content: String(cell.content || '') };
        const rawName = String((cell.type === 'variable' ? cell.variable?.name : cell.parameter?.name) || `${cell.type === 'variable' ? 'variable' : 'parameter'}_${index + 1}`).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48) || `${cell.type === 'variable' ? 'variable' : 'parameter'}_${index + 1}`;
        const name = names.has(rawName) ? `${rawName}_${index + 1}` : rawName;
        names.add(name);
        const raw = cell.type === 'variable' ? cell.variable : cell.parameter;
        const type = ['text', 'number', 'date', 'select'].includes(raw?.type) ? raw.type : 'text';
        const options = Array.isArray(raw?.options) ? raw.options.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 100) : [];
        const normalizedParameter = { name, label: String(raw?.label || name).slice(0, 120), type, value: String(raw?.value || '').slice(0, 1000), options };
        return cell.type === 'variable' ? { id: String(cell.id || `variable-${index}`), type: 'variable' as const, variable: normalizedParameter } : { id: String(cell.id || `parameter-${index}`), type: 'parameter' as const, parameter: normalizedParameter };
      }) as unknown as AnalysisCell[];
    if (valid.length) return valid;
    return [{ id: 'sql-1', type: 'sql', sql: String(input.sql || ''), chart: input.chart && typeof input.chart === 'object' ? input.chart : { type: 'table' } }];
  }

  private normalizeExecutionHistory(raw: unknown): Record<string, AnalysisCellExecution[]> {
    if (!raw || typeof raw !== 'object') return {};
    const output: Record<string, AnalysisCellExecution[]> = {};
    for (const [cellId, records] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(records)) continue;
      const normalized = records.slice(0, 12).flatMap((record: any) => {
        if (!record || typeof record !== 'object' || !record.executedAt) return [];
        return [{
          executedAt: String(record.executedAt),
          elapsedMs: Math.max(0, Number(record.elapsedMs) || 0),
          rowCount: Math.max(0, Number(record.rowCount) || 0),
          truncated: record.truncated === true,
          cellSignature: String(record.cellSignature || ''),
          parameterSignature: String(record.parameterSignature || ''),
          dependencySignatures: record.dependencySignatures && typeof record.dependencySignatures === 'object' ? Object.fromEntries(Object.entries(record.dependencySignatures).slice(0, 64).map(([key, value]) => [String(key), String(value)])) : {},
          sourceSyncedAt: record.sourceSyncedAt ? String(record.sourceSyncedAt) : null,
        } as AnalysisCellExecution];
      });
      if (normalized.length) output[String(cellId)] = normalized;
    }
    return output;
  }

  private normalizeSnapshots(raw: unknown): Record<string, AnalysisCellSnapshot[]> {
    if (!raw || typeof raw !== 'object') return {};
    const output: Record<string, AnalysisCellSnapshot[]> = {};
    for (const [cellId, items] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      const snapshots = items.slice(0, 8).flatMap((item: any) => {
        if (!item || typeof item !== 'object' || !item.createdAt || !Array.isArray(item.columns) || !Array.isArray(item.rows)) return [];
        const columns = item.columns.map(String).slice(0, 128);
        return [{ id: String(item.id || `${cellId}-${item.createdAt}`), createdAt: String(item.createdAt), label: String(item.label || 'スナップショット').slice(0, 120), rowCount: Math.max(0, Number(item.rowCount) || 0), columns, rows: item.rows.slice(0, 1000).filter((row: any) => row && typeof row === 'object').map((row: any) => Object.fromEntries(columns.map((column: string) => [column, row[column] ?? null]))), truncated: item.truncated === true, execution: item.execution && typeof item.execution === 'object' ? item.execution as AnalysisCellExecution : undefined } as AnalysisCellSnapshot];
      });
      if (snapshots.length) output[String(cellId)] = snapshots;
    }
    return output;
  }

  private hydrateNotebook(row: any): AnalysisNotebook {
    const chart = JSON.parse(row.chartJson || '{}');
    let cells: AnalysisCell[] = [];
    let executionHistory: Record<string, AnalysisCellExecution[]> = {};
    let snapshots: Record<string, AnalysisCellSnapshot[]> = {};
    try { cells = JSON.parse(row.cellsJson || '[]'); } catch {}
    try { executionHistory = this.normalizeExecutionHistory(JSON.parse(row.executionHistoryJson || '{}')); } catch {}
    try { snapshots = this.normalizeSnapshots(JSON.parse(row.snapshotsJson || '{}')); } catch {}
    const base: AnalysisNotebook = { ...row, chart, cells, executionHistory, snapshots, sql: String(row.sql || ''), createdAt: row.createdAt, updatedAt: row.updatedAt };
    return { ...base, cells: this.normalizeCells(base) };
  }

  /**
   * Sidebar/list reads intentionally avoid cells_json, execution_history_json and snapshots_json.
   * Those fields can be very large and are only needed after a notebook is opened.
   */
  listNotebooks(): AnalysisNotebookSummary[] {
    return (this.db.prepare(`SELECT id, title, description, created_at AS createdAt, updated_at AS updatedAt FROM analysis_notebooks ORDER BY updated_at DESC`).all() as any[])
      .map((row) => ({
        id: String(row.id),
        title: String(row.title || '無題の分析'),
        description: String(row.description || ''),
        createdAt: String(row.createdAt || ''),
        updatedAt: String(row.updatedAt || ''),
      }));
  }

  getNotebook(id: string): AnalysisNotebook | null {
    const row = this.db.prepare(`SELECT id, title, description, sql_text AS sql, chart_json AS chartJson, cells_json AS cellsJson, execution_history_json AS executionHistoryJson, snapshots_json AS snapshotsJson, created_at AS createdAt, updated_at AS updatedAt FROM analysis_notebooks WHERE id = ?`).get(id) as any;
    return row ? this.hydrateNotebook(row) : null;
  }

  saveNotebook(input: AnalysisNotebook): AnalysisNotebook {
    const now = new Date().toISOString();
    const existing = this.getNotebook(input.id);
    const cells = this.normalizeCells(input);
    const firstSql = cells.find((cell): cell is Extract<AnalysisCell, { type: 'sql' }> => cell.type === 'sql');
    const notebook: AnalysisNotebook = {
      ...input,
      sql: firstSql?.sql || String(input.sql || ''),
      chart: firstSql?.chart || input.chart || { type: 'table' },
      cells,
      executionHistory: this.normalizeExecutionHistory(input.executionHistory || {}),
      snapshots: this.normalizeSnapshots(input.snapshots || {}),
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: now,
    };
    this.db.prepare(`INSERT INTO analysis_notebooks (id,title,description,sql_text,chart_json,cells_json,execution_history_json,snapshots_json,created_at,updated_at) VALUES (@id,@title,@description,@sql,@chartJson,@cellsJson,@executionHistoryJson,@snapshotsJson,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, sql_text=excluded.sql_text, chart_json=excluded.chart_json, cells_json=excluded.cells_json, execution_history_json=excluded.execution_history_json, snapshots_json=excluded.snapshots_json, updated_at=excluded.updated_at`)
      .run({ ...notebook, chartJson: JSON.stringify(notebook.chart || {}), cellsJson: JSON.stringify(cells), executionHistoryJson: JSON.stringify(notebook.executionHistory || {}), snapshotsJson: JSON.stringify(notebook.snapshots || {}) });
    return notebook;
  }

  listDashboardPins(): AnalysisDashboardPin[] {
    return (this.db.prepare(`SELECT id, notebook_id AS notebookId, notebook_title AS notebookTitle, cell_id AS cellId, cell_title AS cellTitle, chart_json AS chartJson, columns_json AS columnsJson, rows_json AS rowsJson, row_count AS rowCount, truncated, captured_at AS capturedAt, source_synced_at AS sourceSyncedAt FROM analysis_dashboard_pins ORDER BY updated_at DESC`).all() as any[]).map((row) => ({
      ...row,
      chart: JSON.parse(row.chartJson || '{}'),
      columns: JSON.parse(row.columnsJson || '[]'),
      rows: JSON.parse(row.rowsJson || '[]'),
      truncated: Boolean(row.truncated),
    }));
  }

  saveDashboardPin(input: AnalysisDashboardPin): AnalysisDashboardPin {
    const now = new Date().toISOString();
    const pin: AnalysisDashboardPin = {
      ...input,
      id: String(input.id || `${input.notebookId}:${input.cellId}`),
      notebookTitle: String(input.notebookTitle || '無題の分析').slice(0, 160),
      cellTitle: String(input.cellTitle || '分析セル').slice(0, 120),
      columns: Array.isArray(input.columns) ? input.columns.map(String).slice(0, 128) : [],
      rows: Array.isArray(input.rows) ? input.rows.slice(0, 300) : [],
      rowCount: Math.max(0, Number(input.rowCount) || 0),
      truncated: input.truncated === true,
      capturedAt: input.capturedAt || now,
      sourceSyncedAt: input.sourceSyncedAt || null,
    };
    this.db.prepare(`INSERT INTO analysis_dashboard_pins (id,notebook_id,notebook_title,cell_id,cell_title,chart_json,columns_json,rows_json,row_count,truncated,captured_at,source_synced_at,created_at,updated_at) VALUES (@id,@notebookId,@notebookTitle,@cellId,@cellTitle,@chartJson,@columnsJson,@rowsJson,@rowCount,@truncated,@capturedAt,@sourceSyncedAt,@createdAt,@updatedAt) ON CONFLICT(notebook_id,cell_id) DO UPDATE SET notebook_title=excluded.notebook_title,cell_title=excluded.cell_title,chart_json=excluded.chart_json,columns_json=excluded.columns_json,rows_json=excluded.rows_json,row_count=excluded.row_count,truncated=excluded.truncated,captured_at=excluded.captured_at,source_synced_at=excluded.source_synced_at,updated_at=excluded.updated_at`).run({ ...pin, chartJson: JSON.stringify(pin.chart || {}), columnsJson: JSON.stringify(pin.columns), rowsJson: JSON.stringify(pin.rows), createdAt: now, updatedAt: now, truncated: pin.truncated ? 1 : 0 });
    return pin;
  }

  deleteDashboardPin(id: string): { ok: true } {
    this.db.prepare('DELETE FROM analysis_dashboard_pins WHERE id = ?').run(id);
    return { ok: true };
  }

  deleteNotebook(id: string): { ok: true } {
    this.db.prepare('DELETE FROM analysis_dashboard_pins WHERE notebook_id = ?').run(id);
    this.db.prepare('DELETE FROM analysis_notebooks WHERE id = ?').run(id);
    return { ok: true };
  }
}
