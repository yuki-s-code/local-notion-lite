import React from 'react';

type Props = {
  analysis: {
    numeric: Array<any>;
    checkbox: Array<any>;
    select: Array<any>;
    date: Array<any>;
  };
};

export function DatabaseAnalysisPanel({ analysis }: Props) {
  return (
    <div className="db-analysis-panel db-analysis-modern db-fast-analysis">
      <div className="analysis-header"><strong>分析</strong><span>必要な時だけ計算します</span></div>
      <div className="analysis-grid-v58">
        {analysis.numeric.map(item => <div className="analysis-card" key={item.propertyId}><strong>{item.name}</strong><span>平均 {item.avg.toFixed(1)} / 合計 {item.sum.toFixed(1)}</span><div className="simple-bar"><i style={{ width: `${Math.min(100, Math.abs(item.avg))}%` }} /></div></div>)}
        {analysis.checkbox.map(item => <div className="analysis-card" key={item.propertyId}><strong>{item.name}</strong><span>完了率 {item.rate}%</span><div className="simple-bar"><i style={{ width: `${item.rate}%` }} /></div></div>)}
        {analysis.select.slice(0, 4).map(item => <div className="analysis-card" key={item.propertyId}><strong>{item.name}</strong>{item.counts.slice(0, 5).map((count: any) => <span key={count.value}>{count.value}: {count.count}</span>)}</div>)}
        {analysis.date.map(item => <div className="analysis-card" key={item.propertyId}><strong>{item.name}</strong><span>{item.earliest} 〜 {item.latest}</span><small>{item.filled}件入力</small></div>)}
      </div>
    </div>
  );
}
