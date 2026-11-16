'use client';

import { GST_REGISTRATION_LABELS, VENDOR_TYPE_LABELS } from '@kenzo/shared';
import { Building2, Copy, MapPin, Pencil, ShieldAlert, Store } from 'lucide-react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, ErrorState, PageLoading } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/misc';
import { Breadcrumbs } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { EditVendorDrawer } from '@/components/vendors/edit-vendor-drawer';
import { VendorLifecycleActions } from '@/components/vendors/lifecycle-actions';
import { ApprovalsTab, BankTab, ContactsTab, DocumentsTab, HistoryTab, OverviewTab, PerformanceTab } from '@/components/vendors/vendor-tabs';
import { BankStatusBadge, LifecycleStepper, ProgressRing, VendorStatusBadge } from '@/components/vendors/vendor-ui';
import { formatDate, relativeTime } from '@/lib/format';
import { useInvalidateVendors, useVendor360 } from '@/lib/vendor-queries';

const TABS = ['overview', 'contacts', 'documents', 'bank', 'approvals', 'history', 'performance'] as const;
type Tab = (typeof TABS)[number];

function Vendor360Content() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const q = useVendor360(id);
  const invalidate = useInvalidateVendors();
  const [editing, setEditing] = useState(false);
  const tabParam = params.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'overview';
  const setTab = (t: string) => {
    const next = new URLSearchParams(params.toString());
    if (t === 'overview') next.delete('tab');
    else next.set('tab', t);
    next.delete('created');
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };
  const refresh = async () => {
    await invalidate(id);
    await q.refetch();
  };

  if (q.isLoading) return <PageLoading rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const v = d.vendor;
  const editable = d.viewer.canEdit && !['SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED'].includes(v.status);
  const docAttention = d.compliance.requirements.filter((r) => r.state !== 'VERIFIED').length;
  const pendingBank = d.bank.changeRequests.some((r) => r.status === 'PENDING_APPROVAL');
  const bankStatus = d.bank.accounts.some((a) => a.status === 'ACTIVE')
    ? 'VERIFIED'
    : d.bank.accounts.some((a) => a.status === 'PROPOSED')
      ? 'PENDING'
      : 'NONE';

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(v.vendorCode);
      toast.info('Vendor code copied', v.vendorCode);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-col gap-4">
        <Breadcrumbs items={[{ label: 'Vendors', href: '/vendors' }, { label: 'Directory', href: '/vendors/directory' }, { label: v.legalName }]} />
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-1 gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <Store className="size-6" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight text-fg">{v.legalName}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                  <button
                    type="button"
                    onClick={copyCode}
                    className="inline-flex items-center gap-1 font-mono text-xs hover:text-fg"
                    aria-label={`Copy vendor code ${v.vendorCode}`}
                  >
                    {v.vendorCode} <Copy className="size-3" aria-hidden />
                  </button>
                  {v.tradeName && <span>t/a {v.tradeName}</span>}
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="size-3.5" aria-hidden /> {VENDOR_TYPE_LABELS[v.vendorType]} · {v.category}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden /> {v.city}, {v.state}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <VendorStatusBadge status={v.status} />
                  <Badge>{GST_REGISTRATION_LABELS[v.gstRegistrationType]}</Badge>
                  {v.msmeRegistered && <Badge tone="info">MSME</Badge>}
                  <BankStatusBadge status={bankStatus} />
                  {pendingBank && <Badge tone="warning">Bank change pending</Badge>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {editable && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden /> Edit
                </Button>
              )}
              <VendorLifecycleActions data={d} onChanged={refresh} />
            </div>
          </div>
          <div className="grid gap-4 border-t border-border bg-surface-muted/40 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <LifecycleStepper status={v.status} />
            <div className="flex items-center gap-3 md:border-l md:border-border md:pl-5">
              <ProgressRing
                value={d.compliance.verifiedCount}
                max={d.compliance.requirements.length}
                size={44}
                label="Compliance"
                tone={d.compliance.compliant ? 'success' : 'warning'}
              />
              <div className="text-xs">
                <p className="font-medium text-fg">
                  {d.compliance.compliant ? 'Compliant' : `${docAttention} document${docAttention === 1 ? '' : 's'} need attention`}
                </p>
                <p className="text-fg-subtle">
                  Created {formatDate(v.createdAt)} · updated {relativeTime(v.updatedAt)}
                </p>
              </div>
            </div>
          </div>
          {v.statusReason && ['REJECTED', 'SUSPENDED', 'DRAFT'].includes(v.status) && (
            <div className="border-t border-border px-5 py-3">
              <Alert tone={v.status === 'DRAFT' ? 'info' : 'warning'} title={v.status === 'DRAFT' ? 'Latest note' : 'Reason'}>
                {v.statusReason}
              </Alert>
            </div>
          )}
          {v.duplicateOverrideReason && (
            <div className="flex items-start gap-2 border-t border-border px-5 py-2.5 text-xs text-fg-muted">
              <ShieldAlert className="mt-0.5 size-3.5 text-warning" aria-hidden /> Created despite a duplicate warning: “{v.duplicateOverrideReason}”
            </div>
          )}
        </Card>
      </div>

      <Tabs
        className="mb-6 overflow-x-auto"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'contacts', label: 'Contacts', count: d.contacts.length },
          { value: 'documents', label: 'Documents', count: docAttention || undefined },
          { value: 'bank', label: 'Bank' },
          { value: 'approvals', label: 'Approvals', count: d.approvals.filter((a) => a.myPendingTaskId).length || undefined },
          { value: 'history', label: 'History' },
          { value: 'performance', label: 'Performance' },
        ]}
      />
      <div key={tab} className="animate-fade-in" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <OverviewTab data={d} onGoTo={setTab} refresh={refresh} />}
        {tab === 'contacts' && <ContactsTab data={d} refresh={refresh} />}
        {tab === 'documents' && <DocumentsTab data={d} refresh={refresh} highlightUpload={params.get('created') === '1'} />}
        {tab === 'bank' && <BankTab data={d} refresh={refresh} />}
        {tab === 'approvals' && <ApprovalsTab data={d} refresh={refresh} />}
        {tab === 'history' && <HistoryTab data={d} />}
        {tab === 'performance' && <PerformanceTab data={d} />}
      </div>
      {editing && <EditVendorDrawer vendor={v} onClose={() => setEditing(false)} onSaved={refresh} />}
    </>
  );
}

export default function VendorDetailPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Vendor360Content />
    </Suspense>
  );
}
