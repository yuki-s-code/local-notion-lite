import type { Express } from "express";
import type { VaultService } from "../services/vaultService";
import { parseBody, parseItemsBody, parseQuery, Schemas } from "../utils/validation";
import { getTransformerRuntimeInfo } from "../services/transformerSemanticRetrieval";

/** smartAssistRoutes: feature-scoped HTTP contract registration. */
export function registerSmartAssistRoutes(app: Express, vault: VaultService) {
  app.post("/smart-assist/chat/ask", async (req, res) => {
    try {
      const response = await vault.domains.ai.smartAssist(
        parseBody(req, Schemas.smartAsk),
      );
      // v208: UI safety net. The chat UI expects an `answer` string.
      // Even if an internal ranking/embedding path returns a partial object,
      // normalize it here so the user never sees a blank assistant response.
      if (
        !response ||
        typeof response.answer !== "string" ||
        !response.answer.trim()
      ) {
        res.json({
          answer:
            "回答を生成できませんでした。FAQ候補は取得できている可能性があります。再インデックス後、もう一度質問してください。",
          confidence: 0,
          confidenceLabel: "低",
          uxLevel: "low",
          intent: "None",
          followUpQuestions: [
            "FAQ JSONの取込状態を確認してください。",
            "検索・意味ベクトル再生成を実行してください。",
          ],
          categoryOptions: [],
          sources: [],
          mode: "chat-route-empty-answer-safeguard-v208",
        });
        return;
      }
      res.json(response);
    } catch (e: any) {
      res.json({
        answer: `回答生成中にエラーが発生しました。検索インデックスまたは意味ベクトルを再生成してください。詳細: ${String(e?.message || e).slice(0, 240)}`,
        confidence: 0,
        confidenceLabel: "低",
        uxLevel: "low",
        intent: "None",
        followUpQuestions: [
          "検索・意味ベクトル再生成を実行してください。",
          "FAQ JSONの形式を確認してください。",
        ],
        categoryOptions: [],
        sources: [],
        mode: "chat-route-error-safeguard-v208",
      });
    }
  });

  app.get("/smart-assist/faqs", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartFaqRecords());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/faqs/query", async (req, res) => {
    try {
      const query = parseQuery(req, Schemas.smartFaqQuery);
      res.json(await vault.querySmartFaqRecords(query));
    } catch (e: any) {
      res.json({
        items: [],
        total: 0,
        limit: Math.max(1, Math.min(200, Number(req.query.limit || 50))),
        offset: Math.max(0, Number(req.query.offset || 0)),
        mode: "safe-empty-faq-query-v209",
        indexedCount: 0,
        faqCount: 0,
        warning: String(e?.message || e).slice(0, 240),
      });
    }
  });
  app.get("/smart-assist/faqs/search-stats", async (_req, res) => {
    try {
      res.json(await vault.getSmartFaqSearchStats());
    } catch (e: any) {
      res.json({
        mode: "safe-search-stats-v209",
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
  app.get("/smart-assist/search-index", async (_req, res, next) => {
    try {
      res.json(await vault.getSmartAssistSearchIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/semantic-index", async (_req, res, next) => {
    try {
      res.json(await vault.getSmartAssistSemanticIndexInfo());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/semantic-cache", async (_req, res, next) => {
    try {
      res.json(await vault.getSmartAssistSemanticCacheInfo());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/cache-topology", async (_req, res, next) => {
    try {
      res.json(await vault.getWorkspaceCacheTopology());
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/smart-assist/semantic-cache/clear-query",
    async (_req, res, next) => {
      try {
        res.json(await vault.clearSmartAssistQueryCache());
      } catch (e) {
        next(e);
      }
    },
  );

  app.get("/smart-assist/generation-settings", async (_req, res) => {
    try {
      res.json({
        ok: true,
        settings: await vault.getSmartAssistGenerationSettings(),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/generation-settings", async (req, res, next) => {
    try {
      res.json({
        ok: true,
        settings: await vault.updateSmartAssistGenerationSettings(
          Object.fromEntries(
            Object.entries(parseBody(req, Schemas.generationSettings)).filter(
              ([, value]) => value !== null,
            ),
          ) as any,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/generation-check", async (_req, res) => {
    try {
      res.json(await vault.checkSmartAssistGenerationEngine());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/generation-test", async (_req, res) => {
    try {
      res.json(await vault.testSmartAssistGenerationEngine());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/smart-assist/generation-server/status", async (_req, res) => {
    try {
      res.json(await vault.getSmartAssistGenerationServerStatus());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/generation-server/start", async (req, res) => {
    try {
      res.json(await vault.startSmartAssistGenerationServer(req.body || {}));
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/generation-server/stop", async (_req, res) => {
    try {
      res.json(await vault.stopSmartAssistGenerationServer());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get("/smart-assist/transformer-settings", async (_req, res) => {
    try {
      res.json({
        ok: true,
        settings: await vault.getSmartAssistTransformerSettings(),
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/transformer-settings", async (req, res, next) => {
    try {
      res.json({
        ok: true,
        settings: await vault.updateSmartAssistTransformerSettings(
          Object.fromEntries(
            Object.entries(parseBody(req, Schemas.transformerSettings)).filter(
              ([, value]) => value !== null,
            ),
          ) as any,
        ),
      });
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/transformer-model-check", async (_req, res) => {
    try {
      res.json(await vault.checkSmartAssistTransformerModel());
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.post("/smart-assist/transformer-model-download", async (req, res) => {
    try {
      res.json(
        await vault.downloadSmartAssistTransformerModel(
          Object.fromEntries(
            Object.entries(parseBody(req, Schemas.transformerDownload)).filter(
              ([, value]) => value !== null,
            ),
          ) as any,
        ),
      );
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
  app.get("/smart-assist/transformer-runtime", async (_req, res) => {
    res.json(getTransformerRuntimeInfo());
  });
  app.post("/smart-assist/faqs/reindex", async (_req, res, next) => {
    try {
      res.json(await vault.rebuildSmartFaqIndex());
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/nlp/retrain", async (_req, res, next) => {
    try {
      res.json(await vault.retrainSmartAssistNlp());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/chat/logs", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistChatLogs());
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/chat/logs", async (_req, res, next) => {
    try {
      res.json(await vault.clearSmartAssistChatLogs());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/chat/low-confidence", async (_req, res, next) => {
    try {
      res.json(await vault.listLowConfidenceSmartAssistLogs());
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/faq/test", async (req, res, next) => {
    try {
      res.json(
        await vault.testSmartFaqRecord(
          parseBody(req, Schemas.smartFaqRecord) as any,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/synonyms", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistSynonyms());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/synonyms", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistSynonyms(
          parseItemsBody(req, Schemas.smartSynonym),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/synonyms", async (req, res, next) => {
    try {
      res.json(
        await vault.upsertSmartAssistSynonym(
          parseBody(req, Schemas.smartSynonym),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/synonyms/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.deleteSmartAssistSynonym(
          decodeURIComponent(req.params.id),
          req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/rule-profiles", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistRuleProfiles());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/rule-profiles", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistRuleProfiles(
          parseItemsBody(req, Schemas.smartRuleProfile),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/rule-profiles", async (req, res, next) => {
    try {
      res.json(
        await vault.upsertSmartAssistRuleProfile(
          parseBody(req, Schemas.smartRuleProfile),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/rule-profiles/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.deleteSmartAssistRuleProfile(
          decodeURIComponent(req.params.id),
          req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/faqs", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartFaqRecords(
          parseItemsBody(req, Schemas.smartFaqRecord),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/faqs", async (req, res, next) => {
    try {
      res.json(
        await vault.upsertSmartFaqRecord(
          parseBody(req, Schemas.smartFaqRecord),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/faqs/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.deleteSmartFaqRecord(
          decodeURIComponent(req.params.id),
          req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/smart-assist/improvement-queue", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistImprovementQueue());
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/improvement-queue", async (req, res, next) => {
    try {
      res.json(
        await vault.addSmartAssistImprovementQueue(
          parseBody(req, Schemas.smartGenericObject),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/improvement-queue/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.updateSmartAssistImprovementQueue(
          decodeURIComponent(req.params.id),
          parseBody(req, Schemas.smartGenericObject),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/improvement-queue/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.deleteSmartAssistImprovementQueue(
          decodeURIComponent(req.params.id),
          req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/faqs/improve-draft", async (req, res, next) => {
    try {
      res.json(
        await vault.generateSmartFaqImprovementDraft(
          parseBody(req, Schemas.smartGenericObject) as any,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/evaluation-set", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistEvaluationSet());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/evaluation-set", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistEvaluationSet(
          parseItemsBody(req, Schemas.smartEvaluationItem),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/evaluation-set", async (req, res, next) => {
    try {
      res.json(
        await vault.upsertSmartAssistEvaluationEntry(
          parseBody(req, Schemas.smartEvaluationItem),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.delete("/smart-assist/evaluation-set/:id", async (req, res, next) => {
    try {
      res.json(
        await vault.deleteSmartAssistEvaluationEntry(
          decodeURIComponent(req.params.id),
          req.query.baseUpdatedAt ? String(req.query.baseUpdatedAt) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/evaluation-set/run", async (_req, res, next) => {
    try {
      res.json(await vault.runSmartAssistEvaluationSet());
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/evaluation-reports", async (req, res, next) => {
    try {
      res.json(
        await vault.listSmartAssistEvaluationReports(
          req.query.limit ? Number(req.query.limit) : undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/query-normalization", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistQueryNormalizationRules());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/query-normalization", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistQueryNormalizationRules(
          parseBody(req, Schemas.smartGenericObject),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/smart-assist/fallback-contacts", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistFallbackContacts());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/fallback-contacts", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistFallbackContacts(
          parseBody(req, Schemas.smartGenericObject),
        ),
      );
    } catch (e) {
      next(e);
    }
  });

  app.get("/smart-assist/feedback", async (_req, res, next) => {
    try {
      res.json(await vault.listSmartAssistFeedback());
    } catch (e) {
      next(e);
    }
  });
  app.put("/smart-assist/feedback", async (req, res, next) => {
    try {
      res.json(
        await vault.saveSmartAssistFeedback(
          parseItemsBody(req, Schemas.smartFeedback),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post("/smart-assist/feedback", async (req, res, next) => {
    try {
      res.json(
        await vault.addSmartAssistFeedback(
          parseBody(req, Schemas.smartFeedback),
        ),
      );
    } catch (e) {
      next(e);
    }
  });

}
