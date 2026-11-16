'use client';

import { GST_REGISTRATION_LABELS, VENDOR_DOCUMENT_LABELS, VENDOR_TYPE_LABELS } from '@kenzo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, ExternalLink, Inbox, ScanSearch } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, KeyValue } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { DecisionPanel } from '@/components/vendors/decision-panel';
import { DownloadButton, VerifyControls } from '@/components/vendors/document-actions';
import { DuplicateList, ExpiryBadge, ProgressRing, RequirementIcon, VendorStatusBadge, VerificationBadge } from '@/components/vendors/vendor-ui';
import { errorMessage, get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useAnyPermission, usePermission } from '@/lib/session';
import type { Page, TaskRow } from '@/lib/types';
import { useInvalidateVendors, useVendor360, useVendorList } from '@/lib/vendor-queries';
import type { DuplicateMatch } from '@/lib/vendors';

function ReviewDetail({ id }: { id: string }) {
  const toast = useToast();
  const q = useVendor360(id);
  const invalidate = useInvalidateVendors();
  const refresh = async () => {
    await invalidate(id);
    await q.refetch();
  };
  const v = q.data?.vendor;
  const dup = useQuery({
    queryKey: ['vendors', 'review-dup', id, v?.legalName, v?.gstin],
    queryFn: () =>
      post<{ matches: DuplicateMatch[] }>('/vendors/duplicate-check', { legalName: v!.legalName, gstin: v!.gstin ?? undefined, excludeVendorId: id }),
    enabled: !!v,
  });
  const startReview = useMutation({
    mutationFn: () => post(`/vendors/${id}/start-review`),
    onSuccess: async () => {
      toast.success('Review started');
      await refresh();
    },
    onError: (e) => toast.error('Could not start review', errorMessage(e)),
  });

  if (q.isLoading) return <Skeleton className="h-[480px]" />;
  if (q.error || !q.data || !v) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const current = d.documents.filter((doc) => doc.isCurrent);

  return (
    <div key={id} className="flex flex-col gap-4 animate-fade-in">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{v.legalName}</h2>
            <p className="text-sm text-fg-muted">
              <span className="font-mono text-xs">{v.vendorCode}</span> · {VENDOR_TYPE_LABELS[v.vendorType]} · {v.category} · {v.city}, {v.state}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <VendorStatusBadge status={v.status} />
              <Badge>{GST_REGISTRATION_LABELS[v.gstRegistrationType]}</Badge>
              {v.msmeRegistered && <Badge tone="info">MSME</Badge>}
            </div>
          </div>
          <div className="flex gap-2">
            {v.status === 'SUBMITTED' && d.viewer.pendingApprovalTaskId && (
              <Button variant="secondary" onClick={() => startReview.mutate()} loading={startReview.isPending}>
                <ScanSearch aria-hidden /> Start review
              </Button>
            )}
            <Link
              href={`/vendors/${id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary hover:bg-primary-soft"
            >
              Open 360 <ExternalLink className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="border-t border-border px-5 py-4">
          <KeyValue
            columns={3}
            items={[
              { label: 'GSTIN', value: v.gstin ?? '—', mono: true },
              { label: 'PAN', value: v.panMasked ?? '—', mono: true },
              { label: 'Payment terms', value: `${v.paymentTermsDays} days` },
              { label: 'Primary contact', value: d.contacts.find((c) => c.isPrimary)?.name ?? d.contacts[0]?.name ?? '—' },
              { label: 'Submitted', value: v.submittedAt ? relativeTime(v.submittedAt) : '—' },
              {
                label: 'Bank',
                value:
                  d.bank.accounts
                    .filter((a) => a.status !== 'SUPERSEDED')
                    .map((a) => `${a.bankName} ${a.accountMasked}`)
                    .join(', ') || 'Not provided',
              },
            ]}
          />
        </div>
      </Card>

      {d.viewer.pendingApprovalTaskId ? (
        <DecisionPanel taskId={d.viewer.pendingApprovalTaskId} subject={v.legalName} onDecided={refresh} />
      ) : (
        <Alert tone="info">You do not have a pending approval task for this vendor. You can still verify documents if you hold verification rights.</Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Compliance checklist" />
          <CardBody className="flex items-start gap-4">
            <ProgressRing
              value={d.compliance.verifiedCount}
              max={d.compliance.requirements.length}
              label="Required documents verified"
              tone={d.compliance.compliant ? 'success' : 'warning'}
            />
            <ul className="flex flex-1 flex-col gap-2">
              {d.compliance.requirements.map((r) => (
                <li key={r.documentType} className="flex items-center gap-2 text-sm">
                  <RequirementIcon state={r.state} />
                  <span className="flex-1 text-fg-muted">{r.label}</span>
                </li>
              ))}
              <li className="flex items-center gap-2 text-sm">
                <RequirementIcon state={d.contacts.length ? 'VERIFIED' : 'MISSING'} />
                <span className="flex-1 text-fg-muted">At least one contact ({d.contacts.length})</span>
              </li>
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Duplicate check" description="Re-run against the current vendor master" />
          <CardBody>
            {dup.isLoading ? (
              <Skeleton className="h-20" />
            ) : dup.data?.matches.length ? (
              <DuplicateList matches={dup.data.matches} compact />
            ) : (
              <p className="text-sm text-success">No other vendor shares this name or GSTIN.</p>
            )}
            {v.duplicateOverrideReason && <p className="mt-3 text-xs text-fg-muted">Creator’s duplicate override: “{v.duplicateOverrideReason}”</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Documents"
          description={d.viewer.canVerifyDocuments ? 'Verify each document against the original. You cannot verify documents you uploaded.' : undefined}
        />
        {current.length === 0 ? (
          <EmptyState title="No documents uploaded" />
        ) : (
          <ul className="divide-y divide-border">
            {current.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {VENDOR_DOCUMENT_LABELS[doc.documentType]} <span className="text-xs font-normal text-fg-subtle">v{doc.versionNo}</span>
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {doc.document.originalName} · uploaded by {doc.uploadedBy.fullName}
                    {doc.documentNumber ? ` · No. ${doc.documentNumber}` : ''}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <VerificationBadge status={doc.verificationStatus} />
                    <ExpiryBadge expiryDate={doc.expiryDate} />
                  </div>
                </div>
                <DownloadButton documentId={doc.documentId} label="View" />
                {d.viewer.canVerifyDocuments && doc.verificationStatus === 'PENDING' && (
                  <VerifyControls vendorId={id} vendorDocumentId={doc.id} onDone={refresh} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReviewWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = useAnyPermission(['vendor.approve', 'approval.task.act', 'vendor.read']);
  const list = useVendorList({ status: 'SUBMITTED,UNDER_REVIEW', sort: 'updatedAt', order: 'asc', pageSize: 100 }, allowed);
  const canAct = usePermission('approval.task.act');
  const tasks = useQuery({
    queryKey: ['approvals', 'tasks', 'vendor-review'],
    queryFn: () => get<Page<TaskRow>>('/approvals/tasks', { status: 'PENDING', limit: 100 }),
    enabled: canAct,
  });
  const myVendorTasks = new Set((tasks.data?.items ?? []).filter((t) => t.instance.entityType === 'vendor').map((t) => t.instance.entityId));
  const items = [...(list.data?.items ?? [])].sort((a, b) => Number(myVendorTasks.has(b.id)) - Number(myVendorTasks.has(a.id)));
  const selected = params.get('vendor') ?? items[0]?.id ?? null;
  const select = (id: string) => router.replace(`${pathname}?vendor=${id}`, { scroll: false });

  useEffect(() => {
    if (!params.get('vendor') && items[0]) select(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select first item once loaded
  }, [items[0]?.id]);

  if (!allowed) return <PermissionDenied />;

  return (
    <>
      <PageHeader
        title="Review workspace"
        description="Vendors waiting for onboarding approval. Items assigned to you are listed first."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Review workspace' }]}
        meta={myVendorTasks.size > 0 && <Badge tone="warning">{myVendorTasks.size} assigned to you</Badge>}
      />
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.isLoading && items.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardCheck} title="Nothing to review" description="Submitted vendors appear here for independent review." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
            <ul role="listbox" aria-label="Vendors awaiting review" className="divide-y divide-border">
              {list.isLoading
                ? Array.from({ length: 5 }, (_, i) => (
                    <li key={i} className="p-4">
                      <Skeleton className="h-10" />
                    </li>
                  ))
                : items.map((v) => {
                    const active = v.id === selected;
                    const mine = myVendorTasks.has(v.id);
                    return (
                      <li key={v.id} role="option" aria-selected={active}>
                        <button
                          type="button"
                          onClick={() => select(v.id)}
                          className={cn(
                            'flex w-full flex-col gap-1.5 border-l-2 px-4 py-3 text-left transition-colors duration-150',
                            active ? 'border-primary bg-primary-soft/50' : 'border-transparent hover:bg-surface-muted/60',
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-fg">{v.legalName}</span>
                            {mine && <span className="size-2 shrink-0 rounded-full bg-warning" aria-label="Assigned to you" />}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                            <VendorStatusBadge status={v.status} />
                            {v.submittedAt && <span>{relativeTime(v.submittedAt)}</span>}
                            {v.documentSummary.pending > 0 && <Badge tone="info">{v.documentSummary.pending} to verify</Badge>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </Card>
          {selected ? <ReviewDetail id={selected} /> : <EmptyState icon={Inbox} title="Select a vendor" />}
        </div>
      )}
    </>
  );
}

export default function VendorReviewPage() {
  return (
    <Suspense>
      <ReviewWorkspace />
    </Suspense>
  );
}
