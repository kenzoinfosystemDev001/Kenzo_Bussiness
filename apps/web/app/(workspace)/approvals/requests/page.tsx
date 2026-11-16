'use client';

import { APPROVAL_ENTITY_LABELS, APPROVAL_ENTITY_TYPES, APPROVAL_INSTANCE_STATUSES } from '@kenzo/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/form';
import { FilterBar } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { formatAmount, formatDateTime, humanize } from '@/lib/format';
import { useCursorList } from '@/lib/hooks';
import { usePermission } from '@/lib/session';
import type { InstanceRow } from '@/lib/types';

export default function ApprovalRequestsPage() {
  const router = useRouter();
  const seeAll = usePermission('approval.instance.read');
  const [status, setStatus] = useState('');
  const [entityType, setEntityType] = useState('');
  const [mine, setMine] = useState(false);
  const list = useCursorList<InstanceRow>(['approvals', 'instances'], '/approvals/instances', { status, entityType, mine: mine ? 'true' : undefined });

  const columns: Column<InstanceRow>[] = [
    {
      key: 'ref',
      header: 'Request',
      cell: (i) => (
        <div>
          <p className="font-medium text-fg">
            {APPROVAL_ENTITY_LABELS[i.entityType as keyof typeof APPROVAL_ENTITY_LABELS] ?? humanize(i.entityType)} {i.entityReference}
          </p>
          <p className="text-xs text-fg-subtle">
            {i.policy.name} · v{i.policy.policyVersion}
          </p>
        </div>
      ),
    },
    { key: 'requester', header: 'Requester', cell: (i) => i.requester.fullName },
    { key: 'amount', header: 'Amount', numeric: true, cell: (i) => formatAmount(i.amount, i.currencyCode) },
    { key: 'submitted', header: 'Submitted', cell: (i) => <span className="text-fg-muted">{formatDateTime(i.submittedAt)}</span> },
    { key: 'waiting', header: 'Waiting on', cell: (i) => <span className="text-fg-muted">{i.tasks.map((t) => t.assignee.fullName).join(', ') || '—'}</span> },
    { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
  ];

  return (
    <>
      <PageHeader
        title={seeAll ? 'Approval requests' : 'My approval requests'}
        description={seeAll ? 'All approvals in this company.' : 'Requests you raised or acted on.'}
        breadcrumbs={[{ label: 'Approvals', href: '/approvals' }, { label: 'Requests' }]}
      />
      <Card>
        <FilterBar>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {APPROVAL_INSTANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </Select>
          <Select aria-label="Type" value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-56">
            <option value="">All types</option>
            {APPROVAL_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {APPROVAL_ENTITY_LABELS[t]}
              </option>
            ))}
          </Select>
          {seeAll && <Checkbox label="Only mine" checked={mine} onChange={(e) => setMine(e.target.checked)} />}
        </FilterBar>
        <DataTable
          caption="Approval requests"
          columns={columns}
          rows={list.items}
          rowKey={(i) => i.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(i) => router.push(`/approvals/${i.id}`)}
          hasNextPage={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={{ title: 'No approval requests', description: 'Requests appear here once a business record is submitted for approval.' }}
        />
      </Card>
    </>
  );
}
