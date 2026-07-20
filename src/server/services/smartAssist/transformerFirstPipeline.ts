import type { SmartFaqSearchRecord } from '../japaneseFaqSearch';
import type { TransformerSemanticIndex } from '../transformerSemanticRetrieval';
import {
  searchWithTransformerSemanticIndex,
  TRANSFORMER_SEMANTIC_INDEX_VERSION,
} from '../transformerSemanticRetrieval';

type SmartAssistUxLevel = 'high' | 'medium' | 'low';

type RankedTransformerCandidate = {
  record: SmartFaqSearchRecord;
  score: number;
  confidence: number;
  confidenceLabel: '高' | '中' | '低';
  reasons: string[];
  matchedTerms: string[];
  semanticBreakdown?: any;
  lexicalScore: number;
  exactScore: number;
  negativeHits: string[];
};

type TransformerFirstDeps = {
  normalizeQuery: (message: string) => Promise<{ original: string; normalized: string; replacements: string[] }>;
  readSemanticIndex: () => Promise<TransformerSemanticIndex | null>;
  writeSemanticIndex: (records: SmartFaqSearchRecord[]) => Promise<TransformerSemanticIndex>;
  searchFts: (message: string, records: SmartFaqSearchRecord[], limit: number) => Array<{ id: string; score: number; reasons: string[] }>;
  exactMetadataScore: (message: string, record: SmartFaqSearchRecord) => { score: number; hits: string[] };
  negativePenalty: (message: string, record: SmartFaqSearchRecord) => { penalty: number; hits: string[] };
  resolveFallbackContact: (category?: string) => Promise<any>;
  buildNoMatchFallbackAnswer: (args: { message: string; candidates: any[]; contact: any; normalizedQuery?: any }) => string;
  addImprovementQueue: (payload: any) => Promise<any>;
};

function uniqueStrings(values: Array<unknown>, limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function confidenceLabel(confidence: number): '高' | '中' | '低' {
  if (confidence >= 85) return '高';
  if (confidence >= 60) return '中';
  return '低';
}

function confidenceLevel(confidence: number): SmartAssistUxLevel {
  if (confidence >= 85) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
}

function inferCategoryHints(records: SmartFaqSearchRecord[]): string[] {
  return uniqueStrings(records.map((item) => item.category).filter(Boolean), 8);
}

function sameFaqFamily(a: SmartFaqSearchRecord, b: SmartFaqSearchRecord): boolean {
  const aIntent = String(a.intentId || a.intentLabel || '').trim();
  const bIntent = String(b.intentId || b.intentLabel || '').trim();
  if (aIntent && bIntent && aIntent === bIntent) return true;
  const aCategory = String(a.category || '').trim();
  const bCategory = String(b.category || '').trim();
  return Boolean(aCategory && bCategory && aCategory === bCategory);
}

function buildSuggestions(args: {
  message: string;
  record?: SmartFaqSearchRecord;
  related?: RankedTransformerCandidate[];
  categoryHints?: string[];
  level?: SmartAssistUxLevel;
}) {
  const record = args.record;
  const related = args.related || [];
  const categoryHints = args.categoryHints || [];
  const level = args.level || 'low';
  const actions = level === 'high'
    ? ['この回答をコピーする', '関連FAQを見る', '根拠を確認する']
    : ['近い候補を確認する', '質問に手続き名を追加する', '担当者に確認する'];
  const next = uniqueStrings([
    ...(Array.isArray(record?.followUpQuestions) ? record!.followUpQuestions : []),
    ...related.map((item) => item.record.question),
    ...categoryHints.map((category) => `${category}について確認したい`),
  ], 6);
  const clarifications = uniqueStrings([
    '対象者を追加',
    '手続き名を追加',
    '期限を追加',
    ...categoryHints.slice(0, 3),
  ], 6);
  return { suggestedActions: uniqueStrings(actions, 6), nextQuestions: next, clarificationChips: clarifications };
}

function formatAnswer(args: {
  level: SmartAssistUxLevel;
  record: SmartFaqSearchRecord;
  answer: string;
  confidence: number;
  candidates?: RankedTransformerCandidate[];
  categoryHints?: string[];
}): string {
  if (args.level === 'high') return args.answer;
  const prefix = args.level === 'medium'
    ? `信頼度は中程度です。候補FAQ「${args.record.question}」に基づく回答です。\n\n`
    : `信頼度が低いため、断定せず候補として表示します。\n\n候補FAQ: ${args.record.question}\n\n`;
  const suffix = args.level === 'low'
    ? '\n\n手続き名、対象者、期限などを追加すると精度が上がります。'
    : '';
  return `${prefix}${args.answer}${suffix}`;
}

export async function buildTransformerFirstSmartAssistResponse(args: {
  message: string;
  records: SmartFaqSearchRecord[];
  debug?: boolean;
  deps: TransformerFirstDeps;
}): Promise<any | null> {
  const normalizedQuery = await args.deps.normalizeQuery(args.message);
  const searchMessage = normalizedQuery.normalized || args.message;
  const records = args.records.filter((item) => item.status !== 'hidden' && String(item.question || '').trim() && String(item.answer || '').trim());
  if (!records.length) return null;

  let semanticIndex = await args.deps.readSemanticIndex();
  if (!semanticIndex || semanticIndex.indexedCount !== records.length || semanticIndex.version !== TRANSFORMER_SEMANTIC_INDEX_VERSION) {
    try {
      semanticIndex = await args.deps.writeSemanticIndex(records);
    } catch {
      semanticIndex = await args.deps.readSemanticIndex();
    }
  }

  const semantic = await searchWithTransformerSemanticIndex({ query: searchMessage, index: semanticIndex, limit: 40 })
    .catch((error: any) => ({ results: [], available: false, error: String(error?.message || error) }));
  const fts = args.deps.searchFts(searchMessage, records, 40);
  const semanticById = new Map((semantic.results || []).map((item: any) => [String(item.id), item]));
  const ftsById = new Map(fts.map((item) => [String(item.id), item]));

  const allRanked: RankedTransformerCandidate[] = records.map((record) => {
    const semanticRow: any = semanticById.get(String(record.id));
    const ftsRow = ftsById.get(String(record.id));
    const semanticScore = Number(semanticRow?.score || 0);
    const identityScore = Number(semanticRow?.breakdown?.identitySemantic || semanticRow?.identityScore * 100 || 0);
    const contentScore = Number(semanticRow?.breakdown?.contentSemantic || semanticRow?.contentScore * 100 || 0);
    const lexicalScore = Number(ftsRow?.score || 0);
    const exact = args.deps.exactMetadataScore(searchMessage, record);
    const negative = args.deps.negativePenalty(searchMessage, record);

    let score = Math.round(semanticScore * 0.52 + lexicalScore * 0.24 + exact.score * 0.24 - negative.penalty);
    let cap = 96;
    if (negative.penalty) cap = 35;
    if (semanticScore >= 82 && exact.score < 25 && lexicalScore < 35) cap = Math.min(cap, 74);
    if (semanticScore >= 82 && exact.score < 40 && lexicalScore < 45) cap = Math.min(cap, 84);
    if (contentScore > identityScore + 18 && exact.score < 35) cap = Math.min(cap, 72);
    score = Math.max(1, Math.min(cap, score));

    const reasons = uniqueStrings([
      semanticScore ? `意味検索 ${semanticScore}%` : '',
      identityScore ? `識別ベクトル ${Math.round(identityScore)}%` : '',
      contentScore ? `本文ベクトル ${Math.round(contentScore)}%` : '',
      lexicalScore ? `FTS/N-gram ${Math.round(lexicalScore)}%` : '',
      exact.score ? `メタ情報一致 ${Math.round(exact.score)}%` : '',
      ...exact.hits.slice(0, 4).map((hit) => `一致: ${hit}`),
      ...negative.hits.map((hit) => `除外語: ${hit}`),
    ].filter(Boolean), 12);

    return {
      record,
      score,
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      reasons,
      matchedTerms: exact.hits,
      semanticBreakdown: semanticRow?.breakdown,
      lexicalScore,
      exactScore: exact.score,
      negativeHits: negative.hits,
    };
  }).sort((a, b) => b.score - a.score);

  const ranked = allRanked.filter((item) => item.score >= 20).slice(0, 12);
  const fallbackCandidates = ranked.length ? ranked : allRanked.filter((item) => item.score > 0).slice(0, 6);
  const top = ranked[0];

  if (!top) {
    const contact = await args.deps.resolveFallbackContact(String(fallbackCandidates[0]?.record?.category || ''));
    const answer = args.deps.buildNoMatchFallbackAnswer({ message: args.message, candidates: fallbackCandidates, contact, normalizedQuery });
    await args.deps.addImprovementQueue({
      question: args.message,
      confidence: 0,
      candidates: fallbackCandidates.slice(0, 5).map((item: any) => ({ id: item.record.id, question: item.record.question, category: item.record.category, score: item.score })),
      reason: 'no-confident-match',
      response: { answerPolicy: 'fallback-with-near-candidates-v218' },
    });
    return {
      answer,
      rawAnswer: '',
      confidence: 0,
      confidenceLabel: '低',
      uxLevel: 'low',
      intent: 'None',
      matchedFaqId: '',
      matchedFaqTitle: '',
      faqScore: 0,
      reasons: ['該当FAQなし', ...(normalizedQuery.replacements || []).map((item: string) => `表記揺れ補正: ${item}`)],
      matchedTerms: [],
      followUpQuestions: ['手続き名を追加してください。', '制度名や対象者を追加してください。'],
      suggestedActions: ['近い候補を確認する', '担当係に確認する', 'FAQ追加候補として保存する'],
      nextQuestions: fallbackCandidates.slice(0, 3).map((item: any) => item.record.question).filter(Boolean),
      clarificationChips: ['候補1を確認', '手続き名を追加', '未回答FAQにする'],
      categoryOptions: inferCategoryHints(records),
      sources: [],
      related: [],
      fallbackContact: contact,
      candidates: fallbackCandidates.slice(0, 3).map((item: any) => ({ id: item.record.id, question: item.record.question, category: item.record.category, score: item.score, reasons: item.reasons, semanticBreakdown: item.semanticBreakdown, lexicalScore: item.lexicalScore, exactScore: item.exactScore })),
      answerPolicy: 'fallback-with-near-candidates-v218',
      mode: 'transformer-first-fallback-v218',
      debug: args.debug ? { normalizedQuery, semanticAvailable: semantic.available, semanticError: semantic.error, semanticResults: (semantic.results || []).slice(0, 8), fts: fts.slice(0, 8), ranked: fallbackCandidates.slice(0, 8).map((item: any) => ({ id: item.record.id, question: item.record.question, score: item.score, reasons: item.reasons, semanticBreakdown: item.semanticBreakdown, lexicalScore: item.lexicalScore, exactScore: item.exactScore, negativeHits: item.negativeHits })) } : undefined,
    };
  }

  const second = ranked[1];
  if (second && top.score >= 85 && top.score - second.score < 6) {
    top.score = 84;
    top.confidence = 84;
    top.confidenceLabel = '中';
    top.reasons = uniqueStrings([...top.reasons, `候補差が小さいため高信頼抑制: ${top.score - second.score}pt`], 12);
  }

  let confidence = Math.max(0, Math.min(96, Math.round(top.score || 0)));
  if (confidence >= 85 && Number(top.exactScore || 0) < 45 && Number(top.lexicalScore || 0) < 50) confidence = 84;
  if (confidence < 55) {
    await args.deps.addImprovementQueue({
      question: args.message,
      matchedFaqId: top.record?.id,
      confidence,
      candidates: ranked.slice(0, 4).map((item: any) => ({ id: item.record.id, question: item.record.question, category: item.record.category, score: item.score })),
      reason: 'below-answer-threshold',
    });
  }

  const level = confidenceLevel(confidence);
  const record = top.record;
  const categoryOptions = inferCategoryHints(records);
  const answer = formatAnswer({ level, record, answer: String(record.answer || ''), confidence, candidates: ranked.slice(0, 4), categoryHints: categoryOptions });
  const relatedCandidates = level === 'high' ? [] : ranked.slice(1).filter((item: any) => sameFaqFamily(record, item.record)).slice(0, 3);
  const suggestions = buildSuggestions({ message: searchMessage, record, related: relatedCandidates, categoryHints: categoryOptions, level });

  return {
    answer,
    rawAnswer: record.answer,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    uxLevel: level,
    intent: record.intentId || record.intentLabel || 'transformer-first',
    matchedFaqId: record.id,
    matchedFaqTitle: record.question,
    faqScore: confidence,
    reasons: top.reasons,
    matchedTerms: top.matchedTerms,
    followUpQuestions: uniqueStrings(Array.isArray(record.followUpQuestions) ? record.followUpQuestions : [], 4),
    suggestedActions: suggestions.suggestedActions,
    nextQuestions: suggestions.nextQuestions,
    clarificationChips: suggestions.clarificationChips,
    categoryOptions: level === 'low' ? categoryOptions : [],
    sources: [{ title: record.category || 'FAQ', type: record.sourceType || 'faq', page: record.sourcePage }],
    related: relatedCandidates.map((item: any) => ({ id: item.record.id, question: item.record.question, category: item.record.category, score: item.score, reasons: item.reasons })),
    candidates: level === 'high' ? [] : ranked.slice(0, 4).map((item: any) => ({ id: item.record.id, question: item.record.question, category: item.record.category, score: item.score, reasons: item.reasons, semanticBreakdown: item.semanticBreakdown, lexicalScore: item.lexicalScore, exactScore: item.exactScore })),
    answerPolicy: level === 'high' ? 'transformer-first-single-faq' : 'transformer-first-candidate-answer',
    mode: 'transformer-first-fts5-eval-v217',
    debug: args.debug ? { normalizedQuery, semanticAvailable: semantic.available, semanticError: semantic.error, semanticResults: (semantic.results || []).slice(0, 8), fts: fts.slice(0, 8), ranked: ranked.slice(0, 8).map((item: any) => ({ id: item.record.id, question: item.record.question, score: item.score, reasons: item.reasons, semanticBreakdown: item.semanticBreakdown, lexicalScore: item.lexicalScore, exactScore: item.exactScore, negativeHits: item.negativeHits })) } : undefined,
  };
}
