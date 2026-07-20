import type { WebBinding, WebCmsCollection, WebLocalFileSource, WebProject, WebResponsiveRule, WebSharedComponent, WebVariable } from './types';

const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[char]||char));


function renderLocalSource(source:WebLocalFileSource){
 if(source.format==="html")return source.rawText;
 const rows=source.records.slice(0,200);
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,30);
 if(!rows.length)return `<section class="ln-local-source-empty" data-local-source="${escapeHtml(source.name)}">データがありません</section>`;
 return `<div class="ln-local-source" data-local-source="${escapeHtml(source.name)}"><table><thead><tr>${columns.map(column=>`<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>`<td>${escapeHtml(formatLocalValue(row[column]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function formatLocalValue(value:unknown){if(value==null)return '';if(typeof value==='object'){try{return JSON.stringify(value)}catch{return String(value)}}return String(value)}

export function resolveWebRuntime(project:WebProject,html=project.html){
 let output=html;
 for(const source of project.localFileSources??[]){
  output=output.replace(new RegExp(`<ln-local-source\\s+name=["']${escapeRegExp(source.name)}["']\\s*><\\/ln-local-source>`,'gi'),renderLocalSource(source));
  const first=source.records[0]??{};
  for(const [key,value] of Object.entries(first))if(value==null||['string','number','boolean'].includes(typeof value))output=output.replace(new RegExp(`{{\\s*file\\.${escapeRegExp(source.name)}\\.${escapeRegExp(key)}\\s*}}`,'g'),escapeHtml(value==null?'':String(value)));
 }
 const runtimeVariables:WebVariable[]=[
  {key:'today',value:new Date().toLocaleDateString('ja-JP')},
  {key:'currentYear',value:String(new Date().getFullYear())},
  {key:'projectTitle',value:project.title},
  {key:'lastUpdated',value:new Date(project.updatedAt).toLocaleString('ja-JP')},
  ...(project.variables??[]),
 ];
 for(const variable of runtimeVariables)output=output.replace(new RegExp(`{{\\s*${escapeRegExp(variable.key)}\\s*}}`,'g'),escapeHtml(variable.value));
 for(const binding of project.bindings??[])output=output.replace(new RegExp(`{{\\s*${escapeRegExp(binding.key)}\\s*}}`,'g'),binding.escape===false?binding.value:escapeHtml(binding.value));
 for(const component of project.sharedComponents??[])output=output.replace(new RegExp(`<ln-component\\s+name=["']${escapeRegExp(component.name)}["']\\s*><\\/ln-component>`,'gi'),component.html);
 for(const collection of project.cmsCollections??[])output=output.replace(new RegExp(`<ln-cms\\s+name=["']${escapeRegExp(collection.name)}["']\\s*><\\/ln-cms>`,'gi'),renderCms(collection));
 return output;
}

function renderCms(collection:WebCmsCollection){
 const items=collection.items.filter(item=>item.published!==false).slice(0,collection.limit||100);
 return `<section class="ln-cms ln-cms-${escapeHtml(collection.layout)}" data-cms="${escapeHtml(collection.name)}">${items.map(item=>`<article class="ln-cms-item"><h3>${escapeHtml(item.title)}</h3>${item.date?`<time>${escapeHtml(item.date)}</time>`:''}<p>${escapeHtml(item.summary||'')}</p>${item.url?`<a href="${escapeHtml(item.url)}">詳しく見る</a>`:''}</article>`).join('')}</section>`;
}

export function responsiveCss(rules:WebResponsiveRule[]|undefined){return (rules??[]).map(rule=>`@media (max-width:${Math.max(240,rule.maxWidth)}px){${rule.selector}{${rule.declarations}}}`).join('\n')}
export function formRuntimeScript(){return `document.addEventListener('submit',function(e){const form=e.target;if(!(form instanceof HTMLFormElement)||!form.matches('[data-ln-form]'))return;e.preventDefault();const invalid=[...form.querySelectorAll('[required]')].find(el=>!el.value);if(invalid){invalid.focus();form.dispatchEvent(new CustomEvent('ln-form-error',{detail:{message:'必須項目を入力してください'}}));return;}form.dispatchEvent(new CustomEvent('ln-form-submit',{detail:Object.fromEntries(new FormData(form).entries())}));const message=form.querySelector('[data-ln-form-message]');if(message)message.textContent='送信内容を確認しました。';});`}

export function optimizeLayout(project:WebProject):Partial<WebProject>{
 const additions:string[]=[];
 if(!/box-sizing\s*:\s*border-box/i.test(project.css))additions.push(`*,*::before,*::after{box-sizing:border-box}`);
 if(!/img\s*\{[^}]*max-width/i.test(project.css))additions.push(`img,video,svg{max-width:100%;height:auto}`);
 if(!/@media/i.test(project.css))additions.push(`@media(max-width:768px){.grid,.cards,.pricing{grid-template-columns:1fr!important}.hero{padding:48px 20px!important}body{overflow-x:hidden}}`);
 return {css:[project.css,...additions].filter(Boolean).join('\n')};
}

export function compareVersions(current:WebProject,previous?:{html:string;css:string;javascript:string}){
 if(!previous)return {html:0,css:0,javascript:0};
 const delta=(a:string,b:string)=>Math.abs(a.split(/\n/).length-b.split(/\n/).length)+[...a].filter((char,i)=>char!==b[i]).length;
 return {html:delta(current.html,previous.html),css:delta(current.css,previous.css),javascript:delta(current.javascript,previous.javascript)};
}

export function buildDeployGuide(project:WebProject){return {project:project.title,generatedAt:new Date().toISOString(),providers:{githubPages:['ZIPを書き出す','リポジトリへ展開','PagesのSourceを設定'],netlify:['ZIPを展開','フォルダをNetlifyへドラッグ'],vercel:['ZIPを展開','Static SiteとしてImport'],cloudflare:['ZIPを展開','PagesのDirect Uploadへ追加']}}}

export function makeBinding(key:string,value:string):WebBinding{return{id:`binding:${Date.now()}`,key:key.trim(),value,escape:true}}
export function makeSharedComponent(name:string,html:string):WebSharedComponent{return{id:`component:${Date.now()}`,name:name.trim(),html,updatedAt:Date.now()}}
