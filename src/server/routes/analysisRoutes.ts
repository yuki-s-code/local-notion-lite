import type { Express } from "express";
import type { VaultService } from "../services/vaultService";
import { parseBody, Schemas } from "../utils/validation";
import type { AnalysisCell, AnalysisNotebook, AnalysisParameter } from "../../shared/analysisTypes";

/** analysisRoutes: feature-scoped HTTP contract registration. */
export function registerAnalysisRoutes(app: Express, vault: VaultService) {
  app.get("/analysis/status", async (_req, res, next) => {
    try {
      res.json(await vault.getAnalysisStatus());
    } catch (e) {
      next(e);
    }
  });
  app.post("/analysis/sync", async (_req, res, next) => {
    try {
      res.json(await vault.syncAnalysisData());
    } catch (e) {
      next(e);
    }
  });
  app.post("/analysis/query", async (req, res, next) => {
    try {
      res.json(
        await vault.queryAnalysis(
          String(req.body?.sql || ""),
          Array.isArray(req.body?.parameters)
            ? (req.body.parameters as AnalysisParameter[])
            : [],
          Array.isArray(req.body?.namedResults) ? req.body.namedResults : [],
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/analysis/pivot", async (req, res, next) => {
    try {
      res.json(await vault.pivotAnalysis(req.body?.pivot || {}, req.body?.namedSource || {}));
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/results/:resultId", async (req, res, next) => {
    try {
      res.json(
        vault.getAnalysisResultPage(
          req.params.resultId,
          Number(req.query.page || 0),
          Number(req.query.pageSize || 500),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/results/:resultId/all", async (req, res, next) => {
    try {
      res.json(vault.getAnalysisResultAll(req.params.resultId));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/analysis/results/:resultId", async (req, res, next) => {
    try {
      res.json({ released: vault.releaseAnalysisResult(req.params.resultId) });
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/results-cache/status", async (_req, res, next) => {
    try {
      res.json(vault.getAnalysisResultCacheStatus());
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/results/:resultId/export.csv", async (req, res, next) => {
    try {
      res.status(200);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", 'attachment; filename="analysis-result.csv"');
      await vault.streamAnalysisResultCsv(req.params.resultId, async (chunk) => {
        if (res.write(chunk)) return;
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => { cleanup(); resolve(); };
          const onClose = () => { cleanup(); reject(new Error("CSV download was cancelled")); };
          const cleanup = () => {
            res.off("drain", onDrain);
            res.off("close", onClose);
          };
          res.once("drain", onDrain);
          res.once("close", onClose);
        });
      });
      res.end();
    } catch (e) {
      if (!res.headersSent) next(e);
      else res.end();
    }
  });
  app.post("/analysis/ai-draft", async (req, res, next) => {
    try {
      res.json(
        await vault.generateAnalysisAiDraft(
          parseBody(req, Schemas.smartGenericObject) as any,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/data-dictionary", async (_req, res, next) => {
    try {
      res.json(vault.getAnalysisDataDictionary());
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/settings", async (_req, res, next) => {
    try {
      res.json(vault.getAnalysisWorkspaceSettings());
    } catch (e) {
      next(e);
    }
  });
  app.put("/analysis/settings", async (req, res, next) => {
    try {
      res.json(vault.saveAnalysisWorkspaceSettings(req.body || {}));
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/notebooks", async (_req, res, next) => {
    try {
      res.json(vault.listAnalysisNotebooks());
    } catch (e) {
      next(e);
    }
  });
  app.get("/analysis/notebooks/:id", async (req, res, next) => {
    try {
      const notebook = vault.getAnalysisNotebook(req.params.id);
      if (!notebook)
        return res.status(404).json({ message: "Analysis notebook not found" });
      res.json(notebook);
    } catch (e) {
      next(e);
    }
  });
  app.put("/analysis/notebooks/:id", async (req, res, next) => {
    try {
      const body = req.body || {};
      const notebook: AnalysisNotebook = {
        id: req.params.id,
        title: String(body.title || "無題の分析"),
        description: String(body.description || ""),
        sql: String(body.sql || ""),
        chart:
          body.chart && typeof body.chart === "object"
            ? body.chart
            : { type: "table" },
        cells: Array.isArray(body.cells)
          ? (body.cells as AnalysisCell[])
          : undefined,
        executionHistory:
          body.executionHistory && typeof body.executionHistory === "object"
            ? body.executionHistory
            : undefined,
        snapshots:
          body.snapshots && typeof body.snapshots === "object"
            ? body.snapshots
            : undefined,
        createdAt: String(body.createdAt || ""),
        updatedAt: String(body.updatedAt || ""),
      };
      res.json(vault.saveAnalysisNotebook(notebook));
    } catch (e) {
      next(e);
    }
  });
  app.delete("/analysis/notebooks/:id", async (req, res, next) => {
    try {
      res.json(vault.deleteAnalysisNotebook(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  app.get("/analysis/dashboard", async (_req, res, next) => {
    try {
      res.json(vault.listAnalysisDashboardPins());
    } catch (e) {
      next(e);
    }
  });
  app.put("/analysis/dashboard/:id", async (req, res, next) => {
    try {
      res.json(
        vault.saveAnalysisDashboardPin({
          ...(req.body || {}),
          id: req.params.id,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/analysis/dashboard/:id", async (req, res, next) => {
    try {
      res.json(vault.deleteAnalysisDashboardPin(req.params.id));
    } catch (e) {
      next(e);
    }
  });

}
