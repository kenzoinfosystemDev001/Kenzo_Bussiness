'use client';

import { VENDOR_STATUS_LABELS, type VendorStatus } from '@kenzo/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { BankStatusBadge, DocSummaryIndicators, ScoreBar, VendorStatusBadge } from '@/components/vendors/vendor-ui';
import { cn } from '@/lib/cn';
import { usePermission } from '@/lib/session';
import { useVendorList } from '@/lib/vendor-queries';
import type { VendorListItem } from '@/lib/vendors';

const STANDARD_TERMS = 30;
/** Same formula as the server's payment-terms indicator. */
const termsScore = (days: number) => Math.min(100, Math.round((days / STANDARD_TERMS) * 100));
const docIssues = (v: VendorListItem) =>
  v.documentSummary.expired + v.documentSummary.rejected + v.documentSummary.pending + v.documentSummary.expiring + (v.documentSummary.total === 0 ? 1 : 0);
const bankRank = { VERIFIED: 2, PENDING: 1, NONE: 0 } as const;

type SortKey = 'name' | 'docs' | 'bank' | 'terms';

const FUTURE = [
  { label: 'Quotation competitiveness', phase: 3, source: 'RFQ comparisons' },
  { label: 'On-time delivery', phase: 4, source: 'Goods receipts vs PO schedules' },
  { label: 'Accepted vs rejected quantity', phase: 4, source: 'Goods receipt notes' },
  { label: 'Invoice disputes', phase: 5, source: 'Accounts payable' },
];

export default function VendorPerformancePage() {
  const router = useRouter();
  const canRead = usePermission('vendor.read');
  const [statusFilter, setStatusFilter] = useState<VendorStatus[]>(['ACTIVE', 'APPROVED', 'SUSPENDED']);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'docs', dir: 'desc' });
  const list = useVendorList({ status: statusFilter.join(','), sort: 'legalName', order: 'asc', page, pageSize: 100 }, canRead);

  const rows = useMemo(() => {
    const items = [...(list.data?.items ?? [])];
    const val = (v: VendorListItem): number | string =>
      sort.key === 'name'
        ? v.legalName.toLowerCase()
        : sort.key === 'docs'
          ? docIssues(v)
          : sort.key === 'bank'
            ? bankRank[v.bankStatus]
            : termsScore(v.paymentTermsDays);
    items.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.dir === 'asc' ? c : -c;
    });
    return items;
  }, [list.data, sort]);

  if (!canRead) return <PermissionDenied />;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 100));
  const issues = rows.filter((r) => docIssues(r) > 0).length;
  const verifiedBank = rows.filter((r) => r.bankStatus === 'VERIFIED').length;

  const header = (key: SortKey, label: string, className?: string) => {
    const active = sort.key === key;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn('border-b border-border px-4 py-2.5', className)}
      >
        <button
          type="button"
          onClick={() => setSort({ key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
          className={cn('inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide hover:text-fg', active ? 'text-fg' : 'text-fg-subtle')}
        >
          {label} <Icon className="size-3.5" aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <>
      <PageHeader
        title="Vendor performance"
        description="What can be measured today from verified records. Delivery, quality and invoice indicators start once those modules record real transactions."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Performance' }]}
      />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-fg-muted">Vendors in view</p>
          <p className="tabular mt-1 text-2xl font-semibold text-fg">{list.isLoading ? <Skeleton className="h-8 w-12" /> : total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-fg-muted">With document issues</p>
          <p className={cn('tabular mt-1 text-2xl font-semibold', issues ? 'text-warning' : 'text-fg')}>
            {list.isLoading ? <Skeleton className="h-8 w-12" /> : issues}
          </p>
          <p className="text-xs text-fg-subtle">Missing, pending, rejected, expiring or expired</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-fg-muted">Bank verified</p>
          <p className="tabular mt-1 text-2xl font-semibold text-fg">
            {list.isLoading ? <Skeleton className="h-8 w-12" /> : `${verifiedBank} / ${rows.length}`}
          </p>
          <p className="text-xs text-fg-subtle">Independently approved account on file</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3" role="group" aria-label="Statuses">
          {(['ACTIVE', 'APPROVED', 'SUSPENDED', 'UNDER_REVIEW', 'SUBMITTED', 'DRAFT'] as VendorStatus[]).map((s) => {
            const on = statusFilter.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setPage(1);
                  setStatusFilter((all) => (on ? all.filter((x) => x !== s) : [...all, s]));
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                  on ? 'border-primary bg-primary text-primary-fg' : 'border-border text-fg-muted hover:text-fg',
                )}
              >
                {VENDOR_STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !list.isLoading && rows.length === 0 ? (
          <EmptyState title="No vendors in these statuses" />
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full border-collapse text-left text-base">
              <caption className="sr-only">Vendor performance indicators measurable today</caption>
              <thead className="bg-surface-muted/95">
                <tr>
                  {header('name', 'Vendor')}
                  {header('docs', 'Document health')}
                  {header('bank', 'Bank')}
                  {header('terms', 'Payment terms')}
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }, (__, j) => (
                          <td key={j} className="border-b border-border px-4 py-3">
                            <Skeleton className="h-4 w-32" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((v) => (
                      <tr
                        key={v.id}
                        tabIndex={0}
                        onClick={() => router.push(`/vendors/${v.id}?tab=performance`)}
                        onKeyDown={(e) => e.key === 'Enter' && router.push(`/vendors/${v.id}?tab=performance`)}
                        className="cursor-pointer transition-colors duration-150 hover:bg-surface-muted/60 focus-visible:bg-primary-soft/40 focus-visible:outline-none"
                      >
                        <td className="border-b border-border px-4 py-2.5">
                          <p className="font-medium text-fg">{v.legalName}</p>
                          <p className="text-xs text-fg-subtle">
                            {v.vendorCode} · {v.category}
                          </p>
                        </td>
                        <td className="border-b border-border px-4 py-2.5">
                          <DocSummaryIndicators summary={v.documentSummary} />
                        </td>
                        <td className="border-b border-border px-4 py-2.5">
                          <BankStatusBadge status={v.bankStatus} />
                        </td>
                        <td className="border-b border-border px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span className="tabular w-16 text-sm text-fg-muted">{v.paymentTermsDays} days</span>
                            <ScoreBar score={termsScore(v.paymentTermsDays)} />
                          </div>
                        </td>
                        <td className="border-b border-border px-4 py-2.5">
                          <VendorStatusBadge status={v.status} />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="secondary" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft />
            </Button>
            <span className="tabular text-xs text-fg-muted">
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="How these are calculated" />
          <CardBody className="flex flex-col gap-2 text-sm text-fg-muted">
            <p>
              <strong className="text-fg">Document health</strong> counts current documents that are missing, awaiting verification, rejected, expiring within
              30 days or expired.
            </p>
            <p>
              <strong className="text-fg">Bank</strong> is verified only when an independent approver activated the account (maker-checker).
            </p>
            <p>
              <strong className="text-fg">Payment terms</strong> score = min(100, vendor credit days ÷ {STANDARD_TERMS} × 100).
            </p>
            <p className="text-xs text-fg-subtle">Open a vendor for its full indicator breakdown with every input value.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Coming with later modules" description="Never estimated — shown only once real transactions exist." />
          <CardBody className="flex flex-col gap-2">
            {FUTURE.map((f) => (
              <div key={f.label} className="flex items-center gap-3 rounded-md border border-dashed border-border-strong px-3 py-2">
                <Lock className="size-4 text-fg-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{f.label}</p>
                  <p className="text-xs text-fg-subtle">From {f.source}</p>
                </div>
                <Badge>Phase {f.phase}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Alert tone="info" className="mt-6">
        Indicators inform people; they never approve, suspend or reject vendors automatically.
      </Alert>
    </>
  );
}
