'use client';

import { costCentreSchema, departmentSchema, updateCompanySchema } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Alert, ErrorState, PageLoading, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Input, Select, Switch } from '@/components/ui/form';
import { Tabs } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/workflow/user-picker';
import { errorMessage, get, patch, post } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { MONTHS } from '@/lib/format';
import { useCostCentres, useDepartments } from '@/lib/queries';
import { usePermission } from '@/lib/session';
import type { Company, CostCentre, Department } from '@/lib/types';

const COMPANY_FIELDS = [
  'legalName',
  'displayName',
  'gstin',
  'pan',
  'timezone',
  'baseCurrency',
  'fiscalYearStartMonth',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
] as const;

function CompanyProfile() {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = usePermission('org.company.manage');
  const q = useQuery({ queryKey: ['company'], queryFn: () => get<Company>('/companies/current') });
  const [form, setForm] = useState<Record<string, string | number | boolean> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => patch<Company>('/companies/current', body),
    onSuccess: async () => {
      toast.success('Company profile saved');
      setForm(null);
      await qc.invalidateQueries({ queryKey: ['company'] });
      await qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });

  if (q.isLoading) return <PageLoading rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const values = form ?? { ...Object.fromEntries(COMPANY_FIELDS.map((k) => [k, c[k] ?? ''])), enforceMfaForPrivileged: c.enforceMfaForPrivileged };
  const set = (k: string, v: string | number | boolean) => setForm({ ...values, [k]: v });
  const text = (k: (typeof COMPANY_FIELDS)[number]) => String(values[k] ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { version: c.version, enforceMfaForPrivileged: values.enforceMfaForPrivileged };
    for (const k of COMPANY_FIELDS) {
      const v = values[k];
      body[k] = k === 'fiscalYearStartMonth' ? Number(v) : v === '' ? null : v;
    }
    body.legalName = text('legalName');
    body.displayName = text('displayName');
    body.timezone = text('timezone');
    body.baseCurrency = text('baseCurrency');
    const v = validate(updateCompanySchema, body);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(v.data);
  };

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Company profile"
          description={`Code ${c.code} · legal entity and tenant boundary`}
          actions={
            canManage &&
            form && (
              <Button type="submit" loading={m.isPending}>
                Save changes
              </Button>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {errors.form && <Alert tone="danger">{errors.form}</Alert>}
          <fieldset disabled={!canManage} className="grid gap-4 sm:grid-cols-2">
            <FormField label="Legal name" required error={errors.legalName}>
              <Input value={text('legalName')} onChange={(e) => set('legalName', e.target.value)} />
            </FormField>
            <FormField label="Display name" required error={errors.displayName}>
              <Input value={text('displayName')} onChange={(e) => set('displayName', e.target.value)} />
            </FormField>
            <FormField label="GSTIN" error={errors.gstin}>
              <Input value={text('gstin')} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} className="font-mono" />
            </FormField>
            <FormField label="PAN" error={errors.pan}>
              <Input value={text('pan')} onChange={(e) => set('pan', e.target.value.toUpperCase())} maxLength={10} className="font-mono" />
            </FormField>
            <FormField label="Timezone" required error={errors.timezone}>
              <Input value={text('timezone')} onChange={(e) => set('timezone', e.target.value)} />
            </FormField>
            <FormField label="Base currency" required error={errors.baseCurrency}>
              <Input value={text('baseCurrency')} onChange={(e) => set('baseCurrency', e.target.value.toUpperCase())} maxLength={3} />
            </FormField>
            <FormField label="Fiscal year starts" error={errors.fiscalYearStartMonth}>
              <Select value={String(values.fiscalYearStartMonth)} onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Address line 1" error={errors.addressLine1}>
              <Input value={text('addressLine1')} onChange={(e) => set('addressLine1', e.target.value)} />
            </FormField>
            <FormField label="Address line 2" error={errors.addressLine2}>
              <Input value={text('addressLine2')} onChange={(e) => set('addressLine2', e.target.value)} />
            </FormField>
            <FormField label="City" error={errors.city}>
              <Input value={text('city')} onChange={(e) => set('city', e.target.value)} />
            </FormField>
            <FormField label="State" error={errors.state}>
              <Input value={text('state')} onChange={(e) => set('state', e.target.value)} />
            </FormField>
            <FormField label="Postal code" error={errors.postalCode}>
              <Input value={text('postalCode')} onChange={(e) => set('postalCode', e.target.value)} />
            </FormField>
          </fieldset>
          <div className="rounded-md border border-border p-3">
            <Switch
              checked={Boolean(values.enforceMfaForPrivileged)}
              onCheckedChange={(v) => set('enforceMfaForPrivileged', v)}
              disabled={!canManage}
              label="Require MFA for privileged actions"
              description="Users must verify with an authenticator app before role changes, policy publishing, payment approval and other sensitive actions."
            />
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

function DepartmentDrawer({ dept, departments, onClose }: { dept: Department | null; departments: Department[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    code: dept?.code ?? '',
    name: dept?.name ?? '',
    parentId: dept?.parentId ?? '',
    headUserId: dept?.headUserId ?? '',
    isActive: dept?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => (dept ? patch(`/departments/${dept.id}`, body) : post('/departments', body)),
    onSuccess: async () => {
      toast.success(dept ? 'Department updated' : 'Department created');
      await qc.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { code: form.code, name: form.name, parentId: form.parentId || null, headUserId: form.headUserId || null };
    const v = validate(departmentSchema, body);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(dept ? { ...v.data, isActive: form.isActive, version: dept.version } : v.data);
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={dept ? `Edit ${dept.name}` : 'New department'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="dept-form" loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="dept-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Code" required error={errors.code}>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="font-mono" />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="Parent department" error={errors.parentId}>
          <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
            <option value="">None (top level)</option>
            {departments
              .filter((d) => d.id !== dept?.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="Department head" hint="Routes department-head approval stages." error={errors.headUserId}>
          <UserPicker value={form.headUserId} onChange={(id) => setForm({ ...form, headUserId: id })} placeholder="No head" />
        </FormField>
        {dept && (
          <Switch
            checked={form.isActive}
            onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            label="Active"
            description="Inactive departments cannot be selected on new records."
          />
        )}
      </form>
    </Drawer>
  );
}

function Departments() {
  const canManage = usePermission('org.department.manage');
  const q = useDepartments();
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const columns: Column<Department>[] = [
    { key: 'name', header: 'Department', cell: (d) => <span className="font-medium text-fg">{d.name}</span> },
    { key: 'code', header: 'Code', cell: (d) => <span className="font-mono text-xs text-fg-muted">{d.code}</span> },
    { key: 'parent', header: 'Parent', cell: (d) => <span className="text-fg-muted">{d.parent?.name ?? '—'}</span> },
    { key: 'head', header: 'Head', cell: (d) => d.head?.fullName ?? <span className="text-fg-subtle">Not set</span> },
    { key: 'members', header: 'Members', numeric: true, cell: (d) => d._count.members },
    { key: 'status', header: 'Status', cell: (d) => <StatusBadge status={d.isActive ? 'ACTIVE' : 'DISABLED'} label={d.isActive ? 'Active' : 'Inactive'} /> },
  ];
  return (
    <Card>
      <CardHeader
        title="Departments"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Department
            </Button>
          )
        }
      />
      <DataTable
        caption="Departments"
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(d) => d.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={canManage ? (d) => setEditing(d) : undefined}
        empty={{ title: 'No departments yet', description: 'Departments drive approval routing and department-scoped access.' }}
      />
      {editing && <DepartmentDrawer dept={editing === 'new' ? null : editing} departments={q.data?.items ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CostCentreDrawer({ cc, onClose }: { cc: CostCentre | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const departments = useDepartments();
  const [form, setForm] = useState({ code: cc?.code ?? '', name: cc?.name ?? '', departmentId: cc?.departmentId ?? '', isActive: cc?.isActive ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => (cc ? patch(`/cost-centres/${cc.id}`, body) : post('/cost-centres', body)),
    onSuccess: async () => {
      toast.success(cc ? 'Cost centre updated' : 'Cost centre created');
      await qc.invalidateQueries({ queryKey: ['cost-centres'] });
      onClose();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(costCentreSchema, { code: form.code, name: form.name, departmentId: form.departmentId || null });
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(cc ? { ...v.data, isActive: form.isActive, version: cc.version } : v.data);
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={cc ? `Edit ${cc.code}` : 'New cost centre'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="cc-form" loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="cc-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Code" required error={errors.code}>
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="font-mono" />
        </FormField>
        <FormField label="Name" required error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="Department" error={errors.departmentId}>
          <Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">None</option>
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FormField>
        {cc && <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} label="Active" />}
      </form>
    </Drawer>
  );
}

function CostCentres() {
  const canManage = usePermission('org.cost_centre.manage');
  const q = useCostCentres();
  const [editing, setEditing] = useState<CostCentre | 'new' | null>(null);
  const columns: Column<CostCentre>[] = [
    { key: 'code', header: 'Code', cell: (c) => <span className="font-mono text-xs font-medium text-fg">{c.code}</span> },
    { key: 'name', header: 'Name', cell: (c) => c.name },
    { key: 'dept', header: 'Department', cell: (c) => <span className="text-fg-muted">{c.department?.name ?? '—'}</span> },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.isActive ? 'ACTIVE' : 'DISABLED'} label={c.isActive ? 'Active' : 'Inactive'} /> },
  ];
  return (
    <Card>
      <CardHeader
        title="Cost centres"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Cost centre
            </Button>
          )
        }
      />
      <DataTable
        caption="Cost centres"
        columns={columns}
        rows={q.data?.items ?? []}
        rowKey={(c) => c.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={canManage ? (c) => setEditing(c) : undefined}
        empty={{ title: 'No cost centres yet' }}
      />
      {editing && <CostCentreDrawer cc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export default function OrganizationPage() {
  const canCompany = usePermission('org.company.read');
  const canDept = usePermission('org.department.read');
  const canCc = usePermission('org.cost_centre.read');
  const tabs = [
    ...(canCompany ? [{ value: 'company', label: 'Company' }] : []),
    ...(canDept ? [{ value: 'departments', label: 'Departments' }] : []),
    ...(canCc ? [{ value: 'cost-centres', label: 'Cost centres' }] : []),
  ];
  const [tab, setTab] = useState<string | null>(null);
  const current = tab ?? tabs[0]?.value;
  if (tabs.length === 0) return <PermissionDenied />;
  return (
    <>
      <PageHeader
        title="Organization"
        description="Legal entity details, departments and cost centres used for routing, scoping and reporting."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Organization' }]}
      />
      <Tabs items={tabs} value={current ?? ''} onChange={setTab} className="mb-6" />
      {current === 'company' && <CompanyProfile />}
      {current === 'departments' && <Departments />}
      {current === 'cost-centres' && <CostCentres />}
    </>
  );
}
