import { fileTypeFromBuffer } from 'file-type';

/**
 * Upload allow-list (docs/modules/files-monitoring.md §2, §7): the type is decided from the
 * bytes, never from the file name or the browser. No archives, no macro-enabled Office files,
 * no HTML/SVG (both can carry scripts).
 */
const BINARY_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** The detected, allowed content type — or null if the file is not on the allow-list. */
export async function allowedContentType(content: Buffer, name: string): Promise<string | null> {
  const detected = await fileTypeFromBuffer(content);
  if (detected) return BINARY_TYPES.has(detected.mime) ? detected.mime : null;
  // No binary signature: accept only real UTF-8 text (CSV or plain), never markup.
  const extension = name.toLowerCase().split('.').pop();
  if (extension !== 'csv' && extension !== 'txt') return null;
  if (content.includes(0)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    if (/^\s*</.test(text)) return null; // looks like HTML/XML/SVG despite the name
  } catch {
    return null;
  }
  return extension === 'csv' ? 'text/csv' : 'text/plain';
}

/** A display name safe to store and show: no paths, no control characters, max 200 chars. */
export function displayNameOf(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'file').slice(0, 200);
}
