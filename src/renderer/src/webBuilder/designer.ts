import type { WebProject } from "./types";
import { WEB_COMPONENTS } from "./components";
export function applyDesignerPrompt(project:WebProject,prompt:string):Partial<WebProject>{
 const q=prompt.toLocaleLowerCase("ja-JP"); let html=project.html; let css=project.css;
 const add=(id:string)=>{const c=WEB_COMPONENTS.find(x=>x.id===id);if(c){html=`${html.trim()}\n\n${c.html}`.trim();if(c.css&&!css.includes(c.css))css=`${css.trim()}\n\n${c.css}`.trim()}};
 if(/ヒーロー|hero|トップ/.test(q))add("hero");
 if(/faq|質問/.test(q))add("faq");
 if(/料金|価格|pricing/.test(q))add("pricing");
 if(/問い合わせ|contact/.test(q))add("contact");
 if(/カード|一覧/.test(q))add("card-grid");
 if(/フッター|footer/.test(q))add("footer");
 if(/ダーク|dark/.test(q))css=`${css}\n:root{--wb-background:#0f172a;--wb-text:#f8fafc;--wb-secondary:#cbd5e1}.wb-card{background:#162033;border-color:#334155}`;
 if(/余白.*広|ゆったり/.test(q))css=`${css}\n:root{--wb-space:24px}.wb-section{padding:clamp(3rem,8vw,7rem)}`;
 if(/丸|やわらか/.test(q))css=`${css}\n:root{--wb-radius:20px}`;
 if(/アニメ|動き/.test(q))css=`${css}\n@media(prefers-reduced-motion:no-preference){.wb-card,.wb-button{transition:transform .2s ease,box-shadow .2s ease}.wb-card:hover,.wb-button:hover{transform:translateY(-3px)}}`;
 return {html,css};
}
