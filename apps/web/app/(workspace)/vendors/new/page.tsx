'use client';

import { GST_REGISTRATION_LABELS, VENDOR_TYPE_LABELS, requiredVendorDocuments, VENDOR_DOCUMENT_LABELS } from '@kenzo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, FileText, RotateCcw, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, PermissionDenied } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { AddressStep, BankStep, CommercialStep, DuplicateReview, IdentityStep, SummaryRow } from '@/components/vendors/wizard-steps';
import { isApiError, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDebouncedValue } from '@/lib/hooks';
import { usePermission } from '@/lib/session';
import { useInvalidateVendors, useVendorCategories } from '@/lib/vendor-queries';
import {
  INITIAL_WIZARD,
  WIZARD_STEPS,
  clearDraft,
  errorsForStep,
  isPristine,
  loadDraft,
  saveDraft,
  stepForPath,
  toCreatePayload,
  validateWizard,
  type WizardState,
} from '@/lib/vendor-wizard';
import { OVERRIDE_REASON_MIN, duplicateOverrideRequired, type DuplicateMatch, type VendorRecord } from '@/lib/vendors';

function StepRail({
  current,
  completed,
  errorSteps,
  onJump,
}: {
  current: number;
  completed: Set<number>;
  errorSteps: Set<number>;
  onJump: (i: number) => void;
}) {
  return (
    <nav aria-label="Wizard steps">
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1">
        {WIZARD_STEPS.map((s, i) => {
          const active = i === current;
          const done = completed.has(i) && !errorSteps.has(i);
          const bad = errorSteps.has(i) && completed.has(i);
          return (
            <li key={s.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150',
                  active ? 'bg-surface shadow-card ring-1 ring-border' : 'hover:bg-surface/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-200',
                    bad
                      ? 'bg-danger-soft text-danger'
                      : done
                        ? 'bg-success text-white'
                        : active
                          ? 'bg-primary text-primary-fg'
                          : 'bg-surface-muted text-fg-subtle',
                  )}
                >
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className={cn('block text-sm', active ? 'font-semibold text-fg' : 'font-medium text-fg-muted')}>{s.label}</span>
                  <span className="hidden truncate text-xs text-fg-subtle lg:block">{bad ? 'Needs attention' : s.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default function NewVendorPage() {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateVendors();
  const canCreate = usePermission('vendor.create');
  const categories = useVendorCategories(canCreate);
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD);
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [overrideReason, setOverrideReason] = useState('');
  const [conflicts, setConflicts] = useState<DuplicateMatch[] | null>(null);
  const [restored, setRestored] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const done = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore an autosaved draft (never contains bank details).
  useEffect(() => {
    const draft = loadDraft();
    if (draft && !isPristine(draft)) {
      setState(draft);
      setRestored(true);
    }
  }, []);
  const debouncedState = useDebouncedValue(state, 600);
  useEffect(() => {
    if (!done.current && !isPristine(debouncedState)) saveDraft(debouncedState);
  }, [debouncedState]);

  // Unsaved-changes guard for reloads / tab closes.
  const dirty = !isPristine(state);
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      if (done.current) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  const clientErrors = useMemo(() => validateWizard(state), [state]);
  const allErrors = { ...clientErrors, ...serverErrors };
  const visibleErrors = showErrors
    ? errorsForStep(allErrors, step)
    : Object.fromEntries(Object.entries(errorsForStep(allErrors, step)).filter(([k]) => k in serverErrors));
  const errorSteps = new Set(Object.keys(allErrors).map(stepForPath));

  const dupInput = useDebouncedValue(
    { legalName: state.legalName.trim(), gstin: state.gstin.length === 15 ? state.gstin : undefined, pan: state.pan.length === 10 ? state.pan : undefined },
    500,
  );
  const duplicates = useQuery({
    queryKey: ['vendors', 'dup-check', dupInput],
    queryFn: () =>
      post<{ matches: DuplicateMatch[] }>('/vendors/duplicate-check', { ...dupInput, gstin: dupInput.gstin || undefined, pan: dupInput.pan || undefined }),
    enabled: canCreate && dupInput.legalName.length >= 3,
    staleTime: 30_000,
  });
  const matches = conflicts ?? duplicates.data?.matches ?? [];
  const needsOverride = duplicateOverrideRequired(matches);
  const overrideError = needsOverride && overrideReason.trim().length < OVERRIDE_REASON_MIN ? `Explain in at least ${OVERRIDE_REASON_MIN} characters` : null;

  const update = (patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
    if (Object.keys(serverErrors).length)
      setServerErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !Object.keys(patch).includes(k.split('.')[0]!))));
  };

  const goTo = (i: number) => {
    setVisited((v) => new Set(v).add(step));
    setStep(i);
    setShowErrors(visited.has(i));
    requestAnimationFrame(() => headingRef.current?.focus());
  };
  const next = () => {
    const stepErrs = errorsForStep(allErrors, step);
    if (step < WIZARD_STEPS.length - 1 && Object.keys(stepErrs).length) {
      setShowErrors(true);
      setVisited((v) => new Set(v).add(step));
      return;
    }
    setShowErrors(false);
    goTo(step + 1);
  };

  const create = useMutation({
    mutationFn: () =>
      post<{ vendor: VendorRecord; duplicates: DuplicateMatch[] }>('/vendors', toCreatePayload(state, needsOverride ? overrideReason.trim() : undefined)),
    onSuccess: async (res) => {
      done.current = true;
      clearDraft();
      await invalidate();
      toast.success(`Draft ${res.vendor.vendorCode} created`, 'Upload the required documents, then submit for approval.');
      router.push(`/vendors/${res.vendor.id}?tab=documents&created=1`);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'CONFLICT' && Array.isArray(err.details?.duplicates)) {
        setConflicts(err.details.duplicates as DuplicateMatch[]);
        return;
      }
      if (isApiError(err) && err.fieldErrors.length) {
        const map = err.fieldMap();
        setServerErrors(map);
        setShowErrors(true);
        const first = Math.min(...Object.keys(map).map(stepForPath));
        if (first < WIZARD_STEPS.length - 1) goTo(first);
      }
    },
  });

  const submit = () => {
    const firstBad = [...errorSteps].filter((i) => i < WIZARD_STEPS.length - 1).sort()[0];
    if (firstBad !== undefined) {
      setVisited(new Set([0, 1, 2, 3]));
      setShowErrors(true);
      setStep(firstBad);
      toast.error('Some details need attention', WIZARD_STEPS[firstBad]!.label);
      return;
    }
    if (overrideError) return;
    create.mutate();
  };

  const startOver = () => {
    clearDraft();
    setState(INITIAL_WIZARD);
    setRestored(false);
    setStep(0);
    setVisited(new Set());
    setShowErrors(false);
  };

  if (!canCreate) return <PermissionDenied message="You do not have permission to create vendors." />;

  const stepProps = { state, update, replace: setState, errors: visibleErrors };
  const requiredDocs = requiredVendorDocuments({
    gstRegistrationType: state.gstRegistrationType,
    msmeRegistered: state.msmeRegistered,
    hasBankAccount: state.includeBank,
  });
  const completed = new Set([...visited].filter((i) => i !== step));

  return (
    <>
      <PageHeader
        title="New vendor"
        description="Five short steps. Your progress is saved in this browser tab (bank details excluded)."
        breadcrumbs={[{ label: 'Vendors', href: '/vendors' }, { label: 'Directory', href: '/vendors/directory' }, { label: 'New vendor' }]}
        actions={
          <Button variant="ghost" onClick={() => (dirty ? setLeaving('/vendors/directory') : router.push('/vendors/directory'))}>
            Cancel
          </Button>
        }
      />
      {restored && (
        <Alert tone="info" className="mb-4">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Restored your unsaved draft from earlier in this session.
            <Button size="sm" variant="ghost" onClick={startOver}>
              <RotateCcw aria-hidden /> Start over
            </Button>
          </span>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <StepRail current={step} completed={completed} errorSteps={errorSteps} onJump={goTo} />
          <div className="mt-4 hidden h-1.5 overflow-hidden rounded-full bg-surface-muted lg:block" aria-hidden>
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }}
            />
          </div>
          {dirty && (
            <p className="mt-3 hidden items-center gap-1.5 text-xs text-fg-subtle lg:flex">
              <Save className="size-3.5" aria-hidden /> Draft autosaved
            </p>
          )}
        </aside>
        <Card>
          <CardBody className="p-6">
            <h2 ref={headingRef} tabIndex={-1} className="mb-6 text-lg font-semibold text-fg outline-none">
              <span className="mr-2 text-sm font-medium text-fg-subtle">
                Step {step + 1} of {WIZARD_STEPS.length}
              </span>
              {WIZARD_STEPS[step]!.label}
            </h2>
            <div key={step} className="animate-fade-in">
              {step === 0 && (
                <>
                  <IdentityStep {...stepProps} categories={categories.data?.items} />
                  {duplicates.data && duplicates.data.matches.length > 0 && (
                    <Alert
                      tone={needsOverride ? 'danger' : 'warning'}
                      className="mt-6"
                      title={`${duplicates.data.matches.length} existing vendor${duplicates.data.matches.length > 1 ? 's' : ''} may match`}
                    >
                      {duplicates.data.matches
                        .slice(0, 3)
                        .map((m) => m.legalName)
                        .join(', ')}{' '}
                      — details on the review step.
                    </Alert>
                  )}
                </>
              )}
              {step === 1 && <AddressStep {...stepProps} />}
              {step === 2 && <CommercialStep {...stepProps} />}
              {step === 3 && <BankStep {...stepProps} />}
              {step === 4 && (
                <div className="flex flex-col gap-8">
                  <section>
                    <h3 className="mb-2 text-md font-semibold text-fg">Duplicate check</h3>
                    <DuplicateReview
                      matches={matches}
                      loading={duplicates.isFetching && !conflicts}
                      overrideReason={overrideReason}
                      onOverrideReason={setOverrideReason}
                      error={overrideReason ? overrideError : null}
                    />
                  </section>
                  <section className="grid gap-6 md:grid-cols-2">
                    <div>
                      <h3 className="mb-1 text-md font-semibold text-fg">Summary</h3>
                      <dl className="divide-y divide-border">
                        <SummaryRow label="Legal name" value={state.legalName} />
                        <SummaryRow label="Type" value={VENDOR_TYPE_LABELS[state.vendorType]} />
                        <SummaryRow label="Category" value={state.category} />
                        <SummaryRow label="GST" value={GST_REGISTRATION_LABELS[state.gstRegistrationType]} />
                        <SummaryRow label="GSTIN" value={state.gstin && <span className="font-mono">{state.gstin}</span>} />
                        <SummaryRow
                          label="PAN"
                          value={
                            state.pan && (
                              <span className="font-mono">
                                {state.pan.slice(0, 2)}••••••{state.pan.slice(-2)}
                              </span>
                            )
                          }
                        />
                        <SummaryRow label="Address" value={[state.city, state.state, state.postalCode].filter(Boolean).join(', ')} />
                        <SummaryRow
                          label="Contacts"
                          value={state.contacts
                            .filter((c) => c.name.trim())
                            .map((c) => c.name)
                            .join(', ')}
                        />
                        <SummaryRow label="Payment terms" value={state.paymentTermsDays && `${state.paymentTermsDays} days · ${state.preferredCurrency}`} />
                        <SummaryRow
                          label="Bank"
                          value={state.includeBank ? `${state.bank.bankName} ···· ${state.bank.accountNumber.slice(-4)}` : 'Not provided'}
                        />
                      </dl>
                    </div>
                    <div>
                      <h3 className="mb-1 text-md font-semibold text-fg">What happens next</h3>
                      <ol className="flex flex-col gap-3 text-sm text-fg-muted">
                        <li className="flex gap-2">
                          <Badge tone="info">1</Badge> The vendor is saved as a <strong className="text-fg">draft</strong>.
                        </li>
                        <li className="flex gap-2">
                          <Badge tone="info">2</Badge>
                          <span>
                            Upload required documents:
                            <span className="mt-1 flex flex-wrap gap-1">
                              {requiredDocs.map((d) => (
                                <Badge key={d} icon={FileText}>
                                  {VENDOR_DOCUMENT_LABELS[d]}
                                </Badge>
                              ))}
                            </span>
                          </span>
                        </li>
                        <li className="flex gap-2">
                          <Badge tone="info">3</Badge> Submit — an independent approver reviews, then a vendor approver activates it.
                        </li>
                      </ol>
                    </div>
                  </section>
                  {Object.keys(allErrors).filter((k) => stepForPath(k) < 4).length > 0 && (
                    <Alert tone="warning" title="Some steps need attention">
                      {[...errorSteps]
                        .filter((i) => i < 4)
                        .map((i) => WIZARD_STEPS[i]!.label)
                        .join(', ')}
                    </Alert>
                  )}
                  {create.error && !(isApiError(create.error) && (create.error.code === 'CONFLICT' || create.error.fieldErrors.length)) && (
                    <Alert tone="danger">{create.error.message}</Alert>
                  )}
                </div>
              )}
            </div>
            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
              <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={step === 0}>
                <ArrowLeft aria-hidden /> Back
              </Button>
              {step < WIZARD_STEPS.length - 1 ? (
                <Button onClick={next}>
                  Continue <ArrowRight aria-hidden />
                </Button>
              ) : (
                <Button onClick={submit} loading={create.isPending} disabled={!!overrideError && needsOverride}>
                  <Check aria-hidden /> Create draft vendor
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(o) => !o && setLeaving(null)}
        title="Leave without creating the vendor?"
        impact="Your draft stays saved in this browser tab (without bank details) until you close it."
        confirmLabel="Leave"
        onConfirm={() => {
          const to = leaving!;
          setLeaving(null);
          router.push(to);
        }}
      />
    </>
  );
}
