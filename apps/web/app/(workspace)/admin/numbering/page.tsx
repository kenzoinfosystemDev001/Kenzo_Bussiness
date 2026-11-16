'use client';

import { numberingSeriesSchema } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { FormField, Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { errorMessage, get, post, put } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { humanize } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { usePermission } from '@/lib/session';
import type { List, NumberingSeries } from '@/lib/types';

function EditSeries({ series, onClose }: { series: NumberingSeries; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ prefix: series.prefix, pattern: series.pattern, padding: series.padding, resetPolicy: series.resetPolicy });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const debounced = useDebouncedValue(form, 300);
  const preview = useMutation({
    mutationFn: (body: typeof form) => post<NumberingSeries['preview']>(`/numbering-series/${series.documentType}/preview`, body),
  });
  const { mutate: runPreview } = preview;

  useEffect(() => {
    const v = validate(numberingSeriesSchema, { ...debounced, documentType: series.documentType });
    if (!v.errors) runPreview(debounced);
  }, [debounced, series.documentType, runPreview]);

  const save = useMutation({
    mutationFn: () => put(`/numbering-series/${series.documentType}`, { ...form, version: series.version }),
    onSuccess: async () => {
      toast.success('Numbering updated');
      await qc.invalidateQueries({ queryKey: ['numbering'] });
      onClose();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(numberingSeriesSchema, { ...form, documentType: series.documentType });
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    save.mutate();
  };
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${humanize(series.documentType)} numbering`}
      description="Format changes apply to the next number issued. Counters are never reset by an edit."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="series-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="series-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <FormField label="Prefix" required error={errors.prefix}>
          <Input value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} className="font-mono" maxLength={10} />
        </FormField>
        <FormField label="Pattern" required hint="Tokens: {PREFIX} {FY} {FYS} {YYYY} {MM} {SEQ} or {SEQ:n}" error={errors.pattern}>
          <Input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} className="font-mono" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Sequence digits" error={errors.padding}>
            <Input type="number" min={3} max={10} value={form.padding} onChange={(e) => setForm({ ...form, padding: Number(e.target.value) })} />
          </FormField>
          <FormField label="Restart counter" error={errors.resetPolicy}>
            <Select value={form.resetPolicy} onChange={(e) => setForm({ ...form, resetPolicy: e.target.value as 'NEVER' | 'FISCAL_YEAR' })}>
              <option value="FISCAL_YEAR">Every fiscal year</option>
              <option value="NEVER">Never</option>
            </Select>
          </FormField>
        </div>
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <p className="text-xs uppercase tracking-wide text-fg-subtle">Next number</p>
          <p className="mt-1 font-mono text-md font-semibold text-fg" aria-live="polite">
            {preview.data?.example ?? (preview.isPending ? '…' : '—')}
          </p>
          {preview.error && <p className="mt-1 text-xs text-danger">{errorMessage(preview.error)}</p>}
        </div>
      </form>
    </Drawer>
  );
}

export default function NumberingPage() {
  const canRead = usePermission('numbering.read');
  const canManage = usePermission('numbering.manage');
  const q = useQuery({ queryKey: ['numbering'], queryFn: () => get<List<NumberingSeries>>('/numbering-series'), enabled: canRead });
  const [editing, setEditing] = useState<NumberingSeries | null>(null);
  const columns: Column<NumberingSeries>[] = [
    { key: 'type', header: 'Document', cell: (s) => <span className="font-medium text-fg">{humanize(s.documentType)}</span> },
    { key: 'pattern', header: 'Pattern', cell: (s) => <span className="font-mono text-xs text-fg-muted">{s.pattern}</span> },
    { key: 'next', header: 'Next number', cell: (s) => <span className="font-mono text-sm text-fg">{s.preview.example}</span> },
    { key: 'reset', header: 'Restarts', cell: (s) => <Badge>{s.resetPolicy === 'FISCAL_YEAR' ? 'Each fiscal year' : 'Never'}</Badge> },
    { key: 'issued', header: 'Issued this period', numeric: true, cell: (s) => Math.max(0, s.preview.nextSequence - 1) },
  ];
  if (!canRead) return <PermissionDenied />;
  return (
    <>
      <PageHeader
        title="Numbering series"
        description="Human-readable document numbers. Allocation is atomic, so two records can never share a number."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Numbering' }]}
      />
      <Card>
        <DataTable
          caption="Numbering series"
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(s) => s.id}
          isLoading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={canManage ? setEditing : undefined}
          empty={{ title: 'No numbering series configured' }}
        />
      </Card>
      {editing && <EditSeries series={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
