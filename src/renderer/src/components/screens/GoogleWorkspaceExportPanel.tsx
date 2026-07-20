import React, { useMemo, useState } from "react";
import type { FreeformNode } from "./freeformCanvasModel";

type Props = {
  boardTitle: string;
  nodes: FreeformNode[];
  onStatus?: (message: string) => void;
};

type WorkspaceStatus = {
  connected: boolean;
  docsEnabled?: boolean;
  sheetsEnabled?: boolean;
  email?: string;
};

function nodeKindLabel(kind: FreeformNode["kind"]): string {
  const labels: Partial<Record<FreeformNode["kind"], string>> = {
    note: "付箋",
    page: "ページ",
    database: "データベース",
    pdf: "PDF",
    group: "フレーム",
    text: "テキスト",
    shape: "図形",
    image: "画像",
    drawing: "描画",
    "google-drive": "Google Drive",
    "google-calendar": "Google Calendar",
    "google-gmail": "Gmail",
    "web-project": "Webプロジェクト",
  };
  return labels[kind] || kind;
}

function buildDocumentContent(nodes: FreeformNode[]): string {
  return nodes.map((node, index) => {
    const lines = [
      `${index + 1}. ${node.title || "無題"}`,
      `種類: ${nodeKindLabel(node.kind)}`,
    ];
    if (node.body?.trim()) lines.push("", node.body.trim());
    if (node.externalUrl) lines.push("", `リンク: ${node.externalUrl}`);
    return lines.join("\n");
  }).join("\n\n---\n\n");
}

function buildSheetRows(nodes: FreeformNode[]): Array<Array<string | number>> {
  return [
    ["種類", "タイトル", "本文", "リンク", "X", "Y", "幅", "高さ", "グループ", "フレーム"],
    ...nodes.map((node) => [
      nodeKindLabel(node.kind),
      node.title || "無題",
      node.body || "",
      node.externalUrl || "",
      Math.round(node.x),
      Math.round(node.y),
      Math.round(node.w),
      Math.round(node.h),
      node.groupId || "",
      node.parentFrameId || "",
    ]),
  ];
}

export function GoogleWorkspaceExportPanel({ boardTitle, nodes, onStatus }: Props) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(`${boardTitle || "ホワイトボード"} 書き出し`);
  const targetNodes = useMemo(() => nodes.filter((node) => node.kind !== "drawing"), [nodes]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  React.useEffect(() => {
    void window.localNotion.googleWorkspace.getStatus().then(setStatus).catch((error) => onStatus?.(String(error)));
  }, [onStatus]);

  if (!status?.connected) {
    return <div className="google-drive-picker"><p>先にDriveタブからGoogle Workspaceへ接続してください。</p></div>;
  }

  if (!status.docsEnabled || !status.sheetsEnabled) {
    return <div className="google-drive-picker">
      <strong>Docs・Sheets権限が必要です</strong>
      <p>選択したホワイトボード要素を書き出すため、Google DocsとGoogle Sheetsの作成権限を追加します。</p>
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        await window.localNotion.googleWorkspace.disconnect();
        const next = await window.localNotion.googleWorkspace.connect(['drive', 'docs', 'sheets']);
        setStatus(next);
        onStatus?.("Google Docs・Sheets権限を追加しました");
      })}>再認証する</button>
    </div>;
  }

  return <div className="google-drive-picker google-workspace-export-panel">
    <div className="google-drive-account"><strong>Workspaceへ書き出し</strong><small>{status.email}</small></div>
    <label>書き出し名</label>
    <input value={title} onChange={(event) => setTitle(event.target.value)} />
    <small>{targetNodes.length}件を書き出します。描画線は除外されます。</small>
    <div className="google-workspace-export-actions">
      <button type="button" className="primary" disabled={busy || !targetNodes.length} onClick={() => void run(async () => {
        const result = await window.localNotion.googleWorkspace.createGoogleDoc({
          title: title.trim() || "ホワイトボード書き出し",
          content: buildDocumentContent(targetNodes),
        });
        onStatus?.("Google Docsを作成しました");
        await window.localNotion.openExternalHttpUrl(result.webViewLink);
      })}>Google Docsを作成</button>
      <button type="button" disabled={busy || !targetNodes.length} onClick={() => void run(async () => {
        const result = await window.localNotion.googleWorkspace.createGoogleSheet({
          title: title.trim() || "ホワイトボード書き出し",
          rows: buildSheetRows(targetNodes),
        });
        onStatus?.("Google Sheetsを作成しました");
        await window.localNotion.openExternalHttpUrl(result.webViewLink);
      })}>Google Sheetsを作成</button>
    </div>
  </div>;
}
