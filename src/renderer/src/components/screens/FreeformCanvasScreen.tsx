import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AttachmentInfo,
  PageBundle,
  PageWithLock,
  WorkspaceDatabase,
} from "../../../../shared/types";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLORS,
  STORAGE_KEY,
  buildAttachmentFileUrl,
  buildLinkPath,
  buildSmoothPath,
  buildPagePreviewBlocks,
  clamp,
  colorLabel,
  createDefaultBoard,
  drawingHitTest,
  nodeContainsNode,
  resolveParentFrameId,
  formatBytes,
  formatUpdatedAt,
  getBounds,
  isPdfAttachment,
  kindLabel,
  makeNode,
  nowId,
  nearestAnchor,
  pickDatabasePreviewColumns,
  projectLowDetailNodes,
  safeLoadBoard,
  simplifyStrokePoints,
  snap,
  stringifyCell,
  toolLabel,
  type AddPanelMode,
  type CanvasPagePreviewState,
  type CanvasTemplate,
  type FreeformBoard,
  type FreeformLink,
  type FreeformAnchor,
  type FreeformCanvasTool,
  type FreeformNode,
  type FreeformNodeKind,
  type FreeformShapeKind,
} from "./freeformCanvasModel";
import { FreeformMiniMap } from "./FreeformMiniMap";
import { FreeformConnectorHandles } from "./FreeformConnectorHandles";
import { InlinePageEditor } from "./whiteboard/InlinePageEditor";
import type { GoogleDriveFileItem } from "./GoogleDrivePicker";
import type { GoogleCalendarEventItem } from "./GoogleCalendarPicker";
import type { GoogleGmailMessageItem } from "./GoogleGmailPicker";
import { consumeGoogleWorkspaceQueue } from "./googleWorkspaceQueue";
import { readExternalSourceRecords } from "../../externalSources/store";
import { GoogleWorkspaceExportPanel } from "./GoogleWorkspaceExportPanel";
import { compileWebProject } from "../../webBuilder/compiler";
import { consumeWebProjectWhiteboardQueue, getWebProject, setActiveWebProjectId } from "../../webBuilder/store";
import {
  WhiteboardEngine,
  FreeformLinkLayer,
  buildCollapsedProjection,
  alignNodes,
  distributeNodes,
  layoutNodes,
  calculateSnapDelta,
  cloneClipboardPayload,
  createClipboardPayload,
  parseClipboardPayload,
  serializeClipboardPayload,
  searchFreeformNodes,
  exportFreeformBoard,
  importFreeformBoard,
  dataUrlToBlob,
  getFreeformAsset,
  putFreeformAsset,
  useHistoryEngine,
  type FreeformClipboardPayload,
  type FreeformLayoutMode,
  type FreeformAlignMode,
  type FreeformDistributeMode,
  type FreeformGuide,
} from "./whiteboard/engines";

export function FreeformCanvasScreen({
  pages,
  databases,
  attachments,
  apiUrl,
  loadPage,
  savePage,
  onOpenPage,
  onOpenDatabase,
  onOpenWebBuilder,
  onBack,
  onStatus,
}: {
  pages: PageWithLock[];
  databases: WorkspaceDatabase[];
  attachments?: AttachmentInfo[];
  apiUrl?: string;
  loadPage?: (id: string) => Promise<PageBundle>;
  savePage?: (bundle: PageBundle, changes: { title: string; markdown: string }) => Promise<PageBundle>;
  onOpenPage: (id: string) => void;
  onOpenDatabase: (id: string) => void;
  onOpenWebBuilder?: () => void;
  onBack: () => void;
  onStatus?: (message: string) => void;
}) {
  const initialBoardRef = useRef<FreeformBoard | null>(null);
  if (!initialBoardRef.current) initialBoardRef.current = safeLoadBoard();
  const {
    board,
    boardRef,
    setBoard,
    canUndo,
    canRedo,
    saveBoard,
    updateNode,
    commitCurrentToHistory,
    undo,
    redo,
  } = useHistoryEngine({
    initialBoard: initialBoardRef.current,
    onStatus,
  });
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<AddPanelMode>("note");
  const [zoom, setZoom] = useState(0.9);
  const [viewportWindow, setViewportWindow] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [canvasTool, setCanvasTool] = useState<FreeformCanvasTool>("select");
  const [shapeKind, setShapeKind] = useState<FreeformShapeKind>("round");
  const [connectorStartId, setConnectorStartId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const connectorDragRef = useRef<{
    pointerId: number;
    fromId: string;
    fromHandle: FreeformAnchor;
  } | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<{
    fromId: string;
    fromHandle: FreeformAnchor;
    x: number;
    y: number;
    targetId: string | null;
    toHandle: FreeformAnchor | null;
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    nodes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
    before: FreeformBoard;
    moved: boolean;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const selectionRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    additive: boolean;
    initialIds: string[];
  } | null>(null);
  const spacePressedRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const objectUrlRef = useRef<Set<string>>(new Set());
  const [pagePreviewCache, setPagePreviewCache] = useState<
    Record<string, CanvasPagePreviewState>
  >({});
  const pagePreviewCacheRef = useRef<Record<string, CanvasPagePreviewState>>(
    {},
  );
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const boardImportInputRef = useRef<HTMLInputElement | null>(null);
  const drawRef = useRef<{
    pointerId: number;
    points: Array<{ x: number; y: number }>;
    mode: "draw" | "ruler";
  } | null>(null);
  const eraseRef = useRef<{ pointerId: number; ids: Set<string> } | null>(null);
  const [draftStroke, setDraftStroke] = useState<
    Array<{ x: number; y: number }>
  >([]);
  const strokeFrameRef = useRef<number | null>(null);
  const [cropNodeId, setCropNodeId] = useState<string | null>(null);
  const [penColor, setPenColor] = useState("#2563eb");
  const [penWidth, setPenWidth] = useState(3);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [layoutMode, setLayoutMode] = useState<FreeformLayoutMode>("flow-right");
  const [snapGuides, setSnapGuides] = useState<FreeformGuide[]>([]);
  const clipboardRef = useRef<FreeformClipboardPayload | null>(null);
  const pasteCountRef = useRef(0);
  const [nodeFinderOpen, setNodeFinderOpen] = useState(false);
  const [googleExportOpen, setGoogleExportOpen] = useState(false);
  const [nodeFinderQuery, setNodeFinderQuery] = useState("");
  const [inlinePageBundle, setInlinePageBundle] = useState<PageBundle | null>(null);
  const [inlinePageNodeId, setInlinePageNodeId] = useState<string | null>(null);
  const [inlinePageSaving, setInlinePageSaving] = useState(false);
  const [knowledgeGraphBusy, setKnowledgeGraphBusy] = useState(false);
  const [enginePanelOpen, setEnginePanelOpen] = useState(false);

  useEffect(() => {
    if (!inlinePageNodeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setInlinePageNodeId(null);
      setInlinePageBundle(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inlinePageNodeId]);

  const nodeMap = useMemo(() => WhiteboardEngine.node.index(board.nodes), [board.nodes]);
  const pageById = useMemo(
    () => new Map(pages.map((page) => [page.id, page])),
    [pages],
  );
  const databaseById = useMemo(
    () => new Map(databases.map((database) => [database.id, database])),
    [databases],
  );
  const attachmentByKey = useMemo(
    () =>
      new Map(
        (attachments || []).map((file) => [`${file.pageId}:${file.id}`, file]),
      ),
    [attachments],
  );
  const collapsedProjection = useMemo(
    () => buildCollapsedProjection(board.nodes, board.links),
    [board.links, board.nodes],
  );
  const { hiddenNodeIds, visibleNodes } = collapsedProjection;
  const lowDetail = zoom < 0.62;
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const displayNodes = useMemo(
    () => projectLowDetailNodes(visibleNodes, lowDetail, selectedIdSet),
    [lowDetail, selectedIdSet, visibleNodes],
  );
  const linkNodeMap = useMemo(
    () => new Map(displayNodes.map((node) => [node.id, node])),
    [displayNodes],
  );
  const validLinks = collapsedProjection.projectedLinks;
  const selectedNodes = useMemo(
    () => WhiteboardEngine.selection.nodes(board.nodes, selectedIds),
    [board.nodes, selectedIds],
  );
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const nodeFinderResults = useMemo(
    () => searchFreeformNodes(board.nodes, nodeFinderQuery),
    [board.nodes, nodeFinderQuery],
  );
  const logicalGroups = useMemo(() => {
    const grouped = new Map<string, FreeformNode[]>();
    for (const node of displayNodes) {
      if (!node.groupId) continue;
      const members = grouped.get(node.groupId) || [];
      members.push(node);
      grouped.set(node.groupId, members);
    }
    return Array.from(grouped.entries()).flatMap(([id, members]) => {
      const bounds = getBounds(members);
      return bounds ? [{ id, members, bounds }] : [];
    });
  }, [displayNodes]);
  const renderState = useMemo(
    () => WhiteboardEngine.render.deriveNodes(displayNodes, {
      lowDetail: false,
      selectedIds: selectedIdSet,
      viewport: viewportWindow,
      hiddenIds: hiddenNodeIds,
    }),
    [displayNodes, hiddenNodeIds, selectedIdSet, viewportWindow],
  );
  const renderNodes = renderState.visible;
  const drawingNodes = renderState.drawings;
  const cardNodes = renderState.cards;
  const renderNodeIds = useMemo(() => new Set(renderNodes.map((node) => node.id)), [renderNodes]);
  const renderLinks = useMemo(
    () => validLinks.filter((link) => renderNodeIds.has(link.fromId) || renderNodeIds.has(link.toId)),
    [renderNodeIds, validLinks],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const margin = 420 / zoom;
        setViewportWindow({
          x: viewport.scrollLeft / zoom - margin,
          y: viewport.scrollTop / zoom - margin,
          w: viewport.clientWidth / zoom + margin * 2,
          h: viewport.clientHeight / zoom + margin * 2,
        });
      });
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(viewport);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [zoom]);

  useEffect(() => {
    pagePreviewCacheRef.current = pagePreviewCache;
  }, [pagePreviewCache]);

  useEffect(() => {
    if (!loadPage) return;
    const pageIds = Array.from(
      new Set(
        board.nodes
          .filter((node) => node.kind === "page" && Boolean(node.targetId))
          .map((node) => node.targetId as string),
      ),
    ).slice(0, 24);
    const pending = pageIds.filter((id) => {
      const state = pagePreviewCacheRef.current[id];
      if (!state) return true;
      return Boolean(state.loading && Date.now() - state.loadedAt > 15_000);
    });
    if (!pending.length) return;

    let cancelled = false;
    const queue = [...pending];
    const workerCount = Math.min(4, queue.length);

    const runWorker = async () => {
      while (!cancelled) {
        const id = queue.shift();
        if (!id) return;
        setPagePreviewCache((current) => ({
          ...current,
          [id]: {
            loading: true,
            markdown: current[id]?.markdown || "",
            loadedAt: Date.now(),
          },
        }));
        try {
          const bundle = await loadPage(id);
          if (cancelled) return;
          setPagePreviewCache((current) => ({
            ...current,
            [id]: {
              loading: false,
              markdown: bundle.markdown || "",
              loadedAt: Date.now(),
            },
          }));
        } catch {
          if (cancelled) return;
          setPagePreviewCache((current) => ({
            ...current,
            [id]: {
              loading: false,
              markdown: current[id]?.markdown || "",
              loadedAt: Date.now(),
              error: "preview-failed",
            },
          }));
        }
      }
    };

    void Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return () => {
      cancelled = true;
    };
  }, [board.nodes, loadPage]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ja-JP");
    return pages
      .filter(
        (page) =>
          !q ||
          `${page.title} ${page.id} ${(page.properties.tags || []).join(" ")}`
            .toLocaleLowerCase("ja-JP")
            .includes(q),
      )
      .slice(0, 24);
  }, [pages, query]);

  const filteredDatabases = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ja-JP");
    return databases
      .filter(
        (database) =>
          !q ||
          `${database.title} ${database.id} ${database.properties.map((prop) => prop.name).join(" ")}`
            .toLocaleLowerCase("ja-JP")
            .includes(q),
      )
      .slice(0, 24);
  }, [databases, query]);

  const pageTitleById = useMemo(
    () => new Map(pages.map((page) => [page.id, page.title || "無題のページ"])),
    [pages],
  );

  const pdfAttachments = useMemo(
    () => (attachments || []).filter(isPdfAttachment),
    [attachments],
  );

  const filteredPdfAttachments = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ja-JP");
    return pdfAttachments
      .filter(
        (file) =>
          !q ||
          `${file.fileName} ${pageTitleById.get(file.pageId) || ""}`
            .toLocaleLowerCase("ja-JP")
            .includes(q),
      )
      .slice(0, 24);
  }, [pageTitleById, pdfAttachments, query]);

  const addNode = useCallback(
    (
      node: Omit<FreeformNode, "id" | "createdAt" | "updatedAt">,
      options?: { select?: boolean; status?: boolean },
    ) => {
      const timestamp = Date.now();
      const draftNode = makeNode(node, timestamp);
      saveBoard((current) => {
        const parentFrameId =
          draftNode.kind === "group"
            ? undefined
            : resolveParentFrameId(draftNode, current.nodes);
        const nextNode = { ...draftNode, parentFrameId };
        return { ...current, nodes: [...current.nodes, nextNode] };
      });
      if (options?.select !== false) setSelectedIds([draftNode.id]);
      if (options?.status !== false) onStatus?.("キャンバスに追加しました");
    },
    [onStatus, saveBoard],
  );

  const addNodeAt = useCallback(
    (tool: FreeformCanvasTool, x: number, y: number) => {
      if (tool === "sticky") {
        addNode({
          kind: "note",
          title: "付箋",
          body: "ここにメモを書きます",
          icon: "✎",
          x,
          y,
          w: 260,
          h: 150,
          color: "amber",
        });
        return;
      }
      if (tool === "text") {
        addNode({
          kind: "text",
          title: "テキスト",
          body: "自由に書けるテキストブロック",
          icon: "T",
          x,
          y,
          w: 300,
          h: 110,
          color: "paper",
        });
        return;
      }
      if (tool === "shape") {
        addNode({
          kind: "shape",
          title:
            shapeKind === "ellipse"
              ? "楕円"
              : shapeKind === "diamond"
                ? "ひし形"
                : "図形",
          body: "",
          icon: "□",
          x,
          y,
          w: 220,
          h: 140,
          color: "violet",
          shape: shapeKind,
        });
        return;
      }
      if (tool === "frame") {
        addNode({
          kind: "group",
          title: "フレーム",
          body: "関連するカードをこの枠内にまとめます",
          icon: "▣",
          x,
          y,
          w: 420,
          h: 260,
          color: "paper",
        });
      }
    },
    [addNode, shapeKind],
  );

  const getCanvasPoint = useCallback(
    (clientX: number, clientY: number, snapToGrid = true) => {
      const viewport = viewportRef.current;
      if (!viewport) return { x: 180, y: 160 };
      const rect = viewport.getBoundingClientRect();
      return {
        x: clamp(
          snapToGrid
            ? snap((clientX - rect.left + viewport.scrollLeft) / zoom)
            : (clientX - rect.left + viewport.scrollLeft) / zoom,
          0,
          CANVAS_WIDTH - 1,
        ),
        y: clamp(
          snapToGrid
            ? snap((clientY - rect.top + viewport.scrollTop) / zoom)
            : (clientY - rect.top + viewport.scrollTop) / zoom,
          0,
          CANVAS_HEIGHT - 1,
        ),
      };
    },
    [zoom],
  );

  const addDraftNode = () => {
    const title =
      draft.title.trim() || (mode === "group" ? "グループ" : "メモ");
    addNode({
      kind: mode === "group" ? "group" : "note",
      title,
      body: draft.body.trim(),
      icon: mode === "group" ? "▣" : "✎",
      x: 190 + (board.nodes.length % 5) * 36,
      y: 170 + (board.nodes.length % 6) * 30,
      w: mode === "group" ? 380 : 270,
      h: mode === "group" ? 230 : 150,
      color: mode === "group" ? "violet" : "paper",
    });
    setDraft({ title: "", body: "" });
  };

  const addPageNode = (page: PageWithLock) => {
    addNode({
      kind: "page",
      title: page.title || "無題のページ",
      body: [
        page.properties.status,
        page.properties.priority,
        ...(page.properties.tags || []).slice(0, 3),
      ]
        .filter(Boolean)
        .join(" · "),
      targetId: page.id,
      icon: page.icon || "📄",
      x: 210 + (board.nodes.length % 6) * 38,
      y: 170 + (board.nodes.length % 7) * 28,
      w: 360,
      h: 240,
      color: "blue",
    });
  };

  const addDatabaseNode = (database: WorkspaceDatabase) => {
    addNode({
      kind: "database",
      title: database.title || "無題のデータベース",
      body: `${database.rows.length}行 · ${database.properties.length}プロパティ`,
      targetId: database.id,
      icon: "▦",
      x: 220 + (board.nodes.length % 6) * 38,
      y: 180 + (board.nodes.length % 7) * 28,
      w: 390,
      h: 245,
      color: "green",
    });
  };

  const addGoogleDriveNode = useCallback((file: GoogleDriveFileItem) => {
    const now = Date.now();
    const next = makeNode({
      kind: "google-drive",
      title: file.name,
      body: [
        file.mimeType,
        file.modifiedTime ? `更新: ${new Date(file.modifiedTime).toLocaleString("ja-JP")}` : "",
        file.owners?.[0]?.displayName ? `所有者: ${file.owners[0].displayName}` : "",
      ].filter(Boolean).join("\n"),
      targetId: file.id,
      externalUrl: file.webViewLink,
      mimeType: file.mimeType,
      sourceDriveId: file.driveId,
      icon: file.mimeType.includes("spreadsheet") ? "▦" : file.mimeType.includes("document") ? "📄" : file.mimeType === "application/pdf" ? "📕" : "☁",
      x: snap(360 + boardRef.current.nodes.length * 18),
      y: snap(220 + boardRef.current.nodes.length * 18),
      w: 340,
      h: 180,
      color: "paper",
    }, now);
    saveBoard((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedIds([next.id]);
    onStatus?.(`Google Driveから「${file.name}」を追加しました`);
  }, [boardRef, onStatus, saveBoard]);

  const addGoogleCalendarNode = useCallback((event: GoogleCalendarEventItem) => {
    const now = Date.now();
    const startValue = event.start.dateTime || event.start.date || "";
    const endValue = event.end.dateTime || event.end.date || "";
    const startLabel = startValue ? new Date(startValue.length === 10 ? `${startValue}T00:00:00` : startValue).toLocaleString("ja-JP") : "日時未設定";
    const next = makeNode({
      kind: "google-calendar",
      title: event.summary || "無題の予定",
      body: [
        startLabel,
        endValue ? `終了: ${new Date(endValue.length === 10 ? `${endValue}T00:00:00` : endValue).toLocaleString("ja-JP")}` : "",
        event.location ? `場所: ${event.location}` : "",
        event.attendees?.length ? `参加者: ${event.attendees.length}名` : "",
        event.description || "",
      ].filter(Boolean).join("\n"),
      targetId: event.id,
      externalUrl: event.htmlLink,
      mimeType: "application/vnd.google-calendar.event",
      sourceDriveId: event.calendarId,
      icon: "📅",
      x: snap(390 + boardRef.current.nodes.length * 18),
      y: snap(250 + boardRef.current.nodes.length * 18),
      w: 350,
      h: 190,
      color: "blue",
    }, now);
    saveBoard((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedIds([next.id]);
    onStatus?.(`Google Calendarから「${event.summary}」を追加しました`);
  }, [boardRef, onStatus, saveBoard]);

  const addGoogleGmailNode = useCallback((message: GoogleGmailMessageItem) => {
    const now = Date.now();
    const timestamp = message.internalDate ? Number(message.internalDate) : Date.parse(message.date || "");
    const next = makeNode({
      kind: "google-gmail",
      title: message.subject || "件名なし",
      body: [
        message.from ? `差出人: ${message.from}` : "",
        Number.isFinite(timestamp) ? `日時: ${new Date(timestamp).toLocaleString("ja-JP")}` : "",
        message.attachments.length ? `添付: ${message.attachments.map((item) => item.filename).join("、")}` : "",
        message.snippet || "",
      ].filter(Boolean).join("\n"),
      targetId: message.id,
      externalUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.threadId)}`,
      mimeType: "message/rfc822",
      sourceDriveId: message.threadId,
      icon: "✉",
      x: snap(420 + boardRef.current.nodes.length * 18),
      y: snap(280 + boardRef.current.nodes.length * 18),
      w: 370,
      h: 210,
      color: "amber",
    }, now);
    saveBoard((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedIds([next.id]);
    onStatus?.(`Gmailから「${message.subject}」を追加しました`);
  }, [boardRef, onStatus, saveBoard]);

  useEffect(() => {
    const queued = consumeGoogleWorkspaceQueue();
    if (!queued.length) return;
    const baseNodeCount = boardRef.current.nodes.length;
    const getQueuedNodePosition = (index: number) => {
      const sequence = baseNodeCount + index;
      return {
        x: snap(260 + (sequence % 6) * 38),
        y: snap(210 + (sequence % 7) * 30),
      };
    };
    const sourceRecords = readExternalSourceRecords();
    queued.forEach((item, index) => {
      const position = getQueuedNodePosition(index);
      const sourceKey = item.kind === "calendar" ? `calendar:${item.payload.calendarId}:${item.payload.id}` : `${item.kind}:${item.payload.id}`;
      const sourceRecord = sourceRecords.find((record) => record.key === sourceKey);
      if (item.mode === "import" && sourceRecord) {
        addNode({
          kind: "note",
          title: `取込｜${sourceRecord.title}`,
          body: [sourceRecord.current.content, "", `取得日時: ${new Date(sourceRecord.current.capturedAt).toLocaleString("ja-JP")}`, sourceRecord.externalUrl ? `元データ: ${sourceRecord.externalUrl}` : ""].filter(Boolean).join("\n"),
          icon: "↓",
          color: "blue",
          x: position.x,
          y: position.y,
          w: 420,
          h: 320,
        });
      } else if (item.intent === "meeting-notes" && item.kind === "calendar") {
        const event = item.payload;
        const attendees = (event.attendees || []).map((entry) => entry.displayName || entry.email).filter(Boolean).join("、");
        addNode({
          kind: "note",
          title: `議事録｜${event.summary || "会議"}`,
          body: [`日時: ${event.start.dateTime || event.start.date || ""}`, event.location ? `場所: ${event.location}` : "", attendees ? `参加者: ${attendees}` : "", "", "## アジェンダ", event.description || "", "", "## 決定事項", "", "## TODO", ""].filter((line) => line !== undefined).join("\n"),
          icon: "📝",
          color: "blue",
          x: position.x,
          y: position.y,
          w: 420,
          h: 320,
        });
      } else if (item.intent === "task" && item.kind === "gmail") {
        const message = item.payload;
        addNode({
          kind: "note",
          title: `対応｜${message.subject || "メール"}`,
          body: [`依頼者: ${message.from || ""}`, `元メール: https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.threadId)}`, "", "## 要件", message.snippet || "", "", "## 期限", "", "## 対応メモ", ""].join("\n"),
          icon: "✓",
          color: "amber",
          x: position.x,
          y: position.y,
          w: 400,
          h: 300,
        });
      } else if (item.kind === "drive") addGoogleDriveNode(item.payload);
      else if (item.kind === "calendar") addGoogleCalendarNode(item.payload);
      else addGoogleGmailNode(item.payload);
    });
    onStatus?.(`${queued.length}件の外部ソースをホワイトボードへ追加しました`);
  }, [addGoogleCalendarNode, addGoogleDriveNode, addGoogleGmailNode, addNode, onStatus]);

  useEffect(() => {
    const queued = consumeWebProjectWhiteboardQueue();
    if (!queued) return;
    const exists = boardRef.current.nodes.some((node) => node.kind === "web-project" && node.targetId === queued.projectId);
    if (exists) {
      onStatus?.("このWebプロジェクトはすでにホワイトボードにあります");
      return;
    }
    const positionIndex = boardRef.current.nodes.length;
    addNode({
      kind: "web-project",
      title: queued.title,
      body: "HTML・CSS・JavaScript Webプロジェクト",
      targetId: queued.projectId,
      icon: "</>",
      color: "violet",
      x: snap(300 + (positionIndex % 6) * 42),
      y: snap(230 + (positionIndex % 7) * 32),
      w: 420,
      h: 300,
    });
    onStatus?.(`Webプロジェクト「${queued.title}」を追加しました`);
  }, [addNode, boardRef, onStatus]);

  const addPdfNode = (attachment: AttachmentInfo) => {
    addNode({
      kind: "pdf",
      title: attachment.fileName || "PDF",
      body: [
        pageTitleById.get(attachment.pageId) || "添付PDF",
        formatBytes(attachment.size),
        formatUpdatedAt(Date.parse(attachment.createdAt) || Date.now()),
      ]
        .filter(Boolean)
        .join(" · "),
      targetId: `${attachment.pageId}:${attachment.id}`,
      icon: "📕",
      x: 230 + (board.nodes.length % 6) * 38,
      y: 190 + (board.nodes.length % 7) * 28,
      w: 330,
      h: 230,
      color: "rose",
    });
  };

  const removeSelected = () => {
    if (selectedLinkId) {
      saveBoard((current) => ({
        ...current,
        links: current.links.filter((link) => link.id !== selectedLinkId),
      }));
      setSelectedLinkId(null);
      onStatus?.("接続線を削除しました");
      return;
    }
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    saveBoard((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !selected.has(node.id)),
      links: current.links.filter(
        (link) => !selected.has(link.fromId) && !selected.has(link.toId),
      ),
    }));
    setSelectedIds([]);
  };

  const insertClipboardPayload = useCallback(
    (payload: FreeformClipboardPayload, offset = 34) => {
      const cloned = cloneClipboardPayload(payload, offset);
      if (!cloned.nodes.length) return;
      saveBoard((current) => ({
        ...current,
        nodes: [...current.nodes, ...cloned.nodes],
        links: [...current.links, ...cloned.links],
      }));
      setSelectedLinkId(null);
      setSelectedIds(cloned.nodes.map((node) => node.id));
      onStatus?.(`${cloned.nodes.length}件を貼り付けました`);
    },
    [onStatus, saveBoard],
  );

  const copySelected = useCallback(async () => {
    const payload = createClipboardPayload(boardRef.current, selectedIds);
    if (!payload) return;
    clipboardRef.current = payload;
    pasteCountRef.current = 0;
    try {
      await navigator.clipboard?.writeText(serializeClipboardPayload(payload));
    } catch {
      // The in-memory clipboard remains available when system clipboard access is denied.
    }
    onStatus?.(`${payload.nodes.length}件をコピーしました`);
  }, [boardRef, onStatus, selectedIds]);

  const pasteSelected = useCallback(async () => {
    let payload = clipboardRef.current;
    if (!payload) {
      try {
        payload = parseClipboardPayload(await navigator.clipboard.readText());
      } catch {
        payload = null;
      }
    }
    if (!payload) {
      onStatus?.("貼り付けできるホワイトボード要素がありません");
      return;
    }
    pasteCountRef.current += 1;
    insertClipboardPayload(payload, 34 * pasteCountRef.current);
  }, [insertClipboardPayload, onStatus]);

  const cutSelected = useCallback(async () => {
    if (!selectedIds.length) return;
    await copySelected();
    const selected = new Set(selectedIds);
    saveBoard((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !selected.has(node.id)),
      links: current.links.filter(
        (link) => !selected.has(link.fromId) && !selected.has(link.toId),
      ),
    }));
    setSelectedIds([]);
  }, [copySelected, saveBoard, selectedIds]);

  const duplicateSelected = useCallback(() => {
    const payload = createClipboardPayload(boardRef.current, selectedIds);
    if (!payload) return;
    insertClipboardPayload(payload, 34);
    onStatus?.("選択カードを複製しました");
  }, [boardRef, insertClipboardPayload, onStatus, selectedIds]);

  const focusNode = useCallback((node: FreeformNode) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setSelectedLinkId(null);
    setSelectedIds([node.id]);
    setNodeFinderOpen(false);
    window.requestAnimationFrame(() => {
      viewport.scrollTo({
        left: Math.max(0, (node.x + node.w / 2) * zoom - viewport.clientWidth / 2),
        top: Math.max(0, (node.y + node.h / 2) * zoom - viewport.clientHeight / 2),
        behavior: "smooth",
      });
    });
  }, [zoom]);

  const fitView = useCallback(
    (nodes: FreeformNode[] = board.nodes) => {
      const viewport = viewportRef.current;
      const bounds = getBounds(nodes);
      if (!viewport || !bounds) return;
      const padding = 180;
      const width = Math.max(360, bounds.maxX - bounds.minX + padding * 2);
      const height = Math.max(260, bounds.maxY - bounds.minY + padding * 2);
      const nextZoom = clamp(
        Math.min(viewport.clientWidth / width, viewport.clientHeight / height),
        0.55,
        1.15,
      );
      setZoom(nextZoom);
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, (bounds.minX - padding) * nextZoom);
        viewport.scrollTop = Math.max(0, (bounds.minY - padding) * nextZoom);
      });
    },
    [board.nodes],
  );

  const downloadBoard = useCallback(() => {
    const blob = new Blob([exportFreeformBoard(boardRef.current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `freeform-board-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onStatus?.("ホワイトボードを書き出しました");
  }, [boardRef, onStatus]);

  const handleBoardImport = useCallback(async (file: File) => {
    try {
      const imported = importFreeformBoard(await file.text());
      saveBoard(() => imported);
      setSelectedIds([]);
      setSelectedLinkId(null);
      fitView(imported.nodes);
      onStatus?.("ホワイトボードを読み込みました");
    } catch (error) {
      console.error("Failed to import freeform board", error);
      onStatus?.("このJSONはホワイトボードとして読み込めません");
    }
  }, [fitView, onStatus, saveBoard]);

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = nowId("logical-group");
    const selected = new Set(selectedIds);
    saveBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        selected.has(node.id) ? { ...node, groupId, updatedAt: Date.now() } : node,
      ),
    }));
    onStatus?.(`${selectedIds.length}件をグループ化しました`);
  }, [onStatus, saveBoard, selectedIds]);

  const ungroupSelected = useCallback(() => {
    const groupIds = new Set(
      selectedIds
        .map((id) => boardRef.current.nodes.find((node) => node.id === id)?.groupId)
        .filter((id): id is string => Boolean(id)),
    );
    if (!groupIds.size) return;
    saveBoard((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.groupId && groupIds.has(node.groupId)
          ? { ...node, groupId: undefined, updatedAt: Date.now() }
          : node,
      ),
    }));
    onStatus?.("グループを解除しました");
  }, [boardRef, onStatus, saveBoard, selectedIds]);

  const updateLink = useCallback(
    (id: string, patch: Partial<FreeformLink>) => {
      saveBoard((current) => ({
        ...current,
        links: current.links.map((link) =>
          link.id === id ? { ...link, ...patch } : link,
        ),
      }));
    },
    [saveBoard],
  );

  const connectPair = useCallback(
    (fromId: string, toId: string, fromHandle?: FreeformAnchor, toHandle?: FreeformAnchor) => {
      if (fromId === toId) return;
      saveBoard((current) => {
        const exists = current.links.some(
          (link) =>
            (link.fromId === fromId && link.toId === toId) ||
            (link.fromId === toId && link.toId === fromId),
        );
        if (exists) return current;
        return {
          ...current,
          links: [
            ...current.links,
            { id: nowId("link"), fromId, toId, color: "#64748b", width: 2, dashed: false, edgeType: "bezier", bidirectional: false, fromHandle, toHandle, createdAt: Date.now() },
          ],
        };
      });
      onStatus?.("カードを線でつなぎました");
    },
    [onStatus, saveBoard],
  );

  const startConnectorDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, fromId: string, fromHandle: FreeformAnchor) => {
      event.preventDefault();
      event.stopPropagation();
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      connectorDragRef.current = { pointerId: event.pointerId, fromId, fromHandle };
      setConnectorDraft({ fromId, fromHandle, x: point.x, y: point.y, targetId: null, toHandle: null });
      event.currentTarget.setPointerCapture(event.pointerId);
      setSelectedLinkId(null);
    },
    [getCanvasPoint],
  );

  const moveConnectorDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = connectorDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      const hit = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-freeform-node-id]");
      const candidateId = hit?.dataset.freeformNodeId || null;
      const targetId =
        candidateId && candidateId !== drag.fromId ? candidateId : null;
      const targetNode = targetId ? nodeMap.get(targetId) : undefined;
      setConnectorDraft({
        fromId: drag.fromId,
        fromHandle: drag.fromHandle,
        x: point.x,
        y: point.y,
        targetId,
        toHandle: targetNode ? nearestAnchor(targetNode, point) : null,
      });
    },
    [getCanvasPoint, nodeMap],
  );

  const endConnectorDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = connectorDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const targetId = connectorDraft?.targetId || null;
      connectorDragRef.current = null;
      setConnectorDraft(null);
      if (!targetId) {
        onStatus?.("接続先のカードまでドラッグしてください");
        return;
      }
      connectPair(drag.fromId, targetId, drag.fromHandle, connectorDraft?.toHandle || undefined);
      setSelectedIds([drag.fromId, targetId]);
    },
    [connectPair, connectorDraft?.targetId, connectorDraft?.toHandle, onStatus],
  );

  const connectSelected = () => {
    if (selectedIds.length !== 2) {
      onStatus?.("2つのカードを選択すると線でつなげます");
      return;
    }
    connectPair(selectedIds[0], selectedIds[1]);
  };

  const bringSelectedToFront = () => {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    saveBoard((current) => ({
      ...current,
      nodes: [
        ...current.nodes.filter((node) => !selected.has(node.id)),
        ...current.nodes.filter((node) => selected.has(node.id)),
      ],
    }));
  };

  const clearBoard = () => {
    if (!window.confirm("キャンバスを空にしますか？")) return;
    saveBoard((current) => ({ ...current, nodes: [], links: [] }));
    setSelectedIds([]);
  };

  const applyTemplate = (template: CanvasTemplate) => {
    const timestamp = Date.now();
    const baseX = 260 + (board.nodes.length % 4) * 48;
    const baseY = 220 + (board.nodes.length % 4) * 44;
    const make = (node: Omit<FreeformNode, "id" | "createdAt" | "updatedAt">) =>
      makeNode(node, timestamp);
    let nodes: FreeformNode[] = [];
    let links: FreeformLink[] = [];
    if (template === "brainstorm") {
      const center = make({
        kind: "note",
        title: "テーマ",
        body: "ここに考えたいテーマを書きます",
        icon: "✦",
        x: baseX + 210,
        y: baseY + 150,
        w: 260,
        h: 150,
        color: "violet",
      });
      const ideas = ["論点", "資料", "課題", "次の行動"].map((title, index) =>
        make({
          kind: "note",
          title,
          body: "",
          icon: "✎",
          x: baseX + [0, 500, 60, 480][index],
          y: baseY + [30, 30, 340, 340][index],
          w: 230,
          h: 130,
          color: COLORS[(index + 1) as 1 | 2 | 3 | 4],
        }),
      );
      nodes = [center, ...ideas];
      links = ideas.map((node) => ({
        id: nowId("link"),
        fromId: center.id,
        toId: node.id,
        createdAt: timestamp,
      }));
    } else if (template === "workflow") {
      nodes = ["入力", "整理", "確認", "完了"].map((title, index) =>
        make({
          kind: "note",
          title,
          body: index === 0 ? "情報の入口" : "",
          icon: index === 3 ? "✓" : "→",
          x: baseX + index * 260,
          y: baseY + 130,
          w: 220,
          h: 130,
          color: index === 3 ? "green" : "blue",
        }),
      );
      links = nodes.slice(0, -1).map((node, index) => ({
        id: nowId("link"),
        fromId: node.id,
        toId: nodes[index + 1].id,
        createdAt: timestamp,
      }));
    } else {
      nodes = [
        make({
          kind: "group",
          title: "A案",
          body: "",
          icon: "A",
          x: baseX,
          y: baseY,
          w: 340,
          h: 250,
          color: "blue",
        }),
        make({
          kind: "group",
          title: "B案",
          body: "",
          icon: "B",
          x: baseX + 400,
          y: baseY,
          w: 340,
          h: 250,
          color: "amber",
        }),
        make({
          kind: "note",
          title: "判断基準",
          body: "費用・速度・安全性・運用性",
          icon: "◆",
          x: baseX + 220,
          y: baseY + 310,
          w: 300,
          h: 130,
          color: "paper",
        }),
      ];
    }
    saveBoard((current) => ({
      ...current,
      nodes: [...current.nodes, ...nodes],
      links: [...current.links, ...links],
    }));
    setSelectedIds(nodes.map((node) => node.id));
    onStatus?.("テンプレートを追加しました");
  };

  const applyLayout = useCallback((mode: FreeformLayoutMode = layoutMode) => {
    const target = selectedNodes.length ? selectedNodes : board.nodes.filter((node) => node.kind !== "group");
    if (!target.length) return;
    const targetIds = new Set(target.map((node) => node.id));
    saveBoard((current) => ({
      ...current,
      nodes: layoutNodes(current.nodes, current.links, targetIds, mode),
    }));
    onStatus?.(mode === "flow-right" ? "接続に沿って左から右へ配置しました" : mode === "flow-down" ? "接続に沿って上から下へ配置しました" : "グリッド配置しました");
  }, [board.nodes, layoutMode, onStatus, saveBoard, selectedNodes]);

  const alignSelection = useCallback((mode: FreeformAlignMode) => {
    if (selectedIds.length < 2) return;
    const targetIds = new Set(selectedIds);
    saveBoard((current) => ({ ...current, nodes: alignNodes(current.nodes, targetIds, mode) }));
  }, [saveBoard, selectedIds]);

  const distributeSelection = useCallback((mode: FreeformDistributeMode) => {
    if (selectedIds.length < 3) return;
    const targetIds = new Set(selectedIds);
    saveBoard((current) => ({ ...current, nodes: distributeNodes(current.nodes, targetIds, mode) }));
  }, [saveBoard, selectedIds]);

  const openInlinePageEditor = useCallback(async (node: FreeformNode) => {
    if (node.kind !== "page" || !node.targetId) return;
    if (!loadPage || !savePage) {
      onOpenPage(node.targetId);
      return;
    }
    try {
      const bundle = await loadPage(node.targetId);
      setInlinePageBundle(bundle);
      saveBoard((current) => ({
        ...current,
        nodes: current.nodes.map((item) =>
          item.id === node.id
            ? { ...item, w: Math.max(item.w, 560), h: Math.max(item.h, 420), updatedAt: Date.now() }
            : item,
        ),
      }));
      setInlinePageNodeId(node.id);
      setSelectedIds([node.id]);
      setSelectedLinkId(null);
    } catch (error) {
      console.error("Failed to open inline page editor", error);
      onStatus?.("ページをキャンバス内で開けませんでした");
    }
  }, [loadPage, onOpenPage, onStatus, saveBoard, savePage]);

  const saveInlinePage = useCallback(async (changes: { title: string; markdown: string }) => {
    if (!inlinePageBundle || !inlinePageNodeId || !savePage) return;
    setInlinePageSaving(true);
    try {
      const saved = await savePage(inlinePageBundle, changes);
      setInlinePageBundle(saved);
      setPagePreviewCache((current) => ({
        ...current,
        [saved.meta.id]: { loading: false, markdown: saved.markdown || "", loadedAt: Date.now() },
      }));
      saveBoard((current) => ({
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === inlinePageNodeId
            ? {
                ...node,
                title: saved.meta.title,
                body: saved.markdown.slice(0, 600),
                updatedAt: Date.now(),
              }
            : node,
        ),
      }));
      setInlinePageNodeId(null);
      setInlinePageBundle(null);
      onStatus?.("ページをキャンバス内で保存しました");
    } catch (error) {
      console.error("Failed to save inline page", error);
      onStatus?.("ページを保存できませんでした");
    } finally {
      setInlinePageSaving(false);
    }
  }, [inlinePageBundle, inlinePageNodeId, onStatus, saveBoard, savePage]);

  const generateKnowledgeGraph = useCallback(() => {
    if (knowledgeGraphBusy) return;
    setKnowledgeGraphBusy(true);
    try {
      const selectedKnowledgeNodes = selectedNodes.filter((node) =>
        node.kind === "page" || node.kind === "google-drive",
      );
      if (selectedKnowledgeNodes.length >= 2) {
        const links = WhiteboardEngine.ai.buildExistingNodeKnowledgeLinks(
          selectedKnowledgeNodes,
          boardRef.current.links,
        );
        if (!links.length) {
          onStatus?.("選択したノード間に新しい関連候補はありませんでした");
          return;
        }
        saveBoard((current) => ({ ...current, links: [...current.links, ...links] }));
        onStatus?.(`選択ノードへKnowledge Graph接続を${links.length}件追加しました`);
        return;
      }
      const selectedPageIds = selectedNodes
        .filter((node) => node.kind === "page" && node.targetId)
        .map((node) => node.targetId as string);
      const sourcePages = selectedPageIds.length >= 2
        ? pages.filter((page) => selectedPageIds.includes(page.id))
        : pages;
      const viewport = viewportRef.current;
      const origin = {
        x: viewport ? viewport.scrollLeft / zoom + 120 : 220,
        y: viewport ? viewport.scrollTop / zoom + 120 : 180,
      };
      const graph = WhiteboardEngine.ai.buildKnowledgeGraph(sourcePages, origin, 32);
      if (!graph.nodes.length) {
        onStatus?.("Knowledge Graphにできるページがありません");
        return;
      }
      const graphIds = new Set(graph.nodes.map((node) => node.id));
      saveBoard((current) => {
        const nodes = [...current.nodes, ...graph.nodes];
        const links = [...current.links, ...graph.links];
        return {
          ...current,
          nodes: layoutNodes(nodes, links, graphIds, "flow-right"),
          links,
        };
      });
      setSelectedIds(graph.nodes.map((node) => node.id));
      window.requestAnimationFrame(() => fitView(graph.nodes));
      onStatus?.(`Knowledge Graphを生成しました（${graph.nodes.length}ノード・${graph.links.length}接続）`);
    } finally {
      setKnowledgeGraphBusy(false);
    }
  }, [boardRef, fitView, knowledgeGraphBusy, onStatus, pages, saveBoard, selectedNodes, zoom]);

  useEffect(() => {
    window.requestAnimationFrame(() => fitView(board.nodes));
    // 初回だけ中央へ寄せる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrawing = useCallback(
    (event: React.PointerEvent<Element>, mode: "draw" | "ruler") => {
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      const points = mode === "ruler" ? [point, point] : [point];
      drawRef.current = { pointerId: event.pointerId, points, mode };
      setDraftStroke(points);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getCanvasPoint],
  );

  const handleNodePointerDown = (
    event: React.PointerEvent<Element>,
    node: FreeformNode,
  ) => {
    if (
      (event.target as HTMLElement).closest("button, input, textarea, select")
    )
      return;
    if (canvasTool === "draw" || canvasTool === "ruler") {
      event.preventDefault();
      event.stopPropagation();
      startDrawing(event, canvasTool);
      return;
    }
    if (canvasTool === "eraser" && node.kind === "drawing") {
      event.preventDefault();
      event.stopPropagation();
      saveBoard((current) => ({
        ...current,
        nodes: current.nodes.filter((item) => item.id !== node.id),
        links: current.links.filter(
          (link) => link.fromId !== node.id && link.toId !== node.id,
        ),
      }));
      setSelectedIds([]);
      onStatus?.("手書きを消しました");
      return;
    }
    if (canvasTool === "connector") {
      event.preventDefault();
      event.stopPropagation();
      if (!connectorStartId) {
        setConnectorStartId(node.id);
        setSelectedIds([node.id]);
        onStatus?.("接続先のカードをクリックしてください");
      } else {
        connectPair(connectorStartId, node.id);
        setConnectorStartId(null);
        setSelectedIds([connectorStartId, node.id]);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedLinkId(null);
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const groupedIds = node.groupId
      ? boardRef.current.nodes.filter((item) => item.groupId === node.groupId).map((item) => item.id)
      : [node.id];
    const groupAlreadySelected = groupedIds.every((id) => selectedIds.includes(id));
    const nextSelection = additive
      ? groupAlreadySelected
        ? selectedIds.filter((id) => !groupedIds.includes(id))
        : Array.from(new Set([...selectedIds, ...groupedIds]))
      : groupAlreadySelected
        ? selectedIds
        : groupedIds;
    setSelectedIds(nextSelection);
    const baseDragIds = nextSelection.includes(node.id) ? nextSelection : [node.id];
    const selectedGroupIds = new Set(
      baseDragIds
        .map((id) => boardRef.current.nodes.find((item) => item.id === id)?.groupId)
        .filter((id): id is string => Boolean(id)),
    );
    const logicalGroupPeerIds = boardRef.current.nodes
      .filter((item) => item.groupId && selectedGroupIds.has(item.groupId))
      .map((item) => item.id);
    const frameChildIds = new Set(
      boardRef.current.nodes
        .filter((item) =>
          baseDragIds.some(
            (id) => item.parentFrameId === id ||
              (boardRef.current.nodes.find((candidate) => candidate.id === id)?.kind === "group" &&
                nodeContainsNode(boardRef.current.nodes.find((candidate) => candidate.id === id)!, item)),
          ),
        )
        .map((item) => item.id),
    );
    const dragIds = Array.from(new Set([...baseDragIds, ...logicalGroupPeerIds, ...frameChildIds]));
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      before: boardRef.current,
      moved: false,
      nodes: dragIds
        .map((id) => boardRef.current.nodes.find((item) => item.id === id))
        .filter((item): item is FreeformNode => Boolean(item))
        .map((item) => ({
          id: item.id,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
    };
  };

  const handleNodePointerMove = (event: React.PointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rawDx = (event.clientX - drag.startX) / zoom;
    const rawDy = (event.clientY - drag.startY) / zoom;
    if (Math.hypot(rawDx, rawDy) > 2) drag.moved = true;
    const movingIds = new Set(drag.nodes.map((item) => item.id));
    const stationary = boardRef.current.nodes.filter((item) => !movingIds.has(item.id) && !hiddenNodeIds.has(item.id));
    const snapped = event.shiftKey
      ? { dx: rawDx, dy: rawDy, guides: [] as FreeformGuide[] }
      : calculateSnapDelta(drag.nodes, stationary, rawDx, rawDy);
    setSnapGuides(snapped.guides);
    const positions = new Map(
      drag.nodes.map((item) => [
        item.id,
        {
          x: clamp(event.altKey ? item.x + snapped.dx : snap(item.x + snapped.dx), 0, CANVAS_WIDTH - item.w),
          y: clamp(event.altKey ? item.y + snapped.dy : snap(item.y + snapped.dy), 0, CANVAS_HEIGHT - item.h),
        },
      ]),
    );
    const timestamp = Date.now();
    setBoard((current) => {
      const next = {
        ...current,
        updatedAt: timestamp,
        nodes: current.nodes.map((item) => {
          const position = positions.get(item.id);
          return position
            ? { ...item, ...position, updatedAt: timestamp }
            : item;
        }),
      };
      boardRef.current = next;
      return next;
    });
  };

  const handleNodePointerUp = (event: React.PointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setSnapGuides([]);
    if (drag.moved) {
      const movedIds = new Set(drag.nodes.map((item) => item.id));
      setBoard((current) => {
        const frames = current.nodes.filter((item) => item.kind === "group");
        const nodes = current.nodes.map((item) => {
          if (!movedIds.has(item.id) || item.kind === "group") return item;
          return { ...item, parentFrameId: resolveParentFrameId(item, frames) };
        });
        const next = { ...current, nodes, updatedAt: Date.now() };
        boardRef.current = next;
        return next;
      });
      window.requestAnimationFrame(commitCurrentToHistory);
    }
  };

  const handleViewportPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const target = event.target as HTMLElement;
    setSelectedLinkId(null);
    if (
      target.closest(
        ".freeform-node, .freeform-ink-path, .freeform-blocksuite-toolbar, .freeform-freeboard-toolbar, .freeform-zoom-dock, .freeform-minimap",
      )
    )
      return;
    if (canvasTool === "draw" || canvasTool === "ruler") {
      startDrawing(event, canvasTool);
      return;
    }
    if (canvasTool === "eraser") {
      eraseRef.current = { pointerId: event.pointerId, ids: new Set<string>() };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (
      canvasTool === "sticky" ||
      canvasTool === "text" ||
      canvasTool === "shape" ||
      canvasTool === "frame" ||
      canvasTool === "connector" ||
      canvasTool === "image"
    ) {
      if (!event.shiftKey) setSelectedIds([]);
      return;
    }
    const shouldPan = canvasTool === "hand" || spacePressedRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (shouldPan) {
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
      };
      return;
    }
    if (canvasTool === "select") {
      const start = getCanvasPoint(event.clientX, event.clientY, false);
      selectionRef.current = {
        pointerId: event.pointerId,
        start,
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
        initialIds: selectedIds,
      };
      if (!selectionRef.current.additive) setSelectedIds([]);
      setSelectionBox({ x: start.x, y: start.y, w: 0, h: 0 });
    }
  };

  const handleViewportPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drawing = drawRef.current;
    if (drawing && drawing.pointerId === event.pointerId) {
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      if (drawing.mode === "ruler") {
        const start = drawing.points[0];
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        const length = Math.hypot(dx, dy);
        const snappedAngle =
          Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        drawing.points = [
          start,
          {
            x: start.x + Math.cos(snappedAngle) * length,
            y: start.y + Math.sin(snappedAngle) * length,
          },
        ];
      } else {
        const last = drawing.points[drawing.points.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2)
          drawing.points = [...drawing.points, point];
      }
      if (strokeFrameRef.current == null) {
        strokeFrameRef.current = window.requestAnimationFrame(() => {
          strokeFrameRef.current = null;
          setDraftStroke([...drawRef.current?.points || []]);
        });
      }
      return;
    }
    const erasing = eraseRef.current;
    if (erasing && erasing.pointerId === event.pointerId) {
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      for (const node of boardRef.current.nodes) {
        if (node.kind !== "drawing") continue;
        if (drawingHitTest(node, point)) erasing.ids.add(node.id);
      }
      if (erasing.ids.size) setSelectedIds(Array.from(erasing.ids));
      return;
    }
    const selection = selectionRef.current;
    if (selection?.pointerId === event.pointerId) {
      const point = getCanvasPoint(event.clientX, event.clientY, false);
      const box = {
        x: Math.min(selection.start.x, point.x),
        y: Math.min(selection.start.y, point.y),
        w: Math.abs(point.x - selection.start.x),
        h: Math.abs(point.y - selection.start.y),
      };
      setSelectionBox(box);
      const inside = boardRef.current.nodes
        .filter(
          (node) =>
            node.x < box.x + box.w &&
            node.x + node.w > box.x &&
            node.y < box.y + box.h &&
            node.y + node.h > box.y,
        )
        .map((node) => node.id);
      setSelectedIds(
        selection.additive
          ? Array.from(new Set([...selection.initialIds, ...inside]))
          : inside,
      );
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const handleViewportPointerUp = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const drawing = drawRef.current;
    if (drawing?.pointerId === event.pointerId) {
      drawRef.current = null;
      setDraftStroke([]);
      if (drawing.points.length > 1) {
        const normalizedPoints = drawing.mode === "ruler"
          ? drawing.points
          : simplifyStrokePoints(drawing.points, Math.max(0.8, penWidth * 0.3));
        const xs = normalizedPoints.map((point) => point.x);
        const ys = normalizedPoints.map((point) => point.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        const padding = Math.max(6, penWidth * 2);
        addNode({
          kind: "drawing",
          title: drawing.mode === "ruler" ? "直線" : "描画",
          body: JSON.stringify(
            normalizedPoints.map((point) => ({
              x: point.x - minX + padding,
              y: point.y - minY + padding,
            })),
          ),
          icon: drawing.mode === "ruler" ? "／" : "✎",
          x: minX - padding,
          y: minY - padding,
          w: Math.max(padding * 2 + 1, maxX - minX + padding * 2),
          h: Math.max(padding * 2 + 1, maxY - minY + padding * 2),
          color: "blue",
          strokeColor: penColor,
          strokeWidth: penWidth,
        }, { select: false, status: false });
      }
      return;
    }
    const erasing = eraseRef.current;
    if (erasing?.pointerId === event.pointerId) {
      eraseRef.current = null;
      const ids = erasing.ids;
      if (ids.size) {
        saveBoard((current) => ({
          ...current,
          nodes: current.nodes.filter((node) => !ids.has(node.id)),
          links: current.links.filter(
            (link) => !ids.has(link.fromId) && !ids.has(link.toId),
          ),
        }));
        setSelectedIds([]);
        onStatus?.(`${ids.size}件の手書きを消しました`);
      }
      return;
    }
    if (selectionRef.current?.pointerId === event.pointerId) {
      selectionRef.current = null;
      setSelectionBox(null);
    }
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (canvasTool !== "select") return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (canvasTool === "select") {
      const timestamp = Date.now();
      const node = makeNode(
        {
          kind: "text",
          title: "",
          body: "",
          icon: "T",
          x: point.x,
          y: point.y,
          w: 320,
          h: 120,
          color: "paper",
        },
        timestamp,
      );
      saveBoard((current) => ({ ...current, nodes: [...current.nodes, node] }));
      setSelectedIds([node.id]);
      setEditingNodeId(node.id);
      return;
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!["sticky", "text", "shape", "frame", "image"].includes(canvasTool))
      return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    if (canvasTool === "image") {
      imageInputRef.current?.click();
      return;
    }
    addNodeAt(canvasTool, point.x, point.y);
    setCanvasTool("select");
  };

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 20 * 1024 * 1024) {
      onStatus?.("画像は20MB以下にしてください");
      return;
    }
    try {
      const assetId = await putFreeformAsset(file, file.name);
      const viewport = viewportRef.current;
      const x = viewport
        ? (viewport.scrollLeft + viewport.clientWidth / 2) / zoom - 180
        : 220;
      const y = viewport
        ? (viewport.scrollTop + viewport.clientHeight / 2) / zoom - 120
        : 180;
      addNode({
        kind: "image",
        title: file.name,
        body: assetId,
        icon: "🖼",
        x: clamp(x, 0, CANVAS_WIDTH - 360),
        y: clamp(y, 0, CANVAS_HEIGHT - 240),
        w: 360,
        h: 240,
        color: "paper",
      });
      setCanvasTool("select");
    } catch (error) {
      console.error("Failed to add freeform image", error);
      onStatus?.("画像を保存できませんでした");
    }
  };

  const handleMiniMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratioX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const ratioY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    viewport.scrollLeft =
      CANVAS_WIDTH * zoom * ratioX - viewport.clientWidth / 2;
    viewport.scrollTop =
      CANVAS_HEIGHT * zoom * ratioY - viewport.clientHeight / 2;
  };

  const handleViewportWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left + viewport.scrollLeft) / zoom;
    const canvasY = (event.clientY - rect.top + viewport.scrollTop) / zoom;
    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.35, 1.8);
    setZoom(nextZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = canvasX * nextZoom - (event.clientX - rect.left);
      viewport.scrollTop = canvasY * nextZoom - (event.clientY - rect.top);
    });
  }, [zoom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        viewportRef.current?.classList.add("space-pan-active");
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setNodeFinderOpen(true);
        setNodeFinderQuery("");
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        if (selectedIds.length) {
          event.preventDefault();
          void copySelected();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        if (selectedIds.length) {
          event.preventDefault();
          void cutSelected();
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pasteSelected();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedLinkId(null);
        setSelectedIds(boardRef.current.nodes.filter((node) => node.kind !== "drawing").map((node) => node.id));
        return;
      }
      if (mod && event.key === "0") {
        event.preventDefault();
        fitView(boardRef.current.nodes);
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selectedIds.length) {
        event.preventDefault();
        const amount = event.shiftKey ? 24 : 4;
        const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
        const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
        const ids = new Set(selectedIds);
        saveBoard((current) => ({ ...current, nodes: current.nodes.map((node) => ids.has(node.id) ? { ...node, x: clamp(node.x + dx, 0, CANVAS_WIDTH - node.w), y: clamp(node.y + dy, 0, CANVAS_HEIGHT - node.h), updatedAt: Date.now() } : node) }));
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length || selectedLinkId) {
          event.preventDefault();
          removeSelected();
        }
        return;
      }
      const map: Record<string, FreeformCanvasTool> = {
        v: "select",
        h: "hand",
        n: "sticky",
        t: "text",
        s: "shape",
        f: "frame",
        c: "connector",
        p: "draw",
        e: "eraser",
        r: "ruler",
        i: "image",
      };
      const tool = map[event.key.toLowerCase()];
      if (tool) {
        event.preventDefault();
        setCanvasTool(tool);
        setConnectorStartId(null);
      }
      if (event.key === "Escape") {
        setCanvasTool("select");
        setConnectorStartId(null);
        setEditingNodeId(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      spacePressedRef.current = false;
      viewportRef.current?.classList.remove("space-pan-active");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      spacePressedRef.current = false;
    };
  }, [boardRef, copySelected, cutSelected, duplicateSelected, fitView, pasteSelected, redo, removeSelected, saveBoard, selectedIds, selectedLinkId, undo]);

  useEffect(
    () => () => {
      objectUrlRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlRef.current.clear();
      if (strokeFrameRef.current != null) window.cancelAnimationFrame(strokeFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let published = false;
    const objectUrls: string[] = [];

    const registerObjectUrl = (nodeId: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return null;
      }
      objectUrls.push(url);
      objectUrlRef.current.add(url);
      return [nodeId, url] as const;
    };

    const loadImages = async () => {
      const loadedEntries: Array<readonly [string, string]> = [];
      for (const node of board.nodes) {
        if (cancelled) break;
        if (node.kind !== "image" || !node.body || imageUrls[node.id]) continue;
        try {
          if (node.body.startsWith("data:")) {
            const blob = await dataUrlToBlob(node.body);
            if (cancelled) break;
            const assetId = await putFreeformAsset(blob, node.title || "image");
            if (cancelled) break;
            const entry = registerObjectUrl(node.id, blob);
            if (!entry) break;
            loadedEntries.push(entry);
            setBoard((current) => ({
              ...current,
              nodes: current.nodes.map((item) =>
                item.id === node.id
                  ? { ...item, body: assetId, updatedAt: Date.now() }
                  : item,
              ),
            }));
          } else if (node.body.startsWith("asset:")) {
            const asset = await getFreeformAsset(node.body);
            if (cancelled) break;
            if (asset) {
              const entry = registerObjectUrl(node.id, asset.blob);
              if (!entry) break;
              loadedEntries.push(entry);
            }
          }
        } catch (error) {
          console.error("Failed to load freeform image", error);
        }
      }
      if (!cancelled && loadedEntries.length) {
        setImageUrls((current) => ({
          ...current,
          ...Object.fromEntries(loadedEntries),
        }));
        published = true;
      }
    };

    void loadImages();
    return () => {
      cancelled = true;
      if (!published) {
        objectUrls.forEach((url) => {
          URL.revokeObjectURL(url);
          objectUrlRef.current.delete(url);
        });
      }
    };
  }, [board.nodes, imageUrls]);

  const renderNodePreview = (node: FreeformNode) => {
    if (node.kind === "image" && node.body)
      return (
        <div className="freeform-image-crop-frame">
          <img
            className="freeform-image-preview"
            src={
              imageUrls[node.id] ||
              (node.body.startsWith("data:") ? node.body : "")
            }
            alt={node.title || "画像"}
            draggable={false}
            style={{
              objectPosition: `${node.cropX ?? 50}% ${node.cropY ?? 50}%`,
              transform: `scale(${node.cropScale ?? 1})`,
            }}
          />
        </div>
      );
    if (node.kind === "page" && node.targetId) {
      const page = pageById.get(node.targetId);
      const loaded = pagePreviewCache[node.targetId];
      const blocks = buildPagePreviewBlocks(
        loaded?.markdown,
        page?.previewSnippet || node.body,
        24,
      );
      return (
        <div className="freeform-preview freeform-page-preview">
          <div className="freeform-preview-paper">
            <div className="freeform-preview-title">
              {page?.icon || node.icon || "📄"} {page?.title || node.title}
            </div>
            {loaded?.loading && !blocks.length && (
              <div className="freeform-preview-loading">
                本文を読み込み中…
              </div>
            )}
            {loaded?.error && !blocks.length && (
              <div className="freeform-preview-loading is-error">
                本文を取得できませんでした
              </div>
            )}
            <div className="freeform-page-lines">
              {blocks.length ? (
                blocks.map((line, index) => (
                  <div
                    key={`${line.kind}-${index}`}
                    className={`freeform-page-line kind-${line.kind}`}
                  >
                    <i>
                      {line.kind === "heading"
                        ? "H"
                        : line.kind === "list"
                          ? "•"
                          : line.kind === "quote"
                            ? "”"
                            : line.kind === "code"
                              ? "{}"
                              : ""}
                    </i>
                    <span>{line.text}</span>
                  </div>
                ))
              ) : (
                <div className="freeform-page-line muted">
                  <span>本文プレビューは未作成です</span>
                </div>
              )}
            </div>
          </div>
          <div className="freeform-preview-meta">
            {(page?.properties.tags || []).slice(0, 4).map((tag) => (
              <em key={tag}>#{tag}</em>
            ))}
            {page?.properties.status && <em>{page.properties.status}</em>}
            {page?.properties.priority && <em>{page.properties.priority}</em>}
          </div>
        </div>
      );
    }
    if (node.kind === "database" && node.targetId) {
      const database = databaseById.get(node.targetId);
      const columns = pickDatabasePreviewColumns(database, 4);
      const rows = (database?.rows || []).slice(0, 10);
      return (
        <div className="freeform-preview freeform-db-preview">
          <div
            className="freeform-db-preview-head freeform-db-preview-grid"
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`,
            }}
          >
            {columns.length ? (
              columns.map((prop) => <span key={prop.id}>{prop.name}</span>)
            ) : (
              <span>プロパティ</span>
            )}
          </div>
          {rows.length ? (
            rows.map((row) => (
              <div
                key={row.id}
                className="freeform-db-preview-row freeform-db-preview-grid"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))`,
                }}
              >
                {columns.map((prop) => (
                  <span key={prop.id}>
                    {stringifyCell(row.cells[prop.id]) || "—"}
                  </span>
                ))}
              </div>
            ))
          ) : (
            <div className="freeform-db-preview-empty">
              行はまだありません
            </div>
          )}
          <div className="freeform-db-preview-footer">
            {database
              ? `${database.rows.length}行 · ${database.properties.length}列`
              : "DBを読み込めません"}
          </div>
        </div>
      );
    }
    if (node.kind === "web-project" && node.targetId) {
      const project = getWebProject(node.targetId);
      return (
        <div className="freeform-preview freeform-web-preview">
          {project ? (
            <iframe
              title={`${project.title} preview`}
              sandbox="allow-scripts"
              srcDoc={compileWebProject(project)}
              loading="lazy"
            />
          ) : (
            <div className="freeform-web-placeholder">Webプロジェクトが見つかりません</div>
          )}
          <div className="freeform-web-ribbon">HTML · CSS · JavaScript</div>
        </div>
      );
    }
    if (node.kind === "pdf" && node.targetId) {
      const attachment = attachmentByKey.get(node.targetId);
      const src = attachment ? buildAttachmentFileUrl(apiUrl, attachment) : "";
      return (
        <div className="freeform-preview freeform-pdf-preview">
          {src ? (
            <iframe
              title={attachment?.fileName || node.title}
              src={`${src}#toolbar=0&navpanes=0&view=FitH`}
              loading="lazy"
            />
          ) : (
            <div className="freeform-pdf-placeholder">PDF</div>
          )}
          <div className="freeform-pdf-ribbon">PDFプレビュー</div>
        </div>
      );
    }
    return null;
  };

  return (
    <section className="freeform-screen">
      <header className="freeform-header">
        <div>
          <button type="button" className="freeform-back" onClick={onBack}>
            ← 戻る
          </button>
          <p>Freeform Canvas</p>
          <h1>Blocksuite Whiteboard</h1>
          <small>
            付箋・テキスト・図形・ページ・DBを同じキャンバスに並べ、手動で考えを組み立てます。
          </small>
        </div>
        <div className="freeform-header-actions">
          <span>
            {board.nodes.length} cards · {validLinks.length} links ·{" "}
            {formatUpdatedAt(board.updatedAt)}
          </span>
          <button type="button" onClick={() => fitView(board.nodes)}>
            全体表示
          </button>
          <button type="button" onClick={() => { setNodeFinderOpen(true); setNodeFinderQuery(""); }}>
            検索
          </button>
          <button type="button" onClick={downloadBoard}>書き出し</button>
          <button type="button" onClick={() => setGoogleExportOpen(true)}>Google書出</button>
          <button type="button" onClick={() => boardImportInputRef.current?.click()}>読み込み</button>
          <input
            ref={boardImportInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void handleBoardImport(file);
            }}
          />
          <button type="button" onClick={connectSelected}>
            接続
          </button>
          <button type="button" onClick={() => void copySelected()} disabled={!selectedIds.length}>
            コピー
          </button>
          <button type="button" onClick={() => void pasteSelected()}>
            貼り付け
          </button>
          <button
            type="button"
            onClick={duplicateSelected}
            disabled={!selectedIds.length}
          >
            複製
          </button>
          <button
            type="button"
            className="danger"
            onClick={removeSelected}
            disabled={!selectedIds.length && !selectedLinkId}
          >
            削除
          </button>
        </div>
      </header>

      {selectedLinkId && (() => {
        const link = board.links.find((item) => item.id === selectedLinkId);
        if (!link) return null;
        return (
          <div className="freeform-link-inspector" role="toolbar" aria-label="接続線の設定">
            <b>接続線</b>
            <label>始点<select value={link.fromId} onChange={(event) => updateLink(link.id, { fromId: event.target.value })}>{visibleNodes.filter((node) => node.kind !== "group" && node.id !== link.toId).map((node) => <option key={node.id} value={node.id}>{node.title || kindLabel(node.kind)}</option>)}</select></label>
            <label>終点<select value={link.toId} onChange={(event) => updateLink(link.id, { toId: event.target.value })}>{visibleNodes.filter((node) => node.kind !== "group" && node.id !== link.fromId).map((node) => <option key={node.id} value={node.id}>{node.title || kindLabel(node.kind)}</option>)}</select></label>
            <label>色<input type="color" value={link.color || "#64748b"} onChange={(event) => updateLink(link.id, { color: event.target.value })} /></label>
            <label>太さ<input type="range" min="1" max="6" value={link.width || 2} onChange={(event) => updateLink(link.id, { width: Number(event.target.value) })} /></label>
            <label>形状<select value={link.edgeType || "bezier"} onChange={(event) => updateLink(link.id, { edgeType: event.target.value as FreeformLink["edgeType"] })}><option value="bezier">曲線</option><option value="smoothstep">直角</option><option value="straight">直線</option></select></label>
            <button type="button" className={link.dashed ? "active" : ""} onClick={() => updateLink(link.id, { dashed: !link.dashed })}>破線</button>
            <button type="button" className={link.bidirectional ? "active" : ""} onClick={() => updateLink(link.id, { bidirectional: !link.bidirectional })}>双方向</button>
            <input aria-label="接続線ラベル" value={link.label || ""} placeholder="ラベル" onChange={(event) => updateLink(link.id, { label: event.target.value })} />
            <button type="button" className="danger" onClick={removeSelected}>削除</button>
          </div>
        );
      })()}

      {googleExportOpen && (
        <div className="freeform-node-finder-backdrop" onPointerDown={() => setGoogleExportOpen(false)}>
          <section className="freeform-google-export-dialog" role="dialog" aria-modal="true" aria-label="Googleへ書き出し" onPointerDown={(event) => event.stopPropagation()}>
            <header><b>Googleへ書き出し</b><button type="button" onClick={() => setGoogleExportOpen(false)} aria-label="閉じる">×</button></header>
            <GoogleWorkspaceExportPanel boardTitle={board.title} nodes={selectedNodes.length ? selectedNodes : board.nodes} onStatus={onStatus} />
          </section>
        </div>
      )}

      {nodeFinderOpen && (
        <div className="freeform-node-finder-backdrop" onPointerDown={() => setNodeFinderOpen(false)}>
          <section className="freeform-node-finder" role="dialog" aria-modal="true" aria-label="ノード検索" onPointerDown={(event) => event.stopPropagation()}>
            <div className="freeform-node-finder-head">
              <b>ノード検索</b>
              <button type="button" onClick={() => setNodeFinderOpen(false)} aria-label="閉じる">×</button>
            </div>
            <input
              autoFocus
              value={nodeFinderQuery}
              onChange={(event) => setNodeFinderQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setNodeFinderOpen(false);
                if (event.key === "Enter" && nodeFinderResults[0]) focusNode(nodeFinderResults[0].node);
              }}
              placeholder="タイトル・本文・種類で検索…"
            />
            <div className="freeform-node-finder-results">
              {nodeFinderResults.map((result) => (
                <button key={result.id} type="button" onClick={() => focusNode(result.node)}>
                  <span>{result.title}</span>
                  <small>{result.subtitle}</small>
                </button>
              ))}
              {!nodeFinderResults.length && <p>一致するノードがありません</p>}
            </div>
            <footer>⌘/Ctrl + K · Enterで移動</footer>
          </section>
        </div>
      )}

      <div className="freeform-layout">
        <aside className="freeform-sidebar">
          <div className="freeform-sidebar-title">
            <b>ブロック</b>
            <span>BlockSuite風の部品を配置</span>
          </div>
          <div className="freeform-segment">
            {(
              ["note", "page", "database", "pdf", "group"] as AddPanelMode[]
            ).map((item) => (
              <button
                key={item}
                type="button"
                className={mode === item ? "active" : ""}
                onClick={() => setMode(item)}
              >
                {item === "note"
                  ? "付箋"
                  : item === "page"
                    ? "ページ"
                    : item === "database"
                      ? "DB"
                      : item === "pdf"
                        ? "PDF"
                        : "枠"}
              </button>
            ))}
          </div>

          <div className="freeform-template-card">
            <label>テンプレート</label>
            <div>
              <button type="button" onClick={() => applyTemplate("brainstorm")}>
                発想
              </button>
              <button type="button" onClick={() => applyTemplate("workflow")}>
                流れ
              </button>
              <button type="button" onClick={() => applyTemplate("comparison")}>
                比較
              </button>
            </div>
          </div>

          {mode === "note" || mode === "group" ? (
            <div className="freeform-add-card">
              <label>タイトル</label>
              <input
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder={mode === "group" ? "調査メモのまとまり" : "メモ"}
              />
              <label>本文</label>
              <textarea
                value={draft.body}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                placeholder="ここに短いメモを書きます"
              />
              <button type="button" className="primary" onClick={addDraftNode}>
                キャンバスに追加
              </button>
            </div>
          ) : (
            <div className="freeform-search">
              <label>
                {mode === "page"
                  ? "ページ検索"
                  : mode === "database"
                    ? "DB検索"
                    : "PDF検索"}
              </label>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  mode === "pdf"
                    ? "PDF名・ページ名で検索"
                    : "タイトル・タグで検索"
                }
              />
              <div className="freeform-picker-list">
                {mode === "pdf" ? (
                  filteredPdfAttachments.length ? (
                    filteredPdfAttachments.map((file) => (
                      <button
                        key={`${file.pageId}:${file.id}`}
                        type="button"
                        onClick={() => addPdfNode(file)}
                      >
                        <b>📕 {file.fileName || "PDF"}</b>
                        <small>
                          {pageTitleById.get(file.pageId) || "ページ添付"} ·{" "}
                          {formatBytes(file.size)}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p className="freeform-empty">
                      PDF添付が見つかりません。
                    </p>
                  )
                ) : (
                  (mode === "page" ? filteredPages : filteredDatabases).map(
                    (item: PageWithLock | WorkspaceDatabase) => {
                      const isPage = mode === "page";
                      const title = isPage
                        ? (item as PageWithLock).title
                        : (item as WorkspaceDatabase).title;
                      const subtitle = isPage
                        ? [
                            (item as PageWithLock).properties.status,
                            ...(
                              (item as PageWithLock).properties.tags || []
                            ).slice(0, 2),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : `${(item as WorkspaceDatabase).rows.length}行 · ${(item as WorkspaceDatabase).properties.length}プロパティ`;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() =>
                            isPage
                              ? addPageNode(item as PageWithLock)
                              : addDatabaseNode(item as WorkspaceDatabase)
                          }
                        >
                          <b>
                            {isPage ? (item as PageWithLock).icon || "📄" : "▦"}{" "}
                            {title || "無題"}
                          </b>
                          <small>
                            {subtitle || (isPage ? "ページ" : "データベース")}
                          </small>
                        </button>
                      );
                    },
                  )
                )}
              </div>
            </div>
          )}

          <div className="freeform-tools">
            <label>表示と整列</label>
            <input
              type="range"
              min="45"
              max="140"
              value={Math.round(zoom * 100)}
              onChange={(event) => setZoom(Number(event.target.value) / 100)}
            />
            <span>
              {Math.round(zoom * 100)}% · 現在: {toolLabel(canvasTool)} ·
              ダブルクリックで追加
            </span>
            <div className="freeform-tool-grid">
              <button type="button" onClick={() => setZoom(0.9)}>
                倍率リセット
              </button>
              <button
                type="button"
                onClick={() =>
                  fitView(selectedNodes.length ? selectedNodes : visibleNodes)
                }
              >
                選択/全体表示
              </button>
              <label className="freeform-layout-select">
                配置
                <select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value as FreeformLayoutMode)}>
                  <option value="flow-right">フロー →</option>
                  <option value="flow-down">フロー ↓</option>
                  <option value="grid">グリッド</option>
                </select>
              </label>
              <button type="button" onClick={() => applyLayout(layoutMode)}>
                自動レイアウト
              </button>
              <button
                type="button"
                onClick={generateKnowledgeGraph}
                disabled={knowledgeGraphBusy}
                title="タグ・状態・タイトル・本文プレビューから関連ページを接続"
              >
                {knowledgeGraphBusy ? "生成中…" : "Knowledge Graph"}
              </button>
              <button type="button" onClick={() => setEnginePanelOpen((value) => !value)}>
                {enginePanelOpen ? "Engineを閉じる" : "Engine構成"}
              </button>
              <button
                type="button"
                onClick={bringSelectedToFront}
                disabled={!selectedIds.length}
              >
                前面へ
              </button>
              <button
                type="button"
                onClick={() => setShowMiniMap((value) => !value)}
              >
                {showMiniMap ? "ミニマップ非表示" : "ミニマップ表示"}
              </button>
              <button type="button" onClick={clearBoard}>
                全削除
              </button>
            </div>
          </div>

          {enginePanelOpen && (
            <section className="freeform-engine-panel" aria-label="Whiteboard Engine">
              <header>
                <div>
                  <strong>Whiteboard Engine</strong>
                  <small>{WhiteboardEngine.plugins.list().length} plugins active</small>
                </div>
              </header>
              <div className="freeform-engine-grid">
                {[
                  ["Node", "ノード生成・索引・種別"],
                  ["Edge", "接続・経路・代理接続"],
                  ["Layout", "配置・整列・スナップ"],
                  ["Render", "仮想化・詳細度・描画"],
                  ["Selection", "選択・グループ展開"],
                  ["History", "Undo・Redo・確定"],
                  ["Clipboard", "コピー・複製・貼付"],
                  ["AI", "Knowledge Graph・提案"],
                  ["Search", "検索・ジャンプ"],
                  ["Plugin", "機能登録・拡張"],
                  ["Persistence", "保存・画像・入出力"],
                ].map(([name, description]) => (
                  <div key={name}>
                    <b>{name} Engine</b>
                    <span>{description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {selectedNode && (
            <div className="freeform-inspector">
              <h3>選択中</h3>
              <label>タイトル</label>
              <input
                value={selectedNode.title}
                onChange={(event) =>
                  updateNode(selectedNode.id, { title: event.target.value })
                }
              />
              <label>本文</label>
              <textarea
                value={selectedNode.body || ""}
                onChange={(event) =>
                  updateNode(selectedNode.id, { body: event.target.value })
                }
              />
              <label>色</label>
              <div className="freeform-color-row">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`freeform-color-dot color-${color}${selectedNode.color === color ? " active" : ""}`}
                    onClick={() => updateNode(selectedNode.id, { color })}
                    title={colorLabel(color)}
                  />
                ))}
              </div>
              {selectedNode.kind === "shape" && (
                <label>
                  図形
                  <select
                    value={selectedNode.shape || "round"}
                    onChange={(event) =>
                      updateNode(selectedNode.id, {
                        shape: event.target.value as FreeformShapeKind,
                      })
                    }
                  >
                    <option value="round">角丸</option>
                    <option value="rect">四角</option>
                    <option value="ellipse">楕円</option>
                    <option value="diamond">ひし形</option>
                  </select>
                </label>
              )}
              {selectedNode.kind === "image" && (
                <button
                  type="button"
                  className="freeform-crop-open"
                  onClick={() => setCropNodeId(selectedNode.id)}
                >
                  画像を切り抜く
                </button>
              )}
              <div className="freeform-size-grid">
                <label>
                  幅
                  <input
                    type="number"
                    value={Math.round(selectedNode.w)}
                    min={160}
                    max={720}
                    onChange={(event) =>
                      updateNode(selectedNode.id, {
                        w: clamp(
                          Number(event.target.value) || selectedNode.w,
                          160,
                          720,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  高さ
                  <input
                    type="number"
                    value={Math.round(selectedNode.h)}
                    min={90}
                    max={520}
                    onChange={(event) =>
                      updateNode(selectedNode.id, {
                        h: clamp(
                          Number(event.target.value) || selectedNode.h,
                          90,
                          520,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          )}

          {selectedIds.length > 1 && (
            <div className="freeform-inspector freeform-multi">
              <h3>{selectedIds.length}件を選択中</h3>
              <button type="button" onClick={connectSelected}>
                線で接続
              </button>
              <button type="button" onClick={duplicateSelected}>
                まとめて複製
              </button>
              <button type="button" onClick={groupSelected}>
                グループ化
              </button>
              {selectedNodes.some((node) => node.groupId) && (
                <button type="button" onClick={ungroupSelected}>
                  グループ解除
                </button>
              )}
              <button type="button" onClick={() => applyLayout(layoutMode)}>選択を自動配置</button>
              <div className="freeform-align-grid" role="group" aria-label="整列">
                <button type="button" onClick={() => alignSelection("left")}>左</button>
                <button type="button" onClick={() => alignSelection("center-x")}>中央↔</button>
                <button type="button" onClick={() => alignSelection("right")}>右</button>
                <button type="button" onClick={() => alignSelection("top")}>上</button>
                <button type="button" onClick={() => alignSelection("center-y")}>中央↕</button>
                <button type="button" onClick={() => alignSelection("bottom")}>下</button>
                <button type="button" disabled={selectedIds.length < 3} onClick={() => distributeSelection("horizontal")}>横均等</button>
                <button type="button" disabled={selectedIds.length < 3} onClick={() => distributeSelection("vertical")}>縦均等</button>
              </div>
            </div>
          )}
        </aside>

        <div
          ref={viewportRef}
          className={`freeform-viewport tool-${canvasTool}`}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onPointerCancel={handleViewportPointerUp}
          onWheel={handleViewportWheel}
        >
          <div
            className="freeform-freeboard-toolbar"
            role="toolbar"
            aria-label="ホワイトボードツール"
          >
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                undo();
              }}
              disabled={!canUndo}
              title="取り消す"
              aria-label="取り消す"
            >
              <span aria-hidden="true">↶</span>
            </button>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                redo();
              }}
              disabled={!canRedo}
              title="やり直す"
              aria-label="やり直す"
            >
              <span aria-hidden="true">↷</span>
            </button>
            {(
              [
                "select",
                "hand",
                "sticky",
                "text",
                "shape",
                "draw",
                "eraser",
                "ruler",
                "image",
                "frame",
                "connector",
              ] as FreeformCanvasTool[]
            ).map((tool) => (
              <button
                key={tool}
                type="button"
                className={canvasTool === tool ? "active" : ""}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setCanvasTool(tool);
                  setConnectorStartId(null);
                  if (tool === "image") imageInputRef.current?.click();
                }}
                title={toolLabel(tool)}
                aria-label={toolLabel(tool)}
                data-tooltip={toolLabel(tool)}
              >
                <span aria-hidden="true">
                  {tool === "select"
                    ? "↖"
                    : tool === "hand"
                      ? "✋"
                      : tool === "sticky"
                        ? "▤"
                        : tool === "text"
                          ? "T"
                          : tool === "shape"
                            ? "□"
                            : tool === "draw"
                              ? "✎"
                              : tool === "eraser"
                                ? "⌫"
                                : tool === "ruler"
                                  ? "／"
                                  : tool === "image"
                                    ? "▧"
                                    : tool === "frame"
                                      ? "▣"
                                      : "⌁"}
                </span>
              </button>
            ))}
            {canvasTool === "shape" && (
              <label className="freeform-shape-picker" title="図形の種類">
                <span aria-hidden="true">⌄</span>
                <select
                  value={shapeKind}
                  onChange={(event) =>
                    setShapeKind(event.target.value as FreeformShapeKind)
                  }
                  aria-label="図形の種類"
                >
                  <option value="round">角丸</option>
                  <option value="rect">四角</option>
                  <option value="ellipse">楕円</option>
                  <option value="diamond">ひし形</option>
                </select>
              </label>
            )}
            {(canvasTool === "draw" || canvasTool === "ruler") && (
              <div
                className="freeform-pen-options"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <input
                  type="color"
                  value={penColor}
                  onChange={(event) => setPenColor(event.target.value)}
                  aria-label="ペンの色"
                  title="ペンの色"
                />
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={penWidth}
                  onChange={(event) => setPenWidth(Number(event.target.value))}
                  aria-label="ペンの太さ"
                  title={`太さ ${penWidth}`}
                />
              </div>
            )}
          </div>
          <div
            className="freeform-zoom-dock"
            role="group"
            aria-label="表示倍率"
          >
            <button
              type="button"
              onClick={() => setZoom((value) => clamp(value - 0.1, 0.45, 1.4))}
              title="縮小"
              aria-label="縮小"
            >
              −
            </button>
            <strong>{Math.round(zoom * 100)}%</strong>
            <button
              type="button"
              onClick={() => setZoom((value) => clamp(value + 0.1, 0.45, 1.4))}
              title="拡大"
              aria-label="拡大"
            >
              ＋
            </button>
            <button
              type="button"
              onClick={() =>
                fitView(selectedNodes.length ? selectedNodes : visibleNodes)
              }
              title="全体表示"
              aria-label="全体表示"
            >
              ⌗
            </button>
          </div>
          <div className="freeform-canvas-hint">
            {canvasTool === "select"
              ? "カードを選択・ドラッグ / 空白ダブルクリックで自由入力 / Shift・⌘で複数選択"
              : canvasTool === "hand"
                ? "空白ドラッグでキャンバス移動"
                : canvasTool === "connector"
                  ? connectorStartId
                    ? "接続先のカードをクリック"
                    : "接続元カードをクリック"
                  : canvasTool === "draw"
                    ? "ドラッグして自由に描画"
                    : canvasTool === "eraser"
                      ? "消したい手書き線をなぞる"
                      : canvasTool === "ruler"
                        ? "ドラッグして45°単位の直線を描画"
                        : `${toolLabel(canvasTool)}ツール: 空白をダブルクリックして追加${canvasTool === "text" || canvasTool === "sticky" ? "・そのまま入力" : ""}`}
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              handleImageFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <div
            className={`freeform-surface tool-${canvasTool}${lowDetail ? " is-low-detail" : ""}`}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            style={{
              transform: `scale(${zoom})`,
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
            }}
          >
            <FreeformLinkLayer
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              links={renderLinks}
              nodeMap={linkNodeMap}
              selectedLinkId={selectedLinkId}
              onSelect={(id) => {
                setSelectedIds([]);
                setSelectedLinkId(id);
              }}
            />
            {connectorDraft && (() => {
              const from = nodeMap.get(connectorDraft.fromId);
              if (!from) return null;
              const target = connectorDraft.targetId
                ? nodeMap.get(connectorDraft.targetId)
                : undefined;
              const pointerNode: FreeformNode = target || {
                ...from,
                id: "__connector_pointer__",
                x: connectorDraft.x,
                y: connectorDraft.y,
                w: 1,
                h: 1,
              };
              return (
                <svg
                  className="freeform-connector-draft"
                  viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                  aria-hidden="true"
                >
                  <path d={buildLinkPath(from, pointerNode, { fromHandle: connectorDraft.fromHandle, toHandle: connectorDraft.toHandle || undefined })} />
                </svg>
              );
            })()}
            {draftStroke.length > 1 &&
              (() => {
                const path = buildSmoothPath(draftStroke);
                return (
                  <svg
                    className="freeform-live-stroke"
                    viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                    aria-hidden="true"
                  >
                    <path
                      d={path}
                      fill="none"
                      style={{ stroke: penColor, strokeWidth: penWidth }}
                    />
                  </svg>
                );
              })()}
            {selectionBox && (
              <div
                className="freeform-selection-box"
                style={{
                  left: selectionBox.x,
                  top: selectionBox.y,
                  width: selectionBox.w,
                  height: selectionBox.h,
                }}
                aria-hidden="true"
              />
            )}
            {snapGuides.map((guide, index) => (
              <div
                key={`${guide.axis}:${guide.value}:${index}`}
                className={`freeform-snap-guide is-${guide.axis}`}
                style={guide.axis === "x" ? { left: guide.value } : { top: guide.value }}
                aria-hidden="true"
              />
            ))}
            {logicalGroups.map(({ id, bounds, members }) => {
              const selected = members.some((member) => selectedIds.includes(member.id));
              return (
                <div
                  key={id}
                  className={`freeform-logical-group${selected ? " selected" : ""}`}
                  style={{
                    left: bounds.minX - 12,
                    top: bounds.minY - 12,
                    width: bounds.maxX - bounds.minX + 24,
                    height: bounds.maxY - bounds.minY + 24,
                  }}
                  aria-hidden="true"
                >
                  <span>グループ · {members.length}</span>
                </div>
              );
            })}
            {cardNodes.map((node) => {
              const selected = selectedIds.includes(node.id);
              return (
                <div
                  key={node.id}
                  data-freeform-node-id={node.id}
                  className={`freeform-node is-${node.kind} shape-${node.shape || "round"} color-${node.color}${selected ? " selected" : ""}${connectorStartId === node.id ? " connector-source" : ""}${connectorDraft?.targetId === node.id ? " connector-target" : ""}${node.kind === "group" && node.collapsed ? " is-collapsed" : ""}`}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    minHeight: node.h,
                    height: node.kind === "group" && node.collapsed ? node.h : undefined,
                  }}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onPointerMove={(event) => {
                    if (drawRef.current || eraseRef.current)
                      handleViewportPointerMove(event);
                    else handleNodePointerMove(event);
                  }}
                  onPointerUp={(event) => {
                    if (drawRef.current || eraseRef.current)
                      handleViewportPointerUp(event);
                    else handleNodePointerUp(event);
                  }}
                  onPointerCancel={(event) => {
                    if (drawRef.current || eraseRef.current)
                      handleViewportPointerUp(event);
                    else handleNodePointerUp(event);
                  }}
                  onDoubleClick={(event) => {
                    if (node.kind === "page" && node.targetId) {
                      event.preventDefault();
                      event.stopPropagation();
                      void openInlinePageEditor(node);
                      return;
                    }
                    if (node.kind !== "text" && node.kind !== "note") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedIds([node.id]);
                    setEditingNodeId(node.id);
                  }}
                >
                  <FreeformConnectorHandles
                    node={node}
                    onStart={startConnectorDrag}
                    onMove={moveConnectorDrag}
                    onEnd={endConnectorDrag}
                  />
                  <div className="freeform-node-top">
                    <span>
                      {node.icon ||
                        (node.kind === "database"
                          ? "▦"
                          : node.kind === "page"
                            ? "📄"
                            : node.kind === "pdf"
                              ? "📕"
                              : node.kind === "image"
                                ? "🖼"
                                : node.kind === "drawing"
                                  ? "✎"
                                  : node.kind === "group"
                                    ? "▣"
                                    : node.kind === "google-drive"
                                      ? "☁"
                                      : node.kind === "google-calendar"
                                        ? "📅"
                                        : node.kind === "google-gmail"
                                          ? "✉"
                                          : node.kind === "web-project"
                                            ? "</>"
                                            : "✎")}
                    </span>
                    <b>{node.title}</b>
                    {node.kind === "group" && (
                      <button
                        type="button"
                        className="freeform-frame-collapse"
                        aria-label={node.collapsed ? "フレームを展開" : "フレームを折りたたむ"}
                        title={node.collapsed ? "展開" : "折りたたむ"}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          saveBoard((current) => ({
                            ...current,
                            nodes: current.nodes.map((item) => item.id === node.id ? { ...item, collapsed: !item.collapsed, updatedAt: Date.now() } : item),
                          }));
                        }}
                      >
                        {node.collapsed ? "＋" : "−"}
                      </button>
                    )}
                  </div>
                  {node.kind === "group" && node.collapsed && (
                    <div className="freeform-collapsed-summary" aria-label="折りたたみ内容">
                      <span>{node.collapsedChildCount || 0}ノード</span>
                      <span>{node.collapsedExternalCount || 0}接続</span>
                    </div>
                  )}
                  {node.kind === "page" && inlinePageNodeId === node.id && inlinePageBundle ? (
                    <InlinePageEditor
                      bundle={inlinePageBundle}
                      saving={inlinePageSaving}
                      onCancel={() => {
                        setInlinePageNodeId(null);
                        setInlinePageBundle(null);
                      }}
                      onSave={saveInlinePage}
                    />
                  ) : (node.kind === "text" || node.kind === "note") &&
                  editingNodeId === node.id ? (
                    <textarea
                      className="freeform-inline-editor"
                      autoFocus
                      value={node.body || ""}
                      placeholder={
                        node.kind === "text"
                          ? "ここに自由に入力…"
                          : "付箋にメモを書く…"
                      }
                      onChange={(event) =>
                        updateNode(node.id, { body: event.target.value })
                      }
                      onBlur={() => setEditingNodeId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingNodeId(null);
                        }
                      }}
                    />
                  ) : (
                    renderNodePreview(node) ||
                    (node.body ? (
                      <p>{node.body}</p>
                    ) : node.kind === "text" || node.kind === "note" ? (
                      <p className="freeform-empty-write">
                        ダブルクリックして入力
                      </p>
                    ) : null)
                  )}
                  {(node.kind === "page" ||
                    node.kind === "database" ||
                    node.kind === "pdf" ||
                    node.kind === "google-drive" ||
                    node.kind === "google-calendar" ||
                    node.kind === "google-gmail" ||
                    node.kind === "web-project") &&
                    node.targetId && (
                      <div className="freeform-node-actions">
                        {node.kind === "page" && loadPage && savePage && (
                          <button
                            type="button"
                            onClick={() => void openInlinePageEditor(node)}
                          >
                            その場で編集
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (node.kind === "page") onOpenPage(node.targetId!);
                            else if (node.kind === "database")
                              onOpenDatabase(node.targetId!);
                            else if (node.kind === "web-project") {
                              setActiveWebProjectId(node.targetId!);
                              onOpenWebBuilder?.();
                            } else if (node.kind === "google-drive" || node.kind === "google-calendar" || node.kind === "google-gmail") {
                              if (node.externalUrl) void window.localNotion.openExternalHttpUrl(node.externalUrl);
                            } else {
                              const attachment = attachmentByKey.get(
                                node.targetId!,
                              );
                              const src = attachment
                                ? buildAttachmentFileUrl(apiUrl, attachment)
                                : "";
                              if (src)
                                window.open(src, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          {node.kind === "pdf" ? "PDFを開く" : node.kind === "google-drive" ? "Driveで開く" : node.kind === "google-calendar" ? "Calendarで開く" : node.kind === "google-gmail" ? "Gmailで開く" : node.kind === "web-project" ? "Web Builderで開く" : "開く"}
                        </button>
                      </div>
                    )}
                  <small>
                    {selected
                      ? "選択中"
                      : node.parentFrameId
                        ? `${kindLabel(node.kind)} · フレーム内`
                        : `${kindLabel(node.kind)} · ドラッグで移動`}
                  </small>
                  {selected && node.kind !== "drawing" && (
                    <button
                      type="button"
                      className="freeform-resize-handle"
                      aria-label="サイズ変更"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const startX = event.clientX,
                          startY = event.clientY,
                          startW = node.w,
                          startH = node.h;
                        const move = (e: PointerEvent) =>
                          updateNode(node.id, {
                            w: clamp(
                              startW + (e.clientX - startX) / zoom,
                              80,
                              900,
                            ),
                            h: clamp(
                              startH + (e.clientY - startY) / zoom,
                              50,
                              700,
                            ),
                          });
                        const up = () => {
                          window.removeEventListener("pointermove", move);
                          window.removeEventListener("pointerup", up);
                        };
                        window.addEventListener("pointermove", move);
                        window.addEventListener("pointerup", up);
                      }}
                    >
                      ↘
                    </button>
                  )}
                </div>
              );
            })}
            {drawingNodes.length > 0 && (
              <svg
                className="freeform-ink-layer"
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                aria-label="手書きレイヤー"
              >
                {drawingNodes.map((node) => {
                  if (!node.body) return null;
                  try {
                    const points = JSON.parse(node.body) as Array<{ x: number; y: number }>;
                    const d = buildSmoothPath(points);
                    const selected = selectedIds.includes(node.id);
                    return (
                      <g
                        key={node.id}
                        className={`freeform-ink-stroke${selected ? " selected" : ""}`}
                        transform={`translate(${node.x} ${node.y})`}
                      >
                        {selected && (
                          <path
                            className="freeform-ink-selection"
                            d={d}
                            fill="none"
                            strokeWidth={(node.strokeWidth || 3) + 8}
                            aria-hidden="true"
                          />
                        )}
                        <path
                          className="freeform-ink-path"
                          d={d}
                          fill="none"
                          stroke={node.strokeColor || "#2563eb"}
                          strokeWidth={node.strokeWidth || 3}
                          data-freeform-node-id={node.id}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            handleNodePointerDown(event, node);
                          }}
                          onPointerMove={(event) => {
                            event.stopPropagation();
                            handleNodePointerMove(event);
                          }}
                          onPointerUp={(event) => {
                            event.stopPropagation();
                            handleNodePointerUp(event);
                          }}
                          onPointerCancel={(event) => {
                            event.stopPropagation();
                            handleNodePointerUp(event);
                          }}
                        />
                      </g>
                    );
                  } catch {
                    return null;
                  }
                })}
              </svg>
            )}
          </div>

          {cropNodeId &&
            (() => {
              const cropNode = nodeMap.get(cropNodeId);
              if (!cropNode || cropNode.kind !== "image" || !cropNode.body)
                return null;
              return (
                <div
                  className="freeform-crop-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="画像の切り抜き"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="freeform-crop-card">
                    <header>
                      <div>
                        <b>画像を切り抜く</b>
                        <small>
                          元画像は変更せず、表示範囲だけ調整します。
                        </small>
                      </div>
                      <button type="button" onClick={() => setCropNodeId(null)}>
                        ×
                      </button>
                    </header>
                    <div className="freeform-crop-preview">
                      <img
                        src={cropNode.body}
                        alt={cropNode.title}
                        style={{
                          objectPosition: `${cropNode.cropX ?? 50}% ${cropNode.cropY ?? 50}%`,
                          transform: `scale(${cropNode.cropScale ?? 1})`,
                        }}
                      />
                    </div>
                    <label>
                      横位置
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={cropNode.cropX ?? 50}
                        onChange={(event) =>
                          updateNode(cropNode.id, {
                            cropX: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      縦位置
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={cropNode.cropY ?? 50}
                        onChange={(event) =>
                          updateNode(cropNode.id, {
                            cropY: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      拡大
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropNode.cropScale ?? 1}
                        onChange={(event) =>
                          updateNode(cropNode.id, {
                            cropScale: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <footer>
                      <button
                        type="button"
                        onClick={() =>
                          updateNode(cropNode.id, {
                            cropX: 50,
                            cropY: 50,
                            cropScale: 1,
                          })
                        }
                      >
                        リセット
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => setCropNodeId(null)}
                      >
                        完了
                      </button>
                    </footer>
                  </div>
                </div>
              );
            })()}

          {showMiniMap && (
            <FreeformMiniMap nodes={board.nodes} onActivate={handleMiniMapClick} />
          )}
        </div>
      </div>
    </section>
  );
}
