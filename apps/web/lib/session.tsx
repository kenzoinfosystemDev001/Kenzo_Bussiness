'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SCOPE_RANK, type PermissionKey, type PermissionScope } from '@kenzo/shared';
import type { ReactNode } from 'react';
import { api } from './api';
import type { Session } from './types';

export const SESSION_KEY = ['session'] as const;

export function fetchSession(): Promise<Session> {
  return api<Session>('/auth/me');
}

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 60_000, retry: false });
}

export function useRefreshSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSION_KEY });
}

export function hasPermission(session: Pick<Session, 'permissions'> | undefined, permission: PermissionKey, minScope: PermissionScope = 'OWN'): boolean {
  const scope = session?.permissions[permission];
  return !!scope && SCOPE_RANK[scope] >= SCOPE_RANK[minScope];
}

/** UI gating only — the API enforces every permission independently. */
export function usePermission(permission: PermissionKey, minScope: PermissionScope = 'OWN'): boolean {
  const { data } = useSession();
  return hasPermission(data, permission, minScope);
}

export function useAnyPermission(permissions: PermissionKey[]): boolean {
  const { data } = useSession();
  return permissions.some((p) => hasPermission(data, p));
}

interface CanProps {
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  minScope?: PermissionScope;
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders children only when the session holds the permission(s). */
export function Can({ permission, anyOf, minScope = 'OWN', fallback = null, children }: CanProps) {
  const { data } = useSession();
  const allowed = permission ? hasPermission(data, permission, minScope) : (anyOf ?? []).some((p) => hasPermission(data, p, minScope));
  return <>{allowed ? children : fallback}</>;
}
