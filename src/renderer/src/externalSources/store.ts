import type { ExternalSourceRecord, ExternalSourceResult, ExternalSourceMode, ExternalSourceIntent, ExternalSyncIssue, GmailActionItem, MeetingWorkflowItem } from './types';
const RECORDS='local-notion:external-source-records-v1', ISSUES='local-notion:external-source-issues-v1', GMAIL='local-notion:gmail-actions-v1', MEETINGS='local-notion:meeting-workflows-v1';
function readArray<T>(key:string):T[]{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
function writeArray<T>(key:string,v:T[],max=500){localStorage.setItem(key,JSON.stringify(v.slice(-max)))}
export function resultContent(result: ExternalSourceResult): string {
  if(result.providerId==='drive') return [result.payload.name,result.payload.mimeType,result.payload.owners?.map(x=>x.displayName||x.emailAddress).filter(Boolean).join('、')].filter(Boolean).join('\n');
  if(result.providerId==='calendar') return [result.payload.description,result.payload.location,(result.payload.attendees||[]).map(x=>x.displayName||x.email).filter(Boolean).join('、')].filter(Boolean).join('\n');
  return [result.payload.from,result.payload.to,result.payload.snippet,(result.payload.attachments||[]).map(x=>x.filename).join('、')].filter(Boolean).join('\n');
}
export function upsertExternalSourceRecord(result:ExternalSourceResult,mode:ExternalSourceMode,intent:ExternalSourceIntent,content?:string):ExternalSourceRecord{
 const all=readArray<ExternalSourceRecord>(RECORDS); const old=all.find(x=>x.key===result.key); const now=Date.now();
 const current={title:result.title,subtitle:result.subtitle,content:content??resultContent(result),timestamp:result.timestamp,capturedAt:now};
 const record:ExternalSourceRecord={key:result.key,providerId:result.providerId,mode,intent,title:result.title,sensitivity:result.sensitivity,syncState:mode==='sync'?'queued':'idle',current,previous:old?.current,lastSyncedAt:old?.lastSyncedAt,lastError:undefined,externalUrl:result.providerId==='drive'?result.payload.webViewLink:result.providerId==='calendar'?result.payload.htmlLink:`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(result.payload.threadId)}`};
 writeArray(RECORDS,[...all.filter(x=>x.key!==result.key),record]); return record;
}
export const readExternalSourceRecords=()=>readArray<ExternalSourceRecord>(RECORDS).sort((a,b)=>b.current.capturedAt-a.current.capturedAt);
export function patchExternalSourceRecord(key:string,patch:Partial<ExternalSourceRecord>){const all=readArray<ExternalSourceRecord>(RECORDS);writeArray(RECORDS,all.map(x=>x.key===key?{...x,...patch}:x))}
export function removeExternalSourceRecord(key:string){writeArray(RECORDS,readArray<ExternalSourceRecord>(RECORDS).filter(x=>x.key!==key))}
export function addSyncIssue(input:Omit<ExternalSyncIssue,'id'|'createdAt'>){const all=readArray<ExternalSyncIssue>(ISSUES);writeArray(ISSUES,[...all,{...input,id:`issue-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,createdAt:Date.now()}])}
export const readSyncIssues=()=>readArray<ExternalSyncIssue>(ISSUES).filter(x=>!x.resolvedAt).sort((a,b)=>b.createdAt-a.createdAt);
export function resolveSyncIssue(id:string){const all=readArray<ExternalSyncIssue>(ISSUES);writeArray(ISSUES,all.map(x=>x.id===id?{...x,resolvedAt:Date.now()}:x))}
export function addGmailAction(item:Omit<GmailActionItem,'id'|'createdAt'|'status'>){const all=readArray<GmailActionItem>(GMAIL);writeArray(GMAIL,[...all.filter(x=>x.sourceKey!==item.sourceKey),{...item,id:`mail-${Date.now()}`,createdAt:Date.now(),status:'todo'}])}
export const readGmailActions=()=>readArray<GmailActionItem>(GMAIL).sort((a,b)=>b.createdAt-a.createdAt);
export function patchGmailAction(id:string,patch:Partial<GmailActionItem>){writeArray(GMAIL,readArray<GmailActionItem>(GMAIL).map(x=>x.id===id?{...x,...patch}:x))}
export function addMeetingWorkflow(item:Omit<MeetingWorkflowItem,'id'|'createdAt'|'status'>){const all=readArray<MeetingWorkflowItem>(MEETINGS);writeArray(MEETINGS,[...all.filter(x=>x.sourceKey!==item.sourceKey),{...item,id:`meeting-${Date.now()}`,createdAt:Date.now(),status:'planned'}])}
export const readMeetingWorkflows=()=>readArray<MeetingWorkflowItem>(MEETINGS).sort((a,b)=>b.createdAt-a.createdAt);
export function patchMeetingWorkflow(id:string,patch:Partial<MeetingWorkflowItem>){writeArray(MEETINGS,readArray<MeetingWorkflowItem>(MEETINGS).map(x=>x.id===id?{...x,...patch}:x))}
