import type { Express } from "express";
import type { VaultService } from "../services/vaultService";
import { parseBody, parseQuery, Schemas } from "../utils/validation";

/** semanticRoutes: feature-scoped HTTP contract registration. */
export function registerSemanticRoutes(app: Express, vault: VaultService) {
  app.get("/semantic/index", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceSemanticIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/index-revision", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceSemanticIndexRevision());
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/recovery-backups", async (_req, res, next) => {
    try {
      res.json(await vault.listWorkspaceRecoveryBackups());
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/recovery-backups", async (req, res, next) => {
    try {
      res.json(
        await vault.createWorkspaceRecoveryBackup(
          String((req.body || {}).reason || "manual"),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/cache-reset", async (_req, res, next) => {
    try {
      res.json(await vault.resetWorkspaceSemanticLocalCache());
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/cache-maintenance", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        await vault.maintainWorkspaceSemanticCache({
          vacuum: body.vacuum === true,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/rebuild-job", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceSemanticRebuildJob());
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/rebuild-job", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        await vault.startWorkspaceSemanticRebuildJob({
          mode: body.mode === "diff" ? "diff" : "full",
          maxNewEmbeddings:
            body.maxNewEmbeddings !== undefined
              ? Number(body.maxNewEmbeddings)
              : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/rebuild-job/control", async (req, res, next) => {
    try {
      const action = String((req.body || {}).action || "");
      if (!["pause", "resume", "cancel"].includes(action))
        throw new Error("invalid semantic rebuild action");
      res.json(
        await vault.controlWorkspaceSemanticRebuildJob(
          action as "pause" | "resume" | "cancel",
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/reindex", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        await vault.rebuildWorkspaceSemanticIndex({
          mode: body.mode === "diff" ? "diff" : "full",
          maxNewEmbeddings:
            body.maxNewEmbeddings !== undefined
              ? Number(body.maxNewEmbeddings)
              : undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/diff-update", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      const preferredChunkIds = Array.isArray(body.preferredChunkIds)
        ? body.preferredChunkIds.map(String).filter(Boolean).slice(0, 100)
        : [];
      const targets: Array<{
        type: "page" | "database_row" | "journal";
        sourceId: string;
        databaseId?: string;
      }> = Array.isArray(body.targets)
        ? body.targets
            .map((raw: any) => {
              const type =
                raw?.type === "database_row"
                  ? ("database_row" as const)
                  : raw?.type === "page"
                    ? ("page" as const)
                    : raw?.type === "journal"
                      ? ("journal" as const)
                      : null;
              return {
                type,
                sourceId: String(raw?.sourceId || "").trim(),
                databaseId: String(raw?.databaseId || "").trim() || undefined,
              };
            })
            .filter(
              (
                target: {
                  type: "page" | "database_row" | "journal" | null;
                  sourceId: string;
                  databaseId?: string;
                },
              ): target is {
                type: "page" | "database_row" | "journal";
                sourceId: string;
                databaseId?: string;
              } =>
                Boolean(
                  target.type &&
                  target.sourceId &&
                  (target.type !== "database_row" || target.databaseId),
                ),
            )
            .slice(0, 100)
        : [];
      res.json(
        await vault.diffUpdateWorkspaceSemanticIndex(
          body.limit !== undefined ? Number(body.limit) : 20,
          { preferredChunkIds, background: body.background === true, targets },
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/semantic/reindex-source", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        await vault.reindexWorkspaceSemanticSource(
          String(body.sourceId || ""),
          body.type ? String(body.type) : undefined,
          body.databaseId ? String(body.databaseId) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  // Editing has higher priority than low-priority semantic maintenance.
  app.post("/semantic/editor-activity", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        vault.noteSemanticEditorActivity(
          body.holdMs !== undefined ? Number(body.holdMs) : 10_000,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/history", async (req, res, next) => {
    try {
      res.json(
        await vault.getWorkspaceSemanticUpdateHistory(
          req.query.limit ? Number(req.query.limit) : 20,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.post("/semantic/chat-answer", async (req, res, next) => {
    try {
      res.json(
        await vault.domains.ai.chat(
          parseBody(req, Schemas.smartGenericObject) as any,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  // NDJSON stream: emits model deltas immediately in llama-server resident mode.
  // One-shot llama-completion remains compatible and emits only the final event.
  app.post("/semantic/chat-answer/stream", async (req, res, next) => {
    const write = (event: any) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      const body = parseBody(req, Schemas.smartGenericObject) as any;
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      write({ type: "status", stage: "retrieving" });
      const result = await vault.domains.ai.chat(body, (delta) =>
        write({ type: "delta", delta }),
      );
      write({ type: "final", data: result });
      res.end();
    } catch (e: any) {
      if (res.headersSent) {
        write({
          type: "error",
          message: e?.message || "AIストリームに失敗しました。",
        });
        res.end();
      } else next(e);
    }
  });

  // Editor AI is deliberately separate from Smart Assist. It never performs
  // semantic/FTS retrieval and never returns related-source explanations.
  app.post("/editor-ai/edit", async (req, res, next) => {
    try {
      res.json(
        await vault.domains.ai.editorEdit(
          parseBody(req, Schemas.smartGenericObject) as any,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/semantic/search", async (req, res, next) => {
    try {
      const types =
        typeof req.query.types === "string"
          ? String(req.query.types)
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined;
      res.json(
        await vault.domains.search.semantic(String(req.query.q || ""), {
          limit: req.query.limit ? Number(req.query.limit) : 20,
          types,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  // Draft related search is intentionally read-only: it never writes the semantic
  // index and is used only for lightweight suggestions while a page is being edited.
  app.post("/semantic/related/draft", async (req, res, next) => {
    try {
      const body =
        req.body && typeof req.body === "object" ? (req.body as any) : {};
      res.json(
        await vault.getWorkspaceSemanticRelatedDraft({
          pageId: String(body.pageId || ""),
          title: String(body.title || ""),
          text: String(body.text || ""),
          tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          limit: body.limit !== undefined ? Number(body.limit) : 5,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/related/page/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.getWorkspaceSemanticRelated({
          type: "page",
          id: req.params.id,
          limit: req.query.limit ? Number(req.query.limit) : 32,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/related/faq/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.getWorkspaceSemanticRelated({
          type: "faq",
          id: req.params.id,
          limit: req.query.limit ? Number(req.query.limit) : 32,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/semantic/related/journal/:date", async (req, res, next) => {
    try {
      res.json(
        await vault.getWorkspaceSemanticRelated({
          type: "journal",
          id: req.params.date,
          limit: req.query.limit ? Number(req.query.limit) : 32,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get(
    "/semantic/related/database/:databaseId/row/:rowId",
    async (req, res, next) => {
      try {
        res.json(
          await vault.getWorkspaceSemanticRelated({
            type: "database_row",
            databaseId: req.params.databaseId,
            id: req.params.rowId,
            limit: req.query.limit ? Number(req.query.limit) : 32,
          }),
        );
      } catch (e) {
        next(e);
      }
    },
  );

}
