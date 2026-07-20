import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WORKSPACE_PRESETS, type WorkspaceDensity, type WorkspacePresetId } from "../../workspace/layout";

type MenuPosition = {
  top: number;
  right: number;
  maxHeight: number;
};

export const WorkspaceLayoutControls = memo(function WorkspaceLayoutControls({
  preset,
  density,
  onApplyPreset,
  onDensityChange,
  onReset,
}: {
  preset: WorkspacePresetId;
  density: WorkspaceDensity;
  onApplyPreset: (preset: WorkspacePresetId) => void;
  onDensityChange: (density: WorkspaceDensity) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ top: 52, right: 12, maxHeight: 560 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
    setMenuPosition({
      top,
      right: Math.max(viewportPadding, window.innerWidth - rect.right),
      maxHeight: Math.max(180, window.innerHeight - top - viewportPadding),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const reposition = () => updatePosition();

    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const menu = open ? (
    <div
      ref={menuRef}
      className="workspace-layout-menu-v776"
      role="dialog"
      aria-label="ワークスペース配置"
      style={{
        position: "fixed",
        top: menuPosition.top,
        right: menuPosition.right,
        maxHeight: menuPosition.maxHeight,
      }}
    >
      <header><b>作業レイアウト</b><small>ページ・DBの内部タブには影響しません</small></header>
      <div className="workspace-layout-presets-v776">
        {WORKSPACE_PRESETS.map((item) => (
          <button key={item.id} type="button" className={item.id === preset ? "is-active" : ""} onClick={() => { onApplyPreset(item.id); setOpen(false); }}>
            <span>{item.title}</span><small>{item.description}</small>
          </button>
        ))}
      </div>
      <div className="workspace-layout-density-v776">
        <span>表示密度</span>
        <button type="button" className={density === "comfortable" ? "is-active" : ""} onClick={() => onDensityChange("comfortable")}>標準</button>
        <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => onDensityChange("compact")}>コンパクト</button>
      </div>
      <button type="button" className="workspace-layout-reset-v776" onClick={() => { onReset(); setOpen(false); }}>初期配置へ戻す</button>
    </div>
  ) : null;

  return (
    <div className="workspace-layout-controls-v776" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-layout-trigger-v776"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="ワークスペース配置"
      >
        ▦ 配置
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
});
