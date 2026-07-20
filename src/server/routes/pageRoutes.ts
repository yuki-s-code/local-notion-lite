import type { Express } from "express";
import type { VaultService } from "../services/vaultService";
import { parseBody, Schemas } from "../utils/validation";

/** pageRoutes: feature-scoped HTTP contract registration. */
export function registerPageRoutes(app: Express, vault: VaultService) {
  app.get("/pages", async (_, res, next) => {
    try {
      res.json(await vault.domains.pages.list());
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/tree", async (_, res, next) => {
    try {
      res.json(await vault.listPageTree());
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/search", async (req, res, next) => {
    try {
      res.json(await vault.domains.search.pages(String(req.query.q ?? "")));
    } catch (e) {
      next(e);
    }
  });
  app.get("/locks", async (_, res, next) => {
    try {
      res.json(await vault.listLocks());
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id", (req, res) => {
    const page = vault.domains.pages.get(req.params.id);
    if (!page) return res.status(404).json({ message: "Page not found" });
    res.json(page);
  });
  app.get("/pages/:id/sidebar-counts", async (req, res, next) => {
    try {
      res.json(await vault.getPageSidebarCounts(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/comments", async (req, res, next) => {
    try {
      res.json(await vault.listPageComments(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/activity", async (req, res, next) => {
    try {
      res.json(await vault.listPageActivity(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/comments", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.pageCommentCreate);
      res.json(
        await vault.addPageComment(req.params.id, {
          body: body.body,
          blockId: body.blockId,
          blockPreview: body.blockPreview,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.patch("/pages/:id/comments/:commentId", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.pageCommentUpdate);
      res.json(
        await vault.updatePageComment(req.params.id, req.params.commentId, {
          body: body.body,
          resolved: body.resolved,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/pages/:id/comments/:commentId", async (req, res, next) => {
    try {
      res.json(
        await vault.deletePageComment(req.params.id, req.params.commentId),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.createPage);
      res.json(
        await vault.domains.pages.create(
          body.title,
          body.parentId ?? null,
          body.scope === "private" ? "private" : "shared",
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/duplicate", async (req, res, next) => {
    try {
      res.json(await vault.duplicatePage(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.patch("/pages/:id/move", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.pageMove);
      res.json(await vault.domains.pages.move(req.params.id, body.parentId ?? null));
    } catch (e) {
      next(e);
    }
  });
  app.patch("/pages/:id/order", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.pageOrder);
      res.json(await vault.updatePageOrder(req.params.id, body.sortOrder));
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/favorite", async (req, res, next) => {
    try {
      res.json(await vault.toggleFavorite(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/pages/:id", async (req, res, next) => {
    try {
      res.json(await vault.domains.pages.trash(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.put("/pages/:id", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.savePage);
      res.json(
        await vault.domains.pages.save({
          id: req.params.id,
          title: body.title,
          markdown: body.markdown ?? "",
          blocksuite: body.blocksuite ?? {},
          baseUpdatedAt: body.baseUpdatedAt,
          properties: body.properties,
          icon: body.icon,
          scope:
            body.scope === "private"
              ? "private"
              : body.scope === "shared"
                ? "shared"
                : undefined,
          historyReason: body.historyReason,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/lock", async (req, res) => {
    try {
      const lock = await vault.acquireLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      // Lock acquisition is not a fatal page-open error.
      // Return 200 with editable=false so the renderer can open the page in read-only mode
      // without showing browser 400 errors or blanking the editor.
      res.json({
        ok: false,
        editable: false,
        lock: await vault.getLock(req.params.id).catch(() => null),
        reason: e?.message ?? "Lock unavailable",
      });
    }
  });
  app.post("/pages/:id/lock/renew", async (req, res) => {
    try {
      const lock = await vault.renewLock(req.params.id);
      res.json({ ok: true, editable: true, lock });
    } catch (e: any) {
      res.json({
        ok: false,
        editable: false,
        lock: await vault.getLock(req.params.id).catch(() => null),
        reason: e?.message ?? "Lock unavailable",
      });
    }
  });
  app.delete("/pages/:id/lock", async (req, res, next) => {
    try {
      await vault.releaseLock(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/attachments", async (req, res, next) => {
    try {
      res.json(await vault.listAttachments(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/attachments", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.sourcePathAttachment);
      res.json(await vault.addAttachment(req.params.id, body.sourcePath));
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/attachments/upload", async (req, res, next) => {
    try {
      const body = parseBody(req, Schemas.base64Attachment);
      res.json(
        await vault.addAttachmentFromBase64(
          req.params.id,
          body.fileName,
          body.base64,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get(
    "/pages/:id/attachments/:attachmentId/name/:fileName",
    async (req, res, next) => {
      try {
        const attachment = await vault.getAttachmentInfo(
          req.params.id,
          req.params.attachmentId,
        );
        const filePath = await vault.getAttachmentFilePath(
          req.params.id,
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
    "/pages/:id/attachments/:attachmentId/file",
    async (req, res, next) => {
      try {
        const attachment = await vault.getAttachmentInfo(
          req.params.id,
          req.params.attachmentId,
        );
        const filePath = await vault.getAttachmentFilePath(
          req.params.id,
          req.params.attachmentId,
        );
        const fileName = encodeURIComponent(
          attachment.fileName || "attachment",
        ).replace(/'/g, "%27");
        if (String(req.query.download ?? "") === "1") {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename*=UTF-8''${fileName}`,
          );
        } else {
          res.setHeader(
            "Content-Disposition",
            `inline; filename*=UTF-8''${fileName}`,
          );
        }
        res.sendFile(filePath);
      } catch (e) {
        next(e);
      }
    },
  );

  app.get(
    "/pages/:id/attachments/:attachmentId/download",
    async (req, res, next) => {
      try {
        const attachment = await vault.getAttachmentInfo(
          req.params.id,
          req.params.attachmentId,
        );
        const filePath = await vault.getAttachmentFilePath(
          req.params.id,
          req.params.attachmentId,
        );
        // Do not delegate filename encoding to res.download(). Electron's Chromium
        // download path is more reliable when the UTF-8 filename is explicit.
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
  app.get("/knowledge-graph", async (req, res, next) => {
    try {
      const rawMax = Number(req.query.maxNodes || 320);
      res.json(
        await vault.domains.links.globalGraph({
          maxNodes: Number.isFinite(rawMax) ? rawMax : 320,
          expansion: ["pages", "database_rows", "attachments", "journals"].includes(String(req.query.expansion || ""))
            ? String(req.query.expansion) as "pages" | "database_rows" | "attachments" | "journals"
            : "pages",
        }),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/pages/:id/knowledge-graph", async (req, res, next) => {
    try {
      const rawMax = Number(req.query.maxNodes || 80);
      res.json(
        await vault.getLocalKnowledgeGraph(req.params.id, {
          maxNodes: Number.isFinite(rawMax) ? rawMax : 80,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/backlinks", async (req, res, next) => {
    try {
      res.json(await vault.domains.links.backlinks(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/history", async (req, res, next) => {
    try {
      res.json(await vault.listHistory(req.params.id));
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/history/:historyId", async (req, res, next) => {
    try {
      res.json(
        await vault.getHistoryBundle(req.params.id, req.params.historyId),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/pages/:id/history/:historyId/diff", async (req, res, next) => {
    try {
      res.json(await vault.diffHistory(req.params.id, req.params.historyId));
    } catch (e) {
      next(e);
    }
  });
  app.post("/pages/:id/history/:historyId/restore", async (req, res, next) => {
    try {
      res.json(await vault.restoreHistory(req.params.id, req.params.historyId));
    } catch (e) {
      next(e);
    }
  });
  app.get("/wiki/updates", async (req, res, next) => {
    try {
      res.json(
        await vault.listWikiUpdateDigests(Number(req.query.limit) || 12),
      );
    } catch (e) {
      next(e);
    }
  });

}
