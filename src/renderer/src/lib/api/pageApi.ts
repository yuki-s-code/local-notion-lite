import type { PageBundle, PageMeta, PageTreeNode, PageWithLock, WorkspaceScope, PageProperties } from "../../../../shared/types";
import type { ApiTransport } from "./transport";
export class PageApi {
  constructor(private readonly transport: ApiTransport) {}
  list = () => this.transport.getJson<PageWithLock[]>("/pages");
  tree = () => this.transport.getJson<PageTreeNode[]>("/pages/tree");
  get = (id: string, signal?: AbortSignal) => this.transport.getJson<PageBundle>(`/pages/${this.transport.pathId(id)}`, signal ? { signal } : undefined);
  search = (query: string) => this.transport.getJson<PageWithLock[]>(`/pages/search?q=${encodeURIComponent(query)}`);
  create = (title: string, parentId: string | null, scope: WorkspaceScope) => this.transport.postJson<PageBundle>("/pages", { title, parentId, scope });
  save = (page: { id:string; title:string; markdown:string; blocksuite:unknown; baseUpdatedAt?:string; properties?:PageProperties; icon?:string|null; scope?:WorkspaceScope; historyReason?:"manual"|"auto_checkpoint"|"metadata_changed"; }) => this.transport.putJson<PageBundle>(`/pages/${this.transport.pathId(page.id)}`, page);
  move = (id: string, parentId: string | null) => this.transport.patchJson<PageMeta>(`/pages/${this.transport.pathId(id)}/move`, { parentId });
}
