'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Mail, Plus, UserCheck, UserX } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, KeyValue } from '@/components/ui/card';
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, PageLoading, Skeleton } from '@/components/ui/feedback';
import { FormField, Input, Select } from '@/components/ui/form';
import { Avatar } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { ActivityTimeline } from '@/components/workflow/activity-timeline';
import { UserPicker } from '@/components/workflow/user-picker';
import { errorMessage, get, patch, post } from '@/lib/api';
import { serverFieldErrors } from '@/lib/forms';
import { formatDate, formatDateTime, relativeTime } from '@/lib/format';
import { useDepartments, useRoles } from '@/lib/queries';
import { useSession, usePermission } from '@/lib/session';
import type { AuditRow, Page, UserDetail } from '@/lib/types';

function EditProfile({ user, open, onOpenChange }: { user: UserDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const [form, setForm] = useState({
    fullName: user.fullName,
    jobTitle: user.jobTitle ?? '',
    departmentId: user.departmentId ?? '',
    managerId: user.managerId ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      patch(`/users/${user.id}`, {
        fullName: form.fullName,
        jobTitle: form.jobTitle || null,
        departmentId: form.departmentId || null,
        managerId: form.managerId || null,
        version: user.version,
      }),
    onSuccess: async () => {
      toast.success('Profile updated');
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim()) return setErrors({ fullName: 'Name is required' });
    m.mutate();
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Edit profile"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="profile-form" loading={m.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="profile-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Full name" required error={errors.fullName}>
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </FormField>
        <FormField label="Job title" error={errors.jobTitle}>
          <Input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        </FormField>
        <FormField label="Department" error={errors.departmentId}>
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">No department</option>
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Manager" error={errors.managerId}>
          <UserPicker value={form.managerId} onChange={(id) => setForm({ ...form, managerId: id })} excludeIds={[user.id]} placeholder="No manager" />
        </FormField>
      </form>
    </Drawer>
  );
}

function AssignRole({ user, open, onOpenChange }: { user: UserDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles();
  const departments = useDepartments();
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      post(`/users/${user.id}/role-assignments`, {
        roleId,
        departmentId: departmentId || null,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      }),
    onSuccess: async () => {
      toast.success('Role assigned');
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Assign role" description="You can only grant roles whose permissions you hold yourself.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!roleId) return setError('Choose a role');
          m.mutate();
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField label="Role" required>
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Select role</option>
            {roles.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Limit to department" hint="Narrows department-scoped permissions to this department.">
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Expires" hint="Recommended for auditors and temporary access.">
          <Input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </FormField>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={m.isPending}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Pending = { kind: 'deactivate' | 'activate' | 'sessions' } | { kind: 'revoke'; assignmentId: string; roleName: string } | null;

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSession();
  const canManage = usePermission('user.manage');
  const canAssign = usePermission('role.assign');
  const canInvite = usePermission('user.invite');
  const canRevokeSessions = usePermission('user.session.revoke');
  const canAudit = usePermission('audit.read');
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const q = useQuery({ queryKey: ['users', 'detail', id], queryFn: () => get<UserDetail>(`/users/${id}`) });
  const audit = useQuery({
    queryKey: ['audit', 'user', id],
    queryFn: () => get<Page<AuditRow>>('/audit-events', { entityType: 'user', entityId: id, limit: 15 }),
    enabled: canAudit,
  });

  const action = useMutation({
    mutationFn: async (reason: string) => {
      if (!pending) return;
      if (pending.kind === 'revoke') return post(`/users/role-assignments/${pending.assignmentId}/revoke`, { reason });
      if (pending.kind === 'deactivate') return post(`/users/${id}/deactivate`, { reason });
      if (pending.kind === 'activate') return post(`/users/${id}/activate`, { reason });
      return post(`/users/${id}/sessions/revoke`, { reason });
    },
    onSuccess: async () => {
      toast.success('Done');
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  const resend = useMutation({
    mutationFn: () => post(`/users/${id}/invitation/resend`),
    onSuccess: () => toast.success('Invitation resent'),
    onError: (e) => toast.error('Could not resend', errorMessage(e)),
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const u = q.data;
  const self = session?.user.id === u.id;
  const active = u.roleAssignments.filter((a) => !a.revokedAt && (!a.validUntil || new Date(a.validUntil) > new Date()));
  const history = u.roleAssignments.filter((a) => !active.includes(a));

  const confirmCopy: Record<string, { title: string; impact: string; label: string; tone: 'danger' | 'primary' }> = {
    deactivate: {
      title: `Deactivate ${u.fullName}?`,
      impact: 'All of their sessions end immediately and they can no longer sign in. Their history is preserved.',
      label: 'Deactivate',
      tone: 'danger',
    },
    activate: {
      title: `Reactivate ${u.fullName}?`,
      impact: 'They will be able to sign in again with their existing roles.',
      label: 'Reactivate',
      tone: 'primary',
    },
    sessions: { title: 'Sign this user out everywhere?', impact: 'Every active session for this user is revoked.', label: 'Revoke sessions', tone: 'danger' },
    revoke: {
      title: 'Revoke role?',
      impact: 'The permissions granted by this role are removed immediately. The assignment stays in history.',
      label: 'Revoke role',
      tone: 'danger',
    },
  };
  const copy = pending ? confirmCopy[pending.kind]! : null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={u.fullName} />
            {u.fullName}
          </span>
        }
        description={u.email}
        breadcrumbs={[{ label: 'Users', href: '/admin/users' }, { label: u.fullName }]}
        meta={
          <>
            <StatusBadge status={u.status} />
            {u.mfaEnabled ? <Badge tone="success">MFA enabled</Badge> : <Badge>MFA off</Badge>}
            {self && <Badge tone="info">You</Badge>}
          </>
        }
        actions={
          <>
            {canManage && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit profile
              </Button>
            )}
            {canInvite && u.status === 'INVITED' && (
              <Button variant="secondary" onClick={() => resend.mutate()} loading={resend.isPending}>
                <Mail aria-hidden /> Resend invitation
              </Button>
            )}
            {canRevokeSessions && u.status === 'ACTIVE' && (
              <Button variant="secondary" onClick={() => setPending({ kind: 'sessions' })}>
                <LogOut aria-hidden /> Revoke sessions
              </Button>
            )}
            {canManage && !self && u.status !== 'DEACTIVATED' && (
              <Button variant="danger-outline" onClick={() => setPending({ kind: 'deactivate' })}>
                <UserX aria-hidden /> Deactivate
              </Button>
            )}
            {canManage && !self && u.status === 'DEACTIVATED' && (
              <Button onClick={() => setPending({ kind: 'activate' })}>
                <UserCheck aria-hidden /> Reactivate
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <KeyValue
                items={[
                  { label: 'Job title', value: u.jobTitle ?? '—' },
                  { label: 'Department', value: u.department?.name ?? '—' },
                  { label: 'Manager', value: u.manager?.fullName ?? '—' },
                  { label: 'Last sign-in', value: u.lastLoginAt ? `${formatDateTime(u.lastLoginAt)} (${relativeTime(u.lastLoginAt)})` : 'Never' },
                  { label: 'Activated', value: formatDate(u.activatedAt) },
                  { label: 'Active sessions', value: u.activeSessionCount ?? '—' },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Roles"
              description="Effective in this company only."
              actions={
                canAssign &&
                !self && (
                  <Button size="sm" onClick={() => setAssigning(true)}>
                    <Plus aria-hidden /> Assign role
                  </Button>
                )
              }
            />
            {self && canAssign && (
              <Alert className="mx-5 mt-4" tone="info">
                You cannot change your own role assignments (separation of duties).
              </Alert>
            )}
            {active.length === 0 ? (
              <EmptyState icon={KeyRound} title="No active roles" description="This user cannot access anything until a role is assigned." />
            ) : (
              <ul className="divide-y divide-border">
                {active.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-fg">
                        {a.role.name} {a.role.isSystem && <Badge className="ml-1">System</Badge>}
                      </p>
                      <p className="text-xs text-fg-subtle">
                        {a.department ? `Limited to ${a.department.name}` : 'All departments'} · granted {formatDate(a.createdAt)}
                        {a.grantedBy ? ` by ${a.grantedBy.fullName}` : ''}
                        {a.validUntil ? ` · expires ${formatDateTime(a.validUntil)}` : ''}
                      </p>
                    </div>
                    {canAssign && !self && (
                      <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'revoke', assignmentId: a.id, roleName: a.role.name })}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {history.length > 0 && (
              <details className="border-t border-border px-5 py-3 text-sm">
                <summary className="cursor-pointer text-fg-muted">Role history ({history.length})</summary>
                <ul className="mt-2 flex flex-col gap-1 text-fg-muted">
                  {history.map((a) => (
                    <li key={a.id}>
                      {a.role.name} — {a.revokedAt ? `revoked ${formatDate(a.revokedAt)}` : `expired ${formatDate(a.validUntil)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </div>
        {canAudit && (
          <Card>
            <CardHeader title="Activity" description="Audited changes to this account" />
            <CardBody>
              {audit.isLoading ? (
                <Skeleton className="h-40" />
              ) : audit.error ? (
                <ErrorState error={audit.error} />
              ) : audit.data?.items.length ? (
                <ActivityTimeline events={audit.data.items} />
              ) : (
                <EmptyState title="No activity yet" />
              )}
            </CardBody>
          </Card>
        )}
      </div>
      {editing && <EditProfile user={u} open onOpenChange={setEditing} />}
      {assigning && <AssignRole user={u} open onOpenChange={setAssigning} />}
      {copy && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={copy.title}
          description={pending?.kind === 'revoke' ? pending.roleName : undefined}
          impact={copy.impact}
          confirmLabel={copy.label}
          tone={copy.tone}
          requireReason
          loading={action.isPending}
          error={action.error ? errorMessage(action.error) : null}
          onConfirm={(reason) => action.mutate(reason)}
        />
      )}
    </>
  );
}
