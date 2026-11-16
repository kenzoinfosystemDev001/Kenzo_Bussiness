import { AlertTriangle, Inbox, Loader2, Lock, RefreshCw, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-fg-muted', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-muted', className)} />;
}

export function PageLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-surface-muted text-fg-subtle">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PermissionDenied({ message = 'You do not have permission to view this.' }: { message?: string }) {
  return <EmptyState icon={Lock} title="Access restricted" description={`${message} Ask an administrator if you need access.`} />;
}

/** Error panel that surfaces the server correlation ID for support. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (isApiError(error) && (error.code === 'FORBIDDEN' || error.code === 'COMPANY_ACCESS_DENIED')) {
    return <PermissionDenied message={error.message} />;
  }
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  const correlationId = isApiError(error) ? error.correlationId : null;
  const mfa = isApiError(error) && error.code === 'MFA_REQUIRED';
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-base font-medium text-fg">{mfa ? 'Multi-factor verification required' : 'Could not load this'}</p>
      <p className="max-w-md text-sm text-fg-muted">{message}</p>
      {correlationId && (
        <p className="text-xs text-fg-subtle">
          Reference: <span className="font-mono">{correlationId}</span>
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {mfa && (
          <Link href="/settings/security" className="text-sm font-medium text-primary hover:underline">
            Go to security settings
          </Link>
        )}
        {onRetry && !mfa && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden /> Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-primary/20 bg-primary-soft text-fg',
    warning: 'border-warning/30 bg-warning-soft text-fg',
    danger: 'border-danger/30 bg-danger-soft text-fg',
    success: 'border-success/30 bg-success-soft text-fg',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-md border px-3.5 py-2.5 text-sm', styles, className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-fg-muted')}>{children}</div>}
    </div>
  );
}
