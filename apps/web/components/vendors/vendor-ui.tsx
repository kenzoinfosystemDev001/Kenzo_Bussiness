'use client';

import { VENDOR_STATUS_LABELS, type VendorStatus } from '@kenzo/shared';
import { AlertTriangle, Building2, Check, Clock, FileWarning, Landmark, Lock, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { Badge, StatusBadge, type BadgeTone } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  DUPLICATE_REASON_LABELS,
  documentExpiryState,
  expiryLabel,
  type BankStatus,
  type DocumentSummary,
  type DuplicateMatch,
  type VerificationStatus,
} from '@/lib/vendors';

export function VendorStatusBadge({ status, className }: { status: VendorStatus; className?: string }) {
  return <StatusBadge status={status} label={VENDOR_STATUS_LABELS[status]} className={className} />;
}

const MAIN_PATH: VendorStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE'];

/** Draft → Submitted → Under review → Approved → Active, with side states shown explicitly. */
export function LifecycleStepper({ status }: { status: VendorStatus }) {
  const side = !MAIN_PATH.includes(status);
  const currentIdx = MAIN_PATH.indexOf(status);
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex items-center gap-1" aria-label="Vendor lifecycle">
        {MAIN_PATH.map((s, i) => {
          const done = !side && i < currentIdx;
          const current = !side && i === currentIdx;
          return (
            <li key={s} className="flex min-w-0 flex-1 items-center gap-1" aria-current={current ? 'step' : undefined}>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold transition-colors duration-200',
                  done && 'border-success bg-success text-white',
                  current && 'border-primary bg-primary text-primary-fg ring-4 ring-primary/15',
                  !done && !current && 'border-border-strong bg-surface text-fg-subtle',
                  side && 'opacity-60',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn('hidden truncate text-xs sm:inline', current ? 'font-medium text-fg' : 'text-fg-subtle')}>{VENDOR_STATUS_LABELS[s]}</span>
              {i < MAIN_PATH.length - 1 && <span aria-hidden className={cn('mx-1 h-px flex-1', done ? 'bg-success' : 'bg-border')} />}
            </li>
          );
        })}
      </ol>
      {side && (
        <p className="text-xs text-fg-muted">
          Currently <VendorStatusBadge status={status} className="mx-1" /> — outside the onboarding path.
        </p>
      )}
    </div>
  );
}

export function ExpiryBadge({ expiryDate, now }: { expiryDate: string | null | undefined; now?: Date }) {
  const state = documentExpiryState(expiryDate, now);
  if (state.kind === 'none') return <span className="text-xs text-fg-subtle">No expiry</span>;
  const tone: BadgeTone = state.kind === 'expired' ? 'danger' : state.kind === 'expiring' ? 'warning' : 'neutral';
  const Icon = state.kind === 'expired' ? FileWarning : state.kind === 'expiring' ? AlertTriangle : Clock;
  return (
    <Badge tone={tone} icon={Icon}>
      {expiryLabel(state)}
    </Badge>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <StatusBadge status={status} label={status === 'PENDING' ? 'Awaiting verification' : status === 'VERIFIED' ? 'Verified' : 'Rejected'} />;
}

export function BankStatusBadge({ status }: { status: BankStatus }) {
  if (status === 'VERIFIED')
    return (
      <Badge tone="success" icon={ShieldCheck}>
        Bank verified
      </Badge>
    );
  if (status === 'PENDING')
    return (
      <Badge tone="warning" icon={ShieldQuestion}>
        Bank pending
      </Badge>
    );
  return <Badge icon={Landmark}>No bank</Badge>;
}

/** Compact document health indicators for list rows. */
export function DocSummaryIndicators({ summary }: { summary: DocumentSummary }) {
  if (summary.total === 0)
    return (
      <Badge tone="danger" icon={FileWarning}>
        No documents
      </Badge>
    );
  const all: Array<{ n: number; label: string; tone: BadgeTone }> = [
    { n: summary.expired, label: 'expired', tone: 'danger' },
    { n: summary.rejected, label: 'rejected', tone: 'danger' },
    { n: summary.expiring, label: 'expiring', tone: 'warning' },
    { n: summary.pending, label: 'to verify', tone: 'info' },
  ];
  const parts = all.filter((p) => p.n > 0);
  if (parts.length === 0)
    return (
      <Badge tone="success" icon={ShieldCheck}>
        {summary.total} docs OK
      </Badge>
    );
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <Badge key={p.label} tone={p.tone}>
          {p.n} {p.label}
        </Badge>
      ))}
    </div>
  );
}

/** Accessible progress ring (SVG) — value is also announced as text. */
export function ProgressRing({
  value,
  max,
  size = 64,
  label,
  tone = 'primary',
}: {
  value: number;
  max: number;
  size?: number;
  label: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger';
}) {
  const pct = max === 0 ? 0 : Math.min(1, value / max);
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = { primary: 'stroke-primary', success: 'stroke-success', warning: 'stroke-warning', danger: 'stroke-danger' }[tone];
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label}: ${value} of ${max}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-surface-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className={cn(color, 'transition-[stroke-dashoffset] duration-500 ease-out')}
        />
      </svg>
      <span className="tabular absolute text-sm font-semibold text-fg">{max === 0 ? '—' : `${Math.round(pct * 100)}%`}</span>
    </div>
  );
}

export function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-fg-subtle">Not measured</span>;
  const tone = score >= 80 ? 'bg-success' : score >= 50 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Score">
      <div className="h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-surface-muted">
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="tabular text-sm font-semibold text-fg">{score}</span>
    </div>
  );
}

export function DuplicateList({ matches, compact }: { matches: DuplicateMatch[]; compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {matches.map((m) => (
        <li
          key={m.vendorId}
          className={cn('rounded-md border px-3 py-2.5', m.strong ? 'border-danger/30 bg-danger-soft/50' : 'border-warning/30 bg-warning-soft/50')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-4 text-fg-subtle" aria-hidden />
            <Link href={`/vendors/${m.vendorId}`} target="_blank" className="font-medium text-fg hover:underline">
              {m.legalName}
            </Link>
            <span className="font-mono text-xs text-fg-subtle">{m.vendorCode}</span>
            <VendorStatusBadge status={m.status} />
            {m.strong ? <Badge tone="danger">Likely duplicate</Badge> : <Badge tone="warning">Possible duplicate</Badge>}
          </div>
          {!compact && (
            <p className="mt-1 text-xs text-fg-muted">
              {m.city}
              {m.gstin ? ` · GSTIN ${m.gstin}` : ''}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.reasons.map((r) => (
              <Badge key={r} tone={r === 'NAME_SIMILAR' ? 'warning' : 'danger'}>
                {DUPLICATE_REASON_LABELS[r]}
                {r === 'NAME_SIMILAR' ? ` (${Math.round(m.similarity * 100)}%)` : ''}
              </Badge>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Honest placeholder for transaction data owned by later phases — never shows invented numbers. */
export function FutureModulePanel({ label, phase }: { label: string; phase: number }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-dashed border-border-strong bg-surface-muted/40 px-3 py-2.5">
      <Lock className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="text-xs text-fg-subtle">Available when the Phase {phase} module launches. No data is shown until then.</p>
      </div>
    </div>
  );
}

export function RequirementIcon({ state }: { state: string }) {
  const map: Record<string, { tone: string; label: string }> = {
    VERIFIED: { tone: 'bg-success text-white', label: 'Verified' },
    PENDING: { tone: 'bg-warning-soft text-warning', label: 'Awaiting verification' },
    REJECTED: { tone: 'bg-danger-soft text-danger', label: 'Rejected' },
    EXPIRED: { tone: 'bg-danger-soft text-danger', label: 'Expired' },
    MISSING: { tone: 'bg-surface-muted text-fg-subtle', label: 'Missing' },
  };
  const m = map[state] ?? map.MISSING!;
  return (
    <Tooltip content={m.label}>
      <span className={cn('flex size-5 items-center justify-center rounded-full', m.tone)}>
        {state === 'VERIFIED' ? (
          <Check className="size-3" aria-hidden />
        ) : state === 'PENDING' ? (
          <Clock className="size-3" aria-hidden />
        ) : (
          <AlertTriangle className="size-3" aria-hidden />
        )}
        <span className="sr-only">{m.label}</span>
      </span>
    </Tooltip>
  );
}
