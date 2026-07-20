import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api';
import { MarkdownAnswer } from '../common/MarkdownAnswer';
import { workspaceMutationCoordinator } from '../../../../shared/workspace/workspaceMutationCoordinator';

type SemanticResult = {
  chunk?: {
    id?: string;
    type?: string;
    sourceId?: string;
    parentPageId?: string;
    databaseId?: string;
    rowId?: string;
    title?: string;
    text?: string;
    tags?: string[];
    keywords?: string[];
    updatedAt?: string;
  };
  score?: number;
  semanticScore?: number;
  lexicalScore?: number;
  titleScore?: number;
  metaScore?: number;
  reasons?: string[];
};

type SearchResponse = {
  ok?: boolean;
  available?: boolean;
  indexedCount?: number;
  results?: SemanticResult[];
  warning?: string;
};

type Props = {
  api: ApiClient | null;
  compact?: boolean;
  autoFocus?: boolean;
  initialQuery?: string;
  onOpenPage?: (id: string) => void;
  onOpenDatabase?: (id: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenJournal?: (date: string) => void;
  onClose?: () => void;
};

type FilterType = 'all' | 'faq' | 'page' | 'database_row' | 'journal' | 'attachment_summary';

const FILTERS: Array<{ key: FilterType; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'faq', label: 'FAQ' },
  { key: 'page', label: 'ページ' },
  { key: 'database_row', label: 'DB行' },
  { key: 'journal', label: 'Journal' },
  { key: 'attachment_summary', label: '資料' },
];

function typeLabel(type?: string) {
  if (type === 'faq') return 'FAQ';
  if (type === 'page') return 'ページ';
  if (type === 'database_row') return 'DB行';
  if (type === 'journal') return 'Journal';
  if (type === 'attachment_summary') return '資料';
  return type || '不明';
}

function typeIcon(type?: string) {
  if (type === 'faq') return '💬';
  if (type === 'page') return '📄';
  if (type === 'database_row') return '🗃️';
  if (type === 'journal') return '📔';
  if (type === 'attachment_summary') return '📎';
  return '✨';
}

function groupKey(type?: string) {
  if (type === 'faq') return 'FAQ';
  if (type === 'page') return 'ページ';
  if (type === 'database_row') return 'データベース';
  if (type === 'journal') return 'ジャーナル';
  if (type === 'attachment_summary') return '資料';
  return 'その他';
}

function shortText(value?: string, length = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function resultKey(result: SemanticResult) {
  const chunk = result.chunk || {};
  return `${chunk.type || 'unknown'}:${chunk.databaseId || ''}:${chunk.rowId || chunk.sourceId || chunk.id || ''}`;
}


function AiThinkingIndicator({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  const stages = [
    { label: '考えています', note: '質問の意図を整理しています' },
    { label: '情報を確認しています', note: 'ページ・FAQ・データベースを横断しています' },
    { label: '回答を組み立てています', note: '根拠をもとに分かりやすく整理しています' },
  ];

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Date.now() - startedAt));
    tick();
    const timer = window.setInterval(tick, 650);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const active = Math.min(stages.length - 1, Math.floor(elapsed / 2800));
  return <div className="workspace-ai-thinking-v465" aria-live="polite" aria-label="AIが回答を作成中です">
    <div className="workspace-ai-thinking-mark-v465" aria-hidden="true"><i /><i /><i /></div>
    <div className="workspace-ai-thinking-copy-v465">
      <strong>{stages[active].label}</strong>
      <span>{stages[active].note}</span>
      <small>{Math.floor(elapsed / 1000)}秒</small>
    </div>
    <div className="workspace-ai-thinking-steps-v465" aria-hidden="true">
      {stages.map((stage, index) => <span key={stage.label} className={index <= active ? 'active' : ''}>{index < active ? '✓' : index + 1}</span>)}
    </div>
  </div>;
}

function nextProgressBoundary(markdown: string, current: number): number {
  const remaining = markdown.length - current;
  if (remaining <= 0) return markdown.length;

  // 画面更新は粗めにしつつ、文・改行の切れ目を優先する。
  // Markdown解析は完了時の1回だけにして、表示中は軽いテキスト更新に限定する。
  const preferred = remaining > 2400 ? 180 : remaining > 1200 ? 120 : 72;
  const minimum = Math.min(markdown.length, current + Math.max(28, Math.floor(preferred * 0.55)));
  const target = Math.min(markdown.length, current + preferred);
  const lookAhead = Math.min(markdown.length, target + 90);
  const segment = markdown.slice(minimum, lookAhead);
  const match = segment.search(/[。！？!?]\s|\n{1,2}/);
  return match >= 0 ? minimum + match + 1 : target;
}

function ProgressiveAnswer({ markdown, active, onComplete }: { markdown: string; active: boolean; onComplete?: () => void }) {
  const [visibleLength, setVisibleLength] = useState(active ? 0 : markdown.length);
  const [complete, setComplete] = useState(!active);
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    setVisibleLength(active ? 0 : markdown.length);
    setComplete(!active);
  }, [markdown, active]);

  useEffect(() => {
    if (!active) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setVisibleLength(markdown.length);
      setComplete(true);
      if (!completedRef.current) {
        completedRef.current = true;
        window.setTimeout(() => onComplete?.(), 0);
      }
      return;
    }

    const timer = window.setInterval(() => {
      setVisibleLength(current => {
        const next = nextProgressBoundary(markdown, current);
        if (next >= markdown.length && !completedRef.current) {
          completedRef.current = true;
          window.setTimeout(() => {
            setComplete(true);
            onComplete?.();
          }, 80);
        }
        return next;
      });
    }, 72);
    return () => window.clearInterval(timer);
  }, [active, markdown, onComplete]);

  if (complete) {
    return <div className="workspace-ai-progressive-answer-v466 is-complete"><MarkdownAnswer markdown={markdown} /></div>;
  }

  return <div className="workspace-ai-progressive-answer-v466" aria-live="polite" aria-label="AI回答を表示中">
    <div className="workspace-ai-progressive-answer-text-v466">{markdown.slice(0, visibleLength)}</div>
    <span className="workspace-ai-progressive-answer-cursor-v466" aria-hidden="true" />
  </div>;
}

export function WorkspaceAiSearch({ api, compact = false, autoFocus = false, initialQuery = '', onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<FilterType>('all');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('質問・キーワードを入力してください。');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 80);
  }, [autoFocus]);

  useEffect(() => {
    setQuery(initialQuery || '');
  }, [initialQuery]);

  async function runSearch(nextQuery = query, nextFilter = filter) {
    const trimmed = String(nextQuery || '').trim();
    if (!api) {
      setStatus('APIがまだ起動していません。');
      return;
    }
    if (!trimmed) {
      setResponse(null);
      setStatus('質問・キーワードを入力してください。');
      return;
    }
    const seq = ++searchSeqRef.current;
    setBusy(true);
    setStatus('Workspace Semantic Indexを検索中...');
    try {
      const types = nextFilter === 'all' ? undefined : [nextFilter];
      const data = await api.searchWorkspaceSemantic(trimmed, { limit: compact ? 16 : 32, types });
      if (seq !== searchSeqRef.current) return;
      setResponse(data);
      const count = data?.results?.length || 0;
      setStatus(count ? `${count}件見つかりました。` : '該当候補が見つかりませんでした。Index再生成も確認してください。');
    } catch (error: any) {
      if (seq !== searchSeqRef.current) return;
      setResponse(null);
      setStatus(error?.message || '検索に失敗しました。');
    } finally {
      if (seq === searchSeqRef.current) setBusy(false);
    }
  }

  const results = useMemo(() => {
    const seen = new Set<string>();
    return (response?.results || [])
      .filter(item => item?.chunk)
      .filter(item => {
        const key = resultKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [response]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SemanticResult[]>();
    for (const item of results) {
      const key = groupKey(item.chunk?.type);
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    return Array.from(groups.entries());
  }, [results]);

  function openResult(item: SemanticResult) {
    const chunk = item.chunk || {};
    if (chunk.type === 'page' && chunk.sourceId) onOpenPage?.(chunk.sourceId);
    else if (chunk.type === 'journal' && chunk.sourceId) onOpenJournal?.(chunk.sourceId);
    else if (chunk.type === 'database_row' && chunk.databaseId && chunk.rowId) onOpenDatabaseRow?.(chunk.databaseId, chunk.rowId);
    else if (chunk.type === 'database_row' && chunk.databaseId) onOpenDatabase?.(chunk.databaseId);
    else if (chunk.type === 'attachment_summary' && chunk.parentPageId) onOpenPage?.(chunk.parentPageId);
  }

  function canOpen(item: SemanticResult) {
    const chunk = item.chunk || {};
    if (chunk.type === 'page') return Boolean(chunk.sourceId);
    if (chunk.type === 'journal') return Boolean(chunk.sourceId);
    if (chunk.type === 'database_row') return Boolean(chunk.databaseId);
    if (chunk.type === 'attachment_summary') return Boolean(chunk.parentPageId);
    return false;
  }

  return <section className={compact ? 'workspace-ai-search compact' : 'workspace-ai-search'}>
    <div className="workspace-ai-search-head">
      <div>
        <span>Workspace AI Search</span>
        <h3>ワークスペースを横断検索</h3>
        <p>FAQ・ページ・DB行・JournalをRuri-v3 Semantic Indexで横断検索します。</p>
      </div>
      {onClose ? <button type="button" className="workspace-ai-close" onClick={onClose}>閉じる</button> : null}
    </div>

    <form className="workspace-ai-search-box" onSubmit={event => { event.preventDefault(); runSearch(); }}>
      <input
        ref={inputRef}
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="例: 申請方法、育休の必要書類、会議メモ、DB行の内容..."
      />
      <button type="submit" className="primary" disabled={busy || !query.trim()}>{busy ? '検索中...' : 'AI検索'}</button>
    </form>

    <div className="workspace-ai-filter-row">
      {FILTERS.map(item => <button key={item.key} type="button" className={filter === item.key ? 'active' : ''} onClick={() => { setFilter(item.key); if (query.trim()) runSearch(query, item.key); }}>{item.label}</button>)}
    </div>

    <div className={busy ? 'workspace-ai-status busy' : 'workspace-ai-status'}>
      <span />
      <small>{status}{response?.indexedCount ? ` / Index ${response.indexedCount}件` : ''}{response?.warning ? ` / ${response.warning}` : ''}</small>
    </div>

    {grouped.length ? <div className="workspace-ai-results">
      {grouped.map(([label, items]) => <section key={label} className="workspace-ai-result-group">
        <div className="workspace-ai-result-group-head"><strong>{label}</strong><span>{items.length}件</span></div>
        <div className="workspace-ai-result-list">
          {items.map(item => {
            const chunk = item.chunk || {};
            const openable = canOpen(item);
            return <article key={resultKey(item)} className="workspace-ai-result-card">
              <button type="button" disabled={!openable} onClick={() => openResult(item)}>
                <span className="workspace-ai-result-score">{Math.round(Number(item.score || 0))}</span>
                <span className="workspace-ai-result-body">
                  <b>{typeIcon(chunk.type)} {chunk.title || 'Untitled'}</b>
                  <small>{typeLabel(chunk.type)}{item.semanticScore ? ` ・ 意味${Math.round(item.semanticScore)}%` : ''}{item.lexicalScore ? ` ・ 語句${Math.round(item.lexicalScore)}%` : ''}{chunk.updatedAt ? ` ・ ${String(chunk.updatedAt).slice(0, 10)}` : ''}</small>
                  {chunk.text ? <em>{shortText(chunk.text, compact ? 90 : 150)}</em> : null}
                </span>
              </button>
              {item.reasons?.length ? <div className="workspace-ai-reasons">
                {item.reasons.slice(0, 3).map(reason => <span key={reason}>{reason}</span>)}
              </div> : null}
            </article>;
          })}
        </div>
      </section>)}
    </div> : response ? <div className="workspace-ai-empty">候補がありません。検索語を変えるか、Semantic Indexを再生成してください。</div> : null}
  </section>;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  results?: SemanticResult[];
  warning?: string;
  generated?: boolean;
  elapsedMs?: number;
  command?: string;
  query?: string;
  usage?: {
    pageReadMode?: string;
    answerLength?: string;
    usedPageChars?: number;
    totalPageChars?: number;
    pageChunkCount?: number;
    maxTokens?: number;
    contextSize?: number;
  };
  grounding?: {
    confidence?: string;
    usedSourceCount?: number;
    pinnedCount?: number;
    excludedCount?: number;
    sourceMode?: string;
    topScore?: number;
    strongSourceCount?: number;
    intent?: string;
    intentLabel?: string;
    searchStrategy?: string;
    rerank?: {
      mode?: string;
      termCount?: number;
      topAnswerFit?: number;
    };
  };
  answerPlan?: {
    intent?: string;
    label?: string;
    searchStrategy?: string;
    groundingPolicy?: string;
    needsClarification?: boolean;
  };
  answerTemplate?: {
    id?: string;
    label?: string;
    structure?: string;
  };
  answerVerification?: {
    checked?: boolean;
    quality?: 'high' | 'medium' | 'review' | string;
    label?: string;
    summary?: string;
    unsupportedClaims?: string[];
    missingInfo?: string[];
    sourceChars?: number;
    policy?: string;
  };
  suggestions?: string[];
  clarificationNeeded?: boolean;
};

type ChatAnswerAction = 'append_current_page' | 'create_page' | 'create_tasks' | 'create_faq_draft' | 'copy_markdown';

type ChatActionPreview = {
  messageId: string;
  action: ChatAnswerAction;
  title: string;
  body: string;
  status?: string;
};


type AiChatHistorySession = {
  id: string;
  title: string;
  pageId?: string;
  pageTitle?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  messages: ChatMessage[];
  settings?: {
    answerMode?: AnswerMode;
    pageReadMode?: PageReadMode;
    answerLength?: AnswerLength;
    scope?: ChatScope;
    usePinnedOnly?: boolean;
    tonePreset?: TonePreset;
  };
  sourcePrefs?: Record<string, 'use' | 'exclude' | undefined>;
};

type AnswerMode = 'standard' | 'short' | 'detail' | 'steps' | 'evidence' | 'faq' | 'document';
type ChatScope = 'workspace' | 'page';
type PageReadMode = 'fast' | 'standard' | 'detail';
type AnswerLength = 'short' | 'standard' | 'long';
type TonePreset = 'smart' | 'friendly' | 'business_memo' | 'guardian' | 'staff';

type ChatProps = Props & {
  currentPageId?: string;
  currentTitle?: string;
  currentMarkdown?: string;
  onOpenDetailedSearch?: (query: string) => void;
  onGenerationStateChange?: (state: { busy: boolean; question?: string }) => void;
  queuedPrompt?: string;
  onQueuedPromptHandled?: () => void;
};

const ANSWER_MODES: Array<{ key: AnswerMode; label: string; hint: string }> = [
  { key: 'standard', label: 'スマート', hint: '自然な会話調で要点整理' },
  { key: 'short', label: '短く', hint: '2〜4文で要点のみ' },
  { key: 'detail', label: '詳しく', hint: '背景と注意点も整理' },
  { key: 'steps', label: '手順化', hint: '番号付き手順' },
  { key: 'evidence', label: '根拠重視', hint: '参照元を明示' },
  { key: 'faq', label: 'FAQ形式', hint: 'Q&A風に整理' },
  { key: 'document', label: '文書作成', hint: '完成原稿を作成 / 最大2048' },
];

const PAGE_READ_MODES: Array<{ key: PageReadMode; label: string; hint: string; recommendedContext: number }> = [
  { key: 'fast', label: '高速', hint: '約2,400文字 / 速い / 推奨ctx 2048', recommendedContext: 2048 },
  { key: 'standard', label: '標準', hint: '約6,000文字 / 通常 / 推奨ctx 4096', recommendedContext: 4096 },
  { key: 'detail', label: '詳細', hint: '約12,000文字 / 長文向け / 推奨ctx 6144以上', recommendedContext: 6144 },
];

const ANSWER_LENGTHS: Array<{ key: AnswerLength; label: string; hint: string }> = [
  { key: 'short', label: '短め', hint: '短く確認' },
  { key: 'standard', label: '標準', hint: '通常の長さ' },
  { key: 'long', label: '詳しく', hint: '長めに整理' },
];

const TONE_PRESETS: Array<{ key: TonePreset; label: string; hint: string }> = [
  { key: 'smart', label: 'スマート', hint: '自然で要点が分かる' },
  { key: 'friendly', label: 'やさしく', hint: '柔らかく説明' },
  { key: 'business_memo', label: '業務メモ', hint: '実務メモ向け' },
  { key: 'guardian', label: '保護者向け', hint: '住民・保護者向け' },
  { key: 'staff', label: '職員向け', hint: '庁内確認向け' },
];


const AI_CHAT_HISTORY_STORAGE_KEY = 'local-notion-lite-ai-chat-history-v357';
const AI_CHAT_HISTORY_LIMIT = 30;

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function readAiChatHistorySessions(): AiChatHistorySession[] {
  if (typeof window === 'undefined') return [];
  const sessions = safeJsonParse<AiChatHistorySession[]>(window.localStorage.getItem(AI_CHAT_HISTORY_STORAGE_KEY), []);
  return Array.isArray(sessions) ? sessions.filter(item => item?.id && Array.isArray(item.messages)).slice(0, AI_CHAT_HISTORY_LIMIT) : [];
}

function writeAiChatHistorySessions(sessions: AiChatHistorySession[]) {
  if (typeof window === 'undefined') return;
  const compact = sessions
    .filter(item => item?.id)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, AI_CHAT_HISTORY_LIMIT)
    .map(item => ({ ...item, messages: (item.messages || []).slice(-40).map(message => ({ ...message, results: (message.results || []).slice(0, 6) })) }));
  window.localStorage.setItem(AI_CHAT_HISTORY_STORAGE_KEY, JSON.stringify(compact));
}

function buildAiChatSessionTitle(messages: ChatMessage[], fallback = 'AIチャット') {
  const firstQuestion = messages.find(message => message.role === 'user')?.text || fallback;
  return shortText(firstQuestion.replace(/\s+/g, ' '), 36) || fallback;
}

function formatHistoryTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function summarizeFromResults(query: string, results: SemanticResult[], mode: AnswerMode = 'standard') {
  if (!results.length) {
    return '関連する情報が見つかりませんでした。検索語を変えるか、Semantic Indexの再生成を確認してください。';
  }
  const top = results[0];
  const topTitle = top.chunk?.title || '関連情報';
  const topText = shortText(top.chunk?.text, mode === 'short' ? 140 : 260);
  const sourceSummary = results.slice(0, 5).map(item => item.chunk?.title || 'Untitled').join(' / ');
  if (mode === 'steps') {
    return ['手順候補です。', `1. まず「${topTitle}」を確認します。`, topText ? `2. 要点: ${topText}` : '', '3. 参照候補カードを開き、原文を確認します。'].filter(Boolean).join('\n');
  }
  if (mode === 'evidence') {
    return [`回答候補: 「${query}」に関連する情報が見つかりました。`, `根拠: 「${topTitle}」`, topText ? `該当内容: ${topText}` : '', `参照候補: ${sourceSummary}`].filter(Boolean).join('\n');
  }
  if (mode === 'faq') {
    return [`Q. ${query}`, `A. 「${topTitle}」が最も近い候補です。`, topText ? `補足: ${topText}` : '', `関連情報: ${sourceSummary}`].filter(Boolean).join('\n');
  }
  return [
    `「${query}」に関連する情報を見つけました。`,
    `最も関連が高い候補は「${topTitle}」です。`,
    topText ? `内容の要点: ${topText}` : '',
    sourceSummary ? `参照候補: ${sourceSummary}` : '',
  ].filter(Boolean).join('\n');
}

function buildSourceMarkdown(results: SemanticResult[] = []) {
  const lines = results.slice(0, 6).map((item, index) => {
    const chunk = item.chunk || {};
    const label = typeLabel(chunk.type);
    const title = chunk.title || 'Untitled';
    const score = Math.round(Number(item.score || 0));
    return `${index + 1}. ${label}: ${title}${score ? ` / score ${score}` : ''}`;
  });
  return lines.length ? ['### 参照候補', ...lines].join('\n') : '';
}

function formatAiAnswerMarkdown(message: ChatMessage, includeSources = true) {
  const body = String(message.text || '').trim();
  const sourceBlock = includeSources ? buildSourceMarkdown(message.results || []) : '';
  const meta = [
    message.generated !== undefined ? `生成: ${message.generated ? '生成AI回答' : '検索ベース回答'}` : '',
    message.elapsedMs ? `所要時間: ${message.elapsedMs}ms` : '',
    message.usage ? `読込: ${message.usage.usedPageChars || 0}/${message.usage.totalPageChars || 0}文字 / ctx ${message.usage.contextSize || '-'} / max ${message.usage.maxTokens || '-'}` : '',
  ].filter(Boolean).join(' / ');
  return [body, sourceBlock, meta ? `---\n${meta}` : ''].filter(Boolean).join('\n\n');
}

function extractTodoLinesFromAnswer(text: string) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const todoLines = lines.filter(line => /TODO|タスク|確認|期限|対応|提出|連絡|予約|更新|作成|準備|確認事項|未対応|□|\[ \]/i.test(line));
  const picked = (todoLines.length ? todoLines : lines).slice(0, 12);
  return picked
    .map(line => line.replace(/^[-*・\d.\s]+/, '').trim())
    .filter(Boolean)
    .map(line => `- [ ] ${line}`);
}

function buildFaqDraftFromAnswer(message: ChatMessage) {
  const question = String(message.query || 'AIチャット回答').trim().slice(0, 240) || 'AIチャット回答';
  const answer = String(message.text || '').trim();
  const sourceTitles = (message.results || []).map(item => item.chunk?.title || '').filter(Boolean).slice(0, 8);
  return { question, answer, sourceTitles };
}

export function WorkspaceAiChatPanel({ api, autoFocus = false, currentPageId = '', currentTitle = '', currentMarkdown = '', onOpenDetailedSearch, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, onClose, onGenerationStateChange, queuedPrompt = '', onQueuedPromptHandled }: ChatProps) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [generationStartedAt, setGenerationStartedAt] = useState(0);
  const [answerMode, setAnswerMode] = useState<AnswerMode>('standard');
  const [pageReadMode, setPageReadMode] = useState<PageReadMode>('standard');
  const [answerLength, setAnswerLength] = useState<AnswerLength>('standard');
  const [tonePreset, setTonePreset] = useState<TonePreset>('smart');
  const [scope, setScope] = useState<ChatScope>(currentPageId ? 'page' : 'workspace');
  const [sourcePrefs, setSourcePrefs] = useState<Record<string, 'use' | 'exclude' | undefined>>({});
  const [usePinnedOnly, setUsePinnedOnly] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      role: 'assistant',
      text: '気になることをそのまま聞いてください。ページやFAQ、DBの内容をもとに、自然な言葉で整理します。',
    },
  ]);
  const [serverStatus, setServerStatus] = useState<any | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverPanelOpen, setServerPanelOpen] = useState(false);
  const [actionPreview, setActionPreview] = useState<ChatActionPreview | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<AiChatHistorySession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyMessage, setHistoryMessage] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  const pageReadPreset = PAGE_READ_MODES.find(item => item.key === pageReadMode) || PAGE_READ_MODES[1];
  const answerLengthPreset = ANSWER_LENGTHS.find(item => item.key === answerLength) || ANSWER_LENGTHS[1];
  const tonePresetOption = TONE_PRESETS.find(item => item.key === tonePreset) || TONE_PRESETS[0];
  const answerModePreset = ANSWER_MODES.find(item => item.key === answerMode) || ANSWER_MODES[0];
  const recommendedContext = answerMode === 'document' ? 8192 : pageReadPreset.recommendedContext;
  const serverContextSize = Number(serverStatus?.contextSize || 0) || null;
  const serverCtxWarning = Boolean(serverStatus?.reachable && serverContextSize && serverContextSize < recommendedContext);
  const serverCtxUnknown = Boolean(serverStatus?.reachable && !serverContextSize);

  async function refreshGenerationServerStatus() {
    if (!api?.getGenerationServerStatus) return;
    try {
      const status = await api.getGenerationServerStatus();
      setServerStatus(status);
      return status;
    } catch (error: any) {
      setServerMessage(`llama-server状態確認に失敗: ${error?.message || error}`);
      return null;
    }
  }

  async function restartGenerationServerWithRecommendedContext() {
    if (!api?.startGenerationServer) return;
    setServerBusy(true);
    setServerMessage(`llama-serverを推奨ctx=${recommendedContext}で起動しています...`);
    try {
      const status = await api.startGenerationServer({ contextSize: recommendedContext, forceRestart: true });
      setServerStatus(status);
      setServerMessage(status?.message || `llama-serverをctx=${recommendedContext}で起動しました。`);
    } catch (error: any) {
      setServerMessage(`llama-server起動に失敗: ${error?.message || error}`);
    } finally {
      setServerBusy(false);
    }
  }

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 90);
  }, [autoFocus]);

  useEffect(() => () => {
    onGenerationStateChange?.({ busy: false });
  }, [onGenerationStateChange]);


  useEffect(() => {
    const timer = window.setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [messages.length, busy, typingMessageId, actionPreview?.messageId]);

  useEffect(() => {
    refreshGenerationServerStatus();
  }, [api]);

  useEffect(() => {
    if (currentPageId) setScope(prev => prev || 'page');
  }, [currentPageId]);

  useEffect(() => {
    setSavedSessions(readAiChatHistorySessions());
  }, []);

  useEffect(() => {
    const meaningfulMessages = messages.filter(message => message.id !== 'welcome');
    if (!meaningfulMessages.length) return;
    const now = new Date().toISOString();
    const id = activeSessionId || `ai-chat-${Date.now()}`;
    if (!activeSessionId) setActiveSessionId(id);
    const existing = readAiChatHistorySessions();
    const previous = existing.find(item => item.id === id);
    const session: AiChatHistorySession = {
      id,
      title: buildAiChatSessionTitle(meaningfulMessages, currentTitle || 'AIチャット'),
      pageId: currentPageId || previous?.pageId,
      pageTitle: currentTitle || previous?.pageTitle,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      messageCount: meaningfulMessages.length,
      messages: meaningfulMessages.slice(-40),
      settings: { answerMode, pageReadMode, answerLength, scope, usePinnedOnly, tonePreset },
      sourcePrefs,
    };
    const next = [session, ...existing.filter(item => item.id !== id)].slice(0, AI_CHAT_HISTORY_LIMIT);
    writeAiChatHistorySessions(next);
    setSavedSessions(next);
  }, [messages, activeSessionId, answerMode, pageReadMode, answerLength, scope, usePinnedOnly, tonePreset, sourcePrefs, currentPageId, currentTitle]);

  function startNewChatSession() {
    setActiveSessionId(null);
    setMessages([{ id: 'welcome', role: 'assistant', text: '気になることをそのまま聞いてください。ページやFAQ、DBの内容をもとに、自然な言葉で整理します。' }]);
    setSourcePrefs({});
    setUsePinnedOnly(false);
    setActionPreview(null);
    setActionMessage('');
    setHistoryMessage('新しいAIチャットを開始しました。');
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function restoreChatSession(session: AiChatHistorySession) {
    setActiveSessionId(session.id);
    setMessages([{ id: 'welcome', role: 'assistant', text: '保存されたAIチャット履歴を開きました。続けて質問できます。' }, ...(session.messages || [])]);
    if (session.settings?.answerMode) setAnswerMode(session.settings.answerMode);
    if (session.settings?.pageReadMode) setPageReadMode(session.settings.pageReadMode);
    if (session.settings?.answerLength) setAnswerLength(session.settings.answerLength);
    if (session.settings?.tonePreset) setTonePreset(session.settings.tonePreset);
    if (session.settings?.scope) setScope(session.settings.scope);
    setUsePinnedOnly(Boolean(session.settings?.usePinnedOnly));
    setSourcePrefs(session.sourcePrefs || {});
    setHistoryOpen(false);
    setHistoryMessage(`履歴「${session.title}」を開きました。`);
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function deleteChatSession(sessionId: string) {
    const next = readAiChatHistorySessions().filter(item => item.id !== sessionId);
    writeAiChatHistorySessions(next);
    setSavedSessions(next);
    if (activeSessionId === sessionId) setActiveSessionId(null);
    setHistoryMessage('AIチャット履歴を削除しました。');
  }

  function clearAiChatHistory() {
    writeAiChatHistorySessions([]);
    setSavedSessions([]);
    setActiveSessionId(null);
    setHistoryMessage('AIチャット履歴をすべて削除しました。');
  }

  const pinnedSourceKeys = useMemo(() => Object.entries(sourcePrefs).filter(([, value]) => value === 'use').map(([key]) => key), [sourcePrefs]);
  const excludedSourceKeys = useMemo(() => Object.entries(sourcePrefs).filter(([, value]) => value === 'exclude').map(([key]) => key), [sourcePrefs]);

  useEffect(() => {
    if (!pinnedSourceKeys.length && usePinnedOnly) setUsePinnedOnly(false);
  }, [pinnedSourceKeys.length, usePinnedOnly]);

  function setSourcePreference(item: SemanticResult, value: 'use' | 'exclude') {
    const key = resultKey(item);
    setSourcePrefs(prev => ({ ...prev, [key]: prev[key] === value ? undefined : value }));
  }

  function getPinnedSourceItems() {
    if (!pinnedSourceKeys.length) return [];
    const seen = new Set<string>();
    const items: SemanticResult[] = [];
    for (const message of messages) {
      for (const result of message.results || []) {
        const key = resultKey(result);
        if (!pinnedSourceKeys.includes(key) || seen.has(key)) continue;
        seen.add(key);
        items.push(result);
      }
    }
    return items.slice(0, 8);
  }

  useEffect(() => {
    const prompt = String(queuedPrompt || '').trim();
    if (!prompt || busy || !api) return;
    setScope('page');
    onQueuedPromptHandled?.();
    void ask(prompt, 'evidence', 'page');
  }, [queuedPrompt, api]);

  async function ask(next = input, forcedMode?: AnswerMode, forcedScope?: ChatScope) {
    const question = String(next || '').trim();
    if (!question || busy || typingMessageId) return;
    if (!api) {
      setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', text: question }, { id: `a-${Date.now()}`, role: 'assistant', text: 'APIがまだ起動していません。少し待ってから再度お試しください。' }]);
      return;
    }
    const seq = ++seqRef.current;
    const mode = forcedMode || answerMode;
    const nextScope = forcedScope || scope;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: question, query: question };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setBusy(true);
    setGenerationStartedAt(Date.now());
    onGenerationStateChange?.({ busy: true, question });
    let waitForPresentation = false;
    try {
      const payload = {
        question,
        answerMode: mode,
        pageReadMode,
        answerLength,
        tonePreset,
        recentMessages: messages.filter(m => m.id !== 'welcome').slice(-8).map(m => ({ role: m.role, text: m.text.slice(0, 700) })),
        recommendedContextSize: recommendedContext,
        pageContext: nextScope === 'page' && currentPageId ? { id: currentPageId, title: currentTitle, markdown: currentMarkdown } : null,
        pinnedSourceKeys,
        excludedSourceKeys,
        pinnedSourceItems: getPinnedSourceItems(),
        sourceMode: usePinnedOnly && pinnedSourceKeys.length ? 'pinned_only' : 'auto',
      };
      let data: any = null;
      const streamingMessageId = `a-${Date.now()}`;
      let receivedDelta = false;
      try {
        // llama-server常駐モードでは、届いたトークンをそのまま表示する。
        // llama-completion単発モードではfinalイベントのみになり、従来どおり安全に完了表示される。
        setMessages(prev => [...prev, { id: streamingMessageId, role: 'assistant', text: '', streaming: true, query: question }]);
        await api.generateWorkspaceAiChatAnswerStream(payload, (event: any) => {
          if (seq !== seqRef.current) return;
          if (event?.type === 'delta' && event.delta) {
            receivedDelta = true;
            setMessages(prev => prev.map(message => message.id === streamingMessageId
              ? { ...message, text: `${message.text}${String(event.delta)}` }
              : message));
            return;
          }
          if (event?.type === 'final') data = event.data;
          if (event?.type === 'error') throw new Error(event.message || 'AIストリームに失敗しました。');
        });
        if (!data) throw new Error('AIストリームの完了結果を受信できませんでした。');
      } catch {
        // ストリーム未対応の旧ランタイムや接続断では、既存APIと検索ベース回答へ安全にフォールバックする。
        setMessages(prev => prev.filter(message => message.id !== streamingMessageId));
        try {
          data = await api.generateWorkspaceAiChatAnswer(payload);
        } catch {
          const search = await api.searchWorkspaceSemantic([question, nextScope === 'page' ? currentTitle : ''].filter(Boolean).join('\n'), { limit: 10 });
          const results = ((search?.results || []) as SemanticResult[]).filter(item => item?.chunk && !excludedSourceKeys.includes(resultKey(item))).slice(0, 8);
          data = { ok: true, generated: false, answer: summarizeFromResults(question, results, mode), results, warning: search?.warning };
        }
      }
      if (seq !== seqRef.current) return;
      const results = ((data?.results || []) as SemanticResult[]).filter(item => item?.chunk).slice(0, 8);
      const assistantMessage: ChatMessage = {
        id: streamingMessageId,
        role: 'assistant',
        text: String(data?.answer || summarizeFromResults(question, results, mode)),
        streaming: false,
        results,
        warning: data?.warning,
        generated: Boolean(data?.generated),
        elapsedMs: data?.elapsedMs,
        command: data?.command,
        query: question,
        usage: data?.usage,
        grounding: data?.grounding,
        answerPlan: data?.answerPlan,
        answerTemplate: data?.answerTemplate,
        answerVerification: data?.answerVerification,
        suggestions: Array.isArray(data?.suggestions) ? data.suggestions.slice(0, 5) : [],
        clarificationNeeded: Boolean(data?.clarificationNeeded),
      };
      setMessages(prev => {
        const exists = prev.some(message => message.id === streamingMessageId);
        return exists ? prev.map(message => message.id === streamingMessageId ? assistantMessage : message) : [...prev, assistantMessage];
      });
      // 実ストリームで文字を受信済みなら、二重の疑似タイピングを行わない。
      if (!receivedDelta) {
        waitForPresentation = true;
        setTypingMessageId(assistantMessage.id);
      } else {
        setBusy(false);
        onGenerationStateChange?.({ busy: false });
      }
    } catch (error: any) {
      if (seq !== seqRef.current) return;
      const assistantMessage: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', text: error?.message || 'AI回答に失敗しました。' };
      setMessages(prev => [...prev, assistantMessage]);
      waitForPresentation = true;
      setTypingMessageId(assistantMessage.id);
    } finally {
      if (seq === seqRef.current && !waitForPresentation) {
        setBusy(false);
        onGenerationStateChange?.({ busy: false });
      }
    }
  }

  function finishTypewriter(messageId: string) {
    if (typingMessageId !== messageId) return;
    setTypingMessageId(null);
    setBusy(false);
    onGenerationStateChange?.({ busy: false });
  }

  function prepareChatAction(message: ChatMessage, action: ChatAnswerAction) {
    const base = formatAiAnswerMarkdown(message, true);
    const date = new Date().toISOString().slice(0, 10);
    if (action === 'copy_markdown') {
      navigator.clipboard?.writeText(base).then(() => setActionMessage('Markdownをコピーしました。')).catch(() => setActionMessage('コピーに失敗しました。'));
      return;
    }
    if (action === 'append_current_page') {
      setActionPreview({ messageId: message.id, action, title: `AI回答メモ ${date}`, body: `\n\n---\n\n## AI回答メモ（${date}）\n\n${base}\n` });
      return;
    }
    if (action === 'create_page') {
      setActionPreview({ messageId: message.id, action, title: `AI回答: ${shortText(message.query || currentTitle || 'メモ', 32)}`, body: `# AI回答\n\n${base}\n` });
      return;
    }
    if (action === 'create_tasks') {
      const tasks = extractTodoLinesFromAnswer(message.text);
      setActionPreview({ messageId: message.id, action, title: `AI TODO ${date}`, body: [`# AI抽出TODO`, '', ...tasks, '', buildSourceMarkdown(message.results || [])].filter(Boolean).join('\n') });
      return;
    }
    if (action === 'create_faq_draft') {
      const draft = buildFaqDraftFromAnswer(message);
      setActionPreview({ messageId: message.id, action, title: draft.question, body: draft.answer });
    }
  }

  async function executeChatAction() {
    if (!api || !actionPreview || actionBusy) return;
    setActionBusy(true);
    setActionMessage('実行中...');
    try {
      if (actionPreview.action === 'append_current_page') {
        if (!currentPageId) throw new Error('現在ページがありません。');
        const page = await api.getPage(currentPageId);
        const markdown = `${page.markdown || ''}${actionPreview.body}`;
        await api.savePage({
          id: page.meta.id,
          title: page.meta.title,
          markdown,
          blocksuite: page.blocksuite || {},
          baseUpdatedAt: page.meta.updatedAt,
          properties: page.meta.properties,
          icon: page.meta.icon,
          scope: page.meta.scope,
        });
        workspaceMutationCoordinator.publish({ kind: 'ai-page-appended', pageIds: [page.meta.id], cacheScopes: ['workspace', 'graph', 'search', 'tasks', 'notifications'] }, [workspaceMutationCoordinator.pageTarget(page.meta.id)]);
        setActionMessage('現在ページに追記しました。');
      } else if (actionPreview.action === 'create_page') {
        const created = await api.createPage(actionPreview.title || 'AI回答', currentPageId || null, 'shared');
        await api.savePage({
          id: created.meta.id,
          title: actionPreview.title || created.meta.title,
          markdown: actionPreview.body,
          blocksuite: created.blocksuite || {},
          baseUpdatedAt: created.meta.updatedAt,
          properties: created.meta.properties,
          icon: '✨',
          scope: created.meta.scope,
        });
        workspaceMutationCoordinator.publish({ kind: 'ai-page-created', pageIds: [created.meta.id], cacheScopes: ['workspace', 'graph', 'search', 'tasks', 'notifications'] }, [workspaceMutationCoordinator.pageTarget(created.meta.id)]);
        setActionMessage('AI回答ページを作成しました。');
        onOpenPage?.(created.meta.id);
      } else if (actionPreview.action === 'create_tasks') {
        await api.createInboxItem(actionPreview.body, actionPreview.title || 'AI抽出TODO');
        setActionMessage('TODO候補をInbox/Task素材として保存しました。');
      } else if (actionPreview.action === 'create_faq_draft') {
        await api.upsertSmartFaqRecord({
          question: actionPreview.title || 'AIチャット回答',
          answer: actionPreview.body || '回答を入力してください。',
          category: 'AIチャット下書き',
          tags: ['AIチャット', '下書き'],
          status: 'draft',
          confidence: 60,
          sourceType: 'ai-chat',
          sourceTitles: messages.find(item => item.id === actionPreview.messageId)?.results?.map(item => item.chunk?.title || '').filter(Boolean).slice(0, 8) || [],
          sourceText: actionPreview.body.slice(0, 3000),
        });
        setActionMessage('FAQ下書きとして保存しました。Smart AssistのFAQ管理で確認できます。');
      }
      setActionPreview(null);
    } catch (error: any) {
      setActionMessage(error?.message || 'アクション実行に失敗しました。');
    } finally {
      setActionBusy(false);
    }
  }

  function openResult(item: SemanticResult) {
    const chunk = item.chunk || {};
    if (chunk.type === 'page' && chunk.sourceId) onOpenPage?.(chunk.sourceId);
    else if (chunk.type === 'journal' && chunk.sourceId) onOpenJournal?.(chunk.sourceId);
    else if (chunk.type === 'database_row' && chunk.databaseId && chunk.rowId) onOpenDatabaseRow?.(chunk.databaseId, chunk.rowId);
    else if (chunk.type === 'database_row' && chunk.databaseId) onOpenDatabase?.(chunk.databaseId);
    else if (chunk.type === 'attachment_summary' && chunk.parentPageId) onOpenPage?.(chunk.parentPageId);
  }

  const quickActions = [
    currentPageId ? { label: 'このページを要約', prompt: 'このページを要約して', mode: 'detail' as AnswerMode, scope: 'page' as ChatScope } : null,
    currentPageId ? { label: 'TODO抽出', prompt: 'このページからTODO、期限、確認事項を抽出して', mode: 'steps' as AnswerMode, scope: 'page' as ChatScope } : null,
    currentPageId ? { label: '関連情報', prompt: 'このページに関連する情報を探して', mode: 'evidence' as AnswerMode, scope: 'page' as ChatScope } : null,
    currentPageId ? { label: 'ページ診断', prompt: 'このページを業務Wikiとして診断して。古い年度表記、根拠不足、説明の抜け漏れ、重複、FAQ候補を優先度順に示して', mode: 'evidence' as AnswerMode, scope: 'page' as ChatScope } : null,
    { label: '近いFAQ', prompt: 'この内容に近いFAQを探して', mode: 'faq' as AnswerMode, scope },
    { label: 'やさしく説明', prompt: 'この内容をやさしく説明して', mode: 'standard' as AnswerMode, scope },
  ].filter(Boolean) as Array<{ label: string; prompt: string; mode: AnswerMode; scope: ChatScope }>;

  return <section className="workspace-ai-chat-panel workspace-ai-chat-panel-v347 workspace-ai-chat-panel-v353">
    <div className="workspace-ai-chat-head workspace-ai-chat-head-v353">
      <div>
        <span>AI Assistant</span>
        <h3>ワークスペースに質問</h3>
        <p>{scope === 'page' && currentTitle ? `このページ: ${currentTitle}` : 'FAQ・ページ・DB・Journalをもとに自然に回答します。'}</p>
      </div>
      <div className="workspace-ai-head-actions-v353">
        <button type="button" onClick={startNewChatSession}>新規</button>
        <button type="button" onClick={() => setHistoryOpen(v => !v)}>履歴{savedSessions.length ? ` ${savedSessions.length}` : ''}</button>
        <button type="button" onClick={() => setSettingsOpen(v => !v)}>{settingsOpen ? '設定を隠す' : '設定'}</button>
        <button type="button" onClick={() => onOpenDetailedSearch?.(input)}>詳しく検索</button>
        {onClose ? <button type="button" className="workspace-ai-close" onClick={onClose}>閉じる</button> : null}
      </div>
    </div>

    <div className="workspace-ai-status-strip-v353">
      <span>対象: {scope === 'page' ? 'このページ' : '全体'}</span>
      <span>回答: {answerModePreset.label}</span>
      <span>読込: {pageReadPreset.label}</span>
      <span>長さ: {answerLengthPreset.label}</span>
      <span>口調: {tonePresetOption.label}</span>
      <span className={serverCtxWarning ? 'warn' : ''}>ctx: {serverContextSize || '不明'} / 推奨{recommendedContext}</span>
      {(pinnedSourceKeys.length || excludedSourceKeys.length) ? <span>固定{pinnedSourceKeys.length} / 除外{excludedSourceKeys.length}{usePinnedOnly ? ' / 固定のみ' : ''}</span> : null}
      {activeSessionId ? <span>履歴保存中</span> : null}
    </div>

    {historyOpen ? <div className="workspace-ai-history-panel-v357">
      <div className="workspace-ai-history-head-v357">
        <div><strong>AIチャット履歴</strong><small>直近{AI_CHAT_HISTORY_LIMIT}件をこの端末に保存します。</small></div>
        <div>
          <button type="button" onClick={startNewChatSession}>新規</button>
          {savedSessions.length ? <button type="button" className="danger" onClick={clearAiChatHistory}>全削除</button> : null}
        </div>
      </div>
      {savedSessions.length ? <div className="workspace-ai-history-list-v357">
        {savedSessions.map(session => <article key={session.id} className={session.id === activeSessionId ? 'active' : ''}>
          <button type="button" onClick={() => restoreChatSession(session)}>
            <b>{session.title}</b>
            <span>{session.pageTitle ? `ページ: ${session.pageTitle}` : 'ワークスペース'} ・ {session.messageCount}件 ・ {formatHistoryTime(session.updatedAt)}</span>
          </button>
          <button type="button" className="delete" onClick={() => deleteChatSession(session.id)}>削除</button>
        </article>)}
      </div> : <p className="workspace-ai-history-empty-v357">まだ保存されたAIチャットはありません。質問すると自動保存されます。</p>}
      {historyMessage ? <small className="workspace-ai-history-message-v357">{historyMessage}</small> : null}
    </div> : null}

    {settingsOpen ? <div className="workspace-ai-settings-card-v353">
      <div className="workspace-ai-chat-toolbar-v347 workspace-ai-chat-toolbar-v353">
        <label><span>対象</span><select value={scope} onChange={event => setScope(event.target.value as ChatScope)}>
          <option value="workspace">ワークスペース全体</option>
          <option value="page" disabled={!currentPageId}>このページ</option>
        </select></label>
        <label><span>回答</span><select value={answerMode} onChange={event => { const nextMode = event.target.value as AnswerMode; setAnswerMode(nextMode); if (nextMode === 'document') { setAnswerLength('long'); setPageReadMode('detail'); } }}>
          {ANSWER_MODES.map(mode => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
        </select></label>
        <label><span>読込</span><select value={pageReadMode} onChange={event => setPageReadMode(event.target.value as PageReadMode)}>
          {PAGE_READ_MODES.map(mode => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
        </select></label>
        <label><span>長さ</span><select value={answerLength} onChange={event => setAnswerLength(event.target.value as AnswerLength)}>
          {ANSWER_LENGTHS.map(mode => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
        </select></label>
        <label><span>口調</span><select value={tonePreset} onChange={event => setTonePreset(event.target.value as TonePreset)}>
          {TONE_PRESETS.map(mode => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
        </select></label>
      </div>
      <div className="workspace-ai-setting-help-v353">
        <span>{answerModePreset.hint}</span>
        {answerMode === 'document' ? <strong>文書作成は最大2048トークン・推奨ctx 8192です。通常回答より時間とメモリを使います。</strong> : null}
        <span>{pageReadPreset.hint}</span>
        <span>{answerLengthPreset.hint}</span>
        <span>{tonePresetOption.hint}</span>
      </div>
      <div className="workspace-ai-capacity-grid-v353">
        <div><b>高速</b><span>約2,400文字 / ctx 2048 / 短時間確認</span></div>
        <div><b>標準</b><span>約6,000文字 / ctx 4096 / 通常ページ</span></div>
        <div><b>詳細</b><span>約12,000文字 / ctx 6144以上 / 長文要約</span></div>
      </div>
      <div className="workspace-ai-server-summary-v353">
        <button type="button" onClick={() => setServerPanelOpen(v => !v)}>{serverPanelOpen ? '常駐設定を閉じる' : 'llama-server診断'}</button>
        {serverCtxWarning ? <strong>ctx不足: 推奨ctxで再起動してください。</strong> : serverCtxUnknown ? <strong>ctx不明: 外部serverのctxを確認してください。</strong> : <span>server {serverStatus?.reachable ? '起動中' : (serverStatus?.state || '未確認')} / ctx {serverContextSize || '不明'}</span>}
      </div>
      {serverPanelOpen ? <div className="workspace-ai-server-diagnostics-v352 workspace-ai-server-diagnostics-v353">
        <span>推奨ctx {recommendedContext}</span>
        <span>server {serverStatus?.reachable ? '起動中' : (serverStatus?.state || '未確認')}</span>
        <span>現在ctx {serverContextSize || '不明'}</span>
        {serverStatus?.memoryMb ? <span>メモリ {serverStatus.memoryMb} MB</span> : null}
        <button type="button" onClick={refreshGenerationServerStatus} disabled={serverBusy}>状態更新</button>
        <button type="button" onClick={restartGenerationServerWithRecommendedContext} disabled={serverBusy}>推奨ctxで起動/再起動</button>
        {serverCtxWarning ? <strong>ctx不足: 長文回答は失敗する可能性があります。</strong> : null}
        {serverCtxUnknown ? <strong>ctx不明: 外部起動serverの場合は、読込モードに合うctxで起動してください。</strong> : null}
        {serverMessage ? <small>{serverMessage}</small> : null}
      </div> : null}
    </div> : null}

    <div className="workspace-ai-chat-source-state-v347 workspace-ai-chat-source-state-v353 workspace-ai-chat-source-state-v356">
      <span>使用固定 {pinnedSourceKeys.length}件</span>
      <span>除外 {excludedSourceKeys.length}件</span>
      <label className="workspace-ai-pinned-only-v356"><input type="checkbox" checked={usePinnedOnly} disabled={!pinnedSourceKeys.length} onChange={event => setUsePinnedOnly(event.target.checked)} />固定した参照元だけで回答</label>
      {(pinnedSourceKeys.length || excludedSourceKeys.length) ? <button type="button" onClick={() => { setSourcePrefs({}); setUsePinnedOnly(false); }}>リセット</button> : null}
    </div>

    <div className="workspace-ai-chat-prompts workspace-ai-chat-actions-v347 workspace-ai-chat-actions-v353">
      {quickActions.map(action => <button key={action.label} type="button" onClick={() => ask(action.prompt, action.mode, action.scope)} disabled={busy}>{action.label}</button>)}
    </div>

    <div className="workspace-ai-chat-messages workspace-ai-chat-messages-v353" ref={chatMessagesRef}>
      {messages.map(message => <article key={message.id} className={`workspace-ai-chat-message ${message.role}`}>
        <div className={`workspace-ai-chat-bubble ${message.clarificationNeeded ? 'needs-clarification-v359' : ''}`}> 
          {message.generated !== undefined ? <small className="workspace-ai-chat-badge-v347">{message.generated ? '生成AI回答' : '検索ベース回答'}{message.elapsedMs ? ` / ${message.elapsedMs}ms` : ''}</small> : null}
          {message.usage ? <small className="workspace-ai-chat-usage-v350">読込 {message.usage.usedPageChars || 0}/{message.usage.totalPageChars || 0}文字 ・ チャンク {message.usage.pageChunkCount || 0} ・ ctx {message.usage.contextSize || '-'} ・ max {message.usage.maxTokens || '-'}</small> : null}
          {message.answerPlan || message.grounding?.intentLabel ? <small className="workspace-ai-intent-route-v360">判断: {message.answerPlan?.label || message.grounding?.intentLabel || '自動'} ・ {message.answerPlan?.searchStrategy || message.grounding?.searchStrategy || '検索'}{message.answerPlan?.needsClarification || message.clarificationNeeded ? ' ・ 確認優先' : ''}</small> : null}
          {message.answerTemplate?.label ? <small className="workspace-ai-template-route-v362">回答形式: {message.answerTemplate.label}</small> : null}
          {message.grounding ? <small className={`workspace-ai-grounding-v356 ${message.grounding.confidence || 'none'}`}>根拠: {message.grounding.confidence === 'high' ? '高' : message.grounding.confidence === 'medium' ? '中' : message.grounding.confidence === 'low' ? '低' : 'なし'} ・ 使用{message.grounding.usedSourceCount || 0}件 ・ 固定{message.grounding.pinnedCount || 0}件 ・ 除外{message.grounding.excludedCount || 0}件{message.grounding.topScore !== undefined ? ` ・ score${message.grounding.topScore}` : ''}{message.grounding.rerank?.topAnswerFit !== undefined ? ` ・ 適合${message.grounding.rerank.topAnswerFit}` : ''}{message.grounding.sourceMode === 'pinned_only' ? ' ・ 固定のみ' : ''}</small> : null}
          {message.answerVerification?.checked ? <details className={`workspace-ai-answer-verification-v363 ${message.answerVerification.quality || 'medium'}`}>
            <summary><strong>回答品質: {message.answerVerification.label || (message.answerVerification.quality === 'high' ? '高' : message.answerVerification.quality === 'review' ? '要確認' : '中')}</strong><span>{message.answerVerification.summary || '回答を検証しました。'}</span></summary>
            {message.answerVerification.unsupportedClaims?.length ? <div><b>要確認の表現</b><ul>{message.answerVerification.unsupportedClaims.slice(0, 6).map(item => <li key={item}>{item}</li>)}</ul></div> : null}
            {message.answerVerification.missingInfo?.length ? <div><b>この資料だけでは不足しやすい情報</b><ul>{message.answerVerification.missingInfo.slice(0, 6).map(item => <li key={item}>{item}</li>)}</ul></div> : null}
            {message.answerVerification.sourceChars !== undefined ? <small>検証対象 {message.answerVerification.sourceChars}文字 ・ {message.answerVerification.policy || 'answer_verification'}</small> : null}
          </details> : null}
          {message.role === 'assistant'
            ? message.streaming
              ? <div className="workspace-ai-live-answer-v467" aria-live="polite">{message.text || '回答を生成しています'}<span className="workspace-ai-progressive-answer-cursor-v466" aria-hidden="true" /></div>
              : <ProgressiveAnswer markdown={message.text} active={typingMessageId === message.id} onComplete={() => finishTypewriter(message.id)} />
            : message.text.split('\n').map((line, index) => <p key={index}>{line}</p>)}
          {message.warning ? <small className="workspace-ai-chat-warning">{message.warning}</small> : null}
          {message.role === 'assistant' && message.id !== 'welcome' ? <div className="workspace-ai-answer-actions-v354">
            <button type="button" onClick={() => prepareChatAction(message, 'copy_markdown')}>コピー</button>
            {currentPageId ? <button type="button" onClick={() => prepareChatAction(message, 'append_current_page')}>現在ページに追記</button> : null}
            <button type="button" onClick={() => prepareChatAction(message, 'create_page')}>新規ページ化</button>
            <button type="button" onClick={() => prepareChatAction(message, 'create_tasks')}>TODO化</button>
            <button type="button" onClick={() => prepareChatAction(message, 'create_faq_draft')}>FAQ下書き</button>
          </div> : null}
        </div>
        {message.results?.length ? <details className="workspace-ai-chat-sources workspace-ai-chat-sources-v359">
          <summary className="workspace-ai-chat-sources-head">
            <strong>根拠・参照候補 {message.results.length}件</strong>
            <button type="button" onClick={(event) => { event.preventDefault(); onOpenDetailedSearch?.(message.query || [...messages].reverse().find(m => m.role === 'user')?.text || ''); }}>詳しく検索</button>
          </summary>
          {message.results.slice(0, 6).map(item => {
            const chunk = item.chunk || {};
            const pref = sourcePrefs[resultKey(item)];
            return <div key={resultKey(item)} className={`workspace-ai-chat-source-wrap-v347 ${pref || ''}`}>
              <button type="button" className="workspace-ai-chat-source" onClick={() => openResult(item)}>
                <span>{typeIcon(chunk.type)}</span>
                <b>{chunk.title || 'Untitled'}</b>
                <small>{typeLabel(chunk.type)} ・ score {Math.round(Number(item.score || 0))}{item.semanticScore ? ` ・ 意味${Math.round(item.semanticScore)}%` : ''}</small>
              </button>
              <div className="workspace-ai-source-actions-v347">
                <button type="button" className={pref === 'use' ? 'active' : ''} onClick={() => setSourcePreference(item, 'use')}>使う</button>
                <button type="button" className={pref === 'exclude' ? 'active danger' : ''} onClick={() => setSourcePreference(item, 'exclude')}>除外</button>
              </div>
            </div>;
          })}
        </details> : null}
        {message.suggestions?.length ? <div className="workspace-ai-next-suggestions-v359">
          <strong>続けてできます</strong>
          <div>{message.suggestions.slice(0, 5).map(suggestion => <button key={`${message.id}:${suggestion}`} type="button" onClick={() => ask(suggestion)} disabled={busy}>{suggestion}</button>)}</div>
        </div> : null}
      </article>)}
      {busy && !typingMessageId ? <article className="workspace-ai-chat-message assistant workspace-ai-thinking-message-v465"><div className="workspace-ai-chat-bubble"><AiThinkingIndicator startedAt={generationStartedAt || Date.now()} /></div></article> : null}

      {actionPreview ? <article className="workspace-ai-chat-message assistant workspace-ai-action-preview-message-v355">
        <div className="workspace-ai-action-preview-v354 workspace-ai-action-preview-v355">
          <div className="workspace-ai-action-preview-head-v354">
            <strong>実行前プレビュー</strong>
            <span>{actionPreview.action === 'append_current_page' ? '現在ページに追記' : actionPreview.action === 'create_page' ? '新規ページ作成' : actionPreview.action === 'create_tasks' ? 'TODO保存' : 'FAQ下書き保存'}</span>
          </div>
          <label>タイトル<input value={actionPreview.title} onChange={event => setActionPreview(prev => prev ? { ...prev, title: event.target.value } : prev)} /></label>
          <label>内容<textarea value={actionPreview.body} onChange={event => setActionPreview(prev => prev ? { ...prev, body: event.target.value } : prev)} rows={8} /></label>
          <div className="workspace-ai-action-preview-buttons-v354 workspace-ai-action-preview-buttons-v355">
            <button type="button" onClick={() => setActionPreview(null)} disabled={actionBusy}>キャンセル</button>
            <button type="button" className="primary" onClick={executeChatAction} disabled={actionBusy}>{actionBusy ? '実行中...' : '実行する'}</button>
          </div>
        </div>
      </article> : null}
      <div ref={chatBottomRef} className="workspace-ai-chat-bottom-anchor-v363" aria-hidden="true" />
    </div>

    {actionMessage ? <small className="workspace-ai-action-message-v354">{actionMessage}</small> : null}
    {historyMessage && !historyOpen ? <small className="workspace-ai-history-message-v357 compact">{historyMessage}</small> : null}

    <form className="workspace-ai-chat-input workspace-ai-chat-input-v353" onSubmit={event => { event.preventDefault(); ask(); }}>
      <input
        ref={inputRef}
        value={input}
        onChange={event => setInput(event.target.value)}
        placeholder={scope === 'page' ? 'このページについて質問...' : 'ワークスペースに質問...'}
      />
      <button type="submit" disabled={busy || !input.trim()}>{busy ? '...' : '送信'}</button>
    </form>
  </section>;
}
