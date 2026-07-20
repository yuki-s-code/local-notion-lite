import fs from 'fs-extra';
import { nanoid } from 'nanoid';
import type { PageBundle, PageComment, WorkspaceScope } from '../../../shared/types';

export type CommentServiceDependencies = {
  getPage: (pageId: string) => PageBundle | null;
  pageScope: (pageId: string) => WorkspaceScope;
  commentsPath: (pageId: string, scope: WorkspaceScope) => string;
  userLabel: () => string;
  atomicWriteJson: (file: string, data: unknown) => Promise<void>;
};

/** Page comment persistence, including the v378 private-page migration. */
export class CommentService {
  private writeQueues = new Map<string, Promise<void>>();

  constructor(private readonly deps: CommentServiceDependencies) {}

  private normalize(pageId: string, raw: unknown): PageComment[] {
    const comments = Array.isArray(raw) ? raw : [];
    return comments.map((c: any) => ({
      id: String(c.id || `comment_${nanoid(8)}`),
      pageId,
      blockId: c.blockId ? String(c.blockId) : undefined,
      blockPreview: c.blockPreview ? String(c.blockPreview).slice(0, 180) : undefined,
      body: String(c.body || ''),
      author: String(c.author || c.createdBy || this.deps.userLabel()),
      createdAt: String(c.createdAt || new Date().toISOString()),
      updatedAt: String(c.updatedAt || c.createdAt || new Date().toISOString()),
      resolved: Boolean(c.resolved),
    })).filter((c: PageComment) => c.body.trim());
  }

  private async queue<T>(pageId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(pageId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.writeQueues.set(pageId, tail);
    try {
      return await run;
    } finally {
      if (this.writeQueues.get(pageId) === tail) this.writeQueues.delete(pageId);
    }
  }

  async list(pageId: string): Promise<PageComment[]> {
    const scope = this.deps.pageScope(pageId);
    const primary = this.deps.commentsPath(pageId, scope);
    const raw = await fs.readJson(primary).catch(() => undefined);
    if (raw !== undefined) return this.normalize(pageId, raw);

    if (scope === 'private') {
      const legacy = this.deps.commentsPath(pageId, 'shared');
      const legacyRaw = await fs.readJson(legacy).catch(() => []);
      const migrated = this.normalize(pageId, legacyRaw);
      if (migrated.length > 0) {
        await this.deps.atomicWriteJson(primary, migrated);
        await fs.remove(legacy).catch(() => undefined);
      }
      return migrated;
    }
    return [];
  }

  private async write(pageId: string, comments: PageComment[]): Promise<void> {
    const scope = this.deps.pageScope(pageId);
    const primary = this.deps.commentsPath(pageId, scope);
    await this.deps.atomicWriteJson(primary, comments);
    if (scope === 'private') {
      const legacy = this.deps.commentsPath(pageId, 'shared');
      if (legacy !== primary) await fs.remove(legacy).catch(() => undefined);
    }
  }

  async add(pageId: string, input: string | { body?: string; blockId?: string; blockPreview?: string }): Promise<PageComment[]> {
    return this.queue(pageId, async () => {
      if (!this.deps.getPage(pageId)) throw new Error('Page not found');
      const body = typeof input === 'string' ? input : input?.body;
      const trimmed = String(body || '').trim();
      if (!trimmed) throw new Error('Comment body is empty');
      const now = new Date().toISOString();
      const comments = await this.list(pageId);
      comments.unshift({
        id: `comment_${nanoid(12)}`,
        pageId,
        blockId: typeof input === 'string' ? undefined : (input?.blockId ? String(input.blockId) : undefined),
        blockPreview: typeof input === 'string' ? undefined : (input?.blockPreview ? String(input.blockPreview).slice(0, 180) : undefined),
        body: trimmed,
        author: this.deps.userLabel(),
        createdAt: now,
        updatedAt: now,
        resolved: false,
      });
      await this.write(pageId, comments);
      return comments;
    });
  }

  async update(pageId: string, commentId: string, patch: Partial<Pick<PageComment, 'body' | 'resolved'>>): Promise<PageComment[]> {
    return this.queue(pageId, async () => {
      const comments = await this.list(pageId);
      const now = new Date().toISOString();
      const next = comments.map((comment) => {
        if (comment.id !== commentId) return comment;
        return {
          ...comment,
          body: patch.body !== undefined ? String(patch.body).trim() : comment.body,
          resolved: patch.resolved !== undefined ? Boolean(patch.resolved) : comment.resolved,
          updatedAt: now,
        };
      }).filter((comment) => comment.body.trim());
      await this.write(pageId, next);
      return next;
    });
  }

  async remove(pageId: string, commentId: string): Promise<PageComment[]> {
    return this.queue(pageId, async () => {
      const next = (await this.list(pageId)).filter((comment) => comment.id !== commentId);
      await this.write(pageId, next);
      return next;
    });
  }
}
