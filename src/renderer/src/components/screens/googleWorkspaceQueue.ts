import type { GoogleDriveFileItem } from './GoogleDrivePicker';
import type { GoogleCalendarEventItem } from './GoogleCalendarPicker';
import type { GoogleGmailMessageItem } from './GoogleGmailPicker';
import type { ExternalSourceIntent, ExternalSourceMode } from '../../externalSources/types';

export type GoogleWorkspaceQueueItem =
  | { kind: 'drive'; payload: GoogleDriveFileItem; intent?: ExternalSourceIntent; mode?: ExternalSourceMode }
  | { kind: 'calendar'; payload: GoogleCalendarEventItem; intent?: ExternalSourceIntent; mode?: ExternalSourceMode }
  | { kind: 'gmail'; payload: GoogleGmailMessageItem; intent?: ExternalSourceIntent; mode?: ExternalSourceMode };

const KEY = 'local-notion:google-workspace-board-queue-v2';
const LEGACY_KEY = 'local-notion:google-workspace-board-queue-v1';

export function enqueueGoogleWorkspaceItem(item: GoogleWorkspaceQueueItem): void {
  const current = readGoogleWorkspaceQueue();
  const key = `${item.kind}:${item.payload.id}:${item.intent || 'reference'}:${item.mode || 'link'}`;
  const next = [...current.filter((entry) => `${entry.kind}:${entry.payload.id}:${entry.intent || 'reference'}:${entry.mode || 'link'}` !== key), item];
  localStorage.setItem(KEY, JSON.stringify(next.slice(-100)));
}

export function enqueueGoogleWorkspaceItems(items: GoogleWorkspaceQueueItem[]): void {
  items.forEach(enqueueGoogleWorkspaceItem);
}

export function consumeGoogleWorkspaceQueue(): GoogleWorkspaceQueueItem[] {
  const items = readGoogleWorkspaceQueue();
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
  return items;
}

function readGoogleWorkspaceQueue(): GoogleWorkspaceQueueItem[] {
  try {
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || '[]';
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isQueueItem) : [];
  } catch { return []; }
}

function isQueueItem(value: unknown): value is GoogleWorkspaceQueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as { kind?: unknown; intent?: unknown; mode?: unknown; payload?: { id?: unknown } };
  const validIntent = item.intent === undefined || item.intent === 'reference' || item.intent === 'meeting-notes' || item.intent === 'task';
  const validMode = item.mode === undefined || item.mode === 'link' || item.mode === 'import' || item.mode === 'sync';
  return validIntent && validMode && (item.kind === 'drive' || item.kind === 'calendar' || item.kind === 'gmail') && typeof item.payload?.id === 'string';
}
