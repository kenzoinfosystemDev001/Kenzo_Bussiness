'use client';

import { useMutation } from '@tanstack/react-query';
import { Archive, CheckCircle2, MoreHorizontal, PauseCircle, Play, RotateCcw, ScanSearch, Send, Undo2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { DropdownContent, DropdownItem, DropdownMenu, DropdownTrigger } from '@/components/ui/dropdown';
import { Alert } from '@/components/ui/feedback';
import { FormField, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, isApiError, post } from '@/lib/api';
import { vendorActions, type ActionAvailability, type Vendor360, type VendorAction } from '@/lib/vendors';

const ICONS: Record<VendorAction, typeof Send> = {
  submit: Send,
  withdraw: Undo2,
  'start-review': ScanSearch,
  activate: CheckCircle2,
  suspend: PauseCircle,
  reactivate: Play,
  archive: Archive,
  reopen: RotateCcw,
};

const IMPACT: Record<VendorAction, string> = {
  submit: 'The vendor is locked for editing and routed to an independent approver.',
  withdraw: 'The approval is cancelled and the vendor returns to draft for changes.',
  'start-review': 'You take ownership of reviewing this vendor. The requester sees it is under review.',
  activate: 'The vendor becomes usable on RFQs, purchase orders and payments.',
  suspend: 'The vendor is blocked from new transactions until reactivated. Existing records are unchanged.',
  reactivate: 'The vendor becomes usable for new transactions again.',
  archive: 'The vendor becomes read-only and is hidden from the directory. This cannot be undone.',
  reopen: 'The rejected vendor returns to draft so it can be corrected and resubmitted.',
};

const SUCCESS: Record<VendorAction, string> = {
  submit: 'Submitted for approval',
  withdraw: 'Submission withdrawn',
  'start-review': 'Review started',
  activate: 'Vendor activated',
  suspend: 'Vendor suspended',
  reactivate: 'Vendor reactivated',
  archive: 'Vendor archived',
  reopen: 'Vendor reopened as draft',
};

function SubmitDialog({
  vendorId,
  open,
  onOpenChange,
  onDone,
}: {
  vendorId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/vendors/${vendorId}/submit`, { note: note.trim() || null }),
    onSuccess: async () => {
      toast.success(SUCCESS.submit, 'An approver has been notified.');
      onOpenChange(false);
      await onDone();
    },
    onError: (e) => {
      if (isApiError(e) && e.fieldErrors.length) {
        setProblems(e.fieldErrors.map((f) => f.message));
        setError(e.message);
      } else setError(errorMessage(e));
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblems([]);
    setError(null);
    m.mutate();
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Submit for approval?" description={IMPACT.submit} size="sm">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label="Note for the approver (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
        </FormField>
        {error && (
          <Alert tone="danger" title={error}>
            {problems.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={m.isPending}>
            <Send aria-hidden /> Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function VendorLifecycleActions({ data, onChanged }: { data: Vendor360; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [pending, setPending] = useState<ActionAvailability | null>(null);
  const v = data.vendor;
  const actions = vendorActions({
    status: v.status,
    canEdit: data.viewer.canEdit,
    canApprove: data.viewer.canApprove,
    isCreator: data.viewer.isCreator,
    compliant: data.compliance.compliant,
    hasPendingTask: !!data.viewer.pendingApprovalTaskId,
  }).filter((a) => a.visible);

  const run = useMutation({
    mutationFn: ({ action, reason }: { action: VendorAction; reason?: string }) => post(`/vendors/${v.id}/${action}`, reason !== undefined ? { reason } : {}),
    onSuccess: async (_d, vars) => {
      toast.success(SUCCESS[vars.action]);
      setPending(null);
      await onChanged();
    },
  });

  const primary = actions.filter((a) => a.tone === 'primary');
  const secondary = actions.filter((a) => a.tone !== 'primary');
  const trigger = (a: ActionAvailability) => {
    if (a.disabledReason) return;
    if (a.action === 'start-review') {
      run.mutate({ action: 'start-review' });
      return;
    }
    setPending(a);
  };

  if (actions.length === 0) return null;

  return (
    <>
      {primary.map((a) => {
        const Icon = ICONS[a.action];
        const btn = (
          <Button key={a.action} onClick={() => trigger(a)} disabled={!!a.disabledReason} loading={run.isPending && run.variables?.action === a.action}>
            <Icon aria-hidden /> {a.label}
          </Button>
        );
        return a.disabledReason ? (
          <Tooltip key={a.action} content={a.disabledReason} focusable side="bottom">
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
      {secondary.length > 0 && (
        <DropdownMenu>
          <DropdownTrigger asChild>
            <Button variant="secondary" aria-label="More lifecycle actions">
              <MoreHorizontal aria-hidden /> More
            </Button>
          </DropdownTrigger>
          <DropdownContent>
            {secondary.map((a) => {
              const Icon = ICONS[a.action];
              return (
                <DropdownItem key={a.action} disabled={!!a.disabledReason} destructive={a.tone === 'danger'} onSelect={() => trigger(a)}>
                  <Icon aria-hidden />
                  <span className="flex flex-col">
                    <span>{a.label}</span>
                    {a.disabledReason && <span className="text-xs text-fg-subtle">{a.disabledReason}</span>}
                  </span>
                </DropdownItem>
              );
            })}
          </DropdownContent>
        </DropdownMenu>
      )}
      <SubmitDialog vendorId={v.id} open={pending?.action === 'submit'} onOpenChange={(o) => !o && setPending(null)} onDone={onChanged} />
      {pending && pending.action !== 'submit' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={`${pending.label}: ${v.legalName}?`}
          impact={IMPACT[pending.action]}
          confirmLabel={pending.label}
          tone={pending.tone === 'danger' ? 'danger' : 'primary'}
          requireReason={pending.requiresReason}
          reasonLabel="Reason (recorded in the vendor history)"
          loading={run.isPending}
          error={run.error ? errorMessage(run.error) : null}
          onConfirm={(reason) => run.mutate({ action: pending.action, reason: pending.requiresReason ? reason : undefined })}
        />
      )}
    </>
  );
}
