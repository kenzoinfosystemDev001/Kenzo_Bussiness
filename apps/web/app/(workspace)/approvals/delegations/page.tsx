'use client';

import { APPROVAL_ENTITY_LABELS, APPROVAL_ENTITY_TYPES } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Drawer } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { Checkbox, FormField, Input, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { ApproverPicker } from '@/components/workflow/user-picker';
import { errorMessage, get, post } from '@/lib/api';
import { serverFieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { useSession, usePermission } from '@/lib/session';
import type { Delegation, List } from '@/lib/types';

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateDelegation({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const now = new Date();
  const [delegateId, setDelegateId] = useState('');
  const [validFrom, setValidFrom] = useState(toLocalInput(now));
  const [validUntil, setValidUntil] = useState(toLocalInput(new Date(now.getTime() + 7 * 86_400_000)));
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      post('/approvals/delegations', {
        delegateId,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
        entityTypes,
        reason,
      }),
    onSuccess: async () => {
      toast.success('Delegation created');
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['delegations'] });
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!delegateId) errs.delegateId = 'Choose a delegate';
    if (!reason.trim()) errs.reason = 'Reason is required';
    if (new Date(validUntil) <= new Date(validFrom)) errs.validUntil = 'End must be after start';
    setErrors(errs);
    if (Object.keys(errs).length === 0) m.mutate();
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Delegate my approvals"
      description="While active, new approval tasks routed to you go to your delegate. Policies that forbid delegation (e.g. payments) are not affected."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="delegation-form" loading={m.isPending}>
            Create delegation
          </Button>
        </>
      }
    >
      <form id="delegation-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Delegate" required error={errors.delegateId}>
          <ApproverPicker value={delegateId} onChange={setDelegateId} excludeIds={session ? [session.user.id] : []} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="From" required error={errors.validFrom}>
            <Input type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </FormField>
          <FormField label="Until" required error={errors.validUntil}>
            <Input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">Applies to</legend>
          <p className="text-xs text-fg-subtle">Leave all unchecked to delegate every approval type.</p>
          {APPROVAL_ENTITY_TYPES.map((t) => (
            <Checkbox
              key={t}
              label={APPROVAL_ENTITY_LABELS[t]}
              checked={entityTypes.includes(t)}
              onChange={(e) => setEntityTypes((all) => (e.target.checked ? [...all, t] : all.filter((x) => x !== t)))}
            />
          ))}
        </fieldset>
        <FormField label="Reason" required error={errors.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Annual leave 14–21 Nov" />
        </FormField>
      </form>
    </Drawer>
  );
}

export default function DelegationsPage() {
  const allowed = usePermission('approval.delegation.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Delegation | null>(null);
  const q = useQuery({ queryKey: ['delegations'], queryFn: () => get<List<Delegation>>('/approvals/delegations'), enabled: allowed });
  const revoke = useMutation({
    mutationFn: (id: string) => post(`/approvals/delegations/${id}/revoke`),
    onSuccess: async () => {
      toast.success('Delegation revoked');
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: ['delegations'] });
    },
  });

  const state = (d: Delegation) =>
    d.revokedAt ? 'REVOKED' : new Date(d.validUntil) < new Date() ? 'EXPIRED' : new Date(d.validFrom) > new Date() ? 'SCHEDULED' : 'ACTIVE';

  const columns: Column<Delegation>[] = [
    { key: 'from', header: 'Delegator', cell: (d) => d.delegator.fullName },
    { key: 'to', header: 'Delegate', cell: (d) => d.delegate.fullName },
    {
      key: 'types',
      header: 'Applies to',
      cell: (d) =>
        d.entityTypes.length === 0 ? (
          <span className="text-fg-muted">All approval types</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {d.entityTypes.map((t) => (
              <Badge key={t}>{APPROVAL_ENTITY_LABELS[t as keyof typeof APPROVAL_ENTITY_LABELS] ?? t}</Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'window',
      header: 'Period',
      cell: (d) => (
        <span className="text-fg-muted">
          {formatDateTime(d.validFrom)} → {formatDateTime(d.validUntil)}
        </span>
      ),
    },
    { key: 'reason', header: 'Reason', cell: (d) => <span className="text-fg-muted">{d.reason}</span> },
    { key: 'state', header: 'Status', cell: (d) => <StatusBadge status={state(d)} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      cell: (d) =>
        !d.revokedAt && new Date(d.validUntil) > new Date() ? (
          <Button size="sm" variant="ghost" onClick={() => setRevoking(d)}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  if (!allowed) return <PermissionDenied />;

  return (
    <>
      <PageHeader
        title="Delegations"
        description="Temporarily hand your approval authority to an independent colleague."
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: 'Delegations' }]}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New delegation
          </Button>
        }
      />
      <Card>
        <DataTable
          caption="Delegations"
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(d) => d.id}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          empty={{ title: 'No delegations', description: 'Create one before you go on leave so approvals keep moving.' }}
        />
      </Card>
      {creating && <CreateDelegation open onOpenChange={setCreating} />}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke delegation?"
        description={revoking ? `${revoking.delegate.fullName} will no longer receive new tasks on behalf of ${revoking.delegator.fullName}.` : undefined}
        impact="Tasks already assigned to the delegate stay with them."
        confirmLabel="Revoke"
        loading={revoke.isPending}
        error={revoke.error ? errorMessage(revoke.error) : null}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
        }}
      />
    </>
  );
}
