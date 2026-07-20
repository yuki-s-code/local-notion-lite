import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import path from "node:path";
import { openLocalDb } from "./db/sqlite";
import {
  resolveLocalDbPath,
  setPrivateVaultPathOverrides,
} from "./utils/paths";
import { VaultService } from "./services/vaultService";
import { getTransformerRuntimeInfo } from "./services/transformerSemanticRetrieval";
import {
  parseBody,
  parseItemsBody,
  parseQuery,
  Schemas,
} from "./utils/validation";
import type { DatabasePropertyType, WorkspaceDatabase } from "../shared/types";
import type {
  AnalysisCell,
  AnalysisNotebook,
  AnalysisParameter,
} from "../shared/analysisTypes";
import { registerPageRoutes } from "./routes/pageRoutes";
import { registerSmartAssistRoutes } from "./routes/smartAssistRoutes";
import { registerDatabaseRoutes } from "./routes/databaseRoutes";
import { registerSemanticRoutes } from "./routes/semanticRoutes";
import { registerAnalysisRoutes } from "./routes/analysisRoutes";

export type StartupTimings = {
  openLocalDbMs: number;
  initVaultMs: number;
  routeRegistrationMs: number;
  totalMs: number;
};

export type ServerHandle = {
  port: number;
  url: string;
  /** Ephemeral token used only by the Electron renderer for localhost API calls. */
  apiToken: string;
  /** Startup segment timings for diagnosing slow PCs and shared folders. */
  startupTimings: StartupTimings;
  close: () => Promise<void>;
};

export async function startLocalApi(
  sharedRoot: string,
  customLocalDbPath?: string,
  privatePathOptions?: {
    privatePagesRoot?: string;
    privateDatabasesRoot?: string;
    onStartupProgress?: (
      stage: "localDb" | "workspace" | "api",
      message: string,
      detail?: string,
    ) => void;
  },
): Promise<ServerHandle> {
  const startedAt = performance.now();
  const onStartupProgress = privatePathOptions?.onStartupProgress;
  process.env.SMART_ASSIST_SHARED_ROOT = sharedRoot;
  setPrivateVaultPathOverrides({
    privatePagesRoot: privatePathOptions?.privatePagesRoot,
    privateDatabasesRoot: privatePathOptions?.privateDatabasesRoot,
  });
  const localDbPath = resolveLocalDbPath(sharedRoot, customLocalDbPath);
  onStartupProgress?.(
    "localDb",
    "ローカルデータを準備しています",
    "このPCの高速キャッシュを開いています。",
  );
  const dbStartedAt = performance.now();
  const db = openLocalDb(localDbPath);
  const openLocalDbMs = Math.round(performance.now() - dbStartedAt);
  const vault = new VaultService(db, sharedRoot, nanoid(10), localDbPath);
  // The API only listens on loopback, but a per-launch token prevents unrelated local web pages
  // from calling workspace endpoints through the browser. The token is never written to disk.
  const apiToken = nanoid(32);
  const vaultInitStartedAt = performance.now();
  onStartupProgress?.(
    "workspace",
    "共有ワークスペースを確認しています",
    "共有フォルダの利用準備をしています。",
  );
  await vault.initVault();
  const initVaultMs = Math.round(performance.now() - vaultInitStartedAt);
  onStartupProgress?.(
    "api",
    "作業環境を準備しています",
    "ページとデータベースを読み込める状態にしています。",
  );
  const routeRegistrationStartedAt = performance.now();
  // The renderer owns the deferred, idle-time startup import. Starting another
  // import timer here used to race Electron's first paint and duplicate the same
  // shared-folder work through a second startup path.

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        // Electron production windows usually have a null/file origin. Vite is allowed in development.
        const allowed =
          !origin ||
          origin === "null" ||
          /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin);
        callback(
          allowed ? null : new Error("Local API origin is not allowed"),
          allowed,
        );
      },
    }),
  );
  // Base64 uploads are capped at 15 MiB before decoding; retain headroom for JSON fields.
  app.use(express.json({ limit: "24mb" }));
  app.use((req, res, next) => {
    // File downloads are opened by Electron's download manager, which cannot attach custom headers.
    // Attachment IDs are opaque; all mutating and workspace-data endpoints still require the token.
    const isAttachmentDownload =
      /\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(req.path) ||
      /\/attachments\/[^/]+\/name\//.test(req.path) ||
      /\/inbox\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(
        req.path,
      ) ||
      /\/journals\/[^/]+\/attachments\/[^/]+\/(?:file|download)(?:\/|$)/.test(
        req.path,
      ) ||
      /\/journals\/[^/]+\/attachments\/[^/]+\/name\//.test(req.path);
    if (isAttachmentDownload || req.get("x-local-notion-token") === apiToken)
      return next();
    return res.status(403).json({
      message: "Local API token is required",
      code: "LOCAL_API_TOKEN_REQUIRED",
    });
  });

  app.get("/health", (_, res) => {
    const normalizedSharedRoot = path.resolve(sharedRoot);
    const normalizedDbPath = path.resolve(localDbPath);
    const location = normalizedDbPath.startsWith(
      path.join(normalizedSharedRoot, "local-cache"),
    )
      ? "sharedCache"
      : normalizedDbPath.includes(`${path.sep}Documents${path.sep}`)
        ? "documents"
        : normalizedDbPath.includes(`${path.sep}Temp${path.sep}`) ||
            normalizedDbPath.includes(`${path.sep}tmp${path.sep}`)
          ? "temp"
          : normalizedDbPath.includes(`${path.sep}AppData${path.sep}`) ||
              normalizedDbPath.includes(
                `${path.sep}Application Support${path.sep}`,
              )
            ? "appData"
            : "other";

    res.json({
      ok: true,
      sharedRoot,
      localDbPath,
      privateStorage: {
        pagesRoot: privatePathOptions?.privatePagesRoot || null,
        databasesRoot: privatePathOptions?.privateDatabasesRoot || null,
        customPages: Boolean(privatePathOptions?.privatePagesRoot),
        customDatabases: Boolean(privatePathOptions?.privateDatabasesRoot),
      },
      sync: vault.getSharedImportStatus(),
      sqlite: {
        available: true,
        path: localDbPath,
        fileName: path.basename(localDbPath),
        custom: Boolean(customLocalDbPath),
        location,
      },
      startup: {
        openLocalDbMs,
        initVaultMs,
        // Route registration is still in progress while this handler is
        // declared; calculate the current elapsed time for health callers.
        routeRegistrationMs: Math.round(
          performance.now() - routeRegistrationStartedAt,
        ),
        totalMs: Math.round(performance.now() - startedAt),
      },
    });
  });

  app.get("/sync/status", async (_, res) => {
    res.json(vault.getSharedImportStatus());
  });

  app.post("/sync/import", async (_, res, next) => {
    try {
      res.json({
        ok: true,
        sync: await vault.runImportFromShared("manual-sync"),
      });
    } catch (e) {
      next(e);
    }
  });

  app.get("/trash", async (_, res, next) => {
    try {
      res.json(await vault.listTrash());
    } catch (e) {
      next(e);
    }
  });
  app.post("/trash/:id/restore", async (req, res, next) => {
    try {
      res.json(await vault.restoreTrashedPage(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/trash/:id/permanent", async (req, res, next) => {
    try {
      res.json(await vault.deletePagePermanently(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/trash", async (_, res, next) => {
    try {
      res.json(await vault.emptyTrash());
    } catch (e) {
      next(e);
    }
  });

  app.get("/workspace/tag-aliases", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceTagAliases());
    } catch (e) {
      next(e);
    }
  });
  app.put("/workspace/tag-aliases", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.workspaceTagAliases);
      res.json(await vault.updateWorkspaceTagAliases(body));
    } catch (e) {
      next(e);
    }
  });

  app.get("/workspace/glossary", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceGlossary());
    } catch (e) {
      next(e);
    }
  });
  app.put("/workspace/glossary", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.workspaceGlossary);
      res.json(await vault.updateWorkspaceGlossary(body));
    } catch (e) {
      next(e);
    }
  });

  app.get("/workspace/glossary/:termId/insight", async (req, res, next) => {
    try { res.json(await vault.getWorkspaceGlossaryInsight(String(req.params.termId || ""))); }
    catch (e) { next(e); }
  });
  app.post("/workspace/glossary/candidates", async (_req, res, next) => {
    try { res.json({ candidates: await vault.suggestWorkspaceGlossaryCandidates() }); }
    catch (e) { next(e); }
  });

  app.get("/workspace/tag-presentation", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceTagPresentation());
    } catch (e) {
      next(e);
    }
  });
  app.put("/workspace/tag-presentation", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.workspaceTagPresentation);
      res.json(await vault.updateWorkspaceTagPresentation(body));
    } catch (e) {
      next(e);
    }
  });

  registerPageRoutes(app, vault);
  app.get("/tasks", async (_req, res, next) => {
    try {
      res.json(await vault.listTasks());
    } catch (e) {
      next(e);
    }
  });
  app.patch("/tasks/:taskId", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.taskPatch);
      res.json(
        await vault.updateTask(decodeURIComponent(req.params.taskId), body),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/inbox", async (_req, res, next) => {
    try {
      res.json(await vault.listInboxItems());
    } catch (e) {
      next(e);
    }
  });
  app.post("/inbox", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.inboxCreate);
      res.json(
        await vault.createInboxItem({
          title: body.title,
          text: body.text,
          source: (["manual", "drop", "web"].includes(body.source)
            ? body.source
            : "quick") as any,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.patch("/inbox/:id", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.inboxPatch);
      res.json(await vault.updateInboxItem(req.params.id, body));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/inbox/:id", async (req, res, next) => {
    try {
      res.json(await vault.deleteInboxItem(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/ocr-center/import-attachment", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      const sourceType = ["page", "journal", "database-row"].includes(
        String(body.sourceType),
      )
        ? (String(body.sourceType) as "page" | "journal" | "database-row")
        : null;
      if (
        !sourceType ||
        typeof body.attachmentId !== "string" ||
        !body.attachmentId
      ) {
        throw new Error("OCR送信元の情報が不足しています");
      }
      res.json(
        await vault.sendAttachmentToOcrCenter({
          sourceType,
          attachmentId: body.attachmentId,
          pageId: typeof body.pageId === "string" ? body.pageId : undefined,
          date: typeof body.date === "string" ? body.date : undefined,
          databaseId:
            typeof body.databaseId === "string" ? body.databaseId : undefined,
          rowId: typeof body.rowId === "string" ? body.rowId : undefined,
          scope: body.scope === "private" ? "private" : "shared",
          sourceTitle:
            typeof body.sourceTitle === "string" ? body.sourceTitle : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  app.post("/inbox/:id/attachments/upload", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.base64Attachment);
      res.json(
        await vault.addInboxAttachmentFromBase64(
          req.params.id,
          body.fileName,
          body.base64,
          String((req.body as any)?.mimeType || ""),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/inbox/:id/attachments/:attachmentId/file",
    async (req, res, next) => {
      try {
        const { attachment, filePath } = await vault.getInboxAttachmentFile(
          req.params.id,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || "attachment",
        ).replace(/'/g, "%27");
        res.setHeader(
          "Content-Disposition",
          `inline; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/inbox/:id/attachments/:attachmentId/download",
    async (req, res, next) => {
      try {
        const { attachment, filePath } = await vault.getInboxAttachmentFile(
          req.params.id,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || "attachment",
        ).replace(/'/g, "%27");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/inbox/:id/attachments/:attachmentId/ocr",
    async (req, res, next) => {
      // Compatibility endpoint: queue the work rather than bypassing shared-folder OCR ownership.
      try {
        const body = parseBody(req, Schemas.inboxOcr);
        res.json(
          await vault.recognizeInboxAttachment(
            req.params.id,
            req.params.attachmentId,
            body,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/inbox/:id/attachments/:attachmentId/ocr/queue",
    async (req, res, next) => {
      try {
        const body = parseBody(req, Schemas.inboxOcr);
        res.json(
          await vault.enqueueInboxAttachmentOcr(
            req.params.id,
            req.params.attachmentId,
            body,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/inbox/:id/attachments/:attachmentId/ocr/cancel",
    async (req, res, next) => {
      try {
        res.json(
          await vault.cancelInboxAttachmentOcrQueue(
            req.params.id,
            req.params.attachmentId,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    "/inbox/:id/attachments/:attachmentId/ocr/retry",
    async (req, res, next) => {
      try {
        res.json(
          await vault.retryInboxAttachmentOcrQueue(
            req.params.id,
            req.params.attachmentId,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );

  registerSmartAssistRoutes(app, vault);
  app.get("/journals", async (req, res, next) => {
    try {
      res.json(
        await vault.listJournals(
          req.query.month ? String(req.query.month) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/journals/search", async (req, res, next) => {
    try {
      res.json(
        await vault.searchJournals(
          String(req.query.q || ""),
          req.query.limit ? Number(req.query.limit) : 30,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/journals/:date", async (req, res, next) => {
    try {
      res.json(await vault.getJournal(req.params.date));
    } catch (e) {
      next(e);
    }
  });
  app.put("/journals/:date", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.journalSave);
      res.json(await vault.saveJournal({ ...body, date: req.params.date }));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/journals/:date", async (req, res, next) => {
    try {
      res.json(await vault.deleteJournal(req.params.date));
    } catch (e) {
      next(e);
    }
  });
  app.get("/journals/:date/attachments", async (req, res, next) => {
    try {
      res.json(await vault.listJournalAttachments(req.params.date));
    } catch (e) {
      next(e);
    }
  });
  app.post("/journals/:date/attachments", async (req, res, next) => {
    try {
      const sourcePath =
        typeof req.body?.sourcePath === "string" ? req.body.sourcePath : "";
      res.json(await vault.addJournalAttachment(req.params.date, sourcePath));
    } catch (e) {
      next(e);
    }
  });
  app.post("/journals/:date/attachments/upload", async (req, res, next) => {
    try {
      const raw = req.body && typeof req.body === "object" ? req.body : {};
      const fileName =
        typeof raw.fileName === "string" ? raw.fileName : "attachment";
      const base64 = typeof raw.base64 === "string" ? raw.base64 : "";
      res.json(
        await vault.addJournalAttachmentFromBase64(
          req.params.date,
          fileName,
          base64,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/journals/:date/attachments/:attachmentId/name/:fileName",
    async (req, res, next) => {
      try {
        const { attachment, filePath } = await vault.getJournalAttachmentFile(
          req.params.date,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || req.params.fileName || "attachment",
        ).replace(/'/g, "%27");
        const disposition =
          String(req.query.download ?? "") === "1" ? "attachment" : "inline";
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/journals/:date/attachments/:attachmentId/file",
    async (req, res, next) => {
      try {
        const { attachment, filePath } = await vault.getJournalAttachmentFile(
          req.params.date,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || "attachment",
        ).replace(/'/g, "%27");
        if (String(req.query.download ?? "") === "1")
          res.setHeader(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${fileName}`,
          );
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/journals/:date/attachments/:attachmentId/download",
    async (req, res, next) => {
      try {
        const { attachment, filePath } = await vault.getJournalAttachmentFile(
          req.params.date,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || "attachment",
        ).replace(/'/g, "%27");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );

  registerDatabaseRoutes(app, vault);
  registerSemanticRoutes(app, vault);
  registerAnalysisRoutes(app, vault);
  app.get("/dashboard", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceDashboard());
    } catch (e) {
      next(e);
    }
  });
  app.get("/ui-cache/status", async (_req, res, next) => {
    try {
      res.json(await vault.getUiDisplayCacheInfo());
    } catch (e) {
      next(e);
    }
  });
  app.post("/ui-cache/rebuild", async (_req, res, next) => {
    try {
      res.json(await vault.rebuildUiDisplayCache());
    } catch (e) {
      next(e);
    }
  });
  app.get("/workspace-derived-index/status", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceDerivedIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.post("/workspace-derived-index/rebuild", async (_req, res, next) => {
    try {
      res.json(await vault.rebuildWorkspaceDerivedIndexes());
    } catch (e) {
      next(e);
    }
  });
  app.get("/workspace-summary-index/status", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceSummaryIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.post("/workspace-summary-index/rebuild", async (_req, res, next) => {
    try {
      res.json(await vault.rebuildWorkspaceSummaryIndexes());
    } catch (e) {
      next(e);
    }
  });
  app.get("/database-index/status", async (_req, res, next) => {
    try {
      res.json(await vault.getDatabaseIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.post("/database-index/rebuild", async (_req, res, next) => {
    try {
      res.json(await vault.rebuildAllDatabaseIndexes());
    } catch (e) {
      next(e);
    }
  });
  app.get("/attachments", async (_req, res, next) => {
    try {
      res.json(await vault.listAllAttachments());
    } catch (e) {
      next(e);
    }
  });
  app.get("/attachments/index-rebuild/status", async (_req, res, next) => {
    try {
      res.json(vault.getAttachmentIndexRebuildStatus());
    } catch (e) {
      next(e);
    }
  });
  app.post("/attachments/index-rebuild", async (_req, res, next) => {
    try {
      res.json(await vault.startAttachmentIndexRebuild());
    } catch (e) {
      next(e);
    }
  });
  app.post("/attachments/index-rebuild/cancel", async (_req, res, next) => {
    try {
      res.json(vault.cancelAttachmentIndexRebuild());
    } catch (e) {
      next(e);
    }
  });
  app.get("/links/broken", async (_req, res, next) => {
    try {
      res.json(await vault.listBrokenLinks());
    } catch (e) {
      next(e);
    }
  });

  app.get("/conflicts", async (req, res, next) => {
    try {
      res.json(
        await vault.listConflicts(
          req.query.pageId ? String(req.query.pageId) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/backups", async (_req, res, next) => {
    try {
      res.json(await vault.listBackupCenter());
    } catch (e) {
      next(e);
    }
  });
  app.post("/backups/:id/restore", async (req, res, next) => {
    try {
      res.json(
        await vault.restoreBackupCenterItem(decodeURIComponent(req.params.id)),
      );
    } catch (e) {
      next(e);
    }
  });

  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = String(err?.message ?? "Unknown error");
      const isDatabaseConflict = message.includes("Database conflict detected");
      const isDatabaseRowContentConflict = message.includes(
        "Database row content conflict detected",
      );
      const isJournalConflict = message.includes("Journal conflict detected");
      const isItemConflict =
        err?.code === "ITEM_CONFLICT" ||
        message.includes("項目が別の更新で変更されています");
      const isSettingsConflict =
        err?.code === "SETTINGS_CONFLICT" ||
        message.includes("設定が別の更新で変更されています");
      const isSharedDataLocked =
        err?.code === "SHARED_DATA_LOCKED" ||
        message.includes("Shared data is locked by another writer");
      const isDatabaseLocked =
        message.includes("Database is locked by") ||
        message.includes("Locked by ");
      const isNotFound = /not found|does not exist/i.test(message);
      const isValidation =
        err?.name === "ZodError" ||
        /invalid|validation|required|must be/i.test(message);
      const isIoTemporary =
        /EACCES|EBUSY|EPERM|ETIMEDOUT|ENOTCONN|network|share|I\/O/i.test(
          message,
        );
      const status =
        isDatabaseConflict ||
        isDatabaseRowContentConflict ||
        isJournalConflict ||
        isItemConflict ||
        isSettingsConflict
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
        code: isDatabaseRowContentConflict
          ? "DATABASE_ROW_CONTENT_CONFLICT"
          : isDatabaseConflict
            ? "DATABASE_CONFLICT"
            : isJournalConflict
              ? "JOURNAL_CONFLICT"
              : isItemConflict
                ? "ITEM_CONFLICT"
                : isSettingsConflict
                  ? "SETTINGS_CONFLICT"
                  : isSharedDataLocked
                    ? "SHARED_DATA_LOCKED"
                    : isDatabaseLocked
                      ? "DATABASE_LOCKED"
                      : isNotFound
                        ? "NOT_FOUND"
                        : isIoTemporary
                          ? "STORAGE_TEMPORARILY_UNAVAILABLE"
                          : err?.code,
        conflictType: isDatabaseRowContentConflict
          ? "database-row-content"
          : isDatabaseConflict
            ? "database"
            : isJournalConflict
              ? "journal"
              : undefined,
        currentUpdatedAt:
          message.match(/currentUpdatedAt=([^;]+)/)?.[1] ||
          message.match(/current=([^,]+)/)?.[1],
        baseUpdatedAt:
          message.match(/baseUpdatedAt=([^;]+)/)?.[1] ||
          message.match(/base=([^,]+)/)?.[1],
      });
    },
  );

  const routeRegistrationMs = Math.round(
    performance.now() - routeRegistrationStartedAt,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Failed to start local API");
  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    apiToken,
    startupTimings: {
      openLocalDbMs,
      initVaultMs,
      routeRegistrationMs,
      totalMs: Math.round(performance.now() - startedAt),
    },
    close: async () => {
      // Renderer normally releases the active locks before shutdown. This server-side
      // fallback prevents a forced window close from leaving a five-minute self-lock.
      await vault.releaseAllLocksForCurrentInstance().catch(() => undefined);
      await vault.stopSmartAssistGenerationServer().catch(() => undefined);
      // DuckDB keeps a native handle open while the analysis workbench is active.
      // Close it before SQLite and before the Electron process exits so the cache
      // can be reopened immediately on the next launch.
      await vault.closeAnalysisNotebook().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {}
    },
  };
}
