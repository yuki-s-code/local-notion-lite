import React, { useMemo, useState } from 'react';
import type { DatabaseView, WorkspaceDatabase, PageWithLock, JournalSummary } from '../../../../shared/types';
import {
  addMonths,
  dbText,
  formatMonthLabel,
  getBoardGroupProperty,
  getDateProperty,
  getRelationTargetTitle,
  getTimelineEndProperty,
  getTimelineStartProperty,
  getComputedCellValue,
  monthKey,
  parseLocalDate,
  propertyTypeIcon,
  renderCellPreview,
} from './DatabaseHelpers';

export function DatabaseCalendar({ database, rows, view, onSelectRow }: {
  database: WorkspaceDatabase;
  rows: WorkspaceDatabase['rows'];
  view: DatabaseView;
  onSelectRow: (rowId: string) => void;
}) {
  const [month, setMonth] = useState(monthKey(new Date()));
  const dateProp = getDateProperty(database, view);
  const titleProp = database.properties[0];
  const days = useMemo(() => {
    const [year, m] = month.split('-').map(Number);
    const first = new Date(year, m - 1, 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [month]);
  const rowsByDay = useMemo(() => {
    const map = new Map<string, WorkspaceDatabase['rows']>();
    if (!dateProp) return map;
    rows.forEach(row => {
      const date = parseLocalDate(getComputedCellValue(dateProp, row, database, []));
      if (!date) return;
      const key = date.toISOString().slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), row]);
    });
    return map;
  }, [rows, dateProp?.id]);
  if (!dateProp) return <div className="db-view-empty-v99"><strong>CalendarにはDateプロパティが必要です</strong><span>プロパティにDate列を追加してください。</span></div>;
  return <div className="db-calendar-shell-v99">
    <div className="db-calendar-toolbar-v99"><button onClick={() => setMonth(addMonths(month, -1))}>‹</button><strong>{formatMonthLabel(month)}</strong><button onClick={() => setMonth(addMonths(month, 1))}>›</button><button onClick={() => setMonth(monthKey(new Date()))}>今日</button></div>
    <div className="db-calendar-week-v99">{['日','月','火','水','木','金','土'].map(day => <b key={day}>{day}</b>)}</div>
    <div className="db-calendar-grid-v99">{days.map(day => {
      const key = day.toISOString().slice(0, 10);
      const dayRows = rowsByDay.get(key) ?? [];
      const out = monthKey(day) !== month;
      return <section key={key} className={out ? 'muted' : ''}><header>{day.getDate()}</header>{dayRows.slice(0, 4).map(row => <button key={row.id} onClick={() => onSelectRow(row.id)}>{titleProp ? (dbText(row.cells[titleProp.id]) || '無題') : '無題'}</button>)}{dayRows.length > 4 && <small>+{dayRows.length - 4}</small>}</section>;
    })}</div>
  </div>;
}

export function DatabaseGallery({ database, rows, view, onSelectRow }: {
  database: WorkspaceDatabase;
  rows: WorkspaceDatabase['rows'];
  view: DatabaseView;
  onSelectRow: (rowId: string) => void;
}) {
  const titleProp = database.properties[0];
  const visible = view.visiblePropertyIds?.length
    ? database.properties.filter(prop => view.visiblePropertyIds?.includes(prop.id))
    : database.properties.slice(1, 5);
  return <div className="db-gallery-grid-v99">{rows.map(row => <button key={row.id} className="db-gallery-card-v99" onClick={() => onSelectRow(row.id)}><div className="db-gallery-cover-v99">▧</div><strong>{titleProp ? (dbText(row.cells[titleProp.id]) || '無題') : '無題'}</strong><div>{visible.map(prop => { const text = renderCellPreview(getComputedCellValue(prop, row, database, []), prop.type); return text ? <span key={prop.id}><i>{propertyTypeIcon(prop.type)}</i>{text}</span> : null; })}</div></button>)}</div>;
}

export function DatabaseTimeline({ database, rows, view, onSelectRow }: {
  database: WorkspaceDatabase;
  rows: WorkspaceDatabase['rows'];
  view: DatabaseView;
  onSelectRow: (rowId: string) => void;
}) {
  const startProp = getTimelineStartProperty(database, view);
  const endProp = getTimelineEndProperty(database, view);
  const titleProp = database.properties[0];
  const statusProp = database.properties.find(prop => (prop.type === 'select' || prop.type === 'status'));
  // Dependencies are an explicit same-DB relation: the current row depends on referenced rows.
  // This intentionally performs only O(dependency edges) work for the already-rendered Gantt rows.
  const dependencyProp = database.properties.find(prop => prop.type === 'relation' && prop.isDependencyRelation && (prop.relationTargetType ?? 'database') === 'database' && (prop.relationDatabaseId ?? database.id) === database.id);
  const items = useMemo(() => rows
    .map(row => {
      const start = startProp ? parseLocalDate(getComputedCellValue(startProp, row, database, [])) : null;
      const end = endProp ? parseLocalDate(getComputedCellValue(endProp, row, database, [])) : null;
      return { row, start, end: end && start && end.getTime() >= start.getTime() ? end : start };
    })
    .filter((item): item is { row: WorkspaceDatabase['rows'][number]; start: Date; end: Date } => Boolean(item.start))
    .sort((a, b) => a.start.getTime() - b.start.getTime()), [rows, startProp?.id, endProp?.id]);

  if (!startProp) return <div className="db-view-empty-v99"><strong>TimelineにはDateプロパティが必要です</strong><span>開始日に使うDate列を追加してください。</span></div>;
  if (items.length === 0) return <div className="db-view-empty-v99"><strong>Timelineに表示できる行がありません</strong><span>{startProp.name} に日付を入力してください。</span></div>;

  const min = new Date(Math.min(...items.map(item => item.start.getTime())));
  const max = new Date(Math.max(...items.map(item => item.end.getTime())));
  const rangeStart = new Date(min.getFullYear(), min.getMonth(), 1);
  const rangeEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const totalDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1);
  const months: Date[] = [];
  for (let d = new Date(rangeStart); d <= rangeEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const leftPercent = (date: Date) => Math.max(0, ((date.getTime() - rangeStart.getTime()) / 86400000) / totalDays * 100);
  const widthPercent = (start: Date, end: Date) => Math.max(2.4, ((end.getTime() - start.getTime()) / 86400000 + 1) / totalDays * 100);

  return <div className="db-timeline-pro-v100">
    <div className="db-timeline-pro-head-v100">
      <div><strong>Timeline</strong><span>{startProp.name}{endProp && endProp.id !== startProp.id ? ` → ${endProp.name}` : ''}</span></div>
      <small>{items.length}件 ・ {rangeStart.toLocaleDateString()} 〜 {rangeEnd.toLocaleDateString()}</small>
    </div>
    <div className="db-timeline-axis-v100">{months.map(month => {
      const left = leftPercent(month);
      return <div key={monthKey(month)} style={{ left: `${left}%` }}><span>{month.getMonth() + 1}月</span></div>;
    })}</div>
    <div className="db-timeline-lanes-v100">
      {items.map((item, index) => {
        const title = titleProp ? (dbText(item.row.cells[titleProp.id]) || '無題') : '無題';
        const status = statusProp ? dbText(item.row.cells[statusProp.id]) : '';
        const left = leftPercent(item.start);
        const width = widthPercent(item.start, item.end);
        return <button key={item.row.id} className="db-timeline-bar-v100" style={{ left: `${left}%`, width: `${width}%`, top: `${index * 44}px` }} onClick={() => onSelectRow(item.row.id)} title={title}>
          <strong>{title}</strong>{status && <span>{status}</span>}
        </button>;
      })}
      <div style={{ height: `${items.length * 44 + 12}px` }} />
    </div>
  </div>;
}

export function DatabaseGantt({ database, rows, view, onSelectRow }: {
  database: WorkspaceDatabase;
  rows: WorkspaceDatabase['rows'];
  view: DatabaseView;
  onSelectRow: (rowId: string) => void;
}) {
  const startProp = getTimelineStartProperty(database, view);
  const endProp = getTimelineEndProperty(database, view);
  const titleProp = database.properties[0];
  const statusProp = database.properties.find(prop => (prop.type === 'select' || prop.type === 'status'));
  // Dependencies are an explicit same-DB relation: the current row depends on referenced rows.
  // This intentionally performs only O(dependency edges) work for the already-rendered Gantt rows.
  const dependencyProp = database.properties.find(prop => prop.type === 'relation' && prop.isDependencyRelation && (prop.relationTargetType ?? 'database') === 'database' && (prop.relationDatabaseId ?? database.id) === database.id);
  const items = useMemo(() => rows
    .map(row => {
      const start = startProp ? parseLocalDate(getComputedCellValue(startProp, row, database, [])) : null;
      const end = endProp ? parseLocalDate(getComputedCellValue(endProp, row, database, [])) : null;
      return { row, start, end: end && start && end.getTime() >= start.getTime() ? end : start };
    })
    .filter((item): item is { row: WorkspaceDatabase['rows'][number]; start: Date; end: Date } => Boolean(item.start))
    .sort((a, b) => a.start.getTime() - b.start.getTime()), [rows, startProp?.id, endProp?.id]);

  if (!startProp) return <div className="db-view-empty-v99"><strong>Ganttには開始日のDateプロパティが必要です</strong><span>プロパティにDate列を追加してください。</span></div>;
  if (items.length === 0) return <div className="db-view-empty-v99"><strong>Ganttに表示できる行がありません</strong><span>{startProp.name} に日付を入力してください。</span></div>;

  const min = new Date(Math.min(...items.map(item => item.start.getTime())));
  const max = new Date(Math.max(...items.map(item => item.end.getTime())));
  const rangeStart = new Date(min.getFullYear(), min.getMonth(), 1);
  const rangeEnd = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const totalDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1);
  const months: Date[] = [];
  for (let d = new Date(rangeStart); d <= rangeEnd; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const leftPercent = (date: Date) => Math.max(0, ((date.getTime() - rangeStart.getTime()) / 86400000) / totalDays * 100);
  const widthPercent = (start: Date, end: Date) => Math.max(2.8, ((end.getTime() - start.getTime()) / 86400000 + 1) / totalDays * 100);
  const itemById = new Map(items.map(item => [item.row.id, item]));
  const isDoneStatus = (value: unknown) => /^(完了|完了済み|done|completed)$/i.test(String(value ?? '').trim());
  const dependencyState = (item: typeof items[number]) => {
    if (!dependencyProp) return { count: 0, blocked: false, scheduleConflict: false };
    const ids = Array.isArray(item.row.cells[dependencyProp.id]) ? item.row.cells[dependencyProp.id] as string[] : [];
    const deps = ids.map(id => itemById.get(String(id))).filter((value): value is typeof item => Boolean(value));
    const blocked = Boolean(statusProp) && deps.some(dep => !isDoneStatus(dep.row.cells[statusProp!.id]));
    const scheduleConflict = deps.some(dep => dep.end.getTime() > item.start.getTime());
    return { count: deps.length, blocked, scheduleConflict };
  };

  return <div className="db-gantt-pro-v127">
    <div className="db-gantt-head-v127"><div><strong>Gantt Chart</strong><span>{startProp.name}{endProp && endProp.id !== startProp.id ? ` → ${endProp.name}` : ''}</span></div><small>{items.length}件</small></div>
    <div className="db-gantt-axis-v127">{months.map(month => <div key={monthKey(month)} style={{ left: `${leftPercent(month)}%` }}>{month.getMonth() + 1}月</div>)}</div>
    <div className="db-gantt-body-v127">
      {items.map((item, index) => {
        const title = titleProp ? (dbText(item.row.cells[titleProp.id]) || '無題') : '無題';
        const status = statusProp ? dbText(item.row.cells[statusProp.id]) : '';
        const dependency = dependencyState(item);
        const warning = dependency.scheduleConflict ? '日程が前提タスクより先です' : dependency.blocked ? '前提タスクが未完了です' : '';
        return <div className={`db-gantt-row-v127${warning ? ' has-dependency-warning' : ''}`} key={item.row.id}>
          <button className="db-gantt-title-v127" onClick={() => onSelectRow(item.row.id)}>{title}<small>{status}{dependency.count ? ` · 前提 ${dependency.count}件` : ''}{warning ? ` · ⚠ ${warning}` : ''}</small></button>
          <button className={`db-gantt-bar-v127${warning ? ' has-dependency-warning' : ''}`} style={{ left: `${leftPercent(item.start)}%`, width: `${widthPercent(item.start, item.end)}%` }} onClick={() => onSelectRow(item.row.id)}>{item.start.toISOString().slice(5, 10)}〜{item.end.toISOString().slice(5, 10)}</button>
        </div>;
      })}
    </div>
  </div>;
}

function PropertyOptionsEditor({ prop, editing, onAdd, onRename, onDelete }: {
  prop: WorkspaceDatabase['properties'][number];
  editing: boolean;
  onAdd: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return <div className="property-options-editor-v124">
    {(prop.options ?? []).map(option => <div key={option} className="property-option-row-v124">
      <input disabled={!editing} defaultValue={option} onBlur={e => onRename(option, e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <button disabled={!editing} onClick={() => onDelete(option)}>削除</button>
    </div>)}
    <div className="property-option-add-v124">
      <input disabled={!editing} value={draft} placeholder="新しい選択肢" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { onAdd(draft); setDraft(''); } }} />
      <button disabled={!editing || !draft.trim()} onClick={() => { onAdd(draft); setDraft(''); }}>追加</button>
    </div>
    <small>クリック後に直接編集できます。Enterまたはフォーカス外しで反映します。</small>
  </div>;
}

export function DatabaseBoard({ database, rows, view, editing, allDatabases = [], pages = [], journals = [], onUpdateCell, onAddRow, onSelectRow }: {
  database: WorkspaceDatabase;
  rows: WorkspaceDatabase['rows'];
  view: DatabaseView;
  editing: boolean;
  allDatabases?: WorkspaceDatabase[];
  pages?: PageWithLock[];
  journals?: JournalSummary[];
  onUpdateCell: (rowId: string, propId: string, value: any, immediate?: boolean) => void;
  onAddRow: () => void;
  onSelectRow: (rowId: string) => void;
}) {
  const [draggedBoardRowId, setDraggedBoardRowId] = useState<string | null>(null);
  const groupProp = getBoardGroupProperty(database, view);
  const titleProp = database.properties[0];
  const lanes = useMemo(() => {
    const values = new Map<string, WorkspaceDatabase['rows']>();
    const configured = groupProp?.options && groupProp.options.length > 0 ? groupProp.options : [];
    for (const option of configured) values.set(String(option || '未設定'), []);
    for (const row of rows) {
      const raw = groupProp ? row.cells[groupProp.id] : '';
      const key = groupProp?.type === 'checkbox' ? (raw ? '完了' : '未完了') : (dbText(raw).trim() || '未設定');
      if (!values.has(key)) values.set(key, []);
      values.get(key)!.push(row);
    }
    if (values.size === 0) values.set('未設定', []);
    return Array.from(values.entries()).map(([name, items]) => ({ name, rows: items }));
  }, [rows, groupProp?.id, groupProp?.type, JSON.stringify(groupProp?.options ?? [])]);
  return (
    <div className="db-board-shell-v96">
      <div className="db-board-head-v96">
        <div><strong>Board View</strong><span>{groupProp ? `${groupProp.name} でグループ化` : 'グループ化できるプロパティがありません'}</span></div>
        <button disabled={!editing} onClick={onAddRow}>＋ 行を追加</button>
      </div>
      <div className="db-board-lanes-v96">
        {lanes.map(lane => (
          <section className="db-board-lane-v96" key={lane.name} onDragOver={e => { if (editing && groupProp) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (editing && groupProp && draggedBoardRowId) { onUpdateCell(draggedBoardRowId, groupProp.id, lane.name === '未設定' ? '' : lane.name, true); setDraggedBoardRowId(null); } }}>
            <header><span>{lane.name}</span><small>{lane.rows.length}</small></header>
            <div className="db-board-cards-v96">
              {lane.rows.map(row => (
                <button className="db-board-card-v96" key={row.id} draggable={editing} onDragStart={() => setDraggedBoardRowId(row.id)} onDragEnd={() => setDraggedBoardRowId(null)} onClick={() => onSelectRow(row.id)}>
                  <strong>{titleProp ? (dbText(row.cells[titleProp.id]) || '無題') : '無題'}</strong>
                  <div className="db-board-card-props-v96">
                    {database.properties.slice(1, 5).map(prop => {
                      const text = prop.type === 'relation'
                        ? (Array.isArray(row.cells[prop.id]) ? (row.cells[prop.id] as string[]).map(id => getRelationTargetTitle(prop, id, database, allDatabases, pages, journals)).join(', ') : '')
                        : renderCellPreview(getComputedCellValue(prop, row, database, []), prop.type);
                      return text ? <span key={prop.id}><i>{propertyTypeIcon(prop.type)}</i>{text}</span> : null;
                    })}
                  </div>
                  {groupProp && editing && (groupProp.type === 'select' || groupProp.type === 'status') && <select value={String(row.cells[groupProp.id] ?? '')} onClick={e => e.stopPropagation()} onChange={e => onUpdateCell(row.id, groupProp.id, e.target.value, true)}><option value="">未設定</option>{(groupProp.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select>}
                </button>
              ))}
              {lane.rows.length === 0 && <div className="db-board-empty-v96">カードなし</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

