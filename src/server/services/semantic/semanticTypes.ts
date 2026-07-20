export type SemanticDocumentType = 'faq' | 'page' | 'database_row' | 'journal' | 'attachment_summary';

export type SemanticChunk = {
  id: string;
  type: SemanticDocumentType;
  sourceId: string;
  parentPageId?: string;
  databaseId?: string;
  rowId?: string;
  /** v368: user-facing database title for DB row chunks. */
  databaseTitle?: string;
  /** v368: user-facing row title for DB row chunks. */
  rowTitle?: string;
  /** v368: compact DB property summary shown in evidence cards/prompts. */
  propertySummary?: string;
  title: string;
  text: string;
  keywords?: string[];
  tags?: string[];
  intentId?: string;
  /** Searchable metadata generated from title/properties/tags/intent. Used for ranking explanations. */
  semanticMetaText?: string;
  updatedAt?: string;
  /** Zero-based position within a long source split into semantic chunks. */
  chunkIndex?: number;
  /** Total semantic chunks created from the same source. */
  chunkCount?: number;
  url?: string;
};

export type SemanticIndexItem = SemanticChunk & {
  textHash: string;
  embedding: number[];
  dimension: number;
};

export type SemanticWorkspaceIndex = {
  version: 1;
  engine: 'workspace-semantic-ruri-v3-v3-chunked';
  model: string;
  dimension: number;
  generatedAt: string;
  /** Changes on every successful index build; safe cache invalidation token. */
  revision?: string;
  /** Embedding input profile used to decide whether existing vectors can be reused. */
  embeddingProfile?: string;
  indexedCount: number;
  available: boolean;
  error?: string;
  items: SemanticIndexItem[];
};

export type SemanticSearchResult = {
  chunk: SemanticChunk;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  titleScore?: number;
  /** Body-only lexical evidence. Used to prevent title-only related matches. */
  bodyScore?: number;
  metaScore?: number;
  relationBoost?: number;
  reasons: string[];
};

export type SemanticRelatedResult = {
  ok: true;
  target: SemanticChunk | null;
  generatedAt: string;
  /** Revision of the Semantic Index used for this result. */
  indexRevision?: string;
  indexedCount: number;
  available: boolean;
  /** True while the local-only Index cache is being hydrated after app launch. */
  warming?: boolean;
  groups: {
    pages: SemanticSearchResult[];
    faqs: SemanticSearchResult[];
    databaseRows: SemanticSearchResult[];
    journals: SemanticSearchResult[];
    attachments: SemanticSearchResult[];
  };
  results: SemanticSearchResult[];
  warning?: string;
  hiddenLowScoreCount?: number;
  qualityPolicy?: { minScore: number; minSemanticScore: number; mode: string };
};
