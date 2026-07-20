import React, { memo } from "react";
import type { FreeformAnchor, FreeformNode } from "./freeformCanvasModel";

type Props = {
  node: FreeformNode;
  onStart: (event: React.PointerEvent<HTMLButtonElement>, nodeId: string, anchor: FreeformAnchor) => void;
  onMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onEnd: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

const ANCHORS: FreeformAnchor[] = ["top", "right", "bottom", "left"];

export const FreeformConnectorHandles = memo(function FreeformConnectorHandles({ node, onStart, onMove, onEnd }: Props) {
  if (node.kind === "drawing" || node.kind === "group") return null;
  return (
    <div className="freeform-connector-handles">
      {ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          className={`freeform-connector-handle is-${anchor}`}
          aria-label={`${node.title || node.kind}から接続`}
          onPointerDown={(event) => onStart(event, node.id, anchor)}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
        />
      ))}
    </div>
  );
});
