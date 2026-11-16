'use client';

import { APPROVAL_ENTITY_LABELS } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, RotateCcw, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, KeyValue } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Alert, ErrorState, PageLoading } from '@/components/ui/feedback';
import { FormField, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { ApprovalHistory, ApprovalTimeline } from '@/components/workflow/approval-timeline';
import { ApproverPicker, UserPicker } from '@/components/workflow/user-picker';
import { errorMessage, get, post } from '@/lib/api';
import { formatAmount, formatDateTime, humanize } from '@/lib/format';
import { usePermission } from '@/lib/session';
import type { InstanceDetail } from '@/lib/types';

type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

function DecisionPanel({ instance }: { instance: InstanceDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const taskId = instance.viewer.pendingTaskId!;

  const mutate = useMutation({
    mutationFn: (body: { decision: Decision; reason?: string }) => post<InstanceDetail>(`/approvals/tasks/${taskId}/decision`, body),
    onSuccess: async (_d, vars) => {
      toast.success(vars.decision === 'APPROVE' ? 'Approved' : vars.decision === 'REJECT' ? 'Rejected' : 'Returned to requester');
      setDecision(null);
      setReason('');
      await qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    if (decision !== 'APPROVE' && !reason.trim()) return setError('A reason is required to reject or return.');
    setError(null);
    mutate.mutate({ decision, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };

  const labels: Record<Decision, string> = { APPROVE: 'Approve', REJECT: 'Reject', RETURN: 'Return for clarification' };

  return (
    <Card className="border-primary/30">
      <CardHeader title="Your decision" description="Your name, the time and your reason are recorded permanently." />
      <CardBody className="flex flex-wrap gap-2">
        <Button onClick={() => setDecision('APPROVE')}>
          <Check aria-hidden /> Approve
        </Button>
        <Button variant="secondary" onClick={() => setDecision('RETURN')}>
          <RotateCcw aria-hidden /> Return
        </Button>
        <Button variant="danger-outline" onClick={() => setDecision('REJECT')}>
          <X aria-hidden /> Reject
        </Button>
      </CardBody>
      <Modal
        open={decision !== null}
        onOpenChange={(o) => {
          if (!o) {
            setDecision(null);
            setError(null);
          }
        }}
        title={decision ? labels[decision] : ''}
        description={`${APPROVAL_ENTITY_LABELS[instance.entityType as keyof typeof APPROVAL_ENTITY_LABELS] ?? humanize(instance.entityType)} ${instance.entityReference ?? ''}`}
        size="sm"
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormField label={decision === 'APPROVE' ? 'Comment (optional)' : 'Reason'} required={decision !== 'APPROVE'} error={error}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} autoFocus />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button type="submit" variant={decision === 'REJECT' ? 'danger' : 'primary'} loading={mutate.isPending}>
              {decision ? labels[decision] : 'Submit'}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function DelegateDialog({
  instance,
  mode,
  open,
  onOpenChange,
}: {
  instance: InstanceDetail;
  mode: 'delegate' | 'reassign';
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [taskId, setTaskId] = useState(instance.viewer.pendingTaskId ?? '');
  const [toUserId, setToUserId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const openTasks = instance.tasks.filter((t) => t.status === 'PENDING' || t.status === 'WAITING');
  const m = useMutation({
    mutationFn: () => post(`/approvals/tasks/${mode === 'delegate' ? instance.viewer.pendingTaskId : taskId}/${mode}`, { toUserId, reason }),
    onSuccess: async () => {
      toast.success(mode === 'delegate' ? 'Task delegated' : 'Task reassigned');
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!toUserId || !reason.trim() || (mode === 'reassign' && !taskId)) return setError('Choose a person and give a reason.');
    setError(null);
    m.mutate();
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'delegate' ? 'Delegate this task' : 'Reassign an approval task'}
      description="The new approver must be independent of the request."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {mode === 'reassign' && (
          <FormField label="Task" required>
            <select className="h-9 rounded-md border border-border bg-surface px-3 text-base" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Select task</option>
              {openTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  Stage {t.sequence} · {t.assignee.fullName} ({humanize(t.status)})
                </option>
              ))}
            </select>
          </FormField>
        )}
        <FormField label="New approver" required>
          {mode === 'delegate' ? (
            <ApproverPicker value={toUserId} onChange={setToUserId} excludeIds={[instance.requester.id]} />
          ) : (
            <UserPicker value={toUserId} onChange={setToUserId} excludeIds={[instance.requester.id]} />
          )}
        </FormField>
        <FormField label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </FormField>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={m.isPending}>
            {mode === 'delegate' ? 'Delegate' : 'Reassign'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const canDelegate = usePermission('approval.delegation.manage');
  const [dialog, setDialog] = useState<'delegate' | 'reassign' | 'cancel' | null>(null);
  const q = useQuery({ queryKey: ['approvals', 'instance', id], queryFn: () => get<InstanceDetail>(`/approvals/instances/${id}`) });
  const cancel = useMutation({
    mutationFn: (reason: string) => post(`/approvals/instances/${id}/cancel`, { reason }),
    onSuccess: async () => {
      toast.success('Approval withdrawn');
      setDialog(null);
      await qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const i = q.data;
  const label = APPROVAL_ENTITY_LABELS[i.entityType as keyof typeof APPROVAL_ENTITY_LABELS] ?? humanize(i.entityType);
  const pending = i.status === 'PENDING';

  return (
    <>
      <PageHeader
        title={`${label} ${i.entityReference ?? ''}`.trim()}
        description={i.entitySummary ?? undefined}
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: i.entityReference ?? 'Request' }]}
        meta={<StatusBadge status={i.status} />}
        actions={
          <>
            {pending && i.viewer.pendingTaskId && canDelegate && i.policy.allowDelegation && (
              <Button variant="secondary" onClick={() => setDialog('delegate')}>
                <ArrowRightLeft aria-hidden /> Delegate
              </Button>
            )}
            {pending && i.viewer.canAdminister && (
              <Button variant="secondary" onClick={() => setDialog('reassign')}>
                Reassign
              </Button>
            )}
            {pending && (i.viewer.isRequester || i.viewer.canAdminister) && (
              <Button variant="danger-outline" onClick={() => setDialog('cancel')}>
                Withdraw
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          {pending && i.viewer.pendingTaskId && <DecisionPanel instance={i} />}
          {i.outcomeReason && !pending && (
            <Alert tone={i.status === 'APPROVED' ? 'success' : 'warning'} title={`Outcome: ${humanize(i.status)}`}>
              {i.outcomeReason}
            </Alert>
          )}
          <Card>
            <CardHeader title="Approval chain" description={`${i.policy.name} · policy version ${i.policy.policyVersion}`} />
            <CardBody>
              <ApprovalTimeline tasks={i.tasks} currentSequence={i.currentSequence} />
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <KeyValue
                columns={1}
                items={[
                  { label: 'Requested by', value: i.requester.fullName },
                  { label: 'Amount', value: <span className="tabular">{formatAmount(i.amount, i.currencyCode)}</span> },
                  { label: 'Submitted', value: formatDateTime(i.submittedAt) },
                  { label: 'Completed', value: formatDateTime(i.completedAt) },
                  {
                    label: 'Controls',
                    value: (
                      <ul className="list-inside list-disc text-sm text-fg-muted">
                        {i.policy.requireIndependentApproval && <li>Independent approval (no self-approval)</li>}
                        {i.policy.distinctApproversAcrossStages && <li>Different approver per stage</li>}
                        <li>{i.policy.allowDelegation ? 'Delegation allowed' : 'Delegation not allowed'}</li>
                      </ul>
                    ),
                  },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ApprovalHistory events={i.events} />
            </CardBody>
          </Card>
        </div>
      </div>
      {(dialog === 'delegate' || dialog === 'reassign') && <DelegateDialog instance={i} mode={dialog} open onOpenChange={(o) => !o && setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'cancel'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Withdraw this approval?"
        impact="All open approval tasks will be cancelled. The request must be resubmitted to restart approval."
        confirmLabel="Withdraw"
        requireReason
        loading={cancel.isPending}
        error={cancel.error ? errorMessage(cancel.error) : null}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </>
  );
}
