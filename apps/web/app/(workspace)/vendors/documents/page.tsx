'use client';

import { VENDOR_DOCUMENT_LABELS } from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { CalendarSearch, ChevronLeft, ChevronRight, FileCheck2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { DownloadButton, VerifyControls } from '@/components/vendors/document-actions';
import { ExpiryBadge, VendorStatusBadge, VerificationBadge } from '@/components/vendors/vendor-ui';
import { errorMessage, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { usePermission } from '@/lib/session';
import { useDocumentQueue, useInvalidateVendors } from '@/lib/vendor-queries';
import { formatBytes } from '@/lib/vendors';

const FILTERS = [
  { value: 'pending_verification', label: 'Awaiting verification', empty: 'No documents are waiting for verification.' },
  { value: 'expiring', label: 'Expiring soon', empty: 'No documents expire in the next 30 days.' },
  { value: 'expired', label: 'Expired', empty: 'No current documents have expired.' },
  { value: 'rejected', label: 'Rejected', empty: 'No rejected documents need replacing.' },
] as const;

function DocumentQueue() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const canRead = usePermission('vendor.read');
  const canScan = usePermission('vendor.approve');
  const invalidate = useInvalidateVendors();
  const filter = FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'pending_verification';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = useDocumentQueue(filter, page);
  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) next.set(k, v);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const scan = useMutation({
    mutationFn: () => post<{ warned: number; expired: number }>('/vendors/documents/expiry-scan'),
    onSuccess: async (r) => {
      toast.success('Expiry scan complete', `${r.warned} expiry warning(s) and ${r.expired} expiry notice(s) sent.`);
      await invalidate();
    },
    onError: (e) => toast.error('Scan failed', errorMessage(e)),
  });

  if (!canRead) return <PermissionDenied />;
  const data = q.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Document verification"
        description="Verify vendor documents against originals and track expiries. Verifiers can never verify their own uploads."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Documents' }]}
        actions={
          canScan && (
            <Button variant="secondary" onClick={() => scan.mutate()} loading={scan.isPending}>
              <CalendarSearch aria-hidden /> Run expiry scan
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        <Tabs
          className="px-4"
          value={filter}
          onChange={(v) => go({ filter: v, page: '1' })}
          items={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === filter ? data?.total : undefined }))}
        />
        {q.error && !data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon={FileCheck2} title="All clear" description={FILTERS.find((f) => f.value === filter)!.empty} />
        ) : (
          <ul className={cn('divide-y divide-border transition-opacity duration-150', q.isFetching && 'opacity-60')}>
            {data.items.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/vendors/${d.vendor.id}?tab=documents`} className="font-medium text-fg hover:underline">
                      {d.vendor.legalName}
                    </Link>
                    <span className="font-mono text-xs text-fg-subtle">{d.vendor.vendorCode}</span>
                    <VendorStatusBadge status={d.vendor.status} />
                  </div>
                  <p className="mt-1 text-sm text-fg">
                    {VENDOR_DOCUMENT_LABELS[d.documentType]} <Badge className="ml-1">v{d.versionNo}</Badge>
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {d.document.originalName} · {formatBytes(d.document.sizeBytes)} · uploaded by {d.uploadedBy.fullName} {relativeTime(d.createdAt)}
                    {d.documentNumber ? ` · No. ${d.documentNumber}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <VerificationBadge status={d.verificationStatus} />
                    <ExpiryBadge expiryDate={d.expiryDate} />
                  </div>
                  {d.verificationNote && (
                    <p className="mt-2 text-sm text-fg-muted">
                      “{d.verificationNote}”{d.verifiedBy ? ` — ${d.verifiedBy.fullName}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-start justify-end gap-2 lg:w-[360px]">
                  <DownloadButton documentId={d.documentId} label="View" />
                  {data.canVerify && d.verificationStatus === 'PENDING' && (
                    <VerifyControls vendorId={d.vendor.id} vendorDocumentId={d.id} onDone={() => invalidate()} />
                  )}
                  {(filter === 'expired' || filter === 'expiring' || filter === 'rejected') && (
                    <Link
                      href={`/vendors/${d.vendor.id}?tab=documents`}
                      className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-sm font-medium text-fg hover:bg-surface-muted"
                    >
                      Open vendor documents
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 text-sm text-fg-muted">
            <Button variant="secondary" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
              <ChevronLeft />
            </Button>
            <span className="tabular text-xs">
              Page {page} of {pages}
            </span>
            <Button variant="secondary" size="icon" aria-label="Next page" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

export default function VendorDocumentsPage() {
  return (
    <Suspense>
      <DocumentQueue />
    </Suspense>
  );
}
