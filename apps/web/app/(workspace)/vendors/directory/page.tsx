'use client';

import { GST_REGISTRATION_LABELS, GST_REGISTRATION_TYPES, VENDOR_STATUSES, VENDOR_STATUS_LABELS, VENDOR_TYPES, VENDOR_TYPE_LABELS } from '@kenzo/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink, Filter, Plus, Rows2, Rows4, Search, Store, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { SearchInput } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/tooltip';
import { BankStatusBadge, DocSummaryIndicators, VendorStatusBadge } from '@/components/vendors/vendor-ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { usePermission } from '@/lib/session';
import { useVendorCategories, useVendorList } from '@/lib/vendor-queries';
import type { VendorListItem } from '@/lib/vendors';

type SortKey = 'legalName' | 'vendorCode' | 'createdAt' | 'updatedAt' | 'status';
const DENSITY_KEY = 'kk-vendor-density';
const ALERTS = [
  { value: 'pending_verification', label: 'Docs to verify' },
  { value: 'expiring', label: 'Docs expiring' },
  { value: 'expired', label: 'Docs expired' },
  { value: 'missing', label: 'No documents' },
];

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const set = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { get, set, params };
}

function SortHeader({
  label,
  field,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  field: SortKey;
  sort: string;
  order: string;
  onSort: (f: SortKey) => void;
  className?: string;
}) {
  const active = sort === field;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('border-b border-border px-4 py-2.5', className)}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-150 hover:text-fg',
          active ? 'text-fg' : 'text-fg-subtle',
        )}
      >
        {label}
        <Icon className={cn('size-3.5', !active && 'opacity-50')} aria-hidden />
      </button>
    </th>
  );
}

function Directory() {
  const router = useRouter();
  const canRead = usePermission('vendor.read');
  const canCreate = usePermission('vendor.create');
  const { get, set } = useUrlState();
  const categories = useVendorCategories(canRead);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [showFilters, setShowFilters] = useState(false);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(DENSITY_KEY) === 'compact') setDensity('compact');
    } catch {
      /* ignore */
    }
  }, []);
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact';
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const statuses = get('status') ? get('status').split(',') : [];
  const sort = (get('sort') || 'createdAt') as SortKey;
  const order = get('order') || 'desc';
  const page = Math.max(1, Number(get('page')) || 1);
  const pageSize = Number(get('pageSize')) || 20;
  const query = useMemo(
    () => ({
      q: get('q') || undefined,
      status: statuses.join(',') || undefined,
      vendorType: get('vendorType') || undefined,
      category: get('category') || undefined,
      gstRegistrationType: get('gstRegistrationType') || undefined,
      msme: get('msme') || undefined,
      documentAlert: get('documentAlert') || undefined,
      sort,
      order,
      page,
      pageSize,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from the URL
    [get('q'), get('status'), get('vendorType'), get('category'), get('gstRegistrationType'), get('msme'), get('documentAlert'), sort, order, page, pageSize],
  );
  const list = useVendorList(query, canRead);
  const data = list.data;
  const filtersActive = ['q', 'status', 'vendorType', 'category', 'gstRegistrationType', 'msme', 'documentAlert'].some((k) => !!get(k));
  const advancedCount = ['vendorType', 'category', 'gstRegistrationType', 'msme', 'documentAlert'].filter((k) => !!get(k)).length;

  const toggleStatus = (s: string) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    set({ status: next.join(',') || null });
  };
  const onSort = (f: SortKey) => set({ sort: f, order: sort === f && order === 'asc' ? 'desc' : 'asc' }, false);
  const clearAll = () => set({ q: null, status: null, vendorType: null, category: null, gstRegistrationType: null, msme: null, documentAlert: null });

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, v: VendorListItem) => {
    const rows = Array.from(tableRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? []);
    const idx = rows.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      rows[Math.min(idx + 1, rows.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      rows[Math.max(idx - 1, 0)]?.focus();
    } else if (e.key === 'Enter') {
      router.push(`/vendors/${v.id}`);
    }
  };

  if (!canRead) return <PermissionDenied />;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pad = density === 'compact' ? 'py-1.5' : 'py-3';

  return (
    <>
      <PageHeader
        title="Vendor directory"
        description="Search and filter every vendor. Filters are kept in the address bar, so a view can be bookmarked or shared."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Directory' }]}
        actions={
          canCreate && (
            <Link href="/vendors/new" className={buttonVariants()}>
              <Plus aria-hidden /> New vendor
            </Link>
          )
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={get('q')}
              onChange={(v) => set({ q: v || null })}
              placeholder="Name, code, GSTIN, city or contact"
              className="sm:w-80"
              label="Search vendors"
            />
            <Button variant="secondary" size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-controls="vendor-filters">
              <Filter aria-hidden /> Filters
              {advancedCount > 0 && <span className="tabular rounded-full bg-primary px-1.5 text-2xs text-primary-fg">{advancedCount}</span>}
            </Button>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X aria-hidden /> Clear
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Tooltip content={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleDensity}
                  aria-label={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'}
                >
                  {density === 'compact' ? <Rows2 /> : <Rows4 />}
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {VENDOR_STATUSES.map((s) => {
              const on = statuses.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-[background-color,border-color,color] duration-150',
                    on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg',
                  )}
                >
                  {VENDOR_STATUS_LABELS[s]}
                </button>
              );
            })}
            {statuses.length === 0 && <span className="self-center text-xs text-fg-subtle">All except archived</span>}
          </div>
          {showFilters && (
            <div id="vendor-filters" className="grid gap-2 animate-fade-in sm:grid-cols-2 lg:grid-cols-5">
              <Select aria-label="Vendor type" value={get('vendorType')} onChange={(e) => set({ vendorType: e.target.value || null })}>
                <option value="">Any type</option>
                {VENDOR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VENDOR_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Select aria-label="Category" value={get('category')} onChange={(e) => set({ category: e.target.value || null })}>
                <option value="">Any category</option>
                {categories.data?.items.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
              <Select aria-label="GST registration" value={get('gstRegistrationType')} onChange={(e) => set({ gstRegistrationType: e.target.value || null })}>
                <option value="">Any GST registration</option>
                {GST_REGISTRATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GST_REGISTRATION_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Select aria-label="MSME" value={get('msme')} onChange={(e) => set({ msme: e.target.value || null })}>
                <option value="">MSME: any</option>
                <option value="true">MSME only</option>
                <option value="false">Non-MSME</option>
              </Select>
              <Select aria-label="Document alert" value={get('documentAlert')} onChange={(e) => set({ documentAlert: e.target.value || null })}>
                <option value="">Any document state</option>
                {ALERTS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {list.error && !data ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <>
            {/* Desktop table */}
            <div className={cn('scrollbar-thin hidden overflow-x-auto transition-opacity duration-150 md:block', list.isFetching && data && 'opacity-60')}>
              <table className="w-full border-collapse text-left text-base">
                <caption className="sr-only">Vendors. Use arrow keys to move between rows and Enter to open.</caption>
                <thead className="sticky top-0 z-10 bg-surface-muted/95 backdrop-blur">
                  <tr>
                    <SortHeader label="Vendor" field="legalName" sort={sort} order={order} onSort={onSort} />
                    <SortHeader label="Code" field="vendorCode" sort={sort} order={order} onSort={onSort} />
                    <th scope="col" className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                      Category
                    </th>
                    <th scope="col" className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                      Compliance
                    </th>
                    <SortHeader label="Status" field="status" sort={sort} order={order} onSort={onSort} />
                    <SortHeader label="Updated" field="updatedAt" sort={sort} order={order} onSort={onSort} />
                    <th scope="col" className="border-b border-border px-4 py-2.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody ref={tableRef}>
                  {list.isLoading
                    ? Array.from({ length: 8 }, (_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 7 }, (__, j) => (
                            <td key={j} className="border-b border-border px-4 py-3">
                              <Skeleton className="h-4 w-full max-w-[160px]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : data?.items.map((v) => (
                        <tr
                          key={v.id}
                          data-row
                          tabIndex={0}
                          onClick={() => router.push(`/vendors/${v.id}`)}
                          onKeyDown={(e) => onRowKey(e, v)}
                          className="group cursor-pointer transition-colors duration-150 hover:bg-surface-muted/60 focus-visible:bg-primary-soft/50 focus-visible:outline-none"
                        >
                          <td className={cn('border-b border-border px-4', pad)}>
                            <p className="font-medium text-fg">{v.legalName}</p>
                            {density === 'comfortable' && (
                              <p className="text-xs text-fg-subtle">
                                {v.tradeName ? `${v.tradeName} · ` : ''}
                                {v.city}, {v.state}
                                {v.msmeRegistered ? ' · MSME' : ''}
                              </p>
                            )}
                          </td>
                          <td className={cn('border-b border-border px-4 font-mono text-xs text-fg-muted', pad)}>{v.vendorCode}</td>
                          <td className={cn('border-b border-border px-4 text-fg-muted', pad)}>
                            {v.category}
                            {density === 'comfortable' && <p className="text-xs text-fg-subtle">{VENDOR_TYPE_LABELS[v.vendorType]}</p>}
                          </td>
                          <td className={cn('border-b border-border px-4', pad)}>
                            <div className="flex flex-wrap items-center gap-1">
                              <DocSummaryIndicators summary={v.documentSummary} />
                              <BankStatusBadge status={v.bankStatus} />
                            </div>
                          </td>
                          <td className={cn('border-b border-border px-4', pad)}>
                            <VendorStatusBadge status={v.status} />
                          </td>
                          <td className={cn('border-b border-border px-4 text-sm text-fg-muted', pad)}>{relativeTime(v.updatedAt)}</td>
                          <td className={cn('border-b border-border px-2', pad)}>
                            <div className="flex justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                              <Tooltip content="Open in new tab">
                                <a
                                  href={`/vendors/${v.id}`}
                                  target="_blank"
                                  rel="noopener"
                                  onClick={(e) => e.stopPropagation()}
                                  className="rounded p-1.5 text-fg-subtle hover:bg-surface hover:text-fg"
                                  aria-label={`Open ${v.legalName} in a new tab`}
                                >
                                  <ExternalLink className="size-4" />
                                </a>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-border md:hidden">
              {list.isLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    <li key={i} className="p-4">
                      <Skeleton className="h-14" />
                    </li>
                  ))
                : data?.items.map((v) => (
                    <li key={v.id}>
                      <Link href={`/vendors/${v.id}`} className="flex flex-col gap-2 p-4 transition-colors duration-150 active:bg-surface-muted">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">{v.legalName}</p>
                            <p className="text-xs text-fg-subtle">
                              {v.vendorCode} · {v.city}
                            </p>
                          </div>
                          <VendorStatusBadge status={v.status} />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <DocSummaryIndicators summary={v.documentSummary} />
                          <BankStatusBadge status={v.bankStatus} />
                        </div>
                      </Link>
                    </li>
                  ))}
            </ul>
            {!list.isLoading &&
              data &&
              data.items.length === 0 &&
              (filtersActive ? (
                <EmptyState
                  icon={Search}
                  title="No vendors match these filters"
                  description="Try a broader search or clear the filters."
                  action={
                    <Button variant="secondary" onClick={clearAll}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Store}
                  title="No vendors yet"
                  action={
                    canCreate ? (
                      <Button onClick={() => router.push('/vendors/new')}>
                        <Plus aria-hidden /> New vendor
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            {total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-fg-muted">
                <span className="tabular" aria-live="polite">
                  {from}–{to} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs">
                    Rows
                    <select
                      value={pageSize}
                      onChange={(e) => set({ pageSize: e.target.value })}
                      className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                    >
                      {[10, 20, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => set({ page: String(page - 1) }, false)}
                  >
                    <ChevronLeft />
                  </Button>
                  <span className="tabular text-xs">
                    Page {page} of {pages}
                  </span>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Next page"
                    disabled={page >= pages}
                    onClick={() => set({ page: String(page + 1) }, false)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      {statuses.includes('ARCHIVED') && (
        <p className="mt-3 text-xs text-fg-subtle">
          <Badge>Archived</Badge> vendors are read-only and kept for audit history.
        </p>
      )}
    </>
  );
}

export default function VendorDirectoryPage() {
  return (
    <Suspense>
      <Directory />
    </Suspense>
  );
}
