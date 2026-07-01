import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import * as aq from 'arquero';
import * as Plot from '@observablehq/plot';
import { nanoid } from 'nanoid';
import type {
  AnalysisCell,
  AnalysisChart,
  AnalysisCellExecution,
  AnalysisDataFrameTransform,
  AnalysisFunctionTransform,
  AnalysisImportTransform,
  AnalysisPivotTransform,
  AnalysisCellSnapshot,
  AnalysisNamedResult,
  AnalysisDashboardPin,
  AnalysisDataDictionary,
  AnalysisDataDictionaryDataset,
  AnalysisNotebook,
  AnalysisParameter,
  AnalysisQueryResult,
  AnalysisStatus,
  AnalysisWorkspaceSettings,
  AnalysisProfile,
  AnalysisMetricDefinition,
  AnalysisColumnMeaning,
  AnalysisSummaryTransform,
  AnalysisQualityTransform,
  AnalysisPreprocessTransform,
  AnalysisAiDraft,
} from '../../../../shared/analysisTypes';
import type { ApiClient } from '../../lib/api';

type OriginTarget = { kind: 'page'; pageId: string; label: string } | { kind: 'database-row'; databaseId: string; rowId: string; label: string } | { kind: 'database'; databaseId: string; label: string } | { kind: 'journal'; date: string; label: string };

// Analysis can process up to the synchronized 100k rows. The table stays responsive
// because only the visible rows are rendered. Charts and UI guidance sample rows.
const MAX_ANALYSIS_ROWS = 100_000;
const MAX_CHART_ROWS = 12_000;
const ANALYSIS_TABLE_ROW_HEIGHT = 36;
const ANALYSIS_TABLE_VIEWPORT_HEIGHT = 520;
const ANALYSIS_TABLE_OVERSCAN = 12;

function sampleAnalysisRows<T>(rows: T[], limit = MAX_CHART_ROWS): T[] {
  if (rows.length <= limit) return rows;
  const step = rows.length / limit;
  return Array.from({ length: limit }, (_, index) => rows[Math.min(rows.length - 1, Math.floor(index * step))]);
}
type Props = {
  api: ApiClient | null;
  onBack: () => void;
  onStatus: (message: string) => void;
  onOpenPage: (pageId: string) => void;
  onOpenDatabase: (databaseId: string) => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onOpenJournal: (date: string) => void;
};
type SqlCell = Extract<AnalysisCell, { type: 'sql' }>;
type ParameterCell = Extract<AnalysisCell, { type: 'parameter' }>;
type VariableCell = Extract<AnalysisCell, { type: 'variable' }>;
type SectionCell = Extract<AnalysisCell, { type: 'section' }>;
type FunctionCell = Extract<AnalysisCell, { type: 'function' }>;
type ImportCell = Extract<AnalysisCell, { type: 'import' }>;
type DataFrameCell = Extract<AnalysisCell, { type: 'dataframe' }>;
type PivotCell = Extract<AnalysisCell, { type: 'pivot' }>;
type SummaryCell = Extract<AnalysisCell, { type: 'summary' }>;
type QualityCell = Extract<AnalysisCell, { type: 'quality' }>;
type PreprocessCell = Extract<AnalysisCell, { type: 'preprocess' }>;
type ChartCell = Extract<AnalysisCell, { type: 'chart' }>;
type SidebarTab = 'notebooks' | 'dashboard' | 'dictionary' | 'templates' | 'operations';
type AnalysisWizardGoal = 'count' | 'trend' | 'compare' | 'quality';
type AnalysisWizardDraft = {
  goal: AnalysisWizardGoal;
  dataset: string;
  groupColumn: string;
  dateColumn: string;
  valueColumn: string;
  aggregation: 'count' | 'sum' | 'average';
};

function cellTitle(cell: AnalysisCell): string {
  switch (cell.type) {
    case 'sql': return cell.outputName ? `SQL：${cell.outputName}` : 'SQLセル';
    case 'dataframe': return cell.transform.outputName ? `DataFrame：${cell.transform.outputName}` : 'DataFrameセル';
    case 'function': return cell.transform.outputName ? `分析関数：${cell.transform.outputName}` : '分析関数セル';
    case 'pivot': return cell.pivot.outputName ? `ピボット：${cell.pivot.outputName}` : 'ピボットセル';
    case 'summary': return cell.summary.outputName ? `統計・要約：${cell.summary.outputName}` : '統計・要約セル';
    case 'quality': return cell.quality.outputName ? `品質チェック：${cell.quality.outputName}` : '品質チェックセル';
    case 'preprocess': return cell.preprocess.outputName ? `前処理：${cell.preprocess.outputName}` : '前処理セル';
    case 'import': return cell.imported.outputName ? `取込：${cell.imported.outputName}` : '取込セル';
    case 'chart': return 'グラフセル';
    case 'markdown': return 'メモセル';
    case 'section': return cell.title || 'セクション';
    case 'parameter': return cell.parameter.label || '条件セル';
    case 'variable': return cell.variable.label || '変数セル';
  }
}

const STARTER_SQL = `-- Ctrl + Space または ⌘ + Shift + Space でテーブル・列名を補完できます。
SELECT
  d.title AS database_name,
  COUNT(r.row_id) AS row_count
FROM databases d
LEFT JOIN database_rows r ON r.database_id = d.database_id
GROUP BY d.title
ORDER BY row_count DESC;`;

const newSqlCell = (sql = STARTER_SQL, chart: SqlCell['chart'] = { type: 'bar' }): SqlCell => ({ id: nanoid(10), type: 'sql', sql, chart, outputName: '' });
const newDataFrameCell = (): DataFrameCell => ({ id: nanoid(10), type: 'dataframe', chart: { type: 'table' }, transform: { sourceCellId: '', outputName: `frame_${Date.now().toString().slice(-5)}`, operation: 'filter', column: '', operator: 'contains', value: '', columns: [], direction: 'asc', limit: 100 } });
const newFunctionCell = (): FunctionCell => ({ id: nanoid(10), type: 'function', chart: { type: 'table' }, transform: { sourceCellId: '', outputName: `calc_${Date.now().toString().slice(-5)}`, operation: 'movingAverage', valueColumn: '', periodColumn: '', groupColumn: '', outputColumn: '', windowSize: 3, joinSourceCellId: '', joinLeftColumn: '', joinRightColumn: '', joinType: 'left', valueColumns: [], delimiter: ',', splitIndex: 0, secondColumn: '', conditionOperator: 'equals', conditionValue: '', trueValue: '該当', falseValue: '非該当', formulaKind: 'arithmetic', formulaOperator: 'add', formulaValue: '0', renameTo: '' } });
const newImportCell = (): ImportCell => ({ id: nanoid(10), type: 'import', chart: { type: 'table' }, imported: { sourceName: '', columns: [], rows: [], outputName: `import_${Date.now().toString().slice(-5)}`, importedAt: '' } });
const newVariableCell = (): VariableCell => ({ id: nanoid(10), type: 'variable', variable: { name: `var_${Date.now().toString().slice(-5)}`, label: 'ノート変数', type: 'text', value: '' } });
const newSectionCell = (): SectionCell => ({ id: nanoid(10), type: 'section', title: '新しいセクション', description: '', collapsed: false });
const newPivotCell = (): PivotCell => ({ id: nanoid(10), type: 'pivot', chart: { type: 'table' }, pivot: { sourceCellId: '', rowColumn: '', columnColumn: '', valueColumn: '', aggregation: 'count', outputName: `pivot_${Date.now().toString().slice(-5)}` } });
const newSummaryCell = (): SummaryCell => ({ id: nanoid(10), type: 'summary', chart: { type: 'table' }, summary: { sourceCellId: '', outputName: `summary_${Date.now().toString().slice(-5)}`, numericColumn: '', groupColumn: '' } });
const newQualityCell = (): QualityCell => ({ id: nanoid(10), type: 'quality', chart: { type: 'table' }, quality: { sourceCellId: '', outputName: `quality_${Date.now().toString().slice(-5)}`, columns: [], checkMissing: true, checkDuplicates: true, checkNonNumeric: false } });
const newPreprocessCell = (): PreprocessCell => ({ id: nanoid(10), type: 'preprocess', chart: { type: 'table' }, preprocess: { sourceCellId: '', outputName: `prep_${Date.now().toString().slice(-5)}`, operation: 'removeDuplicates', columns: [], column: '', missingStrategy: 'custom', fillValue: '', invalidAction: 'null', findValue: '', replaceValue: '', outlierMethod: 'iqr' } });
const newChartCell = (): ChartCell => ({ id: nanoid(10), type: 'chart', sourceCellId: '', chart: { type: 'bar' } });
const newMarkdownCell = (content = '## 分析メモ\n\nここに前提・結論・次の対応を書きます。'): Extract<AnalysisCell, { type: 'markdown' }> => ({ id: nanoid(10), type: 'markdown', content });
const newParameterCell = (): ParameterCell => ({ id: nanoid(10), type: 'parameter', parameter: { name: `param_${Date.now().toString().slice(-5)}`, label: '分析条件', type: 'text', value: '' } });

const ANALYSIS_TEMPLATES: Array<{ id: string; title: string; description: string; build: () => Pick<AnalysisNotebook, 'title' | 'description' | 'cells' | 'sql' | 'chart'> }> = [
  {
    id: 'database-volume',
    title: 'データベース別の行数',
    description: 'どのデータベースにどれだけの行があるかを確認します。',
    build: () => ({ title: 'データベース別の行数', description: 'データベースごとの登録行数を比較する分析です。', sql: STARTER_SQL, chart: { type: 'bar', x: 'database_name', y: 'row_count' }, cells: [newMarkdownCell('## 目的\n\nデータベースごとの登録量を確認します。'), newSqlCell(STARTER_SQL, { type: 'bar', x: 'database_name', y: 'row_count' })] }),
  },
  {
    id: 'journal-monthly',
    title: 'Journal月次推移',
    description: '月ごとのJournal件数を折れ線で確認します。',
    build: () => {
      const sql = `SELECT\n  substr(date, 1, 7) AS month,\n  COUNT(*) AS journal_count\nFROM journals\nGROUP BY month\nORDER BY month;`;
      return { title: 'Journal月次推移', description: 'Journalの記録量を月ごとに確認します。', sql, chart: { type: 'line', x: 'month', y: 'journal_count' }, cells: [newMarkdownCell('## 見方\n\n記録量の増減を確認し、繁忙期や記録漏れの傾向を見ます。'), newSqlCell(sql, { type: 'line', x: 'month', y: 'journal_count' })] };
    },
  },
  {
    id: 'open-tasks',
    title: '未完了タスク一覧',
    description: '期限が近い未完了タスクを確認します。',
    build: () => {
      const sql = `SELECT\n  source_title,\n  text,\n  due_date,\n  updated_at\nFROM tasks\nWHERE completed NOT IN ('1', 'true', 'TRUE')\nORDER BY\n  CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,\n  due_date ASC,\n  updated_at DESC;`;
      return { title: '未完了タスク一覧', description: '完了していないタスクを期限順に確認します。', sql, chart: { type: 'table' }, cells: [newMarkdownCell('## 確認観点\n\n期限切れ・本日期限・担当未確認のタスクを優先します。'), newSqlCell(sql, { type: 'table' })] };
    },
  },
  {
    id: 'page-update-monthly',
    title: 'ページ更新の月次推移',
    description: '月ごとのページ更新件数を確認します。',
    build: () => {
      const sql = `SELECT\n  substr(updated_at, 1, 7) AS month,\n  COUNT(*) AS updated_pages\nFROM pages\nWHERE trashed NOT IN ('1', 'true', 'TRUE')\nGROUP BY month\nORDER BY month;`;
      return { title: 'ページ更新の月次推移', description: 'ページ更新量を月ごとに確認します。', sql, chart: { type: 'line', x: 'month', y: 'updated_pages' }, cells: [newMarkdownCell('## 目的\n\nナレッジ更新の活動量を月単位で振り返ります。'), newSqlCell(sql, { type: 'line', x: 'month', y: 'updated_pages' })] };
    },
  },
  {
    id: 'recipe-data-profile',
    title: '分析レシピ：データを理解する',
    description: '取込・抽出した表の欠損、重複、数値列を確認する基本レシピです。',
    build: () => {
      const sql = `SELECT * FROM database_rows LIMIT 1000;`;
      const source = newSqlCell(sql, { type: 'table' }); source.outputName = 'sample_data';
      const quality = newQualityCell(); quality.quality = { ...quality.quality, sourceCellId: source.id, outputName: 'quality_check', checkMissing: true, checkDuplicates: true, checkNonNumeric: true };
      const summary = newSummaryCell(); summary.summary = { ...summary.summary, sourceCellId: source.id, outputName: 'data_summary' };
      return { title: 'データ理解レシピ', description: 'データのサンプル、品質、要約を順に確認します。', sql, chart: { type: 'table' }, cells: [{ ...newSectionCell(), title: '1. データの確認' }, newMarkdownCell(`## 使い方\n\n対象のSQLや取込セルを差し替えて、品質確認と統計・要約を実行します。`), source, { ...newSectionCell(), title: '2. 品質と要約' }, quality, summary] };
    },
  },
  {
    id: 'recipe-yearly-comparison',
    title: '分析レシピ：年度別比較',
    description: '年度列と数値列を指定し、前年比・順位・折れ線を作るレシピです。',
    build: () => {
      const sql = `-- 対象の表・列名を実データに合わせて変更してください。
SELECT * FROM database_rows LIMIT 1000;`;
      const source = newSqlCell(sql, { type: 'table' }); source.outputName = 'yearly_source';
      const calc = newFunctionCell(); calc.transform = { ...calc.transform, sourceCellId: source.id, outputName: 'yearly_change', operation: 'yearOverYear', valueColumn: '', periodColumn: '', outputColumn: '前年比' };
      const chart = newChartCell(); chart.sourceCellId = calc.id; chart.chart = { type: 'line' };
      return { title: '年度別比較レシピ', description: '抽出、前年比、可視化を順に設定します。', sql, chart: { type: 'line' }, cells: [{ ...newSectionCell(), title: '年度別比較' }, newMarkdownCell(`## 手順\n\n1. SQLで年度と数値を含む表を作成\n2. 分析関数セルで数値列・年度列を選択\n3. グラフセルで折れ線を表示`), source, calc, chart] };
    },
  },
  {
    id: 'recipe-category-pivot',
    title: '分析レシピ：分類別ピボット',
    description: '分類ごとの件数・合計をピボットで比較するレシピです。',
    build: () => {
      const sql = `SELECT * FROM database_rows LIMIT 1000;`;
      const source = newSqlCell(sql, { type: 'table' }); source.outputName = 'pivot_source';
      const pivot = newPivotCell(); pivot.pivot = { ...pivot.pivot, sourceCellId: source.id, outputName: 'category_pivot' };
      const chart = newChartCell(); chart.sourceCellId = pivot.id; chart.chart = { type: 'bar' };
      return { title: '分類別ピボットレシピ', description: '分類、集計値、グラフを設定します。', sql, chart: { type: 'bar' }, cells: [{ ...newSectionCell(), title: '分類別の比較' }, newMarkdownCell(`## 手順\n\nピボットセルで行項目・列項目・集計値を選び、棒グラフで比較します。`), source, pivot, chart] };
    },
  },
];

function quoteAnalysisIdentifier(value: string): string {
  return `"${String(value || '').replaceAll('"', '""')}"`;
}


function AnalysisAiComposer({ api, onClose, onApply }: { api: ApiClient | null; onClose: () => void; onApply: (draft: AnalysisAiDraft) => void }) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<AnalysisAiDraft | null>(null);
  const examples = ['月ごとのJournal件数を折れ線グラフで見たい', 'データベースごとの登録件数を比較したい', '期限切れの未完了タスクを確認したい', 'ページの更新量を年度ごとに集計したい'];
  const generate = async () => {
    if (!api || !instruction.trim()) return;
    setBusy(true); setError(''); setDraft(null);
    try {
      const result = await api.generateAnalysisAiDraft(instruction.trim());
      if (!result.ok || !result.draft) throw new Error(result.message || 'AIによる分析案の作成に失敗しました。');
      setDraft(result.draft);
    } catch (e: any) { setError(e?.message || 'AIによる分析案の作成に失敗しました。'); }
    finally { setBusy(false); }
  };
  return <div className="analysis-ai-backdrop" role="presentation" onMouseDown={onClose}><section className="analysis-ai-dialog" role="dialog" aria-modal="true" aria-label="AIで分析を作る" onMouseDown={(event) => event.stopPropagation()}>
    <header><div><span>AI ANALYSIS BUILDER</span><h2>やりたい分析を文章で入力</h2><p>AIが、データ辞書にある項目だけを使って、読み取り専用SQLとグラフ設定を提案します。</p></div><button type="button" className="secondary" onClick={onClose}>閉じる</button></header>
    <label className="analysis-ai-input"><b>何を知りたいですか？</b><textarea autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value.slice(0, 1500))} placeholder="例：月ごとのJournal件数を折れ線グラフで見たい" /></label>
    <div className="analysis-ai-examples"><b>例を使う</b>{examples.map((example) => <button type="button" key={example} onClick={() => setInstruction(example)}>{example}</button>)}</div>
    {error && <div className="analysis-error">{error}</div>}
    {draft && <article className="analysis-ai-draft"><div><span>AIの提案</span><h3>{draft.title}</h3><p>{draft.description}</p></div><div className="analysis-ai-draft-grid"><section><b>SQL（確認してから追加）</b><pre>{draft.sql}</pre></section><section><b>グラフ設定</b><p>{draft.chart.type} / 横軸: {draft.chart.x || 'なし'} / 縦軸: {draft.chart.y || 'なし'}</p>{draft.validation && <p className="analysis-ai-validation">✓ サーバーでSQLと出力列を確認済み（{draft.validation.columns.join('、') || '列なし'}）</p>}<b>この分析で確認すること</b><p>{draft.explanation}</p>{draft.warnings.length > 0 && <><b>確認事項</b><ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></>}</section></div><footer><span>実行・保存はまだ行いません。内容を確認してからノートへ追加します。</span><button className="primary" type="button" onClick={() => onApply(draft)}>このノートに追加</button></footer></article>}
    <footer className="analysis-ai-footer"><span>元データは変更しません。生成したSQLも実行前に確認できます。</span><button className="analysis-wizard-launch" type="button" disabled={!instruction.trim() || busy || !api} onClick={() => void generate()}>{busy ? 'AIが作成中…' : '✦ AIで分析案を作る'}</button></footer>
  </section></div>;
}

function analysisWizardDefault(dictionary: AnalysisDataDictionary | null): AnalysisWizardDraft {
  const dataset = dictionary?.datasets.find((item) => item.name === 'database_rows') || dictionary?.datasets[0];
  const names = dataset?.columns.map((column) => column.name) || [];
  return {
    goal: 'count',
    dataset: dataset?.name || 'database_rows',
    groupColumn: names.includes('title_text') ? 'title_text' : names[0] || '',
    dateColumn: names.find((name) => /date|created_at|updated_at/i.test(name)) || '',
    valueColumn: names.find((name) => /count|amount|cost|number|row_order/i.test(name)) || '',
    aggregation: 'count',
  };
}

function buildWizardNotebook(draft: AnalysisWizardDraft, dictionary: AnalysisDataDictionary | null): Pick<AnalysisNotebook, 'title' | 'description' | 'cells' | 'sql' | 'chart'> {
  const dataset = dictionary?.datasets.find((item) => item.name === draft.dataset);
  if (!dataset) throw new Error('分析対象データを選択してください。');
  const available = new Set(dataset.columns.map((column) => column.name));
  const ensure = (column: string, label: string) => {
    if (!column || !available.has(column)) throw new Error(`${label}を選択してください。`);
    return quoteAnalysisIdentifier(column);
  };
  const table = quoteAnalysisIdentifier(dataset.name);
  const group = draft.groupColumn ? ensure(draft.groupColumn, '分類項目') : '';
  const date = draft.dateColumn ? ensure(draft.dateColumn, '日付項目') : '';
  const value = draft.valueColumn ? ensure(draft.valueColumn, '数値項目') : '';
  const markdown = (title: string, purpose: string) => newMarkdownCell(`## ${title}\n\n${purpose}\n\n- 対象データ：\`${dataset.name}\`\n- 作成方法：分析ウィザード`);

  if (draft.goal === 'count') {
    const sql = `SELECT\n  COALESCE(CAST(${group} AS VARCHAR), '(空欄)') AS category,\n  COUNT(*) AS count\nFROM ${table}\nGROUP BY category\nORDER BY count DESC, category;`;
    const source = newSqlCell(sql, { type: 'bar', x: 'category', y: 'count' });
    source.outputName = 'category_count';
    const chart = newChartCell(); chart.sourceCellId = source.id; chart.chart = { type: 'bar', x: 'category', y: 'count' };
    return { title: `${dataset.description}の分類別件数`, description: '分類ごとの件数を確認する分析です。', sql, chart: { type: 'bar', x: 'category', y: 'count' }, cells: [{ ...newSectionCell(), title: '分析の目的' }, markdown('目的', '分類ごとの偏りや件数の多い項目を確認します。'), source, chart] };
  }
  if (draft.goal === 'trend') {
    const sql = `SELECT\n  substr(CAST(${date} AS VARCHAR), 1, 7) AS month,\n  COUNT(*) AS count\nFROM ${table}\nWHERE ${date} IS NOT NULL AND CAST(${date} AS VARCHAR) <> ''\nGROUP BY month\nORDER BY month;`;
    const source = newSqlCell(sql, { type: 'line', x: 'month', y: 'count' });
    source.outputName = 'monthly_trend';
    const chart = newChartCell(); chart.sourceCellId = source.id; chart.chart = { type: 'line', x: 'month', y: 'count' };
    return { title: `${dataset.description}の月次推移`, description: '月ごとの件数推移を確認する分析です。', sql, chart: { type: 'line', x: 'month', y: 'count' }, cells: [{ ...newSectionCell(), title: '分析の目的' }, markdown('目的', '月ごとの増減を確認し、繁忙期・記録漏れ・変化点を把握します。'), source, chart] };
  }
  if (draft.goal === 'compare') {
    const aggregate = draft.aggregation === 'count' ? 'COUNT(*)' : draft.aggregation === 'sum' ? `SUM(TRY_CAST(${value} AS DOUBLE))` : `AVG(TRY_CAST(${value} AS DOUBLE))`;
    const metric = draft.aggregation === 'count' ? 'count' : draft.aggregation === 'sum' ? 'sum_value' : 'average_value';
    const sql = `SELECT\n  COALESCE(CAST(${group} AS VARCHAR), '(空欄)') AS category,\n  ${aggregate} AS ${metric}\nFROM ${table}\nGROUP BY category\nORDER BY ${metric} DESC, category;`;
    const source = newSqlCell(sql, { type: 'bar', x: 'category', y: metric });
    source.outputName = 'category_compare';
    const chart = newChartCell(); chart.sourceCellId = source.id; chart.chart = { type: 'bar', x: 'category', y: metric };
    return { title: `${dataset.description}の分類別比較`, description: '分類ごとの件数または数値を比較する分析です。', sql, chart: { type: 'bar', x: 'category', y: metric }, cells: [{ ...newSectionCell(), title: '分析の目的' }, markdown('目的', '分類間の差を確認し、優先して確認すべき項目を見つけます。'), source, chart] };
  }
  const sql = `SELECT *\nFROM ${table}\nLIMIT 1000;`;
  const source = newSqlCell(sql, { type: 'table' });
  source.outputName = 'quality_source';
  const quality = newQualityCell();
  quality.quality.sourceCellId = source.id;
  quality.quality.outputName = 'quality_check';
  return { title: `${dataset.description}のデータ品質確認`, description: '欠損・重複・数値形式を確認する分析です。', sql, chart: { type: 'table' }, cells: [newSectionCell(), markdown('目的', '登録漏れや重複を確認し、必要な元データの修正につなげます。'), source, quality] };
}

function AnalysisWizard({ dictionary, onClose, onCreate }: { dictionary: AnalysisDataDictionary | null; onClose: () => void; onCreate: (draft: AnalysisWizardDraft) => void }) {
  const [draft, setDraft] = useState<AnalysisWizardDraft>(() => analysisWizardDefault(dictionary));
  const datasets = dictionary?.datasets || [];
  const selected = datasets.find((item) => item.name === draft.dataset) || datasets[0];
  const columns = selected?.columns || [];
  const dateColumns = columns.filter((column) => /date|created_at|updated_at/i.test(column.name));
  const numericColumns = columns.filter((column) => /count|amount|cost|number|row_order/i.test(column.name));
  const chooseDataset = (dataset: string) => {
    const next = datasets.find((item) => item.name === dataset);
    const names = next?.columns.map((column) => column.name) || [];
    setDraft((current) => ({ ...current, dataset, groupColumn: names.includes('title_text') ? 'title_text' : names[0] || '', dateColumn: names.find((name) => /date|created_at|updated_at/i.test(name)) || '', valueColumn: names.find((name) => /count|amount|cost|number|row_order/i.test(name)) || '' }));
  };
  const needsGroup = draft.goal === 'count' || draft.goal === 'compare';
  const needsDate = draft.goal === 'trend';
  const needsValue = draft.goal === 'compare' && draft.aggregation !== 'count';
  return <div className="analysis-wizard-backdrop" role="presentation" onMouseDown={onClose}><section className="analysis-wizard" role="dialog" aria-modal="true" aria-label="分析ウィザード" onMouseDown={(event) => event.stopPropagation()}><header><div><span>ANALYSIS WIZARD</span><h2>何を知りたいですか？</h2><p>選ぶだけで、読み取り専用の分析ノートを作成します。</p></div><button type="button" className="secondary" onClick={onClose}>閉じる</button></header><div className="analysis-wizard-goals"><button className={draft.goal === 'count' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, goal: 'count' }))}><b>分類ごとの件数</b><span>多い項目・偏りを見る</span></button><button className={draft.goal === 'trend' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, goal: 'trend' }))}><b>月ごとの推移</b><span>増減・繁忙期を見る</span></button><button className={draft.goal === 'compare' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, goal: 'compare' }))}><b>分類ごとに比較</b><span>件数・合計・平均を比べる</span></button><button className={draft.goal === 'quality' ? 'active' : ''} onClick={() => setDraft((current) => ({ ...current, goal: 'quality' }))}><b>データの不備を探す</b><span>欠損・重複を確認する</span></button></div><div className="analysis-wizard-fields"><label>対象データ<select value={selected?.name || ''} onChange={(event) => chooseDataset(event.target.value)}>{datasets.map((dataset) => <option key={dataset.name} value={dataset.name}>{dataset.description}（{dataset.name}）</option>)}</select></label>{needsGroup && <label>分類項目<select value={draft.groupColumn} onChange={(event) => setDraft((current) => ({ ...current, groupColumn: event.target.value }))}>{columns.map((column) => <option key={column.name} value={column.name}>{column.description}（{column.name}）</option>)}</select></label>}{needsDate && <label>日付項目<select value={draft.dateColumn} onChange={(event) => setDraft((current) => ({ ...current, dateColumn: event.target.value }))}>{dateColumns.map((column) => <option key={column.name} value={column.name}>{column.description}（{column.name}）</option>)}</select></label>}{draft.goal === 'compare' && <label>集計<select value={draft.aggregation} onChange={(event) => setDraft((current) => ({ ...current, aggregation: event.target.value as AnalysisWizardDraft['aggregation'] }))}><option value="count">件数</option><option value="sum">合計</option><option value="average">平均</option></select></label>}{needsValue && <label>数値項目<select value={draft.valueColumn} onChange={(event) => setDraft((current) => ({ ...current, valueColumn: event.target.value }))}>{numericColumns.map((column) => <option key={column.name} value={column.name}>{column.description}（{column.name}）</option>)}</select></label>}</div><footer><span>作成後に、条件・グラフ・セルを自由に編集できます。</span><button type="button" className="primary" disabled={!selected || (needsGroup && !draft.groupColumn) || (needsDate && !draft.dateColumn) || (needsValue && !draft.valueColumn)} onClick={() => onCreate(draft)}>分析ノートを作成</button></footer></section></div>;
}

function notebookCells(notebook: AnalysisNotebook): AnalysisCell[] {
  if (notebook.cells?.length) return notebook.cells;
  return [{ id: 'legacy-sql', type: 'sql', sql: notebook.sql || STARTER_SQL, chart: notebook.chart || { type: 'bar' } }];
}

function parameterName(value: string, fallback: string): string {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 48);
  return cleaned || fallback;
}

function resultName(value: string, fallback: string): string {
  return parameterName(value, fallback);
}

function transformResult(source: AnalysisQueryResult, transform: AnalysisDataFrameTransform): AnalysisQueryResult {
  const startedAt = Date.now();
  let rows = aq.from(source.rows).objects() as Array<Record<string, unknown>>;
  const column = transform.column || source.columns[0] || '';
  if (transform.operation === 'filter' && column) {
    const needle = String(transform.value || '').toLowerCase();
    rows = rows.filter((row) => {
      const value = row[column];
      if (transform.operator === 'notEmpty') return value !== null && value !== undefined && String(value).trim() !== '';
      if (transform.operator === 'greaterThan') return Number(value) > Number(transform.value);
      if (transform.operator === 'lessThan') return Number(value) < Number(transform.value);
      if (transform.operator === 'equals') return String(value ?? '') === String(transform.value ?? '');
      return String(value ?? '').toLowerCase().includes(needle);
    });
  }
  if (transform.operation === 'select') {
    const selected = (transform.columns || []).filter((item) => source.columns.includes(item));
    if (selected.length) rows = aq.from(rows).select(selected).objects() as Array<Record<string, unknown>>;
  }
  if (transform.operation === 'sort' && column) {
    rows = [...rows].sort((left, right) => {
      const a = left[column]; const b = right[column];
      const direction = transform.direction === 'desc' ? -1 : 1;
      return String(a ?? '').localeCompare(String(b ?? ''), 'ja') * direction;
    });
  }
  if (transform.operation === 'limit') rows = rows.slice(0, Math.max(1, Math.min(MAX_ANALYSIS_ROWS, Number(transform.limit || 100))));
  const columns = transform.operation === 'select' && (transform.columns || []).length ? (transform.columns || []).filter((item) => source.columns.includes(item)) : source.columns;
  return { columns, rows: rows.slice(0, MAX_ANALYSIS_ROWS), rowCount: Math.min(rows.length, MAX_ANALYSIS_ROWS), truncated: rows.length > MAX_ANALYSIS_ROWS, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
}

function preprocessResult(source: AnalysisQueryResult, transform: AnalysisPreprocessTransform): AnalysisQueryResult {
  const startedAt = Date.now();
  const columns = source.columns;
  const chosen = (transform.columns || []).filter((column) => columns.includes(column));
  const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';
  const numeric = (value: unknown): number | null => {
    if (isBlank(value)) return null;
    const normalized = String(value).replace(/[，,\s]/g, '').replace(/％/g, '').replace(/−/g, '-');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const finish = (rows: Array<Record<string, unknown>>, nextColumns = columns, note = ''): AnalysisQueryResult => {
    const result = rows.slice(0, MAX_ANALYSIS_ROWS);
    const output = note ? result.map((row) => ({ ...row })) : result;
    return { columns: nextColumns, rows: output, rowCount: Math.min(rows.length, MAX_ANALYSIS_ROWS), truncated: rows.length > MAX_ANALYSIS_ROWS, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
  };
  if (!transform.sourceCellId) throw new Error('前処理する入力結果を選択してください。');
  if (transform.operation === 'removeDuplicates') {
    if (!chosen.length) throw new Error('重複判定に使う列を1つ以上選択してください。');
    const seen = new Set<string>();
    return finish(source.rows.filter((row) => { const key = chosen.map((column) => JSON.stringify(row[column] ?? null)).join('\u0000'); if (seen.has(key)) return false; seen.add(key); return true; }));
  }
  if (transform.operation === 'handleMissing') {
    if (!chosen.length) throw new Error('欠損を処理する列を1つ以上選択してください。');
    const strategy = transform.missingStrategy || 'custom';
    if (strategy === 'dropRows') return finish(source.rows.filter((row) => chosen.every((column) => !isBlank(row[column]))));
    const stats = new Map<string, number>();
    for (const column of chosen) {
      const values = source.rows.map((row) => numeric(row[column])).filter((value): value is number => value !== null).sort((a,b)=>a-b);
      if (strategy === 'mean') stats.set(column, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
      if (strategy === 'median') stats.set(column, values.length ? values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2 : 0);
    }
    const previous = new Map<string, unknown>();
    const rows = source.rows.map((row) => {
      const next = { ...row };
      for (const column of chosen) {
        if (isBlank(next[column])) {
          if (strategy === 'zero') next[column] = 0;
          else if (strategy === 'mean' || strategy === 'median') next[column] = stats.get(column) ?? null;
          else if (strategy === 'forwardFill') next[column] = previous.get(column) ?? null;
          else next[column] = transform.fillValue ?? '';
        }
        if (!isBlank(next[column])) previous.set(column, next[column]);
      }
      return next;
    });
    return finish(rows);
  }
  if (transform.operation === 'trimText' || transform.operation === 'normalizeText') {
    if (!chosen.length) throw new Error('整形する文字列列を1つ以上選択してください。');
    const rows = source.rows.map((row) => {
      const next = { ...row };
      for (const column of chosen) if (!isBlank(next[column])) {
        const text = String(next[column]).trim();
        next[column] = transform.operation === 'normalizeText' ? text.normalize('NFKC').replace(/\s+/g, ' ') : text;
      }
      return next;
    });
    return finish(rows);
  }
  if (transform.operation === 'coerceNumber' || transform.operation === 'coerceDate') {
    if (!chosen.length) throw new Error('型を整える列を1つ以上選択してください。');
    const rows: Array<Record<string, unknown>> = [];
    for (const row of source.rows) {
      const next = { ...row }; let invalid = false;
      for (const column of chosen) {
        if (isBlank(next[column])) { next[column] = null; continue; }
        if (transform.operation === 'coerceNumber') {
          const value = numeric(next[column]); if (value === null) { invalid = true; next[column] = null; } else next[column] = value;
        } else {
          const date = new Date(String(next[column])); if (!Number.isFinite(date.getTime())) { invalid = true; next[column] = null; } else next[column] = date.toISOString().slice(0, 10);
        }
      }
      if (!(invalid && transform.invalidAction === 'dropRows')) rows.push(next);
    }
    return finish(rows);
  }
  if (transform.operation === 'replaceValues') {
    const column = transform.column || '';
    if (!columns.includes(column)) throw new Error('置換する列を選択してください。');
    const rows = source.rows.map((row) => ({ ...row, [column]: String(row[column] ?? '') === String(transform.findValue ?? '') ? (transform.replaceValue ?? '') : row[column] }));
    return finish(rows);
  }
  if (transform.operation === 'excludeOutliers') {
    const column = transform.column || '';
    if (!columns.includes(column)) throw new Error('外れ値を確認する数値列を選択してください。');
    const values = source.rows.map((row) => numeric(row[column])).filter((value): value is number => value !== null).sort((a,b)=>a-b);
    if (values.length < 4) throw new Error('外れ値除外には有効な数値が4件以上必要です。');
    let lower = -Infinity, upper = Infinity;
    if (transform.outlierMethod === 'threeSigma') { const mean = values.reduce((sum,v)=>sum+v,0)/values.length; const std = Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length); lower = mean - std*3; upper = mean + std*3; }
    else { const percentile = (p:number) => { const i=(values.length-1)*p; const lo=Math.floor(i), hi=Math.ceil(i); return values[lo] + (values[hi]-values[lo])*(i-lo); }; const q1=percentile(.25), q3=percentile(.75), iqr=q3-q1; lower=q1-iqr*1.5; upper=q3+iqr*1.5; }
    return finish(source.rows.filter((row) => { const value=numeric(row[column]); return value === null || (value >= lower && value <= upper); }));
  }
  throw new Error('選択した前処理は実行できません。');
}

function functionResult(source: AnalysisQueryResult, transform: AnalysisFunctionTransform, joinedSource?: AnalysisQueryResult): AnalysisQueryResult {
  const startedAt = Date.now();
  const sourceRows = source.rows.map((row) => ({ ...row }));
  const numeric = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : null; };
  const operationLabels: Record<AnalysisFunctionTransform['operation'], string> = {
    yearOverYear: '前期比', movingAverage: '移動平均', cumulative: '累計', shareOfTotal: '構成比', rank: '順位', fillMissing: '補完値', excludeOutliers: '外れ値除外後',
    join: '結合結果', unpivot: '値', splitText: '分割値', dateDiff: '日数差', conditionalColumn: '条件列', formula: '計算値', dropDuplicates: '重複除去', renameColumn: '列名変更',
    correlation: '相関係数', linearRegression: '回帰係数', tTest: 't値', chiSquare: 'カイ二乗値', anova: 'F値',
  };
  const outputColumn = transform.outputColumn || operationLabels[transform.operation];
  const valueColumn = transform.valueColumn || source.columns.find((column) => source.rows.some((row) => numeric(row[column]) !== null)) || '';
  const groupColumn = transform.groupColumn || '';
  const periodColumn = transform.periodColumn || '';
  const finish = (columns: string[], rows: Array<Record<string, unknown>>, truncated = false): AnalysisQueryResult => ({ columns, rows: rows.slice(0, MAX_ANALYSIS_ROWS), rowCount: Math.min(rows.length, MAX_ANALYSIS_ROWS), truncated: truncated || rows.length > MAX_ANALYSIS_ROWS, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt });

  if (transform.operation === 'join') {
    if (!joinedSource) throw new Error('結合する2つ目の入力結果を選択してください。');
    const leftKey = transform.joinLeftColumn || '';
    const rightKey = transform.joinRightColumn || '';
    if (!leftKey || !rightKey) throw new Error('結合キーを左右それぞれ選択してください。');
    const rightIndex = new Map<string, Array<Record<string, unknown>>>();
    for (const row of joinedSource.rows) { const key = String(row[rightKey] ?? ''); rightIndex.set(key, [...(rightIndex.get(key) || []), row]); }
    const rightColumns = joinedSource.columns.map((column) => source.columns.includes(column) ? `right_${column}` : column);
    const rows: Array<Record<string, unknown>> = [];
    for (const left of sourceRows) {
      const matches = rightIndex.get(String(left[leftKey] ?? '')) || [];
      if (!matches.length && transform.joinType !== 'inner') rows.push({ ...left, ...Object.fromEntries(rightColumns.map((column) => [column, null])) });
      for (const right of matches) {
        const appended = Object.fromEntries(joinedSource.columns.map((column) => [source.columns.includes(column) ? `right_${column}` : column, right[column] ?? null]));
        rows.push({ ...left, ...appended });
      }
    }
    return finish([...source.columns, ...rightColumns.filter((column) => !source.columns.includes(column))], rows);
  }

  if (transform.operation === 'unpivot') {
    const values = (transform.valueColumns || []).filter((column) => source.columns.includes(column));
    if (!values.length) throw new Error('縦持ちへ変換する値列を1つ以上選択してください。');
    const idColumns = source.columns.filter((column) => !values.includes(column));
    const rows = sourceRows.flatMap((row) => values.map((column) => ({ ...Object.fromEntries(idColumns.map((id) => [id, row[id] ?? null])), variable: column, [outputColumn]: row[column] ?? null })));
    return finish([...idColumns, 'variable', outputColumn], rows);
  }

  if (transform.operation === 'splitText') {
    const textColumn = transform.valueColumn || '';
    if (!textColumn) throw new Error('分割する文字列列を選択してください。');
    const delimiter = transform.delimiter ?? ',';
    const index = Math.max(0, Number(transform.splitIndex || 0));
    const rows = sourceRows.map((row) => ({ ...row, [outputColumn]: String(row[textColumn] ?? '').split(delimiter)[index]?.trim() || null }));
    return finish(Array.from(new Set([...source.columns, outputColumn])), rows);
  }

  if (transform.operation === 'dateDiff') {
    const startColumn = transform.valueColumn || '';
    const endColumn = transform.secondColumn || '';
    if (!startColumn || !endColumn) throw new Error('開始日列と終了日列を選択してください。');
    const rows = sourceRows.map((row) => {
      const start = new Date(String(row[startColumn] ?? ''));
      const end = new Date(String(row[endColumn] ?? ''));
      const value = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 86400000) : null;
      return { ...row, [outputColumn]: value };
    });
    return finish(Array.from(new Set([...source.columns, outputColumn])), rows);
  }

  if (transform.operation === 'formula') {
    const column = transform.valueColumn || '';
    if (!column) throw new Error('数式セルの対象列を選択してください。');
    const kind = transform.formulaKind || 'arithmetic';
    const raw = String(transform.formulaValue ?? '');
    const rhsNumber = Number(raw);
    const safeNumber = Number.isFinite(rhsNumber) ? rhsNumber : 0;
    if (['arithmetic', 'round', 'ifGreater'].includes(kind) && raw.trim() && !Number.isFinite(rhsNumber)) throw new Error('数式セルの値には数値を入力してください。');
    const rows = sourceRows.map((row) => {
      const value = row[column];
      const number = numeric(value);
      let calculated: unknown = null;
      if (kind === 'arithmetic') {
        if (number !== null) {
          const operator = transform.formulaOperator || 'add';
          calculated = operator === 'subtract' ? number - safeNumber : operator === 'multiply' ? number * safeNumber : operator === 'divide' ? (safeNumber === 0 ? null : number / safeNumber) : number + safeNumber;
        }
      } else if (kind === 'round') calculated = number === null ? null : Number(number.toFixed(Math.max(0, Math.min(10, Math.floor(safeNumber)))));
      else if (kind === 'absolute') calculated = number === null ? null : Math.abs(number);
      else if (kind === 'year' || kind === 'month') { const date = new Date(String(value ?? '')); calculated = Number.isFinite(date.getTime()) ? (kind === 'year' ? date.getFullYear() : date.getMonth() + 1) : null; }
      else if (kind === 'coalesce') calculated = value === null || value === undefined || String(value).trim() === '' ? raw : value;
      else if (kind === 'dateDiff') { const end = new Date(String(row[transform.secondColumn || ''] ?? '')); const start = new Date(String(value ?? '')); calculated = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) ? Math.round((end.getTime() - start.getTime()) / 86400000) : null; }
      else if (kind === 'ifGreater') calculated = number !== null && number > safeNumber ? (transform.trueValue || '該当') : (transform.falseValue || '非該当');
      return { ...row, [outputColumn]: calculated };
    });
    return finish(Array.from(new Set([...source.columns, outputColumn])), rows);
  }

  if (transform.operation === 'dropDuplicates') {
    const column = transform.valueColumn || '';
    if (!column) throw new Error('重複判定に使う列を選択してください。');
    const seen = new Set<string>();
    const rows = sourceRows.filter((row) => { const key = String(row[column] ?? ''); if (seen.has(key)) return false; seen.add(key); return true; });
    return finish(source.columns, rows);
  }

  if (transform.operation === 'renameColumn') {
    const column = transform.valueColumn || '';
    const renameTo = String(transform.renameTo || '').trim();
    if (!column || !renameTo) throw new Error('変更する列と新しい列名を入力してください。');
    if (source.columns.includes(renameTo) && renameTo !== column) throw new Error('新しい列名が既に存在します。別の列名を指定してください。');
    const rows = sourceRows.map((row) => { const next = { ...row, [renameTo]: row[column] ?? null }; delete next[column]; return next; });
    return finish(source.columns.map((item) => item === column ? renameTo : item), rows);
  }

  if (transform.operation === 'conditionalColumn') {
    const column = transform.valueColumn || '';
    if (!column) throw new Error('条件を確認する列を選択してください。');
    const operator = transform.conditionOperator || 'equals';
    const expected = transform.conditionValue || '';
    const passes = (value: unknown) => {
      if (operator === 'notEmpty') return value !== null && value !== undefined && String(value).trim() !== '';
      if (operator === 'contains') return String(value ?? '').toLowerCase().includes(expected.toLowerCase());
      if (operator === 'greaterThan') return Number(value) > Number(expected);
      if (operator === 'lessThan') return Number(value) < Number(expected);
      return String(value ?? '') === expected;
    };
    const rows = sourceRows.map((row) => ({ ...row, [outputColumn]: passes(row[column]) ? (transform.trueValue || '該当') : (transform.falseValue || '非該当') }));
    return finish(Array.from(new Set([...source.columns, outputColumn])), rows);
  }

  if (transform.operation === 'tTest') {
    const value = transform.valueColumn || '';
    const group = transform.groupColumn || '';
    if (!value || !group) throw new Error('t検定には数値列と2群の分類列を選択してください。');
    const groups = new Map<string, number[]>();
    for (const row of sourceRows) { const n = numeric(row[value]); if (n !== null) { const key = String(row[group] ?? '(空欄)'); groups.set(key, [...(groups.get(key) || []), n]); } }
    const entries = [...groups.entries()].filter(([, values]) => values.length >= 2).slice(0, 2);
    if (entries.length !== 2) throw new Error('t検定には各群2件以上の2群データが必要です。');
    const [aName, a] = entries[0]; const [bName, b] = entries[1];
    const mean = (values: number[]) => values.reduce((sum, item) => sum + item, 0) / values.length;
    const variance = (values: number[], m: number) => values.reduce((sum, item) => sum + (item - m) ** 2, 0) / Math.max(1, values.length - 1);
    const ma = mean(a), mb = mean(b), va = variance(a, ma), vb = variance(b, mb); const se2 = va / a.length + vb / b.length;
    const t = se2 > 0 ? (ma - mb) / Math.sqrt(se2) : null;
    const df = se2 > 0 ? (se2 ** 2) / (((va / a.length) ** 2) / Math.max(1, a.length - 1) + ((vb / b.length) ** 2) / Math.max(1, b.length - 1)) : null;
    return finish(['group_a','group_b','n_a','n_b','mean_a','mean_b','t_value','degrees_of_freedom'], [{ group_a: aName, group_b: bName, n_a: a.length, n_b: b.length, mean_a: ma, mean_b: mb, t_value: t, degrees_of_freedom: df }]);
  }

  if (transform.operation === 'chiSquare') {
    const rowCol = transform.valueColumn || ''; const colCol = transform.secondColumn || '';
    if (!rowCol || !colCol) throw new Error('カイ二乗検定には2つの分類列を選択してください。');
    const rowKeys = [...new Set(sourceRows.map((row) => String(row[rowCol] ?? '(空欄)')))].slice(0, 50); const colKeys = [...new Set(sourceRows.map((row) => String(row[colCol] ?? '(空欄)')))].slice(0, 50);
    if (rowKeys.length < 2 || colKeys.length < 2) throw new Error('カイ二乗検定には各列2分類以上が必要です。');
    const counts = new Map<string, number>(); sourceRows.forEach((row) => { const key = `${String(row[rowCol] ?? '(空欄)')}\u0000${String(row[colCol] ?? '(空欄)')}`; counts.set(key, (counts.get(key) || 0) + 1); });
    const total = sourceRows.length; let chi = 0;
    for (const r of rowKeys) for (const c of colKeys) { const observed = counts.get(`${r}\u0000${c}`) || 0; const rTotal = colKeys.reduce((sum, cc) => sum + (counts.get(`${r}\u0000${cc}`) || 0), 0); const cTotal = rowKeys.reduce((sum, rr) => sum + (counts.get(`${rr}\u0000${c}`) || 0), 0); const expected = total ? rTotal * cTotal / total : 0; if (expected > 0) chi += (observed - expected) ** 2 / expected; }
    return finish(['row_column','column_column','sample_size','chi_square','degrees_of_freedom'], [{ row_column: rowCol, column_column: colCol, sample_size: total, chi_square: chi, degrees_of_freedom: (rowKeys.length - 1) * (colKeys.length - 1) }]);
  }

  if (transform.operation === 'anova') {
    const value = transform.valueColumn || ''; const group = transform.groupColumn || '';
    if (!value || !group) throw new Error('分散分析には数値列と分類列を選択してください。');
    const groups = new Map<string, number[]>(); for (const row of sourceRows) { const n = numeric(row[value]); if (n !== null) { const key = String(row[group] ?? '(空欄)'); groups.set(key, [...(groups.get(key) || []), n]); } }
    const entries = [...groups.entries()].filter(([, items]) => items.length > 0); if (entries.length < 2) throw new Error('分散分析には2群以上が必要です。');
    const all = entries.flatMap(([, items]) => items); const overall = all.reduce((sum, item) => sum + item, 0) / all.length; const ssBetween = entries.reduce((sum, [, items]) => { const m = items.reduce((a,b)=>a+b,0)/items.length; return sum + items.length*(m-overall)**2; }, 0); const ssWithin = entries.reduce((sum, [, items]) => { const m = items.reduce((a,b)=>a+b,0)/items.length; return sum + items.reduce((a,b)=>a+(b-m)**2,0); },0); const dfBetween = entries.length-1; const dfWithin = all.length-entries.length; const f = dfWithin>0 && ssWithin>0 ? (ssBetween/dfBetween)/(ssWithin/dfWithin) : null;
    return finish(['group_column','value_column','group_count','sample_size','f_value','df_between','df_within'], [{ group_column: group, value_column: value, group_count: entries.length, sample_size: all.length, f_value: f, df_between: dfBetween, df_within: dfWithin }]);
  }

  if (transform.operation === 'correlation' || transform.operation === 'linearRegression') {
    const xColumn = transform.valueColumn || '';
    const yColumn = transform.secondColumn || '';
    if (!xColumn || !yColumn) throw new Error('2つの数値列を選択してください。');
    const pairs = sourceRows.map((row) => ({ x: numeric(row[xColumn]), y: numeric(row[yColumn]) })).filter((pair): pair is { x: number; y: number } => pair.x !== null && pair.y !== null);
    if (pairs.length < 2) throw new Error('相関・回帰には数値の組み合わせが2件以上必要です。');
    const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
    const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
    const covariance = pairs.reduce((sum, pair) => sum + (pair.x - meanX) * (pair.y - meanY), 0);
    const varianceX = pairs.reduce((sum, pair) => sum + (pair.x - meanX) ** 2, 0);
    const varianceY = pairs.reduce((sum, pair) => sum + (pair.y - meanY) ** 2, 0);
    const correlation = varianceX > 0 && varianceY > 0 ? covariance / Math.sqrt(varianceX * varianceY) : null;
    if (transform.operation === 'correlation') return finish(['x_column', 'y_column', 'pair_count', outputColumn], [{ x_column: xColumn, y_column: yColumn, pair_count: pairs.length, [outputColumn]: correlation }]);
    const slope = varianceX > 0 ? covariance / varianceX : null;
    const intercept = slope === null ? null : meanY - slope * meanX;
    const r2 = correlation === null ? null : correlation ** 2;
    return finish(['x_column', 'y_column', 'pair_count', 'slope', 'intercept', 'correlation', 'r_squared'], [{ x_column: xColumn, y_column: yColumn, pair_count: pairs.length, slope, intercept, correlation, r_squared: r2 }]);
  }

  if (!valueColumn) throw new Error('分析関数セルの数値列を選択してください。');
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of sourceRows) { const key = groupColumn ? String(row[groupColumn] ?? '(空欄)') : '__all__'; const list = groups.get(key) || []; list.push({ ...row }); groups.set(key, list); }
  const rows: Array<Record<string, unknown>> = [];
  for (const groupRows of groups.values()) {
    const ordered = periodColumn ? [...groupRows].sort((a, b) => String(a[periodColumn] ?? '').localeCompare(String(b[periodColumn] ?? ''), 'ja')) : groupRows;
    const values = ordered.map((row) => numeric(row[valueColumn]));
    const valid = values.filter((value): value is number => value !== null);
    const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
    const std = valid.length > 1 ? Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length) : 0;
    let cumulative = 0;
    const ranks = [...valid].sort((a, b) => b - a);
    ordered.forEach((row, index) => {
      const value = values[index];
      if (transform.operation === 'excludeOutliers' && value !== null && std > 0 && Math.abs(value - mean) > std * 3) return;
      const next = { ...row } as Record<string, unknown>;
      if (transform.operation === 'yearOverYear') { const previous = values[index - 1]; next[outputColumn] = value !== null && previous !== null && previous !== 0 ? (value - previous) / Math.abs(previous) : null; }
      else if (transform.operation === 'movingAverage') { const size = Math.max(2, Math.min(120, Number(transform.windowSize || 3))); const sample = values.slice(Math.max(0, index - size + 1), index + 1).filter((item): item is number => item !== null); next[outputColumn] = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : null; }
      else if (transform.operation === 'cumulative') { if (value !== null) cumulative += value; next[outputColumn] = cumulative; }
      else if (transform.operation === 'shareOfTotal') { const total = valid.reduce((a, b) => a + b, 0); next[outputColumn] = value !== null && total !== 0 ? value / total : null; }
      else if (transform.operation === 'rank') next[outputColumn] = value !== null ? ranks.indexOf(value) + 1 : null;
      else if (transform.operation === 'fillMissing') { next[outputColumn] = value ?? values.slice(0, index).reverse().find((item) => item !== null) ?? null; }
      else next[outputColumn] = value;
      rows.push(next);
    });
  }
  return finish(Array.from(new Set([...source.columns, outputColumn])), rows);
}

function importResult(imported: AnalysisImportTransform): AnalysisQueryResult {
  if (!imported.columns.length) throw new Error('CSV、Excel、JSONファイルを選択してください。');
  const rows = imported.rows.slice(0, MAX_ANALYSIS_ROWS).map((row) => Object.fromEntries(imported.columns.map((column) => [column, row[column] ?? null])));
  return { columns: imported.columns, rows, rowCount: rows.length, truncated: imported.truncated === true, executedAt: new Date().toISOString(), elapsedMs: 0 };
}

function pivotResult(source: AnalysisQueryResult, pivot: AnalysisPivotTransform): AnalysisQueryResult {
  const startedAt = Date.now();
  const rowColumn = pivot.rowColumn;
  if (!rowColumn) throw new Error('ピボットセルの行項目を選択してください。');
  const columnColumn = pivot.columnColumn || '';
  const valueColumn = pivot.valueColumn || '';
  const groups = new Map<string, { row: unknown; column: unknown; count: number; sum: number }>();
  for (const item of source.rows) {
    const row = item[rowColumn] ?? '(空欄)';
    const column = columnColumn ? (item[columnColumn] ?? '(空欄)') : '値';
    const key = `${String(row)}\u0000${String(column)}`;
    const current = groups.get(key) || { row, column, count: 0, sum: 0 };
    current.count += 1;
    if (pivot.aggregation !== 'count') current.sum += Number(item[valueColumn]) || 0;
    groups.set(key, current);
  }
  const valueFor = (item: { count: number; sum: number }) => pivot.aggregation === 'count' ? item.count : pivot.aggregation === 'sum' ? item.sum : item.count ? item.sum / item.count : 0;
  if (!columnColumn) {
    const metric = pivot.aggregation === 'count' ? 'count' : pivot.aggregation === 'sum' ? `sum_${valueColumn}` : `avg_${valueColumn}`;
    const rows = [...groups.values()].map((item) => ({ [rowColumn]: item.row, [metric]: valueFor(item) }));
    return { columns: [rowColumn, metric], rows, rowCount: rows.length, truncated: false, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
  }
  const columns = [...new Set([...groups.values()].map((item) => String(item.column)))];
  const rowsMap = new Map<string, Record<string, unknown>>();
  for (const item of groups.values()) {
    const key = String(item.row);
    const target = rowsMap.get(key) || { [rowColumn]: item.row };
    target[String(item.column)] = valueFor(item);
    rowsMap.set(key, target);
  }
  const rows = [...rowsMap.values()];
  return { columns: [rowColumn, ...columns], rows, rowCount: rows.length, truncated: false, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
}

function summaryResult(source: AnalysisQueryResult, summary: AnalysisSummaryTransform): AnalysisQueryResult {
  const startedAt = Date.now();
  const numericColumn = summary.numericColumn || source.columns.find((column) => source.rows.some((row) => Number.isFinite(Number(row[column])))) || '';
  const groupColumn = summary.groupColumn || '';
  const base = (rows: Array<Record<string, unknown>>, label = '全体'): Record<string, unknown> => {
    const numeric = numericColumn ? rows.map((row) => Number(row[numericColumn])).filter(Number.isFinite) : [];
    const sorted = [...numeric].sort((a, b) => a - b);
    const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    const mean = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null;
    const variance = mean === null || numeric.length < 2 ? null : numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (numeric.length - 1);
    return { group: label, row_count: rows.length, missing_cells: rows.reduce((count, row) => count + source.columns.filter((column) => row[column] === null || row[column] === undefined || String(row[column]).trim() === '').length, 0), numeric_column: numericColumn || '(数値列なし)', numeric_count: numeric.length, mean, median, min: sorted.length ? sorted[0] : null, max: sorted.length ? sorted[sorted.length - 1] : null, stddev: variance === null ? null : Math.sqrt(variance), unique_values: numericColumn ? new Set(rows.map((row) => String(row[numericColumn] ?? ''))).size : null };
  };
  let rows: Array<Record<string, unknown>>;
  if (groupColumn && source.columns.includes(groupColumn)) {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    source.rows.forEach((row) => { const key = String(row[groupColumn] ?? '(空欄)'); groups.set(key, [...(groups.get(key) || []), row]); });
    rows = [...groups.entries()].map(([label, values]) => base(values, label));
  } else rows = [base(source.rows)];
  const columns = ['group', 'row_count', 'missing_cells', 'numeric_column', 'numeric_count', 'mean', 'median', 'min', 'max', 'stddev', 'unique_values'];
  return { columns, rows, rowCount: rows.length, truncated: false, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
}

function qualityResult(source: AnalysisQueryResult, quality: AnalysisQualityTransform): AnalysisQueryResult {
  const startedAt = Date.now();
  const checked = (quality.columns || []).filter((column) => source.columns.includes(column));
  const columns = checked.length ? checked : source.columns;
  const rows: Array<Record<string, unknown>> = [];
  if (quality.checkMissing !== false) {
    columns.forEach((column) => { const count = source.rows.filter((row) => row[column] === null || row[column] === undefined || String(row[column]).trim() === '').length; rows.push({ check: '欠損値', column, issue_count: count, rate: source.rowCount ? count / source.rowCount : 0, status: count ? '要確認' : '問題なし' }); });
  }
  if (quality.checkDuplicates !== false) {
    const counts = new Map<string, number>();
    source.rows.forEach((row) => { const key = JSON.stringify(columns.map((column) => row[column] ?? null)); counts.set(key, (counts.get(key) || 0) + 1); });
    const duplicateRows = [...counts.values()].reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);
    rows.push({ check: '重複行', column: columns.join(', '), issue_count: duplicateRows, rate: source.rowCount ? duplicateRows / source.rowCount : 0, status: duplicateRows ? '要確認' : '問題なし' });
  }
  if (quality.checkNonNumeric) {
    columns.forEach((column) => { const populated = source.rows.filter((row) => row[column] !== null && row[column] !== undefined && String(row[column]).trim() !== ''); const count = populated.filter((row) => !Number.isFinite(Number(row[column]))).length; rows.push({ check: '数値形式外', column, issue_count: count, rate: populated.length ? count / populated.length : 0, status: count ? '要確認' : '問題なし' }); });
  }
  return { columns: ['check', 'column', 'issue_count', 'rate', 'status'], rows, rowCount: rows.length, truncated: false, executedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
}

function ResultSourceSelect({ value, upstream, onChange }: { value: string; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (value: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)}><option value="">上側の結果セルを選択</option>{upstream.map((item) => <option key={item.id} value={item.id}>{item.label}{item.result ? '' : '（未実行・自動実行）'}</option>)}</select>;
}

function PivotEditor({ cell, upstream, onChange }: { cell: PivotCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (pivot: AnalysisPivotTransform) => void }) {
  const source = upstream.find((item) => item.id === cell.pivot.sourceCellId);
  const columns = source?.result?.columns || [];
  const update = (patch: Partial<AnalysisPivotTransform>) => onChange({ ...cell.pivot, ...patch });
  return <div className="analysis-dataframe-cell">
    <div className="analysis-parameter-grid">
      <label>入力結果<ResultSourceSelect value={cell.pivot.sourceCellId} upstream={upstream} onChange={(sourceCellId) => update({ sourceCellId, rowColumn: '', columnColumn: '', valueColumn: '' })} /></label>
      <label>出力名<input value={cell.pivot.outputName} onChange={(e) => update({ outputName: resultName(e.target.value, `pivot_${cell.id.slice(-4)}`) })} /><small>次のSQLでは <code>{`result_${cell.pivot.outputName || 'name'}`}</code></small></label>
      <label>行項目<select value={cell.pivot.rowColumn} onChange={(e) => update({ rowColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
      <label>列項目（任意）<select value={cell.pivot.columnColumn || ''} onChange={(e) => update({ columnColumn: e.target.value })}><option value="">指定しない</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
      <label>集計<select value={cell.pivot.aggregation} onChange={(e) => update({ aggregation: e.target.value as AnalysisPivotTransform['aggregation'] })}><option value="count">件数</option><option value="sum">合計</option><option value="average">平均</option></select></label>
      {cell.pivot.aggregation !== 'count' && <label>値列<select value={cell.pivot.valueColumn || ''} onChange={(e) => update({ valueColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    </div>
    <div className="analysis-parameter-help">上流結果を安全に集計します。行・列・値を選ぶだけで、SQLを書かずにピボット表を作成できます。</div>
  </div>;
}

function SummaryEditor({ cell, upstream, onChange }: { cell: SummaryCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (summary: AnalysisSummaryTransform) => void }) {
  const source = upstream.find((item) => item.id === cell.summary.sourceCellId);
  const columns = source?.result?.columns || [];
  const update = (patch: Partial<AnalysisSummaryTransform>) => onChange({ ...cell.summary, ...patch });
  return <div className="analysis-dataframe-cell"><div className="analysis-parameter-grid">
    <label>入力結果<ResultSourceSelect value={cell.summary.sourceCellId} upstream={upstream} onChange={(sourceCellId) => update({ sourceCellId, numericColumn: '', groupColumn: '' })} /></label>
    <label>出力名<input value={cell.summary.outputName} onChange={(e) => update({ outputName: resultName(e.target.value, `summary_${cell.id.slice(-4)}`) })} /><small>後続SQLでは <code>{`result_${cell.summary.outputName || 'name'}`}</code></small></label>
    <label>数値列（任意）<select value={cell.summary.numericColumn || ''} onChange={(e) => update({ numericColumn: e.target.value })}><option value="">自動判定</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
    <label>グループ列（任意）<select value={cell.summary.groupColumn || ''} onChange={(e) => update({ groupColumn: e.target.value })}><option value="">全体を要約</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
  </div><div className="analysis-parameter-help">件数・欠損数・平均・中央値・最小／最大・標準偏差を算出します。グループ列を選ぶと、カテゴリ別の <code>describe()</code> に近い要約になります。</div></div>;
}

function QualityEditor({ cell, upstream, onChange }: { cell: QualityCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (quality: AnalysisQualityTransform) => void }) {
  const source = upstream.find((item) => item.id === cell.quality.sourceCellId);
  const columns = source?.result?.columns || [];
  const selected = new Set(cell.quality.columns || []);
  const update = (patch: Partial<AnalysisQualityTransform>) => onChange({ ...cell.quality, ...patch });
  return <div className="analysis-dataframe-cell"><div className="analysis-parameter-grid">
    <label>入力結果<ResultSourceSelect value={cell.quality.sourceCellId} upstream={upstream} onChange={(sourceCellId) => update({ sourceCellId, columns: [] })} /></label>
    <label>出力名<input value={cell.quality.outputName} onChange={(e) => update({ outputName: resultName(e.target.value, `quality_${cell.id.slice(-4)}`) })} /><small>後続SQLでは <code>{`result_${cell.quality.outputName || 'name'}`}</code></small></label>
  </div>
  <div className="analysis-quality-checks"><label><input type="checkbox" checked={cell.quality.checkMissing !== false} onChange={(e) => update({ checkMissing: e.target.checked })} />欠損値</label><label><input type="checkbox" checked={cell.quality.checkDuplicates !== false} onChange={(e) => update({ checkDuplicates: e.target.checked })} />重複行</label><label><input type="checkbox" checked={cell.quality.checkNonNumeric === true} onChange={(e) => update({ checkNonNumeric: e.target.checked })} />数値形式外</label></div>
  {columns.length > 0 && <div className="analysis-dataframe-columns"><span>確認する列（未選択なら全列）</span>{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={(e) => { const next = new Set(selected); e.target.checked ? next.add(column) : next.delete(column); update({ columns: [...next] }); }} />{column}</label>)}</div>}
  <div className="analysis-parameter-help">欠損値、指定列の完全一致による重複行、数値列に混入した非数値を確認します。元データを更新せず、問題件数だけを安全に一覧化します。</div></div>;
}

function ChartEditor({ cell, upstream, result, onChange }: { cell: ChartCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; result?: AnalysisQueryResult; onChange: (patch: Partial<ChartCell>) => void }) {
  const columns = result?.columns || [];
  return <div className="analysis-dataframe-cell"><div className="analysis-parameter-grid">
    <label>入力結果<ResultSourceSelect value={cell.sourceCellId} upstream={upstream} onChange={(sourceCellId) => onChange({ sourceCellId })} /></label>
    <label>種類<select value={cell.chart.type} onChange={(e) => onChange({ chart: { ...cell.chart, type: e.target.value as ChartCell['chart']['type'] } })}><option value="bar">棒グラフ</option><option value="line">折れ線</option><option value="dot">散布図</option><option value="area">面グラフ</option><option value="histogram">ヒストグラム</option><option value="box">箱ひげ図</option><option value="heatmap">ヒートマップ</option><option value="table">表のみ</option></select></label>
    <label>横軸<select value={cell.chart.x || ''} onChange={(e) => onChange({ chart: { ...cell.chart, x: e.target.value } })}><option value="">自動</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
    <label>縦軸<select value={cell.chart.y || ''} onChange={(e) => onChange({ chart: { ...cell.chart, y: e.target.value } })}><option value="">自動</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
  </div><div className="analysis-chart-guide-inline"><b>{CHART_GUIDES[cell.chart.type].title}の使い方</b><span>{CHART_GUIDES[cell.chart.type].purpose}</span><small>{CHART_GUIDES[cell.chart.type].axes}</small><em>{CHART_GUIDES[cell.chart.type].caution}</em></div><div className="analysis-parameter-help">グラフ設定はノート保存時に残ります。入力元が未実行なら、このセルの実行で上流を先に実行します。</div></div>;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(result: AnalysisQueryResult, title: string): void {
  const csv = [result.columns.map(csvEscape).join(','), ...result.rows.map((row) => result.columns.map((column) => csvEscape(row[column])).join(','))].join('\r\n');
  const safe = title.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'analysis';
  const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safe}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const PlotView = memo(function PlotView({ result, chart }: { result: AnalysisQueryResult; chart: SqlCell['chart'] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const columns = result.columns;
  const x = chart.x || columns[0] || '';
  const y = chart.y || columns.find((column) => result.rows.some((row) => Number.isFinite(Number(row[column])))) || '';

  useEffect(() => {
    if (!ref.current || chart.type === 'table' || !x || !result.rows.length) return;
    const sampledRows = sampleAnalysisRows(result.rows);
    const numericRows = aq.from(sampledRows).objects().map((row: any) => ({ ...row, [y]: Number(row[y]) })).filter((row: any) => chart.type === 'histogram' ? Number.isFinite(Number(row[x])) : Number.isFinite(row[y]));
    if (!numericRows.length) return;
    const width = Math.max(360, ref.current.clientWidth || 720);
    const mark = chart.type === 'line' ? Plot.lineY(numericRows, { x, y, tip: true })
      : chart.type === 'dot' ? Plot.dot(numericRows, { x, y, tip: true })
      : chart.type === 'area' ? Plot.areaY(numericRows, { x, y, tip: true })
      : chart.type === 'histogram' ? Plot.rectY(numericRows, Plot.binX({ y: 'count' }, { x }))
      : chart.type === 'box' ? Plot.boxY(numericRows, { x, y, tip: true })
      : chart.type === 'heatmap' ? Plot.cell(numericRows, { x, y, fill: y, tip: true })
      : Plot.barY(numericRows, { x, y, tip: true });
    const plot = Plot.plot({ width, height: 320, marginLeft: 64, marginBottom: 58, x: { label: x }, y: { label: chart.type === 'histogram' ? 'count' : y, grid: true }, marks: [mark, ...(chart.type === 'bar' || chart.type === 'area' ? [Plot.ruleY([0])] : [])] });
    ref.current.replaceChildren(plot);
    return () => plot.remove();
  }, [result, chart.type, chart.x, chart.y, x, y]);

  if (chart.type === 'table') return null;
  if (!x || (chart.type !== 'histogram' && !y)) return <div className="analysis-empty-chart">横軸と縦軸を選ぶとグラフを表示します。</div>;
  return <div className="analysis-plot" ref={ref} />;
});
function originTargetForRow(row: Record<string, unknown>, columns: string[]): OriginTarget | null {
  const text = (key: string) => String(row[key] ?? '').trim();
  const databaseId = text('database_id') || text('databaseId');
  const rowId = text('row_id') || text('rowId');
  if (databaseId && rowId) return { kind: 'database-row', databaseId, rowId, label: '元のDB行を開く' };
  if (databaseId && (columns.includes('database_id') || columns.includes('databaseId'))) return { kind: 'database', databaseId, label: '元のデータベースを開く' };
  const sourceType = text('source_type');
  const sourceId = text('source_id');
  if (sourceType === 'page' && sourceId) return { kind: 'page', pageId: sourceId, label: '元ページを開く' };
  if (sourceType === 'journal' && sourceId) return { kind: 'journal', date: sourceId, label: '元のJournalを開く' };
  if ((sourceType === 'database_row' || sourceType === 'database-row') && sourceId && databaseId) return { kind: 'database-row', databaseId, rowId: sourceId, label: '元のDB行を開く' };
  const pageId = text('page_id') || text('pageId');
  if (pageId) return { kind: 'page', pageId, label: '元ページを開く' };
  const journalDate = text('journal_date');
  if (journalDate) return { kind: 'journal', date: journalDate, label: '元のJournalを開く' };
  const looksLikeJournal = columns.includes('date') && (columns.includes('full_text') || columns.includes('mood') || columns.includes('weather') || columns.includes('preview_snippet'));
  if (looksLikeJournal && text('date')) return { kind: 'journal', date: text('date'), label: '元のJournalを開く' };
  const looksLikePage = columns.includes('id') && (columns.includes('markdown') || columns.includes('parent_id') || columns.includes('properties_json'));
  if (looksLikePage && text('id')) return { kind: 'page', pageId: text('id'), label: '元ページを開く' };
  return null;
}

const ResultTable = memo(function ResultTable({ result, api, onOpenOrigin }: { result: AnalysisQueryResult; api: ApiClient | null; onOpenOrigin?: (target: OriginTarget) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [pages, setPages] = useState<Record<number, Array<Record<string, unknown>>>>({ 0: result.rows });
  const [loadingPages, setLoadingPages] = useState<Record<number, boolean>>({});
  const scrollFrame = useRef<number | null>(null);
  const pageSize = Math.max(50, result.pageSize || result.rows.length || 500);
  useEffect(() => {
    setScrollTop(0);
    setPages({ 0: result.rows });
    setLoadingPages({});
  }, [result.resultId, result.executedAt, result.rows]);
  const hasOrigin = Boolean(onOpenOrigin && ['database_id', 'databaseId', 'row_id', 'rowId', 'page_id', 'pageId', 'source_id', 'journal_date', 'id'].some((column) => result.columns.includes(column)));
  const visibleCount = Math.ceil(ANALYSIS_TABLE_VIEWPORT_HEIGHT / ANALYSIS_TABLE_ROW_HEIGHT) + ANALYSIS_TABLE_OVERSCAN * 2;
  const firstRow = Math.max(0, Math.floor(scrollTop / ANALYSIS_TABLE_ROW_HEIGHT) - ANALYSIS_TABLE_OVERSCAN);
  const lastRow = Math.min(result.rowCount, firstRow + visibleCount);
  const spacerColumns = result.columns.length + (hasOrigin ? 1 : 0);
  const topSpacer = firstRow * ANALYSIS_TABLE_ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (result.rowCount - lastRow) * ANALYSIS_TABLE_ROW_HEIGHT);
  const loadPage = useCallback(async (page: number) => {
    if (!result.resultId || !api || pages[page] || loadingPages[page]) return;
    setLoadingPages((current) => ({ ...current, [page]: true }));
    try {
      const response = await api.getAnalysisResultPage(result.resultId, page, pageSize);
      setPages((current) => ({ ...current, [page]: response.rows }));
    } catch {
      // The main execution message remains the primary error surface. A cache can expire after 15 minutes.
    } finally {
      setLoadingPages((current) => { const next = { ...current }; delete next[page]; return next; });
    }
  }, [api, loadingPages, pageSize, pages, result.resultId]);
  useEffect(() => {
    if (!result.resultId || !api) return;
    const fromPage = Math.floor(firstRow / pageSize);
    const toPage = Math.floor(Math.max(firstRow, lastRow - 1) / pageSize);
    for (let page = fromPage; page <= toPage; page += 1) void loadPage(page);
  }, [api, firstRow, lastRow, loadPage, pageSize, result.resultId]);
  const getRow = (index: number): Record<string, unknown> | undefined => pages[Math.floor(index / pageSize)]?.[index % pageSize];
  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const next = event.currentTarget.scrollTop;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => setScrollTop(next));
  }, []);
  useEffect(() => () => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);
  return <>
    {result.truncated && <div className="analysis-preview-limit-note">分析結果は最大100,000行まで保持します。表は必要なページだけ取得・描画するため、大量データでもスクロールできます。</div>}
    <div className="analysis-table-count">{result.rowCount.toLocaleString()} 行をページ取得で表示中{result.rowCount ? `（${(firstRow + 1).toLocaleString()}〜${lastRow.toLocaleString()} 行）` : ''}</div>
    <div className="analysis-table-wrap" style={{ height: ANALYSIS_TABLE_VIEWPORT_HEIGHT }} onScroll={onScroll}>
      <table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}{hasOrigin && <th className="analysis-origin-head">元データ</th>}</tr></thead><tbody>
        {topSpacer > 0 && <tr aria-hidden="true" className="analysis-virtual-spacer"><td colSpan={spacerColumns} style={{ height: topSpacer, padding: 0, border: 0 }} /></tr>}
        {Array.from({ length: Math.max(0, lastRow - firstRow) }, (_, offset) => firstRow + offset).map((index) => {
          const row = getRow(index);
          if (!row) return <tr key={index} style={{ height: ANALYSIS_TABLE_ROW_HEIGHT }} className="analysis-table-loading-row"><td colSpan={spacerColumns}>読み込み中…</td></tr>;
          const origin = onOpenOrigin ? originTargetForRow(row, result.columns) : null;
          return <tr key={index} style={{ height: ANALYSIS_TABLE_ROW_HEIGHT }}>{result.columns.map((column) => <td key={column} title={String(row[column] ?? '')}>{String(row[column] ?? '')}</td>)}{hasOrigin && <td className="analysis-origin-cell">{origin ? <button type="button" className="secondary analysis-origin-button" onClick={() => onOpenOrigin?.(origin)}>{origin.label}</button> : <span>—</span>}</td>}</tr>;
        })}
        {bottomSpacer > 0 && <tr aria-hidden="true" className="analysis-virtual-spacer"><td colSpan={spacerColumns} style={{ height: bottomSpacer, padding: 0, border: 0 }} /></tr>}
      </tbody></table>
    </div>
  </>;
});

function ExecutionBadge({ record, history = [], freshness }: { record?: AnalysisCellExecution; history?: AnalysisCellExecution[]; freshness: { state: 'fresh' | 'stale' | 'idle'; label: string } }) {
  return <div className={`analysis-execution-badge ${freshness.state}`}><b>{freshness.label}</b>{record && <span>最終実行 {new Date(record.executedAt).toLocaleString('ja-JP')} ・ {record.rowCount.toLocaleString()}行 ・ {record.elapsedMs}ms</span>}{history.length > 1 && <details className="analysis-execution-history"><summary>実行履歴 {history.length}件</summary><ol>{history.slice(0, 6).map((item, index) => <li key={`${item.executedAt}-${index}`}>{new Date(item.executedAt).toLocaleString('ja-JP')} ・ {item.rowCount.toLocaleString()}行 ・ {item.elapsedMs}ms{item.truncated ? ' ・ 上限で切り詰め' : ''}</li>)}</ol></details>}</div>;
}


function isNumericColumn(result: AnalysisQueryResult, column: string): boolean {
  const values = sampleAnalysisRows(result.rows).map((row) => row[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  return values.length > 0 && values.filter((value) => Number.isFinite(Number(value))).length / values.length >= 0.8;
}

function isTimeLikeColumn(column: string, result: AnalysisQueryResult): boolean {
  if (/(date|month|year|年月|年度|日付|時刻|updated_at|created_at)/i.test(column)) return true;
  return result.rows.slice(0, 12).filter((row) => /^\d{4}([/-]\d{1,2})?([/-]\d{1,2})?$/.test(String(row[column] ?? '').trim())).length >= 3;
}

function recommendedChart(result: AnalysisQueryResult): { type: AnalysisChart['type']; x: string; y?: string; reason: string } {
  const numeric = result.columns.filter((column) => isNumericColumn(result, column));
  const time = result.columns.find((column) => isTimeLikeColumn(column, result));
  const text = result.columns.find((column) => !numeric.includes(column));
  if (time && numeric.length) return { type: 'line', x: time, y: numeric.find((column) => column !== time) || numeric[0], reason: '日付・月・年度の列があるため、時間による増減を見やすい折れ線グラフがおすすめです。' };
  if (numeric.length >= 2) return { type: 'dot', x: numeric[0], y: numeric[1], reason: '数値列が2つあるため、2つの数値の関係を確認できる散布図がおすすめです。' };
  if (text && numeric.length) return { type: 'bar', x: text, y: numeric[0], reason: '分類と数値の組み合わせのため、項目ごとの差を比べやすい棒グラフがおすすめです。' };
  if (numeric.length) return { type: 'histogram', x: numeric[0], reason: '数値列があるため、値の集中やばらつきを確認できるヒストグラムがおすすめです。' };
  return { type: 'table', x: result.columns[0] || '', reason: 'まずは表で列とデータ内容を確認してから、分類列・数値列を含む集計結果を作るのがおすすめです。' };
}

function chartChecks(result: AnalysisQueryResult, chart: AnalysisChart): string[] {
  const messages: string[] = [];
  const x = chart.x || result.columns[0] || '';
  const y = chart.y || result.columns.find((column) => isNumericColumn(result, column)) || '';
  if (chart.type !== 'table' && !x) messages.push('横軸が未設定です。分類・日付・数値のいずれかを選んでください。');
  if (!['table', 'histogram'].includes(chart.type) && (!y || !isNumericColumn(result, y))) messages.push('縦軸は数値列を選ぶと、比較や増減を正しく表示できます。');
  if ((chart.type === 'line' || chart.type === 'area') && x && !isTimeLikeColumn(x, result)) messages.push('折れ線・面グラフは、月・年度・日付など順序がある横軸に向いています。分類別比較なら棒グラフがおすすめです。');
  if (chart.type === 'dot' && (!x || !y || !isNumericColumn(result, x) || !isNumericColumn(result, y))) messages.push('散布図は横軸・縦軸の両方に数値列を選んでください。');
  if (chart.type === 'bar' && x && result.rows.length > 20) messages.push('項目が20件を超えています。上位10〜20件へ絞ると、グラフが読みやすくなります。');
  if (chart.type === 'histogram' && x && !isNumericColumn(result, x)) messages.push('ヒストグラムの横軸には数値列を選んでください。');
  return messages;
}

function analysisNarrative(result: AnalysisQueryResult, chart: AnalysisChart): string[] {
  const x = chart.x || result.columns[0] || '';
  const y = chart.y || result.columns.find((column) => isNumericColumn(result, column)) || '';
  const lines = [`対象は ${result.rowCount.toLocaleString()} 行、${result.columns.length} 列です。`];
  if (!y || !isNumericColumn(result, y)) return [...lines, '数値列を縦軸に選ぶと、最大・最小・増減のポイントを自動で説明できます。'];
  const numericRows = sampleAnalysisRows(result.rows).map((row) => ({ label: String(row[x] ?? ''), value: Number(row[y]) })).filter((row) => Number.isFinite(row.value));
  if (!numericRows.length) return lines;
  const max = numericRows.reduce((a, b) => a.value >= b.value ? a : b);
  const min = numericRows.reduce((a, b) => a.value <= b.value ? a : b);
  lines.push(`${y} は「${max.label || '（分類なし）'}」が最大で ${max.value.toLocaleString()}、${min.label || '（分類なし）'} が最小で ${min.value.toLocaleString()} です。`);
  if (isTimeLikeColumn(x, result) && numericRows.length >= 2) {
    const first = numericRows[0]; const last = numericRows[numericRows.length - 1];
    const delta = last.value - first.value;
    lines.push(`最初の ${first.value.toLocaleString()} から最後の ${last.value.toLocaleString()} へ${delta >= 0 ? '増加' : '減少'}しています（差 ${Math.abs(delta).toLocaleString()}）。`);
  } else if (max.value && min.value && max.value / Math.max(Math.abs(min.value), 1) >= 2) {
    lines.push('最大値と最小値の差が大きいため、上位項目の背景や入力内容を確認するとよいです。');
  }
  lines.push('結論にする前に、対象期間・欠損・重複・削除済みデータの除外状況を品質チェックセルで確認してください。');
  return lines;
}

function analysisOutputChecklist(result: AnalysisQueryResult, chart: AnalysisChart): Array<{ ok: boolean; label: string }> {
  const numericY = chart.y && isNumericColumn(result, chart.y);
  return [
    { ok: result.rowCount > 0, label: result.rowCount > 0 ? `対象件数を確認（${result.rowCount.toLocaleString()}行）` : '結果が0件です。期間・条件を確認' },
    { ok: !result.truncated, label: result.truncated ? '画面表示は一部です。明細を報告に使う場合は条件を絞る' : '画面表示は全件です' },
    { ok: chart.type === 'table' || Boolean(chart.x), label: chart.type === 'table' || chart.x ? 'グラフの横軸を確認' : 'グラフの横軸を設定' },
    { ok: chart.type === 'table' || chart.type === 'histogram' || Boolean(numericY), label: chart.type === 'table' || chart.type === 'histogram' || numericY ? 'グラフの数値軸を確認' : '縦軸には数値列を選択' },
    { ok: true, label: '削除済みデータは同期時に除外済み' },
  ];
}

function ResultPanel({ result, cell, onChartChange, title, api, onOpenOrigin }: { result: AnalysisQueryResult; cell: SqlCell; title: string; api: ApiClient | null; onChartChange: (chart: SqlCell['chart']) => void; onOpenOrigin?: (target: OriginTarget) => void }) {
  const summary = `${result.rowCount.toLocaleString()} 行・${result.columns.length} 列${result.truncated ? '（上限で切り詰め）' : ''}`;
  const recommendation = recommendedChart(result);
  const checks = chartChecks(result, cell.chart);
  const narrative = analysisNarrative(result, cell.chart);
  return <div className="analysis-result-card">
    <div className="analysis-result-head"><div><b>結果</b><span>{summary} ・ {result.elapsedMs}ms</span></div><button className="secondary" onClick={() => { if (result.resultId && result.hasMore && api) { void api.getAnalysisResultAll(result.resultId).then((all) => downloadCsv(all, title)); } else downloadCsv(result, title); }}>CSV出力</button></div>
    <section className="analysis-result-helper">
      <div className="analysis-result-recommendation"><b>次におすすめ</b><span>{recommendation.reason}</span>{cell.chart.type !== recommendation.type && <button type="button" className="secondary" onClick={() => onChartChange({ ...cell.chart, type: recommendation.type, x: recommendation.x, y: recommendation.y })}>おすすめの設定を使う</button>}</div>
      {checks.length > 0 && <div className="analysis-chart-checks"><b>グラフの確認</b><ul>{checks.map((message) => <li key={message}>{message}</li>)}</ul></div>}
      <details className="analysis-result-narrative" open><summary>この結果から読み取れること（下書き）</summary><ul>{narrative.map((line) => <li key={line}>{line}</li>)}</ul><small>数値と条件を確認したうえで、業務上の背景を加えてください。</small></details>
      <details className="analysis-output-checklist"><summary>レポート・KPI固定前の確認</summary><ul>{analysisOutputChecklist(result, cell.chart).map((item) => <li key={item.label}>{item.ok ? '✓' : '!' } {item.label}</li>)}</ul></details>
    </section>
    <div className="analysis-chart-controls">
      <label>表示<select value={cell.chart.type} onChange={(e) => onChartChange({ ...cell.chart, type: e.target.value as SqlCell['chart']['type'] })}><option value="table">表のみ</option><option value="bar">棒グラフ</option><option value="line">折れ線</option><option value="dot">散布図</option><option value="area">面グラフ</option><option value="histogram">ヒストグラム</option><option value="box">箱ひげ図</option><option value="heatmap">ヒートマップ</option></select></label>
      <label>横軸<select value={cell.chart.x || ''} onChange={(e) => onChartChange({ ...cell.chart, x: e.target.value })}><option value="">自動</option>{result.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
      <label>縦軸<select value={cell.chart.y || ''} onChange={(e) => onChartChange({ ...cell.chart, y: e.target.value })}><option value="">自動</option>{result.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
      <span className="analysis-chart-save-note">グラフ設定はノート保存時に残ります</span>
    </div>
    <PlotView result={result} chart={cell.chart} />
    <ResultTable result={result} api={api} onOpenOrigin={onOpenOrigin} />
  </div>;
}

function ParameterEditor({ cell, onChange }: { cell: ParameterCell; onChange: (parameter: AnalysisParameter) => void }) {
  const parameter = cell.parameter;
  const options = (parameter.options || []).join('\n');
  return <div className="analysis-parameter-cell">
    <div className="analysis-parameter-grid">
      <label>表示名<input value={parameter.label} onChange={(e) => onChange({ ...parameter, label: e.target.value.slice(0, 120) })} placeholder="例：対象年度" /></label>
      <label>SQL名<input value={parameter.name} onChange={(e) => onChange({ ...parameter, name: parameterName(e.target.value, `param_${cell.id.slice(-4)}`) })} placeholder="例：year" /><small>SQLでは <code>{`{{${parameter.name || 'year'}}}`}</code></small></label>
      <label>種類<select value={parameter.type} onChange={(e) => onChange({ ...parameter, type: e.target.value as AnalysisParameter['type'], value: '' })}><option value="text">テキスト</option><option value="number">数値</option><option value="date">日付</option><option value="select">選択肢</option></select></label>
      <label>値{parameter.type === 'select' ? <select value={parameter.value} onChange={(e) => onChange({ ...parameter, value: e.target.value })}><option value="">選択してください</option>{(parameter.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={parameter.type === 'number' ? 'number' : parameter.type === 'date' ? 'date' : 'text'} value={parameter.value} onChange={(e) => onChange({ ...parameter, value: e.target.value })} placeholder={parameter.type === 'date' ? 'YYYY-MM-DD' : '値を入力'} />}</label>
    </div>
    {parameter.type === 'select' && <label className="analysis-parameter-options">選択肢（1行に1つ）<textarea value={options} onChange={(e) => onChange({ ...parameter, options: e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 100), value: parameter.value })} placeholder={'令和6年度\n令和7年度\n令和8年度'} /></label>}
    <div className="analysis-parameter-help">値はサーバー側で安全なSQLリテラルに変換されます。入力内容をSQL文として実行することはありません。</div>
  </div>;
}

function DataFrameEditor({ cell, upstream, onChange }: { cell: DataFrameCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (transform: AnalysisDataFrameTransform) => void }) {
  const transform = cell.transform;
  const source = upstream.find((item) => item.id === transform.sourceCellId);
  const columns = source?.result?.columns || [];
  const selected = new Set(transform.columns || []);
  const update = (patch: Partial<AnalysisDataFrameTransform>) => onChange({ ...transform, ...patch });
  return <div className="analysis-dataframe-cell">
    <div className="analysis-parameter-grid">
      <label>入力結果<select value={transform.sourceCellId} onChange={(e) => update({ sourceCellId: e.target.value, column: '', columns: [] })}><option value="">上側のセルを選択</option>{upstream.map((item) => <option key={item.id} value={item.id}>{item.label}{item.result ? '' : '（未実行・自動実行）'}</option>)}</select></label>
      <label>出力名<input value={transform.outputName} onChange={(e) => update({ outputName: resultName(e.target.value, `frame_${cell.id.slice(-4)}`) })} placeholder="例：filtered_tasks" /><small>次のSQLでは <code>{`result_${transform.outputName || 'name'}`}</code></small></label>
      <label>処理<select value={transform.operation} onChange={(e) => update({ operation: e.target.value as AnalysisDataFrameTransform['operation'] })}><option value="filter">フィルター</option><option value="select">列を選ぶ</option><option value="sort">並べ替え</option><option value="limit">先頭件数</option></select></label>
      {transform.operation === 'limit' ? <label>件数<input type="number" min="1" max={MAX_ANALYSIS_ROWS} value={transform.limit || 100} onChange={(e) => update({ limit: Number(e.target.value) || 100 })} /></label> : <label>対象列<select value={transform.column || ''} onChange={(e) => update({ column: e.target.value })}><option value="">{source && !source.result ? '実行後に選択できます' : '列を選択'}</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    </div>
    {transform.sourceCellId && !source?.result && <div className="analysis-parameter-help">入力元は未実行です。このセルを実行すると、必要な上側セルを先に自動実行します。実行後に列を選択できます。</div>}
    {transform.operation === 'filter' && <div className="analysis-parameter-grid"><label>条件<select value={transform.operator || 'contains'} onChange={(e) => update({ operator: e.target.value as AnalysisDataFrameTransform['operator'] })}><option value="contains">含む</option><option value="equals">一致</option><option value="notEmpty">空欄ではない</option><option value="greaterThan">より大きい</option><option value="lessThan">より小さい</option></select></label>{transform.operator !== 'notEmpty' && <label>値<input value={transform.value || ''} onChange={(e) => update({ value: e.target.value })} placeholder="条件値" /></label>}</div>}
    {transform.operation === 'sort' && <label>順序<select value={transform.direction || 'asc'} onChange={(e) => update({ direction: e.target.value as 'asc' | 'desc' })}><option value="asc">昇順</option><option value="desc">降順</option></select></label>}
    {transform.operation === 'select' && <div className="analysis-dataframe-columns">{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={(e) => { const next = new Set(selected); e.target.checked ? next.add(column) : next.delete(column); update({ columns: [...next] }); }} />{column}</label>)}</div>}
    <div className="analysis-parameter-help">このセルはArqueroで安全に表を加工します。任意JavaScriptは実行しません。</div>
  </div>;
}

const FUNCTION_GUIDES: Record<AnalysisFunctionTransform['operation'], { title: string; description: string; steps: string[]; example: string }> = {
  yearOverYear: { title: '前年比', description: '前の期間と比べた増減率を計算します。年度や月ごとの比較に使います。', steps: ['値列に人件費などの数値を指定', '期間列に年度や月を指定', '必要ならグループ列で施設別などに分ける'], example: '例：令和7年度の人件費 ÷ 令和6年度の人件費の増減率' },
  movingAverage: { title: '移動平均', description: '連続する期間の平均を取り、短期的な上下をなだらかにします。', steps: ['値列と期間列を指定', '窓の大きさを3などに設定', '施設別ならグループ列も指定'], example: '例：3か月移動平均で利用者数の傾向を見る' },
  cumulative: { title: '累計', description: '期間順に値を積み上げます。年度途中の進捗確認に向きます。', steps: ['値列と期間列を指定', '必要ならグループ列を指定'], example: '例：月別支出から年度累計を作る' },
  shareOfTotal: { title: '構成比', description: '全体に対する各行の割合を算出します。', steps: ['値列を指定', '分類別に計算する場合はグループ列を指定'], example: '例：施設別利用者数の全体に占める割合' },
  rank: { title: '順位', description: '数値列を大きい順に順位付けします。', steps: ['値列を指定', '必要ならグループ列を指定'], example: '例：施設別の件数ランキング' },
  fillMissing: { title: '欠損を直前値で補完', description: '空欄を直前の値で補います。時系列データの欠損補完向けです。', steps: ['値列と期間列を指定', '必要ならグループ列を指定'], example: '例：月次データで一部欠けた数値を前月値で補う' },
  excludeOutliers: { title: '外れ値を除外（3σ）', description: '平均から大きく離れた数値を除外します。入力ミス候補の確認に使います。', steps: ['値列を指定', '除外前後の件数を比較'], example: '例：桁違いの人件費入力を候補として除外' },
  join: { title: '2つの結果を結合', description: '共通するキー列を使って、2つの表を1つにまとめます。', steps: ['左側と右側の入力結果を選ぶ', '両方の結合キー列を指定', '左結合または内部結合を選ぶ'], example: '例：施設一覧と年度別実績を施設IDで結合' },
  unpivot: { title: '横持ちを縦持ちへ変換', description: '複数の列を「項目名」と「値」の2列へ展開します。', steps: ['固定したい識別列を残す', '展開する値列を複数選ぶ'], example: '例：令和4〜令和8年度の列を年度・人件費の行へ変換' },
  splitText: { title: '文字列を分割', description: '区切り文字で1つの列を分割し、必要な位置の値を取り出します。', steps: ['対象列を選ぶ', '区切り文字を指定', '0から始まる取得位置を指定'], example: '例：部署/担当者 から担当者だけを取り出す' },
  dateDiff: { title: '日付差分', description: '開始日と終了日の差を日数で計算します。', steps: ['開始日列と終了日列を指定', '出力列名を設定'], example: '例：受付日から完了日までの日数' },
  conditionalColumn: { title: '条件列を追加', description: '条件に応じて新しい分類列を作ります。', steps: ['対象列と条件を選ぶ', '該当時・非該当時の値を入力'], example: '例：期限日が今日より前なら「期限超過」' },
  formula: { title: '数式セル', description: '安全な定型数式で列を計算します。任意コードは実行しません。', steps: ['数式の種類を選ぶ', '対象列と必要な値・終了日列を指定', '出力列名を設定'], example: '例：人件費を1000で割り、千円単位に丸める' },
  dropDuplicates: { title: '重複行を削除', description: '指定列が同じ行を1件にまとめます。', steps: ['重複判定に使う列を選ぶ', '先頭の行を残して重複を除外'], example: '例：同じ受付番号の二重登録を除外' },
  renameColumn: { title: '列名を変更', description: '分析中だけ列名を分かりやすく変更します。', steps: ['変更したい列を選ぶ', '新しい列名を入力'], example: '例：updated_at を 最終更新日時 に変更' },
  correlation: { title: '相関係数', description: '2つの数値の連動の強さを-1〜1で確認します。', steps: ['数値列を2つ選ぶ', '欠損や文字列は自動的に除外'], example: '例：学級数と人件費の相関を確認' },
  linearRegression: { title: '単回帰分析', description: '説明変数から目的変数をどの程度説明できるかを確認します。', steps: ['X列とY列を指定', 'R²と傾きを確認'], example: '例：学級数から人件費の傾向を確認' },
  tTest: { title: 't検定', description: '2つのグループの平均に差がありそうかを確認します。', steps: ['数値列とグループ列を指定', '比較する2群を用意'], example: '例：平日と長期休業日の平均利用者数比較' },
  chiSquare: { title: 'カイ二乗検定', description: '2つの分類の偏りや関連を確認します。', steps: ['2つの分類列を指定', 'クロス集計の偏りを確認'], example: '例：施設と利用区分に関係があるか確認' },
  anova: { title: '一元配置分散分析', description: '3群以上の平均に差がありそうかを確認します。', steps: ['数値列とグループ列を指定', '3群以上の分類を用意'], example: '例：学校別の平均利用者数比較' },
};

function FunctionGuide({ operation }: { operation: AnalysisFunctionTransform['operation'] }) {
  const guide = FUNCTION_GUIDES[operation];
  return <details className="analysis-function-guide"><summary>使い方：{guide.title}</summary><p>{guide.description}</p><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol><div><b>例</b><span>{guide.example}</span></div></details>;
}


const CELL_GUIDES: Array<{ type: string; title: string; purpose: string; useWhen: string; steps: string[] }> = [
  { type: 'section', title: 'セクション', purpose: 'ノートを「取得・前処理・集計・考察」などのまとまりに分けます。', useWhen: '分析が長くなり、途中の作業を見失いたくない時。', steps: ['見出しと説明を入力します。', '必要なら「折りたたむ」をオンにします。', '左のセクション一覧から該当箇所へ移動できます。'] },
  { type: 'markdown', title: 'メモセル', purpose: '分析の目的、前提、読み取れたこと、次の対応を文章で残します。', useWhen: '数字だけでは伝わらない背景や結論を記録したい時。', steps: ['最初に「何を確認するか」を書きます。', '結果の下に「分かったこと」を追記します。', '最後に「次に確認・対応すること」を書きます。'] },
  { type: 'import', title: '取込セル', purpose: 'CSV・Excel・JSONを、このノートの分析用データとして取り込みます。', useWhen: 'アプリ内のページやDB以外の表を一緒に分析したい時。', steps: ['取込ファイルを選びます。', '列名と先頭行を確認します。', '出力名を付けて実行します。', '次のセルで入力結果として選びます。'] },
  { type: 'sql', title: 'SQLセル', purpose: 'DuckDBに同期したデータから、必要な行・列だけを取り出します。', useWhen: 'ページ、データベース行、Journal、タスクを条件付きで集計したい時。', steps: ['最初は「分析をはじめる」またはテンプレートを使います。', 'データ辞書でテーブル・列の意味を確認します。', 'SQLを実行し、表の列と件数を確認します。', '出力名を付けると後続セルで再利用できます。'] },
  { type: 'dataframe', title: 'DataFrameセル', purpose: '上の結果を絞り込み、必要な列だけ残し、並び替える前処理セルです。', useWhen: 'SQLを複雑にせず、結果を少し整えたい時。', steps: ['入力結果を選びます。', 'フィルター・列選択・並び替え・件数制限を設定します。', '実行して、期待どおりの行だけ残ったか確認します。'] },
  { type: 'preprocess', title: '前処理セル', purpose: '元データを変更せず、重複・欠損・表記ゆれ・数値／日付形式を分析用に整えます。', useWhen: '集計やグラフの前に、分析対象だけを整えたい時。', steps: ['入力結果を選びます。', '前処理と対象列を選びます。', '実行後に件数と表を確認します。', '問題があれば設定を変更して再実行します。'] },
  { type: 'function', title: '分析関数セル', purpose: '前年比、移動平均、結合、数式、相関などの定型処理を安全に行います。', useWhen: '計算や比較を追加したいが、SQLやプログラムを書きたくない時。', steps: ['入力結果を選びます。', '関数を選びます。', '対象の列・期間列・出力名を設定します。', '「使い方」を開き、例と入力項目を確認して実行します。'] },
  { type: 'pivot', title: 'ピボットセル', purpose: '行・列・値を指定して、Excelのピボットテーブルのように集計します。', useWhen: '分類ごとの件数・合計・平均を比較したい時。', steps: ['入力結果を選びます。', '行項目、必要なら列項目を選びます。', '値と集計方法（件数・合計・平均）を選びます。', '表を見て、偏りや差が大きい項目を確認します。'] },
  { type: 'summary', title: '統計・要約セル', purpose: '件数、平均、中央値、最小・最大、標準偏差、欠損数を確認します。', useWhen: '数値の全体像や、分類ごとの差を把握したい時。', steps: ['入力結果を選びます。', '数値列を選びます。', '必要ならグループ列を選びます。', '平均だけでなく中央値・欠損数も確認します。'] },
  { type: 'quality', title: '品質チェックセル', purpose: '空欄、重複、数値として扱えない値を確認します。', useWhen: '集計前にデータの信頼性を確認したい時。', steps: ['入力結果を選びます。', '確認したい列を選びます。', '欠損・重複・非数値の確認を選びます。', '問題件数を確認し、必要なら元データを開きます。'] },
  { type: 'chart', title: 'グラフセル', purpose: '上の結果を棒・折れ線・散布図などで見やすく表示します。', useWhen: '表の増減や違いを説明しやすくしたい時。', steps: ['入力結果を選びます。', 'グラフ種類を選びます。', '横軸・縦軸を選びます。', 'タイトルと軸が目的に合うか確認します。'] },
  { type: 'parameter', title: '条件セル', purpose: '期間・年度・施設名などを、SQLを書き換えずに変えられる条件です。', useWhen: '毎月・毎年度、同じ分析を繰り返したい時。', steps: ['条件名と表示名を入力します。', '値の種類と初期値を設定します。', 'SQL内で {{条件名}} と書いて参照します。', '条件を変えたら、上から再実行します。'] },
  { type: 'variable', title: '変数セル', purpose: 'ノート全体で繰り返し使う値を一か所で管理します。', useWhen: '基準日、対象年度、単位などを何度も使う時。', steps: ['変数名と値を入力します。', 'SQL内で {{変数名}} と書いて参照します。', '変数を変更したら、古い結果の表示を確認して再実行します。'] },
];

const CODE_EXAMPLES: Array<{ category: string; title: string; description: string; code: string }> = [
  { category: 'SQLの基本', title: '1. 最初の20件を見る', description: '同期されている表の中身を確認する最初のSQLです。', code: 'SELECT *\nFROM pages\nORDER BY updated_at DESC\nLIMIT 20;' },
  { category: 'SQLの基本', title: '2. 件数を数える', description: '対象データが何件あるか確認します。', code: 'SELECT COUNT(*) AS 件数\nFROM database_rows;' },
  { category: 'SQLの基本', title: '3. 未完了タスクを期限順に並べる', description: '期限の近い未完了タスクを確認します。', code: "SELECT text, due_date, source_title\nFROM tasks\nWHERE completed = '0'\nORDER BY due_date ASC\nLIMIT 100;" },
  { category: '集計', title: '4. 分類ごとの件数', description: '例ではページの親フォルダごとに件数を数えます。', code: 'SELECT parent_id, COUNT(*) AS 件数\nFROM pages\nGROUP BY parent_id\nORDER BY 件数 DESC;' },
  { category: '集計', title: '5. 月ごとの更新件数', description: '月単位の推移を折れ線グラフにすると増減を確認できます。', code: "SELECT substr(updated_at, 1, 7) AS 月, COUNT(*) AS 更新件数\nFROM pages\nWHERE updated_at <> ''\nGROUP BY 月\nORDER BY 月;" },
  { category: '集計', title: '6. データベースごとの登録件数', description: 'どのデータベースに行が多いかを確認します。', code: 'SELECT database_id, COUNT(*) AS 行数\nFROM database_rows\nGROUP BY database_id\nORDER BY 行数 DESC;' },
  { category: '条件・変数', title: '7. 条件セルを使う', description: '「year」という条件セルを作り、年度・年を変えて再利用します。', code: "SELECT *\nFROM pages\nWHERE substr(updated_at, 1, 4) = {{year}}\nORDER BY updated_at DESC;" },
  { category: 'セル間参照', title: '8. 上のSQL結果を再利用する', description: '上のSQLセルに出力名「recent_pages」を設定してから使います。', code: 'SELECT parent_id, COUNT(*) AS 件数\nFROM result_recent_pages\nGROUP BY parent_id\nORDER BY 件数 DESC;' },
  { category: '比較', title: '9. 前月との差を出す', description: '月別集計の後に、LAGで前月値を取り出します。', code: "WITH monthly AS (\n  SELECT substr(updated_at, 1, 7) AS 月, COUNT(*) AS 件数\n  FROM pages\n  GROUP BY 月\n)\nSELECT 月, 件数,\n       件数 - LAG(件数) OVER (ORDER BY 月) AS 前月差\nFROM monthly\nORDER BY 月;" },
  { category: '品質確認', title: '10. 空欄を探す', description: 'タイトルが空のページを確認します。', code: "SELECT id, title, updated_at\nFROM pages\nWHERE title IS NULL OR trim(title) = '';" },
  { category: '品質確認', title: '11. 重複候補を探す', description: '同じタイトルのページを確認します。', code: "SELECT title, COUNT(*) AS 件数\nFROM pages\nWHERE trim(title) <> ''\nGROUP BY title\nHAVING COUNT(*) > 1\nORDER BY 件数 DESC;" },
  { category: '分析関数・数式', title: '12. 数式セルの例', description: '分析関数セルで「数式」を選び、数値列と計算内容を指定します。', code: '四則演算: [人件費] ÷ [学級数]\n丸め: ROUND([平均], 1)\n年の取り出し: YEAR([日付])\n空欄の置換: COALESCE([数値], 0)\n日付差: DATE_DIFF([開始日], [終了日])' },
];


type VisualExample = {
  title: string;
  purpose: string;
  useWhen: string;
  chartType: AnalysisChart['type'];
  x: string;
  y: string;
  sql: string;
  steps: string[];
  caution: string;
};

const CHART_GUIDES: Record<AnalysisChart['type'], { title: string; purpose: string; axes: string; caution: string }> = {
  table: { title: '表のみ', purpose: 'まず明細や集計結果を正確に確認したい時に使います。', axes: '横軸・縦軸は不要です。列の並びと件数を確認します。', caution: '件数が多い時は、条件や上位件数で絞り込みます。' },
  bar: { title: '棒グラフ', purpose: '分類ごとの件数・金額・平均を比べたい時に使います。', axes: '横軸は分類名、縦軸は件数・合計・平均などの数値を選びます。', caution: '分類が多すぎる場合は、上位10〜20件に絞ると読みやすくなります。' },
  line: { title: '折れ線グラフ', purpose: '月・年度など、時間とともにどう変わったかを見たい時に使います。', axes: '横軸は月・年度・日付、縦軸は件数・金額などの数値を選びます。', caution: '横軸は必ず時間順に並べ、欠けている期間がないか表でも確認します。' },
  dot: { title: '散布図', purpose: '2つの数値に関係があるかを見たい時に使います。', axes: '横軸と縦軸はどちらも数値列を選びます。例：学級数と人件費。', caution: '点が少ない場合や、極端な値がある場合は結論を急がず表で確認します。' },
  area: { title: '面グラフ', purpose: '時間による量の変化や累計の伸びを見たい時に使います。', axes: '横軸は月・年度、縦軸は件数・金額・累計などの数値を選びます。', caution: '複数系列を重ねるより、まず1系列で変化を見る方が読みやすいです。' },
  histogram: { title: 'ヒストグラム', purpose: '数値がどの範囲に集中しているか、ばらつきを見たい時に使います。', axes: '横軸は数値列、縦軸は自動で件数になります。縦軸は指定しなくて構いません。', caution: '金額など桁が大きく異なる値がある場合は、外れ値を先に確認します。' },
  box: { title: '箱ひげ図', purpose: '中央値・ばらつき・外れ値候補をまとめて見たい時に使います。', axes: '横軸は分類列（任意）、縦軸は数値列を選びます。', caution: '外れ値は必ずしも誤りではありません。元データと業務上の事情を確認します。' },
  heatmap: { title: 'ヒートマップ', purpose: '行と列の組み合わせごとの濃淡・偏りを見たい時に使います。', axes: '横軸は列分類、縦軸は行分類、値は件数や合計を使うピボット結果を選びます。', caution: '先にピボットセルで行・列・値を整理すると、意味のある図になります。' },
};

const VISUAL_EXAMPLES: VisualExample[] = [
  {
    title: '1. 分類ごとの件数を棒グラフで比べる',
    purpose: 'どの分類・フォルダ・施設に件数が多いかを確認します。',
    useWhen: '項目ごとの多い・少ないを比べたい時。',
    chartType: 'bar', x: '分類', y: '件数',
    sql: "SELECT parent_id AS 分類, COUNT(*) AS 件数\nFROM pages\nWHERE parent_id <> ''\nGROUP BY parent_id\nORDER BY 件数 DESC\nLIMIT 20;",
    steps: ['SQLセルに貼り付けて実行します。', 'グラフセルを追加し、入力結果にこのSQLセルを選びます。', '種類は「棒グラフ」、横軸は「分類」、縦軸は「件数」を選びます。'],
    caution: '親フォルダIDではなく名前で比べたい場合は、元データに分類名の列がある表を使います。',
  },
  {
    title: '2. 月ごとの推移を折れ線グラフで見る',
    purpose: '月ごとの更新量や受付件数などの増減を確認します。',
    useWhen: 'いつ増えた・減ったか、繁忙期や記録漏れを確認したい時。',
    chartType: 'line', x: '月', y: '更新件数',
    sql: "SELECT substr(updated_at, 1, 7) AS 月, COUNT(*) AS 更新件数\nFROM pages\nWHERE updated_at <> ''\nGROUP BY 月\nORDER BY 月;",
    steps: ['SQLセルに貼り付けて実行します。', 'グラフセルの種類で「折れ線グラフ」を選びます。', '横軸は「月」、縦軸は「更新件数」を選びます。'],
    caution: '月が飛んでいる場合は、データがないのか記録漏れかを表で確認します。',
  },
  {
    title: '3. 2つの数値の関係を散布図で見る',
    purpose: '学級数と人件費、利用者数と支出などの関係を確認します。',
    useWhen: '一方が増えるともう一方も増える傾向があるかを見たい時。',
    chartType: 'dot', x: '学級数', y: '人件費',
    sql: "-- 列名を実際の数値列に置き換えます\nSELECT 学級数, 人件費\nFROM result_年度別実績\nWHERE 学級数 IS NOT NULL\n  AND 人件費 IS NOT NULL;",
    steps: ['先に、学級数と人件費を含むSQLまたは取込セルを用意します。', '上のSQLの result_年度別実績 を出力名に合わせて変えます。', 'グラフセルで「散布図」、横軸「学級数」、縦軸「人件費」を選びます。'],
    caution: '点が右上に並んでも因果関係を示すものではありません。相関セルと元データも確認します。',
  },
  {
    title: '4. 数値のばらつきをヒストグラムで見る',
    purpose: '金額・日数・利用者数などがどの範囲に集中しているかを確認します。',
    useWhen: '平均だけでは分からない分布や、極端な値の有無を見たい時。',
    chartType: 'histogram', x: '処理日数', y: '（自動）',
    sql: "-- 数値列を実際の列名に置き換えます\nSELECT 処理日数\nFROM result_処理実績\nWHERE 処理日数 IS NOT NULL;",
    steps: ['数値列だけを取り出すSQLセルを実行します。', 'グラフセルで「ヒストグラム」を選びます。', '横軸に「処理日数」を選び、縦軸は「自動」のままにします。'],
    caution: '桁違いの値があると図が読みにくくなります。品質チェックや外れ値確認も行います。',
  },
  {
    title: '5. 分類ごとのばらつきを箱ひげ図で見る',
    purpose: '施設・年度・担当ごとに、数値の中心とばらつきを比べます。',
    useWhen: '平均だけでなく、値の広がりや外れ値候補も比べたい時。',
    chartType: 'box', x: '施設名', y: '利用者数',
    sql: "-- 分類列と数値列を実際の列名に置き換えます\nSELECT 施設名, 利用者数\nFROM result_利用実績\nWHERE 施設名 <> ''\n  AND 利用者数 IS NOT NULL;",
    steps: ['分類列と数値列を含む結果を用意します。', 'グラフセルで「箱ひげ図」を選びます。', '横軸に「施設名」、縦軸に「利用者数」を選びます。'],
    caution: '外れ値は入力ミスとは限りません。イベントや長期休業などの背景を確認します。',
  },
  {
    title: '6. ピボット結果をヒートマップで見る',
    purpose: '月×施設、年度×分類など、組み合わせごとの偏りを色の濃淡で確認します。',
    useWhen: '2つの分類を同時に比べ、集中している箇所を見つけたい時。',
    chartType: 'heatmap', x: '月', y: '施設名',
    sql: "-- まずSQLセルで必要な3列を用意します\nSELECT substr(updated_at, 1, 7) AS 月, parent_id AS 施設名, COUNT(*) AS 件数\nFROM pages\nWHERE updated_at <> ''\nGROUP BY 月, 施設名\nORDER BY 月, 施設名;",
    steps: ['SQLセルを実行し、月・施設名・件数の3列を作ります。', '必要ならピボットセルで、行「施設名」・列「月」・値「件数」を設定します。', 'グラフセルで「ヒートマップ」を選び、横軸「月」、縦軸「施設名」を選びます。'],
    caution: '分類数が多すぎると読みにくくなります。上位の施設・分類に絞り込みます。',
  },
];

function AnalysisGuide({ onClose, onOpenWizard }: { onClose: () => void; onOpenWizard: () => void }) {
  const [tab, setTab] = useState<'start' | 'cells' | 'examples' | 'visuals' | 'results' | 'daily' | 'help'>('start');
  const [selectedCellType, setSelectedCellType] = useState('sql');
  const selected = CELL_GUIDES.find((item) => item.type === selectedCellType) || CELL_GUIDES[0];
  const tabs: Array<[typeof tab, string]> = [['start', 'はじめ方'], ['cells', 'セル一覧'], ['examples', 'コード例'], ['visuals', 'グラフ・図'], ['results', '結果の見方'], ['daily', 'よくある使い方'], ['help', '困った時']];
  return <div className="analysis-guide-backdrop" role="presentation" onMouseDown={onClose}><section className="analysis-guide-dialog" role="dialog" aria-modal="true" aria-label="分析ノートブックの使い方" onMouseDown={(event) => event.stopPropagation()}><header className="analysis-guide-header"><div><span>ANALYSIS NOTEBOOK GUIDE</span><h2>はじめての分析ガイド</h2><p>JupyterNotebookやSQLを使ったことがなくても、画面の順に進めれば分析できます。</p></div><button type="button" className="secondary" onClick={onClose}>閉じる</button></header><nav className="analysis-guide-tabs">{tabs.map(([key, label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'start' && <div className="analysis-guide-content"><div className="analysis-guide-hero"><b>最初は「分析をはじめる」からで大丈夫です</b><p>何を知りたいかを選ぶと、必要なセルとグラフを含むノートが自動で作られます。SQLを最初から書く必要はありません。</p><button type="button" className="primary" onClick={() => { onClose(); onOpenWizard(); }}>✦ 分析をはじめる</button></div><ol className="analysis-guide-steps"><li><b>同期する</b><span>「同期」で、アプリ内のページ・DB・Journal・タスクを分析用に読み込みます。</span></li><li><b>目的を選ぶ</b><span>「分類ごとの件数」「月ごとの推移」「比較」「不備確認」から選びます。</span></li><li><b>セルを上から実行する</b><span>各セルの「実行」または「すべて実行」を押します。必要な上流セルは自動実行されます。</span></li><li><b>結果を確認する</b><span>表・グラフ・統計から気になる点を見つけ、メモセルに結論を書きます。</span></li><li><b>保存する</b><span>「保存」で、ノートの構成・条件・グラフ設定・実行履歴を端末側に保存します。</span></li></ol><div className="analysis-guide-note"><b>覚えるのは3つだけです</b><span>①上から順に作る　②実行して表を確認する　③分かったことをメモに残す</span></div></div>}
    {tab === 'cells' && <div className="analysis-guide-content analysis-guide-cells"><aside>{CELL_GUIDES.map((item) => <button type="button" key={item.type} className={selectedCellType === item.type ? 'active' : ''} onClick={() => setSelectedCellType(item.type)}>{item.title}</button>)}</aside><article><span className="analysis-guide-kicker">セルの役割</span><h3>{selected.title}</h3><p>{selected.purpose}</p><div className="analysis-guide-when"><b>使う場面</b><span>{selected.useWhen}</span></div><b>使い方</b><ol>{selected.steps.map((step) => <li key={step}>{step}</li>)}</ol></article></div>}
    {tab === 'examples' && <div className="analysis-guide-content"><div className="analysis-guide-note"><b>コピーしてから、表・列名だけを自分のデータに合わせて変えます</b><span>安全のため、使えるのは読み取り専用の SELECT と WITH ... SELECT です。INSERT、UPDATE、DELETE は実行できません。</span></div><div className="analysis-code-example-list">{CODE_EXAMPLES.map((item) => <article key={item.title}><div><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p></div><pre><code>{item.code}</code></pre><button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(item.code)}>コードをコピー</button></article>)}</div></div>}
    {tab === 'visuals' && <div className="analysis-guide-content"><div className="analysis-guide-hero analysis-visual-hero"><b>グラフは「表を作ってから」選びます</b><p>まずSQL・ピボット・分析関数セルで表を作り、その結果をグラフセルに渡します。下の例は、SQLとグラフ設定をセットで示しています。</p><div className="analysis-visual-steps"><span>1. SQLをコピー</span><span>2. SQLセルで実行</span><span>3. グラフセルを追加</span><span>4. 種類と軸を選択</span></div></div><div className="analysis-visual-example-list">{VISUAL_EXAMPLES.map((item) => <article key={item.title}><header><div><span>{CHART_GUIDES[item.chartType].title}</span><h3>{item.title}</h3><p>{item.purpose}</p></div><div className="analysis-visual-badge">おすすめ：{CHART_GUIDES[item.chartType].title}</div></header><div className="analysis-visual-grid"><section><b>使う場面</b><p>{item.useWhen}</p><b>SQLセルに貼るコード</b><pre><code>{item.sql}</code></pre><button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(item.sql)}>SQLをコピー</button></section><section className="analysis-visual-settings"><b>グラフセルで選ぶ項目</b><dl><div><dt>種類</dt><dd>{CHART_GUIDES[item.chartType].title}</dd></div><div><dt>横軸</dt><dd>{item.x}</dd></div><div><dt>縦軸</dt><dd>{item.y}</dd></div></dl><b>作成手順</b><ol>{item.steps.map((step) => <li key={step}>{step}</li>)}</ol><div className="analysis-visual-caution"><b>確認ポイント</b><span>{item.caution}</span></div></section></div></article>)}</div></div>}
    {tab === 'results' && <div className="analysis-guide-content"><div className="analysis-guide-card-grid"><article><b>表</b><span>まず行数と列名を確認します。想定より多い・少ない場合は、入力データや条件を見直します。</span></article><article><b>グラフ</b><span>急な増減、突出した項目、空白の期間を探します。グラフだけで結論を出さず、表で根拠を確認します。</span></article><article><b>統計・要約</b><span>平均だけでなく、中央値・最小／最大・欠損数を見ます。極端な値があると平均は大きく影響されます。</span></article><article><b>品質チェック</b><span>欠損・重複・非数値が見つかった場合は、集計結果を報告に使う前に元データを確認します。</span></article><article><b>鮮度表示</b><span>「再実行が必要」と表示されたセルは、条件・上流結果・同期データが変わっています。上から再実行します。</span></article><article><b>元データを開く</b><span>結果に表示される操作から、ページ・DB行・Journalを開いて原因を確認できます。</span></article></div></div>}
    {tab === 'daily' && <div className="analysis-guide-content"><div className="analysis-guide-workflows"><article><h3>毎月の件数推移を見たい</h3><ol><li>「分析をはじめる」→「月ごとの推移」</li><li>対象データと日付項目を選ぶ</li><li>「すべて実行」</li><li>折れ線グラフの増減をメモに書く</li></ol></article><article><h3>年度別に人件費を比較したい</h3><ol><li>「年度別比較」レシピを開く</li><li>年度列・人件費列を設定する</li><li>前年比または移動平均を実行する</li><li>折れ線・棒グラフを確認する</li></ol></article><article><h3>入力漏れを確認したい</h3><ol><li>対象の表をSQLまたは取込で表示する</li><li>品質チェックセルを追加する</li><li>欠損・重複・非数値を選ぶ</li><li>問題があれば元データを開く</li></ol></article><article><h3>会議資料にしたい</h3><ol><li>メモセルに結論を記載する</li><li>必要な表とグラフだけ残す</li><li>発表モードで見え方を確認する</li><li>運用タブからHTML／Excel、またはPDFとして印刷する</li></ol></article></div></div>}
    {tab === 'help' && <div className="analysis-guide-content"><div className="analysis-guide-faq"><details open><summary>どこから始めればよいですか？</summary><p>上部の「分析をはじめる」を押し、目的を選んでください。初めては「分類ごとの件数」か「データの不備を探す」がおすすめです。</p></details><details><summary>「入力結果を先に実行してください」と出ます</summary><p>そのセルは上のセルの結果を使います。個別実行でも上流は自動実行されますが、入力結果が未設定の場合は、セルの「入力結果」を選んでください。</p></details><details><summary>結果が古いと表示されます</summary><p>条件、セル設定、上流結果、または同期データが変わりました。「すべて実行」または該当セル以降の実行で更新します。</p></details><details><summary>SQLが分かりません</summary><p>ウィザード、テンプレート、ピボット、分析関数、品質チェックから始めればSQLなしで進められます。必要になった時だけ、データ辞書と補完を使ってSQLを編集してください。</p></details><details><summary>分析データは共有フォルダを変更しますか？</summary><p>いいえ。同期と分析結果は端末側のローカル分析データに保存されます。正本のページ・DB・Journalを分析操作で更新することはありません。</p></details><details><summary>間違えた時はどうすればよいですか？</summary><p>セルを削除・並べ替えできます。保存前なら新規ノートを作り直せます。保存済み分析はノート一覧の×から削除できます。</p></details></div></div>}
    <footer className="analysis-guide-footer"><span><kbd>F1</kbd> または画面上部の <b>使い方</b> でいつでも開けます。</span><button type="button" className="secondary" onClick={onClose}>ガイドを閉じる</button></footer></section></div>;
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const groups = [
    { title: 'ノート操作', items: [['⌘ / Ctrl + S', '保存'], ['⌘ / Ctrl + Shift + N', 'SQLセルを追加'], ['⌘ / Ctrl + /', 'ショートカット一覧を開く／閉じる']] },
    { title: '実行', items: [['Shift + Enter', '選択中セルを実行'], ['⌘ / Ctrl + Enter', '選択中セルを実行'], ['⌘ / Ctrl + Shift + Enter', 'すべて実行']] },
    { title: 'SQL入力', items: [['Ctrl + Space', '補完を表示'], ['⌘ + Shift + Space', 'Macの補完を表示'], ['Esc', '補完候補・この一覧を閉じる']] },
  ];
  return <div className="analysis-shortcut-backdrop" role="presentation" onMouseDown={onClose}><section className="analysis-shortcut-dialog" role="dialog" aria-modal="true" aria-label="ショートカットキー一覧" onMouseDown={(event) => event.stopPropagation()}><div className="analysis-shortcut-title"><div><span>KEYBOARD SHORTCUTS</span><h2>ショートカットキー</h2></div><button type="button" className="secondary" onClick={onClose}>閉じる</button></div><p>入力欄で文字入力中でも、保存・実行・ヘルプは使えます。SQLの補完は入力欄でだけ有効です。</p><div className="analysis-shortcut-groups">{groups.map((group) => <section key={group.title}><h3>{group.title}</h3>{group.items.map(([key, description]) => <div key={key}><kbd>{key}</kbd><span>{description}</span></div>)}</section>)}</div></section></div>;
}

function PreprocessEditor({ cell, upstream, onChange }: { cell: PreprocessCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (preprocess: AnalysisPreprocessTransform) => void }) {
  const source = upstream.find((item) => item.id === cell.preprocess.sourceCellId);
  const columns = source?.result?.columns || [];
  const selected = new Set(cell.preprocess.columns || []);
  const update = (patch: Partial<AnalysisPreprocessTransform>) => onChange({ ...cell.preprocess, ...patch });
  const operation = cell.preprocess.operation;
  const multiColumn = ['removeDuplicates','handleMissing','trimText','normalizeText','coerceNumber','coerceDate'].includes(operation);
  return <div className="analysis-dataframe-cell analysis-preprocess-cell">
    <div className="analysis-preprocess-intro"><b>元データは変更しません</b><span>ここで作るのは、この分析ノート内だけで使う整形済みの結果です。元ページ・元データベース・共有フォルダには保存されません。</span></div>
    <div className="analysis-parameter-grid">
      <label>入力結果<ResultSourceSelect value={cell.preprocess.sourceCellId} upstream={upstream} onChange={(sourceCellId) => update({ sourceCellId, columns: [], column: '' })} /></label>
      <label>出力名<input value={cell.preprocess.outputName} onChange={(event) => update({ outputName: resultName(event.target.value, `prep_${cell.id.slice(-4)}`) })} /><small>次のSQLでは <code>{`result_${cell.preprocess.outputName || 'name'}`}</code></small></label>
      <label>前処理<select value={operation} onChange={(event) => update({ operation: event.target.value as AnalysisPreprocessTransform['operation'], columns: [], column: '' })}>
        <option value="removeDuplicates">重複行を除く</option><option value="handleMissing">欠損値を処理する</option><option value="trimText">前後の空白を除く</option><option value="normalizeText">文字を整える（全角・空白）</option><option value="coerceNumber">数値として整える</option><option value="coerceDate">日付として整える</option><option value="replaceValues">値を置き換える</option><option value="excludeOutliers">外れ値を分析から除く</option>
      </select></label>
    </div>
    {multiColumn && columns.length > 0 && <div className="analysis-dataframe-columns"><span>{operation === 'removeDuplicates' ? '重複判定に使う列' : operation === 'handleMissing' ? '欠損を処理する列' : '対象列'}</span>{columns.map((column) => <label key={column}><input type="checkbox" checked={selected.has(column)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(column) : next.delete(column); update({ columns: [...next] }); }} />{column}</label>)}</div>}
    {operation === 'handleMissing' && <div className="analysis-parameter-grid"><label>欠損時の処理<select value={cell.preprocess.missingStrategy || 'custom'} onChange={(event) => update({ missingStrategy: event.target.value as AnalysisPreprocessTransform['missingStrategy'] })}><option value="dropRows">欠損がある行を分析から除く</option><option value="custom">指定した値で補完</option><option value="zero">0で補完</option><option value="mean">平均値で補完（数値）</option><option value="median">中央値で補完（数値）</option><option value="forwardFill">直前の値で補完</option></select></label>{(cell.preprocess.missingStrategy || 'custom') === 'custom' && <label>補完する値<input value={cell.preprocess.fillValue || ''} onChange={(event) => update({ fillValue: event.target.value })} placeholder="例：未入力、0" /></label>}</div>}
    {(operation === 'coerceNumber' || operation === 'coerceDate') && <div className="analysis-parameter-grid"><label>変換できない値<select value={cell.preprocess.invalidAction || 'null'} onChange={(event) => update({ invalidAction: event.target.value as AnalysisPreprocessTransform['invalidAction'] })}><option value="null">空欄にして残す</option><option value="dropRows">行を分析から除く</option></select></label></div>}
    {operation === 'replaceValues' && <div className="analysis-parameter-grid"><label>対象列<select value={cell.preprocess.column || ''} onChange={(event) => update({ column: event.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label><label>置き換える値<input value={cell.preprocess.findValue || ''} onChange={(event) => update({ findValue: event.target.value })} placeholder="例：未設定" /></label><label>新しい値<input value={cell.preprocess.replaceValue || ''} onChange={(event) => update({ replaceValue: event.target.value })} placeholder="例：未入力" /></label></div>}
    {operation === 'excludeOutliers' && <div className="analysis-parameter-grid"><label>数値列<select value={cell.preprocess.column || ''} onChange={(event) => update({ column: event.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label><label>判定方法<select value={cell.preprocess.outlierMethod || 'iqr'} onChange={(event) => update({ outlierMethod: event.target.value as AnalysisPreprocessTransform['outlierMethod'] })}><option value="iqr">IQR（推奨）</option><option value="threeSigma">3σ</option></select></label></div>}
    <div className="analysis-parameter-help">実行後は、入力件数と出力件数を比べて意図どおりに整形できたか確認してください。前処理結果は後続のSQL、統計、グラフ、ピボットで使えます。</div>
  </div>;
}

function FunctionEditor({ cell, upstream, onChange }: { cell: FunctionCell; upstream: Array<{ id: string; label: string; result?: AnalysisQueryResult }>; onChange: (transform: AnalysisFunctionTransform) => void }) {
  const transform = cell.transform;
  const source = upstream.find((item) => item.id === transform.sourceCellId);
  const joinSource = upstream.find((item) => item.id === transform.joinSourceCellId);
  const columns = source?.result?.columns || [];
  const joinColumns = joinSource?.result?.columns || [];
  const selectedValues = new Set(transform.valueColumns || []);
  const update = (patch: Partial<AnalysisFunctionTransform>) => onChange({ ...transform, ...patch });
  const isWindow = transform.operation === 'movingAverage';
  const needsPeriod = ['yearOverYear', 'movingAverage', 'cumulative'].includes(transform.operation);
  const isJoin = transform.operation === 'join';
  const isUnpivot = transform.operation === 'unpivot';
  const isSplit = transform.operation === 'splitText';
  const isDateDiff = transform.operation === 'dateDiff';
  const isConditional = transform.operation === 'conditionalColumn';
  const isFormula = transform.operation === 'formula';
  const isDropDuplicates = transform.operation === 'dropDuplicates';
  const isRename = transform.operation === 'renameColumn';
  const isStats = ['correlation','linearRegression','tTest','chiSquare','anova'].includes(transform.operation);
  const needsNumeric = !isJoin && !isUnpivot && !isSplit && !isDateDiff && !isConditional && !isFormula && !isDropDuplicates && !isRename && !isStats;
  return <div className="analysis-dataframe-cell"><div className="analysis-function-palette"><span>よく使う関数</span><button type="button" className="secondary" onClick={() => update({ operation: 'formula', formulaKind: 'arithmetic', outputColumn: '計算値' })}>数式</button><button type="button" className="secondary" onClick={() => update({ operation: 'dropDuplicates' })}>重複除去</button><button type="button" className="secondary" onClick={() => update({ operation: 'unpivot' })}>縦持ち</button><button type="button" className="secondary" onClick={() => update({ operation: 'movingAverage' })}>移動平均</button><button type="button" className="secondary" onClick={() => update({ operation: 'correlation' })}>相関</button></div><div className="analysis-parameter-grid">
    <label>入力結果<ResultSourceSelect value={transform.sourceCellId} upstream={upstream} onChange={(sourceCellId) => update({ sourceCellId, valueColumn: '', periodColumn: '', groupColumn: '', secondColumn: '', joinLeftColumn: '' })} /></label>
    <label>出力名<input value={transform.outputName} onChange={(e) => update({ outputName: resultName(e.target.value, `calc_${cell.id.slice(-4)}`) })} /><small>SQLでは <code>{`result_${transform.outputName || 'name'}`}</code></small></label>
    <label>関数<select value={transform.operation} onChange={(e) => update({ operation: e.target.value as AnalysisFunctionTransform['operation'] })}>
      <optgroup label="集計・時系列"><option value="yearOverYear">前期比・前年比</option><option value="movingAverage">移動平均（グループ対応）</option><option value="cumulative">累計</option><option value="shareOfTotal">構成比</option><option value="rank">順位</option></optgroup>
      <optgroup label="前処理"><option value="fillMissing">欠損を直前値で補完</option><option value="excludeOutliers">外れ値を除外（3σ）</option><option value="join">2つの結果を結合</option><option value="unpivot">横持ちを縦持ちへ変換</option><option value="splitText">文字列を分割</option><option value="dateDiff">日付差分（日数）</option><option value="conditionalColumn">条件列を追加</option><option value="formula">数式セル（安全な関数）</option><option value="dropDuplicates">重複行を削除</option><option value="renameColumn">列名を変更</option></optgroup>
      <optgroup label="統計"><option value="correlation">相関係数</option><option value="linearRegression">単回帰分析</option><option value="tTest">2群のt検定（t値）</option><option value="chiSquare">カイ二乗検定</option><option value="anova">一元配置分散分析（F値）</option></optgroup>
    </select></label>
    {!isJoin && !isUnpivot && <label>{isFormula ? '対象列' : isDropDuplicates ? '重複判定列' : isRename ? '変更する列' : isSplit ? '文字列列' : isDateDiff ? '開始日列' : isConditional ? '確認列' : transform.operation === 'tTest' || transform.operation === 'anova' ? '数値列' : transform.operation === 'chiSquare' ? '行分類' : isStats ? 'X軸（説明変数）' : '数値列'}<select value={transform.valueColumn || ''} onChange={(e) => update({ valueColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    {(isDateDiff || isStats) && <label>{isDateDiff ? '終了日列' : transform.operation === 'chiSquare' ? '列分類' : 'Y軸（目的変数）'}<select value={transform.secondColumn || ''} onChange={(e) => update({ secondColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    {needsPeriod && <label>並び順列<select value={transform.periodColumn || ''} onChange={(e) => update({ periodColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    {(needsNumeric || isWindow || transform.operation === 'tTest' || transform.operation === 'anova') && <label>{transform.operation === 'tTest' || transform.operation === 'anova' ? '群・分類列' : 'グループ列（任意）'}<select value={transform.groupColumn || ''} onChange={(e) => update({ groupColumn: e.target.value })}><option value="">全体</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}
    {isWindow && <label>期間<input type="number" min="2" max="120" value={transform.windowSize || 3} onChange={(e) => update({ windowSize: Number(e.target.value) || 3 })} /></label>}
    {!isJoin && !isUnpivot && !isStats && <label>追加列名<input value={transform.outputColumn || ''} onChange={(e) => update({ outputColumn: e.target.value.slice(0, 80) })} placeholder="自動設定" /></label>}
  </div>
  {isJoin && <div className="analysis-parameter-grid"><label>結合する結果<ResultSourceSelect value={transform.joinSourceCellId || ''} upstream={upstream.filter((item) => item.id !== transform.sourceCellId)} onChange={(joinSourceCellId) => update({ joinSourceCellId, joinLeftColumn: '', joinRightColumn: '' })} /></label><label>左側の結合キー<select value={transform.joinLeftColumn || ''} onChange={(e) => update({ joinLeftColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label><label>右側の結合キー<select value={transform.joinRightColumn || ''} onChange={(e) => update({ joinRightColumn: e.target.value })}><option value="">列を選択</option>{joinColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label><label>結合方法<select value={transform.joinType || 'left'} onChange={(e) => update({ joinType: e.target.value as 'left' | 'inner' })}><option value="left">左結合（左を残す）</option><option value="inner">内部結合（一致のみ）</option></select></label></div>}
  {isUnpivot && <div className="analysis-dataframe-columns">{columns.map((column) => <label key={column}><input type="checkbox" checked={selectedValues.has(column)} onChange={(e) => { const next = new Set(selectedValues); e.target.checked ? next.add(column) : next.delete(column); update({ valueColumns: [...next] }); }} />{column}</label>)}</div>}
  {isSplit && <div className="analysis-parameter-grid"><label>区切り文字<input value={transform.delimiter ?? ','} onChange={(e) => update({ delimiter: e.target.value })} placeholder="," /></label><label>取得位置（0から）<input type="number" min="0" max="100" value={transform.splitIndex || 0} onChange={(e) => update({ splitIndex: Number(e.target.value) || 0 })} /></label></div>}
  {isFormula && <div className="analysis-parameter-grid"><label>数式<select value={transform.formulaKind || 'arithmetic'} onChange={(e) => update({ formulaKind: e.target.value as AnalysisFunctionTransform['formulaKind'] })}><option value="arithmetic">四則演算</option><option value="round">ROUND（丸め）</option><option value="absolute">ABS（絶対値）</option><option value="year">YEAR（日付の年）</option><option value="month">MONTH（日付の月）</option><option value="coalesce">COALESCE（空欄を置換）</option><option value="dateDiff">DATE_DIFF（日数差）</option><option value="ifGreater">IF（指定値より大きい）</option></select></label>{(transform.formulaKind || 'arithmetic') === 'arithmetic' && <label>演算<select value={transform.formulaOperator || 'add'} onChange={(e) => update({ formulaOperator: e.target.value as AnalysisFunctionTransform['formulaOperator'] })}><option value="add">＋</option><option value="subtract">−</option><option value="multiply">×</option><option value="divide">÷</option></select></label>} {['arithmetic','round','coalesce','ifGreater'].includes(transform.formulaKind || 'arithmetic') && <label>値<input value={transform.formulaValue || ''} onChange={(e) => update({ formulaValue: e.target.value })} placeholder="例：1000" /></label>} {(transform.formulaKind || '') === 'dateDiff' && <label>終了日列<select value={transform.secondColumn || ''} onChange={(e) => update({ secondColumn: e.target.value })}><option value="">列を選択</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>}</div>}
  {isRename && <div className="analysis-parameter-grid"><label>新しい列名<input value={transform.renameTo || ''} onChange={(e) => update({ renameTo: e.target.value.slice(0, 120) })} placeholder="例：年度" /></label></div>}
  {isConditional && <div className="analysis-parameter-grid"><label>条件<select value={transform.conditionOperator || 'equals'} onChange={(e) => update({ conditionOperator: e.target.value as AnalysisFunctionTransform['conditionOperator'] })}><option value="equals">一致</option><option value="contains">含む</option><option value="notEmpty">空欄ではない</option><option value="greaterThan">より大きい</option><option value="lessThan">より小さい</option></select></label>{transform.conditionOperator !== 'notEmpty' && <label>比較値<input value={transform.conditionValue || ''} onChange={(e) => update({ conditionValue: e.target.value })} /></label>}<label>該当時の値<input value={transform.trueValue || ''} onChange={(e) => update({ trueValue: e.target.value })} /></label><label>非該当時の値<input value={transform.falseValue || ''} onChange={(e) => update({ falseValue: e.target.value })} /></label></div>}
  {transform.sourceCellId && !source?.result && <div className="analysis-parameter-help">入力元は未実行です。このセルを実行すると、必要な上側セルを先に自動実行します。実行後に列を選択できます。</div>}
  <FunctionGuide operation={transform.operation} />
  <div className="analysis-parameter-help">pandasでよく使う処理を安全な定型関数として実行します。結合・統計を含め、任意JavaScriptやPythonは実行しません。</div></div>;
}

function ImportEditor({ cell, onChange }: { cell: ImportCell; onChange: (imported: AnalysisImportTransform) => void }) {
  const imported = cell.imported;
  const selectFile = async (file?: File) => {
    if (!file) return;
    try {
      const name = file.name;
      let rows: Array<Record<string, unknown>> = [];
      if (/\.json$/i.test(name)) {
        const parsed = JSON.parse(await file.text());
        const array = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
        rows = array.filter((item: unknown) => item && typeof item === 'object').map((item: unknown) => item as Record<string, unknown>);
      } else if (/\.(xlsx|xls|csv)$/i.test(name)) {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
      } else throw new Error('CSV、Excel（.xlsx / .xls）、JSONのみ取り込めます。');
      const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).map(String).slice(0, 128);
      const limited = rows.slice(0, MAX_ANALYSIS_ROWS).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
      onChange({ ...imported, sourceName: name, columns, rows: limited, truncated: rows.length > limited.length, importedAt: new Date().toISOString() });
    } catch (error: any) { window.alert(error?.message || 'ファイルの取込に失敗しました。'); }
  };
  return <div className="analysis-dataframe-cell"><div className="analysis-parameter-grid"><label>ローカルファイル<input type="file" accept=".csv,.xlsx,.xls,.json,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(event) => void selectFile(event.target.files?.[0])} /></label><label>出力名<input value={imported.outputName} onChange={(e) => onChange({ ...imported, outputName: resultName(e.target.value, `import_${cell.id.slice(-4)}`) })} /><small>SQLでは <code>{`result_${imported.outputName || 'name'}`}</code></small></label></div><div className="analysis-parameter-help">{imported.sourceName ? `${imported.sourceName} ・ ${imported.rows.length.toLocaleString()}行・${imported.columns.length}列` : 'CSV、Excel、JSONを選択してください。内容はノートのローカル保存領域だけに保持され、共有フォルダへは保存しません。'}{imported.truncated ? '（最大100,000行で切り詰め）' : ''}</div></div>;
}

function SqlEditor({ value, dictionary, onChange }: { value: string; dictionary: AnalysisDataDictionary | null; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [term, setTerm] = useState('');
  const candidates = useMemo(() => {
    const all = (dictionary?.datasets || []).flatMap((dataset) => [
      { label: dataset.name, insert: dataset.name, detail: 'テーブル' },
      ...dataset.columns.map((column) => ({ label: `${dataset.name}.${column.name}`, insert: column.name, detail: `${column.type} · ${column.description}` })),
    ]);
    const query = term.toLowerCase();
    return all.filter((item) => !query || item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query)).slice(0, 12);
  }, [dictionary, term]);

  const tokenAtCursor = (): { start: number; token: string } => {
    const textarea = ref.current;
    const caret = textarea?.selectionStart ?? value.length;
    const left = value.slice(0, caret);
    const match = left.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
    return { start: caret - (match?.[0].length || 0), token: match?.[0] || '' };
  };
  const showSuggestions = () => {
    const current = tokenAtCursor();
    setTerm(current.token);
    setActiveIndex(0);
    setOpen(true);
  };
  const closeSuggestions = () => {
    setOpen(false);
    setActiveIndex(0);
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) closeSuggestions();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSuggestions();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  const insertCandidate = (insert: string) => {
    const textarea = ref.current;
    const caret = textarea?.selectionStart ?? value.length;
    const current = tokenAtCursor();
    const next = `${value.slice(0, current.start)}${insert}${value.slice(caret)}`;
    onChange(next);
    closeSuggestions();
    requestAnimationFrame(() => {
      if (!textarea) return;
      const position = current.start + insert.length;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  };

  return <div ref={editorRef} className="analysis-sql-editor">
    <textarea ref={ref} className="analysis-sql" spellCheck={false} value={value} onChange={(e) => { onChange(e.target.value); if (open) setTerm(tokenAtCursor().token); }} onBlur={() => window.setTimeout(() => { if (!editorRef.current?.contains(document.activeElement)) closeSuggestions(); }, 0)} onKeyDown={(event) => {
      if ((event.ctrlKey || (event.metaKey && event.shiftKey)) && event.code === 'Space') { event.preventDefault(); showSuggestions(); return; }
      if (!open) return;
      if (event.key === 'Escape') { event.preventDefault(); closeSuggestions(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(0, candidates.length - 1))); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); return; }
      if (event.key === 'Enter' && candidates[activeIndex]) { event.preventDefault(); insertCandidate(candidates[activeIndex].insert); }
    }} />
    <div className="analysis-sql-helper"><span><kbd>Ctrl</kbd> + <kbd>Space</kbd> または <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> で補完</span><div><button type="button" className="secondary" onClick={showSuggestions}>補完</button>{open && <button type="button" className="secondary analysis-completion-close" onClick={closeSuggestions} aria-label="補完候補を閉じる">閉じる</button>}</div></div>
    {open && <div className="analysis-completion-menu" role="listbox" aria-label="SQL補完候補">{candidates.length ? candidates.map((candidate, index) => <button type="button" key={`${candidate.label}-${index}`} className={index === activeIndex ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => insertCandidate(candidate.insert)}><code>{candidate.label}</code><small>{candidate.detail}</small></button>) : <div className="analysis-completion-empty">候補がありません</div>}</div>}
  </div>;
}

function AnalysisDashboardPanel({ pins, onOpen, onDelete }: { pins: AnalysisDashboardPin[]; onOpen: (pin: AnalysisDashboardPin) => void; onDelete: (id: string) => void }) {
  if (!pins.length) return <div className="analysis-dashboard-empty"><b>固定済みのKPIはありません</b><span>セルを実行後、「ダッシュボードに固定」でここへ追加できます。</span></div>;
  return <div className="analysis-dashboard-list"><div className="analysis-dashboard-note">固定結果は端末側SQLiteに保存されます。最新データに更新するには、元ノートで同期・実行してから再度固定してください。</div>{pins.map((pin) => <article className="analysis-dashboard-card" key={pin.id}><div className="analysis-dashboard-card-head"><div><small>{pin.notebookTitle}</small><b>{pin.cellTitle}</b></div><button className="secondary danger" onClick={() => onDelete(pin.id)}>削除</button></div><div className="analysis-dashboard-metric"><strong>{pin.rowCount.toLocaleString()}</strong><span>行</span></div><small>取得 {new Date(pin.capturedAt).toLocaleString('ja-JP')}{pin.truncated ? ' ・ 一部表示' : ''}</small>{pin.columns.length > 0 && <div className="analysis-dashboard-preview"><div>{pin.columns.slice(0, 3).map((column) => <span key={column}>{column}</span>)}</div>{pin.rows.slice(0, 3).map((row, index) => <div key={index}>{pin.columns.slice(0, 3).map((column) => <span key={column} title={String(row[column] ?? '')}>{String(row[column] ?? '—')}</span>)}</div>)}</div>}<button className="primary analysis-dashboard-open" onClick={() => onOpen(pin)}>元の分析を開く</button></article>)}</div>;
}

function DictionaryPanel({ dictionary, onCopy }: { dictionary: AnalysisDataDictionary | null; onCopy: (text: string) => void }) {
  if (!dictionary) return <p className="analysis-empty-list">データ辞書を読み込んでいます。</p>;
  return <div className="analysis-dictionary-panel">{dictionary.datasets.map((dataset: AnalysisDataDictionaryDataset) => <details key={dataset.name} open={dataset.name === 'database_rows'}><summary><code>{dataset.name}</code><span>{dataset.description}</span></summary><div className="analysis-dictionary-columns">{dataset.columns.map((column) => <button type="button" key={column.name} title={`${column.description}\nクリックで列名をコピー`} onClick={() => onCopy(column.name)}><code>{column.name}</code><small>{column.type}</small><span>{column.description}</span></button>)}</div></details>)}</div>;
}


function profileResult(result: AnalysisQueryResult): AnalysisProfile {
  const rows = result.rows || [];
  const columns = result.columns.map((column) => {
    const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
    const numericValues = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const dateValues = values.map((value) => new Date(String(value))).filter((value) => Number.isFinite(value.getTime()));
    const unique = new Set(values.map((value) => String(value)));
    const counts = new Map<string, number>(); values.forEach((value) => { const key = String(value); counts.set(key, (counts.get(key) || 0) + 1); });
    const inferredType: AnalysisProfile['columns'][number]['inferredType'] = !values.length ? 'empty' : numericValues.length === values.length ? 'number' : dateValues.length === values.length ? 'date' : numericValues.length || dateValues.length ? 'mixed' : 'text';
    const topValues = [...counts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],'ja')).slice(0,5).map(([value,count]) => ({ value, count }));
    return { column, inferredType, nonNullCount: values.length, nullCount: rows.length - values.length, uniqueCount: unique.size, min: numericValues.length ? Math.min(...numericValues) : dateValues.length ? new Date(Math.min(...dateValues.map((date) => date.getTime()))).toISOString().slice(0,10) : null, max: numericValues.length ? Math.max(...numericValues) : dateValues.length ? new Date(Math.max(...dateValues.map((date) => date.getTime()))).toISOString().slice(0,10) : null, mean: numericValues.length ? numericValues.reduce((sum,value)=>sum+value,0)/numericValues.length : null, topValues };
  });
  return { rowCount: result.rowCount, columns, createdAt: new Date().toISOString() };
}

function downloadAnalysisFile(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AnalysisOperationsPanel({ dictionary, settings, notebook, cells, results, selectedCellId, status, onSettings, onStatus, onImportTemplate }: { dictionary: AnalysisDataDictionary | null; settings: AnalysisWorkspaceSettings | null; notebook: AnalysisNotebook; cells: AnalysisCell[]; results: Record<string, AnalysisQueryResult>; selectedCellId: string; status: AnalysisStatus | null; onSettings: (next: AnalysisWorkspaceSettings) => void; onStatus: (text: string) => void; onImportTemplate: (template: Partial<AnalysisNotebook>) => void; }) {
  const [metricName, setMetricName] = useState(''); const [metricDataset, setMetricDataset] = useState(''); const [metricExpression, setMetricExpression] = useState('COUNT(*)');
  const [meaningDataset, setMeaningDataset] = useState(''); const [meaningColumn, setMeaningColumn] = useState(''); const [meaningLabel, setMeaningLabel] = useState(''); const [meaningRole, setMeaningRole] = useState<AnalysisColumnMeaning['role']>('dimension');
  const templateInputRef = useRef<HTMLInputElement | null>(null);
  const currentResult = selectedCellId ? results[selectedCellId] : undefined;
  const profile = currentResult ? profileResult(currentResult) : null;
  const dependencies = cells.flatMap((cell) => {
    const source = (() => {
      switch (cell.type) {
        case 'dataframe': return cell.transform.sourceCellId;
        case 'function': return cell.transform.sourceCellId;
        case 'pivot': return cell.pivot.sourceCellId;
        case 'summary': return cell.summary.sourceCellId;
        case 'quality': return cell.quality.sourceCellId;
        case 'preprocess': return cell.preprocess.sourceCellId;
        case 'chart': return cell.sourceCellId;
        default: return '';
      }
    })();
    const upstream = cells.find((item) => item.id === source);
    return source ? [{ from: source, to: cell.id, label: `${cellTitle(cell)} ← ${upstream ? cellTitle(upstream) : '不明なセル'}` }] : [];
  });
  const safe = settings || { columnMeanings: [], metrics: [], automation: { enabled: false, intervalMinutes: 60, alertRules: [] }, updatedAt: '' };
  const exportMarkdown = () => {
    const body = cells.map((cell, index) => {
      if (cell.type === 'markdown') return cell.content;
      if (cell.type === 'section') return `## ${cell.title}\n\n${cell.description || ''}`;
      const result = results[cell.id as keyof typeof results];
      if (!result) return `### ${index + 1}. ${cellTitle(cell)}\n\n未実行`;
      const head = `| ${result.columns.join(' | ')} |\n| ${result.columns.map(()=>'---').join(' | ')} |`;
      const rows = result.rows.slice(0, 100).map((row) => `| ${result.columns.map((column)=>String(row[column] ?? '').replaceAll('|','\\|').replaceAll('\n',' ')).join(' | ')} |`).join('\n');
      return `### ${index + 1}. ${cellTitle(cell)}\n\n${head}\n${rows}${result.truncated ? '\n\n※ 一部表示' : ''}`;
    }).join('\n\n');
    downloadAnalysisFile(`${notebook.title || 'analysis'}-report.md`, `# ${notebook.title}\n\n${notebook.description}\n\n作成日時: ${new Date().toLocaleString('ja-JP')}\n\n${body}`, 'text/markdown;charset=utf-8'); onStatus('Markdownレポートを書き出しました');
  };
  const exportHtml = () => { const markdown = `<h1>${notebook.title}</h1><p>${notebook.description}</p>${cells.map((cell) => { const result = results[cell.id]; if (cell.type === 'markdown') return `<pre>${cell.content.replace(/</g,'&lt;')}</pre>`; if (cell.type === 'section') return `<h2>${cell.title}</h2><p>${cell.description || ''}</p>`; if (!result) return `<h3>${cellTitle(cell)}</h3><p>未実行</p>`; return `<h3>${cellTitle(cell)}</h3><table><thead><tr>${result.columns.map((column)=>`<th>${column}</th>`).join('')}</tr></thead><tbody>${result.rows.slice(0,1000).map((row)=>`<tr>${result.columns.map((column)=>`<td>${String(row[column]??'').replace(/</g,'&lt;')}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }).join('')}`; downloadAnalysisFile(`${notebook.title || 'analysis'}-report.html`, `<!doctype html><meta charset=\"utf-8\"><title>${notebook.title}</title><style>body{font-family:system-ui;padding:32px;color:#182230}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d8dee8;padding:6px;text-align:left}th{background:#f5f7fa}pre{white-space:pre-wrap}</style>${markdown}`, 'text/html;charset=utf-8'); onStatus('HTMLレポートを書き出しました'); };
  const exportExcel = () => { const book = XLSX.utils.book_new(); Object.entries(results).forEach(([id, result]) => { const cell = cells.find((item)=>item.id===id); if (!cell) return; XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(result.rows, { header: result.columns }), cellTitle(cell).slice(0, 28) || id.slice(0, 12)); }); XLSX.writeFile(book, `${notebook.title || 'analysis'}-report.xlsx`); onStatus('Excelレポートを書き出しました'); };
  const exportTemplate = () => { const value = { version: 1, exportedAt: new Date().toISOString(), notebook: { ...notebook, id: '', createdAt: '', updatedAt: '', executionHistory: {}, snapshots: {} } }; downloadAnalysisFile(`${notebook.title || 'analysis'}-template.json`, JSON.stringify(value, null, 2), 'application/json;charset=utf-8'); onStatus('共有用テンプレートJSONを書き出しました'); };
  const importTemplate = async (file?: File) => { if (!file) return; try { const parsed = JSON.parse(await file.text()); const draft = parsed?.notebook || parsed; if (!draft || !Array.isArray(draft.cells)) throw new Error('分析テンプレートJSONではありません。'); onImportTemplate(draft); onStatus('共有テンプレートを新しい分析ノートとして読み込みました'); } catch (error: any) { onStatus(error?.message || 'テンプレートを読み込めませんでした'); } finally { if (templateInputRef.current) templateInputRef.current.value = ''; } };
  const addMetric = () => { if (!metricName.trim() || !metricDataset || !metricExpression.trim()) return; const metric: AnalysisMetricDefinition = { id: nanoid(10), name: metricName.trim(), description: '', dataset: metricDataset, expression: metricExpression.trim(), format: 'number', updatedAt: new Date().toISOString() }; onSettings({ ...safe, metrics: [metric, ...safe.metrics] }); setMetricName(''); };
  const addMeaning = () => { if (!meaningDataset || !meaningColumn) return; const meaning: AnalysisColumnMeaning = { dataset: meaningDataset, column: meaningColumn, label: meaningLabel || meaningColumn, description: '', role: meaningRole, updatedAt: new Date().toISOString() }; onSettings({ ...safe, columnMeanings: [meaning, ...safe.columnMeanings.filter((item)=>!(item.dataset===meaning.dataset && item.column===meaning.column))] }); setMeaningLabel(''); };
  const selectedDataset = dictionary?.datasets.find((dataset)=>dataset.name===meaningDataset);
  return <div className="analysis-operations-panel">
    <section><h3>分析の信頼性</h3><p>DuckDB同期：{status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString('ja-JP') : '未同期'}{status?.lastSyncMode === 'unchanged' ? '（前回から変更なし・再構築を省略）' : status?.lastSyncMode === 'rebuilt' ? '（変更を反映）' : ''}。選択中セル：{currentResult ? `${currentResult.rowCount.toLocaleString()}行 / ${currentResult.elapsedMs.toLocaleString()}ms${currentResult.truncated ? ' / 一部表示' : ''}` : '未実行'}。実行履歴・鮮度表示は各セルの上部で確認できます。</p></section>
    <section><h3>レポート出力</h3><p>現在のノート・実行結果を端末から書き出します。PDFは発表モードで印刷ダイアログを使います。</p><div className="analysis-operations-actions"><button className="primary" onClick={exportMarkdown}>Markdown</button><button className="secondary" onClick={exportHtml}>HTML</button><button className="secondary" onClick={exportExcel}>Excel</button><button className="secondary" onClick={() => window.print()}>PDFとして印刷</button></div></section>
    <section><h3>テンプレート共有</h3><p>個人の実行履歴・スナップショットを含めず、ノート構造だけをJSONで配布できます。</p><div className="analysis-operations-actions"><button className="secondary" onClick={exportTemplate}>テンプレートJSONを書き出す</button><button className="secondary" onClick={() => templateInputRef.current?.click()}>テンプレートJSONを読み込む</button><input ref={templateInputRef} type="file" accept="application/json,.json" hidden onChange={(event)=>void importTemplate(event.target.files?.[0])}/></div></section>
    <section><h3>依存関係</h3>{dependencies.length ? <ul>{dependencies.map((item)=><li key={`${item.from}-${item.to}`}>{item.label}</li>)}</ul> : <p>セル間の依存関係はまだありません。</p>}</section>
    <section><h3>データプロファイル</h3>{profile ? <><p>{profile.rowCount.toLocaleString()}行・{profile.columns.length}列。選択中セルの結果だけを分析します。</p><div className="analysis-profile-list">{profile.columns.map((column)=><div key={column.column}><b>{column.column}</b><span>{column.inferredType} / 欠損 {column.nullCount} / ユニーク {column.uniqueCount}</span>{typeof column.mean === 'number' && <small>平均 {column.mean.toLocaleString(undefined,{maximumFractionDigits:3})} ・ 範囲 {String(column.min)}〜{String(column.max)}</small>}</div>)}</div></> : <p>実行済みセルを選択すると、列型・欠損・ユニーク数・分布の概要を表示します。</p>}</section>
    <section><h3>データの意味づけ</h3><div className="analysis-parameter-grid"><label>データ<select value={meaningDataset} onChange={(e)=>{setMeaningDataset(e.target.value);setMeaningColumn('');}}><option value="">選択</option>{(dictionary?.datasets||[]).map((dataset)=><option key={dataset.name} value={dataset.name}>{dataset.name}</option>)}</select></label><label>列<select value={meaningColumn} onChange={(e)=>setMeaningColumn(e.target.value)}><option value="">選択</option>{selectedDataset?.columns.map((column)=><option key={column.name} value={column.name}>{column.name}</option>)}</select></label><label>表示名<input value={meaningLabel} onChange={(e)=>setMeaningLabel(e.target.value)} /></label><label>役割<select value={meaningRole} onChange={(e)=>setMeaningRole(e.target.value as AnalysisColumnMeaning['role'])}><option value="dimension">分類</option><option value="measure">数値</option><option value="date">日付</option><option value="identifier">識別子</option><option value="exclude">分析対象外</option></select></label></div><button className="secondary" onClick={addMeaning}>列の意味を保存</button>{safe.columnMeanings.length>0 && <ul>{safe.columnMeanings.slice(0,12).map((item)=><li key={`${item.dataset}.${item.column}`}>{item.dataset}.{item.column} → {item.label}（{item.role}）</li>)}</ul>}</section>
    <section><h3>指標管理</h3><div className="analysis-parameter-grid"><label>指標名<input value={metricName} onChange={(e)=>setMetricName(e.target.value)} placeholder="例：未完了件数"/></label><label>データ<select value={metricDataset} onChange={(e)=>setMetricDataset(e.target.value)}><option value="">選択</option>{(dictionary?.datasets||[]).map((dataset)=><option key={dataset.name} value={dataset.name}>{dataset.name}</option>)}</select></label><label>集計式<input value={metricExpression} onChange={(e)=>setMetricExpression(e.target.value)} placeholder="例：COUNT(*)"/></label></div><button className="secondary" onClick={addMetric}>指標を保存</button>{safe.metrics.length>0 && <ul>{safe.metrics.map((metric)=><li key={metric.id}><b>{metric.name}</b>：{metric.dataset} / {metric.expression}</li>)}</ul>}</section>
    <section><h3>定期同期・通知</h3><label><input type="checkbox" checked={safe.automation.enabled} onChange={(e)=>onSettings({...safe, automation:{...safe.automation,enabled:e.target.checked}})}/> アプリ起動中に分析データを定期同期する</label><label>同期間隔（分）<input type="number" min="15" max="1440" value={safe.automation.intervalMinutes} onChange={(e)=>onSettings({...safe, automation:{...safe.automation, intervalMinutes:Math.max(15,Math.min(1440,Number(e.target.value)||60))}})}/></label><p>定期同期はアプリ起動中のみ実行します。通知ルールは次の段階でKPI指標へ紐付けできます。</p></section>
  </div>;
}

export function AnalysisNotebookScreen({ api, onBack, onStatus, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal }: Props) {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [dictionary, setDictionary] = useState<AnalysisDataDictionary | null>(null);
  const [notebooks, setNotebooks] = useState<AnalysisNotebook[]>([]);
  const [dashboardPins, setDashboardPins] = useState<AnalysisDashboardPin[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<AnalysisWorkspaceSettings | null>(null);
  const [notebook, setNotebook] = useState<AnalysisNotebook>({ id: nanoid(12), title: '無題の分析', description: '', sql: STARTER_SQL, chart: { type: 'bar' }, cells: [newSqlCell()], createdAt: '', updatedAt: '' });
  const [results, setResults] = useState<Record<string, AnalysisQueryResult>>({});
  const [runningCellId, setRunningCellId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('notebooks');
  const [selectedCellId, setSelectedCellId] = useState('');
  const [expandedResultCellId, setExpandedResultCellId] = useState('');
  const [presentationMode, setPresentationMode] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiComposerOpen, setAiComposerOpen] = useState(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const cells = useMemo(() => notebookCells(notebook), [notebook]);
  const executionHistory = notebook.executionHistory || {};
  const executionHistoryRef = useRef<Record<string, AnalysisCellExecution[]>>({});
  useEffect(() => { executionHistoryRef.current = executionHistory; }, [executionHistory]);
  const parameters = useMemo(() => cells.flatMap((cell) => cell.type === 'parameter' ? [cell.parameter] : cell.type === 'variable' ? [cell.variable] : []), [cells]);
  const upstreamResults = (index: number) => cells.slice(0, index).flatMap((item) => {
    if (item.type !== 'sql' && item.type !== 'dataframe' && item.type !== 'function' && item.type !== 'pivot' && item.type !== 'summary' && item.type !== 'quality' && item.type !== 'preprocess' && item.type !== 'import') return [];
    const label = item.type === 'sql' ? `SQL: ${item.outputName || item.id}` : item.type === 'dataframe' ? `DataFrame: ${item.transform.outputName || item.id}` : item.type === 'function' ? `関数: ${item.transform.outputName || item.id}` : item.type === 'pivot' ? `Pivot: ${item.pivot.outputName || item.id}` : item.type === 'summary' ? `統計: ${item.summary.outputName || item.id}` : item.type === 'quality' ? `品質: ${item.quality.outputName || item.id}` : item.type === 'preprocess' ? `前処理: ${item.preprocess.outputName || item.id}` : `取込: ${item.imported.outputName || item.id}`;
    return [{ id: item.id, label, result: results[item.id] }];
  });

  const cellSignature = (cell: AnalysisCell): string => {
    if (cell.type === 'sql') return JSON.stringify({ type: cell.type, sql: cell.sql, outputName: cell.outputName || '' });
    if (cell.type === 'dataframe') return JSON.stringify({ type: cell.type, transform: cell.transform });
    if (cell.type === 'function') return JSON.stringify({ type: cell.type, transform: cell.transform });
    if (cell.type === 'import') return JSON.stringify({ type: cell.type, sourceName: cell.imported.sourceName, outputName: cell.imported.outputName, columns: cell.imported.columns, rowCount: cell.imported.rows.length, importedAt: cell.imported.importedAt || '' });
    if (cell.type === 'pivot') return JSON.stringify({ type: cell.type, pivot: cell.pivot });
    if (cell.type === 'summary') return JSON.stringify({ type: cell.type, summary: cell.summary });
    if (cell.type === 'quality') return JSON.stringify({ type: cell.type, quality: cell.quality });
    if (cell.type === 'preprocess') return JSON.stringify({ type: cell.type, preprocess: cell.preprocess });
    if (cell.type === 'chart') return JSON.stringify({ type: cell.type, sourceCellId: cell.sourceCellId, chart: cell.chart });
    return JSON.stringify(cell);
  };
  const parameterSignature = () => JSON.stringify(parameters.map((parameter) => ({ name: parameter.name, type: parameter.type, value: parameter.value, options: parameter.options || [] })));
  const latestExecution = (cellId: string, history = executionHistory) => history[cellId]?.[0];
  const openOrigin = (target: OriginTarget) => {
    if (target.kind === 'page') onOpenPage(target.pageId);
    else if (target.kind === 'database-row') onOpenDatabaseRow(target.databaseId, target.rowId);
    else if (target.kind === 'database') onOpenDatabase(target.databaseId);
    else onOpenJournal(target.date);
    onStatus(target.label);
  };
  const refresh = async () => {
    if (!api) return;
    const [nextStatus, nextNotebooks, nextDictionary, nextPins, nextSettings] = await Promise.all([api.getAnalysisStatus(), api.listAnalysisNotebooks(), api.getAnalysisDataDictionary(), api.listAnalysisDashboardPins(), api.getAnalysisWorkspaceSettings()]);
    setStatus(nextStatus);
    setNotebooks(nextNotebooks);
    setDictionary(nextDictionary);
    setDashboardPins(nextPins);
    setWorkspaceSettings(nextSettings);
  };
  useEffect(() => { void refresh().catch((e) => setError(e?.message || '分析情報を取得できませんでした。')); }, [api]);

  const saveWorkspaceSettings = (next: AnalysisWorkspaceSettings) => { setWorkspaceSettings(next); if (!api) return; void api.saveAnalysisWorkspaceSettings(next).then((saved) => { setWorkspaceSettings(saved); onStatus('分析の運用設定を端末側SQLiteへ保存しました'); }).catch((e: any) => setError(e?.message || '運用設定の保存に失敗しました')); };

  const setCells = (next: AnalysisCell[]) => setNotebook((current) => ({ ...current, cells: next }));
  const updateCell = (id: string, updater: (cell: AnalysisCell) => AnalysisCell) => setCells(cells.map((cell) => cell.id === id ? updater(cell) : cell));
  const moveCell = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= cells.length) return; const next = [...cells]; [next[index], next[target]] = [next[target], next[index]]; setCells(next); };
  const removeCell = (id: string) => { if (cells.length === 1) { setError('分析ノートには少なくとも1つのセルが必要です。'); return; } setCells(cells.filter((cell) => cell.id !== id)); setResults((current) => { const next = { ...current }; delete next[id]; return next; }); };
  const sync = async () => { if (!api) return; setBusy(true); setError(''); try { const next = await api.syncAnalysisData(); setStatus(next); onStatus('分析用DuckDBキャッシュを同期しました'); } catch (e: any) { setError(e?.message || '同期に失敗しました'); } finally { setBusy(false); } };
  const namedResultsBefore = (cellId: string, currentResults: Record<string, AnalysisQueryResult>): AnalysisNamedResult[] => {
    const index = cells.findIndex((item) => item.id === cellId);
    return cells.slice(0, Math.max(0, index)).flatMap((item) => {
      const name = item.type === 'sql' ? item.outputName : item.type === 'dataframe' || item.type === 'function' ? item.transform.outputName : item.type === 'pivot' ? item.pivot.outputName : item.type === 'summary' ? item.summary.outputName : item.type === 'quality' ? item.quality.outputName : item.type === 'preprocess' ? item.preprocess.outputName : item.type === 'import' ? item.imported.outputName : '';
      const result = currentResults[item.id];
      return name && result ? [{ name, columns: result.columns, rows: result.rows, resultId: result.resultId }] : [];
    });
  };
  const hydrateResult = async (result: AnalysisQueryResult): Promise<AnalysisQueryResult> => {
    if (!result.resultId || !result.hasMore || !api) return result;
    return api.getAnalysisResultAll(result.resultId);
  };

  const resultDependencies = (cell: SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell | ChartCell): string[] => {
    const index = cells.findIndex((item) => item.id === cell.id);
    if (index < 0) return [];
    if (cell.type === 'import') return [];
    if (cell.type === 'dataframe' || cell.type === 'function' || cell.type === 'pivot' || cell.type === 'summary' || cell.type === 'quality' || cell.type === 'preprocess' || cell.type === 'chart') {
      const sourceCellId = (() => {
        switch (cell.type) {
          case 'dataframe': return cell.transform.sourceCellId;
          case 'function': return cell.transform.sourceCellId;
          case 'pivot': return cell.pivot.sourceCellId;
          case 'summary': return cell.summary.sourceCellId;
          case 'quality': return cell.quality.sourceCellId;
          case 'preprocess': return cell.preprocess.sourceCellId;
          case 'chart': return cell.sourceCellId;
          default: return '';
        }
      })();
      if (!sourceCellId) throw new Error(`${cell.type === 'function' ? '分析関数' : cell.type === 'preprocess' ? '前処理' : cell.type === 'pivot' ? 'ピボット' : cell.type === 'summary' ? '統計・要約' : cell.type === 'quality' ? '品質チェック' : cell.type === 'chart' ? 'グラフ' : 'DataFrame'}セルの入力結果を選択してください。`);
      const sourceIndex = cells.findIndex((item) => item.id === sourceCellId);
      if (sourceIndex < 0) throw new Error('選択した入力元セルが見つかりません。入力結果を選び直してください。');
      if (sourceIndex >= index) throw new Error('DataFrameセルは上側のセルだけを入力元にできます。');
      const source = cells[sourceIndex];
      if (source.type !== 'sql' && source.type !== 'dataframe' && source.type !== 'function' && source.type !== 'pivot' && source.type !== 'summary' && source.type !== 'quality' && source.type !== 'preprocess' && source.type !== 'import') throw new Error('入力元にはSQL、DataFrame、分析関数、ピボット、統計・要約、品質チェック、取込の各セルを選択してください。');
      if (cell.type !== 'function' || cell.transform.operation !== 'join') return [source.id];
      const joinSourceCellId = cell.transform.joinSourceCellId || '';
      if (!joinSourceCellId) throw new Error('結合する2つ目の入力結果を選択してください。');
      const joinSourceIndex = cells.findIndex((item) => item.id === joinSourceCellId);
      if (joinSourceIndex < 0 || joinSourceIndex >= index) throw new Error('結合する結果は上側のセルから選択してください。');
      const joinSource = cells[joinSourceIndex];
      if (joinSource.type !== 'sql' && joinSource.type !== 'dataframe' && joinSource.type !== 'function' && joinSource.type !== 'pivot' && joinSource.type !== 'summary' && joinSource.type !== 'quality' && joinSource.type !== 'import') throw new Error('結合する入力元セルを選び直してください。');
      if (joinSource.id === source.id) throw new Error('結合する2つの入力結果には別々のセルを選択してください。');
      return [source.id, joinSource.id];
    }
    const referenced = Array.from(cell.sql.matchAll(/\bresult_([A-Za-z_][A-Za-z0-9_]*)\b/g)).map((match) => match[1]);
    return referenced.map((name) => {
      const source = cells.slice(0, index).find((item) => {
        const outputName = item.type === 'sql' ? item.outputName : item.type === 'dataframe' || item.type === 'function' ? item.transform.outputName : item.type === 'pivot' ? item.pivot.outputName : item.type === 'summary' ? item.summary.outputName : item.type === 'quality' ? item.quality.outputName : item.type === 'preprocess' ? item.preprocess.outputName : item.type === 'import' ? item.imported.outputName : '';
        return outputName === name;
      });
      if (!source) throw new Error(`「result_${name}」の出力元が上側のセルに見つかりません。出力名とセル順序を確認してください。`);
      return source.id;
    });
  };
  const freshnessFor = (cell: AnalysisCell): { state: 'fresh' | 'stale' | 'idle'; label: string } => {
    if (cell.type === 'parameter' || cell.type === 'variable' || cell.type === 'markdown' || cell.type === 'section') return { state: 'fresh', label: '設定セル' };
    const record = latestExecution(cell.id);
    if (!record) return { state: 'idle', label: '未実行' };
    if (record.cellSignature !== cellSignature(cell)) return { state: 'stale', label: '設定変更後・再実行が必要' };
    if (record.parameterSignature !== parameterSignature()) return { state: 'stale', label: '条件変更後・再実行が必要' };
    if (status?.lastSyncedAt && record.sourceSyncedAt && new Date(status.lastSyncedAt).getTime() > new Date(record.sourceSyncedAt).getTime()) return { state: 'stale', label: 'データ同期後・再実行が必要' };
    try {
      const target = cell as SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell | ChartCell;
      const dependencies = resultDependencies(target);
      for (const dependencyId of dependencies) {
        const upstream = latestExecution(dependencyId);
        if (!upstream) return { state: 'stale', label: '上流が未実行です' };
        if (record.dependencySignatures[dependencyId] !== upstream.cellSignature || new Date(upstream.executedAt).getTime() > new Date(record.executedAt).getTime()) return { state: 'stale', label: '上流更新後・再実行が必要' };
      }
    } catch { return { state: 'stale', label: '入力設定を確認してください' }; }
    return { state: 'fresh', label: '最新の結果' };
  };

  const runCell = async (cell: SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell | ChartCell, initialResults = results, refreshDependencies = true, commitRender = true, persistNotebook = true): Promise<AnalysisQueryResult | null> => {
    if (!api) return null;
    const duplicate = parameters.find((parameter, index) => parameters.findIndex((candidate) => candidate.name === parameter.name) !== index);
    if (duplicate) { setError(`条件セルのSQL名「${duplicate.name}」が重複しています。別の名前に変更してください。`); return null; }
    const currentResults: Record<string, AnalysisQueryResult> = { ...initialResults };
    let nextExecutionHistory: Record<string, AnalysisCellExecution[]> = { ...executionHistoryRef.current };
    const executing = new Set<string>();
    setError('');
    const execute = async (targetId: string): Promise<AnalysisQueryResult> => {
      const target = cells.find((item) => item.id === targetId);
      if (!target || (target.type !== 'sql' && target.type !== 'dataframe' && target.type !== 'function' && target.type !== 'pivot' && target.type !== 'summary' && target.type !== 'quality' && target.type !== 'preprocess' && target.type !== 'import' && target.type !== 'chart')) throw new Error('実行対象の分析セルが見つかりません。');
      if (executing.has(targetId)) throw new Error('セルの依存関係が循環しています。上側セルだけを参照するように修正してください。');
      executing.add(targetId);
      try {
        for (const dependencyId of Array.from(new Set(resultDependencies(target)))) {
          if (refreshDependencies || !currentResults[dependencyId]) await execute(dependencyId);
        }
        setRunningCellId(targetId);
        const next = target.type === 'sql'
          ? await api.runAnalysisSql(target.sql, parameters, namedResultsBefore(target.id, currentResults))
          : target.type === 'dataframe' ? transformResult(await hydrateResult(currentResults[target.transform.sourceCellId]), target.transform)
          : target.type === 'function' ? functionResult(await hydrateResult(currentResults[target.transform.sourceCellId]), target.transform, target.transform.joinSourceCellId ? await hydrateResult(currentResults[target.transform.joinSourceCellId]) : undefined)
          : target.type === 'import' ? importResult(target.imported)
          : target.type === 'pivot' ? pivotResult(await hydrateResult(currentResults[target.pivot.sourceCellId]), target.pivot)
          : target.type === 'summary' ? summaryResult(await hydrateResult(currentResults[target.summary.sourceCellId]), target.summary)
          : target.type === 'quality' ? qualityResult(await hydrateResult(currentResults[target.quality.sourceCellId]), target.quality)
          : target.type === 'preprocess' ? preprocessResult(await hydrateResult(currentResults[target.preprocess.sourceCellId]), target.preprocess)
          : currentResults[target.sourceCellId];
        currentResults[target.id] = next;
        const dependencySignatures = Object.fromEntries(Array.from(new Set(resultDependencies(target))).map((dependencyId) => [dependencyId, latestExecution(dependencyId, nextExecutionHistory)?.cellSignature || '']));
        const record: AnalysisCellExecution = { executedAt: next.executedAt, elapsedMs: next.elapsedMs, rowCount: next.rowCount, truncated: next.truncated, cellSignature: cellSignature(target), parameterSignature: parameterSignature(), dependencySignatures, sourceSyncedAt: status?.lastSyncedAt || null };
        nextExecutionHistory = { ...nextExecutionHistory, [target.id]: [record, ...(nextExecutionHistory[target.id] || [])].slice(0, 12) };
        executionHistoryRef.current = nextExecutionHistory;
        if (commitRender) {
          setResults((previous) => ({ ...previous, [target.id]: next }));
          setNotebook((current) => ({ ...current, executionHistory: nextExecutionHistory }));
        }
        return next;
      } finally {
        executing.delete(targetId);
      }
    };
    try {
      const result = await execute(cell.id);
      if (api && persistNotebook) {
        void api.saveAnalysisNotebook({ ...notebook, cells, executionHistory: nextExecutionHistory }).then((saved) => {
          setNotebook((current) => current.id === saved.id ? { ...current, createdAt: saved.createdAt, updatedAt: saved.updatedAt, executionHistory: saved.executionHistory } : current);
        }).catch(() => undefined);
      }
      if (commitRender) setExpandedResultCellId(cell.id);
      onStatus(`分析セルを実行しました（${result.rowCount}行）`);
      return result;
    } catch (e: any) {
      setError(e?.message || '分析セルの実行に失敗しました');
      return null;
    } finally {
      setRunningCellId('');
    }
  };
  const runAll = async () => {
    let currentResults: Record<string, AnalysisQueryResult> = {};
    setResults({});
    for (const cell of cells) {
      if (cell.type !== 'sql' && cell.type !== 'dataframe' && cell.type !== 'function' && cell.type !== 'pivot' && cell.type !== 'summary' && cell.type !== 'quality' && cell.type !== 'preprocess' && cell.type !== 'import' && cell.type !== 'chart') continue;
      const result = await runCell(cell, currentResults, false, false, false);
      if (!result) return;
      currentResults = { ...currentResults, [cell.id]: result };
    }
    setResults(currentResults);
    setNotebook((current) => ({ ...current, executionHistory: executionHistoryRef.current }));
    if (api) void api.saveAnalysisNotebook({ ...notebook, cells, executionHistory: executionHistoryRef.current }).catch(() => undefined);
    onStatus('実行可能な分析セルを上から順に実行しました');
  };
  const isExecutable = (cell: AnalysisCell): cell is SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell | ChartCell => ['sql', 'dataframe', 'function', 'pivot', 'summary', 'quality', 'preprocess', 'import', 'chart'].includes(cell.type);
  const runRange = async (from: number, to: number) => {
    let currentResults: Record<string, AnalysisQueryResult> = { ...results };
    for (let index = Math.max(0, from); index <= Math.min(cells.length - 1, to); index += 1) {
      const cell = cells[index];
      if (!isExecutable(cell)) continue;
      const result = await runCell(cell, currentResults, false, false, false);
      if (!result) return;
      currentResults = { ...currentResults, [cell.id]: result };
    }
    setResults(currentResults);
    setNotebook((current) => ({ ...current, executionHistory: executionHistoryRef.current }));
    if (api) void api.saveAnalysisNotebook({ ...notebook, cells, executionHistory: executionHistoryRef.current }).catch(() => undefined);
  };
  const runStale = async () => {
    let currentResults: Record<string, AnalysisQueryResult> = { ...results };
    for (const cell of cells) {
      if (!isExecutable(cell) || freshnessFor(cell).state === 'fresh') continue;
      const result = await runCell(cell, currentResults, false, false, false);
      if (!result) return;
      currentResults = { ...currentResults, [cell.id]: result };
    }
    setResults(currentResults);
    setNotebook((current) => ({ ...current, executionHistory: executionHistoryRef.current }));
    if (api) void api.saveAnalysisNotebook({ ...notebook, cells, executionHistory: executionHistoryRef.current }).catch(() => undefined);
    onStatus('再実行が必要なセルを実行しました');
  };
  const captureSnapshot = (cellId: string) => {
    const result = results[cellId];
    if (!result) { setError('先にセルを実行してからスナップショットを作成してください。'); return; }
    const snapshot: AnalysisCellSnapshot = { id: nanoid(10), createdAt: new Date().toISOString(), label: `実行結果 ${new Date().toLocaleString('ja-JP')}`, rowCount: result.rowCount, columns: result.columns, rows: result.rows.slice(0, 1000), truncated: result.truncated || result.rows.length > 1000, execution: latestExecution(cellId) };
    setNotebook((current) => ({ ...current, snapshots: { ...(current.snapshots || {}), [cellId]: [snapshot, ...((current.snapshots || {})[cellId] || [])].slice(0, 8) } }));
    onStatus('このセルのローカルスナップショットを保存しました');
  };
  const pinCellToDashboard = async (cell: SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell | ChartCell) => {
    if (!api) return;
    const result = results[cell.id];
    if (!result) { setError('ダッシュボードへ固定する前に、このセルを実行してください。'); return; }
    const id = `${notebook.id}:${cell.id}`;
    const pin: AnalysisDashboardPin = {
      id,
      notebookId: notebook.id,
      notebookTitle: notebook.title || '無題の分析',
      cellId: cell.id,
      cellTitle: cellTitle(cell),
      chart: cell.chart,
      columns: result.columns,
      rows: result.rows.slice(0, 300),
      rowCount: result.rowCount,
      truncated: result.truncated || result.rows.length > 300,
      capturedAt: new Date().toISOString(),
      sourceSyncedAt: status?.lastSyncedAt || null,
    };
    try {
      const saved = await api.saveAnalysisDashboardPin(pin);
      setDashboardPins((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      onStatus(`「${cellTitle(cell)}」をKPIダッシュボードへ固定しました`);
    } catch (e: any) { setError(e?.message || 'ダッシュボードへの固定に失敗しました'); }
  };
  const unpinDashboard = async (id: string) => {
    if (!api) return;
    try { await api.deleteAnalysisDashboardPin(id); setDashboardPins((current) => current.filter((item) => item.id !== id)); onStatus('ダッシュボードから削除しました'); }
    catch (e: any) { setError(e?.message || 'ダッシュボードから削除できませんでした'); }
  };
  const openDashboardPin = (pin: AnalysisDashboardPin) => {
    const target = notebooks.find((item) => item.id === pin.notebookId);
    if (target) { setNotebook(target); setResults({}); setSelectedCellId(pin.cellId); setSidebarTab('notebooks'); window.setTimeout(() => document.getElementById(`analysis-cell-${pin.cellId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }
    else setError('この固定元の分析ノートは削除されています。');
  };

  const save = async () => { if (!api) return; setBusy(true); setError(''); try { const saved = await api.saveAnalysisNotebook({ ...notebook, cells }); setNotebook(saved); await refresh(); onStatus('分析ノート、条件、グラフ、実行履歴を保存しました'); } catch (e: any) { setError(e?.message || '保存に失敗しました'); } finally { setBusy(false); } };
  const create = () => { setNotebook({ id: nanoid(12), title: '無題の分析', description: '', sql: STARTER_SQL, chart: { type: 'bar' }, cells: [newSectionCell(), newSqlCell()], createdAt: '', updatedAt: '' }); setResults({}); setError(''); };
  const deleteNotebook = async (target: AnalysisNotebook) => {
    if (!api) return;
    const name = target.title?.trim() || '無題の分析';
    if (!window.confirm(`保存済み分析「${name}」を削除します。\nこの操作は取り消せません。`)) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAnalysisNotebook(target.id);
      const remaining = notebooks.filter((item) => item.id !== target.id);
      setNotebooks(remaining);
      if (notebook.id === target.id) {
        const replacement = remaining[0];
        if (replacement) setNotebook(replacement);
        else create();
        setResults({});
      }
      onStatus(`保存済み分析「${name}」を削除しました`);
    } catch (e: any) {
      setError(e?.message || '保存済み分析を削除できませんでした。');
    } finally {
      setBusy(false);
    }
  };
  const applyTemplate = (template: typeof ANALYSIS_TEMPLATES[number]) => { const built = template.build(); setNotebook({ id: nanoid(12), title: built.title, description: built.description, sql: built.sql, chart: built.chart, cells: built.cells, createdAt: '', updatedAt: '' }); setResults({}); setError(''); setSidebarTab('notebooks'); onStatus(`分析テンプレート「${template.title}」を作成しました`); };
  const createFromWizard = (draft: AnalysisWizardDraft) => { try { const built = buildWizardNotebook(draft, dictionary); setNotebook({ id: nanoid(12), title: built.title, description: built.description, sql: built.sql, chart: built.chart, cells: built.cells, createdAt: '', updatedAt: '' }); setResults({}); setError(''); setSidebarTab('notebooks'); setWizardOpen(false); onStatus('分析ウィザードから新しいノートを作成しました'); } catch (e: any) { setError(e?.message || '分析ノートを作成できませんでした'); } };
  const copyDictionaryValue = async (value: string) => { try { await navigator.clipboard?.writeText(value); onStatus(`「${value}」をコピーしました`); } catch { setError('クリップボードへコピーできませんでした。'); } };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const key = event.key.toLowerCase();
      const primary = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape') { if (guideOpen) { event.preventDefault(); setGuideOpen(false); return; } if (shortcutHelpOpen) { event.preventDefault(); setShortcutHelpOpen(false); } return; }
      if (event.key === 'F1') { event.preventDefault(); setGuideOpen(true); return; }
      if (primary && key === '/') { event.preventDefault(); setShortcutHelpOpen((current) => !current); return; }
      if (primary && key === 's') { event.preventDefault(); if (!busy && !runningCellId) void save(); return; }
      if (primary && event.shiftKey && key === 'n') { event.preventDefault(); const next = newSqlCell(); setCells([...cells, next]); setSelectedCellId(next.id); onStatus('SQLセルを追加しました'); return; }
      if (primary && event.shiftKey && event.key === 'Enter') { event.preventDefault(); if (!runningCellId) void runAll(); return; }
      if ((event.shiftKey && event.key === 'Enter') || (primary && event.key === 'Enter')) {
        const selected = cells.find((cell) => cell.id === selectedCellId) || cells[0];
        if (selected && isExecutable(selected) && !runningCellId) { event.preventDefault(); void runCell(selected); }
        return;
      }
      // Keep all remaining typing shortcuts native to text inputs and selects.
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api, busy, cells, executionHistory, guideOpen, notebook, onStatus, parameters, results, runningCellId, selectedCellId, shortcutHelpOpen, status]);

  const selectedIndex = Math.max(0, cells.findIndex((cell) => cell.id === selectedCellId));
  const sections = cells.flatMap((cell, index) => cell.type === 'section' ? [{ id: cell.id, title: cell.title || 'セクション', index }] : []);
  let hiddenAfterSection = false;
  const renderedCells = cells.map((cell, index) => {
    if (cell.type === 'section') { hiddenAfterSection = Boolean(cell.collapsed); return { cell, index, hidden: false }; }
    return { cell, index, hidden: hiddenAfterSection };
  });
  const cellTitle = (cell: AnalysisCell) => cell.type === 'sql' ? 'SQLセル' : cell.type === 'dataframe' ? 'DataFrameセル' : cell.type === 'function' ? '分析関数セル' : cell.type === 'pivot' ? 'ピボットセル' : cell.type === 'summary' ? '統計・要約セル' : cell.type === 'quality' ? '品質チェックセル' : cell.type === 'preprocess' ? '前処理セル' : cell.type === 'import' ? '取込セル' : cell.type === 'chart' ? 'グラフセル' : cell.type === 'section' ? 'セクション' : cell.type === 'variable' ? '変数セル' : cell.type === 'parameter' ? '条件セル' : 'メモセル';
  const applyAiDraft = (draft: AnalysisAiDraft) => {
    const section = { ...newSectionCell(), title: draft.title, description: draft.description };
    const note = newMarkdownCell(`## AIが提案した分析

${draft.explanation}${draft.warnings.length ? `

### 実行前の確認
${draft.warnings.map((warning) => `- ${warning}`).join('\n')}` : ''}`);
    const sql = newSqlCell(draft.sql, draft.chart);
    setNotebook((current) => ({ ...current, title: current.title === '無題の分析' ? draft.title : current.title, description: current.description || draft.description, cells: [...notebookCells(current), section, note, sql] }));
    setAiComposerOpen(false);
    setSelectedCellId(sql.id);
    onStatus('AIが提案したSQLとグラフ設定をノートへ追加しました。内容を確認してから実行してください。');
  };

  const resultPanel = (cell: SqlCell | DataFrameCell | FunctionCell | PivotCell | SummaryCell | QualityCell | PreprocessCell | ImportCell) => {
    const result = results[cell.id];
    if (!result) return <div className="analysis-empty-result">このセルを実行すると、結果をここに表示します。</div>;
    const expanded = expandedResultCellId === cell.id || selectedCellId === cell.id;
    if (!expanded) return <div className="analysis-result-collapsed"><span>結果 {result.rowCount.toLocaleString()}行 ・ {result.elapsedMs.toLocaleString()}ms</span><button className="secondary" type="button" onClick={() => { setSelectedCellId(cell.id); setExpandedResultCellId(cell.id); }}>結果を表示</button></div>;
    return <ResultPanel title={notebook.title} result={result} cell={{ id: cell.id, type: 'sql', sql: '', chart: cell.chart }} api={api} onChartChange={(chart) => updateCell(cell.id, (current) => ({ ...(current as typeof cell), chart } as AnalysisCell))} onOpenOrigin={openOrigin} />;
  };

  return <section className={`analysis-notebook-screen ${presentationMode ? 'analysis-presentation-mode' : ''}`}>
    <header className="analysis-notebook-header"><div className="analysis-header-copy"><span className="analysis-eyebrow">ANALYSIS NOTEBOOK</span><h1>{notebook.title || '分析ノートブック'}</h1><p>データを取得し、整え、可視化し、考察までを一つのノートに残します。</p></div><div className="analysis-header-actions"><button className="secondary analysis-presentation-toggle" onClick={() => setPresentationMode(!presentationMode)}>{presentationMode ? '編集に戻る' : '発表モード'}</button>{!presentationMode && <><button type="button" className="secondary analysis-guide-button" onClick={() => setGuideOpen(true)} title="はじめての方へ（F1）">? 使い方</button><button type="button" className="secondary analysis-shortcut-button" onClick={() => setShortcutHelpOpen(true)} title="ショートカットキー（⌘ / Ctrl + /）">⌨ ショートカット</button><button className="analysis-wizard-launch" onClick={() => setWizardOpen(true)}>✦ 分析をはじめる</button><button className="secondary analysis-ai-launch" type="button" onClick={() => setAiComposerOpen(true)}>✦ AIで作る</button><button className="secondary" disabled={busy || !api} onClick={() => void sync()}>{busy ? '同期中…' : '↻ 同期'}</button><button className="primary analysis-run-all" disabled={!!runningCellId} onClick={() => void runAll()}>{runningCellId ? '実行中…' : '▶ すべて実行'}</button><button className="secondary" disabled={busy || !api} onClick={() => void save()}>保存</button><details className="analysis-actions-menu"><summary aria-label="その他の操作">•••</summary><div><button className="secondary" onClick={onBack}>← 一覧へ戻る</button><button className="secondary" disabled={!!runningCellId} onClick={() => void runRange(0, selectedIndex)}>このセルまで実行</button><button className="secondary" disabled={!!runningCellId} onClick={() => void runRange(selectedIndex, cells.length - 1)}>このセル以降を実行</button><button className="secondary" disabled={!!runningCellId} onClick={() => void runStale()}>古いセルだけ実行</button>{notebooks.some((item) => item.id === notebook.id) && <button className="secondary danger" disabled={busy || !!runningCellId} onClick={() => void deleteNotebook(notebook)}>この保存済み分析を削除</button>}</div></details></>}</div></header>
    <div className="analysis-status-strip">{status?.available ? <><b>DuckDB 接続済み</b><span>{status.lastSyncedAt ? `最終同期 ${new Date(status.lastSyncedAt).toLocaleString('ja-JP')}` : 'まだ同期されていません'}{status.limits ? ` ・ 同期上限 ${status.limits.syncRows.toLocaleString()}件 ・ 画面表示 ${status.limits.previewRows.toLocaleString()}行` : ''}</span><details className="analysis-storage-details"><summary>保存先を確認</summary><p><b>SQLite</b><code>{status.sqlitePath || '確認中'}</code></p><p><b>DuckDB</b><code>{status.databasePath || '確認中'}</code></p><p>{status.databaseFile?.exists ? `ファイル確認済み：${(status.databaseFile.bytes || 0).toLocaleString()} bytes${status.databaseFile.modifiedAt ? ` ・ 更新 ${new Date(status.databaseFile.modifiedAt).toLocaleString('ja-JP')}` : ''}` : '接続はありますが、DuckDBファイルを確認できません。同期をやり直し、診断ログを確認してください。'}</p></details></> : <><b>DuckDB 未起動</b><span>「データを同期」で分析用のローカルキャッシュを作成します。</span>{status?.databasePath && <details className="analysis-storage-details"><summary>作成予定の保存先を確認</summary><p><b>SQLite</b><code>{status.sqlitePath || '確認中'}</code></p><p><b>DuckDB</b><code>{status.databasePath}</code></p></details>}</>}</div>
    {error && <div className="analysis-error">{error}</div>}
    {aiComposerOpen && <AnalysisAiComposer api={api} onClose={() => setAiComposerOpen(false)} onApply={applyAiDraft} />}
    <div className="analysis-layout"><aside className="analysis-sidebar"><div className="analysis-sidebar-tabs"><button className={sidebarTab === 'notebooks' ? 'active' : ''} onClick={() => setSidebarTab('notebooks')}>ノート</button><button className={sidebarTab === 'dashboard' ? 'active' : ''} onClick={() => setSidebarTab('dashboard')}>KPI</button><button className={sidebarTab === 'dictionary' ? 'active' : ''} onClick={() => setSidebarTab('dictionary')}>データ辞書</button><button className={sidebarTab === 'templates' ? 'active' : ''} onClick={() => setSidebarTab('templates')}>テンプレート</button><button className={sidebarTab === 'operations' ? 'active' : ''} onClick={() => setSidebarTab('operations')}>運用</button></div>
      {sidebarTab === 'notebooks' && <><div className="analysis-sidebar-head"><b>保存済み分析</b><button onClick={create} title="新規ノート">＋</button></div>{notebooks.length ? notebooks.map((item) => <div key={item.id} className={`analysis-notebook-item-wrap ${item.id === notebook.id ? 'active' : ''}`}><button className="analysis-notebook-item" onClick={() => { setNotebook(item); setResults({}); setError(''); }}><strong>{item.title}</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString('ja-JP') : '未保存'}</small></button><button type="button" className="analysis-notebook-delete" title={`「${item.title || '無題の分析'}」を削除`} aria-label={`「${item.title || '無題の分析'}」を削除`} disabled={busy || !!runningCellId} onClick={() => void deleteNotebook(item)}>×</button></div>) : <p className="analysis-empty-list">保存済みの分析はまだありません。</p>}<div className="analysis-datasets"><b>セクション</b>{sections.map((section) => <button type="button" key={section.id} onClick={() => document.getElementById(`analysis-cell-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{section.title}</button>)}</div></>}
      {sidebarTab === 'dashboard' && <AnalysisDashboardPanel pins={dashboardPins} onOpen={openDashboardPin} onDelete={(id) => void unpinDashboard(id)} />}
      {sidebarTab === 'dictionary' && <DictionaryPanel dictionary={dictionary} onCopy={(value) => void copyDictionaryValue(value)} />}
      {sidebarTab === 'templates' && <div className="analysis-template-list">{ANALYSIS_TEMPLATES.map((template) => <button type="button" key={template.id} onClick={() => applyTemplate(template)}><strong>{template.title}</strong><span>{template.description}</span><small>このテンプレートを開く →</small></button>)}</div>}
      {sidebarTab === 'operations' && <AnalysisOperationsPanel dictionary={dictionary} settings={workspaceSettings} notebook={notebook} cells={cells} results={results} selectedCellId={selectedCellId} status={status} onSettings={saveWorkspaceSettings} onStatus={onStatus} onImportTemplate={(draft) => { setNotebook({ id: nanoid(12), title: String(draft.title || '共有テンプレート'), description: String(draft.description || ''), sql: String(draft.sql || ''), chart: draft.chart || { type: 'table' }, cells: Array.isArray(draft.cells) ? draft.cells : [newSqlCell()], createdAt: '', updatedAt: '' }); setResults({}); setError(''); setSidebarTab('notebooks'); }} />}
    </aside><div className="analysis-editor"><input className="analysis-title" value={notebook.title} onChange={(e) => setNotebook({ ...notebook, title: e.target.value.slice(0, 120) })} placeholder="分析タイトル" /><textarea className="analysis-description" value={notebook.description} onChange={(e) => setNotebook({ ...notebook, description: e.target.value.slice(0, 1000) })} placeholder="分析の目的・前提・結論の要約" />
      <div className="analysis-add-cells"><div><b>セルを追加</b><span>分析の流れに必要なセルを選びます</span></div><button className="primary" onClick={() => setCells([...cells, newSqlCell()])}>＋ SQL</button><button className="secondary" onClick={() => setCells([...cells, newMarkdownCell()])}>＋ メモ</button><details className="analysis-add-menu"><summary>その他のセル</summary><div><button className="secondary" onClick={() => setCells([...cells, newImportCell()])}>取込</button><button className="secondary" onClick={() => setCells([...cells, newDataFrameCell()])}>DataFrame</button><button className="secondary" onClick={() => setCells([...cells, newPreprocessCell()])}>前処理</button><button className="secondary" onClick={() => setCells([...cells, newFunctionCell()])}>分析関数</button><button className="secondary" onClick={() => setCells([...cells, newPivotCell()])}>ピボット</button><button className="secondary" onClick={() => setCells([...cells, newSummaryCell()])}>統計・要約</button><button className="secondary" onClick={() => setCells([...cells, newQualityCell()])}>品質確認</button><button className="secondary" onClick={() => setCells([...cells, newChartCell()])}>グラフ</button><button className="secondary" onClick={() => setCells([...cells, newVariableCell()])}>変数</button><button className="secondary" onClick={() => setCells([...cells, newParameterCell()])}>条件</button><button className="secondary" onClick={() => setCells([...cells, newSectionCell()])}>セクション</button></div></details></div>
      <div className="analysis-cells">{renderedCells.map(({ cell, index, hidden }) => <article id={`analysis-cell-${cell.id}`} key={cell.id} hidden={hidden} className={`analysis-cell analysis-cell-${cell.type} ${selectedCellId === cell.id ? 'selected' : ''}`} onClick={() => { setSelectedCellId(cell.id); if (isExecutable(cell)) setExpandedResultCellId(cell.id); }}><div className="analysis-cell-head"><div><b>{cellTitle(cell)}</b><span>{cell.type === 'section' ? (cell.description || '分析のまとまりを作成します。') : cell.type === 'function' ? 'pandas風の定型処理を安全に実行' : cell.type === 'preprocess' ? '元データを変更せず、分析用の表だけ整えます' : cell.type === 'import' ? '端末ローカルにだけ取り込む一時DataFrame' : cell.type === 'variable' ? `SQLでは {{${cell.variable.name}}}` : '分析セル'}</span></div>{!presentationMode && <div className="analysis-cell-actions"><button className="secondary" disabled={index === 0} onClick={() => moveCell(index, -1)}>↑</button><button className="secondary" disabled={index === cells.length - 1} onClick={() => moveCell(index, 1)}>↓</button><button className="secondary danger" onClick={() => removeCell(cell.id)}>削除</button>{isExecutable(cell) && <><button className="secondary" disabled={!results[cell.id]} onClick={() => captureSnapshot(cell.id)}>スナップショット</button><button className="secondary" disabled={!results[cell.id] || !api} onClick={() => void pinCellToDashboard(cell)}>ダッシュボードに固定</button><button className="primary" disabled={!!runningCellId || !api} onClick={() => void runCell(cell)}>{runningCellId === cell.id ? '実行中…' : '▶ 実行'}</button></>}</div>}</div>
        {isExecutable(cell) && <ExecutionBadge record={latestExecution(cell.id)} history={executionHistory[cell.id]} freshness={freshnessFor(cell)} />}
        {isExecutable(cell) && (notebook.snapshots?.[cell.id] || []).length > 0 && <div className="analysis-parameter-help">スナップショット {(notebook.snapshots?.[cell.id] || []).length}件：{(notebook.snapshots?.[cell.id] || [])[0].rowCount.toLocaleString()}行（{new Date((notebook.snapshots?.[cell.id] || [])[0].createdAt).toLocaleString('ja-JP')}）</div>}
        {cell.type === 'section' ? <div className="analysis-parameter-grid"><label>見出し<input value={cell.title} onChange={(e) => updateCell(cell.id, (current) => ({ ...(current as SectionCell), title: e.target.value.slice(0, 160) }))} /></label><label>説明<input value={cell.description || ''} onChange={(e) => updateCell(cell.id, (current) => ({ ...(current as SectionCell), description: e.target.value.slice(0, 500) }))} /></label><label><input type="checkbox" checked={cell.collapsed === true} onChange={(e) => updateCell(cell.id, (current) => ({ ...(current as SectionCell), collapsed: e.target.checked }))} />このセクションを折りたたむ</label></div>
        : cell.type === 'sql' ? <><div className="analysis-sql-output"><label>出力名（任意）<input value={cell.outputName || ''} onChange={(e) => updateCell(cell.id, (current) => ({ ...(current as SqlCell), outputName: resultName(e.target.value, '') }))} /><small>次のSQLでは <code>{cell.outputName ? `result_${cell.outputName}` : '出力名を設定すると参照できます'}</code></small></label></div><SqlEditor value={cell.sql} dictionary={dictionary} onChange={(sql) => updateCell(cell.id, (current) => ({ ...(current as SqlCell), sql }))} />{resultPanel(cell)}</>
        : cell.type === 'dataframe' ? <><DataFrameEditor cell={cell} upstream={upstreamResults(index)} onChange={(transform) => updateCell(cell.id, (current) => ({ ...(current as DataFrameCell), transform }))} />{resultPanel(cell)}</>
        : cell.type === 'function' ? <><FunctionEditor cell={cell} upstream={upstreamResults(index)} onChange={(transform) => updateCell(cell.id, (current) => ({ ...(current as FunctionCell), transform }))} />{resultPanel(cell)}</>
        : cell.type === 'import' ? <><ImportEditor cell={cell} onChange={(imported) => updateCell(cell.id, (current) => ({ ...(current as ImportCell), imported }))} />{resultPanel(cell)}</>
        : cell.type === 'pivot' ? <><PivotEditor cell={cell} upstream={upstreamResults(index)} onChange={(pivot) => updateCell(cell.id, (current) => ({ ...(current as PivotCell), pivot }))} />{resultPanel(cell)}</>
        : cell.type === 'summary' ? <><SummaryEditor cell={cell} upstream={upstreamResults(index)} onChange={(summary) => updateCell(cell.id, (current) => ({ ...(current as SummaryCell), summary }))} />{resultPanel(cell)}</>
        : cell.type === 'quality' ? <><QualityEditor cell={cell} upstream={upstreamResults(index)} onChange={(quality) => updateCell(cell.id, (current) => ({ ...(current as QualityCell), quality }))} />{resultPanel(cell)}</>
        : cell.type === 'preprocess' ? <><PreprocessEditor cell={cell} upstream={upstreamResults(index)} onChange={(preprocess) => updateCell(cell.id, (current) => ({ ...(current as PreprocessCell), preprocess }))} />{resultPanel(cell)}</>
        : cell.type === 'chart' ? <><ChartEditor cell={cell} upstream={upstreamResults(index)} result={results[cell.sourceCellId]} onChange={(patch) => updateCell(cell.id, (current) => ({ ...(current as ChartCell), ...patch }))} />{results[cell.id] ? ((expandedResultCellId === cell.id || selectedCellId === cell.id) ? <><PlotView result={results[cell.id]} chart={cell.chart} /><ResultTable result={results[cell.id]} api={api} onOpenOrigin={openOrigin} /></> : <div className="analysis-result-collapsed"><span>グラフ結果 {results[cell.id].rowCount.toLocaleString()}行 ・ {results[cell.id].elapsedMs.toLocaleString()}ms</span><button className="secondary" type="button" onClick={() => { setSelectedCellId(cell.id); setExpandedResultCellId(cell.id); }}>結果を表示</button></div>) : <div className="analysis-empty-result">入力結果を選択して実行すると、独立したグラフを表示します。</div>}</>
        : cell.type === 'parameter' ? <ParameterEditor cell={cell} onChange={(parameter) => updateCell(cell.id, (current) => ({ ...(current as ParameterCell), parameter }))} />
        : cell.type === 'variable' ? <ParameterEditor cell={{ id: cell.id, type: 'parameter', parameter: cell.variable }} onChange={(variable) => updateCell(cell.id, (current) => ({ ...(current as VariableCell), variable }))} />
        : <div className="analysis-markdown-cell"><textarea value={cell.content} onChange={(e) => updateCell(cell.id, (current) => ({ ...(current as Extract<AnalysisCell, { type: 'markdown' }>), content: e.target.value.slice(0, 12000) }))} placeholder="分析メモ" /><div className="analysis-markdown-preview"><span>プレビュー</span><div>{cell.content || 'メモを入力するとここに表示されます。'}</div></div></div>}
      </article>)}</div></div></div>
    {guideOpen && <AnalysisGuide onClose={() => setGuideOpen(false)} onOpenWizard={() => setWizardOpen(true)} />}
    {shortcutHelpOpen && <ShortcutHelp onClose={() => setShortcutHelpOpen(false)} />}
    {wizardOpen && <AnalysisWizard dictionary={dictionary} onClose={() => setWizardOpen(false)} onCreate={createFromWizard} />}
  </section>;
}
