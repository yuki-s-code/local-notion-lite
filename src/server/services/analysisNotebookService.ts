import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import type { Db } from '../db/sqlite';
import type { AnalysisCell, AnalysisCellExecution, AnalysisCellSnapshot, AnalysisDashboardPin, AnalysisDataDictionary, AnalysisNamedResult, AnalysisNotebook, AnalysisParameter, AnalysisQueryResult, AnalysisStatus, AnalysisWorkspaceSettings, AnalysisMetricDefinition, AnalysisColumnMeaning } from '../../shared/analysisTypes';

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
const MAX_TEXT_CHARS = 12_000;
const SYNC_LIMITS = { pages: 20_000, database_rows: 60_000, databases: 2_000, journals: 10_000, tasks: 8_000 } as const;


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
  /** SQL result cache: keeps full rows server-side so the renderer receives only pages. */
  private readonly resultCache = new Map<string, { columns: string[]; rows: Array<Record<string, unknown>>; createdAt: number; executedAt: string; elapsedMs: number; truncated: boolean }>();

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
    if (!rows.length) return;
    // Keep each generated statement bounded. Page bodies and OCR text can be large,
    // and a single monolithic INSERT would block the local API on bigger workspaces.
    const batchSize = 200;
    for (let index = 0; index < rows.length; index += batchSize) {
      const values = rows.slice(index, index + batchSize)
        .map((row) => `(${columns.map((key) => quote(row[key])).join(', ')})`)
        .join(',');
      await connection.run(`INSERT INTO ${table} VALUES ${values}`);
    }
  }

  private sourceFingerprint(): string {
    const sources = [
      ['pages', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM pages WHERE COALESCE(trashed, 0) = 0`],
      ['database_rows', `SELECT COUNT(*) AS count, COALESCE(MAX(r.updated_at), '') AS latest FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE COALESCE(d.trashed, 0) = 0`],
      ['databases', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM database_summary_index WHERE COALESCE(trashed, 0) = 0`],
      ['journals', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM journal_summary_index`],
      ['tasks', `SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS latest FROM task_index`],
    ] as const;
    return sources.map(([name, sql]) => {
      const row = this.db.prepare(sql).get() as { count?: number; latest?: string } | undefined;
      return `${name}:${Number(row?.count || 0)}:${String(row?.latest || '')}`;
    }).join('|');
  }

  async sync(): Promise<AnalysisStatus> {
    const connection = await this.ensureDuckDb();
    const fingerprint = this.sourceFingerprint();
    const previousFingerprint = (this.db.prepare(`SELECT value FROM analysis_notebook_meta WHERE key = 'source_fingerprint'`).get() as { value?: string } | undefined)?.value || '';
    // Fast path: if the source indexes did not change, do not rebuild the DuckDB cache.
    // This is intentionally conservative: a changed count or latest timestamp always triggers a full safe rebuild.
    if (previousFingerprint && previousFingerprint === fingerprint && this.lastSyncedAt) {
      this.db.prepare(`INSERT INTO analysis_notebook_meta (key, value) VALUES ('last_sync_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run('unchanged');
      return this.status();
    }
    // Analysis must never include items in the Trash. Filter at the SQLite source
    // and recreate the DuckDB tables on every sync, so a previously synced deleted
    // page/database/row is removed from analysis.duckdb on the next sync as well.
    // Keep the synchronization cache under approximately 100,000 records in total.
    // Newest records are retained first. Base quotas preserve a useful mix of data;
    // any unused quota is then reassigned, so a database-row-only workspace can still
    // use the full 100,000-row budget.
    const sourceCounts = {
      pages: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM pages WHERE COALESCE(trashed, 0) = 0`).get() as any)?.count || 0),
      database_rows: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM database_row_index r INNER JOIN database_summary_index d ON d.database_id = r.database_id WHERE COALESCE(d.trashed, 0) = 0`).get() as any)?.count || 0),
      databases: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM database_summary_index WHERE COALESCE(trashed, 0) = 0`).get() as any)?.count || 0),
      journals: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM journal_summary_index`).get() as any)?.count || 0),
      tasks: Number((this.db.prepare(`SELECT COUNT(*) AS count FROM task_index`).get() as any)?.count || 0),
    };
    const syncLimits: Record<keyof typeof sourceCounts, number> = {
      pages: Math.min(sourceCounts.pages, SYNC_LIMITS.pages),
      database_rows: Math.min(sourceCounts.database_rows, SYNC_LIMITS.database_rows),
      databases: Math.min(sourceCounts.databases, SYNC_LIMITS.databases),
      journals: Math.min(sourceCounts.journals, SYNC_LIMITS.journals),
      tasks: Math.min(sourceCounts.tasks, SYNC_LIMITS.tasks),
    };
    let remainingRows = MAX_SYNC_ROWS - Object.values(syncLimits).reduce((sum, count) => sum + count, 0);
    for (const dataset of ['database_rows', 'pages', 'journals', 'tasks', 'databases'] as Array<keyof typeof sourceCounts>) {
      if (remainingRows <= 0) break;
      const additional = Math.min(remainingRows, Math.max(0, sourceCounts[dataset] - syncLimits[dataset]));
      syncLimits[dataset] += additional;
      remainingRows -= additional;
    }
    const pageRows = this.sqliteRows(`
      SELECT id, title, parent_id AS parent_id, icon, created_at, updated_at, updated_by,
             favorite, trashed, substr(markdown, 1, ${MAX_TEXT_CHARS}) AS markdown, properties_json
      FROM pages
      WHERE COALESCE(trashed, 0) = 0
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT ${syncLimits.pages}
    `);
    const databaseRows = this.sqliteRows(`
      SELECT r.database_id, r.row_id, r.row_order, r.title_text, r.search_text,
             r.cells_json, r.created_at, r.updated_at
      FROM database_row_index r
      INNER JOIN database_summary_index d ON d.database_id = r.database_id
      WHERE COALESCE(d.trashed, 0) = 0
      ORDER BY datetime(r.updated_at) DESC, r.row_id DESC
      LIMIT ${syncLimits.database_rows}
    `);
    const databaseMeta = this.sqliteRows(`
      SELECT database_id, title, scope, created_at, updated_at, row_count, properties_json, views_json
      FROM database_summary_index
      WHERE COALESCE(trashed, 0) = 0
      ORDER BY datetime(updated_at) DESC, database_id DESC
      LIMIT ${syncLimits.databases}
    `);
    const journalRows = this.sqliteRows(`
      SELECT date, title, icon, updated_at, preview_snippet, mood, weather, tags_json,
             substr(full_text, 1, ${MAX_TEXT_CHARS}) AS full_text
      FROM journal_summary_index
      ORDER BY date DESC
      LIMIT ${syncLimits.journals}
    `);
    const taskRows = this.sqliteRows(`
      SELECT id, source_type, source_id, source_title, source_icon, text, completed, due_date, line_index, context, updated_at
      FROM task_index
      ORDER BY CASE WHEN completed = 0 THEN 0 ELSE 1 END, datetime(updated_at) DESC, id DESC
      LIMIT ${syncLimits.tasks}
    `);

    await this.replaceTable(connection, 'pages', ['id','title','parent_id','icon','created_at','updated_at','updated_by','favorite','trashed','markdown','properties_json'], pageRows);
    await this.replaceTable(connection, 'database_rows', ['database_id','row_id','row_order','title_text','search_text','cells_json','created_at','updated_at'], databaseRows);
    await this.replaceTable(connection, 'databases', ['database_id','title','scope','created_at','updated_at','row_count','properties_json','views_json'], databaseMeta);
    await this.replaceTable(connection, 'journals', ['date','title','icon','updated_at','preview_snippet','mood','weather','tags_json','full_text'], journalRows);
    await this.replaceTable(connection, 'tasks', ['id','source_type','source_id','source_title','source_icon','text','completed','due_date','line_index','context','updated_at'], taskRows);
    // Lightweight indexes for the fields used most often by the wizard and examples.
    for (const statement of [
      'CREATE INDEX IF NOT EXISTS analysis_pages_updated_idx ON pages(updated_at)',
      'CREATE INDEX IF NOT EXISTS analysis_rows_database_idx ON database_rows(database_id)',
      'CREATE INDEX IF NOT EXISTS analysis_rows_updated_idx ON database_rows(updated_at)',
      'CREATE INDEX IF NOT EXISTS analysis_journals_date_idx ON journals(date)',
      'CREATE INDEX IF NOT EXISTS analysis_tasks_due_idx ON tasks(due_date)',
    ]) { try { await connection.run(statement); } catch {} }

    this.lastSyncedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO analysis_notebook_meta (key, value) VALUES ('last_synced_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(this.lastSyncedAt);
    this.db.prepare(`INSERT INTO analysis_notebook_meta (key, value) VALUES ('source_fingerprint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(fingerprint);
    this.db.prepare(`INSERT INTO analysis_notebook_meta (key, value) VALUES ('last_sync_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run('rebuilt');
    return this.status();
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
      lastSyncMode: lastSyncMode === 'rebuilt' || lastSyncMode === 'unchanged' ? lastSyncMode : null,
      datasets: [
        { name: 'pages', rows: counts.pages || 0, description: '通常ページとプロパティ' },
        { name: 'databases', rows: counts.databases || 0, description: 'データベースの定義' },
        { name: 'database_rows', rows: counts.database_rows || 0, description: 'データベース行とセルJSON' },
        { name: 'journals', rows: counts.journals || 0, description: 'Journal全文・タグ・気分・天気' },
        { name: 'tasks', rows: counts.tasks || 0, description: 'ページ・Journal・Inboxから抽出したタスク' },
      ],
      limits: { syncRows: MAX_SYNC_ROWS, previewRows: MAX_QUERY_ROWS },
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
            { name: 'markdown', type: 'TEXT', description: '本文（最大60,000文字）' },
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
            { name: 'full_text', type: 'TEXT', description: '本文全文（最大60,000文字）' },
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
      ],
    };
  }

  private purgeResultCache(): void {
    const now = Date.now();
    for (const [id, entry] of this.resultCache) {
      if (now - entry.createdAt > RESULT_CACHE_TTL_MS) this.resultCache.delete(id);
    }
    while (this.resultCache.size > MAX_RESULT_CACHES) {
      const oldest = this.resultCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resultCache.delete(oldest);
    }
  }

  private cacheResult(columns: string[], rows: Array<Record<string, unknown>>, executedAt: string, elapsedMs: number, truncated: boolean): string {
    this.purgeResultCache();
    const id = randomUUID();
    this.resultCache.set(id, { columns, rows, createdAt: Date.now(), executedAt, elapsedMs, truncated });
    this.purgeResultCache();
    return id;
  }

  getResultPage(resultId: string, page = 0, pageSize = RESULT_PAGE_SIZE): AnalysisQueryResult {
    this.purgeResultCache();
    const cached = this.resultCache.get(String(resultId || ''));
    if (!cached) throw new Error('分析結果の一時キャッシュが期限切れです。もう一度セルを実行してください。');
    const safePageSize = Math.max(50, Math.min(2_000, Number(pageSize) || RESULT_PAGE_SIZE));
    const safePage = Math.max(0, Number(page) || 0);
    const start = safePage * safePageSize;
    const rows = cached.rows.slice(start, start + safePageSize);
    return { columns: cached.columns, rows, rowCount: cached.rows.length, truncated: cached.truncated, executedAt: cached.executedAt, elapsedMs: cached.elapsedMs, resultId, pageSize: safePageSize, hasMore: start + rows.length < cached.rows.length };
  }

  getResultAll(resultId: string): AnalysisQueryResult {
    this.purgeResultCache();
    const cached = this.resultCache.get(String(resultId || ''));
    if (!cached) throw new Error('分析結果の一時キャッシュが期限切れです。もう一度セルを実行してください。');
    return { columns: cached.columns, rows: cached.rows, rowCount: cached.rows.length, truncated: cached.truncated, executedAt: cached.executedAt, elapsedMs: cached.elapsedMs, resultId, pageSize: cached.rows.length, hasMore: false };
  }

  private async materializeNamedResults(connection: any, namedResults: AnalysisNamedResult[] = []): Promise<string[]> {
    const tables: string[] = [];
    for (const item of namedResults.slice(0, 32)) {
      const table = normalizeResultName(item.name);
      const columns = Array.from(new Set((item.columns || []).map(String))).slice(0, 128);
      if (!columns.length) continue;
      await connection.run(`DROP TABLE IF EXISTS \"${table}\"`);
      const cachedRows = item.resultId ? this.resultCache.get(item.resultId)?.rows : undefined;
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

  async query(sql: string, parameters: AnalysisParameter[] = [], namedResults: AnalysisNamedResult[] = []): Promise<AnalysisQueryResult> {
    const query = readOnlySql(sql, parameters);
    const connection = await this.ensureDuckDb();
    const startedAt = Date.now();
    const tempTables = await this.materializeNamedResults(connection, namedResults);
    try {
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
        try { await connection.run(`DROP TABLE IF EXISTS \"${table}\"`); } catch {}
      }
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

  listNotebooks(): AnalysisNotebook[] {
    return (this.db.prepare(`SELECT id, title, description, sql_text AS sql, chart_json AS chartJson, cells_json AS cellsJson, execution_history_json AS executionHistoryJson, snapshots_json AS snapshotsJson, created_at AS createdAt, updated_at AS updatedAt FROM analysis_notebooks ORDER BY updated_at DESC`).all() as any[])
      .map((row) => this.hydrateNotebook(row));
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
