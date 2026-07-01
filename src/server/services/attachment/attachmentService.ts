import fs from 'fs-extra';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/sqlite';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';
import { selectScopedRoot } from '../../../shared/persistence/scopeBoundary';
import { base64AttachmentLimitMessage, estimatedBase64DecodedBytes, isBase64AttachmentWithinLimit } from '../../../shared/persistence/attachmentUploadPolicy';
import { createAtomicTempPath } from '../../../shared/persistence/atomicPath';
import type { AttachmentInfo, LockInfo, PageBundle, WorkspaceScope } from '../../../shared/types';

export type AttachmentServiceDependencies = {
  db: Db;
  sharedRoot: string;
  appInstanceId: string;
  getPage: (pageId: string) => PageBundle | null;
  getLock: (pageId: string) => Promise<LockInfo | null>;
  pageScope: (pageId: string) => WorkspaceScope;
  userLabel: () => string;
  atomicWriteJson: (file: string, data: unknown) => Promise<void>;
};

/** Keeps attachment I/O, privacy migration and SQLite indexing out of VaultService. */
export class AttachmentService {
  constructor(private readonly deps: AttachmentServiceDependencies) {}

  private attachmentRoot(scope: WorkspaceScope): string {
    const paths = vaultPaths(this.deps.sharedRoot);
    return selectScopedRoot(scope, paths.attachments, paths.privateAttachments);
  }
  private attachmentPageDir(pageId: string, scope: WorkspaceScope): string {
    return path.join(this.attachmentRoot(scope), sanitizeSegment(pageId));
  }
  private attachmentIndexPath(pageId: string, scope: WorkspaceScope): string {
    return path.join(this.attachmentPageDir(pageId, scope), 'attachments.json');
  }
  private async readAttachmentIndex(pageId: string, scope: WorkspaceScope): Promise<AttachmentInfo[]> {
    const raw = await fs.readJson(this.attachmentIndexPath(pageId, scope)).catch(() => []);
    if (!Array.isArray(raw)) return [];
    return raw.map((item: any) => ({
      ...item, id: String(item?.id || ''), pageId,
      fileName: String(item?.fileName || ''), relativePath: String(item?.relativePath || ''),
      size: Number(item?.size || 0), createdAt: String(item?.createdAt || ''),
      createdBy: String(item?.createdBy || ''), scope: item?.scope === 'private' ? 'private' : scope,
    })).filter((item: AttachmentInfo) => Boolean(item.id && item.relativePath));
  }
  private async assertWritable(pageId: string): Promise<PageBundle> {
    const page = this.deps.getPage(pageId);
    if (!page) throw new Error('Page not found');
    const lock = await this.deps.getLock(pageId);
    if (lock && lock.appInstanceId !== this.deps.appInstanceId && new Date(lock.expiresAt).getTime() > Date.now()) {
      throw new Error(`Page is locked by ${lock.userName} / ${lock.lockedBy}`);
    }
    return page;
  }
  private async upsertAttachmentIndexForPage(page: PageBundle, attachment: AttachmentInfo): Promise<void> {
    const item = attachment;
    this.deps.db.prepare(`INSERT OR REPLACE INTO attachment_index(id,page_id,attachment_id,file_name,mime_type,size,created_at,relative_path,page_title,page_icon,page_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      `${page.meta.id}:${item.id}`, page.meta.id, item.id, item.fileName || '', (item as any).mimeType || '',
      Number(item.size || 0), item.createdAt || page.meta.updatedAt || '', item.relativePath || '', page.meta.title,
      page.meta.icon || '📄', page.meta.updatedAt || '',
    );
  }
  async listAttachments(pageId: string): Promise<AttachmentInfo[]> {
    const scope = this.deps.pageScope(pageId);
    const primary = await this.readAttachmentIndex(pageId, scope);
    if (scope !== 'private') return primary;
    const legacy = await this.readAttachmentIndex(pageId, 'shared');
    if (!legacy.length) return primary;
    const privateDir = this.attachmentPageDir(pageId, 'private');
    await fs.ensureDir(privateDir);
    const migrated = [...primary]; const ids = new Set(primary.map(x => x.id)); let allCopied = true;
    for (const item of legacy) {
      if (ids.has(item.id)) continue;
      const legacyAbsolute = path.resolve(this.deps.sharedRoot, item.relativePath);
      const root = path.resolve(this.deps.sharedRoot);
      if (!legacyAbsolute.startsWith(`${root}${path.sep}`) || !(await fs.pathExists(legacyAbsolute))) { allCopied = false; continue; }
      const dest = path.join(privateDir, path.basename(legacyAbsolute));
      await fs.copy(legacyAbsolute, dest, { overwrite: false }).catch(() => { allCopied = false; });
      if (!(await fs.pathExists(dest))) { allCopied = false; continue; }
      migrated.push({ ...item, relativePath: path.relative(this.attachmentRoot('private'), dest), scope: 'private' }); ids.add(item.id);
    }
    if (ids.size > primary.length) await this.deps.atomicWriteJson(this.attachmentIndexPath(pageId, 'private'), migrated);
    if (allCopied && ids.size >= legacy.length) await fs.remove(this.attachmentPageDir(pageId, 'shared')).catch(() => undefined);
    return migrated;
  }
  async addAttachment(pageId: string, sourcePath: string): Promise<AttachmentInfo> {
    const page = await this.assertWritable(pageId);
    if (!(await fs.pathExists(sourcePath))) throw new Error('添付元ファイルが見つかりません。');
    const scope = page.meta.scope === 'private' ? 'private' : 'shared'; const stat = await fs.stat(sourcePath);
    const fileName = path.basename(sourcePath); const id = `att_${nanoid(12)}`; const dir = this.attachmentPageDir(pageId, scope);
    await fs.ensureDir(dir); const dest = path.join(dir, `${id}_${sanitizeSegment(fileName) || 'file'}`); await fs.copy(sourcePath, dest, { overwrite: false });
    const relativeBase = scope === 'private' ? this.attachmentRoot(scope) : this.deps.sharedRoot;
    const info: AttachmentInfo = { id, pageId, fileName, relativePath: path.relative(relativeBase, dest), size: stat.size, createdAt: new Date().toISOString(), createdBy: this.deps.userLabel(), scope };
    const own = await this.readAttachmentIndex(pageId, scope); own.push(info); await this.deps.atomicWriteJson(this.attachmentIndexPath(pageId, scope), own); await this.upsertAttachmentIndexForPage(page, info); return info;
  }
  async addAttachmentFromBase64(pageId: string, fileName: string, base64: string): Promise<AttachmentInfo> {
    const page = await this.assertWritable(pageId); const scope = page.meta.scope === 'private' ? 'private' : 'shared';
    const clean = sanitizeSegment(path.basename(fileName || 'file')) || 'file'; const raw = String(base64 || '');
    if (!isBase64AttachmentWithinLimit(estimatedBase64DecodedBytes(raw))) throw new Error(base64AttachmentLimitMessage(fileName || clean));
    const data = Buffer.from(raw, 'base64'); if (!isBase64AttachmentWithinLimit(data.byteLength)) throw new Error(base64AttachmentLimitMessage(fileName || clean));
    const id = `att_${nanoid(12)}`; const dir = this.attachmentPageDir(pageId, scope); await fs.ensureDir(dir); const dest = path.join(dir, `${id}_${clean}`);
    const tmp = createAtomicTempPath(dest, this.deps.appInstanceId, Date.now(), nanoid(6));
    try { await fs.writeFile(tmp, data); await fs.move(tmp, dest, { overwrite: false }); } finally { await fs.remove(tmp).catch(() => undefined); }
    const relativeBase = scope === 'private' ? this.attachmentRoot(scope) : this.deps.sharedRoot;
    const info: AttachmentInfo = { id, pageId, fileName: fileName || clean, relativePath: path.relative(relativeBase, dest), size: data.byteLength, createdAt: new Date().toISOString(), createdBy: this.deps.userLabel(), scope };
    const own = await this.readAttachmentIndex(pageId, scope); own.push(info); await this.deps.atomicWriteJson(this.attachmentIndexPath(pageId, scope), own); await this.upsertAttachmentIndexForPage(page, info); return info;
  }
  async getAttachmentInfo(pageId: string, attachmentId: string): Promise<AttachmentInfo> {
    const item = (await this.listAttachments(pageId)).find(x => x.id === attachmentId); if (!item) throw new Error('Attachment not found'); return item;
  }
  async getAttachmentFilePath(pageId: string, attachmentId: string): Promise<string> {
    const item = await this.getAttachmentInfo(pageId, attachmentId); const pageScope = this.deps.pageScope(pageId);
    const preferred: WorkspaceScope = item.scope === 'private' ? 'private' : item.scope === 'shared' ? 'shared' : pageScope;
    const candidates: WorkspaceScope[] = preferred === 'private' ? ['private','shared'] : preferred === 'shared' && pageScope === 'private' ? ['shared','private'] : [preferred];
    for (const scope of candidates) {
      const relative = String(item.relativePath || ''); const base = scope === 'shared' && /^attachments[\\/]/i.test(relative) ? this.deps.sharedRoot : this.attachmentRoot(scope);
      const root = path.resolve(base); const absolute = path.resolve(root, relative);
      if ((!absolute.startsWith(`${root}${path.sep}`) && absolute !== root) || !(await fs.pathExists(absolute))) continue;
      return absolute;
    }
    throw new Error('Attachment file not found');
  }
}
