import { useEffect } from "react";

/** Shared outside-click, Escape, resize and optional blur dismissal for floating menus. */
export function useContextMenuDismissal(
  isOpen: boolean,
  onClose: () => void,
  options: { closeOnBlur?: boolean } = {},
) {
  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("click", onClose);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onClose);
    if (options.closeOnBlur) window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onClose);
      if (options.closeOnBlur) window.removeEventListener("blur", onClose);
    };
  }, [isOpen, onClose, options.closeOnBlur]);
}
