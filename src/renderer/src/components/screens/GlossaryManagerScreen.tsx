import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GlossaryCandidate,
  GlossaryTerm,
  GlossaryTermInsight,
  PageWithLock,
} from "../../../../shared/types";
import { findGlossaryNameConflicts } from "../../lib/glossary";
import {
  GLOSSARY_IMPORT_COLUMNS,
  GLOSSARY_IMPORT_CSV_SAMPLE,
  GLOSSARY_IMPORT_JSON_SAMPLE,
  parseGlossaryImportFile,
  planGlossaryImport,
  type GlossaryImportPayload,
} from "../../lib/glossaryImport";
import type { ApiClient } from "../../lib/api";

const emptyDraft = (): GlossaryTerm => ({
  id: `term_${crypto.randomUUID()}`,
  term: "",
  aliases: [],
  summary: "",
  category: "",
  status: "draft",
  sourcePageIds: [],
  updatedAt: new Date().toISOString(),
  updatedBy: "",
});

type Props = {
  terms: GlossaryTerm[];
  pages: PageWithLock[];
  api: ApiClient | null;
  initialDraftTerm?: string;
  onInitialDraftConsumed?: () => void;
  onSave: (terms: GlossaryTerm[]) => Promise<void>;
  onOpenPage: (id: string) => void;
  onBack: () => void;
};

function dateLabel(value?: string) {
  if (!value) return "未設定";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ja-JP");
}

export function GlossaryManagerScreen({ terms, pages, api, initialDraftTerm, onInitialDraftConsumed, onSave, onOpenPage, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(terms[0]?.id ?? null);
  const [draft, setDraft] = useState<GlossaryTerm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [insight, setInsight] = useState<GlossaryTermInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [candidates, setCandidates] = useState<GlossaryCandidate[] | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importPayload, setImportPayload] = useState<GlossaryImportPayload | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importUpdatingExisting, setImportUpdatingExisting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const importPlan = useMemo(() => importPayload ? planGlossaryImport(terms, importPayload.terms, importUpdatingExisting) : null, [terms, importPayload, importUpdatingExisting]);
  const selected = draft ?? terms.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const term = String(initialDraftTerm || "").trim();
    if (!term) return;
    const item = { ...emptyDraft(), term };
    setSelectedId(item.id);
    setDraft(item);
    setCandidates(null);
    setImportPayload(null);
    setSaveError(null);
    onInitialDraftConsumed?.();
  }, [initialDraftTerm, onInitialDraftConsumed]);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ja-JP");
    return !q ? terms : terms.filter((item) => [item.term, ...item.aliases, item.summary, item.category, item.owner].join(" ").toLocaleLowerCase("ja-JP").includes(q));
  }, [terms, query]);

  useEffect(() => {
    if (!api || !selected || draft) { setInsight(null); return; }
    const controller = new AbortController();
    setInsightLoading(true);
    api.getWorkspaceGlossaryInsight(selected.id)
      .then((value) => { if (!controller.signal.aborted) setInsight(value); })
      .catch(() => { if (!controller.signal.aborted) setInsight(null); })
      .finally(() => { if (!controller.signal.aborted) setInsightLoading(false); });
    return () => controller.abort();
  }, [api, selected?.id, draft]);

  const startEdit = (item: GlossaryTerm) => {
    setSelectedId(item.id); setSaveError(null);
    setDraft({ ...item, aliases: [...item.aliases], sourcePageIds: [...item.sourcePageIds] });
  };
  const save = async () => {
    if (!draft || draft.term.trim().length < 2 || !draft.summary.trim()) return;
    setSaving(true);
    try {
      const normalized: GlossaryTerm = {
        ...draft,
        term: draft.term.trim(),
        aliases: Array.from(new Set(draft.aliases.map((value) => value.trim()).filter(Boolean))),
        summary: draft.summary.trim(),
        category: draft.category?.trim() || undefined,
        owner: draft.owner?.trim() || undefined,
        verifiedAt: draft.verifiedAt?.trim() || undefined,
        reviewDue: draft.reviewDue?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      const exists = terms.some((item) => item.id === normalized.id);
      const next = exists ? terms.map((item) => item.id === normalized.id ? normalized : item) : [...terms, normalized];
      const conflicts = findGlossaryNameConflicts(next);
      if (conflicts.length) {
        const first = conflicts[0];
        setSaveError(`「${first.name}」は「${first.terms.join("」と「")}」で重複しています。正式名称・別名は1つの用語だけに登録してください。`);
        return;
      }
      setSaveError(null); await onSave(next); setSelectedId(normalized.id); setDraft(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "用語を保存できませんでした。"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!selected || !terms.some((item) => item.id === selected.id) || !window.confirm(`「${selected.term}」を用語辞書から削除しますか？`)) return;
    setSaving(true); try { await onSave(terms.filter((item) => item.id !== selected.id)); setSelectedId(null); setDraft(null); }
    finally { setSaving(false); }
  };
  const detectCandidates = async () => {
    if (!api) return; setCandidateLoading(true);
    try { setCandidates((await api.getWorkspaceGlossaryCandidates()).candidates); }
    finally { setCandidateLoading(false); }
  };
  const createFromCandidate = (candidate: GlossaryCandidate) => {
    // Candidate examples show where a phrase is used. They are not automatically
    // treated as supporting sources for the definition.
    const item = { ...emptyDraft(), term: candidate.phrase, summary: "", sourcePageIds: [] };
    setSelectedId(item.id); setDraft(item); setCandidates(null); setSaveError(null);
  };

  const chooseImport = () => importInputRef.current?.click();
  const readImport = async (file?: File) => {
    if (!file) return;
    setImportError(null);
    try {
      const payload = await parseGlossaryImportFile(file);
      setImportPayload(payload);
      setImportFileName(file.name);
      setImportUpdatingExisting(false);
      setCandidates(null);
      setDraft(null);
    } catch (error) {
      setImportPayload(null);
      setImportError(error instanceof Error ? error.message : "取込ファイルを読み込めませんでした。");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };
  const applyImport = async () => {
    if (!importPlan || importPlan.conflicts.length) return;
    setSaving(true);
    try {
      await onSave(importPlan.nextTerms);
      setImportPayload(null);
      setImportFileName("");
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "用語辞書を更新できませんでした。");
    } finally { setSaving(false); }
  };

  return <section className="glossary-management-screen">
    <header className="workspace-tag-management-header"><div><span className="eyebrow">WORKSPACE GLOSSARY</span><h1>用語辞書</h1><p>説明文を定義として管理し、必要な場合だけ補足資料・見直し期限・利用状況を紐づけます。用語の検出は辞書画面だけで実行され、ページ編集を重くしません。</p></div><button className="secondary" onClick={onBack}>戻る</button></header>
    <div className="glossary-manager-layout"><aside>
      <div className="glossary-manager-actions"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用語・別名を検索"/><button onClick={() => { const item=emptyDraft(); setSaveError(null); setSelectedId(item.id); setDraft(item); }}>＋ 用語を追加</button><button className="secondary" onClick={chooseImport}>⇧ CSV / JSON取込</button><input ref={importInputRef} className="glossary-file-input" type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => void readImport(event.target.files?.[0])}/><button className="secondary glossary-candidate-button" onClick={() => void detectCandidates()} disabled={!api || candidateLoading}>{candidateLoading ? "候補を確認中…" : "✦ 未登録語を探す"}</button></div>
      <details className="glossary-import-format" open>
        <summary>CSV / JSON の取込形式を見る</summary>
        <p>必須項目は <code>term</code>（正式名称）と <code>summary</code>（定義）です。CSVは日本語見出しの「用語」「説明文」「定義」なども使えます。JSONは配列、または <code>{'{ terms: [...] }'}</code> 形式に対応しています。</p>
        <div className="glossary-import-format-grid">
          <section><h3>CSV</h3><p>別名や補足資料IDはカンマ区切りで入力します。</p><pre>{GLOSSARY_IMPORT_CSV_SAMPLE}</pre></section>
          <section><h3>JSON</h3><p>aliases と sourcePageIds は配列で入力します。</p><pre>{GLOSSARY_IMPORT_JSON_SAMPLE}</pre></section>
        </div>
        <small>利用できる列：<code>{GLOSSARY_IMPORT_COLUMNS}</code></small>
      </details>
      <div className="glossary-manager-list">{visible.map((item) => <button key={item.id} className={selected?.id === item.id ? "is-selected" : ""} onClick={() => startEdit(item)}><strong>{item.term}</strong><small>{item.category || "未分類"} · {item.status === "verified" ? "確認済み" : item.status === "deprecated" ? "旧用語" : "下書き"}</small></button>)}{!visible.length && <p>一致する用語はありません。</p>}</div>
    </aside><main>
      {importPayload && importPlan ? <div className="glossary-editor glossary-import-preview"><div className="glossary-editor-head"><h2>用語辞書を取り込む</h2><button className="secondary" onClick={() => { setImportPayload(null); setImportError(null); }}>閉じる</button></div><p className="glossary-section-note"><b>{importFileName}</b>（{importPayload.format.toUpperCase()}）を確認しています。保存前に件数と重複を確認できます。</p><div className="glossary-import-summary"><span>読込 <b>{importPayload.terms.length}</b>件</span><span>新規 <b>{importPlan.added}</b>件</span><span>更新候補 <b>{importUpdatingExisting ? importPlan.updates : importPlan.skipped}</b>件</span><span>無効行 <b>{importPayload.issues.length}</b>件</span></div><label className="glossary-import-mode"><input type="checkbox" checked={importUpdatingExisting} onChange={(event) => setImportUpdatingExisting(event.target.checked)}/> 同じ正式名称またはIDの既存用語を、取込内容で更新する</label><p className="glossary-section-note">チェックしない場合、既存の用語は変更せず新規用語だけを追加します。CSV列：<code>{GLOSSARY_IMPORT_COLUMNS}</code></p><details className="glossary-import-format"><summary>CSV / JSON の構成を確認する</summary><div className="glossary-import-format-grid"><section><h3>CSV</h3><pre>{GLOSSARY_IMPORT_CSV_SAMPLE}</pre></section><section><h3>JSON</h3><pre>{GLOSSARY_IMPORT_JSON_SAMPLE}</pre></section></div></details>{importPayload.issues.length > 0 && <details className="glossary-import-issues"><summary>読込時の注意 {importPayload.issues.length}件</summary>{importPayload.issues.slice(0, 20).map((issue, index) => <p key={`${issue.row ?? "file"}:${index}`}>{issue.row ? `${issue.row}行目：` : ""}{issue.message}</p>)}</details>}{importPlan.conflicts.length > 0 && <div className="glossary-editor-error" role="alert">{importPlan.conflicts.slice(0, 3).map((conflict) => <p key={conflict.name}>「{conflict.name}」が「{conflict.terms.join("」「")}」で重複します。別名または正式名称を修正してください。</p>)}</div>}<div className="glossary-import-sample"><h3>取込プレビュー</h3>{importPayload.terms.slice(0, 8).map((term) => <div key={term.id}><strong>{term.term}</strong><small>{term.summary}</small></div>)}</div><footer><button className="secondary" onClick={() => { setImportPayload(null); setImportError(null); }}>キャンセル</button>{importError && <p className="glossary-editor-error" role="alert">{importError}</p>}<button onClick={() => void applyImport()} disabled={saving || !importPlan.added && !importPlan.updates || importPlan.conflicts.length > 0}>{saving ? "取り込み中…" : `用語辞書へ反映（${importPlan.added + importPlan.updates}件）`}</button></footer></div> : candidates ? <div className="glossary-editor glossary-candidates"><div className="glossary-editor-head"><h2>未登録の用語候補</h2><button className="secondary" onClick={() => setCandidates(null)}>閉じる</button></div><p className="glossary-section-note">最近更新されたページタイトル最大3,000件から、制度名・基準名などの候補を抽出しています。自動登録はしません。</p>{candidates.length ? <div className="glossary-candidate-list">{candidates.map((candidate) => <div key={candidate.phrase}><div><strong>{candidate.phrase}</strong><small>{candidate.count}ページで検出</small></div><button onClick={() => createFromCandidate(candidate)}>用語として作成</button></div>)}</div> : <p className="glossary-section-note">現在、確認が必要な候補は見つかりませんでした。</p>}</div> : selected ? <div className="glossary-editor">
        <div className="glossary-editor-head"><h2>{terms.some((item) => item.id === selected.id) ? "用語を編集" : "新しい用語"}</h2>{terms.some((item) => item.id === selected.id) && <button className="danger" onClick={() => void remove()} disabled={saving}>削除</button>}</div>
        {draft ? <>
          <label>正式名称<input value={selected.term} onChange={(event) => setDraft({ ...selected, term: event.target.value })} placeholder="例：延長保育"/></label>
          <label>短い説明（この用語の定義）<textarea value={selected.summary} onChange={(event) => setDraft({ ...selected, summary: event.target.value })} placeholder="読みながら確認できる、短く正確な説明"/></label>
          <label>別名・略称（カンマ区切り）<input value={selected.aliases.join(", ")} onChange={(event) => setDraft({ ...selected, aliases: event.target.value.split(/[、,]/).map((value) => value.trim()).filter(Boolean) })} placeholder="延長利用, 延長"/></label>
          <div className="glossary-editor-grid"><label>分類<input value={selected.category || ""} onChange={(event) => setDraft({ ...selected, category: event.target.value })} placeholder="制度・運用・施設など"/></label><label>定義の状態<select value={selected.status} onChange={(event) => setDraft({ ...selected, status: event.target.value as GlossaryTerm["status"] })}><option value="draft">下書き</option><option value="verified">定義を確認済み</option><option value="deprecated">旧用語</option></select></label></div>
          <details className="glossary-optional-details"><summary>補足情報（任意）</summary><p className="glossary-section-note">説明文だけで定義を運用できます。制度・料金・基準など、確認元を追いたい場合だけ入力してください。</p><div className="glossary-editor-grid"><label>管理担当<input value={selected.owner || ""} onChange={(event) => setDraft({ ...selected, owner: event.target.value })} placeholder="例：青少年育成課"/></label><label>定義を確認した日<input type="date" value={selected.verifiedAt?.slice(0,10) || ""} onChange={(event) => setDraft({ ...selected, verifiedAt: event.target.value || undefined })}/></label></div>
          <label>定義を見直す期限<input type="date" value={selected.reviewDue?.slice(0,10) || ""} onChange={(event) => setDraft({ ...selected, reviewDue: event.target.value || undefined })}/></label>
          <label>補足資料・関連ページ（必要な場合のみ。出現ページとは別に選択）<select multiple value={selected.sourcePageIds} onChange={(event) => setDraft({ ...selected, sourcePageIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>{pages.slice(0,500).map((page) => <option key={page.id} value={page.id}>{page.icon || "📄"} {page.title}</option>)}</select></label></details>
          <footer><button className="secondary" onClick={() => setDraft(null)} disabled={saving}>キャンセル</button>{saveError && <p className="glossary-editor-error" role="alert">{saveError}</p>}<button onClick={() => void save()} disabled={saving || selected.term.trim().length < 2 || !selected.summary.trim()}>{saving ? "保存中…" : "用語を保存"}</button></footer>
        </> : <>
          <div className="glossary-overview"><div><span>定義の状態</span><strong>{selected.status === "verified" ? "確認済み" : selected.status === "deprecated" ? "旧用語" : "下書き"}</strong></div><div><span>定義の最終確認</span><strong>{dateLabel(selected.verifiedAt)}</strong></div><div><span>見直し期限</span><strong>{dateLabel(selected.reviewDue)}</strong></div><button onClick={() => startEdit(selected)}>編集する</button></div>
          <p className="glossary-summary-readonly">{selected.summary}</p>{selected.aliases.length>0 && <p className="glossary-section-note">別名：{selected.aliases.join("、")}</p>}
          <section className="glossary-insight-section"><h3>定義の確認・補足資料</h3>{insightLoading ? <p className="glossary-section-note">軽量Indexから確認中…</p> : insight ? <><p className={`glossary-evidence-state is-${insight.evidence.state}`}>{insight.evidence.message}</p>{selected.owner && <p className="glossary-section-note">管理担当：{selected.owner}</p>}<div className="glossary-source-links">{insight.evidence.sourcePages.map((page) => <button key={page.id} onClick={() => onOpenPage(page.id)}>📄 {page.title} · {dateLabel(page.updatedAt)}</button>)}</div></> : <p className="glossary-section-note">定義の確認状態を取得できませんでした。</p>}</section>
          <section className="glossary-insight-section"><h3>利用状況</h3>{insight ? <><div className="glossary-usage-grid"><span>ページ <b>{insight.usage.pages}</b></span><span>DB行 <b>{insight.usage.databaseRows}</b></span><span>Journal <b>{insight.usage.journals}</b></span></div>{insight.recentUsage.length>0 && <div className="glossary-recent-usage">{insight.recentUsage.map((ref) => <button key={`${ref.kind}:${ref.id}`} onClick={() => ref.kind === "page" && onOpenPage(ref.id)} disabled={ref.kind !== "page"}>{ref.kind === "page" ? "📄" : ref.kind === "database-row" ? "▦" : "📓"} {ref.title}</button>)}</div>}</> : <p className="glossary-section-note">利用状況を取得中です。</p>}</section>
          <section className="glossary-insight-section"><h3>用語のつながり</h3>{insight?.related.length ? <div className="glossary-related-list">{insight.related.map((item) => <button key={item.termId} onClick={() => { setSelectedId(item.termId); setDraft(null); }}><strong>✦ {item.term}</strong><small>{item.reason}</small></button>)}</div> : <p className="glossary-section-note">共通の補足資料または同じ分類の確認済み用語はまだありません。</p>}</section>
          <section className="glossary-insight-section"><h3>表記統一候補</h3>{insight?.aliasUsage.length ? <div className="glossary-alias-list">{insight.aliasUsage.map((item) => <div key={item.alias}><span>「{item.alias}」 → <b>「{selected.term}」</b></span><small>ページ・DB行で {item.count} 件</small></div>)}</div> : <p className="glossary-section-note">置換候補になる別名の利用は見つかっていません。</p>}</section>
        </>}
      </div> : <div className="glossary-manager-empty">✦<h2>用語を選択してください</h2><p>新しい用語を追加すると、ページとデータベース内で意味を案内できます。</p></div>}
    </main></div>
  </section>;
}
