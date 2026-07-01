import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import fs from 'fs-extra';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { startLocalApi, type ServerHandle } from '../server/app';
import { atomicWriteJson } from '../server/utils/atomicWrite';
import { normalizeExternalHttpUrl } from '../shared/externalUrlPolicy';

let mainWindow: BrowserWindow | null = null;
let api: ServerHandle | null = null;
let isQuitting = false;
let allowWindowClose = false;
type BootstrapPayload = {
  apiUrl: string;
  apiToken?: string;
  sharedRoot: string;
  localDbPath?: string;
  privatePagesRoot?: string;
  privateDatabasesRoot?: string;
  ocrBinaryPath?: string;
  popplerBinaryPath?: string;
};
let bootstrapPayload: BootstrapPayload | null = null;

/**
 * Electron exposes separate overloads for owned and unowned dialogs.  Passing
 * `undefined` as an owner does not satisfy either overload under strict TS.
 */
async function showAppOpenDialog(options: OpenDialogOptions) {
  const owner = mainWindow;
  if (owner && !owner.isDestroyed()) {
    return dialog.showOpenDialog(owner, options);
  }
  return dialog.showOpenDialog(options);
}

/**
 * BlockNote internal resource links can be serialized either as legacy custom
 * protocols or as normal URLs whose hash carries a local resource target.
 * They must never reach Electron's external-browser path.
 */
function isInternalLocalNotionUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  if (/^(?:local-page|local-dbrow|local-database):\/\//i.test(value)) return true;
  return /#local-(?:page|dbrow|database)=/i.test(value);
}

async function openExternalHttpUrl(rawUrl: string): Promise<boolean> {
  // Defense in depth: even if a renderer click handler misses an internal
  // BlockNote link, never delegate it to the operating system browser.
  if (isInternalLocalNotionUrl(rawUrl)) return false;
  const url = normalizeExternalHttpUrl(rawUrl);
  if (!url) return false;
  await shell.openExternal(url);
  return true;
}

async function flushRendererSavesBeforeQuit(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const requestId = `quit-flush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, 5_000);
    function done() {
      clearTimeout(timeout);
      ipcMain.removeListener('app:save-flush-complete', onComplete);
      resolve();
    }
    function onComplete(_event: any, completedRequestId: string) {
      if (completedRequestId === requestId) done();
    }
    ipcMain.on('app:save-flush-complete', onComplete);
    mainWindow?.webContents.send('app:before-quit-flush', requestId);
  });
}

// All quit paths (menu Quit, Alt+F4, and the window × button) must pass through
// the renderer flush before closing the local API/SQLite connection.
async function shutdownApplication(): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;
  await flushRendererSavesBeforeQuit().catch(() => undefined);
  const currentApi = api;
  api = null;
  await currentApi?.close().catch(() => undefined);
  allowWindowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  app.quit();
}

// v372: A second Electron process on the same PC was able to open the same
// shared workspace and create self-conflicts. Keep exactly one writer process.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

type AppBootSettings = {
  sharedRoot?: string;
  localDbPath?: string;
  sqliteMode?: 'auto' | 'custom';
  privatePagesRoot?: string;
  privateDatabasesRoot?: string;
  ocrBinaryPath?: string;
  popplerBinaryPath?: string;
};

async function readSettings(): Promise<AppBootSettings> {
  return fs.readJson(settingsPath()).catch(() => ({}));
}

async function writeSettings(patch: Partial<AppBootSettings>): Promise<void> {
  await fs.ensureDir(path.dirname(settingsPath()));
  const current = await readSettings();
  await atomicWriteJson(settingsPath(), { ...current, ...patch }, 'main-settings');
}

async function chooseSharedRoot(): Promise<string> {
  const current = await readSettings();
  if (current.sharedRoot && await fs.pathExists(current.sharedRoot)) return current.sharedRoot;
  const result = await dialog.showOpenDialog({ title: '社内共有フォルダを選択してください', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) throw new Error('Shared folder was not selected.');
  await writeSettings({ sharedRoot: result.filePaths[0] });
  return result.filePaths[0];
}


async function chooseLocalDbPathAtStartup(): Promise<string | undefined> {
  const current = await readSettings();
  if (current.sqliteMode === 'custom' && current.localDbPath && await fs.pathExists(path.dirname(current.localDbPath))) {
    return current.localDbPath;
  }
  if (current.sqliteMode === 'auto') return undefined;

  const answer = await dialog.showMessageBox({
    type: 'question',
    title: 'SQLite保存先',
    message: 'SQLiteキャッシュの保存先を選択しますか？',
    detail: '通常は自動保存で問題ありません。職場PCでAppData等が使えない場合は、任意のフォルダを選択してください。',
    buttons: ['自動で使う', '保存先を選択'],
    defaultId: 0,
    cancelId: 0
  });

  if (answer.response !== 1) {
    await writeSettings({ sqliteMode: 'auto', localDbPath: undefined });
    return undefined;
  }

  return chooseLocalDbPath();
}

async function chooseLocalDbPath(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title: 'SQLite保存先フォルダを選択してください',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const localDbPath = path.join(result.filePaths[0], 'local.sqlite');
  await fs.ensureDir(path.dirname(localDbPath));
  await writeSettings({ sqliteMode: 'custom', localDbPath });
  return localDbPath;
}

async function createWindow(): Promise<void> {
  const sharedRoot = await chooseSharedRoot();
  const localDbPath = await chooseLocalDbPathAtStartup();
  const bootSettings = await readSettings();
  if (bootSettings.ocrBinaryPath && await fs.pathExists(bootSettings.ocrBinaryPath)) {
    process.env.LOCAL_NOTION_OCR_BINARY = bootSettings.ocrBinaryPath;
  } else {
    delete process.env.LOCAL_NOTION_OCR_BINARY;
  }
  if (bootSettings.popplerBinaryPath && await fs.pathExists(bootSettings.popplerBinaryPath)) {
    const ext = path.extname(bootSettings.popplerBinaryPath);
    const dir = path.dirname(bootSettings.popplerBinaryPath);
    process.env.LOCAL_NOTION_PDFTOTEXT_BINARY = bootSettings.popplerBinaryPath;
    process.env.LOCAL_NOTION_PDFINFO_BINARY = path.join(dir, `pdfinfo${ext}`);
    process.env.LOCAL_NOTION_PDFTOPPM_BINARY = path.join(dir, `pdftoppm${ext}`);
  } else {
    delete process.env.LOCAL_NOTION_PDFTOTEXT_BINARY;
    delete process.env.LOCAL_NOTION_PDFINFO_BINARY;
    delete process.env.LOCAL_NOTION_PDFTOPPM_BINARY;
  }
  api = await startLocalApi(sharedRoot, localDbPath, {
    privatePagesRoot: bootSettings.privatePagesRoot,
    privateDatabasesRoot: bootSettings.privateDatabasesRoot
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      // Explicitly keep Node APIs out of renderer pages. sandbox remains disabled
      // because the current BlockNote/preload integration depends on it; revisit
      // after editor integration tests cover sandbox: true.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  function isAttachmentUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.pathname.includes('/attachments/') &&
        (parsed.pathname.endsWith('/file') || parsed.pathname.endsWith('/download') || parsed.pathname.includes('/name/'));
    } catch {
      return false;
    }
  }

  function toAttachmentDownloadUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/file') || parsed.pathname.includes('/name/')) parsed.searchParams.set('download', '1');
      // The renderer persists BlockNote blocks, and older blocks can contain the
      // previous run's ephemeral localhost port. Always rebase attachment routes
      // to the API instance that belongs to this Electron process.
      if (api && (/^\/pages\/[^/]+\/attachments\//.test(parsed.pathname) || /^\/databases\/[^/]+\/rows\/[^/]+\/attachments\//.test(parsed.pathname))) {
        return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, api.url).toString();
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function startAttachmentDownload(url: string): void {
    const target = toAttachmentDownloadUrl(url);
    mainWindow?.webContents.downloadURL(target);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Internal BlockNote resource links are handled inside the renderer.
    // Never open them as a new Electron window or send them to the browser.
    if (isInternalLocalNotionUrl(url)) return { action: 'deny' };

    // BlockNote's built-in file block may try to open the file URL in a new window
    // when the user clicks its "download" action. Convert that navigation to an
    // Electron download instead of denying it silently.
    if (isAttachmentUrl(url)) {
      startAttachmentDownload(url);
      return { action: 'deny' };
    }

    // Never embed arbitrary websites in Electron. Open validated http(s) links
    // in the user's default browser instead.
    if (normalizeExternalHttpUrl(url)) {
      void openExternalHttpUrl(url).catch(() => undefined);
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Prevent BlockNote internal resource links from navigating the whole BrowserWindow.
    if (isInternalLocalNotionUrl(url)) {
      event.preventDefault();
      return;
    }

    // If BlockNote opens an attachment URL in the current window, turn it into a
    // real download and keep the app on the current page.
    if (isAttachmentUrl(url)) {
      event.preventDefault();
      startAttachmentDownload(url);
      return;
    }

    if (normalizeExternalHttpUrl(url)) {
      event.preventDefault();
      void openExternalHttpUrl(url).catch(() => undefined);
    }
  });

  const readySettings = await readSettings().catch((): AppBootSettings => ({}));
  const activeOcrBinaryPath = readySettings.ocrBinaryPath && await fs.pathExists(readySettings.ocrBinaryPath)
    ? readySettings.ocrBinaryPath
    : undefined;
  const activePopplerBinaryPath = readySettings.popplerBinaryPath && await fs.pathExists(readySettings.popplerBinaryPath)
    ? readySettings.popplerBinaryPath
    : undefined;
  bootstrapPayload = {
    apiUrl: api.url,
    apiToken: api.apiToken,
    sharedRoot,
    localDbPath,
    privatePagesRoot: readySettings.privatePagesRoot,
    privateDatabasesRoot: readySettings.privateDatabasesRoot,
    ocrBinaryPath: activeOcrBinaryPath,
    popplerBinaryPath: activePopplerBinaryPath
  };

  // Kept for compatibility with an already-open renderer, but the renderer now
  // obtains the authoritative payload through app:getBootstrap as well.
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('app:ready', bootstrapPayload);
  });

  mainWindow.on('close', (event) => {
    if (allowWindowClose || isQuitting) return;
    event.preventDefault();
    void shutdownApplication();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  electronApp.setAppUserModelId('jp.local.notionlite');
  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void shutdownApplication();
  });
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window));

  ipcMain.handle('app:getBootstrap', async () => bootstrapPayload);

  ipcMain.handle('app:openExternalHttpUrl', async (_event, rawUrl: string) => {
    return openExternalHttpUrl(rawUrl).catch(() => false);
  });

  ipcMain.handle('settings:chooseSharedRoot', async () => {
    const result = await dialog.showOpenDialog({ title: '社内共有フォルダを選択してください', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    await writeSettings({ sharedRoot: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseLocalDbPath', async () => {
    const selected = await chooseLocalDbPath();
    return selected ?? null;
  });

  ipcMain.handle('settings:useAutoLocalDbPath', async () => {
    await writeSettings({ sqliteMode: 'auto', localDbPath: undefined });
    return true;
  });


  ipcMain.handle('settings:choosePrivatePagesRoot', async () => {
    const result = await dialog.showOpenDialog({ title: 'Privateページ保存先フォルダを選択してください', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    await fs.ensureDir(result.filePaths[0]);
    await writeSettings({ privatePagesRoot: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle('settings:choosePrivateDatabasesRoot', async () => {
    const result = await dialog.showOpenDialog({ title: 'Private DB保存先フォルダを選択してください', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    await fs.ensureDir(result.filePaths[0]);
    await writeSettings({ privateDatabasesRoot: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseTransformerModelRoot', async () => {
    const result = await dialog.showOpenDialog({
      title: 'AIモデル保存先フォルダを選択してください',
      message: 'Xenova / sirasagi62 / onnx-community などの提供者フォルダの親フォルダを選択してください。',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await fs.ensureDir(result.filePaths[0]);
    return result.filePaths[0];
  });



  ipcMain.handle('settings:chooseSemanticCacheDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '検索AIローカルキャッシュ保存先フォルダを選択してください',
      message: '各PCのローカルフォルダを推奨します。共有フォルダを使う場合はPCごとに別フォルダを指定してください。',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await fs.ensureDir(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseGenerationModelRoot', async () => {
    const result = await dialog.showOpenDialog({
      title: '生成AIモデルフォルダを選択してください',
      message: 'Qwen2.5 1.5B/3B などの .gguf ファイルを置いたフォルダを選択してください。',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await fs.ensureDir(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseGenerationExecutable', async () => {
    const result = await dialog.showOpenDialog({
      title: 'llama.cpp 実行ファイルを選択してください',
      message: 'v298以降は通常、llamaフォルダ選択を使います。手動指定する場合だけ選択してください。',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseGenerationRuntimeDir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'llama.cppを解凍したフォルダを選択してください',
      message: 'llama-cli / llama-cli.exe と同梱ライブラリ（.dylib / .dll）が入っているフォルダを、構成を崩さず選択してください。',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('settings:chooseOcrBinary', async () => {
    const result = await showAppOpenDialog({
      title: 'Tesseract OCR 実行ファイルを選択してください',
      message: 'tesseract.exe を選択してください。選択した場所はこのPCだけに保存されます。',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Tesseract executable', extensions: ['exe'] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    if (!(await fs.pathExists(selected))) throw new Error('選択したOCR実行ファイルが見つかりません。');
    await writeSettings({ ocrBinaryPath: selected });
    process.env.LOCAL_NOTION_OCR_BINARY = selected;
    if (bootstrapPayload) bootstrapPayload.ocrBinaryPath = selected;
    return selected;
  });

  ipcMain.handle('settings:resetOcrBinary', async () => {
    await writeSettings({ ocrBinaryPath: undefined });
    delete process.env.LOCAL_NOTION_OCR_BINARY;
    if (bootstrapPayload) bootstrapPayload.ocrBinaryPath = undefined;
    return true;
  });


  type PopplerPaths = { binDirectory: string; pdftotextPath: string; pdfinfoPath: string; pdftoppmPath: string };

  async function findPopplerPaths(selectedDirectory: string): Promise<PopplerPaths | null> {
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const queue: Array<{ directory: string; depth: number }> = [{ directory: selectedDirectory, depth: 0 }];
    const visited = new Set<string>();
    const maxDepth = 5;
    const maxDirectories = 500;

    while (queue.length > 0 && visited.size < maxDirectories) {
      const current = queue.shift();
      if (!current) break;
      const resolved = path.resolve(current.directory);
      if (visited.has(resolved)) continue;
      visited.add(resolved);

      const pdftotextPath = path.join(resolved, `pdftotext${suffix}`);
      const pdfinfoPath = path.join(resolved, `pdfinfo${suffix}`);
      const pdftoppmPath = path.join(resolved, `pdftoppm${suffix}`);
      if (await fs.pathExists(pdftotextPath) && await fs.pathExists(pdfinfoPath) && await fs.pathExists(pdftoppmPath)) {
        return { binDirectory: resolved, pdftotextPath, pdfinfoPath, pdftoppmPath };
      }

      if (current.depth >= maxDepth) continue;
      const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => [] as any[]);
      for (const entry of entries) {
        if (!entry?.isDirectory?.()) continue;
        // Do not walk into directories that cannot contain unpacked Poppler binaries.
        if (['node_modules', '.git', '.svn', '__MACOSX'].includes(entry.name)) continue;
        queue.push({ directory: path.join(resolved, entry.name), depth: current.depth + 1 });
      }
    }

    return null;
  }

  async function configurePopplerFromDirectory(selectedDirectory: string): Promise<string> {
    const found = await findPopplerPaths(selectedDirectory);
    if (!found) {
      throw new Error(`「${selectedDirectory}」内に必要なPopplerファイルが見つかりません。pdftotext・pdfinfo・pdftoppm が入った解凍済みフォルダを選択してください。`);
    }

    await writeSettings({ popplerBinaryPath: found.pdftotextPath });
    process.env.LOCAL_NOTION_PDFTOTEXT_BINARY = found.pdftotextPath;
    process.env.LOCAL_NOTION_PDFINFO_BINARY = found.pdfinfoPath;
    process.env.LOCAL_NOTION_PDFTOPPM_BINARY = found.pdftoppmPath;
    if (bootstrapPayload) bootstrapPayload.popplerBinaryPath = found.pdftotextPath;
    return found.pdftotextPath;
  }

  ipcMain.handle('settings:choosePopplerFolder', async () => {
    const result = await showAppOpenDialog({
      title: 'Popplerを解凍したフォルダを選択してください',
      message: '解凍先・bin・Library/binのどれを選んでも、配下を自動検索して必要な3ファイルを見つけます。',
      buttonLabel: 'このフォルダを使用',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return configurePopplerFromDirectory(result.filePaths[0]);
  });

  ipcMain.handle('settings:choosePopplerBinary', async () => {
    const result = await showAppOpenDialog({
      title: 'pdftotext 実行ファイルを選択してください',
      message: 'Popplerに含まれる pdftotext を選択してください。同じフォルダの pdfinfo と pdftoppm も自動使用します。',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'pdftotext executable', extensions: ['exe'] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (!(await fs.pathExists(result.filePaths[0]))) throw new Error('選択した pdftotext 実行ファイルが見つかりません。');
    return configurePopplerFromDirectory(path.dirname(result.filePaths[0]));
  });

  ipcMain.handle('settings:resetPopplerBinary', async () => {
    await writeSettings({ popplerBinaryPath: undefined });
    delete process.env.LOCAL_NOTION_PDFTOTEXT_BINARY;
    delete process.env.LOCAL_NOTION_PDFINFO_BINARY;
    delete process.env.LOCAL_NOTION_PDFTOPPM_BINARY;
    if (bootstrapPayload) bootstrapPayload.popplerBinaryPath = undefined;
    return true;
  });

  ipcMain.handle('settings:resetPrivatePagesRoot', async () => {
    await writeSettings({ privatePagesRoot: undefined });
    return true;
  });

  ipcMain.handle('settings:resetPrivateDatabasesRoot', async () => {
    await writeSettings({ privateDatabasesRoot: undefined });
    return true;
  });

  ipcMain.handle('files:chooseAttachment', async () => {
    const result = await dialog.showOpenDialog({ title: '添付ファイルを選択してください', properties: ['openFile', 'multiSelections'] });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  await createWindow();
}).catch((error) => {
  // Do not leave startup failures as an unhandled rejection: Electron otherwise
  // emits only a generic warning without the originating stack.
  console.error('[main] application startup failed', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // shutdownApplication already closed API/SQLite. This only covers an unexpected
  // window destruction path where no explicit quit was requested.
  if (!isQuitting) void shutdownApplication().catch((error) => {
    console.error("[main] unexpected shutdown failure", error);
  });
});
