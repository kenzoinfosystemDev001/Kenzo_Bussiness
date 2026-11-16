import { ArrowRightLeft, CheckCircle2, CircleDashed, Clock, Hourglass, RotateCcw, Send, ShieldAlert, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize, relativeTime } from '@/lib/format';
import type { ApprovalEvent, InstanceTask } from '@/lib/types';

/** Approval chain grouped by stage, with each approver's status and decision. */
export function ApprovalTimeline({ tasks, currentSequence }: { tasks: InstanceTask[]; currentSequence: number | null }) {
  const stages = new Map<number, InstanceTask[]>();
  for (const t of tasks) stages.set(t.sequence, [...(stages.get(t.sequence) ?? []), t]);
  const ordered = [...stages.entries()].sort(([a], [b]) => a - b);

  return (
    <ol className="flex flex-col" aria-label="Approval stages">
      {ordered.map(([sequence, stageTasks], idx) => {
        const stage = stageTasks[0]!.stage;
        const done = stageTasks.some((t) => t.status === 'APPROVED') && stageTasks.every((t) => t.status !== 'PENDING' && t.status !== 'WAITING');
        const rejected = stageTasks.some((t) => t.status === 'REJECTED' || t.status === 'RETURNED');
        const active = currentSequence === sequence;
        const Icon = rejected ? XCircle : done ? CheckCircle2 : active ? Hourglass : CircleDashed;
        const tone = rejected
          ? 'text-danger bg-danger-soft'
          : done
            ? 'text-success bg-success-soft'
            : active
              ? 'text-warning bg-warning-soft'
              : 'text-fg-subtle bg-surface-muted';
        return (
          <li key={sequence} className="relative flex gap-3 pb-5 last:pb-0">
            {idx < ordered.length - 1 && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border" />}
            <span className={cn('relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full', tone)}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-medium text-fg">
                  Stage {sequence}: {stage.name}
                </p>
                <span className="text-xs text-fg-subtle">
                  {stage.mode === 'ALL'
                    ? 'All approvers must approve'
                    : stage.minApprovals > 1
                      ? `${stage.minApprovals} approvals required`
                      : 'Any one approver'}
                  {stage.slaHours ? ` · SLA ${stage.slaHours}h` : ''}
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {stageTasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2">
                    <Avatar name={t.assignee.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{t.assignee.fullName}</span>
                        <StatusBadge status={t.status} />
                        {t.isEscalation && <span className="text-xs text-warning">Escalation approver</span>}
                      </div>
                      {t.delegatedFrom && <p className="text-xs text-fg-subtle">On behalf of {t.delegatedFrom.fullName}</p>}
                      {t.decidedAt && (
                        <p className="text-xs text-fg-subtle">
                          {humanize(t.status)} by {t.decidedBy?.fullName ?? t.assignee.fullName} ·{' '}
                          <time dateTime={t.decidedAt}>{formatDateTime(t.decidedAt)}</time>
                        </p>
                      )}
                      {!t.decidedAt && t.status === 'PENDING' && t.dueAt && (
                        <p className={cn('text-xs', new Date(t.dueAt) < new Date() ? 'text-danger' : 'text-fg-subtle')}>
                          <Clock className="mr-1 inline size-3" aria-hidden />
                          Due {relativeTime(t.dueAt)}
                        </p>
                      )}
                      {t.reason && <p className="mt-1 rounded bg-surface-muted px-2 py-1 text-sm text-fg-muted">“{t.reason}”</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const EVENT_ICON: Record<string, typeof Send> = {
  submitted: Send,
  approve: CheckCircle2,
  reject: XCircle,
  return: RotateCcw,
  delegated: ArrowRightLeft,
  reassigned: ArrowRightLeft,
  escalated: ShieldAlert,
  instance_approved: CheckCircle2,
  instance_rejected: XCircle,
  instance_returned: RotateCcw,
  instance_cancelled: XCircle,
};

const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted for approval',
  approve: 'Approved',
  reject: 'Rejected',
  return: 'Returned for clarification',
  delegated: 'Delegated',
  reassigned: 'Reassigned by administrator',
  escalated: 'Escalated (overdue)',
  stage_activated: 'Stage started',
  stage_completed: 'Stage completed',
  instance_approved: 'Approval completed',
  instance_rejected: 'Request rejected',
  instance_returned: 'Returned to requester',
  instance_cancelled: 'Withdrawn',
  reassignment_required: 'Reassignment required',
};

/** Immutable approval history (approval_event rows). */
export function ApprovalHistory({ events }: { events: ApprovalEvent[] }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Approval history">
      {events.map((e) => {
        const Icon = EVENT_ICON[e.type] ?? Clock;
        return (
          <li key={e.id} className="flex gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm text-fg">
                <span className="font-medium">{EVENT_LABEL[e.type] ?? humanize(e.type)}</span>
                {e.sequence ? <span className="text-fg-subtle"> · stage {e.sequence}</span> : null}
                {e.actor && <span className="text-fg-muted"> by {e.actor.fullName}</span>}
              </p>
              {e.reason && <p className="text-sm text-fg-muted">“{e.reason}”</p>}
              <time dateTime={e.occurredAt} className="text-xs text-fg-subtle">
                {formatDateTime(e.occurredAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
