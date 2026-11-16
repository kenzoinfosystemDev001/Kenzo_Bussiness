import type { ApiErrorBody, ErrorCode, FieldError } from '@kenzo/shared';

/**
 * Typed client for the same-origin API (`/api/v1`, proxied by Next.js to NestJS).
 *  - Cookies travel automatically (`credentials: 'same-origin'`).
 *  - State-changing requests echo the CSRF token from the `kk_csrf` cookie.
 *  - Errors are parsed from the standard envelope into `ApiError`.
 *  - An expired/missing session sends the user to /login (configurable).
 */
export const API_BASE = '/api/v1';
export const CSRF_COOKIE = 'kk_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly fieldErrors: FieldError[];
  readonly correlationId: string | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: ApiError['code'];
    message: string;
    fieldErrors?: FieldError[];
    correlationId?: string | null;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors ?? [];
    this.correlationId = init.correlationId ?? null;
    this.details = init.details;
  }

  /** Field errors keyed by path, for forms. */
  fieldMap(): Record<string, string> {
    return Object.fromEntries(this.fieldErrors.map((f) => [f.path, f.message]));
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

type UnauthenticatedHandler = (error: ApiError) => void;

let onUnauthenticated: UnauthenticatedHandler = () => {
  if (typeof window === 'undefined') return;
  const here = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname.startsWith('/login')) return;
  // Full reload (absolute URL) so every cached query is discarded.
  window.location.replace(new URL(`/login?next=${encodeURIComponent(here)}`, window.location.origin).toString());
};

/** Override the redirect behaviour (tests, embedded contexts). */
export function setUnauthenticatedHandler(handler: UnauthenticatedHandler): void {
  onUnauthenticated = handler;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Do not redirect to /login on 401 (used by auth screens). */
  skipAuthRedirect?: boolean;
}

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const e = body?.error;
  return new ApiError({
    status: res.status,
    code: e?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED'),
    message: e?.message ?? `Request failed (${res.status})`,
    fieldErrors: e?.fieldErrors,
    correlationId: e?.correlationId ?? res.headers.get('x-correlation-id'),
    details: e?.details,
  });
}

async function send(path: string, init: RequestInit & { skipAuthRedirect?: boolean }, query?: Query): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { ...init, method, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Cannot reach the server. Check your connection and try again.' });
  }
  if (!res.ok) {
    const error = await parseError(res);
    if (!init.skipAuthRedirect && (error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED')) onUnauthenticated(error);
    throw error;
  }
  return res;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, skipAuthRedirect } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await send(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, skipAuthRedirect }, query);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Multipart upload (documents). The browser sets the multipart boundary. */
export async function uploadFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await send(path, { method: 'POST', body: form });
  return (await res.json()) as T;
}

export const get = <T>(path: string, query?: Query, signal?: AbortSignal) => api<T>(path, { query, signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
