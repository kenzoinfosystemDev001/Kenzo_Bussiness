import { AppError } from './errors/app-error';

/**
 * Keyset (cursor) pagination over (createdAt DESC, id DESC). Stable under
 * concurrent inserts and O(log n) per page, unlike OFFSET.
 */
export interface CursorKey {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const [ts, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const createdAt = new Date(ts);
    if (Number.isNaN(createdAt.getTime()) || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad');
    return { createdAt, id };
  } catch {
    throw AppError.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}

/** Prisma `where` fragment selecting rows strictly after the cursor in DESC order. */
export function cursorWhere(cursor: CursorKey | null, field = 'createdAt'): Record<string, unknown> {
  if (!cursor) return {};
  return { OR: [{ [field]: { lt: cursor.createdAt } }, { [field]: cursor.createdAt, id: { lt: cursor.id } }] };
}

export function pageOf<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]!) : null };
}
