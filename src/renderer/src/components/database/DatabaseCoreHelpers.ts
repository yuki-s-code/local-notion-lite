import type { DatabaseFilterOperator, DatabaseView, WorkspaceDatabase, DatabasePropertyType, PageWithLock, JournalSummary, WorkspaceScope } from '../../../../shared/types';

export function workspaceScope(item?: { scope?: WorkspaceScope } | null): WorkspaceScope { return item?.scope === 'private' ? 'private' : 'shared'; }
export function pageScope(page?: { scope?: WorkspaceScope } | null): WorkspaceScope { return page?.scope === 'private' ? 'private' : 'shared'; }
export function scopeIcon(scope?: WorkspaceScope) { return scope === 'private' ? '🔒' : '🌐'; }

export function dbText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}


export function isFilledDatabaseValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  return dbText(value).trim().length > 0;
}

export function isCheckedDatabaseValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const text = dbText(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'checked', '完了', '済', '済み'].includes(text);
}

export function toDatabaseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = dbText(value).trim().replace(/,/g, '').replace(/%$/, '');
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function formatPercent(done: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((done / total) * 100)}%`;
}

export function getActiveView(database: WorkspaceDatabase): DatabaseView {
  const views = database.views && database.views.length > 0 ? database.views : [{ id: 'view_default', name: 'Default Table', type: 'table' as const, filters: [], sorts: [] }];
  return views.find(view => view.id === database.activeViewId) ?? views[0];
}

export function getBoardGroupProperty(database: WorkspaceDatabase, view?: DatabaseView) {
  const configured = view?.groupByPropertyId
    ? database.properties.find(prop => prop.id === view.groupByPropertyId)
    : undefined;
  if (configured) return configured;

  return (
    database.properties.find(prop => prop.type === 'status') ??
    database.properties.find(prop => prop.type === 'select') ??
    database.properties.find(prop => prop.type === 'checkbox') ??
    database.properties.find(prop => prop.type === 'text') ??
    database.properties[0]
  );
}

export function getDateProperty(database: WorkspaceDatabase, view?: DatabaseView) {
  const configured = view?.datePropertyId
    ? database.properties.find(prop => prop.id === view.datePropertyId && (prop.type === 'date' || isAutomaticTimeProperty(prop.type)))
    : undefined;
  return configured ?? database.properties.find(prop => prop.type === 'date' || isAutomaticTimeProperty(prop.type));
}

export function getTimelineStartProperty(database: WorkspaceDatabase, view?: DatabaseView) {
  const configured = view?.startDatePropertyId
    ? database.properties.find(prop => prop.id === view.startDatePropertyId && (prop.type === 'date' || isAutomaticTimeProperty(prop.type)))
    : undefined;
  return configured ?? getDateProperty(database, view);
}

export function getTimelineEndProperty(database: WorkspaceDatabase, view?: DatabaseView) {
  const configured = view?.endDatePropertyId
    ? database.properties.find(prop => prop.id === view.endDatePropertyId && (prop.type === 'date' || isAutomaticTimeProperty(prop.type)))
    : undefined;
  return configured ?? getTimelineStartProperty(database, view);
}

export function viewIcon(type: DatabaseView['type']) {
  if (type === 'board') return '▥';
  if (type === 'calendar') return '📅';
  if (type === 'gallery') return '▧';
  if (type === 'timeline') return '⟷';
  if (type === 'gantt') return '▰';
  if (type === 'form') return '✦';
  return '▦';
}

export function viewLabel(type: DatabaseView['type']) {
  if (type === 'board') return 'Board';
  if (type === 'calendar') return 'Calendar';
  if (type === 'gallery') return 'Gallery';
  if (type === 'timeline') return 'Timeline';
  if (type === 'gantt') return 'Gantt';
  if (type === 'form') return 'フォーム';
  return 'Table';
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseLocalDate(value: unknown): Date | null {
  const text = dbText(value).trim();
  if (!text) return null;
  const date = /T\d{2}:\d{2}/.test(text) ? new Date(text) : new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAutomaticTimeProperty(type: DatabasePropertyType): boolean {
  return type === 'created_time' || type === 'last_edited_time';
}

/** Returns a human-friendly deadline state only for columns explicitly named as due dates. */
export function getDeadlineStatus(prop: { name: string; type: DatabasePropertyType }, value: unknown): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' } | null {
  if (prop.type !== 'date' || !/(期限|締切|期日|due|deadline)/i.test(prop.name)) return null;
  const date = parseLocalDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return { label: `期限切れ ${Math.abs(diff)}日`, tone: 'overdue' };
  if (diff === 0) return { label: '期限：今日', tone: 'today' };
  if (diff === 1) return { label: '期限：明日', tone: 'soon' };
  if (diff <= 7) return { label: `あと${diff}日`, tone: 'soon' };
  return { label: `あと${diff}日`, tone: 'future' };
}

export function formatDatabaseTimestamp(value: unknown): string {
  const text = dbText(value).trim();
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function databaseCellText(database: WorkspaceDatabase, row: WorkspaceDatabase['rows'][number], prop: WorkspaceDatabase['properties'][number], allDatabases: WorkspaceDatabase[] = []) {
  const value = (prop.type === 'rollup' || prop.type === 'formula')
    ? getComputedCellValue(prop, row, database, allDatabases)
    : row.cells[prop.id];
  return dbText(value);
}

export function isSameDateKey(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function applyAdvancedDatabaseFilter(text: string, rawValue: unknown, operator: DatabaseFilterOperator, target: string) {
  const valueText = text.toLowerCase();
  const targetText = target.toLowerCase();
  const numericValue = toDatabaseNumber(rawValue);
  const numericTarget = toDatabaseNumber(target);
  const dateValue = parseLocalDate(rawValue);
  const dateTarget = parseLocalDate(target);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  if (operator === 'is_empty') return valueText.length === 0;
  if (operator === 'is_not_empty') return valueText.length > 0;
  if (operator === 'equals') return valueText === targetText;
  if (operator === 'not_equals') return valueText !== targetText;
  if (operator === 'not_contains') return !valueText.includes(targetText);
  if (operator === 'starts_with') return valueText.startsWith(targetText);
  if (operator === 'ends_with') return valueText.endsWith(targetText);
  if (operator === 'greater_than') return numericValue !== null && numericTarget !== null && numericValue > numericTarget;
  if (operator === 'less_than') return numericValue !== null && numericTarget !== null && numericValue < numericTarget;
  if (operator === 'before') return !!dateValue && !!dateTarget && dateValue.getTime() < dateTarget.getTime();
  if (operator === 'after') return !!dateValue && !!dateTarget && dateValue.getTime() > dateTarget.getTime();
  if (operator === 'today') return !!dateValue && isSameDateKey(dateValue, today);
  if (operator === 'this_week') return !!dateValue && dateValue >= today && dateValue < weekEnd;
  if (operator === 'this_month') return !!dateValue && dateValue >= today && dateValue < monthEnd;
  if (operator === 'overdue') return !!dateValue && dateValue < today;
  return valueText.includes(targetText);
}

export function formatMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return `${year}年${month}月`;
}

export function addMonths(value: string, diff: number) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1 + diff, 1);
  return monthKey(date);
}

export function applyDatabaseView(database: WorkspaceDatabase, allDatabases: WorkspaceDatabase[] = []) {
  const view = getActiveView(database);
  const hasFilters = view.filters.length > 0;
  const filterLogic = view.filterLogic === 'or' ? 'or' : 'and';
  const hasSorts = view.sorts.length > 0;
  if (!hasFilters && !hasSorts) return database.rows;
  const filtered = hasFilters ? database.rows.filter(row => (filterLogic === 'or' ? view.filters.some.bind(view.filters) : view.filters.every.bind(view.filters))(filter => {
    const prop = database.properties.find(item => item.id === filter.propertyId);
    const rawValue = prop ? getComputedCellValue(prop, row, database, allDatabases) : row.cells[filter.propertyId];
    const text = dbText(rawValue);
    const target = dbText(filter.value);
    return applyAdvancedDatabaseFilter(text, rawValue, filter.operator, target);
  })) : database.rows;

  if (!hasSorts) return filtered;
  return [...filtered].sort((a, b) => {
    for (const sort of view.sorts) {
      const prop = database.properties.find(item => item.id === sort.propertyId);
      const av = prop ? getComputedCellValue(prop, a, database, allDatabases) : a.cells[sort.propertyId];
      const bv = prop ? getComputedCellValue(prop, b, database, allDatabases) : b.cells[sort.propertyId];
      const an = toDatabaseNumber(av);
      const bn = toDatabaseNumber(bv);
      const result = an !== null && bn !== null ? an - bn : dbText(av).localeCompare(dbText(bv), 'ja', { numeric: true });
      if (result !== 0) return sort.direction === 'desc' ? -result : result;
    }
    return 0;
  });
}


export function propertyTypeLabel(type: DatabasePropertyType) {
  const labels: Record<DatabasePropertyType, string> = {
    text: 'Text',
    number: 'Number',
    select: 'Select',
    status: 'Status',
    multi_select: 'Multi',
    unique_id: 'Unique ID',
    button: 'Button',
    date: 'Date',
    checkbox: 'Check',
    url: 'URL',
    phone: '電話番号',
    email: 'メール',
    created_time: '作成日時',
    last_edited_time: '最終更新日時',
    relation: 'Relation',
    rollup: 'Rollup',
    formula: 'Formula'
  };
  return labels[type] ?? type;
}

export function propertyTypeIcon(type: DatabasePropertyType) {
  const icons: Record<string, string> = {
    text: 'Aa',
    number: '#',
    select: '▾',
    status: '◉',
    multi_select: '⋯',
    unique_id: '#',
    button: '▶',
    date: '◷',
    checkbox: '☑',
    url: '↗',
    phone: '☎',
    email: '✉',
    created_time: '◷',
    last_edited_time: '↻',
    relation: '↔',
    rollup: 'Σ',
    formula: 'ƒx'
  };
  return icons[type] ?? '•';
}

export function defaultDatabaseCellValue(type: DatabasePropertyType): string | number | boolean | string[] {
  if (type === 'checkbox') return false;
  if (type === 'relation' || type === 'multi_select') return [];
  if (type === 'rollup' || type === 'formula' || type === 'unique_id' || type === 'button' || isAutomaticTimeProperty(type)) return '';
  return '';
}

export function coerceDatabaseCellValue(value: unknown, type: DatabasePropertyType): string | number | boolean | string[] {
  if (type === 'checkbox') return Boolean(value);
  if (type === 'number') return value === '' || value == null ? '' : Number(value);
  if (type === 'relation' || type === 'multi_select') return Array.isArray(value) ? value.map(String) : dbText(value).split(',').map(item => item.trim()).filter(Boolean);
  if (type === 'rollup' || type === 'formula' || type === 'unique_id' || type === 'button') return '';
  return dbText(value);
}


type DatabaseAnalysis = {
  numeric: Array<{ propertyId: string; name: string; count: number; sum: number; avg: number; min: number; max: number }>;
  select: Array<{ propertyId: string; name: string; counts: Array<{ value: string; count: number }> }>;
  date: Array<{ propertyId: string; name: string; earliest: string; latest: string; filled: number }>;
  checkbox: Array<{ propertyId: string; name: string; checked: number; total: number; rate: number }>;
};

export function csvEscape(value: unknown): string {
  const text = value == null ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function databaseToCsv(database: WorkspaceDatabase, rows = database.rows): string {
  const header = database.properties.map(prop => csvEscape(prop.name)).join(',');
  const body = rows.map(row => database.properties.map(prop => csvEscape(getComputedCellValue(prop, row, database, []))).join(',')).join('\n');
  return [header, body].filter(Boolean).join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
}

export function guessPropertyType(values: string[]): DatabasePropertyType {
  const nonEmpty = values.map(v => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.every(v => ['true', 'false', 'yes', 'no', '1', '0', '完了', '未完了'].includes(v.toLowerCase()))) return 'checkbox';
  if (nonEmpty.every(v => !Number.isNaN(Number(v)))) return 'number';
  if (nonEmpty.every(v => /^\d{4}-\d{2}-\d{2}/.test(v))) return 'date';
  if (nonEmpty.every(v => /^https?:\/\//.test(v))) return 'url';
  if (nonEmpty.every(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  if (nonEmpty.every(v => /^(?:\+?\d[\d()\-\s]{5,}\d)$/.test(v))) return 'phone';
  const unique = new Set(nonEmpty).size;
  if (unique <= Math.min(12, Math.max(3, nonEmpty.length / 2))) return 'select';
  return 'text';
}

export function normalizeCsvValue(value: string, type: DatabasePropertyType): string | number | boolean {
  if (type === 'number') return value.trim() === '' ? '' : Number(value);
  if (type === 'checkbox') return ['true', 'yes', '1', '完了', 'checked'].includes(value.trim().toLowerCase());
  return value;
}

export function csvToDatabaseRows(database: WorkspaceDatabase, csvText: string): WorkspaceDatabase | null {
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) return null;
  const headers = parsed[0].map((h, i) => h.trim() || `列${i + 1}`);
  const dataRows = parsed.slice(1);
  const properties = headers.map((name, index) => {
    const values = dataRows.map(row => row[index] ?? '');
    const type = guessPropertyType(values);
    const options = type === 'select' ? Array.from(new Set(values.map(v => v.trim()).filter(Boolean))).slice(0, 30) : undefined;
    return { id: `prop_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`, name, type, options };
  });
  const now = new Date().toISOString();
  const rows = dataRows.map((csvRow, rowIndex) => ({
    id: `row_${Date.now()}_${rowIndex}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    cells: Object.fromEntries(properties.map((prop, index) => [prop.id, normalizeCsvValue(csvRow[index] ?? '', prop.type)]))
  }));
  return { ...database, updatedAt: now, properties, rows };
}

export function analyzeDatabase(database: WorkspaceDatabase): DatabaseAnalysis {
  const numeric: DatabaseAnalysis['numeric'] = [];
  const select: DatabaseAnalysis['select'] = [];
  const date: DatabaseAnalysis['date'] = [];
  const checkbox: DatabaseAnalysis['checkbox'] = [];
  for (const prop of database.properties) {
    if (prop.type === 'number') {
      const values = database.rows.map(row => Number(row.cells[prop.id])).filter(value => Number.isFinite(value));
      if (values.length) numeric.push({ propertyId: prop.id, name: prop.name, count: values.length, sum: values.reduce((a, b) => a + b, 0), avg: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) });
    }
    if (prop.type === 'select' || prop.type === 'text') {
      const counts = new Map<string, number>();
      for (const row of database.rows) {
        const value = dbText(row.cells[prop.id]).trim() || '空';
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const sorted = Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 8);
      if (sorted.length > 1 || sorted[0]?.value !== '空') select.push({ propertyId: prop.id, name: prop.name, counts: sorted });
    }
    if (prop.type === 'date') {
      const values = database.rows.map(row => dbText(row.cells[prop.id])).filter(Boolean).sort();
      if (values.length) date.push({ propertyId: prop.id, name: prop.name, earliest: values[0], latest: values[values.length - 1], filled: values.length });
    }
    if (prop.type === 'checkbox') {
      const checked = database.rows.filter(row => Boolean(row.cells[prop.id])).length;
      checkbox.push({ propertyId: prop.id, name: prop.name, checked, total: database.rows.length, rate: database.rows.length ? Math.round((checked / database.rows.length) * 100) : 0 });
    }
  }
  return { numeric, select, date, checkbox };
}


export function readJsonLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function renderCellPreview(value: unknown, type: DatabasePropertyType) {
  const text = dbText(value);
  if (type === 'checkbox') return Boolean(value) ? '完了' : '未完了';
  if (type === 'date' && text) return text;
  if (isAutomaticTimeProperty(type) && text) return formatDatabaseTimestamp(text);
  if (type === 'url' && text) return text.replace(/^https?:\/\//, '');
  if (type === 'phone' || type === 'email') return text;
  return text || '空';
}

export function getDatabaseRowTitle(database: WorkspaceDatabase, rowId: string): string {
  const row = database.rows.find(item => item.id === rowId);
  if (!row) return 'Missing row';
  const titleProp = database.properties[0];
  return titleProp ? (dbText(row.cells[titleProp.id]) || '無題の行') : row.id;
}

export function getRelationTargetTitle(prop: WorkspaceDatabase['properties'][number], rawId: string, currentDb: WorkspaceDatabase, allDatabases: WorkspaceDatabase[], pages: PageWithLock[], journals: JournalSummary[]): string {
  const id = rawId.includes(':') ? rawId.split(':').slice(-1)[0] : rawId;
  const targetType = prop.relationTargetType ?? 'database';
  if (targetType === 'page') {
    const page = pages.find(item => item.id === id);
    return page ? `${page.icon || '📄'} ${page.title}` : 'Missing page';
  }
  if (targetType === 'journal') {
    const journal = journals.find(item => item.date === id);
    return journal ? `📅 ${journal.date}` : `📅 ${id}`;
  }
  const targetDb = allDatabases.find(db => db.id === (prop.relationDatabaseId || currentDb.id)) ?? currentDb;
  return getDatabaseRowTitle(targetDb, id);
}

export function isSharedToPrivateRelationBlocked(sourceScope: WorkspaceScope, targetScope: WorkspaceScope): boolean {
  return sourceScope === 'shared' && targetScope === 'private';
}

export type RelationCandidate = { id: string; title: string; subtitle: string; preview?: string; updatedAt?: string };

export function getRelationCandidates(prop: WorkspaceDatabase['properties'][number], currentDb: WorkspaceDatabase, allDatabases: WorkspaceDatabase[], pages: PageWithLock[], journals: JournalSummary[], rowId: string, options: { limit?: number } = {}): RelationCandidate[] {
  const sourceScope = workspaceScope(currentDb);
  const targetType = prop.relationTargetType ?? 'database';
  if (targetType === 'page') {
    return pages
      .filter(page => !isSharedToPrivateRelationBlocked(sourceScope, pageScope(page)))
      .slice(0, 80)
      .map(page => ({ id: page.id, title: `${page.icon || '📄'} ${page.title}`, subtitle: `${scopeIcon(pageScope(page))} Page`, preview: page.previewSnippet || '', updatedAt: page.updatedAt }));
  }
  if (targetType === 'journal') {
    return journals.slice(0, 80).map(journal => ({ id: journal.date, title: `📅 ${journal.date}`, subtitle: journal.previewSnippet || 'Journal', preview: journal.previewSnippet || '', updatedAt: journal.updatedAt }));
  }
  const targetDb = allDatabases.find(db => db.id === (prop.relationDatabaseId || currentDb.id)) ?? currentDb;
  if (isSharedToPrivateRelationBlocked(sourceScope, workspaceScope(targetDb))) return [];
  const titleProperty = targetDb.properties[0];
  const previewProperties = targetDb.properties
    .filter(item => item.id !== titleProperty?.id && !['relation', 'rollup', 'formula', 'created_time', 'last_edited_time'].includes(item.type))
    .slice(0, 2);
  const limit = Math.max(1, Math.min(options.limit ?? (prop.isSubItemRelation ? 5000 : 1000), 5000));
  return targetDb.rows
    .filter(row => !(targetDb.id === currentDb.id && row.id === rowId))
    .slice(0, limit)
    .map(row => {
      const details = previewProperties
        .map(item => {
          const value = getComputedCellValue(item, row, targetDb, allDatabases);
          const rendered = renderCellPreview(value, item.type);
          return rendered && rendered !== '空' ? `${item.name}: ${rendered}` : '';
        })
        .filter(Boolean)
        .join(' ・ ');
      return {
        id: row.id,
        title: getDatabaseRowTitle(targetDb, row.id),
        subtitle: `${scopeIcon(workspaceScope(targetDb))} ${targetDb.title}`,
        preview: details || '入力済みプロパティはありません',
        updatedAt: row.updatedAt,
      };
    });
}

export type RelationBacklink = {
  sourceDbId: string;
  sourceDbTitle: string;
  sourceRowId: string;
  sourceRowTitle: string;
  propertyId: string;
  propertyName: string;
};

export function findRowRelationBacklinks(currentDb: WorkspaceDatabase, rowId: string, allDatabases: WorkspaceDatabase[]): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (prop.type !== 'relation') continue;
      const targetType = prop.relationTargetType ?? 'database';
      const targetDbId = prop.relationDatabaseId || db.id;
      if (targetType !== 'database' || targetDbId !== currentDb.id) continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(rowId)) {
          result.push({
            sourceDbId: db.id,
            sourceDbTitle: db.title,
            sourceRowId: row.id,
            sourceRowTitle: getDatabaseRowTitle(db, row.id),
            propertyId: prop.id,
            propertyName: prop.name,
          });
        }
      }
    }
  }
  return result;
}

export function findPageRelationBacklinks(pageId: string, allDatabases: WorkspaceDatabase[]): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (prop.type !== 'relation' || (prop.relationTargetType ?? 'database') !== 'page') continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(pageId)) {
          result.push({ sourceDbId: db.id, sourceDbTitle: db.title, sourceRowId: row.id, sourceRowTitle: getDatabaseRowTitle(db, row.id), propertyId: prop.id, propertyName: prop.name });
        }
      }
    }
  }
  return result;
}

export function findJournalRelationBacklinks(date: string, allDatabases: WorkspaceDatabase[]): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (prop.type !== 'relation' || (prop.relationTargetType ?? 'database') !== 'journal') continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(date)) {
          result.push({ sourceDbId: db.id, sourceDbTitle: db.title, sourceRowId: row.id, sourceRowTitle: getDatabaseRowTitle(db, row.id), propertyId: prop.id, propertyName: prop.name });
        }
      }
    }
  }
  return result;
}

export function getRelationTargetDatabase(prop: WorkspaceDatabase['properties'][number], currentDb: WorkspaceDatabase, allDatabases: WorkspaceDatabase[]) {
  return allDatabases.find(db => db.id === (prop.relationDatabaseId || currentDb.id)) ?? currentDb;
}

export function getRollupValue(prop: WorkspaceDatabase['properties'][number], row: WorkspaceDatabase['rows'][number], currentDb: WorkspaceDatabase, allDatabases: WorkspaceDatabase[]) {
  const relationProp = currentDb.properties.find(p => p.id === prop.rollupRelationPropertyId && p.type === 'relation');
  if (!relationProp) return 'Relation未設定';
  const rawRelationIds = row.cells[relationProp.id];
  const ids = Array.isArray(rawRelationIds) ? rawRelationIds.map(String) : [];
  const targetDb = getRelationTargetDatabase(relationProp, currentDb, allDatabases);
  const targetRows = targetDb.rows.filter(item => ids.includes(item.id));
  const fn = prop.rollupFunction ?? 'count';
  if (fn === 'count') return targetRows.length;

  const targetProp = targetDb.properties.find(p => p.id === prop.rollupTargetPropertyId);
  if (!targetProp) {
    if (fn === 'percent_checked') return '0%';
    if (fn === 'count_checked' || fn === 'count_unchecked') return 0;
    return targetRows.length;
  }

  const values = targetRows.map(item => item.cells[targetProp.id]);
  const isDoneStatus = (value: unknown) => ['完了', '完了済み', 'done', 'completed'].includes(String(value ?? '').trim().toLowerCase());
  if (fn === 'count_checked') return values.filter(isCheckedDatabaseValue).length;
  if (fn === 'count_unchecked') return values.filter(value => !isCheckedDatabaseValue(value)).length;
  if (fn === 'percent_checked') return formatPercent(values.filter(isCheckedDatabaseValue).length, targetRows.length);
  if (fn === 'count_status_done') return values.filter(isDoneStatus).length;
  if (fn === 'count_status_open') return values.filter(value => !isDoneStatus(value)).length;
  if (fn === 'percent_status_done') return formatPercent(values.filter(isDoneStatus).length, targetRows.length);

  const nums = values.map(toDatabaseNumber).filter((value): value is number => value !== null);
  if (fn === 'sum') return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  if (fn === 'average') return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
  if (fn === 'min') return nums.length ? Math.min(...nums) : '';
  if (fn === 'max') return nums.length ? Math.max(...nums) : '';
  if (fn === 'show_unique') return Array.from(new Set(values.flatMap(value => Array.isArray(value) ? value.map(String) : [dbText(value)]).map(value => value.trim()).filter(Boolean))).join(', ');
  return targetRows.length;
}

export function getFormulaValue(prop: WorkspaceDatabase['properties'][number], row: WorkspaceDatabase['rows'][number], database: WorkspaceDatabase, allDatabases: WorkspaceDatabase[]): unknown {
  const expression = (prop.formulaExpression || '').trim();
  if (!expression) return '式未設定';
  const lookup = (name: string): unknown => {
    const target = database.properties.find(p => p.name === name || p.id === name);
    if (!target) return '';
    if (target.type === 'rollup') return getRollupValue(target, row, database, allDatabases);
    if (target.type === 'formula') return '';
    return getComputedCellValue(target, row, database, allDatabases);
  };
  if (/^daysUntil\(([^)]+)\)$/i.test(expression)) {
    const name = expression.match(/^daysUntil\(([^)]+)\)$/i)?.[1]?.trim() ?? '';
    const date = parseLocalDate(lookup(name));
    if (!date) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((date.getTime() - today.getTime()) / 86400000);
  }
  if (/^progress\(([^,]+),([^\)]+)\)$/i.test(expression)) {
    const m = expression.match(/^progress\(([^,]+),([^\)]+)\)$/i);
    const done: number = toDatabaseNumber(lookup(m?.[1]?.trim() ?? '')) ?? 0;
    const total: number = toDatabaseNumber(lookup(m?.[2]?.trim() ?? '')) ?? 0;
    return formatPercent(done, total);
  }
  const safe: string = expression.replace(/\{([^}]+)\}/g, (_match: string, name: string): string => String(toDatabaseNumber(lookup(String(name).trim())) ?? 0));
  if (!/^[0-9+\-*/().\s]+$/.test(safe)) return '式エラー';
  try {
    // Formula is intentionally limited to numeric arithmetic generated from {Property Name} placeholders.
    // eslint-disable-next-line no-new-func
    const result: unknown = Function(`"use strict"; return (${safe});`)();
    return typeof result === 'number' && Number.isFinite(result) ? Math.round(result * 100) / 100 : '';
  } catch {
    return '式エラー';
  }
}

export function getComputedCellValue(prop: WorkspaceDatabase['properties'][number], row: WorkspaceDatabase['rows'][number], database: WorkspaceDatabase, allDatabases: WorkspaceDatabase[]): unknown {
  if (prop.type === 'created_time') return row.createdAt;
  if (prop.type === 'last_edited_time') return row.updatedAt;
  if (prop.type === 'rollup') return getRollupValue(prop, row, database, allDatabases);
  if (prop.type === 'formula') return getFormulaValue(prop, row, database, allDatabases);
  return row.cells[prop.id];
}

/** Contact-property helpers: normalize common Japanese input variations and
 * provide non-blocking validation feedback while the user is typing. */
export function normalizePhoneInput(value: unknown): string {
  return dbText(value)
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[＋]/g, '+')
    .replace(/[ー－―]/g, '-')
    .replace(/[\s　]/g, '');
}

export function normalizeEmailInput(value: unknown): string {
  return dbText(value)
    .replace(/[＠]/g, '@')
    .replace(/[．]/g, '.')
    .replace(/[\s　]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
}

export function contactValidationMessage(type: DatabasePropertyType, value: unknown): string | null {
  const raw = dbText(value);
  if (!raw.trim()) return null;
  if (type === 'phone') {
    const normalized = normalizePhoneInput(raw);
    const digits = normalized.replace(/\D/g, '');
    if (!/^[+]?\d[\d()-]*\d$/.test(normalized) || digits.length < 6 || digits.length > 15) {
      return '電話番号は数字6〜15桁で入力してください。ハイフンと先頭の＋を使用できます。';
    }
  }
  if (type === 'email') {
    const normalized = normalizeEmailInput(raw);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return 'メールアドレスの形式を確認してください。例：name@example.jp';
    }
  }
  return null;
}

export function normalizeContactValue(type: DatabasePropertyType, value: unknown): string {
  if (type === 'phone') return normalizePhoneInput(value);
  if (type === 'email') return normalizeEmailInput(value);
  return dbText(value);
}
