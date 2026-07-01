import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('localNotion', {
  getBootstrap: () => ipcRenderer.invoke('app:getBootstrap'),
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
  onBeforeQuit: (callback: (requestId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string) => callback(requestId);
    ipcRenderer.on('app:before-quit-flush', listener);
    return () => ipcRenderer.removeListener('app:before-quit-flush', listener);
  },
  notifySaveFlushComplete: (requestId: string) => ipcRenderer.send('app:save-flush-complete', requestId)
});
