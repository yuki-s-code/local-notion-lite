import path from 'node:path';
import fs from 'fs-extra';

export type ItemWithRevision = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  [key: string]: unknown;
};

type AtomicWriteJson = (file: string, data: unknown) => Promise<void>;
type Mutation = <T>(file: string, task: () => Promise<T>) => Promise<T>;

type ItemCollectionOptions<T extends ItemWithRevision> = {
  /** Existing aggregate JSON path kept for backwards compatibility. */
  legacyFile: string;
  /** A stable collection key such as faqs or synonyms. */
  collectionKey: string;
  normalize: (value: any) => T | null;
  atomicWriteJson: AtomicWriteJson;
  mutate: Mutation;
  limit: number;
};

export class ItemCollection<T extends ItemWithRevision> {
  constructor(private readonly options: ItemCollectionOptions<T>) {}

  private get root(): string {
    return path.join(path.dirname(this.options.legacyFile), 'item-collections', this.options.collectionKey);
  }

  private get itemsDir(): string { return path.join(this.root, 'items'); }
  private get tombstonesDir(): string { return path.join(this.root, 'tombstones'); }
  private get manifestFile(): string { return path.join(this.root, 'manifest.json'); }
  private itemFile(id: string): string { return path.join(this.itemsDir, `${encodeURIComponent(id)}.json`); }
  private tombstoneFile(id: string): string { return path.join(this.tombstonesDir, `${encodeURIComponent(id)}.json`); }

  private async ensureDirs(): Promise<void> {
    await Promise.all([fs.ensureDir(this.itemsDir), fs.ensureDir(this.tombstonesDir)]);
  }

  private async readLegacy(): Promise<any[]> {
    const raw = await fs.readJson(this.options.legacyFile).catch(() => []);
    return Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  }

  private async readItems(): Promise<T[]> {
    const names = await fs.readdir(this.itemsDir).catch(() => [] as string[]);
    // Keep the generic type out of Promise.all's Awaited<T> inference. The
    // normalizer is the sole boundary that turns untrusted JSON into T.
    const items: T[] = [];
    await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
      const raw = await fs.readJson(path.join(this.itemsDir, name)).catch(() => null);
      const item = this.options.normalize(raw);
      if (item) items.push(item);
    }));
    return items;
  }

  private async readTombstones(): Promise<Map<string, string>> {
    const names = await fs.readdir(this.tombstonesDir).catch(() => [] as string[]);
    const rows = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
      const raw = await fs.readJson(path.join(this.tombstonesDir, name)).catch(() => null);
      const id = String(raw?.id || '').trim();
      const deletedAt = String(raw?.deletedAt || '');
      return id ? [id, deletedAt] as const : null;
    }));
    return new Map(rows.filter((row): row is readonly [string, string] => Boolean(row)));
  }

  private sort(items: T[]): T[] {
    return [...items]
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
      .slice(0, this.options.limit);
  }

  private async bootstrapIfNeeded(): Promise<void> {
    await this.ensureDirs();
    if (await fs.pathExists(this.manifestFile)) return;
    const legacy = await this.readLegacy();
    for (const raw of legacy) {
      const item = this.options.normalize(raw);
      if (!item) continue;
      await this.options.atomicWriteJson(this.itemFile(item.id), item);
    }
    await this.options.atomicWriteJson(this.manifestFile, {
      version: 1,
      migratedAt: new Date().toISOString(),
      source: path.basename(this.options.legacyFile),
    });
  }

  private async writeLegacyCache(items: T[]): Promise<void> {
    await this.options.atomicWriteJson(this.options.legacyFile, this.sort(items));
  }

  private async listUnsafe(): Promise<T[]> {
    await this.bootstrapIfNeeded();
    const tombstones = await this.readTombstones();
    const items = await this.readItems();
    return this.sort(items.filter((item) => {
      const deletedAt = tombstones.get(item.id);
      return !deletedAt || String(item.updatedAt || item.createdAt || '') > deletedAt;
    }));
  }

  async list(): Promise<T[]> {
    return this.options.mutate(this.manifestFile, async () => this.listUnsafe());
  }

  async upsert(input: any, options?: { baseUpdatedAt?: string }): Promise<T[]> {
    return this.options.mutate(this.manifestFile, async () => {
      await this.bootstrapIfNeeded();
      const next = this.options.normalize(input);
      if (!next) return this.listUnsafe();
      const current = this.options.normalize(await fs.readJson(this.itemFile(next.id)).catch(() => null));
      const baseUpdatedAt = String(options?.baseUpdatedAt || input?.baseUpdatedAt || '').trim();
      if (current && baseUpdatedAt && String(current.updatedAt || '') !== baseUpdatedAt) {
        const error: any = new Error('項目が別の更新で変更されています。再読み込みしてから編集してください。');
        error.code = 'ITEM_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      const now = new Date().toISOString();
      const persisted = this.options.normalize({
        ...current,
        ...next,
        id: next.id,
        createdAt: current?.createdAt || next.createdAt || now,
        updatedAt: now,
      });
      if (!persisted) return this.listUnsafe();
      await this.options.atomicWriteJson(this.itemFile(persisted.id), persisted);
      await fs.remove(this.tombstoneFile(persisted.id)).catch(() => undefined);
      const all = await this.listUnsafe();
      await this.writeLegacyCache(all);
      return all;
    });
  }

  /**
   * Legacy bulk-save compatibility. It only upserts supplied items and never
   * deletes omitted records. Deletion must use delete(id), preventing stale
   * list screens from resurrecting or deleting unrelated records.
   */
  async mergeBulk(input: any[]): Promise<T[]> {
    return this.options.mutate(this.manifestFile, async () => {
      await this.bootstrapIfNeeded();
      for (const raw of Array.isArray(input) ? input : []) {
        const next = this.options.normalize(raw);
        if (!next) continue;
        const tombstone = await fs.readJson(this.tombstoneFile(next.id)).catch(() => null);
        const deletedAt = String(tombstone?.deletedAt || '');
        const incomingAt = String(next.updatedAt || next.createdAt || '');
        if (deletedAt && (!incomingAt || incomingAt <= deletedAt)) continue;
        const current = this.options.normalize(await fs.readJson(this.itemFile(next.id)).catch(() => null));
        const currentAt = String(current?.updatedAt || current?.createdAt || '');
        if (current && incomingAt && currentAt && incomingAt < currentAt) continue;
        const now = new Date().toISOString();
        const persisted = this.options.normalize({
          ...current,
          ...next,
          id: next.id,
          createdAt: current?.createdAt || next.createdAt || now,
          updatedAt: incomingAt || now,
        });
        if (persisted) await this.options.atomicWriteJson(this.itemFile(persisted.id), persisted);
      }
      const all = await this.listUnsafe();
      await this.writeLegacyCache(all);
      return all;
    });
  }

  /**
   * Deletes an item with optional optimistic concurrency protection.
   * A stale editor must not be able to delete a newer item that was changed on
   * another PC after the editor originally loaded it.
   */
  async delete(id: string, options?: { baseUpdatedAt?: string }): Promise<T[]> {
    return this.options.mutate(this.manifestFile, async () => {
      await this.bootstrapIfNeeded();
      const current = this.options.normalize(await fs.readJson(this.itemFile(id)).catch(() => null));
      const baseUpdatedAt = String(options?.baseUpdatedAt || '').trim();
      if (current && baseUpdatedAt && String(current.updatedAt || '') !== baseUpdatedAt) {
        const error: any = new Error('項目が別の更新で変更されています。再読み込みしてから削除してください。');
        error.code = 'ITEM_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      const deletedAt = new Date().toISOString();
      await this.options.atomicWriteJson(this.tombstoneFile(id), {
        id,
        deletedAt,
        updatedAt: deletedAt,
        previousUpdatedAt: current?.updatedAt,
      });
      await fs.remove(this.itemFile(id));
      const all = await this.listUnsafe();
      await this.writeLegacyCache(all);
      return all;
    });
  }
}
