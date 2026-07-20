import type { WebPage, WebProject, WebTheme } from "./types";
export const DEFAULT_THEME:WebTheme={primary:"#3157d5",secondary:"#6b7280",background:"#ffffff",text:"#172033",radius:12,spacing:16,shadow:"0 12px 32px rgba(15,23,42,.12)",fontFamily:"system-ui, -apple-system, sans-serif"};
export function normalizeWebProject(project:WebProject):WebProject{
 const now=Date.now(); const pages=project.pages?.length?project.pages:[{id:"page:home",title:"Home",slug:"index",html:project.html||"",createdAt:project.createdAt||now,updatedAt:project.updatedAt||now}];
 const activePageId=pages.some(p=>p.id===project.activePageId)?project.activePageId!:pages[0].id;
 const active=pages.find(p=>p.id===activePageId)!;
 return {...project,html:active.html,pages,activePageId,theme:{...DEFAULT_THEME,...project.theme},assets:project.assets??[],history:project.history??[],favoriteComponentIds:project.favoriteComponentIds??[],userTemplates:project.userTemplates??[],plugins:project.plugins??[],designHistory:project.designHistory??[],variables:project.variables??[],bindings:project.bindings??[],cmsCollections:project.cmsCollections??[],sharedComponents:project.sharedComponents??[],responsiveRules:project.responsiveRules??[],localFileSources:project.localFileSources??[],deploy:project.deploy??{provider:"manual"}};
}
export function syncActivePage(project:WebProject,html=project.html):WebProject{
 const normalized=normalizeWebProject(project); return {...normalized,html,pages:normalized.pages!.map(page=>page.id===normalized.activePageId?{...page,html,updatedAt:Date.now()}:page)};
}
export function switchWebPage(project:WebProject,pageId:string):WebProject{
 const synced=syncActivePage(project); const page=synced.pages!.find(item=>item.id===pageId); return page?{...synced,activePageId:pageId,html:page.html}:synced;
}
export function themeCss(theme:WebTheme){return `:root{--wb-primary:${theme.primary};--wb-secondary:${theme.secondary};--wb-background:${theme.background};--wb-text:${theme.text};--wb-radius:${theme.radius}px;--wb-space:${theme.spacing}px;--wb-shadow:${theme.shadow};--wb-font:${theme.fontFamily}}\nbody{background:var(--wb-background);color:var(--wb-text);font-family:var(--wb-font)}`}
