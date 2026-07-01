/**
 * Security boundary for links that leave the offline workspace.
 * Only normal web URLs are accepted; custom schemes and local file URLs stay blocked.
 */
export function normalizeExternalHttpUrl(rawUrl: unknown): string | null {
  try {
    const parsed = new URL(String(rawUrl ?? '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
