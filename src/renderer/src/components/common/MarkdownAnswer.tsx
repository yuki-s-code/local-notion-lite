import React, { Fragment, type ReactNode } from 'react';

type MarkdownAnswerProps = {
  markdown: string;
  className?: string;
};

type TableRow = string[];

function safeHref(value: string): string | null {
  const href = String(value || '').trim();
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  return null;
}

function inlineMarkdown(value: string): ReactNode[] {
  const text = String(value || '');
  const tokenPattern = /(\[[^\]]+\]\([^\s)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_|https?:\/\/[^\s<]+)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  const pushText = (part: string) => {
    if (part) nodes.push(<Fragment key={`text-${key++}`}>{part}</Fragment>);
  };

  while ((match = tokenPattern.exec(text)) !== null) {
    pushText(text.slice(cursor, match.index));
    const token = match[0];
    const tokenKey = `token-${key++}`;
    const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      nodes.push(href
        ? <a key={tokenKey} href={href} target="_blank" rel="noreferrer noopener">{inlineMarkdown(link[1])}</a>
        : <Fragment key={tokenKey}>{link[1]}</Fragment>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={tokenKey}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={tokenKey}>{inlineMarkdown(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={tokenKey}>{inlineMarkdown(token.slice(2, -2))}</del>);
    } else if (token.startsWith('*') || token.startsWith('_')) {
      nodes.push(<em key={tokenKey}>{inlineMarkdown(token.slice(1, -1))}</em>);
    } else {
      const href = safeHref(token);
      nodes.push(href ? <a key={tokenKey} href={href} target="_blank" rel="noreferrer noopener">{token}</a> : <Fragment key={tokenKey}>{token}</Fragment>);
    }
    cursor = match.index + token.length;
  }
  pushText(text.slice(cursor));
  return nodes;
}

function isTableDivider(line: string): boolean {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function tableCells(line: string): TableRow {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] || '';
  return !line.trim()
    || /^```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
    || /^>\s?/.test(line)
    || /^\s*[-+*]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1]));
}

function listItems(lines: string[], start: number, ordered: boolean): { end: number; items: Array<{ text: string; checked?: boolean }> } {
  const pattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-+*]\s+(.*)$/;
  const items: Array<{ text: string; checked?: boolean }> = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) break;
    const task = match[1].match(/^\[([ xX])\]\s+(.*)$/);
    items.push(task ? { text: task[2], checked: task[1].toLowerCase() === 'x' } : { text: match[1] });
    index += 1;
  }
  return { end: index, items };
}

export function MarkdownAnswer({ markdown, className = '' }: MarkdownAnswerProps) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) { code.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${blockKey++}`} className="markdown-answer-code"><code data-language={language || undefined}>{code.join('\n')}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={`heading-${blockKey++}`}>{inlineMarkdown(heading[2])}</Tag>);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${blockKey++}`} />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) { quote.push(lines[index].replace(/^>\s?/, '')); index += 1; }
      blocks.push(<blockquote key={`quote-${blockKey++}`}>{quote.map((part, i) => <p key={i}>{inlineMarkdown(part)}</p>)}</blockquote>);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const header = tableCells(line);
      index += 2;
      const rows: TableRow[] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(tableCells(lines[index])); index += 1; }
      blocks.push(<div key={`table-wrap-${blockKey++}`} className="markdown-answer-table-wrap"><table><thead><tr>{header.map((cell, i) => <th key={i}>{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}>{inlineMarkdown(row[cellIndex] || '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }

    if (/^\s*[-+*]\s+/.test(line)) {
      const list = listItems(lines, index, false);
      blocks.push(<ul key={`ul-${blockKey++}`}>{list.items.map((item, itemIndex) => <li key={itemIndex} className={item.checked !== undefined ? 'markdown-answer-task' : undefined}>{item.checked !== undefined ? <input type="checkbox" checked={item.checked} readOnly aria-label="タスク状態" /> : null}{inlineMarkdown(item.text)}</li>)}</ul>);
      index = list.end;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = listItems(lines, index, true);
      blocks.push(<ol key={`ol-${blockKey++}`}>{list.items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item.text)}</li>)}</ol>);
      index = list.end;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) { paragraph.push(lines[index]); index += 1; }
    blocks.push(<p key={`paragraph-${blockKey++}`}>{paragraph.flatMap((part, lineIndex) => [<Fragment key={`line-${lineIndex}`}>{inlineMarkdown(part)}</Fragment>, ...(lineIndex < paragraph.length - 1 ? [<br key={`break-${lineIndex}`} />] : [])])}</p>);
  }

  return <div className={`markdown-answer ${className}`.trim()}>{blocks.length ? blocks : <p />}</div>;
}
