import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { app } from 'electron';

export function ensureWritableDir(dir: string): void {
  fs.ensureDirSync(dir);
  const test = path.join(dir, '.write-test');
  fs.writeFileSync(test, 'ok', 'utf8');
  fs.unlinkSync(test);
}

export function normalizeCustomSqlitePath(value?: string): string | undefined {
  if (!value || !value.trim()) return undefined;
  const normalized = path.resolve(value);
  const ext = path.extname(normalized).toLowerCase();
  return ext === '.sqlite' || ext === '.db' ? normalized : path.join(normalized, 'local.sqlite');
}

export function resolveLocalDbPath(sharedRoot?: string, customLocalDbPath?: string): string {
  const pc = sanitizeSegment(os.hostname() || process.env.COMPUTERNAME || 'unknown-pc');
  const custom = normalizeCustomSqlitePath(customLocalDbPath);
  const candidates = [
    custom,
    path.join(app.getPath('userData'), 'local.sqlite'),
    path.join(app.getPath('appData'), 'LocalNotionLite', 'local.sqlite'),
    path.join(app.getPath('documents'), 'LocalNotionLite', 'local.sqlite'),
    sharedRoot ? path.join(sharedRoot, 'local-cache', pc, 'local.sqlite') : undefined,
    path.join(app.getPath('temp'), 'LocalNotionLite', 'local.sqlite')
  ].filter(Boolean) as string[];

  for (const dbPath of candidates) {
    try {
      ensureWritableDir(path.dirname(dbPath));
      return dbPath;
    } catch {
      // try next path
    }
  }
  throw new Error('No writable location for local SQLite DB was found.');
}

export function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '-');
}

type PrivateVaultPathOverrides = {
  privateRoot?: string;
  privatePagesRoot?: string;
  privateDatabasesRoot?: string;
};

let privateVaultPathOverrides: PrivateVaultPathOverrides = {};

export function setPrivateVaultPathOverrides(overrides: PrivateVaultPathOverrides = {}): void {
  privateVaultPathOverrides = { ...overrides };
}

function normalizePrivateDir(value: string | undefined, fallback: string): string {
  if (!value || !value.trim()) return fallback;
  return path.resolve(value);
}

export function vaultPaths(sharedRoot: string) {
  const defaultPrivateRoot = path.join(app.getPath('userData'), 'private-vault');
  const privateRoot = normalizePrivateDir(privateVaultPathOverrides.privateRoot, defaultPrivateRoot);
  const privatePages = normalizePrivateDir(privateVaultPathOverrides.privatePagesRoot, path.join(privateRoot, 'pages'));
  const privateDatabases = normalizePrivateDir(privateVaultPathOverrides.privateDatabasesRoot, path.join(privateRoot, 'databases'));
  const privateAttachments = path.join(privateRoot, 'attachments');
  return {
    root: sharedRoot,
    privateRoot,
    pages: path.join(sharedRoot, 'pages'),
    privatePages,
    attachments: path.join(sharedRoot, 'attachments'),
    privateAttachments,
    locks: path.join(sharedRoot, 'locks'),
    backups: path.join(sharedRoot, 'backups'),
    databases: path.join(sharedRoot, 'databases'),
    privateDatabases,
    journals: path.join(sharedRoot, 'journals'),
    inbox: path.join(sharedRoot, 'inbox'),
    smartAssist: path.join(sharedRoot, 'smart-assist'),
    privateSmartAssist: path.join(privateRoot, 'smart-assist'),
    conflicts: path.join(sharedRoot, 'conflicts'),
    manifest: path.join(sharedRoot, 'manifest.json'),
    workspace: path.join(sharedRoot, 'workspace')
  };
}
