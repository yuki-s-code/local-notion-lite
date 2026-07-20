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
  /** Optional v189 metadata. Prefer stable ids such as annual_leave / missed_deadline. */
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

export type RankedFaqSearchResult = {
  record: SmartFaqSearchRecord;
  score: number;
  reasons: string[];
  matchedTerms: string[];
  confidenceLabel: '高' | '中' | '低';
};

type SearchDocument = {
  record: SmartFaqSearchRecord;
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string;
  source: string;
  text: string;
  normalizedText: string;
};

type QueryAnalysis = {
  original: string;
  normalized: string;
  tokens: string[];
  expandedTerms: string[];
  importantTerms: string[];
  engine: 'ngram-fallback';
};

const STOP_WORDS = new Set([
  'する', 'いる', 'ある', 'なる', 'できる', 'れる', 'られる', 'こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'あれ',
  'どれ', 'ここ', 'そこ', 'どこ', 'いつ', 'なに', '何', 'です', 'ます', 'ください', 'について', '場合', 'とき',
  'ので', 'から', 'まで', 'また', 'または', '及び', 'および', 'なら', 'では', 'には', 'とは', 'って', 'する',
]);

const DOMAIN_SYNONYM_GROUPS = [
  ['年休', '有休', '有給', '年次有給休暇', '有給休暇', '年次休暇'],
  ['忌引', '忌引き', '服喪', '親族死亡', '死亡休暇', '特別休暇'],
  ['病休', '病気休暇', '療養休暇', '病気', '体調不良'],
  ['子の看護', '看護休暇', '子看護', '子どもの看護', '子供の看護', '子どもが熱', '子供が熱', '発熱', '子の発熱', '休みたい'],
  ['介護休暇', '介護時間', '介護', '家族介護'],
  ['会計年度任用職員', '会計年度', '任用職員', '非常勤', 'パートタイム会計年度'],
  ['給与', '給料', '報酬', '賃金', '手当', '期末手当', '勤勉手当'],
  ['社会保険', '健康保険', '厚生年金', '雇用保険', '保険加入'],
  ['勤務条件', '勤務時間', '労働条件', '勤務日', '週休日'],
  ['就労', '仕事', '勤務', '労働', '働く', '勤務先', '勤務終了時間', '終業時間', '退勤時間'],
  ['要件', '条件', '基準', '対象', '資格', '入会要件', '就労要件', '利用要件', '申込要件'],
  ['週3日', '週三日', '3か月', '三か月', '午後4時', '16時', '4時以降', '継続勤務'],
  ['休暇', '休み', '休む', '特別休暇', '職免', '職務免除'],
  ['旅費', '交通費', '通勤手当', '出張', '費用弁償'],
  ['互助会', '福利厚生', '給付', '助成'],
  ['放課後児童クラブ', '学童', '児童クラブ', '留守家庭児童会', '放課後クラブ'],
  ['利用料', '保育料', '料金', '費用', '月額', '減免'],
  ['申請', '届出', '提出', '手続', '手続き', '申込', '申し込み'],
  ['PDF', '資料', '文書', 'マニュアル', '手引', '手引き'],
  ['Notion', 'ノーション', 'データベース', 'DB', 'ページ'],
  ['GitHub', 'リポジトリ', 'Actions', 'ワークフロー', 'ビルド'],
  ['Omi', 'Omi.ai', 'オミ', '文字起こし', '会話ログ'],
  ['FAQ', 'Q&A', '質問', '回答', 'ナレッジ', '知識'],
  ['対象', '条件', '要件', '基準', '資格', '該当', '利用可否', '可能性'],
  ['手続', '手続き', '申請', '申込', '申し込み', '登録', '提出', '流れ', '方法'],
  ['必要書類', '書類', '証明書', '添付資料', '提出物', '確認資料'],
  ['料金', '費用', '金額', '支払い', '負担', '減免', '免除', '割引'],
  ['期限', '締切', '期日', '受付期間', '開始日', '終了日', '何日前'],
  ['変更', '修正', '訂正', '取消', 'キャンセル', '退会', '停止'],
  ['問い合わせ', '相談', '確認', '窓口', '担当', '連絡先'],
  // V177: abstract / vague wording groups for practical chat queries
  ['できる', '可能', 'いける', '使える', '利用できる', '申し込める', '入れる', '対象になる', '該当する'],
  ['どうしたらいい', 'どうすればいい', '何をすればいい', '手順', '流れ', 'やり方', '方法', '案内'],
  ['大丈夫', '問題ない', '平気', 'できますか', '可能ですか', 'いけますか'],
  ['どんな人', '誰が', '対象者', '対象', '条件', '要件', '基準', '資格'],
  ['いつ', 'いつまで', '期限', '締切', '何日前', '開始', 'いつから', 'いつまでに'],
  ['いくら', 'お金', '料金', '費用', '負担', '支払い', '月額', '安く', '減らす'],
  ['いるもの', '必要なもの', '持ち物', '提出物', '書類', '添付', '証明'],
  ['変わった', '変える', '変更', '転職', '引越し', '住所変更', '勤務先変更'],
  ['やめたい', 'やめる', '辞める', '停止', '退会', '取消'],
  ['困った', 'わからない', '不安', '相談', '問い合わせ', '聞きたい', '確認したい'],
];

const synonymMap = new Map<string, string[]>();
for (const group of DOMAIN_SYNONYM_GROUPS) {
  const normalized = Array.from(new Set(group.flatMap((term) => [term, normalizeJapaneseText(term)]).filter(Boolean)));
  for (const term of normalized) {
    synonymMap.set(term, normalized.filter((item) => item !== term));
  }
}

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

function splitFallback(input: string): string[] {
  const normalized = normalizeJapaneseText(input);
  const chunks = normalized.split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const chunk of chunks) {
    terms.push(chunk);
    const matches = chunk.match(/[a-z0-9]+|[ァ-ヶー]{2,}|[一-龥々〆ヵヶ]{2,}/g) || [];
    terms.push(...matches);
  }
  for (const group of DOMAIN_SYNONYM_GROUPS) {
    for (const term of group) {
      const normalizedTerm = normalizeJapaneseText(term);
      if (normalizedTerm && normalized.includes(normalizedTerm)) terms.push(normalizedTerm);
    }
  }
  return unique(terms).filter((term) => !STOP_WORDS.has(term) && term.length >= 2).slice(0, 40);
}

export async function analyzeJapaneseQuery(query: string): Promise<QueryAnalysis> {
  const normalized = normalizeJapaneseText(query);
  const tokens = splitFallback(query)
    .filter((term) => !STOP_WORDS.has(term) && term.length >= 2)
    .slice(0, 50);
  const expandedTerms = expandTerms(tokens);
  const importantTerms = unique([...tokens, ...expandedTerms]).slice(0, 80);
  return { original: query, normalized, tokens, expandedTerms, importantTerms, engine: 'ngram-fallback' };
}

export function expandTerms(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const direct = synonymMap.get(token);
    if (direct) expanded.push(...direct);
    for (const [key, values] of synonymMap) {
      if (key.includes(token) || token.includes(key)) expanded.push(key, ...values);
    }
  }
  return unique(expanded).slice(0, 100);
}

export function buildSmartFaqSearchText(item: SmartFaqSearchRecord): string {
  return [
    item.question,
    item.answer,
    item.category,
    Array.isArray(item.tags) ? item.tags.join(' ') : '',
    Array.isArray((item as any).keywords) ? (item as any).keywords.join(' ') : '',
    Array.isArray((item as any).examples) ? (item as any).examples.join(' ') : '',
    Array.isArray((item as any).testQuestions) ? (item as any).testQuestions.join(' ') : '',
    item.sourceType,
    item.sourceTitle,
    Array.isArray(item.sourceTitles) ? item.sourceTitles.join(' ') : '',
    item.sourcePdfName,
    item.sourcePage,
    item.sourceText,
    item.intent,
    item.intentId,
    Array.isArray(item.intentIds) ? item.intentIds.join(' ') : '',
    item.intentLabel,
    item.domain,
    item.domainId,
    item.status,
  ].filter(Boolean).map(String).join('\n').replace(/\s+/g, ' ').trim();
}

function createDocument(record: SmartFaqSearchRecord): SearchDocument {
  const question = String(record.question || '');
  const answer = String(record.answer || '');
  const category = String(record.category || '');
  const tags = [Array.isArray(record.tags) ? record.tags.join(' ') : '', Array.isArray((record as any).keywords) ? (record as any).keywords.join(' ') : '', Array.isArray((record as any).examples) ? (record as any).examples.join(' ') : '', Array.isArray((record as any).testQuestions) ? (record as any).testQuestions.join(' ') : ''].filter(Boolean).join(' ');
  const source = [
    record.sourceType,
    record.sourceTitle,
    Array.isArray(record.sourceTitles) ? record.sourceTitles.join(' ') : '',
    record.sourcePdfName,
    record.sourcePage,
    record.sourceText,
    record.intent,
    record.intentId,
    Array.isArray(record.intentIds) ? record.intentIds.join(' ') : '',
    record.intentLabel,
    record.domain,
    record.domainId,
  ].filter(Boolean).map(String).join(' ');
  const text = [question, answer, category, tags, source, record.status].filter(Boolean).join('\n');
  return {
    record,
    id: String(record.id),
    question,
    answer,
    category,
    tags,
    source,
    text,
    normalizedText: normalizeJapaneseText(text),
  };
}


function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeJapaneseText(term)));
}


type FaqIntentProfile = {
  id: string;
  domain: string;
  label: string;
  aliases?: string[];
  queryTerms: string[];
  evidenceTerms: string[];
  negativeTerms: string[];
};

const FAQ_INTENT_PROFILES: FaqIntentProfile[] = [
  { id: 'annual_leave', domain: 'leave', label: '年次有給休暇', aliases: ['leave.paid_start', 'leave_paid_start', 'leave_vacation', 'annual_leave', 'leave.annual', 'leave_annual'], queryTerms: ['有給', '有休', '年休', '年次有給休暇', '有給休暇', '年次休暇', 'いつから', 'いつから使える', 'いつから使用', '使えます', '使える', '取れます', '取得できます', '付与', '付与日', '取得開始', '取得'], evidenceTerms: ['有給', '有休', '年休', '年次有給休暇', '有給休暇', '年次休暇', '付与', '付与日', '付与日数', '取得', '使用', '採用日', '勤務条件', '継続勤務', '残日数', '時間単位'], negativeTerms: ['扶養手当', '通勤手当', '子の看護', '看護休暇', '発熱', '保育園', '就労要件', '育成料', '減免'] },
  { id: 'child_care_leave', domain: 'leave', label: '子の看護・休暇', queryTerms: ['子供', '子ども', 'こども', '子の看護', '看護休暇', '発熱', '熱', '病気', '休みたい', '休む'], evidenceTerms: ['子の看護', '看護休暇', '子どもの看護', '発熱', '病気', '体調不良', '所属へ連絡', '必要書類', '証明書類', '事後提出'], negativeTerms: ['育成料', '減免', '扶養手当', '通勤手当', '就労要件', '有給', '年休'] },
  { id: 'missed_deadline', domain: 'procedure', label: '期限超過・申請遅れ', queryTerms: ['期限が過ぎた', '締切が過ぎた', '申請遅れ', '間に合わない', '忘れた', '期限切れ', '遅れた', '過ぎてしまった'], evidenceTerms: ['期限', '締切', '期日', '申請期限', '提出期限', '期限後', '過ぎ', '遅れ', '間に合わ', '再申請', '随時受付', '担当窓口', '問い合わせ', '受付可否'], negativeTerms: ['子の看護', '看護休暇', '発熱', '扶養手当', '通勤手当', '就労要件', '有給', '育成料', '減免'] },
  { id: 'change_request', domain: 'procedure', label: '変更・修正', queryTerms: ['変更', '変えたい', '修正', '訂正', '間違えた', '変更届', '住所変更', '勤務先変更', '内容変更'], evidenceTerms: ['変更', '変更届', '修正', '訂正', '事前承認', '届出', '反映時期', '勤務時間', '勤務先', '住所変更', '内容変更'], negativeTerms: ['子の看護', '発熱', '扶養手当', '通勤手当', '年次有給', '育成料'] },
  { id: 'work_requirement', domain: 'eligibility', label: '就労要件', queryTerms: ['就労要件', '就労条件', '勤務終了時間', '午後4時', '16時', '週3日', '3か月', '働いていたら', '勤務条件'], evidenceTerms: ['就労要件', '就労条件', '勤務終了時間', '勤務日数', '勤務期間', '週3日', '3か月', '午後4時', '16時', '通勤時間', '継続勤務'], negativeTerms: ['有給', '年休', '扶養手当', '通勤手当', '子の看護', '看護休暇', '育成料'] },
  { id: 'allowance_dependent', domain: 'allowance', label: '扶養手当', queryTerms: ['扶養手当', '扶養対象', '扶養', '配偶者', '被扶養', '続柄', '同居', '別居'], evidenceTerms: ['扶養手当', '扶養対象', '収入状況', '続柄', '同居', '別居', '届出書', '証明書類'], negativeTerms: ['有給', '年休', '通勤手当', '子の看護', '看護休暇'] },
  { id: 'commute_allowance', domain: 'allowance', label: '通勤手当', queryTerms: ['通勤手当', '交通費', '通勤方法', '公共交通', '自転車', '自動車', '定期券'], evidenceTerms: ['通勤手当', '通勤方法', '交通費', '公共交通機関', '自転車', '自動車', '定期券', '必要書類'], negativeTerms: ['有給', '年休', '扶養手当', '子の看護', '看護休暇'] },
  { id: 'fee_general', domain: 'fee', label: '料金・費用', aliases: ['afterschool.fee', 'fee.general'], queryTerms: ['料金', '費用', '利用料', '育成料', '保育料', '月額', '金額', 'いくら', '支払い'], evidenceTerms: ['料金', '費用', '利用料', '育成料', '保育料', '月額', '延長料金', '支払い', '口座振替'], negativeTerms: ['減免', '免除', '割引', '非課税', '生活保護', 'ひとり親', '兄弟減額', '有給', '年休', '扶養手当', '通勤手当', '子の看護', '就労要件'] },
  { id: 'fee_reduction', domain: 'fee', label: '料金・減免', aliases: ['afterschool.reduction', 'fee.reduction'], queryTerms: ['減免', '免除', '割引', '安く', '非課税', '生活保護', 'ひとり親', '兄弟減額'], evidenceTerms: ['減免', '免除', '減額', '割引', '非課税', '生活保護', 'ひとり親', '兄弟減額', '対象条件', '必要書類'], negativeTerms: ['月額', '通常料金', '支払方法', '口座振替', '有給', '年休', '扶養手当', '通勤手当', '子の看護', '就労要件'] },
  { id: 'required_documents', domain: 'procedure', label: '必要書類', queryTerms: ['書類', '証明', '証明書', '添付', '必要なもの', 'いるもの', '提出物', '写真'], evidenceTerms: ['書類', '証明書', '添付', '提出', '必要書類', '確認書類', '様式', '資料'], negativeTerms: [] },
  { id: 'application_method', domain: 'procedure', label: '手続き・申請', queryTerms: ['申請', '申込', '申し込み', '手続', '方法', 'どうしたら', 'どうすれば', '提出', '連絡', '流れ'], evidenceTerms: ['申請', '申込', '手続', '提出', '連絡', 'フォーム', '電子申請', '窓口', '郵送', '届出'], negativeTerms: [] },
  { id: 'overview', domain: 'definition', label: '概要・意味', queryTerms: ['とは', '何ですか', '概要', '違い', 'どんな', '意味'], evidenceTerms: ['概要', '目的', '違い', '定義', '対象', '説明'], negativeTerms: [] },
];

function normalizeIntentValue(value: unknown): string {
  return normalizeJapaneseText(value).replace(/\s+/g, '_');
}

function getExplicitIntentValues(record: SmartFaqSearchRecord): string[] {
  return unique([
    record.intentId,
    ...(Array.isArray(record.intentIds) ? record.intentIds : []),
    ...(Array.isArray(record.intent) ? record.intent : [record.intent]),
    record.intentLabel,
    record.domain,
    record.domainId,
  ].filter(Boolean).map(String));
}

function scoreProfile(text: string, profile: FaqIntentProfile, mode: 'query' | 'record'): number {
  const positiveTerms = mode === 'query' ? profile.queryTerms : profile.evidenceTerms;
  return scoreIntentTerms(text, positiveTerms) * (mode === 'query' ? 16 : 12)
    + scoreIntentTerms(text, profile.evidenceTerms) * 4
    - scoreIntentTerms(text, profile.negativeTerms) * 18;
}

function classifyTextIntent(text: string, mode: 'query' | 'record'): { profile: FaqIntentProfile | null; score: number; runnerUpScore: number; confident: boolean } {
  const normalized = normalizeJapaneseText(text);
  const scored = FAQ_INTENT_PROFILES.map((profile) => ({ profile, score: scoreProfile(normalized, profile, mode) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];
  const score = Math.max(0, top?.score || 0);
  const runnerUpScore = Math.max(0, second?.score || 0);
  return {
    profile: score > 0 ? top.profile : null,
    score,
    runnerUpScore,
    confident: score >= (mode === 'query' ? 16 : 18) && score - runnerUpScore >= (mode === 'query' ? 6 : 8),
  };
}

function classifyRecordIntent(record: SmartFaqSearchRecord, haystack: string): { profile: FaqIntentProfile | null; score: number; runnerUpScore: number; confident: boolean; explicit: boolean } {
  const explicitValues = getExplicitIntentValues(record).map(normalizeIntentValue);
  for (const profile of FAQ_INTENT_PROFILES) {
    const ids = [profile.id, profile.domain, profile.label, ...(profile.aliases || [])].map(normalizeIntentValue);
    if (explicitValues.some((value) => ids.includes(value))) {
      return { profile, score: 100, runnerUpScore: 0, confident: true, explicit: true };
    }
  }
  return { ...classifyTextIntent(haystack, 'record'), explicit: false };
}

function applyIntentMetadataGate(score: number, query: ReturnType<typeof classifyTextIntent>, record: ReturnType<typeof classifyRecordIntent>): number {
  if (!query.profile || !query.confident) return score;
  if (!record.profile) return score - 12;
  if (record.profile.id === query.profile.id) return score + (record.explicit ? 90 : 55);
  if (record.profile.domain === query.profile.domain) return score + (record.explicit ? 28 : 12);
  return score - (record.explicit || record.confident ? 110 : 45);
}

function analyzeIntent(analysis: QueryAnalysis): {
  isWorkRequirementQuery: boolean;
  isFeeQuery: boolean;
  isApplicationQuery: boolean;
  isMissedDeadlineQuery: boolean;
  isDocumentQuery: boolean;
  isScheduleQuery: boolean;
  isGradeQuery: boolean;
  isWithdrawalQuery: boolean;
  isChangeQuery: boolean;
  isAvailabilityQuery: boolean;
  isOverviewQuery: boolean;
  isVagueEligibilityQuery: boolean;
  isHowToQuery: boolean;
  isCanDoQuery: boolean;
  isHelpQuery: boolean;
  isChildCareLeaveQuery: boolean;
  isAnnualLeaveQuery: boolean;
  isAllowanceQuery: boolean;
  isCommuteQuery: boolean;
} {
  const queryText = normalizeJapaneseText([
    analysis.original,
    analysis.normalized,
    ...analysis.tokens,
    ...analysis.expandedTerms,
  ].join(' '));
  const workTerms = ['就労', '仕事', '勤務', '働く', '勤務時間', '勤務日', '終業', '退勤', '労働', '雇用', 'パート', 'フルタイム'];
  const requirementTerms = ['要件', '条件', '基準', '対象', '資格', '何時', '何日', '週何日', '入れる', '申し込める', '必要'];
  const feeTerms = ['料金', '費用', '利用料', '育成料', '保育料', '減免', '免除', '兄弟', '割引', '安く'];
  const applicationTerms = ['申請', '申込', '申し込み', '手続', '期限', 'いつまで', '電子申請', 'ロゴフォーム', 'logo', '受付'];
  const missedDeadlineTerms = ['期限過ぎ', '期限切れ', '締切過ぎ', '締め切り過ぎ', '間に合わない', '遅れた', '過ぎてしまった', '忘れた', '期限後'];
  const documentTerms = ['書類', '就労証明', '勤務証明', '証明書', '添付', '写真', 'シフト', '自営業', 'フリーランス'];
  const scheduleTerms = ['延長', '土曜', '土曜日', '休業日', '長期休業', '夏休み', '春休み', '冬休み', '時間'];
  const gradeTerms = ['何年生', '学年', '1年生', '2年生', '3年生', '4年生', '5年生', '6年生', '小学生'];
  const withdrawalTerms = ['退会', 'やめる', '辞める', '利用停止'];
  const changeTerms = ['変更', '転職', '勤務先変更', '住所変更', '内容変更'];
  const availabilityTerms = ['空き', '待機', '入れるか', '空いて', '定員'];
  const overviewTerms = ['違い', '概要', 'どんな', '何ですか', 'キッズスクエア'];
  const vagueEligibilityTerms = ['対象', '条件', '要件', '基準', '資格', '誰が', 'どんな人', '入れる', '申し込める', '使える', '利用できる', '該当', '対象になる'];
  const howToTerms = ['どうしたらいい', 'どうすればいい', '何をすればいい', '方法', 'やり方', '手順', '流れ', '手続き'];
  const canDoTerms = ['できる', '可能', 'いける', '大丈夫', '使える', '利用できる', '申し込める', '入れる'];
  const helpTerms = ['困った', 'わからない', '不安', '相談', '問い合わせ', '聞きたい', '確認したい'];
  const childCareLeaveTerms = ['子供', '子ども', 'こども', '子の看護', '看護休暇', '発熱', '熱', '病気', '体調不良', '休みたい', '休む', '休暇'];
  const childCareLeaveNegativeTerms = ['料金', '費用', '育成料', '利用料', '保育料', '減免', '免除', '割引', '安く', '支払い'];
  const annualLeaveTerms = ['有給', '有休', '年休', '年次有給休暇', '有給休暇', '年次休暇', '付与', 'いつから使える', 'いつから使用', '取得できる'];
  const annualLeaveNegativeTerms = ['扶養', '扶養手当', '通勤手当', '通勤方法', '交通費', '子の看護', '看護休暇', '忌引', '就労要件', '育成料', '減免'];
  const allowanceTerms = ['扶養手当', '扶養', '扶養対象', '手当', '配偶者', '被扶養'];
  const commuteTerms = ['通勤手当', '通勤方法', '交通費', '公共交通', '自転車', '自動車', '定期券'];
  return {
    isWorkRequirementQuery: hasAny(queryText, workTerms) && (hasAny(queryText, requirementTerms) || hasAny(queryText, ['16時', '4時', '週3日', '三日', '3か月', '通勤'])),
    isFeeQuery: hasAny(queryText, feeTerms),
    isApplicationQuery: hasAny(queryText, applicationTerms),
    isMissedDeadlineQuery: hasAny(queryText, missedDeadlineTerms) || (hasAny(queryText, ['期限', '締切', '期日', '申請', '提出']) && hasAny(queryText, ['過ぎ', '遅れ', '間に合わ', '忘れ', '期限切れ'])),
    isDocumentQuery: hasAny(queryText, documentTerms),
    isScheduleQuery: hasAny(queryText, scheduleTerms),
    isGradeQuery: hasAny(queryText, gradeTerms),
    isWithdrawalQuery: hasAny(queryText, withdrawalTerms),
    isChangeQuery: hasAny(queryText, changeTerms),
    isAvailabilityQuery: hasAny(queryText, availabilityTerms),
    isOverviewQuery: hasAny(queryText, overviewTerms),
    isVagueEligibilityQuery: hasAny(queryText, vagueEligibilityTerms),
    isHowToQuery: hasAny(queryText, howToTerms),
    isCanDoQuery: hasAny(queryText, canDoTerms),
    isHelpQuery: hasAny(queryText, helpTerms),
    isChildCareLeaveQuery: hasAny(queryText, childCareLeaveTerms) && !hasAny(queryText, childCareLeaveNegativeTerms),
    isAnnualLeaveQuery: hasAny(queryText, annualLeaveTerms) && !hasAny(queryText, annualLeaveNegativeTerms),
    isAllowanceQuery: hasAny(queryText, allowanceTerms) && !hasAny(queryText, ['有給', '年休', '子の看護', '通勤手当']),
    isCommuteQuery: hasAny(queryText, commuteTerms) && !hasAny(queryText, ['有給', '年休', '扶養手当']),
  };
}


function scoreIntentTerms(text: string, terms: string[]): number {
  return terms.reduce((sum, term) => sum + (text.includes(normalizeJapaneseText(term)) ? 1 : 0), 0);
}

function applyIntentBoosts(score: number, intent: ReturnType<typeof analyzeIntent>, haystack: string): number {
  const concreteIntent = intent.isWorkRequirementQuery || intent.isFeeQuery || intent.isApplicationQuery || intent.isDocumentQuery || intent.isScheduleQuery || intent.isGradeQuery || intent.isWithdrawalQuery || intent.isChangeQuery || intent.isAvailabilityQuery || intent.isAnnualLeaveQuery || intent.isAllowanceQuery || intent.isCommuteQuery || intent.isMissedDeadlineQuery;
  let next = score;
  if (intent.isWorkRequirementQuery) next += scoreIntentTerms(haystack, ['就労要件', '就労条件', '勤務終了時間', '午後4時', '16時', '週3日', '3か月', '継続勤務', '通勤時間']) * 8;
  if (intent.isFeeQuery) next += scoreIntentTerms(haystack, ['育成料', '利用料', '料金', '減額', '免除', '減免', '兄弟減額']) * 8;
  if (intent.isMissedDeadlineQuery) {
    next += scoreIntentTerms(haystack, ['期限', '締切', '期日', '受付期間', '申請期限', '提出期限', '過ぎ', '遅れ', '間に合わ', '期限後', '再申請', '随時受付', '担当窓口', '問い合わせ']) * 14;
    next -= scoreIntentTerms(haystack, ['子の看護', '看護休暇', '発熱', '扶養手当', '通勤手当', '就労要件', '勤務終了時間', '年次有給', '有給休暇', '育成料', '減免']) * 18;
  }
  if (intent.isApplicationQuery) next += scoreIntentTerms(haystack, ['申請', '申込', '申し込み', '期限', '電子申請', 'logoフォーム', '利用開始希望日', '2週間前']) * 7;
  if (intent.isDocumentQuery) next += scoreIntentTerms(haystack, ['就労証明書', '勤務証明', '証明書', '添付書類', 'シフト表', '自営業', '内職', 'フリーランス']) * 8;
  if (intent.isScheduleQuery) next += scoreIntentTerms(haystack, ['延長', '土曜', '土曜日', '長期休業', '夏休み', '休業日', '利用時間']) * 7;
  if (intent.isGradeQuery) next += scoreIntentTerms(haystack, ['小学校1年生', '1年生', '6年生', '小学生', '学年']) * 7;
  if (intent.isWithdrawalQuery) next += scoreIntentTerms(haystack, ['退会', '退会届', '利用停止', 'やめる']) * 9;
  if (intent.isChangeQuery) next += scoreIntentTerms(haystack, ['変更', '転職', '勤務先変更', '変更届', '届出']) * 8;
  if (intent.isAvailabilityQuery) next += scoreIntentTerms(haystack, ['空き', '待機', '待機児童', '定員', '入会可否']) * 8;
  if (intent.isAnnualLeaveQuery) {
    next += scoreIntentTerms(haystack, ['有給', '有休', '年休', '年次有給休暇', '有給休暇', '年次休暇', '付与', '取得', '使用', '採用日', '勤務条件', '継続勤務']) * 12;
    next -= scoreIntentTerms(haystack, ['扶養手当', '扶養対象', '通勤手当', '交通費', '子の看護', '看護休暇', '忌引', '育成料', '減免', '就労要件']) * 18;
  }
  if (intent.isAllowanceQuery) {
    next += scoreIntentTerms(haystack, ['扶養手当', '扶養対象', '収入状況', '続柄', '同居', '別居', '届出書', '証明書類']) * 10;
    next -= scoreIntentTerms(haystack, ['有給', '年休', '年次有給休暇', '看護休暇', '通勤手当', '育成料']) * 16;
  }
  if (intent.isCommuteQuery) {
    next += scoreIntentTerms(haystack, ['通勤手当', '通勤方法', '交通費', '公共交通機関', '自転車', '自動車', '定期券', '必要書類']) * 10;
    next -= scoreIntentTerms(haystack, ['有給', '年休', '扶養手当', '子の看護', '育成料']) * 16;
  }
  if (intent.isChildCareLeaveQuery) {
    next += scoreIntentTerms(haystack, ['子の看護', '看護休暇', '子どもの看護', '子供の看護', '発熱', '熱', '病気', '休暇', '休む', '所属へ連絡', '必要書類', '証明書類']) * 10;
    next -= scoreIntentTerms(haystack, ['料金', '費用', '育成料', '利用料', '保育料', '減免', '免除', '兄弟', '割引', '支払い', '月額', '減額', '扶養手当', '通勤手当', '就労要件']) * 14;
  }
  if (intent.isVagueEligibilityQuery) next += scoreIntentTerms(haystack, ['対象', '条件', '要件', '基準', '資格', '入会要件', '就労要件', '市内在住', '小学生']) * 5;
  if (intent.isHowToQuery) next += scoreIntentTerms(haystack, ['申請', '手続', '提出', '必要書類', '電子申請', '届出', '期限']) * 5;
  if (intent.isCanDoQuery) next += scoreIntentTerms(haystack, ['利用できる', '対象', '要件', '条件', '申請', '入会', '利用']) * 4;
  // Generic domain-independent boosts: works for childcare, HR, IT, procedures, manuals, etc.
  next += scoreIntentTerms(haystack, ['対象', '条件', '要件', '基準', '資格', '該当', '可能']) * 3;
  next += scoreIntentTerms(haystack, ['申請', '申込', '手続', '提出', '登録', '方法', '流れ']) * 3;
  next += scoreIntentTerms(haystack, ['必要書類', '書類', '証明書', '添付', '提出物']) * 3;
  next += scoreIntentTerms(haystack, ['料金', '費用', '金額', '支払い', '減免', '免除']) * 3;
  next += scoreIntentTerms(haystack, ['期限', '締切', '期日', '受付', '開始', '終了']) * 3;
  next += scoreIntentTerms(haystack, ['変更', '取消', '退会', '停止', '修正', '訂正']) * 3;
  next += scoreIntentTerms(haystack, ['問い合わせ', '相談', '窓口', '担当', '確認']) * 3;
  if ((concreteIntent || intent.isVagueEligibilityQuery || intent.isHowToQuery) && scoreIntentTerms(haystack, ['概要', '目的', 'キッズスクエア', '安全な遊び場', '事業です']) >= 2) next -= 20;
  return next;
}

function countTermHits(text: string, terms: string[]): { count: number; terms: string[] } {
  const hits: string[] = [];
  for (const term of terms) {
    if (term.length < 2) continue;
    if (text.includes(term)) hits.push(term);
  }
  return { count: hits.length, terms: unique(hits).slice(0, 15) };
}

function scoreDocument(doc: SearchDocument, analysis: QueryAnalysis, fuseScore?: number): RankedFaqSearchResult | null {
  const normalizedQuestion = normalizeJapaneseText(doc.question);
  const normalizedAnswer = normalizeJapaneseText(doc.answer);
  const normalizedCategory = normalizeJapaneseText(doc.category);
  const normalizedTags = normalizeJapaneseText(doc.tags);
  const normalizedSource = normalizeJapaneseText(doc.source);
  const allTerms = analysis.importantTerms;
  const directTerms = analysis.tokens;
  const intent = analyzeIntent(analysis);

  const questionHits = countTermHits(normalizedQuestion, allTerms);
  const answerHits = countTermHits(normalizedAnswer, allTerms);
  const categoryHits = countTermHits(normalizedCategory, allTerms);
  const tagHits = countTermHits(normalizedTags, allTerms);
  const sourceHits = countTermHits(normalizedSource, allTerms);
  const directHits = countTermHits(doc.normalizedText, directTerms);

  const exactPhraseHit = analysis.normalized && doc.normalizedText.includes(analysis.normalized);
  const questionPhraseHit = analysis.normalized && normalizedQuestion.includes(analysis.normalized);
  const statusBoost = doc.record.status === 'approved' ? 8 : doc.record.status === 'reviewed' ? 5 : doc.record.status === 'draft' ? 0 : -8;
  const sourceConfidence = Number.isFinite(Number(doc.record.confidence)) ? Math.max(0, Math.min(100, Number(doc.record.confidence))) : 70;
  const fuseBoost = typeof fuseScore === 'number' ? Math.max(0, 18 * (1 - Math.min(1, fuseScore))) : 0;

  let score = 0;
  score += questionHits.count * 11;
  score += answerHits.count * 5;
  score += categoryHits.count * 8;
  score += tagHits.count * 8;
  score += sourceHits.count * 3;
  score += directHits.count * 6;
  score += exactPhraseHit ? 22 : 0;
  score += questionPhraseHit ? 18 : 0;
  score += statusBoost;
  score += fuseBoost;
  score += Math.min(8, sourceConfidence / 15);

  const intentHaystack = [normalizedQuestion, normalizedAnswer, normalizedCategory, normalizedTags, normalizedSource].join(' ');
  score = applyIntentBoosts(score, intent, intentHaystack);

  // V189: metadata-first intent/domain gate. If FAQ JSON has intent/domain, trust it more than fuzzy text.
  const queryIntent = classifyTextIntent([analysis.original, analysis.normalized, ...analysis.tokens, ...analysis.expandedTerms].join(' '), 'query');
  const recordIntent = classifyRecordIntent(doc.record, intentHaystack);
  score = applyIntentMetadataGate(score, queryIntent, recordIntent);

  if (intent.isWorkRequirementQuery) {
    const focusedWorkTerms = ['就労要件', '就労条件', '勤務終了時間', '午後4時', '16時', '週3日', '3か月', '継続勤務', '通勤時間'];
    const genericOverviewTerms = ['概要', '目的', 'キッズスクエア', '安全な遊び場', '事業です', '対象や目的'];
    const titleHasFocusedWork = hasAny(normalizedQuestion, focusedWorkTerms);
    const answerHasFocusedWork = hasAny(normalizedAnswer, focusedWorkTerms);
    const isGenericOverview = hasAny(normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedCategory + ' ' + normalizedTags, genericOverviewTerms);

    if (titleHasFocusedWork) score += 46;
    if (answerHasFocusedWork) score += 34;
    if (normalizedQuestion.includes('就労') && hasAny(normalizedQuestion, ['要件', '条件'])) score += 28;
    if (isGenericOverview && !titleHasFocusedWork && !answerHasFocusedWork) score -= 42;
  }

  if (intent.isVagueEligibilityQuery) {
    const eligibilityText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedCategory + ' ' + normalizedTags;
    if (hasAny(eligibilityText, ['入会要件', '就労要件', '対象', '条件', '基準', '資格', '市内在住', '小学生'])) score += 18;
    if (intent.isCanDoQuery && hasAny(eligibilityText, ['できる', '利用できる', '申し込める', '入会', '対象'])) score += 8;
  }
  if (intent.isHowToQuery) {
    const howToText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags;
    if (hasAny(howToText, ['申請', '手続', '提出', '必要書類', '電子申請', '期限', '届出'])) score += 18;
  }
  if (intent.isHelpQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags, ['問い合わせ', '相談', '確認', '担当', '窓口'])) score += 12;
  if (intent.isAnnualLeaveQuery) {
    const annualText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags + ' ' + normalizedCategory;
    if (hasAny(annualText, ['有給', '有休', '年休', '年次有給休暇', '有給休暇', '年次休暇'])) score += 56;
    if (hasAny(annualText, ['付与', 'いつから', '取得', '使用', '採用日', '勤務条件', '継続勤務'])) score += 34;
    if (hasAny(annualText, ['扶養手当', '扶養対象', '通勤手当', '通勤方法', '交通費', '子の看護', '看護休暇', '忌引', '育成料', '減免', '就労要件'])) score -= 82;
  }
  if (intent.isAllowanceQuery) {
    const allowanceText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags + ' ' + normalizedCategory;
    if (hasAny(allowanceText, ['扶養手当', '扶養対象', '収入状況', '続柄', '同居', '別居'])) score += 44;
    if (hasAny(allowanceText, ['有給', '年休', '年次有給休暇', '通勤手当', '看護休暇'])) score -= 60;
  }
  if (intent.isCommuteQuery) {
    const commuteText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags + ' ' + normalizedCategory;
    if (hasAny(commuteText, ['通勤手当', '通勤方法', '交通費', '公共交通機関', '自転車', '自動車'])) score += 44;
    if (hasAny(commuteText, ['有給', '年休', '扶養手当', '看護休暇'])) score -= 60;
  }
  if (intent.isChildCareLeaveQuery) {
    const leaveText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags + ' ' + normalizedCategory;
    if (hasAny(leaveText, ['子の看護', '看護休暇', '子どもの看護', '子供の看護', '発熱', '熱', '病気', '休暇', '休む'])) score += 38;
    if (hasAny(leaveText, ['料金', '費用', '育成料', '利用料', '保育料', '減免', '免除', '兄弟', '割引', '支払い', '月額', '減額', '扶養手当', '通勤手当', '就労要件'])) score -= 70;
  }
  if (intent.isFeeQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags, ['育成料', '利用料', '料金', '減免', '兄弟'])) score += 20;
  if (intent.isMissedDeadlineQuery) {
    const deadlineText = normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags + ' ' + normalizedCategory;
    if (hasAny(deadlineText, ['期限', '締切', '期日', '受付期間', '申請期限', '提出期限', '期限後', '過ぎ', '遅れ', '間に合わ', '再申請', '随時受付', '担当窓口', '問い合わせ'])) score += 72;
    if (hasAny(deadlineText, ['子の看護', '看護休暇', '発熱', '扶養手当', '通勤手当', '就労要件', '勤務終了時間', '年次有給', '有給休暇', '育成料', '減免'])) score -= 88;
  }
  if (intent.isApplicationQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer + ' ' + normalizedTags, ['申請', '申込', '申し込み', '期限', '電子申請', '書類'])) score += 18;

  if (score < 8 && !exactPhraseHit && directHits.count === 0) return null;

  const matchedTerms = unique([
    ...questionHits.terms,
    ...answerHits.terms,
    ...categoryHits.terms,
    ...tagHits.terms,
    ...sourceHits.terms,
    ...directHits.terms,
  ]).slice(0, 12);

  const reasons: string[] = [];
  reasons.push('日本語正規化 + n-gram検索');
  {
    const queryIntentForReason = classifyTextIntent([analysis.original, analysis.normalized, ...analysis.tokens, ...analysis.expandedTerms].join(' '), 'query');
    const recordIntentForReason = classifyRecordIntent(doc.record, [normalizedQuestion, normalizedAnswer, normalizedCategory, normalizedTags, normalizedSource].join(' '));
    if (queryIntentForReason.profile?.id && recordIntentForReason.profile?.id === queryIntentForReason.profile.id) reasons.push(`Intent一致: ${queryIntentForReason.profile.label}`);
    else if (queryIntentForReason.profile && recordIntentForReason.profile?.domain === queryIntentForReason.profile.domain) reasons.push(`同一分野: ${queryIntentForReason.profile.domain}`);
    if (recordIntentForReason.explicit) reasons.push('FAQメタデータIntentを優先');
  }
  if (questionHits.count) reasons.push(`質問タイトル一致: ${questionHits.terms.slice(0, 4).join(' / ')}`);
  if (answerHits.count) reasons.push(`回答本文一致: ${answerHits.terms.slice(0, 4).join(' / ')}`);
  if (categoryHits.count || tagHits.count) reasons.push('カテゴリ・タグ一致');
  if (exactPhraseHit) reasons.push('検索文の直接一致');
  if (analysis.expandedTerms.some((term) => matchedTerms.includes(term) && !analysis.tokens.includes(term))) reasons.push('同義語・業務用語辞書一致');
  if (intent.isWorkRequirementQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['就労要件', '勤務終了時間', '午後4時', '週3日', '3か月'])) reasons.push('就労条件の意図に一致');
  if (intent.isFeeQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['育成料', '料金', '減免', '兄弟'])) reasons.push('料金・減免の意図に一致');
  if (intent.isMissedDeadlineQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['期限', '締切', '期日', '過ぎ', '期限後', '再申請', '問い合わせ'])) reasons.push('期限超過・申請遅れの意図に一致');
  if (intent.isApplicationQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['申請', '申込', '期限', '電子申請'])) reasons.push('申請手続きの意図に一致');
  if (intent.isDocumentQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['証明書', '添付', 'シフト', '自営業'])) reasons.push('必要書類の意図に一致');
  if (intent.isScheduleQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['延長', '土曜', '夏休み', '時間'])) reasons.push('利用時間・休業日の意図に一致');
  if (intent.isVagueEligibilityQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['対象', '条件', '要件', '基準', '資格'])) reasons.push('曖昧な対象・条件意図を補正');
  if (intent.isHowToQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['申請', '手続', '提出', '必要書類'])) reasons.push('手順・方法の意図に一致');
  if (intent.isCanDoQuery) reasons.push('可能性確認の言い回しを補正');
  if (intent.isAnnualLeaveQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['有給', '年休', '年次有給休暇', '付与', '取得'])) reasons.push('年次有給休暇の意図に一致');
  if (intent.isAllowanceQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['扶養手当', '扶養対象'])) reasons.push('扶養手当の意図に一致');
  if (intent.isCommuteQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['通勤手当', '交通費', '通勤方法'])) reasons.push('通勤手当の意図に一致');
  if (intent.isChildCareLeaveQuery && hasAny(normalizedQuestion + ' ' + normalizedAnswer, ['子の看護', '看護休暇', '発熱', '休暇', '休む'])) reasons.push('子の看護・休暇の意図に一致');
  if (doc.record.status === 'approved') reasons.push('承認済みFAQ');
  else if (doc.record.status === 'reviewed') reasons.push('確認済みFAQ');

  const boundedScore = Math.max(1, Math.min(100, Math.round(score)));
  return {
    record: doc.record,
    score: boundedScore,
    reasons: reasons.slice(0, 6),
    matchedTerms,
    confidenceLabel: boundedScore >= 78 ? '高' : boundedScore >= 50 ? '中' : '低',
  };
}

export async function rankSmartFaqRecords(
  query: string,
  records: SmartFaqSearchRecord[],
  options: { limit?: number; offset?: number } = {},
): Promise<{ results: RankedFaqSearchResult[]; total: number; mode: string; analysis: QueryAnalysis }> {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  const offset = Math.max(0, Number(options.offset || 0));
  const analysis = await analyzeJapaneseQuery(query);
  const docs = records.map(createDocument);

  // v216: Fuse.js dependency removed. Legacy ranker now uses deterministic token scoring only.
  const fuseScores = new Map<string, number>();


  const ranked = docs
    .map((doc) => scoreDocument(doc, analysis, fuseScores.get(doc.id)))
    .filter((result): result is RankedFaqSearchResult => Boolean(result))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aTime = Date.parse(String(a.record.updatedAt || '')) || 0;
      const bTime = Date.parse(String(b.record.updatedAt || '')) || 0;
      return bTime - aTime;
    });

  return {
    results: ranked.slice(offset, offset + limit),
    total: ranked.length,
    mode: `legacy-token-ranker:${analysis.engine}`, 
    analysis,
  };
}
