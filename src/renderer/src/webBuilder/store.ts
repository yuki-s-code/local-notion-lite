import type { WebProject } from "./types";
import { WEB_TEMPLATES } from "./templates";
import { normalizeWebProject, syncActivePage } from "./model";
const KEY="local-notion:web-builder-projects-v1",ACTIVE_KEY="local-notion:web-builder-active-v1",QUEUE_KEY="local-notion:web-builder-whiteboard-queue-v1";
export function createWebProject(templateId="blank"):WebProject{const template=WEB_TEMPLATES.find(i=>i.id===templateId)??WEB_TEMPLATES[0];const now=Date.now();return normalizeWebProject({id:`web:${now}:${Math.random().toString(36).slice(2,8)}`,title:template.title,html:template.html,css:template.css,javascript:template.javascript,device:"desktop",links:[],createdAt:now,updatedAt:now})}
export function readWebProjects():WebProject[]{try{const value=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(value)?value.filter(i=>i&&typeof i.id==="string").map(normalizeWebProject):[]}catch{return[]}}
export function saveWebProject(project:WebProject):WebProject[]{const nextProject={...syncActivePage(project),updatedAt:Date.now()};const projects=readWebProjects();const index=projects.findIndex(i=>i.id===project.id);if(index>=0)projects[index]=nextProject;else projects.unshift(nextProject);localStorage.setItem(KEY,JSON.stringify(projects.slice(0,100)));localStorage.setItem(ACTIVE_KEY,project.id);return projects}
export function deleteWebProject(id:string){const next=readWebProjects().filter(i=>i.id!==id);localStorage.setItem(KEY,JSON.stringify(next));return next}
export const readActiveWebProjectId=()=>localStorage.getItem(ACTIVE_KEY);export const setActiveWebProjectId=(id:string)=>localStorage.setItem(ACTIVE_KEY,id);
export function queueWebProjectForWhiteboard(project:WebProject){localStorage.setItem(QUEUE_KEY,JSON.stringify({projectId:project.id,title:project.title,html:project.html,css:project.css,updatedAt:project.updatedAt}))}
export function consumeWebProjectWhiteboardQueue(){try{const raw=localStorage.getItem(QUEUE_KEY);if(!raw)return null;localStorage.removeItem(QUEUE_KEY);return JSON.parse(raw)}catch{localStorage.removeItem(QUEUE_KEY);return null}}
export const getWebProject=(id:string)=>readWebProjects().find(i=>i.id===id)??null;
