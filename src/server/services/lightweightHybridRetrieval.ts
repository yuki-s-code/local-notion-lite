import { analyzeJapaneseQuery, buildSmartFaqSearchText, normalizeJapaneseText, type RankedFaqSearchResult, type SmartFaqSearchRecord } from './japaneseFaqSearch';

export type LightweightSearchVector = Record<string, number>;

export type LightweightSearchIndexItem = {
  id: string;
  category: string;
  intentId?: string;
  title: string;
  /** 日本語正規化で抽出した意味単位トークン。専門語・名詞・基本形を重視する。 */
  normalizedTerms: string[];
  /** n-gramフォールバック用トークン。短文・未知語・スペースなし入力を拾う。 */
  ngramTerms: string[];
  /** 検索で使う統合トークン。正規化トークン + ngram + FAQメタデータ由来。 */
  terms: string[];
  /** レコード固有性の高い語。汎用語だけでサブFAQが高信頼になるのを防ぐ。 */
  distinctiveTerms: string[];
  /** かなり一般的な語。単独一致では信頼度を上げすぎない。 */
  commonTerms: string[];
  vector: LightweightSearchVector;
  length: number;
  updatedAt?: string;
};

export type LightweightSearchIndex = {
  version: 206;
  engine: 'transformer-js-semantic-hybrid-v206';
  generatedAt: string;
  indexedCount: number;
  documentFrequency: Record<string, number>;
  items: LightweightSearchIndexItem[];
};

export type LightweightHybridResult = {
  id: string;
  score: number;
  lexicalScore: number;
  vectorScore: number;
  bm25Score: number;
  exactScore: number;
  matchedTerms: string[];
  reasons: string[];
};

const FIELD_SEPARATORS = /[\s\n\r\t、。，,.・:：;；!！?？「」『』【】\[\]()（）{}<>＜＞/\\|＿_~〜ー－―]+/g;
const VECTOR_STOP_WORDS = new Set(['です', 'ます', 'する', 'した', 'して', 'できる', 'ください', 'について', '場合', '確認', '方法', 'どのよう', 'どの', 'よう', 'こと', 'もの', 'ため']);


function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeJapaneseText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function ngrams(text: string, min = 2, max = 3): string[] {
  const compact = normalizeJapaneseText(text).replace(/\s+/g, '');
  const out: string[] = [];
  if (compact.length < min) return out;
  for (let n = min; n <= max; n += 1) {
    for (let i = 0; i <= compact.length - n; i += 1) out.push(compact.slice(i, i + n));
  }
  return out;
}

function detectDomainTerms(normalized: string): string[] {
  // v205では業務ドメイン固有の固定語を持たない。
  // 英数字略語、2文字以上の連続漢字、カタカナ語など、どの業務でも使える表層語だけを拾う。
  const out: string[] = [];
  const patterns = [
    /[a-z0-9][a-z0-9._-]{1,}/gi,
    /[一-龯々〆ヵヶ]{2,}/g,
    /[ァ-ヶー]{2,}/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.match(pattern) || []) out.push(match);
  }
  return unique(out).slice(0, 80);
}


export function tokenizeForLightweightVector(text: string): string[] {
  const normalized = normalizeJapaneseText(text);
  const splitTerms = normalized
    .split(FIELD_SEPARATORS)
    .map((x) => normalizeJapaneseText(x))
    .filter((x) => x.length >= 2 && !VECTOR_STOP_WORDS.has(x));
  return unique([...splitTerms, ...detectDomainTerms(normalized), ...ngrams(normalized, 2, 2).slice(0, 120)]).slice(0, 220);
}

export async function tokenizeForHybridVector(text: string): Promise<{ normalizedTerms: string[]; ngramTerms: string[]; terms: string[]; engine: 'normalized-ngram' }> {
  const normalized = normalizeJapaneseText(text);
  const analysis = await analyzeJapaneseQuery(text);
  const normalizedTerms = unique([
    ...analysis.tokens,
    ...analysis.expandedTerms,
    ...detectDomainTerms(normalized),
  ]).filter((x) => x.length >= 2 && !VECTOR_STOP_WORDS.has(x)).slice(0, 160);
  const fallbackTerms = tokenizeForLightweightVector(text);
  const ngramTerms = unique([...ngrams(normalized, 2, 2), ...ngrams(normalized, 3, 3).slice(0, 80)]).slice(0, 180);
  const terms = unique([
    ...normalizedTerms.flatMap((term) => [term, term]),
    ...fallbackTerms,
    ...ngramTerms,
  ]).slice(0, 280);
  return {
    normalizedTerms,
    ngramTerms,
    terms,
    engine: 'normalized-ngram',
  };
}

function weightedSearchText(record: SmartFaqSearchRecord): string {
  const parts: string[] = [];
  const push = (value: unknown, weight = 1) => {
    const text = Array.isArray(value) ? value.join(' ') : String(value || '');
    if (!text.trim()) return;
    for (let i = 0; i < weight; i += 1) parts.push(text);
  };
  push(record.question, 5);
  push((record as any).testQuestions, 5);
  push((record as any).examples, 4);
  push((record as any).keywords, 4);
  push(record.tags, 3);
  push(record.intentId, 3);
  push((record as any).intentName, 3);
  push(record.intentLabel, 3);
  push(record.category, 2);
  push((record as any).suggestedActions, 2);
  push((record as any).nextQuestions, 2);
  push(record.answer, 1);
  push(buildSmartFaqSearchText(record), 1);
  return parts.join('\n');
}

type WeightedField = { value: unknown; weight: number; label: string };

function recordWeightedFields(record: SmartFaqSearchRecord): WeightedField[] {
  return [
    { value: record.question, weight: 8, label: 'question' },
    { value: (record as any).testQuestions, weight: 8, label: 'testQuestions' },
    { value: (record as any).examples, weight: 7, label: 'examples' },
    { value: (record as any).keywords, weight: 7, label: 'keywords' },
    { value: record.tags, weight: 5, label: 'tags' },
    { value: record.intentId, weight: 4, label: 'intentId' },
    { value: (record as any).intentName, weight: 4, label: 'intentName' },
    { value: record.intentLabel, weight: 4, label: 'intentLabel' },
    { value: record.category, weight: 3, label: 'category' },
    { value: (record as any).suggestedActions, weight: 2, label: 'suggestedActions' },
    { value: (record as any).nextQuestions, weight: 2, label: 'nextQuestions' },
    { value: record.answer, weight: 1, label: 'answer' },
  ];
}

function stringifyField(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join(' ');
  return String(value || '');
}

async function weightedTokensForRecord(record: SmartFaqSearchRecord): Promise<{ tokens: string[]; normalizedTerms: string[]; ngramTerms: string[] }> {
  const tokens: string[] = [];
  const normalizedTerms: string[] = [];
  const ngramTerms: string[] = [];
  for (const field of recordWeightedFields(record)) {
    const text = stringifyField(field.value);
    if (!text.trim()) continue;
    const tokenized = await tokenizeForHybridVector(text);
    normalizedTerms.push(...tokenized.normalizedTerms);
    ngramTerms.push(...tokenized.ngramTerms);
    for (const term of tokenized.terms) {
      const repeat = Math.max(1, Math.min(10, Math.round(field.weight)));
      for (let i = 0; i < repeat; i += 1) tokens.push(term);
    }
  }
  return {
    tokens: tokens.slice(0, 2400),
    normalizedTerms: unique(normalizedTerms).slice(0, 180),
    ngramTerms: unique(ngramTerms).slice(0, 220),
  };
}


function termFrequency(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const token of tokens) tf[token] = (tf[token] || 0) + 1;
  return tf;
}

function normalizeVector(vector: LightweightSearchVector): LightweightSearchVector {
  const norm = Math.sqrt(Object.values(vector).reduce((sum, value) => sum + value * value, 0)) || 1;
  const out: LightweightSearchVector = {};
  for (const [key, value] of Object.entries(vector)) out[key] = value / norm;
  return out;
}

function cosine(a: LightweightSearchVector, b: LightweightSearchVector): number {
  let sum = 0;
  const [small, large] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  for (const [key, value] of Object.entries(small)) {
    const other = large[key];
    if (other) sum += value * other;
  }
  return Math.max(0, Math.min(1, sum));
}

export async function buildLightweightSearchIndex(records: SmartFaqSearchRecord[]): Promise<LightweightSearchIndex> {
  const searchable = records.filter((record) => record.status !== 'hidden');
  const tokenized = await Promise.all(searchable.map(async (record) => {
    const tokenizedText = await weightedTokensForRecord(record);
    const tokens = tokenizedText.tokens;
    return { record, tokens, normalizedTerms: tokenizedText.normalizedTerms, ngramTerms: tokenizedText.ngramTerms, tf: termFrequency(tokens) };
  }));
  const df: Record<string, number> = {};
  for (const item of tokenized) {
    for (const token of Object.keys(item.tf)) df[token] = (df[token] || 0) + 1;
  }
  const n = Math.max(1, tokenized.length);
  const items: LightweightSearchIndexItem[] = tokenized.map(({ record, tokens, normalizedTerms, ngramTerms, tf }) => {
    const vector: LightweightSearchVector = {};
    for (const [term, count] of Object.entries(tf)) {
      const idf = Math.log(1 + (n + 1) / ((df[term] || 0) + 1));
      vector[term] = (1 + Math.log(count)) * idf;
    }
    return {
      id: String(record.id),
      category: String(record.category || ''),
      intentId: String(record.intentId || (record as any).intentName || ''),
      title: String(record.question || record.id),
      normalizedTerms: normalizedTerms.slice(0, 100),
      ngramTerms: ngramTerms.slice(0, 100),
      terms: Object.keys(tf).sort((a, b) => (tf[b] || 0) - (tf[a] || 0)).slice(0, 180),
      distinctiveTerms: Object.keys(tf)
        .filter((term) => (df[term] || 0) <= Math.max(1, Math.ceil(n * 0.28)))
        .sort((a, b) => (tf[b] || 0) - (tf[a] || 0))
        .slice(0, 80),
      commonTerms: Object.keys(tf)
        .filter((term) => (df[term] || 0) >= Math.max(2, Math.ceil(n * 0.55)))
        .sort((a, b) => (df[b] || 0) - (df[a] || 0))
        .slice(0, 80),
      vector: normalizeVector(vector),
      length: tokens.length,
      updatedAt: record.updatedAt,
    };
  });
  return {
    version: 206,
    engine: 'transformer-js-semantic-hybrid-v206',
    generatedAt: new Date().toISOString(),
    indexedCount: items.length,
    documentFrequency: Object.fromEntries(Object.entries(df).sort((a, b) => b[1] - a[1]).slice(0, 5000)),
    items,
  };
}

function bm25LikeScore(queryTerms: string[], item: LightweightSearchIndexItem, df: Record<string, number>, docCount: number): number {
  const itemTerms = new Set(item.terms);
  let score = 0;
  for (const term of queryTerms) {
    if (!itemTerms.has(term) && !item.terms.some((x) => x.includes(term) || term.includes(x))) continue;
    const idf = Math.log(1 + (docCount + 1) / ((df[term] || 1) + 0.5));
    score += idf;
  }
  return Math.min(1, score / Math.max(2, queryTerms.length * 1.25));
}

function exactPhraseScore(query: string, record: SmartFaqSearchRecord): number {
  const normalizedQuery = normalizeJapaneseText(query);
  if (!normalizedQuery) return 0;
  const exactFields = [
    record.question,
    ...((Array.isArray((record as any).testQuestions) ? (record as any).testQuestions : []) as string[]),
    ...((Array.isArray((record as any).examples) ? (record as any).examples : []) as string[]),
  ].map((x) => normalizeJapaneseText(x));
  if (exactFields.some((field) => field === normalizedQuery)) return 1;
  if (exactFields.some((field) => field.includes(normalizedQuery) || normalizedQuery.includes(field))) return 0.82;
  return 0;
}

function overlapCount(queryTerms: string[], terms: string[]): number {
  const termSet = new Set(terms);
  let count = 0;
  for (const term of unique(queryTerms)) {
    if (termSet.has(term) || terms.some((x) => x.includes(term) || term.includes(x))) count += 1;
  }
  return count;
}

function distinctiveMatchScore(queryTerms: string[], item: LightweightSearchIndexItem): number {
  const distinctiveHits = overlapCount(queryTerms, item.distinctiveTerms || []);
  const commonHits = overlapCount(queryTerms, item.commonTerms || []);
  const totalHits = overlapCount(queryTerms, item.terms || []);
  if (!totalHits) return 0;
  // 汎用語しか当たっていない候補は低くし、レコード固有語が当たれば強くする。
  return Math.min(1, distinctiveHits / Math.max(1, Math.min(4, totalHits - commonHits + 1)));
}

function genericityPenalty(queryTerms: string[], item: LightweightSearchIndexItem): { penalty: number; reason?: string } {
  const hits = overlapCount(queryTerms, item.terms || []);
  if (!hits) return { penalty: 0 };
  const distinctiveHits = overlapCount(queryTerms, item.distinctiveTerms || []);
  const commonHits = overlapCount(queryTerms, item.commonTerms || []);
  const shortQuery = unique(queryTerms.filter((x) => x.length >= 2)).length <= 6;
  if (shortQuery && distinctiveHits === 0 && commonHits > 0) {
    return { penalty: 0.34, reason: '汎用語だけの一致のため高信頼を抑制' };
  }
  if (shortQuery && distinctiveHits <= 1 && hits >= 1) {
    return { penalty: 0.14, reason: '短文で固有語が少ないため信頼度を補正' };
  }
  return { penalty: 0 };
}


export async function searchWithLightweightHybridIndex(input: {
  query: string;
  records: SmartFaqSearchRecord[];
  index?: LightweightSearchIndex | null;
  limit?: number;
}): Promise<{ results: LightweightHybridResult[]; index: LightweightSearchIndex; analysisTerms: string[] }> {
  const index = input.index && input.index.version === 206 ? input.index : await buildLightweightSearchIndex(input.records);
  const byId = new Map(input.records.map((record) => [String(record.id), record]));
  const analysis = await analyzeJapaneseQuery(input.query);
  const hybridQuery = await tokenizeForHybridVector(input.query);
  const queryTerms = unique([...analysis.tokens, ...analysis.expandedTerms, ...hybridQuery.normalizedTerms, ...hybridQuery.ngramTerms, ...hybridQuery.terms]).slice(0, 160);
  const queryTf = termFrequency(queryTerms);
  const queryVectorRaw: LightweightSearchVector = {};
  const docCount = Math.max(1, index.indexedCount);
  for (const [term, count] of Object.entries(queryTf)) {
    const idf = Math.log(1 + (docCount + 1) / ((index.documentFrequency[term] || 0) + 1));
    queryVectorRaw[term] = (1 + Math.log(count)) * idf;
  }
  const queryVector = normalizeVector(queryVectorRaw);

  const results = index.items.map((item) => {
    const record = byId.get(item.id);
    const vectorScore = cosine(queryVector, item.vector);
    const bm25Score = bm25LikeScore(queryTerms, item, index.documentFrequency, docCount);
    const exactScore = record ? exactPhraseScore(input.query, record) : 0;
    const matchedTerms = queryTerms.filter((term) => item.terms.includes(term) || item.terms.some((x) => x.includes(term) || term.includes(x))).slice(0, 20);
    const normalizedOverlap = hybridQuery.normalizedTerms.filter((term) => item.normalizedTerms.includes(term)).length;
    const normalizedTokenScore = Math.min(1, normalizedOverlap / Math.max(2, Math.min(hybridQuery.normalizedTerms.length, 8)));
    const lexicalScore = Math.min(1, matchedTerms.length / Math.max(3, Math.min(queryTerms.length, 12)));
    const distinctiveScore = distinctiveMatchScore(queryTerms, item);
    const genericPenalty = genericityPenalty(queryTerms, item);
    const rawScore01 = Math.max(
      exactScore,
      vectorScore * 0.26
        + bm25Score * 0.25
        + lexicalScore * 0.12
        + normalizedTokenScore * 0.14
        + distinctiveScore * 0.18
        + exactScore * 0.05,
    );
    const score01 = Math.max(0, Math.min(1, rawScore01 - genericPenalty.penalty));
    const score = Math.round(score01 * 100);
    const reasons: string[] = [];
    if (exactScore >= 0.8) reasons.push('完全一致・例文一致');
    if (bm25Score >= 0.25) reasons.push('BM25風キーワード検索一致');
    if (vectorScore >= 0.12) reasons.push('軽量TF-IDFベクトル類似度一致');
    if (normalizedTokenScore >= 0.25) reasons.push('日本語正規化トークン一致');
    if (distinctiveScore >= 0.25) reasons.push('FAQ固有語の一致');
    if (lexicalScore >= 0.25) reasons.push('重要語の重なり');
    if (genericPenalty.reason) reasons.push(genericPenalty.reason);
    return { id: item.id, score, lexicalScore, vectorScore, bm25Score, exactScore, matchedTerms, reasons };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(100, input.limit || 20)));

  return { results, index, analysisTerms: queryTerms };
}

export function mergeLightweightResultsIntoRanking(
  base: RankedFaqSearchResult[],
  vectorResults: LightweightHybridResult[],
  records: SmartFaqSearchRecord[] = [],
): RankedFaqSearchResult[] {
  const vectorById = new Map(vectorResults.map((item) => [item.id, item]));
  const recordById = new Map(records.map((record) => [String(record.id), record]));
  const output = base.map((item) => {
    const vector = vectorById.get(String(item.record.id));
    if (!vector) return item;
    const boost = Math.round(vector.score * 0.28);
    return {
      ...item,
      score: Math.max(item.score, Math.min(100, Math.round(item.score * 0.82 + vector.score * 0.18 + boost * 0.25))),
      reasons: Array.from(new Set([...item.reasons, ...vector.reasons, '自動ベクトル検索で補正'])).slice(0, 8),
      matchedTerms: Array.from(new Set([...item.matchedTerms, ...vector.matchedTerms])).slice(0, 16),
      confidenceLabel: Math.max(item.score, vector.score) >= 78 ? '高' : Math.max(item.score, vector.score) >= 50 ? '中' : '低',
    } as RankedFaqSearchResult;
  });
  const existing = new Set(output.map((item) => String(item.record.id)));
  for (const vector of vectorResults.slice(0, 10)) {
    if (existing.has(vector.id)) continue;
    const record = recordById.get(vector.id);
    if (!record || vector.score < 42) continue;
    output.push({
      record,
      score: Math.min(100, Math.max(1, vector.score)),
      reasons: Array.from(new Set([...vector.reasons, 'ベクトル検索のみで候補化'])).slice(0, 8),
      matchedTerms: vector.matchedTerms.slice(0, 16),
      confidenceLabel: vector.score >= 78 ? '高' : vector.score >= 50 ? '中' : '低',
    });
  }
  return output.sort((a, b) => b.score - a.score);
}
