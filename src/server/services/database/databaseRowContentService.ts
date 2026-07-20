import fs from 'fs-extra';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { sanitizeSegment, vaultPaths } from '../../utils/paths';
import type { AttachmentInfo, DatabaseRowContent, SaveDatabaseRowContentInput } from '../../../shared/types';
import { base64AttachmentLimitMessage, estimatedBase64DecodedBytes, isBase64AttachmentWithinLimit } from '../../../shared/persistence/attachmentUploadPolicy';

const EMPTY_BLOCKSUITE = { version: 1, kind: 'blocknote', blocks: [] };

function nowIso(): string { return new Date().toISOString(); }

function safeTitle(value: unknown): string {
  const text = String(value ?? '').trim();
  return text || '無題の行';
}

export class DatabaseRowContentService {
  constructor(
    private sharedRoot: string,
    private userLabel: () => string,
  ) {}

  private paths() { return vaultPaths(this.sharedRoot); }

  private rowContentRoot(databaseScope: 'shared' | 'private' = 'shared'): string {
    const p = this.paths();
    return databaseScope === 'private'
      ? path.join(p.privateDatabases, '.row-pages')
      : path.join(p.root, 'database-row-pages');
  }

  private rowContentPath(databaseId: string, rowId: string, databaseScope: 'shared' | 'private' = 'shared'): string {
    return path.join(this.rowContentRoot(databaseScope), sanitizeSegment(databaseId), `${sanitizeSegment(rowId)}.json`);
  }

  private conflictDir(databaseId: string, rowId: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.paths().conflicts, `database-row-content_${sanitizeSegment(databaseId)}_${sanitizeSegment(rowId)}_${stamp}_${nanoid(6)}`);
  }

  private async atomicWriteJson(file: string, data: unknown): Promise<void> {
    await fs.ensureDir(path.dirname(file));
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeJson(tmp, data, { spaces: 2 });
    await fs.move(tmp, file, { overwrite: true });
  }

  async ensureDirs(): Promise<void> {
    await fs.ensureDir(this.rowContentRoot('shared'));
    await fs.ensureDir(this.rowContentRoot('private'));
  }

  async getRowContent(databaseId: string, rowId: string, options: { title?: string; scope?: 'shared' | 'private' } = {}): Promise<DatabaseRowContent> {
    const scope = options.scope === 'private' ? 'private' : 'shared';
    const file = this.rowContentPath(databaseId, rowId, scope);
    if (await fs.pathExists(file)) {
      const existing = await fs.readJson(file) as DatabaseRowContent;
      return {
        databaseId,
        rowId,
        title: safeTitle(existing.title || options.title),
        markdown: String(existing.markdown ?? ''),
        blocksuite: existing.blocksuite ?? EMPTY_BLOCKSUITE,
        createdAt: existing.createdAt || nowIso(),
        updatedAt: existing.updatedAt || nowIso(),
        updatedBy: existing.updatedBy || '',
        childPageIds: Array.isArray(existing.childPageIds) ? existing.childPageIds.filter(Boolean) : [],
      };
    }

    const now = nowIso();
    return {
      databaseId,
      rowId,
      title: safeTitle(options.title),
      markdown: '',
      blocksuite: EMPTY_BLOCKSUITE,
      createdAt: now,
      updatedAt: now,
      updatedBy: '',
    };
  }

  async saveRowContent(input: SaveDatabaseRowContentInput): Promise<DatabaseRowContent> {
    const scope = input.scope === 'private' ? 'private' : 'shared';
    const file = this.rowContentPath(input.databaseId, input.rowId, scope);
    const fileExists = await fs.pathExists(file);
    const current = fileExists
      ? await this.getRowContent(input.databaseId, input.rowId, { title: input.title, scope })
      : null;

    // V257: getRowContent() returns a synthetic initial document when the file does not exist yet.
    // That synthetic document has a fresh updatedAt on every call, so comparing it with the
    // renderer's baseUpdatedAt makes the first real save look like a false conflict.
    // Only persisted files are eligible for conflict checks.
    if (fileExists && current && input.baseUpdatedAt && current.updatedAt !== input.baseUpdatedAt) {
      await this.writeConflictSnapshot(input, current, 'baseUpdatedAt_mismatch');
      throw new Error(`Database row content conflict detected. currentUpdatedAt=${current.updatedAt}; baseUpdatedAt=${input.baseUpdatedAt}`);
    }

    const now = nowIso();
    const next: DatabaseRowContent = {
      databaseId: input.databaseId,
      rowId: input.rowId,
      title: safeTitle(input.title ?? current?.title),
      markdown: String(input.markdown ?? ''),
      blocksuite: input.blocksuite ?? EMPTY_BLOCKSUITE,
      createdAt: current?.createdAt || now,
      updatedAt: now,
      updatedBy: this.userLabel(),
      childPageIds: Array.isArray(input.childPageIds) ? input.childPageIds.filter(Boolean) : (current?.childPageIds ?? []),
    };
    await this.atomicWriteJson(this.rowContentPath(input.databaseId, input.rowId, scope), next);
    return next;
  }

  private attachmentRoot(scope: 'shared' | 'private'): string {
    const p = this.paths();
    return path.join(scope === 'private' ? p.privateAttachments : p.attachments, 'database-rows');
  }

  private attachmentDir(databaseId: string, rowId: string, scope: 'shared' | 'private'): string {
    return path.join(this.attachmentRoot(scope), sanitizeSegment(databaseId), sanitizeSegment(rowId));
  }

  private attachmentIndexPath(databaseId: string, rowId: string, scope: 'shared' | 'private'): string {
    return path.join(this.attachmentDir(databaseId, rowId, scope), 'attachments.json');
  }

  private async readAttachmentIndex(databaseId: string, rowId: string, scope: 'shared' | 'private'): Promise<AttachmentInfo[]> {
    const raw = await fs.readJson(this.attachmentIndexPath(databaseId, rowId, scope)).catch(() => []);
    if (!Array.isArray(raw)) return [];
    const resourceId = `dbrow:${databaseId}:${rowId}`;
    return raw.map((item: any) => ({
      ...item,
      id: String(item?.id || ''),
      pageId: resourceId,
      fileName: String(item?.fileName || ''),
      relativePath: String(item?.relativePath || ''),
      size: Number(item?.size || 0),
      createdAt: String(item?.createdAt || ''),
      createdBy: String(item?.createdBy || ''),
      scope: item?.scope === 'private' ? 'private' : scope,
    })).filter((item: AttachmentInfo) => Boolean(item.id && item.relativePath));
  }

  async listRowAttachments(databaseId: string, rowId: string, scope: 'shared' | 'private' = 'shared'): Promise<AttachmentInfo[]> {
    const preferred = scope === 'private' ? ['private', 'shared'] as const : ['shared'] as const;
    const seen = new Set<string>();
    const result: AttachmentInfo[] = [];
    for (const candidateScope of preferred) {
      const entries = await this.readAttachmentIndex(databaseId, rowId, candidateScope);
      for (const entry of entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        result.push(entry);
      }
    }
    return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async addRowAttachmentFromBase64(databaseId: string, rowId: string, fileName: string, base64: string, scope: 'shared' | 'private' = 'shared'): Promise<AttachmentInfo> {
    const raw = String(base64 || '');
    const clean = sanitizeSegment(path.basename(fileName || 'attachment')) || 'attachment';
    if (!isBase64AttachmentWithinLimit(estimatedBase64DecodedBytes(raw))) throw new Error(base64AttachmentLimitMessage(fileName || clean));
    const data = Buffer.from(raw, 'base64');
    if (!isBase64AttachmentWithinLimit(data.byteLength)) throw new Error(base64AttachmentLimitMessage(fileName || clean));
    const id = `dbatt_${nanoid(12)}`;
    const dir = this.attachmentDir(databaseId, rowId, scope);
    await fs.ensureDir(dir);
    const destination = path.join(dir, `${id}_${clean}`);
    const temporary = `${destination}.${nanoid(6)}.tmp`;
    try {
      await fs.writeFile(temporary, data);
      await fs.move(temporary, destination, { overwrite: false });
    } finally {
      await fs.remove(temporary).catch(() => undefined);
    }
    const info: AttachmentInfo = {
      id,
      pageId: `dbrow:${databaseId}:${rowId}`,
      fileName: fileName || clean,
      relativePath: path.relative(this.attachmentRoot(scope), destination),
      size: data.byteLength,
      createdAt: nowIso(),
      createdBy: this.userLabel(),
      scope,
    };
    const existing = await this.readAttachmentIndex(databaseId, rowId, scope);
    existing.push(info);
    await this.atomicWriteJson(this.attachmentIndexPath(databaseId, rowId, scope), existing);
    return info;
  }

  async getRowAttachmentInfo(databaseId: string, rowId: string, attachmentId: string, scope: 'shared' | 'private' = 'shared'): Promise<AttachmentInfo> {
    const preferred = scope === 'private' ? ['private', 'shared'] as const : ['shared'] as const;
    for (const candidateScope of preferred) {
      const found = (await this.readAttachmentIndex(databaseId, rowId, candidateScope)).find(item => item.id === attachmentId);
      if (found) return found;
    }
    throw new Error('Database row attachment not found');
  }

  async getRowAttachmentFilePath(databaseId: string, rowId: string, attachmentId: string, scope: 'shared' | 'private' = 'shared'): Promise<{ info: AttachmentInfo; filePath: string }> {
    const info = await this.getRowAttachmentInfo(databaseId, rowId, attachmentId, scope);
    const preferred = info.scope === 'private' ? ['private', 'shared'] as const : scope === 'private' ? ['private', 'shared'] as const : ['shared'] as const;
    for (const candidateScope of preferred) {
      const root = path.resolve(this.attachmentRoot(candidateScope));
      const full = path.resolve(root, String(info.relativePath || ''));
      if (!full.startsWith(`${root}${path.sep}`) || !(await fs.pathExists(full))) continue;
      return { info, filePath: full };
    }
    throw new Error('Database row attachment file not found');
  }

  async listExistingRowContents(databaseId: string, scope: 'shared' | 'private' = 'shared'): Promise<DatabaseRowContent[]> {
    const dir = path.join(this.rowContentRoot(scope), sanitizeSegment(databaseId));
    if (!(await fs.pathExists(dir))) return [];
    const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json'));
    const result: DatabaseRowContent[] = [];
    for (const file of files) {
      try { result.push(await fs.readJson(path.join(dir, file)) as DatabaseRowContent); } catch {}
    }
    return result;
  }


  /**
   * Removes every representation of a DB-row child page.
   *
   * A child page is stored in three places: childPageIds, the Markdown body,
   * and a BlockNote inline link block.  Removing only childPageIds made the
   * sidebar disappear while the row body kept a dead link, which is confusing
   * and can be saved back by an already-open editor.
   */
  /**
   * Keeps the generated child-page notation in a DB-row body in sync with the
   * child page metadata.  The sidebar child list already reads the page title
   * from the page bundle, but the row body stores a display label in both its
   * Markdown notation and BlockNote link content.  Update only rows that
   * structurally own the page (childPageIds) so manually-labelled normal links
   * elsewhere are never rewritten.
   */
  async updateChildPageReferenceTitle(
    pageId: string,
    nextTitle: string,
    parent?: { databaseId: string; rowId: string; scope?: 'shared' | 'private' },
  ): Promise<{ updated: number; updatedRows: Array<{ databaseId: string; rowId: string; scope: 'shared' | 'private' }> }> {
    const target = String(pageId || '').trim();
    const title = safeTitle(nextTitle);
    if (!target) return { updated: 0, updatedRows: [] };

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPattern = escapeRegex(target);
    const updateMarkdown = (markdown: unknown) => String(markdown ?? '')
      // Generated child-page notation: @[[title|page-id]]
      .replace(new RegExp(`@\\[\\[[^\\]\\r\\n]*\\|${targetPattern}\\]\\]`, 'g'), `@[[${title}|${target}]]`)
      // Defensive support for a generated Markdown local-page link.
      .replace(new RegExp(`\\[[^\\]]*\\]\\(local-page://${targetPattern}\\)`, 'g'), `[${title}](local-page://${target})`);

    const updateBlockNoteLinkLabel = (value: any): any => {
      if (Array.isArray(value)) return value.map(updateBlockNoteLinkLabel);
      if (!value || typeof value !== 'object') return value;
      const next: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) next[key] = updateBlockNoteLinkLabel(child);
      if (next.href === `local-page://${target}`) {
        next.content = [{ type: 'text', text: title, styles: {} }];
      }
      return next;
    };

    const candidates: Array<{ databaseId: string; rowId: string; scope: 'shared' | 'private' }> = parent
      ? [{ databaseId: parent.databaseId, rowId: parent.rowId, scope: parent.scope === 'private' ? 'private' : 'shared' }]
      : [];
    if (!candidates.length) return { updated: 0, updatedRows: [] };

    let updated = 0;
    const updatedRows: Array<{ databaseId: string; rowId: string; scope: 'shared' | 'private' }> = [];
    for (const candidate of candidates) {
      const file = this.rowContentPath(candidate.databaseId, candidate.rowId, candidate.scope);
      if (!(await fs.pathExists(file))) continue;
      try {
        const content = await fs.readJson(file) as DatabaseRowContent;
        const childIds = Array.isArray(content.childPageIds) ? content.childPageIds.filter(Boolean) : [];
        // parent is supplied only after the page metadata confirmed this row is
        // its owner.  Repair a legacy row that has the generated link but is
        // missing childPageIds while we are synchronising the title.
        const nextChildPageIds = childIds.includes(target) ? childIds : [...childIds, target];
        const markdown = updateMarkdown(content.markdown);
        const blocksuite = updateBlockNoteLinkLabel(content.blocksuite ?? EMPTY_BLOCKSUITE);
        if (
          markdown === String(content.markdown ?? '') &&
          JSON.stringify(blocksuite) === JSON.stringify(content.blocksuite ?? EMPTY_BLOCKSUITE) &&
          nextChildPageIds.length === childIds.length
        ) continue;
        await this.atomicWriteJson(file, {
          ...content,
          markdown,
          blocksuite,
          childPageIds: nextChildPageIds,
          updatedAt: nowIso(),
          updatedBy: this.userLabel(),
        });
        updated += 1;
        updatedRows.push(candidate);
      } catch {
        // Renaming a page must not fail because an optional row-content file is malformed.
      }
    }
    return { updated, updatedRows };
  }

  async removeChildPageReference(pageId: string): Promise<{ updated: number; updatedRows: Array<{ databaseId: string; rowId: string; scope: 'shared' | 'private' }> }> {
    const target = String(pageId || '').trim();
    if (!target) return { updated: 0, updatedRows: [] };

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPattern = escapeRegex(target);
    const removeMarkdownLink = (markdown: unknown) => String(markdown ?? '')
      // Generated child-page notation: @[[title|page-id]]
      .replace(new RegExp(`@\\[\\[[^\\]\\r\\n]*\\|${targetPattern}\\]\\][\\t ]*(?:\\r?\\n)?`, 'g'), '')
      // Defensive cleanup for manually-created local-page Markdown links.
      .replace(new RegExp(`\\[[^\\]]*\\]\\(local-page://${targetPattern}\\)[\\t ]*(?:\\r?\\n)?`, 'g'), '');

    const stripLocalPageLink = (value: any): any => {
      if (Array.isArray(value)) {
        return value
          .map(stripLocalPageLink)
          .filter((entry) => entry !== null && entry !== undefined);
      }
      if (!value || typeof value !== 'object') return value;
      if (value.href === `local-page://${target}`) return null;
      const next: Record<string, any> = {};
      for (const [key, child] of Object.entries(value)) {
        const stripped = stripLocalPageLink(child);
        if (stripped !== null && stripped !== undefined) next[key] = stripped;
      }
      // The generated child-page link is its own paragraph.  Drop that empty
      // paragraph rather than leaving a blank line in the BlockNote document.
      if (Array.isArray(next.content) && next.content.length === 0 && next.type === 'paragraph') return null;
      return next;
    };

    let updated = 0;
    const updatedRows: Array<{ databaseId: string; rowId: string; scope: 'shared' | 'private' }> = [];
    for (const scope of ['shared', 'private'] as const) {
      const root = this.rowContentRoot(scope);
      if (!(await fs.pathExists(root))) continue;
      const databaseDirs = await fs.readdir(root).catch(() => [] as string[]);
      for (const databaseDir of databaseDirs) {
        const dbDir = path.join(root, databaseDir);
        const stat = await fs.stat(dbDir).catch(() => null);
        if (!stat?.isDirectory()) continue;
        const files = (await fs.readdir(dbDir).catch(() => [] as string[])).filter(file => file.endsWith('.json'));
        for (const file of files) {
          const full = path.join(dbDir, file);
          try {
            const content = await fs.readJson(full) as DatabaseRowContent;
            const beforeIds = Array.isArray(content.childPageIds) ? content.childPageIds.filter(Boolean) : [];
            const nextMarkdown = removeMarkdownLink(content.markdown);
            const nextBlocksuite = stripLocalPageLink(content.blocksuite) ?? EMPTY_BLOCKSUITE;
            const changed = beforeIds.includes(target)
              || nextMarkdown !== String(content.markdown ?? '')
              || JSON.stringify(nextBlocksuite) !== JSON.stringify(content.blocksuite ?? EMPTY_BLOCKSUITE);
            if (!changed) continue;
            await this.atomicWriteJson(full, {
              ...content,
              markdown: nextMarkdown,
              blocksuite: nextBlocksuite,
              childPageIds: beforeIds.filter(id => id !== target),
              updatedAt: nowIso(),
              updatedBy: this.userLabel(),
            });
            updated += 1;
            if (content.databaseId && content.rowId) updatedRows.push({ databaseId: content.databaseId, rowId: content.rowId, scope });
          } catch {
            // A malformed optional row-content file must not block page trash.
          }
        }
      }
    }
    return { updated, updatedRows };
  }

  private async writeConflictSnapshot(input: SaveDatabaseRowContentInput, current: DatabaseRowContent, reason: string): Promise<void> {
    const dir = this.conflictDir(input.databaseId, input.rowId);
    await fs.ensureDir(dir);
    await this.atomicWriteJson(path.join(dir, 'incoming-row-content.json'), input);
    await this.atomicWriteJson(path.join(dir, 'current-row-content.json'), current);
    await this.atomicWriteJson(path.join(dir, 'meta.json'), {
      type: 'database-row-content-conflict',
      reason,
      databaseId: input.databaseId,
      rowId: input.rowId,
      createdAt: nowIso(),
      user: this.userLabel(),
      currentUpdatedAt: current.updatedAt,
      baseUpdatedAt: input.baseUpdatedAt ?? null,
    });
  }
}
