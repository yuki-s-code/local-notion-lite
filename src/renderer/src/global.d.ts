export {};

declare global {
  interface Window {
    localNotion: {
      getBootstrap: () => Promise<{ apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string } | null>;
      getStartupProgress: () => Promise<{ stage: string; title?: string; message: string; detail?: string } | null>;
      onStartupProgress: (callback: (progress: { stage: string; title?: string; message: string; detail?: string }) => void) => () => void;
      onReady: (callback: (payload: { apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string }) => void) => () => void;
      chooseSharedRoot: () => Promise<string | null>;
      chooseLocalDbPath: () => Promise<string | null>;
      useAutoLocalDbPath: () => Promise<boolean>;
      choosePrivatePagesRoot: () => Promise<string | null>;
      choosePrivateDatabasesRoot: () => Promise<string | null>;
      chooseTransformerModelRoot: () => Promise<string | null>;
      chooseGenerationModelRoot: () => Promise<string | null>;
      chooseSemanticCacheDir: () => Promise<string | null>;
      chooseGenerationExecutable: () => Promise<string | null>;
      chooseGenerationRuntimeDir: () => Promise<string | null>;
      chooseOcrBinary: () => Promise<string | null>;
      resetOcrBinary: () => Promise<boolean>;
      choosePopplerFolder: () => Promise<string | null>;
      choosePopplerBinary: () => Promise<string | null>;
      resetPopplerBinary: () => Promise<boolean>;
      resetPrivatePagesRoot: () => Promise<boolean>;
      resetPrivateDatabasesRoot: () => Promise<boolean>;
      chooseAttachment: () => Promise<string[]>;
      openExternalHttpUrl: (url: string) => Promise<boolean>;
      googleWorkspace: {
        getStatus: () => Promise<{ configured: boolean; connected: boolean; clientId?: string; email?: string; expiresAt?: number; calendarEnabled?: boolean; reconnectRequired?: boolean; gmailEnabled?: boolean; gmailComposeEnabled?: boolean; docsEnabled?: boolean; sheetsEnabled?: boolean; driveLastSyncedAt?: number }>;
        configure: (clientId: string) => Promise<{ configured: boolean; connected: boolean; clientId?: string; email?: string; expiresAt?: number; calendarEnabled?: boolean; reconnectRequired?: boolean; gmailEnabled?: boolean; gmailComposeEnabled?: boolean; docsEnabled?: boolean; sheetsEnabled?: boolean; driveLastSyncedAt?: number }>;
        connect: (capabilities?: Array<'drive' | 'calendar' | 'gmail' | 'docs' | 'sheets'>) => Promise<{ configured: boolean; connected: boolean; clientId?: string; email?: string; expiresAt?: number; calendarEnabled?: boolean; reconnectRequired?: boolean; gmailEnabled?: boolean; gmailComposeEnabled?: boolean; docsEnabled?: boolean; sheetsEnabled?: boolean; driveLastSyncedAt?: number }>;
        disconnect: () => Promise<{ configured: boolean; connected: boolean; clientId?: string; email?: string; expiresAt?: number; calendarEnabled?: boolean; reconnectRequired?: boolean; gmailEnabled?: boolean; gmailComposeEnabled?: boolean; docsEnabled?: boolean; sheetsEnabled?: boolean; driveLastSyncedAt?: number }>;
        listSharedDrives: () => Promise<Array<{ id: string; name: string }>>;
        searchFiles: (query: string, driveId?: string) => Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string; iconLink?: string; thumbnailLink?: string; driveId?: string; parents?: string[]; owners?: Array<{ displayName?: string; emailAddress?: string }> }>>;
        getDriveFileContent: (fileId: string) => Promise<{ fileId: string; name: string; mimeType: string; content: string; truncated: boolean }>;
        listCalendars: () => Promise<Array<{ id: string; summary: string; primary?: boolean; accessRole?: string; backgroundColor?: string }>>;
        listCalendarEvents: (calendarId: string, timeMin: string, timeMax: string) => Promise<Array<{ id: string; calendarId: string; summary: string; description?: string; location?: string; htmlLink?: string; status?: string; start: { date?: string; dateTime?: string; timeZone?: string }; end: { date?: string; dateTime?: string; timeZone?: string }; attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>; organizer?: { email?: string; displayName?: string }; updated?: string }>>;
        searchGmailMessages: (query: string) => Promise<Array<{ id: string; threadId: string; subject: string; from?: string; to?: string; date?: string; messageId?: string; references?: string; snippet?: string; internalDate?: string; labelIds?: string[]; attachments: Array<{ attachmentId?: string; filename: string; mimeType?: string; size?: number }> }>>;
        createGmailDraft: (input: { to: string; subject: string; body: string; replyToMessageId?: string }) => Promise<{ id: string; messageId?: string }>;
        createGoogleDoc: (input: { title: string; content: string }) => Promise<{ id: string; title: string; webViewLink: string }>;
        createGoogleSheet: (input: { title: string; rows: Array<Array<string | number | boolean | null>> }) => Promise<{ id: string; title: string; webViewLink: string }>;
        syncDriveChanges: () => Promise<{ changes: Array<{ fileId: string; removed?: boolean; time?: string; file?: { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string; iconLink?: string; thumbnailLink?: string; driveId?: string; parents?: string[]; owners?: Array<{ displayName?: string; emailAddress?: string }> } }>; initialized: boolean; syncedAt: number }>;
        listDriveChanges: (pageToken?: string) => Promise<{ changes: Array<{ fileId: string; removed?: boolean; time?: string; file?: { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; webViewLink?: string; iconLink?: string; thumbnailLink?: string; driveId?: string; parents?: string[]; owners?: Array<{ displayName?: string; emailAddress?: string }> } }>; nextPageToken?: string; newStartPageToken?: string }>;
      };
      onBeforeQuit: (callback: (requestId: string) => void) => () => void;
      notifySaveFlushComplete: (requestId: string) => void;
    };
  }
}
