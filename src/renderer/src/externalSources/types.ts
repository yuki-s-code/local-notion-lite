import type { GoogleDriveFileItem } from '../components/screens/GoogleDrivePicker';
import type { GoogleCalendarEventItem } from '../components/screens/GoogleCalendarPicker';
import type { GoogleGmailMessageItem } from '../components/screens/GoogleGmailPicker';

export type ExternalSourceKind = 'drive' | 'calendar' | 'gmail';
export type ExternalSourceIntent = 'reference' | 'meeting-notes' | 'task';
export type ExternalSourceMode = 'link' | 'import' | 'sync';
export type ExternalSourceSensitivity = 'private' | 'organization' | 'shared-drive' | 'unknown';
export type ExternalSyncState = 'idle' | 'queued' | 'running' | 'synced' | 'conflict' | 'failed' | 'removed';

type ExternalSourceResultBase = {
  key: string;
  title: string;
  subtitle: string;
  timestamp?: number;
  icon: string;
  sensitivity: ExternalSourceSensitivity;
};

export type ExternalSourceResult =
  | (ExternalSourceResultBase & { providerId: 'drive'; payload: GoogleDriveFileItem })
  | (ExternalSourceResultBase & { providerId: 'calendar'; payload: GoogleCalendarEventItem })
  | (ExternalSourceResultBase & { providerId: 'gmail'; payload: GoogleGmailMessageItem });

export interface ExternalSourceProvider {
  readonly id: ExternalSourceKind;
  readonly label: string;
  readonly icon: string;
  isAvailable(status: Awaited<ReturnType<typeof window.localNotion.googleWorkspace.getStatus>>): boolean;
  search(query: string): Promise<ExternalSourceResult[]>;
}

export interface ExternalSourceSnapshot {
  title: string;
  subtitle: string;
  content: string;
  timestamp?: number;
  capturedAt: number;
}

export interface ExternalSourceRecord {
  key: string;
  providerId: ExternalSourceKind;
  mode: ExternalSourceMode;
  intent: ExternalSourceIntent;
  title: string;
  externalUrl?: string;
  sensitivity: ExternalSourceSensitivity;
  syncState: ExternalSyncState;
  current: ExternalSourceSnapshot;
  previous?: ExternalSourceSnapshot;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface ExternalSyncIssue {
  id: string;
  sourceKey?: string;
  providerId: ExternalSourceKind;
  kind: 'auth' | 'permission' | 'removed' | 'conflict' | 'fetch' | 'unknown';
  message: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface GmailActionItem {
  id: string;
  sourceKey: string;
  subject: string;
  sender: string;
  dueDate?: string;
  assignee?: string;
  status: 'todo' | 'waiting' | 'done';
  createdAt: number;
}

export interface MeetingWorkflowItem {
  id: string;
  sourceKey: string;
  title: string;
  startsAt?: string;
  status: 'planned' | 'in-progress' | 'completed';
  followUpDate?: string;
  createdAt: number;
}
