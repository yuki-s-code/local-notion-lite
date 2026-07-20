import type { ExternalSourceProvider, ExternalSourceResult } from '../types';
import { getExternalSourceCache, setExternalSourceCache } from '../cache';

function normalize(value: unknown): string {
  return String(value || '').trim().toLocaleLowerCase('ja-JP');
}

function includesQuery(values: unknown[], query: string): boolean {
  const needle = normalize(query);
  return !needle || values.some((value) => normalize(value).includes(needle));
}

export const googleDriveProvider: ExternalSourceProvider = {
  id: 'drive', label: 'Drive', icon: '☁',
  isAvailable: (status) => status.connected,
  async search(query) {
    const cacheKey = `search:drive:${normalize(query)}`;
    const cached = getExternalSourceCache<ExternalSourceResult[]>(cacheKey);
    if (cached) return cached.value;
    const stale = getExternalSourceCache<ExternalSourceResult[]>(cacheKey, true);
    let files;
    try { files = await window.localNotion.googleWorkspace.searchFiles(query); } catch (error) { if (stale) return stale.value; throw error; }
    const results = files.map((file): ExternalSourceResult => ({
      key: `drive:${file.id}`,
      providerId: 'drive',
      title: file.name,
      subtitle: file.driveId ? '共有ドライブ' : file.owners?.[0]?.displayName || file.mimeType,
      timestamp: file.modifiedTime ? Date.parse(file.modifiedTime) : undefined,
      icon: file.mimeType.includes('spreadsheet') ? '▦' : file.mimeType.includes('document') ? '📄' : file.mimeType === 'application/pdf' ? '📕' : '☁',
      sensitivity: file.driveId ? 'shared-drive' : file.owners?.length ? 'private' : 'unknown',
      payload: file,
    }));
    setExternalSourceCache(cacheKey, results, 5 * 60_000);
    return results;
  },
};

export const googleCalendarProvider: ExternalSourceProvider = {
  id: 'calendar', label: 'Calendar', icon: '📅',
  isAvailable: (status) => Boolean(status.calendarEnabled),
  async search(query) {
    const cacheKey = `search:calendar:${normalize(query)}`;
    const cached = getExternalSourceCache<ExternalSourceResult[]>(cacheKey);
    if (cached) return cached.value;
    const stale = getExternalSourceCache<ExternalSourceResult[]>(cacheKey, true);
    let calendars;
    try { calendars = await window.localNotion.googleWorkspace.listCalendars(); } catch (error) { if (stale) return stale.value; throw error; }
    const primary = calendars.find((item) => item.primary) || calendars[0];
    if (!primary) return [];
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const end = new Date();
    end.setDate(end.getDate() + 90);
    const events = await window.localNotion.googleWorkspace.listCalendarEvents(primary.id, start.toISOString(), end.toISOString());
    const results = events.filter((event) => includesQuery([event.summary, event.description, event.location, ...(event.attendees || []).map((item) => item.email)], query)).map((event): ExternalSourceResult => ({
      key: `calendar:${event.calendarId}:${event.id}`,
      providerId: 'calendar',
      title: event.summary || '無題の予定',
      subtitle: event.location || event.organizer?.displayName || event.organizer?.email || 'Google Calendar',
      timestamp: Date.parse(event.start.dateTime || event.start.date || ''),
      icon: '📅',
      sensitivity: primary.accessRole === 'owner' ? 'private' : 'organization',
      payload: event,
    }));
    setExternalSourceCache(cacheKey, results, 2 * 60_000);
    return results;
  },
};

export const googleGmailProvider: ExternalSourceProvider = {
  id: 'gmail', label: 'Gmail', icon: '✉',
  isAvailable: (status) => Boolean(status.gmailEnabled),
  async search(query) {
    const gmailQuery = query.trim() || 'newer_than:30d -in:spam -in:trash';
    const cacheKey = `search:gmail:${normalize(gmailQuery)}`;
    const cached = getExternalSourceCache<ExternalSourceResult[]>(cacheKey);
    if (cached) return cached.value;
    const stale = getExternalSourceCache<ExternalSourceResult[]>(cacheKey, true);
    let messages;
    try { messages = await window.localNotion.googleWorkspace.searchGmailMessages(gmailQuery); } catch (error) { if (stale) return stale.value; throw error; }
    const results = messages.map((message): ExternalSourceResult => ({
      key: `gmail:${message.id}`,
      providerId: 'gmail',
      title: message.subject || '件名なし',
      subtitle: message.from || '送信者不明',
      timestamp: Number(message.internalDate || 0) || Date.parse(message.date || ''),
      icon: '✉',
      sensitivity: 'private',
      payload: message,
    }));
    setExternalSourceCache(cacheKey, results, 60_000);
    return results;
  },
};

export const googleExternalSourceProviders = [googleDriveProvider, googleCalendarProvider, googleGmailProvider] as const;
