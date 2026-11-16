/**
 * Content-based file type detection. The declared MIME type and extension are
 * NOT trusted: the leading bytes must match the type implied by the extension.
 */
export interface AllowedType {
  mime: string;
  extensions: string[];
  matches(buf: Buffer): boolean;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

export const ALLOWED_TYPES: AllowedType[] = [
  { mime: 'application/pdf', extensions: ['pdf'], matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) },
  { mime: 'image/png', extensions: ['png'], matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'], matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mime: 'image/webp', extensions: ['webp'], matches: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) },
  {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    matches: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  },
  {
    mime: 'text/csv',
    extensions: ['csv'],
    // Plain text: no NUL bytes in the first 4 KB.
    matches: (b) => !b.subarray(0, 4096).includes(0),
  },
];

export function detectType(originalName: string, buf: Buffer): AllowedType | null {
  const ext = originalName.toLowerCase().split('.').pop() ?? '';
  const candidate = ALLOWED_TYPES.find((t) => t.extensions.includes(ext));
  if (!candidate || buf.length === 0) return null;
  return candidate.matches(buf) ? candidate : null;
}

/** Strips path components and control characters; keeps a safe display name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const unsafe = new Set(['"', '<', '>', '|', ':', '*', '?']);
  const clean = Array.from(base, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f || unsafe.has(ch) ? '_' : ch;
  })
    .join('')
    .trim()
    .slice(0, 200);
  return clean || 'file';
}
