import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  STORAGE_KEY,
  type FreeformBoard,
  type FreeformNode,
} from "../../freeformCanvasModel";
import { putFreeformBoard } from "./PersistenceEngine";

const HISTORY_LIMIT = 80;
const SAVE_DEBOUNCE_MS = 350;
const EDIT_COMMIT_DEBOUNCE_MS = 500;

type UseFreeformBoardStateOptions = {
  initialBoard: FreeformBoard;
  onStatus?: (message: string) => void;
};

type UseFreeformBoardStateResult = {
  board: FreeformBoard;
  boardRef: MutableRefObject<FreeformBoard>;
  setBoard: Dispatch<SetStateAction<FreeformBoard>>;
  canUndo: boolean;
  canRedo: boolean;
  saveBoard: (updater: (current: FreeformBoard) => FreeformBoard) => void;
  updateNode: (id: string, patch: Partial<FreeformNode>) => void;
  commitCurrentToHistory: () => void;
  undo: () => void;
  redo: () => void;
};

export function useHistoryEngine({
  initialBoard,
  onStatus,
}: UseFreeformBoardStateOptions): UseFreeformBoardStateResult {
  const [board, setBoardState] = useState<FreeformBoard>(initialBoard);
  const boardRef = useRef(initialBoard);
  const historyRef = useRef<FreeformBoard[]>([initialBoard]);
  const historyIndexRef = useRef(0);
  const [historyIndex, setHistoryIndex] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const editCommitTimerRef = useRef<number | null>(null);
  const editBaselineRef = useRef<FreeformBoard | null>(null);

  const setBoard: Dispatch<SetStateAction<FreeformBoard>> = useCallback(
    (action) => {
      setBoardState((current) => {
        const next =
          typeof action === "function"
            ? (action as (value: FreeformBoard) => FreeformBoard)(current)
            : action;
        boardRef.current = next;
        return next;
      });
    },
    [],
  );

  const persistBoard = useCallback(
    (value: FreeformBoard) => {
      try {
        const persisted = { ...value, updatedAt: Date.now() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
        void putFreeformBoard(STORAGE_KEY, persisted).catch((error) => {
          console.error("Failed to mirror freeform board to IndexedDB", error);
        });
      } catch (error) {
        console.error("Failed to save freeform board", error);
        onStatus?.(
          "キャンバスを保存できませんでした。画像容量または保存領域を確認してください",
        );
      }
    },
    [onStatus],
  );

  const pushHistory = useCallback((next: FreeformBoard) => {
    const currentSnapshot = historyRef.current[historyIndexRef.current];
    if (currentSnapshot === next) return;

    const history = historyRef.current.slice(0, historyIndexRef.current + 1);
    history.push(next);
    historyRef.current = history.slice(-HISTORY_LIMIT);
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryIndex(historyIndexRef.current);
  }, []);

  const flushPendingEdit = useCallback(() => {
    if (editCommitTimerRef.current) {
      window.clearTimeout(editCommitTimerRef.current);
      editCommitTimerRef.current = null;
    }
    if (!editBaselineRef.current) return;
    editBaselineRef.current = null;
    pushHistory(boardRef.current);
  }, [pushHistory]);

  const saveBoard = useCallback(
    (updater: (current: FreeformBoard) => FreeformBoard) => {
      flushPendingEdit();
      setBoardState((current) => {
        const updated = updater(current);
        if (updated === current) return current;
        const next = { ...updated, updatedAt: Date.now() };
        boardRef.current = next;
        pushHistory(next);
        return next;
      });
    },
    [flushPendingEdit, pushHistory],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<FreeformNode>) => {
      const timestamp = Date.now();
      setBoardState((current) => {
        const target = current.nodes.find((node) => node.id === id);
        if (!target) return current;
        if (!editBaselineRef.current) editBaselineRef.current = current;
        const next = {
          ...current,
          updatedAt: timestamp,
          nodes: current.nodes.map((node) =>
            node.id === id ? { ...node, ...patch, updatedAt: timestamp } : node,
          ),
        };
        boardRef.current = next;
        return next;
      });

      if (editCommitTimerRef.current) {
        window.clearTimeout(editCommitTimerRef.current);
      }
      editCommitTimerRef.current = window.setTimeout(() => {
        editCommitTimerRef.current = null;
        if (!editBaselineRef.current) return;
        editBaselineRef.current = null;
        pushHistory(boardRef.current);
      }, EDIT_COMMIT_DEBOUNCE_MS);
    },
    [pushHistory],
  );

  const commitCurrentToHistory = useCallback(() => {
    flushPendingEdit();
    pushHistory(boardRef.current);
  }, [flushPendingEdit, pushHistory]);

  const undo = useCallback(() => {
    flushPendingEdit();
    const nextIndex = Math.max(0, historyIndexRef.current - 1);
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    boardRef.current = snapshot;
    setBoardState(snapshot);
  }, [flushPendingEdit]);

  const redo = useCallback(() => {
    flushPendingEdit();
    const nextIndex = Math.min(
      historyRef.current.length - 1,
      historyIndexRef.current + 1,
    );
    const snapshot = historyRef.current[nextIndex];
    if (!snapshot) return;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    boardRef.current = snapshot;
    setBoardState(snapshot);
  }, [flushPendingEdit]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(
      () => persistBoard(boardRef.current),
      SAVE_DEBOUNCE_MS,
    );
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [board, persistBoard]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (editCommitTimerRef.current)
        window.clearTimeout(editCommitTimerRef.current);
      persistBoard(boardRef.current);
    },
    [persistBoard],
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < historyRef.current.length - 1;

  return {
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
  };
}
