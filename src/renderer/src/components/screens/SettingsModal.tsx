import React from 'react';
import type { HealthInfo } from '../../../../shared/types';

type AppDensity = 'comfortable' | 'compact';
type AppTheme = 'light' | 'soft';
export type AppSettings = { density: AppDensity; theme: AppTheme; autoSaveDelayMs: number; journalStart: 'today' | 'last'; commandHints: boolean };

export function SettingsModal({ open, settings, sharedRoot, privatePagesRoot, privateDatabasesRoot, ocrBinaryPath, popplerBinaryPath, health, onChange, onClose, onChooseSharedRoot, onChooseLocalDbPath, onUseAutoLocalDbPath, onChoosePrivatePagesRoot, onChoosePrivateDatabasesRoot, onResetPrivatePagesRoot, onResetPrivateDatabasesRoot, onChooseOcrBinary, onResetOcrBinary, onChoosePopplerFolder, onChoosePopplerBinary, onResetPopplerBinary, onSync }: {
  open: boolean;
  settings: AppSettings;
  sharedRoot: string;
  privatePagesRoot: string;
  privateDatabasesRoot: string;
  ocrBinaryPath: string;
  popplerBinaryPath: string;
  health: HealthInfo | null;
  onChange: (settings: AppSettings) => void;
  onClose: () => void;
  onChooseSharedRoot: () => void;
  onChooseLocalDbPath: () => void;
  onUseAutoLocalDbPath: () => void;
  onChoosePrivatePagesRoot: () => void;
  onChoosePrivateDatabasesRoot: () => void;
  onResetPrivatePagesRoot: () => void;
  onResetPrivateDatabasesRoot: () => void;
  onChooseOcrBinary: () => void;
  onResetOcrBinary: () => void;
  onChoosePopplerFolder: () => void;
  onChoosePopplerBinary: () => void;
  onResetPopplerBinary: () => void;
  onSync: () => void;
}) {
  if (!open) return null;
  const update = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });
  return (
    <div className="settings-overlay-v106" onMouseDown={onClose}>
      <section className="settings-panel-v106" onMouseDown={e => e.stopPropagation()} aria-label="設定">
        <header className="settings-header-v106">
          <div><p className="section-kicker-v61">Settings</p><h2>設定</h2><small>表示、保存、共有フォルダの基本設定をまとめて管理します。</small></div>
          <button className="icon-toolbar-button" onClick={onClose} title="閉じる" aria-label="閉じる">×</button>
        </header>
        <div className="settings-grid-v106">
          <section className="settings-card-v106">
            <h3>表示</h3>
            <label>密度<select value={settings.density} onChange={e => update({ density: e.target.value as AppDensity })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
            <label>テーマ<select value={settings.theme} onChange={e => update({ theme: e.target.value as AppTheme })}><option value="soft">Soft</option><option value="light">Light</option></select></label>
            <label className="settings-check-v106"><input type="checkbox" checked={settings.commandHints} onChange={e => update({ commandHints: e.target.checked })} /> コマンドパレットにヒントを表示</label>
          </section>
          <section className="settings-card-v106">
            <h3>保存</h3>
            <label>自動保存の間隔<select value={settings.autoSaveDelayMs} onChange={e => update({ autoSaveDelayMs: Number(e.target.value) })}><option value={650}>速い 0.65秒</option><option value={900}>標準 0.9秒</option><option value={1500}>ゆっくり 1.5秒</option></select></label>
            <label>Journalの初期表示<select value={settings.journalStart} onChange={e => update({ journalStart: e.target.value as AppSettings['journalStart'] })}><option value="today">今日</option><option value="last">最後に開いた日付</option></select></label>
          </section>
          <section className="settings-card-v106 wide">
            <h3>共有フォルダ</h3>
            <div className="settings-path-v106" title={sharedRoot}>{sharedRoot || '共有フォルダ未設定'}</div>
            <div className="settings-actions-v106"><button onClick={onChooseSharedRoot}>共有フォルダを変更</button><button onClick={onSync}>再同期</button></div>
            <div className="settings-status-v106"><span>API: {health?.ok ? 'OK' : '-'}</span><span>SQLite: {health?.sqlite?.available ? 'OK' : '-'}</span></div>
            {health?.startup && <small>起動計測: SQLite {health.startup.openLocalDbMs}ms ・ 共有フォルダ初期化 {health.startup.initVaultMs}ms ・ API {health.startup.totalMs}ms</small>}
          </section>
          <section className="settings-card-v106 wide">
            <h3>SQLite保存先</h3>
            <div className="settings-path-v106" title={health?.sqlite?.path || health?.localDbPath || ''}>{health?.sqlite?.path || health?.localDbPath || '自動選択中'}</div>
            <div className="settings-actions-v106"><button onClick={onChooseLocalDbPath}>保存先を選択</button><button onClick={onUseAutoLocalDbPath}>自動選択に戻す</button></div>
            <div className="settings-status-v106"><span>{health?.sqlite?.custom ? 'Custom' : 'Auto'}</span><span>{health?.sqlite?.fileName || 'local.sqlite'}</span></div>
            <small>変更後はアプリを再起動すると新しいSQLiteキャッシュを使用します。共有フォルダ側のJSONが正本なので、SQLiteは再構築できます。</small>
          </section>
          <section className="settings-card-v106 wide private-storage-card-v164">
            <h3>🔒 Privateページ保存先</h3>
            <p className="muted-small">BlockNoteのPrivateページだけを保存する場所です。共有フォルダには出ません。</p>
            <div className="settings-path-v106" title={privatePagesRoot || health?.privateStorage?.pagesRoot || ''}>{privatePagesRoot || health?.privateStorage?.pagesRoot || '自動：このPCのアプリデータ内'}</div>
            <div className="settings-actions-v106"><button onClick={onChoosePrivatePagesRoot}>保存先を選択</button><button onClick={onResetPrivatePagesRoot}>自動に戻す</button></div>
            <div className="settings-status-v106"><span>{privatePagesRoot || health?.privateStorage?.customPages ? 'Custom' : 'Auto'}</span><span>Private Pages</span></div>
            <small>変更後はアプリを再起動すると新しい保存先を使用します。既存Privateページは自動移動しません。</small>
          </section>
          <section className="settings-card-v106 wide private-storage-card-v164">
            <h3>🔒 Private DB保存先</h3>
            <p className="muted-small">Private DBだけを保存する場所です。個人DBをUSB・個人フォルダ・ローカル領域に分けられます。</p>
            <div className="settings-path-v106" title={privateDatabasesRoot || health?.privateStorage?.databasesRoot || ''}>{privateDatabasesRoot || health?.privateStorage?.databasesRoot || '自動：このPCのアプリデータ内'}</div>
            <div className="settings-actions-v106"><button onClick={onChoosePrivateDatabasesRoot}>保存先を選択</button><button onClick={onResetPrivateDatabasesRoot}>自動に戻す</button></div>
            <div className="settings-status-v106"><span>{privateDatabasesRoot || health?.privateStorage?.customDatabases ? 'Custom' : 'Auto'}</span><span>Private DB</span></div>
            <small>Shared DBは共有フォルダ、Private DBはここに保存されます。SharedからPrivateへのRelationは引き続きブロックされます。</small>
          </section>
          <section className="settings-card-v106 wide ocr-settings-card-v491">
            <h3>⌁ ローカルOCR</h3>
            <p className="muted-small">画像の文字抽出に使うTesseract実行ファイルです。指定しない場合は同梱版またはWindowsのPATHから自動検出します。</p>
            <div className="settings-path-v106" title={ocrBinaryPath || ''}>{ocrBinaryPath || '自動検出（同梱OCR / PATH）'}</div>
            <div className="settings-actions-v106"><button onClick={onChooseOcrBinary}>tesseract.exe を選択</button><button onClick={onResetOcrBinary} disabled={!ocrBinaryPath}>自動検出に戻す</button></div>
            <div className="settings-status-v106"><span>{ocrBinaryPath ? 'Custom' : 'Auto'}</span><span>{ocrBinaryPath ? 'このPCだけに保存' : '画像OCRを実行する時だけ起動'}</span></div>
            <small>設定後は再起動不要です。OCR実行時に選択した実行ファイルを最優先で使用します。</small>
          </section>
          <section className="settings-card-v106 wide ocr-settings-card-v491">
            <h3>▤ PDF文字抽出（Poppler）</h3>
            <p className="muted-small">スキャンPDFのページ画像化と、文字PDFの本文抽出に使います。Popplerを解凍したフォルダを選ぶと、必要な3つの実行ファイルを自動検出します。</p>
            <div className="settings-path-v106" title={popplerBinaryPath || ''}>{popplerBinaryPath || '自動検出（同梱Poppler / PATH）'}</div>
            <div className="settings-actions-v106"><button onClick={onChoosePopplerFolder}>Popplerフォルダを選択</button><button onClick={onChoosePopplerBinary} className="secondary">実行ファイルを選択</button><button onClick={onResetPopplerBinary} disabled={!popplerBinaryPath}>自動検出に戻す</button></div>
            <div className="settings-status-v106"><span>{popplerBinaryPath ? 'Custom' : 'Auto'}</span><span>{popplerBinaryPath ? 'このPCだけに保存' : 'PDF OCRを実行する時だけ起動'}</span></div>
            <small>解凍した親フォルダ・bin・Library/binのどれを選んでも、配下を自動検索します。設定後は実際に検出したpdftotextの場所が表示されます。</small>
          </section>
        </div>
      </section>
    </div>
  );
}
