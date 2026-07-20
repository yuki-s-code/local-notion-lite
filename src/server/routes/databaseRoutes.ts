import type { Express } from "express";
import path from "node:path";
import type { VaultService } from "../services/vaultService";
import { parseBody, parseQuery, Schemas } from "../utils/validation";
import type { DatabasePropertyType, WorkspaceDatabase } from "../../shared/types";

/** databaseRoutes: feature-scoped HTTP contract registration. */
export function registerDatabaseRoutes(app: Express, vault: VaultService) {
  app.get("/databases", async (_, res, next) => {
    try {
      res.json(await vault.listDatabases());
    } catch (e) {
      next(e);
    }
  });
  app.post("/databases", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.createDatabase);
      res.json(
        await vault.createDatabase(
          body.title,
          body.scope === "private" ? "private" : "shared",
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/databases/:id/query", async (req, res, next) => {
    try {
      const query = parseQuery(req, Schemas.databaseQuery);
      res.json(await vault.queryDatabaseRows(req.params.id, query));
    } catch (e) {
      next(e);
    }
  });
  app.post("/databases/:id/aggregates", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.databaseAggregates);
      res.json(await vault.aggregateDatabaseRows(req.params.id, body));
    } catch (e) {
      next(e);
    }
  });
  app.get("/databases/:id/performance", async (req, res, next) => {
    try {
      res.json(await vault.getDatabasePerformance(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/databases/:id/reindex", async (req, res, next) => {
    try {
      res.json(await vault.rebuildDatabaseIndex(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/databases/:id", async (req, res, next) => {
    try {
      const database = await vault.getDatabase(req.params.id);
      if (!database)
        return res.status(404).json({ message: "Database not found" });
      res.json(database);
    } catch (e) {
      next(e);
    }
  });
  // Lock contention is an expected editor state, not a transport/API failure.
  // Keep it 200 like the page lock route so the renderer can show the concrete
  // reason without a noisy browser 409 resource error.
  app.post("/databases/:id/lock", async (req, res) => {
    try {
      const lock = await vault.acquireDatabaseLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({
        ok: false,
        editable: false,
        lock: await vault.getDatabaseLock(req.params.id).catch(() => null),
        reason: e?.message || "Database locked",
      });
    }
  });
  app.post("/databases/:id/lock/renew", async (req, res) => {
    try {
      const lock = await vault.renewDatabaseLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({
        ok: false,
        editable: false,
        lock: await vault.getDatabaseLock(req.params.id).catch(() => null),
        reason: e?.message || "Database locked",
      });
    }
  });
  app.delete("/databases/:id/lock", async (req, res, next) => {
    try {
      await vault.releaseDatabaseLock(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.put("/databases/:id", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.saveDatabase);
      res.json(
        await vault.saveDatabase({
          ...body,
          id: req.params.id,
        } as WorkspaceDatabase),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/databases/:id", async (req, res, next) => {
    try {
      res.json(await vault.deleteDatabase(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/databases-trash", async (_req, res, next) => {
    try {
      res.json(await vault.listTrashedDatabases());
    } catch (e) {
      next(e);
    }
  });
  app.post("/databases-trash/:id/restore", async (req, res, next) => {
    try {
      res.json(await vault.restoreTrashedDatabase(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/databases-trash/:id", async (req, res, next) => {
    try {
      res.json(await vault.deleteTrashedDatabasePermanently(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/databases-trash", async (_req, res, next) => {
    try {
      res.json(await vault.emptyTrashedDatabases());
    } catch (e) {
      next(e);
    }
  });
  app.patch("/databases/:id/rows", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.patchDatabaseRows);
      res.json(await vault.patchDatabaseRows(req.params.id, body));
    } catch (e) {
      next(e);
    }
  });

  app.post("/databases/:id/rows", async (req, res, next) => {
    try {
      res.json(await vault.addDatabaseRow(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.post("/databases/:id/rows/batch", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.createDatabaseRows);
      res.json(await vault.createDatabaseRows(req.params.id, body));
    } catch (e) {
      next(e);
    }
  });

  app.post("/databases/:id/rows/delete", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.deleteDatabaseRows);
      res.json(await vault.deleteDatabaseRows(req.params.id, body));
    } catch (e) {
      next(e);
    }
  });

  app.get("/databases/:id/sidebar-rows", async (req, res, next) => {
    try {
      res.json(
        await vault.listDatabaseSidebarRows(req.params.id, {
          limit: req.query.limit ? Number(req.query.limit) : 30,
          offset: req.query.offset ? Number(req.query.offset) : 0,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/databases/:id/rows/:rowId/sidebar-children",
    async (req, res, next) => {
      try {
        res.json(
          await vault.listDatabaseRowSidebarChildren(
            req.params.id,
            req.params.rowId,
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );

  app.get("/workspace/database-child-pages", async (_req, res, next) => {
    try {
      res.json(await vault.listWorkspaceDatabaseChildPages());
    } catch (e) {
      next(e);
    }
  });

  app.get("/databases/:id/rows/:rowId/attachments", async (req, res, next) => {
    try {
      res.json(
        await vault.listDatabaseRowAttachments(
          req.params.id,
          req.params.rowId,
          req.query.scope === "private" ? "private" : "shared",
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/databases/:id/rows/:rowId/attachments/upload",
    async (req, res, next) => {
      try {
        const raw =
          req.body && typeof req.body === "object"
            ? (req.body as Record<string, unknown>)
            : {};
        const fileName =
          typeof raw.fileName === "string" ? raw.fileName : "attachment";
        const base64 = typeof raw.base64 === "string" ? raw.base64 : "";
        if (!base64) {
          const error: any = new Error("base64 is required");
          error.statusCode = 400;
          throw error;
        }
        res.json(
          await vault.addDatabaseRowAttachmentFromBase64(
            req.params.id,
            req.params.rowId,
            fileName,
            base64,
            raw.scope === "private" ? "private" : "shared",
          ),
        );
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/databases/:id/rows/:rowId/attachments/:attachmentId/name/:fileName",
    async (req, res, next) => {
      try {
        const { info, filePath } = await vault.getDatabaseRowAttachmentFile(
          req.params.id,
          req.params.rowId,
          req.params.attachmentId,
          req.query.scope === "private" ? "private" : "shared",
        );
        const fileName = encodeURIComponent(
          info.fileName || req.params.fileName || "attachment",
        ).replace(/'/g, "%27");
        res.setHeader(
          "Content-Disposition",
          `inline; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(path.resolve(filePath));
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/databases/:id/rows/:rowId/attachments/:attachmentId/file",
    async (req, res, next) => {
      try {
        const { info, filePath } = await vault.getDatabaseRowAttachmentFile(
          req.params.id,
          req.params.rowId,
          req.params.attachmentId,
          req.query.scope === "private" ? "private" : "shared",
        );
        const fileName = encodeURIComponent(
          info.fileName || "attachment",
        ).replace(/'/g, "%27");
        const disposition =
          String(req.query.download ?? "") === "1" ? "attachment" : "inline";
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(path.resolve(filePath));
      } catch (e) {
        next(e);
      }
    },
  );
  app.get(
    "/databases/:id/rows/:rowId/attachments/:attachmentId/download",
    async (req, res, next) => {
      try {
        const { info, filePath } = await vault.getDatabaseRowAttachmentFile(
          req.params.id,
          req.params.rowId,
          req.params.attachmentId,
          req.query.scope === "private" ? "private" : "shared",
        );
        const fileName = encodeURIComponent(
          info.fileName || "attachment",
        ).replace(/'/g, "%27");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${fileName}`,
        );
        res.sendFile(path.resolve(filePath));
      } catch (e) {
        next(e);
      }
    },
  );

  app.get("/databases/:id/rows/:rowId/content", async (req, res, next) => {
    try {
      res.json(
        await vault.getDatabaseRowContent(req.params.id, req.params.rowId, {
          title: req.query.title ? String(req.query.title) : undefined,
          scope: req.query.scope === "private" ? "private" : "shared",
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/databases/:id/rows/:rowId/links", async (req, res, next) => {
    try {
      res.json(
        await vault.listDatabaseRowLinks(req.params.id, req.params.rowId, {
          scope: req.query.scope === "private" ? "private" : "shared",
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  app.delete(
    "/databases/:id/rows/:rowId/child-pages/:pageId",
    async (req, res, next) => {
      try {
        res.json(
          await vault.deleteDatabaseRowChildPage(
            req.params.id,
            req.params.rowId,
            req.params.pageId,
            {
              trashPage: req.query.trashPage === "false" ? false : true,
            },
          ),
        );
      } catch (e) {
        // V271: deleting a DB-row child page is a cleanup operation from multiple UI surfaces.
        // Even if the sidebar has stale IDs, the route should not break the app with 400.
        // Return a successful no-op so the client can refresh and remove stale rows.
        res.json({
          ok: true,
          databaseId: req.params.id,
          rowId: req.params.rowId,
          pageId: req.params.pageId,
          trashed: req.query.trashPage === "false" ? false : true,
          links: { childPages: [], outboundLinks: [], backlinks: [] },
          warning:
            e instanceof Error
              ? e.message
              : "Child page delete cleanup completed with warning",
        });
      }
    },
  );

  app.post("/databases/:id/rows/:rowId/child-pages", async (req, res, next) => {
    try {
      const raw =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      res.json(
        await vault.createDatabaseRowChildPage(
          req.params.id,
          req.params.rowId,
          {
            title: typeof raw.title === "string" ? raw.title : undefined,
            scope: raw.scope === "private" ? "private" : "shared",
          },
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.put("/databases/:id/rows/:rowId/content", async (req, res, next) => {
    try {
      // V256: BlockNote can emit a richer payload than the strict zod schema originally expected.
      // Normalize this endpoint defensively so row-content autosave never fails with a generic 400
      // just because optional editor metadata has an unexpected shape.
      const raw =
        req.body && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)
          : {};
      const scope = raw.scope === "private" ? "private" : "shared";
      const baseUpdatedAt =
        typeof raw.baseUpdatedAt === "string" && raw.baseUpdatedAt.trim()
          ? raw.baseUpdatedAt
          : undefined;
      const markdown =
        typeof raw.markdown === "string"
          ? raw.markdown
          : String(raw.markdown ?? "");
      const title =
        typeof raw.title === "string"
          ? raw.title
          : raw.title == null
            ? undefined
            : String(raw.title);
      if (markdown.length > 10_000_000) {
        const error: any = new Error("markdown is too long");
        error.statusCode = 400;
        throw error;
      }
      res.json(
        await vault.saveDatabaseRowContent({
          databaseId: req.params.id,
          rowId: req.params.rowId,
          title,
          markdown,
          blocksuite: raw.blocksuite,
          baseUpdatedAt,
          scope,
          childPageIds: Array.isArray(raw.childPageIds)
            ? (raw.childPageIds.filter(
                (item) => typeof item === "string",
              ) as string[])
            : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/databases/:id/properties", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.addDatabaseProperty);
      res.json(
        await vault.addDatabaseProperty(
          req.params.id,
          body.name,
          body.type as DatabasePropertyType,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

}
