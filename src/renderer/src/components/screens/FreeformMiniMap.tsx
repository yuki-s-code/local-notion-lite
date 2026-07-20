import React, { memo } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH, type FreeformNode } from "./freeformCanvasModel";

type Props = { nodes: FreeformNode[]; onActivate: (event: React.MouseEvent<HTMLDivElement>) => void };
export const FreeformMiniMap = memo(function FreeformMiniMap({ nodes, onActivate }: Props) {
  return (
    <div
      className="freeform-minimap"
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.currentTarget.click();
      }}
      role="button"
      tabIndex={0}
      aria-label="ミニマップ。クリックして移動"
    >
      {nodes.map((node) => (
        <span key={node.id} className={`color-${node.color}`} style={{
          left: `${(node.x / CANVAS_WIDTH) * 100}%`,
          top: `${(node.y / CANVAS_HEIGHT) * 100}%`,
          width: `${Math.max(3, (node.w / CANVAS_WIDTH) * 100)}%`,
          height: `${Math.max(3, (node.h / CANVAS_HEIGHT) * 100)}%`,
        }} />
      ))}
    </div>
  );
});
