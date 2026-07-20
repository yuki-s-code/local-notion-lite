export type WebPreviewDevice = "desktop" | "tablet" | "mobile" | "iphone" | "ipad" | "macbook" | "wide";
export type WebCodeTab = "html" | "css" | "javascript";
export type WebBuilderPanel = "components" | "navigator" | "properties" | "theme" | "assets" | "pages" | "data" | "responsive" | "quality" | "history" | "templates" | "plugins" | "ai" | "publish";

export type WebVariable={id?:string;key:string;value:string};
export type WebBinding={id:string;key:string;value:string;escape?:boolean;sourceKind?:"manual"|"page"|"database"};
export type WebCmsItem={id:string;title:string;summary?:string;date?:string;url?:string;published?:boolean};
export type WebCmsCollection={id:string;name:string;layout:"grid"|"list";limit:number;items:WebCmsItem[]};
export type WebSharedComponent={id:string;name:string;html:string;updatedAt:number};
export type WebResponsiveRule={id:string;maxWidth:number;selector:string;declarations:string};
export type WebDeploySettings={provider:"github-pages"|"netlify"|"vercel"|"cloudflare"|"manual";repository?:string;siteName?:string};
export type WebProjectLink = { kind: "page" | "database"; id: string; title: string; snapshot: string; updatedAt?: string };
export type WebTheme = { primary:string; secondary:string; background:string; text:string; radius:number; spacing:number; shadow:string; fontFamily:string };
export type WebPage = { id:string; title:string; slug:string; html:string; createdAt:number; updatedAt:number };
export type WebAsset = { id:string; name:string; type:string; dataUrl:string; size:number; createdAt:number };
export type WebHistoryEntry = { id:string; label:string; html:string; css:string; javascript:string; pageId:string; createdAt:number };
export type WebUserTemplate={id:string;name:string;html:string;css:string;javascript:string;createdAt:number};
export type WebPlugin={id:string;name:string;enabled:boolean;html?:string;css?:string;javascript?:string};
export type WebDesignEvent={id:string;label:string;kind:"content"|"layout"|"theme"|"asset"|"publish";createdAt:number};
export type WebLocalFileSource={id:string;name:string;fileName:string;format:"json"|"csv"|"html";rawText:string;records:Record<string,unknown>[];createdAt:number;size:number};
export type WebProject = {
  id:string; title:string; html:string; css:string; javascript:string; device:WebPreviewDevice; links:WebProjectLink[];
  pages?:WebPage[]; activePageId?:string; theme?:WebTheme; assets?:WebAsset[]; history?:WebHistoryEntry[]; favoriteComponentIds?:string[]; userTemplates?:WebUserTemplate[]; plugins?:WebPlugin[]; designHistory?:WebDesignEvent[]; variables?:WebVariable[]; bindings?:WebBinding[]; cmsCollections?:WebCmsCollection[]; sharedComponents?:WebSharedComponent[]; responsiveRules?:WebResponsiveRule[]; localFileSources?:WebLocalFileSource[]; deploy?:WebDeploySettings;
  createdAt:number; updatedAt:number;
};
export type WebConsoleEntry = { id:string; level:"log"|"warn"|"error"; message:string; createdAt:number };
export type WebAuditIssue = { id:string; category:"accessibility"|"seo"|"performance"|"responsive"|"maintainability"; severity:"error"|"warning"|"info"; title:string; detail:string; fix?:string };
