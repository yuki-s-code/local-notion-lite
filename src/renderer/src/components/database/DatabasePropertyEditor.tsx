import React, { useEffect, useRef, useState } from 'react';
import type { PageWithLock, JournalSummary, WorkspaceDatabase } from '../../../../shared/types';
import type { ApiClient } from '../../lib/api';
import {
  getComputedCellValue,
  isAutomaticTimeProperty,
  getRelationCandidates,
  getRelationTargetTitle,
  propertyTypeIcon,
  propertyTypeLabel,
  renderCellPreview,
  getDeadlineStatus,
  contactValidationMessage,
  normalizeContactValue,
} from './DatabaseHelpers';

const RELATION_CANDIDATE_RENDER_LIMIT = 120;
const RELATION_CANDIDATE_SEARCH_LIMIT = 240;

type Props = {
  database: WorkspaceDatabase;
  allDatabases: WorkspaceDatabase[];
  pages: PageWithLock[];
  journals: JournalSummary[];
  row: WorkspaceDatabase['rows'][number];
  prop: WorkspaceDatabase['properties'][number];
  editing: boolean;
  api?: ApiClient | null;
  onUpdateCell: (rowId: string, propId: string, value: any, immediate?: boolean) => void;
  onOpenRelationTarget: (prop: WorkspaceDatabase['properties'][number], rawId: string) => void;
};

export function DatabasePropertyEditor({ database, allDatabases, pages, journals, row, prop, editing, api = null, onUpdateCell, onOpenRelationTarget }: Props) {
  const resolvedValue = getComputedCellValue(prop, row, database, allDatabases);
  const [draft, setDraft] = useState<any>(resolvedValue ?? (prop.type === 'checkbox' ? false : ''));
  const [relationQuery, setRelationQuery] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ rowId: string; propId: string; value: any } | null>(null);

  useEffect(() => {
    setDraft(getComputedCellValue(prop, row, database, allDatabases) ?? (prop.type === 'checkbox' ? false : ''));
    setContactError(null);
  }, [row.id, prop.id, row.createdAt, row.updatedAt, row.cells[prop.id]]);

  const flushPending = (immediate = true) => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    onUpdateCell(pending.rowId, pending.propId, pending.value, immediate);
  };

  useEffect(() => () => {
    flushPending(true);
  }, []);

  function schedule(nextValue: any, immediate = false) {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = { rowId: row.id, propId: prop.id, value: nextValue };
    if (immediate) {
      flushPending(true);
      return;
    }
    timerRef.current = window.setTimeout(() => flushPending(false), 700);
  }

  function renderEditor() {
    if (prop.type === 'rollup' || prop.type === 'formula') {
      return <span className="computed-cell-v127">{String(getComputedCellValue(prop, row, database, allDatabases))}</span>;
    }
    if (prop.type === 'unique_id') {
      return <span className="readonly-cell-preview unique-id-cell-v605">{renderCellPreview(draft, prop.type) || '採番待ち'}</span>;
    }
    if (prop.type === 'button') {
      const target = database.properties.find(item => item.id === prop.buttonTargetPropertyId);
      const action = prop.buttonAction;
      const canRun = Boolean(editing && target && action && ((action === 'mark_status_done' && target.type === 'status') || (action === 'set_today' && target.type === 'date')));
      const label = action === 'set_today' ? '今日を設定' : '完了にする';
      return <button type="button" className="db-row-button-v619" disabled={!canRun} title={canRun ? `${target?.name}を更新します` : 'Buttonの対象プロパティを設定してください'} onClick={() => { if (!target || !action || !canRun) return; const next = action === 'set_today' ? new Date().toISOString().slice(0, 10) : ((target.options ?? []).find(option => /^(完了|完了済み|done|completed)$/i.test(option)) ?? '完了'); onUpdateCell(row.id, target.id, next, true); }}>▶ {label}</button>;
    }

    if (isAutomaticTimeProperty(prop.type)) {
      return <span className="readonly-cell-preview">{renderCellPreview(getComputedCellValue(prop, row, database, allDatabases), prop.type)}</span>;
    }

    if (prop.type === 'checkbox') {
      return <label className="modern-check db-preview-modern-check-v260"><input type="checkbox" checked={Boolean(draft)} disabled={!editing} onChange={e => { setDraft(e.target.checked); schedule(e.target.checked, true); }} /><span>{Boolean(draft) ? '完了' : '未完了'}</span></label>;
    }

    if ((prop.type === 'select' || prop.type === 'status')) {
      return <select className="modern-cell-input select-chip db-preview-cell-control-v260" value={String(draft ?? '')} disabled={!editing} onChange={e => { setDraft(e.target.value); schedule(e.target.value, true); }}><option value="">未選択</option>{(prop.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}</select>;
    }

    if (prop.type === 'multi_select') {
      const selected = Array.isArray(draft) ? draft as string[] : [];
      const toggle = (option: string) => {
        const next = selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option];
        setDraft(next);
        schedule(next, true);
      };
      return <div className="multi-select-cell-v123 db-preview-multi-select-v260">{(prop.options ?? []).map(option => <label key={option}><input type="checkbox" disabled={!editing} checked={selected.includes(option)} onChange={() => toggle(option)} /><span>{option}</span></label>)}{(prop.options ?? []).length === 0 && <small>選択肢なし</small>}</div>;
    }

    if (prop.type === 'relation') {
      const selected = Array.isArray(draft) ? draft as string[] : [];
      const candidates = getRelationCandidates(prop, database, allDatabases, pages, journals, row.id);
      const normalizedRelationQuery = relationQuery.trim().toLowerCase();
      const matchedCandidates = normalizedRelationQuery
        ? candidates.filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(normalizedRelationQuery))
        : candidates;
      const candidateRenderLimit = normalizedRelationQuery ? RELATION_CANDIDATE_SEARCH_LIMIT : RELATION_CANDIDATE_RENDER_LIMIT;
      const filteredCandidates = matchedCandidates.slice(0, candidateRenderLimit);
      const hiddenCandidateCount = Math.max(0, matchedCandidates.length - filteredCandidates.length);
      const selectedCandidateMap = new Map(candidates.map(item => [item.id, item]));
      const targetType = prop.relationTargetType ?? 'database';
      const targetDatabase = targetType === 'database'
        ? (allDatabases.find(item => item.id === (prop.relationDatabaseId || database.id)) ?? database)
        : null;
      const brokenIds = selected.filter(id => {
        if (targetType === 'page') return !pages.some(item => item.id === id);
        if (targetType === 'journal') return !journals.some(item => item.date === id);
        return !targetDatabase?.rows.some(item => item.id === id);
      });
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
      const clearBroken = () => {
        if (!brokenIds.length) return;
        const next = selected.filter(id => !brokenIds.includes(id));
        setDraft(next);
        schedule(next, true);
      };
      if (!editing) {
        return <span className="relation-pill-list-v96 relation-pill-list-v124 relation-pill-list-v126 db-preview-relation-readonly-v260">{selected.slice(0, 6).map(id => <button type="button" key={id} onClick={() => onOpenRelationTarget(prop, id)}>↗ {getRelationTargetTitle(prop, id, database, allDatabases, pages, journals)}</button>)}{selected.length > 6 && <em>+{selected.length - 6}</em>}{selected.length === 0 && <small>未設定</small>}</span>;
      }
      return <div className="relation-cell-v96 relation-cell-v124 db-preview-relation-cell-v260">
        <button type="button">↔ {selected.length ? `${selected.length}件` : 'Relation'}</button>
        <div className="relation-popover-v96 relation-popover-v101 relation-popover-v124 db-preview-relation-popover-v260">
          <div className="relation-selected-v124 relation-selected-v573">
            {selected.length === 0 ? <small>未選択</small> : selected.map(id => {
              const candidate = selectedCandidateMap.get(id);
              const isBroken = brokenIds.includes(id);
              return <button type="button" key={id} className={isBroken ? 'is-broken' : ''} onDoubleClick={() => !isBroken && onOpenRelationTarget(prop, id)} onClick={() => toggle(id)} title={isBroken ? '削除済みまたは存在しない参照です。クリックで解除' : 'クリックで解除 / ダブルクリックで開く'}>
                <span>× {isBroken ? '参照先が見つかりません' : getRelationTargetTitle(prop, id, database, allDatabases, pages, journals)}</span>
                {candidate?.preview ? <small>{candidate.preview}</small> : null}
              </button>;
            })}
            {selected.length > 0 && <button type="button" className="relation-clear-v124" onClick={clearAll}>すべて解除</button>}
          </div>
          {brokenIds.length > 0 ? <div className="relation-integrity-alert-v573"><span>⚠ 削除済みまたは存在しない参照が{brokenIds.length}件あります。</span><button type="button" onClick={clearBroken}>無効な参照を解除</button></div> : null}
          <input className="relation-search-v124" placeholder="Relation候補を検索" value={relationQuery} onChange={e => setRelationQuery(e.target.value)} />
          <div className="relation-candidates-v124 relation-candidates-v573">
            {filteredCandidates.map(item => <label key={item.id} draggable onDragStart={e => e.dataTransfer.setData('text/relation-id', item.id)}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /><span><b>{item.title}</b><small>{item.subtitle}</small>{item.preview ? <em>{item.preview}</em> : null}</span></label>)}
            {hiddenCandidateCount > 0 && <small>候補が多いため先頭{filteredCandidates.length}件を表示中です。検索語を入力すると絞り込めます。</small>}
            {filteredCandidates.length === 0 && <small>候補なし</small>}
          </div>
        </div>
      </div>;
    }

    if (!editing) {
      const text = String(draft ?? '').trim();
      const deadlineStatus = getDeadlineStatus(prop, draft);
      const withDeadline = (content: React.ReactNode) => <>{content}{deadlineStatus ? <small className={`db-deadline-badge-v553 ${deadlineStatus.tone}`}>{deadlineStatus.label}</small> : null}</>;
      if (prop.type === 'url' && /^https?:\/\//i.test(text)) return withDeadline(<button type="button" className="readonly-cell-preview db-contact-link-v551" onClick={() => void window.localNotion.openExternalHttpUrl(text)} title="既定のブラウザで開く">↗ {renderCellPreview(text, prop.type)}</button>);
      if (prop.type === 'email' && text && !contactValidationMessage('email', text)) return withDeadline(<a className="readonly-cell-preview db-contact-link-v551" href={`mailto:${text}`} onClick={e => e.stopPropagation()} title="メール作成">✉ {text}</a>);
      if (prop.type === 'phone' && text && !contactValidationMessage('phone', text)) return withDeadline(<a className="readonly-cell-preview db-contact-link-v551" href={`tel:${text.replace(/[^+\d]/g, '')}`} onClick={e => e.stopPropagation()} title="電話番号を使用">☎ {text}</a>);
      return withDeadline(<span className="readonly-cell-preview">{renderCellPreview(draft, prop.type)}</span>);
    }

    const inputType = prop.type === 'number' ? 'number' : prop.type === 'date' ? 'date' : prop.type === 'url' ? 'url' : prop.type === 'email' ? 'email' : prop.type === 'phone' ? 'tel' : 'text';
    const placeholder = prop.type === 'url' ? 'https://' : prop.type === 'email' ? 'name@example.jp' : prop.type === 'phone' ? '0797-00-0000' : '空';
    const isContact = prop.type === 'phone' || prop.type === 'email';
    return <div className="db-contact-input-wrap-v554"><input className={`modern-cell-input db-preview-cell-control-v260 ${contactError ? 'is-invalid' : ''}`} type={inputType} inputMode={prop.type === 'phone' ? 'tel' : prop.type === 'email' ? 'email' : undefined} autoComplete={prop.type === 'phone' ? 'tel' : prop.type === 'email' ? 'email' : undefined} autoCapitalize="none" autoCorrect="off" value={String(draft ?? '')} placeholder={prop.description || placeholder} title={prop.description || prop.name} aria-invalid={Boolean(contactError)} onChange={e => { const next = e.target.value; setDraft(next); const error = isContact ? contactValidationMessage(prop.type, next) : null; if (isContact) setContactError(error); if (!error) schedule(prop.type === 'number' && next !== '' ? Number(next) : next); }} onBlur={() => { const next = isContact ? normalizeContactValue(prop.type, draft) : draft; const error = isContact ? contactValidationMessage(prop.type, next) : null; if (isContact) setContactError(error); setDraft(next); if (!error) schedule(prop.type === 'number' && next !== '' ? Number(next) : next, true); }} />{contactError ? <small className="db-contact-error-v554">{contactError}</small> : null}</div>;
  }

  return <label className={`row-field-v60 db-preview-property-row-v260 type-${prop.type}`}>
    <span><i>{propertyTypeIcon(prop.type)}</i><b>{prop.name}</b><small>{propertyTypeLabel(prop.type)}</small>{prop.description ? <em className="db-property-guide-v553">{prop.description}</em> : null}</span>
    <div className="db-preview-property-control-v260">{renderEditor()}</div>
  </label>;
}
