import React from 'react';
import type { DatabaseView, WorkspaceDatabase, DatabasePropertyType } from '../../../../shared/types';
import { viewIcon, viewLabel } from './DatabaseHelpers';

type Props = {
  database: WorkspaceDatabase;
  editing: boolean;
  activeView: DatabaseView;
  commitState: 'idle' | 'dirty' | 'saving' | 'saved';
  latestUpdated?: string | null;
  visibleRowsCount: number;
  visibleTotalRows: number;
  visiblePropertiesCount: number;
  hiddenPropertiesCount: number;
  selectedRowsCount: number;
  fillRate: number;
  completed: number;
  selectedRowIndex: number | string;
  hasSelectedRow: boolean;
  performanceMode: boolean;
  serverTableMode: boolean;
  serverPerf: any | null;
  serverPerfLoading: boolean;
  apiAvailable: boolean;
  serverTableEnabled: boolean;
  hasSubItemRelation: boolean;
  dbSearch: string;
  schemaOpen: boolean;
  controlsOpen: boolean;
  density: 'comfortable' | 'compact';
  fileInputRef: React.RefObject<HTMLInputElement>;
  nonTableRenderLimit: number;
  onTitleChange: (title: string) => void;
  onAddRow: () => void;
  onAddTodayRow: () => void;
  onAddProperty: (type: DatabasePropertyType) => void;
  onToggleAnalysis: () => void;
  onExportCsv: () => void;
  onImportCsvFile: (file: File) => void | Promise<void>;
  onDensityToggle: () => void;
  onLargeDbModeToggle: () => void;
  onRebuildServerIndex: () => void | Promise<void>;
  onServerTableEnabledChange: (enabled: boolean) => void;
  onActivateView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onSwitchOrCreateView: (type: DatabaseView['type']) => void;
  onDbSearchChange: (value: string) => void;
  onSchemaOpenChange: (open: boolean) => void;
  onControlsOpenChange: (open: boolean) => void;
  onAddRowFromTemplate: (templateId: string) => void;
};

export function DatabaseToolbar({
  database,
  editing,
  activeView,
  commitState,
  latestUpdated,
  visibleRowsCount,
  visibleTotalRows,
  visiblePropertiesCount,
  hiddenPropertiesCount,
  selectedRowsCount,
  fillRate,
  completed,
  selectedRowIndex,
  hasSelectedRow,
  performanceMode,
  serverTableMode,
  serverPerf,
  serverPerfLoading,
  apiAvailable,
  serverTableEnabled,
  hasSubItemRelation,
  dbSearch,
  schemaOpen,
  controlsOpen,
  density,
  fileInputRef,
  nonTableRenderLimit,
  onTitleChange,
  onAddRow,
  onAddTodayRow,
  onAddProperty,
  onToggleAnalysis,
  onExportCsv,
  onImportCsvFile,
  onDensityToggle,
  onLargeDbModeToggle,
  onRebuildServerIndex,
  onServerTableEnabledChange,
  onActivateView,
  onDeleteView,
  onSwitchOrCreateView,
  onDbSearchChange,
  onSchemaOpenChange,
  onControlsOpenChange,
  onAddRowFromTemplate,
}: Props) {
  return (
    <>
      <div className="db-command-hero db-fast-hero">
        <div className="db-title-cluster">
          <div className="db-hero-icon db-hero-icon-modern">🗃️</div>
          <div className="db-title-copy">
            <input className="db-title-input db-title-input-modern" value={database.title} disabled={!editing} onChange={e => onTitleChange(e.target.value)} />
            <div className="db-subtitle db-subtitle-modern">
              <span>{database.rows.length} 行</span><span>・</span><span>{database.properties.length} プロパティ</span><span>・</span><span>{database.views?.length ?? 1} ビュー</span>
              <span>・</span><span>{commitState === 'dirty' ? '編集中' : commitState === 'saving' ? '保存中' : commitState === 'saved' ? '保存済み' : '待機中'}</span>
              <span>・</span><span>更新 {latestUpdated ? new Date(latestUpdated).toLocaleString() : 'なし'}</span>
            </div>
          </div>
        </div>
        <div className="db-command-actions">
          <button className="primary-db-action" disabled={!editing} onClick={onAddRow}>＋ 新規</button>{(database.templates ?? []).slice(0, 2).map(tpl => <button key={tpl.id} disabled={!editing} onClick={() => onAddRowFromTemplate(tpl.id)}>＋ {tpl.name}</button>)}
          <button disabled={!editing} onClick={onAddTodayRow}>今日の行</button>
          <button disabled={!editing} onClick={() => onAddProperty('text')}>列を追加</button>
          <button onClick={onToggleAnalysis}>分析</button>
          <button onClick={onExportCsv}>CSV保存</button>
          <button disabled={!editing} onClick={() => fileInputRef.current?.click()}>CSV読込</button>
          <input ref={fileInputRef} className="hidden-file-input" type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file) void onImportCsvFile(file); e.currentTarget.value = ''; }} />
          <button onClick={onDensityToggle}>{density === 'comfortable' ? 'Compact' : 'Comfort'}</button>
          <button className={performanceMode ? 'active' : ''} onClick={onLargeDbModeToggle}>{performanceMode ? 'Large DB ON' : 'Large DB OFF'}</button>
        </div>
      </div>

      <div className="db-insight-grid db-fast-insights">
        <div className="db-insight-card"><span>表示中</span><strong>{visibleRowsCount}</strong><small>/ {serverTableMode ? visibleTotalRows : database.rows.length} 行</small></div>
        <div className="db-insight-card"><span>選択中</span><strong>{selectedRowsCount}</strong><small>行</small></div>
        <div className="db-insight-card"><span>入力率</span><strong>{fillRate}%</strong><small>セル入力済み</small></div>
        <div className="db-insight-card"><span>チェック済み</span><strong>{completed}</strong><small>完了セル</small></div>
        <div className="db-insight-card accent"><span>選択中</span><strong>{selectedRowIndex}</strong><small>{hasSelectedRow ? '行をプレビュー中' : '未選択'}</small></div>
        <div className="db-insight-card db-large-card-v131"><span>大規模DB</span><strong>{performanceMode ? 'ON' : 'OFF'}</strong><small>Tableは仮想表示</small></div>
      </div>

      {performanceMode && <div className="db-large-banner-v131"><strong>Large DB Mode</strong><span>Tableは表示行だけ描画します。Board / Calendar / Gallery / Timeline / Gantt は重くなりやすいため、表示対象が多い場合は先頭 {nonTableRenderLimit} 件に制限します。検索・フィルターで対象を絞ると全体が軽くなります。</span></div>}
      {(performanceMode || serverPerf) && <div className="db-server-engine-banner-v132 db-server-engine-banner-v133">
        <div><strong>SQLite Server Engine</strong><span>検索用FTS5・行順インデックス・ページングAPIをTable表示に接続できます。大量行ではReactへ全件を渡さずページ単位で取得します。</span></div>
        <div className="db-server-engine-stats-v132 db-server-engine-stats-v133">
          <span>{serverPerfLoading ? '確認中...' : serverPerf ? `${serverPerf.indexedRowCount}/${serverPerf.rowCount} indexed` : 'index pending'}</span>
          <button disabled={!apiAvailable || serverPerfLoading} onClick={onRebuildServerIndex}>Reindex</button>
          <label className="db-server-toggle-v133" title={hasSubItemRelation ? '親アイテム表示中は階層と折りたたみを保つため、Server Tableは一時的に無効化されます。' : '大量行ではページ単位で取得します。'}><input type="checkbox" checked={serverTableEnabled && !hasSubItemRelation} disabled={hasSubItemRelation} onChange={e => onServerTableEnabledChange(e.target.checked)} /> Server Table</label>
        </div>
        {hasSubItemRelation && serverTableEnabled ? <small className="db-server-subitem-note-v728">親アイテムRelationを使用中のため、階層表示・折りたたみを優先してServer Tableは自動的に停止しています。</small> : null}
      </div>}

      <div className="db-modern-toolbar db-toolbar-v48">
        <div className="db-view-tabs db-view-tabs-modern">
          {(database.views ?? [activeView]).map(view => (
            <button key={view.id} className={view.id === activeView.id ? 'active db-view-tab-with-delete' : 'db-view-tab-with-delete'} disabled={!editing && view.id !== activeView.id} onClick={() => onActivateView(view.id)}>
              <span>{viewIcon(view.type)} {view.name}</span>
              {editing && (database.views?.length ?? 1) > 1 && <b title="このビューを削除" onClick={(e) => { e.stopPropagation(); onDeleteView(view.id); }}>×</b>}
            </button>
          ))}
          <span className="db-view-kind-switcher-v123">
            {(['table', 'board', 'calendar', 'gallery', 'timeline', 'gantt', 'form'] as DatabaseView['type'][]).map(type => (
              <button key={type} disabled={!editing} onClick={() => onSwitchOrCreateView(type)} title="既存ビューがあれば切替、なければ1つだけ作成">{viewIcon(type)} {viewLabel(type)}</button>
            ))}
          </span>
        </div>
        <div className="db-toolbar-right db-toolbar-right-modern">
          <label className="db-search-box db-search-box-modern"><span>⌕</span><input placeholder="行・セルを検索" value={dbSearch} onChange={e => onDbSearchChange(e.target.value)} /></label>
          <button className={schemaOpen ? 'active' : ''} onClick={() => onSchemaOpenChange(!schemaOpen)}>Properties</button>
          <button className={controlsOpen ? 'active' : ''} onClick={() => onControlsOpenChange(!controlsOpen)} title={hiddenPropertiesCount ? `非表示の列: ${hiddenPropertiesCount}` : '表示列・ビュー設定'}>表示・View {visiblePropertiesCount}/{database.properties.length}{hiddenPropertiesCount ? `（非表示 ${hiddenPropertiesCount}）` : ''}</button>
        </div>
      </div>
    </>
  );
}
