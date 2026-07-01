import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../lib/api';
import type { WorkspaceDatabase, PageWithLock, JournalSummary } from '../../../../shared/types';
import {
  getComputedCellValue,
  getRelationCandidates,
  getRelationTargetTitle,
  renderCellPreview,
  isAutomaticTimeProperty,
  getDeadlineStatus,
  contactValidationMessage,
  normalizeContactValue,
} from './DatabaseHelpers';

const RELATION_CANDIDATE_RENDER_LIMIT = 120;
const RELATION_CANDIDATE_SEARCH_LIMIT = 240;

type FastDatabaseRowProps = {
  row: WorkspaceDatabase['rows'][number];
  rowIndex: number;
  rowDepth?: number;
  showSubItemStructure?: boolean;
  hasSubItems?: boolean;
  subItemsCollapsed?: boolean;
  subItemProgress?: { done: number; total: number };
  onToggleSubItems?: () => void;
  database: WorkspaceDatabase;
  allDatabases: WorkspaceDatabase[];
  api: ApiClient | null;
  pages: PageWithLock[];
  journals: JournalSummary[];
  properties: WorkspaceDatabase['properties'];
  selected: boolean;
  editing: boolean;
  selectedRowId: string | null;
  onSelect: (checked: boolean) => void;
  onFocus: () => void;
  onUpdateCell: (rowId: string, propId: string, value: any, immediate?: boolean) => void;
  onOpenRelationTarget: (prop: WorkspaceDatabase['properties'][number], rawId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDragStartRow: () => void;
  onDropBeforeRow: () => void;
  pinnedPropertyLeftById?: Record<string, number>;
};

export const FastDatabaseRow = React.memo(function FastDatabaseRow({ row, rowIndex, rowDepth = 0, showSubItemStructure = false, hasSubItems = false, subItemsCollapsed = false, subItemProgress, onToggleSubItems, database, allDatabases, pages, journals, properties, selected, editing, selectedRowId, api, onSelect, onFocus, onUpdateCell, onOpenRelationTarget, onDuplicate, onDelete, onDragStartRow, onDropBeforeRow, pinnedPropertyLeftById = {} }: FastDatabaseRowProps) {
  return <tr draggable={editing} onDragStart={onDragStartRow} onDragOver={e => { if (editing) e.preventDefault(); }} onDrop={e => { e.preventDefault(); onDropBeforeRow(); }} className={`${selectedRowId === row.id ? 'selected-row ' : ''}${rowDepth > 0 ? ' db-subitem-row-v606' : ''}`} onClick={onFocus}>
    <td className="fast-select-cell"><input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)} onClick={e => e.stopPropagation()} /></td>
    <td className="fast-row-number"><span className="row-index-pill"><b>{rowIndex + 1}</b></span></td>
    {showSubItemStructure ? <td className="db-subitem-structure-cell"><div className="db-subitem-structure" style={{ paddingLeft: Math.min(8, rowDepth) * 14 }}>{hasSubItems ? <button type="button" className="db-subitem-toggle-v608" onClick={(event) => { event.stopPropagation(); onToggleSubItems?.(); }} title={subItemsCollapsed ? '子アイテムを表示' : '子アイテムを折りたたむ'} aria-label={subItemsCollapsed ? '子アイテムを表示' : '子アイテムを折りたたむ'}>{subItemsCollapsed ? '▸' : '▾'}</button> : (rowDepth > 0 ? <span className="db-subitem-branch-v609" aria-hidden="true">↳</span> : <span className="db-subitem-structure-spacer-v609" aria-hidden="true" />)}{hasSubItems && subItemProgress ? <small className="db-subitem-progress-v608">{subItemProgress.done}/{subItemProgress.total}</small> : null}</div></td> : null}
    {properties.map(prop => <FastCell key={`${row.id}:${prop.id}`} database={database} allDatabases={allDatabases} pages={pages} journals={journals} row={row} rowId={row.id} prop={prop} value={getComputedCellValue(prop, row, database, allDatabases)} editing={editing} onUpdate={onUpdateCell} api={api} onOpenRelationTarget={onOpenRelationTarget} pinnedLeft={pinnedPropertyLeftById[prop.id]} />)}
    <td className="fast-actions-cell"><div className="row-action-cluster"><button disabled={!editing} onClick={(e) => { e.stopPropagation(); onDuplicate(); }}>複製</button><button disabled={!editing} onClick={(e) => { e.stopPropagation(); onDelete(); }}>削除</button></div></td>
  </tr>;
});

type FastCellProps = {
  database: WorkspaceDatabase;
  allDatabases: WorkspaceDatabase[];
  api: ApiClient | null;
  pages: PageWithLock[];
  journals: JournalSummary[];
  row: WorkspaceDatabase['rows'][number];
  rowId: string;
  prop: WorkspaceDatabase['properties'][number];
  value: any;
  editing: boolean;
  onUpdate: (rowId: string, propId: string, value: any, immediate?: boolean) => void;
  onOpenRelationTarget: (prop: WorkspaceDatabase['properties'][number], rawId: string) => void;
  pinnedLeft?: number;
};

const FastCell = React.memo(function FastCell({ database, allDatabases, api, pages, journals, row, rowId, prop, value, editing, onUpdate, onOpenRelationTarget, pinnedLeft }: FastCellProps) {
  const [draft, setDraft] = useState<any>(value ?? (prop.type === 'checkbox' ? false : ''));
  const [relationQuery, setRelationQuery] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const tdProps = pinnedLeft == null ? undefined : { className: 'fast-pinned-property-cell', style: { left: pinnedLeft } };

  useEffect(() => {
    setDraft(value ?? (prop.type === 'checkbox' ? false : ''));
  }, [rowId, prop.id, value]);

  useEffect(() => { setContactError(null); }, [rowId, prop.id, value]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  function schedule(value: any, immediate = false) {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (immediate) {
      onUpdate(rowId, prop.id, value, true);
      return;
    }
    timerRef.current = window.setTimeout(() => onUpdate(rowId, prop.id, value), 700);
  }

  if (prop.type === 'rollup' || prop.type === 'formula') {
    return <td {...tdProps}><span className="computed-cell-v127">{String(getComputedCellValue(prop, row, database, allDatabases))}</span></td>;
  }
  if (prop.type === 'unique_id') {
    return <td {...tdProps}><span className="readonly-cell-preview unique-id-cell-v605">{renderCellPreview(value, prop.type) || '採番待ち'}</span></td>;
  }
  if (prop.type === 'button') {
    const target = database.properties.find(item => item.id === prop.buttonTargetPropertyId);
    const action = prop.buttonAction;
    const canRun = Boolean(editing && target && action && ((action === 'mark_status_done' && target.type === 'status') || (action === 'set_today' && target.type === 'date')));
    const label = action === 'set_today' ? '今日を設定' : '完了にする';
    const run = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!target || !action || !canRun) return;
      const next = action === 'set_today' ? new Date().toISOString().slice(0, 10) : ((target.options ?? []).find(option => /^(完了|完了済み|done|completed)$/i.test(option)) ?? '完了');
      onUpdate(rowId, target.id, next, true);
    };
    return <td {...tdProps}><button type="button" className="db-row-button-v619" disabled={!canRun} title={canRun ? `${target?.name}を更新します` : 'Buttonの対象プロパティを設定してください'} onClick={run}>▶ {label}</button></td>;
  }
  if (isAutomaticTimeProperty(prop.type)) {
    return <td {...tdProps}><span className="readonly-cell-preview">{renderCellPreview(value, prop.type)}</span></td>;
  }
  if (prop.type === 'checkbox') {
    return <td {...tdProps}><label className="modern-check"><input type="checkbox" checked={Boolean(draft)} disabled={!editing} data-db-row-id={rowId} data-db-prop-id={prop.id} onChange={e => { setDraft(e.target.checked); schedule(e.target.checked, true); }} /><span>{Boolean(draft) ? '完了' : '未完了'}</span></label></td>;
  }
  if ((prop.type === 'select' || prop.type === 'status')) {
    return <td {...tdProps}><select className="modern-cell-input select-chip" value={String(draft ?? '')} disabled={!editing} data-db-row-id={rowId} data-db-prop-id={prop.id} onChange={e => { setDraft(e.target.value); schedule(e.target.value, true); }}><option value="">未選択</option>{(prop.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></td>;
  }
  if (prop.type === 'multi_select') {
    const selected = Array.isArray(draft) ? draft as string[] : [];
    const toggle = (option: string) => {
      const next = selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option];
      setDraft(next);
      schedule(next, true);
    };
    return <td {...tdProps}><div className="multi-select-cell-v123">{(prop.options ?? []).map(option => <label key={option}><input type="checkbox" disabled={!editing} checked={selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}</div></td>;
  }
  if (prop.type === 'relation') {
    const selected = Array.isArray(draft) ? draft as string[] : [];
    const candidates = getRelationCandidates(prop, database, allDatabases, pages, journals, rowId);
    const normalizedRelationQuery = relationQuery.trim().toLowerCase();
    const matchedCandidates = normalizedRelationQuery
      ? candidates.filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(normalizedRelationQuery))
      : candidates;
    const candidateRenderLimit = normalizedRelationQuery ? RELATION_CANDIDATE_SEARCH_LIMIT : RELATION_CANDIDATE_RENDER_LIMIT;
    const filteredCandidates = matchedCandidates.slice(0, candidateRenderLimit);
    const hiddenCandidateCount = Math.max(0, matchedCandidates.length - filteredCandidates.length);
    const toggle = (id: string) => {
      const next = selected.includes(id)
        ? selected.filter(item => item !== id)
        : (prop.isSubItemRelation ? [id] : [...selected, id]);
      setDraft(next);
      schedule(next, true);
    };
    const clearAll = () => {
      setDraft([]);
      schedule([], true);
    };
    if (!editing) {
      return <td {...tdProps}><span className="relation-pill-list-v96 relation-pill-list-v124 relation-pill-list-v126">{selected.slice(0, 3).map(id => <button type="button" key={id} onClick={() => onOpenRelationTarget(prop, id)}>↗ {getRelationTargetTitle(prop, id, database, allDatabases, pages, journals)}</button>)}{selected.length > 3 && <em>+{selected.length - 3}</em>}</span></td>;
    }
    return <td {...tdProps}><div className="relation-cell-v96 relation-cell-v124">
      <button type="button">↔ {selected.length ? `${selected.length}件` : 'Relation'}</button>
      <div className="relation-popover-v96 relation-popover-v101 relation-popover-v124">
        <div className="relation-selected-v124">
          {selected.length === 0 ? <small>未選択</small> : selected.map(id => <button type="button" key={id} onDoubleClick={() => onOpenRelationTarget(prop, id)} onClick={() => toggle(id)} title="クリックで解除 / ダブルクリックで開く">× {getRelationTargetTitle(prop, id, database, allDatabases, pages, journals)}</button>)}
          {selected.length > 0 && <button type="button" className="relation-clear-v124" onClick={clearAll}>すべて解除</button>}
        </div>
        <input className="relation-search-v124" placeholder="Relation候補を検索" value={relationQuery} onChange={e => setRelationQuery(e.target.value)} />
        <div className="relation-candidates-v124">
          {filteredCandidates.map(item => <label key={item.id} draggable onDragStart={e => e.dataTransfer.setData('text/relation-id', item.id)}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.title}</span><small>{item.subtitle}</small></label>)}
          {hiddenCandidateCount > 0 && <small>候補が多いため先頭{filteredCandidates.length}件を表示中です。検索語を入力すると絞り込めます。</small>}
          {filteredCandidates.length === 0 && <small>候補なし</small>}
        </div>
      </div>
    </div></td>;
  }
  if (!editing) {
    const text = String(draft ?? '').trim();
    const deadlineStatus = getDeadlineStatus(prop, draft);
    const withDeadline = (content: React.ReactNode) => <><span>{content}</span>{deadlineStatus ? <small className={`db-deadline-badge-v553 ${deadlineStatus.tone}`}>{deadlineStatus.label}</small> : null}</>;
    if (prop.type === 'url' && /^https?:\/\//i.test(text)) return <td {...tdProps}>{withDeadline(<button type="button" className="readonly-cell-preview db-contact-link-v551" onClick={e => { e.stopPropagation(); void window.localNotion.openExternalHttpUrl(text); }}>↗ {renderCellPreview(text, prop.type)}</button>)}</td>;
    if (prop.type === 'email' && text && !contactValidationMessage('email', text)) return <td {...tdProps}>{withDeadline(<a className="readonly-cell-preview db-contact-link-v551" href={`mailto:${text}`} onClick={e => e.stopPropagation()}>✉ {text}</a>)}</td>;
    if (prop.type === 'phone' && text && !contactValidationMessage('phone', text)) return <td {...tdProps}>{withDeadline(<a className="readonly-cell-preview db-contact-link-v551" href={`tel:${text.replace(/[^+\d]/g, '')}`} onClick={e => e.stopPropagation()}>☎ {text}</a>)}</td>;
    return <td {...tdProps}>{withDeadline(<span className="readonly-cell-preview">{renderCellPreview(draft, prop.type)}</span>)}</td>;
  }
  const inputType = prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : prop.type === 'url' ? 'url' : prop.type === 'email' ? 'email' : prop.type === 'phone' ? 'tel' : 'text';
  const placeholder = prop.type === 'url' ? 'https://' : prop.type === 'email' ? 'name@example.jp' : prop.type === 'phone' ? '0797-00-0000' : '空';
  const isContact = prop.type === 'phone' || prop.type === 'email';
  return <td {...tdProps}><div className="db-contact-input-wrap-v554"><input className={`modern-cell-input ${contactError ? 'is-invalid' : ''}`} type={inputType} inputMode={prop.type === 'phone' ? 'tel' : prop.type === 'email' ? 'email' : undefined} autoComplete={prop.type === 'phone' ? 'tel' : prop.type === 'email' ? 'email' : undefined} autoCapitalize="none" autoCorrect="off" data-db-row-id={rowId} data-db-prop-id={prop.id} value={String(draft ?? '')} placeholder={prop.description || placeholder} title={prop.description || prop.name} aria-invalid={Boolean(contactError)} onChange={e => { const next = e.target.value; setDraft(next); const error = isContact ? contactValidationMessage(prop.type, next) : null; if (isContact) setContactError(error); if (!error) schedule(prop.type === 'number' && next !== '' ? Number(next) : next); }} onBlur={() => { const next = isContact ? normalizeContactValue(prop.type, draft) : draft; const error = isContact ? contactValidationMessage(prop.type, next) : null; if (isContact) setContactError(error); setDraft(next); if (!error) schedule(prop.type === 'number' && next !== '' ? Number(next) : next, true); }} />{contactError ? <small className="db-contact-error-v554">{contactError}</small> : null}</div></td>;
});


