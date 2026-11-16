'use client';

import {
  GST_REGISTRATION_LABELS,
  VENDOR_DOCUMENT_LABELS,
  VENDOR_STATUS_LABELS,
  VENDOR_TYPE_LABELS,
  vendorContactSchema,
  type VendorDocumentType,
} from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Eye, FileText, History, Landmark, Mail, Pencil, Phone, Plus, ShieldCheck, Star, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, KeyValue } from '@/components/ui/card';
import { ConfirmDialog, Drawer } from '@/components/ui/dialog';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Checkbox, FormField, Input } from '@/components/ui/form';
import { Avatar } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ActivityTimeline } from '@/components/workflow/activity-timeline';
import { del, errorMessage, patch, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { serverFieldErrors, validate } from '@/lib/forms';
import { formatDate, formatDateTime, humanize, relativeTime } from '@/lib/format';
import { usePermission } from '@/lib/session';
import { EMPTY_BANK, type BankDraft } from '@/lib/vendor-wizard';
import type { BankAccountView, Vendor360, VendorContact, VendorDocumentRow } from '@/lib/vendors';
import { DecisionPanel } from './decision-panel';
import { DownloadButton, UploadDocumentDrawer, VerifyControls } from './document-actions';
import { RevealDialog } from './reveal-dialog';
import { ExpiryBadge, FutureModulePanel, ProgressRing, RequirementIcon, ScoreBar, VendorStatusBadge, VerificationBadge } from './vendor-ui';
import { BankFields } from './wizard-steps';

type Refresh = () => Promise<void>;

// ── Overview ──────────────────────────────────────────────────────────────────

export function OverviewTab({ data, onGoTo, refresh }: { data: Vendor360; onGoTo: (tab: string) => void; refresh: Refresh }) {
  const v = data.vendor;
  const [revealPan, setRevealPan] = useState(false);
  const c = data.compliance;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Business profile" />
          <CardBody>
            <KeyValue
              items={[
                { label: 'Legal name', value: v.legalName },
                { label: 'Trade name', value: v.tradeName ?? '—' },
                { label: 'Vendor type', value: VENDOR_TYPE_LABELS[v.vendorType] },
                { label: 'Category', value: v.category },
                { label: 'GST registration', value: GST_REGISTRATION_LABELS[v.gstRegistrationType] },
                { label: 'GSTIN', value: v.gstin ?? '—', mono: true },
                {
                  label: 'PAN',
                  value: v.hasPan ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="font-mono">{v.panMasked}</span>
                      {data.bank.canReveal && (
                        <button
                          type="button"
                          onClick={() => setRevealPan(true)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Eye className="size-3.5" aria-hidden /> Reveal
                        </button>
                      )}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Registration no.', value: v.registrationNumber ?? '—', mono: true },
                { label: 'MSME', value: v.msmeRegistered ? <span className="font-mono text-sm">{v.msmeNumber}</span> : 'Not registered' },
                { label: 'Payment terms', value: `${v.paymentTermsDays} days · ${v.preferredCurrency}` },
                {
                  label: 'Address',
                  value: (
                    <span>
                      {v.addressLine1}
                      {v.addressLine2 ? `, ${v.addressLine2}` : ''}
                      <br />
                      {v.city}, {v.state} {v.postalCode} · {v.country}
                    </span>
                  ),
                },
                {
                  label: 'Channels',
                  value: (
                    <span className="flex flex-col gap-0.5 text-sm">
                      {v.email && (
                        <a href={`mailto:${v.email}`} className="text-primary hover:underline">
                          {v.email}
                        </a>
                      )}
                      {v.phone && <span>{v.phone}</span>}
                      {v.website && (
                        <a href={v.website} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">
                          {v.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                      {!v.email && !v.phone && !v.website && '—'}
                    </span>
                  ),
                },
              ]}
            />
            {v.internalNotes && (
              <div className="mt-5 rounded-md border border-border bg-surface-muted/60 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Internal notes</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{v.internalNotes}</p>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Transactions & relationships" description="RFQs, purchase orders, invoices and payments link here as their modules ship." />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            {data.relations.map((r) => (
              <FutureModulePanel key={r.key} label={r.label} phase={r.phase} />
            ))}
          </CardBody>
        </Card>
      </div>
      <div className="flex flex-col gap-6">
        {data.viewer.pendingApprovalTaskId && <DecisionPanel taskId={data.viewer.pendingApprovalTaskId} subject={v.legalName} onDecided={refresh} />}
        <Card>
          <CardHeader
            title="Compliance"
            actions={
              <Button variant="ghost" size="sm" onClick={() => onGoTo('documents')}>
                Documents <ArrowRight aria-hidden />
              </Button>
            }
          />
          <CardBody className="flex items-center gap-4">
            <ProgressRing value={c.verifiedCount} max={c.requirements.length} label="Required documents verified" tone={c.compliant ? 'success' : 'warning'} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{c.compliant ? 'Fully compliant' : `${c.verifiedCount} of ${c.requirements.length} verified`}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {c.requirements.map((r) => (
                  <li key={r.documentType} className="flex items-center gap-2 text-sm">
                    <RequirementIcon state={r.state} />
                    <span className="truncate text-fg-muted">{r.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Performance"
            actions={
              <Button variant="ghost" size="sm" onClick={() => onGoTo('performance')}>
                Details <ArrowRight aria-hidden />
              </Button>
            }
          />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl font-semibold text-fg">{data.performance.overall ?? '—'}</span>
              <span className="text-sm text-fg-subtle">/ 100 · {data.performance.measuredCount} indicators measured</span>
            </div>
            {data.performance.indicators
              .filter((i) => i.status === 'measured')
              .map((i) => (
                <div key={i.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-fg-muted">{i.label}</span>
                  <ScoreBar score={i.score} />
                </div>
              ))}
          </CardBody>
        </Card>
      </div>
      <RevealDialog
        open={revealPan}
        onOpenChange={setRevealPan}
        title="Reveal PAN"
        endpoint={`/vendors/${v.id}/pan/reveal`}
        pick={(r) => (typeof r.pan === 'string' ? r.pan : null)}
      />
    </div>
  );
}

// ── Contacts ──────────────────────────────────────────────────────────────────

function ContactDrawer({ vendorId, contact, onClose, refresh }: { vendorId: string; contact: VendorContact | null; onClose: () => void; refresh: Refresh }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    designation: contact?.designation ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    isPrimary: contact?.isPrimary ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => (contact ? patch(`/vendors/${vendorId}/contacts/${contact.id}`, body) : post(`/vendors/${vendorId}/contacts`, body)),
    onSuccess: async () => {
      toast.success(contact ? 'Contact updated' : 'Contact added');
      onClose();
      await refresh();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(vendorContactSchema, form);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(v.data);
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={contact ? `Edit ${contact.name}` : 'Add contact'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Name" required error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="Designation" error={errors.designation}>
          <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        </FormField>
        <FormField label="Email" error={errors.email}>
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </FormField>
        <FormField label="Phone" error={errors.phone}>
          <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </FormField>
        <Checkbox
          label="Primary contact"
          description="Replaces the current primary contact."
          checked={form.isPrimary}
          onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })}
        />
      </form>
    </Drawer>
  );
}

export function ContactsTab({ data, refresh }: { data: Vendor360; refresh: Refresh }) {
  const toast = useToast();
  const editable = data.viewer.canEdit && !['SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED'].includes(data.vendor.status);
  const [editing, setEditing] = useState<VendorContact | 'new' | null>(null);
  const [removing, setRemoving] = useState<VendorContact | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/vendors/${data.vendor.id}/contacts/${id}`),
    onSuccess: async () => {
      toast.success('Contact removed');
      setRemoving(null);
      await refresh();
    },
  });
  return (
    <Card>
      <CardHeader
        title="Contact people"
        description={editable ? undefined : data.viewer.canEdit ? 'Contacts are locked while the vendor is under review or archived.' : undefined}
        actions={
          editable && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add contact
            </Button>
          )
        }
      />
      {data.contacts.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          description="At least one contact is required before submission."
          action={editable ? <Button onClick={() => setEditing('new')}>Add contact</Button> : undefined}
        />
      ) : (
        <ul className="grid gap-px bg-border sm:grid-cols-2">
          {data.contacts.map((c) => (
            <li key={c.id} className="group flex gap-3 bg-surface p-4">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-fg">
                  {c.name}
                  {c.isPrimary && (
                    <Badge tone="warning" icon={Star}>
                      Primary
                    </Badge>
                  )}
                </p>
                {c.designation && <p className="text-xs text-fg-subtle">{c.designation}</p>}
                <div className="mt-2 flex flex-col gap-1 text-sm">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 text-fg-muted hover:text-primary">
                      <Mail className="size-3.5" aria-hidden /> {c.email}
                    </a>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 text-fg-muted hover:text-primary">
                      <Phone className="size-3.5" aria-hidden /> {c.phone}
                    </a>
                  )}
                </div>
              </div>
              {editable && (
                <div className="flex flex-col gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  <Button variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ContactDrawer vendorId={data.vendor.id} contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} refresh={refresh} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'contact'}?`}
        confirmLabel="Remove"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </Card>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────

export function DocumentsTab({ data, refresh, highlightUpload }: { data: Vendor360; refresh: Refresh; highlightUpload?: boolean }) {
  const canDocUpload = usePermission('document.upload');
  const canUpload = data.viewer.canEdit && canDocUpload && !['SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED'].includes(data.vendor.status);
  const [uploadType, setUploadType] = useState<VendorDocumentType | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const current = data.documents.filter((d) => d.isCurrent);
  const byType = new Map<string, VendorDocumentRow[]>();
  for (const d of data.documents) byType.set(d.documentType, [...(byType.get(d.documentType) ?? []), d]);

  return (
    <div className="flex flex-col gap-6">
      {highlightUpload && data.vendor.status === 'DRAFT' && !data.compliance.compliant && (
        <Alert tone="info" title="Next: upload the required documents">
          Upload each required document below, then use <strong>Submit for approval</strong>. Documents are verified by someone other than the uploader.
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Required documents"
          description={`${data.compliance.verifiedCount} of ${data.compliance.requirements.length} verified and valid`}
          actions={
            canUpload && (
              <Button size="sm" onClick={() => setUploadType('OTHER')}>
                <Upload aria-hidden /> Upload other
              </Button>
            )
          }
        />
        <ul className="divide-y divide-border">
          {data.compliance.requirements.map((r) => {
            const doc = current.find((d) => d.id === r.vendorDocumentId);
            return (
              <li key={r.documentType} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <RequirementIcon state={r.state} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{r.label}</p>
                  <p className="text-xs text-fg-subtle">{doc ? `${doc.document.originalName} · v${doc.versionNo}` : 'Not uploaded'}</p>
                </div>
                {doc && <ExpiryBadge expiryDate={doc.expiryDate} />}
                <StatusBadge status={r.state} label={humanize(r.state)} />
                {canUpload && r.state !== 'VERIFIED' && (
                  <Button size="sm" variant={r.state === 'MISSING' ? 'primary' : 'secondary'} onClick={() => setUploadType(r.documentType)}>
                    <Upload aria-hidden /> {r.state === 'MISSING' ? 'Upload' : 'Replace'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="All documents" description="Current versions with verification status. Earlier versions are kept for audit." />
        {current.length === 0 ? (
          <EmptyState icon={FileText} title="No documents uploaded" />
        ) : (
          <ul className="divide-y divide-border">
            {current.map((d) => {
              const versions = byType.get(d.documentType) ?? [];
              const canVerify = data.viewer.canVerifyDocuments && d.verificationStatus === 'PENDING';
              return (
                <li key={d.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-subtle">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                        {d.title}
                        <Badge>v{d.versionNo}</Badge>
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {VENDOR_DOCUMENT_LABELS[d.documentType]}
                        {d.documentNumber ? ` · No. ${d.documentNumber}` : ''} · {d.document.originalName} · uploaded by {d.uploadedBy.fullName}{' '}
                        {relativeTime(d.createdAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <VerificationBadge status={d.verificationStatus} />
                        <ExpiryBadge expiryDate={d.expiryDate} />
                        {d.verifiedBy && (
                          <span className="text-xs text-fg-subtle">
                            {d.verificationStatus === 'VERIFIED' ? 'Verified' : 'Reviewed'} by {d.verifiedBy.fullName}{' '}
                            {d.verifiedAt ? `on ${formatDate(d.verifiedAt)}` : ''}
                          </span>
                        )}
                      </div>
                      {d.verificationNote && <p className="mt-2 rounded bg-surface-muted px-2 py-1 text-sm text-fg-muted">“{d.verificationNote}”</p>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex gap-1">
                        <DownloadButton documentId={d.documentId} />
                        {versions.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowHistory(showHistory === d.documentType ? null : d.documentType)}
                            aria-expanded={showHistory === d.documentType}
                          >
                            <History aria-hidden /> {versions.length} versions
                          </Button>
                        )}
                      </div>
                      {canVerify && <VerifyControls vendorId={data.vendor.id} vendorDocumentId={d.id} onDone={refresh} />}
                    </div>
                  </div>
                  {showHistory === d.documentType && (
                    <ol className="ml-12 mt-3 flex flex-col gap-2 border-l border-border pl-4 animate-fade-in" aria-label="Version history">
                      {versions.map((ver) => (
                        <li key={ver.id} className="relative text-sm">
                          <span
                            aria-hidden
                            className={cn(
                              'absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface',
                              ver.isCurrent ? 'bg-primary' : 'bg-border-strong',
                            )}
                          />
                          <span className="font-medium text-fg">v{ver.versionNo}</span> <span className="text-fg-muted">{ver.document.originalName}</span>{' '}
                          <span className="text-xs text-fg-subtle">
                            · {formatDateTime(ver.createdAt)} by {ver.uploadedBy.fullName} · {humanize(ver.verificationStatus)}
                            {ver.isCurrent ? ' · current' : ''}
                          </span>
                          <DownloadButton documentId={ver.documentId} label={`Download v${ver.versionNo}`} />
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {uploadType && (
        <UploadDocumentDrawer vendorId={data.vendor.id} open defaultType={uploadType} onOpenChange={(o) => !o && setUploadType(null)} onUploaded={refresh} />
      )}
    </div>
  );
}

// ── Bank ──────────────────────────────────────────────────────────────────────

function BankAccountCard({ account, vendorId, canReveal }: { account: BankAccountView; vendorId: string; canReveal: boolean }) {
  const [reveal, setReveal] = useState(false);
  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-shadow duration-200',
        account.status === 'ACTIVE' ? 'border-success/30 bg-success-soft/30' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium text-fg">
            <Landmark className="size-4 text-fg-subtle" aria-hidden />
            {account.bankName}
            {account.branchName && <span className="text-sm font-normal text-fg-subtle">· {account.branchName}</span>}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">{account.accountHolderName}</p>
        </div>
        <StatusBadge status={account.status === 'ACTIVE' ? 'VERIFIED' : account.status} label={account.status === 'ACTIVE' ? 'Verified · active' : undefined} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Account</span>
          <span className="font-mono tracking-wider text-fg">{account.accountMasked}</span>
          {canReveal && account.status !== 'SUPERSEDED' && (
            <button type="button" onClick={() => setReveal(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Eye className="size-3.5" aria-hidden /> Reveal
            </button>
          )}
        </span>
        <span>
          <span className="text-xs uppercase tracking-wide text-fg-subtle">{account.swiftCode ? 'SWIFT' : 'IFSC'}</span>{' '}
          <span className="ml-1 font-mono text-fg">{account.swiftCode ?? account.ifsc}</span>
        </span>
        <span className="text-xs text-fg-subtle">{humanize(account.accountType)}</span>
      </div>
      {account.verifiedBy && (
        <p className="mt-2 flex items-center gap-1 text-xs text-success">
          <ShieldCheck className="size-3.5" aria-hidden /> Verified by {account.verifiedBy.fullName}{' '}
          {account.verifiedAt ? `on ${formatDate(account.verifiedAt)}` : ''}
        </p>
      )}
      <RevealDialog
        open={reveal}
        onOpenChange={setReveal}
        title="Reveal account number"
        endpoint={`/vendors/${vendorId}/bank-accounts/${account.id}/reveal`}
        pick={(r) => (typeof r.accountNumber === 'string' ? r.accountNumber : null)}
      />
    </div>
  );
}

function BankFormDrawer({ data, mode, onClose, refresh }: { data: Vendor360; mode: 'onboarding' | 'change'; onClose: () => void; refresh: Refresh }) {
  const toast = useToast();
  const overseas = data.vendor.gstRegistrationType === 'OVERSEAS';
  const [bank, setBank] = useState<BankDraft>({ ...EMPTY_BANK, accountType: overseas ? 'OVERSEAS' : 'CURRENT' });
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const body = {
        ...bank,
        branchName: bank.branchName || null,
        ifsc: bank.accountType === 'OVERSEAS' ? null : bank.ifsc,
        swiftCode: bank.accountType === 'OVERSEAS' ? bank.swiftCode : null,
      };
      return mode === 'change'
        ? post(`/vendors/${data.vendor.id}/bank-change-requests`, { ...body, reason })
        : post(`/vendors/${data.vendor.id}/bank-account`, body);
    },
    onSuccess: async () => {
      toast.success(
        mode === 'change' ? 'Bank change requested' : 'Bank details saved',
        mode === 'change' ? 'An independent approver must verify it before it is used.' : 'Upload the bank verification document next.',
      );
      onClose();
      await refresh();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!bank.accountHolderName.trim()) errs.accountHolderName = 'Account holder name is required';
    if (!bank.bankName.trim()) errs.bankName = 'Bank name is required';
    if (bank.accountNumber !== bank.confirmAccountNumber) errs.confirmAccountNumber = 'Account numbers do not match';
    if (mode === 'change' && reason.trim().length < 5) errs.reason = 'Please give a meaningful reason';
    setErrors(errs);
    if (Object.keys(errs).length === 0) m.mutate();
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={mode === 'change' ? 'Request bank detail change' : 'Add bank details'}
      description={
        mode === 'change'
          ? 'Maker-checker: the change takes effect only after an independent approver verifies it. You cannot approve your own request.'
          : 'Encrypted at rest and masked everywhere.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bank-form" loading={m.isPending}>
            {mode === 'change' ? 'Submit change for approval' : 'Save bank details'}
          </Button>
        </>
      }
    >
      <form id="bank-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <BankFields bank={bank} onChange={(b) => setBank({ ...b })} errors={errors} prefix="" overseasOnly={overseas} />
        {mode === 'change' && (
          <FormField label="Reason for the change" required error={errors.reason}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vendor moved to a new bank — letter dated 12 Nov" />
          </FormField>
        )}
      </form>
    </Drawer>
  );
}

export function BankTab({ data, refresh }: { data: Vendor360; refresh: Refresh }) {
  const toast = useToast();
  const [form, setForm] = useState<'onboarding' | 'change' | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const live = data.bank.accounts.filter((a) => a.status === 'ACTIVE' || a.status === 'PROPOSED');
  const past = data.bank.accounts.filter((a) => a.status === 'SUPERSEDED' || a.status === 'REJECTED');
  const canOnboard = data.viewer.canEdit && ['DRAFT', 'REJECTED'].includes(data.vendor.status);
  const pendingChange = data.bank.changeRequests.find((r) => r.status === 'PENDING_APPROVAL');
  const canChange =
    data.bank.canRequestChange && !pendingChange && !['DRAFT', 'REJECTED', 'ARCHIVED'].includes(data.vendor.status) && live.some((a) => a.status === 'ACTIVE');
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/vendors/${data.vendor.id}/bank-change-requests/${id}/cancel`, { reason }),
    onSuccess: async () => {
      toast.success('Change request cancelled');
      setCancelling(null);
      await refresh();
    },
  });
  const bankApproval = data.approvals.find((a) => a.entityType === 'vendor_bank_change' && a.status === 'PENDING' && a.myPendingTaskId);

  return (
    <div className="flex flex-col gap-6">
      {bankApproval && <DecisionPanel taskId={bankApproval.myPendingTaskId!} subject={`Bank change for ${data.vendor.legalName}`} onDecided={refresh} />}
      <Card>
        <CardHeader
          title="Bank accounts"
          description="Masked by default. Revealing a full number requires permission and is audited."
          actions={
            <>
              {canOnboard && (
                <Button size="sm" variant={live.length ? 'secondary' : 'primary'} onClick={() => setForm('onboarding')}>
                  <Plus aria-hidden /> {live.length ? 'Replace bank details' : 'Add bank details'}
                </Button>
              )}
              {canChange && (
                <Button size="sm" onClick={() => setForm('change')}>
                  Request change
                </Button>
              )}
            </>
          }
        />
        <CardBody className="flex flex-col gap-3">
          {live.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bank account on file"
              description="Payments cannot be released until a bank account is verified by an independent approver."
            />
          ) : (
            live.map((a) => <BankAccountCard key={a.id} account={a} vendorId={data.vendor.id} canReveal={data.bank.canReveal} />)
          )}
          {pendingChange && (
            <Alert tone="warning" title="A bank change is awaiting approval">
              Requested by {pendingChange.requestedBy.fullName} {relativeTime(pendingChange.createdAt)} — “{pendingChange.reason}”. The current account stays in
              use until it is approved.
            </Alert>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change history" />
        {data.bank.changeRequests.length === 0 ? (
          <EmptyState title="No bank changes requested" />
        ) : (
          <ul className="divide-y divide-border">
            {data.bank.changeRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">“{r.reason}”</p>
                  <p className="text-xs text-fg-subtle">
                    {r.requestedBy.fullName} · {formatDateTime(r.createdAt)}
                    {r.outcomeReason ? ` · outcome: ${r.outcomeReason}` : ''}
                  </p>
                </div>
                <StatusBadge status={r.status} />
                {r.status === 'PENDING_APPROVAL' && data.bank.canRequestChange && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(r.id)}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <details className="border-t border-border px-5 py-3 text-sm">
            <summary className="cursor-pointer text-fg-muted">Previous accounts ({past.length})</summary>
            <ul className="mt-2 flex flex-col gap-1 text-fg-muted">
              {past.map((a) => (
                <li key={a.id}>
                  {a.bankName} <span className="font-mono">{a.accountMasked}</span> — {humanize(a.status)}
                  {a.supersededAt ? ` ${formatDate(a.supersededAt)}` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      {form && <BankFormDrawer data={data} mode={form} onClose={() => setForm(null)} refresh={refresh} />}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this bank change request?"
        impact="The proposed account is discarded. The current account stays in use."
        confirmLabel="Cancel request"
        requireReason
        loading={cancel.isPending}
        error={cancel.error ? errorMessage(cancel.error) : null}
        onConfirm={(reason) => {
          if (cancelling) cancel.mutate({ id: cancelling, reason });
        }}
      />
    </div>
  );
}

// ── Approvals ─────────────────────────────────────────────────────────────────

export function ApprovalsTab({ data, refresh }: { data: Vendor360; refresh: Refresh }) {
  if (data.approvals.length === 0)
    return (
      <Card>
        <EmptyState title="No approvals yet" description="Submitting the vendor or requesting a bank change starts an approval." />
      </Card>
    );
  return (
    <div className="flex flex-col gap-4">
      {data.approvals.map((a) => {
        const stages = new Map<number, typeof a.tasks>();
        for (const t of a.tasks) stages.set(t.sequence, [...(stages.get(t.sequence) ?? []), t]);
        return (
          <Card key={a.id}>
            <CardHeader
              title={a.entityType === 'vendor' ? 'Vendor onboarding approval' : 'Bank-detail change approval'}
              description={`Requested by ${a.requester.fullName} · ${formatDateTime(a.submittedAt)}`}
              actions={
                <>
                  <StatusBadge status={a.status} />
                  <Link href={`/approvals/${a.id}`} className="text-sm font-medium text-primary hover:underline">
                    Full history
                  </Link>
                </>
              }
            />
            <CardBody className="flex flex-col gap-4">
              {a.myPendingTaskId && <DecisionPanel taskId={a.myPendingTaskId} subject={data.vendor.legalName} onDecided={refresh} compact />}
              <ol className="flex flex-col gap-3">
                {[...stages.entries()].map(([seq, tasks]) => (
                  <li key={seq} className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium text-fg">
                      Stage {seq}: {tasks[0]!.stage.name}
                    </p>
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {tasks.map((t) => (
                        <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <Avatar name={t.assignee.fullName} size="sm" />
                          <span className="text-fg">{t.assignee.fullName}</span>
                          <StatusBadge status={t.status} />
                          {t.decidedAt && <span className="text-xs text-fg-subtle">{formatDateTime(t.decidedAt)}</span>}
                          {t.reason && <span className="w-full pl-8 text-sm text-fg-muted">“{t.reason}”</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              {a.outcomeReason && <p className="text-sm text-fg-muted">Outcome: “{a.outcomeReason}”</p>}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────

export function HistoryTab({ data }: { data: Vendor360 }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Status history" description="Every lifecycle change with actor, time and reason" />
        <CardBody>
          <ol className="flex flex-col">
            {[...data.statusHistory].reverse().map((h, i, arr) => (
              <li key={h.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < arr.length - 1 && <span aria-hidden className="absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-px bg-border" />}
                <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted">
                  <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg">
                    {h.fromStatus ? <VendorStatusBadge status={h.fromStatus} /> : <span className="text-fg-subtle">Created</span>}
                    <ArrowRight className="size-3 text-fg-subtle" aria-hidden />
                    <VendorStatusBadge status={h.toStatus} />
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    {h.actor?.fullName ?? 'System'} · <time dateTime={h.occurredAt}>{formatDateTime(h.occurredAt)}</time>
                  </p>
                  {h.reason && <p className="mt-1 text-sm text-fg-muted">“{h.reason}”</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="sr-only">Status labels: {Object.values(VENDOR_STATUS_LABELS).join(', ')}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Audit activity" description="All audited changes to this vendor" />
        <CardBody>
          {data.activity === null ? (
            <p className="text-sm text-fg-muted">You need audit-log access to see detailed activity.</p>
          ) : data.activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ActivityTimeline events={data.activity} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ── Performance ───────────────────────────────────────────────────────────────

export function PerformanceTab({ data }: { data: Vendor360 }) {
  const p = data.performance;
  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info" title="Transparent indicators">
        Every score shows its formula and the exact inputs used. Scores never approve, reject or suspend a vendor automatically — decisions stay with people.
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        {p.indicators.map((i) => {
          const na = i.status === 'not_available';
          return (
            <Card key={i.key} className={cn('flex flex-col', na && 'opacity-70')}>
              <CardHeader
                title={i.label}
                actions={
                  na ? (
                    <Badge>Phase {i.availableInPhase}</Badge>
                  ) : i.status === 'insufficient_data' ? (
                    <Badge tone="warning">Insufficient data</Badge>
                  ) : (
                    <ScoreBar score={i.score} />
                  )
                }
              />
              <CardBody className="flex flex-1 flex-col gap-3">
                {i.value && <p className="text-sm font-medium text-fg">{i.value}</p>}
                <p className="text-sm text-fg-muted">{i.explanation}</p>
                <div className="rounded-md bg-surface-muted/70 px-3 py-2">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">Formula</p>
                  <p className="mt-0.5 font-mono text-xs text-fg">{i.formula}</p>
                </div>
                {Object.keys(i.inputs).length > 0 ? (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Inputs for {i.label}</caption>
                    <tbody>
                      {Object.entries(i.inputs).map(([k, v]) => (
                        <tr key={k} className="border-b border-border last:border-0">
                          <th scope="row" className="py-1 pr-2 text-left font-normal text-fg-muted">
                            {humanize(k)}
                          </th>
                          <td className="tabular py-1 text-right text-fg">{v === null ? '—' : String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  na && <p className="text-xs text-fg-subtle">Calculated once the Phase {i.availableInPhase} module records real transactions.</p>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
