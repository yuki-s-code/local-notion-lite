import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type StickyColor = "amber" | "lavender" | "mint" | "rose" | "sky";

type PersonalSticky = {
  id: string;
  pageId: string;
  text: string;
  x: number;
  y: number;
  color: StickyColor;
  minimized?: boolean;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "local-notion:personal-sticky-notes:v1";
const VISIBILITY_KEY = "local-notion:personal-sticky-notes:visible";
const COLORS: StickyColor[] = ["amber", "lavender", "mint", "rose", "sky"];
const STICKY_WIDTH = 252;
const STICKY_HEIGHT_GUARD = 118; // Keep dragged notes clear of browser chrome and viewport edges.

function safeLoad(): PersonalSticky[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is PersonalSticky => Boolean(item && typeof item.id === "string" && typeof item.pageId === "string"))
      .map((item) => ({
        id: item.id,
        pageId: item.pageId,
        text: typeof item.text === "string" ? item.text : "",
        x: Number.isFinite(item.x) ? item.x : 96,
        y: Number.isFinite(item.y) ? item.y : 138,
        color: COLORS.includes(item.color) ? item.color : "amber",
        minimized: Boolean(item.minimized),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function clampPosition(x: number, y: number) {
  const maxX = Math.max(12, window.innerWidth - STICKY_WIDTH - 12);
  const maxY = Math.max(12, window.innerHeight - STICKY_HEIGHT_GUARD);
  return {
    x: Math.round(Math.min(maxX, Math.max(12, x))),
    y: Math.round(Math.min(maxY, Math.max(12, y))),
  };
}

function makeId() {
  return `sticky_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function PersonalStickyNotes({
  pageId,
  pageTitle,
  launcherPlacement = "inline",
}: {
  pageId: string;
  pageTitle: string;
  launcherPlacement?: "inline" | "floating";
}) {
  const [allNotes, setAllNotes] = useState<PersonalSticky[]>(safeLoad);
  const [visible, setVisible] = useState(() => window.localStorage.getItem(VISIBILITY_KEY) !== "false");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [launcherMenuPosition, setLauncherMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const launcherButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const notes = useMemo(
    () => allNotes.filter((note) => note.pageId === pageId),
    [allNotes, pageId],
  );

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allNotes)); } catch { /* personal notes are best-effort */ }
  }, [allNotes]);

  useEffect(() => {
    try { window.localStorage.setItem(VISIBILITY_KEY, visible ? "true" : "false"); } catch { /* preference only */ }
  }, [visible]);

  useEffect(() => {
    const onResize = () => {
      setAllNotes((previous) => previous.map((note) => {
        const next = clampPosition(note.x, note.y);
        return next.x === note.x && next.y === note.y ? note : { ...note, ...next, updatedAt: new Date().toISOString() };
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function updateLauncherMenuPosition() {
    const button = launcherButtonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const menuWidth = 50;
    const menuHeight = 92;
    const margin = 8;
    const left = Math.max(margin, Math.min(window.innerWidth - menuWidth - margin, rect.right - menuWidth));
    const top = rect.bottom + menuHeight + margin <= window.innerHeight
      ? rect.bottom + margin
      : Math.max(margin, rect.top - menuHeight - margin);
    setLauncherMenuPosition({ left: Math.round(left), top: Math.round(top) });
  }

  useLayoutEffect(() => {
    if (!launcherOpen) {
      setLauncherMenuPosition(null);
      return;
    }
    updateLauncherMenuPosition();
  }, [launcherOpen]);

  useEffect(() => {
    if (!launcherOpen) return;
    const reposition = () => updateLauncherMenuPosition();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLauncherOpen(false);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [launcherOpen]);

  function updateNote(id: string, patch: Partial<PersonalSticky>) {
    setAllNotes((previous) => previous.map((note) => note.id === id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note));
  }

  function addNote() {
    const shift = Math.min(notes.length * 22, 132);
    const position = clampPosition(72 + shift, 132 + shift);
    const now = new Date().toISOString();
    const note: PersonalSticky = {
      id: makeId(),
      pageId,
      text: "",
      x: position.x,
      y: position.y,
      color: COLORS[notes.length % COLORS.length],
      createdAt: now,
      updatedAt: now,
    };
    setAllNotes((previous) => [...previous, note]);
    setVisible(true);
    setActiveId(note.id);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`textarea[data-sticky-id="${note.id}"]`)?.focus(), 0);
  }

  function removeNote(id: string) {
    setAllNotes((previous) => previous.filter((note) => note.id !== id));
    setActiveId((current) => current === id ? null : current);
  }

  function startDrag(event: React.PointerEvent<HTMLElement>, note: PersonalSticky) {
    if ((event.target as HTMLElement).closest("button")) return;

    // Sticky notes are rendered in a portal directly under <body>. This makes
    // the note's fixed left/top coordinates use the same viewport coordinate
    // system as PointerEvent.clientX/clientY, even when the editor/workspace
    // itself is inside transformed or docked layout containers.
    const element = event.currentTarget.closest<HTMLElement>(".personal-sticky-note");
    if (!element) return;
    const rect = element.getBoundingClientRect();
    dragRef.current = {
      id: note.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setActiveId(note.id);
    event.preventDefault();
  }

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const position = clampPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
      setAllNotes((previous) => previous.map((note) => (
        note.id === drag.id
          ? { ...note, ...position, updatedAt: new Date().toISOString() }
          : note
      )));
    };

    const finishDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === event.pointerId) dragRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, []);

  return (
    <>
      <div
        className={`personal-sticky-toolbar ${launcherPlacement === "inline" ? "is-inline" : "is-floating"}${launcherOpen ? " is-open" : ""}`}
        aria-label="個人付箋"
      >
        <button
          type="button"
          ref={launcherButtonRef}
          className={`personal-sticky-toolbar-toggle${visible ? " is-active" : ""}`}
          onClick={() => setLauncherOpen((value) => !value)}
          title="個人付箋"
          aria-label="個人付箋メニューを開く"
          aria-expanded={launcherOpen}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 3.5h11A3.5 3.5 0 0 1 21 7v10a3.5 3.5 0 0 1-3.5 3.5H6.5A3.5 3.5 0 0 1 3 17V7a3.5 3.5 0 0 1 3.5-3.5Z" />
            <path d="M8 9h8M8 13h5" />
          </svg>
          {notes.length > 0 && <em>{notes.length}</em>}
        </button>
      </div>


      {typeof document !== "undefined" && launcherOpen && launcherMenuPosition && createPortal(
        <div
          className="personal-sticky-launcher-menu personal-sticky-launcher-menu-portal"
          role="menu"
          aria-label="個人付箋メニュー"
          style={{ left: launcherMenuPosition.left, top: launcherMenuPosition.top }}
        >
          <button
            type="button"
            className="personal-sticky-launcher-action is-add"
            onClick={() => { addNote(); setLauncherOpen(false); }}
            title="付箋を追加"
            aria-label="付箋を追加"
            role="menuitem"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button
            type="button"
            className="personal-sticky-launcher-action"
            onClick={() => { setVisible((value) => !value); setLauncherOpen(false); }}
            title={visible ? "付箋を隠す" : "付箋を表示"}
            aria-label={visible ? "付箋を隠す" : "付箋を表示"}
            aria-pressed={visible}
            role="menuitem"
          >
            {visible ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.7 6.2A10.6 10.6 0 0 1 12 6c5.1 0 8.8 4.2 9.8 6-0.5.9-1.6 2.4-3.2 3.7M6.2 6.2C4.6 7.5 3.5 9.1 2.2 12c1 1.8 4.7 6 9.8 6 1.3 0 2.5-.3 3.6-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12C3.2 10.2 6.9 6 12 6s8.8 4.2 9.8 6c-1 1.8-4.7 6-9.8 6S3.2 13.8 2.2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
            )}
          </button>
        </div>,
        document.body,
      )}

      {typeof document !== "undefined" && createPortal(
        <div className="personal-sticky-layer" aria-live="polite">
      {visible && notes.map((note) => (
        <section
          key={note.id}
          className={`personal-sticky-note color-${note.color}${note.minimized ? " is-minimized" : ""}${activeId === note.id ? " is-active" : ""}`}
          style={{ left: note.x, top: note.y }}
          onPointerDown={() => setActiveId(note.id)}
          aria-label={`個人付箋: ${pageTitle}`}
        >
          <div className="personal-sticky-handle">
            <span
              className="personal-sticky-grip"
              onPointerDown={(event) => startDrag(event, note)}
              role="button"
              tabIndex={0}
              title="ドラッグして移動"
              aria-label="付箋をドラッグして移動"
            >⠿</span>
            <span className="personal-sticky-private">個人用</span>
            <div className="personal-sticky-actions">
              <button type="button" onClick={() => updateNote(note.id, { minimized: !note.minimized })} title={note.minimized ? "開く" : "最小化"} aria-label={note.minimized ? "付箋を開く" : "付箋を最小化"}>{note.minimized ? "⌄" : "−"}</button>
              <button type="button" onClick={() => removeNote(note.id)} title="削除" aria-label="付箋を削除">×</button>
            </div>
          </div>
          {!note.minimized && (
            <>
              <textarea
                data-sticky-id={note.id}
                value={note.text}
                onChange={(event) => updateNote(note.id, { text: event.target.value })}
                placeholder="自分だけに見えるメモ"
                aria-label="個人付箋の内容"
              />
              <footer className="personal-sticky-footer">
                <div className="personal-sticky-colors" aria-label="色を選択">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`personal-sticky-color-dot ${color}${note.color === color ? " selected" : ""}`}
                      onClick={() => updateNote(note.id, { color })}
                      aria-label={`${color}色に変更`}
                      title="色を変更"
                    />
                  ))}
                </div>
                <span>この端末のみ</span>
              </footer>
            </>
          )}
        </section>
      ))}
        </div>,
        document.body,
      )}
    </>
  );
}
