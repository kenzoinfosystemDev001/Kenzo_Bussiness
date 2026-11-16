'use client';

import { useQuery } from '@tanstack/react-query';
import { AlarmClock, Bell, CheckSquare, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, StatTile } from '@/components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { ActivityTimeline } from '@/components/workflow/activity-timeline';
import { get } from '@/lib/api';
import { formatAmount, humanize, relativeTime } from '@/lib/format';
import { useSession, usePermission } from '@/lib/session';
import type { AuditRow, NotificationRow, Page, TaskRow } from '@/lib/types';

export default function OverviewPage() {
  const { data: session } = useSession();
  const canAct = usePermission('approval.task.act');
  const canAudit = usePermission('audit.read');

  const summary = useQuery({ queryKey: ['approvals', 'summary'], queryFn: () => get<{ pending: number; overdue: number }>('/approvals/summary') });
  const tasks = useQuery({
    queryKey: ['approvals', 'tasks', 'overview'],
    queryFn: () => get<Page<TaskRow>>('/approvals/tasks', { status: 'PENDING', limit: 5 }),
    enabled: canAct,
  });
  const notifications = useQuery({
    queryKey: ['notifications', 'overview'],
    queryFn: () => get<Page<NotificationRow>>('/notifications', { unread: 'true', limit: 5 }),
  });
  const audit = useQuery({ queryKey: ['audit', 'overview'], queryFn: () => get<Page<AuditRow>>('/audit-events', { limit: 8 }), enabled: canAudit });

  const firstName = session?.user.fullName.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Good to see you{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {session?.company?.displayName} · {session?.roleKeys.map((r) => humanize(r)).join(', ') || 'No roles assigned'}
        </p>
      </header>

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Pending approvals"
          value={summary.isLoading ? <Skeleton className="h-8 w-12" /> : (summary.data?.pending ?? 0)}
          hint="Assigned to you"
          icon={<CheckSquare className="size-4 text-fg-subtle" aria-hidden />}
        />
        <StatTile
          label="Overdue"
          value={summary.isLoading ? <Skeleton className="h-8 w-12" /> : (summary.data?.overdue ?? 0)}
          hint="Past their SLA"
          tone={(summary.data?.overdue ?? 0) > 0 ? 'danger' : 'neutral'}
          icon={<AlarmClock className="size-4 text-fg-subtle" aria-hidden />}
        />
        <StatTile
          label="Unread notifications"
          value={
            notifications.isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : notifications.data?.items.length === 5 && notifications.data.nextCursor ? (
              '5+'
            ) : (
              (notifications.data?.items.length ?? 0)
            )
          }
          icon={<Bell className="size-4 text-fg-subtle" aria-hidden />}
        />
        <StatTile
          label="Account security"
          value={session?.mfa.enabled ? 'MFA on' : 'MFA off'}
          tone={session?.mfa.enabled ? 'success' : session?.mfa.enforced ? 'danger' : 'warning'}
          hint={
            <Link href="/settings/security" className="text-primary hover:underline">
              {session?.mfa.enabled ? 'Manage security' : 'Enable two-step verification'}
            </Link>
          }
          icon={
            session?.mfa.enabled ? <ShieldCheck className="size-4 text-success" aria-hidden /> : <ShieldAlert className="size-4 text-warning" aria-hidden />
          }
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {canAct && (
          <Card>
            <CardHeader
              title="Waiting for your decision"
              actions={
                <Link href="/approvals" className="text-sm font-medium text-primary hover:underline">
                  Open inbox
                </Link>
              }
            />
            {tasks.error ? (
              <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
            ) : tasks.isLoading ? (
              <CardBody className="flex flex-col gap-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </CardBody>
            ) : tasks.data?.items.length ? (
              <ul className="divide-y divide-border">
                {tasks.data.items.map((t) => (
                  <li key={t.id}>
                    <Link href={`/approvals/${t.instance.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium text-fg">
                          {humanize(t.instance.entityType)} {t.instance.entityReference ?? ''}
                        </p>
                        <p className="truncate text-xs text-fg-subtle">
                          {t.stage.name} · requested by {t.instance.requester.fullName} · {relativeTime(t.instance.submittedAt)}
                        </p>
                      </div>
                      <span className="tabular text-sm text-fg">{formatAmount(t.instance.amount, t.instance.currencyCode)}</span>
                      {t.dueAt && new Date(t.dueAt) < new Date() && <Badge tone="danger">Overdue</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={CheckSquare} title="You're all caught up" description="New approval tasks assigned to you will appear here." />
            )}
          </Card>
        )}

        <Card>
          <CardHeader
            title="Unread notifications"
            actions={
              <Link href="/notifications" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          {notifications.error ? (
            <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
          ) : notifications.isLoading ? (
            <CardBody className="flex flex-col gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </CardBody>
          ) : notifications.data?.items.length ? (
            <ul className="divide-y divide-border">
              {notifications.data.items.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  {n.link ? (
                    <Link href={n.link} className="text-sm font-medium text-fg hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-fg">{n.title}</p>
                  )}
                  <p className="text-xs text-fg-subtle">{relativeTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Bell} title="No unread notifications" />
          )}
        </Card>
      </div>

      {canAudit && (
        <Card>
          <CardHeader
            title="Recent activity"
            description="Latest audited actions in this company"
            actions={
              <Link href="/admin/audit" className="text-sm font-medium text-primary hover:underline">
                Audit log
              </Link>
            }
          />
          <CardBody>
            {audit.error ? (
              <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
            ) : audit.isLoading ? (
              <Skeleton className="h-32" />
            ) : audit.data?.items.length ? (
              <ActivityTimeline events={audit.data.items} />
            ) : (
              <EmptyState title="No activity yet" />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
