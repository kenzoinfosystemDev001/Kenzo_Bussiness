import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, buildUrl, setUnauthenticatedHandler } from '@/lib/api';
import { safeNext } from '@/lib/forms';
import { jsonResponse, mockFetch } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends the CSRF token from the kk_csrf cookie on state-changing requests only', async () => {
    document.cookie = 'kk_csrf=abc123; path=/';
    const fetchMock = mockFetch(() => jsonResponse(200, { ok: true }));
    await api('/users', { method: 'POST', body: { a: 1 } });
    await api('/users');
    const [, postInit] = fetchMock.mock.calls[0]!;
    const [, getInit] = fetchMock.mock.calls[1]!;
    expect(new Headers(postInit!.headers).get('x-csrf-token')).toBe('abc123');
    expect(new Headers(getInit!.headers).get('x-csrf-token')).toBeNull();
    expect(postInit!.credentials).toBe('same-origin');
    expect(postInit!.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('parses the error envelope into ApiError with field errors and correlation id', async () => {
    mockFetch(() =>
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields are invalid',
          fieldErrors: [{ path: 'email', message: 'Enter a valid email address' }],
          correlationId: 'corr-1',
        },
      }),
    );
    const err = (await api('/users/invitations', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.correlationId).toBe('corr-1');
    expect(err.fieldMap()).toEqual({ email: 'Enter a valid email address' });
  });

  it('invokes the unauthenticated handler on 401 unless suppressed', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    mockFetch(() => jsonResponse(401, { error: { code: 'SESSION_EXPIRED', message: 'ended', correlationId: 'c' } }));
    await expect(api('/auth/me')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(api('/auth/login', { method: 'POST', body: {}, skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(api('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('builds query strings without empty values', () => {
    expect(buildUrl('/users', { q: 'asha', status: '', cursor: undefined, limit: 25 })).toBe('/api/v1/users?q=asha&limit=25');
  });

  it('only allows same-site relative redirects', () => {
    expect(safeNext('/admin/users')).toBe('/admin/users');
    expect(safeNext('//evil.example')).toBe('/overview');
    expect(safeNext('https://evil.example')).toBe('/overview');
    expect(safeNext('/\\evil')).toBe('/overview');
    expect(safeNext(null)).toBe('/overview');
  });
});
