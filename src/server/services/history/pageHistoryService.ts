import fs from 'fs-extra';
import path from 'node:path';
import type { HistoryDiffLine, HistoryDiffResult, HistoryEntry, PageBundle, PageHistoryReason } from '../../../shared/types';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';

export type PageHistoryServiceDependencies = {
  sharedRoot: string;
  userLabel: () => string;
  atomicWriteJson: (file: string, data: unknown) => Promise<void>;
  atomicWriteText: (file: string, text: string) => Promise<void>;
  normalizeMeta: (raw: unknown, pageId: string) => PageBundle['meta'];
  emptyBlocksuite: unknown;
};

export type PageHistoryDiffSummary = {
  lines: HistoryDiffLine[];
  addedCount: number;
  removedCount: number;
};

/** Keeps page snapshots and expensive diff logic isolated from the main vault facade. */
export class PageHistoryService {
  constructor(private readonly deps: PageHistoryServiceDependencies) {}

  private backupRoot(pageId: string): string {
    return path.join(vaultPaths(this.deps.sharedRoot).backups, sanitizeSegment(pageId));
  }

  async backup(bundle: PageBundle, reason?: PageHistoryReason, options: { deduplicate?: boolean } = {}): Promise<boolean> {
    if (options.deduplicate && await this.latestSnapshotMatches(bundle)) return false;
    const backupId = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.backupRoot(bundle.meta.id), backupId);
    await fs.ensureDir(dir);
    await this.deps.atomicWriteJson(path.join(dir, 'meta.json'), {
      ...bundle.meta,
      backupCreatedAt: new Date().toISOString(),
      backupCreatedBy: this.deps.userLabel(),
      historyReason: reason,
    });
    await this.deps.atomicWriteText(path.join(dir, 'content.md'), bundle.markdown);
    await this.deps.atomicWriteJson(path.join(dir, 'blocksuite.json'), bundle.blocksuite);
    return true;
  }

  private async latestSnapshotMatches(bundle: PageBundle): Promise<boolean> {
    const root = this.backupRoot(bundle.meta.id);
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    const latestId = entries.sort().at(-1);
    if (!latestId) return false;
    const dir = path.join(root, latestId);
    try {
      const [meta, markdown, blocksuite] = await Promise.all([
        fs.readJson(path.join(dir, 'meta.json')) as Promise<any>,
        fs.readFile(path.join(dir, 'content.md'), 'utf8'),
        fs.readJson(path.join(dir, 'blocksuite.json')),
      ]);
      const sameMeta =
        String(meta?.title || '') === String(bundle.meta.title || '') &&
        String(meta?.icon || '') === String(bundle.meta.icon || '') &&
        String(meta?.scope || 'shared') === String(bundle.meta.scope || 'shared') &&
        JSON.stringify(meta?.properties || {}) === JSON.stringify(bundle.meta.properties || {});
      return sameMeta && markdown === bundle.markdown && JSON.stringify(blocksuite) === JSON.stringify(bundle.blocksuite);
    } catch {
      return false;
    }
  }

  /** Counts snapshot directories without opening each meta.json file. */
  async count(pageId: string): Promise<number> {
    const root = this.backupRoot(pageId);
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    return entries.length;
  }

  async list(pageId: string): Promise<HistoryEntry[]> {
    const root = this.backupRoot(pageId);
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    const histories: HistoryEntry[] = [];
    for (const entry of entries) {
      const meta = await fs.readJson(path.join(root, entry, 'meta.json')).catch(() => null) as any;
      if (!meta) continue;
      histories.push({
        id: entry,
        pageId,
        title: meta.title || 'Untitled',
        backupDir: path.relative(this.deps.sharedRoot, path.join(root, entry)),
        createdAt: meta.backupCreatedAt || meta.updatedAt || entry,
        createdBy: meta.backupCreatedBy || meta.updatedBy || 'unknown',
        reason: meta.historyReason,
      });
    }
    histories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return histories;
  }

  async getBundle(pageId: string, historyId: string): Promise<PageBundle> {
    const dir = path.join(this.backupRoot(pageId), sanitizeSegment(historyId));
    const metaPath = path.join(dir, 'meta.json');
    if (!(await fs.pathExists(metaPath))) throw new Error('履歴が見つかりません。');
    const meta = this.deps.normalizeMeta(await fs.readJson(metaPath), pageId);
    const markdown = await fs.readFile(path.join(dir, 'content.md'), 'utf8').catch(() => '');
    const blocksuite = await fs.readJson(path.join(dir, 'blocksuite.json')).catch(() => this.deps.emptyBlocksuite);
    return { meta: { ...meta, id: pageId }, markdown, blocksuite };
  }

  diff(oldText: string, newText: string): PageHistoryDiffSummary {
    const oldLines = oldText.split(/\r?\n/);
    const newLines = newText.split(/\r?\n/);
    const m = oldLines.length;
    const n = newLines.length;
    if (m * n > 1_000_000) {
      const lines: HistoryDiffLine[] = [{ type: 'same', text: `文書が大きいため詳細な行単位比較を省略しました（旧 ${m.toLocaleString()} 行 / 新 ${n.toLocaleString()} 行）。` }];
      return { lines, addedCount: 0, removedCount: 0 };
    }
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const lines: HistoryDiffLine[] = [];
    let i = 0; let j = 0;
    while (i < m && j < n) {
      if (oldLines[i] === newLines[j]) { lines.push({ type: 'same', text: oldLines[i++] }); j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) lines.push({ type: 'removed', text: oldLines[i++] });
      else lines.push({ type: 'added', text: newLines[j++] });
    }
    while (i < m) lines.push({ type: 'removed', text: oldLines[i++] });
    while (j < n) lines.push({ type: 'added', text: newLines[j++] });
    const clipped = lines.slice(0, 800);
    return { lines: clipped, addedCount: clipped.filter((line) => line.type === 'added').length, removedCount: clipped.filter((line) => line.type === 'removed').length };
  }
}
