import { useLayoutEffect, useRef, useState } from "react";

export type ContextMenuAnchor = { x: number; y: number; maxHeight: number } | null;

/**
 * Places a fixed context menu near its pointer anchor, then clamps it using the
 * rendered dimensions. ResizeObserver keeps long expandable menus on-screen
 * without relying on guessed menu heights.
 */
export function useMeasuredContextMenuPosition(
  anchor: ContextMenuAnchor,
  watchKey = "",
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ContextMenuAnchor>(anchor);

  useLayoutEffect(() => {
    setPosition(anchor);
    if (!anchor) return;

    const clamp = () => {
      const menu = menuRef.current;
      if (!menu || typeof window === "undefined") return;
      const margin = 12;
      const rect = menu.getBoundingClientRect();
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      const next = {
        x: Math.max(margin, Math.min(anchor.x, maxLeft)),
        y: Math.max(margin, Math.min(anchor.y, maxTop)),
        maxHeight: Math.max(1, window.innerHeight - margin * 2),
      };
      setPosition((current) =>
        current && current.x === next.x && current.y === next.y && current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };

    const frame = window.requestAnimationFrame(clamp);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(clamp);
    if (menuRef.current && observer) observer.observe(menuRef.current);
    window.addEventListener("resize", clamp);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", clamp);
    };
  }, [anchor?.x, anchor?.y, anchor?.maxHeight, watchKey]);

  return { menuRef, position: position ?? anchor };
}
