import React, { useEffect, useMemo, useState } from 'react';
import type { DatabaseProperty, WorkspaceDatabase } from '../../../../shared/types';
import { propertyTypeIcon, propertyTypeLabel, renderCellPreview } from './DatabaseHelpers';

type BulkOperation = 'set' | 'clear' | 'add' | 'remove';

export type BulkEditRequest = {
  propertyId: string;
  operation: BulkOperation;
  value: string | number | boolean | string[] | null;
};

type Props = {
  open: boolean;
  database: WorkspaceDatabase;
  rowIds: string[];
  onClose: () => void;
  onApply: (request: BulkEditRequest) => void;
};

const EDITABLE_TYPES = new Set(['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'phone', 'email']);

function defaultOperation(property?: DatabaseProperty): BulkOperation {
  return property?.type === 'multi_select' ? 'add' : 'set';
}

export function DatabaseBulkEditModal({ open, database, rowIds, onClose, onApply }: Props) {
  const editableProperties = useMemo(() => database.properties.filter(prop => EDITABLE_TYPES.has(prop.type)), [database.properties]);
  const [propertyId, setPropertyId] = useState('');
  const [operation, setOperation] = useState<BulkOperation>('set');
  const [rawValue, setRawValue] = useState('');
  const [checked, setChecked] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  const property = editableProperties.find(prop => prop.id === propertyId) ?? editableProperties[0];
  const rows = useMemo(() => database.rows.filter(row => rowIds.includes(row.id)), [database.rows, rowIds]);

  useEffect(() => {
    if (!open) return;
    const first = editableProperties[0];
    setPropertyId(first?.id ?? '');
    setOperation(defaultOperation(first));
    setRawValue('');
    setChecked(true);
    setConfirmed(false);
  }, [open, database.id, editableProperties]);

  if (!open || !property) return null;

  const operationOptions: Array<{ value: BulkOperation; label: string }> = property.type === 'multi_select'
    ? [
      { value: 'add', label: '追加する' },
      { value: 'remove', label: '削除する' },
      { value: 'set', label: '置き換える' },
      { value: 'clear', label: 'すべてクリア' },
    ]
    : [
      { value: 'set', label: property.type === 'checkbox' ? 'まとめて変更' : '値を設定' },
      { value: 'clear', label: '値をクリア' },
    ];

  const selectedOptions = rawValue.split(',').map(value => value.trim()).filter(Boolean);
  const resultValue: BulkEditRequest['value'] = property.type === 'checkbox'
    ? checked
    : property.type === 'number'
      ? (rawValue.trim() === '' ? null : Number(rawValue))
      : property.type === 'multi_select'
        ? selectedOptions
        : rawValue.trim();

  const titleProperty = database.properties[0];
  const canApply = operation === 'clear' || property.type === 'checkbox' || (property.type === 'multi_select' ? selectedOptions.length > 0 : rawValue.trim() !== '');

  function chooseProperty(nextId: string) {
    const next = editableProperties.find(prop => prop.id === nextId);
    setPropertyId(nextId);
    setOperation(defaultOperation(next));
    setRawValue('');
    setConfirmed(false);
  }

  return <div className="db-bulk-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="db-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="db-bulk-edit-title" onMouseDown={event => event.stopPropagation()}>
      <header className="db-bulk-modal-head">
        <div>
          <span className="db-bulk-modal-kicker">BULK EDIT</span>
          <h2 id="db-bulk-edit-title">{rowIds.length}件の行をまとめて編集</h2>
          <p>選択した行だけを更新します。変更後はすぐに取り消せます。</p>
        </div>
        <button type="button" className="db-bulk-modal-close" onClick={onClose} aria-label="閉じる">×</button>
      </header>

      <div className="db-bulk-modal-grid">
        <label className="db-bulk-field">
          <span>変更するプロパティ</span>
          <select value={property.id} onChange={event => chooseProperty(event.target.value)}>
            {editableProperties.map(prop => <option key={prop.id} value={prop.id}>{propertyTypeIcon(prop.type)} {prop.name}（{propertyTypeLabel(prop.type)}）</option>)}
          </select>
          {property.description ? <small>{property.description}</small> : null}
        </label>
        <label className="db-bulk-field">
          <span>操作</span>
          <select value={operation} onChange={event => { setOperation(event.target.value as BulkOperation); setConfirmed(false); }}>
            {operationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      {operation !== 'clear' && <div className="db-bulk-value-panel">
        {property.type === 'checkbox' ? <label className="db-bulk-check"><input type="checkbox" checked={checked} onChange={event => { setChecked(event.target.checked); setConfirmed(false); }} /> <span>{checked ? 'チェック済みにする' : '未チェックにする'}</span></label> :
        (property.type === 'select' || property.type === 'status') ? <label className="db-bulk-field"><span>設定する値</span><select value={rawValue} onChange={event => { setRawValue(event.target.value); setConfirmed(false); }}><option value="">選択してください</option>{(property.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}</select></label> :
        property.type === 'multi_select' ? <label className="db-bulk-field"><span>{operation === 'remove' ? '削除する選択肢' : operation === 'add' ? '追加する選択肢' : '設定する選択肢'}</span><div className="db-bulk-options">{(property.options ?? []).map(option => <label key={option}><input type="checkbox" checked={selectedOptions.includes(option)} onChange={event => { const next = new Set(selectedOptions); event.target.checked ? next.add(option) : next.delete(option); setRawValue([...next].join(',')); setConfirmed(false); }} /><span>{option}</span></label>)}</div><small>複数選択できます。</small></label> :
        <label className="db-bulk-field"><span>設定する値</span><input type={property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'email' ? 'email' : property.type === 'url' ? 'url' : property.type === 'phone' ? 'tel' : 'text'} value={rawValue} onChange={event => { setRawValue(event.target.value); setConfirmed(false); }} placeholder={property.type === 'date' ? '日付を選択' : `${property.name}を入力`} /></label>}
      </div>}

      <div className="db-bulk-preview">
        <div className="db-bulk-preview-head"><strong>変更プレビュー</strong><span>{propertyTypeIcon(property.type)} {property.name} を {operationOptions.find(item => item.value === operation)?.label ?? '変更'}</span></div>
        <div className="db-bulk-preview-value">{operation === 'clear' ? '空欄にします' : property.type === 'checkbox' ? (checked ? 'チェック済み' : '未チェック') : property.type === 'multi_select' ? (selectedOptions.join('、') || '選択なし') : String(resultValue || '未入力')}</div>
        <div className="db-bulk-row-list">{rows.slice(0, 6).map(row => <span key={row.id}>{titleProperty ? renderCellPreview(row.cells[titleProperty.id], titleProperty.type) || '無題の行' : row.id}</span>)}{rows.length > 6 ? <span>ほか {rows.length - 6}件</span> : null}</div>
      </div>

      <label className="db-bulk-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> <span>選択した {rowIds.length}件にこの変更を適用することを確認しました</span></label>
      <footer className="db-bulk-modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!canApply || !confirmed} onClick={() => onApply({ propertyId: property.id, operation, value: resultValue })}>変更を適用</button></footer>
    </section>
  </div>;
}
