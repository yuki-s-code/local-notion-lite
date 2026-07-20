import React, { useMemo, useState } from "react";
import { buildExplorerPreview, buildWorkspaceExplorerItems, findExplorerUsage, getExplorerBreadcrumb, readExplorerRecentKeys, recordExplorerRecent, searchWorkspaceExplorer, toggleExplorerFavorite, writeExplorerDragData, type WorkspaceExplorerItem, type WorkspaceExplorerKind } from "../../workspace/explorerService";
import { readWebProjects } from "../../webBuilder/store";

type Scope = "all" | "favorites" | "recent" | WorkspaceExplorerKind | "web-resource";
const SCOPE_ITEMS: Array<[Scope,string]> = [["all","すべて"],["favorites","お気に入り"],["recent","最近"],["page","ページ"],["database","DB"],["website","Web"],["asset","素材"],["component","部品"],["template","型"],["local-file","ファイル"],["form","フォーム"],["theme","テーマ"],["screen","機能"]];
const WEB_RESOURCE_KINDS = new Set<WorkspaceExplorerKind>(["asset","component","template","local-file","form","theme"]);

export function WorkspaceExplorerScreen(props: { pages:any[]; databases:any[]; screens:Array<{id:string;title:string;icon:string}>; onOpenPage:(id:string)=>void; onOpenDatabase:(id:string)=>void; onOpenScreen:(id:string)=>void; onOpenWebProject:(id:string)=>void; onBack:()=>void; }) {
  const [query,setQuery]=useState(""); const [scope,setScope]=useState<Scope>("all"); const [revision,setRevision]=useState(0); const [selectedKey,setSelectedKey]=useState<string>("");
  const webProjects=useMemo(()=>readWebProjects(),[revision]);
  const items=useMemo(()=>buildWorkspaceExplorerItems({...props,webProjects}),[props.pages,props.databases,props.screens,webProjects,revision]);
  const recentKeys=useMemo(()=>new Set(readExplorerRecentKeys()),[revision]);
  const visible=useMemo(()=>{let filtered=searchWorkspaceExplorer(items,query);if(scope==="favorites")filtered=filtered.filter(i=>i.favorite);else if(scope==="recent")filtered=filtered.filter(i=>recentKeys.has(i.key));else if(scope==="web-resource")filtered=filtered.filter(i=>WEB_RESOURCE_KINDS.has(i.kind));else if(scope!=="all")filtered=filtered.filter(i=>i.kind===scope);if(scope==="recent")filtered.sort((a,b)=>readExplorerRecentKeys().indexOf(a.key)-readExplorerRecentKeys().indexOf(b.key));else filtered.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||b.updatedAt-a.updatedAt||a.title.localeCompare(b.title,"ja"));return filtered;},[items,query,scope,recentKeys]);
  const selected=items.find(item=>item.key===selectedKey)||visible[0]||null;
  const preview=useMemo(()=>selected?buildExplorerPreview(selected):null,[selected]);
  const usage=useMemo(()=>selected?findExplorerUsage(selected,webProjects):[],[selected,webProjects]);
  const breadcrumb=useMemo(()=>selected?getExplorerBreadcrumb(selected,items):[],[selected,items]);
  function open(item:WorkspaceExplorerItem){recordExplorerRecent(item.key);setRevision(v=>v+1);if(item.kind==="page")props.onOpenPage(item.id);else if(item.kind==="database")props.onOpenDatabase(item.id);else if(item.kind==="screen")props.onOpenScreen(item.id);else if(item.projectId)props.onOpenWebProject(item.projectId);else if(item.kind==="website")props.onOpenWebProject(item.id);}
  const counts=(kind:WorkspaceExplorerKind)=>items.filter(i=>i.kind===kind).length;
  return <section className="workspace-explorer-screen">
    <header className="workspace-explorer-header"><div><span className="eyebrow">WORKSPACE EXPLORER</span><h1>すべての情報を一か所から開く</h1><p>横断検索、プレビュー、利用箇所、ドラッグ連携を共通基盤で管理します。</p></div><button className="secondary" onClick={props.onBack}>戻る</button></header>
    <div className="workspace-explorer-toolbar"><label className="workspace-explorer-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="タイトル、種類、タグ、ファイル名を横断検索" autoFocus/></label><nav className="workspace-explorer-scopes" aria-label="Explorer表示範囲">{SCOPE_ITEMS.map(([id,label])=><button key={id} className={scope===id?"active":""} onClick={()=>setScope(id)}>{label}</button>)}</nav></div>
    <div className="workspace-explorer-summary"><b>{visible.length}</b><span>件</span><small>ページ {counts("page")} ・ DB {counts("database")} ・ Web {counts("website")} ・ Web資産 {items.filter(i=>WEB_RESOURCE_KINDS.has(i.kind)).length}</small></div>
    <div className="workspace-explorer-body">
      <div className="workspace-explorer-list">{visible.map(item=><article className={`workspace-explorer-row${selected?.key===item.key?" is-selected":""}`} key={item.key} draggable onDragStart={event=>writeExplorerDragData(event.dataTransfer,item)} onClick={()=>setSelectedKey(item.key)}><button className="workspace-explorer-open" onDoubleClick={()=>open(item)} onClick={()=>setSelectedKey(item.key)}><span className="workspace-explorer-icon">{item.icon}</span><span className="workspace-explorer-copy"><strong>{item.title}</strong><small>{item.subtitle}{item.parentKey?` ・ ${items.find(parent=>parent.key===item.parentKey)?.title||"Web Builder"}`:""}{item.updatedAt?` ・ ${new Date(item.updatedAt).toLocaleDateString("ja-JP")}`:""}</small></span></button><button className={item.favorite?"workspace-explorer-favorite active":"workspace-explorer-favorite"} onClick={event=>{event.stopPropagation();toggleExplorerFavorite(item.key);setRevision(v=>v+1)}} aria-label={item.favorite?`${item.title}をお気に入りから外す`:`${item.title}をお気に入りに追加`}>{item.favorite?"★":"☆"}</button></article>)}{!visible.length&&<div className="workspace-explorer-empty"><b>該当する項目がありません</b><span>検索語または表示範囲を変更してください。</span></div>}</div>
      <aside className="workspace-explorer-preview" aria-label="Quick Preview">
        {selected&&preview?<>
          <nav className="workspace-explorer-breadcrumb" aria-label="パンくず">{breadcrumb.map((entry,index)=><React.Fragment key={entry.key}>{index>0?<span>›</span>:null}<button onClick={()=>setSelectedKey(entry.key)}>{entry.title}</button></React.Fragment>)}</nav>
          <div className="workspace-explorer-preview-head"><span className="workspace-explorer-preview-icon">{selected.icon}</span><div><small>QUICK PREVIEW</small><h2>{preview.title}</h2></div></div>
          <div className="workspace-explorer-preview-actions"><button className="primary" onClick={()=>open(selected)}>開く</button><button onClick={()=>{toggleExplorerFavorite(selected.key);setRevision(v=>v+1)}}>{selected.favorite?"★ お気に入り済み":"☆ お気に入り"}</button></div>
          {preview.badges.length?<div className="workspace-explorer-preview-badges">{preview.badges.map(badge=><span key={badge}>{badge}</span>)}</div>:null}
          {preview.imageUrl?<div className="workspace-explorer-image-preview"><img src={preview.imageUrl} alt={preview.title}/></div>:null}
          <p className="workspace-explorer-description">{preview.description}</p>
          {preview.rows?.length?<div className="workspace-explorer-table-wrap"><table><thead><tr>{Object.keys(preview.rows[0]||{}).slice(0,6).map(key=><th key={key}>{key}</th>)}</tr></thead><tbody>{preview.rows.slice(0,8).map((row,index)=><tr key={index}>{Object.keys(preview.rows?.[0]||{}).slice(0,6).map(key=><td key={key}>{String(row[key]??"")}</td>)}</tr>)}</tbody></table></div>:null}
          {preview.code?<pre className="workspace-explorer-code"><code>{preview.code}</code></pre>:null}
          <dl className="workspace-explorer-meta">{preview.metadata.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <section className="workspace-explorer-usage"><header><b>利用箇所</b><span>{usage.length}</span></header>{usage.length?usage.map(entry=><button key={entry.key} onClick={()=>entry.projectId&&props.onOpenWebProject(entry.projectId)}><strong>{entry.title}</strong><small>{entry.detail}</small></button>):<p>この項目の参照先は検出されませんでした。</p>}</section>
          <p className="workspace-explorer-drag-hint">項目をドラッグすると、対応画面でリンク・素材・データとして受け取れる共通形式を使用します。</p>
        </>:<div className="workspace-explorer-empty"><b>プレビューする項目を選択</b></div>}
      </aside>
    </div>
  </section>;
}
