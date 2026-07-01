import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export type SmartFaqSearchRecord = {
  id: string;
  question?: string;
  answer?: string;
  category?: string;
  tags?: string[];
  status?: string;
  sourceType?: string;
  sourceTitles?: string[];
  sourceTitle?: string;
  sourcePdfName?: string;
  sourcePage?: string | number;
  sourceText?: string;
  intent?: string | string[];
  intentId?: string;
  intentIds?: string[];
  intentLabel?: string;
  domain?: string;
  domainId?: string;
  confidence?: number;
  updatedAt?: string;
  [key: string]: unknown;
};

export function normalizeJapaneseText(input: unknown): string {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ん]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/[\u3000\t\r\n]+/g, ' ')
    .replace(/[。、，,.・:：;；!！?？「」『』【】\[\]()（）{}<>＜＞/\\|＿_~〜ー－―]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const require = createRequire(import.meta.url);

export const DEFAULT_TRANSFORMER_EMBEDDING_MODEL = 'sirasagi62/ruri-v3-70m-ONNX';
export const TRANSFORMER_SEMANTIC_INDEX_VERSION = 243;
export const TRANSFORMER_SEMANTIC_ENGINE = 'transformer-first-external-ruri-v243';

type FeatureExtractorLike = (text: string, options?: any) => Promise<any>;

type EmbeddingState = {
  model: string;
  extractor: FeatureExtractorLike | null;
  available: boolean;
  loading?: Promise<EmbeddingState>;
  error?: string;
};

let embeddingState: EmbeddingState | null = null;


type TransformerRuntimePaths = {
  packaged: boolean;
  source: 'settings' | 'env' | 'packaged' | 'development' | 'fallback';
  resourcesPath: string;
  modelBasePath: string;
  expectedModelPath: string;
  expectedOnnxPath: string;
  onnxFileName: 'model_quantized.onnx' | 'model.onnx';
  hasQuantizedModel: boolean;
  wasmPath: string;
  cacheDir: string;
  modelExists: boolean;
  onnxExists: boolean;
  onnxSize: number;
  wasmExists: boolean;
};

type TransformerSettings = {
  modelId: string;
  modelRoot?: string;
  dtype?: 'q8';
};

function getResourcesPath(): string {
  const maybeResources = (process as any).resourcesPath;
  if (typeof maybeResources === 'string' && maybeResources.trim()) return maybeResources;
  return process.cwd();
}

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'resources'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function modelParts(model: string): string[] {
  return String(model || DEFAULT_TRANSFORMER_EMBEDDING_MODEL).split('/').filter(Boolean);
}

function modelDirAtBase(basePath: string, model: string): string {
  // The UI accepts either the model root (D:/Models) or the model folder itself
  // (D:/Models/sirasagi62/ruri-v3-70m-ONNX).
  if (fs.existsSync(path.join(basePath, 'config.json')) && fs.existsSync(path.join(basePath, 'onnx'))) {
    return basePath;
  }
  return path.join(basePath, ...modelParts(model));
}

function readTransformerSettings(): TransformerSettings {
  const envModelId = process.env.SMART_ASSIST_MODEL_ID?.trim();
  const envModelRoot = process.env.SMART_ASSIST_MODEL_ROOT?.trim();
  if (envModelId || envModelRoot) {
    return { modelId: envModelId || DEFAULT_TRANSFORMER_EMBEDDING_MODEL, modelRoot: envModelRoot, dtype: 'q8' };
  }
  const sharedRoot = process.env.SMART_ASSIST_SHARED_ROOT?.trim();
  if (sharedRoot) {
    const settingsPath = path.join(sharedRoot, 'smart-assist', 'transformer-settings.json');
    try {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      return {
        modelId: String(raw.modelId || DEFAULT_TRANSFORMER_EMBEDDING_MODEL),
        modelRoot: raw.modelRoot ? String(raw.modelRoot) : undefined,
        dtype: 'q8',
      };
    } catch {}
  }
  return { modelId: DEFAULT_TRANSFORMER_EMBEDDING_MODEL, dtype: 'q8' };
}

function resolveOnnxModelAtBase(basePath: string, model: string): {
  ok: boolean;
  modelDir: string;
  onnxPath: string;
  onnxFileName: 'model_quantized.onnx' | 'model.onnx';
  size: number;
  hasQuantizedModel: boolean;
} {
  const modelDir = modelDirAtBase(basePath, model);
  const quantizedPath = path.join(modelDir, 'onnx', 'model_quantized.onnx');
  const plainPath = path.join(modelDir, 'onnx', 'model.onnx');
  const quantizedSize = fs.existsSync(quantizedPath) ? fs.statSync(quantizedPath).size : 0;
  const plainSize = fs.existsSync(plainPath) ? fs.statSync(plainPath).size : 0;
  const hasQuantizedModel = quantizedSize > 10 * 1024 * 1024;
  const hasPlainModel = plainSize > 10 * 1024 * 1024;
  const onnxPath = hasQuantizedModel ? quantizedPath : plainPath;
  const size = hasQuantizedModel ? quantizedSize : plainSize;
  const ok =
    fs.existsSync(path.join(modelDir, 'config.json')) &&
    fs.existsSync(path.join(modelDir, 'tokenizer.json')) &&
    fs.existsSync(path.join(modelDir, 'tokenizer_config.json')) &&
    (hasQuantizedModel || hasPlainModel);
  return {
    ok,
    modelDir,
    onnxPath,
    onnxFileName: hasQuantizedModel ? 'model_quantized.onnx' : 'model.onnx',
    size,
    hasQuantizedModel,
  };
}

export function getActiveTransformerModelId(model?: string): string {
  return model || readTransformerSettings().modelId || DEFAULT_TRANSFORMER_EMBEDDING_MODEL;
}

export function getTransformerRuntimePaths(modelInput?: string): TransformerRuntimePaths {
  const settings = readTransformerSettings();
  const model = modelInput || settings.modelId || DEFAULT_TRANSFORMER_EMBEDDING_MODEL;
  const resourcesPath = getResourcesPath();
  const isPackaged = Boolean((process as any).resourcesPath && !String(process.cwd()).includes('node_modules/electron'));
  const candidates: Array<{ source: TransformerRuntimePaths['source']; base: string }> = [];
  if (settings.modelRoot) candidates.push({ source: process.env.SMART_ASSIST_MODEL_ROOT ? 'env' : 'settings', base: path.resolve(settings.modelRoot) });
  candidates.push({ source: 'packaged', base: path.join(resourcesPath, 'models') });
  candidates.push({ source: 'development', base: path.join(findProjectRoot(), 'resources', 'models') });

  let selected = candidates[0] || { source: 'fallback' as const, base: path.join(findProjectRoot(), 'resources', 'models') };
  let selectedCheck = resolveOnnxModelAtBase(selected.base, model);
  for (const candidate of candidates) {
    const check = resolveOnnxModelAtBase(candidate.base, model);
    if (check.ok) {
      selected = candidate;
      selectedCheck = check;
      break;
    }
  }

  const wasmBase = selected.source === 'packaged'
    ? resourcesPath
    : selected.source === 'development'
      ? path.join(findProjectRoot(), 'resources')
      : path.resolve(settings.modelRoot || path.join(resourcesPath, 'models'));
  const wasmPath = path.join(wasmBase, 'wasm');
  const fallbackWasmPath = path.join(resourcesPath, 'wasm');
  const actualWasmPath = fs.existsSync(wasmPath) ? wasmPath : fallbackWasmPath;
  const cacheDir = path.join(path.dirname(selected.base), 'transformers-cache');
  return {
    packaged: isPackaged,
    source: selected.source,
    resourcesPath,
    modelBasePath: selected.base,
    expectedModelPath: selectedCheck.modelDir,
    expectedOnnxPath: selectedCheck.onnxPath,
    onnxFileName: selectedCheck.onnxFileName,
    hasQuantizedModel: selectedCheck.hasQuantizedModel,
    wasmPath: actualWasmPath,
    cacheDir,
    modelExists: selectedCheck.ok,
    onnxExists: fs.existsSync(selectedCheck.onnxPath),
    onnxSize: selectedCheck.size,
    wasmExists: fs.existsSync(actualWasmPath) && fs.readdirSync(actualWasmPath).some((name) => name.endsWith('.wasm')),
  };
}

function configureTransformersEnv(mod: any, model = getActiveTransformerModelId()): TransformerRuntimePaths {
  const runtime = getTransformerRuntimePaths(model);
  const env = mod?.env;
  if (env) {
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = runtime.modelBasePath;
    env.cacheDir = runtime.cacheDir;
    try { fs.mkdirSync(runtime.cacheDir, { recursive: true }); } catch {}
    if (env.backends?.onnx?.wasm && runtime.wasmExists) {
      env.backends.onnx.wasm.wasmPaths = runtime.wasmPath + path.sep;
      env.backends.onnx.wasm.proxy = false;
    }
  }
  return runtime;
}

export function getTransformerRuntimeInfo(modelInput?: string) {
  const model = getActiveTransformerModelId(modelInput);
  const runtime = getTransformerRuntimePaths(model);
  return {
    ok: runtime.modelExists && runtime.wasmExists,
    mode: 'external-folder-transformers-ruri-v243',
    model,
    dtype: runtime.hasQuantizedModel ? 'q8' : 'fp32',
    onnxFileName: runtime.onnxFileName,
    modelSource: runtime.source,
    packaged: runtime.packaged,
    allowRemoteModels: false,
    allowLocalModels: true,
    cpuWasmOnly: true,
    modelBasePath: runtime.modelBasePath,
    expectedModelPath: runtime.expectedModelPath,
    expectedOnnxPath: runtime.expectedOnnxPath,
    wasmPath: runtime.wasmPath,
    cacheDir: runtime.cacheDir,
    modelExists: runtime.modelExists,
    onnxExists: runtime.onnxExists,
    onnxSize: runtime.onnxSize,
    onnxSizeMb: Number((runtime.onnxSize / 1024 / 1024).toFixed(2)),
    wasmExists: runtime.wasmExists,
    note: runtime.modelExists && runtime.wasmExists
      ? '任意フォルダの外部モデルを使用します。ネットワーク接続は不要です。'
      : '外部モデルまたはWASMが見つかりません。管理画面でモデル保存先を設定し、モデル確認またはモデル取得を実行してください。',
  };
}

export type TransformerSemanticIndexItem = {
  faqId: string;
  textHash: string;
  identityHash: string;
  contentHash: string;
  category: string;
  intentId?: string;
  title: string;
  identityTextPreview?: string;
  contentTextPreview?: string;
  identityEmbedding: number[];
  contentEmbedding: number[];
  // Backward-compat field. Do not use as primary score in v212.
  embedding?: number[];
  dimension: number;
  updatedAt?: string;
};

export type TransformerSemanticIndex = {
  version: 243;
  engine: typeof TRANSFORMER_SEMANTIC_ENGINE;
  model: string;
  dimension: number;
  generatedAt: string;
  indexedCount: number;
  available: boolean;
  strategy: 'identity-content-dual-embedding';
  fusion: 'transformer-identity+sqlite-fts5-ngram+metadata-guard+eval-queue';
  error?: string;
  items: TransformerSemanticIndexItem[];
};

export type TransformerSemanticSearchResult = {
  id: string;
  score: number;
  semanticScore: number;
  identityScore: number;
  contentScore: number;
  rrfScore: number;
  textHash: string;
  reasons: string[];
  breakdown: {
    identitySemantic: number;
    contentSemantic: number;
    rrf: number;
    finalSemantic: number;
  };
};

function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join(' ');
  return String(value || '');
}

function unique(values: string[], limit = 120): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const key = normalizeJapaneseText(text).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function getRecordIntentId(record: SmartFaqSearchRecord): string {
  return String(record.intentId || (record as any).intentName || (Array.isArray((record as any).intentIds) ? (record as any).intentIds[0] : '') || '');
}

function buildLabeledLines(label: string, value: unknown, weight = 1): string[] {
  const text = stringify(value).trim();
  if (!text) return [];
  return Array.from({ length: Math.max(1, weight) }, () => `${label}: ${text}`);
}

export function buildSemanticIdentityText(record: SmartFaqSearchRecord): string {
  // v212 production-grade retrieval:
  // FAQ identification must be driven by metadata, examples, and test questions.
  // The answer body is intentionally excluded here because it often contains related
  // side topics that should not decide the FAQ identity.
  const parts: string[] = [];
  parts.push(...buildLabeledLines('タイトル', (record as any).title || record.question, 5));
  parts.push(...buildLabeledLines('質問', record.question, 6));
  parts.push(...buildLabeledLines('テスト質問', (record as any).testQuestions, 6));
  parts.push(...buildLabeledLines('想定質問', (record as any).likelyQuestions, 6));
  parts.push(...buildLabeledLines('パラフレーズ', (record as any).paraphrases, 5));
  parts.push(...buildLabeledLines('言い換え例', (record as any).examples, 5));
  parts.push(...buildLabeledLines('重要語', (record as any).keywords, 5));
  parts.push(...buildLabeledLines('タグ', record.tags, 4));
  parts.push(...buildLabeledLines('意図', [record.intentId, (record as any).intentName, record.intentLabel].filter(Boolean), 3));
  parts.push(...buildLabeledLines('カテゴリ', record.category, 3));
  return unique(parts, 240).join('\n').slice(0, 5000);
}

export function buildSemanticContentText(record: SmartFaqSearchRecord): string {
  // Content embedding is used only as a weak supporting signal.
  const parts: string[] = [];
  parts.push(...buildLabeledLines('回答', String(record.answer || '').slice(0, 1400), 2));
  parts.push(...buildLabeledLines('確認質問', (record as any).followUpQuestions, 1));
  parts.push(...buildLabeledLines('次の提案', (record as any).nextQuestions, 1));
  parts.push(...buildLabeledLines('できること', (record as any).suggestedActions, 1));
  return unique(parts, 160).join('\n').slice(0, 5000);
}

export function buildSemanticEmbeddingText(record: SmartFaqSearchRecord): string {
  return buildSemanticIdentityText(record);
}

export function semanticTextHash(record: SmartFaqSearchRecord): string {
  return createHash('sha1')
    .update(buildSemanticIdentityText(record))
    .update('\n---content---\n')
    .update(buildSemanticContentText(record))
    .digest('hex');
}

function textHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}


function shouldUseE5Prefix(model: string): boolean {
  return /(^|[/_-])e5($|[/_-])/i.test(model) || model.toLowerCase().includes('multilingual-e5');
}

function embeddingInput(text: string, model: string, role: 'query' | 'passage'): string {
  const raw = String(text || '').trim();
  if (!shouldUseE5Prefix(model)) return raw;
  return raw.toLowerCase().startsWith(`${role}:`) ? raw : `${role}: ${raw}`;
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let sum = 0;
  for (let i = 0; i < len; i += 1) sum += a[i] * b[i];
  return Math.max(0, Math.min(1, sum));
}

function rrf(rank: number, k = 60): number {
  return 1 / (k + Math.max(1, rank));
}

async function loadFeatureExtractor(model = getActiveTransformerModelId()): Promise<EmbeddingState> {
  if (embeddingState?.model === model && embeddingState.available && embeddingState.extractor) return embeddingState;
  if (embeddingState?.model === model && embeddingState.loading) return embeddingState.loading;

  const nextState: EmbeddingState = { model, extractor: null, available: false };
  nextState.loading = (async () => {
    try {
      let mod: any;
      try {
        mod = await import('@huggingface/transformers');
      } catch {
        mod = require('@huggingface/transformers');
      }
      const pipeline = mod.pipeline;
      const runtime = configureTransformersEnv(mod, model);
      if (!runtime.modelExists) {
        throw new Error(`offline model not found: ${runtime.expectedModelPath}`);
      }
      const loadOptions = runtime.hasQuantizedModel
        ? { dtype: 'q8', local_files_only: true }
        : { local_files_only: true };
      const extractor = await pipeline('feature-extraction', model, loadOptions);
      embeddingState = { model, extractor, available: true };
      return embeddingState;
    } catch (error) {
      embeddingState = {
        model,
        extractor: null,
        available: false,
        error: `Transformers.js embedding を利用できません: ${error instanceof Error ? error.message : String(error)}`,
      };
      return embeddingState;
    }
  })();
  embeddingState = nextState;
  return nextState.loading;
}

export async function embedTextWithTransformer(text: string, model = getActiveTransformerModelId()): Promise<{ available: boolean; embedding: number[]; dimension: number; error?: string }> {
  const normalized = normalizeJapaneseText(text).trim();
  if (!normalized) return { available: false, embedding: [], dimension: 0, error: 'empty text' };
  const state = await loadFeatureExtractor(model);
  if (!state.available || !state.extractor) return { available: false, embedding: [], dimension: 0, error: state.error };
  try {
    const output = await state.extractor(normalized.slice(0, 1_800), { pooling: 'mean', normalize: true, truncation: true, max_length: 512 });
    const raw = Array.from(output?.data || output?.tolist?.()?.[0] || []) as number[];
    const embedding = l2Normalize(raw.map(Number).filter((value) => Number.isFinite(value)));
    return { available: embedding.length > 0, embedding, dimension: embedding.length };
  } catch (error) {
    return { available: false, embedding: [], dimension: 0, error: `embedding failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function buildTransformerSemanticIndex(records: SmartFaqSearchRecord[], previous?: TransformerSemanticIndex | null, model = getActiveTransformerModelId()): Promise<TransformerSemanticIndex> {
  const searchable = records.filter((record) => record.status !== 'hidden');
  const prevById = new Map(((previous?.model === model ? previous?.items : []) || []).map((item) => [item.faqId, item]));
  const items: TransformerSemanticIndexItem[] = [];
  let dimension = previous?.dimension || 0;
  let available = true;
  let error: string | undefined;

  for (const record of searchable) {
    const faqId = String(record.id);
    const identityText = buildSemanticIdentityText(record);
    const contentText = buildSemanticContentText(record);
    const identityHash = textHash(identityText);
    const contentHash = textHash(contentText);
    const combinedHash = semanticTextHash(record);
    const previousItem = prevById.get(faqId);
    if (
      previousItem &&
      previousItem.textHash === combinedHash &&
      previousItem.identityHash === identityHash &&
      previousItem.contentHash === contentHash &&
      previousItem.identityEmbedding?.length &&
      previousItem.contentEmbedding?.length
    ) {
      items.push(previousItem);
      dimension = dimension || previousItem.dimension || previousItem.identityEmbedding.length;
      continue;
    }

    const identityEmbedded = await embedTextWithTransformer(embeddingInput(identityText, model, 'passage'), model);
    if (!identityEmbedded.available || !identityEmbedded.embedding.length) {
      available = false;
      error = identityEmbedded.error || 'identity embedding unavailable';
      continue;
    }
    const contentEmbedded = contentText.trim()
      ? await embedTextWithTransformer(embeddingInput(contentText, model, 'passage'), model)
      : { available: true, embedding: identityEmbedded.embedding, dimension: identityEmbedded.dimension };
    if (!contentEmbedded.available || !contentEmbedded.embedding.length) {
      available = false;
      error = contentEmbedded.error || 'content embedding unavailable';
      continue;
    }
    dimension = identityEmbedded.dimension;
    items.push({
      faqId,
      textHash: combinedHash,
      identityHash,
      contentHash,
      category: String(record.category || ''),
      intentId: getRecordIntentId(record),
      title: String(record.question || record.id),
      identityTextPreview: identityText.slice(0, 500),
      contentTextPreview: contentText.slice(0, 500),
      identityEmbedding: identityEmbedded.embedding,
      contentEmbedding: contentEmbedded.embedding,
      embedding: identityEmbedded.embedding,
      dimension: identityEmbedded.dimension,
      updatedAt: record.updatedAt,
    });
  }

  return {
    version: TRANSFORMER_SEMANTIC_INDEX_VERSION,
    engine: TRANSFORMER_SEMANTIC_ENGINE,
    model,
    dimension,
    generatedAt: new Date().toISOString(),
    indexedCount: items.length,
    available: available && items.length === searchable.length,
    strategy: 'identity-content-dual-embedding',
    fusion: 'transformer-identity+sqlite-fts5-ngram+metadata-guard+eval-queue',
    error,
    items,
  };
}

export async function searchWithTransformerSemanticIndex(input: {
  query: string;
  index?: TransformerSemanticIndex | null;
  limit?: number;
  model?: string;
}): Promise<{ results: TransformerSemanticSearchResult[]; available: boolean; error?: string }> {
  const index = input.index;
  if (!index || index.version !== TRANSFORMER_SEMANTIC_INDEX_VERSION || !index.items.length) {
    return { results: [], available: false, error: 'semantic index is missing' };
  }
  const activeModel = input.model || index.model || getActiveTransformerModelId();
  const embedded = await embedTextWithTransformer(embeddingInput(input.query, activeModel, 'query'), activeModel);
  if (!embedded.available || !embedded.embedding.length) return { results: [], available: false, error: embedded.error };

  const identityRanked = index.items
    .map((item) => ({ item, score: cosine(embedded.embedding, item.identityEmbedding || item.embedding || []) }))
    .sort((a, b) => b.score - a.score);
  const contentRanked = index.items
    .map((item) => ({ item, score: cosine(embedded.embedding, item.contentEmbedding || item.embedding || []) }))
    .sort((a, b) => b.score - a.score);
  const identityRankById = new Map(identityRanked.map((row, index) => [row.item.faqId, index + 1]));
  const contentRankById = new Map(contentRanked.map((row, index) => [row.item.faqId, index + 1]));
  const identityScoreById = new Map(identityRanked.map((row) => [row.item.faqId, row.score]));
  const contentScoreById = new Map(contentRanked.map((row) => [row.item.faqId, row.score]));

  const maxRrf = rrf(1) * 0.86 + rrf(1) * 0.14;
  const results = index.items
    .map((item) => {
      const identityScore = identityScoreById.get(item.faqId) || 0;
      const contentScore = contentScoreById.get(item.faqId) || 0;
      const identityRank = identityRankById.get(item.faqId) || 9999;
      const contentRank = contentRankById.get(item.faqId) || 9999;
      const rrfRaw = rrf(identityRank) * 0.86 + rrf(contentRank) * 0.14;
      const rrfNormalized = Math.max(0, Math.min(1, rrfRaw / maxRrf));
      // Identity is the production retrieval signal. Content is only a weak support signal.
      const semanticScore = Math.max(0, Math.min(1, identityScore * 0.88 + contentScore * 0.07 + rrfNormalized * 0.05));
      const score = Math.round(semanticScore * 100);
      const reasons = [
        identityScore >= 0.55 ? 'Identity意味ベクトル類似' : identityScore >= 0.42 ? 'Identity意味候補' : '',
        contentScore >= 0.62 ? 'Content意味補助' : '',
        rrfNormalized >= 0.65 ? 'RRF統合上位' : '',
      ].filter(Boolean);
      return {
        id: item.faqId,
        score,
        semanticScore,
        identityScore,
        contentScore,
        rrfScore: rrfNormalized,
        textHash: item.textHash,
        reasons,
        breakdown: {
          identitySemantic: Math.round(identityScore * 100),
          contentSemantic: Math.round(contentScore * 100),
          rrf: Math.round(rrfNormalized * 100),
          finalSemantic: score,
        },
      };
    })
    .filter((item) => item.score >= 28)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, input.limit || 20)));
  return { results, available: true };
}

export function mergeTransformerSemanticResultsIntoRanking<T extends { record: SmartFaqSearchRecord; score: number; reasons: string[]; matchedTerms: string[]; confidenceLabel?: string }>(
  base: T[],
  semanticResults: TransformerSemanticSearchResult[],
  records: SmartFaqSearchRecord[] = [],
): T[] {
  if (!semanticResults.length) return base;
  const semanticById = new Map(semanticResults.map((item) => [item.id, item]));
  const recordById = new Map(records.map((record) => [String(record.id), record]));
  const output = base.map((item) => {
    const semantic = semanticById.get(String(item.record.id));
    if (!semantic) return item;
    // v212: semantic should improve candidate ordering, not override explicit metadata/lexical signals.
    // Identity semantic is stronger than content semantic, but the boost remains conservative.
    const semanticBoosted = Math.round(item.score * 0.84 + semantic.score * 0.16);
    const identityBonus = semantic.breakdown.identitySemantic >= 70 ? 3 : semantic.breakdown.identitySemantic >= 58 ? 2 : 0;
    const score = Math.max(item.score, Math.min(96, semanticBoosted + identityBonus));
    return {
      ...item,
      score,
      reasons: Array.from(new Set([
        ...item.reasons,
        ...semantic.reasons,
        `意味検索: identity ${semantic.breakdown.identitySemantic}% / content ${semantic.breakdown.contentSemantic}%`,
      ])).slice(0, 12),
      matchedTerms: Array.from(new Set([...item.matchedTerms, 'semantic-identity'])).slice(0, 16),
      confidenceLabel: score >= 85 ? '高' : score >= 50 ? '中' : '低',
      semanticBreakdown: semantic.breakdown,
    } as unknown as T;
  });
  const existing = new Set(output.map((item) => String(item.record.id)));
  for (const semantic of semanticResults.slice(0, 8)) {
    if (existing.has(semantic.id) || semantic.score < 48) continue;
    const record = recordById.get(semantic.id);
    if (!record) continue;
    output.push({
      record,
      score: Math.min(82, semantic.score),
      reasons: Array.from(new Set([...semantic.reasons, 'Identity意味検索で候補化'])).slice(0, 8),
      matchedTerms: ['semantic-identity'],
      confidenceLabel: semantic.score >= 85 ? '高' : semantic.score >= 50 ? '中' : '低',
      semanticBreakdown: semantic.breakdown,
    } as unknown as T);
  }
  return output.sort((a, b) => b.score - a.score);
}
