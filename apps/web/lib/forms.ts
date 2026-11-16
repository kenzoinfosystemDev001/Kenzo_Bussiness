import { isApiError } from './api';

/** Structural subset of a zod schema (the shared package owns the zod dependency). */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/** Client-side pre-validation with the shared zod schema (UX only — the server re-validates). */
export function validate<T>(schema: Schema<T>, value: unknown): { data: T; errors: null } | { data: null; errors: Record<string, string> } {
  const result = schema.safeParse(value);
  if (result.success) return { data: result.data, errors: null };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.') || '(root)';
    errors[path] ??= issue.message;
  }
  return { data: null, errors };
}

/** Server field errors (422) keyed by path, or an empty map. */
export function serverFieldErrors(error: unknown): Record<string, string> {
  return isApiError(error) ? error.fieldMap() : {};
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/overview'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
