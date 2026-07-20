export type PageCommitMarker = {
  version: 1;
  state?: 'writing';
  pageId?: string;
  revision?: string;
  startedAt?: string;
  committedAt?: string;
  files?: string[];
};

export type PageCommitMeta = { id?: string; updatedAt?: string } | null | undefined;

export function isCommittedPageMarker(
  marker: unknown,
  meta: PageCommitMeta,
  expectedPageId?: string,
): boolean {
  if (!marker || typeof marker !== 'object') return false;
  const commit = marker as PageCommitMarker;
  if (commit.version !== 1 || commit.state === 'writing' || !commit.revision) return false;
  if (expectedPageId && commit.pageId && commit.pageId !== expectedPageId) return false;
  return Boolean(meta?.id && meta.updatedAt && meta.updatedAt === commit.revision);
}

export function createWritingPageCommit(pageId: string, revision: string, startedAt: string): PageCommitMarker {
  return { version: 1, state: 'writing', pageId, revision, startedAt };
}

export function createCommittedPageCommit(pageId: string, revision: string, committedAt: string): PageCommitMarker {
  return {
    version: 1,
    pageId,
    revision,
    committedAt,
    files: ['meta.json', 'content.md', 'blocksuite.json'],
  };
}
