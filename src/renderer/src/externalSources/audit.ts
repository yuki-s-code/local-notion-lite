export type ExternalSourceAuditEntry = {
  id: string;
  at: number;
  action: 'search' | 'queue' | 'sync' | 'connect' | 'disconnect' | 'error';
  provider?: string;
  detail: string;
};

const KEY = 'local-notion:external-source-audit-v1';

export function appendExternalSourceAudit(entry: Omit<ExternalSourceAuditEntry, 'id' | 'at'>): void {
  const current = readExternalSourceAudit();
  current.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(current.slice(0, 300)));
}

export function readExternalSourceAudit(): ExternalSourceAuditEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.detail === 'string' && typeof item.at === 'number') : [];
  } catch { return []; }
}
