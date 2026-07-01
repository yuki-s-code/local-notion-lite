import React, { useMemo, useState } from 'react';
import type { PageProperties } from '../../../../shared/types';

type IssueKind = 'critical' | 'warning' | 'tip' | 'good';
type Issue = { kind: IssueKind; title: string; detail: string };

type Props = {
  title: string;
  markdown: string;
  properties: PageProperties;
  onAskAi?: (prompt: string) => void;
};

function currentReiwaYear() {
  return new Date().getFullYear() - 2018;
}

function diagnosis(title: string, markdown: string, p: PageProperties): Issue[] {
  const issues: Issue[] = [];
  const now = new Date().toISOString().slice(0, 10);
  const text = String(markdown || '').trim();
  const wikiStatus = p.wikiStatus || 'draft';
  const due = String(p.wikiReviewDue || '');
  const source = String(p.wikiSource || '').trim();
  const owner = String(p.wikiOwner || '').trim();
  const tags = Array.isArray(p.tags) ? p.tags.filter(Boolean) : [];

  if (!text) issues.push({ kind: 'critical', title: '本文がありません', detail: 'ページ本文を入力するか、資料を取り込んでください。' });
  if (wikiStatus === 'archived') issues.push({ kind: 'warning', title: '廃止済みのページです', detail: 'AIは低優先で扱います。後継ページがある場合は設定してください。' });
  if (due && due < now) issues.push({ kind: 'critical', title: '確認期限を過ぎています', detail: `次回確認日は ${due} です。内容を確認して日付を更新してください。` });
  if (wikiStatus === 'verified' && !source) issues.push({ kind: 'warning', title: '正式版ですが根拠資料が未設定です', detail: '規程名・PDF名・通知文などの根拠を記録するとAI回答の信頼性が上がります。' });
  if (wikiStatus === 'verified' && !owner) issues.push({ kind: 'tip', title: '責任者が未設定です', detail: '年度更新や制度変更時に確認する担当を記録しておくと引継ぎが容易です。' });
  if (wikiStatus === 'draft') issues.push({ kind: 'tip', title: '下書きとして管理中です', detail: '内容確認後に「確認待ち」または「正式版」へ進められます。' });
  if (!tags.length && text.length >= 240) issues.push({ kind: 'tip', title: 'タグが未設定です', detail: '関連ページ検索やAIの再ランキングを改善するため、2〜4個のタグを設定することをおすすめします。' });

  const reiwa = currentReiwaYear();
  const olderReiwa = Array.from(text.matchAll(/令和\s*([0-9]{1,2})\s*年度/g)).map(match => Number(match[1])).filter(year => Number.isFinite(year) && year < reiwa);
  const olderWestern = Array.from(text.matchAll(/\b(20[0-2][0-9])年度?\b/g)).map(match => Number(match[1])).filter(year => Number.isFinite(year) && year < new Date().getFullYear());
  if (olderReiwa.length || olderWestern.length) {
    const labels = [...new Set([...olderReiwa.map(year => `令和${year}年度`), ...olderWestern.map(year => `${year}年度`)])].slice(0, 3);
    issues.push({ kind: 'warning', title: '過年度の表記があります', detail: `${labels.join('・')} を検出しました。引用・沿革でなければ、現在年度への更新要否を確認してください。` });
  }

  const headings = Array.from(text.matchAll(/^#{1,3}\s+(.+)$/gm)).map(match => match[1].trim().toLowerCase()).filter(Boolean);
  const duplicateHeadings = headings.filter((heading, index) => headings.indexOf(heading) !== index);
  if (duplicateHeadings.length) issues.push({ kind: 'tip', title: '重複した見出しがあります', detail: `「${duplicateHeadings[0]}」が複数あります。内容をまとめられるか確認してください。` });
  if (text.length >= 1000 && headings.length < 2) issues.push({ kind: 'tip', title: '見出しが少なめです', detail: '長いページは見出しを追加すると、目次・検索・AI要約の精度が上がります。' });
  if (!issues.length) issues.push({ kind: 'good', title: '大きな確認事項は見つかりませんでした', detail: 'Wiki情報・本文構造・タグは現在の状態で問題ありません。' });
  return issues;
}

const ICON: Record<IssueKind, string> = { critical: '!', warning: '!', tip: '✦', good: '✓' };
const LABEL: Record<IssueKind, string> = { critical: '対応が必要', warning: '確認推奨', tip: '改善ヒント', good: '良好' };

export function PageDiagnosisPanel({ title, markdown, properties, onAskAi }: Props) {
  const [open, setOpen] = useState(false);
  const issues = useMemo(() => diagnosis(title, markdown, properties), [title, markdown, properties]);
  const actionable = issues.filter(issue => issue.kind === 'critical' || issue.kind === 'warning').length;
  const score = Math.max(48, 100 - issues.reduce((sum, issue) => sum + (issue.kind === 'critical' ? 24 : issue.kind === 'warning' ? 12 : issue.kind === 'tip' ? 4 : 0), 0));
  const prompt = `このページを業務Wikiとして詳しく診断してください。古い年度表記、根拠不足、説明の抜け漏れ、重複、FAQ化候補、改善案を、根拠のない断定を避けて優先度順に示してください。\n\nページ名: ${title || '無題'}\n\n本文:\n${String(markdown || '').slice(0, 12000)}`;

  return <section className={`page-diagnosis-v470 ${open ? 'is-open' : ''}`} aria-label="ページ診断">
    <button className="page-diagnosis-summary-v470" type="button" onClick={() => setOpen(value => !value)}>
      <span className={`page-diagnosis-score-v470 ${actionable ? 'needs-attention' : 'healthy'}`}>{score}</span>
      <span className="page-diagnosis-summary-copy-v470"><b>ページ診断</b><small>{actionable ? `${actionable}件の確認事項があります` : '確認事項は見つかりませんでした'}</small></span>
      <span className="page-diagnosis-summary-status-v470">{open ? '閉じる' : '確認する'} ▾</span>
    </button>
    {open && <div className="page-diagnosis-body-v470">
      <div className="page-diagnosis-head-v470"><div><b>確認結果</b><small>Wiki情報・本文構造・年度表記を端末内で即時チェックしています。</small></div>{onAskAi && <button type="button" onClick={() => onAskAi(prompt)}>AIに詳しく診断を依頼</button>}</div>
      <div className="page-diagnosis-list-v470">
        {issues.map((issue, index) => <article key={`${issue.title}-${index}`} className={`page-diagnosis-item-v470 ${issue.kind}`}><span>{ICON[issue.kind]}</span><div><small>{LABEL[issue.kind]}</small><b>{issue.title}</b><p>{issue.detail}</p></div></article>)}
      </div>
    </div>}
  </section>;
}
