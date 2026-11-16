'use client';

import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, type Query } from './api';
import type { Page } from './types';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Cursor-paginated list backed by `{ items, nextCursor }` endpoints. */
export function useCursorList<T>(key: QueryKey, path: string, query: Query = {}, options: { enabled?: boolean; limit?: number } = {}) {
  const q = useInfiniteQuery({
    queryKey: [...key, query],
    queryFn: ({ pageParam, signal }) => get<Page<T>>(path, { ...query, limit: options.limit ?? 25, cursor: pageParam ?? undefined }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled ?? true,
  });
  return {
    items: q.data?.pages.flatMap((p) => p.items) ?? [],
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: q.error,
    refetch: q.refetch,
    hasNextPage: q.hasNextPage,
    fetchNextPage: q.fetchNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
  };
}
