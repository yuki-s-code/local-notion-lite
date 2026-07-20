import React, { useCallback, useEffect, useState } from "react";

export type GoogleGmailMessageItem = {
  id: string;
  threadId: string;
  subject: string;
  from?: string;
  to?: string;
  date?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  attachments: Array<{ attachmentId?: string; filename: string; mimeType?: string; size?: number }>;
};

type WorkspaceStatus = {
  connected: boolean;
  gmailEnabled?: boolean;
  gmailComposeEnabled?: boolean;
  email?: string;
};

export function GoogleGmailPicker({ onAdd, onStatus }: { onAdd: (message: GoogleGmailMessageItem) => void; onStatus?: (message: string) => void }) {
  const [status, setStatus] = useState<WorkspaceStatus>({ connected: false });
  const [query, setQuery] = useState("newer_than:30d -in:spam -in:trash");
  const [messages, setMessages] = useState<GoogleGmailMessageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });

  const refresh = useCallback(async () => setStatus(await window.localNotion.googleWorkspace.getStatus()), []);
  useEffect(() => { void refresh().catch((error) => onStatus?.(String(error))); }, [onStatus, refresh]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { onStatus?.(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!status.connected) return <div className="google-drive-picker"><p>先にDriveタブからGoogle Workspaceへ接続してください。</p></div>;
  if (!status.gmailEnabled || !status.gmailComposeEnabled) return <div className="google-drive-picker">
    <strong>Gmail権限が必要です</strong>
    <p>Gmailは検索したメールだけを取得し、送信せず下書きだけを作成します。</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => {
      await window.localNotion.googleWorkspace.disconnect();
      await window.localNotion.googleWorkspace.connect(['drive', 'gmail']);
      await refresh();
      onStatus?.("Gmail権限を追加しました");
    })}>再認証する</button>
  </div>;

  return <div className="google-drive-picker google-gmail-picker">
    <div className="google-drive-account"><strong>Gmail</strong><small>{status.email}</small></div>
    <div className="google-drive-search-row">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例: from:example@city.jp newer_than:7d" onKeyDown={(event) => { if (event.key === "Enter") void run(async () => setMessages(await window.localNotion.googleWorkspace.searchGmailMessages(query))); }} />
      <button type="button" disabled={busy} onClick={() => void run(async () => setMessages(await window.localNotion.googleWorkspace.searchGmailMessages(query)))}>検索</button>
    </div>
    <small>Gmailと同じ検索演算子を使用できます。検索結果は最大50件です。</small>
    <div className="google-drive-results google-gmail-results">
      {messages.map((message) => <button type="button" key={message.id} onClick={() => onAdd(message)}>
        <span>✉</span><span><b>{message.subject}</b><small>{message.from || "送信者不明"}{message.attachments.length ? ` · 添付${message.attachments.length}件` : ""}</small></span>
      </button>)}
      {!messages.length && <p>必要なメールだけ検索してホワイトボードへ追加できます。</p>}
    </div>
    <div className="google-gmail-draft">
      <strong>Gmail下書き</strong>
      <input value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} placeholder="宛先" />
      <input value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} placeholder="件名" />
      <textarea value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} placeholder="本文" rows={5} />
      <button type="button" disabled={busy || !draft.to.trim() || !draft.subject.trim()} onClick={() => void run(async () => {
        await window.localNotion.googleWorkspace.createGmailDraft(draft);
        onStatus?.("Gmailに下書きを作成しました。送信はしていません");
        setDraft({ to: "", subject: "", body: "" });
      })}>下書きを作成</button>
    </div>
  </div>;
}
