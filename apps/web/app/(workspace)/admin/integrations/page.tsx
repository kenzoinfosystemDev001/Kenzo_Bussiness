'use client';

import { INTEGRATION_KINDS, integrationConfigSchema, isSecretFieldName } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Input, Select, Switch } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { errorMessage, get, post, put } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { relativeTime } from '@/lib/format';
import { usePermission } from '@/lib/session';
import type { IntegrationConfig, List } from '@/lib/types';

type Row = { key: string; value: string };

function IntegrationDrawer({ config, onClose }: { config: IntegrationConfig | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    kind: config?.kind ?? 'EMAIL',
    provider: config?.provider ?? '',
    name: config?.name ?? '',
    enabled: config?.enabled ?? false,
    secretRef: config?.secretRef ?? '',
  });
  const [rows, setRows] = useState<Row[]>(Object.entries(config?.settings ?? {}).map(([key, value]) => ({ key, value: String(value) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => (config ? put(`/integrations/${config.id}`, body) : post('/integrations', body)),
    onSuccess: async () => {
      toast.success('Integration saved');
      await qc.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const settings = Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));
    const body = { ...form, secretRef: form.secretRef || null, settings };
    const v = validate(integrationConfigSchema, body);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(config ? { ...v.data, version: config.version } : v.data);
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title={config ? `Edit ${config.name}` : 'Add integration'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="integration-form" loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="integration-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <Alert tone="info" title="Secrets never live here">
          Store API keys, passwords and client secrets in the secret manager, then enter only the secret&apos;s reference name below. Setting names that look
          like secrets are rejected.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Type" required error={errors.kind}>
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} disabled={!!config}>
              {INTEGRATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Provider" required hint="e.g. ses, s3, textract, azure-ad" error={errors.provider}>
            <Input
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value.toLowerCase() })}
              disabled={!!config}
              className="font-mono"
            />
          </FormField>
          <FormField label="Display name" required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Secret reference" hint="Name/path in the secret manager, e.g. prod/ses/credentials" error={errors.secretRef}>
            <Input value={form.secretRef} onChange={(e) => setForm({ ...form, secretRef: e.target.value })} className="font-mono" />
          </FormField>
        </div>
        <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} label="Enabled" />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-fg">Non-secret settings</legend>
          {rows.map((r, i) => {
            const looksSecret = r.key && isSecretFieldName(r.key);
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  aria-label="Setting name"
                  placeholder="region"
                  value={r.key}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  aria-invalid={looksSecret || undefined}
                />
                <Input
                  aria-label="Setting value"
                  placeholder="ap-south-1"
                  value={r.value}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                />
                <Button variant="ghost" size="icon" aria-label="Remove setting" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
                {looksSecret && <p className="col-span-3 text-xs text-danger">“{r.key}” looks like a secret — use the secret reference instead.</p>}
              </div>
            );
          })}
          {Object.entries(errors)
            .filter(([k]) => k.startsWith('settings'))
            .map(([k, v]) => (
              <p key={k} className="text-xs text-danger">
                {v}
              </p>
            ))}
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setRows([...rows, { key: '', value: '' }])}>
            <Plus aria-hidden /> Add setting
          </Button>
        </fieldset>
      </form>
    </Drawer>
  );
}

export default function IntegrationsPage() {
  const canRead = usePermission('integration.read');
  const canManage = usePermission('integration.manage');
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => get<List<IntegrationConfig>>('/integrations'), enabled: canRead });
  const [editing, setEditing] = useState<IntegrationConfig | 'new' | null>(null);
  const columns: Column<IntegrationConfig>[] = [
    { key: 'name', header: 'Integration', cell: (c) => <span className="font-medium text-fg">{c.name}</span> },
    { key: 'kind', header: 'Type', cell: (c) => <Badge>{c.kind}</Badge> },
    { key: 'provider', header: 'Provider', cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.provider}</span> },
    {
      key: 'secret',
      header: 'Secret',
      cell: (c) =>
        c.secretRef ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted">
            <KeyRound className="size-3" aria-hidden />
            {c.secretRef}
          </span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { key: 'updated', header: 'Updated', cell: (c) => <span className="text-fg-muted">{relativeTime(c.updatedAt)}</span> },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.enabled ? 'ENABLED' : 'DISABLED'} /> },
  ];
  if (!canRead) return <PermissionDenied />;
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connections to SSO, email, storage, OCR, ERP, HRMS and bank systems. Adapters are delivered with their modules; configuration lives here."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Integrations' }]}
        actions={
          canManage && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add integration
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          caption="Integrations"
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(c) => c.id}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={canManage ? (c) => setEditing(c) : undefined}
          empty={{ title: 'No integrations configured' }}
        />
      </Card>
      {editing && <IntegrationDrawer config={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
