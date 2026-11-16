'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { formatAmount, formatDateTime, humanize, relativeTime } from '@/lib/format';
import { useCursorList } from '@/lib/hooks';
import { usePermission } from '@/lib/session';
import type { TaskRow } from '@/lib/types';

export default function ApprovalsInboxPage() {
  const router = useRouter();
  const canAct = usePermission('approval.task.act');
  const [tab, setTab] = useState<'PENDING' | 'DECIDED'>('PENDING');
  const list = useCursorList<TaskRow>(['approvals', 'tasks'], '/approvals/tasks', { status: tab }, { enabled: canAct });

  const columns: Column<TaskRow>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (t) => (
        <div className="min-w-0">
          <p className="font-medium text-fg">
            {humanize(t.instance.entityType)} {t.instance.entityReference}
          </p>
          {t.instance.entitySummary && <p className="max-w-md truncate text-xs text-fg-subtle">{t.instance.entitySummary}</p>}
        </div>
      ),
    },
    { key: 'stage', header: 'Stage', cell: (t) => <span className="text-fg-muted">{t.stage.name}</span> },
    { key: 'requester', header: 'Requested by', cell: (t) => t.instance.requester.fullName },
    { key: 'amount', header: 'Amount', numeric: true, cell: (t) => formatAmount(t.instance.amount, t.instance.currencyCode) },
    {
      key: 'when',
      header: tab === 'PENDING' ? 'Due' : 'Decided',
      cell: (t) =>
        tab === 'PENDING' ? (
          t.dueAt ? (
            new Date(t.dueAt) < new Date() ? (
              <Badge tone="danger">Overdue {relativeTime(t.dueAt)}</Badge>
            ) : (
              <span className="text-fg-muted">{relativeTime(t.dueAt)}</span>
            )
          ) : (
            <span className="text-fg-subtle">No SLA</span>
          )
        ) : (
          <span className="text-fg-muted">{formatDateTime(t.decidedAt)}</span>
        ),
    },
    { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={tab === 'PENDING' ? t.status : t.status} /> },
  ];

  if (!canAct) {
    return (
      <>
        <PageHeader
          title="Approvals"
          actions={
            <Link href="/approvals/requests" className="text-sm font-medium text-primary hover:underline">
              My requests
            </Link>
          }
        />
        <Card>
          <PermissionDenied message="You are not an approver in this company. You can still follow your own requests." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Decisions assigned to you. Every decision is recorded with your name, time and reason."
        actions={
          <>
            <Link href="/approvals/requests" className="text-sm font-medium text-primary hover:underline">
              All requests
            </Link>
            <Link href="/approvals/delegations" className="text-sm font-medium text-primary hover:underline">
              Delegations
            </Link>
          </>
        }
      />
      <Card>
        <Tabs
          className="px-4"
          value={tab}
          onChange={(v) => setTab(v as 'PENDING' | 'DECIDED')}
          items={[
            { value: 'PENDING', label: 'Waiting for me' },
            { value: 'DECIDED', label: 'Decided' },
          ]}
        />
        <DataTable
          caption="Approval tasks"
          columns={columns}
          rows={list.items}
          rowKey={(t) => t.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(t) => router.push(`/approvals/${t.instance.id}`)}
          hasNextPage={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={
            tab === 'PENDING'
              ? { title: 'Nothing waiting for you', description: 'New approval tasks will appear here and in your notifications.' }
              : { title: 'No decisions yet' }
          }
        />
      </Card>
    </>
  );
}
