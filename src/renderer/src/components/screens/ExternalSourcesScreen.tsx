import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GoogleDrivePicker } from './GoogleDrivePicker';
import { GoogleCalendarPicker } from './GoogleCalendarPicker';
import { GoogleGmailPicker } from './GoogleGmailPicker';
import { enqueueGoogleWorkspaceItem, type GoogleWorkspaceQueueItem } from './googleWorkspaceQueue';
import { ExternalSourceRegistry } from '../../externalSources/registry';
import type { ExternalSourceIntent, ExternalSourceMode, ExternalSourceRecord, ExternalSourceResult } from '../../externalSources/types';
import { appendExternalSourceAudit, readExternalSourceAudit } from '../../externalSources/audit';
import { buildLineDiff } from '../../externalSources/diff';
import { clearExternalSourceCache, getExternalSourceCacheStats } from '../../externalSources/cache';
import { enqueueBackgroundSync, processBackgroundSyncQueue, readBackgroundSyncJobs, retryBackgroundSyncJob } from '../../externalSources/backgroundSync';
import { addGmailAction, addMeetingWorkflow, patchGmailAction, patchMeetingWorkflow, readExternalSourceRecords, readGmailActions, readMeetingWorkflows, readSyncIssues, removeExternalSourceRecord, resolveSyncIssue, upsertExternalSourceRecord } from '../../externalSources/store';

type Tab = 'search' | 'drive' | 'calendar' | 'gmail' | 'sync' | 'issues' | 'workflow' | 'settings' | 'audit';
type WorkspaceStatus = Awaited<ReturnType<typeof window.localNotion.googleWorkspace.getStatus>>;
const MODE_LABEL: Record<ExternalSourceMode, string> = { link: 'リンク', import: '取込', sync: '同期' };

function formatTime(value?: number): string { return value && Number.isFinite(value) ? new Date(value).toLocaleString('ja-JP') : '日時不明'; }
function sensitivityLabel(value: ExternalSourceResult['sensitivity']): string { return value === 'private' ? '個人' : value === 'organization' ? '組織' : value === 'shared-drive' ? '共有ドライブ' : '不明'; }
function toQueueItem(result: ExternalSourceResult, intent: ExternalSourceIntent, mode: ExternalSourceMode): GoogleWorkspaceQueueItem {
  if (result.providerId === 'drive') return { kind: 'drive', payload: result.payload, intent, mode };
  if (result.providerId === 'calendar') return { kind: 'calendar', payload: result.payload, intent, mode };
  return { kind: 'gmail', payload: result.payload, intent, mode };
}

export function ExternalSourcesScreen({ onBack, onOpenWhiteboard, onStatus }: { onBack: () => void; onOpenWhiteboard: () => void; onStatus?: (message: string) => void; }) {
  const [tab, setTab] = useState<Tab>('search');
  const [status, setStatus] = useState<WorkspaceStatus>({ configured: false, connected: false });
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExternalSourceResult[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [mode, setMode] = useState<ExternalSourceMode>('link');
  const [version, setVersion] = useState(0);
  const [diffRecord, setDiffRecord] = useState<ExternalSourceRecord | null>(null);
  const providers = useMemo(() => ExternalSourceRegistry.list(), []);
  const auditEntries = useMemo(() => readExternalSourceAudit(), [version]);
  const records = useMemo(() => readExternalSourceRecords(), [version]);
  const issues = useMemo(() => readSyncIssues(), [version]);
  const jobs = useMemo(() => readBackgroundSyncJobs(), [version]);
  const gmailActions = useMemo(() => readGmailActions(), [version]);
  const meetings = useMemo(() => readMeetingWorkflows(), [version]);
  const cacheStats = useMemo(() => getExternalSourceCacheStats(), [version]);
  const bump = () => setVersion((value) => value + 1);

  const refresh = useCallback(async () => setStatus(await window.localNotion.googleWorkspace.getStatus()), []);
  useEffect(() => { void refresh().catch((error) => onStatus?.(String(error))); void processBackgroundSyncQueue().finally(bump); }, [onStatus, refresh]);
  const run = useCallback(async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (error) { const message = error instanceof Error ? error.message : String(error); appendExternalSourceAudit({ action: 'error', detail: message }); onStatus?.(message); } finally { setBusy(false); bump(); } }, [onStatus]);

  const registerAndQueue = useCallback(async (result: ExternalSourceResult, intent: ExternalSourceIntent, selectedMode: ExternalSourceMode, open = true) => {
    let content: string | undefined;
    if (result.providerId === 'drive' && selectedMode !== 'link') {
      try { content = (await window.localNotion.googleWorkspace.getDriveFileContent(result.payload.id)).content; }
      catch (error) { if (selectedMode === 'import') throw error; }
    }
    upsertExternalSourceRecord(result, selectedMode, intent, content);
    enqueueGoogleWorkspaceItem(toQueueItem(result, intent, selectedMode));
    if (selectedMode === 'sync') enqueueBackgroundSync('source-refresh', result.key);
    if (intent === 'meeting-notes' && result.providerId === 'calendar') addMeetingWorkflow({ sourceKey: result.key, title: result.title, startsAt: result.payload.start.dateTime || result.payload.start.date });
    if (intent === 'task' && result.providerId === 'gmail') addGmailAction({ sourceKey: result.key, subject: result.title, sender: result.payload.from || '' });
    appendExternalSourceAudit({ action: 'queue', provider: result.providerId, detail: `${result.title}を${MODE_LABEL[selectedMode]}・${intent}として追加` });
    bump(); if (open) onOpenWhiteboard();
  }, [onOpenWhiteboard]);

  const searchAll = useCallback(() => run(async () => {
    if (!status.connected) throw new Error('先にGoogle Workspaceへ接続してください。');
    const settled = await Promise.allSettled(providers.filter((provider) => provider.isAvailable(status)).map((provider) => provider.search(query)));
    const merged = settled.flatMap((entry) => entry.status === 'fulfilled' ? entry.value : []).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    setResults(merged.slice(0, 150)); setSelectedKeys([]);
    appendExternalSourceAudit({ action: 'search', detail: `横断検索「${query || '最近の項目'}」: ${merged.length}件` });
  }), [providers, query, run, status]);

  const addSelected = useCallback((intent: ExternalSourceIntent) => run(async () => {
    const selected = results.filter((item) => selectedKeys.includes(item.key)).filter((item) => intent === 'reference' || (intent === 'meeting-notes' && item.providerId === 'calendar') || (intent === 'task' && item.providerId === 'gmail'));
    if (!selected.length) return;
    for (const item of selected) await registerAndQueue(item, intent, mode, false);
    onOpenWhiteboard();
  }), [mode, onOpenWhiteboard, registerAndQueue, results, run, selectedKeys]);

  return <section className="external-sources-screen">
    <header className="external-sources-head"><button type="button" onClick={onBack}>← 戻る</button><div><h2>External Sources</h2><p>リンク・取込・同期を分離し、差分とエラーを一元管理します。</p></div><span>{status.connected ? status.email || 'Google接続済み' : '未接続'}</span></header>
    <div className="external-sources-layout"><aside><b>情報源</b>{([
      ['search','⌕ 横断検索'],['drive','☁ Drive'],['calendar','📅 Calendar'],['gmail','✉ Gmail'],['sync','↻ 同期キュー'],['issues',`⚠ 解決センター${issues.length ? ` (${issues.length})` : ''}`],['workflow','✓ 実務ワークフロー'],['settings','⚙ 権限・設定'],['audit','☷ 監査ログ'],
    ] as Array<[Tab,string]>).map(([id,label])=><button key={id} type="button" className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}<small>外部ソース記録を正本にし、検索・同期・差分・ワークフローで再利用します。</small></aside>
    <main>
      {tab==='search'&&<div className="external-source-unified-search">
        <div className="external-source-searchbar"><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Drive・Gmail・Calendarを横断検索" onKeyDown={(e)=>{if(e.key==='Enter')void searchAll();}}/><button disabled={busy} onClick={()=>void searchAll()}>検索</button></div>
        <div className="external-source-mode-picker">{(['link','import','sync'] as ExternalSourceMode[]).map((value)=><button key={value} className={mode===value?'active':''} onClick={()=>setMode(value)}><b>{MODE_LABEL[value]}</b><small>{value==='link'?'Googleを正本として参照':value==='import'?'本文をローカルへ複製':'更新を追跡して差分表示'}</small></button>)}</div>
        <div className="external-source-provider-state">{providers.map((p)=><span key={p.id} className={p.isAvailable(status)?'ok':''}>{p.icon} {p.label}</span>)}</div>
        {!!selectedKeys.length&&<div className="external-source-bulkbar"><b>{selectedKeys.length}件・{MODE_LABEL[mode]}</b><button onClick={()=>void addSelected('reference')}>追加</button><button onClick={()=>void addSelected('meeting-notes')}>議事録化</button><button onClick={()=>void addSelected('task')}>タスク化</button></div>}
        <div className="external-source-result-grid">{results.map((item)=><article key={item.key} className={selectedKeys.includes(item.key)?'selected':''}><label><input type="checkbox" checked={selectedKeys.includes(item.key)} onChange={()=>setSelectedKeys((current)=>current.includes(item.key)?current.filter((key)=>key!==item.key):[...current,item.key])}/><span>{item.icon}</span><div><b>{item.title}</b><small>{item.subtitle}</small></div></label><footer><span>{item.providerId}</span><span>{sensitivityLabel(item.sensitivity)}</span><time>{formatTime(item.timestamp)}</time><button onClick={()=>void run(()=>registerAndQueue(item,'reference',mode))}>追加</button></footer></article>)}{!results.length&&<p>キーワードを入力して横断検索してください。</p>}</div>
      </div>}
      {tab==='drive'&&<GoogleDrivePicker onAdd={(file)=>{const result:ExternalSourceResult={key:`drive:${file.id}`,providerId:'drive',title:file.name,subtitle:file.mimeType,icon:'☁',sensitivity:file.driveId?'shared-drive':'private',timestamp:file.modifiedTime?Date.parse(file.modifiedTime):undefined,payload:file};void run(()=>registerAndQueue(result,'reference',mode));}} onChanges={()=>enqueueBackgroundSync('drive-changes')} onStatus={onStatus}/>} 
      {tab==='calendar'&&<GoogleCalendarPicker onAdd={(event)=>{const result:ExternalSourceResult={key:`calendar:${event.calendarId}:${event.id}`,providerId:'calendar',title:event.summary||'予定',subtitle:event.location||'Calendar',icon:'📅',sensitivity:'organization',timestamp:Date.parse(event.start.dateTime||event.start.date||''),payload:event};void run(()=>registerAndQueue(result,'meeting-notes',mode));}} onStatus={onStatus}/>} 
      {tab==='gmail'&&<GoogleGmailPicker onAdd={(message)=>{const result:ExternalSourceResult={key:`gmail:${message.id}`,providerId:'gmail',title:message.subject||'メール',subtitle:message.from||'',icon:'✉',sensitivity:'private',timestamp:Number(message.internalDate||0),payload:message};void run(()=>registerAndQueue(result,'task',mode));}} onStatus={onStatus}/>} 
      {tab==='sync'&&<div className="external-sync-center"><h3>Background Sync Queue</h3><p>UI操作と同期処理を分離し、同じジョブの重複登録を防ぎます。</p><div className="external-sync-actions"><button disabled={!status.connected} onClick={()=>{enqueueBackgroundSync('drive-changes');bump();}}>Drive差分同期を予約</button><button onClick={()=>void processBackgroundSyncQueue().finally(bump)}>今すぐ処理</button></div><div className="external-record-list">{jobs.map((job)=><article key={job.id}><b>{job.kind}</b><span className={`state-${job.state}`}>{job.state}</span><small>{formatTime(job.createdAt)}・試行{job.attempts}回</small>{job.error&&<p>{job.error}</p>}{job.state==='failed'&&<button onClick={()=>{retryBackgroundSyncJob(job.id);bump();}}>再試行</button>}</article>)}</div><h3>同期対象</h3><div className="external-record-list">{records.filter((r)=>r.mode==='sync').map((record)=><article key={record.key}><b>{record.title}</b><span>{record.syncState}</span><small>{record.lastSyncedAt?formatTime(record.lastSyncedAt):'未同期'}</small><button onClick={()=>setDiffRecord(record)} disabled={!record.previous}>差分</button></article>)}</div></div>}
      {tab==='issues'&&<div className="external-sync-center"><h3>同期エラー解決センター</h3><p>認証・権限・削除・競合・取得失敗を同じ画面で解決します。</p><div className="external-record-list">{issues.map((issue)=><article key={issue.id}><b>{issue.kind}</b><span>{issue.providerId}</span><p>{issue.message}</p><div><button onClick={()=>{resolveSyncIssue(issue.id);bump();}}>解決済み</button>{issue.sourceKey&&<button onClick={()=>{enqueueBackgroundSync('source-refresh',issue.sourceKey);resolveSyncIssue(issue.id);bump();}}>再試行</button>}{issue.sourceKey&&<button onClick={()=>{removeExternalSourceRecord(issue.sourceKey!);resolveSyncIssue(issue.id);bump();}}>リンク解除</button>}</div></article>)}{!issues.length&&<p>未解決の同期問題はありません。</p>}</div></div>}
      {tab==='workflow'&&<div className="external-workflows"><section><h3>会議ワークフロー</h3>{meetings.map((item)=><article key={item.id}><b>{item.title}</b><small>{item.startsAt||'日時不明'}</small><select value={item.status} onChange={(e)=>{patchMeetingWorkflow(item.id,{status:e.target.value as typeof item.status});bump();}}><option value="planned">準備中</option><option value="in-progress">進行中</option><option value="completed">完了</option></select><input type="date" value={item.followUpDate||''} onChange={(e)=>{patchMeetingWorkflow(item.id,{followUpDate:e.target.value});bump();}}/></article>)}</section><section><h3>Gmail対応管理</h3>{gmailActions.map((item)=><article key={item.id}><b>{item.subject}</b><small>{item.sender}</small><select value={item.status} onChange={(e)=>{patchGmailAction(item.id,{status:e.target.value as typeof item.status});bump();}}><option value="todo">未対応</option><option value="waiting">保留</option><option value="done">完了</option></select><input type="date" value={item.dueDate||''} onChange={(e)=>{patchGmailAction(item.id,{dueDate:e.target.value});bump();}}/><input value={item.assignee||''} placeholder="担当者" onChange={(e)=>{patchGmailAction(item.id,{assignee:e.target.value});bump();}}/></article>)}</section></div>}
      {tab==='settings'&&<div className="external-sources-settings"><h3>権限・キャッシュ</h3><div className="google-workspace-permissions"><span className={status.connected?'ok':''}>Drive</span><span className={status.calendarEnabled?'ok':''}>Calendar</span><span className={status.gmailEnabled?'ok':''}>Gmail</span></div><p>キャッシュ: {cacheStats.count}件・{Math.ceil(cacheStats.bytes/1024)}KB。期限切れ時も通信障害中は古い結果を表示できます。</p><div className="external-source-settings-actions"><button onClick={()=>{clearExternalSourceCache();bump();}}>キャッシュ削除</button><button disabled={busy} onClick={()=>void run(async()=>{await window.localNotion.googleWorkspace.connect(['drive']);await refresh();})}>Drive認証</button><button disabled={busy} onClick={()=>void run(async()=>{await window.localNotion.googleWorkspace.connect(['drive','calendar']);await refresh();})}>Calendar追加</button><button disabled={busy} onClick={()=>void run(async()=>{await window.localNotion.googleWorkspace.connect(['drive','gmail']);await refresh();})}>Gmail追加</button><button disabled={!status.connected} onClick={()=>void run(async()=>{await window.localNotion.googleWorkspace.disconnect();await refresh();})}>接続解除</button></div></div>}
      {tab==='audit'&&<div className="external-source-audit"><h3>監査ログ</h3>{auditEntries.map((entry)=><div key={entry.id}><time>{formatTime(entry.at)}</time><b>{entry.action}</b><span>{entry.provider||'workspace'}</span><p>{entry.detail}</p></div>)}</div>}
    </main></div>
    {diffRecord&&<div className="external-diff-backdrop" onClick={()=>setDiffRecord(null)}><section className="external-diff-view" onClick={(e)=>e.stopPropagation()}><header><div><h3>{diffRecord.title}</h3><p>前回取得と現在の内容</p></div><button onClick={()=>setDiffRecord(null)}>×</button></header><div>{buildLineDiff(diffRecord.previous?.content||'',diffRecord.current.content).map((line,index)=><pre key={index} className={`diff-${line.type}`}>{line.type==='added'?'+ ':line.type==='removed'?'- ':'  '}{line.text}</pre>)}</div></section></div>}
  </section>;
}
