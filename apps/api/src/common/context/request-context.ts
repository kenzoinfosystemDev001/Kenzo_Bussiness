import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionKey, PermissionScope } from '@kenzo/shared';

/** The authenticated principal for the current request, resolved from the session. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  /** Company the session is currently operating in (workspace switcher). */
  companyId: string;
  homeCompanyId: string;
  departmentId: string | null;
  /** Departments covered by DEPARTMENT-scoped grants (home dept, assignment depts, headed depts). */
  departmentScopeIds: string[];
  permissions: ReadonlyMap<PermissionKey, PermissionScope>;
  roleKeys: string[];
  mfaEnabled: boolean;
  mfaVerified: boolean;
  mfaPending: boolean;
  companyEnforcesMfa: boolean;
}

export interface RequestContextData {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  auth?: AuthContext;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  setAuth(auth: AuthContext): void {
    const store = storage.getStore();
    if (store) store.auth = auth;
  },
  correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
