import type { VaultService } from "../vaultService";

/**
 * Explicit domain boundary around the legacy VaultService. Routes use these
 * facades now; implementation can move out of VaultService incrementally
 * without changing HTTP contracts or renderer call sites.
 */
export class VaultPageUpdateService {
  constructor(private readonly vault: VaultService) {}
  list = () => this.vault.listPages();
  tree = () => this.vault.listPageTree();
  get = (id: string) => this.vault.getPage(id);
  create = (title: string, parentId: string | null, scope: any) => this.vault.createPage(title, parentId, scope);
  save = (input: Parameters<VaultService["savePage"]>[0]) => this.vault.savePage(input);
  move = (id: string, parentId: string | null) => this.vault.movePage(id, parentId);
  trash = (id: string) => this.vault.trashPage(id);
  restore = (id: string) => this.vault.restoreTrashedPage(id);
}
export class VaultLinkService {
  constructor(private readonly vault: VaultService) {}
  backlinks = (pageId: string) => this.vault.listBacklinks(pageId);
  broken = () => this.vault.listBrokenLinks();
  localGraph = (pageId: string, maxNodes?: number) =>
    this.vault.getLocalKnowledgeGraph(
      pageId,
      maxNodes === undefined ? undefined : { maxNodes },
    );
  globalGraph = (options?: any) => this.vault.getGlobalKnowledgeGraph(options);
}
export class VaultSearchService {
  constructor(private readonly vault: VaultService) {}
  pages = (query: string) => this.vault.search(query);
  journals = (query: string, limit?: number) => this.vault.searchJournals(query, limit);
  semantic = (query: string, options?: any) => this.vault.searchWorkspaceSemantic(query, options);
}
export class VaultAiService {
  constructor(private readonly vault: VaultService) {}
  chat = (input: any, onDelta?: (delta: string) => void) => this.vault.generateWorkspaceAiChatAnswer(input, onDelta);
  editorEdit = (input: any) => this.vault.generateEditorAiEdit(input);
  smartAssist = (input: Parameters<VaultService["askSmartAssist"]>[0]) => this.vault.askSmartAssist(input);
}
export function createVaultDomainServices(vault: VaultService) {
  return { pages: new VaultPageUpdateService(vault), links: new VaultLinkService(vault), search: new VaultSearchService(vault), ai: new VaultAiService(vault) };
}
export type VaultDomainServices = ReturnType<typeof createVaultDomainServices>;
