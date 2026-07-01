import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { openLocalDb } from './db/sqlite';
import { resolveLocalDbPath, setPrivateVaultPathOverrides } from './utils/paths';
import { VaultService } from './services/vaultService';
import { getTransformerRuntimeInfo } from './services/transformerSemanticRetrieval';
import { parseBody, parseItemsBody, parseQuery, Schemas } from './utils/validation';
import type { DatabasePropertyType, WorkspaceDatabase } from '../shared/types';
import type { AnalysisCell, AnalysisNotebook, AnalysisParameter } from '../shared/analysisTypes';

export type ServerHandle = {
  port: number;
  url: string;
  /** Ephemeral token used only by the Electron renderer for localhost API calls. */
  apiToken: string;
  close: () => Promise<void>;
};

export async function startLocalApi(sharedRoot: string, customLocalDbPath?: string, privatePathOptions?: { privatePagesRoot?: string; privateDatabasesRoot?: string }): Promise<ServerHandle> {
  process.env.SMART_ASSIST_SHARED_ROOT = sharedRoot;
  setPrivateVaultPathOverrides(privatePathOptions ?? {});
  const localDbPath = resolveLocalDbPath(sharedRoot, customLocalDbPath);
  const db = openLocalDb(localDbPath);
  const vault = new VaultService(db, sharedRoot, nanoid(10), localDbPath);
  // The API only listens on loopback, but a per-launch token prevents unrelated local web pages
  // from calling workspace endpoints through the browser. The token is never written to disk.
  const apiToken = nanoid(32);
  await vault.initVault();
  // The renderer owns the deferred, idle-time startup import. Starting another
  // import timer here used to race Electron's first paint and duplicate the same
  // shared-folder work through a second startup path.

  const app = express();
  app.use(cors({
    origin(origin, callback) {
      // Electron production windows usually have a null/file origin. Vite is allowed in development.
      const allowed = !origin || origin === 'null' || /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
      callback(allowed ? null : new Error('Local API origin is not allowed'), allowed);
    }
  }));
  // Base64 uploads are capped at 15 MiB before decoding; retain headroom for JSON fields.
  app.use(express.json({ limit: '24mb' }));
  app.use((req, res, next) => {
    // File downloads are opened by Electron's download manager, which cannot attach custom headers.
    // Attachment IDs are opaque; all mutating and workspace-data endpoints still require the token.
    const isAttachmentDownload = /\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(req.path)
      || /\/attachments\/[^/]+\/name\//.test(req.path)
      || /\/inbox\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(req.path)
      || /\/journals\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(req.path)
      || /\/journals\/[^/]+\/attachments\/[^/]+\/name\//.test(req.path);
    if (isAttachmentDownload || req.get('x-local-notion-token') === apiToken) return next();
    return res.status(403).json({ message: 'Local API token is required', code: 'LOCAL_API_TOKEN_REQUIRED' });
  });

  app.get('/health', (_, res) => {
    const normalizedSharedRoot = path.resolve(sharedRoot);
    const normalizedDbPath = path.resolve(localDbPath);
    const location = normalizedDbPath.startsWith(path.join(normalizedSharedRoot, 'local-cache'))
      ? 'sharedCache'
      : normalizedDbPath.includes(`${path.sep}Documents${path.sep}`)
        ? 'documents'
        : normalizedDbPath.includes(`${path.sep}Temp${path.sep}`) || normalizedDbPath.includes(`${path.sep}tmp${path.sep}`)
          ? 'temp'
          : normalizedDbPath.includes(`${path.sep}AppData${path.sep}`) || normalizedDbPath.includes(`${path.sep}Application Support${path.sep}`)
            ? 'appData'
            : 'other';

    res.json({
      ok: true,
      sharedRoot,
      localDbPath,
      privateStorage: {
        pagesRoot: privatePathOptions?.privatePagesRoot || null,
        databasesRoot: privatePathOptions?.privateDatabasesRoot || null,
        customPages: Boolean(privatePathOptions?.privatePagesRoot),
        customDatabases: Boolean(privatePathOptions?.privateDatabasesRoot)
      },
      sync: vault.getSharedImportStatus(),
      sqlite: {
        available: true,
        path: localDbPath,
        fileName: path.basename(localDbPath),
        custom: Boolean(customLocalDbPath),
        location
      }
    });
  });

  app.get('/sync/status', async (_, res) => {
    res.json(vault.getSharedImportStatus());
  });

  app.post('/sync/import', async (_, res, next) => {
    try { res.json({ ok: true, sync: await vault.runImportFromShared('manual-sync') }); } catch (e) { next(e); }
  });


  app.get('/trash', async (_, res, next) => {
    try { res.json(await vault.listTrash()); } catch (e) { next(e); }
  });
  app.post('/trash/:id/restore', async (req, res, next) => {
    try { res.json(await vault.restoreTrashedPage(req.params.id)); } catch (e) { next(e); }
  });
  app.delete('/trash/:id/permanent', async (req, res, next) => {
    try { res.json(await vault.deletePagePermanently(req.params.id)); } catch (e) { next(e); }
  });
  app.delete('/trash', async (_, res, next) => {
    try { res.json(await vault.emptyTrash()); } catch (e) { next(e); }
  });

  app.get('/workspace/tag-aliases', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceTagAliases()); } catch (e) { next(e); }
  });
  app.put('/workspace/tag-aliases', async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.workspaceTagAliases);
      res.json(await vault.updateWorkspaceTagAliases(body));
    } catch (e) { next(e); }
  });

  app.get('/workspace/tag-presentation', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceTagPresentation()); } catch (e) { next(e); }
  });
  app.put('/workspace/tag-presentation', async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.workspaceTagPresentation);
      res.json(await vault.updateWorkspaceTagPresentation(body));
    } catch (e) { next(e); }
  });

  app.get('/pages', async (_, res, next) => {
    try { res.json(await vault.listPages()); } catch (e) { next(e); }
  });
  app.get('/pages/tree', async (_, res, next) => {
    try { res.json(await vault.listPageTree()); } catch (e) { next(e); }
  });
  app.get('/pages/search', async (req, res, next) => {
    try { res.json(await vault.search(String(req.query.q ?? ''))); } catch (e) { next(e); }
  });
  app.get('/locks', async (_, res, next) => {
    try { res.json(await vault.listLocks()); } catch (e) { next(e); }
  });
  app.get('/pages/:id', (req, res) => {
    const page = vault.getPage(req.params.id);
    if (!page) return res.status(404).json({ message: 'Page not found' });
    res.json(page);
  });
  app.get('/pages/:id/sidebar-counts', async (req, res, next) => {
    try { res.json(await vault.getPageSidebarCounts(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/pages/:id/comments', async (req, res, next) => {
    try { res.json(await vault.listPageComments(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/pages/:id/activity', async (req, res, next) => {
    try { res.json(await vault.listPageActivity(req.params.id)); } catch (e) { next(e); }
  });
  app.post('/pages/:id/comments', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.pageCommentCreate); res.json(await vault.addPageComment(req.params.id, { body: body.body, blockId: body.blockId, blockPreview: body.blockPreview })); } catch (e) { next(e); }
  });
  app.patch('/pages/:id/comments/:commentId', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.pageCommentUpdate); res.json(await vault.updatePageComment(req.params.id, req.params.commentId, { body: body.body, resolved: body.resolved })); } catch (e) { next(e); }
  });
  app.delete('/pages/:id/comments/:commentId', async (req, res, next) => {
    try { res.json(await vault.deletePageComment(req.params.id, req.params.commentId)); } catch (e) { next(e); }
  });
  app.post('/pages', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.createPage); res.json(await vault.createPage(body.title, body.parentId ?? null, body.scope === 'private' ? 'private' : 'shared')); } catch (e) { next(e); }
  });
  app.post('/pages/:id/duplicate', async (req, res, next) => {
    try { res.json(await vault.duplicatePage(req.params.id)); } catch (e) { next(e); }
  });
  app.patch('/pages/:id/move', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.pageMove); res.json(await vault.movePage(req.params.id, body.parentId ?? null)); } catch (e) { next(e); }
  });
  app.patch('/pages/:id/order', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.pageOrder); res.json(await vault.updatePageOrder(req.params.id, body.sortOrder)); } catch (e) { next(e); }
  });
  app.post('/pages/:id/favorite', async (req, res, next) => {
    try { res.json(await vault.toggleFavorite(req.params.id)); } catch (e) { next(e); }
  });
  app.delete('/pages/:id', async (req, res, next) => {
    try { res.json(await vault.trashPage(req.params.id)); } catch (e) { next(e); }
  });
  app.put('/pages/:id', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.savePage); res.json(await vault.savePage({ id: req.params.id, title: body.title, markdown: body.markdown ?? '', blocksuite: body.blocksuite ?? {}, baseUpdatedAt: body.baseUpdatedAt, properties: body.properties, icon: body.icon, scope: body.scope === 'private' ? 'private' : body.scope === 'shared' ? 'shared' : undefined, historyReason: body.historyReason })); } catch (e) { next(e); }
  });
  app.post('/pages/:id/lock', async (req, res) => {
    try {
      const lock = await vault.acquireLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      // Lock acquisition is not a fatal page-open error.
      // Return 200 with editable=false so the renderer can open the page in read-only mode
      // without showing browser 400 errors or blanking the editor.
      res.json({ ok: false, editable: false, lock: await vault.getLock(req.params.id).catch(() => null), reason: e?.message ?? 'Lock unavailable' });
    }
  });
  app.post('/pages/:id/lock/renew', async (req, res) => {
    try {
      const lock = await vault.renewLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({ ok: false, editable: false, lock: await vault.getLock(req.params.id).catch(() => null), reason: e?.message ?? 'Lock unavailable' });
    }
  });
  app.delete('/pages/:id/lock', async (req, res, next) => {
    try { await vault.releaseLock(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
  });
  app.get('/pages/:id/attachments', async (req, res, next) => {
    try { res.json(await vault.listAttachments(req.params.id)); } catch (e) { next(e); }
  });
  app.post('/pages/:id/attachments', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.sourcePathAttachment); res.json(await vault.addAttachment(req.params.id, body.sourcePath)); } catch (e) { next(e); }
  });
  app.post('/pages/:id/attachments/upload', async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.base64Attachment);
      res.json(await vault.addAttachmentFromBase64(req.params.id, body.fileName, body.base64));
    } catch (e) { next(e); }
  });

  app.get('/pages/:id/attachments/:attachmentId/name/:fileName', async (req, res, next) => {
    try {
      const attachment = await vault.getAttachmentInfo(req.params.id, req.params.attachmentId);
      const filePath = await vault.getAttachmentFilePath(req.params.id, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || req.params.fileName || 'attachment').replace(/'/g, '%27');
      const disposition = String(req.query.download ?? '') === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });

  app.get('/pages/:id/attachments/:attachmentId/file', async (req, res, next) => {
    try {
      const attachment = await vault.getAttachmentInfo(req.params.id, req.params.attachmentId);
      const filePath = await vault.getAttachmentFilePath(req.params.id, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      if (String(req.query.download ?? '') === '1') {
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      } else {
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
      }
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });

  app.get('/pages/:id/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const attachment = await vault.getAttachmentInfo(req.params.id, req.params.attachmentId);
      const filePath = await vault.getAttachmentFilePath(req.params.id, req.params.attachmentId);
      // Do not delegate filename encoding to res.download(). Electron's Chromium
      // download path is more reliable when the UTF-8 filename is explicit.
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });
  app.get('/pages/:id/backlinks', async (req, res, next) => {
    try { res.json(await vault.listBacklinks(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/pages/:id/history', async (req, res, next) => {
    try { res.json(await vault.listHistory(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/pages/:id/history/:historyId', async (req, res, next) => {
    try { res.json(await vault.getHistoryBundle(req.params.id, req.params.historyId)); } catch (e) { next(e); }
  });
  app.get('/pages/:id/history/:historyId/diff', async (req, res, next) => {
    try { res.json(await vault.diffHistory(req.params.id, req.params.historyId)); } catch (e) { next(e); }
  });
  app.post('/pages/:id/history/:historyId/restore', async (req, res, next) => {
    try { res.json(await vault.restoreHistory(req.params.id, req.params.historyId)); } catch (e) { next(e); }
  });
  app.get('/wiki/updates', async (req, res, next) => {
    try { res.json(await vault.listWikiUpdateDigests(Number(req.query.limit) || 12)); } catch (e) { next(e); }
  });



  app.get('/tasks', async (_req, res, next) => {
    try { res.json(await vault.listTasks()); } catch (e) { next(e); }
  });
  app.patch('/tasks/:taskId', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.taskPatch); res.json(await vault.updateTask(decodeURIComponent(req.params.taskId), body)); } catch (e) { next(e); }
  });

  app.get('/inbox', async (_req, res, next) => {
    try { res.json(await vault.listInboxItems()); } catch (e) { next(e); }
  });
  app.post('/inbox', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.inboxCreate); res.json(await vault.createInboxItem({ title: body.title, text: body.text, source: (['manual', 'drop', 'web'].includes(body.source) ? body.source : 'quick') as any })); } catch (e) { next(e); }
  });
  app.patch('/inbox/:id', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.inboxPatch); res.json(await vault.updateInboxItem(req.params.id, body)); } catch (e) { next(e); }
  });
  app.delete('/inbox/:id', async (req, res, next) => {
    try { res.json(await vault.deleteInboxItem(req.params.id)); } catch (e) { next(e); }
  });
  app.post('/ocr-center/import-attachment', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body as any : {};
      const sourceType = ["page", "journal", "database-row"].includes(String(body.sourceType))
        ? String(body.sourceType) as "page" | "journal" | "database-row"
        : null;
      if (!sourceType || typeof body.attachmentId !== 'string' || !body.attachmentId) {
        throw new Error('OCR送信元の情報が不足しています');
      }
      res.json(await vault.sendAttachmentToOcrCenter({
        sourceType,
        attachmentId: body.attachmentId,
        pageId: typeof body.pageId === 'string' ? body.pageId : undefined,
        date: typeof body.date === 'string' ? body.date : undefined,
        databaseId: typeof body.databaseId === 'string' ? body.databaseId : undefined,
        rowId: typeof body.rowId === 'string' ? body.rowId : undefined,
        scope: body.scope === 'private' ? 'private' : 'shared',
        sourceTitle: typeof body.sourceTitle === 'string' ? body.sourceTitle : undefined,
      }));
    } catch (e) { next(e); }
  });

  app.post('/inbox/:id/attachments/upload', async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.base64Attachment);
      res.json(await vault.addInboxAttachmentFromBase64(req.params.id, body.fileName, body.base64, String((req.body as any)?.mimeType || '')));
    } catch (e) { next(e); }
  });
  app.get('/inbox/:id/attachments/:attachmentId/file', async (req, res, next) => {
    try {
      const { attachment, filePath } = await vault.getInboxAttachmentFile(req.params.id, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });
  app.get('/inbox/:id/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const { attachment, filePath } = await vault.getInboxAttachmentFile(req.params.id, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });
  app.post('/inbox/:id/attachments/:attachmentId/ocr', async (req, res, next) => {
    // Compatibility endpoint: queue the work rather than bypassing shared-folder OCR ownership.
    try { const body = parseBody(req, Schemas.inboxOcr); res.json(await vault.recognizeInboxAttachment(req.params.id, req.params.attachmentId, body)); } catch (e) { next(e); }
  });
  app.post('/inbox/:id/attachments/:attachmentId/ocr/queue', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.inboxOcr); res.json(await vault.enqueueInboxAttachmentOcr(req.params.id, req.params.attachmentId, body)); } catch (e) { next(e); }
  });
  app.post('/inbox/:id/attachments/:attachmentId/ocr/cancel', async (req, res, next) => {
    try { res.json(await vault.cancelInboxAttachmentOcrQueue(req.params.id, req.params.attachmentId)); } catch (e) { next(e); }
  });
  app.post('/inbox/:id/attachments/:attachmentId/ocr/retry', async (req, res, next) => {
    try { res.json(await vault.retryInboxAttachmentOcrQueue(req.params.id, req.params.attachmentId)); } catch (e) { next(e); }
  });


  app.post('/smart-assist/chat/ask', async (req, res) => {
    try {
      const response = await vault.askSmartAssist(parseBody(req, Schemas.smartAsk));
      // v208: UI safety net. The chat UI expects an `answer` string.
      // Even if an internal ranking/embedding path returns a partial object,
      // normalize it here so the user never sees a blank assistant response.
      if (!response || typeof response.answer !== 'string' || !response.answer.trim()) {
        res.json({
          answer: '回答を生成できませんでした。FAQ候補は取得できている可能性があります。再インデックス後、もう一度質問してください。',
          confidence: 0,
          confidenceLabel: '低',
          uxLevel: 'low',
          intent: 'None',
          followUpQuestions: ['FAQ JSONの取込状態を確認してください。', '検索・意味ベクトル再生成を実行してください。'],
          categoryOptions: [],
          sources: [],
          mode: 'chat-route-empty-answer-safeguard-v208',
        });
        return;
      }
      res.json(response);
    } catch (e: any) {
      res.json({
        answer: `回答生成中にエラーが発生しました。検索インデックスまたは意味ベクトルを再生成してください。詳細: ${String(e?.message || e).slice(0, 240)}`,
        confidence: 0,
        confidenceLabel: '低',
        uxLevel: 'low',
        intent: 'None',
        followUpQuestions: ['検索・意味ベクトル再生成を実行してください。', 'FAQ JSONの形式を確認してください。'],
        categoryOptions: [],
        sources: [],
        mode: 'chat-route-error-safeguard-v208',
      });
    }
  });

  app.get('/smart-assist/faqs', async (_req, res, next) => {
    try { res.json(await vault.listSmartFaqRecords()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/faqs/query', async (req, res) => {
    try {
      const query = parseQuery(req, Schemas.smartFaqQuery);
      res.json(await vault.querySmartFaqRecords(query));
    } catch (e: any) {
      res.json({
        items: [],
        total: 0,
        limit: Math.max(1, Math.min(200, Number(req.query.limit || 50))),
        offset: Math.max(0, Number(req.query.offset || 0)),
        mode: 'safe-empty-faq-query-v209',
        indexedCount: 0,
        faqCount: 0,
        warning: String(e?.message || e).slice(0, 240),
      });
    }
  });
  app.get('/smart-assist/faqs/search-stats', async (_req, res) => {
    try { res.json(await vault.getSmartFaqSearchStats()); } catch (e: any) {
      res.json({
        mode: 'safe-search-stats-v209',
        faqCount: 0,
        indexedCount: 0,
        approvedCount: 0,
        reviewedCount: 0,
        needsReindex: true,
        warning: String(e?.message || e).slice(0, 240),
        features: [],
      });
    }
  });
  app.get('/smart-assist/search-index', async (_req, res, next) => {
    try { res.json(await vault.getSmartAssistSearchIndexInfo()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/semantic-index', async (_req, res, next) => {
    try { res.json(await vault.getSmartAssistSemanticIndexInfo()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/semantic-cache', async (_req, res, next) => {
    try { res.json(await vault.getSmartAssistSemanticCacheInfo()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/cache-topology', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceCacheTopology()); } catch (e) { next(e); }
  });
  app.post('/smart-assist/semantic-cache/clear-query', async (_req, res, next) => {
    try { res.json(await vault.clearSmartAssistQueryCache()); } catch (e) { next(e); }
  });

  app.get('/smart-assist/generation-settings', async (_req, res) => {
    try { res.json({ ok: true, settings: await vault.getSmartAssistGenerationSettings() }); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/generation-settings', async (req, res, next) => {
    try { res.json({ ok: true, settings: await vault.updateSmartAssistGenerationSettings(Object.fromEntries(Object.entries(parseBody(req, Schemas.generationSettings)).filter(([, value]) => value !== null)) as any) }); } catch (e) { next(e); }
  });
  app.get('/smart-assist/generation-check', async (_req, res) => {
    try { res.json(await vault.checkSmartAssistGenerationEngine()); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/generation-test', async (_req, res) => {
    try { res.json(await vault.testSmartAssistGenerationEngine()); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.get('/smart-assist/generation-server/status', async (_req, res) => {
    try { res.json(await vault.getSmartAssistGenerationServerStatus()); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/generation-server/start', async (req, res) => {
    try { res.json(await vault.startSmartAssistGenerationServer(req.body || {})); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/generation-server/stop', async (_req, res) => {
    try { res.json(await vault.stopSmartAssistGenerationServer()); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.get('/smart-assist/transformer-settings', async (_req, res) => {
    try { res.json({ ok: true, settings: await vault.getSmartAssistTransformerSettings() }); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/transformer-settings', async (req, res, next) => {
    try { res.json({ ok: true, settings: await vault.updateSmartAssistTransformerSettings(Object.fromEntries(Object.entries(parseBody(req, Schemas.transformerSettings)).filter(([, value]) => value !== null)) as any) }); } catch (e) { next(e); }
  });
  app.get('/smart-assist/transformer-model-check', async (_req, res) => {
    try { res.json(await vault.checkSmartAssistTransformerModel()); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.post('/smart-assist/transformer-model-download', async (req, res) => {
    try { res.json(await vault.downloadSmartAssistTransformerModel(Object.fromEntries(Object.entries(parseBody(req, Schemas.transformerDownload)).filter(([, value]) => value !== null)) as any)); } catch (e: any) { res.status(500).json({ ok: false, error: String(e?.message || e) }); }
  });
  app.get('/smart-assist/transformer-runtime', async (_req, res) => {
    res.json(getTransformerRuntimeInfo());
  });
  app.post('/smart-assist/faqs/reindex', async (_req, res, next) => {
    try { res.json(await vault.rebuildSmartFaqIndex()); } catch (e) { next(e); }
  });
  app.post('/smart-assist/nlp/retrain', async (_req, res, next) => {
    try { res.json(await vault.retrainSmartAssistNlp()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/chat/logs', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistChatLogs()); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/chat/logs', async (_req, res, next) => {
    try { res.json(await vault.clearSmartAssistChatLogs()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/chat/low-confidence', async (_req, res, next) => {
    try { res.json(await vault.listLowConfidenceSmartAssistLogs()); } catch (e) { next(e); }
  });
  app.post('/smart-assist/faq/test', async (req, res, next) => {
    try { res.json(await vault.testSmartFaqRecord(parseBody(req, Schemas.smartFaqRecord) as any)); } catch (e) { next(e); }
  });
  app.get('/smart-assist/synonyms', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistSynonyms()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/synonyms', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistSynonyms(parseItemsBody(req, Schemas.smartSynonym))); } catch (e) { next(e); }
  });
  app.post('/smart-assist/synonyms', async (req, res, next) => {
    try { res.json(await vault.upsertSmartAssistSynonym(parseBody(req, Schemas.smartSynonym))); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/synonyms/:id', async (req, res, next) => {
    try { res.json(await vault.deleteSmartAssistSynonym(decodeURIComponent(req.params.id), req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined)); } catch (e) { next(e); }
  });
  app.get('/smart-assist/rule-profiles', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistRuleProfiles()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/rule-profiles', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistRuleProfiles(parseItemsBody(req, Schemas.smartRuleProfile))); } catch (e) { next(e); }
  });
  app.post('/smart-assist/rule-profiles', async (req, res, next) => {
    try { res.json(await vault.upsertSmartAssistRuleProfile(parseBody(req, Schemas.smartRuleProfile))); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/rule-profiles/:id', async (req, res, next) => {
    try { res.json(await vault.deleteSmartAssistRuleProfile(decodeURIComponent(req.params.id), req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined)); } catch (e) { next(e); }
  });
  app.put('/smart-assist/faqs', async (req, res, next) => {
    try { res.json(await vault.saveSmartFaqRecords(parseItemsBody(req, Schemas.smartFaqRecord))); } catch (e) { next(e); }
  });
  app.post('/smart-assist/faqs', async (req, res, next) => {
    try { res.json(await vault.upsertSmartFaqRecord(parseBody(req, Schemas.smartFaqRecord))); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/faqs/:id', async (req, res, next) => {
    try { res.json(await vault.deleteSmartFaqRecord(decodeURIComponent(req.params.id), req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined)); } catch (e) { next(e); }
  });


  app.get('/smart-assist/improvement-queue', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistImprovementQueue()); } catch (e) { next(e); }
  });
  app.post('/smart-assist/improvement-queue', async (req, res, next) => {
    try { res.json(await vault.addSmartAssistImprovementQueue(parseBody(req, Schemas.smartGenericObject))); } catch (e) { next(e); }
  });
  app.put('/smart-assist/improvement-queue/:id', async (req, res, next) => {
    try { res.json(await vault.updateSmartAssistImprovementQueue(decodeURIComponent(req.params.id), parseBody(req, Schemas.smartGenericObject))); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/improvement-queue/:id', async (req, res, next) => {
    try { res.json(await vault.deleteSmartAssistImprovementQueue(decodeURIComponent(req.params.id), req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined)); } catch (e) { next(e); }
  });
  app.post('/smart-assist/faqs/improve-draft', async (req, res, next) => {
    try { res.json(await vault.generateSmartFaqImprovementDraft(parseBody(req, Schemas.smartGenericObject) as any)); } catch (e) { next(e); }
  });
  app.get('/smart-assist/evaluation-set', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistEvaluationSet()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/evaluation-set', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistEvaluationSet(parseItemsBody(req, Schemas.smartEvaluationItem))); } catch (e) { next(e); }
  });
  app.post('/smart-assist/evaluation-set', async (req, res, next) => {
    try { res.json(await vault.upsertSmartAssistEvaluationEntry(parseBody(req, Schemas.smartEvaluationItem))); } catch (e) { next(e); }
  });
  app.delete('/smart-assist/evaluation-set/:id', async (req, res, next) => {
    try { res.json(await vault.deleteSmartAssistEvaluationEntry(decodeURIComponent(req.params.id), req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined)); } catch (e) { next(e); }
  });
  app.post('/smart-assist/evaluation-set/run', async (_req, res, next) => {
    try { res.json(await vault.runSmartAssistEvaluationSet()); } catch (e) { next(e); }
  });
  app.get('/smart-assist/evaluation-reports', async (req, res, next) => {
    try { res.json(await vault.listSmartAssistEvaluationReports(req.query.limit ? Number(req.query.limit) : undefined)); } catch (e) { next(e); }
  });
  app.get('/smart-assist/query-normalization', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistQueryNormalizationRules()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/query-normalization', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistQueryNormalizationRules(parseBody(req, Schemas.smartGenericObject))); } catch (e) { next(e); }
  });
  app.get('/smart-assist/fallback-contacts', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistFallbackContacts()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/fallback-contacts', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistFallbackContacts(parseBody(req, Schemas.smartGenericObject))); } catch (e) { next(e); }
  });

  app.get('/smart-assist/feedback', async (_req, res, next) => {
    try { res.json(await vault.listSmartAssistFeedback()); } catch (e) { next(e); }
  });
  app.put('/smart-assist/feedback', async (req, res, next) => {
    try { res.json(await vault.saveSmartAssistFeedback(parseItemsBody(req, Schemas.smartFeedback))); } catch (e) { next(e); }
  });
  app.post('/smart-assist/feedback', async (req, res, next) => {
    try { res.json(await vault.addSmartAssistFeedback(parseBody(req, Schemas.smartFeedback))); } catch (e) { next(e); }
  });

  app.get('/journals', async (req, res, next) => {
    try { res.json(await vault.listJournals(req.query.month ? String(req.query.month) : undefined)); } catch (e) { next(e); }
  });
  app.get('/journals/search', async (req, res, next) => {
    try { res.json(await vault.searchJournals(String(req.query.q || ''), req.query.limit ? Number(req.query.limit) : 30)); } catch (e) { next(e); }
  });
  app.get('/journals/:date', async (req, res, next) => {
    try { res.json(await vault.getJournal(req.params.date)); } catch (e) { next(e); }
  });
  app.put('/journals/:date', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.journalSave); res.json(await vault.saveJournal({ ...body, date: req.params.date })); } catch (e) { next(e); }
  });
  app.delete('/journals/:date', async (req, res, next) => {
    try { res.json(await vault.deleteJournal(req.params.date)); } catch (e) { next(e); }
  });
  app.get('/journals/:date/attachments', async (req, res, next) => {
    try { res.json(await vault.listJournalAttachments(req.params.date)); } catch (e) { next(e); }
  });
  app.post('/journals/:date/attachments', async (req, res, next) => {
    try {
      const sourcePath = typeof req.body?.sourcePath === 'string' ? req.body.sourcePath : '';
      res.json(await vault.addJournalAttachment(req.params.date, sourcePath));
    } catch (e) { next(e); }
  });
  app.post('/journals/:date/attachments/upload', async (req, res, next) => {
    try {
      const raw = req.body && typeof req.body === 'object' ? req.body : {};
      const fileName = typeof raw.fileName === 'string' ? raw.fileName : 'attachment';
      const base64 = typeof raw.base64 === 'string' ? raw.base64 : '';
      res.json(await vault.addJournalAttachmentFromBase64(req.params.date, fileName, base64));
    } catch (e) { next(e); }
  });
  app.get('/journals/:date/attachments/:attachmentId/name/:fileName', async (req, res, next) => {
    try {
      const { attachment, filePath } = await vault.getJournalAttachmentFile(req.params.date, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || req.params.fileName || 'attachment').replace(/'/g, '%27');
      const disposition = String(req.query.download ?? '') === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });
  app.get('/journals/:date/attachments/:attachmentId/file', async (req, res, next) => {
    try {
      const { attachment, filePath } = await vault.getJournalAttachmentFile(req.params.date, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      if (String(req.query.download ?? '') === '1') res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });
  app.get('/journals/:date/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const { attachment, filePath } = await vault.getJournalAttachmentFile(req.params.date, req.params.attachmentId);
      const fileName = encodeURIComponent(attachment.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.sendFile(filePath);
    } catch (e) { next(e); }
  });

  app.get('/databases', async (_, res, next) => {
    try { res.json(await vault.listDatabases()); } catch (e) { next(e); }
  });
  app.post('/databases', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.createDatabase); res.json(await vault.createDatabase(body.title, body.scope === 'private' ? 'private' : 'shared')); } catch (e) { next(e); }
  });
  app.get('/databases/:id/query', async (req, res, next) => {
    try {
      const query = parseQuery(req, Schemas.databaseQuery);
      res.json(await vault.queryDatabaseRows(req.params.id, query));
    } catch (e) { next(e); }
  });
  app.post('/databases/:id/aggregates', async (req, res, next) => {
    try {
      const body: any = parseBody(req, Schemas.databaseAggregates);
      res.json(await vault.aggregateDatabaseRows(req.params.id, body));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/performance', async (req, res, next) => {
    try { res.json(await vault.getDatabasePerformance(req.params.id)); } catch (e) { next(e); }
  });
  app.post('/databases/:id/reindex', async (req, res, next) => {
    try { res.json(await vault.rebuildDatabaseIndex(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/databases/:id', async (req, res, next) => {
    try {
      const database = await vault.getDatabase(req.params.id);
      if (!database) return res.status(404).json({ message: 'Database not found' });
      res.json(database);
    } catch (e) { next(e); }
  });
  // Lock contention is an expected editor state, not a transport/API failure.
  // Keep it 200 like the page lock route so the renderer can show the concrete
  // reason without a noisy browser 409 resource error.
  app.post('/databases/:id/lock', async (req, res) => {
    try {
      const lock = await vault.acquireDatabaseLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({ ok: false, editable: false, lock: await vault.getDatabaseLock(req.params.id).catch(() => null), reason: e?.message || 'Database locked' });
    }
  });
  app.post('/databases/:id/lock/renew', async (req, res) => {
    try {
      const lock = await vault.renewDatabaseLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({ ok: false, editable: false, lock: await vault.getDatabaseLock(req.params.id).catch(() => null), reason: e?.message || 'Database locked' });
    }
  });
  app.delete('/databases/:id/lock', async (req, res, next) => {
    try { await vault.releaseDatabaseLock(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
  });
  app.put('/databases/:id', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.saveDatabase); res.json(await vault.saveDatabase({ ...body, id: req.params.id } as WorkspaceDatabase)); } catch (e) { next(e); }
  });
  app.delete('/databases/:id', async (req, res, next) => {
    try { res.json(await vault.deleteDatabase(req.params.id)); } catch (e) { next(e); }
  });
  app.get('/databases-trash', async (_req, res, next) => {
    try { res.json(await vault.listTrashedDatabases()); } catch (e) { next(e); }
  });
  app.post('/databases-trash/:id/restore', async (req, res, next) => {
    try { res.json(await vault.restoreTrashedDatabase(req.params.id)); } catch (e) { next(e); }
  });
  app.delete('/databases-trash/:id', async (req, res, next) => {
    try { res.json(await vault.deleteTrashedDatabasePermanently(req.params.id)); } catch (e) { next(e); }
  });
  app.delete('/databases-trash', async (_req, res, next) => {
    try { res.json(await vault.emptyTrashedDatabases()); } catch (e) { next(e); }
  });
  app.patch('/databases/:id/rows', async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.patchDatabaseRows);
      res.json(await vault.patchDatabaseRows(req.params.id, body));
    } catch (e) { next(e); }
  });

  app.post('/databases/:id/rows', async (req, res, next) => {
    try { res.json(await vault.addDatabaseRow(req.params.id)); } catch (e) { next(e); }
  });

  app.get('/databases/:id/sidebar-rows', async (req, res, next) => {
    try {
      res.json(await vault.listDatabaseSidebarRows(req.params.id, {
        limit: req.query.limit ? Number(req.query.limit) : 30,
        offset: req.query.offset ? Number(req.query.offset) : 0,
      }));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/rows/:rowId/sidebar-children', async (req, res, next) => {
    try {
      res.json(await vault.listDatabaseRowSidebarChildren(req.params.id, req.params.rowId));
    } catch (e) { next(e); }
  });

  app.get('/workspace/database-child-pages', async (_req, res, next) => {
    try {
      res.json(await vault.listWorkspaceDatabaseChildPages());
    } catch (e) { next(e); }
  });

  app.get('/databases/:id/rows/:rowId/attachments', async (req, res, next) => {
    try {
      res.json(await vault.listDatabaseRowAttachments(req.params.id, req.params.rowId, req.query.scope === 'private' ? 'private' : 'shared'));
    } catch (e) { next(e); }
  });
  app.post('/databases/:id/rows/:rowId/attachments/upload', async (req, res, next) => {
    try {
      const raw = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      const fileName = typeof raw.fileName === 'string' ? raw.fileName : 'attachment';
      const base64 = typeof raw.base64 === 'string' ? raw.base64 : '';
      if (!base64) {
        const error: any = new Error('base64 is required');
        error.statusCode = 400;
        throw error;
      }
      res.json(await vault.addDatabaseRowAttachmentFromBase64(req.params.id, req.params.rowId, fileName, base64, raw.scope === 'private' ? 'private' : 'shared'));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/rows/:rowId/attachments/:attachmentId/name/:fileName', async (req, res, next) => {
    try {
      const { info, filePath } = await vault.getDatabaseRowAttachmentFile(req.params.id, req.params.rowId, req.params.attachmentId, req.query.scope === 'private' ? 'private' : 'shared');
      const fileName = encodeURIComponent(info.fileName || req.params.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${fileName}`);
      res.sendFile(path.resolve(filePath));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/rows/:rowId/attachments/:attachmentId/file', async (req, res, next) => {
    try {
      const { info, filePath } = await vault.getDatabaseRowAttachmentFile(req.params.id, req.params.rowId, req.params.attachmentId, req.query.scope === 'private' ? 'private' : 'shared');
      const fileName = encodeURIComponent(info.fileName || 'attachment').replace(/'/g, '%27');
      const disposition = String(req.query.download ?? '') === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${fileName}`);
      res.sendFile(path.resolve(filePath));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/rows/:rowId/attachments/:attachmentId/download', async (req, res, next) => {
    try {
      const { info, filePath } = await vault.getDatabaseRowAttachmentFile(req.params.id, req.params.rowId, req.params.attachmentId, req.query.scope === 'private' ? 'private' : 'shared');
      const fileName = encodeURIComponent(info.fileName || 'attachment').replace(/'/g, '%27');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
      res.sendFile(path.resolve(filePath));
    } catch (e) { next(e); }
  });

  app.get('/databases/:id/rows/:rowId/content', async (req, res, next) => {
    try {
      res.json(await vault.getDatabaseRowContent(req.params.id, req.params.rowId, {
        title: req.query.title ? String(req.query.title) : undefined,
        scope: req.query.scope === 'private' ? 'private' : 'shared',
      }));
    } catch (e) { next(e); }
  });
  app.get('/databases/:id/rows/:rowId/links', async (req, res, next) => {
    try {
      res.json(await vault.listDatabaseRowLinks(req.params.id, req.params.rowId, {
        scope: req.query.scope === 'private' ? 'private' : 'shared',
      }));
    } catch (e) { next(e); }
  });

  app.delete('/databases/:id/rows/:rowId/child-pages/:pageId', async (req, res, next) => {
    try {
      res.json(await vault.deleteDatabaseRowChildPage(req.params.id, req.params.rowId, req.params.pageId, {
        trashPage: req.query.trashPage === 'false' ? false : true,
      }));
    } catch (e) {
      // V271: deleting a DB-row child page is a cleanup operation from multiple UI surfaces.
      // Even if the sidebar has stale IDs, the route should not break the app with 400.
      // Return a successful no-op so the client can refresh and remove stale rows.
      res.json({
        ok: true,
        databaseId: req.params.id,
        rowId: req.params.rowId,
        pageId: req.params.pageId,
        trashed: req.query.trashPage === 'false' ? false : true,
        links: { childPages: [], outboundLinks: [], backlinks: [] },
        warning: e instanceof Error ? e.message : 'Child page delete cleanup completed with warning',
      });
    }
  });

  app.post('/databases/:id/rows/:rowId/child-pages', async (req, res, next) => {
    try {
      const raw = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      res.json(await vault.createDatabaseRowChildPage(req.params.id, req.params.rowId, {
        title: typeof raw.title === 'string' ? raw.title : undefined,
        scope: raw.scope === 'private' ? 'private' : 'shared',
      }));
    } catch (e) { next(e); }
  });
  app.put('/databases/:id/rows/:rowId/content', async (req, res, next) => {
    try {
      // V256: BlockNote can emit a richer payload than the strict zod schema originally expected.
      // Normalize this endpoint defensively so row-content autosave never fails with a generic 400
      // just because optional editor metadata has an unexpected shape.
      const raw = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
      const scope = raw.scope === 'private' ? 'private' : 'shared';
      const baseUpdatedAt = typeof raw.baseUpdatedAt === 'string' && raw.baseUpdatedAt.trim() ? raw.baseUpdatedAt : undefined;
      const markdown = typeof raw.markdown === 'string' ? raw.markdown : String(raw.markdown ?? '');
      const title = typeof raw.title === 'string' ? raw.title : raw.title == null ? undefined : String(raw.title);
      if (markdown.length > 10_000_000) {
        const error: any = new Error('markdown is too long');
        error.statusCode = 400;
        throw error;
      }
      res.json(await vault.saveDatabaseRowContent({
        databaseId: req.params.id,
        rowId: req.params.rowId,
        title,
        markdown,
        blocksuite: raw.blocksuite,
        baseUpdatedAt,
        scope,
        childPageIds: Array.isArray(raw.childPageIds) ? raw.childPageIds.filter(item => typeof item === 'string') as string[] : undefined,
      }));
    } catch (e) { next(e); }
  });
  app.post('/databases/:id/properties', async (req, res, next) => {
    try { const body = parseBody(req, Schemas.addDatabaseProperty); res.json(await vault.addDatabaseProperty(req.params.id, body.name, body.type as DatabasePropertyType)); } catch (e) { next(e); }
  });



  app.get('/semantic/index', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticIndexInfo()); } catch (e) { next(e); }
  });
  app.get('/semantic/index-revision', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticIndexRevision()); } catch (e) { next(e); }
  });
  app.get('/semantic/recovery-backups', async (_req, res, next) => {
    try { res.json(await vault.listWorkspaceRecoveryBackups()); } catch (e) { next(e); }
  });
  app.post('/semantic/recovery-backups', async (req, res, next) => {
    try { res.json(await vault.createWorkspaceRecoveryBackup(String((req.body || {}).reason || 'manual'))); } catch (e) { next(e); }
  });
  app.post('/semantic/cache-reset', async (_req, res, next) => {
    try { res.json(await vault.resetWorkspaceSemanticLocalCache()); } catch (e) { next(e); }
  });
  app.post('/semantic/cache-maintenance', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(await vault.maintainWorkspaceSemanticCache({ vacuum: body.vacuum === true }));
    } catch (e) { next(e); }
  });
  app.get('/semantic/rebuild-job', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticRebuildJob()); } catch (e) { next(e); }
  });
  app.post('/semantic/rebuild-job', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(await vault.startWorkspaceSemanticRebuildJob({ mode: body.mode === 'diff' ? 'diff' : 'full', maxNewEmbeddings: body.maxNewEmbeddings !== undefined ? Number(body.maxNewEmbeddings) : undefined }));
    } catch (e) { next(e); }
  });
  app.post('/semantic/rebuild-job/control', async (req, res, next) => {
    try {
      const action = String((req.body || {}).action || '');
      if (!['pause', 'resume', 'cancel'].includes(action)) throw new Error('invalid semantic rebuild action');
      res.json(await vault.controlWorkspaceSemanticRebuildJob(action as 'pause' | 'resume' | 'cancel'));
    } catch (e) { next(e); }
  });
  app.post('/semantic/reindex', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(await vault.rebuildWorkspaceSemanticIndex({
        mode: body.mode === 'diff' ? 'diff' : 'full',
        maxNewEmbeddings: body.maxNewEmbeddings !== undefined ? Number(body.maxNewEmbeddings) : undefined,
      }));
    } catch (e) { next(e); }
  });
  app.post('/semantic/diff-update', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      const preferredChunkIds = Array.isArray(body.preferredChunkIds)
        ? body.preferredChunkIds.map(String).filter(Boolean).slice(0, 100)
        : [];
      res.json(await vault.diffUpdateWorkspaceSemanticIndex(
        body.limit !== undefined ? Number(body.limit) : 20,
        { preferredChunkIds, background: body.background === true },
      ));
    } catch (e) { next(e); }
  });
  app.post('/semantic/reindex-source', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(await vault.reindexWorkspaceSemanticSource(String(body.sourceId || ''), body.type ? String(body.type) : undefined));
    } catch (e) { next(e); }
  });
  // Editing has higher priority than low-priority semantic maintenance.
  app.post('/semantic/editor-activity', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(vault.noteSemanticEditorActivity(body.holdMs !== undefined ? Number(body.holdMs) : 10_000));
    } catch (e) { next(e); }
  });
  app.get('/semantic/history', async (req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticUpdateHistory(req.query.limit ? Number(req.query.limit) : 20)); } catch (e) { next(e); }
  });

  app.post('/semantic/chat-answer', async (req, res, next) => {
    try { res.json(await vault.generateWorkspaceAiChatAnswer(parseBody(req, Schemas.smartGenericObject) as any)); } catch (e) { next(e); }
  });

  // NDJSON stream: emits model deltas immediately in llama-server resident mode.
  // One-shot llama-completion remains compatible and emits only the final event.
  app.post('/semantic/chat-answer/stream', async (req, res, next) => {
    const write = (event: any) => { if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
    try {
      const body = parseBody(req, Schemas.smartGenericObject) as any;
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      write({ type: 'status', stage: 'retrieving' });
      const result = await vault.generateWorkspaceAiChatAnswer(body, (delta) => write({ type: 'delta', delta }));
      write({ type: 'final', data: result });
      res.end();
    } catch (e: any) {
      if (res.headersSent) { write({ type: 'error', message: e?.message || 'AIストリームに失敗しました。' }); res.end(); }
      else next(e);
    }
  });

  // Editor AI is deliberately separate from Smart Assist. It never performs
  // semantic/FTS retrieval and never returns related-source explanations.
  app.post('/editor-ai/edit', async (req, res, next) => {
    try { res.json(await vault.generateEditorAiEdit(parseBody(req, Schemas.smartGenericObject) as any)); } catch (e) { next(e); }
  });

  app.get('/semantic/search', async (req, res, next) => {
    try {
      const types = typeof req.query.types === 'string'
        ? String(req.query.types).split(',').map((item) => item.trim()).filter(Boolean)
        : undefined;
      res.json(await vault.searchWorkspaceSemantic(String(req.query.q || ''), {
        limit: req.query.limit ? Number(req.query.limit) : 20,
        types,
      }));
    } catch (e) { next(e); }
  });
  // Draft related search is intentionally read-only: it never writes the semantic
  // index and is used only for lightweight suggestions while a page is being edited.
  app.post('/semantic/related/draft', async (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body as any : {};
      res.json(await vault.getWorkspaceSemanticRelatedDraft({
        pageId: String(body.pageId || ''),
        title: String(body.title || ''),
        text: String(body.text || ''),
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        limit: body.limit !== undefined ? Number(body.limit) : 5,
      }));
    } catch (e) { next(e); }
  });
  app.get('/semantic/related/page/:id', async (req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticRelated({ type: 'page', id: req.params.id, limit: req.query.limit ? Number(req.query.limit) : 32 })); } catch (e) { next(e); }
  });
  app.get('/semantic/related/faq/:id', async (req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticRelated({ type: 'faq', id: req.params.id, limit: req.query.limit ? Number(req.query.limit) : 32 })); } catch (e) { next(e); }
  });
  app.get('/semantic/related/journal/:date', async (req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticRelated({ type: 'journal', id: req.params.date, limit: req.query.limit ? Number(req.query.limit) : 32 })); } catch (e) { next(e); }
  });
  app.get('/semantic/related/database/:databaseId/row/:rowId', async (req, res, next) => {
    try { res.json(await vault.getWorkspaceSemanticRelated({ type: 'database_row', databaseId: req.params.databaseId, id: req.params.rowId, limit: req.query.limit ? Number(req.query.limit) : 32 })); } catch (e) { next(e); }
  });

  app.get('/analysis/status', async (_req, res, next) => {
    try { res.json(await vault.getAnalysisStatus()); } catch (e) { next(e); }
  });
  app.post('/analysis/sync', async (_req, res, next) => {
    try { res.json(await vault.syncAnalysisData()); } catch (e) { next(e); }
  });
  app.post('/analysis/query', async (req, res, next) => {
    try { res.json(await vault.queryAnalysis(String(req.body?.sql || ''), Array.isArray(req.body?.parameters) ? req.body.parameters as AnalysisParameter[] : [], Array.isArray(req.body?.namedResults) ? req.body.namedResults : [])); } catch (e) { next(e); }
  });
  app.get('/analysis/results/:resultId', async (req, res, next) => {
    try { res.json(vault.getAnalysisResultPage(req.params.resultId, Number(req.query.page || 0), Number(req.query.pageSize || 500))); } catch (e) { next(e); }
  });
  app.get('/analysis/results/:resultId/all', async (req, res, next) => {
    try { res.json(vault.getAnalysisResultAll(req.params.resultId)); } catch (e) { next(e); }
  });
  app.post('/analysis/ai-draft', async (req, res, next) => {
    try { res.json(await vault.generateAnalysisAiDraft(parseBody(req, Schemas.smartGenericObject) as any)); } catch (e) { next(e); }
  });
  app.get('/analysis/data-dictionary', async (_req, res, next) => {
    try { res.json(vault.getAnalysisDataDictionary()); } catch (e) { next(e); }
  });
  app.get('/analysis/settings', async (_req, res, next) => {
    try { res.json(vault.getAnalysisWorkspaceSettings()); } catch (e) { next(e); }
  });
  app.put('/analysis/settings', async (req, res, next) => {
    try { res.json(vault.saveAnalysisWorkspaceSettings(req.body || {})); } catch (e) { next(e); }
  });
  app.get('/analysis/notebooks', async (_req, res, next) => {
    try { res.json(vault.listAnalysisNotebooks()); } catch (e) { next(e); }
  });
  app.get('/analysis/notebooks/:id', async (req, res, next) => {
    try {
      const notebook = vault.getAnalysisNotebook(req.params.id);
      if (!notebook) return res.status(404).json({ message: 'Analysis notebook not found' });
      res.json(notebook);
    } catch (e) { next(e); }
  });
  app.put('/analysis/notebooks/:id', async (req, res, next) => {
    try {
      const body = req.body || {};
      const notebook: AnalysisNotebook = {
        id: req.params.id,
        title: String(body.title || '無題の分析'),
        description: String(body.description || ''),
        sql: String(body.sql || ''),
        chart: body.chart && typeof body.chart === 'object' ? body.chart : { type: 'table' },
        cells: Array.isArray(body.cells) ? body.cells as AnalysisCell[] : undefined,
        executionHistory: body.executionHistory && typeof body.executionHistory === 'object' ? body.executionHistory : undefined,
        snapshots: body.snapshots && typeof body.snapshots === 'object' ? body.snapshots : undefined,
        createdAt: String(body.createdAt || ''),
        updatedAt: String(body.updatedAt || ''),
      };
      res.json(vault.saveAnalysisNotebook(notebook));
    } catch (e) { next(e); }
  });
  app.delete('/analysis/notebooks/:id', async (req, res, next) => {
    try { res.json(vault.deleteAnalysisNotebook(req.params.id)); } catch (e) { next(e); }
  });

  app.get('/analysis/dashboard', async (_req, res, next) => {
    try { res.json(vault.listAnalysisDashboardPins()); } catch (e) { next(e); }
  });
  app.put('/analysis/dashboard/:id', async (req, res, next) => {
    try { res.json(vault.saveAnalysisDashboardPin({ ...(req.body || {}), id: req.params.id })); } catch (e) { next(e); }
  });
  app.delete('/analysis/dashboard/:id', async (req, res, next) => {
    try { res.json(vault.deleteAnalysisDashboardPin(req.params.id)); } catch (e) { next(e); }
  });

  app.get('/dashboard', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceDashboard()); } catch (e) { next(e); }
  });
  app.get('/ui-cache/status', async (_req, res, next) => {
    try { res.json(await vault.getUiDisplayCacheInfo()); } catch (e) { next(e); }
  });
  app.post('/ui-cache/rebuild', async (_req, res, next) => {
    try { res.json(await vault.rebuildUiDisplayCache()); } catch (e) { next(e); }
  });
  app.get('/workspace-derived-index/status', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceDerivedIndexInfo()); } catch (e) { next(e); }
  });
  app.post('/workspace-derived-index/rebuild', async (_req, res, next) => {
    try { res.json(await vault.rebuildWorkspaceDerivedIndexes()); } catch (e) { next(e); }
  });
  app.get('/workspace-summary-index/status', async (_req, res, next) => {
    try { res.json(await vault.getWorkspaceSummaryIndexInfo()); } catch (e) { next(e); }
  });
  app.post('/workspace-summary-index/rebuild', async (_req, res, next) => {
    try { res.json(await vault.rebuildWorkspaceSummaryIndexes()); } catch (e) { next(e); }
  });
  app.get('/database-index/status', async (_req, res, next) => {
    try { res.json(await vault.getDatabaseIndexInfo()); } catch (e) { next(e); }
  });
  app.post('/database-index/rebuild', async (_req, res, next) => {
    try { res.json(await vault.rebuildAllDatabaseIndexes()); } catch (e) { next(e); }
  });
  app.get('/attachments', async (_req, res, next) => {
    try { res.json(await vault.listAllAttachments()); } catch (e) { next(e); }
  });
  app.get('/links/broken', async (_req, res, next) => {
    try { res.json(await vault.listBrokenLinks()); } catch (e) { next(e); }
  });

  app.get('/conflicts', async (req, res, next) => {
    try { res.json(await vault.listConflicts(req.query.pageId ? String(req.query.pageId) : undefined)); } catch (e) { next(e); }
  });

  app.get('/backups', async (_req, res, next) => {
    try { res.json(await vault.listBackupCenter()); } catch (e) { next(e); }
  });
  app.post('/backups/:id/restore', async (req, res, next) => {
    try { res.json(await vault.restoreBackupCenterItem(decodeURIComponent(req.params.id))); } catch (e) { next(e); }
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = String(err?.message ?? 'Unknown error');
    const isDatabaseConflict = message.includes('Database conflict detected');
    const isDatabaseRowContentConflict = message.includes('Database row content conflict detected');
    const isJournalConflict = message.includes('Journal conflict detected');
    const isItemConflict = err?.code === 'ITEM_CONFLICT' || message.includes('項目が別の更新で変更されています');
    const isSettingsConflict = err?.code === 'SETTINGS_CONFLICT' || message.includes('設定が別の更新で変更されています');
    const isSharedDataLocked = err?.code === 'SHARED_DATA_LOCKED' || message.includes('Shared data is locked by another writer');
    const isDatabaseLocked = message.includes('Database is locked by') || message.includes('Locked by ');
    const isNotFound = /not found|does not exist/i.test(message);
    const isValidation = err?.name === 'ZodError' || /invalid|validation|required|must be/i.test(message);
    const isIoTemporary = /EACCES|EBUSY|EPERM|ETIMEDOUT|ENOTCONN|network|share|I\/O/i.test(message);
    const status = isDatabaseConflict || isDatabaseRowContentConflict || isJournalConflict || isItemConflict || isSettingsConflict
      ? 409
      : isDatabaseLocked || isSharedDataLocked
        ? 423
        : isNotFound
          ? 404
          : isValidation
            ? 400
            : isIoTemporary
              ? 503
              : 500;
    res.status(status).json({
      message,
      code: isDatabaseRowContentConflict ? 'DATABASE_ROW_CONTENT_CONFLICT'
        : isDatabaseConflict ? 'DATABASE_CONFLICT'
          : isJournalConflict ? 'JOURNAL_CONFLICT'
            : isItemConflict ? 'ITEM_CONFLICT'
              : isSettingsConflict ? 'SETTINGS_CONFLICT'
            : isSharedDataLocked ? 'SHARED_DATA_LOCKED'
              : isDatabaseLocked ? 'DATABASE_LOCKED'
            : isNotFound ? 'NOT_FOUND'
              : isIoTemporary ? 'STORAGE_TEMPORARILY_UNAVAILABLE'
                : err?.code,
      conflictType: isDatabaseRowContentConflict ? 'database-row-content' : isDatabaseConflict ? 'database' : isJournalConflict ? 'journal' : undefined,
      currentUpdatedAt: message.match(/currentUpdatedAt=([^;]+)/)?.[1] || message.match(/current=([^,]+)/)?.[1],
      baseUpdatedAt: message.match(/baseUpdatedAt=([^;]+)/)?.[1] || message.match(/base=([^,]+)/)?.[1],
    });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start local API');
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    apiToken,
    close: async () => {
      // Renderer normally releases the active locks before shutdown. This server-side
      // fallback prevents a forced window close from leaving a five-minute self-lock.
      await vault.releaseAllLocksForCurrentInstance().catch(() => undefined);
      await vault.stopSmartAssistGenerationServer().catch(() => undefined);
      // DuckDB keeps a native handle open while the analysis workbench is active.
      // Close it before SQLite and before the Electron process exits so the cache
      // can be reopened immediately on the next launch.
      await vault.closeAnalysisNotebook().catch(() => undefined);
      await new Promise<void>(resolve => server.close(() => resolve()));
      try { db.close(); } catch {}
    }
  };
}
