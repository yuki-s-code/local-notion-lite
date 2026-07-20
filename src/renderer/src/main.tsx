import { incrementalSemanticTargetFromQueueKey } from "../../shared/semantic/semanticTargetPolicy";
import { type WorkspaceMutationDetail } from "../../shared/workspace/workspaceMutation";
import { workspaceMutationCoordinator } from "../../shared/workspace/workspaceMutationCoordinator";
import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ApiClient, isApiError } from "./lib/api";
import type {
  AttachmentInfo,
  BacklinkInfo,
  ConflictInfo,
  DatabaseFilterOperator,
  DatabaseQueryResult,
  DatabaseView,
  HealthInfo,
  HistoryDiffResult,
  HistoryEntry,
  PageBundle,
  PageTreeNode,
  PageWithLock,
  WorkspaceDatabase,
  DatabasePropertyType,
  PageProperties,
  JournalEntry,
  JournalSummary,
  InboxItem,
  TaskItem,
  PageComment,
  PageActivityItem,
  WorkspaceScope,
  PageStatus,
  PagePriority,
  DatabaseRowLinkTarget,
  PageSidebarCounts,
  GlossaryTerm,
} from "../../shared/types";
import {
  BlockNotePageEditor,
  blockNoteToMarkdown,
  localBlocksToBlockNote,
  type BlockNoteDoc,
} from "./components/BlockNoteEditor";
import { DatabaseTable } from "./components/DatabaseTable";
import { QuickCaptureModal, InboxView } from "./components/screens/InboxScreen";
import { OcrCenterView } from "./components/screens/OcrCenterView";
import { SettingsModal } from "./components/screens/SettingsModal";
import { PageOutlinePanel } from "./components/screens/PageOutlinePanel";
import { PageMiniMapPanel } from "./components/screens/PageMiniMapPanel";
import { PageGlossaryPanel } from "./components/screens/PageGlossaryPanel";
import { WorkspaceRelatedPanel } from "./components/screens/WorkspaceRelatedPanel";
import { LocalSmartAssistView } from "./components/screens/SmartAssistScreen";
import { HomeDashboard } from "./components/screens/HomeDashboard";
import { PageContextStoryPanel } from "./components/screens/PageContextStoryPanel";
import { PageContextMenu } from "./components/menus/PageContextMenu";
import { VirtualPageTree } from "./components/screens/PageTreeItem";
import { CommandPalette } from "./components/screens/CommandPalette";
import {
  addCollectionItemToDefaultShelf,
  addCollectionItemToShelf,
  readCollectionShelves,
} from "./lib/collectionShelves";
import {
  CollectionShelfPickerDialog,
  type ShelfPickerItem,
} from "./components/workspace/CollectionShelfPickerDialog";
import {
  AttachmentManagerView,
  BackupCenterView,
  LinkManagerView,
  NotificationCenterView,
  TrashCenterView,
  WorkspaceAdminView,
} from "./components/screens/WorkspaceUtilityScreens";
import { DatabaseSidebarTree } from "./components/screens/DatabaseSidebarTree";
import { WikiManagementScreen } from "./components/screens/WikiManagementScreen";
import { ProjectHubScreen } from "./components/screens/ProjectHubScreen";
import { KnowledgeMapScreen } from "./components/screens/KnowledgeMapScreen";
import { AnalysisNotebookScreen } from "./components/screens/AnalysisNotebookScreen";
import { GlossaryManagerScreen } from "./components/screens/GlossaryManagerScreen";
import { FreeformCanvasScreen } from "./components/screens/FreeformCanvasScreen";
import { ExternalSourcesScreen } from "./components/screens/ExternalSourcesScreen";
import { WebBuilderScreen } from "./components/screens/WebBuilderScreen";
import { setActiveWebProjectId } from "./webBuilder/store";
import { WorkspaceExplorerScreen } from "./components/screens/WorkspaceExplorerScreen";
import { PageDiagnosisPanel } from "./components/screens/PageDiagnosisPanel";
import { WorkspaceWorkbench } from "./components/screens/WorkspaceWorkbench";
import { rememberWorkspaceScreen } from "./workspace/session";
import { workspaceScreenForMainMode } from "./workspace/mainModeBridge";
import { getWorkspaceScreen, listWorkspaceScreens } from "./workspace/registry";
import { WorkspaceFeatureTabs } from "./components/workspace/WorkspaceFeatureTabs";
import { WorkspaceLayoutControls } from "./components/workspace/WorkspaceLayoutControls";
import { WorkspaceErrorBoundary } from "./components/workspace/WorkspaceErrorBoundary";
import { closeWorkspaceFeatureTab, openWorkspaceFeatureTab, reorderWorkspaceFeatureTabs, replaceWorkspaceFeatureTabs, workspaceTabsStore } from "./workspace/tabs";
import { getWorkspacePreset, patchWorkspaceLayout, workspaceLayoutStore, type WorkspaceDensity, type WorkspacePresetId } from "./workspace/layout";
import { workspaceActions } from "./workspace/actions";
import type { WorkspaceScreenId } from "./workspace/types";
import { PersonalStickyNotes } from "./components/PersonalStickyNotes";
import { FloatingWorkspaceActions } from "./components/workspace/FloatingWorkspaceActions";
import { WorkspaceAiDrawer } from "./components/workspace/WorkspaceAiDrawer";
import { flushQueuedSave } from "./lib/saveCoordinator";
import { recordAiActivity } from "./lib/aiActivityLog";
import {
  suggestTagsFromContent,
  type TagSuggestion,
} from "./lib/tagSuggestions";
import {
  loadTagAliases,
  removeTagAliasEntry,
  saveTagAliases,
  updateTagAliases,
  type TagAliasMap,
} from "./lib/tagAliases";
import {
  getSimilarWorkspaceTagCandidates,
  getWorkspaceTagStats,
  moveTagAliases,
  replaceTagInList,
} from "./lib/tagWorkspace";
import {
  TAG_COLORS,
  TAG_GROUPS,
  normalizeTagPresentation,
  setTagPresentation as updateTagPresentation,
  tagPresentationFor,
  type TagPresentationMap,
} from "./lib/tagPresentation";
import { filterPagesByTags, normalizeTagFilterKey } from "./lib/tagPageFilter";
import {
  getTagSuggestionFeedbackScore,
  loadTagSuggestionFeedback,
  recordTagSuggestionFeedback,
  shouldHideDismissedSuggestion,
  type TagSuggestionFeedbackMap,
} from "./lib/tagSuggestionFeedback";
import { recordRecentWorkspaceItem } from "./lib/recentWorkspace";
import { useElectronBootstrap } from "./hooks/useElectronBootstrap";
import { useWorkspaceNavigationSession } from "./hooks/useWorkspaceNavigationSession";
import { useSaveRecovery } from "./hooks/useSaveRecovery";
import { useWorkspaceStartupSync } from "./hooks/useWorkspaceStartupSync";
import { usePageContextMenu } from "./hooks/usePageContextMenu";
import "./styles/app.css";

type WorkspaceSyncState = "ready" | "syncing" | "error" | "offline";

type ViewMode = "tree" | "search" | "databases" | "trash";
type AppDensity = "comfortable" | "compact";
type AppTheme = "light" | "soft";

type AppSettings = {
  density: AppDensity;
  theme: AppTheme;
  autoSaveDelayMs: number;
  journalStart: "today" | "last";
  commandHints: boolean;
};
const DEFAULT_APP_SETTINGS: AppSettings = {
  density: "comfortable",
  theme: "soft",
  autoSaveDelayMs: 900,
  journalStart: "today",
  commandHints: true,
};
function loadAppSettings(): AppSettings {
  try {
    const raw = JSON.parse(
      localStorage.getItem("local-notion:app-settings") || "{}",
    );
    return {
      ...DEFAULT_APP_SETTINGS,
      ...raw,
      density:
        raw.density === "compact"
          ? "compact"
          : raw.density === "comfortable"
            ? "comfortable"
            : DEFAULT_APP_SETTINGS.density,
      theme:
        raw.theme === "light"
          ? "light"
          : raw.theme === "soft"
            ? "soft"
            : DEFAULT_APP_SETTINGS.theme,
      autoSaveDelayMs: Number.isFinite(Number(raw.autoSaveDelayMs))
        ? Math.min(3000, Math.max(400, Number(raw.autoSaveDelayMs)))
        : DEFAULT_APP_SETTINGS.autoSaveDelayMs,
      journalStart: raw.journalStart === "last" ? "last" : "today",
      commandHints: raw.commandHints !== false,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

function formatTrashDate(value?: string | null) {
  if (!value) return "日時不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type MainMode =
  | "empty"
  | "home"
  | "page"
  | "database"
  | "trash"
  | "journal"
  | "inbox"
  | "ocr"
  | "tasks"
  | "attachments"
  | "links"
  | "admin"
  | "backup"
  | "notifications"
  | "smart"
  | "tags"
  | "glossary"
  | "wiki"
  | "projects"
  | "analysis"
  | "knowledge-map"
  | "external-sources"
  | "web-builder"
  | "explorer"
  | "canvas";
type BlockType =
  "paragraph" | "heading1" | "heading2" | "bullet" | "todo" | "quote" | "code";
type LocalBlock = {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
};
type LocalBlocksDoc = {
  version: 2;
  kind: "local-blocks";
  blocks: LocalBlock[];
};
type BlockNoteStoredDoc = {
  version: 1;
  kind: "blocknote";
  blocks: BlockNoteDoc;
};

type CommentBlockTarget = { blockId: string; preview: string; kind: string };

function textFromBlockContent(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        typeof part === "string" ? part : String(part?.text || ""),
      )
      .join("");
  return "";
}

function collectCommentBlockTargets(
  blocks: any[],
  out: CommentBlockTarget[] = [],
): CommentBlockTarget[] {
  if (!Array.isArray(blocks)) return out;
  for (const block of blocks) {
    const rawText = textFromBlockContent(block?.content)
      .replace(/\s+/g, " ")
      .trim();
    const children = Array.isArray(block?.children) ? block.children : [];
    if (block?.id && rawText) {
      out.push({
        blockId: String(block.id),
        preview: rawText.slice(0, 120),
        kind: String(block.type || "block"),
      });
    }
    if (children.length) collectCommentBlockTargets(children, out);
  }
  return out;
}

function extractCommentBlockTargets(
  doc: unknown,
  markdown: string,
): CommentBlockTarget[] {
  const blocks = Array.isArray((doc as any)?.blocks)
    ? (doc as any).blocks
    : Array.isArray(doc)
      ? (doc as any[])
      : [];
  const targets = collectCommentBlockTargets(blocks).slice(0, 80);
  if (targets.length) return targets;
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line, index) => ({
      blockId: `markdown_${index}`,
      preview: line.slice(0, 120),
      kind: "markdown",
    }));
}

type PageTemplateKey = "blank" | "meeting" | "faq" | "manual" | "task";
type PageTemplate = {
  key: PageTemplateKey;
  title: string;
  icon: string;
  description: string;
  blocks: BlockNoteDoc;
  properties?: Partial<PageProperties>;
};

function paragraph(text = ""): any {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text, styles: {} }] : [],
  };
}
function heading(text: string, level = 1): any {
  return {
    type: "heading",
    props: { level },
    content: [{ type: "text", text, styles: {} }],
  };
}
function bullet(text: string): any {
  return {
    type: "bulletListItem",
    content: [{ type: "text", text, styles: {} }],
  };
}
function checklist(text: string): any {
  return {
    type: "checkListItem",
    props: { checked: false },
    content: [{ type: "text", text, styles: {} }],
  };
}

const PAGE_TEMPLATES: PageTemplate[] = [
  {
    key: "blank",
    title: "空白ページ",
    icon: "📄",
    description: "何もないページから始めます。",
    blocks: [paragraph()],
  },
  {
    key: "meeting",
    title: "会議メモ",
    icon: "📝",
    description: "議題・決定事項・ToDoをすぐ書けます。",
    properties: { tags: ["会議"], status: "進行中" },
    blocks: [
      heading("会議メモ", 1),
      paragraph("日時："),
      paragraph("参加者："),
      heading("議題", 2),
      bullet(""),
      heading("決定事項", 2),
      bullet(""),
      heading("ToDo", 2),
      checklist(""),
    ],
  },
  {
    key: "faq",
    title: "FAQ",
    icon: "❓",
    description: "質問と回答を整理します。",
    properties: { tags: ["FAQ"], status: "確認待ち" },
    blocks: [
      heading("FAQ", 1),
      heading("質問", 2),
      paragraph(""),
      heading("回答", 2),
      paragraph(""),
      heading("補足", 2),
      bullet(""),
    ],
  },
  {
    key: "manual",
    title: "業務マニュアル",
    icon: "📘",
    description: "手順・注意点・関連リンクをまとめます。",
    properties: { tags: ["マニュアル"], status: "進行中" },
    blocks: [
      heading("業務マニュアル", 1),
      heading("概要", 2),
      paragraph(""),
      heading("手順", 2),
      bullet("1. "),
      bullet("2. "),
      heading("注意点", 2),
      bullet(""),
      heading("関連ページ", 2),
      paragraph("@"),
    ],
  },
  {
    key: "task",
    title: "タスク管理",
    icon: "✅",
    description: "やることをチェックリストで管理します。",
    properties: { tags: ["タスク"], status: "未着手" },
    blocks: [heading("タスク", 1), checklist(""), checklist(""), checklist("")],
  },
];

function blockNoteContentFromPage(page: PageBundle): BlockNoteDoc {
  const doc = page.blocksuite as Partial<BlockNoteStoredDoc> | null;
  if (doc?.kind === "blocknote" && Array.isArray(doc.blocks))
    return doc.blocks as BlockNoteDoc;
  return localBlocksToBlockNote(blocksFromPage(page));
}

const blockLabels: Record<BlockType, string> = {
  paragraph: "本文",
  heading1: "見出し1",
  heading2: "見出し2",
  bullet: "箇条書き",
  todo: "ToDo",
  quote: "引用",
  code: "コード",
};

function newBlock(type: BlockType = "paragraph", text = ""): LocalBlock {
  return {
    id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    text,
    checked: false,
  };
}

function blocksToMarkdown(blocks: LocalBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading1":
          return `# ${block.text}`;
        case "heading2":
          return `## ${block.text}`;
        case "bullet":
          return `- ${block.text}`;
        case "todo":
          return `- [${block.checked ? "x" : " "}] ${block.text}`;
        case "quote":
          return `> ${block.text}`;
        case "code":
          return `\`\`\`\n${block.text}\n\`\`\``;
        default:
          return block.text;
      }
    })
    .join("\n\n");
}

function markdownToBlocks(markdown: string): LocalBlock[] {
  if (!markdown.trim()) return [newBlock("paragraph")];
  return markdown.split(/\n{2,}/).map((part) => {
    const text = part.trimEnd();
    if (text.startsWith("# ")) return newBlock("heading1", text.slice(2));
    if (text.startsWith("## ")) return newBlock("heading2", text.slice(3));
    if (text.startsWith("- [x] "))
      return { ...newBlock("todo", text.slice(6)), checked: true };
    if (text.startsWith("- [ ] "))
      return { ...newBlock("todo", text.slice(6)), checked: false };
    if (text.startsWith("- ")) return newBlock("bullet", text.slice(2));
    if (text.startsWith("> ")) return newBlock("quote", text.slice(2));
    if (text.startsWith("```"))
      return newBlock(
        "code",
        text.replace(/^```\n?/, "").replace(/\n?```$/, ""),
      );
    return newBlock("paragraph", text);
  });
}

function blocksFromPage(page: PageBundle): LocalBlock[] {
  const doc = page.blocksuite as Partial<LocalBlocksDoc> | null;
  if (
    doc?.kind === "local-blocks" &&
    Array.isArray(doc.blocks) &&
    doc.blocks.length > 0
  ) {
    return doc.blocks as LocalBlock[];
  }
  return markdownToBlocks(page.markdown);
}

function scopeIcon(scope?: WorkspaceScope) {
  return scope === "private" ? "🔒" : "🌐";
}
function scopeLabel(scope?: WorkspaceScope) {
  return scope === "private" ? "Private" : "Shared";
}
function pageScope(page?: { scope?: WorkspaceScope } | null): WorkspaceScope {
  return page?.scope === "private" ? "private" : "shared";
}

/**
 * Applies a page metadata save to the already-rendered tree without fetching
 * the entire workspace.  Unchanged branches retain object identity, allowing
 * memoized sidebar items to avoid needless reconciliation after each autosave.
 */
function patchPageTreeNode(
  nodes: PageTreeNode[],
  savedMeta: PageBundle["meta"],
): PageTreeNode[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.id === savedMeta.id) {
      changed = true;
      return {
        ...node,
        ...savedMeta,
        children: node.children,
      };
    }
    const nextChildren = patchPageTreeNode(node.children, savedMeta);
    if (nextChildren !== node.children) {
      changed = true;
      return { ...node, children: nextChildren };
    }
    return node;
  });
  return changed ? nextNodes : nodes;
}
function workspaceScope(
  item?: { scope?: WorkspaceScope } | null,
): WorkspaceScope {
  return item?.scope === "private" ? "private" : "shared";
}
function scopeNotice(scope?: WorkspaceScope) {
  return workspaceScope({ scope }) === "private" ? "このPCだけ" : "共有";
}

const DEFAULT_PAGE_PROPERTIES: PageProperties = {
  tags: [],
  status: "未着手",
  assignee: "",
  dueDate: "",
  priority: "Mid",
  wikiStatus: "draft",
  wikiVerifiedAt: "",
  wikiReviewDue: "",
  wikiOwner: "",
  wikiSource: "",
  wikiSuccessorId: "",
};

function normalizePageProperties(
  input?: Partial<PageProperties> | null,
): PageProperties {
  return {
    tags: Array.isArray(input?.tags)
      ? input!.tags.map(String).filter(Boolean)
      : [],
    status: ["未着手", "進行中", "確認待ち", "完了", "保留"].includes(
      String(input?.status),
    )
      ? (input!.status as PageProperties["status"])
      : "未着手",
    assignee: input?.assignee ? String(input.assignee) : "",
    dueDate: input?.dueDate ? String(input.dueDate) : "",
    priority: ["Low", "Mid", "High"].includes(String(input?.priority))
      ? (input!.priority as PageProperties["priority"])
      : "Mid",
    wikiStatus: ["draft", "verified", "review", "archived"].includes(
      String(input?.wikiStatus),
    )
      ? input!.wikiStatus
      : "draft",
    wikiVerifiedAt: input?.wikiVerifiedAt ? String(input.wikiVerifiedAt) : "",
    wikiReviewDue: input?.wikiReviewDue ? String(input.wikiReviewDue) : "",
    wikiOwner: input?.wikiOwner ? String(input.wikiOwner) : "",
    wikiSource: input?.wikiSource ? String(input.wikiSource) : "",
    wikiSuccessorId: input?.wikiSuccessorId
      ? String(input.wikiSuccessorId)
      : "",
    projectRole: input?.projectRole === "project" ? "project" : undefined,
    projectId: input?.projectId ? String(input.projectId) : "",
    projectStatus: ["計画中", "進行中", "確認待ち", "完了", "保留"].includes(
      String(input?.projectStatus),
    )
      ? (input!.projectStatus as any)
      : "計画中",
    projectDueDate: input?.projectDueDate ? String(input.projectDueDate) : "",
    projectSummary: input?.projectSummary ? String(input.projectSummary) : "",
  };
}

type PageSaveSnapshot = {
  pageId: string;
  title: string;
  icon: string;
  properties: PageProperties;
  blocks: BlockNoteDoc;
  scope: WorkspaceScope;
  /** History is a checkpoint request and is intentionally excluded from content identity. */
  historyReason?: "manual" | "auto_checkpoint" | "metadata_changed";
  signature: string;
};

/**
 * The main page editor can receive BlockNote change events after a save even
 * when the document has not changed.  Use one canonical signature for the
 * client-side dirty check and the serialized save queue.
 */
function pageSaveSignature(input: Omit<PageSaveSnapshot, "signature">): string {
  const properties = normalizePageProperties(input.properties);
  try {
    return JSON.stringify({
      title: String(input.title || "無題"),
      icon: String(input.icon || "📄"),
      scope: input.scope === "private" ? "private" : "shared",
      properties: {
        tags: [...properties.tags],
        status: properties.status,
        assignee: properties.assignee,
        dueDate: properties.dueDate,
        priority: properties.priority,
        wikiStatus: properties.wikiStatus,
        wikiVerifiedAt: properties.wikiVerifiedAt,
        wikiReviewDue: properties.wikiReviewDue,
        wikiOwner: properties.wikiOwner,
        wikiSource: properties.wikiSource,
        wikiSuccessorId: properties.wikiSuccessorId,
      },
      blocks: input.blocks ?? [],
    });
  } catch {
    // BlockNote documents should be JSON serializable.  Keep a deterministic
    // fallback so an unexpected block never turns every onChange into a save.
    return [
      String(input.title || "無題"),
      String(input.icon || "📄"),
      input.scope === "private" ? "private" : "shared",
      blockNoteToMarkdown(input.blocks ?? []),
    ].join("\n---\n");
  }
}

const PAGE_HISTORY_CHECKPOINT_MS = 5 * 60 * 1000;

type PageHistoryCheckpointReason = NonNullable<
  PageSaveSnapshot["historyReason"]
>;

function strongerPageHistoryReason(
  current?: PageHistoryCheckpointReason,
  incoming?: PageHistoryCheckpointReason,
): PageHistoryCheckpointReason | undefined {
  const priority: Record<PageHistoryCheckpointReason, number> = {
    auto_checkpoint: 1,
    metadata_changed: 2,
    manual: 3,
  };
  if (!current) return incoming;
  if (!incoming) return current;
  return priority[incoming] >= priority[current] ? incoming : current;
}

type PagePropertyFilters = {
  status: "" | PageProperties["status"];
  priority: "" | PageProperties["priority"];
  assignee: string;
  tag: string;
  dueFrom: string;
  dueTo: string;
  locked: "all" | "locked" | "unlocked";
  overdueOnly: boolean;
};

const DEFAULT_PAGE_FILTERS: PagePropertyFilters = {
  status: "",
  priority: "",
  assignee: "",
  tag: "",
  dueFrom: "",
  dueTo: "",
  locked: "all",
  overdueOnly: false,
};

function flattenTree(nodes: PageTreeNode[]): PageTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function flattenPages(nodes: PageTreeNode[]): PageWithLock[] {
  return nodes.flatMap((node) => {
    const { children: _children, ...page } = node;
    return [page as PageWithLock, ...flattenPages(node.children)];
  });
}

function countDescendantPages(node: PageTreeNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendantPages(child),
    0,
  );
}

function dateKeyJst(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
    date,
  );
}

function formatJournalDisplayDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function getJournalWeekDays(centerDate: string): string[] {
  const base = new Date(`${centerDate}T00:00:00+09:00`);
  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setDate(base.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + index);
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
      d,
    );
  });
}

function compactJournalWeekRange(days: string[]): string {
  if (!days.length) return "";
  const first = new Date(`${days[0]}T00:00:00+09:00`);
  const last = new Date(`${days[days.length - 1]}T00:00:00+09:00`);
  return `${first.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} - ${last.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}`;
}

function journalWeekdayLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    weekday: "short",
  });
}

function journalDayNumber(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    day: "numeric",
  });
}

function getMonthKey(dateKey: string): string {
  return /^\d{4}-\d{2}/.test(dateKey) ? dateKey.slice(0, 7) : "";
}

function dateInRange(dateKey: string, start: string, end: string): boolean {
  return Boolean(dateKey) && dateKey >= start && dateKey <= end;
}

function makeJournalReview(
  items: JournalSummary[],
  pages: PageWithLock[],
  start: string,
  end: string,
) {
  const rangeJournals = items.filter((j) => dateInRange(j.date, start, end));
  const rangePages = pages.filter(
    (p) =>
      dateInRange(dateKeyJst(p.createdAt), start, end) ||
      dateInRange(dateKeyJst(p.updatedAt), start, end),
  );
  const tags = new Map<string, number>();
  const moods = new Map<string, number>();
  const weathers = new Map<string, number>();
  for (const j of rangeJournals) {
    (j.tags || []).forEach((tag) => tags.set(tag, (tags.get(tag) || 0) + 1));
    if (j.mood) moods.set(j.mood, (moods.get(j.mood) || 0) + 1);
    if (j.weather) weathers.set(j.weather, (weathers.get(j.weather) || 0) + 1);
  }
  const top = (map: Map<string, number>, limit = 6) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  return {
    journalCount: rangeJournals.length,
    pageCount: rangePages.length,
    topTags: top(tags),
    topMoods: top(moods, 4),
    topWeather: top(weathers, 4),
    recent: rangeJournals
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5),
  };
}

function formatShortDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function pageMatchesFilters(
  page: PageWithLock,
  filters: PagePropertyFilters,
): boolean {
  const props = normalizePageProperties(page.properties);
  if (filters.status && props.status !== filters.status) return false;
  if (filters.priority && props.priority !== filters.priority) return false;
  if (
    filters.assignee &&
    !props.assignee.toLowerCase().includes(filters.assignee.toLowerCase())
  )
    return false;
  if (
    filters.tag &&
    !props.tags.some((tag) =>
      tag.toLowerCase().includes(filters.tag.toLowerCase()),
    )
  )
    return false;
  if (filters.dueFrom && (!props.dueDate || props.dueDate < filters.dueFrom))
    return false;
  if (filters.dueTo && (!props.dueDate || props.dueDate > filters.dueTo))
    return false;
  if (filters.locked === "locked" && !page.isLocked) return false;
  if (filters.locked === "unlocked" && page.isLocked) return false;
  if (filters.overdueOnly) {
    const today = new Date().toISOString().slice(0, 10);
    if (!props.dueDate || props.dueDate >= today || props.status === "完了")
      return false;
  }
  return true;
}

function filterTreeByProperties(
  nodes: PageTreeNode[],
  filters: PagePropertyFilters,
): PageTreeNode[] {
  return nodes.flatMap((node) => {
    const children = filterTreeByProperties(node.children, filters);
    if (pageMatchesFilters(node, filters) || children.length > 0)
      return [{ ...node, children }];
    return [];
  });
}

function PageFilterPanel({
  filters,
  onChange,
  tags,
  assignees,
  resultCount,
  totalCount,
}: {
  filters: PagePropertyFilters;
  onChange: (filters: PagePropertyFilters) => void;
  tags: string[];
  assignees: string[];
  resultCount: number;
  totalCount: number;
}) {
  const hasFilter =
    JSON.stringify(filters) !== JSON.stringify(DEFAULT_PAGE_FILTERS);
  return (
    <div className="page-filter-panel">
      <div className="section-title">ページフィルター</div>
      <select
        value={filters.status}
        onChange={(e) =>
          onChange({
            ...filters,
            status: e.target.value as PagePropertyFilters["status"],
          })
        }
      >
        <option value="">全ステータス</option>
        {(["未着手", "進行中", "確認待ち", "完了", "保留"] as const).map(
          (status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ),
        )}
      </select>
      <select
        value={filters.priority}
        onChange={(e) =>
          onChange({
            ...filters,
            priority: e.target.value as PagePropertyFilters["priority"],
          })
        }
      >
        <option value="">全優先度</option>
        {(["Low", "Mid", "High"] as const).map((priority) => (
          <option key={priority} value={priority}>
            {priority}
          </option>
        ))}
      </select>
      <input
        list="assignee-options"
        value={filters.assignee}
        placeholder="担当者で絞り込み"
        onChange={(e) => onChange({ ...filters, assignee: e.target.value })}
      />
      <datalist id="assignee-options">
        {assignees.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <input
        list="tag-options"
        value={filters.tag}
        placeholder="タグで絞り込み"
        onChange={(e) => onChange({ ...filters, tag: e.target.value })}
      />
      <datalist id="tag-options">
        {tags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <div className="filter-date-row">
        <input
          type="date"
          value={filters.dueFrom}
          onChange={(e) => onChange({ ...filters, dueFrom: e.target.value })}
          title="期限 From"
        />
        <input
          type="date"
          value={filters.dueTo}
          onChange={(e) => onChange({ ...filters, dueTo: e.target.value })}
          title="期限 To"
        />
      </div>
      <select
        value={filters.locked}
        onChange={(e) =>
          onChange({
            ...filters,
            locked: e.target.value as PagePropertyFilters["locked"],
          })
        }
      >
        <option value="all">ロック指定なし</option>
        <option value="locked">ロック中のみ</option>
        <option value="unlocked">未ロックのみ</option>
      </select>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={filters.overdueOnly}
          onChange={(e) =>
            onChange({ ...filters, overdueOnly: e.target.checked })
          }
        />
        期限切れのみ
      </label>
      <div className="filter-summary">
        表示 {resultCount} / 全 {totalCount}
      </div>
      <button
        className="secondary"
        disabled={!hasFilter}
        onClick={() => onChange(DEFAULT_PAGE_FILTERS)}
      >
        フィルター解除
      </button>
    </div>
  );
}

function PropertyBadges({ properties }: { properties: PageProperties }) {
  const props = normalizePageProperties(properties);
  return (
    <div className="property-badges">
      <span className={`badge status-${props.status}`}>{props.status}</span>
      <span className={`badge priority-${props.priority}`}>
        {props.priority}
      </span>
      {props.assignee && <span className="badge">👤 {props.assignee}</span>}
      {props.dueDate && <span className="badge">📅 {props.dueDate}</span>}
      {props.tags.slice(0, 3).map((tag) => (
        <span className="badge tag" key={tag}>
          #{tag}
        </span>
      ))}
    </div>
  );
}

function cleanTagValue(value: string): string {
  return value.replace(/^#+/, "").trim();
}

function uniqTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const tag = cleanTagValue(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function TagInput({
  tags,
  suggestions,
  tagPresentation = {},
  disabled,
  onChange,
  placeholder = "タグを追加",
}: {
  tags: string[];
  suggestions: string[];
  tagPresentation?: TagPresentationMap;
  disabled?: boolean;
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const current = useMemo(() => uniqTags(tags), [tags]);
  const filtered = useMemo(() => {
    const q = cleanTagValue(draft).toLowerCase();
    return uniqTags(suggestions)
      .filter(
        (tag) => !current.some((t) => t.toLowerCase() === tag.toLowerCase()),
      )
      .filter((tag) => !q || tag.toLowerCase().includes(q))
      .slice(0, 12);
  }, [suggestions, current, draft]);

  const addTag = (value: string) => {
    const next = cleanTagValue(value);
    if (!next) return;
    onChange(uniqTags([...current, next]));
    setDraft("");
  };

  const removeTag = (value: string) => {
    onChange(
      current.filter((tag) => tag.toLowerCase() !== value.toLowerCase()),
    );
  };

  const commitDraft = () => {
    const parts = draft.split(/[，,]/).map(cleanTagValue).filter(Boolean);
    if (parts.length === 0) return;
    onChange(uniqTags([...current, ...parts]));
    setDraft("");
  };

  return (
    <div className="tag-input-shell">
      <div className="tag-chip-row">
        {current.map((tag) => (
          <span
            className={`tag-chip ${tagPresentationFor(tagPresentation, tag).color ? `tag-color-${tagPresentationFor(tagPresentation, tag).color}` : ""}`}
            key={tag}
          >
            #{tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`${tag}を削除`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            value={draft}
            placeholder={current.length ? "追加" : placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commitDraft();
              }
              if (e.key === "Backspace" && !draft && current.length > 0) {
                removeTag(current[current.length - 1]);
              }
            }}
            onBlur={commitDraft}
          />
        )}
      </div>
      {!disabled && filtered.length > 0 && (
        <div className="tag-suggestion-row">
          {filtered.map((tag) => (
            <button
              type="button"
              key={tag}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(tag);
              }}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoTagSuggestions({
  suggestions,
  disabled,
  onAdd,
  onAddAll,
  onDismiss,
}: {
  suggestions: TagSuggestion[];
  disabled?: boolean;
  onAdd: (tag: string) => void;
  onAddAll: (tags: string[]) => void;
  onDismiss: (tag: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="auto-tag-suggestions" aria-label="内容からのタグ候補">
      <div className="auto-tag-suggestions-header">
        <span>✨ 内容からの候補</span>
        <div className="auto-tag-suggestions-actions">
          <small>既存タグのみ・クリックで追加</small>
          {suggestions.length >= 2 && (
            <button
              type="button"
              className="auto-tag-add-all"
              disabled={disabled}
              onClick={() => onAddAll(suggestions.map((item) => item.tag))}
            >
              上位候補を追加
            </button>
          )}
        </div>
      </div>
      <div className="auto-tag-suggestion-row">
        {suggestions.map((suggestion) => (
          <div className="auto-tag-suggestion" key={suggestion.tag}>
            <button
              type="button"
              className="auto-tag-suggestion-add"
              disabled={disabled}
              title={
                suggestion.matchedIn === "title"
                  ? "タイトルに一致"
                  : suggestion.matchedIn === "body"
                    ? "本文に一致"
                    : suggestion.matchedIn === "both"
                      ? "タイトルと本文に一致"
                      : suggestion.matchedIn === "alias"
                        ? "登録した別名に一致"
                        : suggestion.relatedTo.length > 0
                          ? `#${suggestion.relatedTo.join("・#")} と過去ページで併用`
                          : "過去ページで併用"
              }
              onClick={() => onAdd(suggestion.tag)}
            >
              <span>#{suggestion.tag}</span>
              <small>
                {suggestion.matchedIn === "both"
                  ? "タイトル・本文"
                  : suggestion.matchedIn === "title"
                    ? "タイトル"
                    : suggestion.matchedIn === "body"
                      ? "本文"
                      : suggestion.matchedIn === "alias"
                        ? "別名"
                        : suggestion.relatedTo.length > 0
                          ? `#${suggestion.relatedTo.slice(0, 2).join("・#")} と関連`
                          : "関連タグ"}
                {suggestion.relatedCount >= 2
                  ? `・併用${suggestion.relatedCount}件`
                  : suggestion.usageCount >= 2
                    ? `・${suggestion.usageCount}件`
                    : ""}
              </small>
            </button>
            <button
              type="button"
              className="auto-tag-suggestion-dismiss"
              disabled={disabled}
              aria-label={`#${suggestion.tag}を候補から見送る`}
              title="今回は見送る（繰り返すと候補に出にくくなります）"
              onClick={() => onDismiss(suggestion.tag)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TagManagerPanel({
  tags,
  activeTags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  activeTags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const active = new Set(activeTags.map((tag) => tag.toLowerCase()));
  return (
    <details className="tag-manager">
      <summary>タグ管理</summary>
      <p className="muted-small">
        ページ・Journal・Inbox・DBで使われているタグ候補です。クリックでこのページに追加できます。
      </p>
      <div className="tag-manager-grid">
        {uniqTags(tags).length === 0 ? (
          <span className="muted-small">タグ候補はまだありません。</span>
        ) : (
          uniqTags(tags).map((tag) => {
            const selected = active.has(tag.toLowerCase());
            return (
              <button
                type="button"
                key={tag}
                className={selected ? "selected" : ""}
                onClick={() => (selected ? onRemove(tag) : onAdd(tag))}
              >
                #{tag}
              </button>
            );
          })
        )}
      </div>
    </details>
  );
}

type BulkTagSuggestionReviewItem = {
  page: PageWithLock;
  suggestions: TagSuggestion[];
};

function BulkTagSuggestionReview({
  api,
  pages,
  aliases,
  disabled,
  onOpenPage,
  onStatus,
  onRefresh,
}: {
  api: ApiClient | null;
  pages: PageWithLock[];
  aliases: TagAliasMap;
  disabled?: boolean;
  onOpenPage?: (pageId: string) => void;
  onStatus?: (message: string) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [items, setItems] = useState<BulkTagSuggestionReviewItem[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelledRef = useRef(false);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  const candidateTags = useMemo(
    () =>
      getWorkspaceTagStats(pages, aliases)
        .filter((item) => item.count > 0)
        .map((item) => item.tag),
    [pages, aliases],
  );

  const scan = async (scope: "untagged" | "all") => {
    if (!api || scanning) return;
    cancelledRef.current = false;
    setScanning(true);
    setItems([]);
    setSelected({});
    const reviewPages =
      scope === "untagged"
        ? pages.filter((page) => (page.properties?.tags ?? []).length === 0)
        : pages;
    const ordered = [...reviewPages].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    setProgress({ done: 0, total: ordered.length });
    onStatus?.(
      `${scope === "untagged" ? "タグなしページ" : "全ページ"}の候補を確認しています… 0/${ordered.length}`,
    );
    if (ordered.length === 0) {
      onStatus?.(
        scope === "untagged"
          ? "タグなしページはありません。"
          : "確認対象のページはありません。",
      );
      setScanning(false);
      return;
    }

    const usageCounts: Record<string, number> = {};
    const coOccurrence = new Map<string, Map<string, number>>();
    for (const page of pages) {
      const tags = uniqTags(page.properties?.tags ?? []);
      const keyed = tags
        .map((tag) => [normalizeTagKeyForUi(tag), tag] as const)
        .filter(([key]) => Boolean(key));
      for (const [key, label] of keyed) {
        usageCounts[key] = (usageCounts[key] ?? 0) + 1;
      }
      for (const [sourceKey] of keyed) {
        const related =
          coOccurrence.get(sourceKey) ?? new Map<string, number>();
        for (const [targetKey] of keyed) {
          if (sourceKey === targetKey) continue;
          related.set(targetKey, (related.get(targetKey) ?? 0) + 1);
        }
        coOccurrence.set(sourceKey, related);
      }
    }

    const found: BulkTagSuggestionReviewItem[] = [];
    let cursor = 0;
    let completed = 0;
    const workers = Array.from(
      { length: Math.min(3, Math.max(1, ordered.length)) },
      async () => {
        while (!cancelledRef.current) {
          const index = cursor++;
          if (index >= ordered.length) return;
          const meta = ordered[index];
          try {
            const page = await api.getPage(meta.id);
            const activeTags = uniqTags(page.meta.properties?.tags ?? []);
            const relatedTagCounts: Record<string, number> = {};
            const relatedTagLabels: Record<string, string[]> = {};
            for (const activeTag of activeTags) {
              const activeKey = normalizeTagKeyForUi(activeTag);
              const related = coOccurrence.get(activeKey);
              if (!related) continue;
              for (const [candidateKey, count] of related.entries()) {
                relatedTagCounts[candidateKey] =
                  (relatedTagCounts[candidateKey] ?? 0) + count;
                const labels = new Set(relatedTagLabels[candidateKey] ?? []);
                labels.add(activeTag);
                relatedTagLabels[candidateKey] = Array.from(labels);
              }
            }
            const suggestions = suggestTagsFromContent({
              title: page.meta.title,
              body: page.markdown,
              candidates: candidateTags,
              activeTags,
              usageCounts,
              relatedTagCounts,
              relatedTagLabels,
              aliases,
              limit: 3,
            });
            if (suggestions.length > 0)
              found.push({
                page: { ...meta, properties: page.meta.properties },
                suggestions,
              });
          } catch {
            // A page can be removed or temporarily unavailable while the review is running.
            // Skip it and continue; applying later re-reads each selected page to avoid stale writes.
          } finally {
            completed += 1;
            if (completed === ordered.length || completed % 5 === 0) {
              setProgress({ done: completed, total: ordered.length });
            }
          }
        }
      },
    );

    await Promise.all(workers);
    if (cancelledRef.current) {
      onStatus?.(
        `候補確認を中止しました（${completed}/${ordered.length}ページ）`,
      );
    } else {
      const sorted = found.sort(
        (a, b) =>
          b.suggestions[0].score - a.suggestions[0].score ||
          b.page.updatedAt.localeCompare(a.page.updatedAt),
      );
      setItems(sorted);
      setSelected(
        Object.fromEntries(
          sorted.map((item) => [
            item.page.id,
            item.suggestions.map((suggestion) => suggestion.tag),
          ]),
        ),
      );
      onStatus?.(
        sorted.length > 0
          ? `${sorted.length}ページにタグ候補があります。内容を確認して追加してください。`
          : "追加候補は見つかりませんでした。",
      );
    }
    setScanning(false);
  };

  const toggleTag = (pageId: string, tag: string) => {
    const key = normalizeTagKeyForUi(tag);
    setSelected((current) => {
      const previous = current[pageId] ?? [];
      const has = previous.some((value) => normalizeTagKeyForUi(value) === key);
      return {
        ...current,
        [pageId]: has
          ? previous.filter((value) => normalizeTagKeyForUi(value) !== key)
          : [...previous, tag],
      };
    });
  };

  const applySelected = async () => {
    if (!api || applying) return;
    const targets = items.filter(
      (item) => (selected[item.page.id] ?? []).length > 0,
    );
    if (targets.length === 0) {
      onStatus?.("追加する候補を選択してください。");
      return;
    }
    if (
      !window.confirm(
        `${targets.length}ページに選択したタグを追加します。\n本文・コメント・履歴は変更しません。ページごとに最新状態を読み直してから保存します。`,
      )
    )
      return;
    setApplying(true);
    onStatus?.(`選択したタグを追加しています… 0/${targets.length}`);
    let updated = 0;
    let processed = 0;
    const failed: string[] = [];
    for (const item of targets) {
      try {
        const latest = await api.getPage(item.page.id);
        const requested = selected[item.page.id] ?? [];
        const nextTags = uniqTags([
          ...(latest.meta.properties?.tags ?? []),
          ...requested,
        ]);
        if (nextTags.length === (latest.meta.properties?.tags ?? []).length)
          continue;
        await api.savePage({
          id: latest.meta.id,
          title: latest.meta.title,
          markdown: latest.markdown,
          blocksuite: latest.blocksuite,
          baseUpdatedAt: latest.meta.updatedAt,
          properties: { ...latest.meta.properties, tags: nextTags },
          icon: latest.meta.icon ?? null,
          scope: latest.meta.scope,
        });
        updated += 1;
      } catch {
        failed.push(item.page.title || item.page.id);
      }
      processed += 1;
      onStatus?.(
        `選択したタグを追加しています… ${processed}/${targets.length}`,
      );
    }
    await onRefresh?.();
    setItems((current) =>
      current.filter(
        (item) => !targets.some((target) => target.page.id === item.page.id),
      ),
    );
    setSelected({});
    const failedNote = failed.length
      ? ` 更新できなかったページ: ${failed.slice(0, 3).join("、")}${failed.length > 3 ? " ほか" : ""}`
      : "";
    onStatus?.(`${updated}ページにタグを追加しました。${failedNote}`);
    setApplying(false);
  };

  const totalSelected = Object.values(selected).reduce(
    (sum, tags) => sum + tags.length,
    0,
  );
  return (
    <section className="bulk-tag-review" aria-label="タグ候補を一括確認">
      <div className="bulk-tag-review-head">
        <div>
          <span className="eyebrow">REVIEW BEFORE APPLY</span>
          <h2>タグ候補をまとめて確認</h2>
          <p>
            既存タグだけを候補にします。自動では追加せず、本文の根拠を確認して選択したものだけを保存します。
          </p>
        </div>
        <div className="bulk-tag-review-actions">
          {scanning ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                cancelledRef.current = true;
              }}
            >
              確認を中止
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void scan("untagged")}
                disabled={disabled || !api || candidateTags.length === 0}
              >
                タグなしページを確認
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void scan("all")}
                disabled={disabled || !api || candidateTags.length === 0}
              >
                全ページを確認
              </button>
            </>
          )}
          {items.length > 0 ? (
            <button
              type="button"
              className="primary"
              onClick={() => void applySelected()}
              disabled={disabled || applying || totalSelected === 0}
            >
              {applying ? "追加中…" : `選択した候補を追加 (${totalSelected})`}
            </button>
          ) : null}
        </div>
      </div>
      {scanning ? (
        <div className="bulk-tag-review-progress">
          <span>
            ページを確認中… {progress.done}/{progress.total}
          </span>
          <progress value={progress.done} max={Math.max(1, progress.total)} />
        </div>
      ) : null}
      {!scanning && items.length === 0 ? (
        <div className="bulk-tag-review-empty">
          「候補を確認」を押すと、各ページのタイトル・本文・既存タグ・別名辞書から候補を作成します。
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="bulk-tag-review-list">
          {items.map((item) => {
            const selectedTags = selected[item.page.id] ?? [];
            return (
              <article key={item.page.id}>
                <div className="bulk-tag-review-page">
                  <button
                    type="button"
                    onClick={() => onOpenPage?.(item.page.id)}
                    title="ページを開く"
                  >
                    <span>{item.page.icon || "📄"}</span>
                    <strong>{item.page.title || "無題"}</strong>
                  </button>
                  <small>
                    現在:{" "}
                    {(item.page.properties?.tags ?? []).length
                      ? (item.page.properties?.tags ?? [])
                          .map((tag) => `#${tag}`)
                          .join(" ")
                      : "タグなし"}
                  </small>
                </div>
                <div className="bulk-tag-review-candidates">
                  {item.suggestions.map((suggestion) => {
                    const checked = selectedTags.some(
                      (tag) =>
                        normalizeTagKeyForUi(tag) ===
                        normalizeTagKeyForUi(suggestion.tag),
                    );
                    const reason =
                      suggestion.matchedIn === "both"
                        ? "タイトル・本文に一致"
                        : suggestion.matchedIn === "title"
                          ? "タイトルに一致"
                          : suggestion.matchedIn === "body"
                            ? "本文に一致"
                            : suggestion.matchedIn === "alias"
                              ? "別名に一致"
                              : suggestion.relatedTo.length
                                ? `#${suggestion.relatedTo.slice(0, 2).join("・#")} と関連`
                                : "関連タグ";
                    return (
                      <label key={suggestion.tag}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={applying}
                          onChange={() =>
                            toggleTag(item.page.id, suggestion.tag)
                          }
                        />
                        <span>
                          <b>#{suggestion.tag}</b>
                          <small>
                            {reason}
                            {suggestion.usageCount >= 2
                              ? ` ・${suggestion.usageCount}ページで利用`
                              : ""}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {items.length > 0 ? (
        <p className="bulk-tag-review-safety">
          候補の追加は、各ページの最新状態を読み直してからタグだけを更新します。保存競合・削除などで更新できないページは、他のページを止めずに結果として表示します。
        </p>
      ) : null}
    </section>
  );
}

function TagCoverageDashboard({
  pages,
  aliases,
  presentation,
  onOpenPage,
}: {
  pages: PageWithLock[];
  aliases: TagAliasMap;
  presentation: TagPresentationMap;
  onOpenPage?: (pageId: string) => void;
}) {
  const stats = useMemo(
    () => getWorkspaceTagStats(pages, aliases),
    [pages, aliases],
  );
  const activeStats = useMemo(
    () => stats.filter((item) => item.count > 0),
    [stats],
  );
  const untaggedPages = useMemo(
    () =>
      pages
        .filter((page) => (page.properties?.tags ?? []).length === 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [pages],
  );
  const crowdedPages = useMemo(
    () =>
      pages
        .filter((page) => (page.properties?.tags ?? []).length >= 6)
        .sort(
          (a, b) =>
            (b.properties?.tags ?? []).length -
              (a.properties?.tags ?? []).length ||
            b.updatedAt.localeCompare(a.updatedAt),
        ),
    [pages],
  );
  const groupCounts = useMemo(() => {
    const counts = new Map<string, { tags: number; assignments: number }>();
    for (const item of activeStats) {
      const group =
        tagPresentationFor(presentation, item.tag).group ?? "未分類";
      const current = counts.get(group) ?? { tags: 0, assignments: 0 };
      current.tags += 1;
      current.assignments += item.count;
      counts.set(group, current);
    }
    return Array.from(counts.entries()).sort(
      (a, b) =>
        b[1].assignments - a[1].assignments || a[0].localeCompare(b[0], "ja"),
    );
  }, [activeStats, presentation]);
  const coverage = pages.length
    ? Math.round(((pages.length - untaggedPages.length) / pages.length) * 100)
    : 0;

  return (
    <section className="tag-coverage-dashboard" aria-label="タグ利用状況">
      <div className="tag-coverage-dashboard-head">
        <div>
          <span className="eyebrow">TAG HEALTH</span>
          <h2>タグ利用状況</h2>
          <p>
            タグ漏れや付けすぎを確認し、候補レビューに進むための運用ダッシュボードです。
          </p>
        </div>
      </div>
      <div className="tag-coverage-metrics">
        <article>
          <span>タグ付与率</span>
          <strong>{coverage}%</strong>
          <small>
            {pages.length - untaggedPages.length}/{pages.length}ページ
          </small>
        </article>
        <article>
          <span>タグなしページ</span>
          <strong>{untaggedPages.length}</strong>
          <small>候補レビューの対象</small>
        </article>
        <article>
          <span>タグが多いページ</span>
          <strong>{crowdedPages.length}</strong>
          <small>6件以上のタグ</small>
        </article>
        <article>
          <span>分類済みタグ</span>
          <strong>
            {
              activeStats.filter((item) =>
                Boolean(tagPresentationFor(presentation, item.tag).group),
              ).length
            }
          </strong>
          <small>{activeStats.length}タグ中</small>
        </article>
      </div>
      <div className="tag-coverage-grid">
        <article className="tag-coverage-card">
          <div className="tag-console-card-head">
            <div>
              <strong>タグなしページ</strong>
              <span>更新が新しい順・最大8件</span>
            </div>
            <small>{untaggedPages.length}件</small>
          </div>
          {untaggedPages.length === 0 ? (
            <p className="tag-coverage-empty">
              すべてのページに少なくとも1つのタグがあります。
            </p>
          ) : (
            <div className="tag-coverage-list">
              {untaggedPages.slice(0, 8).map((page) => (
                <button
                  type="button"
                  key={page.id}
                  onClick={() => onOpenPage?.(page.id)}
                >
                  <span>{page.icon || "📄"}</span>
                  <strong>{page.title || "無題"}</strong>
                  <small>
                    {new Date(page.updatedAt).toLocaleDateString("ja-JP")}
                  </small>
                </button>
              ))}
            </div>
          )}
        </article>
        <article className="tag-coverage-card">
          <div className="tag-console-card-head">
            <div>
              <strong>タグが多いページ</strong>
              <span>整理の確認候補・最大8件</span>
            </div>
            <small>{crowdedPages.length}件</small>
          </div>
          {crowdedPages.length === 0 ? (
            <p className="tag-coverage-empty">
              6件以上のタグが付いたページはありません。
            </p>
          ) : (
            <div className="tag-coverage-list">
              {crowdedPages.slice(0, 8).map((page) => (
                <button
                  type="button"
                  key={page.id}
                  onClick={() => onOpenPage?.(page.id)}
                >
                  <span>{page.icon || "📄"}</span>
                  <strong>{page.title || "無題"}</strong>
                  <small>{(page.properties?.tags ?? []).length}タグ</small>
                </button>
              ))}
            </div>
          )}
        </article>
        <article className="tag-coverage-card tag-coverage-groups">
          <div className="tag-console-card-head">
            <div>
              <strong>グループ別の利用状況</strong>
              <span>利用中タグのみ</span>
            </div>
            <small>{groupCounts.length}分類</small>
          </div>
          {groupCounts.length === 0 ? (
            <p className="tag-coverage-empty">まだ利用中のタグがありません。</p>
          ) : (
            <div className="tag-coverage-group-list">
              {groupCounts.map(([group, count]) => (
                <div key={group}>
                  <span>{group}</span>
                  <strong>{count.tags}タグ</strong>
                  <small>{count.assignments}回</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function WorkspaceTagManager({
  pages,
  aliases,
  presentation,
  disabled,
  onPresentationChange,
  onRename,
  onMerge,
  onAliasesChange,
  onOpenPage,
  standalone = false,
}: {
  pages: PageWithLock[];
  aliases: TagAliasMap;
  presentation: TagPresentationMap;
  disabled?: boolean;
  onPresentationChange: (next: TagPresentationMap) => void;
  onRename: (from: string, to: string) => void;
  onMerge: (from: string, to: string) => void;
  onAliasesChange: (next: TagAliasMap) => void;
  onOpenPage?: (pageId: string) => void;
  standalone?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState("");
  const [sort, setSort] = useState<"usage" | "name">("usage");
  const [pageFilterTags, setPageFilterTags] = useState<string[]>([]);
  const [pageView, setPageView] = useState<"table" | "cards">("table");
  const [pageSort, setPageSort] = useState<"updated" | "title" | "created">(
    "updated",
  );
  const [pageQuery, setPageQuery] = useState("");
  const [pageGroupFilter, setPageGroupFilter] = useState<
    "" | (typeof TAG_GROUPS)[number]
  >("");
  const stats = useMemo(
    () => getWorkspaceTagStats(pages, aliases),
    [pages, aliases],
  );
  const activeStats = useMemo(
    () => stats.filter((item) => item.count > 0),
    [stats],
  );
  const unusedStats = useMemo(
    () => stats.filter((item) => item.count === 0),
    [stats],
  );
  const mergeCandidates = useMemo(
    () => getSimilarWorkspaceTagCandidates(activeStats, aliases),
    [activeStats, aliases],
  );
  const filtered = useMemo(() => {
    const q = query
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/^#+/, "")
      .trim();
    return activeStats
      .filter(
        (item) =>
          !q ||
          item.tag.normalize("NFKC").toLocaleLowerCase("ja-JP").includes(q) ||
          item.aliases.some((alias) => alias.includes(q)),
      )
      .sort((a, b) =>
        sort === "name"
          ? a.tag.localeCompare(b.tag, "ja")
          : b.count - a.count || a.tag.localeCompare(b.tag, "ja"),
      );
  }, [activeStats, query, sort]);
  const selectedStat =
    activeStats.find((item) => item.tag === selected) ??
    filtered[0] ??
    activeStats[0];
  const selectedKey = selectedStat
    ? normalizeTagKeyForUi(selectedStat.tag)
    : "";
  const selectedAliases = selectedKey ? (aliases[selectedKey] ?? []) : [];
  const selectedPresentation = selectedStat
    ? tagPresentationFor(presentation, selectedStat.tag)
    : {};
  const tagClassName = (tag: string) =>
    `tag-presentation tag-color-${tagPresentationFor(presentation, tag).color ?? "slate"}`;
  const target = draft.replace(/^#+/, "").trim();
  const mergeTargetExists = activeStats.some(
    (item) =>
      normalizeTagKeyForUi(item.tag) === normalizeTagKeyForUi(target) &&
      normalizeTagKeyForUi(item.tag) !== selectedKey,
  );
  const effectivePageFilterTags =
    pageFilterTags.length > 0
      ? pageFilterTags
      : selectedStat
        ? [selectedStat.tag]
        : [];
  const matchingPages = useMemo(
    () => filterPagesByTags(pages, effectivePageFilterTags),
    [pages, effectivePageFilterTags.join("\u0000")],
  );
  const pageViewRows = useMemo(() => {
    const normalizedQuery = pageQuery
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .trim();
    return matchingPages
      .filter((page) => {
        const tags = page.properties?.tags ?? [];
        const matchesQuery =
          !normalizedQuery ||
          [page.title, ...tags]
            .filter(Boolean)
            .some((value) =>
              value
                .normalize("NFKC")
                .toLocaleLowerCase("ja-JP")
                .includes(normalizedQuery),
            );
        const matchesGroup =
          !pageGroupFilter ||
          tags.some(
            (tag) =>
              tagPresentationFor(presentation, tag).group === pageGroupFilter,
          );
        return matchesQuery && matchesGroup;
      })
      .sort((a, b) => {
        if (pageSort === "title")
          return (a.title || "").localeCompare(b.title || "", "ja");
        if (pageSort === "created")
          return (b.createdAt || "").localeCompare(a.createdAt || "");
        return (b.updatedAt || "").localeCompare(a.updatedAt || "");
      });
  }, [matchingPages, pageQuery, pageGroupFilter, pageSort, presentation]);
  const taggedPages = pageViewRows.slice(0, 6);
  const togglePageFilterTag = (tag: string) => {
    const key = normalizeTagFilterKey(tag);
    setPageFilterTags((current) =>
      current.some((item) => normalizeTagFilterKey(item) === key)
        ? current.filter((item) => normalizeTagFilterKey(item) !== key)
        : [...current, tag],
    );
  };
  const totalAssignments = useMemo(
    () => activeStats.reduce((sum, item) => sum + item.count, 0),
    [activeStats],
  );
  const totalAliases = useMemo(
    () => stats.reduce((sum, item) => sum + item.aliases.length, 0),
    [stats],
  );
  const removeUnusedTag = (tag: string) => {
    const key = normalizeTagKeyForUi(tag);
    const item = unusedStats.find(
      (candidate) => normalizeTagKeyForUi(candidate.tag) === key,
    );
    if (!item || item.count > 0) return;
    if (
      !window.confirm(`#${item.tag} は現在どのページにも使われていません。
別名辞書からこの未使用タグを外しますか？
ページ本文・タグ・履歴は変更されません。`)
    )
      return;
    onAliasesChange(removeTagAliasEntry(aliases, item.tag));
    if (normalizeTagKeyForUi(selected) === key) setSelected("");
  };
  const pagesWithTags = useMemo(
    () =>
      pages.filter((page) => (page.properties?.tags ?? []).length > 0).length,
    [pages],
  );
  const selectTag = (tag: string) => {
    setSelected(tag);
    setDraft(tag);
  };
  const managerContent = (
    <>
      <div className="tag-console-overview" aria-label="タグの概要">
        <article>
          <span>利用中タグ</span>
          <strong>{activeStats.length}</strong>
          <small>ワークスペース全体</small>
        </article>
        <article>
          <span>タグ付きページ</span>
          <strong>{pagesWithTags}</strong>
          <small>{pages.length}ページ中</small>
        </article>
        <article>
          <span>タグの利用回数</span>
          <strong>{totalAssignments}</strong>
          <small>重複を除いて集計</small>
        </article>
        <article>
          <span>別名・表記ゆれ</span>
          <strong>{totalAliases}</strong>
          <small>共有辞書</small>
        </article>
      </div>
      <div className="tag-console-toolbar">
        <label className="tag-console-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="タグ名・別名を検索"
            aria-label="タグ名・別名を検索"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="検索をクリア"
            >
              ×
            </button>
          )}
        </label>
        <label className="tag-console-sort">
          並び順
          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as "usage" | "name")
            }
          >
            <option value="usage">使用件数順</option>
            <option value="name">名前順</option>
          </select>
        </label>
      </div>
      <section
        className="tag-console-unused-tags"
        aria-label="未使用タグの整理"
      >
        <div className="tag-console-card-head">
          <div>
            <strong>未使用タグの整理</strong>
            <span>ページで使われていない別名辞書の登録</span>
          </div>
          <small>{unusedStats.length}件</small>
        </div>
        <p>
          使用ページ数が0のタグは、別名辞書だけに残っています。辞書から外してもページ本文・タグ・履歴は変更されません。迷うものは残したままで問題ありません。
        </p>
        {unusedStats.length === 0 ? (
          <div className="tag-console-unused-empty">
            現在、整理が必要な未使用タグはありません。
          </div>
        ) : (
          <div className="tag-console-unused-list">
            {unusedStats.slice(0, 12).map((item) => (
              <article key={normalizeTagKeyForUi(item.tag)}>
                <div>
                  <strong>#{item.tag}</strong>
                  <span>
                    {item.aliases.length
                      ? `別名 ${item.aliases.length}件`
                      : "別名なし"}
                  </span>
                </div>
                {item.aliases.length ? (
                  <p>{item.aliases.map((alias) => `#${alias}`).join("  ")}</p>
                ) : (
                  <p>このタグはページにも別名にも実体がありません。</p>
                )}
                <button
                  type="button"
                  className="danger"
                  disabled={disabled}
                  onClick={() => removeUnusedTag(item.tag)}
                >
                  辞書から外す
                </button>
              </article>
            ))}
          </div>
        )}
        {unusedStats.length > 12 ? (
          <small className="muted-small">
            表示は先頭12件です。未使用タグは別名辞書の見直しで整理できます。
          </small>
        ) : null}
      </section>
      <section
        className="tag-console-merge-candidates"
        aria-label="似たタグの統合候補"
      >
        <div className="tag-console-card-head">
          <div>
            <strong>似たタグの統合候補</strong>
            <span>自動では変更しません</span>
          </div>
          <small>{mergeCandidates.length}件</small>
        </div>
        <p>
          別名辞書・表記の近さ・包含関係から、重複の可能性があるタグだけを表示します。内容を確認してから統合してください。
        </p>
        {mergeCandidates.length === 0 ? (
          <div className="tag-console-candidate-empty">
            現在、確認が必要な似たタグは見つかっていません。
          </div>
        ) : (
          <div className="tag-console-candidate-list">
            {mergeCandidates.map((candidate) => (
              <article
                key={`${candidate.sourceTag}\u0000${candidate.targetTag}`}
              >
                <div className="tag-console-candidate-tags">
                  <strong>#{candidate.sourceTag}</strong>
                  <span>→</span>
                  <strong>#{candidate.targetTag}</strong>
                </div>
                <div className="tag-console-candidate-reasons">
                  {candidate.reasons.join("・")}
                </div>
                <span className="tag-console-candidate-score">
                  確度 {candidate.score}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    selectTag(candidate.sourceTag);
                    setDraft(candidate.targetTag);
                  }}
                >
                  統合内容を確認
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
      <div
        className="tag-console-filterbar"
        aria-label="タグによるページ絞り込み"
      >
        <div>
          <strong>ページを絞り込み</strong>
          <span>複数タグを選ぶと、すべてを持つページだけを表示します。</span>
        </div>
        <div className="tag-console-filter-actions">
          <div className="tag-console-filter-chips">
            {pageFilterTags.length > 0 ? (
              pageFilterTags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => togglePageFilterTag(tag)}
                  title="この絞り込みを外す"
                >
                  #{tag} ×
                </button>
              ))
            ) : (
              <span>選択中のタグで表示</span>
            )}
          </div>
          {selectedStat ? (
            <button
              type="button"
              className="secondary"
              onClick={() => togglePageFilterTag(selectedStat.tag)}
            >
              {pageFilterTags.some(
                (tag) => normalizeTagFilterKey(tag) === selectedKey,
              )
                ? "選択タグを外す"
                : "選択タグを追加"}
            </button>
          ) : null}
          {pageFilterTags.length > 0 ? (
            <button
              type="button"
              className="link-button"
              onClick={() => setPageFilterTags([])}
            >
              絞り込みをリセット
            </button>
          ) : null}
        </div>
      </div>
      <div className="tag-console-layout">
        <section className="tag-console-list-panel" aria-label="タグ一覧">
          <div className="tag-console-section-head">
            <strong>タグ一覧</strong>
            <span>{filtered.length}件</span>
          </div>
          <div
            className="tag-console-list"
            role="listbox"
            aria-label="タグを選択"
          >
            {filtered.length === 0 ? (
              <div className="tag-console-empty">
                <strong>一致するタグはありません</strong>
                <span>検索語を変えてください。</span>
              </div>
            ) : (
              filtered.map((item) => {
                const isSelected = selectedStat?.tag === item.tag;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={isSelected ? "selected" : ""}
                    key={item.tag}
                    onClick={() => selectTag(item.tag)}
                  >
                    <span
                      className={`tag-console-tag ${tagClassName(item.tag)}`}
                    >
                      #{item.tag}
                    </span>
                    <span className="tag-console-row-meta">
                      <em>{item.count}</em>ページ
                      {item.aliases.length ? (
                        <small>別名 {item.aliases.length}</small>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section
          className="tag-console-detail-panel"
          aria-label="選択したタグの詳細"
        >
          {selectedStat ? (
            <>
              <div className="tag-console-detail-head">
                <div>
                  <span>選択中のタグ</span>
                  <h2>
                    <b className={tagClassName(selectedStat.tag)}>
                      #{selectedStat.tag}
                    </b>
                  </h2>
                  <p>
                    {selectedStat.count}
                    ページで利用中です。本文は変更せず、タグ情報だけを整理できます。
                  </p>
                </div>
                <span className="tag-console-usage">
                  {selectedStat.count}
                  <small>ページ</small>
                </span>
              </div>
              <div className="tag-console-detail-grid">
                <article className="tag-console-card tag-presentation-editor">
                  <div className="tag-console-card-head">
                    <strong>分類・色</strong>
                    <span>表示専用・共有設定</span>
                  </div>
                  <p>
                    タグを業務分野・年度・対象者・状態などに分類し、色を付けます。ページ本文やタグそのものは変更されません。
                  </p>
                  <label>
                    グループ
                    <select
                      value={selectedPresentation.group ?? ""}
                      disabled={disabled}
                      onChange={(event) =>
                        onPresentationChange(
                          updateTagPresentation(
                            presentation,
                            selectedStat.tag,
                            {
                              ...selectedPresentation,
                              group: event.target.value
                                ? (event.target
                                    .value as (typeof TAG_GROUPS)[number])
                                : undefined,
                            },
                          ),
                        )
                      }
                    >
                      <option value="">未分類</option>
                      {TAG_GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    className="tag-presentation-color-options"
                    aria-label="タグの色"
                  >
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        disabled={disabled}
                        className={
                          selectedPresentation.color === color
                            ? `selected tag-color-${color}`
                            : `tag-color-${color}`
                        }
                        onClick={() =>
                          onPresentationChange(
                            updateTagPresentation(
                              presentation,
                              selectedStat.tag,
                              { ...selectedPresentation, color },
                            ),
                          )
                        }
                      >
                        <i aria-hidden="true" />
                        {color === "slate"
                          ? "グレー"
                          : color === "blue"
                            ? "青"
                            : color === "cyan"
                              ? "水色"
                              : color === "green"
                                ? "緑"
                                : color === "amber"
                                  ? "黄"
                                  : color === "orange"
                                    ? "橙"
                                    : color === "red"
                                      ? "赤"
                                      : color === "purple"
                                        ? "紫"
                                        : "桃"}
                      </button>
                    ))}
                  </div>
                </article>
                <article className="tag-console-card">
                  <div className="tag-console-card-head">
                    <strong>別名・表記ゆれ</strong>
                    <span>候補表示に使います</span>
                  </div>
                  <p>
                    「学童,
                    学童保育」のようにカンマで区切って登録します。AI辞書とは別に、このタグへ確実に結び付く語だけを登録してください。
                  </p>
                  <textarea
                    value={selectedAliases.join(", ")}
                    disabled={disabled}
                    onChange={(event) =>
                      onAliasesChange(
                        updateTagAliases(
                          aliases,
                          selectedStat.tag,
                          event.target.value,
                        ),
                      )
                    }
                    placeholder="例：学童, 学童保育"
                    rows={3}
                  />
                </article>
                <article className="tag-console-card">
                  <div className="tag-console-card-head">
                    <strong>名前の整理</strong>
                    <span>タグのみ更新</span>
                  </div>
                  <p>
                    表記を統一する場合は名前を変更します。統合は、すでに登録済みのタグだけを統合先にできます。
                  </p>
                  <label>
                    新しいタグ名／統合先
                    <input
                      value={draft}
                      disabled={disabled}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="例：放課後児童クラブ"
                    />
                  </label>
                  <div className="tag-console-action-buttons">
                    <button
                      type="button"
                      disabled={
                        disabled ||
                        !target ||
                        normalizeTagKeyForUi(target) === selectedKey
                      }
                      onClick={() => onRename(selectedStat.tag, target)}
                    >
                      名前を変更
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={disabled || !mergeTargetExists}
                      onClick={() => onMerge(selectedStat.tag, target)}
                    >
                      既存タグへ統合
                    </button>
                  </div>
                  {!mergeTargetExists &&
                  target &&
                  normalizeTagKeyForUi(target) !== selectedKey ? (
                    <small className="muted-small">
                      統合するには、一覧にある既存タグ名を入力してください。
                    </small>
                  ) : null}
                </article>
              </div>
              <article className="tag-console-pages-card">
                <div className="tag-console-card-head">
                  <strong>使用しているページ</strong>
                  <span>更新日時が新しい順・最大6件</span>
                </div>
                {taggedPages.length === 0 ? (
                  <p className="muted-small">
                    条件に一致するページは見つかりません。
                  </p>
                ) : (
                  <div className="tag-console-pages-list">
                    {taggedPages.map((page) => (
                      <button
                        type="button"
                        key={page.id}
                        onClick={() => onOpenPage?.(page.id)}
                      >
                        <span>{page.icon || "📄"}</span>
                        <strong>{page.title || "無題"}</strong>
                        <small>
                          {new Date(page.updatedAt).toLocaleString("ja-JP")}
                        </small>
                      </button>
                    ))}
                  </div>
                )}
              </article>
              <p className="tag-console-safety-note">
                名前変更・統合は対象ページのタグだけを更新します。本文・コメント・履歴は変更しません。タグだけの変更はページ履歴を作成しません。
              </p>
            </>
          ) : (
            <div className="tag-console-empty large">
              <strong>まだタグがありません</strong>
              <span>
                ページのプロパティからタグを追加すると、ここで全体管理できます。
              </span>
            </div>
          )}
        </section>
      </div>
      <section className="tag-page-explorer" aria-label="タグ別ページ一覧">
        <header className="tag-page-explorer-head">
          <div className="tag-page-explorer-heading">
            <span className="tag-page-explorer-eyebrow">TAG EXPLORER</span>
            <div className="tag-page-explorer-title-row">
              <h2>タグ別ページ一覧</h2>
              <span className="tag-page-explorer-live">LIVE</span>
            </div>
            <p>
              {effectivePageFilterTags.length > 0
                ? `#${effectivePageFilterTags.join("  #")} をすべて持つページを表示しています。`
                : "タグを選ぶと、関連ページを一覧で確認できます。"}
            </p>
            {effectivePageFilterTags.length > 0 ? (
              <div
                className="tag-page-explorer-active-tags"
                aria-label="適用中のタグ条件"
              >
                {effectivePageFilterTags.map((tag) => (
                  <span key={tag} className={tagClassName(tag)}>
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="tag-page-explorer-count" aria-label="表示件数">
            <strong>{pageViewRows.length}</strong>
            <span>pages</span>
          </div>
        </header>
        <div className="tag-page-explorer-toolbar">
          <label className="tag-page-explorer-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={pageQuery}
              onChange={(event) => setPageQuery(event.target.value)}
              placeholder="ページ名・タグを検索"
              aria-label="ページ名・タグを検索"
            />
            {pageQuery ? (
              <button
                type="button"
                onClick={() => setPageQuery("")}
                aria-label="検索をクリア"
              >
                ×
              </button>
            ) : null}
          </label>
          <div className="tag-page-explorer-control-group">
            <label>
              <span>グループ</span>
              <select
                value={pageGroupFilter}
                onChange={(event) =>
                  setPageGroupFilter(
                    event.target.value as "" | (typeof TAG_GROUPS)[number],
                  )
                }
              >
                <option value="">すべて</option>
                {TAG_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>並び順</span>
              <select
                value={pageSort}
                onChange={(event) =>
                  setPageSort(
                    event.target.value as "updated" | "title" | "created",
                  )
                }
              >
                <option value="updated">更新が新しい順</option>
                <option value="created">作成が新しい順</option>
                <option value="title">タイトル順</option>
              </select>
            </label>
          </div>
          <div className="tag-page-explorer-view-switch" aria-label="表示形式">
            <button
              type="button"
              className={pageView === "table" ? "selected" : ""}
              onClick={() => setPageView("table")}
            >
              <span aria-hidden="true">☷</span>一覧
            </button>
            <button
              type="button"
              className={pageView === "cards" ? "selected" : ""}
              onClick={() => setPageView("cards")}
            >
              <span aria-hidden="true">▦</span>カード
            </button>
          </div>
        </div>
        {pageViewRows.length === 0 ? (
          <div className="tag-console-empty">
            <strong>一致するページはありません</strong>
            <span>タグ、グループ、検索語を見直してください。</span>
          </div>
        ) : pageView === "table" ? (
          <div
            className="tag-page-explorer-table"
            role="table"
            aria-label="タグ別ページ一覧"
          >
            <div className="tag-page-explorer-table-head" role="row">
              <span>ページ</span>
              <span>タグ</span>
              <span>状態</span>
              <span>更新日時</span>
            </div>
            {pageViewRows.map((page) => {
              const tags = page.properties?.tags ?? [];
              return (
                <button
                  type="button"
                  role="row"
                  key={page.id}
                  onClick={() => onOpenPage?.(page.id)}
                >
                  <span className="tag-page-explorer-title">
                    <i>{page.icon || "📄"}</i>
                    <b>{page.title || "無題"}</b>
                  </span>
                  <span className="tag-page-explorer-tags">
                    {tags.length ? (
                      tags.slice(0, 4).map((tag) => (
                        <em key={tag} className={tagClassName(tag)}>
                          #{tag}
                        </em>
                      ))
                    ) : (
                      <small>タグなし</small>
                    )}
                    {tags.length > 4 ? <small>+{tags.length - 4}</small> : null}
                  </span>
                  <span>
                    <small
                      className={
                        page.properties?.status
                          ? "tag-page-explorer-status is-set"
                          : "tag-page-explorer-status"
                      }
                    >
                      {page.properties?.status || "未設定"}
                    </small>
                  </span>
                  <time>
                    {new Date(page.updatedAt).toLocaleString("ja-JP")}
                  </time>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="tag-page-explorer-cards">
            {pageViewRows.map((page) => {
              const tags = page.properties?.tags ?? [];
              return (
                <button
                  type="button"
                  key={page.id}
                  onClick={() => onOpenPage?.(page.id)}
                >
                  <header>
                    <span>{page.icon || "📄"}</span>
                    <small
                      className={
                        page.properties?.status
                          ? "tag-page-explorer-status is-set"
                          : "tag-page-explorer-status"
                      }
                    >
                      {page.properties?.status || "未設定"}
                    </small>
                  </header>
                  <strong>{page.title || "無題"}</strong>
                  <div>
                    {tags.length ? (
                      tags.slice(0, 5).map((tag) => (
                        <em key={tag} className={tagClassName(tag)}>
                          #{tag}
                        </em>
                      ))
                    ) : (
                      <small>タグなし</small>
                    )}
                  </div>
                  <time>
                    更新 {new Date(page.updatedAt).toLocaleString("ja-JP")}
                  </time>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
  return standalone ? (
    <section className="workspace-tag-manager workspace-tag-manager-screen">
      {managerContent}
    </section>
  ) : (
    <details className="workspace-tag-manager">
      <summary>ワークスペースのタグを管理</summary>
      {managerContent}
    </details>
  );
}

function normalizeTagKeyForUi(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/^#+/, "")
    .trim();
}

function TagAliasManager({
  tags,
  aliases,
  disabled,
  onChange,
}: {
  tags: string[];
  aliases: TagAliasMap;
  disabled?: boolean;
  onChange: (next: TagAliasMap) => void;
}) {
  const sortedTags = uniqTags(tags);
  const [selectedTag, setSelectedTag] = useState("");
  const activeTag = selectedTag || sortedTags[0] || "";
  const key = activeTag
    .normalize("NFKC")
    .toLocaleLowerCase("ja-JP")
    .replace(/^#+/, "")
    .trim();
  const value = aliases[key]?.join(", ") ?? "";
  if (sortedTags.length === 0) return null;
  return (
    <details className="tag-alias-manager">
      <summary>タグの別名・表記ゆれ</summary>
      <p className="muted-small">
        例：#放課後児童クラブ に「学童,
        学童保育」を登録すると、本文中の別名から候補に出せます。この設定は共有ワークスペースに保存され、同じ共有フォルダを開く端末で共通になります。
      </p>
      <div className="tag-alias-manager-controls">
        <select
          value={activeTag}
          disabled={disabled}
          onChange={(event) => setSelectedTag(event.target.value)}
        >
          {sortedTags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
        <input
          value={value}
          disabled={disabled}
          placeholder="学童, 学童保育"
          onChange={(event) =>
            onChange(updateTagAliases(aliases, activeTag, event.target.value))
          }
        />
      </div>
    </details>
  );
}

function PagePropertiesPanel({
  properties,
  editing,
  onChange,
  allTags = [],
  tagPresentation = {},
  autoTagSuggestions = [],
  onAcceptTagSuggestion,
  onAcceptAllTagSuggestions,
  onDismissTagSuggestion,
}: {
  properties: PageProperties;
  editing: boolean;
  onChange: (properties: PageProperties) => void;
  allTags?: string[];
  tagPresentation?: TagPresentationMap;
  autoTagSuggestions?: TagSuggestion[];
  onAcceptTagSuggestion: (tag: string) => void;
  onAcceptAllTagSuggestions: (tags: string[]) => void;
  onDismissTagSuggestion: (tag: string) => void;
}) {
  return (
    <section className="page-properties-panel">
      <div className="property-row">
        <label>ステータス</label>
        <select
          value={properties.status}
          disabled={!editing}
          onChange={(e) =>
            onChange({
              ...properties,
              status: e.target.value as PageProperties["status"],
            })
          }
        >
          {(["未着手", "進行中", "確認待ち", "完了", "保留"] as const).map(
            (status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ),
          )}
        </select>
      </div>
      <div className="property-row">
        <label>優先度</label>
        <select
          value={properties.priority}
          disabled={!editing}
          onChange={(e) =>
            onChange({
              ...properties,
              priority: e.target.value as PageProperties["priority"],
            })
          }
        >
          {(["Low", "Mid", "High"] as const).map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </div>
      <div className="property-row">
        <label>担当者</label>
        <input
          value={properties.assignee}
          disabled={!editing}
          placeholder="担当者"
          onChange={(e) =>
            onChange({ ...properties, assignee: e.target.value })
          }
        />
      </div>
      <div className="property-row">
        <label>期限</label>
        <input
          type="date"
          value={properties.dueDate}
          disabled={!editing}
          onChange={(e) => onChange({ ...properties, dueDate: e.target.value })}
        />
      </div>
      <div className="wiki-properties-divider-v469">
        <span>Wiki管理</span>
        <small>正式情報の確認・更新管理</small>
      </div>
      <div className="property-row">
        <label>Wiki状態</label>
        <select
          value={properties.wikiStatus || "draft"}
          disabled={!editing}
          onChange={(e) =>
            onChange({ ...properties, wikiStatus: e.target.value as any })
          }
        >
          <option value="draft">下書き</option>
          <option value="review">確認待ち</option>
          <option value="verified">正式版</option>
          <option value="archived">廃止</option>
        </select>
      </div>
      <div className="property-row">
        <label>最終確認日</label>
        <input
          type="date"
          value={properties.wikiVerifiedAt || ""}
          disabled={!editing}
          onChange={(e) =>
            onChange({ ...properties, wikiVerifiedAt: e.target.value })
          }
        />
      </div>
      <div className="property-row">
        <label>次回確認日</label>
        <input
          type="date"
          value={properties.wikiReviewDue || ""}
          disabled={!editing}
          onChange={(e) =>
            onChange({ ...properties, wikiReviewDue: e.target.value })
          }
        />
      </div>
      <div className="property-row">
        <label>責任者</label>
        <input
          value={properties.wikiOwner || ""}
          disabled={!editing}
          placeholder="例：青少年育成課"
          onChange={(e) =>
            onChange({ ...properties, wikiOwner: e.target.value })
          }
        />
      </div>
      <div className="property-row property-row-wide">
        <label>根拠資料</label>
        <input
          value={properties.wikiSource || ""}
          disabled={!editing}
          placeholder="例：令和8年度 利用案内PDF"
          onChange={(e) =>
            onChange({ ...properties, wikiSource: e.target.value })
          }
        />
      </div>
      <div className="property-row property-row-wide">
        <label>後継ページID</label>
        <input
          value={properties.wikiSuccessorId || ""}
          disabled={!editing}
          placeholder="廃止時のみ入力（後継ページのID）"
          onChange={(e) =>
            onChange({ ...properties, wikiSuccessorId: e.target.value })
          }
        />
      </div>
      {properties.projectRole === "project" && (
        <>
          <div className="wiki-properties-divider-v469 project-properties-divider-v472">
            <span>案件管理</span>
            <small>案件Hubの進捗・期限・概要</small>
          </div>
          <div className="property-row">
            <label>案件状態</label>
            <select
              value={properties.projectStatus || "計画中"}
              disabled={!editing}
              onChange={(e) =>
                onChange({
                  ...properties,
                  projectStatus: e.target.value as any,
                })
              }
            >
              <option value="計画中">計画中</option>
              <option value="進行中">進行中</option>
              <option value="確認待ち">確認待ち</option>
              <option value="完了">完了</option>
              <option value="保留">保留</option>
            </select>
          </div>
          <div className="property-row">
            <label>案件期限</label>
            <input
              type="date"
              value={properties.projectDueDate || ""}
              disabled={!editing}
              onChange={(e) =>
                onChange({ ...properties, projectDueDate: e.target.value })
              }
            />
          </div>
          <div className="property-row property-row-wide">
            <label>案件概要</label>
            <input
              value={properties.projectSummary || ""}
              disabled={!editing}
              placeholder="目的・達成したい状態を簡潔に記載"
              onChange={(e) =>
                onChange({ ...properties, projectSummary: e.target.value })
              }
            />
          </div>
        </>
      )}
      <div className="property-row property-row-wide">
        <label>タグ</label>
        <TagInput
          tags={properties.tags}
          suggestions={allTags}
          tagPresentation={tagPresentation}
          disabled={!editing}
          onChange={(nextTags) => onChange({ ...properties, tags: nextTags })}
          placeholder="会議, FAQ, 重要"
        />
        <AutoTagSuggestions
          suggestions={autoTagSuggestions}
          disabled={!editing}
          onAdd={onAcceptTagSuggestion}
          onAddAll={onAcceptAllTagSuggestions}
          onDismiss={onDismissTagSuggestion}
        />
        <TagManagerPanel
          tags={allTags}
          activeTags={properties.tags}
          onAdd={(tag) =>
            onChange({
              ...properties,
              tags: uniqTags([...properties.tags, tag]),
            })
          }
          onRemove={(tag) =>
            onChange({
              ...properties,
              tags: properties.tags.filter(
                (t) => t.toLowerCase() !== tag.toLowerCase(),
              ),
            })
          }
        />
      </div>
    </section>
  );
}

type PageInfoTab = "properties" | "comments" | "history" | "links";

function PageCommentsPanel({
  comments,
  editing,
  blockTargets,
  onAdd,
  onToggle,
  onDelete,
}: {
  comments: PageComment[];
  editing: boolean;
  blockTargets: CommentBlockTarget[];
  onAdd: (input: {
    body: string;
    blockId?: string;
    blockPreview?: string;
  }) => void;
  onToggle: (comment: PageComment) => void;
  onDelete: (commentId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [targetId, setTargetId] = useState("page");
  const openComments = comments.filter((comment) => !comment.resolved);
  const resolvedComments = comments.filter((comment) => comment.resolved);
  function submit() {
    const body = draft.trim();
    if (!body || !editing) return;
    const target = blockTargets.find((t) => t.blockId === targetId);
    onAdd({ body, blockId: target?.blockId, blockPreview: target?.preview });
    setDraft("");
  }
  const renderComment = (comment: PageComment, resolved = false) => (
    <article
      className={resolved ? "comment-card resolved" : "comment-card"}
      key={comment.id}
    >
      <div className="comment-meta">
        <strong>{comment.author}</strong>
        <span>{new Date(comment.updatedAt).toLocaleString()}</span>
      </div>
      {comment.blockPreview && (
        <div className="block-comment-target">
          <span>本文ブロック</span>
          <em>{comment.blockPreview}</em>
        </div>
      )}
      <p>{comment.body}</p>
      <div className="comment-actions">
        <button onClick={() => onToggle(comment)}>
          {resolved ? "未解決に戻す" : "解決"}
        </button>
        <button className="danger" onClick={() => onDelete(comment.id)}>
          削除
        </button>
      </div>
    </article>
  );
  return (
    <div className="page-comments-panel">
      <div className="comment-composer">
        <div className="comment-composer-head">
          <div>
            <strong>コメントを追加</strong>
            <small>
              ページ全体、または本文ブロックを選んでコメントできます。
            </small>
          </div>
          <span>{blockTargets.length} blocks</span>
        </div>
        <label className="comment-target-label">コメント対象</label>
        <select
          value={targetId}
          disabled={!editing}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="page">ページ全体</option>
          {blockTargets.map((target) => (
            <option key={target.blockId} value={target.blockId}>
              {target.preview}
            </option>
          ))}
        </select>
        <textarea
          value={draft}
          disabled={!editing}
          placeholder={editing ? "コメントを追加..." : "閲覧専用です"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        <div className="comment-composer-footer">
          <small>Cmd / Ctrl + Enter で投稿</small>
          <button disabled={!editing || !draft.trim()} onClick={submit}>
            投稿
          </button>
        </div>
      </div>
      <div className="comment-list">
        {comments.length === 0 && (
          <p className="muted-small">コメントはまだありません。</p>
        )}
        {openComments.map((comment) => renderComment(comment))}
        {resolvedComments.length > 0 && (
          <details className="resolved-comments">
            <summary>解決済み {resolvedComments.length}</summary>
            {resolvedComments.map((comment) => renderComment(comment, true))}
          </details>
        )}
      </div>
    </div>
  );
}

type HistoryDiffDisplayRow = {
  kind: "same" | "added" | "removed" | "changed" | "gap";
  oldText?: string;
  newText?: string;
  oldLine?: number;
  newLine?: number;
};

function buildHistoryDiffRows(
  lines: HistoryDiffResult["lines"],
  showAll: boolean,
): HistoryDiffDisplayRow[] {
  const numbered = lines.map((line, index) => {
    const oldLine =
      lines.slice(0, index).filter((item) => item.type !== "added").length +
      (line.type !== "added" ? 1 : 0);
    const newLine =
      lines.slice(0, index).filter((item) => item.type !== "removed").length +
      (line.type !== "removed" ? 1 : 0);
    return {
      ...line,
      oldLine: line.type === "added" ? undefined : oldLine,
      newLine: line.type === "removed" ? undefined : newLine,
    };
  });
  const changed = numbered
    .map((line, index) => (line.type !== "same" ? index : -1))
    .filter((index) => index >= 0);
  if (!changed.length)
    return numbered.map((line) => ({
      kind: "same",
      oldText: line.text,
      newText: line.text,
      oldLine: line.oldLine,
      newLine: line.newLine,
    }));
  const include = new Set<number>();
  if (showAll) numbered.forEach((_, index) => include.add(index));
  else
    changed.forEach((index) => {
      for (
        let point = Math.max(0, index - 2);
        point <= Math.min(numbered.length - 1, index + 2);
        point++
      )
        include.add(point);
    });
  const rows: HistoryDiffDisplayRow[] = [];
  let index = 0;
  let previousIncluded = -2;
  while (index < numbered.length) {
    if (!include.has(index)) {
      index++;
      continue;
    }
    if (index > previousIncluded + 1) rows.push({ kind: "gap" });
    const line = numbered[index];
    if (line.type === "removed") {
      const removed = [] as typeof numbered;
      const added = [] as typeof numbered;
      while (
        index < numbered.length &&
        include.has(index) &&
        numbered[index].type === "removed"
      )
        removed.push(numbered[index++]);
      while (
        index < numbered.length &&
        include.has(index) &&
        numbered[index].type === "added"
      )
        added.push(numbered[index++]);
      const count = Math.max(removed.length, added.length);
      for (let pair = 0; pair < count; pair++) {
        const oldItem = removed[pair];
        const newItem = added[pair];
        rows.push({
          kind: oldItem && newItem ? "changed" : oldItem ? "removed" : "added",
          oldText: oldItem?.text,
          newText: newItem?.text,
          oldLine: oldItem?.oldLine,
          newLine: newItem?.newLine,
        });
      }
      previousIncluded = index - 1;
      continue;
    }
    if (line.type === "added") {
      rows.push({ kind: "added", newText: line.text, newLine: line.newLine });
    } else {
      rows.push({
        kind: "same",
        oldText: line.text,
        newText: line.text,
        oldLine: line.oldLine,
        newLine: line.newLine,
      });
    }
    previousIncluded = index;
    index++;
  }
  return rows;
}

function HistoryDiffView({ diff }: { diff: HistoryDiffResult }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(
    () => buildHistoryDiffRows(diff.lines, showAll),
    [diff.lines, showAll],
  );
  return (
    <div className="history-diff-card">
      <div className="history-diff-toolbar">
        <div className="history-diff-summary">
          <span className="history-diff-added">+ {diff.addedCount} 追加</span>
          <span className="history-diff-removed">
            − {diff.removedCount} 削除
          </span>
        </div>
        <button
          className="secondary history-diff-toggle"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "変更箇所だけ表示" : "すべての行を表示"}
        </button>
      </div>
      <div
        className="history-diff-table"
        role="table"
        aria-label="履歴との差分"
      >
        <div className="history-diff-table-head" role="row">
          <span>変更前</span>
          <span>変更後</span>
        </div>
        {rows.map((row, index) =>
          row.kind === "gap" ? (
            <div className="history-diff-gap" key={`gap-${index}`}>
              … 変更なしの行を省略 …
            </div>
          ) : (
            <div
              className={`history-diff-row history-diff-row-${row.kind}`}
              key={`${row.oldLine ?? "n"}-${row.newLine ?? "n"}-${index}`}
              role="row"
            >
              <div className="history-diff-cell history-diff-old">
                <span className="history-diff-line-number">
                  {row.oldLine ?? ""}
                </span>
                <code>{row.oldText ?? ""}</code>
              </div>
              <div className="history-diff-cell history-diff-new">
                <span className="history-diff-line-number">
                  {row.newLine ?? ""}
                </span>
                <code>{row.newText ?? ""}</code>
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function HistoryInspectorModal({
  historyPreview,
  historyDiff,
  onClose,
}: {
  historyPreview: PageBundle | null;
  historyDiff: HistoryDiffResult | null;
  onClose: () => void;
}) {
  if (!historyPreview && !historyDiff) return null;
  return createPortal(
    <div className="history-modal-backdrop" onMouseDown={onClose}>
      <section
        className="history-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="履歴の確認"
      >
        <div className="history-modal-head">
          <div>
            <strong>
              {historyPreview ? "履歴プレビュー" : "差分プレビュー"}
            </strong>
            <small>
              {historyPreview
                ? `${new Date(historyPreview.meta.updatedAt).toLocaleString()} / ${historyPreview.meta.updatedBy}`
                : "現在の本文との差分を表示しています"}
            </small>
          </div>
          <button
            className="icon-toolbar-button"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
        {historyPreview && (
          <div className="history-modal-body">
            <div className="history-modal-title">
              {historyPreview.meta.icon || "📄"} {historyPreview.meta.title}
            </div>
            <pre>{historyPreview.markdown || "本文なし"}</pre>
          </div>
        )}
        {historyDiff && (
          <div className="history-modal-body">
            <HistoryDiffView diff={historyDiff} />
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

function PageInfoPanel({
  initialTab = "properties",
  properties,
  editing,
  onChange,
  history,
  historyPreview,
  historyDiff,
  onPreviewHistory,
  onShowHistoryDiff,
  onCloseHistoryInspect,
  onRestoreHistory,
  markdown,
  pageTitle,
  api,
  pages,
  databases,
  databaseRowLinks = [],
  backlinks,
  comments,
  blockTargets,
  activity,
  onAddComment,
  onToggleComment,
  onDeleteComment,
  onOpenPage,
  onOpenDatabase,
  onOpenDatabaseRow,
  allTags = [],
  tagAliases,
  tagPresentation = {},
  sidebarCounts,
  onRequestTabData,
}: {
  initialTab?: PageInfoTab;
  properties: PageProperties;
  editing: boolean;
  onChange: (properties: PageProperties) => void;
  history: HistoryEntry[];
  historyPreview: PageBundle | null;
  historyDiff: HistoryDiffResult | null;
  onPreviewHistory: (historyId: string) => void;
  onShowHistoryDiff: (historyId: string) => void;
  onCloseHistoryInspect: () => void;
  onRestoreHistory: (historyId: string) => void;
  markdown: string;
  pageTitle: string;
  api: ApiClient | null;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  databaseRowLinks?: DatabaseRowLinkTarget[];
  backlinks: BacklinkInfo[];
  comments: PageComment[];
  blockTargets: CommentBlockTarget[];
  activity: PageActivityItem[];
  onAddComment: (input: {
    body: string;
    blockId?: string;
    blockPreview?: string;
  }) => void;
  onToggleComment: (comment: PageComment) => void;
  onDeleteComment: (commentId: string) => void;
  onOpenPage: (id: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  allTags?: string[];
  tagAliases: TagAliasMap;
  tagPresentation?: TagPresentationMap;
  /** Accurate lightweight counts loaded independently of the lazy detail tabs. */
  sidebarCounts: PageSidebarCounts | null;
  onRequestTabData?: (tab: PageInfoTab) => void;
}) {
  const resolvedInitialTab: PageInfoTab = initialTab ?? "properties";
  const [tab, setTab] = useState<PageInfoTab>(resolvedInitialTab);
  useEffect(() => {
    setTab(resolvedInitialTab);
    onRequestTabData?.(resolvedInitialTab);
    // The callback is intentionally not a dependency: the parent creates it
    // inline, while only a real initial-tab change should reset this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInitialTab]);

  function selectTab(nextTab: PageInfoTab) {
    setTab(nextTab);
    onRequestTabData?.(nextTab);
  }

  const [tagSuggestionFeedback, setTagSuggestionFeedback] =
    useState<TagSuggestionFeedbackMap>(() => loadTagSuggestionFeedback());
  const [dismissedTagSuggestions, setDismissedTagSuggestions] = useState<
    string[]
  >([]);
  const links = extractPageLinks(markdown, pages);
  const embedded = extractDatabaseEmbeds(markdown, databases);
  const dbRowLinks = extractDatabaseRowLinksFromMarkdown(
    markdown,
    databaseRowLinks,
  );
  const { tagUsageCounts, relatedTagCounts, relatedTagLabels } = useMemo(() => {
    const usageCounts: Record<string, number> = {};
    const relatedCounts: Record<string, number> = {};
    const relatedLabels = new Map<string, Set<string>>();
    const activeTagMap = new Map(
      properties.tags.map((rawTag) => {
        const label = rawTag.replace(/^#+/, "").trim();
        return [
          label.normalize("NFKC").toLocaleLowerCase("ja-JP"),
          label,
        ] as const;
      }),
    );

    for (const page of pages) {
      const pageTags = Array.from(
        new Map(
          (page.properties?.tags ?? []).map((rawTag) => {
            const label = rawTag.replace(/^#+/, "").trim();
            return [
              label.normalize("NFKC").toLocaleLowerCase("ja-JP"),
              label,
            ] as const;
          }),
        ).values(),
      ).filter(Boolean);
      const pageTagKeys = new Set(
        pageTags.map((tag) => tag.normalize("NFKC").toLocaleLowerCase("ja-JP")),
      );

      for (const rawTag of pageTags) {
        const key = rawTag.normalize("NFKC").toLocaleLowerCase("ja-JP");
        usageCounts[key] = (usageCounts[key] ?? 0) + 1;
      }

      const matchedActive = Array.from(activeTagMap.entries()).filter(([key]) =>
        pageTagKeys.has(key),
      );
      if (matchedActive.length === 0) continue;

      for (const rawTag of pageTags) {
        const key = rawTag.normalize("NFKC").toLocaleLowerCase("ja-JP");
        if (activeTagMap.has(key)) continue;
        relatedCounts[key] = (relatedCounts[key] ?? 0) + 1;
        const labels = relatedLabels.get(key) ?? new Set<string>();
        for (const [, activeLabel] of matchedActive) labels.add(activeLabel);
        relatedLabels.set(key, labels);
      }
    }

    return {
      tagUsageCounts: usageCounts,
      relatedTagCounts: relatedCounts,
      relatedTagLabels: Object.fromEntries(
        Array.from(relatedLabels.entries()).map(([key, labels]) => [
          key,
          Array.from(labels),
        ]),
      ) as Record<string, string[]>,
    };
  }, [pages, properties.tags]);

  const autoTagSuggestions = useMemo(
    () =>
      suggestTagsFromContent({
        title: pageTitle,
        body: markdown,
        candidates: allTags,
        activeTags: properties.tags,
        usageCounts: tagUsageCounts,
        relatedTagCounts,
        relatedTagLabels,
        aliases: tagAliases,
        feedbackScores: Object.fromEntries(
          Object.entries(tagSuggestionFeedback).map(([tag, feedback]) => [
            tag,
            getTagSuggestionFeedbackScore(feedback),
          ]),
        ),
        hiddenCandidates: [
          ...dismissedTagSuggestions,
          ...Object.entries(tagSuggestionFeedback)
            .filter(([, feedback]) => shouldHideDismissedSuggestion(feedback))
            .map(([tag]) => tag),
        ],
        limit: 5,
      }),
    [
      pageTitle,
      markdown,
      allTags,
      properties.tags,
      tagUsageCounts,
      relatedTagCounts,
      relatedTagLabels,
      tagSuggestionFeedback,
      dismissedTagSuggestions,
      tagAliases,
    ],
  );

  return (
    <section className="page-info-panel">
      <div className="page-info-tabs">
        <button
          className={tab === "properties" ? "active" : ""}
          onClick={() => selectTab("properties")}
        >
          基本情報
        </button>
        <button
          className={tab === "comments" ? "active" : ""}
          onClick={() => selectTab("comments")}
        >
          コメント{" "}
          <span>{sidebarCounts ? sidebarCounts.commentsOpen : "…"}</span>
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => selectTab("history")}
        >
          履歴 <span>{sidebarCounts ? sidebarCounts.history : "…"}</span>
          {sidebarCounts && (sidebarCounts.conflicts ?? 0) > 0 && (
            <small className="page-info-conflict-count">
              競合 {sidebarCounts.conflicts}
            </small>
          )}
        </button>
        <button
          className={tab === "links" ? "active" : ""}
          onClick={() => selectTab("links")}
        >
          リンク{" "}
          <span>
            {links.length +
              dbRowLinks.length +
              embedded.length +
              (sidebarCounts?.backlinks ?? 0)}
          </span>
        </button>
      </div>
      {tab === "properties" && (
        <PagePropertiesPanel
          properties={properties}
          editing={editing}
          onChange={onChange}
          allTags={allTags}
          tagPresentation={tagPresentation}
          autoTagSuggestions={autoTagSuggestions}
          onAcceptTagSuggestion={(tag) => {
            setTagSuggestionFeedback((current) =>
              recordTagSuggestionFeedback(current, tag, "accepted"),
            );
            onChange({
              ...properties,
              tags: uniqTags([...properties.tags, tag]),
            });
          }}
          onAcceptAllTagSuggestions={(tags) => {
            setTagSuggestionFeedback((current) =>
              tags.reduce(
                (next, tag) =>
                  recordTagSuggestionFeedback(next, tag, "accepted"),
                current,
              ),
            );
            onChange({
              ...properties,
              tags: uniqTags([...properties.tags, ...tags]),
            });
          }}
          onDismissTagSuggestion={(tag) => {
            setTagSuggestionFeedback((current) =>
              recordTagSuggestionFeedback(current, tag, "dismissed"),
            );
            setDismissedTagSuggestions((current) =>
              current.includes(tag) ? current : [...current, tag],
            );
          }}
        />
      )}
      {tab === "comments" && (
        <PageCommentsPanel
          comments={comments}
          editing={editing}
          blockTargets={blockTargets}
          onAdd={onAddComment}
          onToggle={onToggleComment}
          onDelete={onDeleteComment}
        />
      )}
      {tab === "history" && (
        <div className="page-info-section history-tab-panel">
          <div className="activity-timeline">
            {activity.length === 0 ? (
              <p className="muted-small">変更履歴はまだありません。</p>
            ) : (
              activity.slice(0, 40).map((item) => (
                <div
                  className={`activity-item activity-${item.type}`}
                  key={item.id}
                >
                  <div className="activity-dot">
                    {item.type === "comment"
                      ? "💬"
                      : item.type === "comment_resolved"
                        ? "✅"
                        : "🕘"}
                  </div>
                  <div className="activity-body">
                    <div className="activity-head">
                      <strong>{item.title}</strong>
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{item.description}</p>
                    <small>{item.createdBy}</small>
                    {item.historyId && (
                      <div className="history-actions">
                        <button
                          onClick={() => onPreviewHistory(item.historyId!)}
                        >
                          表示
                        </button>
                        <button
                          onClick={() => onShowHistoryDiff(item.historyId!)}
                        >
                          差分
                        </button>
                        <button
                          onClick={() => onRestoreHistory(item.historyId!)}
                          disabled={editing}
                        >
                          復元
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {tab === "links" && (
        <div className="page-info-section page-info-links">
          <div className="section-title">バックリンク</div>
          {backlinks.length === 0 ? (
            <p className="muted-small">
              このページへのリンク元はまだありません。
            </p>
          ) : (
            backlinks.map((link, index) => (
              <button
                key={
                  link.sourcePageId ||
                  `${link.sourceDatabaseId}:${link.sourceRowId}:${index}`
                }
                onClick={() => {
                  if (
                    link.sourceType === "database-row" &&
                    link.sourceDatabaseId &&
                    link.sourceRowId
                  ) {
                    onOpenDatabaseRow?.(
                      link.sourceDatabaseId,
                      link.sourceRowId,
                    );
                    return;
                  }
                  if (link.sourcePageId) onOpenPage(link.sourcePageId);
                }}
                title={
                  link.snippet || link.sourcePageId || link.sourceRowId || ""
                }
              >
                {link.sourceIcon ??
                  (link.sourceType === "database-row" ? "🧾" : "📄")}{" "}
                {link.sourceTitle}
                {link.snippet && <small>{link.snippet}</small>}
              </button>
            ))
          )}
          <div className="section-title">このページからのリンク</div>
          {links.length === 0 ? (
            <p className="muted-small">リンクされたページはありません。</p>
          ) : (
            links.map((link) => {
              const page = pages.find((p) => p.id === link.pageId);
              return (
                <button
                  key={link.pageId}
                  onClick={() => page && onOpenPage(page.id)}
                  disabled={!page}
                  title={page ? page.id : "ページが見つかりません"}
                >
                  📄 {page?.title ?? link.title}{" "}
                  {!page && <span className="missing-link">missing</span>}
                </button>
              );
            })
          )}
          <div className="section-title">リンクされたDB行</div>
          {dbRowLinks.length === 0 ? (
            <p className="muted-small">リンクされたDB行はありません。</p>
          ) : (
            dbRowLinks.map((link) => (
              <button
                key={`${link.databaseId}:${link.rowId}`}
                onClick={() => onOpenDatabaseRow?.(link.databaseId, link.rowId)}
                title={`${link.databaseId} / ${link.rowId}`}
              >
                🧾 {link.title}
              </button>
            ))
          )}
          <div className="section-title">リンクされたデータベース</div>
          {embedded.length === 0 ? (
            <p className="muted-small">
              リンクされたデータベースはありません。
            </p>
          ) : (
            embedded.map((db) => (
              <button
                className="linked-db-chip"
                key={db.database.id}
                onClick={() => onOpenDatabase?.(db.database.id)}
                title={db.database.id}
              >
                🗃️ {db.database.title}
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function BlockEditor({
  blocks,
  editing,
  onChange,
}: {
  blocks: LocalBlock[];
  editing: boolean;
  onChange: (blocks: LocalBlock[]) => void;
}) {
  function updateBlock(id: string, patch: Partial<LocalBlock>) {
    onChange(
      blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    );
  }

  function addBlockAfter(afterId: string, type: BlockType = "paragraph") {
    const idx = blocks.findIndex((block) => block.id === afterId);
    const next = [...blocks];
    next.splice(idx + 1, 0, newBlock(type));
    onChange(next);
  }

  function removeBlock(id: string) {
    if (blocks.length === 1) {
      onChange([{ ...blocks[0], text: "", type: "paragraph", checked: false }]);
      return;
    }
    onChange(blocks.filter((block) => block.id !== id));
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const idx = blocks.findIndex((block) => block.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="block-editor">
      {blocks.map((block, index) => (
        <div className={`block-row block-${block.type}`} key={block.id}>
          <div className="block-tools">
            <select
              value={block.type}
              disabled={!editing}
              onChange={(e) =>
                updateBlock(block.id, { type: e.target.value as BlockType })
              }
            >
              {Object.entries(blockLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              disabled={!editing || index === 0}
              onClick={() => moveBlock(block.id, -1)}
            >
              ↑
            </button>
            <button
              disabled={!editing || index === blocks.length - 1}
              onClick={() => moveBlock(block.id, 1)}
            >
              ↓
            </button>
            <button disabled={!editing} onClick={() => addBlockAfter(block.id)}>
              ＋
            </button>
            <button disabled={!editing} onClick={() => removeBlock(block.id)}>
              削除
            </button>
          </div>
          <div className="block-content">
            {block.type === "todo" && (
              <input
                className="todo-check"
                type="checkbox"
                checked={Boolean(block.checked)}
                disabled={!editing}
                onChange={(e) =>
                  updateBlock(block.id, { checked: e.target.checked })
                }
              />
            )}
            {block.type === "code" ? (
              <textarea
                value={block.text}
                disabled={!editing}
                onChange={(e) =>
                  updateBlock(block.id, { text: e.target.value })
                }
                placeholder="コードを入力"
              />
            ) : (
              <input
                value={block.text}
                disabled={!editing}
                onChange={(e) =>
                  updateBlock(block.id, { text: e.target.value })
                }
                placeholder={
                  block.type === "paragraph"
                    ? "本文を入力"
                    : blockLabels[block.type]
                }
              />
            )}
          </div>
        </div>
      ))}
      <div className="block-add-row">
        {(
          [
            "paragraph",
            "heading1",
            "heading2",
            "bullet",
            "todo",
            "quote",
            "code",
          ] as BlockType[]
        ).map((type) => (
          <button
            key={type}
            disabled={!editing}
            onClick={() => onChange([...blocks, newBlock(type)])}
          >
            ＋ {blockLabels[type]}
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplatePicker({
  onSelect,
}: {
  onSelect: (template: PageTemplate) => void;
}) {
  return (
    <div className="template-picker">
      <div className="section-title">テンプレート</div>
      {PAGE_TEMPLATES.map((template) => (
        <button key={template.key} onClick={() => onSelect(template)}>
          <span>
            {template.icon} {template.title}
          </span>
          <small>{template.description}</small>
        </button>
      ))}
    </div>
  );
}

function dbText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function isFilledDatabaseValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return dbText(value).trim().length > 0;
}

function isCheckedDatabaseValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = dbText(value).trim().toLowerCase();
  return [
    "true",
    "1",
    "yes",
    "y",
    "on",
    "checked",
    "完了",
    "済",
    "済み",
  ].includes(text);
}

function toDatabaseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = dbText(value).trim().replace(/,/g, "").replace(/%$/, "");
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function formatPercent(done: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((done / total) * 100)}%`;
}

function getActiveView(database: WorkspaceDatabase): DatabaseView {
  const views =
    database.views && database.views.length > 0
      ? database.views
      : [
          {
            id: "view_default",
            name: "Default Table",
            type: "table" as const,
            filters: [],
            sorts: [],
          },
        ];
  return views.find((view) => view.id === database.activeViewId) ?? views[0];
}

function getBoardGroupProperty(
  database: WorkspaceDatabase,
  view?: DatabaseView,
) {
  const configured = view?.groupByPropertyId
    ? database.properties.find((prop) => prop.id === view.groupByPropertyId)
    : undefined;
  if (configured) return configured;

  return (
    database.properties.find((prop) => prop.type === "select") ??
    database.properties.find((prop) => prop.type === "checkbox") ??
    database.properties.find((prop) => prop.type === "text") ??
    database.properties[0]
  );
}

function getDateProperty(database: WorkspaceDatabase, view?: DatabaseView) {
  const configured = view?.datePropertyId
    ? database.properties.find(
        (prop) =>
          prop.id === view.datePropertyId &&
          (prop.type === "date" ||
            prop.type === "created_time" ||
            prop.type === "last_edited_time"),
      )
    : undefined;
  return (
    configured ??
    database.properties.find(
      (prop) =>
        prop.type === "date" ||
        prop.type === "created_time" ||
        prop.type === "last_edited_time",
    )
  );
}

function getTimelineStartProperty(
  database: WorkspaceDatabase,
  view?: DatabaseView,
) {
  const configured = view?.startDatePropertyId
    ? database.properties.find(
        (prop) =>
          prop.id === view.startDatePropertyId &&
          (prop.type === "date" ||
            prop.type === "created_time" ||
            prop.type === "last_edited_time"),
      )
    : undefined;
  return configured ?? getDateProperty(database, view);
}

function getTimelineEndProperty(
  database: WorkspaceDatabase,
  view?: DatabaseView,
) {
  const configured = view?.endDatePropertyId
    ? database.properties.find(
        (prop) =>
          prop.id === view.endDatePropertyId &&
          (prop.type === "date" ||
            prop.type === "created_time" ||
            prop.type === "last_edited_time"),
      )
    : undefined;
  return configured ?? getTimelineStartProperty(database, view);
}

function viewIcon(type: DatabaseView["type"]) {
  if (type === "board") return "▥";
  if (type === "calendar") return "📅";
  if (type === "gallery") return "▧";
  if (type === "timeline") return "⟷";
  if (type === "gantt") return "▰";
  return "▦";
}

function viewLabel(type: DatabaseView["type"]) {
  if (type === "board") return "Board";
  if (type === "calendar") return "Calendar";
  if (type === "gallery") return "Gallery";
  if (type === "timeline") return "Timeline";
  if (type === "gantt") return "Gantt";
  return "Table";
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseLocalDate(value: unknown): Date | null {
  const text = dbText(value).trim();
  if (!text) return null;
  const date = /T\d{2}:\d{2}/.test(text)
    ? new Date(text)
    : new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function databaseCellText(
  database: WorkspaceDatabase,
  row: WorkspaceDatabase["rows"][number],
  prop: WorkspaceDatabase["properties"][number],
  allDatabases: WorkspaceDatabase[] = [],
) {
  const value = getComputedCellValue(prop, row, database, allDatabases);
  return dbText(value);
}

function isSameDateKey(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function applyAdvancedDatabaseFilter(
  text: string,
  rawValue: unknown,
  operator: DatabaseFilterOperator,
  target: string,
) {
  const valueText = text.toLowerCase();
  const targetText = target.toLowerCase();
  const numericValue = toDatabaseNumber(rawValue);
  const numericTarget = toDatabaseNumber(target);
  const dateValue = parseLocalDate(rawValue);
  const dateTarget = parseLocalDate(target);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + 7);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  if (operator === "is_empty") return valueText.length === 0;
  if (operator === "is_not_empty") return valueText.length > 0;
  if (operator === "equals") return valueText === targetText;
  if (operator === "not_equals") return valueText !== targetText;
  if (operator === "not_contains") return !valueText.includes(targetText);
  if (operator === "starts_with") return valueText.startsWith(targetText);
  if (operator === "ends_with") return valueText.endsWith(targetText);
  if (operator === "greater_than")
    return (
      numericValue !== null &&
      numericTarget !== null &&
      numericValue > numericTarget
    );
  if (operator === "less_than")
    return (
      numericValue !== null &&
      numericTarget !== null &&
      numericValue < numericTarget
    );
  if (operator === "before")
    return (
      !!dateValue && !!dateTarget && dateValue.getTime() < dateTarget.getTime()
    );
  if (operator === "after")
    return (
      !!dateValue && !!dateTarget && dateValue.getTime() > dateTarget.getTime()
    );
  if (operator === "today")
    return !!dateValue && isSameDateKey(dateValue, today);
  if (operator === "this_week")
    return !!dateValue && dateValue >= today && dateValue < weekEnd;
  if (operator === "this_month")
    return !!dateValue && dateValue >= today && dateValue < monthEnd;
  if (operator === "overdue") return !!dateValue && dateValue < today;
  return valueText.includes(targetText);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return `${year}年${month}月`;
}

function addMonths(value: string, diff: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + diff, 1);
  return monthKey(date);
}

function applyDatabaseView(
  database: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[] = [],
) {
  const view = getActiveView(database);
  const hasFilters = view.filters.length > 0;
  const hasSorts = view.sorts.length > 0;
  if (!hasFilters && !hasSorts) return database.rows;
  const filtered = hasFilters
    ? database.rows.filter((row) =>
        view.filters.every((filter) => {
          const prop = database.properties.find(
            (item) => item.id === filter.propertyId,
          );
          const rawValue = prop
            ? getComputedCellValue(prop, row, database, allDatabases)
            : row.cells[filter.propertyId];
          const text = dbText(rawValue);
          const target = dbText(filter.value);
          return applyAdvancedDatabaseFilter(
            text,
            rawValue,
            filter.operator,
            target,
          );
        }),
      )
    : database.rows;

  if (!hasSorts) return filtered;
  return [...filtered].sort((a, b) => {
    for (const sort of view.sorts) {
      const prop = database.properties.find(
        (item) => item.id === sort.propertyId,
      );
      const av = prop
        ? getComputedCellValue(prop, a, database, allDatabases)
        : a.cells[sort.propertyId];
      const bv = prop
        ? getComputedCellValue(prop, b, database, allDatabases)
        : b.cells[sort.propertyId];
      const an = toDatabaseNumber(av);
      const bn = toDatabaseNumber(bv);
      const result =
        an !== null && bn !== null
          ? an - bn
          : dbText(av).localeCompare(dbText(bv), "ja", { numeric: true });
      if (result !== 0) return sort.direction === "desc" ? -result : result;
    }
    return 0;
  });
}

function propertyTypeLabel(type: DatabasePropertyType) {
  const labels: Record<DatabasePropertyType, string> = {
    text: "Text",
    number: "Number",
    select: "Select",
    status: "Status",
    multi_select: "Multi",
    unique_id: "ID",
    button: "Button",
    date: "Date",
    checkbox: "Check",
    url: "URL",
    phone: "電話番号",
    email: "メール",
    created_time: "作成日時",
    last_edited_time: "最終更新日時",
    relation: "Relation",
    rollup: "Rollup",
    formula: "Formula",
  };
  return labels[type] ?? type;
}

function propertyTypeIcon(type: DatabasePropertyType) {
  const icons: Record<string, string> = {
    text: "Aa",
    number: "#",
    select: "▾",
    multi_select: "⋯",
    unique_id: "#",
    button: "▶",
    date: "◷",
    checkbox: "☑",
    url: "↗",
    phone: "☎",
    email: "✉",
    created_time: "◷",
    last_edited_time: "↻",
    relation: "↔",
    rollup: "Σ",
    formula: "ƒx",
  };
  return icons[type] ?? "•";
}

function defaultDatabaseCellValue(
  type: DatabasePropertyType,
): string | number | boolean | string[] {
  if (type === "checkbox") return false;
  if (type === "relation" || type === "multi_select") return [];
  if (
    type === "rollup" ||
    type === "formula" ||
    type === "button" ||
    type === "created_time" ||
    type === "last_edited_time"
  )
    return "";
  return "";
}

function coerceDatabaseCellValue(
  value: unknown,
  type: DatabasePropertyType,
): string | number | boolean | string[] {
  if (type === "checkbox") return Boolean(value);
  if (type === "number")
    return value === "" || value == null ? "" : Number(value);
  if (type === "relation" || type === "multi_select")
    return Array.isArray(value)
      ? value.map(String)
      : dbText(value)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
  if (
    type === "rollup" ||
    type === "formula" ||
    type === "button" ||
    type === "created_time" ||
    type === "last_edited_time"
  )
    return "";
  return dbText(value);
}

type DatabaseAnalysis = {
  numeric: Array<{
    propertyId: string;
    name: string;
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  }>;
  select: Array<{
    propertyId: string;
    name: string;
    counts: Array<{ value: string; count: number }>;
  }>;
  date: Array<{
    propertyId: string;
    name: string;
    earliest: string;
    latest: string;
    filled: number;
  }>;
  checkbox: Array<{
    propertyId: string;
    name: string;
    checked: number;
    total: number;
    rate: number;
  }>;
};

function csvEscape(value: unknown): string {
  const text =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.join("; ")
        : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function databaseToCsv(
  database: WorkspaceDatabase,
  rows = database.rows,
): string {
  const header = database.properties
    .map((prop) => csvEscape(prop.name))
    .join(",");
  const body = rows
    .map((row) =>
      database.properties
        .map((prop) => csvEscape(row.cells[prop.id]))
        .join(","),
    )
    .join("\n");
  return [header, body].filter(Boolean).join("\n");
}

function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function guessPropertyType(values: string[]): DatabasePropertyType {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return "text";
  if (
    nonEmpty.every((v) =>
      ["true", "false", "yes", "no", "1", "0", "完了", "未完了"].includes(
        v.toLowerCase(),
      ),
    )
  )
    return "checkbox";
  if (nonEmpty.every((v) => !Number.isNaN(Number(v)))) return "number";
  if (nonEmpty.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (nonEmpty.every((v) => /^https?:\/\//.test(v))) return "url";
  if (nonEmpty.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))
    return "email";
  if (nonEmpty.every((v) => /^(?:\+?\d[\d()\-\s]{5,}\d)$/.test(v)))
    return "phone";
  const unique = new Set(nonEmpty).size;
  if (unique <= Math.min(12, Math.max(3, nonEmpty.length / 2))) return "select";
  return "text";
}

function normalizeCsvValue(
  value: string,
  type: DatabasePropertyType,
): string | number | boolean {
  if (type === "number") return value.trim() === "" ? "" : Number(value);
  if (type === "checkbox")
    return ["true", "yes", "1", "完了", "checked"].includes(
      value.trim().toLowerCase(),
    );
  return value;
}

function csvToDatabaseRows(
  database: WorkspaceDatabase,
  csvText: string,
): WorkspaceDatabase | null {
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) return null;
  const headers = parsed[0].map((h, i) => h.trim() || `列${i + 1}`);
  const dataRows = parsed.slice(1);
  const properties = headers.map((name, index) => {
    const values = dataRows.map((row) => row[index] ?? "");
    const type = guessPropertyType(values);
    const options =
      type === "select"
        ? Array.from(
            new Set(values.map((v) => v.trim()).filter(Boolean)),
          ).slice(0, 30)
        : undefined;
    return {
      id: `prop_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      type,
      options,
    };
  });
  const now = new Date().toISOString();
  const rows = dataRows.map((csvRow, rowIndex) => ({
    id: `row_${Date.now()}_${rowIndex}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    cells: Object.fromEntries(
      properties.map((prop, index) => [
        prop.id,
        normalizeCsvValue(csvRow[index] ?? "", prop.type),
      ]),
    ),
  }));
  return { ...database, updatedAt: now, properties, rows };
}

function analyzeDatabase(database: WorkspaceDatabase): DatabaseAnalysis {
  const numeric: DatabaseAnalysis["numeric"] = [];
  const select: DatabaseAnalysis["select"] = [];
  const date: DatabaseAnalysis["date"] = [];
  const checkbox: DatabaseAnalysis["checkbox"] = [];
  for (const prop of database.properties) {
    if (prop.type === "number") {
      const values = database.rows
        .map((row) => Number(row.cells[prop.id]))
        .filter((value) => Number.isFinite(value));
      if (values.length)
        numeric.push({
          propertyId: prop.id,
          name: prop.name,
          count: values.length,
          sum: values.reduce((a, b) => a + b, 0),
          avg: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        });
    }
    if (prop.type === "select" || prop.type === "text") {
      const counts = new Map<string, number>();
      for (const row of database.rows) {
        const value = dbText(row.cells[prop.id]).trim() || "空";
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const sorted = Array.from(counts, ([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      if (sorted.length > 1 || sorted[0]?.value !== "空")
        select.push({ propertyId: prop.id, name: prop.name, counts: sorted });
    }
    if (prop.type === "date") {
      const values = database.rows
        .map((row) => dbText(row.cells[prop.id]))
        .filter(Boolean)
        .sort();
      if (values.length)
        date.push({
          propertyId: prop.id,
          name: prop.name,
          earliest: values[0],
          latest: values[values.length - 1],
          filled: values.length,
        });
    }
    if (prop.type === "checkbox") {
      const checked = database.rows.filter((row) =>
        Boolean(row.cells[prop.id]),
      ).length;
      checkbox.push({
        propertyId: prop.id,
        name: prop.name,
        checked,
        total: database.rows.length,
        rate: database.rows.length
          ? Math.round((checked / database.rows.length) * 100)
          : 0,
      });
    }
  }
  return { numeric, select, date, checkbox };
}

function readJsonLocalStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function renderCellPreview(value: unknown, type: DatabasePropertyType) {
  const text = dbText(value);
  if (type === "checkbox") return Boolean(value) ? "完了" : "未完了";
  if (type === "date" && text) return text;
  if (type === "url" && text) return text.replace(/^https?:\/\//, "");
  if (type === "phone" || type === "email") return text;
  return text || "空";
}

function getDatabaseRowTitle(
  database: WorkspaceDatabase,
  rowId: string,
): string {
  const row = database.rows.find((item) => item.id === rowId);
  if (!row) return "Missing row";
  const titleProp = database.properties[0];
  return titleProp ? dbText(row.cells[titleProp.id]) || "無題の行" : row.id;
}

function getRelationTargetTitle(
  prop: WorkspaceDatabase["properties"][number],
  rawId: string,
  currentDb: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
  pages: PageWithLock[],
  journals: JournalSummary[],
): string {
  const id = rawId.includes(":") ? rawId.split(":").slice(-1)[0] : rawId;
  const targetType = prop.relationTargetType ?? "database";
  if (targetType === "page") {
    const page = pages.find((item) => item.id === id);
    return page ? `${page.icon || "📄"} ${page.title}` : "Missing page";
  }
  if (targetType === "journal") {
    const journal = journals.find((item) => item.date === id);
    return journal ? `📅 ${journal.date}` : `📅 ${id}`;
  }
  const targetDb =
    allDatabases.find(
      (db) => db.id === (prop.relationDatabaseId || currentDb.id),
    ) ?? currentDb;
  return getDatabaseRowTitle(targetDb, id);
}

function isSharedToPrivateRelationBlocked(
  sourceScope: WorkspaceScope,
  targetScope: WorkspaceScope,
): boolean {
  return sourceScope === "shared" && targetScope === "private";
}

function getRelationCandidates(
  prop: WorkspaceDatabase["properties"][number],
  currentDb: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
  pages: PageWithLock[],
  journals: JournalSummary[],
  rowId: string,
) {
  const sourceScope = workspaceScope(currentDb);
  const targetType = prop.relationTargetType ?? "database";
  if (targetType === "page") {
    return pages
      .filter(
        (page) =>
          !isSharedToPrivateRelationBlocked(sourceScope, pageScope(page)),
      )
      .slice(0, 80)
      .map((page) => ({
        id: page.id,
        title: `${page.icon || "📄"} ${page.title}`,
        subtitle: `${scopeIcon(pageScope(page))} Page`,
      }));
  }
  if (targetType === "journal") {
    return journals.slice(0, 80).map((journal) => ({
      id: journal.date,
      title: `📅 ${journal.date}`,
      subtitle: journal.previewSnippet || "Journal",
    }));
  }
  const targetDb =
    allDatabases.find(
      (db) => db.id === (prop.relationDatabaseId || currentDb.id),
    ) ?? currentDb;
  if (isSharedToPrivateRelationBlocked(sourceScope, workspaceScope(targetDb)))
    return [];
  return targetDb.rows
    .filter((row) => !(targetDb.id === currentDb.id && row.id === rowId))
    .slice(0, 80)
    .map((row) => ({
      id: row.id,
      title: getDatabaseRowTitle(targetDb, row.id),
      subtitle: `${scopeIcon(workspaceScope(targetDb))} ${targetDb.title}`,
    }));
}

type RelationBacklink = {
  sourceDbId: string;
  sourceDbTitle: string;
  sourceRowId: string;
  sourceRowTitle: string;
  propertyId: string;
  propertyName: string;
};

function findRowRelationBacklinks(
  currentDb: WorkspaceDatabase,
  rowId: string,
  allDatabases: WorkspaceDatabase[],
): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (prop.type !== "relation") continue;
      const targetType = prop.relationTargetType ?? "database";
      const targetDbId = prop.relationDatabaseId || db.id;
      if (targetType !== "database" || targetDbId !== currentDb.id) continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(rowId)) {
          result.push({
            sourceDbId: db.id,
            sourceDbTitle: db.title,
            sourceRowId: row.id,
            sourceRowTitle: getDatabaseRowTitle(db, row.id),
            propertyId: prop.id,
            propertyName: prop.name,
          });
        }
      }
    }
  }
  return result;
}

function findPageRelationBacklinks(
  pageId: string,
  allDatabases: WorkspaceDatabase[],
): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (
        prop.type !== "relation" ||
        (prop.relationTargetType ?? "database") !== "page"
      )
        continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(pageId)) {
          result.push({
            sourceDbId: db.id,
            sourceDbTitle: db.title,
            sourceRowId: row.id,
            sourceRowTitle: getDatabaseRowTitle(db, row.id),
            propertyId: prop.id,
            propertyName: prop.name,
          });
        }
      }
    }
  }
  return result;
}

function findJournalRelationBacklinks(
  date: string,
  allDatabases: WorkspaceDatabase[],
): RelationBacklink[] {
  const result: RelationBacklink[] = [];
  for (const db of allDatabases) {
    for (const prop of db.properties) {
      if (
        prop.type !== "relation" ||
        (prop.relationTargetType ?? "database") !== "journal"
      )
        continue;
      for (const row of db.rows) {
        const value = row.cells[prop.id];
        if (Array.isArray(value) && value.includes(date)) {
          result.push({
            sourceDbId: db.id,
            sourceDbTitle: db.title,
            sourceRowId: row.id,
            sourceRowTitle: getDatabaseRowTitle(db, row.id),
            propertyId: prop.id,
            propertyName: prop.name,
          });
        }
      }
    }
  }
  return result;
}

function getRelationTargetDatabase(
  prop: WorkspaceDatabase["properties"][number],
  currentDb: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
) {
  return (
    allDatabases.find(
      (db) => db.id === (prop.relationDatabaseId || currentDb.id),
    ) ?? currentDb
  );
}

function getRollupValue(
  prop: WorkspaceDatabase["properties"][number],
  row: WorkspaceDatabase["rows"][number],
  currentDb: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
) {
  const relationProp = currentDb.properties.find(
    (p) => p.id === prop.rollupRelationPropertyId && p.type === "relation",
  );
  if (!relationProp) return "Relation未設定";
  const rawRelationIds = row.cells[relationProp.id];
  const ids = Array.isArray(rawRelationIds) ? rawRelationIds.map(String) : [];
  const targetDb = getRelationTargetDatabase(
    relationProp,
    currentDb,
    allDatabases,
  );
  const targetRows = targetDb.rows.filter((item) => ids.includes(item.id));
  const fn = prop.rollupFunction ?? "count";
  if (fn === "count") return targetRows.length;

  const targetProp = targetDb.properties.find(
    (p) => p.id === prop.rollupTargetPropertyId,
  );
  if (!targetProp) {
    if (fn === "percent_checked") return "0%";
    if (fn === "count_checked" || fn === "count_unchecked") return 0;
    return targetRows.length;
  }

  const values = targetRows.map((item) => item.cells[targetProp.id]);
  const isDoneStatus = (value: unknown) =>
    ["完了", "完了済み", "done", "completed"].includes(
      String(value ?? "")
        .trim()
        .toLowerCase(),
    );
  if (fn === "count_checked")
    return values.filter(isCheckedDatabaseValue).length;
  if (fn === "count_unchecked")
    return values.filter((value) => !isCheckedDatabaseValue(value)).length;
  if (fn === "percent_checked")
    return formatPercent(
      values.filter(isCheckedDatabaseValue).length,
      targetRows.length,
    );
  if (fn === "count_status_done") return values.filter(isDoneStatus).length;
  if (fn === "count_status_open")
    return values.filter((value) => !isDoneStatus(value)).length;
  if (fn === "percent_status_done")
    return formatPercent(values.filter(isDoneStatus).length, targetRows.length);

  const nums = values
    .map(toDatabaseNumber)
    .filter((value): value is number => value !== null);
  if (fn === "sum")
    return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
  if (fn === "average")
    return nums.length
      ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
      : 0;
  if (fn === "min") return nums.length ? Math.min(...nums) : "";
  if (fn === "max") return nums.length ? Math.max(...nums) : "";
  if (fn === "show_unique")
    return Array.from(
      new Set(
        values
          .flatMap((value) =>
            Array.isArray(value) ? value.map(String) : [dbText(value)],
          )
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).join(", ");
  return targetRows.length;
}

function getFormulaValue(
  prop: WorkspaceDatabase["properties"][number],
  row: WorkspaceDatabase["rows"][number],
  database: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
): unknown {
  const expression = (prop.formulaExpression || "").trim();
  if (!expression) return "式未設定";
  const lookup = (name: string): unknown => {
    const target = database.properties.find(
      (p) => p.name === name || p.id === name,
    );
    if (!target) return "";
    if (target.type === "rollup")
      return getRollupValue(target, row, database, allDatabases);
    if (target.type === "formula") return "";
    return getComputedCellValue(target, row, database, allDatabases);
  };
  if (/^daysUntil\(([^)]+)\)$/i.test(expression)) {
    const name = expression.match(/^daysUntil\(([^)]+)\)$/i)?.[1]?.trim() ?? "";
    const date = parseLocalDate(lookup(name));
    if (!date) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((date.getTime() - today.getTime()) / 86400000);
  }
  if (/^progress\(([^,]+),([^\)]+)\)$/i.test(expression)) {
    const m = expression.match(/^progress\(([^,]+),([^\)]+)\)$/i);
    const done: number = toDatabaseNumber(lookup(m?.[1]?.trim() ?? "")) ?? 0;
    const total: number = toDatabaseNumber(lookup(m?.[2]?.trim() ?? "")) ?? 0;
    return formatPercent(done, total);
  }
  const safe: string = expression.replace(
    /\{([^}]+)\}/g,
    (_match: string, name: string): string =>
      String(toDatabaseNumber(lookup(String(name).trim())) ?? 0),
  );
  if (!/^[0-9+\-*/().\s]+$/.test(safe)) return "式エラー";
  try {
    // Formula is intentionally limited to numeric arithmetic generated from {Property Name} placeholders.
    // eslint-disable-next-line no-new-func
    const result: unknown = Function(`"use strict"; return (${safe});`)();
    return typeof result === "number" && Number.isFinite(result)
      ? Math.round(result * 100) / 100
      : "";
  } catch {
    return "式エラー";
  }
}

function getComputedCellValue(
  prop: WorkspaceDatabase["properties"][number],
  row: WorkspaceDatabase["rows"][number],
  database: WorkspaceDatabase,
  allDatabases: WorkspaceDatabase[],
): unknown {
  if (prop.type === "created_time") return row.createdAt;
  if (prop.type === "last_edited_time") return row.updatedAt;
  if (prop.type === "rollup")
    return getRollupValue(prop, row, database, allDatabases);
  if (prop.type === "formula")
    return getFormulaValue(prop, row, database, allDatabases);
  return row.cells[prop.id];
}

function extractPageLinks(markdown: string, pages: PageWithLock[]) {
  const found: Array<{ title: string; pageId: string; legacy?: boolean }> = [];

  // 旧形式との後方互換: @[[タイトル|page_id]]
  for (const match of markdown.matchAll(/@\[\[([^|\]]+)\|([^\]]+)\]\]/g)) {
    found.push({ title: match[1], pageId: match[2], legacy: true });
  }

  // v20の読みやすい形式: 📄 ページタイトル
  for (const page of pages) {
    const escaped = page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n|\\s)📄\\s+${escaped}(?=$|\\n|\\s)`, "u");
    if (re.test(markdown)) found.push({ title: page.title, pageId: page.id });
  }

  const seen = new Set<string>();
  return found.filter((link) => {
    if (seen.has(link.pageId)) return false;
    seen.add(link.pageId);
    return true;
  });
}

function safeDecodeToken(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

type EmbeddedDatabaseRef = {
  database: WorkspaceDatabase;
  viewId?: string;
  linked?: boolean;
};

function extractDatabaseEmbeds(
  markdown: string,
  databases: WorkspaceDatabase[],
): EmbeddedDatabaseRef[] {
  const found: EmbeddedDatabaseRef[] = [];
  const addById = (id: string, viewId?: string, linked = false) => {
    const database = databases.find((item) => item.id === id);
    if (!database) return;
    const validViewId =
      viewId && (database.views ?? []).some((view) => view.id === viewId)
        ? viewId
        : undefined;
    found.push({
      database,
      viewId: validViewId,
      linked: linked && Boolean(validViewId),
    });
  };

  // ページ固有の表示ビューを指定するリンクドDB形式。
  // 元DBの行・プロパティは複製せず、表示ビューIDだけを本文に保存する。
  for (const match of markdown.matchAll(
    /\[\[database-view:([^:|\]]+):([^|\]]+)\|[^\]]+\]\]/g,
  ))
    addById(match[1], match[2], true);

  // 旧形式との後方互換: {{database:db_id}}
  for (const match of markdown.matchAll(/\{\{database:([^}]+)\}\}/g))
    addById(match[1]);

  // v274: 通常ページ本文のクリック可能なDBリンク。
  for (const match of markdown.matchAll(/\[\[database:([^|\]]+)\|[^\]]+\]\]/g))
    addById(match[1]);
  for (const match of markdown.matchAll(/#local-database=([^\s)\]&]+)/g))
    addById(safeDecodeToken(match[1]));
  for (const match of markdown.matchAll(/local-database:\/\/([^\s)\]/?#]+)/g))
    addById(safeDecodeToken(match[1]));

  // v20の読みやすい形式: 🗃️ データベースタイトル
  for (const database of databases) {
    const escaped = database.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\n|\\s)🗃️\\s+${escaped}(?=$|\\n|\\s)`, "u");
    if (re.test(markdown)) found.push({ database });
  }

  const seen = new Set<string>();
  return found.filter((item) => {
    const key = `${item.database.id}:${item.viewId ?? "source"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDatabaseRowLinksFromMarkdown(
  markdown: string,
  targets: DatabaseRowLinkTarget[],
) {
  const found: Array<{ databaseId: string; rowId: string; title: string }> = [];
  const add = (databaseId: string, rowId: string, title?: string) => {
    const target = targets.find(
      (item) => item.databaseId === databaseId && item.rowId === rowId,
    );
    found.push({
      databaseId,
      rowId,
      title: target
        ? `${target.databaseTitle} / ${target.rowTitle}`
        : title || `${databaseId} / ${rowId}`,
    });
  };

  for (const match of markdown.matchAll(
    /\[\[dbrow:([^:\]|]+):([^\]|]+)\|([^\]]+)\]\]/g,
  )) {
    add(match[1], match[2], match[3]);
  }
  for (const match of markdown.matchAll(
    /local-dbrow:\/\/([^\s)\]/?#]+)\/([^\s)\]/?#]+)/g,
  )) {
    try {
      add(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    } catch {
      add(match[1], match[2]);
    }
  }
  for (const match of markdown.matchAll(
    /#local-dbrow=([^\s)\]&]+)&row=([^\s)\]&]+)/g,
  )) {
    try {
      add(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    } catch {
      add(match[1], match[2]);
    }
  }

  const seen = new Set<string>();
  return found.filter((link) => {
    const key = `${link.databaseId}:${link.rowId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function LinkedPagesPanel({
  markdown,
  pages,
  onOpen,
}: {
  markdown: string;
  pages: PageWithLock[];
  onOpen: (id: string) => void;
}) {
  const links = extractPageLinks(markdown, pages);
  if (links.length === 0) return null;
  return (
    <section className="panel-card linked-pages-panel">
      <h3>リンクされたページ</h3>
      <div className="linked-page-list">
        {links.map((link) => {
          const page = pages.find((p) => p.id === link.pageId);
          return (
            <button
              key={link.pageId}
              onClick={() => onOpen(link.pageId)}
              disabled={!page}
              title={page ? page.id : "ページが見つかりません"}
            >
              <span className="link-chip-icon">📄</span>
              <span>{page?.title ?? link.title}</span>{" "}
              {!page && <span className="missing-link">missing</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function embeddedDatabaseForView(ref: EmbeddedDatabaseRef): WorkspaceDatabase {
  if (!ref.viewId) return ref.database;
  return { ...ref.database, activeViewId: ref.viewId };
}

function linkedViewName(ref: EmbeddedDatabaseRef): string {
  if (!ref.viewId) return "元のビュー";
  return (
    ref.database.views?.find((view) => view.id === ref.viewId)?.name ||
    "リンクドビュー"
  );
}

function EmbeddedDatabasesPanel({
  markdown,
  databases,
  pages = [],
  journals = [],
  onOpenDatabase,
  onOpenDatabaseRow,
}: {
  markdown: string;
  databases: WorkspaceDatabase[];
  pages?: PageWithLock[];
  journals?: JournalSummary[];
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
}) {
  const embedded = extractDatabaseEmbeds(markdown, databases);
  if (embedded.length === 0) return null;
  return (
    <section className="embedded-databases">
      <h3>埋め込みデータベース</h3>
      {embedded.map((ref) => {
        const database = embeddedDatabaseForView(ref);
        return (
          <div
            className="embedded-db-card"
            key={`${ref.database.id}:${ref.viewId ?? "source"}`}
          >
            <div className="embedded-db-title">
              <span>🗃️ {ref.database.title}</span>
              {ref.linked && (
                <small className="linked-db-badge-v474">
                  リンクドビュー · {linkedViewName(ref)}
                </small>
              )}
            </div>
            <DatabaseTable
              database={database}
              editing={false}
              onChange={() => undefined}
              allDatabases={databases}
              pages={pages}
              journals={journals}
              onOpenDatabase={onOpenDatabase}
              onOpenDatabaseRow={onOpenDatabaseRow}
            />
          </div>
        );
      })}
    </section>
  );
}

function EmbeddedDatabasesStickyRail({
  markdown,
  databases,
  pages,
  journals,
  editing,
  onChangeDatabase,
  onOpenDatabase,
  onOpenDatabaseRow,
}: {
  markdown: string;
  databases: WorkspaceDatabase[];
  pages: PageWithLock[];
  journals: JournalSummary[];
  editing: boolean;
  onChangeDatabase: (database: WorkspaceDatabase) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
}) {
  const embedded = extractDatabaseEmbeds(markdown, databases);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const keyOf = (ref: EmbeddedDatabaseRef) =>
    `${ref.database.id}:${ref.viewId ?? "source"}`;

  useEffect(() => {
    if (embedded.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !embedded.some((ref) => keyOf(ref) === selectedKey))
      setSelectedKey(keyOf(embedded[0]));
  }, [embedded.map(keyOf).join("|")]);

  if (embedded.length === 0) return null;
  const selected =
    embedded.find((ref) => keyOf(ref) === selectedKey) ?? embedded[0];
  const displayDatabase = embeddedDatabaseForView(selected);

  return (
    <aside
      className={
        collapsed
          ? "embedded-db-sticky-rail collapsed"
          : "embedded-db-sticky-rail"
      }
    >
      <div className="embedded-rail-header">
        <div>
          <span>Linked database</span>
          <strong>本文内DB</strong>
        </div>
        <button
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "表示する" : "折りたたむ"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="embedded-rail-tabs">
            {embedded.map((ref) => (
              <button
                key={keyOf(ref)}
                className={keyOf(ref) === keyOf(selected) ? "active" : ""}
                onClick={() => setSelectedKey(keyOf(ref))}
                title={`${ref.database.title} · ${linkedViewName(ref)}`}
              >
                <span>🗃️</span>
                <span>{ref.database.title}</span>
                {ref.linked ? (
                  <small>{linkedViewName(ref)}</small>
                ) : (
                  <small>{ref.database.rows.length}</small>
                )}
              </button>
            ))}
          </div>
          <div className="embedded-rail-context-v474">
            <div>
              <strong>
                {selected.linked ? "リンクドDBビュー" : "埋め込みDB"}
              </strong>
              <span>
                {selected.linked
                  ? `${linkedViewName(selected)} をこのページで参照中`
                  : "元データベースの現在のビューを参照中"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onOpenDatabase?.(selected.database.id)}
            >
              DBを開く ↗
            </button>
          </div>
          <div className="embedded-rail-table">
            <DatabaseTable
              database={displayDatabase}
              editing={selected.linked ? false : editing}
              onChange={onChangeDatabase}
              allDatabases={databases}
              pages={pages}
              journals={journals}
              onOpenDatabase={onOpenDatabase}
              onOpenDatabaseRow={onOpenDatabaseRow}
            />
          </div>
        </>
      )}
    </aside>
  );
}

function getPagePath(
  pageId: string | undefined,
  pages: PageWithLock[],
): PageWithLock[] {
  if (!pageId) return [];
  const map = new Map(pages.map((page) => [page.id, page]));
  const result: PageWithLock[] = [];
  let cursor = map.get(pageId);
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    result.unshift(cursor);
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined;
  }
  return result;
}

function Breadcrumbs({
  currentId,
  pages,
  onOpen,
}: {
  currentId?: string;
  pages: PageWithLock[];
  onOpen: (id: string) => void;
}) {
  const path = getPagePath(currentId, pages);
  if (path.length === 0) return null;
  return (
    <nav className="breadcrumbs">
      {path.map((page, index) => (
        <React.Fragment key={page.id}>
          {index > 0 && <span className="breadcrumb-sep">/</span>}
          <button
            onClick={() => onOpen(page.id)}
            className={index === path.length - 1 ? "current" : ""}
          >
            {page.icon ?? "📄"} {page.title}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

function TasksView({
  tasks,
  onOpenPage,
  onOpenJournal,
  onOpenInbox,
  onOpenDatabaseRow,
  onRefresh,
  onUpdateTask,
}: {
  tasks: TaskItem[];
  onOpenPage: (id: string) => void;
  onOpenJournal: (date: string) => void;
  onOpenInbox: () => void;
  onOpenDatabaseRow: (databaseId: string, rowId: string) => void;
  onRefresh: () => void;
  onUpdateTask: (
    taskId: string,
    patch: { completed?: boolean; dueDate?: string | null },
  ) => Promise<void>;
}) {
  const [tab, setTab] = useState<
    "today" | "upcoming" | "overdue" | "done" | "all"
  >("today");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const openTasks = tasks.filter((t) => !t.completed);
  const visible = tasks.filter((task) => {
    const q = query.trim().toLowerCase();
    const matches =
      !q ||
      [task.text, task.sourceTitle, task.sourceType, task.dueDate || ""].some(
        (v) => String(v).toLowerCase().includes(q),
      );
    if (!matches) return false;
    if (tab === "done") return task.completed;
    if (tab === "all") return true;
    if (task.completed) return false;
    if (tab === "today") return !task.dueDate || task.dueDate === today;
    if (tab === "overdue") return Boolean(task.dueDate && task.dueDate < today);
    if (tab === "upcoming")
      return Boolean(task.dueDate && task.dueDate > today);
    return true;
  });
  const stats = {
    today: openTasks.filter((t) => !t.dueDate || t.dueDate === today).length,
    overdue: openTasks.filter((t) => t.dueDate && t.dueDate < today).length,
    upcoming: openTasks.filter((t) => t.dueDate && t.dueDate > today).length,
    done: tasks.filter((t) => t.completed).length,
  };
  const openSource = (task: TaskItem) => {
    if (task.sourceType === "page") onOpenPage(task.sourceId);
    else if (task.sourceType === "journal") onOpenJournal(task.sourceId);
    else if (task.sourceType === "database-row") {
      const [rawDatabaseId, rawRowId] = String(task.sourceId || "").split("/");
      if (rawDatabaseId && rawRowId) {
        try {
          onOpenDatabaseRow(
            decodeURIComponent(rawDatabaseId),
            decodeURIComponent(rawRowId),
          );
        } catch {
          onOpenInbox();
        }
      } else onOpenInbox();
    } else onOpenInbox();
  };
  const update = async (
    task: TaskItem,
    patch: { completed?: boolean; dueDate?: string | null },
  ) => {
    setBusyId(task.id);
    try {
      await onUpdateTask(task.id, patch);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className="tasks-page-v95">
      <div className="tasks-hero-v94 tasks-hero-v95">
        <div>
          <p className="section-kicker-v61">Task hub</p>
          <h1>Tasks</h1>
          <p>
            タスクを確認するだけでなく、この画面から完了・期限変更・元ページ確認までできます。
          </p>
        </div>
        <div className="task-hero-actions-v95">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タスクを検索"
            className="task-search-v95"
          />
          <button
            className="icon-toolbar-button"
            onClick={onRefresh}
            title="再読み込み"
            aria-label="再読み込み"
          >
            ↻
          </button>
        </div>
      </div>
      <div className="task-insights-v94">
        <button
          className={tab === "today" ? "active" : ""}
          onClick={() => setTab("today")}
        >
          <b>{stats.today}</b>
          <span>Today</span>
        </button>
        <button
          className={tab === "overdue" ? "active danger" : ""}
          onClick={() => setTab("overdue")}
        >
          <b>{stats.overdue}</b>
          <span>Overdue</span>
        </button>
        <button
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          <b>{stats.upcoming}</b>
          <span>Upcoming</span>
        </button>
        <button
          className={tab === "done" ? "active" : ""}
          onClick={() => setTab("done")}
        >
          <b>{stats.done}</b>
          <span>Done</span>
        </button>
        <button
          className={tab === "all" ? "active" : ""}
          onClick={() => setTab("all")}
        >
          <b>{tasks.length}</b>
          <span>All</span>
        </button>
      </div>
      <div className="task-list-v94 task-list-v95">
        {visible.length === 0 ? (
          <div className="inbox-empty">
            <b>該当タスクはありません</b>
            <span>本文に - [ ] タスク の形式で書くとここに集約されます。</span>
          </div>
        ) : (
          visible.map((task) => (
            <article
              key={task.id}
              className={
                task.completed
                  ? "task-card-v94 task-card-v95 done"
                  : "task-card-v94 task-card-v95"
              }
            >
              <button
                className="task-check-v95"
                disabled={busyId === task.id}
                onClick={() => update(task, { completed: !task.completed })}
                title={task.completed ? "未完了に戻す" : "完了にする"}
              >
                {task.completed ? "✓" : "○"}
              </button>
              <button
                className="task-main-v94 task-main-v95"
                onClick={() => openSource(task)}
                title="元の場所を開く"
              >
                <b>{task.text}</b>
                <small>
                  {task.sourceIcon || "📄"} {task.sourceTitle} ・{" "}
                  {task.sourceType}
                  {task.dueDate ? ` ・ due ${task.dueDate}` : ""}
                </small>
              </button>
              <div className="task-actions-v95">
                <button
                  onClick={() => update(task, { dueDate: today })}
                  title="今日に設定"
                >
                  今日
                </button>
                <button
                  onClick={() => update(task, { dueDate: tomorrow })}
                  title="明日に設定"
                >
                  明日
                </button>
                <input
                  type="date"
                  value={task.dueDate || ""}
                  onChange={(e) =>
                    update(task, { dueDate: e.target.value || null })
                  }
                  title="期限"
                />
                <button onClick={() => openSource(task)} title="元を開く">
                  ↗
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function LinkPreviewDrawer({
  page,
  pages,
  databases,
  databaseRowLinks = [],
  journals = [],
  api,
  apiUrl,
  width,
  onStartResize,
  onClose,
  onOpen,
  onPreview,
  onOpenDatabase,
  onOpenDatabaseRow,
  onSaved,
  allTags = [],
}: {
  page: PageBundle | null;
  api: ApiClient | null;
  apiUrl: string;
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  databaseRowLinks?: DatabaseRowLinkTarget[];
  journals?: JournalSummary[];
  width: number;
  onStartResize: (event: React.PointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onOpen: (id: string) => void | Promise<void>;
  onPreview: (id: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onSaved: () => void;
  allTags?: string[];
}) {
  const [draftPage, setDraftPage] = useState<PageBundle | null>(page);
  const [draftTitle, setDraftTitle] = useState(page?.meta.title ?? "");
  const [draftIcon, setDraftIcon] = useState(page?.meta.icon || "📄");
  const [draftProps, setDraftProps] = useState<PageProperties>(
    normalizePageProperties(page?.meta.properties),
  );
  const [draftBlocks, setDraftBlocks] = useState<BlockNoteDoc>(
    page ? blockNoteContentFromPage(page) : [paragraph()],
  );
  // v374: The side peek is deliberately read-only. Editing a page in both the
  // main editor and the preview used the same lock id and could release the main
  // editor's lock when the drawer unmounted. Open the page in the main editor to edit.
  const editable = false;
  const [dirty, setDirty] = useState(false);
  const [saving] = useState(false);
  const [drawerStatus, setDrawerStatus] = useState("");

  useEffect(() => {
    setDraftPage(page);
    setDraftTitle(page?.meta.title ?? "");
    setDraftIcon(page?.meta.icon || "📄");
    setDraftProps(normalizePageProperties(page?.meta.properties));
    setDraftBlocks(page ? blockNoteContentFromPage(page) : [paragraph()]);
    setDrawerStatus(
      page ? "閲覧のみ。編集する場合はメインで開いてください" : "",
    );
  }, [page?.meta.id]);

  async function saveDrawerPage() {
    // Side peek is read-only in v374; there is no independent writer to flush.
    return;
  }

  async function uploadFileForDrawerBlockNote(file: File): Promise<string> {
    if (!api || !draftPage) throw new Error("ページが読み込まれていません。");
    const url = await api.uploadAttachmentFile(draftPage.meta.id, file);
    setDrawerStatus("ファイルを添付しました");
    onSaved();
    return url;
  }

  useEffect(() => {
    (window as any).__localNotionFlushLinkPreviewSave = async () => undefined;
    return () => {
      delete (window as any).__localNotionFlushLinkPreviewSave;
    };
  }, []);

  if (!page || !draftPage) return null;
  const previewMarkdown = blockNoteToMarkdown(draftBlocks);
  return (
    <aside
      className="link-preview-drawer notion-page-preview-drawer editable-preview-drawer resizable-link-preview"
      style={{ width, maxWidth: width, ["--peek-width" as any]: `${width}px` }}
      aria-label="リンク先ページプレビュー"
    >
      <div
        className="link-preview-resize-handle"
        onPointerDown={onStartResize}
        title="幅を調整"
        aria-label="右サイドバーの幅を調整"
      />
      <div className="link-preview-header notion-preview-header editable-preview-header">
        <div className="editable-preview-title-row">
          <input
            className="preview-icon-input"
            value={draftIcon}
            disabled={!editable}
            onChange={(e) => {
              setDraftIcon(e.target.value || "📄");
              setDirty(true);
            }}
            aria-label="ページアイコン"
          />
          <div className="editable-preview-title-stack">
            <div className="muted-small">サイドピーク ・閲覧のみ</div>
            <input
              className="preview-title-input"
              value={draftTitle}
              disabled={!editable}
              onChange={(e) => {
                setDraftTitle(e.target.value);
                setDirty(true);
              }}
              aria-label="ページタイトル"
            />
          </div>
        </div>
        <button
          className="icon-button"
          onClick={async () => {
            if (dirty) await saveDrawerPage();
            onClose();
          }}
          title="保存して閉じる"
        >
          ×
        </button>
      </div>
      <details className="preview-properties-editor">
        <summary>プロパティ</summary>
        <div className="preview-property-grid">
          <label>
            ステータス
            <input
              disabled={!editable}
              value={draftProps.status}
              onChange={(e) => {
                setDraftProps({
                  ...draftProps,
                  status: e.target.value as PageStatus,
                });
                setDirty(true);
              }}
            />
          </label>
          <label>
            優先度
            <input
              disabled={!editable}
              value={draftProps.priority}
              onChange={(e) => {
                setDraftProps({
                  ...draftProps,
                  priority: e.target.value as PagePriority,
                });
                setDirty(true);
              }}
            />
          </label>
          <label>
            担当者
            <input
              disabled={!editable}
              value={draftProps.assignee}
              onChange={(e) => {
                setDraftProps({ ...draftProps, assignee: e.target.value });
                setDirty(true);
              }}
            />
          </label>
          <label>
            期限
            <input
              disabled={!editable}
              type="date"
              value={draftProps.dueDate}
              onChange={(e) => {
                setDraftProps({ ...draftProps, dueDate: e.target.value });
                setDirty(true);
              }}
            />
          </label>
          <label className="wide">
            タグ
            <TagInput
              tags={draftProps.tags}
              suggestions={allTags}
              disabled={!editable}
              onChange={(nextTags) => {
                setDraftProps({ ...draftProps, tags: nextTags });
                setDirty(true);
              }}
              placeholder="タグを追加"
            />
          </label>
        </div>
      </details>
      <div className="link-preview-body full-page-preview-body">
        <BlockNotePageEditor
          pageId={draftPage.meta.id}
          initialContent={draftBlocks}
          editing={editable}
          pages={pages}
          databases={databases}
          databaseRowLinks={databaseRowLinks}
          aiClient={api}
          attachmentApiBaseUrl={apiUrl}
          aiPageTitle={draftTitle}
          aiTagHints={draftProps.tags}
          previewMode={true}
          onOpenPage={onOpen}
          onPreviewPage={onPreview}
          onOpenDatabase={onOpenDatabase}
          onOpenDatabaseRow={onOpenDatabaseRow}
          onUploadFile={uploadFileForDrawerBlockNote}
          onChange={(next) => {
            setDraftBlocks(next);
            setDirty(true);
          }}
        />
        <EmbeddedDatabasesPanel
          markdown={previewMarkdown}
          databases={databases}
          pages={pages}
          journals={journals}
          onOpenDatabase={onOpenDatabase}
          onOpenDatabaseRow={onOpenDatabaseRow}
        />
      </div>
      <div className="link-preview-actions notion-preview-actions">
        <span className="drawer-save-status">
          {saving ? "保存中…" : dirty ? "未保存" : drawerStatus}
        </span>
        <button
          onClick={async () => {
            onClose();
            await onOpen(draftPage.meta.id);
          }}
        >
          メインで開く
        </button>
        <button
          className="secondary"
          onClick={async () => {
            if (dirty) await saveDrawerPage();
            onClose();
          }}
        >
          閉じる
        </button>
      </div>
    </aside>
  );
}

function localPageIdFromLocationHash(): string {
  const hash = window.location.hash || "";
  const prefix = "#local-page=";
  if (!hash.startsWith(prefix)) return "";
  const raw = hash.slice(prefix.length).split("&")[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function journalAttachmentExtension(fileName: string): string {
  const match = String(fileName || "")
    .toLowerCase()
    .match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] || "";
}

function isJournalImageAttachment(fileName: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(
    journalAttachmentExtension(fileName),
  );
}

function isJournalPdfAttachment(fileName: string): boolean {
  return journalAttachmentExtension(fileName) === "pdf";
}

function journalAttachmentIcon(fileName: string): string {
  if (isJournalImageAttachment(fileName)) return "🖼️";
  if (isJournalPdfAttachment(fileName)) return "📕";
  const ext = journalAttachmentExtension(fileName);
  if (["doc", "docx", "odt"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["zip", "7z", "rar"].includes(ext)) return "🗜️";
  return "📄";
}

function formatJournalAttachmentSize(size: number): string {
  const bytes = Math.max(0, Number(size || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function App() {
  const [apiUrl, setApiUrl] = useState<string>("");
  const [apiToken, setApiToken] = useState<string>("");
  const [sharedRoot, setSharedRoot] = useState<string>("");
  const [privatePagesRoot, setPrivatePagesRoot] = useState<string>("");
  const [privateDatabasesRoot, setPrivateDatabasesRoot] = useState<string>("");
  const [ocrBinaryPath, setOcrBinaryPath] = useState<string>("");
  const [popplerBinaryPath, setPopplerBinaryPath] = useState<string>("");
  const api = useMemo(
    () => (apiUrl ? new ApiClient(apiUrl, apiToken) : null),
    [apiUrl, apiToken],
  );
  const [tree, setTree] = useState<PageTreeNode[]>([]);
  const [searchResults, setSearchResults] = useState<PageWithLock[]>([]);
  const [trashedPages, setTrashedPages] = useState<PageWithLock[]>([]);
  const [trashedDatabases, setTrashedDatabases] = useState<WorkspaceDatabase[]>(
    [],
  );
  const [current, setCurrent] = useState<PageBundle | null>(null);
  const [workspaceActiveItem, setWorkspaceActiveItem] = useState<{
    kind: "page" | "database";
    id: string;
    rowId?: string | null;
    parentId?: string | null;
  } | null>(null);
  const workspaceSelectionRequestRef = useRef(0);
  const [title, setTitle] = useState("");
  const [pageIcon, setPageIcon] = useState("📄");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [workspaceAiSearchOpen, setWorkspaceAiSearchOpen] = useState(false);
  const [workspaceAiGeneration, setWorkspaceAiGeneration] = useState<{
    busy: boolean;
    question?: string;
  }>({ busy: false });
  const [currentPageShelfPickerItem, setCurrentPageShelfPickerItem] =
    useState<ShelfPickerItem | null>(null);
  const [workspaceAiDrawerMode, setWorkspaceAiDrawerMode] = useState<
    "chat" | "search"
  >("chat");
  const [workspaceAiQueuedPrompt, setWorkspaceAiQueuedPrompt] = useState("");
  const [workspaceAiInitialQuery, setWorkspaceAiInitialQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    loadAppSettings(),
  );
  const [pageProperties, setPageProperties] = useState<PageProperties>(
    DEFAULT_PAGE_PROPERTIES,
  );
  const [blocks, setBlocks] = useState<LocalBlock[]>([newBlock("paragraph")]);
  const [blockNoteBlocks, setBlockNoteBlocks] = useState<BlockNoteDoc>(
    localBlocksToBlockNote([newBlock("paragraph")]),
  );
  const [status, setStatus] = useState("起動中...");
  const [initialWorkspaceReady, setInitialWorkspaceReady] = useState(false);
  const [startupProgress, setStartupProgress] = useState<{
    stage: string;
    title?: string;
    message: string;
    detail?: string;
  }>({
    stage: "renderer",
    title: "ワークスペースを準備しています",
    message: "画面を起動しています。",
  });
  const [startupFailure, setStartupFailure] = useState<string | null>(null);
  // A full-screen startup explanation is useful only after a perceptible wait.
  // Before then, keep the overlay deliberately quiet so fast launches feel immediate.
  const [startupGateExpanded, setStartupGateExpanded] = useState(false);
  const [workspaceSyncState, setWorkspaceSyncState] =
    useState<WorkspaceSyncState>("ready");
  const [workspaceSyncDetail, setWorkspaceSyncDetail] =
    useState("ローカルデータを表示中");
  const [saveActivity, setSaveActivity] = useState<{
    page: boolean;
    journal: boolean;
    database: boolean;
  }>({ page: false, journal: false, database: false });
  const [recentWorkspaceRevision, setRecentWorkspaceRevision] = useState(0);
  const [saveRecovery, setSaveRecovery] = useState<
    Record<string, { label: string; attempt: number; exhausted: boolean }>
  >({});
  const saveRecoveryController = useSaveRecovery({
    setRecovery: setSaveRecovery,
    setStatus,
  });
  const saveRetryTimersRef = saveRecoveryController.timersRef;
  const saveRetryAttemptsRef = saveRecoveryController.attemptsRef;
  const lightRefreshInFlightCountRef = useRef(0);
  // All shared-workspace refreshes are serialized through one coordinator.
  // This prevents a slow periodic/read import from racing a save-triggered UI update.
  type WorkspaceRefreshPriority = "save" | "manual" | "startup" | "periodic";
  type QueuedWorkspaceRefresh = {
    message: string;
    options: RefreshOptions;
    priority: WorkspaceRefreshPriority;
    resolve: () => void;
    reject: (error: unknown) => void;
  };
  const workspaceRefreshQueueRef = useRef<QueuedWorkspaceRefresh[]>([]);
  const workspaceRefreshRunningRef = useRef(false);
  const [editing, setEditing] = useState(false);
  // Only show a lock warning after a lock request actually failed.
  // `editing === false` also occurs while loading or after the user intentionally ends editing.
  const [pageReadOnlyReason, setPageReadOnlyReason] = useState<string | null>(
    null,
  );
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [pageUtilityMode, setPageUtilityMode] = useState<
    "hidden" | "related" | "outline" | "minimap" | "glossary"
  >("hidden");
  // Shared workspace dictionary. localStorage is only a bootstrap/offline fallback.
  const [tagAliases, setTagAliases] = useState<TagAliasMap>(() =>
    loadTagAliases(),
  );
  const [workspaceGlossary, setWorkspaceGlossary] = useState<GlossaryTerm[]>(
    [],
  );
  const [glossaryDraftTerm, setGlossaryDraftTerm] = useState("");
  const glossaryRevisionRef = useRef(0);
  const glossaryBaselineRef = useRef<GlossaryTerm[]>([]);
  const [tagPresentation, setTagPresentation] = useState<TagPresentationMap>(
    {},
  );
  const tagPresentationSaveTimerRef = useRef<number | null>(null);
  const tagAliasSaveTimerRef = useRef<number | null>(null);
  const tagAliasBaselineRef = useRef<{
    revision: number;
    aliases: TagAliasMap;
  }>({ revision: 0, aliases: loadTagAliases() });

  async function persistWorkspaceTagAliases(
    next: TagAliasMap,
  ): Promise<TagAliasMap> {
    if (tagAliasSaveTimerRef.current !== null) {
      window.clearTimeout(tagAliasSaveTimerRef.current);
      tagAliasSaveTimerRef.current = null;
    }
    const localSnapshot = saveTagAliases(next);
    setTagAliases(localSnapshot);
    if (!api) return localSnapshot;
    try {
      const saved = await api.saveWorkspaceTagAliases({
        aliases: localSnapshot,
        baseAliases: tagAliasBaselineRef.current.aliases,
        baseRevision: tagAliasBaselineRef.current.revision,
      });
      const resolved = saveTagAliases(saved.aliases ?? localSnapshot);
      tagAliasBaselineRef.current = {
        revision: saved.revision ?? tagAliasBaselineRef.current.revision,
        aliases: resolved,
      };
      if (saved.conflictTags?.length) {
        setTagAliases(resolved);
        setStatus(
          `タグ別名の競合を検出しました（${saved.conflictTags.map((tag) => `#${tag}`).join("、")}）。共有ワークスペース側の内容を保持しました。`,
        );
        return resolved;
      }
      setTagAliases(resolved);
      if (saved.merged)
        setStatus("タグ別名は他端末の変更と自動的に統合して保存しました。");
      return resolved;
    } catch (error: any) {
      setStatus(
        `タグ別名はこの端末には保存しましたが、共有ワークスペースには保存できませんでした。${error?.message ? ` ${error.message}` : ""}`,
      );
      return localSnapshot;
    }
  }

  function scheduleWorkspaceTagAliasesPersist(next: TagAliasMap): void {
    const localSnapshot = saveTagAliases(next);
    setTagAliases(localSnapshot);
    if (tagAliasSaveTimerRef.current !== null)
      window.clearTimeout(tagAliasSaveTimerRef.current);
    tagAliasSaveTimerRef.current = window.setTimeout(() => {
      tagAliasSaveTimerRef.current = null;
      void persistWorkspaceTagAliases(localSnapshot);
    }, 500);
  }

  function scheduleWorkspaceTagPresentationPersist(
    next: TagPresentationMap,
  ): void {
    const normalized = normalizeTagPresentation(next);
    setTagPresentation(normalized);
    if (tagPresentationSaveTimerRef.current !== null)
      window.clearTimeout(tagPresentationSaveTimerRef.current);
    tagPresentationSaveTimerRef.current = window.setTimeout(() => {
      tagPresentationSaveTimerRef.current = null;
      if (!api) return;
      void api
        .saveWorkspaceTagPresentation(normalized)
        .then((saved) =>
          setTagPresentation(
            normalizeTagPresentation(saved.settings ?? normalized),
          ),
        )
        .catch((error: any) =>
          setStatus(
            `タグの分類・色を共有ワークスペースへ保存できませんでした。${error?.message ? ` ${error.message}` : ""}`,
          ),
        );
    }, 500);
  }

  const [preferredPageInfoTab, setPreferredPageInfoTab] =
    useState<PageInfoTab>("properties");
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  // Tags selected from the everyday sidebar search. Multiple tags use AND semantics.
  const [searchTagFilters, setSearchTagFilters] = useState<string[]>([]);
  const [pageFilters, setPageFilters] =
    useState<PagePropertyFilters>(DEFAULT_PAGE_FILTERS);
  const [pageFiltersOpen, setPageFiltersOpen] = useState(false);
  const [templatePanelOpen, setTemplatePanelOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("local-notion:sidebar-open") !== "false",
  );
  const [linkPreviewWidth, setLinkPreviewWidth] = useState(() => {
    const saved = Number(
      localStorage.getItem("local-notion:link-preview-width"),
    );
    return Number.isFinite(saved) && saved >= 320 ? saved : 420;
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("tree");

  const [mainMode, setMainMode] = useState<MainMode>("empty");
  const workspaceScreen = useMemo(() => workspaceScreenForMainMode(mainMode), [mainMode]);
  const workspaceScreenDefinition = useMemo(() => getWorkspaceScreen(workspaceScreen), [workspaceScreen]);
  const [workspaceFeatureTabs, setWorkspaceFeatureTabs] = useState(() => workspaceTabsStore.read());
  const [workspaceLayout, setWorkspaceLayout] = useState(() => workspaceLayoutStore.read());

  useEffect(() => {
    rememberWorkspaceScreen(workspaceScreen);
    if (workspaceScreenDefinition.tabOwnership !== "none") {
      setWorkspaceFeatureTabs(openWorkspaceFeatureTab(workspaceScreen));
    }
  }, [workspaceScreen, workspaceScreenDefinition.tabOwnership]);

  const [ocrCenterFocusKey, setOcrCenterFocusKey] = useState("");
  const [knowledgeMapPageId, setKnowledgeMapPageId] = useState<string | null>(
    null,
  );
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyPreview, setHistoryPreview] = useState<PageBundle | null>(null);
  const [historyDiff, setHistoryDiff] = useState<HistoryDiffResult | null>(
    null,
  );
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkInfo[]>([]);
  const [pageComments, setPageComments] = useState<PageComment[]>([]);
  const [pageActivity, setPageActivity] = useState<PageActivityItem[]>([]);
  // Counts are fetched separately from the lazy tab details so badges never
  // show a misleading 0 before comments/history/backlinks are loaded.
  const [pageSidebarCounts, setPageSidebarCounts] =
    useState<PageSidebarCounts | null>(null);
  // Page side panels are intentionally loaded on demand. Opening a page must not
  // compete with history/comment/backlink I/O on slow SMB shares.
  const pageInfoLoadedTabsRef = useRef<Record<string, Set<PageInfoTab>>>({});
  const pageInfoLoadingTabsRef = useRef<Record<string, Set<PageInfoTab>>>({});
  const [databases, setDatabases] = useState<WorkspaceDatabase[]>([]);
  const [currentDb, setCurrentDb] = useState<WorkspaceDatabase | null>(null);
  const [pendingDbRowId, setPendingDbRowId] = useState<string | null>(null);
  const [databaseSidebarRefreshKey, setDatabaseSidebarRefreshKey] = useState(0);
  const currentDbRef = useRef<WorkspaceDatabase | null>(null);

  // Workspace feature tabs depend on the active page/database state. Keep these
  // callbacks after every referenced state declaration to avoid temporal dead-zone
  // failures during App initialization.
  const activateWorkspaceScreen = useCallback((screen: WorkspaceScreenId) => {
    setWorkspaceFeatureTabs(openWorkspaceFeatureTab(screen));
    switch (screen) {
      case "documents":
        setMainMode(workspaceActiveItem?.kind === "database" || (!current && currentDb) ? "database" : current ? "page" : "home");
        break;
      case "journal": setMainMode("journal"); break;
      case "inbox": setMainMode("inbox"); break;
      case "whiteboard": setMainMode("canvas"); break;
      case "web-builder": setMainMode("web-builder"); break;
      case "explorer": setMainMode("explorer"); break;
      case "external-sources": setMainMode("external-sources"); break;
      case "analysis": setMainMode("analysis"); break;
      case "knowledge-map": setMainMode("knowledge-map"); break;
      case "projects": setMainMode("projects"); break;
      case "wiki": setMainMode("wiki"); break;
      case "glossary": setMainMode("glossary"); break;
      case "utility": setMainMode("admin"); break;
      default: setMainMode("home");
    }
  }, [current, currentDb, workspaceActiveItem?.kind]);

  const closeWorkspaceScreen = useCallback((screen: WorkspaceScreenId) => {
    const next = closeWorkspaceFeatureTab(screen);
    setWorkspaceFeatureTabs(next);
    if (workspaceScreen === screen) activateWorkspaceScreen(next.activeScreen);
  }, [activateWorkspaceScreen, workspaceScreen]);

  const reorderWorkspaceScreen = useCallback((source: WorkspaceScreenId, target: WorkspaceScreenId) => {
    setWorkspaceFeatureTabs(reorderWorkspaceFeatureTabs(source, target));
  }, []);

  const applyWorkspacePreset = useCallback((presetId: WorkspacePresetId) => {
    const preset = getWorkspacePreset(presetId);
    setWorkspaceLayout(patchWorkspaceLayout({ preset: presetId, tabsVisible: true }));
    setWorkspaceFeatureTabs(replaceWorkspaceFeatureTabs(preset.screens, preset.activeScreen));
    activateWorkspaceScreen(preset.activeScreen);
  }, [activateWorkspaceScreen]);

  const changeWorkspaceDensity = useCallback((density: WorkspaceDensity) => {
    setWorkspaceLayout(patchWorkspaceLayout({ density }));
  }, []);

  const resetWorkspaceLayout = useCallback(() => {
    setWorkspaceLayout(patchWorkspaceLayout({ preset: "standard", density: "comfortable", tabsVisible: true }));
    setWorkspaceFeatureTabs(replaceWorkspaceFeatureTabs(["documents"], "documents"));
    activateWorkspaceScreen("documents");
  }, [activateWorkspaceScreen]);

  useEffect(() => workspaceActions.subscribe((action) => {
    if (action.type === "open-screen") activateWorkspaceScreen(action.screen);
    else if (action.type === "focus-documents") activateWorkspaceScreen("documents");
    else resetWorkspaceLayout();
  }), [activateWorkspaceScreen, resetWorkspaceLayout]);
  // v372: server-confirmed revisions are tracked separately from optimistic UI state.
  const lastPersistedDatabaseUpdatedAtRef = useRef<Record<string, string>>({});
  const pageSaveInFlightRef = useRef(false);
  const queuedPageSaveRef = useRef<any>(null);
  const pageSaveDrainRef = useRef<Promise<void> | null>(null);
  // Page saves are frequent while typing. Semantic embedding is intentionally
  // delayed and coalesced so it never competes with the editor or SMB writes.
  const semanticAutoUpdateTimerRef = useRef<number | null>(null);
  const semanticAutoUpdateRunningRef = useRef(false);
  const semanticAutoUpdatePendingTargetsRef = useRef(new Map<string, string>());
  const semanticEditorActivityAtRef = useRef(0);
  const semanticEditorActivityLastSentRef = useRef(0);
  const lastPersistedPageUpdatedAtRef = useRef<Record<string, string>>({});
  const lastPersistedPageSignatureRef = useRef<Record<string, string>>({});
  /** Last successful history checkpoint per page. Autosave never changes this. */
  const lastPageHistoryAtRef = useRef<Record<string, number>>({});
  const databaseSaveInFlightRef = useRef(false);
  const databaseSaveDrainRef = useRef<Promise<void> | null>(null);
  const queuedDatabaseSaveRef = useRef<{
    database: WorkspaceDatabase;
    label: string;
  } | null>(null);
  // Workspace DB tabs can remain open while the normal DB screen is not active.
  // Keep a separate, per-database coalescing queue so every save uses the last
  // server-confirmed revision rather than a transient table timestamp.
  const workspaceDatabaseSaveQueuesRef = useRef<
    Record<
      string,
      {
        inFlight: boolean;
        pending: WorkspaceDatabase | null;
      }
    >
  >({});
  // Ordinary grid edits are sent as compact row patches. Structural edits still
  // use the full-database queue because they alter schema, order, or view state.
  const databaseRowPatchQueuesRef = useRef<
    Record<
      string,
      {
        inFlight: boolean;
        pending: Map<string, Record<string, any>>;
      }
    >
  >({});
  const todayJst = useMemo(
    () =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
        new Date(),
      ),
    [],
  );
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [currentJournal, setCurrentJournal] = useState<JournalEntry | null>(
    null,
  );
  const [journalDate, setJournalDate] = useState(todayJst);
  const [journalMetaDraft, setJournalMetaDraft] = useState({
    mood: "",
    weather: "",
    tagsText: "",
  });
  const [journalBlocks, setJournalBlocks] = useState<BlockNoteDoc>([
    paragraph(),
  ]);
  const [journalDirty, setJournalDirty] = useState(false);
  const [journalSaving, setJournalSaving] = useState(false);
  const [journalAttachments, setJournalAttachments] = useState<
    AttachmentInfo[]
  >([]);
  const [journalAttachmentUploading, setJournalAttachmentUploading] =
    useState(false);
  const [journalAttachmentPreview, setJournalAttachmentPreview] =
    useState<AttachmentInfo | null>(null);
  // Journal uses the same last-write-wins queue model as pages and DB rows.
  const journalSaveInFlightRef = useRef(false);
  const queuedJournalSaveRef = useRef<any>(null);
  const journalSaveDrainRef = useRef<Promise<void> | null>(null);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalSearchResults, setJournalSearchResults] = useState<
    JournalSummary[] | null
  >(null);
  const [journalConflict, setJournalConflict] = useState<{
    local: JournalEntry;
    localMeta: { mood: string; weather: string; tagsText: string };
    localBlocks: BlockNoteDoc;
    remote: JournalEntry;
  } | null>(null);
  const [journalConflictSaving, setJournalConflictSaving] = useState(false);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [allAttachments, setAllAttachments] = useState<any[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<any[]>([]);
  const [backupItems, setBackupItems] = useState<any[]>([]);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureText, setQuickCaptureText] = useState("");
  const [inboxDrafts, setInboxDrafts] = useState<Record<string, string>>({});
  const [journalReviewMode, setJournalReviewMode] = useState<"week" | "month">(
    "week",
  );
  const [journalSideTab, setJournalSideTab] = useState<
    "related" | "activity" | "review" | "history" | "attachments"
  >("related");
  const [linkPreviewPage, setLinkPreviewPage] = useState<PageBundle | null>(
    null,
  );
  const [dbEditing, setDbEditing] = useState(false);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(
          localStorage.getItem("local-notion:collapsed-pages") || "[]",
        ),
      );
    } catch {
      return new Set();
    }
  });
  const { contextMenu, openPageContextMenu, closePageContextMenu } =
    usePageContextMenu();
  const deferredBlockNoteBlocks = useDeferredValue(blockNoteBlocks);
  const markdownPreview = useMemo(
    () => blockNoteToMarkdown(deferredBlockNoteBlocks),
    [deferredBlockNoteBlocks],
  );

  // Primary navigation and previews use a dedicated session so obsolete requests are cancelled.
  const { navigationCoordinatorRef, pageOpenAbortRef, linkPreviewAbortRef } =
    useWorkspaceNavigationSession();
  const currentPageIdRef = useRef<string | null>(null);
  // Keeps page rename detection stable across queued autosaves.
  const lastPersistedPageTitleRef = useRef<Record<string, string>>({});
  const suppressNextJournalChangeRef = useRef(false);
  const journalMetaDraftRef = useRef(journalMetaDraft);

  useEffect(() => {
    journalMetaDraftRef.current = journalMetaDraft;
  }, [journalMetaDraft]);

  function updateJournalMetaDraft(patch: Partial<typeof journalMetaDraft>) {
    setJournalMetaDraft((prev) => ({ ...prev, ...patch }));
    setJournalDirty(true);
  }

  useEffect(() => {
    currentPageIdRef.current = current?.meta.id ?? null;
  }, [current?.meta.id]);


  useEffect(() => {
    const handleSemanticUpdated = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      recordAiActivity({
        kind: "index",
        title: "関連Indexを更新しました",
        detail: detail.mode === "full" ? "ワークスペース全体の関連候補を再計算できます。" : "変更されたページ・DB行の関連候補を更新しました。",
        targetKey: detail.revision ? `semantic:${detail.revision}` : "semantic:index",
      });
    };
    const handleTargetDirty = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      recordAiActivity({
        kind: "related",
        title: "関連候補を更新待ちにしました",
        detail: "保存後、アイドル時に関連ページへ反映します。",
        targetKey: detail.targetKey || "semantic:target",
      });
    };
    window.addEventListener("local-notion:semantic-index-updated", handleSemanticUpdated);
    window.addEventListener("local-notion:semantic-target-dirty", handleTargetDirty);
    return () => {
      window.removeEventListener("local-notion:semantic-index-updated", handleSemanticUpdated);
      window.removeEventListener("local-notion:semantic-target-dirty", handleTargetDirty);
    };
  }, []);

  useEffect(() => {
    function handleDatabaseRowContentLinksUpdated() {
      const pageId = currentPageIdRef.current;
      if (!api || !pageId) return;
      api
        .listBacklinks(pageId)
        .then(setBacklinks)
        .catch(() => undefined);
    }
    window.addEventListener(
      "local-notion:database-row-content-links-updated",
      handleDatabaseRowContentLinksUpdated as EventListener,
    );
    return () =>
      window.removeEventListener(
        "local-notion:database-row-content-links-updated",
        handleDatabaseRowContentLinksUpdated as EventListener,
      );
  }, [api]);

  useEffect(() => {
    function handleOpenOcrCenter(event: Event) {
      const detail =
        (event as CustomEvent<{ inboxId?: string; attachmentId?: string }>)
          .detail || {};
      setOcrCenterFocusKey(
        detail.inboxId && detail.attachmentId
          ? `${detail.inboxId}:${detail.attachmentId}`
          : "",
      );
      setMainMode("ocr");
      setStatus("OCRセンターを開きました");
    }
    window.addEventListener(
      "local-notion:open-ocr-center",
      handleOpenOcrCenter as EventListener,
    );
    return () =>
      window.removeEventListener(
        "local-notion:open-ocr-center",
        handleOpenOcrCenter as EventListener,
      );
  }, []);

  useEffect(() => {
    currentDbRef.current = currentDb;
  }, [currentDb]);

  useEffect(() => {
    if (
      !window.localNotion?.onBeforeQuit ||
      !window.localNotion?.notifySaveFlushComplete
    )
      return;
    const unsubscribe = window.localNotion.onBeforeQuit((requestId) => {
      void (async () => {
        try {
          await flushPendingSaves("終了前に未保存内容を保存しました");
          if (tagAliasSaveTimerRef.current !== null)
            await persistWorkspaceTagAliases(tagAliases);
          // Do not leave a normal close looking like a second editor for five minutes.
          if (editing && current?.meta.id)
            await api?.releaseLock(current.meta.id).catch(() => undefined);
          if (currentDb?.id)
            await api?.releaseDatabaseLock(currentDb.id).catch(() => undefined);
        } finally {
          window.localNotion.notifySaveFlushComplete(requestId);
        }
      })();
    });
    return unsubscribe;
  }, [
    api,
    dirty,
    journalDirty,
    editing,
    current?.meta.id,
    currentJournal?.date,
    currentDb?.id,
    tagAliases,
  ]);

  useEffect(
    () => () => {
      if (tagAliasSaveTimerRef.current !== null)
        window.clearTimeout(tagAliasSaveTimerRef.current);
      if (tagPresentationSaveTimerRef.current !== null)
        window.clearTimeout(tagPresentationSaveTimerRef.current);
    },
    [],
  );

  useElectronBootstrap({
    onBootstrap: (payload) => {
      setApiUrl(payload.apiUrl);
      setApiToken(payload.apiToken || "");
      setSharedRoot(payload.sharedRoot);
      setPrivatePagesRoot(payload.privatePagesRoot || "");
      setPrivateDatabasesRoot(payload.privateDatabasesRoot || "");
      setOcrBinaryPath(payload.ocrBinaryPath || "");
      setPopplerBinaryPath(payload.popplerBinaryPath || "");
      setStartupProgress({
        stage: "ready",
        title: "ローカルデータを読み込んでいます",
        message: "まもなく操作を開始できます。",
      });
      setStatus("準備完了");
    },
    onError: (message) => {
      setStartupFailure(message);
      setStatus(message);
    },
    onStartupProgress: (progress) => {
      setStartupProgress(progress);
      if (progress.stage === "error")
        setStartupFailure(progress.detail || progress.message);
    },
  });

  useEffect(() => {
    if (initialWorkspaceReady) {
      window.dispatchEvent(new Event("local-notion:workspace-ready"));
      return;
    }
    const timer = window.setTimeout(() => setStartupGateExpanded(true), 1400);
    return () => window.clearTimeout(timer);
  }, [initialWorkspaceReady]);

  useEffect(() => {
    if (startupFailure) setStartupGateExpanded(true);
  }, [startupFailure]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .getWorkspaceTagPresentation()
      .then(({ settings }) => {
        if (!cancelled)
          setTagPresentation(normalizeTagPresentation(settings ?? {}));
      })
      .catch(() => undefined);
    void api
      .getWorkspaceGlossary()
      .then(({ terms, revision }) => {
        if (cancelled) return;
        const resolved = Array.isArray(terms) ? terms : [];
        glossaryRevisionRef.current =
          Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
        glossaryBaselineRef.current = resolved;
        setWorkspaceGlossary(resolved);
      })
      .catch(() => undefined);
    void api
      .getWorkspaceTagAliases()
      .then(async ({ aliases, revision }) => {
        if (cancelled) return;
        const remote = saveTagAliases(aliases ?? {});
        tagAliasBaselineRef.current = {
          revision:
            Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
          aliases: remote,
        };
        if (Object.keys(remote).length > 0) {
          setTagAliases(remote);
          return;
        }
        // One-time migration of a pre-v417 local dictionary into the shared workspace.
        const local = loadTagAliases();
        if (Object.keys(local).length > 0)
          await persistWorkspaceTagAliases(local);
      })
      .catch(() => {
        // Offline fallback remains usable; persistence errors are surfaced only on write.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    const handleLocalPageHash = () => {
      const pageId = localPageIdFromLocationHash();
      if (!pageId) return;
      window.history.replaceState(
        null,
        document.title,
        window.location.pathname + window.location.search,
      );
      previewLinkedPage(pageId);
    };
    window.addEventListener("hashchange", handleLocalPageHash);
    handleLocalPageHash();
    return () => window.removeEventListener("hashchange", handleLocalPageHash);
  }, [apiUrl]);

  useEffect(() => {
    localStorage.setItem(
      "local-notion:collapsed-pages",
      JSON.stringify(Array.from(collapsedIds)),
    );
  }, [collapsedIds]);

  useEffect(() => {
    localStorage.setItem(
      "local-notion:sidebar-open",
      sidebarOpen ? "true" : "false",
    );
  }, [sidebarOpen]);

  useEffect(() => {
    localStorage.setItem(
      "local-notion:link-preview-width",
      String(linkPreviewWidth),
    );
  }, [linkPreviewWidth]);

  useEffect(() => {
    localStorage.setItem(
      "local-notion:app-settings",
      JSON.stringify(appSettings),
    );
    document.documentElement.dataset.localNotionDensity = appSettings.density;
    document.documentElement.dataset.localNotionTheme = appSettings.theme;
  }, [appSettings]);

  function startLinkPreviewResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = linkPreviewWidth;
    const minWidth = 320;
    const maxWidth = Math.min(
      760,
      Math.max(360, window.innerWidth - (sidebarOpen ? 360 : 120)),
    );

    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(
        maxWidth,
        Math.max(minWidth, startWidth + (startX - moveEvent.clientX)),
      );
      setLinkPreviewWidth(Math.round(next));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-link-preview");
    };

    document.body.classList.add("is-resizing-link-preview");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Space"
      ) {
        event.preventDefault();
        setQuickCaptureOpen(true);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setWorkspaceAiDrawerMode("chat");
        setWorkspaceAiInitialQuery("");
        setWorkspaceAiSearchOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function loadHealth() {
    if (!api) return;
    try {
      const healthInfo = await api.health();
      setHealth(healthInfo);
    } catch {
      setHealth(null);
    }
  }

  type RefreshOptions = {
    importShared?: boolean;
    tree?: boolean;
    databases?: boolean;
    trash?: boolean;
    journals?: boolean;
    inbox?: boolean;
    tasks?: boolean;
    dashboard?: boolean;
    attachments?: boolean;
    brokenLinks?: boolean;
    backups?: boolean;
    health?: boolean;
  };

  async function refreshWorkspace(
    message = "表示を更新しました",
    options: RefreshOptions = {},
  ) {
    if (!api) return;
    const opts: Required<RefreshOptions> = {
      importShared: options.importShared ?? false,
      tree: options.tree ?? true,
      databases: options.databases ?? true,
      trash: options.trash ?? false,
      journals: options.journals ?? true,
      inbox: options.inbox ?? false,
      tasks: options.tasks ?? false,
      dashboard: options.dashboard ?? false,
      attachments: options.attachments ?? false,
      brokenLinks: options.brokenLinks ?? false,
      backups: options.backups ?? false,
      health: options.health ?? false,
    };

    if (opts.health) await loadHealth();
    if (opts.importShared) {
      setWorkspaceSyncState("syncing");
      setWorkspaceSyncDetail("共有フォルダを同期中");
      try {
        await api.importFromShared();
        // Imported changes can originate on another device and do not pass
        // through local save handlers.  Emit one broad mutation after the
        // import completes; consumers debounce this rather than refetching per file.
        notifyWorkspaceGraphMutation("shared-imported", [], {
          cacheScopes: [
            "workspace",
            "graph",
            "search",
            "tasks",
            "attachments",
            "notifications",
          ],
        });
        setWorkspaceSyncState("ready");
        setWorkspaceSyncDetail("共有フォルダと同期済み");
      } catch (err: any) {
        console.warn("importFromShared failed", err);
        setWorkspaceSyncState("error");
        setWorkspaceSyncDetail(
          err?.message
            ? `同期エラー: ${err.message}`
            : "共有フォルダを同期できませんでした",
        );
      }
    }

    const jobs: Promise<void>[] = [];
    if (opts.tree) jobs.push(api.listPageTree().then(setTree));
    if (opts.databases)
      jobs.push(
        api.listDatabases().then((nextDatabases) => {
          nextDatabases.forEach((database) => {
            const known =
              lastPersistedDatabaseUpdatedAtRef.current[database.id];
            if (
              !known ||
              Date.parse(database.updatedAt || "") >= Date.parse(known || "")
            ) {
              lastPersistedDatabaseUpdatedAtRef.current[database.id] =
                database.updatedAt;
            }
          });
          setDatabases(nextDatabases);
        }),
      );
    if (opts.trash) {
      jobs.push(api.listTrash().then(setTrashedPages));
      jobs.push(
        api
          .listTrashedDatabases()
          .then(setTrashedDatabases)
          .catch(() => setTrashedDatabases([])),
      );
    }
    if (opts.journals) jobs.push(api.listJournals().then(setJournals));
    if (opts.inbox) jobs.push(api.listInboxItems().then(setInboxItems));
    if (opts.tasks)
      jobs.push(
        api
          .listTasks()
          .then(setTasks)
          .catch(() => setTasks([])),
      );
    if (opts.dashboard)
      jobs.push(
        api
          .getDashboard()
          .then(setDashboard)
          .catch(() => setDashboard(null)),
      );
    if (opts.attachments)
      jobs.push(
        api
          .listAllAttachments()
          .then(setAllAttachments)
          .catch(() => setAllAttachments([])),
      );
    if (opts.brokenLinks)
      jobs.push(
        api
          .listBrokenLinks()
          .then(setBrokenLinks)
          .catch(() => setBrokenLinks([])),
      );
    if (opts.backups)
      jobs.push(
        api
          .listBackups()
          .then(setBackupItems)
          .catch(() => setBackupItems([])),
      );

    await Promise.all(jobs);
    if (opts.databases) setDatabaseSidebarRefreshKey((value) => value + 1);
    setStatus(message);
  }

  const workspaceRefreshPriorityValue: Record<
    WorkspaceRefreshPriority,
    number
  > = {
    save: 4,
    manual: 3,
    startup: 2,
    periodic: 1,
  };

  function mergeRefreshOptions(
    left: RefreshOptions,
    right: RefreshOptions,
  ): RefreshOptions {
    const keys = Object.keys({ ...left, ...right }) as Array<
      keyof RefreshOptions
    >;
    return keys.reduce<RefreshOptions>((merged, key) => {
      if (left[key] || right[key]) merged[key] = true;
      return merged;
    }, {});
  }

  async function drainWorkspaceRefreshQueue() {
    if (workspaceRefreshRunningRef.current) return;
    workspaceRefreshRunningRef.current = true;
    try {
      while (workspaceRefreshQueueRef.current.length > 0) {
        workspaceRefreshQueueRef.current.sort(
          (a, b) =>
            workspaceRefreshPriorityValue[b.priority] -
            workspaceRefreshPriorityValue[a.priority],
        );
        const next = workspaceRefreshQueueRef.current.shift();
        if (!next) continue;
        try {
          await refreshWorkspace(next.message, next.options);
          next.resolve();
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      workspaceRefreshRunningRef.current = false;
    }
  }

  function enqueueWorkspaceRefresh(
    message: string,
    options: RefreshOptions,
    priority: WorkspaceRefreshPriority,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const queue = workspaceRefreshQueueRef.current;
      // Periodic refreshes are best-effort. Do not enqueue another one while
      // stronger work is already queued or running.
      if (
        priority === "periodic" &&
        (workspaceRefreshRunningRef.current ||
          queue.some(
            (item) =>
              workspaceRefreshPriorityValue[item.priority] >=
              workspaceRefreshPriorityValue.periodic,
          ))
      ) {
        resolve();
        return;
      }

      // Coalesce only equivalent-priority refreshes. Keeping imports separate
      // from save refreshes avoids a save operation unexpectedly importing a
      // slow network share just because a periodic job was pending.
      const existing = queue.find(
        (item) =>
          item.priority === priority &&
          Boolean(item.options.importShared) === Boolean(options.importShared),
      );
      if (existing) {
        existing.options = mergeRefreshOptions(existing.options, options);
        existing.message = message;
        const previousResolve = existing.resolve;
        const previousReject = existing.reject;
        existing.resolve = () => {
          previousResolve();
          resolve();
        };
        existing.reject = (error) => {
          previousReject(error);
          reject(error);
        };
      } else {
        queue.push({ message, options, priority, resolve, reject });
      }
      void drainWorkspaceRefreshQueue();
    });
  }

  async function reload(message = "共有フォルダから再読み込みしました") {
    await enqueueWorkspaceRefresh(
      message,
      {
        importShared: true,
        health: true,
        tree: true,
        databases: true,
        trash: true,
        journals: true,
        inbox: true,
        tasks: true,
        dashboard: true,
        attachments: false,
        brokenLinks: false,
        backups: false,
      },
      "manual",
    );
  }

  async function lightRefresh(
    message = "表示を更新しました",
    priority: WorkspaceRefreshPriority = "save",
    options: RefreshOptions = {},
  ) {
    if (lightRefreshInFlightCountRef.current > 0 && priority === "periodic")
      return;
    lightRefreshInFlightCountRef.current += 1;
    try {
      await enqueueWorkspaceRefresh(
        message,
        {
          tree: options.tree ?? true,
          // Heavy collections are opt-in for periodic refresh. Ordinary saves and
          // user actions can still request them explicitly. This avoids SMB/shared
          // folder reads while the user is just editing a page.
          databases: options.databases ?? priority !== "periodic",
          journals: options.journals ?? priority !== "periodic",
          inbox: options.inbox ?? false,
          tasks: options.tasks ?? false,
          dashboard: options.dashboard ?? false,
        },
        priority,
      );
    } finally {
      lightRefreshInFlightCountRef.current = Math.max(
        0,
        lightRefreshInFlightCountRef.current - 1,
      );
    }
  }

  async function fullMaintenanceRefresh(message = "管理情報を更新しました") {
    await enqueueWorkspaceRefresh(
      message,
      {
        importShared: true,
        health: true,
        tree: true,
        databases: true,
        trash: true,
        journals: true,
        inbox: true,
        tasks: true,
        dashboard: true,
        attachments: true,
        brokenLinks: true,
        backups: true,
      },
      "manual",
    );
  }

  useWorkspaceStartupSync({
    apiUrl,
    enabled: Boolean(api),
    loadHealth,
    enqueue: enqueueWorkspaceRefresh,
    setStatus,
    onInitialLocalReady: () => {
      setStartupFailure(null);
      setInitialWorkspaceReady(true);
    },
    onInitialLocalError: (message) => setStartupFailure(message),
  });

  useEffect(() => {
    if (!api) return;
    const runWhenIdle = () => {
      // 共有フォルダ上の一覧読込は低性能端末では意外に重い。
      // 非表示中・編集中・別の軽量更新中は見送り、次回周期に再試行する。
      if (
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        editing ||
        dbEditing ||
        lightRefreshInFlightCountRef.current > 0
      )
        return;
      const run = () => {
        void lightRefresh("軽量同期しました", "periodic", {
          tree: sidebarOpen && viewMode === "tree",
          databases: mainMode === "database" || viewMode === "databases",
          journals: mainMode === "journal",
        }).catch(() => undefined);
      };
      const requestIdle = (window as any).requestIdleCallback as
        | undefined
        | ((callback: () => void, options?: { timeout?: number }) => number);
      if (requestIdle) requestIdle(run, { timeout: 2500 });
      else window.setTimeout(run, 0);
    };
    const timer = window.setInterval(runWhenIdle, 300_000);
    return () => window.clearInterval(timer);
  }, [api, editing, dbEditing, mainMode, viewMode, sidebarOpen]);

  const clearSaveRecovery = saveRecoveryController.clear;
  const scheduleSaveRetry = saveRecoveryController.schedule;

  async function retryPendingSavesNow() {
    saveRecoveryController.resetAll();
    if (queuedPageSaveRef.current || dirty) await save();
    if (queuedJournalSaveRef.current || journalDirty) await saveJournalNow();
    if (queuedDatabaseSaveRef.current) {
      const queued = queuedDatabaseSaveRef.current;
      queuedDatabaseSaveRef.current = null;
      await flushDatabaseSaveQueue(queued.database, queued.label);
    }
    setStatus("未保存内容の再試行を開始しました。");
  }

  async function flushPendingSaves(
    reason = "画面を切り替える前に保存しました",
  ) {
    if (!api) return;
    try {
      await flushQueuedSave({
        shouldFlush: Boolean(
          dirty || pageSaveInFlightRef.current || queuedPageSaveRef.current,
        ),
        requestSave: save,
        getDrain: () => pageSaveDrainRef.current,
      });
      await flushQueuedSave({
        shouldFlush: Boolean(
          journalDirty ||
          journalSaveInFlightRef.current ||
          queuedJournalSaveRef.current,
        ),
        requestSave: saveJournalNow,
        getDrain: () => journalSaveDrainRef.current,
      });
      if (databaseSaveInFlightRef.current) {
        await (databaseSaveDrainRef.current ?? Promise.resolve());
      } else if (queuedDatabaseSaveRef.current) {
        const queued = queuedDatabaseSaveRef.current;
        queuedDatabaseSaveRef.current = null;
        await flushDatabaseSaveQueue(queued.database, queued.label);
      }
      const smartFlush = (window as any).__localNotionFlushSmartAssistSaves as
        undefined | (() => Promise<void>);
      if (smartFlush) await smartFlush();
      const drawerFlush = (window as any).__localNotionFlushLinkPreviewSave as
        undefined | (() => Promise<void>);
      if (drawerFlush) await drawerFlush();
      setStatus(reason);
    } catch (error: any) {
      setStatus(
        error?.message ?? "保存に失敗しました。未保存状態を維持しています。",
      );
      throw error;
    }
  }

  async function releaseActiveEditorLocks() {
    await flushPendingSaves();
    if (editing && current)
      await api?.releaseLock(current.meta.id).catch(() => undefined);
    if (currentDb?.id)
      await api?.releaseDatabaseLock(currentDb.id).catch(() => undefined);
    setEditing(false);
    setPageReadOnlyReason(null);
    setDbEditing(false);
  }

  async function openOcrCenter() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("ocr");
    setViewMode("tree");
    setInboxItems(await api.listInboxItems());
    setStatus("OCRセンターを表示しました");
  }

  async function openInbox() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    if (editing && current)
      await api.releaseLock(current.meta.id).catch(() => undefined);
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("inbox");
    setViewMode("tree");
    setInboxItems(await api.listInboxItems());
    setStatus("Inboxを表示しました");
  }

  async function openHome() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("home");
    setCurrent(null);
    setCurrentDb(null);
    setDashboard(await api.getDashboard().catch(() => dashboard));
    setStatus("ホームを表示しました");
  }

  async function openSmartAssist() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("smart");
    setCurrentDb(null);
    setViewMode("tree");
    setStatus("Local Smart Assistを表示しました");
  }

  async function openAttachmentsManager() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("attachments");
    setCurrent(null);
    setCurrentDb(null);
    setAllAttachments(await api.listAllAttachments().catch(() => []));
    setStatus("添付ファイルを表示しました");
  }

  async function openLinksManager() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("links");
    setCurrent(null);
    setCurrentDb(null);
    setBrokenLinks(await api.listBrokenLinks().catch(() => []));
    setStatus("リンク管理を表示しました");
  }

  async function openNotificationsCenter() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("notifications");
    setCurrent(null);
    setCurrentDb(null);
    const [taskList, inboxList, broken, conflictList, dashboardData] =
      await Promise.all([
        api.listTasks().catch(() => tasks),
        api.listInboxItems().catch(() => inboxItems),
        api.listBrokenLinks().catch(() => brokenLinks),
        api.listConflicts().catch(() => conflicts),
        api.getDashboard().catch(() => dashboard),
      ]);
    setTasks(taskList);
    setInboxItems(inboxList);
    setBrokenLinks(broken);
    setConflicts(conflictList);
    setDashboard(dashboardData);
    setStatus("通知センターを表示しました");
  }

  async function openTagManager() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("tags");
    setCurrent(null);
    setCurrentDb(null);
    setViewMode("tree");
    setStatus("タグ管理を表示しました");
  }

  async function openGlossaryManager(draftTerm?: string) {
    if (!api) return;
    await releaseActiveEditorLocks();
    if (draftTerm?.trim()) setGlossaryDraftTerm(draftTerm.trim());
    setMainMode("glossary");
    setCurrent(null);
    setCurrentDb(null);
    setViewMode("tree");
    setStatus(draftTerm?.trim() ? `「${draftTerm.trim()}」を新規用語候補として開きました` : "用語辞書を表示しました");
  }

  async function persistWorkspaceGlossary(next: GlossaryTerm[]): Promise<void> {
    if (!api) return;
    const saved = await api.saveWorkspaceGlossary({
      terms: next,
      baseTerms: glossaryBaselineRef.current,
      baseRevision: glossaryRevisionRef.current,
    });
    const resolved = saved.terms ?? next;
    glossaryRevisionRef.current = saved.revision ?? glossaryRevisionRef.current;
    glossaryBaselineRef.current = resolved;
    setWorkspaceGlossary(resolved);
    setStatus(
      saved.merged
        ? "他端末の変更と統合して用語辞書を保存しました"
        : "用語辞書を保存しました",
    );
  }

  async function openWikiManager() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("wiki");
    setCurrent(null);
    setCurrentDb(null);
    setViewMode("tree");
    setStatus("Wiki管理を表示しました");
  }

  async function openProjectHub() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("projects");
    setCurrent(null);
    setCurrentDb(null);
    setViewMode("tree");
    setTasks(await api.listTasks().catch(() => tasks));
    setStatus("案件・プロジェクトを表示しました");
  }

  async function openKnowledgeMap() {
    if (!api || !current?.meta.id) {
      setStatus("関係図を開くページを選択してください");
      return;
    }
    await flushPendingSaves("保存内容を反映して関係図を開きます").catch(
      () => undefined,
    );
    setKnowledgeMapPageId(current.meta.id);
    setMainMode("knowledge-map");
    setViewMode("tree");
    setStatus("ページ関係図を表示しました");
  }


  async function openExternalSources() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("external-sources");
    setViewMode("tree");
    setStatus("外部ソースを表示しました");
  }

  async function openWebBuilder() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("web-builder");
    setViewMode("tree");
    setStatus("Web Builderを表示しました");
  }

  async function openFreeformCanvas() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("canvas");
    setViewMode("tree");
    setStatus("ホワイトボードを表示しました");
  }

  async function openAnalysisNotebook() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("analysis");
    setViewMode("tree");
    setStatus("分析ノートブックを表示しました");
  }

  async function createProjectHub(title: string) {
    if (!api) return;
    const created = await api.createPage(title, null, "shared");
    const props = normalizePageProperties({
      ...created.meta.properties,
      projectRole: "project",
      projectStatus: "計画中",
      projectSummary: "",
      projectDueDate: "",
    });
    await api.savePage({
      id: created.meta.id,
      title,
      markdown: `# ${title}\n\n## 概要\n\n## 進捗\n\n## 関連事項\n`,
      blocksuite: created.blocksuite,
      baseUpdatedAt: created.meta.updatedAt,
      properties: props,
      icon: "◈",
      scope: created.meta.scope,
      historyReason: "metadata_changed",
    });
    await reload();
    setStatus("案件を作成しました");
  }

  async function assignPageToProject(page: PageWithLock, projectId: string) {
    if (!api) return;
    const full = await api.getPage(page.id);
    await api.savePage({
      id: full.meta.id,
      title: full.meta.title,
      markdown: full.markdown,
      blocksuite: full.blocksuite,
      baseUpdatedAt: full.meta.updatedAt,
      properties: normalizePageProperties({
        ...full.meta.properties,
        projectId,
      }),
      icon: full.meta.icon ?? null,
      scope: full.meta.scope,
      historyReason: "metadata_changed",
    });
    await reload();
    setStatus("ページを案件に追加しました");
  }

  async function openWorkspaceAdmin() {
    if (!api) return;
    await releaseActiveEditorLocks();
    setMainMode("admin");
    setCurrent(null);
    setCurrentDb(null);
    setDashboard(await api.getDashboard().catch(() => dashboard));
    setStatus("共有フォルダ管理を表示しました");
  }

  async function openBackupCenter() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    if (editing && current)
      await api.releaseLock(current.meta.id).catch(() => undefined);
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("backup");
    setViewMode("tree");
    setBackupItems(await api.listBackups().catch(() => []));
    setTrashedPages(await api.listTrash().catch(() => []));
    setConflicts(await api.listConflicts().catch(() => []));
    setAllAttachments(await api.listAllAttachments().catch(() => []));
    setDashboard(await api.getDashboard().catch(() => dashboard));
    setStatus("バックアップ・復元センターを表示しました");
  }

  async function restoreBackupItem(id: string) {
    if (!api) return;
    if (
      !confirm(
        "このバックアップを復元しますか？現在のデータは必要に応じてバックアップされます。",
      )
    )
      return;
    await api.restoreBackup(id);
    setStatus("バックアップから復元しました");
    await reload();
    setBackupItems(await api.listBackups().catch(() => []));
  }

  async function openTasks() {
    if (!api) return;
    await releaseActiveEditorLocks();
    navigationCoordinatorRef.current.invalidatePrimary();
    if (editing && current)
      await api.releaseLock(current.meta.id).catch(() => undefined);
    setCurrent(null);
    currentPageIdRef.current = null;
    setCurrentDb(null);
    setEditing(false);
    setMainMode("tasks");
    setViewMode("tree");
    setTasks(await api.listTasks().catch(() => []));
    setStatus("Tasksを表示しました");
  }

  async function quickCapture() {
    if (!api) return;
    const text = quickCaptureText.trim();
    if (!text) return;
    try {
      await api.createInboxItem(text);
      setQuickCaptureText("");
      setQuickCaptureOpen(false);
      setInboxItems(await api.listInboxItems());
      setStatus("Inboxに追加しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function captureInboxFiles(files: File[]) {
    if (!api) return;
    const captured: string[] = [];
    for (const file of files) {
      const meta = [
        `ファイル: ${file.name}`,
        `種類: ${file.type || "不明"}`,
        `サイズ: ${Math.ceil(file.size / 1024)}KB`,
      ].join("\n");
      const item = await api.createInboxItem(meta, file.name, "drop");
      await api.uploadInboxAttachmentFile(item.id, file);
      captured.push(file.name);
    }
    setInboxItems(await api.listInboxItems());
    setStatus(`${captured.length}件をInboxへ追加しました`);
  }

  async function updateInboxItem(id: string, patch: Partial<InboxItem>) {
    if (!api) return;
    try {
      const next = await api.updateInboxItem(id, patch);
      setInboxItems((prev) =>
        prev.map((item) => (item.id === id ? next : item)),
      );
      if (typeof patch.text === "string") {
        setInboxDrafts((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      }
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function runInboxAttachmentOcr(
    inboxId: string,
    attachmentId: string,
    options: {
      mode?: "inspect" | "page" | "all";
      page?: number;
      preprocessing?: "standard" | "enhanced";
    } = {},
  ): Promise<InboxItem> {
    if (!api)
      throw new Error("OCRを開始できません。ローカルAPIに接続してください。");
    try {
      setStatus(
        options.mode === "all"
          ? "PDF全ページOCRをキューへ追加しました"
          : options.mode === "page"
            ? "PDFページOCRをキューへ追加しました"
            : "OCR処理をキューへ追加しました",
      );
      const next = await api.enqueueInboxAttachmentOcr(
        inboxId,
        attachmentId,
        options,
      );
      setInboxItems((prev) =>
        prev.map((item) => (item.id === inboxId ? next : item)),
      );
      const updatedAttachment = next.attachments?.find(
        (file) => file.id === attachmentId,
      );
      setStatus(
        updatedAttachment?.ocrQueue?.status === "queued"
          ? "OCRキューに追加しました。画面を移動してもこの端末内で順番に処理します。"
          : "OCRキューの状態を更新しました。",
      );
      return next;
    } catch (e: any) {
      setStatus(e.message || "OCRに失敗しました");
      throw e;
    }
  }

  async function cancelInboxAttachmentOcr(
    inboxId: string,
    attachmentId: string,
  ): Promise<void> {
    if (!api) return;
    const next = await api.cancelInboxAttachmentOcrQueue(inboxId, attachmentId);
    setInboxItems((prev) =>
      prev.map((item) => (item.id === inboxId ? next : item)),
    );
    setStatus(
      "OCRキューの停止を受け付けました。実行中の場合は現在のページ処理完了後に停止します。",
    );
  }

  async function retryInboxAttachmentOcr(
    inboxId: string,
    attachmentId: string,
  ): Promise<void> {
    if (!api) return;
    const next = await api.retryInboxAttachmentOcrQueue(inboxId, attachmentId);
    setInboxItems((prev) =>
      prev.map((item) => (item.id === inboxId ? next : item)),
    );
    setStatus("OCRを再実行キューへ追加しました。");
  }

  async function refreshInboxOcrQueue(): Promise<void> {
    if (!api) return;
    setInboxItems(await api.listInboxItems());
  }

  async function sendJournalAttachmentToOcrCenter(
    attachment: AttachmentInfo,
  ): Promise<void> {
    if (!api || !currentJournal) return;
    try {
      const item = await api.sendAttachmentToOcrCenter({
        sourceType: "journal",
        attachmentId: attachment.id,
        date: currentJournal.date,
        sourceTitle: currentJournal.title || `${currentJournal.date} Journal`,
      });
      setInboxItems((previous) => [
        item,
        ...previous.filter((candidate) => candidate.id !== item.id),
      ]);
      const workingAttachment = item.attachments?.[0];
      setOcrCenterFocusKey(
        workingAttachment ? `${item.id}:${workingAttachment.id}` : "",
      );
      await openOcrCenter();
      setStatus(
        item.attachments?.[0]?.ocr?.status === "ready" ||
          item.attachments?.[0]?.pdfText?.status === "ready"
          ? "OCR結果をOCRセンターで開きました。"
          : "OCRセンターへ追加しました。処理方法はOCRセンターで選択してください。",
      );
    } catch (error: any) {
      setStatus(error?.message || "OCRセンターへ送信できませんでした");
    }
  }

  async function archiveInboxItem(id: string) {
    if (!api) return;
    try {
      await api.updateInboxItem(id, { status: "archived" });
      setInboxItems(await api.listInboxItems());
      setStatus("Inboxをアーカイブしました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function deleteInboxItem(id: string) {
    if (!api) return;
    await api.deleteInboxItem(id);
    setInboxItems(await api.listInboxItems());
    setStatus("Inboxから削除しました");
  }

  async function inboxToPage(item: InboxItem) {
    if (!api) return;
    try {
      const page = await api.createPage(item.title || "Inboxメモ", null);
      const blocks = [
        heading(item.title || "Inboxメモ", 1),
        paragraph(item.text),
      ];
      await api.savePage({
        id: page.meta.id,
        title: item.title || "Inboxメモ",
        markdown: blockNoteToMarkdown(blocks),
        blocksuite: { version: 1, kind: "blocknote", blocks },
        baseUpdatedAt: page.meta.updatedAt,
        properties: { ...DEFAULT_PAGE_PROPERTIES, tags: ["Inbox"] },
        icon: "📥",
        scope: "private",
      });
      await api.deleteInboxItem(item.id);
      await reload("Inboxメモをページ化しました");
      await openPage(page.meta.id);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function inboxToTodayJournal(item: InboxItem) {
    if (!api) return;
    try {
      const entry = await api.getJournal(todayJst);
      const existing = blockNoteContentFromPage({
        meta: {
          id: `journal_${entry.date}`,
          title: entry.title,
          parentId: null,
          icon: entry.icon || "📅",
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy,
          sortOrder: 0,
          trashed: false,
          properties: DEFAULT_PAGE_PROPERTIES,
          scope: "private",
        },
        markdown: entry.markdown,
        blocksuite: entry.blocksuite,
      } as any);
      const blocks = [
        ...existing,
        heading("Inboxから", 2),
        paragraph(item.text),
      ];
      await api.saveJournal({
        ...entry,
        markdown: blockNoteToMarkdown(blocks),
        blocksuite: { version: 1, kind: "blocknote", blocks },
      });
      await api.deleteInboxItem(item.id);
      await reload("今日のJournalへ追加しました");
      await openJournal(todayJst);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function applyCreatedPageSnapshot(page: PageWithLock) {
    const normalizedPage = { ...(page as any), isLocked: Boolean((page as any).isLocked) } as PageWithLock;
    // allVisiblePages is derived from tree, so updating tree is enough.
    // Avoid a separate allPages state here; it does not exist in this component.
    setTree((previous: PageTreeNode[]) => {
      const node: PageTreeNode = { ...(normalizedPage as any), children: [] };
      const withoutDuplicate = removePageTreeNode(previous, normalizedPage.id);
      if (!normalizedPage.parentId) return [node, ...withoutDuplicate];
      const inserted = insertPageTreeNode(withoutDuplicate, normalizedPage.parentId, node);
      return inserted.changed ? inserted.nodes : [node, ...withoutDuplicate];
    });
  }

  function applyRemovedPageSnapshots(pageIds: string[]) {
    const removed = new Set(pageIds.filter(Boolean));
    if (removed.size === 0) return;
    // allVisiblePages is derived from tree. Removing from tree removes it from page lists too.
    setTree((previous: PageTreeNode[]) => {
      let next = previous;
      removed.forEach((pageId) => {
        next = removePageTreeNode(next, pageId);
      });
      return next;
    });
  }

  function removePageTreeNode(nodes: PageTreeNode[], pageId: string): PageTreeNode[] {
    let changed = false;
    const next: PageTreeNode[] = [];
    for (const node of nodes) {
      if (node.id === pageId) {
        changed = true;
        continue;
      }
      const children = removePageTreeNode(node.children, pageId);
      if (children !== node.children) {
        changed = true;
        next.push({ ...node, children });
      } else {
        next.push(node);
      }
    }
    return changed ? next : nodes;
  }

  function insertPageTreeNode(
    nodes: PageTreeNode[],
    parentId: string,
    child: PageTreeNode,
  ): { nodes: PageTreeNode[]; changed: boolean } {
    let changed = false;
    const next = nodes.map((node) => {
      if (node.id === parentId) {
        changed = true;
        return { ...node, children: [child, ...node.children] };
      }
      const inserted = insertPageTreeNode(node.children, parentId, child);
      if (!inserted.changed) return node;
      changed = true;
      return { ...node, children: inserted.nodes };
    });
    return { nodes: changed ? next : nodes, changed };
  }

  async function createPage(
    parentId: string | null = null,
    scope?: WorkspaceScope,
  ) {
    if (!api) return;
    try {
      const parent = parentId
        ? allVisiblePages.find((p) => p.id === parentId)
        : null;
      const resolvedScope = scope ?? pageScope(parent);
      const page = await api.createPage(
        parentId ? "子ページ" : "Untitled",
        parentId,
        resolvedScope,
      );
      scheduleSemanticIndexUpdateForPage(page.meta.id);
      scheduleSemanticIndexUpdateForDatabaseRowParent(page.meta.parentId);
      applyCreatedPageSnapshot(page.meta as PageWithLock);
      setStatus("ページを作成しました");
      await openPage(page.meta.id);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function createChildPageForEditor(): Promise<PageWithLock | null> {
    if (!api || !current) return null;
    try {
      const page = await api.createPage(
        "Untitled",
        current.meta.id,
        pageScope(current.meta),
      );
      scheduleSemanticIndexUpdateForPage(page.meta.id);
      scheduleSemanticIndexUpdateForDatabaseRowParent(page.meta.parentId);
      const created = { ...(page.meta as any), isLocked: false } as PageWithLock;
      applyCreatedPageSnapshot(created);
      setStatus("子ページを作成しました");
      return created;
    } catch (e: any) {
      setStatus(e.message);
      return null;
    }
  }

  async function createPageFromTemplate(
    template: PageTemplate,
    parentId: string | null = null,
    scope?: WorkspaceScope,
  ) {
    if (!api) return;
    try {
      const parent = parentId
        ? allVisiblePages.find((p) => p.id === parentId)
        : null;
      const resolvedScope = scope ?? pageScope(parent);
      const page = await api.createPage(
        template.title,
        parentId,
        resolvedScope,
      );
      scheduleSemanticIndexUpdateForPage(page.meta.id);
      scheduleSemanticIndexUpdateForDatabaseRowParent(page.meta.parentId);
      const properties = normalizePageProperties({
        ...DEFAULT_PAGE_PROPERTIES,
        ...template.properties,
      });
      const blocksuite: BlockNoteStoredDoc = {
        version: 1,
        kind: "blocknote",
        blocks: template.blocks,
      };
      const markdown = blockNoteToMarkdown(template.blocks);
      const savedPage = await api.savePage({
        id: page.meta.id,
        title: template.title,
        markdown,
        blocksuite,
        baseUpdatedAt: page.meta.updatedAt,
        properties,
        icon: template.icon,
        scope: resolvedScope,
      });
      applyCreatedPageSnapshot({ ...(savedPage.meta as any), isLocked: false } as PageWithLock);
      setStatus("テンプレートからページを作成しました");
      await openPage(page.meta.id);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function refreshPageSidebarCounts(pageId: string): Promise<void> {
    if (!api || !pageId) return;
    try {
      const counts = await api.getPageSidebarCounts(pageId);
      if (currentPageIdRef.current === pageId) setPageSidebarCounts(counts);
    } catch (error: any) {
      // The page remains usable if a slow SMB share cannot return badges.
      if (currentPageIdRef.current === pageId) {
        setPageSidebarCounts(null);
      }
    }
  }

  async function ensurePageInfoTabData(pageId: string, tab: PageInfoTab) {
    if (!api || !pageId || tab === "properties") return;
    const loaded =
      pageInfoLoadedTabsRef.current[pageId] ?? new Set<PageInfoTab>();
    const loading =
      pageInfoLoadingTabsRef.current[pageId] ?? new Set<PageInfoTab>();
    pageInfoLoadedTabsRef.current[pageId] = loaded;
    pageInfoLoadingTabsRef.current[pageId] = loading;
    if (loaded.has(tab) || loading.has(tab)) return;
    loading.add(tab);

    try {
      if (tab === "comments") {
        const comments = await api.listPageComments(pageId);
        if (currentPageIdRef.current === pageId) setPageComments(comments);
      } else if (tab === "history") {
        const [hist, conf, activity] = await Promise.all([
          api.listHistory(pageId),
          api.listConflicts(pageId),
          api.listPageActivity(pageId),
        ]);
        if (currentPageIdRef.current === pageId) {
          setHistory(hist);
          setConflicts(conf);
          setPageSidebarCounts((currentCounts) => ({
            commentsOpen:
              currentCounts?.commentsOpen ??
              pageComments.filter((comment) => !comment.resolved).length,
            commentsTotal: currentCounts?.commentsTotal ?? pageComments.length,
            history: hist.length,
            conflicts: conf.length,
            backlinks: currentCounts?.backlinks ?? backlinks.length,
          }));
          setPageActivity(activity || []);
          const latestHistoryAt = hist[0]?.createdAt;
          const parsedHistoryAt = latestHistoryAt
            ? Date.parse(latestHistoryAt)
            : NaN;
          lastPageHistoryAtRef.current[pageId] = Number.isFinite(
            parsedHistoryAt,
          )
            ? Math.max(parsedHistoryAt, Date.now())
            : Date.now();
        }
      } else if (tab === "links") {
        const backs = await api.listBacklinks(pageId);
        if (currentPageIdRef.current === pageId) setBacklinks(backs);
      }
      // Detail loading may have observed a newer remote state. Refresh only the
      // lightweight badges, not unrelated detail panels.
      void refreshPageSidebarCounts(pageId);
      loaded.add(tab);
    } catch (error: any) {
      if (currentPageIdRef.current === pageId) {
        setStatus(
          `周辺情報を読み込めませんでした。${error?.message ? ` ${error.message}` : ""}`,
        );
      }
    } finally {
      loading.delete(tab);
    }
  }

  async function openPage(id: string) {
    if (!api) return;
    pageOpenAbortRef.current?.abort();
    const requestController = new AbortController();
    pageOpenAbortRef.current = requestController;
    const pageOpenStartedAt = performance.now();
    await flushPendingSaves();
    const seq = navigationCoordinatorRef.current.beginPrimary();
    navigationCoordinatorRef.current.invalidatePreview();
    const previousPageId = currentPageIdRef.current;
    try {
      closePageContextMenu();
      setLinkPreviewPage(null);
      setHistoryPreview(null);
      setHistoryDiff(null);
      setHistoryOpen(false);
      setPageReadOnlyReason(null);
      setStatus("ページを読み込み中...");
      if (currentDb?.id)
        await api.releaseDatabaseLock(currentDb.id).catch(() => undefined);
      setMainMode("page");
      setWorkspaceActiveItem({ kind: "page", id });
      setCurrentDb(null);
      setDbEditing(false);
      setViewMode("tree");

      if (editing && previousPageId && previousPageId !== id) {
        // Do not release a page lock while its debounced/queued save is still pending.
        if (dirty || pageSaveInFlightRef.current) await save();
        await (pageSaveDrainRef.current ?? Promise.resolve());
        await api.releaseLock(previousPageId).catch(() => undefined);
      }

      const page = await api.getPage(id, requestController.signal);
      const pageFetchElapsedMs = Math.round(
        performance.now() - pageOpenStartedAt,
      );
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;

      // v331: ページ本文を最優先で即時表示する。
      // 添付・履歴・バックリンク・コメント・アクティビティは遅延読込にして、共有フォルダI/Oで画面遷移を止めない。
      const nextBlocks = blockNoteContentFromPage(page);
      setCurrent(page);
      window.dispatchEvent(
        new CustomEvent("local-notion:workspace-open-item", {
          detail: { kind: "page", id: page.meta.id, mode: "tabs" },
        }),
      );
      lastPersistedPageUpdatedAtRef.current[page.meta.id] = page.meta.updatedAt;
      currentPageIdRef.current = page.meta.id;
      setAttachments([]);
      setHistory([]);
      setConflicts([]);
      setBacklinks([]);
      setPageComments([]);
      setPageActivity([]);
      setPageSidebarCounts(null);
      // Request precise tab badges separately.  This is intentionally not part
      // of getPage(), and starts after the primary page state is committed.
      window.setTimeout(() => {
        if (currentPageIdRef.current === page.meta.id) {
          void refreshPageSidebarCounts(page.meta.id);
        }
      }, 120);
      setTitle(page.meta.title);
      setPageIcon(page.meta.icon || "📄");
      setPageProperties(normalizePageProperties(page.meta.properties));
      setBlocks(blocksFromPage(page));
      setBlockNoteBlocks(nextBlocks);
      lastPersistedPageSignatureRef.current[page.meta.id] = pageSaveSignature({
        pageId: page.meta.id,
        title: page.meta.title,
        icon: page.meta.icon || "📄",
        properties: normalizePageProperties(page.meta.properties),
        blocks: nextBlocks,
        scope: pageScope(page.meta),
      });
      setPropertiesOpen(false);
      setDirty(false);
      // Side-panel data is requested only when its tab is opened. This keeps
      // page navigation independent from slow history/comment/backlink I/O.
      pageInfoLoadedTabsRef.current[id] = new Set<PageInfoTab>();
      pageInfoLoadingTabsRef.current[id] = new Set<PageInfoTab>();
      recordRecentWorkspaceItem({
        kind: "page",
        id: page.meta.id,
        title: page.meta.title,
        icon: page.meta.icon || "📄",
      });
      setRecentWorkspaceRevision((value) => value + 1);
      setStatus("ページを表示しました");

      // v397: Open optimistically.  A persistent .lock file on SMB shares is
      // not reliable enough to decide whether a brand-new page is editable.
      // Actual concurrent changes are rejected during save with baseUpdatedAt
      // and are preserved in conflicts instead of silently overwriting data.
      if (
        !navigationCoordinatorRef.current.isPrimaryCurrent(seq) ||
        currentPageIdRef.current !== page.meta.id
      )
        return;
      setEditing(true);
      setPageReadOnlyReason(null);
      setStatus("編集できます");
      // Lightweight timing marker for real-device diagnosis. It does not block
      // navigation and is available from the Electron renderer DevTools.
      window.requestAnimationFrame(() => {
        const totalElapsedMs = Math.round(
          performance.now() - pageOpenStartedAt,
        );
        console.info("[page-open]", {
          pageId: page.meta.id,
          fetchMs: pageFetchElapsedMs,
          firstPaintMs: totalElapsedMs,
          sidebarCountsDeferred: true,
          relatedDeferred: true,
        });
      });
    } catch (e: any) {
      if (e?.name === "AbortError" || requestController.signal.aborted) return;
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
      setStatus(e.message);
    } finally {
      if (pageOpenAbortRef.current === requestController) {
        pageOpenAbortRef.current = null;
      }
    }
  }

  async function previewLinkedPage(id: string) {
    if (!api) return;
    linkPreviewAbortRef.current?.abort();
    const requestController = new AbortController();
    linkPreviewAbortRef.current = requestController;
    const seq = navigationCoordinatorRef.current.beginPreview();
    try {
      const page = await api.getPage(id, requestController.signal);
      if (!navigationCoordinatorRef.current.isPreviewCurrent(seq)) return;
      setLinkPreviewPage(page);
      setStatus("リンク先をプレビューしています");
    } catch (e: any) {
      if (e?.name === "AbortError" || requestController.signal.aborted) return;
      if (navigationCoordinatorRef.current.isPreviewCurrent(seq))
        setStatus(e.message);
    } finally {
      if (linkPreviewAbortRef.current === requestController) {
        linkPreviewAbortRef.current = null;
      }
    }
  }

  async function addPageComment(input: {
    body: string;
    blockId?: string;
    blockPreview?: string;
  }) {
    if (!api || !current) return;
    try {
      const next = await api.addPageComment(current.meta.id, input);
      setPageComments(next);
      void refreshPageSidebarCounts(current.meta.id);
      if (pageInfoLoadedTabsRef.current[current.meta.id]?.has("history")) {
        setPageActivity(await api.listPageActivity(current.meta.id));
      }
      setStatus(
        input.blockId
          ? "ブロックコメントを追加しました"
          : "コメントを追加しました",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function togglePageComment(comment: PageComment) {
    if (!api || !current) return;
    try {
      const next = await api.updatePageComment(current.meta.id, comment.id, {
        resolved: !comment.resolved,
      });
      setPageComments(next);
      void refreshPageSidebarCounts(current.meta.id);
      if (pageInfoLoadedTabsRef.current[current.meta.id]?.has("history")) {
        setPageActivity(await api.listPageActivity(current.meta.id));
      }
      setStatus(
        comment.resolved
          ? "コメントを未解決に戻しました"
          : "コメントを解決済みにしました",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function deletePageComment(commentId: string) {
    if (!api || !current) return;
    try {
      const next = await api.deletePageComment(current.meta.id, commentId);
      setPageComments(next);
      void refreshPageSidebarCounts(current.meta.id);
      if (pageInfoLoadedTabsRef.current[current.meta.id]?.has("history")) {
        setPageActivity(await api.listPageActivity(current.meta.id));
      }
      setStatus("コメントを削除しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function startEdit() {
    if (!api || !current) return;
    // v397: Editing is not gated by a long-lived file lease. Save-time
    // baseUpdatedAt validation is the cross-PC concurrency boundary.
    setEditing(true);
    setPageReadOnlyReason(null);
    setStatus("編集を再開しました");
  }

  function markSemanticEditorActivity(): void {
    const now = Date.now();
    semanticEditorActivityAtRef.current = now;
    // Keep IPC/network chatter low while typing, but notify a running background
    // embedding job quickly enough to stop before its next chunk.
    if (!api || now - semanticEditorActivityLastSentRef.current < 900) return;
    semanticEditorActivityLastSentRef.current = now;
    void api.noteSemanticEditorActivity(10_000).catch(() => undefined);
  }

  type SemanticAutoUpdateTarget = {
    targetKey: string;
    preferredChunkId: string;
  };

  function scheduleSemanticIndexUpdate(target: SemanticAutoUpdateTarget): void {
    if (!api || !target.targetKey || !target.preferredChunkId) return;
    semanticAutoUpdatePendingTargetsRef.current.set(
      target.targetKey,
      target.preferredChunkId,
    );
    // Existing related results describe the pre-save content. Keep the panel
    // honest while the idle diff update is waiting to run.
    window.dispatchEvent(
      new CustomEvent("local-notion:semantic-target-dirty", { detail: target }),
    );
    if (semanticAutoUpdateTimerRef.current !== null) {
      window.clearTimeout(semanticAutoUpdateTimerRef.current);
    }
    semanticAutoUpdateTimerRef.current = window.setTimeout(async () => {
      semanticAutoUpdateTimerRef.current = null;
      if (semanticAutoUpdateRunningRef.current) return;
      const editorIdleMs = Date.now() - semanticEditorActivityAtRef.current;
      const editorQuietDelayMs = 10_000;
      if (
        semanticEditorActivityAtRef.current &&
        editorIdleMs < editorQuietDelayMs
      ) {
        semanticAutoUpdateTimerRef.current = window.setTimeout(
          () => {
            const next = semanticAutoUpdatePendingTargetsRef.current
              .entries()
              .next().value as [string, string] | undefined;
            if (next)
              scheduleSemanticIndexUpdate({
                targetKey: next[0],
                preferredChunkId: next[1],
              });
          },
          Math.max(800, editorQuietDelayMs - editorIdleMs),
        );
        return;
      }
      // Process at most 20 sources per embedding pass. Keep the remainder in
      // the deduplicated queue; clearing the entire queue here used to leave
      // rows after the first batch permanently "not indexed".
      const pendingTargets = Array.from(
        semanticAutoUpdatePendingTargetsRef.current.entries(),
      )
        .slice(0, 20)
        .map(([targetKey, preferredChunkId]) => ({
          targetKey,
          preferredChunkId,
        }));
      if (!pendingTargets.length) return;
      pendingTargets.forEach((item) =>
        semanticAutoUpdatePendingTargetsRef.current.delete(item.targetKey),
      );
      semanticAutoUpdateRunningRef.current = true;
      try {
        // Never create a partial index implicitly. Automatic maintenance only
        // keeps an already available index fresh; first-time creation remains
        // an explicit user/admin operation.
        const indexInfo = await api.getWorkspaceSemanticIndexRevision();
        if (!indexInfo.available || !indexInfo.revision) {
          pendingTargets.forEach((item) =>
            semanticAutoUpdatePendingTargetsRef.current.set(
              item.targetKey,
              item.preferredChunkId,
            ),
          );
          return;
        }
        const semanticTargets = pendingTargets
          .map((item) => incrementalSemanticTargetFromQueueKey(item.targetKey))
          .filter((target): target is NonNullable<typeof target> =>
            Boolean(target),
          );
        const result = await api.diffUpdateWorkspaceSemanticIndex(
          pendingTargets.length,
          {
            preferredChunkIds: pendingTargets.map(
              (item) => item.preferredChunkId,
            ),
            targets: semanticTargets,
            background: true,
          },
        );
        window.dispatchEvent(
          new CustomEvent("local-notion:semantic-index-updated", {
            detail: {
              revision: result?.revision || result?.generatedAt || null,
              mode: "autosave-diff",
              targets: pendingTargets,
            },
          }),
        );
      } catch {
        // Search remains usable with the previous index. The next save, manual
        // diff update, or scheduled maintenance pass retries the pending work.
        pendingTargets.forEach((item) =>
          semanticAutoUpdatePendingTargetsRef.current.set(
            item.targetKey,
            item.preferredChunkId,
          ),
        );
      } finally {
        semanticAutoUpdateRunningRef.current = false;
        if (
          semanticAutoUpdatePendingTargetsRef.current.size &&
          semanticAutoUpdateTimerRef.current === null
        ) {
          semanticAutoUpdateTimerRef.current = window.setTimeout(() => {
            const next = semanticAutoUpdatePendingTargetsRef.current
              .entries()
              .next().value as [string, string] | undefined;
            if (next)
              scheduleSemanticIndexUpdate({
                targetKey: next[0],
                preferredChunkId: next[1],
              });
          }, 800);
        }
      }
    }, 6_000);
  }

  function scheduleSemanticIndexUpdateForPage(pageId: string): void {
    if (!pageId) return;
    scheduleSemanticIndexUpdate({
      targetKey: `page::${pageId}`,
      preferredChunkId: `page:${pageId}`,
    });
  }

  function scheduleSemanticIndexUpdateForJournal(date: string): void {
    if (!date) return;
    scheduleSemanticIndexUpdate({
      targetKey: `journal::${date}`,
      preferredChunkId: `journal:${date}`,
    });
  }

  function notifyWorkspaceGraphMutation(
    reason: string,
    ids: string[] = [],
    extra: Partial<WorkspaceMutationDetail> = {},
  ): void {
    // Graph and cache consumers share one normalized mutation payload. Consumers
    // debounce independently, so a burst of autosaves does not cause all panels to refetch.
    workspaceMutationCoordinator.publish({
      kind: reason as WorkspaceMutationDetail["kind"],
      pageIds: ids,
      ...extra,
    });
  }

  function scheduleSemanticIndexUpdateForDatabaseRow(
    databaseId: string,
    rowId: string,
  ): void {
    if (!databaseId || !rowId) return;
    scheduleSemanticIndexUpdate({
      targetKey: `database_row:${databaseId}:${rowId}`,
      preferredChunkId: `database_row:${databaseId}:${rowId}`,
    });
  }

  /**
   * DB行の子ページは parentId に database-row:<databaseId>:<rowId> を持つ。
   * 子ページ自身だけでなく、本文に子ページリンクを保持する親行も再Embeddingする。
   */
  function scheduleSemanticIndexUpdateForDatabaseRowParent(
    parentId: string | null | undefined,
  ): void {
    const match = /^database-row:([^:]+):(.+)$/.exec(String(parentId || ""));
    if (!match) return;
    const databaseId = match[1] ?? "";
    const rowId = match[2] ?? "";
    scheduleSemanticIndexUpdateForDatabaseRow(databaseId, rowId);
  }

  useEffect(() => {
    const handleSemanticRefreshRequest = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SemanticAutoUpdateTarget>>)
        .detail;
      const targetKey = String(detail?.targetKey || "").trim();
      const preferredChunkId = String(detail?.preferredChunkId || "").trim();
      if (targetKey && preferredChunkId)
        scheduleSemanticIndexUpdate({ targetKey, preferredChunkId });
    };
    window.addEventListener(
      "local-notion:semantic-refresh-request",
      handleSemanticRefreshRequest as EventListener,
    );
    return () =>
      window.removeEventListener(
        "local-notion:semantic-refresh-request",
        handleSemanticRefreshRequest as EventListener,
      );
  }, [api]);

  useEffect(
    () => () => {
      if (semanticAutoUpdateTimerRef.current !== null)
        window.clearTimeout(semanticAutoUpdateTimerRef.current);
    },
    [],
  );

  async function save(
    options: { historyReason?: PageHistoryCheckpointReason } = {},
  ) {
    if (!api || !current) return;
    const pageId = current.meta.id;
    const snapshotBase = {
      pageId,
      title,
      icon: pageIcon,
      properties: normalizePageProperties(pageProperties),
      blocks: blockNoteBlocks,
      scope: pageScope(current.meta),
    };
    const lastHistoryAt = lastPageHistoryAtRef.current[pageId] ?? 0;
    const automaticCheckpoint =
      !options.historyReason &&
      Date.now() - lastHistoryAt >= PAGE_HISTORY_CHECKPOINT_MS;
    const snapshot: PageSaveSnapshot = {
      ...snapshotBase,
      historyReason:
        options.historyReason ??
        (automaticCheckpoint ? "auto_checkpoint" : undefined),
      signature: pageSaveSignature(snapshotBase),
    };

    // A BlockNote re-render can emit onChange after a successful save.  Never
    // turn the exact persisted state back into a pending autosave.
    if (
      !options.historyReason &&
      !pageSaveInFlightRef.current &&
      !queuedPageSaveRef.current &&
      lastPersistedPageSignatureRef.current[pageId] === snapshot.signature
    ) {
      setDirty(false);
      return;
    }

    const previouslyQueued =
      queuedPageSaveRef.current as PageSaveSnapshot | null;
    if (previouslyQueued?.pageId === pageId) {
      snapshot.historyReason = strongerPageHistoryReason(
        previouslyQueued.historyReason,
        snapshot.historyReason,
      );
    }
    queuedPageSaveRef.current = snapshot;
    if (pageSaveInFlightRef.current)
      return pageSaveDrainRef.current ?? Promise.resolve();

    pageSaveInFlightRef.current = true;
    setSaveActivity((previous) => ({ ...previous, page: true }));
    const drain = (async () => {
      let failedSnapshot: typeof snapshot | null = null;
      try {
        while (queuedPageSaveRef.current) {
          const next = queuedPageSaveRef.current;
          queuedPageSaveRef.current = null;
          failedSnapshot = next;
          const baseUpdatedAt =
            lastPersistedPageUpdatedAtRef.current[next.pageId] ??
            current?.meta.updatedAt;
          if (
            !next.historyReason &&
            lastPersistedPageSignatureRef.current[next.pageId] ===
              next.signature
          ) {
            failedSnapshot = null;
            if (
              currentPageIdRef.current === next.pageId &&
              !queuedPageSaveRef.current
            ) {
              setDirty(false);
              setStatus("保存しました");
            }
            continue;
          }
          const previousPersistedTitle =
            lastPersistedPageTitleRef.current[next.pageId] ??
            (current?.meta.id === next.pageId ? current.meta.title : "");
          const saved = await api.savePage({
            id: next.pageId,
            title: next.title || "無題",
            markdown: blockNoteToMarkdown(next.blocks),
            blocksuite: { version: 1, kind: "blocknote", blocks: next.blocks },
            baseUpdatedAt,
            properties: next.properties,
            icon: next.icon,
            scope: next.scope,
            historyReason: next.historyReason,
          });
          if (next.historyReason)
            lastPageHistoryAtRef.current[next.pageId] = Date.now();
          lastPersistedPageUpdatedAtRef.current[next.pageId] =
            saved.meta.updatedAt;
          lastPersistedPageTitleRef.current[next.pageId] = saved.meta.title;
          const titleChanged =
            Boolean(previousPersistedTitle) &&
            previousPersistedTitle !== saved.meta.title;
          lastPersistedPageSignatureRef.current[next.pageId] = next.signature;
          failedSnapshot = null;
          clearSaveRecovery("page");
          scheduleSemanticIndexUpdateForPage(next.pageId);
          // Renaming or editing a DB-row child page changes the parent row's
          // generated child-page reference. Keep both semantic sources fresh.
          scheduleSemanticIndexUpdateForDatabaseRowParent(saved.meta.parentId);
          notifyWorkspaceGraphMutation("page-saved", [saved.meta.id]);
          if (currentPageIdRef.current !== next.pageId) continue;
          // Keep the editor-owned document intact after a normal save.  Feeding
          // the server response back through setBlocks()/setBlockNoteBlocks()
          // remounts BlockNote, can move the caret, and may emit a second
          // onChange that queues redundant work.  Only the persisted metadata
          // needs to advance locally; remote refresh, history restore, and page
          // navigation remain the explicit document replacement paths.
          setCurrent((previous) => {
            if (!previous || previous.meta.id !== saved.meta.id) return saved;
            return {
              ...previous,
              meta: saved.meta,
            };
          });
          setPageIcon(saved.meta.icon || "📄");
          setPageProperties(normalizePageProperties(saved.meta.properties));
          setTree((previousTree) =>
            patchPageTreeNode(previousTree, saved.meta),
          );
          setHistoryPreview(null);
          setHistoryDiff(null);
          if (!queuedPageSaveRef.current) setDirty(false);

          // Avoid all side-panel I/O on ordinary text saves.  The history
          // counter can be updated deterministically when this save created a
          // checkpoint; the detailed history list will reload lazily when the
          // user next opens that tab.  Link details are also marked stale rather
          // than fetched during typing, because backlink extraction can involve
          // shared-folder reads on larger workspaces.
          if (next.historyReason) {
            setPageSidebarCounts((currentCounts) =>
              currentCounts
                ? { ...currentCounts, history: currentCounts.history + 1 }
                : currentCounts,
            );
            pageInfoLoadedTabsRef.current[next.pageId]?.delete("history");
          }
          pageInfoLoadedTabsRef.current[next.pageId]?.delete("links");
          try {
            window.dispatchEvent(
              new CustomEvent("local-notion:page-tree-mutated", {
                detail: {
                  pageId: next.pageId,
                  action: titleChanged ? "renamed" : "updated",
                  title: saved.meta.title,
                  parentId: saved.meta.parentId,
                },
              }),
            );
            window.dispatchEvent(
              new CustomEvent("local-notion:database-sidebar-refresh", {
                detail: {
                  pageId: next.pageId,
                  action: "updated",
                  title: saved.meta.title,
                },
              }),
            );
          } catch {}
          // The tree and currently visible page state are patched above.  A full
          // workspace refresh here previously re-fetched pages, databases, and
          // journals after every autosave, which was the dominant source of
          // editor jank on shared folders.
          setStatus(
            queuedPageSaveRef.current
              ? "保存を続けています…"
              : next.historyReason === "manual"
                ? "保存しました（履歴を作成）"
                : next.historyReason === "auto_checkpoint"
                  ? "保存しました（自動チェックポイントを作成）"
                  : "保存しました",
          );
          if (!queuedPageSaveRef.current) {
            recordAiActivity({
              kind: "save",
              title: "ページを保存しました",
              detail: saved.meta.title || "無題のページ",
              targetKey: `page:${saved.meta.id}`,
            });
          }
        }
      } catch (e: any) {
        if (failedSnapshot && !queuedPageSaveRef.current)
          queuedPageSaveRef.current = failedSnapshot;
        setDirty(true);
        setWorkspaceSyncDetail(
          "ページ保存に失敗しました。未保存内容を保持しています",
        );
        scheduleSaveRetry("page", "ページ", async () => {
          await save();
        });
        if (currentPageIdRef.current === pageId)
          setStatus(
            e?.message ??
              "ページの保存に失敗しました。未保存内容を保持しています。",
          );
      } finally {
        pageSaveInFlightRef.current = false;
        setSaveActivity((previous) => ({ ...previous, page: false }));
        pageSaveDrainRef.current = null;
      }
    })();
    pageSaveDrainRef.current = drain;
    return drain;
  }

  useEffect(() => {
    const onManualSave = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.code !== "KeyS" ||
        event.isComposing
      )
        return;
      if (!api || !current || !editing) return;
      // Capture phase prevents BlockNote/ProseMirror from consuming Cmd+S before
      // the workspace can create an explicit history checkpoint.
      event.preventDefault();
      event.stopPropagation();
      void save({ historyReason: "manual" }).catch(() => undefined);
    };
    window.addEventListener("keydown", onManualSave, true);
    return () => window.removeEventListener("keydown", onManualSave, true);
  }, [
    api,
    current?.meta.id,
    current?.meta.updatedAt,
    editing,
    title,
    pageIcon,
    pageProperties,
    blockNoteBlocks,
  ]);

  useEffect(() => {
    if (!api || !current || !editing || !dirty) return;
    const timer = window.setTimeout(() => {
      save().catch(() => undefined);
    }, appSettings.autoSaveDelayMs);
    return () => window.clearTimeout(timer);
  }, [
    api,
    current?.meta.id,
    editing,
    dirty,
    title,
    pageIcon,
    pageProperties,
    blockNoteBlocks,
    appSettings.autoSaveDelayMs,
  ]);

  async function endEdit() {
    if (!api || !current) return;
    try {
      if (dirty || pageSaveInFlightRef.current) await save();
      await (pageSaveDrainRef.current ?? Promise.resolve());
      // v397: no long-lived editor lock is held while a page is open.
      setEditing(false);
      setPageReadOnlyReason(null);
      setStatus("編集を終了しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function changeCurrentScope(nextScope: WorkspaceScope) {
    if (!api || !current) return;
    const currentScope = pageScope(current.meta);
    if (nextScope === currentScope) return;
    const message =
      nextScope === "shared"
        ? "このページを共有フォルダへ移動します。他の端末・ユーザーから見える可能性があります。よろしいですか？"
        : "このページをPrivateへ移動します。共有フォルダ上からは見えなくなります。よろしいですか？";
    if (!confirm(message)) return;
    try {
      const saved = await api.savePage({
        id: current.meta.id,
        title,
        markdown: blockNoteToMarkdown(blockNoteBlocks),
        blocksuite: { version: 1, kind: "blocknote", blocks: blockNoteBlocks },
        baseUpdatedAt: current.meta.updatedAt,
        properties: pageProperties,
        icon: pageIcon,
        scope: nextScope,
      });
      setCurrent(saved);
      await reload(
        nextScope === "private"
          ? "Privateページに変更しました"
          : "Sharedページに変更しました",
      );
    } catch (e: any) {
      setStatus(e?.message ?? "公開範囲の変更に失敗しました");
    }
  }

  async function duplicateCurrent() {
    if (!api || !current) return;
    await duplicatePageById(current.meta.id);
  }

  async function duplicatePageById(id: string) {
    if (!api) return;
    try {
      const copy = await api.duplicatePage(id);
      scheduleSemanticIndexUpdateForPage(copy.meta.id);
      scheduleSemanticIndexUpdateForDatabaseRowParent(copy.meta.parentId);
      applyCreatedPageSnapshot({ ...(copy.meta as any), isLocked: false } as PageWithLock);
      setStatus("ページを複製しました");
      await openPage(copy.meta.id);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function trashCurrent() {
    if (!current) return;
    await trashPageById(current.meta.id);
  }

  async function trashPageById(id: string) {
    if (!api) return;
    if (!confirm("このページをゴミ箱に移動しますか？")) return;
    // Capture the pre-trash parent. After the server marks it trashed, the
    // page source is intentionally absent and only the parent relation tells
    // us which DB row needs its generated child-page link re-embedded.
    const targetMeta =
      current?.meta.id === id
        ? current.meta
        : (allVisiblePages.find((page) => page.id === id) ?? null);
    try {
      const trashed = await api.trashPage(id);
      const affectedPageIds = Array.isArray((trashed as any).affectedPageIds)
        ? (trashed as any).affectedPageIds.map(String)
        : [id];
      affectedPageIds.forEach(scheduleSemanticIndexUpdateForPage);
      scheduleSemanticIndexUpdateForDatabaseRowParent(targetMeta?.parentId);
      notifyWorkspaceGraphMutation("page-trashed", affectedPageIds);
      const mutationDetail: {
        pageId: string;
        action: "trashed";
        workspaceFallbackKey?: string;
        workspaceHasFallback?: boolean;
      } = { pageId: id, action: "trashed" };
      window.dispatchEvent(
        new CustomEvent("local-notion:page-tree-mutated", {
          detail: mutationDetail,
        }),
      );
      applyRemovedPageSnapshots(affectedPageIds);
      setTrashedPages((previous) => {
        const affected = new Set(affectedPageIds);
        const withoutDuplicate = previous.filter((page) => !affected.has(page.id));
        const trashedMeta = {
          ...(targetMeta ?? trashed),
          ...(trashed as any),
          trashed: true,
          isLocked: false,
        } as PageWithLock;
        return [trashedMeta, ...withoutDuplicate];
      });
      if (current?.meta.id === id) {
        navigationCoordinatorRef.current.invalidatePrimary();
        navigationCoordinatorRef.current.invalidatePreview();
        // WorkspaceWorkbench selects the remaining tab synchronously. Only clear the
        // main surface when the deleted page was truly the final open tab.
        if (!mutationDetail.workspaceHasFallback) {
          setCurrent(null);
          currentPageIdRef.current = null;
          setMainMode("empty");
          setEditing(false);
        } else {
          setEditing(false);
        }
      }
      setStatus("ページをゴミ箱に移動しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function showTrash() {
    if (!api) return;
    navigationCoordinatorRef.current.invalidatePrimary();
    try {
      setTrashedPages(await api.listTrash());
      setCurrent(null);
      currentPageIdRef.current = null;
      setCurrentDb(null);
      setWorkspaceActiveItem(null);
      setMainMode("trash");
      setEditing(false);
      setViewMode("trash");
      setStatus("ゴミ箱を表示しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function restoreTrashedPage(id: string) {
    if (!api) return;
    try {
      const restored = await api.restoreTrashedPage(id);
      const affectedPageIds = Array.isArray((restored as any).affectedPageIds)
        ? (restored as any).affectedPageIds.map(String)
        : [id];
      affectedPageIds.forEach(scheduleSemanticIndexUpdateForPage);
      notifyWorkspaceGraphMutation("page-restored", affectedPageIds);
      await reload("ゴミ箱から復元しました");
      setTrashedPages(await api.listTrash());
      setViewMode("trash");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function deleteTrashedPage(id: string) {
    if (!api) return;
    if (
      !confirm(
        "このページを完全削除しますか？この操作は通常画面からは戻せません。削除前バックアップは backups に退避されます。",
      )
    )
      return;
    try {
      const deleted = await api.deletePagePermanently(id);
      deleted.deletedIds.forEach(scheduleSemanticIndexUpdateForPage);
      notifyWorkspaceGraphMutation("page-deleted", deleted.deletedIds);
      window.dispatchEvent(
        new CustomEvent("local-notion:page-tree-mutated", {
          detail: { pageId: id, action: "deleted" },
        }),
      );
      await reload("ページを完全削除しました");
      setTrashedPages(await api.listTrash());
      setViewMode("trash");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function emptyTrash() {
    if (!api) return;
    if (
      !confirm(
        "ゴミ箱内のページ・データベースをすべて完全削除しますか？削除前バックアップは backups に退避されます。",
      )
    )
      return;
    try {
      await api.emptyTrash();
      await api.emptyTrashedDatabases().catch(() => undefined);
      window.dispatchEvent(
        new CustomEvent("local-notion:page-tree-mutated", {
          detail: { action: "empty-trash" },
        }),
      );
      await reload("ゴミ箱を空にしました");
      setTrashedPages([]);
      setTrashedDatabases([]);
      setViewMode("trash");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function restoreTrashedDatabase(id: string) {
    if (!api) return;
    try {
      const restored = await api.restoreTrashedDatabase(id);
      // A restored DB may have had all of its row chunks removed while trashed.
      // Treat it as rows-added so only this DB is restored to Semantic search.
      requestDatabaseSemanticRefresh({ ...restored, rows: [] }, restored);
      notifyWorkspaceGraphMutation("database-restored", [], {
        databaseIds: [restored.id],
      });
      await reload("データベースをゴミ箱から復元しました");
      setTrashedDatabases(await api.listTrashedDatabases().catch(() => []));
      setViewMode("trash");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function deleteTrashedDatabase(id: string) {
    if (!api) return;
    if (
      !confirm(
        "このデータベースを完全削除しますか？この操作は通常画面からは戻せません。削除前バックアップは backups に退避されます。",
      )
    )
      return;
    try {
      const deleted = await api.deleteTrashedDatabase(id);
      // The server has already removed SQLite row/link/task records. Queue only
      // the known removed rows so the semantic index receives empty replacements.
      (deleted.deletedRowIds || []).forEach((rowId) =>
        scheduleSemanticIndexUpdateForDatabaseRow(id, String(rowId)),
      );
      notifyWorkspaceGraphMutation("database-deleted", [], {
        databaseIds: [id],
      });
      await reload("データベースを完全削除しました");
      setTrashedDatabases(await api.listTrashedDatabases().catch(() => []));
      setViewMode("trash");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function toggleSearchTagFilter(tag: string) {
    const normalized = normalizeTagFilterKey(tag);
    if (!normalized) return;
    setSearchTagFilters((current) =>
      current.some((value) => normalizeTagFilterKey(value) === normalized)
        ? current.filter((value) => normalizeTagFilterKey(value) !== normalized)
        : [...current, tag],
    );
  }

  async function search() {
    if (!api) return;
    const textQuery = query.trim();
    if (!textQuery && searchTagFilters.length === 0) {
      setViewMode("tree");
      setSearchResults([]);
      return;
    }
    try {
      // A tag-only search is resolved locally from already-loaded page metadata.
      // This avoids a needless full-text request and preserves AND semantics.
      const results = textQuery
        ? await api.searchPages(textQuery)
        : allVisiblePages;
      setSearchResults(results);
      setViewMode("search");
      setStatus(
        searchTagFilters.length
          ? `タグ${searchTagFilters.map((tag) => ` #${tag}`).join("・")}で絞り込みました`
          : "検索しました",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function uploadFileForBlockNote(file: File): Promise<string> {
    if (!api || !current) throw new Error("ページが読み込まれていません。");
    const url = await api.uploadAttachmentFile(current.meta.id, file);
    setAttachments(await api.listAttachments(current.meta.id));
    notifyWorkspaceGraphMutation("page-attachment-added", [current.meta.id], {
      cacheScopes: ["workspace", "attachments", "notifications"],
    });
    setStatus("ファイルを添付しました");
    return url;
  }

  async function addAttachmentsForEditor(): Promise<AttachmentInfo[]> {
    if (!api || !current) return [];
    const added: AttachmentInfo[] = [];
    try {
      const files = await window.localNotion.chooseAttachment();
      if (!files.length) return [];
      for (const file of files)
        added.push(await api.addAttachment(current.meta.id, file));
      setAttachments(await api.listAttachments(current.meta.id));
      if (added.length)
        notifyWorkspaceGraphMutation(
          "page-attachments-added",
          [current.meta.id],
          {
            cacheScopes: ["workspace", "attachments", "notifications"],
          },
        );
      setStatus("添付ファイルを本文に追加しました");
      return added;
    } catch (e: any) {
      setStatus(e.message);
      return [];
    }
  }

  async function addAttachments() {
    if (!api || !current) return;
    try {
      const files = await window.localNotion.chooseAttachment();
      if (!files.length) return;
      for (const file of files) await api.addAttachment(current.meta.id, file);
      setAttachments(await api.listAttachments(current.meta.id));
      notifyWorkspaceGraphMutation(
        "page-attachments-added",
        [current.meta.id],
        {
          cacheScopes: ["workspace", "attachments", "notifications"],
        },
      );
      setStatus("添付ファイルを追加しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function previewHistory(historyId: string) {
    if (!api || !current) return;
    try {
      const preview = await api.getHistoryBundle(current.meta.id, historyId);
      setHistoryPreview(preview);
      setHistoryDiff(null);
      setStatus("履歴プレビューを表示しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function showHistoryDiff(historyId: string) {
    if (!api || !current) return;
    try {
      const diff = await api.diffHistory(current.meta.id, historyId);
      setHistoryDiff(diff);
      setHistoryPreview(null);
      setStatus("履歴との差分を表示しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function closeHistoryInspect() {
    setHistoryPreview(null);
    setHistoryDiff(null);
  }

  async function restoreFromHistory(historyId: string) {
    if (!api || !current) return;
    if (!confirm("この履歴を復元しますか？現在の内容はバックアップされます。"))
      return;
    try {
      const restored = await api.restoreHistory(current.meta.id, historyId);
      setMainMode("page");
      setCurrent(restored);
      setTitle(restored.meta.title);
      setPageIcon(restored.meta.icon || "📄");
      setPageProperties(normalizePageProperties(restored.meta.properties));
      setBlocks(blocksFromPage(restored));
      const restoredBlocks = blockNoteContentFromPage(restored);
      setBlockNoteBlocks(restoredBlocks);
      lastPersistedPageUpdatedAtRef.current[restored.meta.id] =
        restored.meta.updatedAt;
      lastPersistedPageSignatureRef.current[restored.meta.id] =
        pageSaveSignature({
          pageId: restored.meta.id,
          title: restored.meta.title,
          icon: restored.meta.icon || "📄",
          properties: normalizePageProperties(restored.meta.properties),
          blocks: restoredBlocks,
          scope: pageScope(restored.meta),
        });
      const [att, hist, conf, backs, activity] = await Promise.all([
        api.listAttachments(restored.meta.id),
        api.listHistory(restored.meta.id),
        api.listConflicts(restored.meta.id),
        api.listBacklinks(restored.meta.id).catch(() => []),
        api.listPageActivity(restored.meta.id),
      ]);
      setAttachments(att);
      setHistory(hist);
      setHistoryPreview(null);
      setHistoryDiff(null);
      setConflicts(conf);
      setBacklinks(backs);
      setPageActivity(activity || []);
      void refreshPageSidebarCounts(restored.meta.id);
      await reload("履歴から復元しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function shiftDate(date: string, amount: number): string {
    const d = new Date(`${date}T00:00:00+09:00`);
    d.setDate(d.getDate() + amount);
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
      d,
    );
  }

  async function openJournal(date = journalDate) {
    if (!api) return;
    const seq = navigationCoordinatorRef.current.beginPrimary();
    await flushPendingSaves();
    if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
    try {
      if (editing && current)
        await api.releaseLock(current.meta.id).catch(() => undefined);
      if (currentDb?.id)
        await api.releaseDatabaseLock(currentDb.id).catch(() => undefined);
      closePageContextMenu();
      setLinkPreviewPage(null);
      setCurrent(null);
      currentPageIdRef.current = null;
      setCurrentDb(null);
      setEditing(false);
      setMainMode("journal");
      setJournalDate(date);
      setStatus("ジャーナルを読み込み中...");
      const entry = await api.getJournal(date);
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
      setCurrentJournal(entry);
      setJournalMetaDraft({
        mood: entry.mood || "",
        weather: entry.weather || "",
        tagsText: (entry.tags || []).join(", "),
      });
      suppressNextJournalChangeRef.current = true;
      setJournalBlocks(
        blockNoteContentFromPage({
          meta: {
            id: `journal_${entry.date}`,
            title: entry.title,
            parentId: null,
            icon: entry.icon || "📅",
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            updatedBy: entry.updatedBy,
            sortOrder: 0,
            trashed: false,
            properties: DEFAULT_PAGE_PROPERTIES,
            scope: "private",
          },
          markdown: entry.markdown,
          blocksuite: entry.blocksuite,
        } as any),
      );
      setJournalDirty(false);
      recordRecentWorkspaceItem({
        kind: "journal",
        id: entry.date,
        title: entry.title || `${entry.date} Journal`,
        icon: entry.icon || "📅",
      });
      setRecentWorkspaceRevision((value) => value + 1);
      setStatus("ジャーナルを開きました");
      const [nextJournals, nextAttachments] = await Promise.all([
        api.listJournals(),
        api.listJournalAttachments(date).catch(() => []),
      ]);
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
      setJournals(nextJournals);
      setJournalAttachments(nextAttachments);
      setJournalAttachmentPreview(null);
    } catch (e: any) {
      if (navigationCoordinatorRef.current.isPrimaryCurrent(seq))
        setStatus(e.message);
    }
  }

  function journalEntryToBlocks(entry: JournalEntry): BlockNoteDoc {
    return blockNoteContentFromPage({
      meta: {
        id: `journal_${entry.date}`,
        title: entry.title,
        parentId: null,
        icon: entry.icon || "📅",
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
        sortOrder: 0,
        trashed: false,
        properties: DEFAULT_PAGE_PROPERTIES,
        scope: "private",
      },
      markdown: entry.markdown,
      blocksuite: entry.blocksuite,
    } as any);
  }

  async function addJournalAttachments(): Promise<void> {
    if (!api || !currentJournal || journalAttachmentUploading) return;
    try {
      const files = await window.localNotion.chooseAttachment();
      if (!files.length) return;
      setJournalAttachmentUploading(true);
      for (const sourcePath of files) {
        await api.addJournalAttachment(currentJournal.date, sourcePath);
      }
      setJournalAttachments(
        await api.listJournalAttachments(currentJournal.date),
      );
      setJournalSideTab("attachments");
      notifyWorkspaceGraphMutation("journal-attachments-added", [], {
        journalDates: [currentJournal.date],
        cacheScopes: ["workspace", "attachments", "notifications"],
      });
      setStatus(`${files.length}件のファイルをJournalへ添付しました`);
    } catch (e: any) {
      setStatus(e?.message || "Journalへの添付に失敗しました");
    } finally {
      setJournalAttachmentUploading(false);
    }
  }

  async function uploadJournalFileForBlockNote(file: File): Promise<string> {
    if (!api || !currentJournal)
      throw new Error("Journalが読み込まれていません。");
    const url = await api.uploadJournalAttachmentFile(
      currentJournal.date,
      file,
    );
    setJournalAttachments(
      await api.listJournalAttachments(currentJournal.date),
    );
    notifyWorkspaceGraphMutation("journal-attachments-added", [], {
      journalDates: [currentJournal.date],
      cacheScopes: ["workspace", "attachments", "notifications"],
    });
    setStatus("ファイルをJournal本文へ追加しました");
    return url;
  }

  function showJournalConflict(
    local: JournalEntry,
    localMeta: { mood: string; weather: string; tagsText: string },
    localBlocks: BlockNoteDoc,
    remote: JournalEntry,
  ) {
    setJournalConflict({ local, localMeta, localBlocks, remote });
    setJournalDirty(true);
    setStatus(
      "Journalの競合を検出しました。内容を確認して保存方法を選んでください。",
    );
  }

  async function resolveJournalConflict(mode: "remote" | "local" | "merge") {
    if (!api || !journalConflict) return;
    const conflict = journalConflict;
    if (mode === "remote") {
      setCurrentJournal(conflict.remote);
      setJournalDate(conflict.remote.date);
      setJournalMetaDraft({
        mood: conflict.remote.mood || "",
        weather: conflict.remote.weather || "",
        tagsText: (conflict.remote.tags || []).join(", "),
      });
      suppressNextJournalChangeRef.current = true;
      setJournalBlocks(journalEntryToBlocks(conflict.remote));
      setJournalDirty(false);
      setJournalConflict(null);
      setStatus("共有フォルダ側のJournalを読み込みました");
      return;
    }
    setJournalConflictSaving(true);
    try {
      const localTags = String(conflict.localMeta.tagsText || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const mergedMarkdown =
        mode === "merge"
          ? `${conflict.remote.markdown || ""}${conflict.remote.markdown && conflict.local.markdown ? "\n\n---\n\n" : ""}${conflict.local.markdown || ""}`
          : conflict.local.markdown;
      const mergedBlocks =
        mode === "merge"
          ? journalEntryToBlocks({
              ...conflict.local,
              markdown: mergedMarkdown,
              blocksuite: null,
            })
          : conflict.localBlocks;
      const payload: JournalEntry = {
        ...conflict.remote,
        ...conflict.local,
        markdown: mergedMarkdown,
        blocksuite: { version: 1, kind: "blocknote", blocks: mergedBlocks },
        mood:
          mode === "merge"
            ? conflict.localMeta.mood || conflict.remote.mood || ""
            : conflict.localMeta.mood,
        weather:
          mode === "merge"
            ? conflict.localMeta.weather || conflict.remote.weather || ""
            : conflict.localMeta.weather,
        tags:
          mode === "merge"
            ? Array.from(
                new Set([...(conflict.remote.tags || []), ...localTags]),
              )
            : localTags,
        updatedAt: conflict.remote.updatedAt,
      };
      const saved = await api.saveJournal(payload, { force: true });
      setCurrentJournal(saved);
      setJournalMetaDraft({
        mood: payload.mood || "",
        weather: payload.weather || "",
        tagsText: (payload.tags || []).join(", "),
      });
      suppressNextJournalChangeRef.current = true;
      setJournalBlocks(mergedBlocks);
      setJournalDirty(false);
      setJournalConflict(null);
      clearSaveRecovery("journal");
      setJournals(await api.listJournals());
      setStatus(
        mode === "merge"
          ? "共有側と自分側の本文を統合して保存しました"
          : "自分の内容で共有Journalを更新しました",
      );
    } catch (error: any) {
      setStatus(
        error?.message || "競合の解決に失敗しました。内容は保持されています。",
      );
    } finally {
      setJournalConflictSaving(false);
    }
  }

  async function saveJournalNow() {
    if (!api || !currentJournal) return;
    const snapshot = {
      entry: currentJournal,
      meta: journalMetaDraftRef.current,
      blocks: journalBlocks,
    };
    queuedJournalSaveRef.current = snapshot;
    if (journalSaveInFlightRef.current)
      return journalSaveDrainRef.current ?? Promise.resolve();

    journalSaveInFlightRef.current = true;
    setJournalSaving(true);
    setSaveActivity((previous) => ({ ...previous, journal: true }));
    const drain = (async () => {
      let failedSnapshot: typeof snapshot | null = null;
      try {
        while (queuedJournalSaveRef.current) {
          const next = queuedJournalSaveRef.current;
          queuedJournalSaveRef.current = null;
          failedSnapshot = next;
          const tags = String(next.meta.tagsText || "")
            .split(",")
            .map((value: string) => value.trim())
            .filter(Boolean);
          const saved = await api.saveJournal({
            ...next.entry,
            mood: next.meta.mood,
            weather: next.meta.weather,
            tags,
            markdown: blockNoteToMarkdown(next.blocks),
            blocksuite: { version: 1, kind: "blocknote", blocks: next.blocks },
          });
          setCurrentJournal((prev) =>
            prev?.date === saved.date
              ? {
                  ...saved,
                  mood: next.meta.mood,
                  weather: next.meta.weather,
                  tags,
                }
              : prev,
          );
          failedSnapshot = null;
          clearSaveRecovery("journal");
          scheduleSemanticIndexUpdateForJournal(saved.date);
          notifyWorkspaceGraphMutation("journal-saved", [], {
            journalDates: [saved.date],
          });
          if (!queuedJournalSaveRef.current) setJournalDirty(false);
          setStatus(
            queuedJournalSaveRef.current
              ? "ジャーナルを保存しています…"
              : "ジャーナルを保存しました",
          );
          void api
            .listJournals()
            .then(setJournals)
            .catch(() => undefined);
        }
      } catch (e: any) {
        const isConflict = isApiError(e) && e.code === "JOURNAL_CONFLICT";
        if (isConflict && failedSnapshot) {
          queuedJournalSaveRef.current = null;
          try {
            const remote = await api.getJournal(failedSnapshot.entry.date);
            const localTags = String(failedSnapshot.meta.tagsText || "")
              .split(",")
              .map((value: string) => value.trim())
              .filter(Boolean);
            showJournalConflict(
              {
                ...failedSnapshot.entry,
                mood: failedSnapshot.meta.mood,
                weather: failedSnapshot.meta.weather,
                tags: localTags,
                markdown: blockNoteToMarkdown(failedSnapshot.blocks),
                blocksuite: {
                  version: 1,
                  kind: "blocknote",
                  blocks: failedSnapshot.blocks,
                },
              },
              failedSnapshot.meta,
              failedSnapshot.blocks,
              remote,
            );
          } catch (loadError: any) {
            setStatus(
              loadError?.message ||
                "競合内容の取得に失敗しました。未保存状態を保持しています。",
            );
          }
        } else {
          if (failedSnapshot && !queuedJournalSaveRef.current)
            queuedJournalSaveRef.current = failedSnapshot;
          setJournalDirty(true);
          scheduleSaveRetry("journal", "ジャーナル", async () => {
            await saveJournalNow();
          });
          setStatus(
            e?.message ??
              "ジャーナルの保存に失敗しました。未保存状態を保持しています。",
          );
        }
      } finally {
        journalSaveInFlightRef.current = false;
        journalSaveDrainRef.current = null;
        setJournalSaving(false);
        setSaveActivity((previous) => ({ ...previous, journal: false }));
      }
    })();
    journalSaveDrainRef.current = drain;
    return drain;
  }

  useEffect(() => {
    if (
      mainMode !== "journal" ||
      !currentJournal ||
      !journalDirty ||
      journalConflict
    )
      return;
    const timer = window.setTimeout(() => {
      saveJournalNow().catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [
    mainMode,
    currentJournal?.date,
    journalDirty,
    journalBlocks,
    journalMetaDraft.mood,
    journalMetaDraft.weather,
    journalMetaDraft.tagsText,
    journalConflict,
  ]);

  async function deleteCurrentJournal() {
    if (!api || !currentJournal) return;
    if (!confirm(`${currentJournal.date} のジャーナルを削除しますか？`)) return;
    try {
      const deletedJournalDate = currentJournal.date;
      await api.deleteJournal(deletedJournalDate);
      scheduleSemanticIndexUpdateForJournal(deletedJournalDate);
      notifyWorkspaceGraphMutation("journal-deleted", [], {
        journalDates: [deletedJournalDate],
      });
      setCurrentJournal(null);
      setJournalMetaDraft({ mood: "", weather: "", tagsText: "" });
      setJournalBlocks([paragraph()]);
      setJournalDirty(false);
      setJournals(await api.listJournals());
      setStatus("ジャーナルを削除しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function createDatabase(scope: WorkspaceScope = "shared") {
    if (!api) return;
    try {
      const db = await api.createDatabase(
        scope === "private" ? "Private DB" : "新規テーブル",
        scope,
      );
      await reload(
        scope === "private"
          ? "Privateデータベースを作成しました"
          : "Sharedデータベースを作成しました",
      );
      // Creation follows the same route as a sidebar click: keep the active
      // BlockNote page visible and add the new database to its shared tab rail.
      openDatabaseInWorkspace(db.id, "tabs");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function openDatabaseInWorkspace(
    id: string,
    mode: "tabs" | "split" | "compare" = "tabs",
  ) {
    const dispatch = () =>
      window.dispatchEvent(
        new CustomEvent("local-notion:workspace-open-item", {
          detail: { kind: "database", id, mode },
        }),
      );
    if (current) {
      dispatch();
      setStatus(
        mode === "compare"
          ? "データベースを比較表示に追加しました"
          : mode === "split"
            ? "データベースを分割表示に追加しました"
            : "データベースを作業スペースのタブに開きました",
      );
      return;
    }
    const fallbackPageId = currentPageIdRef.current || allVisiblePages[0]?.id;
    if (!fallbackPageId) {
      void openDatabase(id);
      return;
    }
    void openPage(fallbackPageId).then(() => window.setTimeout(dispatch, 80));
  }

  function openDatabaseRowInWorkspace(
    databaseId: string,
    rowId: string,
    mode: "tabs" | "split" | "compare" = "tabs",
  ) {
    const dispatch = () =>
      window.dispatchEvent(
        new CustomEvent("local-notion:workspace-open-item", {
          detail: { kind: "database", id: databaseId, rowId, mode },
        }),
      );
    if (current) {
      dispatch();
      setStatus("データベース行を作業スペースのタブで開きました");
      return;
    }
    const fallbackPageId = currentPageIdRef.current || allVisiblePages[0]?.id;
    if (!fallbackPageId) {
      void openDatabase(databaseId, undefined, rowId);
      return;
    }
    void openPage(fallbackPageId).then(() => window.setTimeout(dispatch, 80));
  }

  async function openDatabase(id: string, viewId?: string, rowId?: string) {
    if (!api) return;
    const seq = navigationCoordinatorRef.current.beginPrimary();
    await flushPendingSaves();
    if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
    try {
      if (editing && current)
        await api.releaseLock(current.meta.id).catch(() => undefined);
      if (currentDb?.id && currentDb.id !== id)
        await api.releaseDatabaseLock(currentDb.id).catch(() => undefined);
      const fetched = await api.getDatabase(id);
      const db =
        viewId && fetched.views?.some((view) => view.id === viewId)
          ? { ...fetched, activeViewId: viewId }
          : fetched;
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
      // v397: Like pages, databases open in optimistic editing mode.
      // The save path compares baseUpdatedAt and writes a conflict snapshot
      // instead of turning a fresh database into read-only because of SMB lock I/O.
      if (!navigationCoordinatorRef.current.isPrimaryCurrent(seq)) return;
      setCurrent(null);
      currentPageIdRef.current = null;
      setMainMode("database");
      setWorkspaceActiveItem({ kind: "database", id });
      setEditing(false);
      currentDbRef.current = db;
      setCurrentDb(db);
      setDbEditing(true);
      setPendingDbRowId(rowId ?? null);
      recordRecentWorkspaceItem({
        kind: "database",
        id: db.id,
        title: db.title || "無題のデータベース",
        icon: "▦",
      });
      setRecentWorkspaceRevision((value) => value + 1);
      setStatus(rowId ? "DB行を開きました" : "データベースを開きました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function openDatabaseRow(databaseId: string, rowId: string) {
    await openDatabase(databaseId, undefined, rowId);
    setStatus("DB行リンクを開きました。プレビューで対象行を表示します。");
  }

  function databaseSaveErrorMessage(error: unknown, label: string) {
    if (isApiError(error) && error.code === "DATABASE_CONFLICT") {
      const current = error.payload?.currentUpdatedAt
        ? `
現在の更新日時: ${error.payload.currentUpdatedAt}`
        : "";
      const base = error.payload?.baseUpdatedAt
        ? `
編集中の基準日時: ${error.payload.baseUpdatedAt}`
        : "";
      return `${label}の競合を検出しました。別端末または別ウィンドウで更新されています。編集内容は conflicts フォルダに退避されています。再読み込みしてから編集を続けてください。${current}${base}`;
    }
    if (isApiError(error) && error.code === "DATABASE_LOCKED") {
      return `${label}は他の端末または別ウィンドウで編集中のため保存できません。読み取り専用に切り替えました。`;
    }
    return error instanceof Error
      ? error.message
      : `${label}の保存に失敗しました。`;
  }

  function applyDatabaseSnapshot(next: WorkspaceDatabase) {
    setDatabases((prev) => prev.map((db) => (db.id === next.id ? next : db)));
    if (currentDbRef.current?.id === next.id) {
      currentDbRef.current = next;
      setCurrentDb(next);
    }
  }

  function databaseSemanticSchemaSignature(
    database: WorkspaceDatabase,
  ): string {
    // Titles and property labels/types are embedded in DB-row semantic text.
    // Views, column layout, and local-only display settings are intentionally
    // excluded so normal UI changes never trigger a row-wide re-embedding.
    return JSON.stringify({
      title: database.title || "",
      scope: database.scope || "shared",
      properties: database.properties || [],
    });
  }

  function requestDatabaseSemanticRefresh(
    previous: WorkspaceDatabase | null | undefined,
    saved: WorkspaceDatabase,
  ): void {
    const previousById = new Map(
      (previous?.rows || []).map((row) => [row.id, row]),
    );
    const savedById = new Map((saved.rows || []).map((row) => [row.id, row]));
    const schemaChanged = Boolean(
      previous &&
      databaseSemanticSchemaSignature(previous) !==
        databaseSemanticSchemaSignature(saved),
    );
    // Include IDs that disappeared as well. Targeted semantic replacement with
    // no returned chunks removes stale entries for deleted DB rows.
    const rowIds = new Set([...previousById.keys(), ...savedById.keys()]);
    for (const rowId of rowIds) {
      const before = previousById.get(rowId);
      const after = savedById.get(rowId);
      if (
        !schemaChanged &&
        before &&
        after &&
        before.updatedAt === after.updatedAt
      )
        continue;
      workspaceMutationCoordinator.requestSemanticRefresh([
        workspaceMutationCoordinator.databaseRowTarget(saved.id, rowId),
      ]);
    }
  }

  async function createDatabaseRows(
    databaseId: string,
    rows: Array<{ sourceRowId?: string; cells?: Record<string, any> }>,
  ) {
    if (!api) return null;
    const latest =
      currentDbRef.current?.id === databaseId
        ? currentDbRef.current
        : (databases.find((item) => item.id === databaseId) ?? null);
    const baseUpdatedAt = resolveDatabaseSaveBase(latest, latest);
    const result = await api.createDatabaseRows(databaseId, {
      baseUpdatedAt,
      rows,
    });
    const source = latest ?? currentDbRef.current;
    if (source?.id === databaseId) {
      const existingIds = new Set(result.rows.map((row) => row.id));
      const next = {
        ...source,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
        rows: [
          ...result.rows,
          ...source.rows.filter((row) => !existingIds.has(row.id)),
        ],
      };
      lastPersistedDatabaseUpdatedAtRef.current[databaseId] = result.updatedAt;
      applyDatabaseSnapshot(next);
    }
    for (const row of result.rows) {
      workspaceMutationCoordinator.requestSemanticRefresh([
        workspaceMutationCoordinator.databaseRowTarget(databaseId, row.id),
      ]);
    }
    notifyWorkspaceGraphMutation("database-rows-created", [], {
      databaseIds: [databaseId],
      databaseRowIds: result.rows.map((row) => `${databaseId}:${row.id}`),
      cacheScopes: ["workspace", "graph", "search", "tasks", "notifications"],
    });
    setStatus("行を追加しました");
    return result;
  }

  async function deleteDatabaseRows(databaseId: string, rowIds: string[]) {
    if (!api || !rowIds.length) return null;
    const latest =
      currentDbRef.current?.id === databaseId
        ? currentDbRef.current
        : (databases.find((item) => item.id === databaseId) ?? null);
    const baseUpdatedAt = resolveDatabaseSaveBase(latest, latest);
    const result = await api.deleteDatabaseRows(databaseId, {
      baseUpdatedAt,
      rowIds,
    });
    const source = latest ?? currentDbRef.current;
    if (source?.id === databaseId) {
      const deletedIds = new Set(result.deletedRowIds);
      const next = {
        ...source,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
        rows: source.rows.filter((row) => !deletedIds.has(row.id)),
        trash: {
          ...source.trash,
          rows: [...(source.trash?.rows ?? []), ...result.trashedRows],
        },
      };
      lastPersistedDatabaseUpdatedAtRef.current[databaseId] = result.updatedAt;
      applyDatabaseSnapshot(next);
    }
    for (const rowId of result.deletedRowIds) {
      workspaceMutationCoordinator.requestSemanticRefresh([
        workspaceMutationCoordinator.databaseRowTarget(databaseId, rowId),
      ]);
    }
    notifyWorkspaceGraphMutation("database-rows-deleted", [], {
      databaseIds: [databaseId],
      databaseRowIds: result.deletedRowIds.map((rowId) => `${databaseId}:${rowId}`),
      cacheScopes: ["workspace", "graph", "search", "tasks", "notifications"],
    });
    setStatus("行を削除しました");
    return result;
  }

  async function patchDatabaseRows(
    databaseId: string,
    patches: Array<{ rowId: string; cells: Record<string, any> }>,
  ) {
    if (!api || !patches.length) return;
    const queue = databaseRowPatchQueuesRef.current[databaseId] ?? {
      inFlight: false,
      pending: new Map<string, Record<string, any>>(),
    };
    databaseRowPatchQueuesRef.current[databaseId] = queue;
    for (const patch of patches)
      queue.pending.set(patch.rowId, {
        ...(queue.pending.get(patch.rowId) || {}),
        ...patch.cells,
      });
    if (queue.inFlight) return;
    queue.inFlight = true;
    try {
      while (queue.pending.size) {
        const batch = [...queue.pending.entries()]
          .slice(0, 500)
          .map(([rowId, cells]) => ({ rowId, cells }));
        for (const item of batch) queue.pending.delete(item.rowId);
        const latest =
          currentDbRef.current?.id === databaseId
            ? currentDbRef.current
            : (databases.find((item) => item.id === databaseId) ?? null);
        const baseUpdatedAt = resolveDatabaseSaveBase(latest, latest);
        const result = await api.patchDatabaseRows(databaseId, {
          baseUpdatedAt,
          patches: batch,
        });
        if (!result.rows.length) continue;
        const updatedIds = new Set(result.rows.map((row) => row.id));
        const source = latest ?? currentDbRef.current;
        if (source?.id === databaseId) {
          const byId = new Map(result.rows.map((row) => [row.id, row]));
          const next = {
            ...source,
            updatedAt: result.updatedAt,
            updatedBy: result.updatedBy,
            rows: source.rows.map((row) => byId.get(row.id) ?? row),
          };
          lastPersistedDatabaseUpdatedAtRef.current[databaseId] =
            result.updatedAt;
          applyDatabaseSnapshot(next);
        }
        for (const row of result.rows) {
          workspaceMutationCoordinator.requestSemanticRefresh([
            workspaceMutationCoordinator.databaseRowTarget(databaseId, row.id),
          ]);
        }
        notifyWorkspaceGraphMutation("database-rows-patched", [], {
          databaseIds: [databaseId],
          databaseRowIds: result.rows.map((row) => `${databaseId}:${row.id}`),
          cacheScopes: [
            "workspace",
            "graph",
            "search",
            "tasks",
            "notifications",
          ],
        });
      }
      setStatus("データベースの変更を保存しました");
    } catch (error) {
      setStatus(databaseSaveErrorMessage(error, "データベース"));
      throw error;
    } finally {
      queue.inFlight = false;
    }
  }

  function resolveDatabaseSaveBase(
    candidate?: WorkspaceDatabase | null,
    fallback?: WorkspaceDatabase | null,
  ) {
    const databaseId = candidate?.id ?? fallback?.id;
    const persisted = databaseId
      ? lastPersistedDatabaseUpdatedAtRef.current[databaseId]
      : undefined;
    const candidateAny = candidate as any;
    const fallbackAny = fallback as any;
    // Queued writes must be based on the last successful server revision,
    // never on an optimistic updatedAt from the table component.
    return (
      persisted ??
      candidateAny?.baseUpdatedAt ??
      fallbackAny?.baseUpdatedAt ??
      candidate?.updatedAt ??
      fallback?.updatedAt
    );
  }

  async function flushDatabaseSaveQueue(
    initial: WorkspaceDatabase,
    label: string,
  ) {
    if (!api) return;
    if (databaseSaveInFlightRef.current)
      return databaseSaveDrainRef.current ?? Promise.resolve();
    databaseSaveInFlightRef.current = true;
    setSaveActivity((previous) => ({ ...previous, database: true }));
    let next: { database: WorkspaceDatabase; label: string } | null = {
      database: initial,
      label,
    };
    let saveFailed = false;
    const drain = (async () => {
      try {
        while (next) {
          queuedDatabaseSaveRef.current = null;
          const latest =
            currentDbRef.current?.id === next.database.id
              ? currentDbRef.current
              : null;
          const baseUpdatedAt = resolveDatabaseSaveBase(latest, next.database);
          const payload = { ...next.database, baseUpdatedAt };
          const saved = await api.saveDatabase(payload);
          lastPersistedDatabaseUpdatedAtRef.current[saved.id] = saved.updatedAt;
          requestDatabaseSemanticRefresh(latest ?? next.database, saved);
          notifyWorkspaceGraphMutation("database-saved", [], {
            databaseIds: [saved.id],
          });
          applyDatabaseSnapshot(saved);
          clearSaveRecovery("database");
          setStatus(`${next.label}を自動保存しました`);
          next = queuedDatabaseSaveRef.current;
        }
      } catch (e: any) {
        saveFailed = true;
        if (next && !queuedDatabaseSaveRef.current)
          queuedDatabaseSaveRef.current = next;
        const retryLabel = next?.label ?? label;
        const requiresUserDecision =
          isApiError(e) &&
          (e.code === "DATABASE_CONFLICT" || e.code === "DATABASE_LOCKED");
        if (requiresUserDecision) {
          setDbEditing(false);
          setSaveRecovery((prev) => ({
            ...prev,
            database: { label: retryLabel, attempt: 0, exhausted: true },
          }));
        } else {
          scheduleSaveRetry("database", retryLabel, async () => {
            const pending = queuedDatabaseSaveRef.current;
            if (!pending) return;
            queuedDatabaseSaveRef.current = null;
            await flushDatabaseSaveQueue(pending.database, pending.label);
          });
        }
        setStatus(databaseSaveErrorMessage(e, retryLabel));
      } finally {
        databaseSaveInFlightRef.current = false;
        setSaveActivity((previous) => ({ ...previous, database: false }));
        databaseSaveDrainRef.current = null;
        const queued = queuedDatabaseSaveRef.current;
        if (queued && dbEditing && !saveFailed) {
          queuedDatabaseSaveRef.current = null;
          void flushDatabaseSaveQueue(queued.database, queued.label).catch(
            () => undefined,
          );
        }
      }
    })();
    databaseSaveDrainRef.current = drain;
    return drain;
  }

  async function autoSaveDatabase(
    updated: WorkspaceDatabase,
    label = "データベース",
  ) {
    if (!api || !dbEditing) return;
    const latest =
      currentDbRef.current?.id === updated.id ? currentDbRef.current : null;
    const baseUpdatedAt = resolveDatabaseSaveBase(latest, updated);
    const optimistic = { ...updated, baseUpdatedAt };
    applyDatabaseSnapshot(optimistic);
    if (databaseSaveInFlightRef.current) {
      queuedDatabaseSaveRef.current = { database: optimistic, label };
      return;
    }
    await flushDatabaseSaveQueue(optimistic, label);
  }

  async function saveEmbeddedDatabase(updated: WorkspaceDatabase) {
    return autoSaveDatabase(updated, "本文内データベース");
  }

  async function saveWorkspaceDatabase(updated: WorkspaceDatabase) {
    if (!api) return;
    const queue = workspaceDatabaseSaveQueuesRef.current[updated.id] ?? {
      inFlight: false,
      pending: null,
    };
    workspaceDatabaseSaveQueuesRef.current[updated.id] = queue;
    queue.pending = updated;
    applyDatabaseSnapshot(updated);
    if (queue.inFlight) return;

    queue.inFlight = true;
    try {
      while (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        const persistedBase =
          lastPersistedDatabaseUpdatedAtRef.current[next.id];
        const baseUpdatedAt =
          persistedBase ||
          (databases.find((database) => database.id === next.id)?.updatedAt ??
            next.baseUpdatedAt);
        const saved = await api.saveDatabase({ ...next, baseUpdatedAt });
        lastPersistedDatabaseUpdatedAtRef.current[saved.id] = saved.updatedAt;
        requestDatabaseSemanticRefresh(next, saved);
        notifyWorkspaceGraphMutation("database-saved", [], {
          databaseIds: [saved.id],
        });
        applyDatabaseSnapshot(saved);
      }
      setStatus("データベースを保存しました");
    } catch (error) {
      // Do not retain a stale queued snapshot after an explicit conflict. The
      // server already wrote a conflict copy; continuing to retry would only
      // create repeated conflicts.
      queue.pending = null;
      setStatus(databaseSaveErrorMessage(error, "データベース"));
    } finally {
      queue.inFlight = false;
    }
  }

  async function changeWorkspaceDatabaseScope(
    databaseId: string,
    nextScope: WorkspaceScope,
  ) {
    if (!api) return;
    const database = databases.find((item) => item.id === databaseId);
    if (!database || workspaceScope(database) === nextScope) return;
    const warning =
      nextScope === "shared"
        ? "このデータベースをSharedに移動します。共有フォルダ上で他端末・他ユーザーから見える可能性があります。よろしいですか？"
        : "このデータベースをPrivateに移動します。共有フォルダからは見えなくなります。よろしいですか？";
    if (!confirm(warning)) return;
    try {
      const baseUpdatedAt =
        lastPersistedDatabaseUpdatedAtRef.current[databaseId] ||
        database.updatedAt;
      const saved = await api.saveDatabase({
        ...database,
        scope: nextScope,
        baseUpdatedAt,
      });
      lastPersistedDatabaseUpdatedAtRef.current[saved.id] = saved.updatedAt;
      requestDatabaseSemanticRefresh(database, saved);
      notifyWorkspaceGraphMutation("database-scope-changed", [], {
        databaseIds: [saved.id],
      });
      applyDatabaseSnapshot(saved);
      await enqueueWorkspaceRefresh(
        nextScope === "private"
          ? "データベースをPrivateにしました"
          : "データベースをSharedにしました",
        { tree: false, databases: true, journals: false },
        "save",
      );
    } catch (error) {
      setStatus(databaseSaveErrorMessage(error, "データベース"));
    }
  }
  async function saveDatabase() {
    if (!api || !currentDb) return;
    try {
      const saved = await api.saveDatabase({
        ...currentDb,
        baseUpdatedAt: resolveDatabaseSaveBase(currentDb, currentDb),
      });
      lastPersistedDatabaseUpdatedAtRef.current[saved.id] = saved.updatedAt;
      requestDatabaseSemanticRefresh(currentDb, saved);
      notifyWorkspaceGraphMutation("database-saved", [], {
        databaseIds: [saved.id],
      });
      setCurrentDb(saved);
      await reload("データベースを保存しました");
    } catch (e: any) {
      setStatus(databaseSaveErrorMessage(e, "データベース"));
    }
  }

  async function changeDatabaseScope(nextScope: WorkspaceScope) {
    if (!api || !currentDb || workspaceScope(currentDb) === nextScope) return;
    const warning =
      nextScope === "shared"
        ? "このデータベースをSharedに移動します。共有フォルダ上で他端末・他ユーザーから見える可能性があります。よろしいですか？"
        : "このデータベースをPrivateに移動します。共有フォルダからは見えなくなります。よろしいですか？";
    if (!confirm(warning)) return;
    try {
      const saved = await api.saveDatabase({
        ...currentDb,
        scope: nextScope,
        baseUpdatedAt: resolveDatabaseSaveBase(currentDb, currentDb),
      });
      lastPersistedDatabaseUpdatedAtRef.current[saved.id] = saved.updatedAt;
      requestDatabaseSemanticRefresh(currentDb, saved);
      notifyWorkspaceGraphMutation("database-scope-changed", [], {
        databaseIds: [saved.id],
      });
      setCurrentDb(saved);
      await reload(
        nextScope === "private"
          ? "データベースをPrivateにしました"
          : "データベースをSharedにしました",
      );
    } catch (e: any) {
      setDbEditing(false);
      setStatus(databaseSaveErrorMessage(e, "データベース"));
    }
  }

  async function deleteDatabaseById(id: string) {
    if (!api) return;
    const target =
      databases.find((db) => db.id === id) ??
      (currentDb?.id === id ? currentDb : null);
    const title = target?.title ?? id;
    if (
      !confirm(
        `データベース「${title}」を削除しますか？\nゴミ箱へ移動します。後から復元できます。`,
      )
    )
      return;
    try {
      await api.deleteDatabase(id);
      // Deleting a database removes every row source. Queue targeted empty
      // replacements so stale DB-row semantic chunks are removed in batches.
      if (target) {
        requestDatabaseSemanticRefresh(target, {
          ...target,
          rows: [],
          updatedAt: new Date().toISOString(),
        });
      }
      notifyWorkspaceGraphMutation("database-trashed", [], {
        databaseIds: [id],
      });
      if (currentDb?.id === id) {
        setCurrentDb(null);
        setMainMode("empty");
      }
      await reload("データベースをゴミ箱へ移動しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function addDatabaseRow() {
    if (!api || !currentDb) return;
    try {
      await createDatabaseRows(currentDb.id, [{}]);
    } catch (e: any) {
      setStatus(databaseSaveErrorMessage(e, "行"));
    }
  }

  async function addDatabaseProperty() {
    if (!api || !currentDb) return;
    const name = `Property ${currentDb.properties.length + 1}`;
    const type = "text" as DatabasePropertyType;
    try {
      const saved = await api.addDatabaseProperty(currentDb.id, name, type);
      requestDatabaseSemanticRefresh(currentDb, saved);
      notifyWorkspaceGraphMutation("database-schema-changed", [], {
        databaseIds: [saved.id],
      });
      setCurrentDb(saved);
      await reload(
        "列を追加しました。列名や種類はプロパティ設定画面で変更できます。",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function movePageToParent(id: string, parentId: string | null) {
    if (!api) return;
    if (id === parentId) return;
    const previousParentId =
      current?.meta.id === id
        ? current.meta.parentId
        : (allVisiblePages.find((page) => page.id === id)?.parentId ?? null);
    try {
      await api.movePage(id, parentId);
      scheduleSemanticIndexUpdateForPage(id);
      scheduleSemanticIndexUpdateForDatabaseRowParent(previousParentId);
      scheduleSemanticIndexUpdateForDatabaseRowParent(parentId);
      await reload(
        parentId ? "ページを移動しました" : "ページをルートへ移動しました",
      );
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function toggleFavorite(id: string) {
    if (!api) return;
    try {
      const meta = await api.toggleFavorite(id);
      if (current?.meta.id === id) setCurrent({ ...current, meta });
      await reload("お気に入りを更新しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  async function reorderPage(id: string, direction: -1 | 1) {
    if (!api) return;
    const page = allVisiblePages.find((p) => p.id === id);
    if (!page) return;
    const siblings = allVisiblePages
      .filter((p) => p.parentId === page.parentId && !p.trashed)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.updatedAt.localeCompare(b.updatedAt),
      );
    const index = siblings.findIndex((p) => p.id === id);
    const target = siblings[index + direction];
    if (!target) return;
    try {
      await Promise.all([
        api.updatePageOrder(page.id, target.sortOrder),
        api.updatePageOrder(target.id, page.sortOrder),
      ]);
      await reload("ページの並び順を変更しました");
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  function toggleSidebarCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function chooseSharedRoot() {
    const selected = await window.localNotion.chooseSharedRoot();
    if (selected) {
      alert("共有フォルダを変更しました。アプリを再起動してください。");
    }
  }

  async function chooseLocalDbPath() {
    const selected = await window.localNotion.chooseLocalDbPath();
    if (selected) {
      alert("SQLite保存先を変更しました。アプリを再起動してください。");
    }
  }

  async function useAutoLocalDbPath() {
    await window.localNotion.useAutoLocalDbPath();
    alert("SQLite保存先を自動選択に戻しました。アプリを再起動してください。");
  }

  async function choosePrivatePagesRoot() {
    const selected = await window.localNotion.choosePrivatePagesRoot();
    if (selected) {
      setPrivatePagesRoot(selected);
      alert(
        "Privateページ保存先を変更しました。アプリを再起動してください。既存Privateページは自動移動されません。",
      );
    }
  }

  async function choosePrivateDatabasesRoot() {
    const selected = await window.localNotion.choosePrivateDatabasesRoot();
    if (selected) {
      setPrivateDatabasesRoot(selected);
      alert(
        "Private DB保存先を変更しました。アプリを再起動してください。既存Private DBは自動移動されません。",
      );
    }
  }

  async function resetPrivatePagesRoot() {
    await window.localNotion.resetPrivatePagesRoot();
    setPrivatePagesRoot("");
    alert(
      "Privateページ保存先を自動に戻しました。アプリを再起動してください。",
    );
  }

  async function resetPrivateDatabasesRoot() {
    await window.localNotion.resetPrivateDatabasesRoot();
    setPrivateDatabasesRoot("");
    alert("Private DB保存先を自動に戻しました。アプリを再起動してください。");
  }

  async function chooseOcrBinary() {
    try {
      const selected = await window.localNotion.chooseOcrBinary();
      if (selected) {
        setOcrBinaryPath(selected);
        setStatus(`ローカルOCRの実行ファイルを設定しました：${selected}`);
      } else {
        setStatus("OCR実行ファイルの選択をキャンセルしました。");
      }
    } catch (error: any) {
      setStatus(
        `OCR実行ファイルを設定できませんでした：${error?.message || "不明なエラー"}`,
      );
    }
  }

  async function resetOcrBinary() {
    try {
      await window.localNotion.resetOcrBinary();
      setOcrBinaryPath("");
      setStatus("ローカルOCRを自動検出へ戻しました。");
    } catch (error: any) {
      setStatus(
        `OCR設定を戻せませんでした：${error?.message || "不明なエラー"}`,
      );
    }
  }

  async function choosePopplerFolder() {
    try {
      const selected = await window.localNotion.choosePopplerFolder();
      if (selected) {
        setPopplerBinaryPath(selected);
        setStatus(`Popplerフォルダを設定しました：${selected}`);
      } else {
        setStatus("Popplerフォルダの選択をキャンセルしました。");
      }
    } catch (error: any) {
      setStatus(
        `Popplerフォルダを設定できませんでした：${error?.message || "不明なエラー"}`,
      );
    }
  }

  async function choosePopplerBinary() {
    try {
      const selected = await window.localNotion.choosePopplerBinary();
      if (selected) {
        setPopplerBinaryPath(selected);
        setStatus(`PDF文字抽出の実行ファイルを設定しました：${selected}`);
      } else {
        setStatus("pdftotext の選択をキャンセルしました。");
      }
    } catch (error: any) {
      setStatus(
        `pdftotext を設定できませんでした：${error?.message || "不明なエラー"}`,
      );
    }
  }

  async function resetPopplerBinary() {
    try {
      await window.localNotion.resetPopplerBinary();
      setPopplerBinaryPath("");
      setStatus("PDF文字抽出を自動検出へ戻しました。");
    } catch (error: any) {
      setStatus(
        `PDF文字抽出設定を戻せませんでした：${error?.message || "不明なエラー"}`,
      );
    }
  }

  const allVisiblePages = useMemo(() => flattenTree(tree), [tree]);

  const databaseRowLinkTargets = useMemo<DatabaseRowLinkTarget[]>(() => {
    return databases.flatMap((db) =>
      db.rows.map((row) => {
        const preferred =
          db.properties.find((prop) =>
            /^(title|name|名前|件名|項目)$/i.test(prop.name),
          ) ||
          db.properties.find((prop) => prop.type === "text") ||
          db.properties[0];
        const raw = preferred ? row.cells[preferred.id] : "";
        const rowTitle = Array.isArray(raw)
          ? raw.join(", ")
          : raw == null || raw === ""
            ? row.id
            : String(raw);
        return {
          type: "database-row" as const,
          databaseId: db.id,
          databaseTitle: db.title,
          rowId: row.id,
          rowTitle,
        };
      }),
    );
  }, [databases]);

  const filteredTree = useMemo(
    () => filterTreeByProperties(tree, pageFilters),
    [tree, pageFilters],
  );
  const favoritePages = useMemo(
    () => allVisiblePages.filter((page) => page.favorite),
    [allVisiblePages],
  );
  const filteredSearchResults = useMemo(
    () =>
      searchResults.filter((page) => {
        if (!pageMatchesFilters(page, pageFilters)) return false;
        if (!searchTagFilters.length) return true;
        const pageTagKeys = new Set(
          normalizePageProperties(page.properties).tags.map(
            normalizeTagFilterKey,
          ),
        );
        return searchTagFilters.every((tag) =>
          pageTagKeys.has(normalizeTagFilterKey(tag)),
        );
      }),
    [searchResults, pageFilters, searchTagFilters],
  );
  const allKnownTags = useMemo(() => {
    const values: string[] = [];
    for (const page of allVisiblePages)
      values.push(...normalizePageProperties(page.properties).tags);
    for (const journal of journals) values.push(...(journal.tags || []));
    for (const item of inboxItems) values.push(...(item.tags || []));
    for (const db of databases) {
      for (const prop of db.properties) {
        if (prop.type === "select" || prop.type === "multi_select")
          values.push(...(prop.options || []));
      }
      for (const row of db.rows) {
        for (const prop of db.properties) {
          if (prop.type !== "multi_select") continue;
          const cell = row.cells[prop.id];
          if (Array.isArray(cell)) values.push(...cell.map(String));
        }
      }
    }
    return uniqTags(values).sort((a, b) => a.localeCompare(b, "ja"));
  }, [allVisiblePages, journals, inboxItems, databases]);
  const commentBlockTargets = useMemo(
    () => extractCommentBlockTargets(blockNoteBlocks, markdownPreview),
    [blockNoteBlocks, markdownPreview],
  );
  const uniqueTags = allKnownTags;
  const uniqueAssignees = useMemo(
    () =>
      Array.from(
        new Set(
          allVisiblePages
            .map((page) => normalizePageProperties(page.properties).assignee)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "ja")),
    [allVisiblePages],
  );
  const pageFilterResultCount =
    viewMode === "search"
      ? filteredSearchResults.length
      : flattenTree(filteredTree).length;
  const journalDateSet = useMemo(
    () => new Set(journals.map((j) => j.date)),
    [journals],
  );
  const journalWeekDays = useMemo(
    () => getJournalWeekDays(journalDate),
    [journalDate],
  );
  const journalWeekRange = useMemo(
    () => compactJournalWeekRange(journalWeekDays),
    [journalWeekDays],
  );
  const journalRelatedPages = useMemo(() => {
    if (!currentJournal) return [];
    return allVisiblePages
      .filter(
        (page) =>
          dateKeyJst(page.createdAt) === currentJournal.date ||
          dateKeyJst(page.updatedAt) === currentJournal.date,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);
  }, [allVisiblePages, currentJournal?.date]);
  const journalActivityItems = useMemo(() => {
    if (!currentJournal) return [];
    return allVisiblePages
      .filter(
        (page) =>
          dateKeyJst(page.createdAt) === currentJournal.date ||
          dateKeyJst(page.updatedAt) === currentJournal.date,
      )
      .map((page) => ({
        page,
        kind:
          dateKeyJst(page.createdAt) === currentJournal.date ? "作成" : "更新",
        time: page.updatedAt || page.createdAt,
      }))
      .sort((a, b) => b.time.localeCompare(a.time))
      .slice(0, 12);
  }, [allVisiblePages, currentJournal?.date]);
  useEffect(() => {
    const query = journalSearch.trim();
    if (!query) {
      setJournalSearchResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        ?.searchJournals(query, 30)
        .then(setJournalSearchResults)
        .catch(() => setJournalSearchResults(null));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [api, journalSearch]);

  const filteredJournals = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    if (!q) return journals.slice(0, 10);
    if (journalSearchResults) return journalSearchResults.slice(0, 30);
    return journals
      .filter((j) =>
        [
          j.date,
          j.title,
          j.previewSnippet,
          j.mood,
          j.weather,
          ...(j.tags || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [journals, journalSearch, journalSearchResults]);
  const journalReviewRange = useMemo(() => {
    if (journalReviewMode === "week")
      return {
        label: "週次レビュー",
        start: journalWeekDays[0],
        end: journalWeekDays[journalWeekDays.length - 1],
      };
    const month = getMonthKey(journalDate);
    const endDate = new Date(`${month}-01T00:00:00+09:00`);
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    const end = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
    }).format(endDate);
    return { label: "月次レビュー", start: `${month}-01`, end };
  }, [journalReviewMode, journalDate, journalWeekDays]);
  const journalReview = useMemo(
    () =>
      makeJournalReview(
        journals,
        allVisiblePages,
        journalReviewRange.start,
        journalReviewRange.end,
      ),
    [
      journals,
      allVisiblePages,
      journalReviewRange.start,
      journalReviewRange.end,
    ],
  );

  async function replaceWorkspaceTag(
    from: string,
    to: string,
    mode: "rename" | "merge",
  ) {
    if (!api) return;
    const requestedTarget = to.replace(/^#+/, "").trim();
    const existingTarget = allVisiblePages
      .flatMap((page) => page.properties?.tags ?? [])
      .map((tag) => tag.replace(/^#+/, "").trim())
      .find(
        (tag) =>
          normalizeTagKeyForUi(tag) === normalizeTagKeyForUi(requestedTarget),
      );
    const target = mode === "merge" ? (existingTarget ?? "") : requestedTarget;
    if (!target || normalizeTagKeyForUi(from) === normalizeTagKeyForUi(target))
      return;
    const affected = allVisiblePages.filter((page) =>
      (page.properties?.tags ?? []).some(
        (tag) => normalizeTagKeyForUi(tag) === normalizeTagKeyForUi(from),
      ),
    );
    if (affected.length === 0) {
      setStatus(`タグ #${from} を使っているページはありません。`);
      return;
    }
    const action = mode === "merge" ? "統合" : "名前を変更";
    if (
      !window.confirm(
        `#${from} を #${target} へ${action}します。\n${affected.length}ページのタグだけを更新します。本文・履歴は変更しません。`,
      )
    )
      return;
    setStatus(`タグを${action}しています…`);
    let updated = 0;
    const failed: string[] = [];
    for (const meta of affected) {
      try {
        const page = await api.getPage(meta.id);
        const nextProperties = {
          ...page.meta.properties,
          tags: replaceTagInList(page.meta.properties.tags ?? [], from, target),
        };
        const saved = await api.savePage({
          id: page.meta.id,
          title: page.meta.title,
          markdown: page.markdown,
          blocksuite: page.blocksuite,
          baseUpdatedAt: page.meta.updatedAt,
          properties: nextProperties,
          icon: page.meta.icon ?? null,
          scope: page.meta.scope,
        });
        updated += 1;
        if (current?.meta.id === saved.meta.id) {
          setCurrent(saved);
          setPageProperties(saved.meta.properties);
        }
      } catch (error: any) {
        failed.push(meta.title || meta.id);
      }
    }
    if (updated > 0) {
      await persistWorkspaceTagAliases(
        moveTagAliases(tagAliases, from, target, {
          preserveSourceAsAlias: true,
        }),
      );
    }
    await reload();
    const failedDetail =
      failed.length > 0
        ? ` 更新できなかったページ: ${failed.slice(0, 5).join("、")}${failed.length > 5 ? " ほか" : ""}`
        : "";
    setStatus(
      failed.length
        ? `${updated}ページのタグを${action}しました。${failed.length}ページは更新できませんでした。${failedDetail}`
        : `${updated}ページのタグを #${target} へ${action}しました。`,
    );
  }

  return (
    <>
      {!initialWorkspaceReady && (
        <div
          className={`workspace-startup-gate${startupFailure ? " is-error" : ""}${startupGateExpanded ? " is-delayed" : ""}`}
          role="status"
          aria-live="polite"
        >
          <div className="workspace-startup-gate-skeleton" aria-hidden="true">
            <aside>
              <span>✦</span>
              <i />
              <i />
              <i />
              <i />
              <i />
            </aside>
            <main>
              <header>
                <b />
                <i />
                <i />
                <i />
              </header>
              <section>
                <em />
                <strong />
                <i />
                <i />
                <i />
                <i />
              </section>
            </main>
          </div>
          <div className="workspace-startup-gate-card">
            <div className="workspace-startup-gate-mark" aria-hidden="true">
              ✦
            </div>
            <div className="workspace-startup-gate-copy">
              <div className="workspace-startup-gate-eyebrow">
                LOCAL NOTION LITE
              </div>
              <h1>
                {startupFailure
                  ? "起動を完了できませんでした"
                  : startupProgress.title || "ワークスペースを準備しています"}
              </h1>
              <p>{startupFailure || startupProgress.message}</p>
              {!startupFailure && (
                <div
                  className="workspace-startup-gate-meter"
                  aria-hidden="true"
                >
                  <span />
                </div>
              )}
              <small>
                {startupFailure
                  ? "共有フォルダ、ネットワーク接続、SQLite保存先を確認してからアプリを再起動してください。"
                  : startupProgress.detail ||
                    "共有フォルダの同期は、操作を開始した後にバックグラウンドで続けます。"}
              </small>
            </div>
          </div>
        </div>
      )}
      <div
        className={
          (sidebarOpen ? "app-shell" : "app-shell sidebar-collapsed") +
          (linkPreviewPage ? " has-link-preview" : "") +
          ` density-${appSettings.density} theme-${appSettings.theme}`
        }
        style={{ ["--peek-width" as any]: `${linkPreviewWidth}px` }}
      >
        <CommandPalette
          open={commandOpen}
          query={commandQuery}
          api={api}
          pages={allVisiblePages}
          databases={databases}
          journals={journals}
          inboxItems={inboxItems}
          tasks={tasks}
          attachments={allAttachments}
          settings={appSettings}
          onQuery={setCommandQuery}
          onClose={() => {
            setCommandOpen(false);
            setCommandQuery("");
          }}
          onOpenPage={openPage}
          onOpenDatabase={openDatabase}
          onOpenJournal={openJournal}
          onOpenInbox={openInbox}
          onOpenOcrCenter={openOcrCenter}
          onOpenTasks={openTasks}
          onOpenAttachments={openAttachmentsManager}
          onOpenLinks={openLinksManager}
          onOpenKnowledgeMap={() => void openKnowledgeMap()}
          onOpenFreeformCanvas={openFreeformCanvas}
          onOpenAdmin={openWorkspaceAdmin}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenWorkspaceAiSearch={(initialQuery) => {
            setWorkspaceAiDrawerMode("search");
            setWorkspaceAiInitialQuery(initialQuery || "");
            setWorkspaceAiSearchOpen(true);
          }}
          onOpenExplorer={() => setMainMode("explorer")}
          onOpenWebProject={(projectId) => {
            setActiveWebProjectId(projectId);
            void openWebBuilder();
          }}
          onQuickCapture={() => setQuickCaptureOpen(true)}
          onCreatePage={() => createPage(null)}
          onCreateDatabase={() => createDatabase("shared")}
          onSync={() => fullMaintenanceRefresh()}
          onTrash={showTrash}
        />
        <FloatingWorkspaceActions
          currentPage={
            current?.meta?.id
              ? {
                  id: current.meta.id,
                  title: current.meta.title || "無題のページ",
                  icon: current.meta.icon || "📄",
                }
              : null
          }
          aiBusy={workspaceAiGeneration.busy}
          onChooseCurrentPageShelf={(page) =>
            setCurrentPageShelfPickerItem({
              key: `page:${page.id}`,
              kind: "page",
              id: page.id,
              title: page.title || "無題のページ",
              icon: page.icon || "📄",
            })
          }
          onOpenAi={() => {
            setWorkspaceAiDrawerMode("chat");
            setWorkspaceAiInitialQuery("");
            setWorkspaceAiSearchOpen(true);
          }}
        />
        <CollectionShelfPickerDialog
          open={Boolean(currentPageShelfPickerItem)}
          item={currentPageShelfPickerItem}
          onClose={() => setCurrentPageShelfPickerItem(null)}
        />
        <PageContextMenu
          state={contextMenu}
          templates={PAGE_TEMPLATES}
          onClose={closePageContextMenu}
          onOpen={openPage}
          onCreateChild={createPage}
          onCreateFromTemplate={(templateKey, parentId) => {
            const template = PAGE_TEMPLATES.find(
              (candidate) => candidate.key === templateKey,
            );
            if (template) createPageFromTemplate(template, parentId);
          }}
          onDuplicate={duplicatePageById}
          onFavorite={toggleFavorite}
          onMoveRoot={(id) => movePageToParent(id, null)}
          onTrash={trashPageById}
          onAddToShelf={(id, shelfId) => {
            const page = allVisiblePages.find(
              (candidate) => candidate.id === id,
            );
            if (!page) return;
            const item = {
              key: `page:${page.id}`,
              kind: "page" as const,
              id: page.id,
              title: page.title || "無題のページ",
              icon: page.icon || "📄",
            };
            if (shelfId) addCollectionItemToShelf(shelfId, item);
            else addCollectionItemToDefaultShelf(item);
          }}
        />
        <QuickCaptureModal
          open={quickCaptureOpen}
          value={quickCaptureText}
          onChange={setQuickCaptureText}
          onClose={() => setQuickCaptureOpen(false)}
          onSubmit={quickCapture}
        />
        <SettingsModal
          open={settingsOpen}
          settings={appSettings}
          sharedRoot={sharedRoot}
          privatePagesRoot={privatePagesRoot}
          privateDatabasesRoot={privateDatabasesRoot}
          ocrBinaryPath={ocrBinaryPath}
          popplerBinaryPath={popplerBinaryPath}
          health={health}
          onChange={setAppSettings}
          onClose={() => setSettingsOpen(false)}
          onChooseSharedRoot={chooseSharedRoot}
          onChooseLocalDbPath={chooseLocalDbPath}
          onUseAutoLocalDbPath={useAutoLocalDbPath}
          onChoosePrivatePagesRoot={choosePrivatePagesRoot}
          onChoosePrivateDatabasesRoot={choosePrivateDatabasesRoot}
          onResetPrivatePagesRoot={resetPrivatePagesRoot}
          onResetPrivateDatabasesRoot={resetPrivateDatabasesRoot}
          onChooseOcrBinary={chooseOcrBinary}
          onResetOcrBinary={resetOcrBinary}
          onChoosePopplerFolder={choosePopplerFolder}
          onChoosePopplerBinary={choosePopplerBinary}
          onResetPopplerBinary={resetPopplerBinary}
          onSync={() => fullMaintenanceRefresh()}
        />
        <HistoryInspectorModal
          historyPreview={historyPreview}
          historyDiff={historyDiff}
          onClose={closeHistoryInspect}
        />
        {sidebarOpen ? (
          <aside className="sidebar">
            <div className="brand-row">
              <div className="brand">Local Notion Lite</div>
              <div className="brand-actions">
                <button
                  className="sidebar-toggle"
                  onClick={() => setSidebarOpen(false)}
                  title="サイドバーを隠す"
                >
                  ☰
                </button>
                <button
                  className="command-button icon-only-control"
                  onClick={() => setCommandOpen(true)}
                  title="コマンド / 検索"
                  aria-label="コマンド / 検索"
                >
                  ⌘
                </button>
              </div>
            </div>
            <div className="sidebar-scroll-body">
              <div className="workspace-card">
                <div className="workspace-card-top">
                  <span className="workspace-dot"></span>
                  <div>
                    <div className="workspace-label">Workspace</div>
                    <div className="workspace-path" title={sharedRoot}>
                      {sharedRoot || "共有フォルダ未設定"}
                    </div>
                  </div>
                </div>
                <button
                  className="workspace-change icon-only-control"
                  onClick={chooseSharedRoot}
                  title="共有フォルダを変更"
                  aria-label="共有フォルダを変更"
                >
                  ⚙
                </button>
              </div>

              <div
                className={`workspace-sync-card-v636 ${workspaceSyncState}`}
                role="status"
                aria-live="polite"
              >
                <span className="workspace-sync-icon-v636">
                  {workspaceSyncState === "syncing"
                    ? "↻"
                    : workspaceSyncState === "error"
                      ? "!"
                      : "✓"}
                </span>
                <div>
                  <b>
                    {Object.keys(saveRecovery).length > 0
                      ? `未保存 ${Object.keys(saveRecovery).length}件`
                      : saveActivity.page ||
                          saveActivity.journal ||
                          saveActivity.database
                        ? "保存中…"
                        : workspaceSyncState === "syncing"
                          ? "同期中…"
                          : workspaceSyncState === "error"
                            ? "同期を確認"
                            : "保存・同期済み"}
                  </b>
                  <small>
                    {Object.keys(saveRecovery).length > 0
                      ? "再試行して保存できます"
                      : workspaceSyncDetail}
                  </small>
                </div>
                {Object.keys(saveRecovery).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => void retryPendingSavesNow()}
                    title="未保存データを再試行"
                  >
                    再試行
                  </button>
                ) : workspaceSyncState === "error" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void fullMaintenanceRefresh(
                        "共有フォルダを再同期しています",
                      )
                    }
                    title="共有フォルダを再同期"
                  >
                    再同期
                  </button>
                ) : null}
              </div>

              <div className="sidebar-command-card">
                <div className="scope-create-actions">
                  <button
                    className="sidebar-primary-action"
                    onClick={() => createPage(null, "shared")}
                    disabled={!api}
                  >
                    <span className="action-icon">🌐</span>
                    <span>
                      <strong>Sharedページ</strong>
                      <small>共有フォルダに保存</small>
                    </span>
                  </button>
                  <button
                    className="sidebar-primary-action private-action"
                    onClick={() => createPage(null, "private")}
                    disabled={!api}
                  >
                    <span className="action-icon">🔒</span>
                    <span>
                      <strong>Privateページ</strong>
                      <small>このPCだけに保存</small>
                    </span>
                  </button>
                </div>
                <div className="sidebar-action-grid compact-icon-grid">
                  <button
                    onClick={openHome}
                    disabled={!api}
                    title="ホーム"
                    aria-label="ホーム"
                  >
                    <span>🏠</span>
                  </button>
                  <button
                    onClick={() => setMainMode("explorer")}
                    disabled={!api}
                    title="Workspace Explorer"
                    aria-label="Workspace Explorer"
                  >
                    <span>⌕</span>
                  </button>
                  <button
                    onClick={() => setQuickCaptureOpen(true)}
                    disabled={!api}
                    title="クイックキャプチャ"
                    aria-label="クイックキャプチャ"
                  >
                    <span>⚡</span>
                  </button>
                  <button
                    onClick={openInbox}
                    disabled={!api}
                    title="Inbox"
                    aria-label="Inbox"
                    className="trash-icon-action"
                  >
                    <span>📥</span>
                    {inboxItems.length > 0 && <em>{inboxItems.length}</em>}
                  </button>
                  <button
                    onClick={openOcrCenter}
                    disabled={!api}
                    title="OCRセンター"
                    aria-label="OCRセンター"
                    className="trash-icon-action"
                  >
                    <span>⌁</span>
                    {inboxItems.some((item) =>
                      (item.attachments || []).some((file) =>
                        ["queued", "running", "cancelling"].includes(
                          String(file.ocrQueue?.status || ""),
                        ),
                      ),
                    ) && <em>•</em>}
                  </button>
                  <button
                    onClick={openTasks}
                    disabled={!api}
                    title="Tasks"
                    aria-label="Tasks"
                    className="trash-icon-action"
                  >
                    <span>☑️</span>
                    {tasks.filter((t) => !t.completed).length > 0 && (
                      <em>{tasks.filter((t) => !t.completed).length}</em>
                    )}
                  </button>
                  <button
                    onClick={openSmartAssist}
                    disabled={!api}
                    title="Local Smart Assist"
                    aria-label="Local Smart Assist"
                  >
                    <span>🧠</span>
                  </button>
                  <button
                    onClick={openAnalysisNotebook}
                    disabled={!api}
                    title="分析ノートブック"
                    aria-label="分析ノートブック"
                  >
                    <span>📊</span>
                  </button>
                  <button
                    onClick={openNotificationsCenter}
                    disabled={!api}
                    title="通知"
                    aria-label="通知"
                    className="trash-icon-action"
                  >
                    <span>🔔</span>
                    {(dashboard?.counts?.inbox || 0) +
                      conflicts.length +
                      brokenLinks.length >
                      0 && (
                      <em>
                        {Math.min(
                          99,
                          (dashboard?.counts?.inbox || 0) +
                            conflicts.length +
                            brokenLinks.length,
                        )}
                      </em>
                    )}
                  </button>
                  <button
                    onClick={() => createDatabase("shared")}
                    disabled={!api}
                    title="Sharedデータベースを作成"
                    aria-label="Sharedデータベースを作成"
                  >
                    <span>🗃️</span>
                  </button>
                  <button
                    onClick={openAttachmentsManager}
                    disabled={!api}
                    title="添付ファイル"
                    aria-label="添付ファイル"
                  >
                    <span>📎</span>
                  </button>
                  <button
                    onClick={openLinksManager}
                    disabled={!api}
                    title="リンク管理"
                    aria-label="リンク管理"
                  >
                    <span>🔗</span>
                  </button>
                  <button
                    onClick={() => void openKnowledgeMap()}
                    disabled={!api || !current}
                    title={
                      current
                        ? "現在のページの関係図"
                        : "ページを開くと関係図を表示できます"
                    }
                    aria-label="ページ関係図"
                    className="knowledge-map-sidebar-action-v638"
                  >
                    <span>✦</span>
                  </button>
                  <button
                    onClick={openExternalSources}
                    disabled={!api}
                    title="External Sources"
                    aria-label="External Sources"
                    className="external-sources-sidebar-action"
                  >
                    <span>☁</span>
                  </button>
                  <button
                    onClick={openWebBuilder}
                    disabled={!api}
                    title="Web Builder"
                    aria-label="Web Builder"
                    className="web-builder-sidebar-action"
                  >
                    <span>&lt;/&gt;</span>
                  </button>
                  <button
                    onClick={openFreeformCanvas}
                    disabled={!api}
                    title="ホワイトボード"
                    aria-label="ホワイトボード"
                    className="freeform-sidebar-action"
                  >
                    <span>▧</span>
                  </button>
                  <button
                    onClick={openTagManager}
                    disabled={!api}
                    title="タグ管理"
                    aria-label="タグ管理"
                  >
                    <span>🏷️</span>
                  </button>
                  <button
                    onClick={() => void openGlossaryManager()}
                    disabled={!api}
                    title="用語辞書"
                    aria-label="用語辞書"
                  >
                    <span>📖</span>
                  </button>
                  <button
                    onClick={openWikiManager}
                    disabled={!api}
                    title="Wiki管理"
                    aria-label="Wiki管理"
                    className="wiki-sidebar-action-v469"
                  >
                    <span>📚</span>
                  </button>
                  <button
                    onClick={openProjectHub}
                    disabled={!api}
                    title="案件・プロジェクト"
                    aria-label="案件・プロジェクト"
                    className="project-sidebar-action-v472"
                  >
                    <span>◈</span>
                  </button>
                  <button
                    onClick={openWorkspaceAdmin}
                    disabled={!api}
                    title="共有管理"
                    aria-label="共有管理"
                  >
                    <span>⚙️</span>
                  </button>
                  <button
                    onClick={() => setSettingsOpen(true)}
                    title="設定"
                    aria-label="設定"
                  >
                    <span>⚙</span>
                  </button>
                  <button
                    onClick={() => fullMaintenanceRefresh()}
                    disabled={!api}
                    title="同期"
                    aria-label="同期"
                  >
                    <span>↻</span>
                  </button>
                  <button
                    onClick={() => setCommandOpen(true)}
                    title="検索 / コマンド"
                    aria-label="検索 / コマンド"
                  >
                    <span>⌘</span>
                  </button>
                  <button
                    onClick={showTrash}
                    title="ゴミ箱"
                    aria-label="ゴミ箱"
                    className="trash-icon-action"
                  >
                    <span>🗑️</span>
                    {trashedPages.length + trashedDatabases.length > 0 && (
                      <em>{trashedPages.length + trashedDatabases.length}</em>
                    )}
                  </button>
                </div>
              </div>

              <section className="sidebar-journal-card affine-sidebar-journal">
                <button
                  className="affine-journal-entry"
                  onClick={() => openJournal(todayJst)}
                  title="Journalを開く"
                >
                  <span className="affine-journal-entry-icon">📅</span>
                  <span>
                    <strong>Journal</strong>
                    <small>Daily notes</small>
                  </span>
                </button>
                <div className="affine-mini-week">
                  {getJournalWeekDays(todayJst).map((day) => (
                    <button
                      key={day}
                      className={day === todayJst ? "today" : ""}
                      onClick={() => openJournal(day)}
                      title={formatJournalDisplayDate(day)}
                    >
                      <span>{journalWeekdayLabel(day)}</span>
                      <b>{journalDayNumber(day)}</b>
                      {journalDateSet.has(day) && <i />}
                    </button>
                  ))}
                </div>
              </section>

              {inboxItems.length > 0 && (
                <section className="sidebar-inbox-card">
                  <button
                    className="affine-journal-entry"
                    onClick={openInbox}
                    title="Inboxを開く"
                  >
                    <span className="affine-journal-entry-icon">📥</span>
                    <span>
                      <strong>Inbox</strong>
                      <small>{inboxItems.length} items</small>
                    </span>
                  </button>
                  <div className="journal-sidebar-list">
                    {inboxItems.slice(0, 3).map((item) => (
                      <button
                        key={item.id}
                        className="journal-sidebar-row"
                        onClick={openInbox}
                        title={item.title}
                      >
                        <b>{item.title}</b>
                        <small>
                          {item.text.replace(/\s+/g, " ").slice(0, 44)}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <div className="sidebar-search-card">
                <span>⌕</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") search();
                  }}
                  placeholder="ページを検索"
                />
                <button onClick={search}>検索</button>
              </div>
              <section
                className="sidebar-tag-search"
                aria-label="タグで絞り込み"
              >
                <div className="sidebar-tag-search-head">
                  <span>タグで絞り込み</span>
                  {searchTagFilters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSearchTagFilters([])}
                    >
                      クリア
                    </button>
                  )}
                </div>
                <div className="sidebar-tag-search-chips">
                  {uniqueTags.slice(0, 18).map((tag) => {
                    const active = searchTagFilters.some(
                      (value) =>
                        normalizeTagFilterKey(value) ===
                        normalizeTagFilterKey(tag),
                    );
                    const color =
                      tagPresentationFor(tagPresentation, tag).color ?? "slate";
                    return (
                      <button
                        type="button"
                        key={tag}
                        className={`tag-presentation tag-color-${color}${active ? " active" : ""}`}
                        onClick={() => {
                          toggleSearchTagFilter(tag);
                          setViewMode("search");
                          setSearchResults(allVisiblePages);
                        }}
                        title={`#${tag}で絞り込み`}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
                {uniqueTags.length > 18 && (
                  <button
                    type="button"
                    className="sidebar-tag-search-more"
                    onClick={openTagManager}
                  >
                    タグ管理で全件を見る
                  </button>
                )}
                {searchTagFilters.length > 1 && (
                  <small>選択したタグをすべて含むページを表示します</small>
                )}
              </section>

              <div className="sidebar-disclosure template-disclosure">
                <button
                  className="sidebar-disclosure-button"
                  onClick={() => setTemplatePanelOpen((value) => !value)}
                >
                  <span>{templatePanelOpen ? "▾" : "▸"} テンプレート</span>
                  <small>会議 / FAQ / マニュアル</small>
                </button>
                {templatePanelOpen && (
                  <TemplatePicker
                    onSelect={(template) =>
                      createPageFromTemplate(template, null)
                    }
                  />
                )}
              </div>
              <div className="sidebar-disclosure">
                <button
                  className={
                    JSON.stringify(pageFilters) !==
                    JSON.stringify(DEFAULT_PAGE_FILTERS)
                      ? "sidebar-disclosure-button active"
                      : "sidebar-disclosure-button"
                  }
                  onClick={() => setPageFiltersOpen((value) => !value)}
                >
                  <span>{pageFiltersOpen ? "▾" : "▸"} フィルター</span>
                  <small>
                    {pageFilterResultCount} / {allVisiblePages.length}
                  </small>
                </button>
                {pageFiltersOpen && (
                  <PageFilterPanel
                    filters={pageFilters}
                    onChange={setPageFilters}
                    tags={uniqueTags}
                    assignees={uniqueAssignees}
                    resultCount={pageFilterResultCount}
                    totalCount={allVisiblePages.length}
                  />
                )}
              </div>
              {viewMode === "search" ? (
                <div className="page-list">
                  <div className="section-title">検索結果</div>
                  {filteredSearchResults.map((p) => (
                    <button
                      key={p.id}
                      className={current?.meta.id === p.id ? "selected" : ""}
                      onClick={() => openPage(p.id)}
                      title={p.title}
                    >
                      <span className="sidebar-title-text">
                        {p.icon ?? "📄"} {p.title} {p.isLocked ? "🔒" : ""}
                      </span>
                    </button>
                  ))}
                  <button
                    className="secondary"
                    onClick={() => setViewMode("tree")}
                  >
                    ツリーに戻る
                  </button>
                </div>
              ) : viewMode === "trash" ? (
                <div className="page-list trash-list trash-list-v165">
                  <div className="trash-sidebar-head-v165">
                    <span>🗑️</span>
                    <div>
                      <strong>ゴミ箱</strong>
                      <small>
                        {trashedPages.length + trashedDatabases.length} deleted
                        items
                      </small>
                    </div>
                  </div>
                  {trashedPages.length + trashedDatabases.length === 0 ? (
                    <div className="trash-sidebar-empty-v165">
                      ✨ ゴミ箱は空です
                    </div>
                  ) : (
                    trashedPages.slice(0, 12).map((p) => (
                      <div key={p.id} className="trash-item trash-item-v165">
                        <button
                          className="trash-title trash-title-v165"
                          onClick={() => openPage(p.id)}
                          title={p.title}
                        >
                          <span>{p.icon ?? "📄"}</span>
                          <b>{p.title}</b>
                          <small>
                            {p.scope === "private" ? "🔒 Private" : "🌐 Shared"}{" "}
                            ・ {formatTrashDate(p.updatedAt)}
                          </small>
                        </button>
                        <div className="trash-actions trash-actions-v165">
                          <button onClick={() => restoreTrashedPage(p.id)}>
                            復元
                          </button>
                          <button
                            className="danger"
                            onClick={() => deleteTrashedPage(p.id)}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {trashedDatabases
                    .slice(
                      0,
                      Math.max(0, 12 - Math.min(12, trashedPages.length)),
                    )
                    .map((db) => (
                      <div key={db.id} className="trash-item trash-item-v165">
                        <button
                          className="trash-title trash-title-v165"
                          onClick={() => setMainMode("trash")}
                          title={db.title}
                        >
                          <span>🗃️</span>
                          <b>{db.title}</b>
                          <small>
                            {db.scope === "private"
                              ? "🔒 Private DB"
                              : "🌐 Shared DB"}{" "}
                            ・{" "}
                            {formatTrashDate(
                              (db as any).deletedAt ?? db.updatedAt,
                            )}
                          </small>
                        </button>
                        <div className="trash-actions trash-actions-v165">
                          <button onClick={() => restoreTrashedDatabase(db.id)}>
                            復元
                          </button>
                          <button
                            className="danger"
                            onClick={() => deleteTrashedDatabase(db.id)}
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))}
                  {trashedPages.length + trashedDatabases.length > 12 && (
                    <button
                      className="secondary"
                      onClick={() => setMainMode("trash")}
                    >
                      すべて表示
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={() => {
                      setViewMode("tree");
                      setMainMode(current ? "page" : "home");
                    }}
                  >
                    ツリーへ戻る
                  </button>
                  <button
                    className="danger"
                    onClick={emptyTrash}
                    disabled={
                      trashedPages.length + trashedDatabases.length === 0
                    }
                  >
                    空にする
                  </button>
                </div>
              ) : (
                <div className="page-list">
                  {favoritePages.length > 0 && (
                    <div className="favorites-section">
                      <div className="section-title">お気に入り</div>
                      {favoritePages.map((page) => (
                        <button
                          key={page.id}
                          className={
                            (workspaceActiveItem?.kind === "page"
                              ? workspaceActiveItem.id
                              : workspaceActiveItem?.kind === "database"
                                ? null
                                : current?.meta.id) === page.id
                              ? "selected favorite-page-button"
                              : "favorite-page-button"
                          }
                          onClick={() => openPage(page.id)}
                          title={page.title}
                        >
                          <span className="sidebar-title-text">
                            ★ {page.icon ?? "📄"} {page.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    className="root-drop-zone"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedPageId) movePageToParent(draggedPageId, null);
                      setDraggedPageId(null);
                    }}
                  >
                    ここにドロップしてルートへ移動
                  </div>
                  <div className="section-title">ページツリー</div>
                  <VirtualPageTree
                    nodes={filteredTree}
                    currentId={
                      workspaceActiveItem?.kind === "page"
                        ? workspaceActiveItem.id
                        : workspaceActiveItem?.kind === "database"
                          ? undefined
                          : current?.meta.id
                    }
                    collapsedIds={collapsedIds}
                    onToggleCollapse={toggleSidebarCollapse}
                    onOpen={openPage}
                    onCreateChild={createPage}
                    onCreateFromTemplate={createPageFromTemplate}
                    onMovePage={movePageToParent}
                    onToggleFavorite={toggleFavorite}
                    onDuplicatePage={duplicatePageById}
                    onTrashPage={trashPageById}
                    onReorderPage={reorderPage}
                    onContextMenu={openPageContextMenu}
                    draggedPageId={draggedPageId}
                    onDragStart={setDraggedPageId}
                    onDragEnd={() => setDraggedPageId(null)}
                  />
                </div>
              )}

              <div className="database-sidebar-shell-v264">
                <div className="database-list-head-v61 database-list-head-actions-v264">
                  <div>
                    <span className="section-kicker-v61">Workspace</span>
                    <strong>データベース</strong>
                  </div>
                  <div className="db-sidebar-scope-actions-v163">
                    <button
                      className="db-sidebar-new-v61"
                      onClick={() => createDatabase("shared")}
                      title="Sharedデータベース"
                    >
                      🌐＋
                    </button>
                    <button
                      className="db-sidebar-new-v61"
                      onClick={() => createDatabase("private")}
                      title="Privateデータベース"
                    >
                      🔒＋
                    </button>
                  </div>
                </div>
                <DatabaseSidebarTree
                  api={api}
                  databases={databases}
                  currentDatabaseId={
                    workspaceActiveItem?.kind === "database"
                      ? workspaceActiveItem.id
                      : (currentDb?.id ?? null)
                  }
                  currentDatabaseRowId={
                    workspaceActiveItem?.kind === "database"
                      ? (workspaceActiveItem.rowId ?? null)
                      : null
                  }
                  activePageId={
                    workspaceActiveItem
                      ? workspaceActiveItem.kind === "page"
                        ? workspaceActiveItem.id
                        : null
                      : (current?.meta.id ?? null)
                  }
                  activePageParentId={
                    workspaceActiveItem?.kind === "page"
                      ? (workspaceActiveItem.parentId ??
                        (current?.meta.id === workspaceActiveItem.id
                          ? (current.meta.parentId ?? null)
                          : null))
                      : null
                  }
                  refreshKey={databaseSidebarRefreshKey}
                  onOpenDatabase={openDatabase}
                  onOpenDatabaseInWorkspace={openDatabaseInWorkspace}
                  onOpenDatabaseRow={openDatabaseRow}
                  onOpenDatabaseRowInWorkspace={openDatabaseRowInWorkspace}
                  onOpenPage={openPage}
                  onDeleteDatabase={deleteDatabaseById}
                  scopeIcon={scopeIcon}
                  scopeLabel={scopeLabel}
                  scopeNotice={scopeNotice}
                  workspaceScope={workspaceScope}
                />
              </div>
            </div>
            <div className="local-info">
              <div>API: {apiUrl ? "起動中" : "未起動"}</div>
              <div
                title={
                  health?.sqlite?.path ??
                  health?.localDbPath ??
                  "SQLite情報を取得中"
                }
              >
                SQLite:{" "}
                {health?.sqlite?.available || health?.localDbPath
                  ? "利用中"
                  : "確認中"}
              </div>
              {(health?.sqlite?.fileName || health?.localDbPath) && (
                <div
                  className="sqlite-path"
                  title={health?.sqlite?.path ?? health?.localDbPath}
                >
                  {health?.sqlite?.fileName ?? "local.sqlite"}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <button
            className="sidebar-restore"
            onClick={() => setSidebarOpen(true)}
            title="サイドバーを表示"
          >
            ☰
          </button>
        )}

        {journalAttachmentPreview &&
          currentJournal &&
          createPortal(
            <div
              className="journal-attachment-preview-backdrop-v567"
              role="dialog"
              aria-modal="true"
              aria-label={`${journalAttachmentPreview.fileName} のプレビュー`}
              onMouseDown={() => setJournalAttachmentPreview(null)}
            >
              <section
                className="journal-attachment-preview-modal-v567"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>
                      {isJournalImageAttachment(
                        journalAttachmentPreview.fileName,
                      )
                        ? "IMAGE PREVIEW"
                        : "PDF PREVIEW"}
                    </span>
                    <h2>{journalAttachmentPreview.fileName}</h2>
                    <p>
                      {formatJournalAttachmentSize(
                        journalAttachmentPreview.size,
                      )}{" "}
                      ・{" "}
                      {new Date(
                        journalAttachmentPreview.createdAt,
                      ).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <div className="journal-attachment-preview-actions-v567">
                    <a
                      href={
                        api?.journalAttachmentDownloadUrl(
                          currentJournal.date,
                          journalAttachmentPreview.id,
                        ) || "#"
                      }
                      title="ダウンロード"
                    >
                      ダウンロード
                    </a>
                    <a
                      href={
                        api?.journalAttachmentFileUrl(
                          currentJournal.date,
                          journalAttachmentPreview.id,
                        ) || "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                      title="別ウィンドウで開く"
                    >
                      別ウィンドウ
                    </a>
                    <button
                      type="button"
                      onClick={() => setJournalAttachmentPreview(null)}
                      aria-label="閉じる"
                      title="閉じる"
                    >
                      ×
                    </button>
                  </div>
                </header>
                <div className="journal-attachment-preview-body-v567">
                  {isJournalImageAttachment(
                    journalAttachmentPreview.fileName,
                  ) ? (
                    <img
                      src={
                        api?.journalAttachmentFileUrl(
                          currentJournal.date,
                          journalAttachmentPreview.id,
                        ) || ""
                      }
                      alt={journalAttachmentPreview.fileName}
                    />
                  ) : (
                    <iframe
                      src={
                        api?.journalAttachmentFileUrl(
                          currentJournal.date,
                          journalAttachmentPreview.id,
                        ) || ""
                      }
                      title={journalAttachmentPreview.fileName}
                    />
                  )}
                </div>
              </section>
            </div>,
            document.body,
          )}

        {journalConflict &&
          createPortal(
            <div
              className="journal-conflict-backdrop-v565"
              role="dialog"
              aria-modal="true"
              aria-label="Journalの競合を解決"
            >
              <section className="journal-conflict-modal-v565">
                <header>
                  <div>
                    <span>共有フォルダの更新を検出</span>
                    <h2>
                      {journalConflict.local.date} のJournalをどう保存しますか？
                    </h2>
                    <p>
                      別の端末またはウィンドウで同じJournalが更新されています。未保存内容は安全バックアップへ退避したうえで、保存方法を選べます。
                    </p>
                  </div>
                  <button
                    onClick={() => setJournalConflict(null)}
                    aria-label="閉じる"
                    title="後で確認する"
                  >
                    ×
                  </button>
                </header>
                <div className="journal-conflict-columns-v565">
                  <article>
                    <div className="journal-conflict-column-head-v565 local">
                      <b>この端末の未保存内容</b>
                      <small>{journalConflict.local.updatedAt}</small>
                    </div>
                    <div className="journal-conflict-meta-v565">
                      {journalConflict.localMeta.mood && (
                        <span>🙂 {journalConflict.localMeta.mood}</span>
                      )}
                      {journalConflict.localMeta.weather && (
                        <span>☀ {journalConflict.localMeta.weather}</span>
                      )}
                    </div>
                    <pre>
                      {journalConflict.local.markdown || "（本文は空です）"}
                    </pre>
                  </article>
                  <article>
                    <div className="journal-conflict-column-head-v565 remote">
                      <b>共有フォルダの最新内容</b>
                      <small>{journalConflict.remote.updatedAt}</small>
                    </div>
                    <div className="journal-conflict-meta-v565">
                      {journalConflict.remote.mood && (
                        <span>🙂 {journalConflict.remote.mood}</span>
                      )}
                      {journalConflict.remote.weather && (
                        <span>☀ {journalConflict.remote.weather}</span>
                      )}
                    </div>
                    <pre>
                      {journalConflict.remote.markdown || "（本文は空です）"}
                    </pre>
                  </article>
                </div>
                <footer>
                  <button
                    className="journal-conflict-secondary-v565"
                    disabled={journalConflictSaving}
                    onClick={() => void resolveJournalConflict("remote")}
                  >
                    共有側を読み込む
                  </button>
                  <button
                    className="journal-conflict-secondary-v565"
                    disabled={journalConflictSaving}
                    onClick={() => void resolveJournalConflict("merge")}
                  >
                    本文を統合して保存
                  </button>
                  <button
                    className="journal-conflict-primary-v565"
                    disabled={journalConflictSaving}
                    onClick={() => void resolveJournalConflict("local")}
                  >
                    {journalConflictSaving ? "保存中…" : "自分の内容で上書き"}
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )}

        <section className={`workspace-editor-host-v775 workspace-density-${workspaceLayout.density}-v776`}>
          {workspaceLayout.tabsVisible && (
            <WorkspaceFeatureTabs
              screens={workspaceFeatureTabs.openScreens}
              activeScreen={workspaceScreenDefinition.tabOwnership === "none" ? workspaceFeatureTabs.activeScreen : workspaceScreen}
              onActivate={activateWorkspaceScreen}
              onClose={closeWorkspaceScreen}
              onReorder={reorderWorkspaceScreen}
              controls={
                <WorkspaceLayoutControls
                  preset={workspaceLayout.preset}
                  density={workspaceLayout.density}
                  onApplyPreset={applyWorkspacePreset}
                  onDensityChange={changeWorkspaceDensity}
                  onReset={resetWorkspaceLayout}
                />
              }
            />
          )}
        <main className="editor-pane" data-workspace-screen={workspaceScreen} data-tab-ownership={workspaceScreenDefinition.tabOwnership}>
          {mainMode === "home" ? (
            <HomeDashboard
              data={dashboard}
              onOpenPage={openPage}
              onOpenDatabase={openDatabase}
              onOpenDatabaseRow={openDatabaseRow}
              onOpenJournal={openJournal}
              onOpenInbox={openInbox}
              onOpenTasks={openTasks}
              onOpenAttachments={openAttachmentsManager}
              onOpenLinks={openLinksManager}
              onOpenAdmin={openWorkspaceAdmin}
              onOpenNotifications={openNotificationsCenter}
              onOpenFreeformCanvas={openFreeformCanvas}
              recentRevision={recentWorkspaceRevision}
            />
          ) : mainMode === "knowledge-map" && knowledgeMapPageId ? (
            <KnowledgeMapScreen
              api={api}
              pageId={knowledgeMapPageId}
              onOpenPage={openPage}
              onOpenDatabaseRow={openDatabaseRow}
              onBack={() => setMainMode(current ? "page" : "home")}
            />
          ) : mainMode === "analysis" ? (
            <AnalysisNotebookScreen
              api={api}
              onBack={() => setMainMode(current ? "page" : "home")}
              onStatus={setStatus}
              onOpenPage={openPage}
              onOpenDatabase={openDatabase}
              onOpenDatabaseRow={openDatabaseRow}
              onOpenJournal={openJournal}
            />
          ) : mainMode === "external-sources" ? (
            <ExternalSourcesScreen
              onBack={() => setMainMode(current ? "page" : "home")}
              onOpenWhiteboard={() => void openFreeformCanvas()}
              onStatus={setStatus}
            />
          ) : mainMode === "web-builder" ? (
            <WebBuilderScreen
              pages={allVisiblePages}
              databases={databases}
              loadPage={async (id) => {
                if (!api) throw new Error("APIが初期化されていません");
                return api.getPage(id);
              }}
              onBack={() => setMainMode(current ? "page" : "home")}
              onOpenWhiteboard={() => void openFreeformCanvas()}
              onStatus={setStatus}
            />
          ) : mainMode === "canvas" ? (
            <FreeformCanvasScreen
              pages={allVisiblePages}
              databases={databases}
              attachments={allAttachments}
              apiUrl={apiUrl}
              loadPage={async (id) => {
                if (!api) throw new Error("APIが初期化されていません");
                return api.getPage(id);
              }}
              savePage={async (bundle, changes) => {
                if (!api) throw new Error("APIが初期化されていません");
                const saved = await api.savePage({
                  id: bundle.meta.id,
                  title: changes.title,
                  markdown: changes.markdown,
                  blocksuite: {
                    version: 1,
                    kind: "blocknote",
                    blocks: localBlocksToBlockNote(markdownToBlocks(changes.markdown)),
                  },
                  baseUpdatedAt: bundle.meta.updatedAt,
                  properties: bundle.meta.properties,
                  icon: bundle.meta.icon ?? null,
                  scope: bundle.meta.scope,
                  historyReason: "manual",
                });
                await reload();
                return saved;
              }}
              onOpenPage={openPage}
              onOpenDatabase={openDatabase}
              onOpenWebBuilder={() => void openWebBuilder()}
              onBack={() => setMainMode(current ? "page" : "home")}
              onStatus={setStatus}
            />
          ) : mainMode === "smart" ? (
            <LocalSmartAssistView
              api={api}
              pages={flattenPages(tree)}
              databases={databases}
              journals={journals}
              inboxItems={inboxItems}
              tasks={tasks}
              currentPage={current}
              currentDb={currentDb}
              tagAliases={tagAliases}
              tagPresentation={tagPresentation}
              onOpenPage={openPage}
              onOpenDatabase={openDatabase}
              onOpenDatabaseRow={openDatabaseRow}
              onOpenJournal={openJournal}
              onOpenInbox={openInbox}
              onOpenTasks={openTasks}
            />
          ) : mainMode === "notifications" ? (
            <NotificationCenterView
              dashboard={dashboard}
              tasks={tasks}
              inboxItems={inboxItems}
              brokenLinks={brokenLinks}
              conflicts={conflicts}
              onOpenPage={openPage}
              onOpenInbox={openInbox}
              onOpenTasks={openTasks}
              onOpenLinks={openLinksManager}
              onOpenAdmin={openWorkspaceAdmin}
            />
          ) : mainMode === "attachments" ? (
            <AttachmentManagerView
              items={allAttachments}
              inboxItems={inboxItems}
              onOpenPage={openPage}
              onSendToOcr={async (attachment) => {
                if (!api) return;
                const item = await api.sendAttachmentToOcrCenter({
                  sourceType: "page",
                  attachmentId: attachment.id,
                  pageId: attachment.pageId,
                  sourceTitle: attachment.pageTitle || "ページ添付",
                });
                setInboxItems(await api.listInboxItems().catch(() => []));
                setOcrCenterFocusKey(
                  `${item.id}:${item.attachments?.[0]?.id || ""}`,
                );
                setMainMode("ocr");
                setStatus("OCRセンターに登録しました");
              }}
              onOpenOcr={(inboxId, attachmentId) => {
                setOcrCenterFocusKey(`${inboxId}:${attachmentId}`);
                setMainMode("ocr");
              }}
            />
          ) : mainMode === "links" ? (
            <LinkManagerView
              brokenLinks={brokenLinks}
              pages={allVisiblePages}
              onOpenPage={openPage}
            />
          ) : mainMode === "explorer" ? (
            <WorkspaceExplorerScreen
              pages={allVisiblePages}
              databases={databases}
              screens={listWorkspaceScreens()}
              onOpenPage={(pageId) => void openPage(pageId)}
              onOpenDatabase={(databaseId) => void openDatabase(databaseId)}
              onOpenScreen={(screenId) => activateWorkspaceScreen(screenId as WorkspaceScreenId)}
              onOpenWebProject={(projectId) => { setActiveWebProjectId(projectId); void openWebBuilder(); }}
              onBack={() => setMainMode(current ? "page" : "home")}
            />
          ) : mainMode === "projects" ? (
            <ProjectHubScreen
              pages={allVisiblePages}
              tasks={tasks}
              onOpenPage={(pageId) => void openPage(pageId)}
              onCreateProject={createProjectHub}
              onAssignPage={assignPageToProject}
              onBack={() => setMainMode(current ? "page" : "home")}
            />
          ) : mainMode === "wiki" ? (
            <WikiManagementScreen
              api={api}
              pages={allVisiblePages}
              onOpenPage={(pageId) => void openPage(pageId)}
              onAskAi={(pageId, digest) => {
                void openPage(pageId).then(() => {
                  setWorkspaceAiDrawerMode("chat");
                  setWorkspaceAiInitialQuery("");
                  setWorkspaceAiQueuedPrompt(
                    `次の正式版ページの更新内容を、旧版との差分を踏まえて簡潔に要約してください。変更の影響、確認が必要な点、関連ページの見直し候補を示してください。\n\nページ: ${digest.title}\n追加行: ${digest.addedCount} / 削除・変更行: ${digest.removedCount}\n差分の要点:\n${digest.summary.map((line) => `- ${line}`).join("\n")}`,
                  );
                  setWorkspaceAiSearchOpen(true);
                });
              }}
              onBack={() => setMainMode(current ? "page" : "home")}
              onUpdateProperties={async (page, properties) => {
                if (!api) return;
                const full = await api.getPage(page.id);
                const saved = await api.savePage({
                  id: full.meta.id,
                  title: full.meta.title,
                  markdown: full.markdown,
                  blocksuite: full.blocksuite,
                  baseUpdatedAt: full.meta.updatedAt,
                  properties: normalizePageProperties(properties),
                  icon: full.meta.icon ?? null,
                  scope: full.meta.scope,
                  historyReason: "metadata_changed",
                });
                if (current?.meta.id === saved.meta.id) {
                  setCurrent(saved);
                  setPageProperties(saved.meta.properties);
                }
                await reload();
                setStatus("Wiki情報を更新しました");
              }}
            />
          ) : mainMode === "glossary" ? (
            <GlossaryManagerScreen
              terms={workspaceGlossary}
              pages={allVisiblePages}
              api={api}
              initialDraftTerm={glossaryDraftTerm}
              onInitialDraftConsumed={() => setGlossaryDraftTerm("")}
              onSave={persistWorkspaceGlossary}
              onOpenPage={(pageId) => void openPage(pageId)}
              onBack={() => setMainMode(current ? "page" : "home")}
            />
          ) : mainMode === "tags" ? (
            <section className="workspace-tag-management-screen">
              <div className="workspace-tag-management-header">
                <div>
                  <span className="eyebrow">WORKSPACE DICTIONARY</span>
                  <h1>タグ管理</h1>
                  <p>
                    ページへのタグ付与は各ページで行い、名前・別名・統合などの全体管理はここで行います。
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => {
                    setMainMode(current ? "page" : "home");
                  }}
                >
                  戻る
                </button>
              </div>
              <TagCoverageDashboard
                pages={allVisiblePages}
                aliases={tagAliases}
                presentation={tagPresentation}
                onOpenPage={(pageId) => void openPage(pageId)}
              />
              <BulkTagSuggestionReview
                api={api}
                pages={allVisiblePages}
                aliases={tagAliases}
                onOpenPage={(pageId) => void openPage(pageId)}
                onStatus={setStatus}
                onRefresh={() => reload()}
              />
              <WorkspaceTagManager
                pages={allVisiblePages}
                aliases={tagAliases}
                presentation={tagPresentation}
                standalone
                onAliasesChange={scheduleWorkspaceTagAliasesPersist}
                onPresentationChange={scheduleWorkspaceTagPresentationPersist}
                onRename={(from, to) =>
                  void replaceWorkspaceTag(from, to, "rename")
                }
                onMerge={(from, to) =>
                  void replaceWorkspaceTag(from, to, "merge")
                }
                onOpenPage={(pageId) => void openPage(pageId)}
              />
            </section>
          ) : mainMode === "admin" ? (
            <WorkspaceAdminView
              health={health}
              conflicts={conflicts}
              trashCount={trashedPages.length}
              dashboard={dashboard}
              onSync={() => reload("共有フォルダから再同期しました")}
              onOpenBackup={openBackupCenter}
            />
          ) : mainMode === "backup" ? (
            <BackupCenterView
              items={backupItems}
              trash={trashedPages}
              conflicts={conflicts}
              attachments={allAttachments}
              dashboard={dashboard}
              onRestore={restoreBackupItem}
              onOpenPage={openPage}
              onOpenAdmin={openWorkspaceAdmin}
              onSync={() => reload("共有フォルダから再同期しました")}
            />
          ) : mainMode === "tasks" ? (
            <TasksView
              tasks={tasks}
              onOpenPage={openPage}
              onOpenJournal={openJournal}
              onOpenInbox={openInbox}
              onOpenDatabaseRow={openDatabaseRow}
              onRefresh={async () => {
                if (api) setTasks(await api.listTasks().catch(() => []));
              }}
              onUpdateTask={async (taskId, patch) => {
                if (!api) return;
                const next = await api.updateTask(taskId, patch);
                setTasks(next);
                setStatus("タスクを更新しました");
              }}
            />
          ) : mainMode === "ocr" ? (
            <OcrCenterView
              items={inboxItems}
              onCaptureFiles={captureInboxFiles}
              onRunOcr={runInboxAttachmentOcr}
              onCancelOcr={cancelInboxAttachmentOcr}
              onRetryOcr={retryInboxAttachmentOcr}
              onRefresh={refreshInboxOcrQueue}
              onOpenInbox={openInbox}
              focusedKey={ocrCenterFocusKey}
              onAskAiFromOcr={(item, file, text) => {
                setWorkspaceAiQueuedPrompt(
                  `次のOCR結果を整理してください。\n\n1. 内容の要約\n2. タグ候補（最大5個）\n3. FAQ候補（必要な場合のみ）\n4. 誤認識・確認が必要そうな箇所\n\nInbox: ${item.title}\n添付: ${file.fileName}\n\nOCR結果:\n${text.slice(0, 12000)}`,
                );
                setWorkspaceAiDrawerMode("chat");
                setWorkspaceAiInitialQuery("");
                setWorkspaceAiSearchOpen(true);
                setStatus("OCR結果をAIアシスタントへ渡しました");
              }}
              attachmentUrl={(inboxId, attachmentId) =>
                api?.inboxAttachmentFileUrl(inboxId, attachmentId) || "#"
              }
            />
          ) : mainMode === "inbox" ? (
            <InboxView
              items={inboxItems}
              drafts={inboxDrafts}
              onDraft={(id, text) =>
                setInboxDrafts((prev) => ({ ...prev, [id]: text }))
              }
              onUpdate={updateInboxItem}
              onCreatePage={inboxToPage}
              onSendJournal={inboxToTodayJournal}
              onArchive={archiveInboxItem}
              onDelete={deleteInboxItem}
              onCaptureFiles={captureInboxFiles}
              onOpenOcrCenter={openOcrCenter}
              attachmentUrl={(inboxId, attachmentId) =>
                api?.inboxAttachmentFileUrl(inboxId, attachmentId) || "#"
              }
            />
          ) : mainMode === "journal" && currentJournal ? (
            <>
              <div className="toolbar journal-toolbar affine-journal-toolbar">
                <span className="status">{status}</span>
                {Object.keys(saveRecovery).length > 0 && (
                  <button
                    className="save-recovery-action"
                    onClick={() => void retryPendingSavesNow()}
                  >
                    未保存 {Object.keys(saveRecovery).length}件・再試行
                  </button>
                )}
                <span className="autosave-indicator">
                  {journalSaving
                    ? "保存中…"
                    : journalDirty
                      ? "未保存"
                      : "保存済み"}
                </span>
                <button
                  className="icon-toolbar-button"
                  onClick={() => openJournal(shiftDate(journalDate, -7))}
                  title="前週"
                >
                  ‹‹
                </button>
                <button
                  className="icon-toolbar-button"
                  onClick={() =>
                    openJournal(shiftDate(currentJournal.date, -1))
                  }
                  title="前日"
                >
                  ‹
                </button>
                <button
                  className="icon-toolbar-button journal-today-button"
                  onClick={() => openJournal(todayJst)}
                  title="今日へ戻る"
                  aria-label="今日へ戻る"
                >
                  ●
                </button>
                <button
                  className="icon-toolbar-button"
                  onClick={() => openJournal(shiftDate(currentJournal.date, 1))}
                  title="翌日"
                >
                  ›
                </button>
                <button
                  className="icon-toolbar-button"
                  onClick={() => openJournal(shiftDate(journalDate, 7))}
                  title="次週"
                >
                  ››
                </button>
                <input
                  className="journal-date-input compact"
                  type="date"
                  value={journalDate}
                  onChange={(e) => openJournal(e.target.value)}
                  title="日付を選択"
                />
                <button
                  className="icon-toolbar-button"
                  onClick={() => void addJournalAttachments()}
                  disabled={journalAttachmentUploading}
                  title="ファイルを添付"
                  aria-label="ファイルを添付"
                >
                  {journalAttachmentUploading ? "…" : "📎"}
                </button>
                <button
                  className="danger icon-toolbar-button"
                  onClick={deleteCurrentJournal}
                  title="ジャーナルを削除"
                  aria-label="ジャーナルを削除"
                >
                  🗑️
                </button>
              </div>
              <section className="journal-page affine-journal-page">
                <div className="affine-week-panel">
                  <div className="affine-week-panel-head">
                    <div>
                      <span>Journal</span>
                      <strong>{journalWeekRange}</strong>
                    </div>
                    <button
                      className="affine-week-today-icon"
                      onClick={() => openJournal(todayJst)}
                      title="今日へ戻る"
                      aria-label="今日へ戻る"
                    >
                      ●
                    </button>
                  </div>
                  <div className="affine-week-strip">
                    {journalWeekDays.map((day) => (
                      <button
                        key={day}
                        className={
                          (day === currentJournal.date ? "selected " : "") +
                          (day === todayJst ? "today " : "")
                        }
                        onClick={() => openJournal(day)}
                        title={formatJournalDisplayDate(day)}
                      >
                        <span>{journalWeekdayLabel(day)}</span>
                        <b>{journalDayNumber(day)}</b>
                        {journalDateSet.has(day) && (
                          <i className="journal-dot" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="affine-journal-layout">
                  <div className="affine-journal-main">
                    <div className="journal-hero affine-journal-hero">
                      <div className="journal-date-kicker">
                        <span>Daily note</span>
                        <button
                          className="journal-hero-mini-action"
                          onClick={() => openJournal(todayJst)}
                          title="今日へ戻る"
                          aria-label="今日へ戻る"
                        >
                          ●
                        </button>
                      </div>
                      <div className="journal-title-row">
                        <span className="journal-hero-icon">
                          {currentJournal.icon || "📅"}
                        </span>
                        <h1>{formatJournalDisplayDate(currentJournal.date)}</h1>
                      </div>
                      <div className="journal-subtitle">
                        {currentJournal.date}{" "}
                        の出来事・気づき・作業ログを自由に記録します。
                      </div>
                      <div className="journal-meta-row affine-journal-meta-row">
                        <label>
                          気分{" "}
                          <input
                            value={journalMetaDraft.mood}
                            onChange={(e) =>
                              updateJournalMetaDraft({ mood: e.target.value })
                            }
                            placeholder="😊 / 集中 / 疲れ気味"
                          />
                        </label>
                        <label>
                          天気{" "}
                          <input
                            value={journalMetaDraft.weather}
                            onChange={(e) =>
                              updateJournalMetaDraft({
                                weather: e.target.value,
                              })
                            }
                            placeholder="晴れ / 雨"
                          />
                        </label>
                        <label>
                          タグ{" "}
                          <input
                            value={journalMetaDraft.tagsText}
                            onChange={(e) =>
                              updateJournalMetaDraft({
                                tagsText: e.target.value,
                              })
                            }
                            placeholder="仕事, 家族"
                          />
                        </label>
                      </div>
                    </div>
                    <BlockNotePageEditor
                      pageId={`journal_${currentJournal.date}`}
                      initialContent={journalBlocks}
                      editing={true}
                      pages={allVisiblePages}
                      databases={databases}
                      databaseRowLinks={databaseRowLinkTargets}
                      aiClient={api}
                      attachmentApiBaseUrl={apiUrl}
                      aiPageTitle={formatJournalDisplayDate(
                        currentJournal.date,
                      )}
                      aiTagHints={journalMetaDraft.tagsText
                        .split(/[、,]/)
                        .map((tag) => tag.trim())
                        .filter(Boolean)}
                      glossaryTerms={workspaceGlossary}
                      onOpenGlossary={() => void openGlossaryManager()}
                      onOpenDatabase={openDatabase}
                      onOpenDatabaseRow={openDatabaseRow}
                      onCreateChildPage={createChildPageForEditor}
                      onOpenPage={openPage}
                      onPreviewPage={previewLinkedPage}
                      onUploadFile={uploadJournalFileForBlockNote}
                      onChange={(next) => {
                        setJournalBlocks(next);
                        if (suppressNextJournalChangeRef.current) {
                          suppressNextJournalChangeRef.current = false;
                          return;
                        }
                        setJournalDirty(true);
                      }}
                    />
                  </div>
                  <aside className="affine-journal-side v89-journal-side">
                    <section className="v89-journal-panel">
                      <div className="affine-side-title">
                        <span title="Journal検索" aria-label="Journal検索">
                          ⌕
                        </span>
                        <strong>Journal</strong>
                      </div>
                      <input
                        className="v89-journal-search"
                        value={journalSearch}
                        onChange={(e) => setJournalSearch(e.target.value)}
                        placeholder="Journal全文・日付・タグで検索"
                      />
                      <div className="v89-journal-tabs">
                        <button
                          className={
                            journalSideTab === "related" ? "active" : ""
                          }
                          onClick={() => setJournalSideTab("related")}
                          title="関連情報"
                        >
                          ✦
                        </button>
                        <button
                          className={
                            journalSideTab === "activity" ? "active" : ""
                          }
                          onClick={() => setJournalSideTab("activity")}
                          title="今日の動き"
                        >
                          🧭
                        </button>
                        <button
                          className={
                            journalSideTab === "review" ? "active" : ""
                          }
                          onClick={() => setJournalSideTab("review")}
                          title="レビュー"
                        >
                          📊
                        </button>
                        <button
                          className={
                            journalSideTab === "history" ? "active" : ""
                          }
                          onClick={() => setJournalSideTab("history")}
                          title="履歴"
                        >
                          🗓️
                        </button>
                        <button
                          className={
                            journalSideTab === "attachments" ? "active" : ""
                          }
                          onClick={() => setJournalSideTab("attachments")}
                          title="添付ファイル"
                        >
                          📎
                        </button>
                      </div>
                    </section>

                    {journalSideTab === "related" && (
                      <section className="v89-journal-panel v288-journal-related-panel">
                        <WorkspaceRelatedPanel
                          api={api}
                          target={{ type: "journal", id: currentJournal.date }}
                          compact
                          description="このJournalに近いページ・FAQ・DB行・過去記録を抽出します。"
                          onOpenPage={openPage}
                          onOpenDatabase={openDatabase}
                          onOpenDatabaseRow={openDatabaseRow}
                          onOpenJournal={openJournal}
                        />
                      </section>
                    )}

                    {journalSideTab === "activity" && (
                      <section className="v89-journal-panel">
                        <div className="affine-side-title">
                          <span title="今日の動き" aria-label="今日の動き">
                            🧭
                          </span>
                          <strong>今日の動き</strong>
                        </div>
                        {journalActivityItems.length === 0 ? (
                          <p className="muted-small">
                            この日に作成・更新されたページはまだありません。
                          </p>
                        ) : (
                          <div className="v89-timeline">
                            {journalActivityItems.map((item) => (
                              <button
                                key={`${item.page.id}-${item.kind}`}
                                className="v89-timeline-item"
                                onClick={() => openPage(item.page.id)}
                                title={item.page.title}
                              >
                                <i>{item.kind === "作成" ? "＋" : "↻"}</i>
                                <span>{item.page.icon || "📄"}</span>
                                <b>{item.page.title}</b>
                                <small>
                                  {item.kind} ・ {formatShortDate(item.time)}
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    )}

                    {journalSideTab === "review" && (
                      <section className="v89-journal-panel">
                        <div className="affine-side-title">
                          <span title="レビュー" aria-label="レビュー">
                            📊
                          </span>
                          <strong>{journalReviewRange.label}</strong>
                        </div>
                        <div className="v89-review-switch">
                          <button
                            className={
                              journalReviewMode === "week" ? "active" : ""
                            }
                            onClick={() => setJournalReviewMode("week")}
                          >
                            週
                          </button>
                          <button
                            className={
                              journalReviewMode === "month" ? "active" : ""
                            }
                            onClick={() => setJournalReviewMode("month")}
                          >
                            月
                          </button>
                        </div>
                        <div className="v89-review-cards">
                          <div>
                            <strong>{journalReview.journalCount}</strong>
                            <span>Journal</span>
                          </div>
                          <div>
                            <strong>{journalReview.pageCount}</strong>
                            <span>ページ更新</span>
                          </div>
                        </div>
                        <div className="v89-review-list">
                          <small>よく使ったタグ</small>
                          {journalReview.topTags.length === 0 ? (
                            <p className="muted-small">
                              タグはまだありません。
                            </p>
                          ) : (
                            journalReview.topTags.map(([tag, count]) => (
                              <span key={tag}>
                                #{tag}
                                <b>{count}</b>
                              </span>
                            ))
                          )}
                        </div>
                        <div className="v89-review-list compact">
                          <small>気分 / 天気</small>
                          {[
                            ...journalReview.topMoods,
                            ...journalReview.topWeather,
                          ]
                            .slice(0, 6)
                            .map(([label, count]) => (
                              <span key={label}>
                                {label}
                                <b>{count}</b>
                              </span>
                            ))}
                        </div>
                      </section>
                    )}

                    {journalSideTab === "history" && (
                      <section className="v89-journal-panel">
                        <div className="affine-side-title">
                          <span title="Journal履歴" aria-label="Journal履歴">
                            🗓️
                          </span>
                          <strong>履歴</strong>
                        </div>
                        {filteredJournals.length === 0 ? (
                          <p className="muted-small">
                            該当するJournalはありません。
                          </p>
                        ) : (
                          filteredJournals.map((j) => (
                            <button
                              key={j.date}
                              className={
                                j.date === currentJournal.date
                                  ? "affine-journal-history selected"
                                  : "affine-journal-history"
                              }
                              onClick={() => openJournal(j.date)}
                            >
                              <span>{j.date.slice(5)}</span>
                              <small>{j.previewSnippet || "メモなし"}</small>
                            </button>
                          ))
                        )}
                      </section>
                    )}

                    {journalSideTab === "attachments" && (
                      <section className="v89-journal-panel journal-attachments-panel-v566">
                        <div className="affine-side-title">
                          <span title="添付ファイル" aria-label="添付ファイル">
                            📎
                          </span>
                          <strong>添付ファイル</strong>
                          <button
                            className="journal-attachment-add-v566"
                            onClick={() => void addJournalAttachments()}
                            disabled={journalAttachmentUploading}
                            title="ファイルを追加"
                          >
                            {journalAttachmentUploading ? "追加中…" : "＋ 追加"}
                          </button>
                        </div>
                        {journalAttachments.length === 0 ? (
                          <div className="journal-attachments-empty-v566">
                            <b>添付はまだありません</b>
                            <span>
                              PDF・画像・Office文書などを、この日の記録と一緒に保存できます。
                            </span>
                            <button
                              onClick={() => void addJournalAttachments()}
                              disabled={journalAttachmentUploading}
                            >
                              ファイルを添付
                            </button>
                          </div>
                        ) : (
                          <div className="journal-attachment-list-v566">
                            {journalAttachments.map((attachment) => {
                              const previewable =
                                isJournalImageAttachment(attachment.fileName) ||
                                isJournalPdfAttachment(attachment.fileName);
                              const ocrItem = inboxItems.find(
                                (candidate) =>
                                  candidate.ocrSource?.sourceType ===
                                    "journal" &&
                                  candidate.ocrSource?.date ===
                                    currentJournal.date &&
                                  candidate.ocrSource?.attachmentId ===
                                    attachment.id,
                              );
                              const ocrAttachment = ocrItem?.attachments?.[0];
                              const ocrReady =
                                ocrAttachment?.ocr?.status === "ready" ||
                                ocrAttachment?.pdfText?.status === "ready";
                              const ocrActive = [
                                "queued",
                                "running",
                                "cancelling",
                              ].includes(
                                String(ocrAttachment?.ocrQueue?.status || ""),
                              );
                              const ocrFailed =
                                ["failed", "cancelled"].includes(
                                  String(ocrAttachment?.ocrQueue?.status || ""),
                                ) ||
                                ocrAttachment?.ocr?.status === "failed" ||
                                ocrAttachment?.pdfText?.status === "failed";
                              return (
                                <article
                                  key={attachment.id}
                                  className="journal-attachment-card-v567"
                                >
                                  <button
                                    type="button"
                                    className="journal-attachment-open-v567"
                                    onClick={() =>
                                      previewable
                                        ? setJournalAttachmentPreview(
                                            attachment,
                                          )
                                        : window.open(
                                            api?.journalAttachmentFileUrl(
                                              currentJournal.date,
                                              attachment.id,
                                            ) || "#",
                                            "_blank",
                                            "noopener,noreferrer",
                                          )
                                    }
                                    title={
                                      previewable
                                        ? "プレビューを開く"
                                        : "ファイルを開く"
                                    }
                                  >
                                    <span className="journal-attachment-icon-v567">
                                      {journalAttachmentIcon(
                                        attachment.fileName,
                                      )}
                                    </span>
                                    <span className="journal-attachment-copy-v567">
                                      <b>{attachment.fileName}</b>
                                      <small>
                                        {formatJournalAttachmentSize(
                                          attachment.size,
                                        )}{" "}
                                        ・{" "}
                                        {new Date(
                                          attachment.createdAt,
                                        ).toLocaleDateString("ja-JP")}
                                      </small>
                                    </span>
                                    <span className="journal-attachment-kind-v567">
                                      {isJournalImageAttachment(
                                        attachment.fileName,
                                      )
                                        ? "画像"
                                        : isJournalPdfAttachment(
                                              attachment.fileName,
                                            )
                                          ? "PDF"
                                          : journalAttachmentExtension(
                                              attachment.fileName,
                                            ).toUpperCase() || "FILE"}
                                    </span>
                                  </button>
                                  <div className="journal-attachment-actions-v568">
                                    {isJournalImageAttachment(
                                      attachment.fileName,
                                    ) ||
                                    isJournalPdfAttachment(
                                      attachment.fileName,
                                    ) ? (
                                      ocrReady ? (
                                        <button
                                          type="button"
                                          className="journal-attachment-ocr-v568 is-ready"
                                          onClick={() =>
                                            void sendJournalAttachmentToOcrCenter(
                                              attachment,
                                            )
                                          }
                                          title="OCR結果を見る"
                                        >
                                          結果
                                        </button>
                                      ) : ocrActive ? (
                                        <button
                                          type="button"
                                          className="journal-attachment-ocr-v568 is-active"
                                          onClick={() =>
                                            void sendJournalAttachmentToOcrCenter(
                                              attachment,
                                            )
                                          }
                                          title="OCRセンターで状態を見る"
                                        >
                                          処理中
                                        </button>
                                      ) : ocrFailed ? (
                                        <button
                                          type="button"
                                          className="journal-attachment-ocr-v568 is-failed"
                                          onClick={() =>
                                            void sendJournalAttachmentToOcrCenter(
                                              attachment,
                                            )
                                          }
                                          title="OCRセンターで再実行"
                                        >
                                          再試行
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="journal-attachment-ocr-v568"
                                          onClick={() =>
                                            void sendJournalAttachmentToOcrCenter(
                                              attachment,
                                            )
                                          }
                                          title="OCRセンターへ送る"
                                        >
                                          OCR
                                        </button>
                                      )
                                    ) : null}
                                    <a
                                      className="journal-attachment-external-v567"
                                      href={
                                        api?.journalAttachmentFileUrl(
                                          currentJournal.date,
                                          attachment.id,
                                        ) || "#"
                                      }
                                      target="_blank"
                                      rel="noreferrer"
                                      title="別ウィンドウで開く"
                                      aria-label={`${attachment.fileName} を別ウィンドウで開く`}
                                    >
                                      ↗
                                    </a>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    )}
                  </aside>
                </div>
              </section>
            </>
          ) : mainMode === "database" && currentDb ? (
            <>
              <div className="toolbar db-page-toolbar-v48">
                <span className="status">{status}</span>
                {Object.keys(saveRecovery).length > 0 && (
                  <button
                    className="save-recovery-action"
                    onClick={() => void retryPendingSavesNow()}
                  >
                    未保存 {Object.keys(saveRecovery).length}件・再試行
                  </button>
                )}
                <button
                  className="toolbar-primary icon-toolbar-button"
                  onClick={saveDatabase}
                  title="保存"
                  aria-label="保存"
                >
                  💾
                </button>
                <button
                  className="icon-toolbar-button"
                  onClick={addDatabaseRow}
                  title="行を追加"
                  aria-label="行を追加"
                >
                  ＋
                </button>
                <button
                  className="icon-toolbar-button"
                  onClick={addDatabaseProperty}
                  title="列を追加"
                  aria-label="列を追加"
                >
                  ▦
                </button>
                <div
                  className="db-scope-toggle-v163"
                  title={
                    workspaceScope(currentDb) === "private"
                      ? "このPCだけに保存されています"
                      : "共有フォルダに保存されています"
                  }
                >
                  <button
                    className={
                      workspaceScope(currentDb) === "private"
                        ? "active private"
                        : ""
                    }
                    onClick={() => changeDatabaseScope("private")}
                  >
                    🔒 Private
                  </button>
                  <button
                    className={
                      workspaceScope(currentDb) === "shared"
                        ? "active shared"
                        : ""
                    }
                    onClick={() => changeDatabaseScope("shared")}
                  >
                    🌐 Shared
                  </button>
                </div>
                <button
                  className="danger icon-toolbar-button"
                  onClick={() => deleteDatabaseById(currentDb.id)}
                  title="データベースを削除"
                  aria-label="データベースを削除"
                >
                  🗑️
                </button>
              </div>
              <DatabaseTable
                database={currentDb}
                editing={dbEditing}
                onChange={(updated) =>
                  autoSaveDatabase(updated, "データベース")
                }
                onPatchRows={patchDatabaseRows}
                onCreateRows={createDatabaseRows}
                onDeleteRows={deleteDatabaseRows}
                allDatabases={databases}
                pages={flattenPages(tree)}
                journals={journals}
                glossaryTerms={workspaceGlossary}
                onOpenGlossary={() => void openGlossaryManager()}
                onOpenPage={openPage}
                onOpenDatabase={openDatabase}
                onOpenJournal={openJournal}
                api={api}
                initialSelectedRowId={pendingDbRowId}
                onDatabaseRowChildPageCreated={() => {
                  setDatabaseSidebarRefreshKey((value) => value + 1);
                  reload("DB行の子ページを更新しました").catch(() => undefined);
                }}
              />
              <div className="meta">
                <div>ID: {currentDb.id}</div>
                <div>Rows: {currentDb.rows.length}</div>
                <div>Updated: {currentDb.updatedAt}</div>
                <div>By: {currentDb.updatedBy}</div>
              </div>
            </>
          ) : mainMode === "trash" ? (
            <TrashCenterView
              items={trashedPages}
              databases={trashedDatabases}
              onOpen={openPage}
              onRestore={restoreTrashedPage}
              onDelete={deleteTrashedPage}
              onRestoreDatabase={restoreTrashedDatabase}
              onDeleteDatabase={deleteTrashedDatabase}
              onEmpty={emptyTrash}
              onBack={() => {
                setViewMode("tree");
                setMainMode(current ? "page" : "home");
              }}
            />
          ) : mainMode !== "page" || !current ? (
            <div className="empty">
              <h1>Local Notion Lite</h1>
              <p>左の「新規」からページを作成してください。</p>
              <p>
                共有フォルダを正本にし、各PCのSQLiteは検索キャッシュとして使います。
              </p>
            </div>
          ) : (
            <>
              <WorkspaceWorkbench
                toolbar={
                  <div className="toolbar notion-toolbar">
                    <span className="status">{status}</span>
                    {Object.keys(saveRecovery).length > 0 && (
                      <button
                        className="save-recovery-action"
                        onClick={() => void retryPendingSavesNow()}
                      >
                        未保存 {Object.keys(saveRecovery).length}件・再試行
                      </button>
                    )}
                    <span className={`autosave-indicator autosave-indicator-v729${saveActivity.page ? " is-saving" : dirty ? " is-dirty" : " is-saved"}`} role="status" aria-live="polite">
                      <i aria-hidden="true"></i>
                      {editing ? (saveActivity.page ? "保存中…" : dirty ? "未保存" : "保存済み") : "閲覧のみ"}
                    </span>
                    {workspaceActiveItem?.kind === "database" ? (
                      <span
                        className="workspace-toolbar-context-v523"
                        title="データベース固有の共有設定・削除・編集操作は、下のデータベース見出しにあります"
                      >
                        ▦ データベースを編集中
                      </span>
                    ) : (
                      <>
                        <button
                          className="secondary favorite-page-action icon-toolbar-button"
                          onClick={() => toggleFavorite(current.meta.id)}
                          title={
                            current.meta.favorite
                              ? "お気に入り解除"
                              : "お気に入り"
                          }
                          aria-label={
                            current.meta.favorite
                              ? "お気に入り解除"
                              : "お気に入り"
                          }
                        >
                          {current.meta.favorite ? "★" : "☆"}
                        </button>
                        <button
                          className="icon-toolbar-button comment-toolbar-button"
                          onClick={() => {
                            setPreferredPageInfoTab("comments");
                            setPropertiesOpen(true);
                            void ensurePageInfoTabData(
                              current.meta.id,
                              "comments",
                            );
                          }}
                          title="コメント"
                          aria-label="コメント"
                        >
                          💬
                          {pageComments.filter((c) => !c.resolved).length ? (
                            <span>
                              {pageComments.filter((c) => !c.resolved).length}
                            </span>
                          ) : null}
                        </button>
                        <button
                          className="icon-toolbar-button"
                          onClick={duplicateCurrent}
                          title="複製"
                          aria-label="複製"
                        >
                          ⧉
                        </button>
                        <button
                          className="danger icon-toolbar-button"
                          onClick={trashCurrent}
                          title="ゴミ箱へ移動"
                          aria-label="ゴミ箱へ移動"
                        >
                          🗑️
                        </button>
                        <div
                          className="scope-toggle"
                          title={
                            pageScope(current.meta) === "private"
                              ? "このPCだけに保存されています"
                              : "共有フォルダに保存されています"
                          }
                        >
                          <button
                            className={
                              pageScope(current.meta) === "private"
                                ? "active"
                                : ""
                            }
                            onClick={() => changeCurrentScope("private")}
                          >
                            🔒 Private
                          </button>
                          <button
                            className={
                              pageScope(current.meta) === "shared"
                                ? "active"
                                : ""
                            }
                            onClick={() => changeCurrentScope("shared")}
                          >
                            🌐 Shared
                          </button>
                        </div>
                        <span className="engine-badge">BlockNote</span>
                        <PersonalStickyNotes
                          pageId={current.meta.id}
                          pageTitle={title}
                          launcherPlacement="inline"
                        />
                      </>
                    )}
                  </div>
                }
                api={api}
                current={current}
                pages={allVisiblePages}
                databases={databases}
                journals={journals}
                dirty={dirty}
                onOpenPage={(pageId) => void openPage(pageId)}
                onOpenDatabase={(databaseId) => void openDatabase(databaseId)}
                onSaveDatabase={(database) =>
                  void saveWorkspaceDatabase(database)
                }
                onChangeDatabaseScope={(databaseId, scope) =>
                  void changeWorkspaceDatabaseScope(databaseId, scope)
                }
                onDeleteDatabase={(databaseId) =>
                  void deleteDatabaseById(databaseId)
                }
                onActiveItemChange={(item) => {
                  const requestId = ++workspaceSelectionRequestRef.current;
                  if (!item) {
                    setWorkspaceActiveItem(null);
                    return;
                  }
                  setWorkspaceActiveItem({
                    ...item,
                    parentId:
                      item.kind === "page" && current?.meta.id === item.id
                        ? (current.meta.parentId ?? null)
                        : null,
                  });
                  if (
                    item.kind !== "page" ||
                    !api ||
                    current?.meta.id === item.id
                  )
                    return;
                  void api
                    .getPage(item.id)
                    .then((page) => {
                      if (workspaceSelectionRequestRef.current !== requestId)
                        return;
                      setWorkspaceActiveItem((previous) =>
                        previous?.kind === "page" && previous.id === item.id
                          ? {
                              ...previous,
                              parentId: page.meta.parentId ?? null,
                            }
                          : previous,
                      );
                    })
                    .catch((error) =>
                      console.warn(
                        "WORKSPACE_ACTIVE_PAGE_PARENT_RESOLVE_FAILED",
                        item.id,
                        error,
                      ),
                    );
                }}
              />
              <Breadcrumbs
                currentId={current.meta.id}
                pages={allVisiblePages}
                onOpen={openPage}
              />
              <section className="notion-page-hero">
                <div className="notion-cover" />
                <div className="notion-title-stack">
                  <input
                    className="page-icon-input"
                    value={pageIcon}
                    disabled={!editing}
                    onChange={(e) => {
                      setPageIcon(e.target.value.slice(0, 4) || "📄");
                      markSemanticEditorActivity();
                      setDirty(true);
                    }}
                    title="アイコン"
                  />
                  <input
                    className="title-input notion-title-input"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      markSemanticEditorActivity();
                      setDirty(true);
                    }}
                    disabled={!editing}
                    placeholder="Untitled"
                  />
                  <span
                    className={`page-scope-badge ${pageScope(current.meta)}`}
                  >
                    {scopeIcon(pageScope(current.meta))}{" "}
                    {scopeLabel(pageScope(current.meta))}
                  </span>
                </div>
              </section>
              <PageContextStoryPanel
                api={api}
                pageId={current.meta.id}
                pageTitle={title || current.meta.title}
                pageIcon={pageIcon || current.meta.icon}
                properties={pageProperties}
                onOpenPage={openPage}
                onOpenDatabaseRow={openDatabaseRow}
                onOpenKnowledgeMap={() => void openKnowledgeMap()}
              />
              {(pageProperties.wikiStatus === "verified" ||
                pageProperties.wikiStatus === "archived" ||
                pageProperties.wikiReviewDue) && (
                <div
                  className={`wiki-page-summary-v469 ${pageProperties.wikiStatus || "draft"}`}
                >
                  <span>
                    {pageProperties.wikiStatus === "verified"
                      ? "✓ 正式版"
                      : pageProperties.wikiStatus === "archived"
                        ? "⌫ 廃止"
                        : "◌ 確認管理"}
                  </span>
                  {pageProperties.wikiReviewDue && (
                    <small>次回確認：{pageProperties.wikiReviewDue}</small>
                  )}
                  {pageProperties.wikiSource && (
                    <small>根拠：{pageProperties.wikiSource}</small>
                  )}
                </div>
              )}
              <PageDiagnosisPanel
                title={title}
                markdown={markdownPreview}
                properties={pageProperties}
                onAskAi={(prompt) => {
                  setWorkspaceAiQueuedPrompt(prompt);
                  setWorkspaceAiDrawerMode("chat");
                  setWorkspaceAiSearchOpen(true);
                }}
              />
              <section className="notion-collapsible-properties">
                <button
                  className="properties-toggle"
                  onClick={() => {
                    setPreferredPageInfoTab("properties");
                    setPropertiesOpen((value) => !value);
                  }}
                >
                  <span>{propertiesOpen ? "▾" : "▸"} プロパティ</span>
                  <small>
                    {pageProperties.status !== "未着手"
                      ? pageProperties.status
                      : ""}
                    {pageProperties.tags.length
                      ? `  #${pageProperties.tags[0]}`
                      : ""}
                  </small>
                </button>
                {propertiesOpen && (
                  <PageInfoPanel
                    initialTab={preferredPageInfoTab}
                    api={api}
                    properties={pageProperties}
                    editing={editing}
                    onChange={(next) => {
                      setPageProperties(next);
                      markSemanticEditorActivity();
                      setDirty(true);
                    }}
                    history={history}
                    historyPreview={historyPreview}
                    historyDiff={historyDiff}
                    onPreviewHistory={previewHistory}
                    onShowHistoryDiff={showHistoryDiff}
                    onCloseHistoryInspect={closeHistoryInspect}
                    onRestoreHistory={restoreFromHistory}
                    markdown={markdownPreview}
                    pageTitle={title}
                    pages={allVisiblePages}
                    databases={databases}
                    databaseRowLinks={databaseRowLinkTargets}
                    backlinks={backlinks}
                    comments={pageComments}
                    blockTargets={commentBlockTargets}
                    activity={pageActivity}
                    onAddComment={addPageComment}
                    onToggleComment={togglePageComment}
                    onDeleteComment={deletePageComment}
                    onOpenPage={openPage}
                    onOpenDatabase={(databaseId) =>
                      openDatabaseInWorkspace(databaseId)
                    }
                    onOpenDatabaseRow={(databaseId, rowId) =>
                      openDatabaseRowInWorkspace(databaseId, rowId)
                    }
                    allTags={allKnownTags}
                    tagAliases={tagAliases}
                    tagPresentation={tagPresentation}
                    sidebarCounts={pageSidebarCounts}
                    onRequestTabData={(tab) =>
                      void ensurePageInfoTabData(current.meta.id, tab)
                    }
                  />
                )}
              </section>
              {pageReadOnlyReason && !editing && (
                <div className="readonly-lock-note">
                  このページは閲覧のみです。{pageReadOnlyReason}
                  <button
                    className="secondary"
                    onClick={() => void startEdit()}
                  >
                    編集を再試行
                  </button>
                </div>
              )}
              <div className="page-writing-layout-v49 page-writing-layout-v121">
                <div className="page-writing-main-v49">
                  <BlockNotePageEditor
                    pageId={current.meta.id}
                    initialContent={blockNoteBlocks}
                    editing={editing}
                    pages={allVisiblePages}
                    databases={databases}
                    databaseRowLinks={databaseRowLinkTargets}
                    aiClient={api}
                    attachmentApiBaseUrl={apiUrl}
                    aiPageTitle={title}
                    aiTagHints={pageProperties.tags}
                    glossaryTerms={workspaceGlossary}
                    onOpenGlossary={() => void openGlossaryManager()}
                    // Keep the current BlockNote page and every existing workspace tab alive.
                    // Local DB links must add/select a workspace tab, not replace the page screen.
                    onOpenDatabase={(databaseId) =>
                      openDatabaseInWorkspace(databaseId)
                    }
                    onOpenDatabaseRow={(databaseId, rowId) =>
                      openDatabaseRowInWorkspace(databaseId, rowId)
                    }
                    onCreateChildPage={createChildPageForEditor}
                    onOpenPage={openPage}
                    onPreviewPage={previewLinkedPage}
                    onUploadFile={uploadFileForBlockNote}
                    deferEditorMount={true}
                    onChange={(next) => {
                      setBlockNoteBlocks(next);
                      markSemanticEditorActivity();
                      const pageId = current.meta.id;
                      const signature = pageSaveSignature({
                        pageId,
                        title,
                        icon: pageIcon,
                        properties: normalizePageProperties(pageProperties),
                        blocks: next,
                        scope: pageScope(current.meta),
                      });
                      if (
                        !pageSaveInFlightRef.current &&
                        !queuedPageSaveRef.current &&
                        lastPersistedPageSignatureRef.current[pageId] ===
                          signature
                      ) {
                        setDirty(false);
                        return;
                      }
                      setDirty(true);
                    }}
                  />
                  <EmbeddedDatabasesStickyRail
                    markdown={markdownPreview}
                    databases={databases}
                    pages={flattenPages(tree)}
                    journals={journals}
                    editing={editing}
                    onChangeDatabase={saveEmbeddedDatabase}
                    // The embedded DB must stay inside the current workbench tab strip.
                    onOpenDatabase={(databaseId) =>
                      openDatabaseInWorkspace(databaseId)
                    }
                    onOpenDatabaseRow={(databaseId, rowId) =>
                      openDatabaseRowInWorkspace(databaseId, rowId)
                    }
                  />
                </div>
                <div className="page-right-utility-v105 page-right-utility-lazy-v714">
                  <div className="page-utility-switch-v714" role="tablist" aria-label="ページ補助パネル">
                    <button
                      className={pageUtilityMode === "related" ? "active" : ""}
                      onClick={() =>
                        setPageUtilityMode((mode) =>
                          mode === "related" ? "hidden" : "related",
                        )
                      }
                      title="関連ページを表示"
                    >
                      関連
                    </button>
                    <button
                      className={pageUtilityMode === "outline" ? "active" : ""}
                      onClick={() =>
                        setPageUtilityMode((mode) =>
                          mode === "outline" ? "hidden" : "outline",
                        )
                      }
                      title="アウトラインを表示"
                    >
                      目次
                    </button>
                    <button
                      className={pageUtilityMode === "minimap" ? "active" : ""}
                      onClick={() =>
                        setPageUtilityMode((mode) =>
                          mode === "minimap" ? "hidden" : "minimap",
                        )
                      }
                      title="ページ全体のミニマップを表示"
                    >
                      ミニマップ
                    </button>
                    <button
                      className={pageUtilityMode === "glossary" ? "active" : ""}
                      onClick={() =>
                        setPageUtilityMode((mode) =>
                          mode === "glossary" ? "hidden" : "glossary",
                        )
                      }
                      title="このページに出てくる用語を表示"
                    >
                      用語
                    </button>
                  </div>
                  {pageUtilityMode === "related" && (
                    <WorkspaceRelatedPanel
                      api={api}
                      pageId={current.meta.id}
                      active={mainMode === "page"}
                      draftContent={{
                        title,
                        text: markdownPreview,
                        tags: normalizePageProperties(pageProperties).tags || [],
                        enabled: editing && dirty,
                      }}
                      onOpenPage={openPage}
                      onOpenDatabase={(databaseId) =>
                        openDatabaseInWorkspace(databaseId)
                      }
                      onOpenDatabaseRow={(databaseId, rowId) =>
                        openDatabaseRowInWorkspace(databaseId, rowId)
                      }
                      onOpenJournal={openJournal}
                    />
                  )}
                  {pageUtilityMode === "outline" && (
                    <PageOutlinePanel markdown={markdownPreview} />
                  )}
                  {pageUtilityMode === "minimap" && (
                    <PageMiniMapPanel markdown={markdownPreview} blocks={deferredBlockNoteBlocks} />
                  )}
                  {pageUtilityMode === "glossary" && (
                    <PageGlossaryPanel markdown={markdownPreview} terms={workspaceGlossary} onOpenGlossaryManager={openGlossaryManager} />
                  )}
                  {pageUtilityMode === "hidden" && (
                    <div className="muted-small page-utility-empty-v714">
                      関連・目次・ミニマップ・用語は必要な時だけ開きます。編集中の常時解析を抑えて軽くしています。
                    </div>
                  )}
                </div>
              </div>
              <div className="side-panels notion-foldouts">
                <section className="panel-card foldout-card">
                  <button className="foldout-header">
                    <span>競合</span>
                    <small>{conflicts.length}件</small>
                  </button>
                  {conflicts.length > 0 &&
                    conflicts.map((c) => (
                      <div className="conflict-row" key={c.id} title={c.reason}>
                        <strong>
                          {new Date(c.createdAt).toLocaleString()}
                        </strong>
                        <span>{c.conflictDir}</span>
                      </div>
                    ))}
                </section>
              </div>
              <div className="meta">
                <div>ID: {current.meta.id}</div>
                <div>Updated: {current.meta.updatedAt}</div>
                <div>By: {current.meta.updatedBy}</div>
                <div>Mode: {editing ? "編集可" : "閲覧のみ"}</div>
              </div>
            </>
          )}
        </main>
        </section>
        <WorkspaceAiDrawer
          api={api}
          open={workspaceAiSearchOpen}
          mode={workspaceAiDrawerMode}
          initialQuery={workspaceAiInitialQuery}
          queuedPrompt={workspaceAiQueuedPrompt}
          currentPageId={current?.meta.id || ""}
          currentTitle={title}
          currentMarkdown={markdownPreview}
          onClose={() => setWorkspaceAiSearchOpen(false)}
          onQueuedPromptHandled={() => setWorkspaceAiQueuedPrompt("")}
          onGenerationStateChange={setWorkspaceAiGeneration}
          onOpenDetailedSearch={(query) => {
            setWorkspaceAiInitialQuery(query || "");
            setWorkspaceAiDrawerMode("search");
          }}
          onOpenPage={openPage}
          onOpenDatabase={openDatabase}
          onOpenDatabaseRow={openDatabaseRow}
          onOpenJournal={openJournal}
        />
        <LinkPreviewDrawer
          key={linkPreviewPage?.meta.id ?? "empty"}
          page={linkPreviewPage}
          pages={allVisiblePages}
          databases={databases}
          databaseRowLinks={databaseRowLinkTargets}
          journals={journals}
          api={api}
          apiUrl={apiUrl}
          width={linkPreviewWidth}
          onStartResize={startLinkPreviewResize}
          onClose={() => setLinkPreviewPage(null)}
          onOpen={openPage}
          onPreview={previewLinkedPage}
          onOpenDatabase={openDatabase}
          onOpenDatabaseRow={openDatabaseRow}
          onSaved={() => reload("サイドピークの変更を反映しました")}
          allTags={allKnownTags}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary>);
