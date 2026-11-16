'use client';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, type Query } from './api';
import type { BankChangeStatus, BankQueueItem, DocumentQueueItem, Vendor360, VendorListResponse, VendorStats } from './vendors';

export const vendorKeys = {
  all: ['vendors'] as const,
  stats: ['vendors', 'stats'] as const,
  list: (q: Query) => ['vendors', 'list', q] as const,
  detail: (id: string) => ['vendors', 'detail', id] as const,
  categories: ['vendors', 'categories'] as const,
  docQueue: (filter: string, page: number) => ['vendors', 'doc-queue', filter, page] as const,
  bankQueue: (status: string) => ['vendors', 'bank-queue', status] as const,
};

export function useVendorStats(enabled = true) {
  return useQuery({ queryKey: vendorKeys.stats, queryFn: () => get<VendorStats>('/vendors/stats'), enabled });
}

export function useVendorList(query: Query, enabled = true) {
  return useQuery({
    queryKey: vendorKeys.list(query),
    queryFn: ({ signal }) => get<VendorListResponse>('/vendors', query, signal),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useVendor360(id: string) {
  return useQuery({ queryKey: vendorKeys.detail(id), queryFn: () => get<Vendor360>(`/vendors/${id}`) });
}

export function useVendorCategories(enabled = true) {
  return useQuery({ queryKey: vendorKeys.categories, queryFn: () => get<{ items: string[] }>('/vendors/categories'), enabled, staleTime: 5 * 60_000 });
}

export function useDocumentQueue(filter: string, page: number, pageSize = 25) {
  return useQuery({
    queryKey: vendorKeys.docQueue(filter, page),
    queryFn: () =>
      get<{ items: DocumentQueueItem[]; total: number; page: number; pageSize: number; canVerify: boolean }>('/vendors/documents/queue', {
        filter,
        page,
        pageSize,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useBankQueue(status: BankChangeStatus) {
  return useQuery({ queryKey: vendorKeys.bankQueue(status), queryFn: () => get<{ items: BankQueueItem[] }>('/vendors/bank-change-requests', { status }) });
}

/** Reconciles every vendor view with the server after a mutation. */
export function useInvalidateVendors() {
  const qc = useQueryClient();
  return async (id?: string) => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: vendorKeys.all }),
      qc.invalidateQueries({ queryKey: ['approvals'] }),
      ...(id ? [qc.invalidateQueries({ queryKey: vendorKeys.detail(id) })] : []),
    ]);
  };
}
