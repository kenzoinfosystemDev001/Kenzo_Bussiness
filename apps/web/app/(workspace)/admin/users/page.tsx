'use client';

import { inviteUserSchema } from '@kenzo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Input, Select } from '@/components/ui/form';
import { Avatar, FilterBar, SearchInput } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/workflow/user-picker';
import { errorMessage, post } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { relativeTime } from '@/lib/format';
import { useCursorList } from '@/lib/hooks';
import { useDepartments, useRoles } from '@/lib/queries';
import { usePermission } from '@/lib/session';
import type { UserDetail, UserRow } from '@/lib/types';

function InviteDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const canAssign = usePermission('role.assign');
  const departments = useDepartments(usePermission('org.department.read'));
  const roles = useRoles(usePermission('role.read'));
  const [form, setForm] = useState({ email: '', fullName: '', jobTitle: '', departmentId: '', managerId: '' });
  const [assignments, setAssignments] = useState<Array<{ roleId: string; departmentId: string }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: (body: unknown) => post<UserDetail>('/users/invitations', body),
    onSuccess: async (user) => {
      toast.success('Invitation sent', `${user.email} has 72 hours to activate their account.`);
      await qc.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
      router.push(`/admin/users/${user.id}`);
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      email: form.email,
      fullName: form.fullName,
      jobTitle: form.jobTitle || null,
      departmentId: form.departmentId || null,
      managerId: form.managerId || null,
      roleAssignments: assignments.filter((a) => a.roleId).map((a) => ({ roleId: a.roleId, departmentId: a.departmentId || null })),
    };
    const v = validate(inviteUserSchema, body);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(v.data);
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a user"
      description="They receive a single-use link to set their own password. No password is ever shared."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={m.isPending}>
            <UserPlus aria-hidden /> Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Full name" required error={errors.fullName}>
            <Input value={form.fullName} onChange={set('fullName')} autoComplete="off" />
          </FormField>
          <FormField label="Work email" required error={errors.email}>
            <Input type="email" value={form.email} onChange={set('email')} autoComplete="off" />
          </FormField>
          <FormField label="Job title" error={errors.jobTitle}>
            <Input value={form.jobTitle} onChange={set('jobTitle')} />
          </FormField>
          <FormField label="Department" error={errors.departmentId}>
            <Select value={form.departmentId} onChange={set('departmentId')}>
              <option value="">No department</option>
              {departments.data?.items
                .filter((d) => d.isActive)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Manager" hint="Used for manager-based approval routing." error={errors.managerId}>
          <UserPicker value={form.managerId} onChange={(id) => setForm((f) => ({ ...f, managerId: id }))} placeholder="No manager" />
        </FormField>

        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-fg">Roles</legend>
          {!canAssign && (
            <p className="text-sm text-fg-muted">
              You can invite users but not assign roles. An administrator with role-assignment permission must grant access.
            </p>
          )}
          {canAssign &&
            assignments.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Select
                  aria-label="Role"
                  value={a.roleId}
                  onChange={(e) => setAssignments((all) => all.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}
                >
                  <option value="">Select role</option>
                  {roles.data?.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Limit to department"
                  value={a.departmentId}
                  onChange={(e) => setAssignments((all) => all.map((x, j) => (j === i ? { ...x, departmentId: e.target.value } : x)))}
                >
                  <option value="">All departments</option>
                  {departments.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove role" onClick={() => setAssignments((all) => all.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          {canAssign && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setAssignments((all) => [...all, { roleId: '', departmentId: '' }])}>
              <Plus aria-hidden /> Add role
            </Button>
          )}
          {errors.roleAssignments && <p className="text-xs text-danger">{errors.roleAssignments}</p>}
        </fieldset>
      </form>
    </Drawer>
  );
}

function UsersContent() {
  const router = useRouter();
  const params = useSearchParams();
  const canRead = usePermission('user.read');
  const canInvite = usePermission('user.invite');
  const departments = useDepartments(usePermission('org.department.read'));
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [inviting, setInviting] = useState(() => params.get('invite') === '1' && canInvite);
  const list = useCursorList<UserRow>(['users', 'list'], '/users', { q, status, departmentId }, { enabled: canRead });

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (u) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={u.fullName} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{u.fullName}</p>
            <p className="truncate text-xs text-fg-subtle">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'dept', header: 'Department', cell: (u) => <span className="text-fg-muted">{u.department?.name ?? '—'}</span> },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) =>
        u.roleAssignments.length ? (
          <div className="flex max-w-xs flex-wrap gap-1">
            {u.roleAssignments.map((a) => (
              <Badge key={a.id}>{a.role.name}</Badge>
            ))}
          </div>
        ) : (
          <span className="text-fg-subtle">No roles</span>
        ),
    },
    { key: 'mfa', header: 'MFA', cell: (u) => (u.mfaEnabled ? <Badge tone="success">On</Badge> : <span className="text-fg-subtle">Off</span>) },
    { key: 'last', header: 'Last sign-in', cell: (u) => <span className="text-fg-muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</span> },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
  ];

  if (!canRead) return <PermissionDenied />;

  return (
    <>
      <PageHeader
        title="Users"
        description="People with access to this company, their roles and account status."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Users' }]}
        actions={
          canInvite && (
            <Button onClick={() => setInviting(true)}>
              <UserPlus aria-hidden /> Invite user
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchInput value={q} onChange={setQ} placeholder="Search name or email" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="DEACTIVATED">Deactivated</option>
          </Select>
          <Select aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-48">
            <option value="">All departments</option>
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        <DataTable
          caption="Users"
          columns={columns}
          rows={list.items}
          rowKey={(u) => u.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
          hasNextPage={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={{
            title: q || status || departmentId ? 'No users match these filters' : 'No users yet',
            action: canInvite ? <Button onClick={() => setInviting(true)}>Invite the first user</Button> : undefined,
          }}
        />
      </Card>
      {inviting && <InviteDrawer open onOpenChange={setInviting} />}
    </>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <UsersContent />
    </Suspense>
  );
}
