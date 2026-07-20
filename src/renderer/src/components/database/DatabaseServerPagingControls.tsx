import React from 'react';
import type { DatabaseQueryResult } from '../../../../shared/types';

type Props = {
  serverRows: DatabaseQueryResult | null;
  serverRowsLoading: boolean;
  visibleRowsCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number | ((page: number) => number)) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function DatabaseServerPagingControls({ serverRows, serverRowsLoading, visibleRowsCount, page, pageSize, onPageChange, onPageSizeChange }: Props) {
  return (
    <div className="db-server-pager-v133">
      <div><strong>Server Paging</strong><span>{serverRowsLoading ? '読み込み中...' : serverRows ? `${visibleRowsCount} / ${serverRows.total} 行を表示・${serverRows.elapsedMs}ms・${serverRows.mode}` : '未取得'}</span></div>
      <div>
        <button disabled={serverRowsLoading || page <= 1} onClick={() => onPageChange(current => Math.max(1, current - 1))}>前へ</button>
        <span>Page {page}</span>
        <button disabled={serverRowsLoading || !serverRows?.hasMore} onClick={() => onPageChange(current => current + 1)}>次へ</button>
        <select value={pageSize} onChange={e => onPageSizeChange(Number(e.target.value))}>
          <option value={50}>50</option>
          <option value={120}>120</option>
          <option value={250}>250</option>
          <option value={500}>500</option>
        </select>
      </div>
    </div>
  );
}
