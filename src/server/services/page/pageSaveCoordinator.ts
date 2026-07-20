import type {
  PageBundle,
  PageHistoryReason,
  PageMeta,
  PageProperties,
} from "../../../shared/types";

/**
 * Owns page-save ordering only. Side effects are injected so callers keep their
 * existing persistence contracts while implementation moves out of VaultService.
 */
export type SavePageInput = {
  id: string;
  title: string;
  markdown: string;
  blocksuite: unknown;
  baseUpdatedAt?: string;
  properties?: PageProperties;
  icon?: string | null;
  scope?: "private" | "shared";
  historyReason?: PageHistoryReason;
};

type PageSaveCoordinatorDeps = {
  getCurrent: (pageId: string) => PageBundle | null;
  readSharedMeta: (pageId: string) => Promise<PageMeta | null>;
  handleConflict: (current: PageBundle, input: SavePageInput, sharedMeta: PageMeta) => Promise<never>;
  resolveHistoryReason: (current: PageBundle, input: SavePageInput) => PageHistoryReason | undefined;
  matchesCurrent: (current: PageBundle, input: SavePageInput) => boolean;
  backupHistory: (bundle: PageBundle, reason: PageHistoryReason) => Promise<void>;
  buildBundle: (current: PageBundle, input: SavePageInput) => PageBundle;
  persistBundle: (current: PageBundle, bundle: PageBundle) => Promise<void>;
};

export class PageSaveCoordinator {
  constructor(private readonly deps: PageSaveCoordinatorDeps) {}

  async save(input: SavePageInput): Promise<PageBundle> {
    const current = this.deps.getCurrent(input.id);
    if (!current) throw new Error("Page not found");

    const sharedMeta = await this.deps.readSharedMeta(input.id);
    if (input.baseUpdatedAt && sharedMeta && sharedMeta.updatedAt !== input.baseUpdatedAt) {
      return this.deps.handleConflict(current, input, sharedMeta);
    }

    const historyReason = this.deps.resolveHistoryReason(current, input);
    if (this.deps.matchesCurrent(current, input)) {
      if (historyReason) await this.deps.backupHistory(current, historyReason);
      return current;
    }

    const bundle = this.deps.buildBundle(current, input);
    await this.deps.persistBundle(current, bundle);
    if (historyReason) await this.deps.backupHistory(bundle, historyReason);
    return bundle;
  }
}
