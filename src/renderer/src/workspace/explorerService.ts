import { readWebProjects } from "../webBuilder/store";
import type { WebProject } from "../webBuilder/types";

export type WorkspaceExplorerKind =
  | "page" | "database" | "screen" | "website" | "asset" | "component"
  | "template" | "local-file" | "form" | "theme";

export type WorkspaceExplorerItem = {
  key: string; id: string; kind: WorkspaceExplorerKind; title: string; icon: string;
  subtitle: string; searchText: string; updatedAt: number; favorite: boolean;
  parentKey?: string; projectId?: string; payload?: unknown;
};

export type WorkspaceExplorerUsage = { key:string; title:string; detail:string; projectId?:string; pageId?:string };
export type WorkspaceExplorerPreview = {
  kind: WorkspaceExplorerKind; title:string; description:string; badges:string[];
  imageUrl?:string; code?:string; rows?: Array<Record<string, unknown>>; metadata:Array<[string,string]>;
};
export type WorkspaceExplorerDragPayload = { version:1; key:string; id:string; kind:WorkspaceExplorerKind; title:string; projectId?:string };

const FAVORITES_KEY = "local-notion:workspace-explorer-favorites-v1";
const RECENTS_KEY = "local-notion:workspace-explorer-recents-v1";
const MAX_RECENTS = 30;
export const WORKSPACE_EXPLORER_DRAG_MIME = "application/x-local-notion-workspace-item";

function readStringList(key: string): string[] { try { const value=JSON.parse(window.localStorage.getItem(key)||"[]"); return Array.isArray(value)?value.map(String).filter(Boolean):[]; } catch { return []; } }
function writeStringList(key: string, values: string[]): void { try { window.localStorage.setItem(key,JSON.stringify(Array.from(new Set(values)))); } catch { /* optional UI state */ } }
export function readExplorerFavoriteKeys(): string[] { return readStringList(FAVORITES_KEY); }
export function toggleExplorerFavorite(key: string): string[] { const current=readExplorerFavoriteKeys(); const next=current.includes(key)?current.filter(item=>item!==key):[key,...current]; writeStringList(FAVORITES_KEY,next); return next; }
export function readExplorerRecentKeys(): string[] { return readStringList(RECENTS_KEY).slice(0,MAX_RECENTS); }
export function recordExplorerRecent(key: string): string[] { const next=[key,...readExplorerRecentKeys().filter(item=>item!==key)].slice(0,MAX_RECENTS); writeStringList(RECENTS_KEY,next); return next; }

function timestamp(value: unknown): number { const parsed=typeof value==="number"?value:Date.parse(String(value||"")); return Number.isFinite(parsed)?parsed:0; }
function countForms(project: WebProject): number { return (project.html.match(/<form\b/gi)||[]).length+(project.pages||[]).reduce((sum,page)=>sum+(page.html.match(/<form\b/gi)||[]).length,0); }
function webProjectItems(project: WebProject, favoriteKeys: Set<string>): WorkspaceExplorerItem[] {
  const parentKey=`website:${project.id}`; const children:WorkspaceExplorerItem[]=[];
  const push=(item:Omit<WorkspaceExplorerItem,"favorite"|"parentKey"|"projectId">)=>children.push({...item,parentKey,projectId:project.id,favorite:favoriteKeys.has(item.key)});
  for(const asset of project.assets||[]) push({key:`asset:${project.id}:${asset.id}`,id:asset.id,kind:"asset",title:asset.name,icon:"🖼️",subtitle:`素材・${Math.max(1,Math.ceil(asset.size/1024))}KB`,searchText:`${asset.name} ${asset.type} asset image 素材 画像`.toLowerCase(),updatedAt:asset.createdAt,payload:asset});
  for(const component of project.sharedComponents||[]) push({key:`component:${project.id}:${component.id}`,id:component.id,kind:"component",title:component.name,icon:"◫",subtitle:"共有コンポーネント",searchText:`${component.name} component shared 部品 コンポーネント`.toLowerCase(),updatedAt:component.updatedAt,payload:component});
  for(const template of project.userTemplates||[]) push({key:`template:${project.id}:${template.id}`,id:template.id,kind:"template",title:template.name,icon:"▤",subtitle:"ユーザーテンプレート",searchText:`${template.name} template 型 テンプレート`.toLowerCase(),updatedAt:template.createdAt,payload:template});
  for(const source of project.localFileSources||[]) push({key:`local-file:${project.id}:${source.id}`,id:source.id,kind:"local-file",title:source.fileName,icon:source.format==="json"?"{}":source.format==="csv"?"▦":"<>",subtitle:`ローカル${source.format.toUpperCase()}・${Math.max(1,Math.ceil(source.size/1024))}KB`,searchText:`${source.fileName} ${source.name} ${source.format} local file ローカルファイル`.toLowerCase(),updatedAt:source.createdAt,payload:source});
  const forms=countForms(project); for(let index=0;index<forms;index+=1) push({key:`form:${project.id}:${index+1}`,id:String(index+1),kind:"form",title:`フォーム ${index+1}`,icon:"✉",subtitle:"Webフォーム",searchText:`${project.title} form フォーム 問い合わせ`.toLowerCase(),updatedAt:project.updatedAt,payload:{index}});
  if(project.theme) push({key:`theme:${project.id}:default`,id:"default",kind:"theme",title:`${project.title}のテーマ`,icon:"◐",subtitle:`テーマ・${project.theme.fontFamily}`,searchText:`${project.title} theme ${project.theme.primary} ${project.theme.fontFamily} テーマ 配色`.toLowerCase(),updatedAt:project.updatedAt,payload:project.theme});
  return [{key:parentKey,id:project.id,kind:"website",title:project.title,icon:"🌐",subtitle:`Webサイト・${children.length}リソース`,searchText:`${project.title} website web builder サイト`.toLowerCase(),updatedAt:project.updatedAt,favorite:favoriteKeys.has(parentKey),payload:project},...children];
}

export function buildWorkspaceExplorerItems(input:{pages:any[];databases:any[];screens:Array<{id:string;title:string;icon:string}>;webProjects?:WebProject[]}):WorkspaceExplorerItem[]{
  const favoriteKeys=new Set(readExplorerFavoriteKeys());
  const pages=input.pages.map(page=>{const id=String(page?.id||page?.meta?.id||"");const key=`page:${id}`;const title=String(page?.title||page?.meta?.title||"無題のページ");const tags=Array.isArray(page?.properties?.tags)?page.properties.tags.join(" "):"";return{key,id,kind:"page" as const,title,icon:String(page?.icon||page?.meta?.icon||"📄"),subtitle:page?.scope==="private"||page?.meta?.scope==="private"?"Privateページ":"共有ページ",searchText:`${title} ${tags}`.toLowerCase(),updatedAt:timestamp(page?.updatedAt||page?.meta?.updatedAt),favorite:favoriteKeys.has(key),payload:page};}).filter(item=>item.id);
  const databases=input.databases.map(database=>{const id=String(database?.id||"");const key=`database:${id}`;const title=String(database?.title||"無題のデータベース");return{key,id,kind:"database" as const,title,icon:String(database?.icon||"▦"),subtitle:"データベース",searchText:`${title} database データベース`.toLowerCase(),updatedAt:timestamp(database?.updatedAt),favorite:favoriteKeys.has(key),payload:database};}).filter(item=>item.id);
  const screens=input.screens.filter(screen=>!["home","documents","utility","web-builder"].includes(screen.id)).map(screen=>{const key=`screen:${screen.id}`;return{key,id:screen.id,kind:"screen" as const,title:screen.title,icon:screen.icon,subtitle:"ワークスペース機能",searchText:`${screen.title} ${screen.id}`.toLowerCase(),updatedAt:0,favorite:favoriteKeys.has(key),payload:screen};});
  const projects=(input.webProjects??readWebProjects()).flatMap(project=>webProjectItems(project,favoriteKeys)); return [...pages,...databases,...projects,...screens];
}
export function searchWorkspaceExplorer(items:WorkspaceExplorerItem[],query:string):WorkspaceExplorerItem[]{const normalized=query.trim().toLowerCase();if(!normalized)return items;const tokens=normalized.split(/\s+/).filter(Boolean);return items.filter(item=>tokens.every(token=>`${item.title} ${item.subtitle} ${item.searchText}`.toLowerCase().includes(token)));}

export function getExplorerBreadcrumb(item:WorkspaceExplorerItem,items:WorkspaceExplorerItem[]):WorkspaceExplorerItem[]{const trail:WorkspaceExplorerItem[]=[];let current:WorkspaceExplorerItem|undefined=item;const seen=new Set<string>();while(current&&!seen.has(current.key)){seen.add(current.key);trail.unshift(current);current=current.parentKey?items.find(candidate=>candidate.key===current?.parentKey):undefined;}return trail;}

function excerpt(value:unknown,max=900):string{return String(value??"").replace(/\s+/g," ").trim().slice(0,max);}
export function buildExplorerPreview(item:WorkspaceExplorerItem):WorkspaceExplorerPreview{
  const p:any=item.payload||{}; const metadata:Array<[string,string]>=[["種類",item.subtitle],["更新",item.updatedAt?new Date(item.updatedAt).toLocaleString("ja-JP"):"-"]];
  if(item.kind==="asset") return{kind:item.kind,title:item.title,description:p.type||"画像素材",badges:[p.type||"asset",`${Math.max(1,Math.ceil((p.size||0)/1024))}KB`],imageUrl:String(p.dataUrl||""),metadata};
  if(item.kind==="local-file") return{kind:item.kind,title:item.title,description:`${String(p.format||"").toUpperCase()}ローカルソース`,badges:[String(p.format||"file").toUpperCase(),`${Math.max(1,Math.ceil((p.size||0)/1024))}KB`],code:p.format==="html"?String(p.rawText||"").slice(0,4000):undefined,rows:Array.isArray(p.records)?p.records.slice(0,12):undefined,metadata:[...metadata,["参照名",String(p.name||"")]]};
  if(item.kind==="component"||item.kind==="template") return{kind:item.kind,title:item.title,description:item.kind==="component"?"再利用可能な共有コンポーネント":"ユーザー保存テンプレート",badges:[item.kind==="component"?"Component":"Template"],code:[p.html,p.css,p.javascript].filter(Boolean).join("\n\n").slice(0,5000),metadata};
  if(item.kind==="theme") return{kind:item.kind,title:item.title,description:"Web Builderのデザイントークン",badges:[String(p.fontFamily||"Theme")],metadata:[...metadata,["Primary",String(p.primary||"")],["Background",String(p.background||"")],["Radius",String(p.radius??"")]]};
  if(item.kind==="website") return{kind:item.kind,title:item.title,description:"Web Builderプロジェクト",badges:[`${(p.pages||[]).length+1}ページ`,`${(p.assets||[]).length}素材`],code:excerpt(p.html,3000),metadata};
  if(item.kind==="database") return{kind:item.kind,title:item.title,description:"ワークスペースデータベース",badges:[`${(p.rows||[]).length}行`,`${(p.properties||[]).length}プロパティ`],rows:(p.rows||[]).slice(0,8),metadata};
  if(item.kind==="page") return{kind:item.kind,title:item.title,description:excerpt(p.markdown||p.previewSnippet||p.content||"ページを開いて内容を確認できます。",1200),badges:Array.isArray(p.properties?.tags)?p.properties.tags.slice(0,5):[],metadata};
  return{kind:item.kind,title:item.title,description:item.subtitle,badges:[item.kind],metadata};
}

function sourceContains(project:WebProject,needle:string):WorkspaceExplorerUsage[]{if(!needle)return[];const found:WorkspaceExplorerUsage[]=[];const check=(text:string,title:string,pageId?:string)=>{if(text.toLowerCase().includes(needle.toLowerCase()))found.push({key:`${project.id}:${pageId||"root"}:${needle}`,title,detail:"HTML・CSS・JavaScript内で参照",projectId:project.id,pageId});};check(`${project.html}\n${project.css}\n${project.javascript}`,`${project.title}（メイン）`);for(const page of project.pages||[])check(page.html,page.title,page.id);return found;}
export function findExplorerUsage(item:WorkspaceExplorerItem,projects:WebProject[]):WorkspaceExplorerUsage[]{
  if(item.parentKey){const parent=projects.find(project=>project.id===item.projectId);const base=parent?[{key:`parent:${parent.id}`,title:parent.title,detail:"所属するWebプロジェクト",projectId:parent.id}]:[];const needles=[item.id,item.title,(item.payload as any)?.name,(item.payload as any)?.fileName].filter(Boolean).map(String);const refs=projects.flatMap(project=>needles.flatMap(needle=>sourceContains(project,needle)));return [...base,...Array.from(new Map(refs.map(entry=>[`${entry.projectId}:${entry.pageId||"root"}:${entry.title}`,entry])).values())].slice(0,30);}
  if(item.kind==="website") return [{key:`self:${item.id}`,title:item.title,detail:"Web Builderプロジェクト本体",projectId:item.id}];
  return [];
}
export function createExplorerDragPayload(item:WorkspaceExplorerItem):WorkspaceExplorerDragPayload{return{version:1,key:item.key,id:item.id,kind:item.kind,title:item.title,projectId:item.projectId};}
export function writeExplorerDragData(dataTransfer:DataTransfer,item:WorkspaceExplorerItem):void{const payload=JSON.stringify(createExplorerDragPayload(item));dataTransfer.effectAllowed="copyLink";dataTransfer.setData(WORKSPACE_EXPLORER_DRAG_MIME,payload);dataTransfer.setData("text/plain",item.title);}
