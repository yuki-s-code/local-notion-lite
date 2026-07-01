import type { Request } from "express";
import { z } from "zod";
import {
  base64EncodedLengthForBytes,
  MAX_BASE64_ATTACHMENT_BYTES,
} from "../../shared/persistence/attachmentUploadPolicy";

const nonEmptyString = (fieldName: string, max = 500) =>
  z
    .string({ required_error: `${fieldName} is required` })
    .trim()
    .min(1, `${fieldName} is required`)
    .max(max, `${fieldName} is too long`);
const optionalString = (max = 5000) => z.string().max(max).optional();
const nullableString = z.string().nullable().optional();
const scopeSchema = z.enum(["shared", "private"]).optional();
const idLike = z.string().trim().min(1).max(300);
const anyRecord = z.record(z.any());
const anyArray = z.array(z.any());

export class ValidationError extends Error {
  statusCode = 400;
  details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

export function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): z.infer<T> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success)
    throw new ValidationError(
      formatZodError(result.error),
      result.error.flatten(),
    );
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): z.infer<T> {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success)
    throw new ValidationError(
      formatZodError(result.error),
      result.error.flatten(),
    );
  return result.data;
}

export function parseItemsBody<T extends z.ZodTypeAny>(
  req: Request,
  itemSchema: T,
): Array<z.infer<T>> {
  const raw = Array.isArray(req.body) ? req.body : req.body?.items;
  const schema = z.array(itemSchema);
  const result = schema.safeParse(raw ?? []);
  if (!result.success)
    throw new ValidationError(
      formatZodError(result.error),
      result.error.flatten(),
    );
  return result.data;
}

const stringArraySchema = (maxItems = 100, maxLength = 500) =>
  z.array(z.string().trim().max(maxLength)).max(maxItems).optional();
const smartFaqStatusSchema = z
  .enum(["draft", "reviewed", "approved", "hidden"])
  .optional();
const smartFaqRecordSchema = z
  .object({
    id: z.string().trim().min(1).max(300).optional(),
    title: z.string().trim().max(500).optional(),
    question: nonEmptyString("question", 20_000),
    answer: nonEmptyString("answer", 200_000),
    category: z.string().trim().max(500).optional(),
    tags: stringArraySchema(30, 200),
    keywords: stringArraySchema(60, 200),
    negativeTerms: stringArraySchema(60, 200),
    status: smartFaqStatusSchema,
    enabled: z.boolean().optional(),
    sourceDocIds: stringArraySchema(50, 500),
    sourceTitles: stringArraySchema(50, 500),
    confidence: z.coerce.number().min(0).max(100).optional(),
    createdAt: z.string().max(100).optional(),
    updatedAt: z.string().max(100).optional(),
    updatedBy: z.string().max(300).optional(),
    sourceType: z.string().max(100).optional(),
    sourcePdfName: z.string().max(1_000).optional(),
    sourcePage: z.union([z.string(), z.number()]).optional(),
    sourceText: z.string().max(300_000).optional(),
    followUpQuestions: stringArraySchema(8, 1_000),
    examples: stringArraySchema(50, 2_000),
    testQuestions: stringArraySchema(30, 1_000),
    likelyQuestions: stringArraySchema(50, 1_000),
    paraphrases: stringArraySchema(50, 1_000),
    suggestedActions: stringArraySchema(20, 1_000),
    nextQuestions: stringArraySchema(20, 1_000),
    intent: z
      .union([z.string().max(500), z.array(z.string().max(500)).max(20)])
      .optional(),
    intentId: z.string().max(500).optional(),
    intentIds: stringArraySchema(20, 500),
    intentLabel: z.string().max(500).optional(),
    domain: z.string().max(500).optional(),
    domainId: z.string().max(500).optional(),
  })
  .passthrough();

const smartSynonymSchema = z
  .object({
    id: z.string().trim().min(1).max(300).optional(),
    canonical: z.string().trim().max(500).optional(),
    terms: stringArraySchema(80, 200),
    aliases: stringArraySchema(80, 200),
    enabled: z.boolean().optional(),
  })
  .passthrough();

const smartRuleProfileSchema = z
  .object({
    id: z.string().trim().min(1).max(300).optional(),
    name: z.string().trim().max(500).optional(),
    description: z.string().max(5_000).optional(),
    enabled: z.boolean().optional(),
    keywords: stringArraySchema(100, 200),
    intentIds: stringArraySchema(50, 500),
    categoryHints: stringArraySchema(50, 500),
    boost: z.coerce.number().min(-100).max(100).optional(),
  })
  .passthrough();

const smartEvaluationItemSchema = z
  .object({
    id: z.string().trim().min(1).max(300).optional(),
    question: nonEmptyString("question", 20_000),
    expectedFaqId: z.string().trim().max(300).optional(),
    expectedAnswerIncludes: stringArraySchema(20, 1_000),
    category: z.string().max(500).optional(),
  })
  .passthrough();

const smartFeedbackSchema = z
  .object({
    id: z.string().trim().min(1).max(300).optional(),
    faqId: z.string().trim().max(300).optional(),
    question: z.string().max(20_000).optional(),
    rating: z
      .union([
        z.literal("good"),
        z.literal("bad"),
        z.coerce.number().min(1).max(5),
      ])
      .optional(),
    helpful: z.boolean().optional(),
    comment: z.string().max(20_000).optional(),
    answerPreview: z.string().max(20_000).optional(),
    reason: z.string().max(20_000).optional(),
    matchedFaqId: z.string().max(300).optional(),
    matchedFaqTitle: z.string().max(500).optional(),
    expectedFaqId: z.string().max(300).optional(),
    confidence: z.coerce.number().min(0).max(100).optional(),
    confidenceLevel: z.string().max(80).optional(),
    candidates: z.array(z.any()).max(20).optional(),
    status: z.string().max(100).optional(),
    sourceIds: z.array(z.string().max(300)).max(80).optional(),
    sourceTitles: z.array(z.string().max(500)).max(80).optional(),
    createdAt: z.string().max(100).optional(),
    createdBy: z.string().max(200).optional(),
  })
  .passthrough();

export const Schemas = {
  createPage: z
    .object({
      title: nonEmptyString("title", 200).default("Untitled"),
      parentId: nullableString,
      scope: scopeSchema,
    })
    .passthrough(),

  savePage: z
    .object({
      title: nonEmptyString("title", 300),
      markdown: z.string().max(10_000_000).default(""),
      blocksuite: z.any().optional(),
      baseUpdatedAt: optionalString(100),
      properties: z.any().optional(),
      icon: optionalString(20),
      scope: scopeSchema,
      historyReason: z
        .enum(["manual", "auto_checkpoint", "metadata_changed"])
        .optional(),
    })
    .passthrough(),

  pageCommentCreate: z
    .object({
      body: nonEmptyString("body", 20_000),
      blockId: optionalString(500),
      blockPreview: optionalString(2_000),
    })
    .passthrough(),

  pageCommentUpdate: z
    .object({
      body: optionalString(20_000),
      resolved: z.boolean().optional(),
    })
    .passthrough(),

  pageMove: z.object({ parentId: nullableString }).passthrough(),
  pageOrder: z
    .object({ sortOrder: z.coerce.number().finite().default(0) })
    .passthrough(),

  sourcePathAttachment: z
    .object({ sourcePath: nonEmptyString("sourcePath", 10_000) })
    .passthrough(),
  base64Attachment: z
    .object({
      fileName: nonEmptyString("fileName", 500).default("file"),
      base64: nonEmptyString(
        "base64",
        base64EncodedLengthForBytes(MAX_BASE64_ATTACHMENT_BYTES) + 16,
      ),
    })
    .passthrough(),

  taskPatch: z.record(z.any()),
  inboxCreate: z
    .object({
      title: z.string().max(500).optional(),
      text: z.string().max(200_000).default(""),
      source: z.string().max(100).default("quick"),
    })
    .passthrough()
    .transform((value) => {
      const text = String(value.text ?? "").trim();
      const fallbackTitle =
        text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "Quick memo";
      return {
        ...value,
        text,
        title:
          String(value.title ?? fallbackTitle)
            .trim()
            .slice(0, 500) || fallbackTitle,
        source: value.source || "quick",
      };
    }),
  inboxPatch: z.record(z.any()),
  inboxOcr: z
    .object({
      mode: z.enum(["inspect", "page", "all"]).default("inspect"),
      page: z.coerce.number().int().min(1).max(5000).optional(),
      preprocessing: z.enum(["standard", "enhanced"]).default("standard"),
    })
    .passthrough(),

  smartAsk: z
    .object({
      message: z.string().max(50_000).optional(),
      q: z.string().max(50_000).optional(),
      question: z.string().max(50_000).optional(),
      history: z.array(z.any()).optional(),
      conversationId: optionalString(500),
    })
    .passthrough(),

  smartFaqQuery: z
    .object({
      q: z.string().max(5_000).optional(),
      status: z.string().max(100).optional(),
      category: z.string().max(300).optional(),
      pdf: z.string().max(500).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
    })
    .passthrough(),

  transformerSettings: z
    .object({
      enabled: z.boolean().optional(),
      modelId: z.string().max(500).optional(),
      modelRoot: z.string().max(10_000).optional().nullable(),
      localModelPath: z.string().max(10_000).optional().nullable(),
      localCacheDir: z.string().max(10_000).optional().nullable(),
      pooling: z.string().max(100).optional(),
      normalize: z.boolean().optional(),
      maxCandidates: z.coerce.number().int().min(1).max(500).optional(),
      minConfidence: z.coerce.number().min(0).max(100).optional(),
      semanticIdleEnabled: z.boolean().optional(),
      semanticIdleBatchSize: z.coerce.number().int().min(1).max(50).optional(),
      semanticIdleDelaySec: z.coerce.number().int().min(5).max(120).optional(),
    })
    .passthrough(),

  generationSettings: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.enum(["none", "llama-cpp"]).optional(),
      modelRoot: z.string().max(10_000).optional().nullable(),
      selectedModelPath: z.string().max(10_000).optional().nullable(),
      llamaExecutablePath: z.string().max(10_000).optional().nullable(),
      llamaRuntimeDir: z.string().max(10_000).optional().nullable(),
      preset: z.enum(["fast", "light", "balanced", "manual"]).optional(),
      performanceMode: z.enum(["fast", "standard", "quality"]).optional(),
      retryMode: z.enum(["off", "on-error", "full"]).optional(),
      generationRuntimeMode: z.enum(["oneshot", "server"]).optional(),
      llamaServerExecutablePath: z.string().max(10_000).optional().nullable(),
      llamaServerHost: z.string().max(200).optional().nullable(),
      llamaServerPort: z.coerce.number().int().min(1024).max(65535).optional(),
      llamaServerAutoStart: z.boolean().optional(),
      llamaServerFallback: z.boolean().optional(),
      contextSize: z.coerce.number().int().min(512).max(8192).optional(),
      maxTokens: z.coerce.number().int().min(32).max(2048).optional(),
      temperature: z.coerce.number().min(0).max(1).optional(),
      timeoutMs: z.coerce.number().int().min(5_000).max(300_000).optional(),
      totalTimeoutMs: z.coerce
        .number()
        .int()
        .min(5_000)
        .max(300_000)
        .optional(),
    })
    .passthrough(),

  transformerDownload: z
    .object({
      modelId: z.string().max(500).optional(),
      modelRoot: z.string().max(10_000).optional().nullable(),
      targetDir: z.string().max(10_000).optional().nullable(),
      localModelPath: z.string().max(10_000).optional().nullable(),
      localCacheDir: z.string().max(10_000).optional().nullable(),
      overwrite: z.boolean().optional(),
    })
    .passthrough(),

  smartFaqRecord: smartFaqRecordSchema,
  smartSynonym: smartSynonymSchema,
  smartRuleProfile: smartRuleProfileSchema,
  smartEvaluationItem: smartEvaluationItemSchema,
  smartFeedback: smartFeedbackSchema,
  smartGenericObject: anyRecord,

  journalSave: z
    .object({
      title: z.string().max(500).optional(),
      markdown: z.string().max(10_000_000).optional(),
      content: z.string().max(10_000_000).optional(),
      blocksuite: z.any().optional(),
    })
    .passthrough(),

  createDatabase: z
    .object({
      title: nonEmptyString("title", 200).default("New Database"),
      scope: scopeSchema,
    })
    .passthrough(),

  databaseQuery: z
    .object({
      viewId: z.string().max(300).optional(),
      q: z.string().max(5_000).optional(),
      page: z.coerce.number().int().min(1).max(1_000_000).optional(),
      pageSize: z.coerce.number().int().min(1).max(500).optional(),
      cursor: z.string().max(1_000).optional(),
    })
    .passthrough(),

  databaseAggregates: z
    .object({
      viewId: z.string().max(300).optional(),
      q: z.string().max(5_000).optional(),
      aggregates: z.record(z.string().max(300), z.enum([
        "none", "count", "filled", "empty", "unique", "sum", "average",
        "median", "min", "max", "range", "checked", "unchecked", "percent_checked",
        "count_status_done", "count_status_open", "percent_status_done",
      ])).default({}),
    })
    .passthrough(),

  saveDatabase: z
    .object({
      title: z.string().max(500).optional(),
      properties: anyArray.optional(),
      rows: anyArray.optional(),
      views: anyArray.optional(),
      scope: scopeSchema,
      baseUpdatedAt: optionalString(100),
    })
    .passthrough(),

  patchDatabaseRows: z
    .object({
      baseUpdatedAt: optionalString(100),
      patches: z.array(z.object({
        rowId: z.string().min(1).max(300),
        cells: z.record(z.string().max(300), z.any()),
      })).min(1).max(2000),
    })
    .passthrough(),

  addDatabaseProperty: z
    .object({
      name: nonEmptyString("name", 200).default("Property"),
      type: z.string().max(100).default("text"),
    })
    .passthrough(),

  saveDatabaseRowContent: z
    .object({
      title: z.preprocess(
        (value) => (value == null ? undefined : String(value)),
        z.string().max(500).optional(),
      ),
      markdown: z.preprocess(
        (value) => (value == null ? "" : String(value)),
        z.string().max(10_000_000).default(""),
      ),
      blocksuite: z.any().optional(),
      baseUpdatedAt: z.preprocess(
        (value) => (value == null || value === "" ? undefined : String(value)),
        z.string().max(100).optional(),
      ),
      scope: z.preprocess(
        (value) =>
          value === "private"
            ? "private"
            : value === "shared"
              ? "shared"
              : undefined,
        scopeSchema,
      ),
    })
    .passthrough(),

  workspaceTagPresentation: z
    .object({
      settings: z
        .record(
          z
            .object({
              group: z
                .enum(["業務分野", "年度", "対象者", "状態", "その他"])
                .optional(),
              color: z
                .enum([
                  "slate",
                  "blue",
                  "cyan",
                  "green",
                  "amber",
                  "orange",
                  "red",
                  "purple",
                  "pink",
                ])
                .optional(),
            })
            .strict(),
        )
        .superRefine((settings, context) => {
          if (Object.keys(settings).length > 500)
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "settings must contain at most 500 tags",
            });
        }),
    })
    .strict(),

  workspaceTagAliases: z
    .object({
      aliases: z
        .record(z.array(z.string().trim().max(200)).max(80))
        .superRefine((aliases, context) => {
          if (Object.keys(aliases).length > 500) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "aliases must contain at most 500 tags",
            });
          }
        }),
      /** Revision read by the client before it began editing. */
      baseRevision: z
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      /** Baseline used to merge independent tag edits without losing either device's changes. */
      baseAliases: z
        .record(z.array(z.string().trim().max(200)).max(80))
        .superRefine((aliases, context) => {
          if (Object.keys(aliases).length > 500) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "baseAliases must contain at most 500 tags",
            });
          }
        })
        .optional(),
    })
    .strict(),

  idParam: z.object({ id: idLike }),
};
