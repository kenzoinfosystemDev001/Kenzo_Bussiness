'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, PageLoading } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { PermissionMatrix } from '@/components/workflow/permission-matrix';
import { del, errorMessage, get, patch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { usePermissionCatalogue } from '@/lib/queries';
import { useSession, usePermission } from '@/lib/session';
import type { Grant, RoleDetail } from '@/lib/types';

export default function RoleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const canManage = usePermission('role.manage');
  const catalogue = usePermissionCatalogue();
  const q = useQuery({ queryKey: ['roles', id], queryFn: () => get<RoleDetail>(`/roles/${id}`) });
  const [draft, setDraft] = useState<Grant[] | null>(null);
  const [confirm, setConfirm] = useState<'save' | 'delete' | null>(null);

  const save = useMutation({
    mutationFn: (reason: string) => patch(`/roles/${id}`, { permissions: draft, reason }),
    onSuccess: async () => {
      toast.success('Role updated');
      setDraft(null);
      setConfirm(null);
      await qc.invalidateQueries({ queryKey: ['roles'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/roles/${id}`),
    onSuccess: async () => {
      toast.success('Role deleted');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      router.push('/admin/roles');
    },
  });

  if (q.isLoading || catalogue.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const role = q.data;
  const editable = canManage && !role.isSystem;
  const grants = draft ?? role.permissions;

  return (
    <>
      <PageHeader
        title={role.name}
        description={role.description ?? undefined}
        breadcrumbs={[{ label: 'Roles & permissions', href: '/admin/roles' }, { label: role.name }]}
        meta={
          <>
            {role.isSystem ? <Badge>System role</Badge> : <Badge tone="info">Custom role</Badge>}
            <span className="font-mono text-xs text-fg-subtle">{role.key}</span>
          </>
        }
        actions={
          editable && (
            <>
              {draft && (
                <>
                  <Button variant="secondary" onClick={() => setDraft(null)}>
                    Discard
                  </Button>
                  <Button onClick={() => setConfirm('save')}>Save permissions</Button>
                </>
              )}
              {!draft && (
                <Button variant="danger-outline" onClick={() => setConfirm('delete')}>
                  Delete role
                </Button>
              )}
            </>
          )
        }
      />
      {role.isSystem && (
        <Alert tone="info" className="mb-6">
          System roles are defined by the platform so separation of duties stays intact (e.g. administrators never hold payment release). To grant a different
          combination, create a custom role.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Permissions" description={`${grants.length} granted`} />
          <CardBody>
            <PermissionMatrix
              catalogue={catalogue.data?.items ?? []}
              grants={grants}
              onChange={editable ? setDraft : undefined}
              editorPermissions={session?.permissions}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Members" description="Active assignments in this company" />
          {role.assignments.length ? (
            <ul className="divide-y divide-border">
              {role.assignments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/users/${a.user.id}`} className="text-sm font-medium text-fg hover:underline">
                      {a.user.fullName}
                    </Link>
                    <p className="text-xs text-fg-subtle">
                      {a.department ? a.department.name : 'All departments'}
                      {a.validUntil ? ` · until ${formatDateTime(a.validUntil)}` : ''}
                    </p>
                  </div>
                  <StatusBadge status={a.user.status} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nobody holds this role" />
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={confirm === 'save'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Save permission changes?"
        impact={`Changes apply immediately to ${role.assignments.length} user(s) holding this role.`}
        confirmLabel="Save"
        tone="primary"
        requireReason
        loading={save.isPending}
        error={save.error ? errorMessage(save.error) : null}
        onConfirm={(reason) => save.mutate(reason)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${role.name}?`}
        impact="Roles that were ever assigned cannot be deleted — revoke the assignments instead so audit history is kept."
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
