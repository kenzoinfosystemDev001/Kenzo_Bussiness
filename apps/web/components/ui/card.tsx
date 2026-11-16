import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-md font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

/** Description list for record attributes. */
export function KeyValue({ items, columns = 2, className }: { items: KeyValueItem[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
        className,
      )}
    >
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{item.label}</dt>
          <dd className={cn('mt-0.5 break-words text-base text-fg', item.mono && 'font-mono text-sm')}>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = { neutral: 'text-fg', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone];
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2 text-sm text-fg-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className={cn('tabular mt-2 text-2xl font-semibold tracking-tight', toneClass)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-subtle">{hint}</div>}
    </Card>
  );
}
