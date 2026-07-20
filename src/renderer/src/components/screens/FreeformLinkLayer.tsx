import React, { memo } from "react";
import {
  buildLinkPath,
  getLinkLabelPoint,
  type FreeformLink,
  type FreeformNode,
} from "./freeformCanvasModel";

type Props = {
  width: number;
  height: number;
  links: FreeformLink[];
  nodeMap: Map<string, FreeformNode>;
  selectedLinkId: string | null;
  onSelect: (id: string) => void;
};

export const FreeformLinkLayer = memo(function FreeformLinkLayer({
  width,
  height,
  links,
  nodeMap,
  selectedLinkId,
  onSelect,
}: Props) {
  return (
    <svg className="freeform-links" viewBox={`0 0 ${width} ${height}`} style={{ width, height }}>
      <defs>
        <marker id="freeform-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
        <marker id="freeform-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth">
          <path d="M 8 0 L 0 4 L 8 8 z" />
        </marker>
      </defs>
      {links.map((link) => {
        const from = nodeMap.get(link.fromId);
        const to = nodeMap.get(link.toId);
        if (!from || !to) return null;
        const selected = selectedLinkId === link.id;
        const d = buildLinkPath(from, to, link);
        const labelPoint = getLinkLabelPoint(from, to, link);
        return (
          <g
            key={link.id}
            className={`${selected ? "selected " : ""}${(link.proxyCount || 0) > 1 ? "is-proxy" : ""}`.trim() || undefined}
          >
            <path
              className="freeform-link-hit"
              d={d}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(link.id);
              }}
            />
            <path
              className="freeform-link-path"
              d={d}
              markerStart={link.bidirectional ? "url(#freeform-arrow-start)" : undefined}
              markerEnd="url(#freeform-arrow)"
              style={{
                stroke: link.color || "#64748b",
                strokeWidth: link.width || 2,
                strokeDasharray: link.dashed ? "8 6" : undefined,
              }}
            />
            {(link.label || (link.proxyCount || 0) > 1) && (
              <text className="freeform-link-label" x={labelPoint.x} y={labelPoint.y}>
                {link.label || `${link.proxyCount}件`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
