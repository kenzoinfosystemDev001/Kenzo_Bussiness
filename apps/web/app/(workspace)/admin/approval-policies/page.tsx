'use client';

import { APPROVAL_ENTITY_LABELS, APPROVAL_ENTITY_TYPES, type ApprovalEntityType } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, PageLoading, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { errorMessage, get, post } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePermission } from '@/lib/session';
import type { ApprovalPolicy, List } from '@/lib/types';

function NewPolicy({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState<ApprovalEntityType>('purchase_requisition');
  const m = useMutation({
    mutationFn: () =>
      post<ApprovalPolicy>('/approval-policies', {
        entityType,
        name: `${APPROVAL_ENTITY_LABELS[entityType]} approval`,
        requireIndependentApproval: true,
        distinctApproversAcrossStages: true,
        allowDelegation: true,
        excludeInitiatorFromAllStages: true,
        stages: [{ sequence: 1, name: 'Department head', mode: 'ANY', minApprovals: 1, approverType: 'DEPARTMENT_HEAD', departmentIds: [], categoryKeys: [] }],
      }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['approval-policies'] });
      router.push(`/admin/approval-policies/${p.id}`);
    },
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="New approval policy"
      description="Creates a draft you can configure and simulate before publishing."
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <FormField label="Applies to" required>
          <Select value={entityType} onChange={(e) => setEntityType(e.target.value as ApprovalEntityType)}>
            {APPROVAL_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {APPROVAL_ENTITY_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ApprovalPoliciesPage() {
  const canRead = usePermission('approval.policy.read');
  const canManage = usePermission('approval.policy.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['approval-policies'], queryFn: () => get<List<ApprovalPolicy>>('/approval-policies'), enabled: canRead });

  if (!canRead) return <PermissionDenied />;
  const byType = new Map<string, ApprovalPolicy[]>();
  for (const p of q.data?.items ?? []) byType.set(p.entityType, [...(byType.get(p.entityType) ?? []), p]);

  return (
    <>
      <PageHeader
        title="Approval policies"
        description="Versioned, configurable approval rules. Publishing a draft retires the previous version; approvals already in progress keep the version they started with."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Approval policies' }]}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New policy
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <PageLoading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : byType.size === 0 ? (
        <Card>
          <EmptyState title="No approval policies" description="Business records cannot be submitted for approval until a policy is published." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...byType.entries()].map(([type, versions]) => {
            const active = versions.find((v) => v.status === 'ACTIVE');
            return (
              <Card key={type}>
                <CardHeader
                  title={APPROVAL_ENTITY_LABELS[type as ApprovalEntityType] ?? type}
                  description={
                    active
                      ? `Active: version ${active.policyVersion} · ${active.stages.length} stage(s)`
                      : 'No active version — submissions of this type are blocked'
                  }
                  actions={!active && <StatusBadge status="PENDING" label="Not published" />}
                />
                <ul className="divide-y divide-border">
                  {versions.map((v) => (
                    <li key={v.id}>
                      <Link href={`/admin/approval-policies/${v.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted/60">
                        <span className="tabular w-10 text-sm font-semibold text-fg-muted">v{v.policyVersion}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{v.name}</p>
                          <p className="text-xs text-fg-subtle">
                            {v.stages.map((s) => s.name).join(' → ')}
                            {v.publishedAt ? ` · published ${formatDate(v.publishedAt)}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={v.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {creating && <NewPolicy onClose={() => setCreating(false)} />}
    </>
  );
}
