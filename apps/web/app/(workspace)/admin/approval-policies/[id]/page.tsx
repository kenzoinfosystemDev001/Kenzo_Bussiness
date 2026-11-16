'use client';

import { APPROVAL_ENTITY_LABELS, approvalPolicySchema, type ApprovalEntityType } from '@kenzo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, ErrorState, PageLoading } from '@/components/ui/feedback';
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/workflow/user-picker';
import { errorMessage, get, post, put } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';
import { formatAmount, formatDateTime, humanize } from '@/lib/format';
import { useDepartments, useRoles } from '@/lib/queries';
import { usePermission } from '@/lib/session';
import type { ApprovalPolicy, ApproverType, PolicyStage, SimulationResult, StageMode } from '@/lib/types';

interface StageDraft {
  name: string;
  mode: StageMode;
  minApprovals: number;
  minAmount: string;
  maxAmount: string;
  approverType: ApproverType;
  approverRoleKey: string;
  approverUserId: string;
  slaHours: string;
  escalationRoleKey: string;
  departmentIds: string[];
  categoryKeys: string[];
}

const toDraft = (s: PolicyStage): StageDraft => ({
  name: s.name,
  mode: s.mode,
  minApprovals: s.minApprovals,
  minAmount: s.minAmount ?? '',
  maxAmount: s.maxAmount ?? '',
  approverType: s.approverType,
  approverRoleKey: s.approverRoleKey ?? '',
  approverUserId: s.approverUserId ?? '',
  slaHours: s.slaHours ? String(s.slaHours) : '',
  escalationRoleKey: s.escalationRoleKey ?? '',
  departmentIds: s.departmentIds,
  categoryKeys: s.categoryKeys,
});

const APPROVER_LABEL: Record<ApproverType, string> = {
  ROLE: 'Anyone holding a role',
  USER: 'A specific person',
  DEPARTMENT_HEAD: "Head of the requester's department",
  REQUESTER_MANAGER: "Requester's manager",
};

function describeStage(s: PolicyStage, roleName: (k: string | null) => string): string {
  const who = s.approverType === 'ROLE' ? roleName(s.approverRoleKey) : APPROVER_LABEL[s.approverType];
  const band =
    s.minAmount || s.maxAmount
      ? ` · amount ${s.minAmount ? `≥ ${formatAmount(s.minAmount, 'INR')}` : ''}${s.minAmount && s.maxAmount ? ' and ' : ''}${s.maxAmount ? `≤ ${formatAmount(s.maxAmount, 'INR')}` : ''}`
      : ' · all amounts';
  return `${who}${band}`;
}

function StageEditor({
  stage,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  errors,
}: {
  stage: StageDraft;
  index: number;
  count: number;
  onChange: (s: StageDraft) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  errors: Record<string, string>;
}) {
  const roles = useRoles();
  const departments = useDepartments();
  const e = (k: string) => errors[`stages.${index}.${k}`];
  const set = <K extends keyof StageDraft>(k: K, v: StageDraft[K]) => onChange({ ...stage, [k]: v });
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary">{index + 1}</span>
        <Input
          aria-label={`Stage ${index + 1} name`}
          value={stage.name}
          onChange={(ev) => set('name', ev.target.value)}
          className="max-w-xs font-medium"
          aria-invalid={!!e('name') || undefined}
        />
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" aria-label="Move stage up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Move stage down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Remove stage" disabled={count === 1} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FormField label="Approver" error={e('approverType')}>
          <Select value={stage.approverType} onChange={(ev) => set('approverType', ev.target.value as ApproverType)}>
            {(Object.keys(APPROVER_LABEL) as ApproverType[]).map((t) => (
              <option key={t} value={t}>
                {APPROVER_LABEL[t]}
              </option>
            ))}
          </Select>
        </FormField>
        {stage.approverType === 'ROLE' && (
          <FormField label="Role" required error={e('approverRoleKey')}>
            <Select value={stage.approverRoleKey} onChange={(ev) => set('approverRoleKey', ev.target.value)}>
              <option value="">Select role</option>
              {roles.data?.items.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {stage.approverType === 'USER' && (
          <FormField label="Person" required error={e('approverUserId')}>
            <UserPicker value={stage.approverUserId} onChange={(id) => set('approverUserId', id)} />
          </FormField>
        )}
        <FormField label="How approvers combine" error={e('mode')}>
          <Select value={stage.mode} onChange={(ev) => set('mode', ev.target.value as StageMode)}>
            <option value="ANY">Any approver (N of M)</option>
            <option value="ALL">All approvers (parallel)</option>
          </Select>
        </FormField>
        {stage.mode === 'ANY' && (
          <FormField label="Approvals required" error={e('minApprovals')}>
            <Input type="number" min={1} max={10} value={stage.minApprovals} onChange={(ev) => set('minApprovals', Number(ev.target.value) || 1)} />
          </FormField>
        )}
        <FormField label="Applies from amount (₹)" hint="Leave blank for no lower bound" error={e('minAmount')}>
          <Input inputMode="decimal" value={stage.minAmount} onChange={(ev) => set('minAmount', ev.target.value)} className="tabular" />
        </FormField>
        <FormField label="Applies up to amount (₹)" hint="Leave blank for no upper bound" error={e('maxAmount')}>
          <Input inputMode="decimal" value={stage.maxAmount} onChange={(ev) => set('maxAmount', ev.target.value)} className="tabular" />
        </FormField>
        <FormField label="SLA (hours)" error={e('slaHours')}>
          <Input type="number" min={1} max={720} value={stage.slaHours} onChange={(ev) => set('slaHours', ev.target.value)} />
        </FormField>
        <FormField label="Escalate overdue tasks to" error={e('escalationRoleKey')}>
          <Select value={stage.escalationRoleKey} onChange={(ev) => set('escalationRoleKey', ev.target.value)}>
            <option value="">No escalation</option>
            {roles.data?.items.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Only for departments" hint="Hold Ctrl/⌘ to select several; none = all" error={e('departmentIds')}>
          <select
            multiple
            value={stage.departmentIds}
            onChange={(ev) =>
              set(
                'departmentIds',
                Array.from(ev.target.selectedOptions).map((o) => o.value),
              )
            }
            className="h-20 rounded-md border border-border bg-surface px-2 py-1 text-sm"
          >
            {departments.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </li>
  );
}

function Simulator({ policy }: { policy: ApprovalPolicy }) {
  const departments = useDepartments();
  const [amount, setAmount] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const m = useMutation({
    mutationFn: () =>
      post<SimulationResult>(`/approval-policies/${policy.id}/simulate`, { amount: amount || '0', requesterId, departmentId: departmentId || null }),
  });
  return (
    <Card>
      <CardHeader title="Simulator" description="See who would approve a request. Nothing is created or sent." />
      <CardBody className="flex flex-col gap-3">
        <FormField label="Requester" required>
          <UserPicker value={requesterId} onChange={setRequesterId} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Amount (₹)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular" placeholder="0.00" />
          </FormField>
          <FormField label="Department">
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">Requester&apos;s department</option>
              {departments.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <Button variant="secondary" onClick={() => m.mutate()} disabled={!requesterId} loading={m.isPending} className="self-start">
          <FlaskConical aria-hidden /> Simulate
        </Button>
        {m.error && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        {m.data && !m.data.ok && (
          <Alert tone="warning" title="This request could not be routed">
            {m.data.error}
          </Alert>
        )}
        {m.data?.ok && (
          <ol className="flex flex-col gap-2">
            {m.data.stages.map((s) => (
              <li key={s.sequence} className="rounded-md border border-border px-3 py-2">
                <p className="text-sm font-medium text-fg">
                  {s.sequence}. {s.name}{' '}
                  <span className="text-xs font-normal text-fg-subtle">({s.mode === 'ALL' ? 'all must approve' : `${s.required} required`})</span>
                </p>
                <p className="text-sm text-fg-muted">
                  {s.approvers.map((a) => `${a.user?.fullName ?? 'Unknown'}${a.delegatedFrom ? ` (for ${a.delegatedFrom.fullName})` : ''}`).join(', ')}
                </p>
              </li>
            ))}
            {m.data.skippedStages.length > 0 && <p className="text-xs text-fg-subtle">Not applicable: {m.data.skippedStages.map((s) => s.name).join(', ')}</p>}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = usePermission('approval.policy.manage');
  const roles = useRoles();
  const q = useQuery({ queryKey: ['approval-policies', id], queryFn: () => get<ApprovalPolicy>(`/approval-policies/${id}`) });
  const [meta, setMeta] = useState<Pick<
    ApprovalPolicy,
    'name' | 'description' | 'requireIndependentApproval' | 'distinctApproversAcrossStages' | 'allowDelegation' | 'excludeInitiatorFromAllStages'
  > | null>(null);
  const [stages, setStages] = useState<StageDraft[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);

  const save = useMutation({
    mutationFn: (body: unknown) => put<ApprovalPolicy>(`/approval-policies/${id}`, body),
    onSuccess: async () => {
      toast.success('Draft saved');
      setMeta(null);
      setStages(null);
      await qc.invalidateQueries({ queryKey: ['approval-policies'] });
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });
  const publish = useMutation({
    mutationFn: (reason: string) => post(`/approval-policies/${id}/publish`, { reason }),
    onSuccess: async () => {
      toast.success('Policy published');
      setPublishing(false);
      await qc.invalidateQueries({ queryKey: ['approval-policies'] });
    },
  });
  const clone = useMutation({
    mutationFn: () => post<ApprovalPolicy>(`/approval-policies/${id}/clone`),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ['approval-policies'] });
      router.push(`/admin/approval-policies/${p.id}`);
    },
    onError: (e) => toast.error('Could not create a new version', errorMessage(e)),
  });

  if (q.isLoading) return <PageLoading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const editable = canManage && p.status === 'DRAFT';
  const m = meta ?? p;
  const st = stages ?? p.stages.map(toDraft);
  const roleName = (k: string | null) => roles.data?.items.find((r) => r.key === k)?.name ?? humanize(k ?? '');
  const dirty = meta !== null || stages !== null;

  const updateStages = (next: StageDraft[]) => setStages(next);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      entityType: p.entityType,
      name: m.name,
      description: m.description || null,
      requireIndependentApproval: m.requireIndependentApproval,
      distinctApproversAcrossStages: m.distinctApproversAcrossStages,
      allowDelegation: m.allowDelegation,
      excludeInitiatorFromAllStages: m.excludeInitiatorFromAllStages,
      stages: st.map((s, i) => ({
        sequence: i + 1,
        name: s.name,
        mode: s.mode,
        minApprovals: s.minApprovals,
        minAmount: s.minAmount.trim() || null,
        maxAmount: s.maxAmount.trim() || null,
        departmentIds: s.departmentIds,
        categoryKeys: s.categoryKeys,
        approverType: s.approverType,
        approverRoleKey: s.approverType === 'ROLE' ? s.approverRoleKey || null : null,
        approverUserId: s.approverType === 'USER' ? s.approverUserId || null : null,
        slaHours: s.slaHours ? Number(s.slaHours) : null,
        escalationRoleKey: s.escalationRoleKey || null,
      })),
    };
    const v = validate(approvalPolicySchema, body);
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    save.mutate({ ...v.data, version: p.version });
  };

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title={p.name}
        description={APPROVAL_ENTITY_LABELS[p.entityType as ApprovalEntityType] ?? p.entityType}
        breadcrumbs={[{ label: 'Approval policies', href: '/admin/approval-policies' }, { label: `v${p.policyVersion}` }]}
        meta={
          <>
            <StatusBadge status={p.status} />
            <Badge>Version {p.policyVersion}</Badge>
            {p._count && <span className="text-xs text-fg-subtle">{p._count.instances} approval(s) used this version</span>}
          </>
        }
        actions={
          canManage && (
            <>
              {p.status !== 'DRAFT' && (
                <Button variant="secondary" onClick={() => clone.mutate()} loading={clone.isPending}>
                  <Copy aria-hidden /> New version from this
                </Button>
              )}
              {editable && (
                <>
                  <Button type="submit" variant="secondary" loading={save.isPending} disabled={!dirty}>
                    Save draft
                  </Button>
                  <Button onClick={() => setPublishing(true)} disabled={dirty}>
                    Publish
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {errors.form && (
        <Alert tone="danger" className="mb-4">
          {errors.form}
        </Alert>
      )}
      {editable && dirty && (
        <Alert tone="info" className="mb-4">
          Save the draft before publishing.
        </Alert>
      )}
      {p.status === 'ACTIVE' && (
        <Alert tone="info" className="mb-4">
          Active versions are read-only. Create a new version to change the rules; in-flight approvals keep this version.
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Policy" />
            <CardBody className="flex flex-col gap-4">
              <fieldset disabled={!editable} className="flex flex-col gap-4">
                <FormField label="Name" required error={errors.name}>
                  <Input value={m.name} onChange={(e) => setMeta({ ...m, name: e.target.value })} />
                </FormField>
                <FormField label="Description" error={errors.description}>
                  <Textarea value={m.description ?? ''} onChange={(e) => setMeta({ ...m, description: e.target.value })} />
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Checkbox
                    label="Independent approval"
                    description="The requester can never approve their own request."
                    checked={m.requireIndependentApproval}
                    onChange={(e) => setMeta({ ...m, requireIndependentApproval: e.target.checked })}
                  />
                  <Checkbox
                    label="Different approver per stage"
                    description="Nobody approves two stages of the same request."
                    checked={m.distinctApproversAcrossStages}
                    onChange={(e) => setMeta({ ...m, distinctApproversAcrossStages: e.target.checked })}
                  />
                  <Checkbox
                    label="Allow delegation"
                    description="Approvers may delegate to an independent colleague."
                    checked={m.allowDelegation}
                    onChange={(e) => setMeta({ ...m, allowDelegation: e.target.checked })}
                  />
                  <Checkbox
                    label="Exclude initiator everywhere"
                    description="The initiator is removed from every stage."
                    checked={m.excludeInitiatorFromAllStages}
                    onChange={(e) => setMeta({ ...m, excludeInitiatorFromAllStages: e.target.checked })}
                  />
                </div>
              </fieldset>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Stages" description="Stages run in order. A stage applies only when the request matches its amount band and departments." />
            <CardBody>
              {editable ? (
                <>
                  <ol className="flex flex-col gap-3">
                    {st.map((s, i) => (
                      <StageEditor
                        key={i}
                        stage={s}
                        index={i}
                        count={st.length}
                        errors={errors}
                        onChange={(next) => updateStages(st.map((x, j) => (j === i ? next : x)))}
                        onMove={(dir) => {
                          const next = [...st];
                          const [item] = next.splice(i, 1);
                          next.splice(i + dir, 0, item!);
                          updateStages(next);
                        }}
                        onRemove={() => updateStages(st.filter((_, j) => j !== i))}
                      />
                    ))}
                  </ol>
                  {errors.stages && <p className="mt-2 text-xs text-danger">{errors.stages}</p>}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() =>
                      updateStages([
                        ...st,
                        {
                          name: `Stage ${st.length + 1}`,
                          mode: 'ANY',
                          minApprovals: 1,
                          minAmount: '',
                          maxAmount: '',
                          approverType: 'ROLE',
                          approverRoleKey: '',
                          approverUserId: '',
                          slaHours: '',
                          escalationRoleKey: '',
                          departmentIds: [],
                          categoryKeys: [],
                        },
                      ])
                    }
                  >
                    <Plus aria-hidden /> Add stage
                  </Button>
                </>
              ) : (
                <ol className="flex flex-col gap-2">
                  {p.stages.map((s) => (
                    <li key={s.id} className="flex gap-3 rounded-md border border-border px-3 py-2.5">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-fg-muted">
                        {s.sequence}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-fg">{s.name}</p>
                        <p className="text-xs text-fg-muted">
                          {describeStage(s, roleName)} · {s.mode === 'ALL' ? 'all must approve' : `${s.minApprovals} approval(s)`}
                          {s.slaHours ? ` · SLA ${s.slaHours}h` : ''}
                          {s.escalationRoleKey ? ` · escalates to ${roleName(s.escalationRoleKey)}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Simulator policy={p} />
          <Card>
            <CardHeader title="Version" />
            <CardBody className="text-sm text-fg-muted">
              <p>Created {formatDateTime(p.createdAt)}</p>
              {p.publishedAt && <p>Published {formatDateTime(p.publishedAt)}</p>}
              {p.retiredAt && <p>Retired {formatDateTime(p.retiredAt)}</p>}
            </CardBody>
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={`Publish version ${p.policyVersion}?`}
        impact="New submissions will use this version immediately. The currently active version (if any) is retired; approvals already in progress are unaffected."
        confirmLabel="Publish"
        tone="primary"
        requireReason
        loading={publish.isPending}
        error={publish.error ? errorMessage(publish.error) : null}
        onConfirm={(reason) => publish.mutate(reason)}
      />
    </form>
  );
}
