import React from 'react';
import type { DatabaseFilterOperator, DatabaseView, WorkspaceDatabase } from '../../../../shared/types';
import { getBoardGroupProperty, getDateProperty } from './DatabaseHelpers';

type Props = {
  open: boolean;
  activeView: DatabaseView;
  database: WorkspaceDatabase;
  editing: boolean;
  visibleRowsCount: number;
  visiblePropertiesCount: number;
  hiddenColumns: Record<string, boolean>;
  setHiddenColumns: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  renameView: (name: string) => void;
  duplicateActiveView: () => void;
  deleteActiveView: () => void;
  updateView: (view: DatabaseView) => void;
  hideEmptyColumns: () => void;
  resetColumnLayout: () => void;
  resetActiveViewConditions: () => void;
  addFilter: () => void;
  addSort: () => void;
  removeViewFilter: (id: string) => void;
  removeViewSort: (id: string) => void;
};

export function DatabaseViewSettingsPanel(props: Props) {
  const {
    open,
    activeView,
    database,
    editing,
    visibleRowsCount,
    visiblePropertiesCount,
    hiddenColumns,
    setHiddenColumns,
    renameView,
    duplicateActiveView,
    deleteActiveView,
    updateView,
    hideEmptyColumns,
    resetColumnLayout,
    resetActiveViewConditions,
    addFilter,
    addSort,
    removeViewFilter,
    removeViewSort,
  } = props;
  const visibleRows = { length: visibleRowsCount };
  const visibleProperties = { length: visiblePropertiesCount };
  const hiddenProperties = database.properties.filter(prop => hiddenColumns[prop.id]);
  const canHideProperty = visibleProperties.length > 1;
  const setPropertyVisible = (propertyId: string, visible: boolean) => {
    if (!visible && !hiddenColumns[propertyId] && !canHideProperty) return;
    setHiddenColumns(current => ({ ...current, [propertyId]: !visible }));
  };
  if (!open) return null;
  return <div className="db-view-panel db-modern-panel db-view-panel-v130">
        <div className="db-view-hero-v130">
          <div className="db-view-hero-left-v130">
            <span className="db-view-eyebrow-v130">View settings</span>
            <div className="db-view-title-row-v130">
              <span className="db-view-type-badge-v130">{activeView.type}</span>
              <input className="db-view-name-input-v130" disabled={!editing} value={activeView.name} onChange={e => renameView(e.target.value)} />
            </div>
            <p>表示形式・フィルター・ソート・日付列をこのビュー単位で保存します。</p>
          </div>
          <div className="db-view-hero-stats-v130">
            <span><b>{visibleRows.length}</b><small>/ {database.rows.length} rows</small></span>
            <span><b>{visibleProperties.length}</b><small>/ {database.properties.length} props</small></span>
          </div>
        </div>

        <section className="db-view-card-v130">
          <div className="db-view-card-head-v130">
            <div><strong>ビュータイプ</strong><small>Table / Board / Calendar / Form などを切り替えます。</small></div>
            <div className="db-view-actions-v130"><button disabled={!editing} onClick={duplicateActiveView} title="ビューを複製">⧉ 複製</button><button disabled={!editing || ((database.views?.length ?? 1) <= 1)} onClick={deleteActiveView} title="ビューを削除">🗑 削除</button></div>
          </div>
          <div className="db-view-type-grid-v130">
            {(['table','board','calendar','gallery','timeline','gantt','form'] as DatabaseView['type'][]).map(type => <button key={type} disabled={!editing} className={activeView.type === type ? 'active' : ''} onClick={() => updateView({ ...activeView, type })}><span>{type === 'table' ? '▦' : type === 'board' ? '▤' : type === 'calendar' ? '◴' : type === 'gallery' ? '▧' : type === 'timeline' ? '↔' : type === 'gantt' ? '▰' : '✦'}</span><b>{type[0].toUpperCase() + type.slice(1)}</b></button>)}
          </div>
          <div className="db-view-config-grid-v130">
            {(activeView.type === 'board' || activeView.type === 'table') && <label><span>{activeView.type === 'board' ? 'Board グループ列' : 'Table グループ列'}</span><select disabled={!editing} value={activeView.groupByPropertyId ?? (activeView.type === 'board' ? getBoardGroupProperty(database, activeView)?.id ?? '' : '')} onChange={e => updateView({ ...activeView, groupByPropertyId: e.target.value || undefined })}><option value="">グループ化しない</option>{database.properties.map(prop => <option key={prop.id} value={prop.id}>{prop.name}</option>)}</select>{activeView.type === 'table' && <small>グループの開閉はこの端末だけに保存されます。サブアイテム・大規模サーバー表示中は階層の正確性を優先してグループ化しません。</small>}</label>}
            {(activeView.type === 'calendar' || activeView.type === 'timeline' || activeView.type === 'gantt') && <label><span>{activeView.type === 'gantt' ? '開始日列' : '日付列'}</span><select disabled={!editing} value={activeView.datePropertyId ?? getDateProperty(database, activeView)?.id ?? ''} onChange={e => updateView({ ...activeView, datePropertyId: e.target.value, startDatePropertyId: e.target.value })}>{database.properties.filter(prop => prop.type === 'date' || prop.type === 'created_time' || prop.type === 'last_edited_time').map(prop => <option key={prop.id} value={prop.id}>{prop.name}</option>)}</select></label>}
            <div className="db-view-quick-tools-v130"><button onClick={hideEmptyColumns} title="空の列を非表示">空列を隠す</button><button onClick={resetColumnLayout} title="列幅と表示をリセット">列をリセット</button><button disabled={!editing} onClick={resetActiveViewConditions} title="現在のビューのFilter/Sortを消去">条件クリア</button></div>
          </div>
        </section>

        <section className="db-view-card-v130 db-property-visibility-card-v603">
          <div className="db-view-card-head-v130">
            <div><strong>表示するプロパティ</strong><small>この端末だけの表示設定です。データベース本体や他の利用者の表示には影響しません。</small></div>
            <div className="db-view-actions-v130"><button type="button" disabled={hiddenProperties.length === 0} onClick={() => setHiddenColumns({})}>すべて表示</button></div>
          </div>
          <div className="db-property-visibility-summary-v603"><span>表示中 {visibleProperties.length} / {database.properties.length}</span>{hiddenProperties.length > 0 && <span>非表示 {hiddenProperties.length}</span>}</div>
          <div className="db-property-visibility-list-v603">
            {database.properties.map(prop => {
              const visible = !hiddenColumns[prop.id];
              const disabled = visible && !canHideProperty;
              return <label key={prop.id} className={visible ? 'is-visible' : 'is-hidden'} title={disabled ? '最低1列は表示したままにします。' : undefined}>
                <input type="checkbox" checked={visible} disabled={disabled} onChange={event => setPropertyVisible(prop.id, event.target.checked)} />
                <span>{prop.name}</span><small>{prop.type}</small>
              </label>;
            })}
          </div>
          {hiddenProperties.length > 0 && <small className="db-property-visibility-help-v603">非表示の列はここでいつでも戻せます。</small>}
        </section>

        <div className="db-filter-sort-grid-v130">
          <section className="db-view-card-v130 db-filter-card-v130">
            <div className="db-view-card-head-v130"><div><strong>高度フィルター</strong><small>今日・今週・期限切れ・空欄などの条件で絞り込みます。</small></div><div className="db-view-actions-v130"><label className="db-filter-logic-v605">条件<select disabled={!editing} value={activeView.filterLogic ?? 'and'} onChange={e => updateView({ ...activeView, filterLogic: e.target.value === 'or' ? 'or' : 'and' })}><option value="and">すべて満たす（AND）</option><option value="or">いずれか満たす（OR）</option></select></label><button className="db-add-rule-v130" disabled={!editing} onClick={addFilter}>+ 条件を追加</button></div></div>
            <div className="db-rule-list-v130">
              {activeView.filters.length === 0 && <div className="db-empty-rule-v130">フィルター条件はありません。必要な行だけを表示したい時に追加してください。</div>}
              {activeView.filters.map(filter => <div className="db-rule-row-v130" key={filter.id}>
                <select disabled={!editing} value={filter.propertyId} onChange={e => updateView({ ...activeView, filters: activeView.filters.map(f => f.id === filter.id ? { ...f, propertyId: e.target.value } : f) })}>{database.properties.map(prop => <option key={prop.id} value={prop.id}>{prop.name}</option>)}</select>
                <select disabled={!editing} value={filter.operator} onChange={e => updateView({ ...activeView, filters: activeView.filters.map(f => f.id === filter.id ? { ...f, operator: e.target.value as DatabaseFilterOperator } : f) })}><option value="contains">含む</option><option value="not_contains">含まない</option><option value="equals">一致</option><option value="not_equals">不一致</option><option value="starts_with">で始まる</option><option value="ends_with">で終わる</option><option value="greater_than">より大きい</option><option value="less_than">より小さい</option><option value="before">より前</option><option value="after">より後</option><option value="today">今日</option><option value="this_week">今週</option><option value="this_month">今月</option><option value="overdue">期限切れ</option><option value="is_not_empty">空でない</option><option value="is_empty">空</option></select>
                <input disabled={!editing || ['is_empty','is_not_empty','today','this_week','this_month','overdue'].includes(filter.operator)} placeholder="値" value={String(filter.value ?? '')} onChange={e => updateView({ ...activeView, filters: activeView.filters.map(f => f.id === filter.id ? { ...f, value: e.target.value } : f) })} />
                <button className="db-rule-delete-v130" disabled={!editing} onClick={() => removeViewFilter(filter.id)}>×</button>
              </div>)}
            </div>
          </section>

          <section className="db-view-card-v130 db-sort-card-v130">
            <div className="db-view-card-head-v130"><div><strong>ソート</strong><small>計算結果を含め、表示順をビューごとに保存します。</small></div><button className="db-add-rule-v130" disabled={!editing} onClick={addSort}>+ 並び順を追加</button></div>
            <div className="db-rule-list-v130">
              {activeView.sorts.length === 0 && <div className="db-empty-rule-v130">ソート条件はありません。上から順番に適用されます。</div>}
              {activeView.sorts.map(sort => <div className="db-rule-row-v130 db-sort-row-v130" key={sort.id}>
                <select disabled={!editing} value={sort.propertyId} onChange={e => updateView({ ...activeView, sorts: activeView.sorts.map(s => s.id === sort.id ? { ...s, propertyId: e.target.value } : s) })}>{database.properties.map(prop => <option key={prop.id} value={prop.id}>{prop.name}</option>)}</select>
                <select disabled={!editing} value={sort.direction} onChange={e => updateView({ ...activeView, sorts: activeView.sorts.map(s => s.id === sort.id ? { ...s, direction: e.target.value as 'asc' | 'desc' } : s) })}><option value="asc">昇順</option><option value="desc">降順</option></select>
                <button className="db-rule-delete-v130" disabled={!editing} onClick={() => removeViewSort(sort.id)}>×</button>
              </div>)}
            </div>
          </section>
        </div>
      </div>;
}
