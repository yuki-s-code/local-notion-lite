import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

type MiniMapSegmentKind = 'heading1' | 'heading2' | 'heading3' | 'text' | 'list' | 'code' | 'quote' | 'divider' | 'empty';

type MiniMapSegment = {
  id: string;
  ratio: number;
  kind: MiniMapSegmentKind;
  title: string;
  line: number;
  indent: number;
  width: number;
  alpha: number;
  color: string;
  weight: number;
};

type MiniMapHeading = {
  id: string;
  line: number;
  level: 1 | 2 | 3;
  title: string;
  ratio: number;
};

type ViewportState = { top: number; height: number };

type InlineRun = { text: string; color: string | null; weight: number; code?: boolean; bold?: boolean; strike?: boolean };

type SourceLine = {
  text: string;
  kind: MiniMapSegmentKind;
  title: string;
  color: string | null;
  runs: InlineRun[];
};

export type PageMiniMapPanelProps = {
  markdown: string;
  /** BlockNote blocks are used because Markdown export drops textColor/backgroundColor styles. */
  blocks?: any[];
};

const MAX_DRAWN_SEGMENTS = 520;
const MAX_HEADING_ITEMS = 10;
const CANVAS_LOGICAL_HEIGHT = 720;
const MINIMAP_SIDE_PADDING = 8;

const FALLBACK_COLORS: Record<MiniMapSegmentKind, string> = {
  heading1: '#0f172a',
  heading2: '#1d4ed8',
  heading3: '#3b82f6',
  text: '#475569',
  list: '#0f766e',
  code: '#7c3aed',
  quote: '#059669',
  divider: '#94a3b8',
  empty: '#cbd5e1',
};

const NAMED_COLORS: Record<string, string> = {
  default: '#475569',
  gray: '#64748b',
  grey: '#64748b',
  brown: '#92400e',
  orange: '#ea580c',
  yellow: '#ca8a04',
  green: '#16a34a',
  blue: '#2563eb',
  purple: '#7c3aed',
  pink: '#db2777',
  red: '#dc2626',
  black: '#0f172a',
  white: '#64748b',
};

function normalizeCssColor(value: unknown): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === 'default' || raw === 'inherit' || raw === 'transparent') return null;
  const color = raw.replace(/[;'"）)]+$/g, '').trim();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([^)]+\)$/i.test(color)) return color;
  return NAMED_COLORS[color.toLowerCase()] ?? null;
}

function normalizeStyleObject(style: any): Record<string, any> {
  if (!style || typeof style !== 'object') return {};
  return style;
}

function styleColor(styles: any, fallback: string | null = null): string | null {
  const s = normalizeStyleObject(styles);
  return normalizeCssColor(s.textColor)
    ?? normalizeCssColor(s.text_color)
    ?? normalizeCssColor(s.color)
    ?? normalizeCssColor(s.foregroundColor)
    ?? fallback;
}

function classifyLine(line: string): MiniMapSegmentKind {
  const trimmed = line.trim();
  if (!trimmed) return 'empty';
  if (/^#{1}\s+/.test(trimmed)) return 'heading1';
  if (/^#{2}\s+/.test(trimmed)) return 'heading2';
  if (/^#{3,}\s+/.test(trimmed)) return 'heading3';
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return 'divider';
  if (/^```/.test(trimmed) || /^\s{4,}\S/.test(line)) return 'code';
  if (/^>\s?/.test(trimmed)) return 'quote';
  if (/^([-*+]\s+|\d+[.)]\s+|- \[[ xX]\]\s+)/.test(trimmed)) return 'list';
  return 'text';
}

function classifyBlock(block: any, fallbackText: string): MiniMapSegmentKind {
  const type = String(block?.type ?? '');
  if (type === 'heading') {
    const level = Math.min(Math.max(Number(block?.props?.level ?? 1), 1), 3);
    return level === 1 ? 'heading1' : level === 2 ? 'heading2' : 'heading3';
  }
  if (type === 'bulletListItem' || type === 'numberedListItem' || type === 'checkListItem') return 'list';
  if (type === 'codeBlock' || type === 'procode') return 'code';
  if (type === 'quote') return 'quote';
  if (type === 'divider') return 'divider';
  return classifyLine(fallbackText);
}

function headingLevel(kind: MiniMapSegmentKind): 1 | 2 | 3 | null {
  if (kind === 'heading1') return 1;
  if (kind === 'heading2') return 2;
  if (kind === 'heading3') return 3;
  return null;
}

function plainTextFromInlineContent(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'link') return plainTextFromInlineContent(part.content);
    if (typeof part.text === 'string') return part.text;
    if (Array.isArray(part.content)) return plainTextFromInlineContent(part.content);
    return '';
  }).join('');
}

function compactRuns(runs: InlineRun[]): InlineRun[] {
  const next: InlineRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const color = run.color ?? null;
    const last = next[next.length - 1];
    if (last && last.color === color && last.code === run.code && last.bold === run.bold && last.strike === run.strike) {
      last.text += run.text;
      last.weight += run.weight;
    } else {
      next.push({ ...run, color });
    }
  }
  return next;
}

function inlineRunsFromContent(content: any, inheritedColor: string | null = null): InlineRun[] {
  if (!content) return [];
  if (typeof content === 'string') return content ? [{ text: content, color: inheritedColor, weight: content.length }] : [];
  if (!Array.isArray(content)) return [];
  const runs: InlineRun[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) runs.push({ text: part, color: inheritedColor, weight: part.length });
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const styles = normalizeStyleObject(part.styles);
    const ownColor = styleColor(styles, inheritedColor);
    if (part.type === 'link') {
      runs.push(...inlineRunsFromContent(part.content, ownColor ?? '#2563eb'));
      continue;
    }
    if (typeof part.text === 'string') {
      runs.push({
        text: part.text,
        color: ownColor,
        weight: Math.max(1, part.text.length),
        code: Boolean(styles.code),
        bold: Boolean(styles.bold),
        strike: Boolean(styles.strike),
      });
      continue;
    }
    if (Array.isArray(part.content)) runs.push(...inlineRunsFromContent(part.content, ownColor));
  }
  return compactRuns(runs);
}

function colorFromMarkdown(line: string): string | null {
  const explicitStyleColor = /(?:^|[\s;"'])color\s*:\s*([^;"'>]+)/i.exec(line);
  const explicitFontColor = /<font[^>]+color=["']?([^"'>\s]+)/i.exec(line);
  const explicit = normalizeCssColor(explicitStyleColor?.[1]) ?? normalizeCssColor(explicitFontColor?.[1]);
  if (explicit) return explicit;
  if (/\[[^\]]+\]\([^)]+\)/.test(line) || /https?:\/\//i.test(line)) return '#2563eb';
  if (/`[^`]+`/.test(line)) return FALLBACK_COLORS.code;
  if (/\*\*[^*]+\*\*/.test(line)) return '#334155';
  if (/~~[^~]+~~/.test(line)) return '#94a3b8';
  return null;
}

function blockTitle(text: string, kind: MiniMapSegmentKind, lineNo: number): string {
  const trimmed = text.trim();
  const lineLabel = `${lineNo + 1}行目`;
  if (kind === 'heading1' || kind === 'heading2' || kind === 'heading3') return trimmed.replace(/^#{1,3}\s+/, '').slice(0, 120) || lineLabel;
  if (kind === 'empty') return `${lineLabel}：空行`;
  if (kind === 'divider') return `${lineLabel}：区切り線`;
  return `${lineLabel}：${trimmed.slice(0, 120) || '本文'}`;
}

function sourceLinesFromBlocks(blocks: any[] | undefined, markdown: string): SourceLine[] {
  if (Array.isArray(blocks) && blocks.length > 0) {
    return blocks.map((block, index) => {
      const text = plainTextFromInlineContent(block?.content) || String(block?.props?.text ?? '').trim();
      const kind = classifyBlock(block, text);
      const blockColor = normalizeCssColor(block?.props?.textColor)
        ?? normalizeCssColor(block?.props?.text_color)
        ?? normalizeCssColor(block?.props?.color);
      const runs = inlineRunsFromContent(block?.content, blockColor);
      const firstColor = blockColor ?? runs.find(run => run.color)?.color ?? null;
      return { text, kind, title: blockTitle(text, kind, index), color: firstColor, runs };
    });
  }
  return markdown.split(/\r?\n/).map((line, index) => {
    const kind = classifyLine(line);
    const color = colorFromMarkdown(line);
    return { text: line, kind, title: blockTitle(line, kind, index), color, runs: color ? [{ text: line, color, weight: Math.max(1, line.length) }] : [] };
  });
}

function stableWidth(seed: string, base: number, range: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.max(10, Math.min(90, base + Math.abs(hash % range)));
}

function segmentIndent(kind: MiniMapSegmentKind): number {
  if (kind === 'heading1') return 6;
  if (kind === 'heading2') return 10;
  if (kind === 'heading3') return 14;
  if (kind === 'code') return 18;
  if (kind === 'list') return 20;
  if (kind === 'quote') return 22;
  if (kind === 'divider') return 10;
  return 25;
}

function baseWidthFor(text: string, kind: MiniMapSegmentKind): number {
  if (kind === 'heading1') return 78;
  if (kind === 'heading2') return 68;
  if (kind === 'heading3') return 58;
  if (kind === 'code') return 64;
  if (kind === 'quote') return 52;
  if (kind === 'list') return 56;
  if (kind === 'divider') return 66;
  return Math.min(72, Math.max(20, text.trim().length * 1.12));
}

function alphaFor(kind: MiniMapSegmentKind, explicitColor: boolean): number {
  if (kind === 'empty') return 0.04;
  if (kind === 'divider') return 0.20;
  if (kind === 'heading1') return explicitColor ? 0.92 : 0.82;
  if (kind === 'heading2') return explicitColor ? 0.86 : 0.74;
  if (kind === 'heading3') return explicitColor ? 0.80 : 0.68;
  if (kind === 'text') return explicitColor ? 0.76 : 0.42;
  return explicitColor ? 0.82 : 0.58;
}

function lineWeight(kind: MiniMapSegmentKind): number {
  if (kind === 'heading1') return 1.35;
  if (kind === 'heading2') return 1.10;
  if (kind === 'heading3') return 0.95;
  if (kind === 'divider') return 0.55;
  if (kind === 'code') return 0.75;
  if (kind === 'list' || kind === 'quote') return 0.70;
  return 0.55;
}

function findScrollTarget(): HTMLElement | null {
  const selectors = ['.editor-pane', '.page-writing-layout-v121', '.page-writing-layout-v49', '.workspace-main-pane', '.dockview-theme-light'];
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el && el.scrollHeight > el.clientHeight + 32) return el;
  }
  return document.scrollingElement as HTMLElement | null;
}

function compactNumber(value: number): string {
  if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
  return String(value);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function PageMiniMapPanel({ markdown, blocks }: PageMiniMapPanelProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragOffsetRef = useRef(0);
  const [viewport, setViewport] = useState<ViewportState>({ top: 0, height: 18 });
  const [canvasSize, setCanvasSize] = useState({ width: 180, height: 420 });

  const { segments, totalLines, headings, headingItems, allHeadingItems, density, blocks: blockCount } = useMemo(() => {
    const lines = sourceLinesFromBlocks(blocks, markdown).filter(line => line.kind !== 'empty' || line.text.trim());
    const effectiveLines = Math.max(lines.length, 1);
    const raw: MiniMapSegment[] = [];
    const headingList: MiniMapHeading[] = [];

    lines.forEach((line, index) => {
      const kind = line.kind;
      const level = headingLevel(kind);
      const indent = segmentIndent(kind);
      const baseWidth = baseWidthFor(line.text, kind);
      const ratio = index / effectiveLines;
      const lineColor = line.color ?? colorFromMarkdown(line.text) ?? FALLBACK_COLORS[kind];
      const width = stableWidth(line.text || `${index}-${kind}`, baseWidth, level ? 10 : 18);
      const coloredRuns = compactRuns(line.runs).filter(run => run.text.trim() || run.color);
      const hasExplicitLineColor = Boolean(line.color || coloredRuns.some(run => run.color));

      if (coloredRuns.length > 1 && coloredRuns.some(run => run.color)) {
        const totalWeight = Math.max(1, coloredRuns.reduce((sum, run) => sum + Math.max(1, run.weight), 0));
        let consumed = 0;
        coloredRuns.slice(0, 7).forEach((run, runIndex, list) => {
          const runShare = (Math.max(1, run.weight) / totalWeight) * width;
          const runWidth = runIndex === list.length - 1 ? Math.max(4, width - consumed) : Math.max(4, runShare);
          const color = run.color ?? (run.code ? FALLBACK_COLORS.code : run.bold ? '#334155' : run.strike ? '#94a3b8' : lineColor);
          raw.push({
            id: `${index}-${kind}-run-${runIndex}`,
            ratio,
            kind,
            title: `${line.title} / ${run.text.trim().slice(0, 50)}`,
            line: index,
            indent: indent + Math.min(width - 6, consumed),
            width: Math.max(4, Math.min(runWidth, width - consumed)),
            alpha: alphaFor(kind, Boolean(run.color)),
            color,
            weight: lineWeight(kind),
          });
          consumed += runShare;
        });
      } else {
        raw.push({
          id: `${index}-${kind}`,
          ratio,
          kind,
          title: line.title,
          line: index,
          indent,
          width,
          alpha: alphaFor(kind, hasExplicitLineColor),
          color: lineColor,
          weight: lineWeight(kind),
        });
      }

      if (level) headingList.push({ id: `${index}-${kind}`, line: index, level, title: line.title, ratio });
    });

    const step = Math.max(1, Math.ceil(raw.length / MAX_DRAWN_SEGMENTS));
    const sampled = raw.filter((item, index) => index % step === 0 || item.kind.startsWith('heading') || item.kind === 'divider' || item.color !== FALLBACK_COLORS[item.kind]);
    const nonEmpty = lines.filter(item => item.kind !== 'empty').length;
    return {
      segments: sampled.slice(0, MAX_DRAWN_SEGMENTS),
      totalLines: lines.length,
      headings: headingList.length,
      headingItems: headingList.slice(0, MAX_HEADING_ITEMS),
      allHeadingItems: headingList,
      density: Math.round((nonEmpty / effectiveLines) * 100),
      blocks: lines.length,
    };
  }, [blocks, markdown]);

  const activeHeadingId = useMemo(() => {
    const currentCenter = (viewport.top + viewport.height / 2) / 100;
    return [...allHeadingItems].reverse().find(item => item.ratio <= currentCenter + 0.01)?.id ?? allHeadingItems[0]?.id ?? null;
  }, [allHeadingItems, viewport.height, viewport.top]);

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      setCanvasSize({ width: Math.max(80, rect.width), height: Math.max(260, rect.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const cssWidth = Math.max(80, canvasSize.width);
    const cssHeight = Math.max(260, canvasSize.height);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const mapWidth = Math.max(24, cssWidth - MINIMAP_SIDE_PADDING * 2);
    const verticalScale = cssHeight / CANVAS_LOGICAL_HEIGHT;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(248,250,252,0.84)';
    roundedRect(ctx, 0, 0, cssWidth, cssHeight, 14);
    ctx.fill();

    ctx.restore();

    // VS Code のミニマップは、短いファイルを上・中・下に均等配置せず、
    // 実際の行の密度に近い形で上から詰めて表示する。
    // 長文だけ、自然な行間では収まらないため全体高に圧縮する。
    const lineCount = Math.max(1, totalLines);
    const naturalPitch = lineCount <= 40 ? 3.2 : lineCount <= 100 ? 2.8 : lineCount <= 180 ? 2.35 : 1.9;
    const naturalContentHeight = 8 + lineCount * naturalPitch;
    const compressToViewport = naturalContentHeight > cssHeight - 8;
    const yForLine = (line: number, ratio: number) => {
      if (compressToViewport) return Math.max(2, Math.min(cssHeight - 2, ratio * cssHeight));
      return Math.max(4, Math.min(cssHeight - 3, 6 + line * naturalPitch));
    };

    for (const segment of segments) {
      const y = yForLine(segment.line, segment.ratio);
      const x = MINIMAP_SIDE_PADDING + segment.indent;
      const maxLineWidth = Math.max(8, mapWidth - segment.indent - 4);
      const width = Math.max(4, Math.min(maxLineWidth, (segment.width / 100) * mapWidth));
      const rawHeight = Math.max(0.45, segment.weight * verticalScale * 1.2);
      const height = Math.min(segment.kind.startsWith('heading') ? 1.35 : 0.85, rawHeight);
      ctx.save();
      ctx.globalAlpha = segment.alpha;
      ctx.fillStyle = segment.color;
      roundedRect(ctx, x, y, width, height, Math.min(2, height / 2));
      ctx.fill();
      ctx.restore();
    }
  }, [canvasSize.height, canvasSize.width, segments, totalLines]);

  const syncViewport = useCallback(() => {
    const target = findScrollTarget();
    if (!target) return;
    const max = Math.max(1, target.scrollHeight - target.clientHeight);
    const nextTop = Math.max(0, Math.min(100, (target.scrollTop / max) * 100));
    const nextHeight = Math.max(8, Math.min(100, (target.clientHeight / Math.max(target.scrollHeight, 1)) * 100));
    setViewport(prev => {
      if (Math.abs(prev.top - nextTop) < 0.2 && Math.abs(prev.height - nextHeight) < 0.2) return prev;
      return { top: nextTop, height: nextHeight };
    });
  }, []);

  useEffect(() => {
    const target = findScrollTarget();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncViewport);
    };
    syncViewport();
    target?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      target?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [syncViewport, markdown, blocks]);

  const jumpToRatio = useCallback((ratio: number) => {
    const target = findScrollTarget();
    if (!target) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    target.scrollTo({ top: (target.scrollHeight - target.clientHeight) * clamped, behavior: 'smooth' });
  }, []);

  const jumpToLine = useCallback((line: number) => {
    const ratio = totalLines <= 1 ? 0 : line / Math.max(totalLines - 1, 1);
    jumpToRatio(ratio);
  }, [jumpToRatio, totalLines]);

  const ratioFromClientY = useCallback((clientY: number, offsetPercent = 0) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return ((clientY - rect.top) / Math.max(rect.height, 1)) - (offsetPercent / 100);
  }, []);

  const handleMapPointer = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.page-minimap-glass-v726,.page-minimap-heading-item-v726')) return;
    jumpToRatio(ratioFromClientY(event.clientY));
  }, [jumpToRatio, ratioFromClientY]);

  const handleViewportPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerPercent = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    dragOffsetRef.current = Math.max(0, Math.min(viewport.height, pointerPercent - viewport.top));
    const onMove = (moveEvent: PointerEvent) => jumpToRatio(ratioFromClientY(moveEvent.clientY, dragOffsetRef.current));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }, [jumpToRatio, ratioFromClientY, viewport.height, viewport.top]);

  if (!markdown.trim() && (!blocks || blocks.length === 0)) {
    return (
      <section className="page-minimap-panel-v726" aria-label="ページミニマップ">
        <div className="page-minimap-titlebar-v726"><div><span>Page overview</span><h3>ミニマップ</h3></div><em>待機中</em></div>
        <div className="page-minimap-empty-v726">本文を入力すると、ページ全体の構造と現在位置を表示します。</div>
      </section>
    );
  }

  const showViewportGlass = viewport.height < 96;

  return (
    <section className="page-minimap-panel-v726" aria-label="ページミニマップ">
      <div className="page-minimap-titlebar-v726">
        <div><span>Page overview</span><h3>ミニマップ</h3></div>
        <em>Glass viewport</em>
      </div>

      <div className="page-minimap-stats-v726" aria-label="ページ統計">
        <span><strong>{compactNumber(totalLines)}</strong>行</span>
        <span><strong>{compactNumber(blockCount)}</strong>ブロック</span>
        <span><strong>{headings}</strong>見出し</span>
        <span><strong>{density}%</strong>密度</span>
      </div>

      <div className="page-minimap-mapwrap-v726">
        <div ref={mapRef} className="page-minimap-map-v726" role="img" aria-label="ページ全体のミニマップ" onClick={handleMapPointer}>
          <canvas ref={canvasRef} className="page-minimap-canvas-v726" />
          {showViewportGlass && (
            <button
              type="button"
              className="page-minimap-glass-v726"
              style={{ top: `${viewport.top}%`, height: `${viewport.height}%` }}
              aria-label="現在の表示範囲"
              title="現在の表示範囲。ドラッグするとページをスクロールできます。"
              onPointerDown={handleViewportPointerDown}
              onClick={(event) => event.stopPropagation()}
            ><span>現在位置</span></button>
          )}
        </div>
      </div>

      {headingItems.length > 0 && (
        <div className="page-minimap-heading-card-v726">
          <div className="page-minimap-subhead-v726">章ジャンプ</div>
          <div className="page-minimap-heading-list-v726">
            {headingItems.map(item => (
              <button key={item.id} type="button" className={`page-minimap-heading-item-v726 level-${item.level} ${item.id === activeHeadingId ? 'active' : ''}`} onClick={() => jumpToLine(item.line)} title={item.title}>
                <span className="page-minimap-heading-dot-v726" />
                <span className="page-minimap-heading-text-v726">{item.title}</span>
              </button>
            ))}
            {headings > headingItems.length && <div className="page-minimap-heading-more-v726">ほか {headings - headingItems.length} 件の見出しはミニマップ上で確認できます。</div>}
          </div>
        </div>
      )}

      <div className="page-minimap-footer-v726">
        <span><i className="is-heading" />見出し</span>
        <span><i className="is-body" />本文</span>
        <span><i className="is-color" />文字色</span>
        <span><i className="is-viewport" />ガラス枠</span>
      </div>
    </section>
  );
}
