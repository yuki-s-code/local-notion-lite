import React, { useCallback, useEffect, useMemo, useState } from "react";

export type GoogleCalendarEventItem = {
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

type CalendarEntry = { id: string; summary: string; primary?: boolean; backgroundColor?: string };
type WorkspaceStatus = { configured: boolean; connected: boolean; calendarEnabled?: boolean; reconnectRequired?: boolean; email?: string };

function toLocalDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function eventStartLabel(event: GoogleCalendarEventItem): string {
  if (event.start.dateTime) return new Date(event.start.dateTime).toLocaleString("ja-JP");
  if (event.start.date) return `${event.start.date}（終日）`;
  return "日時未設定";
}

export function GoogleCalendarPicker({
  onAdd,
  onStatus,
}: {
  onAdd: (event: GoogleCalendarEventItem) => void;
  onStatus?: (message: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [status, setStatus] = useState<WorkspaceStatus>({ configured: false, connected: false });
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [calendarId, setCalendarId] = useState("primary");
  const [startDate, setStartDate] = useState(toLocalDateInput(today));
  const [endDate, setEndDate] = useState(toLocalDateInput(new Date(today.getTime() + 7 * 86_400_000)));
  const [events, setEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const next = await window.localNotion.googleWorkspace.getStatus();
    setStatus(next);
    if (next.connected && next.calendarEnabled) {
      const list = await window.localNotion.googleWorkspace.listCalendars();
      setCalendars(list);
      const primary = list.find((item) => item.primary);
      setCalendarId(primary?.id || list[0]?.id || "primary");
    }
  }, []);

  useEffect(() => { void loadStatus().catch((error) => onStatus?.(String(error))); }, [loadStatus, onStatus]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); }
    catch (error) { onStatus?.(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  if (!status.connected) {
    return <div className="google-calendar-picker"><p>先にDriveタブからGoogle Workspaceへ接続してください。</p></div>;
  }

  if (!status.calendarEnabled || status.reconnectRequired) {
    return <div className="google-calendar-picker">
      <strong>Calendar権限が必要です</strong>
      <p>以前のDrive専用認証にはCalendar権限がありません。一度接続を解除し、再接続してください。</p>
      <button type="button" disabled={busy} onClick={() => void run(async () => {
        await window.localNotion.googleWorkspace.disconnect();
        await window.localNotion.googleWorkspace.connect(['drive', 'calendar']);
        await loadStatus();
        onStatus?.("Google Calendar権限を追加しました");
      })}>再認証する</button>
    </div>;
  }

  return <div className="google-calendar-picker">
    <div className="google-drive-account"><strong>Google Calendar</strong><small>{status.email}</small></div>
    <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
      {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
    </select>
    <div className="google-calendar-range">
      <label>開始<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      <label>終了<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
    </div>
    <button type="button" disabled={busy || !startDate || !endDate} onClick={() => void run(async () => {
      const min = new Date(`${startDate}T00:00:00`).toISOString();
      const max = new Date(`${endDate}T23:59:59`).toISOString();
      setEvents(await window.localNotion.googleWorkspace.listCalendarEvents(calendarId, min, max));
    })}>予定を読み込む</button>
    <div className="google-drive-results google-calendar-results">
      {events.map((event) => <button type="button" key={`${event.calendarId}:${event.id}`} onClick={() => onAdd(event)}>
        <span>📅</span><span><b>{event.summary}</b><small>{eventStartLabel(event)}{event.location ? ` · ${event.location}` : ""}</small></span>
      </button>)}
      {!events.length && <p>期間を指定して予定を読み込んでください。</p>}
    </div>
  </div>;
}
