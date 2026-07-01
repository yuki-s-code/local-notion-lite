import React from 'react';
import type { WorkspaceDatabase } from '../../../../shared/types';
import { applyAdvancedDatabaseFilter, dbText, getComputedCellValue, getDeadlineStatus, isCheckedDatabaseValue, isFilledDatabaseValue, propertyTypeIcon, toDatabaseNumber, viewIcon } from './DatabaseHelpers';

type Props = {
  database: WorkspaceDatabase;
  editing: boolean;
  backupInputRef: React.RefObject<HTMLInputElement>;
  dashboardOpen: boolean;
  templateOpen: boolean;
  trashOpen: boolean;
  fillRate: number;
  relationPropertiesCount: number;
  onDashboardOpenChange: (open: boolean) => void;
  onTemplateOpenChange: (open: boolean) => void;
  onTrashOpenChange: (open: boolean) => void;
  onExportDatabaseJson: () => void;
  onImportDatabaseJson: (file: File) => void | Promise<void>;
  onIntegrityReport: () => void;
  onInstallTaskManagementPack: () => void;
  onAddCurrentRowAsTemplate: () => void;
  onAddRowFromTemplate: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onEmptyTrash: () => void;
  onRestoreTrashedRow: (rowId: string) => void;
  onRestoreTrashedProperty: (propId: string) => void;
  onRestoreTrashedView: (viewId: string) => void;
};

export function DatabaseUtilityPanels({
  database,
  editing,
  backupInputRef,
  dashboardOpen,
  templateOpen,
  trashOpen,
  fillRate,
  relationPropertiesCount,
  onDashboardOpenChange,
  onTemplateOpenChange,
  onTrashOpenChange,
  onExportDatabaseJson,
  onImportDatabaseJson,
  onIntegrityReport,
  onInstallTaskManagementPack,
  onAddCurrentRowAsTemplate,
  onAddRowFromTemplate,
  onDeleteTemplate,
  onEmptyTrash,
  onRestoreTrashedRow,
  onRestoreTrashedProperty,
  onRestoreTrashedView,
}: Props) {
  const overdueCount = database.rows.filter(row => database.properties.some(prop => prop.type === 'date' && applyAdvancedDatabaseFilter(dbText(row.cells[prop.id]), row.cells[prop.id], 'overdue', ''))).length;

  return (
    <>
      <div className="db-utility-strip-v251">
        <button className={dashboardOpen ? 'active' : ''} onClick={() => onDashboardOpenChange(!dashboardOpen)}>Dashboard</button>
        <button className={templateOpen ? 'active' : ''} onClick={() => onTemplateOpenChange(!templateOpen)}>Templates</button>
        <button className={trashOpen ? 'active' : ''} onClick={() => onTrashOpenChange(!trashOpen)}>Trash</button>
        <button onClick={onIntegrityReport}>整合性チェック</button>
        <button disabled={!editing} onClick={onInstallTaskManagementPack}>Task Pack</button>
        <button onClick={onExportDatabaseJson}>JSON保存</button>
        <button disabled={!editing} onClick={() => backupInputRef.current?.click()}>JSON復元</button>
      </div>
      <input ref={backupInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file) void onImportDatabaseJson(file); e.currentTarget.value = ''; }} />
      {dashboardOpen && <DatabaseDashboardPanel database={database} fillRate={fillRate} overdueCount={overdueCount} relationPropertiesCount={relationPropertiesCount} />}
      {templateOpen && <DatabaseTemplatePanel database={database} editing={editing} onAddCurrentRowAsTemplate={onAddCurrentRowAsTemplate} onAddRowFromTemplate={onAddRowFromTemplate} onDeleteTemplate={onDeleteTemplate} />}
      {trashOpen && <DatabaseTrashPanel database={database} editing={editing} onEmptyTrash={onEmptyTrash} onRestoreTrashedRow={onRestoreTrashedRow} onRestoreTrashedProperty={onRestoreTrashedProperty} onRestoreTrashedView={onRestoreTrashedView} />}
    </>
  );
}

function DatabaseDashboardPanel({ database, fillRate, overdueCount, relationPropertiesCount }: { database: WorkspaceDatabase; fillRate: number; overdueCount: number; relationPropertiesCount: number }) {
  const numericSummaries = database.properties
    .filter(prop => prop.type === 'number' || prop.type === 'formula' || prop.type === 'rollup')
    .map(prop => {
      const values = database.rows.map(row => toDatabaseNumber(getComputedCellValue(prop, row, database, []))).filter((value): value is number => value !== null);
      if (!values.length) return null;
      const sum = values.reduce((total, value) => total + value, 0);
      return { prop, count: values.length, sum, average: sum / values.length, min: Math.min(...values), max: Math.max(...values) };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 6);
  const checkSummaries = database.properties.filter(prop => prop.type === 'checkbox').map(prop => {
    const checked = database.rows.filter(row => isCheckedDatabaseValue(row.cells[prop.id])).length;
    return { prop, checked, total: database.rows.length };
  }).slice(0, 4);
  const selectSummaries = database.properties.filter(prop => (prop.type === 'select' || prop.type === 'status')).map(prop => {
    const counts = new Map<string, number>();
    database.rows.forEach(row => { const value = dbText(row.cells[prop.id]).trim(); if (value) counts.set(value, (counts.get(value) ?? 0) + 1); });
    return { prop, items: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) };
  }).filter(item => item.items.length > 0).slice(0, 4);
  const deadlineSummary = database.properties.filter(prop => prop.type === 'date').map(prop => {
    const statuses = database.rows.map(row => getDeadlineStatus(prop, row.cells[prop.id])).filter(Boolean);
    return { prop, overdue: statuses.filter(item => item?.tone === 'overdue').length, today: statuses.filter(item => item?.tone === 'today').length, soon: statuses.filter(item => item?.tone === 'soon').length };
  }).filter(item => item.overdue || item.today || item.soon).slice(0, 4);
  return (
    <div className="db-view-panel db-modern-panel db-pro-panel-v129">
      <div className="db-view-section-head db-view-section-head-v118"><strong>DB Dashboard</strong><span>{database.title}</span></div>
      <div className="db-insight-grid db-fast-insights">
        <div className="db-insight-card"><span>全行</span><strong>{database.rows.length}</strong><small>rows</small></div>
        <div className="db-insight-card"><span>入力率</span><strong>{fillRate}%</strong><small>filled</small></div>
        <div className="db-insight-card"><span>期限切れ</span><strong>{overdueCount}</strong><small>overdue</small></div>
        <div className="db-insight-card"><span>Relation</span><strong>{relationPropertiesCount}</strong><small>properties</small></div>
      </div>
      <div className="db-summary-grid-v553">
        {numericSummaries.map(({ prop, count, sum, average, min, max }) => <section key={prop.id}><strong>{propertyTypeIcon(prop.type)} {prop.name}</strong><div><span>合計 <b>{sum.toLocaleString('ja-JP')}</b></span><span>平均 <b>{average.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}</b></span><span>最小〜最大 <b>{min.toLocaleString('ja-JP')}〜{max.toLocaleString('ja-JP')}</b></span><small>{count}件を集計</small></div></section>)}
        {checkSummaries.map(({ prop, checked, total }) => <section key={prop.id}><strong>☑ {prop.name}</strong><div><span>チェック済み <b>{checked} / {total}</b></span><div className="db-summary-progress-v553"><i style={{ width: `${total ? Math.round((checked / total) * 100) : 0}%` }} /></div><small>{total ? Math.round((checked / total) * 100) : 0}% 完了</small></div></section>)}
        {selectSummaries.map(({ prop, items }) => <section key={prop.id}><strong>▾ {prop.name}</strong><div className="db-summary-chips-v553">{items.map(([label, count]) => <span key={label}>{label}<b>{count}</b></span>)}</div></section>)}
        {deadlineSummary.map(({ prop, overdue, today, soon }) => <section key={prop.id}><strong>📅 {prop.name}</strong><div className="db-summary-chips-v553"><span className="overdue">期限切れ<b>{overdue}</b></span><span className="today">今日<b>{today}</b></span><span className="soon">7日以内<b>{soon}</b></span></div></section>)}
      </div>
      {numericSummaries.length + checkSummaries.length + selectSummaries.length + deadlineSummary.length === 0 ? <p className="db-summary-empty-v553">集計できる数値・チェック・選択・期限列が追加されると、ここに自動集計を表示します。</p> : null}
      <div className="db-pro-list-v129"><strong>未入力が多い列</strong>{database.properties.filter(prop => !['created_time', 'last_edited_time'].includes(prop.type)).slice(0, 8).map(prop => { const empty = database.rows.filter(row => !isFilledDatabaseValue(row.cells[prop.id])).length; return <div key={prop.id}><span>{propertyTypeIcon(prop.type)} {prop.name}</span><b>{empty} empty</b></div>; })}</div>
    </div>
  );
}

function DatabaseTemplatePanel({ database, editing, onAddCurrentRowAsTemplate, onAddRowFromTemplate, onDeleteTemplate }: { database: WorkspaceDatabase; editing: boolean; onAddCurrentRowAsTemplate: () => void; onAddRowFromTemplate: (templateId: string) => void; onDeleteTemplate: (templateId: string) => void }) {
  return (
    <div className="db-view-panel db-modern-panel db-pro-panel-v129">
      <div className="db-view-section-head db-view-section-head-v118"><strong>DBテンプレート</strong><button disabled={!editing} onClick={onAddCurrentRowAsTemplate}>選択行から作成</button></div>
      <div className="db-pro-list-v129">{(database.templates ?? []).length === 0 ? <small>テンプレートはまだありません。行を選択して「選択行から作成」を押してください。</small> : (database.templates ?? []).map(tpl => <div key={tpl.id}><span>📋 {tpl.name}</span><button disabled={!editing} onClick={() => onAddRowFromTemplate(tpl.id)}>このテンプレートで追加</button><button disabled={!editing} onClick={() => onDeleteTemplate(tpl.id)}>削除</button></div>)}</div>
    </div>
  );
}

function DatabaseTrashPanel({ database, editing, onEmptyTrash, onRestoreTrashedRow, onRestoreTrashedProperty, onRestoreTrashedView }: { database: WorkspaceDatabase; editing: boolean; onEmptyTrash: () => void; onRestoreTrashedRow: (rowId: string) => void; onRestoreTrashedProperty: (propId: string) => void; onRestoreTrashedView: (viewId: string) => void }) {
  return (
    <div className="db-view-panel db-modern-panel db-pro-panel-v129">
      <div className="db-view-section-head db-view-section-head-v118"><strong>DBゴミ箱</strong><button disabled={!editing} onClick={onEmptyTrash}>完全に空にする</button></div>
      <div className="db-pro-list-v129"><strong>削除済み行</strong>{(database.trash?.rows ?? []).length === 0 ? <small>なし</small> : (database.trash?.rows ?? []).map(row => <div key={row.id}><span>🧾 {database.properties[0] ? dbText(row.cells[database.properties[0].id]) || row.id : row.id}</span><button disabled={!editing} onClick={() => onRestoreTrashedRow(row.id)}>復元</button></div>)}</div>
      <div className="db-pro-list-v129"><strong>削除済みプロパティ</strong>{(database.trash?.properties ?? []).length === 0 ? <small>なし</small> : (database.trash?.properties ?? []).map(prop => <div key={prop.id}><span>{propertyTypeIcon(prop.type)} {prop.name}</span><button disabled={!editing} onClick={() => onRestoreTrashedProperty(prop.id)}>復元</button></div>)}</div>
      <div className="db-pro-list-v129"><strong>削除済みビュー</strong>{(database.trash?.views ?? []).length === 0 ? <small>なし</small> : (database.trash?.views ?? []).map(view => <div key={view.id}><span>{viewIcon(view.type)} {view.name}</span><button disabled={!editing} onClick={() => onRestoreTrashedView(view.id)}>復元</button></div>)}</div>
    </div>
  );
}
