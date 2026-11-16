'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Right-align numeric columns. */
  numeric?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  caption?: string;
  skeletonRows?: number;
}

/**
 * Server-driven table: the server filters, sorts and paginates (cursor); the
 * table renders loading, empty and error states and a "Load more" control.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  onRowClick,
  empty = { title: 'Nothing here yet' },
  hasNextPage,
  onLoadMore,
  isLoadingMore,
  caption,
  skeletonRows = 6,
}: DataTableProps<T>) {
  if (error && rows.length === 0) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <div className="flex flex-col">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full border-collapse text-left text-base">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface-muted/95 backdrop-blur">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle',
                    c.numeric && 'text-right',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={`sk-${i}`} data-testid="skeleton-row">
                    {columns.map((c) => (
                      <td key={c.key} className="border-b border-border px-4 py-3">
                        <Skeleton className="h-4 w-full max-w-[180px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(row) : undefined) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn('transition-colors duration-150', onRowClick && 'cursor-pointer hover:bg-surface-muted/70 focus-visible:bg-surface-muted')}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn('border-b border-border px-4 py-2.5 align-middle', c.numeric && 'tabular text-right', c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {!isLoading && rows.length === 0 && <EmptyState title={empty.title} description={empty.description} action={empty.action} />}
      {hasNextPage && onLoadMore && (
        <div className="flex justify-center border-t border-border p-3">
          <Button variant="secondary" size="sm" onClick={onLoadMore} loading={isLoadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
