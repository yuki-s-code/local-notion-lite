import React, { useCallback, useEffect, useState } from "react";

export type GoogleDriveFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  driveId?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
};

type Status = { configured: boolean; connected: boolean; clientId?: string; email?: string };

export function GoogleDrivePicker({ onAdd, onChanges, onStatus, compact = false }: { onAdd: (file: GoogleDriveFileItem) => void; onChanges?: (changes: Array<{ fileId: string; removed?: boolean; file?: GoogleDriveFileItem }>) => void; onStatus?: (message: string) => void; compact?: boolean }) {
  const [status, setStatus] = useState<Status>({ configured: false, connected: false });
  const [clientId, setClientId] = useState("");
  const [query, setQuery] = useState("");
  const [driveId, setDriveId] = useState("");
  const [drives, setDrives] = useState<Array<{ id: string; name: string }>>([]);
  const [files, setFiles] = useState<GoogleDriveFileItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    const next = await window.localNotion.googleWorkspace.getStatus();
    setStatus(next);
    setClientId(next.clientId || "");
    if (next.connected) {
      const shared = await window.localNotion.googleWorkspace.listSharedDrives().catch(() => []);
      setDrives(shared);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { onStatus?.(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!status.configured) {
    return <div className="google-drive-picker">
      <strong>Google Workspace</strong>
      <p>Google Cloudで作成した「デスクトップアプリ」のOAuthクライアントIDを設定します。</p>
      <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="…apps.googleusercontent.com" />
      <button type="button" disabled={busy || !clientId.trim()} onClick={() => void run(async () => { const next = await window.localNotion.googleWorkspace.configure(clientId); setStatus(next); onStatus?.("Google OAuthクライアントIDを保存しました"); })}>設定を保存</button>
    </div>;
  }

  if (!status.connected) {
    return <div className="google-drive-picker">
      <strong>Google Workspace</strong>
      <p>{clientId}</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { const next = await window.localNotion.googleWorkspace.connect(['drive']); setStatus(next); await refreshStatus(); onStatus?.("Google Workspaceへ接続しました"); })}>Googleで接続</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await window.localNotion.googleWorkspace.configure(""); await refreshStatus(); })}>設定を変更</button>
    </div>;
  }

  return <div className="google-drive-picker">
    <div className="google-drive-account"><strong>Google Drive</strong><small>{status.email || "接続済み"}</small></div>
    <select value={driveId} onChange={(event) => setDriveId(event.target.value)}>
      <option value="">マイドライブ＋共有ドライブ</option>
      {drives.map((drive) => <option key={drive.id} value={drive.id}>{drive.name}</option>)}
    </select>
    <div className="google-drive-search-row">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Drive内を検索" onKeyDown={(event) => { if (event.key === "Enter") void run(async () => setFiles(await window.localNotion.googleWorkspace.searchFiles(query, driveId || undefined))); }} />
      <button type="button" disabled={busy} onClick={() => void run(async () => setFiles(await window.localNotion.googleWorkspace.searchFiles(query, driveId || undefined)))}>検索</button>
    </div>
    <div className="google-drive-results">
      {files.map((file) => <button type="button" key={file.id} onClick={() => onAdd(file)}>
        <span>{file.mimeType === "application/vnd.google-apps.folder" ? "📁" : file.mimeType.includes("spreadsheet") ? "▦" : file.mimeType.includes("document") ? "📄" : file.mimeType === "application/pdf" ? "📕" : "☁"}</span>
        <span><b>{file.name}</b><small>{file.modifiedTime ? new Date(file.modifiedTime).toLocaleString("ja-JP") : file.mimeType}</small></span>
      </button>)}
      {!files.length && <p>検索するとDriveファイルが表示されます。</p>}
    </div>
    <button type="button" disabled={busy} onClick={() => void run(async () => {
      const result = await window.localNotion.googleWorkspace.syncDriveChanges();
      if (result.changes.length) onChanges?.(result.changes);
      onStatus?.(result.initialized ? "Drive差分同期を初期化しました" : `Driveの変更${result.changes.length}件を確認しました`);
    })}>変更を同期</button>
    {!compact && <button type="button" className="danger-quiet" disabled={busy} onClick={() => void run(async () => { setStatus(await window.localNotion.googleWorkspace.disconnect()); setFiles([]); })}>接続を解除</button>}
  </div>;
}
