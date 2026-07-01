import fs from 'fs-extra';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { JournalEntry } from '../../../shared/types';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';
import { base64AttachmentLimitMessage, estimatedBase64DecodedBytes, isBase64AttachmentWithinLimit } from '../../../shared/persistence/attachmentUploadPolicy';
import { createAtomicTempPath } from '../../../shared/persistence/atomicPath';
import type { AttachmentInfo } from '../../../shared/types';

export type JournalServiceDependencies = {
  sharedRoot: string;
  userLabel: () => string;
  atomicWriteJson: (file: string, data: unknown) => Promise<void>;
  withSharedJsonMutation: <T>(file: string, task: () => Promise<T>) => Promise<T>;
  onSaved?: (journal: JournalEntry) => void | Promise<void>;
  onDeleted?: (date: string) => void | Promise<void>;
};

/** Shared-folder Journal persistence with conflict detection and serialized mutation. */
export class JournalService {
  constructor(private readonly deps: JournalServiceDependencies) {}

  journalDir(date: string): string {
    return path.join(vaultPaths(this.deps.sharedRoot).journals, sanitizeSegment(date));
  }

  private attachmentDir(date: string): string {
    return path.join(this.journalDir(date), 'attachments');
  }

  private attachmentIndexPath(date: string): string {
    return path.join(this.attachmentDir(date), 'attachments.json');
  }

  private async readAttachments(date: string): Promise<AttachmentInfo[]> {
    const raw = await fs.readJson(this.attachmentIndexPath(date)).catch(() => []);
    if (!Array.isArray(raw)) return [];
    return raw.map((item: any) => ({
      ...item,
      id: String(item?.id || ''),
      pageId: `journal_${date}`,
      fileName: String(item?.fileName || ''),
      relativePath: String(item?.relativePath || ''),
      size: Number(item?.size || 0),
      createdAt: String(item?.createdAt || ''),
      createdBy: String(item?.createdBy || ''),
      scope: 'shared',
    })).filter((item: AttachmentInfo) => Boolean(item.id && item.relativePath));
  }

  async listAttachments(date: string): Promise<AttachmentInfo[]> {
    return this.readAttachments(date);
  }

  async addAttachmentFromSource(date: string, sourcePath: string): Promise<AttachmentInfo> {
    const marker = path.join(this.journalDir(date), 'journal.json');
    return this.deps.withSharedJsonMutation(marker, async () => {
      if (!(await fs.pathExists(sourcePath))) throw new Error('添付元ファイルが見つかりません。');
      const fileName = path.basename(sourcePath);
      const clean = sanitizeSegment(fileName) || 'file';
      const id = `jatt_${nanoid(12)}`;
      const dir = this.attachmentDir(date);
      await fs.ensureDir(dir);
      const dest = path.join(dir, `${id}_${clean}`);
      await fs.copy(sourcePath, dest, { overwrite: false });
      const stat = await fs.stat(dest);
      const info: AttachmentInfo = {
        id,
        pageId: `journal_${date}`,
        fileName,
        relativePath: path.relative(this.journalDir(date), dest),
        size: stat.size,
        createdAt: new Date().toISOString(),
        createdBy: this.deps.userLabel(),
        scope: 'shared',
      };
      const items = await this.readAttachments(date);
      items.push(info);
      await this.deps.atomicWriteJson(this.attachmentIndexPath(date), items);
      return info;
    });
  }

  async addAttachmentFromBase64(date: string, fileName: string, base64: string): Promise<AttachmentInfo> {
    const marker = path.join(this.journalDir(date), 'journal.json');
    return this.deps.withSharedJsonMutation(marker, async () => {
      const clean = sanitizeSegment(path.basename(fileName || 'file')) || 'file';
      const raw = String(base64 || '');
      if (!isBase64AttachmentWithinLimit(estimatedBase64DecodedBytes(raw))) {
        throw new Error(base64AttachmentLimitMessage(fileName || clean));
      }
      const data = Buffer.from(raw, 'base64');
      if (!isBase64AttachmentWithinLimit(data.byteLength)) {
        throw new Error(base64AttachmentLimitMessage(fileName || clean));
      }
      const id = `jatt_${nanoid(12)}`;
      const dir = this.attachmentDir(date);
      await fs.ensureDir(dir);
      const dest = path.join(dir, `${id}_${clean}`);
      const tmp = createAtomicTempPath(dest, 'journal', Date.now(), nanoid(6));
      try {
        await fs.writeFile(tmp, data);
        await fs.move(tmp, dest, { overwrite: false });
      } finally {
        await fs.remove(tmp).catch(() => undefined);
      }
      const info: AttachmentInfo = {
        id,
        pageId: `journal_${date}`,
        fileName: fileName || clean,
        relativePath: path.relative(this.journalDir(date), dest),
        size: data.byteLength,
        createdAt: new Date().toISOString(),
        createdBy: this.deps.userLabel(),
        scope: 'shared',
      };
      const items = await this.readAttachments(date);
      items.push(info);
      await this.deps.atomicWriteJson(this.attachmentIndexPath(date), items);
      return info;
    });
  }

  async getAttachmentInfo(date: string, attachmentId: string): Promise<AttachmentInfo> {
    const attachment = (await this.readAttachments(date)).find((item) => item.id === attachmentId);
    if (!attachment) throw new Error('Journal attachment not found');
    return attachment;
  }

  async getAttachmentFilePath(date: string, attachmentId: string): Promise<string> {
    const attachment = await this.getAttachmentInfo(date, attachmentId);
    const root = path.resolve(this.journalDir(date));
    const absolute = path.resolve(root, attachment.relativePath);
    if (!absolute.startsWith(`${root}${path.sep}`) || !(await fs.pathExists(absolute))) {
      throw new Error('Journal attachment file not found');
    }
    return absolute;
  }

  normalize(input: Partial<JournalEntry>, fallbackDate: string): JournalEntry {
    const now = new Date().toISOString();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date ?? fallbackDate))
      ? String(input.date ?? fallbackDate)
      : fallbackDate;
    return {
      date,
      title: input.title || `${date} のジャーナル`,
      icon: input.icon || '📅',
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || input.createdAt || now,
      updatedBy: input.updatedBy || this.deps.userLabel(),
      mood: input.mood ? String(input.mood) : '',
      weather: input.weather ? String(input.weather) : '',
      tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [],
      markdown: typeof input.markdown === 'string' ? input.markdown : '',
      blocksuite: input.blocksuite ?? { version: 1, kind: 'blocknote', blocks: [{ type: 'paragraph', content: '' }] },
    };
  }

  async get(date: string): Promise<JournalEntry> {
    const file = path.join(this.journalDir(date), 'journal.json');
    if (!(await fs.pathExists(file))) {
      const now = new Date().toISOString();
      return this.normalize({
        date,
        title: `${date} のジャーナル`,
        createdAt: now,
        updatedAt: now,
        updatedBy: this.deps.userLabel(),
        markdown: '',
        blocksuite: { version: 1, kind: 'blocknote', blocks: [{ type: 'paragraph', content: '' }] },
      }, date);
    }
    return this.normalize(await fs.readJson(file).catch(() => ({})), date);
  }

  async save(input: Partial<JournalEntry> & { date: string; baseUpdatedAt?: string }): Promise<JournalEntry> {
    const file = path.join(this.journalDir(input.date), 'journal.json');
    return this.deps.withSharedJsonMutation(file, async () => {
      const existed = await fs.pathExists(file);
      const current = await this.get(input.date);
      const baseUpdatedAt = String(input.baseUpdatedAt || '').trim();
      const force = Boolean((input as any).force);
      if (!force && existed && baseUpdatedAt && current.updatedAt && baseUpdatedAt !== current.updatedAt) {
        // Preserve the local draft in the shared backup area before returning a
        // conflict. The renderer also keeps it in memory, but this protects the
        // user's text if the app is closed while the resolution dialog is open.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(
          vaultPaths(this.deps.sharedRoot).backups,
          `journal_conflict_${sanitizeSegment(input.date)}_${stamp}`,
          'journal.json',
        );
        const { baseUpdatedAt: _base, force: _force, ...draft } = input as any;
        await fs.ensureDir(path.dirname(backupFile));
        await this.deps.atomicWriteJson(
          backupFile,
          this.normalize({ ...current, ...draft, updatedAt: current.updatedAt }, input.date),
        ).catch(() => undefined);
        const conflict = new Error(`Journal conflict detected; currentUpdatedAt=${current.updatedAt}; baseUpdatedAt=${baseUpdatedAt}`);
        (conflict as any).code = 'JOURNAL_CONFLICT';
        throw conflict;
      }
      const now = new Date().toISOString();
      const { baseUpdatedAt: _ignored, force: _force, ...payload } = input as any;
      const next = this.normalize({ ...current, ...payload, updatedAt: now, updatedBy: this.deps.userLabel() }, input.date);
      await fs.ensureDir(this.journalDir(next.date));
      await this.deps.atomicWriteJson(file, next);
      await this.deps.onSaved?.(next);
      return next;
    });
  }

  async remove(date: string): Promise<{ ok: true; date: string }> {
    const dir = this.journalDir(date);
    const marker = path.join(dir, 'journal.json');
    return this.deps.withSharedJsonMutation(marker, async () => {
      if (await fs.pathExists(dir)) {
        const backupDir = path.join(vaultPaths(this.deps.sharedRoot).backups, `deleted_journal_${sanitizeSegment(date)}_${new Date().toISOString().replace(/[:.]/g, '-')}`);
        await fs.ensureDir(path.dirname(backupDir));
        await fs.copy(dir, backupDir, { overwrite: true }).catch(() => undefined);
        await fs.remove(dir);
      }
      await this.deps.onDeleted?.(date);
      return { ok: true, date };
    });
  }
}
