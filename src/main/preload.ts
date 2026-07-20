import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('localNotion', {
  getBootstrap: () => ipcRenderer.invoke('app:getBootstrap'),
  getStartupProgress: () => ipcRenderer.invoke('app:getStartupProgress'),
  onStartupProgress: (callback: (progress: { stage: string; title?: string; message: string; detail?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { stage: string; title?: string; message: string; detail?: string }) => callback(progress);
    ipcRenderer.on('app:startup-progress', listener);
    return () => ipcRenderer.removeListener('app:startup-progress', listener);
  },
  onReady: (callback: (payload: { apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string }) => callback(payload);
    ipcRenderer.on('app:ready', listener);
    return () => ipcRenderer.removeListener('app:ready', listener);
  },
  chooseSharedRoot: () => ipcRenderer.invoke('settings:chooseSharedRoot'),
  chooseLocalDbPath: () => ipcRenderer.invoke('settings:chooseLocalDbPath'),
  useAutoLocalDbPath: () => ipcRenderer.invoke('settings:useAutoLocalDbPath'),
  choosePrivatePagesRoot: () => ipcRenderer.invoke('settings:choosePrivatePagesRoot'),
  choosePrivateDatabasesRoot: () => ipcRenderer.invoke('settings:choosePrivateDatabasesRoot'),
  chooseTransformerModelRoot: () => ipcRenderer.invoke('settings:chooseTransformerModelRoot'),
  chooseGenerationModelRoot: () => ipcRenderer.invoke('settings:chooseGenerationModelRoot'),
  chooseSemanticCacheDir: () => ipcRenderer.invoke('settings:chooseSemanticCacheDir'),
  chooseGenerationExecutable: () => ipcRenderer.invoke('settings:chooseGenerationExecutable'),
  chooseGenerationRuntimeDir: () => ipcRenderer.invoke('settings:chooseGenerationRuntimeDir'),
  chooseOcrBinary: () => ipcRenderer.invoke('settings:chooseOcrBinary'),
  resetOcrBinary: () => ipcRenderer.invoke('settings:resetOcrBinary'),
  choosePopplerFolder: () => ipcRenderer.invoke('settings:choosePopplerFolder'),
  choosePopplerBinary: () => ipcRenderer.invoke('settings:choosePopplerBinary'),
  resetPopplerBinary: () => ipcRenderer.invoke('settings:resetPopplerBinary'),
  resetPrivatePagesRoot: () => ipcRenderer.invoke('settings:resetPrivatePagesRoot'),
  resetPrivateDatabasesRoot: () => ipcRenderer.invoke('settings:resetPrivateDatabasesRoot'),
  chooseAttachment: () => ipcRenderer.invoke('files:chooseAttachment'),
  openExternalHttpUrl: (url: string) => ipcRenderer.invoke('app:openExternalHttpUrl', url),
  googleWorkspace: {
    getStatus: () => ipcRenderer.invoke('googleWorkspace:getStatus'),
    configure: (clientId: string) => ipcRenderer.invoke('googleWorkspace:configure', clientId),
    connect: (capabilities?: Array<'drive' | 'calendar' | 'gmail' | 'docs' | 'sheets'>) => ipcRenderer.invoke('googleWorkspace:connect', capabilities),
    disconnect: () => ipcRenderer.invoke('googleWorkspace:disconnect'),
    listSharedDrives: () => ipcRenderer.invoke('googleWorkspace:listSharedDrives'),
    searchFiles: (query: string, driveId?: string) => ipcRenderer.invoke('googleWorkspace:searchFiles', query, driveId),
    getDriveFileContent: (fileId: string) => ipcRenderer.invoke('googleWorkspace:getDriveFileContent', fileId),
    listCalendars: () => ipcRenderer.invoke('googleWorkspace:listCalendars'),
    listCalendarEvents: (calendarId: string, timeMin: string, timeMax: string) => ipcRenderer.invoke('googleWorkspace:listCalendarEvents', calendarId, timeMin, timeMax),
    listDriveChanges: (pageToken?: string) => ipcRenderer.invoke('googleWorkspace:listDriveChanges', pageToken),
    syncDriveChanges: () => ipcRenderer.invoke('googleWorkspace:syncDriveChanges'),
    searchGmailMessages: (query: string) => ipcRenderer.invoke('googleWorkspace:searchGmailMessages', query),
    createGmailDraft: (input: { to: string; subject: string; body: string; replyToMessageId?: string }) => ipcRenderer.invoke('googleWorkspace:createGmailDraft', input),
    createGoogleDoc: (input: { title: string; content: string }) => ipcRenderer.invoke('googleWorkspace:createGoogleDoc', input),
    createGoogleSheet: (input: { title: string; rows: Array<Array<string | number | boolean | null>> }) => ipcRenderer.invoke('googleWorkspace:createGoogleSheet', input),
  },
  onBeforeQuit: (callback: (requestId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId);
    ipcRenderer.on('app:before-quit-flush', listener);
    return () => ipcRenderer.removeListener('app:before-quit-flush', listener);
  },
  notifySaveFlushComplete: (requestId: string) => ipcRenderer.send('app:save-flush-complete', requestId)
});
