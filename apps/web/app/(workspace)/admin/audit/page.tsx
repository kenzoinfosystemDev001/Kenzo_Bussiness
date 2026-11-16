'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, KeyValue } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { ErrorState, PermissionDenied, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { FilterBar, JsonBlock } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { UserPicker } from '@/components/workflow/user-picker';
import { get } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import { useCursorList, useDebouncedValue } from '@/lib/hooks';
import { usePermission } from '@/lib/session';
import type { AuditDetail, AuditRow } from '@/lib/types';

function AuditDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['audit', 'detail', id], queryFn: () => get<AuditDetail>(`/audit-events/${id}`) });
  const e = q.data;
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={e ? humanize(e.action) : 'Audit event'}
      description={e ? formatDateTime(e.occurredAt) : undefined}
    >
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error || !e ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="flex flex-col gap-5">
          <KeyValue
            items={[
              { label: 'Action', value: <span className="font-mono text-sm">{e.action}</span> },
              { label: 'Outcome', value: <StatusBadge status={e.outcome} /> },
              { label: 'Actor', value: e.actor ? `${e.actor.fullName} (${e.actor.email ?? ''})` : 'System' },
              { label: 'Entity', value: `${e.entityType}${e.entityId ? ` · ${e.entityId}` : ''}`, mono: true },
              { label: 'IP address', value: e.ipAddress ?? '—', mono: true },
              { label: 'Correlation ID', value: e.correlationId ?? '—', mono: true },
              { label: 'Reason', value: e.reason ?? '—' },
              { label: 'User agent', value: <span className="text-xs">{e.userAgent ?? '—'}</span> },
            ]}
          />
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">Before</p>
            <JsonBlock value={e.beforeData} />
            {e.beforeHash && <p className="mt-1 break-all font-mono text-2xs text-fg-subtle">sha256 {e.beforeHash}</p>}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-subtle">After</p>
            <JsonBlock value={e.afterData} />
            {e.afterHash && <p className="mt-1 break-all font-mono text-2xs text-fg-subtle">sha256 {e.afterHash}</p>}
          </div>
          <p className="text-xs text-fg-subtle">Audit events are append-only; secrets are redacted before storage.</p>
        </div>
      )}
    </Drawer>
  );
}

export default function AuditLogPage() {
  const canRead = usePermission('audit.read');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const filters = useDebouncedValue({ action, entityType }, 350);
  const list = useCursorList<AuditRow>(
    ['audit', 'list'],
    '/audit-events',
    {
      action: filters.action,
      entityType: filters.entityType,
      actorId,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    },
    { enabled: canRead, limit: 50 },
  );

  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'When', cell: (e) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(e.occurredAt)}</span> },
    { key: 'action', header: 'Action', cell: (e) => <span className="font-mono text-xs text-fg">{e.action}</span> },
    { key: 'actor', header: 'Actor', cell: (e) => e.actor?.fullName ?? <span className="text-fg-subtle">System</span> },
    { key: 'entity', header: 'Entity', cell: (e) => <span className="text-fg-muted">{humanize(e.entityType)}</span> },
    { key: 'reason', header: 'Reason', cell: (e) => <span className="block max-w-xs truncate text-fg-muted">{e.reason ?? ''}</span> },
    { key: 'outcome', header: 'Outcome', cell: (e) => <StatusBadge status={e.outcome} /> },
  ];

  if (!canRead) return <PermissionDenied />;
  const clear = () => {
    setAction('');
    setEntityType('');
    setActorId('');
    setFrom('');
    setTo('');
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every sensitive action in this company."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Audit log' }]}
      />
      <Card>
        <FilterBar className="items-end">
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Action starts with
            <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. user. or auth.login" className="w-48 font-mono" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Entity type
            <Input value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. user" className="w-36" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            From
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            To
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
          <div className="w-72 text-xs text-fg-subtle">
            Actor
            <UserPicker value={actorId} onChange={setActorId} placeholder="Anyone" />
          </div>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear filters
          </Button>
        </FilterBar>
        <DataTable
          caption="Audit events"
          columns={columns}
          rows={list.items}
          rowKey={(e) => e.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(e) => setSelected(e.id)}
          hasNextPage={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={{ title: 'No audit events match these filters' }}
        />
      </Card>
      {selected && <AuditDetailDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
