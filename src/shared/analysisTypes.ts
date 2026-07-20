export type AnalysisChart = {
  type: 'table' | 'bar' | 'line' | 'dot' | 'area' | 'histogram' | 'box' | 'heatmap';
  x?: string;
  y?: string;
  color?: string;
};

export type AnalysisParameterType = 'text' | 'number' | 'date' | 'select';

/** A safe, notebook-scoped scalar. Both parameter and variable cells use this shape. */
export type AnalysisParameter = {
  name: string;
  label: string;
  type: AnalysisParameterType;
  value: string;
  options?: string[];
};

export type AnalysisPivotAggregation = 'count' | 'sum' | 'average';

export type AnalysisPivotTransform = {
  sourceCellId: string;
  rowColumn: string;
  columnColumn?: string;
  valueColumn?: string;
  aggregation: AnalysisPivotAggregation;
  outputName: string;
};

export type AnalysisDataFrameTransform = {
  sourceCellId: string;
  outputName: string;
  operation: 'filter' | 'select' | 'sort' | 'limit';
  column?: string;
  operator?: 'equals' | 'contains' | 'notEmpty' | 'greaterThan' | 'lessThan';
  value?: string;
  columns?: string[];
  direction?: 'asc' | 'desc';
  limit?: number;
};

/** Curated, pandas-like transformations. No arbitrary JavaScript is run. */
export type AnalysisFunctionTransform = {
  sourceCellId: string;
  outputName: string;
  /** Curated operations that approximate common pandas workflows without arbitrary code execution. */
  operation: 'yearOverYear' | 'movingAverage' | 'cumulative' | 'shareOfTotal' | 'rank' | 'fillMissing' | 'excludeOutliers'
    | 'join' | 'unpivot' | 'splitText' | 'dateDiff' | 'conditionalColumn' | 'formula' | 'dropDuplicates' | 'renameColumn' | 'correlation' | 'linearRegression' | 'tTest' | 'chiSquare' | 'anova';
  valueColumn?: string;
  periodColumn?: string;
  groupColumn?: string;
  outputColumn?: string;
  windowSize?: number;
  /** Second upstream result for join operations. */
  joinSourceCellId?: string;
  joinLeftColumn?: string;
  joinRightColumn?: string;
  joinType?: 'left' | 'inner';
  /** Columns to convert from wide to long form. */
  valueColumns?: string[];
  /** Text split settings. */
  delimiter?: string;
  splitIndex?: number;
  /** Date difference and correlation/regression use this as their second input column. */
  secondColumn?: string;
  /** Conditional derived-column settings. */
  conditionOperator?: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'notEmpty';
  conditionValue?: string;
  trueValue?: string;
  falseValue?: string;
  /** Safe formula presets. No arbitrary JavaScript is evaluated. */
  formulaKind?: 'arithmetic' | 'round' | 'absolute' | 'year' | 'month' | 'coalesce' | 'dateDiff' | 'ifGreater';
  formulaOperator?: 'add' | 'subtract' | 'multiply' | 'divide';
  formulaValue?: string;
  /** Used by the rename-column function. */
  renameTo?: string;
};

/** Imported data stays in local.sqlite through the notebook JSON only. */
export type AnalysisImportTransform = {
  sourceName: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  truncated?: boolean;
  outputName: string;
  importedAt?: string;
};

export type AnalysisSummaryTransform = {
  sourceCellId: string;
  outputName: string;
  numericColumn?: string;
  groupColumn?: string;
};

export type AnalysisQualityTransform = {
  sourceCellId: string;
  outputName: string;
  columns?: string[];
  checkMissing?: boolean;
  checkDuplicates?: boolean;
  checkNonNumeric?: boolean;
};

/** Local-only, non-destructive data preparation for notebook analysis. */
export type AnalysisPreprocessTransform = {
  sourceCellId: string;
  outputName: string;
  operation: 'removeDuplicates' | 'handleMissing' | 'trimText' | 'normalizeText' | 'coerceNumber' | 'coerceDate' | 'replaceValues' | 'excludeOutliers';
  columns?: string[];
  column?: string;
  /** Missing-value handling. */
  missingStrategy?: 'dropRows' | 'custom' | 'zero' | 'mean' | 'median' | 'forwardFill';
  fillValue?: string;
  /** Invalid type conversion rows are either retained as null or excluded from the analysis result. */
  invalidAction?: 'null' | 'dropRows';
  /** Find/replace values. */
  findValue?: string;
  replaceValue?: string;
  /** Outlier handling. */
  outlierMethod?: 'iqr' | 'threeSigma';
};

export type AnalysisNamedResult = {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** Server-side ephemeral result cache. Keeps 100k-row SQL results out of the renderer until needed. */
  resultId?: string;
};

export type AnalysisCell =
  | { id: string; type: 'sql'; sql: string; chart: AnalysisChart; outputName?: string }
  | { id: string; type: 'dataframe'; transform: AnalysisDataFrameTransform; chart: AnalysisChart }
  | { id: string; type: 'function'; transform: AnalysisFunctionTransform; chart: AnalysisChart }
  | { id: string; type: 'pivot'; pivot: AnalysisPivotTransform; chart: AnalysisChart }
  | { id: string; type: 'summary'; summary: AnalysisSummaryTransform; chart: AnalysisChart }
  | { id: string; type: 'quality'; quality: AnalysisQualityTransform; chart: AnalysisChart }
  | { id: string; type: 'preprocess'; preprocess: AnalysisPreprocessTransform; chart: AnalysisChart }
  | { id: string; type: 'import'; imported: AnalysisImportTransform; chart: AnalysisChart }
  | { id: string; type: 'chart'; sourceCellId: string; chart: AnalysisChart }
  | { id: string; type: 'markdown'; content: string }
  | { id: string; type: 'section'; title: string; description?: string; collapsed?: boolean }
  | { id: string; type: 'parameter'; parameter: AnalysisParameter }
  | { id: string; type: 'variable'; variable: AnalysisParameter };

export type AnalysisCellExecution = {
  executedAt: string;
  elapsedMs: number;
  rowCount: number;
  truncated: boolean;
  cellSignature: string;
  parameterSignature: string;
  dependencySignatures: Record<string, string>;
  sourceSyncedAt?: string | null;
};

export type AnalysisCellSnapshot = {
  id: string;
  createdAt: string;
  label: string;
  rowCount: number;
  columns: string[];
  /** Small local-only sample for comparison and reproducibility. */
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  execution?: AnalysisCellExecution;
};

export type AnalysisNotebook = {
  id: string;
  title: string;
  description: string;
  /** Legacy fields are retained for opening notebooks saved before v575. */
  sql: string;
  chart: AnalysisChart;
  cells?: AnalysisCell[];
  executionHistory?: Record<string, AnalysisCellExecution[]>;
  /** Per-cell local snapshots. Never written to shared workspace data. */
  snapshots?: Record<string, AnalysisCellSnapshot[]>;
  createdAt: string;
  updatedAt: string;
};

/** Lightweight notebook metadata for sidebar and list views. Full cell, execution and snapshot JSON is loaded only when opening a notebook. */
export type AnalysisNotebookSummary = Pick<AnalysisNotebook, 'id' | 'title' | 'description' | 'createdAt' | 'updatedAt'>;

export type AnalysisQueryResult = {
  columns: string[];
  /** Current page / loaded rows. Full SQL results remain in the local analysis service until requested. */
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  executedAt: string;
  elapsedMs: number;
  resultId?: string;
  pageSize?: number;
  hasMore?: boolean;
};

export type AnalysisStatus = {
  available: boolean;
  engine: 'duckdb' | 'unavailable';
  databasePath: string | null;
  /** Actual local SQLite path used as the base for analysis.duckdb. */
  sqlitePath?: string | null;
  /** Filesystem state of analysis.duckdb, kept separate from the in-process connection state. */
  databaseFile?: { exists: boolean; bytes: number | null; modifiedAt: string | null };
  lastSyncedAt: string | null;
  datasets: Array<{ name: string; rows: number; description: string; sourceRows?: number; excludedRows?: number; }>;
  /** Sync and table-preview caps keep analysis responsive on ordinary office PCs. */
  limits?: { syncRows: number; previewRows: number; textChars?: number };
  /** Whether the latest manual/automatic sync rebuilt the cache or found no source changes. */
  lastSyncMode?: 'rebuilt' | 'incremental' | 'unchanged' | null;
  /** Current local analysis coverage. Rows excluded by the sync cap are never silently treated as analysed. */
  syncComplete?: boolean;
  syncProgress?: { phase: 'idle' | 'preparing' | 'syncing' | 'indexing' | 'complete' | 'failed'; dataset?: string; processedRows?: number; totalRows?: number; message?: string; startedAt?: string | null };
  message?: string;
};


export type AnalysisDashboardPin = {
  id: string;
  notebookId: string;
  notebookTitle: string;
  cellId: string;
  cellTitle: string;
  chart: AnalysisChart;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  capturedAt: string;
  sourceSyncedAt?: string | null;
};

export type AnalysisDataDictionaryColumn = { name: string; type: string; description: string; };
export type AnalysisDataDictionaryDataset = { name: string; description: string; columns: AnalysisDataDictionaryColumn[]; };
export type AnalysisDataDictionary = { datasets: AnalysisDataDictionaryDataset[]; };


/** Local-only governance for reproducible analysis. */
export type AnalysisMetricDefinition = {
  id: string;
  name: string;
  description: string;
  dataset: string;
  expression: string;
  format?: 'number' | 'percent' | 'currency';
  updatedAt: string;
};

export type AnalysisColumnMeaning = {
  dataset: string;
  column: string;
  label: string;
  description: string;
  role: 'dimension' | 'measure' | 'date' | 'identifier' | 'exclude';
  updatedAt: string;
};

export type AnalysisAutomationSettings = {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string | null;
  alertRules: Array<{ id: string; title: string; metricId?: string; operator: 'gt' | 'lt' | 'change'; threshold: number; enabled: boolean }>;
};

export type AnalysisWorkspaceSettings = {
  columnMeanings: AnalysisColumnMeaning[];
  metrics: AnalysisMetricDefinition[];
  automation: AnalysisAutomationSettings;
  updatedAt: string;
};

export type AnalysisProfileColumn = {
  column: string;
  inferredType: 'number' | 'date' | 'text' | 'mixed' | 'empty';
  nonNullCount: number;
  nullCount: number;
  uniqueCount: number;
  min?: number | string | null;
  max?: number | string | null;
  mean?: number | null;
  topValues: Array<{ value: string; count: number }>;
};

export type AnalysisProfile = { rowCount: number; columns: AnalysisProfileColumn[]; createdAt: string; };

/** A local-AI proposal. It is never executed or applied until the user confirms it in the notebook. */
export type AnalysisAiDraft = {
  title: string;
  description: string;
  sql: string;
  chart: AnalysisChart;
  explanation: string;
  warnings: string[];
  /** Server-side dry-run validation. The SQL is still not saved or executed as a notebook cell until confirmed. */
  validation?: { columns: string[]; checkedAt: string };
};

