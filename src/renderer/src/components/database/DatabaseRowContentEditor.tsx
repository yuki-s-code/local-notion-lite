import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, isApiError } from '../../lib/api';
import type { AttachmentInfo, DatabaseRowContent, DatabaseRowLinkTarget, InboxItem, PageWithLock, ResourceLinkInfo, WorkspaceDatabase } from '../../../../shared/types';
import { BlockNotePageEditor, blockNoteToMarkdown, type BlockNoteDoc } from '../BlockNoteEditor';

const EMPTY_DOC: BlockNoteDoc = [{ type: 'paragraph', content: [] } as any];

function blocksFromContent(content: DatabaseRowContent | null): BlockNoteDoc {
  const raw = content?.blocksuite as any;
  if (raw?.kind === 'blocknote' && Array.isArray(raw.blocks)) return raw.blocks as BlockNoteDoc;
  if (Array.isArray(raw?.blocks)) return raw.blocks as BlockNoteDoc;
  return EMPTY_DOC;
}

function contentSignature(blocks: BlockNoteDoc): string {
  try {
    return JSON.stringify(blocks ?? []);
  } catch {
    return String(Date.now());
  }
}

function resourceKey(ref: ResourceLinkInfo['to']): string {
  if (ref.type === 'page') return `page:${ref.pageId}`;
  if (ref.type === 'database') return `database:${ref.databaseId}`;
  return `dbrow:${ref.databaseId}:${ref.rowId}`;
}

function isOcrCapableAttachment(fileName: string): boolean {
  return /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(fileName || ''));
}

function attachmentIcon(fileName: string): string {
  if (/\.pdf$/i.test(fileName)) return '📕';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(fileName)) return '🖼️';
  return '📎';
}

function formatAttachmentSize(size: number): string {
  const value = Number(size || 0);
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function uniqueResourceLinks(links: ResourceLinkInfo[], direction: 'outbound' | 'backlink'): ResourceLinkInfo[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const endpoint = resourceKey(direction === 'outbound' ? link.to : link.from);
    if (seen.has(endpoint)) return false;
    seen.add(endpoint);
    return true;
  });
}

type Props = {
  api?: ApiClient | null;
  database: WorkspaceDatabase;
  rowId: string;
  title: string;
  editing: boolean;
  pages: PageWithLock[];
  allDatabases: WorkspaceDatabase[];
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenPage?: (pageId: string) => void;
  onChildPageCreated?: () => void;
};

export function DatabaseRowContentEditor({ api, database, rowId, title, editing, pages, allDatabases, onOpenDatabase, onOpenDatabaseRow, onOpenPage, onChildPageCreated }: Props) {
  const [content, setContent] = useState<DatabaseRowContent | null>(null);
  const [blocks, setBlocks] = useState<BlockNoteDoc>(EMPTY_DOC);
  const [status, setStatus] = useState<'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [linksInfo, setLinksInfo] = useState<{ childPages: PageWithLock[]; outboundLinks: ResourceLinkInfo[]; backlinks: ResourceLinkInfo[] }>({ childPages: [], outboundLinks: [], backlinks: [] });
  const [editorVersion, setEditorVersion] = useState(0);
  const [showChildForm, setShowChildForm] = useState(false);
  const [childTitleDraft, setChildTitleDraft] = useState('');
  const [creatingChild, setCreatingChild] = useState(false);
  const [rowAttachments, setRowAttachments] = useState<AttachmentInfo[]>([]);
  const [ocrItems, setOcrItems] = useState<InboxItem[]>([]);
  const [ocrBusyAttachmentId, setOcrBusyAttachmentId] = useState('');
  const baseUpdatedAtRef = useRef<string | undefined>(undefined);
  const lastSavedSignatureRef = useRef<string>('');
  const suppressNextChangeRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const pendingBlocksRef = useRef<BlockNoteDoc | null>(null);
  const mountedRef = useRef(true);

  const scope = database.scope === 'private' ? 'private' : 'shared';
  const editorKey = `${database.id}:${rowId}:${editorVersion}`;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!api || !rowId) return;
    let cancelled = false;
    setStatus('loading');
    setMessage('本文を読み込み中...');
    pendingBlocksRef.current = null;
    savingRef.current = false;
    api.getDatabaseRowContent(database.id, rowId, { title, scope })
      .then(next => {
        if (cancelled || !mountedRef.current) return;
        const nextBlocks = blocksFromContent(next);
        setContent(next);
        setBlocks(nextBlocks);
        suppressNextChangeRef.current = true;
        setEditorVersion(version => version + 1);
        baseUpdatedAtRef.current = next.updatedAt;
        lastSavedSignatureRef.current = contentSignature(nextBlocks);
        setStatus('idle');
        setMessage('');
        refreshLinks();
        void refreshAttachments();
      })
      .catch(error => {
        if (cancelled || !mountedRef.current) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : '本文の読み込みに失敗しました。');
      });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      pendingBlocksRef.current = null;
    };
  }, [api, database.id, rowId, scope, title]);

  const databaseRowTargets = useMemo<DatabaseRowLinkTarget[]>(() => {
    return allDatabases.flatMap(db => db.rows.map(row => {
      const preferred = db.properties.find(prop => /^(title|name|名前|件名|項目)$/i.test(prop.name)) || db.properties.find(prop => prop.type === 'text') || db.properties[0];
      const raw = preferred ? row.cells[preferred.id] : '';
      const rowTitle = Array.isArray(raw) ? raw.join(', ') : raw == null || raw === '' ? row.id : String(raw);
      return { type: 'database-row' as const, databaseId: db.id, databaseTitle: db.title, rowId: row.id, rowTitle };
    }));
  }, [allDatabases]);

  async function refreshAttachments() {
    if (!api) return;
    try {
      const [attachments, inbox] = await Promise.all([
        api.listDatabaseRowAttachments(database.id, rowId, scope),
        api.listInboxItems(),
      ]);
      if (!mountedRef.current) return;
      setRowAttachments(attachments);
      setOcrItems(inbox);
    } catch {
      // Attachment/OCR state is supplemental. Keep the editor usable on a transient share error.
    }
  }

  async function sendAttachmentToOcrCenter(attachment: AttachmentInfo) {
    if (!api || ocrBusyAttachmentId) return;
    try {
      setOcrBusyAttachmentId(attachment.id);
      const item = await api.sendAttachmentToOcrCenter({
        sourceType: 'database-row',
        attachmentId: attachment.id,
        databaseId: database.id,
        rowId,
        scope,
        sourceTitle: `${database.title} › ${title || '無題の行'}`,
      });
      setOcrItems(await api.listInboxItems().catch(() => []));
      setMessage('OCRセンターに登録しました');
      window.dispatchEvent(new CustomEvent('local-notion:open-ocr-center', {
        detail: { inboxId: item.id, attachmentId: item.attachments?.[0]?.id || '' },
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'OCRセンターへの登録に失敗しました。');
    } finally {
      if (mountedRef.current) setOcrBusyAttachmentId('');
    }
  }

  async function refreshLinks() {
    if (!api) return;
    try {
      const next = await api.listDatabaseRowLinks(database.id, rowId, { scope });
      if (!mountedRef.current) return;
      setLinksInfo({
        childPages: Array.from(new Map((next.childPages || []).map(page => [page.id, page])).values()),
        outboundLinks: uniqueResourceLinks(next.outboundLinks || [], 'outbound'),
        backlinks: uniqueResourceLinks(next.backlinks || [], 'backlink'),
      });
    } catch {
      // Keep the last successful link state during transient shared-folder/API errors.
    }
  }

  useEffect(() => {
    function handleChildPageMutated(event: Event) {
      const detail = (event as CustomEvent<{ databaseId?: string; rowId?: string; pageId?: string; action?: string; title?: string }>).detail || {};
      if (detail.databaseId && detail.databaseId !== database.id) return;
      if (detail.rowId && detail.rowId !== rowId) return;
      const shouldRemove = detail.action === 'trashed' || detail.action === 'deleted' || detail.action === 'removed';
      if (detail.pageId && shouldRemove) {
        const removedPageId = detail.pageId;
        setLinksInfo(prev => ({
          ...prev,
          childPages: (prev.childPages || []).filter(page => page.id !== removedPageId),
        }));
        setContent(prev => {
          if (!prev) return prev;
          const wasChild = (prev.childPageIds || []).includes(removedPageId);
          // The server removes the matching Markdown and BlockNote link too.
          // Reload only when this row referenced the page and the editor is not
          // carrying unsaved local changes, so an unrelated page trash never
          // overwrites the user's current draft.
          if (wasChild && status !== 'dirty' && status !== 'saving' && api) {
            void api.getDatabaseRowContent(database.id, rowId, { title, scope }).then(next => {
              if (!mountedRef.current) return;
              const nextBlocks = blocksFromContent(next);
              setContent(next);
              setBlocks(nextBlocks);
              suppressNextChangeRef.current = true;
              setEditorVersion(version => version + 1);
              baseUpdatedAtRef.current = next.updatedAt;
              lastSavedSignatureRef.current = contentSignature(nextBlocks);
            }).catch(() => undefined);
          }
          return { ...prev, childPageIds: (prev.childPageIds || []).filter(id => id !== removedPageId) };
        });
      } else if (detail.pageId && detail.title) {
        setLinksInfo(prev => ({
          ...prev,
          childPages: (prev.childPages || []).map(page => page.id === detail.pageId ? { ...page, title: detail.title || page.title } : page),
        }));
        // The server rewrites generated child-page labels in Markdown and
        // BlockNote after a rename.  Reflect that change immediately when this
        // row editor is clean; never replace an unsaved local draft.
        if (detail.action === 'renamed' && status !== 'dirty' && status !== 'saving' && api) {
          setContent(prev => {
            const isChild = Boolean(prev?.childPageIds?.includes(detail.pageId!));
            if (isChild) {
              void api.getDatabaseRowContent(database.id, rowId, { title, scope }).then(next => {
                if (!mountedRef.current) return;
                const nextBlocks = blocksFromContent(next);
                setContent(next);
                setBlocks(nextBlocks);
                suppressNextChangeRef.current = true;
                setEditorVersion(version => version + 1);
                baseUpdatedAtRef.current = next.updatedAt;
                lastSavedSignatureRef.current = contentSignature(nextBlocks);
                refreshLinks();
              }).catch(() => undefined);
            }
            return prev;
          });
        }
      }
      refreshLinks();
    }
    window.addEventListener('local-notion:database-row-child-page-removed', handleChildPageMutated as EventListener);
    window.addEventListener('local-notion:page-tree-mutated', handleChildPageMutated as EventListener);
    return () => {
      window.removeEventListener('local-notion:database-row-child-page-removed', handleChildPageMutated as EventListener);
      window.removeEventListener('local-notion:page-tree-mutated', handleChildPageMutated as EventListener);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database.id, rowId, api, scope, status, title]);

  const statusLabel = useMemo(() => {
    if (!api) return 'API未接続';
    if (status === 'loading') return '読み込み中';
    if (status === 'dirty') return '未保存';
    if (status === 'saving') return '保存中';
    if (status === 'saved') return '保存済み';
    if (status === 'conflict') return '競合あり';
    if (status === 'error') return 'エラー';
    return editing ? '編集可能' : '読み取り専用';
  }, [api, status, editing]);

  async function save(nextBlocks: BlockNoteDoc) {
    if (!api) return;
    const signature = contentSignature(nextBlocks);
    if (signature === lastSavedSignatureRef.current) return;

    // V257: serialize autosaves. Without this, BlockNote can emit another change while a
    // previous PUT is still in flight. The second request then uses an old baseUpdatedAt and
    // the server correctly reports a conflict, even though it was caused by this same window.
    if (savingRef.current) {
      pendingBlocksRef.current = nextBlocks;
      setStatus('dirty');
      return;
    }

    savingRef.current = true;
    setStatus('saving');
    setMessage('');
    try {
      const saved = await api.saveDatabaseRowContent({
        databaseId: database.id,
        rowId,
        title,
        markdown: blockNoteToMarkdown(nextBlocks),
        blocksuite: { version: 1, kind: 'blocknote', blocks: nextBlocks },
        baseUpdatedAt: baseUpdatedAtRef.current,
        scope,
      });
      if (!mountedRef.current) return;
      setContent(saved);
      baseUpdatedAtRef.current = saved.updatedAt;
      lastSavedSignatureRef.current = signature;
      setStatus('saved');
      setMessage('');
      refreshLinks();
      try {
        window.dispatchEvent(new CustomEvent('local-notion:database-row-content-links-updated', {
          detail: { databaseId: database.id, rowId, title },
        }));
        // DB行本文もページ本文と同じSemantic差分更新経路へ流す。
        // 保存同期とEmbeddingを分離し、編集操作を待たせない。
        window.dispatchEvent(new CustomEvent('local-notion:semantic-refresh-request', {
          detail: { targetKey: `database_row:${database.id}:${rowId}`, preferredChunkId: `database_row:${database.id}:${rowId}` },
        }));
      } catch {}
    } catch (error) {
      if (!mountedRef.current) return;
      if (isApiError(error) && error.code === 'DATABASE_ROW_CONTENT_CONFLICT') {
        setStatus('conflict');
        setMessage('本文の競合を検出しました。保存済み本文を再読み込みしてから編集してください。');
      } else {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : '本文の保存に失敗しました。');
      }
    } finally {
      savingRef.current = false;
      const pending = pendingBlocksRef.current;
      pendingBlocksRef.current = null;
      if (pending && mountedRef.current && contentSignature(pending) !== lastSavedSignatureRef.current) {
        window.setTimeout(() => save(pending), 0);
      }
    }
  }

  async function createChildPage(options: { title?: string; open?: boolean } = {}) {
    if (!api || creatingChild) return null;
    const normalizedTitle = (options.title || childTitleDraft || `${title || '無題の行'} の子ページ`).trim();
    if (!normalizedTitle) return null;
    setCreatingChild(true);
    try {
      const created = await api.createDatabaseRowChildPage(database.id, rowId, { title: normalizedTitle, scope });
      const next = await api.getDatabaseRowContent(database.id, rowId, { title, scope });
      const nextBlocks = blocksFromContent(next);
      setContent(next);
      setBlocks(nextBlocks);
      suppressNextChangeRef.current = true;
      setEditorVersion(version => version + 1);
      baseUpdatedAtRef.current = next.updatedAt;
      lastSavedSignatureRef.current = contentSignature(nextBlocks);
      setChildTitleDraft('');
      setShowChildForm(false);
      await refreshLinks();
      try {
        window.dispatchEvent(new CustomEvent('local-notion:database-row-child-page-created', {
          detail: { databaseId: database.id, rowId, pageId: created.meta.id },
        }));
      } catch {}
      onChildPageCreated?.();
      if (options.open !== false) onOpenPage?.(created.meta.id);
      return { ...created.meta, lock: null, isLocked: false } as PageWithLock;
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '子ページの作成に失敗しました。');
      return null;
    } finally {
      setCreatingChild(false);
    }
  }

  async function deleteChildPage(page: PageWithLock) {
    if (!api || !editing) return;
    if (!confirm(`子ページ「${page.title || '無題'}」をゴミ箱に移動しますか？`)) return;
    try {
      const result = await api.deleteDatabaseRowChildPage(database.id, rowId, page.id, { trashPage: true });
      setLinksInfo(result.links);
      setContent(prev => prev ? { ...prev, childPageIds: (prev.childPageIds || []).filter(id => id !== page.id), updatedAt: new Date().toISOString() } : prev);
      try {
        window.dispatchEvent(new CustomEvent('local-notion:database-row-child-page-removed', { detail: { databaseId: database.id, rowId, pageId: page.id, action: 'removed' } }));
        window.dispatchEvent(new CustomEvent('local-notion:page-tree-mutated', { detail: { pageId: page.id, action: 'trashed' } }));
      } catch {}
      onChildPageCreated?.();
      setStatus('saved');
      setMessage('子ページをゴミ箱に移動しました。');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '子ページの削除に失敗しました。');
    }
  }

  function handleChange(nextBlocks: BlockNoteDoc) {
    setBlocks(nextBlocks);
    const signature = contentSignature(nextBlocks);
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      lastSavedSignatureRef.current = signature;
      return;
    }
    if (signature === lastSavedSignatureRef.current) return;
    if (!editing || !api) return;
    setStatus('dirty');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => save(nextBlocks), 1000);
  }

  if (status === 'loading' && !content) {
    return (
      <section className="db-row-content-editor-v255 state-loading">
        <div className="db-row-content-head-v255"><div><strong>本文</strong><small>このデータベース行専用のメモ・詳細ページ</small></div><span>読み込み中</span></div>
        <p className="db-row-content-empty-v255">本文を読み込んでいます...</p>
      </section>
    );
  }

  if (!api) {
    return (
      <section className="db-row-content-editor-v255">
        <div className="db-row-content-head-v255"><strong>本文</strong><span>API未接続</span></div>
        <p className="db-row-content-empty-v255">本文エディターを使用するにはローカルAPI接続が必要です。</p>
      </section>
    );
  }

  return (
    <section className={`db-row-content-editor-v255 state-${status}`}>
      <div className="db-row-content-head-v255 db-row-content-head-v263">
        <div><strong>本文</strong><small>このデータベース行専用のメモ・詳細ページ</small></div>
        <span>{statusLabel}</span>
      </div>
      {message ? <div className="db-row-content-message-v255">{message}</div> : null}
      <div className="db-row-content-body-v255">
        <BlockNotePageEditor
          key={editorKey}
          pageId={`dbrow:${database.id}:${rowId}`}
          initialContent={blocks}
          editing={editing && status !== 'conflict'}
          pages={pages}
          databases={allDatabases.length ? allDatabases : [database]}
          databaseRowLinks={databaseRowTargets}
          aiClient={api}
          aiPageTitle={title}
          onChange={handleChange}
          onOpenPage={onOpenPage}
          onPreviewPage={onOpenPage}
          onOpenDatabase={onOpenDatabase}
          onOpenDatabaseRow={onOpenDatabaseRow}
          attachmentApiBaseUrl={api.getBaseUrl()}
          onUploadFile={async (file) => {
            const url = await api.uploadDatabaseRowAttachmentFile(database.id, rowId, file, scope);
            void refreshAttachments();
            return url;
          }}
          onCreateChildPage={async () => await createChildPage({ open: false })}
          previewMode={false}
        />
      </div>
      <div className="db-row-resource-panel-v262 db-row-resource-panel-v263">
        <div className="db-row-resource-head-v262 db-row-resource-head-v263">
          <div><strong>リンク・子ページ</strong><small>この行の本文リンクと子ページを整理します</small></div>
          <button type="button" className="secondary" onClick={() => { setShowChildForm(value => !value); setChildTitleDraft(current => current || `${title || '無題の行'} の子ページ`); }} disabled={!editing || !api || creatingChild}>＋ 子ページ</button>
        </div>
        {showChildForm ? (
          <form className="db-row-child-form-v263" onSubmit={event => { event.preventDefault(); void createChildPage({ title: childTitleDraft }); }}>
            <input autoFocus value={childTitleDraft} onChange={event => setChildTitleDraft(event.target.value)} placeholder="子ページ名" disabled={creatingChild} />
            <button type="submit" disabled={!childTitleDraft.trim() || creatingChild}>{creatingChild ? '作成中...' : '作成'}</button>
            <button type="button" className="secondary" onClick={() => setShowChildForm(false)} disabled={creatingChild}>キャンセル</button>
          </form>
        ) : null}
        <div className="db-row-resource-grid-v262 db-row-resource-grid-v263">
          <div><small>子ページ</small>{linksInfo.childPages.length === 0 ? <em>なし</em> : linksInfo.childPages.map(page => <span className="db-row-child-page-chip-v269" key={page.id}><button type="button" onClick={() => onOpenPage?.(page.id)}>📄 {page.title}</button>{editing ? <button type="button" className="db-row-child-page-delete-v269" title="子ページをゴミ箱へ" onClick={() => deleteChildPage(page)}>×</button> : null}</span>)}</div>
          <div><small>この本文からのリンク</small>{linksInfo.outboundLinks.length === 0 ? <em>なし</em> : linksInfo.outboundLinks.map((link, index) => <button type="button" key={`${link.updatedAt}:${index}`} onClick={() => link.to.type === 'page' ? onOpenPage?.(link.to.pageId) : link.to.type === 'database-row' ? onOpenDatabaseRow?.(link.to.databaseId, link.to.rowId) : undefined}>{link.to.type === 'database-row' ? '🧾' : '📄'} {link.targetTitle}</button>)}</div>
          <div><small>この行へのリンク元</small>{linksInfo.backlinks.length === 0 ? <em>なし</em> : linksInfo.backlinks.map((link, index) => <button type="button" key={`${link.updatedAt}:back:${index}`} onClick={() => link.from.type === 'page' ? onOpenPage?.(link.from.pageId) : link.from.type === 'database-row' ? onOpenDatabaseRow?.(link.from.databaseId, link.from.rowId) : undefined}>{link.sourceIcon || '↩'} {link.sourceTitle}</button>)}</div>
        </div>
        <div className="db-row-attachment-panel-v571">
          <div className="db-row-attachment-head-v571"><div><strong>添付ファイル</strong><small>OCRはOCRセンターで一元管理します</small></div><span>{rowAttachments.length}件</span></div>
          {rowAttachments.length === 0 ? <p className="db-row-attachment-empty-v571">本文に追加した添付ファイルはここに表示されます。</p> : (
            <div className="db-row-attachment-list-v571">
              {rowAttachments.map((attachment) => {
                const ocrItem = ocrItems.find((candidate) => candidate.ocrSource?.sourceType === 'database-row' && candidate.ocrSource?.databaseId === database.id && candidate.ocrSource?.rowId === rowId && candidate.ocrSource?.attachmentId === attachment.id && candidate.ocrSource?.scope === scope);
                const ocrFile = ocrItem?.attachments?.[0];
                const ocrReady = ocrFile?.ocr?.status === 'ready' || ocrFile?.pdfText?.status === 'ready';
                const ocrActive = ['queued', 'running', 'cancelling'].includes(String(ocrFile?.ocrQueue?.status || ''));
                const ocrFailed = ['failed', 'cancelled'].includes(String(ocrFile?.ocrQueue?.status || '')) || ocrFile?.ocr?.status === 'failed' || ocrFile?.pdfText?.status === 'failed';
                return <article key={attachment.id} className="db-row-attachment-card-v571"><a href={api.databaseRowAttachmentPrettyFileUrl(database.id, rowId, attachment.id, attachment.fileName, scope)} target="_blank" rel="noreferrer"><span>{attachmentIcon(attachment.fileName)}</span><b>{attachment.fileName}</b><small>{formatAttachmentSize(attachment.size)}</small></a>{isOcrCapableAttachment(attachment.fileName) ? <button type="button" className={`db-row-attachment-ocr-v571 ${ocrReady ? 'is-ready' : ocrActive ? 'is-active' : ocrFailed ? 'is-failed' : ''}`} disabled={Boolean(ocrBusyAttachmentId)} onClick={() => void sendAttachmentToOcrCenter(attachment)}>{ocrReady ? '結果' : ocrActive ? '処理中' : ocrFailed ? '再試行' : ocrBusyAttachmentId === attachment.id ? '登録中…' : 'OCR'}</button> : null}</article>;
              })}
            </div>
          )}
        </div>
      </div>
      {status === 'conflict' ? <button type="button" className="secondary" onClick={() => api.getDatabaseRowContent(database.id, rowId, { title, scope }).then(next => { const nextBlocks = blocksFromContent(next); setContent(next); setBlocks(nextBlocks); suppressNextChangeRef.current = true; setEditorVersion(version => version + 1); baseUpdatedAtRef.current = next.updatedAt; lastSavedSignatureRef.current = contentSignature(nextBlocks); setStatus('idle'); setMessage(''); })}>本文を再読み込み</button> : null}
    </section>
  );
}
