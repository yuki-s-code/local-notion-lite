import { app, safeStorage, shell } from 'electron';
import fs from 'fs-extra';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const DOCS_SCOPE = 'https://www.googleapis.com/auth/documents';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const USERINFO_SCOPE = 'openid email profile';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const DOCS_API = 'https://docs.googleapis.com/v1';
const SHEETS_API = 'https://sheets.googleapis.com/v4';

type GoogleWorkspaceConfig = {
  clientId?: string;
  driveChangeToken?: string;
  driveLastSyncedAt?: number;
};

type StoredTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
  email?: string;
};

export type GoogleWorkspaceCapability = 'drive' | 'calendar' | 'gmail' | 'docs' | 'sheets';

export type GoogleWorkspaceStatus = {
  configured: boolean;
  connected: boolean;
  clientId?: string;
  email?: string;
  expiresAt?: number;
  calendarEnabled?: boolean;
  reconnectRequired?: boolean;
  gmailEnabled?: boolean;
  gmailComposeEnabled?: boolean;
  docsEnabled?: boolean;
  sheetsEnabled?: boolean;
  driveLastSyncedAt?: number;
};


export type GoogleDriveContent = {
  fileId: string;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  driveId?: string;
  parents?: string[];
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
};


export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  status?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  organizer?: { email?: string; displayName?: string };
  updated?: string;
};


export type GoogleGmailAttachment = {
  attachmentId?: string;
  filename: string;
  mimeType?: string;
  size?: number;
};

export type GoogleGmailMessage = {
  id: string;
  threadId: string;
  subject: string;
  from?: string;
  to?: string;
  date?: string;
  messageId?: string;
  references?: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  attachments: GoogleGmailAttachment[];
};

export type GoogleGmailDraftInput = {
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
};

export type GoogleDriveChange = {
  fileId: string;
  removed?: boolean;
  time?: string;
  file?: GoogleDriveFile;
};

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export class GoogleWorkspaceService {
  private readonly configPath = path.join(app.getPath('userData'), 'google-workspace.json');
  private readonly tokenPath = path.join(app.getPath('userData'), 'google-workspace.tokens');

  async getStatus(): Promise<GoogleWorkspaceStatus> {
    const config = await this.readConfig();
    const tokens = await this.readTokens();
    return {
      configured: Boolean(config.clientId),
      connected: Boolean(tokens?.refreshToken || (tokens?.accessToken && tokens.expiresAt > Date.now())),
      clientId: config.clientId,
      email: tokens?.email,
      expiresAt: tokens?.expiresAt,
      calendarEnabled: Boolean(tokens?.scope?.includes(CALENDAR_READONLY_SCOPE)),
      reconnectRequired: Boolean(tokens && !tokens.scope?.includes(CALENDAR_READONLY_SCOPE)),
      gmailEnabled: Boolean(tokens?.scope?.includes(GMAIL_READONLY_SCOPE)),
      gmailComposeEnabled: Boolean(tokens?.scope?.includes(GMAIL_COMPOSE_SCOPE)),
      docsEnabled: Boolean(tokens?.scope?.includes(DOCS_SCOPE)),
      sheetsEnabled: Boolean(tokens?.scope?.includes(SHEETS_SCOPE)),
      driveLastSyncedAt: config.driveLastSyncedAt,
    };
  }

  async configure(clientId: string): Promise<GoogleWorkspaceStatus> {
    const normalized = String(clientId || '').trim();
    if (normalized && !normalized.endsWith('.apps.googleusercontent.com')) {
      throw new Error('Google OAuthクライアントIDの形式を確認してください。');
    }
    await this.writeConfig({ clientId: normalized, driveChangeToken: undefined, driveLastSyncedAt: undefined });
    return this.getStatus();
  }

  async disconnect(): Promise<GoogleWorkspaceStatus> {
    const tokens = await this.readTokens();
    if (tokens?.accessToken) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => undefined);
    }
    await fs.remove(this.tokenPath).catch(() => undefined);
    await this.writeConfig({ driveChangeToken: undefined, driveLastSyncedAt: undefined });
    return this.getStatus();
  }

  async connect(capabilities: GoogleWorkspaceCapability[] = ['drive']): Promise<GoogleWorkspaceStatus> {
    const { clientId } = await this.readConfig();
    if (!clientId) throw new Error('先にGoogle OAuthクライアントIDを設定してください。');

    const verifier = base64Url(crypto.randomBytes(48));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64Url(crypto.randomBytes(24));

    const result = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const server = http.createServer((request, response) => {
        try {
          const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
          if (requestUrl.pathname !== '/oauth2/callback') {
            response.writeHead(404).end();
            return;
          }
          const returnedState = requestUrl.searchParams.get('state');
          const code = requestUrl.searchParams.get('code');
          const error = requestUrl.searchParams.get('error');
          const address = server.address();
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><meta charset="utf-8"><title>Google Workspace</title><style>body{font-family:system-ui;padding:40px;line-height:1.7}</style><h2>Local Notion Liteへ接続しました</h2><p>このタブを閉じてアプリへ戻ってください。</p>');
          server.close();
          if (error) return reject(new Error(`Google認証がキャンセルされました: ${error}`));
          if (!code || returnedState !== state) return reject(new Error('Google認証応答を検証できませんでした。'));
          if (!address || typeof address === 'string') return reject(new Error('OAuthコールバックのポートを取得できませんでした。'));
          resolve({ code, redirectUri: `http://127.0.0.1:${address.port}/oauth2/callback` });
        } catch (error) {
          server.close();
          reject(error);
        }
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (!address || typeof address === 'string') return reject(new Error('OAuthサーバーを開始できませんでした。'));
        const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: this.buildScopes(capabilities),
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        });
        await shell.openExternal(`${AUTH_URL}?${params.toString()}`);
      });
      setTimeout(() => {
        server.close();
        reject(new Error('Google認証がタイムアウトしました。'));
      }, 180_000).unref();
    });

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        code: result.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: result.redirectUri,
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Googleトークン取得に失敗しました (${tokenResponse.status})`);
    const tokenJson = await tokenResponse.json() as any;
    const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    }).then((response) => response.ok ? response.json() : {}).catch(() => ({})) as any;
    const previousTokens = await this.readTokens();
    if (previousTokens?.email && userInfo.email && previousTokens.email !== userInfo.email) {
      await this.writeConfig({ driveChangeToken: undefined, driveLastSyncedAt: undefined });
    }
    await this.writeTokens({
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt: Date.now() + Number(tokenJson.expires_in || 3600) * 1000 - 60_000,
      scope: tokenJson.scope,
      tokenType: tokenJson.token_type,
      email: userInfo.email,
    });
    return this.getStatus();
  }

  async listSharedDrives(): Promise<Array<{ id: string; name: string }>> {
    const token = await this.getAccessToken();
    const response = await fetch(`${DRIVE_API}/drives?pageSize=100&fields=drives(id,name)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`共有ドライブ一覧を取得できませんでした (${response.status})`);
    return ((await response.json()) as any).drives || [];
  }

  async searchFiles(query: string, driveId?: string): Promise<GoogleDriveFile[]> {
    const token = await this.getAccessToken();
    const qParts = ['trashed = false'];
    const normalized = String(query || '').trim();
    if (normalized) qParts.push(`name contains '${escapeDriveQuery(normalized)}'`);
    const params = new URLSearchParams({
      q: qParts.join(' and '),
      pageSize: '100',
      orderBy: 'modifiedTime desc',
      spaces: 'drive',
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,thumbnailLink,driveId,parents,owners(displayName,emailAddress))',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (driveId) {
      params.set('corpora', 'drive');
      params.set('driveId', driveId);
    } else {
      params.set('corpora', 'allDrives');
    }
    const response = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Google Drive検索に失敗しました (${response.status}) ${detail.slice(0, 180)}`);
    }
    return ((await response.json()) as any).files || [];
  }

  async getDriveFileContent(fileId: string): Promise<GoogleDriveContent> {
    const token = await this.getAccessToken();
    const normalizedId = String(fileId || '').trim();
    if (!normalizedId) throw new Error('Google DriveのファイルIDがありません。');
    const metaResponse = await fetch(`${DRIVE_API}/files/${encodeURIComponent(normalizedId)}?fields=id,name,mimeType,size&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaResponse.ok) throw new Error(`Driveファイル情報を取得できませんでした (${metaResponse.status})`);
    const meta = await metaResponse.json() as any;
    const mimeType = String(meta.mimeType || '');
    let url = '';
    if (mimeType === 'application/vnd.google-apps.document') {
      url = `${DRIVE_API}/files/${encodeURIComponent(normalizedId)}/export?mimeType=${encodeURIComponent('text/plain')}`;
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      url = `${DRIVE_API}/files/${encodeURIComponent(normalizedId)}/export?mimeType=${encodeURIComponent('text/csv')}`;
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      url = `${DRIVE_API}/files/${encodeURIComponent(normalizedId)}/export?mimeType=${encodeURIComponent('text/plain')}`;
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
      if (Number(meta.size || 0) > 2 * 1024 * 1024) throw new Error('2MBを超えるテキストファイルは本文取得対象外です。');
      url = `${DRIVE_API}/files/${encodeURIComponent(normalizedId)}?alt=media&supportsAllDrives=true`;
    } else {
      throw new Error('このファイル形式は本文取得に対応していません。Google Docs・Sheets・Slides・テキストを利用してください。');
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Drive本文を取得できませんでした (${response.status})`);
    const raw = await response.text();
    const maxChars = 40_000;
    return {
      fileId: normalizedId,
      name: String(meta.name || '無題'),
      mimeType,
      content: raw.slice(0, maxChars),
      truncated: raw.length > maxChars,
    };
  }

  async listCalendars(): Promise<GoogleCalendarListEntry[]> {
    const token = await this.getAccessToken();
    this.assertCalendarScope(await this.readTokens());
    const response = await fetch(`${CALENDAR_API}/users/me/calendarList?maxResults=250&showHidden=false`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Calendar一覧を取得できませんでした (${response.status})`);
    const json = await response.json() as any;
    return (json.items || []).map((item: any) => ({
      id: String(item.id),
      summary: String(item.summaryOverride || item.summary || item.id),
      primary: Boolean(item.primary),
      accessRole: item.accessRole,
      backgroundColor: item.backgroundColor,
    }));
  }

  async listCalendarEvents(calendarId: string, timeMin: string, timeMax: string): Promise<GoogleCalendarEvent[]> {
    const token = await this.getAccessToken();
    this.assertCalendarScope(await this.readTokens());
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    const response = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId || 'primary')}/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Calendar予定を取得できませんでした (${response.status})`);
    const json = await response.json() as any;
    return (json.items || []).map((item: any) => ({
      id: String(item.id),
      calendarId: calendarId || 'primary',
      summary: String(item.summary || '無題の予定'),
      description: item.description,
      location: item.location,
      htmlLink: item.htmlLink,
      status: item.status,
      start: item.start || {},
      end: item.end || {},
      attendees: item.attendees,
      organizer: item.organizer,
      updated: item.updated,
    }));
  }

  async searchGmailMessages(query: string): Promise<GoogleGmailMessage[]> {
    const token = await this.getAccessToken();
    this.assertGmailScope(await this.readTokens(), false);
    const params = new URLSearchParams({ maxResults: '50' });
    const normalized = String(query || '').trim();
    if (normalized) params.set('q', normalized);
    const listResponse = await fetch(`${GMAIL_API}/users/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listResponse.ok) throw new Error(`Gmail検索に失敗しました (${listResponse.status})`);
    const listed = await listResponse.json() as any;
    const ids = (listed.messages || []).slice(0, 50) as Array<{ id: string }>;
    const messages: GoogleGmailMessage[] = [];
    for (let index = 0; index < ids.length; index += 6) {
      const batch = ids.slice(index, index + 6);
      const loaded = await Promise.all(batch.map(({ id }) => this.getGmailMessage(token, id)));
      messages.push(...loaded);
    }
    return messages;
  }

  async createGmailDraft(input: GoogleGmailDraftInput): Promise<{ id: string; messageId?: string }> {
    const token = await this.getAccessToken();
    this.assertGmailScope(await this.readTokens(), true);
    const to = String(input.to || '').trim();
    const subject = String(input.subject || '').trim();
    const body = String(input.body || '');
    if (!to) throw new Error('宛先を入力してください。');
    if (!subject) throw new Error('件名を入力してください。');

    let threadId: string | undefined;
    let replyHeaders = '';
    if (input.replyToMessageId) {
      const original = await this.getGmailMessage(token, input.replyToMessageId);
      threadId = original.threadId;
      if (original.messageId) {
        const refs = [original.references, original.messageId].filter(Boolean).join(' ');
        replyHeaders = `In-Reply-To: ${original.messageId}\r\nReferences: ${refs}\r\n`;
      }
    }
    const mime = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      replyHeaders.trimEnd(),
      '',
      body,
    ].filter((line, index, lines) => !(line === '' && index > 0 && lines[index - 1] === '')).join('\r\n');
    const raw = base64Url(Buffer.from(mime, 'utf8'));
    const response = await fetch(`${GMAIL_API}/users/me/drafts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gmail下書きを作成できませんでした (${response.status}) ${detail.slice(0, 180)}`);
    }
    const json = await response.json() as any;
    return { id: String(json.id || ''), messageId: json.message?.id };
  }

  private async getGmailMessage(token: string, id: string): Promise<GoogleGmailMessage> {
    const params = new URLSearchParams({ format: 'full' });
    const response = await fetch(`${GMAIL_API}/users/me/messages/${encodeURIComponent(id)}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Gmailメッセージを取得できませんでした (${response.status})`);
    const item = await response.json() as any;
    const headers = new Map<string, string>((item.payload?.headers || []).map((header: any) => [String(header.name || '').toLowerCase(), String(header.value || '')]));
    const attachments: GoogleGmailAttachment[] = [];
    const visit = (part: any) => {
      if (part?.filename && part?.body) attachments.push({
        attachmentId: part.body.attachmentId,
        filename: String(part.filename),
        mimeType: part.mimeType,
        size: Number(part.body.size || 0),
      });
      for (const child of part?.parts || []) visit(child);
    };
    visit(item.payload);
    return {
      id: String(item.id),
      threadId: String(item.threadId || item.id),
      subject: headers.get('subject') || '件名なし',
      from: headers.get('from'),
      to: headers.get('to'),
      date: headers.get('date'),
      messageId: headers.get('message-id'),
      references: headers.get('references'),
      snippet: item.snippet,
      internalDate: item.internalDate,
      labelIds: item.labelIds,
      attachments,
    };
  }

  async listDriveChanges(pageToken?: string): Promise<{ changes: GoogleDriveChange[]; nextPageToken?: string; newStartPageToken?: string }> {
    const token = await this.getAccessToken();
    let tokenToUse = String(pageToken || '').trim();
    if (!tokenToUse) {
      const startResponse = await fetch(`${DRIVE_API}/changes/startPageToken?supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!startResponse.ok) throw new Error(`Drive差分同期トークンを取得できませんでした (${startResponse.status})`);
      const start = await startResponse.json() as any;
      return { changes: [], newStartPageToken: String(start.startPageToken || '') };
    }
    const params = new URLSearchParams({
      pageToken: tokenToUse,
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      fields: 'changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,thumbnailLink,driveId,parents,owners(displayName,emailAddress))),nextPageToken,newStartPageToken',
    });
    const response = await fetch(`${DRIVE_API}/changes?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Google Drive差分同期に失敗しました (${response.status})`);
    const json = await response.json() as any;
    return {
      changes: (json.changes || []) as GoogleDriveChange[],
      nextPageToken: json.nextPageToken,
      newStartPageToken: json.newStartPageToken,
    };
  }


  async syncDriveChanges(): Promise<{ changes: GoogleDriveChange[]; initialized: boolean; syncedAt: number }> {
    const config = await this.readConfig();
    let pageToken = config.driveChangeToken;
    const changes: GoogleDriveChange[] = [];

    for (let page = 0; page < 20; page += 1) {
      let result: Awaited<ReturnType<GoogleWorkspaceService['listDriveChanges']>>;
      try {
        result = await this.listDriveChanges(pageToken);
      } catch (error) {
        if (pageToken && error instanceof Error && error.message.includes('(410)')) {
          pageToken = undefined;
          result = await this.listDriveChanges(undefined);
        } else {
          throw error;
        }
      }
      changes.push(...result.changes);
      if (result.nextPageToken) {
        pageToken = result.nextPageToken;
        continue;
      }
      pageToken = result.newStartPageToken || pageToken;
      break;
    }

    const syncedAt = Date.now();
    await this.writeConfig({ driveChangeToken: pageToken, driveLastSyncedAt: syncedAt });
    return { changes, initialized: !config.driveChangeToken, syncedAt };
  }

  async createGoogleDoc(input: { title: string; content: string }): Promise<{ id: string; title: string; webViewLink: string }> {
    const token = await this.getAccessToken();
    this.assertScope(await this.readTokens(), DOCS_SCOPE, 'Google Docs');
    const title = String(input.title || '').trim() || 'Local Notion Lite 書き出し';
    const createResponse = await fetch(`${DOCS_API}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!createResponse.ok) throw new Error(`Google Docsを作成できませんでした (${createResponse.status})`);
    const created = await createResponse.json() as any;
    const documentId = String(created.documentId || '');
    const content = String(input.content || '').replace(/\r\n/g, '\n');
    if (content) {
      const updateResponse = await fetch(`${DOCS_API}/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
      });
      if (!updateResponse.ok) throw new Error(`Google Docsへ本文を書き込めませんでした (${updateResponse.status})`);
    }
    return { id: documentId, title, webViewLink: `https://docs.google.com/document/d/${documentId}/edit` };
  }

  async createGoogleSheet(input: { title: string; rows: Array<Array<string | number | boolean | null>> }): Promise<{ id: string; title: string; webViewLink: string }> {
    const token = await this.getAccessToken();
    this.assertScope(await this.readTokens(), SHEETS_SCOPE, 'Google Sheets');
    const title = String(input.title || '').trim() || 'Local Notion Lite 書き出し';
    const createResponse = await fetch(`${SHEETS_API}/spreadsheets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { title } }),
    });
    if (!createResponse.ok) throw new Error(`Google Sheetsを作成できませんでした (${createResponse.status})`);
    const created = await createResponse.json() as any;
    const spreadsheetId = String(created.spreadsheetId || '');
    const rows = Array.isArray(input.rows) ? input.rows : [];
    if (rows.length) {
      const range = encodeURIComponent('Sheet1!A1');
      const valuesResponse = await fetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ majorDimension: 'ROWS', values: rows }),
      });
      if (!valuesResponse.ok) throw new Error(`Google Sheetsへデータを書き込めませんでした (${valuesResponse.status})`);
    }
    return { id: spreadsheetId, title, webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
  }

  private assertGmailScope(tokens: StoredTokens | null, compose: boolean): void {
    const required = compose ? GMAIL_COMPOSE_SCOPE : GMAIL_READONLY_SCOPE;
    if (!tokens?.scope?.includes(required)) {
      throw new Error('Gmailを使うには、Google Workspaceを一度切断して再接続してください。');
    }
  }

  private buildScopes(capabilities: GoogleWorkspaceCapability[]): string {
    const requested = new Set<GoogleWorkspaceCapability>(['drive', ...capabilities]);
    const scopes = [USERINFO_SCOPE, DRIVE_READONLY_SCOPE];
    if (requested.has('calendar')) scopes.push(CALENDAR_READONLY_SCOPE);
    if (requested.has('gmail')) scopes.push(GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE);
    if (requested.has('docs')) scopes.push(DOCS_SCOPE);
    if (requested.has('sheets')) scopes.push(SHEETS_SCOPE);
    return scopes.join(' ');
  }

  private assertScope(tokens: StoredTokens | null, required: string, label: string): void {
    if (!tokens?.scope?.includes(required)) {
      throw new Error(`${label}を使うには、Google Workspaceを一度切断して再接続してください。`);
    }
  }

  private assertCalendarScope(tokens: StoredTokens | null): void {
    if (!tokens?.scope?.includes(CALENDAR_READONLY_SCOPE)) {
      throw new Error('Google Calendarを使うには、Google Workspaceを一度切断して再接続してください。');
    }
  }

  private async getAccessToken(): Promise<string> {
    const tokens = await this.readTokens();
    if (!tokens) throw new Error('Google Workspaceへ接続してください。');
    if (tokens.accessToken && tokens.expiresAt > Date.now()) return tokens.accessToken;
    if (!tokens.refreshToken) throw new Error('Google認証の有効期限が切れています。再接続してください。');
    const { clientId } = await this.readConfig();
    if (!clientId) throw new Error('Google OAuthクライアントIDが設定されていません。');
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) throw new Error('Googleアクセストークンを更新できませんでした。');
    const json = await response.json() as any;
    const next = {
      ...tokens,
      accessToken: json.access_token,
      expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 - 60_000,
      scope: json.scope || tokens.scope,
      tokenType: json.token_type || tokens.tokenType,
    };
    await this.writeTokens(next);
    return next.accessToken;
  }

  private async readConfig(): Promise<GoogleWorkspaceConfig> {
    return fs.readJson(this.configPath).catch(() => ({}));
  }

  private async writeConfig(patch: Partial<GoogleWorkspaceConfig>): Promise<void> {
    const current = await this.readConfig();
    const next: GoogleWorkspaceConfig = { ...current, ...patch };
    for (const key of Object.keys(next) as Array<keyof GoogleWorkspaceConfig>) {
      if (next[key] === undefined) delete next[key];
    }
    await fs.ensureDir(path.dirname(this.configPath));
    await fs.writeJson(this.configPath, next, { spaces: 2 });
  }

  private async writeTokens(tokens: StoredTokens): Promise<void> {
    const plain = Buffer.from(JSON.stringify(tokens), 'utf8');
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(plain.toString('utf8'))
      : plain;
    await fs.ensureDir(path.dirname(this.tokenPath));
    await fs.writeFile(this.tokenPath, payload);
  }

  private async readTokens(): Promise<StoredTokens | null> {
    const payload = await fs.readFile(this.tokenPath).catch(() => null);
    if (!payload) return null;
    try {
      const text = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(payload)
        : payload.toString('utf8');
      return JSON.parse(text) as StoredTokens;
    } catch {
      return null;
    }
  }
}
