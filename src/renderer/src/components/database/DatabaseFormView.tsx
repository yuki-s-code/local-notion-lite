import React, { useEffect, useMemo, useState } from 'react';
import type { DatabaseProperty, DatabaseRow, WorkspaceDatabase } from '../../../../shared/types';
import { contactValidationMessage, defaultDatabaseCellValue, normalizeContactValue, propertyTypeIcon, renderCellPreview } from './DatabaseHelpers';

type Props = {
  database: WorkspaceDatabase;
  editing: boolean;
  onCreateRow: (cells: DatabaseRow['cells']) => void;
  onOpenRow: (rowId: string) => void;
};

function initialCells(database: WorkspaceDatabase): DatabaseRow['cells'] {
  return Object.fromEntries(database.properties.map(prop => [prop.id, defaultDatabaseCellValue(prop.type)]));
}

function isEditable(prop: DatabaseProperty) {
  return !['rollup', 'formula', 'relation', 'created_time', 'last_edited_time'].includes(prop.type);
}

export function DatabaseFormView({ database, editing, onCreateRow, onOpenRow }: Props) {
  const editableProps = useMemo(() => database.properties.filter(isEditable), [database.properties]);
  const [draft, setDraft] = useState<DatabaseRow['cells']>(() => initialCells(database));
  const [submitted, setSubmitted] = useState(false);
  const [contactErrors, setContactErrors] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setDraft(initialCells(database));
    setSubmitted(false);
    setContactErrors({});
  }, [database.id, database.properties]);

  const filled = editableProps.filter(prop => {
    const v = draft[prop.id];
    return Array.isArray(v) ? v.length > 0 : v !== '' && v !== null && v !== false;
  }).length;

  function update(prop: DatabaseProperty, value: any) {
    if (prop.type === 'phone' || prop.type === 'email') setContactErrors(current => ({ ...current, [prop.id]: contactValidationMessage(prop.type, value) }));
    setDraft(current => ({ ...current, [prop.id]: value }));
  }

  function finalizeContact(prop: DatabaseProperty) {
    const normalized = normalizeContactValue(prop.type, draft[prop.id]);
    setContactErrors(current => ({ ...current, [prop.id]: contactValidationMessage(prop.type, normalized) }));
    setDraft(current => ({ ...current, [prop.id]: normalized }));
  }

  function submit() {
    if (!editing) return;
    const nextDraft = { ...draft };
    const errors: Record<string, string | null> = {};
    editableProps.forEach(prop => {
      if (prop.type === 'phone' || prop.type === 'email') {
        const normalized = normalizeContactValue(prop.type, nextDraft[prop.id]);
        nextDraft[prop.id] = normalized;
        errors[prop.id] = contactValidationMessage(prop.type, normalized);
      }
    });
    setContactErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    onCreateRow(nextDraft);
    setDraft(initialCells(database));
    setSubmitted(true);
    window.setTimeout(() => setSubmitted(false), 2500);
  }

  return <div className="db-form-view-v473">
    <section className="db-form-hero-v473">
      <div className="db-form-hero-orb-v473"><span>✦</span></div>
      <div>
        <span className="db-form-eyebrow-v473">入力フォーム</span>
        <h2>{database.title}</h2>
        <p>必要な項目だけを順に入力して、データベースへ安全に登録します。</p>
      </div>
      <div className="db-form-progress-v473"><strong>{filled}</strong><span>/ {editableProps.length} 項目を入力</span></div>
    </section>

    <div className="db-form-layout-v473">
      <form className="db-form-card-v473" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="db-form-card-head-v473"><div><strong>新しい記録</strong><small>送信後も既存のTable / Board / Calendarでそのまま管理できます。</small></div><span>{editing ? '編集可能' : '閲覧モード'}</span></div>
        <div className="db-form-fields-v473">
          {editableProps.map(prop => {
            const value = draft[prop.id];
            return <label key={prop.id} className={`db-form-field-v473 type-${prop.type}`}>
              <span><i>{propertyTypeIcon(prop.type)}</i>{prop.name}{prop.description ? <small className="db-property-guide-v553">{prop.description}</small> : null}</span>
              {prop.type === 'checkbox' ? <button type="button" className={value ? 'db-form-check-v473 checked' : 'db-form-check-v473'} disabled={!editing} onClick={() => update(prop, !value)}><b>{value ? '✓' : ''}</b><em>{value ? 'オン' : 'オフ'}</em></button>
                : (prop.type === 'select' || prop.type === 'status') ? <select disabled={!editing} value={String(value ?? '')} onChange={e => update(prop, e.target.value)}><option value="">選択してください</option>{(prop.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select>
                : prop.type === 'multi_select' ? <div className="db-form-chip-grid-v473">{(prop.options ?? []).map(option => { const selected = Array.isArray(value) && value.includes(option); return <button type="button" key={option} disabled={!editing} className={selected ? 'selected' : ''} onClick={() => update(prop, selected ? (value as string[]).filter(item => item !== option) : [...(Array.isArray(value) ? value : []), option])}>{selected ? '✓ ' : ''}{option}</button>; })}</div>
                : prop.type === 'number' ? <input disabled={!editing} type="number" value={value === null ? '' : String(value ?? '')} onChange={e => update(prop, e.target.value === '' ? null : Number(e.target.value))} placeholder={prop.description || '数値を入力'} />
                : prop.type === 'date' ? <input disabled={!editing} type="date" title={prop.description || prop.name} value={String(value ?? '')} onChange={e => update(prop, e.target.value)} />
                : prop.type === 'url' ? <input disabled={!editing} type="url" value={String(value ?? '')} onChange={e => update(prop, e.target.value)} placeholder={prop.description || 'https://'} />
                : prop.type === 'phone' ? <div className="db-contact-input-wrap-v554"><input disabled={!editing} className={contactErrors[prop.id] ? 'is-invalid' : ''} type="tel" inputMode="tel" autoComplete="tel" value={String(value ?? '')} onChange={e => update(prop, e.target.value)} onBlur={() => finalizeContact(prop)} placeholder={prop.description || '0797-00-0000'} aria-invalid={Boolean(contactErrors[prop.id])} />{contactErrors[prop.id] ? <small className="db-contact-error-v554">{contactErrors[prop.id]}</small> : null}</div>
                : prop.type === 'email' ? <div className="db-contact-input-wrap-v554"><input disabled={!editing} className={contactErrors[prop.id] ? 'is-invalid' : ''} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" value={String(value ?? '')} onChange={e => update(prop, e.target.value)} onBlur={() => finalizeContact(prop)} placeholder={prop.description || 'name@example.jp'} aria-invalid={Boolean(contactErrors[prop.id])} />{contactErrors[prop.id] ? <small className="db-contact-error-v554">{contactErrors[prop.id]}</small> : null}</div>
                : <textarea disabled={!editing} value={String(value ?? '')} onChange={e => update(prop, e.target.value)} placeholder={prop.description || `${prop.name}を入力`} rows={prop.type === 'text' ? 3 : 2} />}
            </label>;
          })}
        </div>
        <div className="db-form-submit-row-v473"><div>{submitted ? <span className="db-form-success-v473">✓ 登録しました。続けて入力できます。</span> : <span>＊ は必須ではありません。空欄のままでも登録できます。</span>}</div><button className="db-form-submit-v473" type="submit" disabled={!editing}>✦ データベースに登録</button></div>
      </form>

      <aside className="db-form-side-v473">
        <section><span className="db-form-side-label-v473">このフォームについて</span><strong>入力に集中できる表示</strong><p>列、フィルター、集計を隠して、スマホやiPadでも迷わず記録できます。</p></section>
        <section><span className="db-form-side-label-v473">フォームに含めない項目</span><p>Relation・Rollup・Formulaは登録後に行詳細から設定できます。計算列を壊さないための仕様です。</p></section>
        <section className="db-form-recent-v473"><span className="db-form-side-label-v473">最近の登録</span>{database.rows.slice(0, 4).map(row => <button type="button" key={row.id} onClick={() => onOpenRow(row.id)}><b>{renderCellPreview(row.cells[database.properties[0]?.id], database.properties[0]?.type ?? 'text') || '無題の記録'}</b><small>{new Date(row.createdAt).toLocaleString()}</small></button>)}{database.rows.length === 0 && <p>まだ登録はありません。</p>}</section>
      </aside>
    </div>
  </div>;
}
