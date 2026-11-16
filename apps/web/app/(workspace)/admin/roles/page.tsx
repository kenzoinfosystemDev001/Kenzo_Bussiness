'use client';

import { createRoleSchema } from '@kenzo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Input, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { PermissionMatrix } from '@/components/workflow/permission-matrix';
import { errorMessage, post } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { usePermissionCatalogue, useRoles } from '@/lib/queries';
import { useSession, usePermission } from '@/lib/session';
import type { Grant, RoleDetail, RoleRow } from '@/lib/types';

function CreateRole({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const { data: session } = useSession();
  const catalogue = usePermissionCatalogue();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => post<RoleDetail>('/roles', body),
    onSuccess: async (role) => {
      toast.success('Role created');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
      router.push(`/admin/roles/${role.id}`);
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(createRoleSchema, { key, name, description: description || null, permissions: grants });
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(v.data);
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title="Create custom role"
      description="You can only include permissions you hold yourself, at up to your own scope."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" loading={m.isPending}>
            Create role
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required error={errors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField label="Key" required hint="Uppercase identifier, e.g. VENDOR_REVIEWER" error={errors.key}>
            <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} className="font-mono" />
          </FormField>
        </div>
        <FormField label="Description" error={errors.description}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <div>
          <p className="mb-2 text-sm font-medium text-fg">
            Permissions <span className="tabular text-fg-subtle">({grants.length} selected)</span>
          </p>
          {catalogue.data && (
            <PermissionMatrix catalogue={catalogue.data.items} grants={grants} onChange={setGrants} editorPermissions={session?.permissions} />
          )}
        </div>
      </form>
    </Drawer>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const canRead = usePermission('role.read');
  const canManage = usePermission('role.manage');
  const roles = useRoles(canRead);
  const [creating, setCreating] = useState(false);

  const columns: Column<RoleRow>[] = [
    {
      key: 'name',
      header: 'Role',
      cell: (r) => (
        <div>
          <p className="font-medium text-fg">
            {r.name}{' '}
            {r.isSystem ? (
              <Badge className="ml-1">System</Badge>
            ) : (
              <Badge tone="info" className="ml-1">
                Custom
              </Badge>
            )}
          </p>
          <p className="max-w-xl truncate text-xs text-fg-subtle">{r.description}</p>
        </div>
      ),
    },
    { key: 'key', header: 'Key', cell: (r) => <span className="font-mono text-xs text-fg-muted">{r.key}</span> },
    { key: 'perms', header: 'Permissions', numeric: true, cell: (r) => r.permissions.length },
    { key: 'users', header: 'Active users', numeric: true, cell: (r) => r.activeAssignments },
  ];

  if (!canRead) return <PermissionDenied />;
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="System roles follow the platform's separation-of-duties design and cannot be edited. Create custom roles for anything else."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Roles & permissions' }]}
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Custom role
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          caption="Roles"
          columns={columns}
          rows={roles.data?.items ?? []}
          rowKey={(r) => r.id}
          isLoading={roles.isLoading}
          error={roles.error}
          onRetry={() => void roles.refetch()}
          onRowClick={(r) => router.push(`/admin/roles/${r.id}`)}
          empty={{ title: 'No roles' }}
        />
      </Card>
      {creating && <CreateRole open onOpenChange={setCreating} />}
    </>
  );
}
