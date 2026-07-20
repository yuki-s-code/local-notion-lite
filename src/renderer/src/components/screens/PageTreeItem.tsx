
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PageProperties, PageTreeNode, WorkspaceScope } from '../../../../shared/types';

type PageTemplateKey = 'blank' | 'meeting' | 'faq' | 'manual' | 'task';
type PageTemplate = { key: PageTemplateKey; title: string; icon: string; description: string; blocks: any; properties?: Partial<PageProperties> };
function paragraph(text = ''): any { return { type: 'paragraph', content: text ? [{ type: 'text', text, styles: {} }] : [] }; }
function heading(text: string, level = 1): any { return { type: 'heading', props: { level }, content: [{ type: 'text', text, styles: {} }] }; }
function bullet(text: string): any { return { type: 'bulletListItem', content: [{ type: 'text', text, styles: {} }] }; }
function checklist(text: string): any { return { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text, styles: {} }] }; }
const PAGE_TEMPLATES: PageTemplate[] = [
  { key: 'blank', title: '空白ページ', icon: '📄', description: '何もないページから始めます。', blocks: [paragraph()] },
  { key: 'meeting', title: '会議メモ', icon: '📝', description: '議題・決定事項・ToDoをすぐ書けます。', properties: { tags: ['会議'], status: '進行中' }, blocks: [heading('会議メモ', 1), paragraph('日時：'), paragraph('参加者：'), heading('議題', 2), bullet(''), heading('決定事項', 2), bullet(''), heading('ToDo', 2), checklist('')] },
];
function scopeIcon(scope?: WorkspaceScope) { return scope === 'private' ? '🔒' : '🌐'; }
function scopeLabel(scope?: WorkspaceScope) { return scope === 'private' ? 'Private' : 'Shared'; }
function pageScope(page?: { scope?: WorkspaceScope } | null): WorkspaceScope { return page?.scope === 'private' ? 'private' : 'shared'; }
function normalizePageProperties(input?: Partial<PageProperties> | null): PageProperties {
  return {
    tags: Array.isArray(input?.tags) ? input!.tags!.filter(Boolean) : [],
    status: ['未着手','進行中','確認待ち','完了','保留'].includes(String(input?.status)) ? input!.status as any : '未着手',
    priority: ['低','中','高','緊急'].includes(String(input?.priority)) ? input!.priority as any : '中',
    assignee: input?.assignee ?? '',
    dueDate: input?.dueDate ?? '',
    url: input?.url ?? '',
    summary: input?.summary ?? '',
  };
}
function countDescendantPages(node: PageTreeNode): number { return node.children.reduce((sum, child) => sum + 1 + countDescendantPages(child), 0); }
function formatShortDate(value?: string): string {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit' }).format(new Date(value)); } catch { return value.slice(0, 10); }
}


type FlatPageTreeRow = {
  node: PageTreeNode;
  depth: number;
  descendantCount: number;
};

function flattenVisibleTreeRows(
  nodes: PageTreeNode[],
  collapsedIds: Set<string>,
): FlatPageTreeRow[] {
  const rows: FlatPageTreeRow[] = [];
  const descendantCache = new Map<string, number>();
  const countAllDescendants = (node: PageTreeNode): number => {
    const cached = descendantCache.get(node.id);
    if (cached !== undefined) return cached;
    let total = 0;
    for (const child of node.children) total += 1 + countAllDescendants(child);
    descendantCache.set(node.id, total);
    return total;
  };
  const visit = (node: PageTreeNode, depth: number) => {
    rows.push({ node, depth, descendantCount: countAllDescendants(node) });
    if (!collapsedIds.has(node.id)) {
      for (const child of node.children) visit(child, depth + 1);
    }
  };
  nodes.forEach((node) => visit(node, 0));
  return rows;
}

export function VirtualPageTree({
  nodes,
  currentId,
  collapsedIds,
  onToggleCollapse,
  onOpen,
  onCreateChild,
  onCreateFromTemplate,
  onMovePage,
  onToggleFavorite,
  onDuplicatePage,
  onTrashPage,
  onReorderPage,
  onContextMenu,
  draggedPageId,
  onDragStart,
  onDragEnd,
}: {
  nodes: PageTreeNode[];
  currentId?: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpen: (id: string) => void;
  onCreateChild: (id: string) => void;
  onCreateFromTemplate: (template: PageTemplate, parentId: string | null, scope?: WorkspaceScope) => void | Promise<void>;
  onMovePage: (id: string, parentId: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicatePage: (id: string) => void;
  onTrashPage: (id: string) => void;
  onReorderPage: (id: string, direction: -1 | 1) => void;
  onContextMenu: (event: React.MouseEvent, node: PageTreeNode) => void;
  draggedPageId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  const rows = useMemo(
    () => flattenVisibleTreeRows(nodes, collapsedIds),
    [nodes, collapsedIds],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);
  const rowHeight = 34;
  const overscan = 10;

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportHeight(Math.max(180, element.clientHeight || 420));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const topPadding = startIndex * rowHeight;
  const bottomPadding = Math.max(0, (rows.length - endIndex) * rowHeight);

  return (
    <div
      ref={scrollRef}
      className="virtual-page-tree-v715"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      aria-label="ページツリー"
    >
      {topPadding > 0 && <div aria-hidden="true" style={{ height: topPadding }} />}
      {visibleRows.map(({ node, depth, descendantCount }) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={depth}
          currentId={currentId}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          onOpen={onOpen}
          onCreateChild={onCreateChild}
          onCreateFromTemplate={onCreateFromTemplate}
          onMovePage={onMovePage}
          onToggleFavorite={onToggleFavorite}
          onDuplicatePage={onDuplicatePage}
          onTrashPage={onTrashPage}
          onReorderPage={onReorderPage}
          onContextMenu={onContextMenu}
          draggedPageId={draggedPageId}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          renderChildren={false}
          descendantCount={descendantCount}
        />
      ))}
      {bottomPadding > 0 && <div aria-hidden="true" style={{ height: bottomPadding }} />}
      {rows.length === 0 && <div className="virtual-page-tree-empty-v715">ページがありません</div>}
    </div>
  );
}

export function TreeItem({ node, depth = 0, currentId, collapsedIds, onToggleCollapse, onOpen, onCreateChild, onCreateFromTemplate, onMovePage, onToggleFavorite, onDuplicatePage, onTrashPage, onReorderPage, onContextMenu, draggedPageId, onDragStart, onDragEnd, renderChildren = true, descendantCount }: {
  node: PageTreeNode;
  depth?: number;
  currentId?: string;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onOpen: (id: string) => void;
  onCreateChild: (id: string) => void;
  onCreateFromTemplate: (template: PageTemplate, parentId: string | null, scope?: WorkspaceScope) => void | Promise<void>;
  onMovePage: (id: string, parentId: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onDuplicatePage: (id: string) => void;
  onTrashPage: (id: string) => void;
  onReorderPage: (id: string, direction: -1 | 1) => void;
  onContextMenu: (event: React.MouseEvent, node: PageTreeNode) => void;
  draggedPageId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  renderChildren?: boolean;
  descendantCount?: number;
}) {
  const [previewAnchor, setPreviewAnchor] = useState<{ left: number; top: number } | null>(null);
  const [actionMenuAnchor, setActionMenuAnchor] = useState<{ left: number; top: number } | null>(null);
  const closeMenuTimerRef = useRef<number | null>(null);

  function cancelMenuCloseTimer() {
    if (closeMenuTimerRef.current !== null) {
      window.clearTimeout(closeMenuTimerRef.current);
      closeMenuTimerRef.current = null;
    }
  }

  function scheduleActionMenuClose(delay = 260) {
    cancelMenuCloseTimer();
    closeMenuTimerRef.current = window.setTimeout(() => {
      setActionMenuAnchor(null);
      closeMenuTimerRef.current = null;
    }, delay);
  }
  const visualDepth = Math.min(depth, 5);

  useEffect(() => {
    function closeWhenAnotherPageIsActive(event: Event) {
      const activeId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (activeId && activeId !== node.id) {
        scheduleActionMenuClose(260);
      }
    }

    window.addEventListener('local-notion:tree-hover', closeWhenAnotherPageIsActive as EventListener);
    window.addEventListener('local-notion:tree-menu-open', closeWhenAnotherPageIsActive as EventListener);
    return () => {
      cancelMenuCloseTimer();
      window.removeEventListener('local-notion:tree-hover', closeWhenAnotherPageIsActive as EventListener);
      window.removeEventListener('local-notion:tree-menu-open', closeWhenAnotherPageIsActive as EventListener);
    };
  }, [node.id]);

  function showTreePreview(event: React.MouseEvent<HTMLDivElement>) {
    cancelMenuCloseTimer();
    window.dispatchEvent(new CustomEvent('local-notion:tree-hover', { detail: { id: node.id } }));
    const rect = event.currentTarget.getBoundingClientRect();
    const previewWidth = 380;
    const margin = 14;
    const availableRight = window.innerWidth - rect.right;
    const left = availableRight >= previewWidth + margin
      ? rect.right + margin
      : Math.max(12, rect.left - previewWidth - margin);
    const top = Math.min(Math.max(rect.top + rect.height / 2, 130), window.innerHeight - 130);
    setPreviewAnchor({ left, top });
  }

  function hideTreePreview() {
    setPreviewAnchor(null);
  }

  function toggleActionMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    cancelMenuCloseTimer();
    window.dispatchEvent(new CustomEvent('local-notion:tree-menu-open', { detail: { id: node.id } }));
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 188;
    const estimatedHeight = 286;
    const margin = 10;
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    let top = rect.bottom + 6;
    if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
      top = rect.top - Math.min(estimatedHeight, spaceAbove) - 6;
    }
    top = Math.min(Math.max(margin, top), window.innerHeight - Math.min(estimatedHeight, window.innerHeight - margin * 2) - margin);
    setActionMenuAnchor(current => current ? null : { left, top });
  }

  function closeActionMenu() {
    cancelMenuCloseTimer();
    setActionMenuAnchor(null);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedPageId || draggedPageId === node.id) return;
    onMovePage(draggedPageId, node.id);
  }

  const hasChildren = node.children.length > 0;
  const directChildCount = node.children.length;
  const totalChildCount = descendantCount ?? countDescendantPages(node);
  const collapsed = collapsedIds.has(node.id);
  const properties = normalizePageProperties(node.properties);
  const updatedLabel = formatShortDate(node.updatedAt);
  const previewSnippet = ((node.previewSnippet ?? '')
    .replace(/@\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\{\{database:[^}]+\}\}/g, 'データベース')
    .replace(/\s+/g, ' ')
    .trim());

  return (
    <div className="tree-item">
      <div
        className={`tree-row ${currentId === node.id ? 'selected' : ''} ${draggedPageId === node.id ? 'dragging' : ''}`}
        style={{ '--tree-depth': visualDepth } as React.CSSProperties}
        draggable
        onDragStart={() => onDragStart(node.id)}
        onDragEnd={onDragEnd}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onContextMenu={(e) => onContextMenu(e, node)}
        onMouseEnter={showTreePreview}
        onMouseLeave={hideTreePreview}
        onClick={() => onOpen(node.id)}
        title="クリックで開く。ドラッグして別ページの上に落とすと、その子ページへ移動します"
      >
        <button className="collapse-toggle" onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleCollapse(node.id); }} title={hasChildren ? (collapsed ? '開く' : '閉じる') : ''}>{hasChildren ? (collapsed ? '▸' : '▾') : ''}</button>
        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
        <button className="favorite-star" onClick={(e) => { e.stopPropagation(); onToggleFavorite(node.id); }} title={node.favorite ? 'お気に入り解除' : 'お気に入り'}>{node.favorite ? '★' : '☆'}</button>
        <button className="tree-title" onClick={(e) => { e.stopPropagation(); onOpen(node.id); }} title={node.title}>
          <span className="tree-title-main">
            <span className="icon">{node.icon ?? '📄'}</span>
            <span className={`tree-scope-mini ${pageScope(node)}`} title={scopeLabel(pageScope(node))}>{scopeIcon(pageScope(node))}</span>
            <span className="tree-title-text">{node.title}</span>
          </span>
        </button>
        <span className="tree-meta-slot" aria-label="ページ情報">
          {directChildCount > 0 && <span className="child-count-badge" title={`直下 ${directChildCount}件 / 全体 ${totalChildCount}件`}>{directChildCount}</span>}
          {node.isLocked && <span className="lock-badge" title="ロック中">🔒</span>}
        </span>
        {previewAnchor && typeof document !== 'undefined' && createPortal(
          <div
            className="tree-hover-preview-portal notion-tree-floating-preview"
            role="tooltip"
            style={{ left: previewAnchor.left, top: previewAnchor.top }}
          >
            <div className="tree-hover-preview-head">
              <span className="preview-icon">{node.icon ?? '📄'}</span>
              <div>
                <strong>{node.title}</strong>
                <small>{updatedLabel ? `更新 ${updatedLabel}` : '更新日なし'}{node.updatedBy ? ` ・ ${node.updatedBy}` : ''}</small>
              </div>
            </div>
            <div className="tree-hover-preview-body">
              {previewSnippet ? previewSnippet : '本文はまだありません。'}
            </div>
            <div className="tree-hover-preview-meta">
              <span>{properties.status}</span>
              <span>{properties.priority}</span>
              {directChildCount > 0 && <span>子ページ {directChildCount}</span>}
              {totalChildCount > directChildCount && <span>配下 {totalChildCount}</span>}
            </div>
            {properties.tags.length > 0 && <div className="tree-hover-preview-tags">{properties.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}</div>}
          </div>,
          document.body
        )}
        <button className="tree-row-more" onClick={toggleActionMenu} title="ページ操作">⋯</button>
        {actionMenuAnchor && typeof document !== 'undefined' && createPortal(
          <div className="tree-action-menu-portal" style={{ left: actionMenuAnchor.left, top: actionMenuAnchor.top }} onMouseEnter={cancelMenuCloseTimer} onMouseLeave={() => scheduleActionMenuClose(280)} onMouseDown={e => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); closeActionMenu(); onCreateChild(node.id); }}><span>＋</span><div><strong>子ページを作成</strong><small>このページの下に追加</small></div></button>
            <button onClick={(e) => { e.stopPropagation(); closeActionMenu(); onCreateFromTemplate(PAGE_TEMPLATES[1], node.id); }}><span>📝</span><div><strong>会議メモを作成</strong><small>テンプレートから子ページ作成</small></div></button>
            <button onClick={(e) => { e.stopPropagation(); closeActionMenu(); onReorderPage(node.id, -1); }}><span>↑</span><div><strong>上へ移動</strong><small>同じ階層で並び替え</small></div></button>
            <button onClick={(e) => { e.stopPropagation(); closeActionMenu(); onReorderPage(node.id, 1); }}><span>↓</span><div><strong>下へ移動</strong><small>同じ階層で並び替え</small></div></button>
            <button onClick={(e) => { e.stopPropagation(); closeActionMenu(); onToggleFavorite(node.id); }}><span>{node.favorite ? '☆' : '★'}</span><div><strong>{node.favorite ? 'お気に入り解除' : 'お気に入り'}</strong><small>サイドバー上部に表示</small></div></button>
            <button className="danger" onClick={(e) => { e.stopPropagation(); closeActionMenu(); onTrashPage(node.id); }}><span>🗑</span><div><strong>ゴミ箱へ移動</strong><small>後から復元できます</small></div></button>
          </div>,
          document.body
        )}
      </div>
      {renderChildren && hasChildren && !collapsed && (
        <div className="tree-children">
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onOpen={onOpen}
              onCreateChild={onCreateChild}
              onCreateFromTemplate={onCreateFromTemplate}
              onMovePage={onMovePage}
              onToggleFavorite={onToggleFavorite}
              onDuplicatePage={onDuplicatePage}
              onTrashPage={onTrashPage}
              onReorderPage={onReorderPage}
              onContextMenu={onContextMenu}
              draggedPageId={draggedPageId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

