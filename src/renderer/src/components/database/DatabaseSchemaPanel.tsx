import React, { useState } from 'react';
import type { DatabasePropertyType, PageWithLock, JournalSummary, WorkspaceDatabase } from '../../../../shared/types';
import { getRelationTargetDatabase, propertyTypeIcon, scopeIcon, workspaceScope } from './DatabaseHelpers';

type Props = {
  open: boolean;
  database: WorkspaceDatabase;
  allDatabases: WorkspaceDatabase[];
  pages: PageWithLock[];
  journals: JournalSummary[];
  relationProperties: WorkspaceDatabase['properties'];
  relationUniverse: WorkspaceDatabase[];
  editing: boolean;
  draggedPropId: string | null;
  hiddenColumns: Record<string, boolean>;
  editingOptionsPropId: string | null;
  setDraggedPropId: (id: string | null) => void;
  setHiddenColumns: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  movePropertyToEnd: (sourcePropId: string) => void;
  movePropertyBefore: (sourcePropId: string, targetPropId: string) => void;
  addPropertyLocal: (type: DatabasePropertyType) => void;
  addSubItemRelation: () => void;
  addDependencyRelation: () => void;
  updatePropertyName: (propId: string, name: string) => void;
  updatePropertyDescription: (propId: string, description: string) => void;
  updatePropertyType: (propId: string, type: DatabasePropertyType) => void;
  updatePropertyConfig: (propId: string, patch: Partial<WorkspaceDatabase['properties'][number]>) => void;
  removeProperty: (propId: string) => void;
  editPropertyOptions: (propId: string) => void;
  addPropertyOption: (propId: string, optionName: string) => void;
  renamePropertyOption: (propId: string, oldName: string, newName: string) => void;
  deletePropertyOption: (propId: string, optionName: string) => void;
  updateRelationTarget: (propId: string, relationTargetType: 'database' | 'page' | 'journal', relationDatabaseId?: string) => void;
  updateRelationBidirectional: (propId: string, reversePropId: string) => void;
  updateRollupConfig: (propId: string, patch: Partial<WorkspaceDatabase['properties'][number]>) => void;
  updateFormulaExpression: (propId: string, formulaExpression: string) => void;
};

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

export function DatabaseSchemaPanel(props: Props) {
  const {
    open,
    database,
    allDatabases,
    relationProperties,
    relationUniverse,
    editing,
    draggedPropId,
    hiddenColumns,
    editingOptionsPropId,
    setDraggedPropId,
    setHiddenColumns,
    movePropertyToEnd,
    movePropertyBefore,
    addPropertyLocal,
    addSubItemRelation,
    addDependencyRelation,
    updatePropertyName,
    updatePropertyDescription,
    updatePropertyType,
    updatePropertyConfig,
    removeProperty,
    editPropertyOptions,
    addPropertyOption,
    renamePropertyOption,
    deletePropertyOption,
    updateRelationTarget,
    updateRelationBidirectional,
    updateRollupConfig,
    updateFormulaExpression,
  } = props;
  const setPropertyVisibility = (propertyId: string, visible: boolean) => {
    setHiddenColumns(current => {
      const visibleCount = database.properties.filter(prop => !current[prop.id]).length;
      if (!visible && !current[propertyId] && visibleCount <= 1) return current;
      return { ...current, [propertyId]: !visible };
    });
  };
  if (!open) return null;
  return <div className="db-view-panel db-modern-panel db-schema-panel db-schema-panel-v125">
        <div className="db-schema-hero-v125">
          <div>
            <div className="panel-eyebrow">Database properties</div>
            <strong>プロパティを整える</strong>
            <span>列名・型・表示・Relation先を一覧で整理できます。ドラッグで列順を変更できます。</span>
          </div>
          <div className="db-schema-stats-v60"><b>{database.properties.length}</b><small>properties</small></div>
        </div>

        {relationProperties.length > 0 && <div className="db-relation-map-v126">
          <div><b>Relation Map</b><span>このDBのRelation列と接続先です。行詳細では紐付け先と逆引きが確認できます。</span></div>
          <div>
            {relationProperties.map(prop => {
              const targetType = prop.relationTargetType ?? 'database';
              const targetName = targetType === 'page' ? 'ページ' : targetType === 'journal' ? 'Journal' : (relationUniverse.find(db => db.id === (prop.relationDatabaseId || database.id))?.title ?? database.title);
              return <span key={prop.id}>↔ {prop.name} → {targetName}</span>;
            })}
          </div>
        </div>}

        <div className="db-schema-workbench-v125">
          <aside className="db-property-add-panel-v125" onDragOver={e => { if (editing) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (draggedPropId) movePropertyToEnd(draggedPropId); setDraggedPropId(null); }}>
            <strong>列を追加</strong>
            <small>必要な型を選んで追加します。Relationはページ・Journal・他DB行と紐付けできます。</small>
            <div className="db-property-add-buttons-v125">
              <button disabled={!editing} onClick={() => addPropertyLocal('text')}>Aa Text</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('number')}># Number</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('select')}>▾ Select</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('status')}>◉ Status</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('unique_id')}># Unique ID</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('button')}>▶ Button</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('multi_select')}>🏷 Multi</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('date')}>📅 Date</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('checkbox')}>☑ Check</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('url')}>🔗 URL</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('phone')}>☎ 電話番号</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('email')}>✉ メール</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('created_time')}>◷ 作成日時</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('last_edited_time')}>↻ 最終更新日時</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('relation')}>↔ Relation</button>
              <button disabled={!editing || database.properties.some(prop => prop.isSubItemRelation)} onClick={addSubItemRelation}>↳ サブアイテム</button>
              <button disabled={!editing || database.properties.some(prop => prop.isDependencyRelation)} onClick={addDependencyRelation}>⇢ 依存関係</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('rollup')}>Σ Rollup</button>
              <button disabled={!editing} onClick={() => addPropertyLocal('formula')}>ƒx Formula</button>
            </div>
            <div className="db-relation-help-v125">
              <b>Relationの使い方</b>
              <span>例：タスクDB → 関連ページ。タスクから仕様書・会議メモへ移動できます。</span>
              <span>例：案件DB → 関連タスク。案件に紐づく作業行を一覧化できます。</span>
              <span>例：資料DB → 関連Journal。日々の作業ログと資料を結びつけられます。</span>
              <span>セルをクリック → 候補検索 → 選択。行詳細では逆引きRelationも表示します。</span>
              <span>サブアイテムは同じDB内の親行を1件だけ指定し、Tableで階層表示します。</span>
              <span>依存関係は「この行の開始前に完了すべき行」を指定します。Ganttで遅延・未完了の前提を確認できます。</span>
            </div>
          </aside>

          <div className="db-property-list-v125">
            {database.properties.map((prop, index) => (
              <section className="db-property-row-card-v125" key={prop.id} draggable={editing} onDragStart={() => setDraggedPropId(prop.id)} onDragOver={e => { if (editing) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (draggedPropId) movePropertyBefore(draggedPropId, prop.id); setDraggedPropId(null); }} onDragEnd={() => setDraggedPropId(null)}>
                <div className="property-row-main-v125">
                  <span className="property-drag-handle-v125" title="ドラッグで並び替え">⋮⋮</span>
                  <span className="property-order-v125">{index + 1}</span>
                  <span className="property-icon-v125">{propertyTypeIcon(prop.type)}</span>
                  <div className="property-name-and-guide-v553">
                    <input className="property-name-input-v125" disabled={!editing} value={prop.name} onChange={e => updatePropertyName(prop.id, e.target.value)} />
                    <input className="property-guide-input-v553" disabled={!editing} value={prop.description ?? ''} placeholder="説明・入力ガイド（例：半角数字、ハイフン可）" onChange={e => updatePropertyDescription(prop.id, e.target.value)} />
                  </div>
                  <select className="property-type-select-v125" disabled={!editing} value={prop.type} onChange={e => updatePropertyType(prop.id, e.target.value as DatabasePropertyType)}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="select">Select</option>
                    <option value="status">Status</option>
                    <option value="unique_id">Unique ID（自動）</option>
                    <option value="button">Button（行操作）</option>
                    <option value="multi_select">Multi Select</option>
                    <option value="date">Date</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="url">URL</option>
                    <option value="phone">電話番号</option>
                    <option value="email">メール</option>
                    <option value="created_time">作成日時（自動）</option>
                    <option value="last_edited_time">最終更新日時（自動）</option>
                    <option value="relation">Relation</option>
                    <option value="rollup">Rollup</option>
                    <option value="formula">Formula</option>
                  </select>
                  <label className="property-visible-toggle-v125" title={!hiddenColumns[prop.id] && database.properties.filter(item => !hiddenColumns[item.id]).length <= 1 ? '最低1列は表示したままにします。' : undefined}><input type="checkbox" checked={!hiddenColumns[prop.id]} disabled={!hiddenColumns[prop.id] && database.properties.filter(item => !hiddenColumns[item.id]).length <= 1} onChange={e => setPropertyVisibility(prop.id, e.target.checked)} /><span>表示</span></label>
                  <button className="property-delete-v125" disabled={!editing} onClick={() => removeProperty(prop.id)}>削除</button>
                </div>

                {(prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') && <div className="property-subpanel-v125">
                  <button className="property-options-button-v125" disabled={!editing} onClick={() => editPropertyOptions(prop.id)}>{editingOptionsPropId === prop.id ? '選択肢を閉じる' : '選択肢を編集'}</button>
                  <div className="property-option-preview-v125">{(prop.options ?? []).length ? (prop.options ?? []).map(option => <span key={option}>{option}</span>) : <em>選択肢なし</em>}</div>
                  {editingOptionsPropId === prop.id && <PropertyOptionsEditor prop={prop} editing={editing} onAdd={(name) => addPropertyOption(prop.id, name)} onRename={(oldName, newName) => renamePropertyOption(prop.id, oldName, newName)} onDelete={(name) => deletePropertyOption(prop.id, name)} />}
                </div>}

                {prop.type === 'unique_id' && <div className="relation-target-editor-v125 unique-id-editor-v605">
                  <div className="relation-target-copy-v125"><b>Unique ID設定</b><span>行作成時に自動採番します。既存行にも不足分だけ採番され、直接編集はできません。</span></div>
                  <label><span>接頭辞</span><input disabled={!editing} value={prop.uniqueIdPrefix ?? 'ID'} onChange={e => updatePropertyConfig(prop.id, { uniqueIdPrefix: e.target.value.slice(0, 24) })} placeholder="案件" /></label>
                  <label><span>桁数</span><input disabled={!editing} type="number" min={1} max={10} value={prop.uniqueIdDigits ?? 4} onChange={e => updatePropertyConfig(prop.id, { uniqueIdDigits: Math.max(1, Math.min(10, Number(e.target.value) || 4)) })} /></label>
                </div>}

                {prop.type === 'button' && <div className="relation-target-editor-v125 button-action-editor-v619">
                  <div className="relation-target-copy-v125"><b>Button設定</b><span>ボタンを押した行だけを即時更新します。定期実行・全件走査・外部送信は行いません。</span></div>
                  <select disabled={!editing} value={prop.buttonAction ?? ''} onChange={e => updatePropertyConfig(prop.id, { buttonAction: (e.target.value || undefined) as 'mark_status_done' | 'set_today' | undefined })}>
                    <option value="">アクションを選択</option>
                    <option value="mark_status_done">Statusを完了にする</option>
                    <option value="set_today">日付を今日にする</option>
                  </select>
                  <select disabled={!editing} value={prop.buttonTargetPropertyId ?? ''} onChange={e => updatePropertyConfig(prop.id, { buttonTargetPropertyId: e.target.value || undefined })}>
                    <option value="">対象プロパティを選択</option>
                    {database.properties.filter(item => prop.buttonAction === 'set_today' ? item.type === 'date' : item.type === 'status').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>}

                {prop.type === 'relation' && <div className="relation-target-editor-v125">
                  <div className="relation-target-copy-v125"><b>{prop.isSubItemRelation ? "サブアイテム（親）" : prop.isDependencyRelation ? "依存関係（前提タスク）" : "Relation先"}</b><span>{prop.isSubItemRelation ? "同じDBの親行を1件だけ指定します。Tableでは親子として階層表示されます。" : prop.isDependencyRelation ? "この行を開始・完了する前に終えるべき同じDB内の行を指定します。Ganttでは未完了・日付重複を警告します。" : "この列のセルで紐付ける対象を選びます。"}</span></div>
                  <select disabled={!editing || prop.isSubItemRelation || prop.isDependencyRelation} value={prop.relationTargetType ?? 'database'} onChange={e => updateRelationTarget(prop.id, e.target.value as 'database' | 'page' | 'journal', prop.relationDatabaseId)}>
                    <option value="database">データベースの行</option>
                    <option value="page">ページ</option>
                    <option value="journal">Journal</option>
                  </select>
                  {(prop.relationTargetType ?? 'database') === 'database' && <select disabled={!editing || prop.isSubItemRelation || prop.isDependencyRelation} value={prop.relationDatabaseId ?? database.id} onChange={e => updateRelationTarget(prop.id, 'database', e.target.value)}>
                    {allDatabases.filter(db => !(workspaceScope(database) === 'shared' && workspaceScope(db) === 'private')).map(db => <option key={db.id} value={db.id}>{scopeIcon(workspaceScope(db))} {db.title}</option>)}
                  </select>}
                </div>}

                {prop.type === 'relation' && (prop.relationTargetType ?? 'database') === 'database' && (prop.relationDatabaseId ?? database.id) === database.id && <div className="relation-target-editor-v125 relation-pro-editor-v127">
                  <div className="relation-target-copy-v125"><b>双方向Relation</b><span>同じDB内の別Relation列を選ぶと、片方を選択した時に逆側にも自動反映します。</span></div>
                  <select disabled={!editing} value={prop.bidirectionalRelationPropertyId ?? ''} onChange={e => updateRelationBidirectional(prop.id, e.target.value)}>
                    <option value="">逆側Relationなし</option>
                    {database.properties.filter(p => p.type === 'relation' && p.id !== prop.id && (p.relationTargetType ?? 'database') === 'database' && (p.relationDatabaseId ?? database.id) === database.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>}

                {prop.type === 'rollup' && <div className="relation-target-editor-v125 rollup-editor-v127">
                  <div className="relation-target-copy-v125"><b>Rollup設定</b><span>Relation先の行を集計します。例：関連タスクの件数、完了率、数値合計。</span></div>
                  <select disabled={!editing} value={prop.rollupRelationPropertyId ?? ''} onChange={e => updateRollupConfig(prop.id, { rollupRelationPropertyId: e.target.value })}>
                    <option value="">Relation列を選択</option>
                    {database.properties.filter(p => p.type === 'relation' && (p.relationTargetType ?? 'database') === 'database').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  {(() => {
                    const relationProp = database.properties.find(p => p.id === prop.rollupRelationPropertyId && p.type === 'relation');
                    const targetDb = relationProp ? getRelationTargetDatabase(relationProp, database, allDatabases) : database;
                    return <select disabled={!editing || !relationProp} value={prop.rollupTargetPropertyId ?? ''} onChange={e => updateRollupConfig(prop.id, { rollupTargetPropertyId: e.target.value })}>
                      <option value="">集計対象なし</option>
                      {targetDb.properties.filter(p => p.type !== 'relation' && p.type !== 'rollup' && p.type !== 'formula').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>;
                  })()}
                  <select disabled={!editing} value={prop.rollupFunction ?? 'count'} onChange={e => updateRollupConfig(prop.id, { rollupFunction: e.target.value as any })}>
                    <option value="count">件数</option>
                    <option value="count_checked">チェック済み数</option>
                    <option value="count_unchecked">未チェック数</option>
                    <option value="percent_checked">チェック率</option>
                    <option value="count_status_done">完了Status数</option>
                    <option value="count_status_open">未完了Status数</option>
                    <option value="percent_status_done">完了Status率</option>
                    <option value="sum">合計</option>
                    <option value="average">平均</option>
                    <option value="min">最小</option>
                    <option value="max">最大</option>
                    <option value="show_unique">重複なし一覧</option>
                  </select>
                </div>}

                {prop.type === 'formula' && <div className="relation-target-editor-v125 formula-editor-v127">
                  <div className="relation-target-copy-v125"><b>Formula設定</b><span>例：daysUntil(Date)、progress(完了数, 全体数)、{`{数値1} + {数値2}`}</span></div>
                  <input disabled={!editing} value={prop.formulaExpression ?? ''} placeholder="例：daysUntil(Date) / {金額} * 1.1" onChange={e => updateFormulaExpression(prop.id, e.target.value)} />
                </div>}
              </section>
            ))}
          </div>
        </div>
      </div>;
}
