import type { WebProject } from "./types";

export type WebTemplate = Pick<WebProject, "title" | "html" | "css" | "javascript"> & { id: string; description: string };

export const WEB_TEMPLATES: WebTemplate[] = [
  {
    id: "blank",
    title: "新しいWebサイト",
    description: "空のHTML・CSS・JavaScript",
    html: '<main class="container">\n  <h1>新しいWebサイト</h1>\n  <p>ここから編集を始めます。</p>\n</main>',
    css: 'body { margin: 0; font-family: system-ui, sans-serif; color: #172033; background: #f6f7fb; }\n.container { max-width: 960px; margin: 0 auto; padding: 64px 24px; }',
    javascript: 'console.log("Web Builder ready");',
  },
  {
    id: "landing",
    title: "案内サイト",
    description: "行政・施設案内に使えるランディングページ",
    html: '<header class="hero"><nav><strong>LOCAL PORTAL</strong><a href="#info">ご案内</a></nav><div><span class="eyebrow">INFORMATION</span><h1>必要な情報を、わかりやすく。</h1><p>サービス内容や手続きを、ひとつのページに整理します。</p><button id="start">詳しく見る</button></div></header><main id="info" class="cards"><article><h2>お知らせ</h2><p>最新情報を掲載します。</p></article><article><h2>利用案内</h2><p>利用方法や受付時間を案内します。</p></article><article><h2>お問い合わせ</h2><p>連絡先やよくある質問を掲載します。</p></article></main>',
    css: 'body{margin:0;font-family:system-ui,sans-serif;color:#172033;background:#f7f8fc}.hero{min-height:56vh;padding:28px clamp(24px,7vw,96px);background:linear-gradient(135deg,#e8efff,#fff)}nav{display:flex;justify-content:space-between;align-items:center}nav a{color:inherit}.hero>div{max-width:760px;padding:90px 0}.eyebrow{font-size:12px;letter-spacing:.18em;color:#4867b2}.hero h1{font-size:clamp(42px,7vw,76px);line-height:1.02;margin:14px 0}.hero p{font-size:19px;line-height:1.8;color:#536079}.hero button{border:0;border-radius:999px;padding:14px 24px;background:#244aa5;color:#fff}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;padding:40px clamp(24px,7vw,96px)}article{background:#fff;border:1px solid #e6e9f2;border-radius:20px;padding:26px;box-shadow:0 12px 36px rgba(23,32,51,.06)}',
    javascript: 'document.querySelector("#start")?.addEventListener("click",()=>document.querySelector("#info")?.scrollIntoView({behavior:"smooth"}));',
  },
  {
    id: "dashboard",
    title: "ダッシュボード",
    description: "カードと表を備えた業務ダッシュボード",
    html: '<div class="shell"><aside><h2>Dashboard</h2><button>概要</button><button>レポート</button><button>設定</button></aside><main><header><div><small>WORKSPACE</small><h1>運用ダッシュボード</h1></div><span id="clock"></span></header><section class="stats"><article><span>進行中</span><strong>12</strong></article><article><span>完了</span><strong>48</strong></article><article><span>確認待ち</span><strong>7</strong></article></section><section class="panel"><h2>最近の項目</h2><table><thead><tr><th>名称</th><th>状態</th><th>更新</th></tr></thead><tbody><tr><td>サンプル項目</td><td>進行中</td><td>今日</td></tr></tbody></table></section></main></div>',
    css: '*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f5f6fa;color:#1a2030}.shell{display:grid;grid-template-columns:220px 1fr;min-height:100vh}aside{padding:28px 20px;background:#172033;color:white}aside button{display:block;width:100%;padding:11px 12px;margin:8px 0;border:0;border-radius:10px;text-align:left;background:transparent;color:#dce4f8}main{padding:34px}header{display:flex;justify-content:space-between;align-items:center}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}.stats article,.panel{background:white;border:1px solid #e4e7ef;border-radius:18px;padding:22px}.stats strong{display:block;font-size:38px;margin-top:8px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:14px;border-bottom:1px solid #edf0f5}@media(max-width:700px){.shell{grid-template-columns:1fr}aside{display:none}.stats{grid-template-columns:1fr}}',
    javascript: 'const tick=()=>{const el=document.querySelector("#clock");if(el)el.textContent=new Date().toLocaleString("ja-JP")};tick();setInterval(tick,1000);',
  },
];
