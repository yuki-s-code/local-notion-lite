import type { ApiTransport } from "./transport";
export class SemanticApi {
  constructor(private readonly transport: ApiTransport) {}
  search = (query: string, params: {limit?:number;types?:string[]}={}) => { const qs=new URLSearchParams({q:query}); if(params.limit!==undefined) qs.set("limit",String(params.limit)); if(params.types?.length) qs.set("types",params.types.join(",")); return this.transport.getJson<any>(`/semantic/search?${qs}`); };
  relatedForPage = (id:string, limit=32) => this.transport.getJson<any>(`/semantic/related/page/${this.transport.pathId(id)}?limit=${limit}`);
  chat = (input:any) => this.transport.postJson<any>("/semantic/chat-answer",input);
  editorEdit = (input:any) => this.transport.postJson<any>("/editor-ai/edit",input);
}
