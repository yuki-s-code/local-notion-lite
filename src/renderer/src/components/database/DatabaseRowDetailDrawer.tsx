import React, { useEffect, useMemo, useRef } from 'react';
import type { PageWithLock, JournalSummary, WorkspaceDatabase } from '../../../../shared/types';
import type { ApiClient } from '../../lib/api';
import { DatabaseRowContentEditor } from './DatabaseRowContentEditor';
import { DatabasePropertyEditor } from './DatabasePropertyEditor';
import { WorkspaceRelatedPanel } from '../screens/WorkspaceRelatedPanel';

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  text: 'テキスト',
  number: '数値',
  date: '日付',
  checkbox: 'チェック',
  select: '選択',
  multi_select: '複数選択',
  relation: 'Relation',
  rollup: 'Rollup',
  formula: 'Formula',
  url: 'URL',
  phone: '電話番号',
  email: 'メール',
  created_time: '作成日時（自動）',
  last_edited_time: '最終更新日時（自動）',
};

type Props = {
  selectedRow: WorkspaceDatabase['rows'][number];
  selectedRowTitle: string;
  selectedRowIndex: number | string;
  selectedIncomingRelations: any[];
  database: WorkspaceDatabase;
  allDatabases: WorkspaceDatabase[];
  pages: PageWithLock[];
  journals: JournalSummary[];
  editing: boolean;
  onClose: () => void;
  onUpdateCell: (rowId: string, propId: string, value: any, immediate?: boolean) => void;
  onOpenRelationTarget: (prop: WorkspaceDatabase['properties'][number], rawId: string) => void;
  onOpenIncomingRelation: (item: any) => void;
  onOpenPage?: (pageId: string) => void;
  onOpenDatabase?: (databaseId: string) => void;
  onOpenDatabaseRow?: (databaseId: string, rowId: string) => void;
  onOpenJournal?: (date: string) => void;
  api?: ApiClient | null;
  width?: number;
  onWidthChange?: (width: number) => void;
  onChildPageCreated?: () => void;
};

export function DatabaseRowDetailDrawer({ selectedRow, selectedRowTitle, selectedRowIndex, selectedIncomingRelations, database, allDatabases, pages, journals, editing, onClose, onUpdateCell, onOpenRelationTarget, onOpenIncomingRelation, onOpenPage, onOpenDatabase, onOpenDatabaseRow, onOpenJournal, api = null, width = 520, onWidthChange, onChildPageCreated }: Props) {
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const viewportSafeMax = Math.max(360, Math.min(920, window.innerWidth - 428));
      const next = Math.max(360, Math.min(viewportSafeMax, drag.startWidth - (event.clientX - drag.startX)));
      onWidthChange?.(next);
    };
    const handleUp = () => {
      dragStateRef.current = null;
      document.body.classList.remove('db-row-preview-resizing-v260');
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.classList.remove('db-row-preview-resizing-v260');
    };
  }, [onWidthChange]);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current = { startX: event.clientX, startWidth: width };
    document.body.classList.add('db-row-preview-resizing-v260');
  };

  const propertySummary = useMemo(() => {
    const total = database.properties.length;
    const filled = database.properties.filter(prop => {
      const value = selectedRow.cells[prop.id];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }).length;
    return { total, filled };
  }, [database.properties, selectedRow.cells]);

  const propertyGroups = useMemo(() => {
    const primary = database.properties.filter(prop => !['formula', 'rollup'].includes(prop.type));
    const computed = database.properties.filter(prop => ['formula', 'rollup'].includes(prop.type));
    return { primary, computed };
  }, [database.properties]);

  return (
    <aside className="db-row-preview db-row-preview-modern db-row-preview-v60 db-row-preview-drawer-v61 db-row-preview-resizable-v260 db-row-preview-v263" style={{ width }}>
      <div className="db-row-preview-resize-handle-v260" onMouseDown={startResize} title="ドラッグしてプレビュー幅を変更" />

      <div className="row-preview-hero-v263">
        <div className="row-preview-hero-main-v263">
          <div className="preview-overline">Database row page</div>
          <strong>{selectedRowTitle || '無題の行'}</strong>
          <div className="row-preview-hero-sub-v263">
            <span>{database.title}</span>
            <span>#{selectedRowIndex}</span>
            <span>{editing ? '編集可能' : '読み取り専用'}</span>
          </div>
        </div>
        <button className="row-preview-close-v61 row-preview-close-v263" onClick={onClose} title="詳細を閉じる">×</button>
      </div>

      <div className="row-preview-stats-v263">
        <div><small>Properties</small><strong>{propertySummary.filled}/{propertySummary.total}</strong></div>
        <div><small>Created</small><strong>{new Date(selectedRow.createdAt).toLocaleDateString()}</strong></div>
        <div><small>Updated</small><strong>{new Date(selectedRow.updatedAt).toLocaleDateString()}</strong></div>
      </div>

      <nav className="row-preview-jump-v263" aria-label="プレビュー内の移動">
        <a href="#db-row-properties-v263">プロパティ</a>
        <a href="#db-row-body-v263">本文</a>
        <a href="#db-row-related-v286">関連</a>
        <a href="#db-row-relations-v263">Relation</a>
      </nav>

      <section className="row-preview-card-v263" id="db-row-properties-v263">
        <div className="row-preview-card-head-v263">
          <div><strong>プロパティ</strong><small>一覧テーブルと同じ入力方式で編集できます</small></div>
          <span>{PROPERTY_TYPE_LABELS[database.properties[0]?.type || ''] ? `${database.properties.length}項目` : `${database.properties.length}項目`}</span>
        </div>
        <div className="db-row-preview-list db-row-preview-list-v60 db-row-preview-list-v260 db-row-preview-property-grid-v263">
          {propertyGroups.primary.length === 0 ? (
            <div className="row-preview-empty-v60"><div>🧩</div><strong>プロパティがありません</strong><span>データベースのPropertiesから項目を追加できます。</span></div>
          ) : propertyGroups.primary.map(prop => (
            <DatabasePropertyEditor key={prop.id} database={database} allDatabases={allDatabases} pages={pages} journals={journals} row={selectedRow} prop={prop} editing={editing} api={api} onUpdateCell={onUpdateCell} onOpenRelationTarget={onOpenRelationTarget} />
          ))}
        </div>
        {propertyGroups.computed.length > 0 ? (
          <div className="db-row-preview-computed-v263">
            <small>計算・集計</small>
            {propertyGroups.computed.map(prop => (
              <DatabasePropertyEditor key={prop.id} database={database} allDatabases={allDatabases} pages={pages} journals={journals} row={selectedRow} prop={prop} editing={editing} api={api} onUpdateCell={onUpdateCell} onOpenRelationTarget={onOpenRelationTarget} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="row-preview-card-v263" id="db-row-body-v263">
        <DatabaseRowContentEditor api={api} database={database} rowId={selectedRow.id} title={selectedRowTitle || '無題の行'} editing={editing} pages={pages} allDatabases={allDatabases} onOpenPage={onOpenPage} onOpenDatabase={onOpenDatabase} onOpenDatabaseRow={onOpenDatabaseRow} onChildPageCreated={onChildPageCreated} />
      </section>


      <section className="row-preview-card-v263 row-preview-related-card-v286" id="db-row-related-v286">
        <WorkspaceRelatedPanel
          api={api}
          target={{ type: 'database_row', databaseId: database.id, id: selectedRow.id }}
          compact
          description="このDB行に近いページ・FAQ・過去記録を抽出します。"
          onOpenPage={onOpenPage || (() => undefined)}
          onOpenDatabase={onOpenDatabase || (() => undefined)}
          onOpenDatabaseRow={onOpenDatabaseRow || (() => undefined)}
          onOpenJournal={onOpenJournal || (() => undefined)}
        />
      </section>

      <section className="row-preview-card-v263" id="db-row-relations-v263">
        <div className="row-preview-card-head-v263">
          <div><strong>逆引きRelation</strong><small>この行を参照している他の行</small></div>
          <span>{selectedIncomingRelations.length}件</span>
        </div>
        <div className="db-backrelation-panel-v126 db-backrelation-panel-v263">
          {selectedIncomingRelations.length === 0 ? <small>この行を参照しているRelationはまだありません。</small> : selectedIncomingRelations.map(item => <button type="button" key={`${item.sourceDbId}:${item.sourceRowId}:${item.propertyId}`} onClick={() => onOpenIncomingRelation(item)}>↩ {item.sourceDbTitle} / {item.sourceRowTitle}<em>{item.propertyName}</em></button>)}
        </div>
      </section>
    </aside>
  );
}
