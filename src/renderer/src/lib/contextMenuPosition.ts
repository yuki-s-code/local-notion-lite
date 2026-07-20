export type ViewportContextMenuPosition = {
  x: number;
  y: number;
  /** Maximum safe menu height inside the current viewport. */
  maxHeight: number;
};

type Options = {
  preferredWidth?: number;
  preferredHeight?: number;
  margin?: number;
};

/**
 * Keeps fixed context menus inside the visible viewport without duplicating
 * sizing math across sidebar menus. The rendered menu may be taller than the
 * preferred height; callers must apply maxHeight and enable internal scrolling.
 */
export function getViewportContextMenuPosition(
  x: number,
  y: number,
  {
    preferredWidth = 284,
    preferredHeight = 560,
    margin = 12,
  }: Options = {},
): ViewportContextMenuPosition {
  const viewportWidth =
    typeof window === "undefined" ? preferredWidth + margin * 2 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? preferredHeight + margin * 2 : window.innerHeight;
  const maxHeight = Math.max(1, viewportHeight - margin * 2);
  const expectedHeight = Math.min(preferredHeight, maxHeight);
  const maxLeft = Math.max(margin, viewportWidth - preferredWidth - margin);
  // Vertical placement is corrected after the menu renders and its real height is
  // known. Using a speculative 560px height here made short DB menus jump far
  // above the pointer. Keep the anchor close to the pointer on first paint.
  void expectedHeight;

  return {
    x: Math.max(margin, Math.min(x, maxLeft)),
    y: Math.max(margin, Math.min(y, viewportHeight - margin)),
    maxHeight,
  };
}
