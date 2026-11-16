import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { SESSION_KEY } from '@/lib/session';
import type { Session } from '@/lib/types';

export function makeSession(permissions: Session['permissions'] = {}): Session {
  return {
    user: {
      id: 'u1',
      email: 'a@kenzo.test',
      fullName: 'Asha Rao',
      jobTitle: null,
      departmentId: null,
      mfaEnabled: false,
      lastLoginAt: null,
      passwordChangedAt: null,
    },
    company: {
      id: 'c1',
      code: 'KENZO',
      displayName: 'Kenzo',
      legalName: 'Kenzo Infosystems Pvt. Ltd.',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
      enforceMfaForPrivileged: false,
    },
    companies: [{ id: 'c1', code: 'KENZO', displayName: 'Kenzo' }],
    roleKeys: [],
    permissions,
    mfa: { enabled: false, verified: false, pending: false, enforced: false },
    csrfToken: 'x',
    privilegedPermissions: [],
  };
}

export function renderWithProviders(ui: ReactElement, opts: { session?: Session } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (opts.session) client.setQueryData(SESSION_KEY, opts.session);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(impl(String(input), init ?? {})));
  vi.stubGlobal('fetch', fn);
  return fn;
}
