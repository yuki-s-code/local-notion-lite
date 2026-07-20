import type { WebAuditIssue, WebProject } from "./types";
export function auditWebProject(project:WebProject):WebAuditIssue[]{
 const issues:WebAuditIssue[]=[]; const html=project.html; const text=html.replace(/<[^>]+>/g," ");
 const push=(category:WebAuditIssue["category"],severity:WebAuditIssue["severity"],title:string,detail:string,fix?:string)=>issues.push({id:`${category}:${title}`,category,severity,title,detail,fix});
 if(!/<h1[\s>]/i.test(html))push("seo","warning","H1がありません","ページの主題を示すH1を1つ追加してください。","ヒーローセクションへH1を追加");
 const h1=(html.match(/<h1[\s>]/gi)||[]).length;if(h1>1)push("seo","warning","H1が複数あります",`H1が${h1}個あります。`,"主見出し以外をH2へ変更");
 const images=[...html.matchAll(/<img\b([^>]*)>/gi)];images.forEach((m,i)=>{if(!/\balt\s*=/.test(m[1]))push("accessibility","error",`画像${i+1}にaltがありません`,"スクリーンリーダー向けの代替テキストが必要です。","alt属性を追加")});
 if(!/<meta[^>]+description/i.test(html))push("seo","info","説明文は書き出し時に未設定です","検索結果用のdescription設定を追加すると良いです。");
 if(/style\s*=/.test(html))push("maintainability","info","インラインCSSがあります","再利用するスタイルはCSSタブへ移すと保守しやすくなります。");
 if(text.trim().length<120)push("seo","info","本文量が少なめです","検索や理解に必要な説明が不足していないか確認してください。");
 if(!/@media/i.test(project.css))push("responsive","warning","レスポンシブCSSがありません","スマートフォン向けのレイアウト調整を追加してください。","@mediaルールを追加");
 if(project.javascript.length>60000)push("performance","warning","JavaScriptが大きいです",`${Math.round(project.javascript.length/1000)}KBあります。処理を分割してください。`);
 if(project.assets?.some(a=>a.size>1_000_000))push("performance","warning","大きなアセットがあります","1MBを超える画像は表示速度を低下させる可能性があります。");
 if(!/<button|<a\b/i.test(html))push("accessibility","info","操作要素がありません","必要に応じて明確なCTAを追加してください。");
 return issues;
}
export function qualityScore(issues:WebAuditIssue[]){return Math.max(0,100-issues.reduce((n,i)=>n+(i.severity==="error"?18:i.severity==="warning"?9:3),0))}
export function designSuggestions(project:WebProject){const out:string[]=[];if(!/wb-hero|<header/i.test(project.html))out.push("ページ冒頭にヒーローセクションを追加すると目的が伝わりやすくなります。");if((project.html.match(/<section/gi)||[]).length<3)out.push("情報を3〜5個のセクションに分けると読みやすくなります。");if(!/var\(--wb-primary\)/.test(project.css))out.push("テーマ変数を使うと色変更を一括反映できます。");if(!/hover/i.test(project.css))out.push("ボタンやカードに控えめなホバー反応を追加すると操作感が向上します。");return out.length?out:["構造・テーマ・レスポンシブ対応は概ね良好です。実機プレビューで最終確認してください。"]}
