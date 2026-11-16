import { cva, type VariantProps } from 'class-variance-authority';
import {
  Archive,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Clock,
  FileEdit,
  FileQuestion,
  Hourglass,
  MailQuestion,
  PauseCircle,
  RotateCcw,
  ScanSearch,
  Send,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';

export const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5', {
  variants: {
    tone: {
      neutral: 'border-border bg-surface-muted text-fg-muted',
      info: 'border-primary/20 bg-primary-soft text-primary',
      success: 'border-success/25 bg-success-soft text-success',
      warning: 'border-warning/25 bg-warning-soft text-warning',
      danger: 'border-danger/25 bg-danger-soft text-danger',
      navy: 'border-navy/20 bg-navy text-navy-fg',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({ tone, className, children, icon: Icon }: { tone?: BadgeTone; className?: string; children: ReactNode; icon?: LucideIcon }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {Icon && <Icon aria-hidden />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: BadgeTone; icon: LucideIcon; label?: string }> = {
  ACTIVE: { tone: 'success', icon: CheckCircle2 },
  APPROVED: { tone: 'success', icon: CheckCircle2 },
  PUBLISHED: { tone: 'success', icon: CheckCircle2 },
  CLEAN: { tone: 'success', icon: CheckCircle2 },
  SUCCESS: { tone: 'success', icon: CheckCircle2 },
  ENABLED: { tone: 'success', icon: CheckCircle2 },
  INVITED: { tone: 'info', icon: MailQuestion },
  PENDING: { tone: 'warning', icon: Hourglass },
  WAITING: { tone: 'neutral', icon: Clock },
  DRAFT: { tone: 'neutral', icon: FileEdit },
  RETURNED: { tone: 'warning', icon: RotateCcw },
  REJECTED: { tone: 'danger', icon: XCircle },
  FAILURE: { tone: 'danger', icon: XCircle },
  DENIED: { tone: 'danger', icon: ShieldAlert },
  DEACTIVATED: { tone: 'neutral', icon: Ban },
  CANCELLED: { tone: 'neutral', icon: Ban },
  REVOKED: { tone: 'neutral', icon: Ban },
  DISABLED: { tone: 'neutral', icon: Ban },
  RETIRED: { tone: 'neutral', icon: CircleDashed },
  SUBMITTED: { tone: 'info', icon: Send },
  UNDER_REVIEW: { tone: 'warning', icon: ScanSearch, label: 'Under review' },
  SUSPENDED: { tone: 'danger', icon: PauseCircle },
  ARCHIVED: { tone: 'neutral', icon: Archive },
  VERIFIED: { tone: 'success', icon: ShieldCheck },
  PROPOSED: { tone: 'warning', icon: Hourglass, label: 'Awaiting verification' },
  SUPERSEDED: { tone: 'neutral', icon: CircleDashed },
  PENDING_APPROVAL: { tone: 'warning', icon: Hourglass, label: 'Pending approval' },
  MISSING: { tone: 'danger', icon: FileQuestion },
  SCHEDULED: { tone: 'info', icon: Clock },
  SKIPPED: { tone: 'neutral', icon: CircleDashed },
  EXPIRED: { tone: 'neutral', icon: CircleDashed },
};

/** Status is always conveyed by text + icon, never colour alone (WCAG 1.4.1). */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const s = STATUS[status.toUpperCase()] ?? { tone: 'neutral' as const, icon: CircleDot };
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {label ?? s.label ?? humanize(status)}
    </Badge>
  );
}

export function ScopeBadge({ scope }: { scope: string }) {
  const tone: BadgeTone = scope === 'COMPANY' ? 'info' : scope === 'DEPARTMENT' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{humanize(scope)}</Badge>;
}
