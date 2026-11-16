'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { CostCentre, Department, List, PermissionDef, RoleRow } from './types';

export function useDepartments(enabled = true) {
  return useQuery({ queryKey: ['departments'], queryFn: () => get<List<Department>>('/departments'), enabled });
}

export function useCostCentres(enabled = true) {
  return useQuery({ queryKey: ['cost-centres'], queryFn: () => get<List<CostCentre>>('/cost-centres'), enabled });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: ['roles'], queryFn: () => get<List<RoleRow>>('/roles'), enabled });
}

export function usePermissionCatalogue(enabled = true) {
  return useQuery({ queryKey: ['permissions'], queryFn: () => get<List<PermissionDef>>('/permissions'), enabled, staleTime: 10 * 60_000 });
}
