/**
 * BlockNote drag-and-drop uploads travel through the localhost JSON API as
 * base64. Keep this deliberately smaller than the Express body limit so an
 * ordinary file picker (which uses a direct local path) remains the route for
 * larger PDFs and media.
 */
export const MAX_BASE64_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export function base64EncodedLengthForBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.ceil(bytes / 3) * 4;
}

export function estimatedBase64DecodedBytes(base64: string): number {
  const normalized = String(base64 || '').replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export function isBase64AttachmentWithinLimit(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes >= 0 && sizeBytes <= MAX_BASE64_ATTACHMENT_BYTES;
}

export function base64AttachmentLimitMessage(fileName = 'このファイル'): string {
  const mib = Math.floor(MAX_BASE64_ATTACHMENT_BYTES / 1024 / 1024);
  return `${fileName} は ${mib}MB を超えています。本文へのドラッグ追加ではなく、「添付を追加」から選択してください。`;
}
