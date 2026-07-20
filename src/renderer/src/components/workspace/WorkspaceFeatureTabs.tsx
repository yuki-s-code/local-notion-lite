import { memo, useState, type ReactNode } from "react";
import { getWorkspaceScreen } from "../../workspace/registry";
import type { WorkspaceScreenId } from "../../workspace/types";

export const WorkspaceFeatureTabs = memo(function WorkspaceFeatureTabs({
  screens,
  activeScreen,
  onActivate,
  onClose,
  onReorder,
  controls,
}: {
  screens: WorkspaceScreenId[];
  activeScreen: WorkspaceScreenId;
  onActivate: (screen: WorkspaceScreenId) => void;
  onClose: (screen: WorkspaceScreenId) => void;
  onReorder: (source: WorkspaceScreenId, target: WorkspaceScreenId) => void;
  controls?: ReactNode;
}) {
  const [dragging, setDragging] = useState<WorkspaceScreenId | null>(null);
  return (
    <nav className="workspace-feature-tabs-v775" aria-label="ワークスペース機能タブ">
      <div className="workspace-feature-tabs-scroll-v775">
        {screens.map((screen) => {
          const definition = getWorkspaceScreen(screen);
          const active = screen === activeScreen;
          return (
            <div key={screen} draggable={screen !== "documents"} onDragStart={(event) => { setDragging(screen); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", screen); }} onDragEnd={() => setDragging(null)} onDragOver={(event) => { if (dragging && dragging !== screen) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const source = dragging ?? event.dataTransfer.getData("text/plain") as WorkspaceScreenId; setDragging(null); if (source && source !== screen) onReorder(source, screen); }} className={`workspace-feature-tab-v775${active ? " is-active" : ""}${dragging === screen ? " is-dragging" : ""}`}>
              <button type="button" className="workspace-feature-tab-main-v775" onClick={() => onActivate(screen)} title={definition.title}>
                <span aria-hidden="true">{definition.icon}</span>
                <b>{definition.title}</b>
              </button>
              {screen !== "documents" && (
                <button type="button" className="workspace-feature-tab-close-v775" onClick={(event) => { event.stopPropagation(); onClose(screen); }} aria-label={`${definition.title}を閉じる`} title="閉じる">×</button>
              )}
            </div>
          );
        })}
      </div>
      <small className="workspace-feature-tabs-hint-v775">ページ・DBの個別タブは「ページ・データベース」内で管理されます</small>
      {controls}
    </nav>
  );
});
