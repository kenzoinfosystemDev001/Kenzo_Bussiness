'use client';

import { VENDOR_STATUSES, VENDOR_STATUS_LABELS, VENDOR_TYPE_LABELS, GST_REGISTRATION_LABELS } from '@kenzo/shared';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  FileClock,
  FileWarning,
  Landmark,
  PauseCircle,
  Plus,
  ScanSearch,
  Store,
  Timer,
  Users2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { BarList, DistributionBar, GroupedColumnChart } from '@/components/vendors/charts';
import { VendorStatusBadge } from '@/components/vendors/vendor-ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { usePermission } from '@/lib/session';
import { useVendorStats } from '@/lib/vendor-queries';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-fg-subtle/40',
  SUBMITTED: 'bg-primary/50',
  UNDER_REVIEW: 'bg-warning',
  APPROVED: 'bg-primary',
  ACTIVE: 'bg-success',
  REJECTED: 'bg-danger/70',
  SUSPENDED: 'bg-danger',
  ARCHIVED: 'bg-border-strong',
};

function Kpi({
  label,
  value,
  hint,
  icon,
  href,
  tone = 'neutral',
}: {
  label: string;
  value: number | undefined;
  hint: string;
  icon: ReactNode;
  href: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  return (
    <Link
      href={href}
      className="group rounded-lg border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-overlay focus-visible:-translate-y-0.5"
    >
      <div className="flex items-center justify-between text-sm text-fg-muted">
        {label}
        <span className="text-fg-subtle transition-colors duration-150 group-hover:text-primary">{icon}</span>
      </div>
      <div
        className={cn(
          'tabular mt-2 text-2xl font-semibold tracking-tight',
          { neutral: 'text-fg', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone],
        )}
      >
        {value === undefined ? <Skeleton className="h-8 w-12" /> : value}
      </div>
      <div className="mt-1 text-xs text-fg-subtle">{hint}</div>
    </Link>
  );
}

function AlertCard({
  count,
  label,
  description,
  href,
  icon,
  tone,
}: {
  count: number;
  label: string;
  description: string;
  href: string;
  icon: ReactNode;
  tone: 'warning' | 'danger' | 'info';
}) {
  const active = count > 0;
  const styles = {
    warning: 'border-warning/30 bg-warning-soft text-warning',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    info: 'border-primary/25 bg-primary-soft text-primary',
  }[tone];
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-lg border p-3.5 transition-[background-color,border-color,transform] duration-200 hover:-translate-y-0.5',
        active ? styles : 'border-border bg-surface text-fg-subtle hover:border-border-strong',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface/70">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          <span className="tabular mr-1 text-md font-semibold">{count}</span>
          {label}
        </p>
        <p className="truncate text-xs text-fg-muted">{active ? description : 'Nothing needs attention'}</p>
      </div>
      <ArrowRight
        className="size-4 shrink-0 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
        aria-hidden
      />
    </Link>
  );
}

export default function VendorOverviewPage() {
  const router = useRouter();
  const canRead = usePermission('vendor.read');
  const canCreate = usePermission('vendor.create');
  const q = useVendorStats(canRead);
  if (!canRead) return <PermissionDenied />;
  const s = q.data;

  const header = (
    <PageHeader
      title="Vendors"
      description="The single source of truth for every supplier — onboarding, compliance and verification at a glance."
      breadcrumbs={[{ label: 'Vendors' }, { label: 'Overview' }]}
      actions={
        <>
          <Link href="/vendors/directory" className={buttonVariants({ variant: 'secondary' })}>
            Open directory
          </Link>
          {canCreate && (
            <Link href="/vendors/new" className={buttonVariants()}>
              <Plus aria-hidden /> New vendor
            </Link>
          )}
        </>
      }
    />
  );

  if (q.error)
    return (
      <>
        {header}
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  if (s && s.totals.all === 0 && s.byStatus.ARCHIVED === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Store}
            title="No vendors yet"
            description="Onboard your first supplier. Each vendor is validated, duplicate-checked and approved before it can be used on purchase orders or payments."
            action={
              canCreate ? (
                <Button onClick={() => router.push('/vendors/new')}>
                  <Plus aria-hidden /> Add the first vendor
                </Button>
              ) : undefined
            }
          />
        </Card>
      </>
    );
  }

  const segments = VENDOR_STATUSES.filter((st) => st !== 'ARCHIVED').map((st) => ({
    key: st,
    label: VENDOR_STATUS_LABELS[st],
    value: s?.byStatus[st] ?? 0,
    className: STATUS_COLORS[st]!,
  }));

  return (
    <div className="flex flex-col gap-6">
      {header}
      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi
          label="Active vendors"
          value={s?.totals.active}
          hint="Usable on POs & payments"
          icon={<BadgeCheck className="size-4" />}
          href="/vendors/directory?status=ACTIVE"
          tone="success"
        />
        <Kpi
          label="In review"
          value={s?.totals.inReview}
          hint="Submitted or under review"
          icon={<ScanSearch className="size-4" />}
          href="/vendors/directory?status=SUBMITTED,UNDER_REVIEW"
          tone={(s?.totals.inReview ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <Kpi
          label="Awaiting activation"
          value={s?.totals.awaitingActivation}
          hint="Approved, not yet active"
          icon={<Timer className="size-4" />}
          href="/vendors/directory?status=APPROVED"
        />
        <Kpi label="Drafts" value={s?.totals.drafts} hint="Not yet submitted" icon={<FileClock className="size-4" />} href="/vendors/directory?status=DRAFT" />
        <Kpi
          label="Suspended"
          value={s?.totals.suspended}
          hint="Blocked from new business"
          icon={<PauseCircle className="size-4" />}
          href="/vendors/directory?status=SUSPENDED"
          tone={(s?.totals.suspended ?? 0) > 0 ? 'danger' : 'neutral'}
        />
        <Kpi label="MSME vendors" value={s?.totals.msme} hint="Udyam registered" icon={<Users2 className="size-4" />} href="/vendors/directory?msme=true" />
      </section>

      <section aria-label="Compliance alerts" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {s ? (
          <>
            <AlertCard
              count={s.compliance.documentsPendingVerification}
              label="documents to verify"
              description="Independent verification required"
              href="/vendors/documents?filter=pending_verification"
              icon={<FileClock className="size-4" />}
              tone="info"
            />
            <AlertCard
              count={s.compliance.documentsExpiringSoon}
              label="expiring soon"
              description={`Within ${s.compliance.warningDays} days`}
              href="/vendors/documents?filter=expiring"
              icon={<CalendarClock className="size-4" />}
              tone="warning"
            />
            <AlertCard
              count={s.compliance.documentsExpired}
              label="expired documents"
              description="Vendors are non-compliant until replaced"
              href="/vendors/documents?filter=expired"
              icon={<FileWarning className="size-4" />}
              tone="danger"
            />
            <AlertCard
              count={s.compliance.bankChangesPending}
              label="bank changes pending"
              description="Maker-checker approval needed"
              href="/vendors/bank-verification"
              icon={<Landmark className="size-4" />}
              tone="warning"
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[68px]" />)
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Onboarding trend" description="Vendors created vs activated, last 6 months" />
          <CardBody>
            {s ? (
              <GroupedColumnChart
                title="Vendors created and activated per month"
                months={s.trend.months}
                series={[
                  { label: 'Created', values: s.trend.created, className: 'fill-primary/35', swatch: 'bg-primary/35' },
                  { label: 'Activated', values: s.trend.activated, className: 'fill-success', swatch: 'bg-success' },
                ]}
              />
            ) : (
              <Skeleton className="h-48" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Status distribution" description="Excludes archived vendors" />
          <CardBody>
            {s ? (
              <DistributionBar segments={segments} onSelect={(seg) => router.push(`/vendors/directory?status=${seg.key}`)} />
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top categories" />
          <CardBody>
            {!s ? (
              <Skeleton className="h-40" />
            ) : s.byCategory.length ? (
              <BarList
                items={s.byCategory.map((c) => ({ key: c.category, label: c.category, value: c.count }))}
                onSelect={(k) => router.push(`/vendors/directory?category=${encodeURIComponent(k)}`)}
              />
            ) : (
              <p className="text-sm text-fg-subtle">No categories yet</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="By vendor type" />
          <CardBody>
            {!s ? (
              <Skeleton className="h-40" />
            ) : (
              <BarList
                items={[...s.byType]
                  .sort((a, b) => b.count - a.count)
                  .map((t) => ({ key: t.vendorType, label: VENDOR_TYPE_LABELS[t.vendorType], value: t.count }))}
                onSelect={(k) => router.push(`/vendors/directory?vendorType=${k}`)}
              />
            )}
            {s && s.byGstRegistration.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-subtle">GST registration</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {s.byGstRegistration.map((g) => (
                    <li key={g.gstRegistrationType} className="flex justify-between gap-2">
                      <span className="text-fg-muted">{GST_REGISTRATION_LABELS[g.gstRegistrationType]}</span>
                      <span className="tabular font-medium text-fg">{g.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recently updated"
            actions={
              <Link href="/vendors/directory?sort=updatedAt" className="text-sm font-medium text-primary hover:underline">
                All
              </Link>
            }
          />
          {!s ? (
            <CardBody>
              <Skeleton className="h-40" />
            </CardBody>
          ) : s.recent.length ? (
            <ul className="divide-y divide-border">
              {s.recent.map((v) => (
                <li key={v.id}>
                  <Link href={`/vendors/${v.id}`} className="flex items-center gap-3 px-5 py-2.5 transition-colors duration-150 hover:bg-surface-muted/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{v.legalName}</p>
                      <p className="truncate text-xs text-fg-subtle">
                        {v.vendorCode} · {v.category} · {relativeTime(v.updatedAt)}
                      </p>
                    </div>
                    <VendorStatusBadge status={v.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={AlertTriangle} title="No recent activity" />
          )}
        </Card>
      </div>
    </div>
  );
}
