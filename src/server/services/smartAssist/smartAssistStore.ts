import path from 'path';
import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import { vaultPaths } from '../../utils/paths';
import { ItemCollection } from '../sharedData/itemCollection';

type AtomicWriteJson = (file: string, data: unknown) => Promise<void>;

type SharedJsonMutation = <T>(file: string, task: () => Promise<T>) => Promise<T>;

type StoreOptions = {
  sharedRoot: string;
  userLabel: () => string;
  atomicWriteJson: AtomicWriteJson;
  withSharedJsonMutation?: SharedJsonMutation;
  onBadFeedback?: (item: any) => Promise<void>;
};

export type SmartAssistTransformerSettings = {
  enabled: boolean;
  modelId: string;
  modelRoot?: string;
  localModelPath?: string;
  localCacheDir?: string;
  provider?: string;
  semanticIdleEnabled?: boolean;
  semanticIdleBatchSize?: number;
  semanticIdleDelaySec?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type SmartAssistGenerationSettings = {
  enabled: boolean;
  provider: 'none' | 'llama-cpp';
  modelRoot?: string;
  selectedModelPath?: string;
  llamaExecutablePath?: string;
  llamaRuntimeDir?: string;
  preset?: 'fast' | 'light' | 'balanced' | 'manual';
  performanceMode?: 'fast' | 'standard' | 'quality';
  retryMode?: 'off' | 'on-error' | 'full';
  generationRuntimeMode?: 'oneshot' | 'server';
  llamaServerExecutablePath?: string;
  llamaServerHost?: string;
  llamaServerPort?: number;
  llamaServerAutoStart?: boolean;
  llamaServerFallback?: boolean;
  contextSize: number;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
  totalTimeoutMs?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type SmartAssistSynonymEntry = {
  id: string;
  base: string;
  variants: string[];
  category?: string;
  intentId?: string;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type SmartAssistRuleProfileEntry = {
  id: string;
  label: string;
  description?: string;
  terms: string[];
  boostTerms: string[];
  category?: string;
  intentId?: string;
  questionTypes?: string[];
  negativeTerms?: string[];
  parentIntentIds?: string[];
  weight?: number;
  enabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type SmartAssistEvaluationEntry = {
  id: string;
  question: string;
  expectedFaqId: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
};

const DEFAULT_SMART_ASSIST_SYNONYMS: SmartAssistSynonymEntry[] = [
  { id: 'syn_leave_paid', base: '年次有給休暇', variants: ['有給', '有休', '年休', '年次休暇', '有給休暇', '年次有給休暇', '有給付与', '年休付与'], category: '休暇', intentId: 'leave.paid_start', enabled: true },
  { id: 'syn_leave_child_sick', base: '子の看護休暇', variants: ['子どもが熱', '子供が熱', '発熱', '保育園から呼び出し', '急に休む', '看護休暇'], category: '休暇', intentId: 'leave.child_sick', enabled: true },
  { id: 'syn_application_cancel', base: '申請取消', variants: ['取り消し', '取消', 'キャンセル', '取り下げ', '間違えて申請', '訂正', '変更申請'], category: '申請・手続き', intentId: 'application.cancel', enabled: true },
  { id: 'syn_deadline_missed', base: '申請期限超過', variants: ['締切過ぎた', '期限過ぎた', '提出期限超過', '間に合わない', '申請忘れ', '期限後'], category: '申請・手続き', intentId: 'application.deadline_missed', enabled: true },
  { id: 'syn_commuting_allowance', base: '通勤手当', variants: ['交通費', '通勤費', '定期代', '電車代', 'バス代', '通勤経路'], category: '給与・手当', intentId: 'allowance.commuting', enabled: true },
  { id: 'syn_afterschool_fee', base: '放課後児童クラブ利用料', variants: ['学童費用', '学童の費用', '学童料金', '学童の料金', '放課後児童クラブ費用', '放課後児童クラブ利用料', '月額料金', '月額利用料', '延長料金'], category: '放課後児童クラブ', intentId: 'afterschool.fee', enabled: true },
  { id: 'syn_afterschool_reduction', base: '放課後児童クラブ減免', variants: ['学童減免', '減免制度', '利用料減免', '免除', '安くなる', '兄弟減免'], category: '放課後児童クラブ', intentId: 'afterschool.reduction', enabled: true },
  { id: 'syn_lgwan', base: 'LGWAN', variants: ['庁内ネットワーク', '情報セキュリティ', '外部サービス', 'クラウド利用', 'USB'], category: '情報システム', intentId: 'system.lgwan_external_service', enabled: true },
];

const DEFAULT_SMART_ASSIST_RULE_PROFILES: SmartAssistRuleProfileEntry[] = [
  {
    id: 'rule_leave_paid_start',
    label: '有給・年休の取得開始',
    description: '「有給はいつから」「年休はいつ付与」など短い質問を年休・有給系FAQへ寄せる汎用ルール。',
    enabled: true,
    category: '休暇',
    intentId: 'leave.paid_start',
    terms: ['有給', '有休', '年休', '年次休暇', '有給休暇'],
    boostTerms: ['いつから', '付与', '付与日', '使える', '使えます', '取得開始', '開始'],
    questionTypes: ['start_or_grant'],
    negativeTerms: ['子ども', '子供', '発熱', '保育園', '看護休暇', '子の看護'],
    parentIntentIds: ['leave.annual', 'leave_vacation', 'annual_leave'],
  },
  {
    id: 'rule_application_cancel',
    label: '申請取消・取り下げ',
    enabled: true,
    category: '申請・手続き',
    intentId: 'application.cancel',
    terms: ['申請', '手続き'],
    boostTerms: ['取消', '取り消し', '取り下げ', 'キャンセル', '訂正', '間違えて申請'],
    questionTypes: ['cancel_or_correction'],
  },
  {
    id: 'rule_required_documents',
    label: '必要書類・添付書類',
    enabled: true,
    category: '申請・手続き',
    intentId: 'application.required_documents',
    terms: ['申請', '手続き', '書類'],
    boostTerms: ['必要書類', '添付', '様式', '証明書', '何が必要'],
    questionTypes: ['required_documents'],
  },
  {
    id: 'rule_method_howto',
    label: '方法・手順',
    enabled: true,
    category: '申請・手続き',
    intentId: 'application.method',
    terms: ['申請', '手続き', '方法'],
    boostTerms: ['どうやって', 'どこに', '提出方法', '申請方法', '手順'],
    questionTypes: ['method'],
  },
  {
    id: 'rule_afterschool_fee',
    label: '学童・放課後児童クラブ費用',
    description: '「学童の費用」「利用料を確認」「月額料金」など短い質問を学童費用FAQへ寄せる汎用ルール。',
    enabled: true,
    category: '放課後児童クラブ',
    intentId: 'afterschool.fee',
    terms: ['学童', '放課後児童クラブ', '児童クラブ'],
    boostTerms: ['費用', '料金', '利用料', '月額', '確認', 'いくら', '支払', '延長料金'],
    questionTypes: ['fee_or_price'],
    negativeTerms: ['有給', '年休', 'LGWAN', '通勤手当'],
    parentIntentIds: ['afterschool.fee'],
  },
  {
    id: 'rule_afterschool_reduction',
    label: '学童・放課後児童クラブ減免',
    enabled: true,
    category: '放課後児童クラブ',
    intentId: 'afterschool.reduction',
    terms: ['学童', '放課後児童クラブ', '減免'],
    boostTerms: ['減免', '免除', '安く', '非課税', '兄弟', '生活保護'],
    questionTypes: ['reduction_or_exemption'],
  },
];

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

function normalizeSynonymEntry(item: any, userLabel = 'system'): SmartAssistSynonymEntry | null {
  const variants = Array.isArray(item?.variants) ? item.variants.map(String) : [];
  const base = String(item?.base || item?.label || variants[0] || '').trim();
  if (!base || !variants.length) return null;
  return {
    id: String(item?.id || `syn_${nanoid(10)}`),
    base,
    variants: uniqueStrings(variants, 80),
    category: item?.category ? String(item.category) : undefined,
    intentId: item?.intentId ? String(item.intentId) : undefined,
    enabled: item?.enabled !== false,
    createdAt: String(item?.createdAt || new Date().toISOString()),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
    updatedBy: String(item?.updatedBy || userLabel),
  };
}

function normalizeRuleProfileEntry(item: any, userLabel = 'system'): SmartAssistRuleProfileEntry | null {
  const terms = Array.isArray(item?.terms) ? item.terms.map(String) : [];
  const boostTerms = Array.isArray(item?.boostTerms) ? item.boostTerms.map(String) : [];
  const label = String(item?.label || '').trim();
  if (!label || !terms.length) return null;
  return {
    id: String(item?.id || `rule_${nanoid(10)}`),
    label,
    description: item?.description ? String(item.description).slice(0, 800) : undefined,
    terms: uniqueStrings(terms, 80),
    boostTerms: uniqueStrings(boostTerms, 80),
    category: item?.category ? String(item.category) : undefined,
    intentId: item?.intentId ? String(item.intentId) : undefined,
    questionTypes: Array.isArray(item?.questionTypes) ? uniqueStrings(item.questionTypes.map(String), 20) : undefined,
    negativeTerms: Array.isArray(item?.negativeTerms) ? uniqueStrings(item.negativeTerms.map(String), 40) : undefined,
    parentIntentIds: Array.isArray(item?.parentIntentIds) ? uniqueStrings(item.parentIntentIds.map(String), 20) : undefined,
    weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : undefined,
    enabled: item?.enabled !== false,
    createdAt: String(item?.createdAt || new Date().toISOString()),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
    updatedBy: String(item?.updatedBy || userLabel),
  };
}


function normalizeEvaluationEntry(item: any, userLabel = 'system'): SmartAssistEvaluationEntry | null {
  const question = String(item?.question || '').trim();
  const expectedFaqId = String(item?.expectedFaqId || item?.faqId || '').trim();
  if (!question || !expectedFaqId) return null;
  return {
    id: String(item?.id || `eval_${nanoid(12)}`),
    question: question.slice(0, 5000),
    expectedFaqId,
    note: String(item?.note || '').slice(0, 400) || undefined,
    createdAt: String(item?.createdAt || new Date().toISOString()),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
    updatedBy: String(item?.updatedBy || userLabel),
  };
}

export class SmartAssistStore {
  constructor(private options: StoreOptions) {}

  private get p() {
    return vaultPaths(this.options.sharedRoot).smartAssist;
  }

  private file(name: string): string {
    return path.join(this.p, name);
  }

  private async ensureDir(): Promise<void> {
    await fs.ensureDir(this.p);
  }

  private userLabel(): string {
    return this.options.userLabel();
  }

  private writeJson(file: string, data: unknown): Promise<void> {
    return this.options.atomicWriteJson(file, data);
  }

  private mutateJson<T>(file: string, task: () => Promise<T>): Promise<T> {
    return this.options.withSharedJsonMutation
      ? this.options.withSharedJsonMutation(file, task)
      : task();
  }

  private synonymsCollection(): ItemCollection<SmartAssistSynonymEntry> {
    return new ItemCollection({
      legacyFile: this.synonymsPath(),
      collectionKey: 'synonyms',
      normalize: (value) => normalizeSynonymEntry(value, this.userLabel()),
      atomicWriteJson: (file, value) => this.writeJson(file, value),
      mutate: (file, task) => this.mutateJson(file, task),
      limit: 3000,
    });
  }

  private ruleProfilesCollection(): ItemCollection<SmartAssistRuleProfileEntry> {
    return new ItemCollection({
      legacyFile: this.ruleProfilesPath(),
      collectionKey: 'rule-profiles',
      normalize: (value) => normalizeRuleProfileEntry(value, this.userLabel()),
      atomicWriteJson: (file, value) => this.writeJson(file, value),
      mutate: (file, task) => this.mutateJson(file, task),
      limit: 3000,
    });
  }


  private evaluationSetCollection(): ItemCollection<SmartAssistEvaluationEntry> {
    return new ItemCollection({
      legacyFile: this.evaluationSetPath(),
      collectionKey: 'evaluation-set',
      normalize: (value) => normalizeEvaluationEntry(value, this.userLabel()),
      atomicWriteJson: (file, value) => this.writeJson(file, value),
      mutate: (file, task) => this.mutateJson(file, task),
      limit: 1000,
    });
  }

  private assertSettingsFresh(current: { updatedAt?: string }, baseUpdatedAt?: unknown): void {
    const base = String(baseUpdatedAt || '').trim();
    const currentUpdatedAt = String(current?.updatedAt || '').trim();
    if (!base || !currentUpdatedAt || base === currentUpdatedAt) return;
    const error: any = new Error('設定が別の更新で変更されています。再読み込みしてから保存してください。');
    error.code = 'SETTINGS_CONFLICT';
    error.statusCode = 409;
    error.currentUpdatedAt = currentUpdatedAt;
    error.baseUpdatedAt = base;
    throw error;
  }

  private normalizeImprovementQueueEntry(input: any): any | null {
    const question = String(input?.question || input?.message || '').trim();
    if (!question) return null;
    const now = new Date().toISOString();
    return {
      id: String(input?.id || `improve_${nanoid(12)}`),
      question,
      expectedFaqId: input?.expectedFaqId ? String(input.expectedFaqId) : undefined,
      matchedFaqId: input?.matchedFaqId ? String(input.matchedFaqId) : undefined,
      confidence: Number.isFinite(Number(input?.confidence)) ? Number(input.confidence) : undefined,
      candidates: Array.isArray(input?.candidates) ? input.candidates.slice(0, 10) : [],
      reason: String(input?.reason || 'unknown'),
      response: input?.response || undefined,
      createdAt: String(input?.createdAt || now),
      updatedAt: String(input?.updatedAt || now),
      createdBy: String(input?.createdBy || this.userLabel()),
      status: String(input?.status || 'open'),
    };
  }

  private improvementQueueCollection(): ItemCollection<any> {
    return new ItemCollection({
      legacyFile: this.improvementQueuePath(),
      collectionKey: 'improvement-queue',
      normalize: (value) => this.normalizeImprovementQueueEntry(value),
      atomicWriteJson: (file, value) => this.writeJson(file, value),
      mutate: (file, task) => this.mutateJson(file, task),
      limit: 3000,
    });
  }

  private mergeNewestById<T extends { id?: string; createdAt?: string; updatedAt?: string }>(items: T[], limit: number): T[] {
    const map = new Map<string, T>();
    for (const item of items) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const current = map.get(id);
      const currentTime = String(current?.updatedAt || current?.createdAt || '');
      const nextTime = String(item?.updatedAt || item?.createdAt || '');
      if (!current || nextTime >= currentTime) map.set(id, item);
    }
    return Array.from(map.values())
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, limit);
  }

  synonymsPath(): string { return this.file('synonyms.json'); }
  ruleProfilesPath(): string { return this.file('rule-profiles.json'); }
  feedbackPath(): string { return this.file('answer-feedback.json'); }
  improvementQueuePath(): string { return this.file('faq-improvement-queue.json'); }
  evaluationSetPath(): string { return this.file('faq-evaluation-set.json'); }
  queryNormalizationPath(): string { return this.file('query-normalization.json'); }
  evaluationReportPath(): string { return this.file('faq-evaluation-report.json'); }
  evaluationReportHistoryDir(): string { return path.join(this.p, 'evaluation-reports'); }
  fallbackContactsPath(): string { return this.file('fallback-contacts.json'); }
  transformerSettingsPath(): string { return this.file('transformer-settings.json'); }
  generationSettingsPath(): string { return this.file('generation-settings.json'); }
  chatLogPath(): string { return this.file('chat-logs.json'); }

  async listSynonyms(): Promise<SmartAssistSynonymEntry[]> {
    await this.ensureDir();
    const collection = this.synonymsCollection();
    let items = await collection.list();
    if (!items.length) {
      for (const item of DEFAULT_SMART_ASSIST_SYNONYMS) {
        await collection.upsert({ ...item, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'default-seed' });
      }
      items = await collection.list();
    }
    const existingIds = new Set(items.map((item) => item.id));
    for (const item of DEFAULT_SMART_ASSIST_SYNONYMS.filter((entry) => !existingIds.has(entry.id))) {
      await collection.upsert({ ...item, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'default-seed-v381' });
    }
    return collection.list();
  }

  async saveSynonyms(input: any[]): Promise<SmartAssistSynonymEntry[]> {
    await this.ensureDir();
    return this.synonymsCollection().mergeBulk(input);
  }

  async upsertSynonym(input: any): Promise<SmartAssistSynonymEntry[]> {
    await this.ensureDir();
    return this.synonymsCollection().upsert(
      { ...input, updatedBy: this.userLabel() },
      { baseUpdatedAt: String(input?.baseUpdatedAt || '') || undefined },
    );
  }

  async deleteSynonym(id: string, baseUpdatedAt?: string): Promise<SmartAssistSynonymEntry[]> {
    await this.ensureDir();
    return this.synonymsCollection().delete(id, { baseUpdatedAt });
  }

  async listRuleProfiles(): Promise<SmartAssistRuleProfileEntry[]> {
    await this.ensureDir();
    const collection = this.ruleProfilesCollection();
    let items = await collection.list();
    if (!items.length) {
      for (const item of DEFAULT_SMART_ASSIST_RULE_PROFILES) {
        await collection.upsert({ ...item, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'default-seed' });
      }
      items = await collection.list();
    }
    const existingIds = new Set(items.map((item) => item.id));
    for (const item of DEFAULT_SMART_ASSIST_RULE_PROFILES.filter((entry) => !existingIds.has(entry.id))) {
      await collection.upsert({ ...item, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'default-seed-v381' });
    }
    return collection.list();
  }

  async saveRuleProfiles(input: any[]): Promise<SmartAssistRuleProfileEntry[]> {
    await this.ensureDir();
    return this.ruleProfilesCollection().mergeBulk(input);
  }

  async upsertRuleProfile(input: any): Promise<SmartAssistRuleProfileEntry[]> {
    await this.ensureDir();
    return this.ruleProfilesCollection().upsert(
      { ...input, updatedBy: this.userLabel() },
      { baseUpdatedAt: String(input?.baseUpdatedAt || '') || undefined },
    );
  }

  async deleteRuleProfile(id: string, baseUpdatedAt?: string): Promise<SmartAssistRuleProfileEntry[]> {
    await this.ensureDir();
    return this.ruleProfilesCollection().delete(id, { baseUpdatedAt });
  }

  async getTransformerSettings(defaultModelRoot?: string): Promise<SmartAssistTransformerSettings> {
    await this.ensureDir();
    const fallback: SmartAssistTransformerSettings = {
      enabled: true,
      modelId: 'sirasagi62/ruri-v3-70m-ONNX',
      modelRoot: defaultModelRoot || undefined,
      provider: 'transformers-js',
      localCacheDir: undefined,
      updatedBy: 'default',
    };
    const raw = await fs.readJson(this.transformerSettingsPath()).catch(() => null);
    return { ...fallback, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  async updateTransformerSettings(input: Partial<SmartAssistTransformerSettings> & { baseUpdatedAt?: string }, defaultModelRoot?: string): Promise<SmartAssistTransformerSettings> {
    return this.mutateJson(this.transformerSettingsPath(), async () => {
      const { baseUpdatedAt, ...changes } = input as any;
      const current = await this.getTransformerSettings(defaultModelRoot);
      this.assertSettingsFresh(current, baseUpdatedAt);
      const next: SmartAssistTransformerSettings = {
        ...current,
        ...changes,
        enabled: changes.enabled !== undefined ? Boolean(changes.enabled) : current.enabled,
        modelId: String(changes.modelId || current.modelId || 'sirasagi62/ruri-v3-70m-ONNX'),
        provider: 'transformers-js',
        localCacheDir: changes.localCacheDir !== undefined ? String(changes.localCacheDir || '').trim() || undefined : current.localCacheDir,
        semanticIdleEnabled: changes.semanticIdleEnabled !== undefined ? Boolean(changes.semanticIdleEnabled) : Boolean((current as any).semanticIdleEnabled),
        semanticIdleBatchSize: Math.max(1, Math.min(50, Number(changes.semanticIdleBatchSize ?? (current as any).semanticIdleBatchSize ?? 10))),
        semanticIdleDelaySec: Math.max(5, Math.min(120, Number(changes.semanticIdleDelaySec ?? (current as any).semanticIdleDelaySec ?? 8))),
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      };
      await this.ensureDir();
      await this.writeJson(this.transformerSettingsPath(), next);
      return next;
    });
  }


  async getGenerationSettings(): Promise<SmartAssistGenerationSettings> {
    await this.ensureDir();
    const fallback: SmartAssistGenerationSettings = {
      enabled: false,
      provider: 'none',
      modelRoot: undefined,
      selectedModelPath: undefined,
      llamaExecutablePath: undefined,
      llamaRuntimeDir: undefined,
      preset: 'fast',
      performanceMode: 'fast',
      retryMode: 'off',
      contextSize: 1024,
      maxTokens: 128,
      temperature: 0.1,
      timeoutMs: 45000,
      totalTimeoutMs: 60000,
      updatedBy: 'default',
    };
    const raw = await fs.readJson(this.generationSettingsPath()).catch(() => null);
    return { ...fallback, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  async updateGenerationSettings(input: Partial<SmartAssistGenerationSettings> & { baseUpdatedAt?: string }): Promise<SmartAssistGenerationSettings> {
    return this.mutateJson(this.generationSettingsPath(), async () => {
      const { baseUpdatedAt, ...changes } = input as any;
      const current = await this.getGenerationSettings();
      this.assertSettingsFresh(current, baseUpdatedAt);
      const provider = changes.provider === 'llama-cpp' ? 'llama-cpp' : changes.provider === 'none' ? 'none' : current.provider;
      const enabled = changes.enabled !== undefined ? Boolean(changes.enabled) : current.enabled;
      const next: SmartAssistGenerationSettings = {
        ...current,
        ...changes,
        enabled: enabled && provider !== 'none',
        provider,
        modelRoot: changes.modelRoot !== undefined ? String(changes.modelRoot || '').trim() || undefined : current.modelRoot,
        selectedModelPath: changes.selectedModelPath !== undefined ? String(changes.selectedModelPath || '').trim() || undefined : current.selectedModelPath,
        llamaExecutablePath: changes.llamaExecutablePath !== undefined ? String(changes.llamaExecutablePath || '').trim() || undefined : current.llamaExecutablePath,
        llamaRuntimeDir: changes.llamaRuntimeDir !== undefined ? String(changes.llamaRuntimeDir || '').trim() || undefined : current.llamaRuntimeDir,
        preset: changes.preset === 'fast' || changes.preset === 'balanced' || changes.preset === 'manual' ? changes.preset : changes.preset === 'light' ? 'light' : current.preset,
        performanceMode: changes.performanceMode === 'quality' || changes.performanceMode === 'standard' ? changes.performanceMode : changes.performanceMode === 'fast' ? 'fast' : (current as any).performanceMode || 'fast',
        retryMode: changes.retryMode === 'full' || changes.retryMode === 'on-error' ? changes.retryMode : changes.retryMode === 'off' ? 'off' : (current as any).retryMode || 'off',
        generationRuntimeMode: changes.generationRuntimeMode === 'server' ? 'server' : changes.generationRuntimeMode === 'oneshot' ? 'oneshot' : (current as any).generationRuntimeMode || 'oneshot',
        llamaServerExecutablePath: changes.llamaServerExecutablePath !== undefined ? String(changes.llamaServerExecutablePath || '').trim() || undefined : (current as any).llamaServerExecutablePath,
        llamaServerHost: changes.llamaServerHost !== undefined ? String(changes.llamaServerHost || '127.0.0.1').trim() || '127.0.0.1' : (current as any).llamaServerHost || '127.0.0.1',
        llamaServerPort: Math.max(1024, Math.min(65535, Number(changes.llamaServerPort ?? (current as any).llamaServerPort ?? 18080) || 18080)),
        llamaServerAutoStart: changes.llamaServerAutoStart !== undefined ? Boolean(changes.llamaServerAutoStart) : Boolean((current as any).llamaServerAutoStart),
        llamaServerFallback: changes.llamaServerFallback !== undefined ? Boolean(changes.llamaServerFallback) : ((current as any).llamaServerFallback !== false),
        contextSize: Math.max(512, Math.min(8192, Number(changes.contextSize ?? current.contextSize ?? 1024) || 1024)),
        maxTokens: Math.max(32, Math.min(2048, Number(changes.maxTokens ?? current.maxTokens ?? 128) || 128)),
        temperature: Math.max(0, Math.min(1, Number(changes.temperature ?? current.temperature ?? 0.1) || 0.1)),
        timeoutMs: Math.max(5000, Math.min(300000, Number(changes.timeoutMs ?? (current as any).timeoutMs ?? 45000) || 45000)),
        totalTimeoutMs: Math.max(5000, Math.min(300000, Number(changes.totalTimeoutMs ?? (current as any).totalTimeoutMs ?? 60000) || 60000)),
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      };
      await this.ensureDir();
      await this.writeJson(this.generationSettingsPath(), next);
      return next;
    });
  }


  async listImprovementQueue(): Promise<any[]> {
    await this.ensureDir();
    return this.improvementQueueCollection().list();
  }

  async addImprovementQueue(input: any): Promise<any[]> {
    await this.ensureDir();
    const normalized = this.normalizeImprovementQueueEntry(input);
    if (!normalized) return this.listImprovementQueue();
    return this.improvementQueueCollection().upsert(normalized, { baseUpdatedAt: String(input?.baseUpdatedAt || '') || undefined });
  }

  async updateImprovementQueue(id: string, input: any): Promise<any[]> {
    await this.ensureDir();
    const existing = (await this.improvementQueueCollection().list()).find((item) => item.id === id);
    if (!existing) return this.improvementQueueCollection().list();
    return this.improvementQueueCollection().upsert({ ...existing, ...input, id, updatedBy: this.userLabel() }, { baseUpdatedAt: String(input?.baseUpdatedAt || existing.updatedAt || '') });
  }

  async deleteImprovementQueue(id: string, baseUpdatedAt?: string): Promise<any[]> {
    await this.ensureDir();
    return this.improvementQueueCollection().delete(id, { baseUpdatedAt });
  }

  async listEvaluationSet(): Promise<SmartAssistEvaluationEntry[]> {
    await this.ensureDir();
    return this.evaluationSetCollection().list();
  }

  async saveEvaluationSet(input: any[]): Promise<SmartAssistEvaluationEntry[]> {
    await this.ensureDir();
    // Compatibility bulk import: only upserts supplied entries. Omitted entries
    // are never deleted, preventing a stale admin page from erasing another PC's work.
    return this.evaluationSetCollection().mergeBulk(input);
  }

  async upsertEvaluationEntry(input: any): Promise<SmartAssistEvaluationEntry[]> {
    await this.ensureDir();
    return this.evaluationSetCollection().upsert(
      { ...input, updatedBy: this.userLabel() },
      { baseUpdatedAt: String(input?.baseUpdatedAt || '') || undefined },
    );
  }

  async deleteEvaluationEntry(id: string, baseUpdatedAt?: string): Promise<SmartAssistEvaluationEntry[]> {
    await this.ensureDir();
    return this.evaluationSetCollection().delete(id, { baseUpdatedAt });
  }


  async writeEvaluationReport(report: any): Promise<void> {
    return this.mutateJson(this.evaluationReportPath(), async () => {
      await this.ensureDir();
      const savedAt = String(report?.updatedAt || new Date().toISOString());
      const normalized = { ...report, updatedAt: savedAt, reportId: String(report?.reportId || `evaluation_${savedAt.replace(/[^0-9]/g, '')}_${nanoid(6)}`) };
      await fs.ensureDir(this.evaluationReportHistoryDir());
      await this.writeJson(this.evaluationReportPath(), normalized);
      await this.writeJson(path.join(this.evaluationReportHistoryDir(), `${normalized.reportId}.json`), normalized);
      const files = (await fs.readdir(this.evaluationReportHistoryDir()).catch(() => [] as string[]))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .reverse();
      await Promise.all(files.slice(30).map((file) => fs.remove(path.join(this.evaluationReportHistoryDir(), file)).catch(() => undefined)));
    });
  }

  async listEvaluationReports(limit = 20): Promise<any[]> {
    await this.ensureDir();
    const dir = this.evaluationReportHistoryDir();
    const files = (await fs.readdir(dir).catch(() => [] as string[]))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(Number(limit) || 20, 30)));
    const reports = await Promise.all(files.map((file) => fs.readJson(path.join(dir, file)).catch(() => null)));
    const list = reports.filter(Boolean).sort((a: any, b: any) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (list.length) return list;
    const latest = await fs.readJson(this.evaluationReportPath()).catch(() => null);
    return latest ? [latest] : [];
  }

  normalizeChatLog(item: any): any | null {
    const question = String(item?.question ?? item?.message ?? '').trim();
    if (!question) return null;
    const response = item?.response || item || {};
    return {
      id: String(item?.id || `assist_log_${nanoid(12)}`),
      question,
      answerPreview: String(response?.answer || item?.answerPreview || '').slice(0, 1000),
      matchedFaqId: response?.matchedFaqId ? String(response.matchedFaqId) : item?.matchedFaqId ? String(item.matchedFaqId) : undefined,
      matchedFaqTitle: response?.matchedFaqTitle ? String(response.matchedFaqTitle) : item?.matchedFaqTitle ? String(item.matchedFaqTitle) : undefined,
      intent: response?.intent ? String(response.intent) : item?.intent ? String(item.intent) : undefined,
      confidence: Number.isFinite(Number(response?.confidence ?? item?.confidence)) ? Number(response?.confidence ?? item?.confidence) : 0,
      confidenceLabel: String(response?.confidenceLabel || item?.confidenceLabel || ''),
      uxLevel: String(response?.uxLevel || item?.uxLevel || ''),
      answerPolicy: String(response?.answerPolicy || item?.answerPolicy || ''),
      mode: String(response?.mode || item?.mode || ''),
      createdAt: String(item?.createdAt || new Date().toISOString()),
      createdBy: String(item?.createdBy || this.userLabel()),
    };
  }

  private normalizeFeedback(item: any): any | null {
    const question = String(item?.question ?? '').trim();
    const rating = item?.rating === 'bad' ? 'bad' : item?.rating === 'good' ? 'good' : '';
    if (!question || !rating) return null;
    const now = new Date().toISOString();
    const candidates = Array.isArray(item?.candidates)
      ? item.candidates.map((candidate: any) => ({
          id: String(candidate?.id || '').slice(0, 120),
          question: String(candidate?.question || '').slice(0, 240),
          category: String(candidate?.category || '').slice(0, 80),
          score: Number.isFinite(Number(candidate?.score)) ? Math.round(Number(candidate.score)) : undefined,
          reasons: Array.isArray(candidate?.reasons) ? candidate.reasons.map(String).filter(Boolean).slice(0, 4) : [],
        })).filter((candidate: any) => candidate.id || candidate.question).slice(0, 8)
      : [];
    return {
      id: String(item?.id || `assist_feedback_${nanoid(12)}`),
      question,
      answerPreview: String(item?.answerPreview || '').slice(0, 1000),
      rating,
      reason: String(item?.reason || '').slice(0, 800),
      matchedFaqId: String(item?.matchedFaqId || '').slice(0, 160),
      matchedFaqTitle: String(item?.matchedFaqTitle || '').slice(0, 240),
      expectedFaqId: String(item?.expectedFaqId || '').slice(0, 160),
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.round(Number(item.confidence)) : undefined,
      confidenceLevel: String(item?.confidenceLevel || '').slice(0, 40),
      candidates,
      status: ['open', 'checking', 'faq-created', 'ignored', 'done'].includes(String(item?.status || ''))
        ? String(item.status)
        : (rating === 'bad' ? 'open' : 'done'),
      sourceIds: Array.isArray(item?.sourceIds) ? item.sourceIds.map(String).filter(Boolean).slice(0, 40) : [],
      sourceTitles: Array.isArray(item?.sourceTitles) ? item.sourceTitles.map(String).filter(Boolean).slice(0, 40) : [],
      createdAt: String(item?.createdAt || now),
      updatedAt: String(item?.updatedAt || now),
      createdBy: String(item?.createdBy || this.userLabel()),
      updatedBy: String(item?.updatedBy || this.userLabel()),
    };
  }

  async listFeedback(): Promise<any[]> {
    await this.ensureDir();
    const raw = await fs.readJson(this.feedbackPath()).catch(() => []);
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    return items.map((item: any) => this.normalizeFeedback(item)).filter(Boolean).slice(0, 3000);
  }

  async saveFeedback(input: any[]): Promise<any[]> {
    return this.mutateJson(this.feedbackPath(), async () => {
      await this.ensureDir();
      const existing = await this.listFeedback();
      const normalized = (Array.isArray(input) ? input : [])
        .map((item) => this.normalizeFeedback(item))
        .filter(Boolean) as any[];
      // Merge by id and preserve newer data already written by another client.
      const merged = this.mergeNewestById([...normalized, ...existing], 3000);
      await this.writeJson(this.feedbackPath(), merged);
      return merged;
    });
  }

  async addFeedback(input: any): Promise<any[]> {
    const normalized = this.normalizeFeedback({
      ...input,
      createdAt: input?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: input?.createdBy || this.userLabel(),
      updatedBy: this.userLabel(),
    });
    if (!normalized) return this.listFeedback();
    if (normalized.rating === 'bad' && this.options.onBadFeedback) {
      await this.options.onBadFeedback(normalized).catch(() => undefined);
    }
    return this.saveFeedback([normalized]);
  }

  async listQueryNormalizationRules(): Promise<any> {
    await this.ensureDir();
    const raw = await fs.readJson(this.queryNormalizationPath()).catch(() => null);
    if (raw) return raw;
    const seed = {
      version: 218,
      description: 'Smart Assist query normalization dictionary. rules[].from is replaced with rules[].to before retrieval.',
      rules: [
        { from: '学童保育', to: '放課後児童クラブ' },
        { from: '学童クラブ', to: '放課後児童クラブ' },
        { from: '学童', to: '放課後児童クラブ' },
        { from: '年休', to: '年次有給休暇' },
        { from: '有休', to: '有給休暇' },
        { from: 'キャンセル', to: '取消' },
      ],
      updatedAt: new Date().toISOString(),
      updatedBy: 'default-seed',
    };
    return this.mutateJson(this.queryNormalizationPath(), async () => {
      const current = await fs.readJson(this.queryNormalizationPath()).catch(() => null);
      if (current) return current;
      await this.writeJson(this.queryNormalizationPath(), seed);
      return seed;
    });
  }

  async saveQueryNormalizationRules(input: any): Promise<any> {
    return this.mutateJson(this.queryNormalizationPath(), async () => {
      await this.ensureDir();
      const rawItems = Array.isArray(input) ? input : Array.isArray(input?.rules) ? input.rules : Array.isArray(input?.items) ? input.items : [];
      const seen = new Set<string>();
      const rules = rawItems
        .map((item: any) => ({
          from: String(item?.from || item?.base || item?.variant || '').normalize('NFKC').trim(),
          to: String(item?.to || item?.normalized || item?.canonical || '').normalize('NFKC').trim(),
        }))
        .filter((item: any) => item.from && item.to && item.from !== item.to)
        .filter((item: any) => {
          const key = `${item.from}->${item.to}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 2000);
      const payload = { version: 218, description: 'Smart Assist query normalization dictionary.', rules, updatedAt: new Date().toISOString(), updatedBy: this.userLabel() };
      await this.writeJson(this.queryNormalizationPath(), payload);
      return payload;
    });
  }

  async listFallbackContacts(): Promise<any> {
    await this.ensureDir();
    const raw = await fs.readJson(this.fallbackContactsPath()).catch(() => null);
    if (raw) return raw;
    const seed = {
      version: 218,
      defaultContact: { label: '担当係', department: '担当課', extension: '内線未設定', note: 'fallback-contacts.jsonで設定してください。' },
      categories: [
        { category: '放課後児童クラブ', label: '放課後児童クラブ担当', department: '青少年育成課', extension: '内線未設定' },
        { category: '勤務条件', label: '人事担当', department: '人事担当課', extension: '内線未設定' },
        { category: '申請手続き', label: '手続き担当', department: '担当課', extension: '内線未設定' },
      ],
      updatedAt: new Date().toISOString(),
      updatedBy: 'default-seed',
    };
    return this.mutateJson(this.fallbackContactsPath(), async () => {
      const current = await fs.readJson(this.fallbackContactsPath()).catch(() => null);
      if (current) return current;
      await this.writeJson(this.fallbackContactsPath(), seed);
      return seed;
    });
  }

  async saveFallbackContacts(input: any): Promise<any> {
    return this.mutateJson(this.fallbackContactsPath(), async () => {
      await this.ensureDir();
      const payload = {
        version: 218,
        defaultContact: input?.defaultContact || { label: '担当係', department: '担当課', extension: '内線未設定' },
        categories: Array.isArray(input?.categories) ? input.categories.slice(0, 300) : [],
        updatedAt: new Date().toISOString(),
        updatedBy: this.userLabel(),
      };
      await this.writeJson(this.fallbackContactsPath(), payload);
      return payload;
    });
  }

  async listChatLogs(): Promise<any[]> {
    await this.ensureDir();
    const raw = await fs.readJson(this.chatLogPath()).catch(() => []);
    const items = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    return items.map((item: any) => this.normalizeChatLog(item)).filter(Boolean).slice(0, 5000);
  }

  async addChatLog(input: any): Promise<any[]> {
    return this.mutateJson(this.chatLogPath(), async () => {
      const logs = await this.listChatLogs();
      const normalized = this.normalizeChatLog({ ...input, createdAt: input?.createdAt || new Date().toISOString(), createdBy: this.userLabel() });
      if (!normalized) return logs;
      const next = [normalized, ...logs].slice(0, 5000);
      await this.writeJson(this.chatLogPath(), next);
      return next;
    
    });
  }

  async listLowConfidenceChatLogs(): Promise<any[]> {
    const logs = await this.listChatLogs();
    return logs.filter((item) => Number(item.confidence || 0) < 50 || item.uxLevel === 'low').slice(0, 300);
  }

  async clearChatLogs(): Promise<{ ok: true; deleted: number; updatedAt: string; path: string }> {
    return this.mutateJson(this.chatLogPath(), async () => {
      const old = await this.listChatLogs();
      const updatedAt = new Date().toISOString();
      await this.ensureDir();
      await this.writeJson(this.chatLogPath(), []);
      return { ok: true, deleted: old.length, updatedAt, path: 'smart-assist/chat-logs.json' };
    });
  }
}
