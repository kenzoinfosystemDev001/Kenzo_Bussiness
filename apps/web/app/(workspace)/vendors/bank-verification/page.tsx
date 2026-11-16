'use client';

import { ArrowRight, Landmark, ShieldCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { DecisionPanel } from '@/components/vendors/decision-panel';
import { VendorStatusBadge } from '@/components/vendors/vendor-ui';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize, relativeTime } from '@/lib/format';
import { useAnyPermission, useSession } from '@/lib/session';
import { useBankQueue, useInvalidateVendors } from '@/lib/vendor-queries';
import type { BankAccountView, BankChangeStatus } from '@/lib/vendors';

const STATUSES: Array<{ value: BankChangeStatus; label: string }> = [
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function AccountBox({ title, account, tone }: { title: string; account: BankAccountView | null; tone: 'old' | 'new' }) {
  return (
    <div className={cn('flex-1 rounded-lg border p-3', tone === 'new' ? 'border-primary/30 bg-primary-soft/30' : 'border-border bg-surface-muted/40')}>
      <p className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</p>
      {account ? (
        <div className="mt-1.5 flex flex-col gap-0.5 text-sm">
          <p className="font-medium text-fg">{account.bankName}</p>
          <p className="text-fg-muted">{account.accountHolderName}</p>
          <p className="font-mono tracking-wider text-fg">{account.accountMasked}</p>
          <p className="font-mono text-xs text-fg-subtle">
            {account.swiftCode ? `SWIFT ${account.swiftCode}` : `IFSC ${account.ifsc ?? '—'}`} · {humanize(account.accountType)}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-sm text-fg-subtle">No previous account</p>
      )}
    </div>
  );
}

function BankQueue() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const allowed = useAnyPermission(['vendor.read']);
  const status = (STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'PENDING_APPROVAL') as BankChangeStatus;
  const q = useBankQueue(status);
  const invalidate = useInvalidateVendors();

  if (!allowed) return <PermissionDenied />;
  const items = q.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Bank verification"
        description="Every change to vendor bank details is a maker-checker approval. The person who proposed a change — and the vendor's creator — can never approve it."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Bank verification' }]}
      />
      <Alert tone="info" className="mb-6" title="Before you approve">
        Confirm the new account independently (call the vendor on a known number or check the signed bank letter). Never rely on contact details supplied with
        the change request itself.
      </Alert>
      <Card className="overflow-hidden">
        <Tabs
          className="px-4"
          value={status}
          onChange={(v) => router.replace(`${pathname}?status=${v}`, { scroll: false })}
          items={STATUSES.map((s) => ({ value: s.value, label: s.label, count: s.value === status ? items.length : undefined }))}
        />
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Landmark} title={status === 'PENDING_APPROVAL' ? 'No bank changes waiting' : `No ${humanize(status).toLowerCase()} requests`} />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((r) => {
              const isMine = r.requestedById === session?.user.id;
              return (
                <li key={r.id} className="flex flex-col gap-4 px-5 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/vendors/${r.vendor.id}?tab=bank`} className="font-medium text-fg hover:underline">
                      {r.vendor.legalName}
                    </Link>
                    <span className="font-mono text-xs text-fg-subtle">{r.vendor.vendorCode}</span>
                    <VendorStatusBadge status={r.vendor.status} />
                    <StatusBadge status={r.status} className="ml-auto" />
                  </div>
                  <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
                    <AccountBox title="Current account" account={r.previousAccount} tone="old" />
                    <ArrowRight className="mx-auto size-5 shrink-0 rotate-90 text-fg-subtle md:rotate-0" aria-hidden />
                    <AccountBox title="Proposed account" account={r.proposedAccount} tone="new" />
                  </div>
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
                    <p className="text-fg-muted">
                      Requested by <span className="font-medium text-fg">{r.requestedBy.fullName}</span> ·{' '}
                      <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>
                        {relativeTime(r.createdAt)}
                      </time>
                      {isMine && (
                        <Badge tone="info" className="ml-2">
                          You
                        </Badge>
                      )}
                    </p>
                    {r.approval && r.approval.pendingWith.length > 0 && (
                      <p className="inline-flex items-center gap-1.5 text-fg-muted">
                        <Users className="size-3.5" aria-hidden /> Waiting on {r.approval.pendingWith.join(', ')}
                      </p>
                    )}
                    {r.status === 'APPROVED' && (
                      <p className="inline-flex items-center gap-1.5 text-success">
                        <ShieldCheck className="size-3.5" aria-hidden /> Verified and active
                      </p>
                    )}
                  </div>
                  <p className="rounded-md bg-surface-muted/60 px-3 py-2 text-sm text-fg">“{r.reason}”</p>
                  {r.outcomeReason && <p className="text-sm text-fg-muted">Outcome: “{r.outcomeReason}”</p>}
                  {r.approval?.myTaskId ? (
                    <DecisionPanel
                      taskId={r.approval.myTaskId}
                      subject={`Bank change for ${r.vendor.legalName}`}
                      onDecided={() => invalidate(r.vendor.id)}
                      compact
                    />
                  ) : (
                    r.status === 'PENDING_APPROVAL' && (
                      <p className="text-xs text-fg-subtle">
                        {isMine ? 'You requested this change, so you cannot approve it.' : 'This approval is assigned to someone else.'}
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function BankVerificationPage() {
  return (
    <Suspense>
      <BankQueue />
    </Suspense>
  );
}
