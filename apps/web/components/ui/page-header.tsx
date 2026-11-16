import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-subtle">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3" aria-hidden />}
            {c.href && i < items.length - 1 ? (
              <Link href={c.href} className="hover:text-fg hover:underline">
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className={i === items.length - 1 ? 'text-fg-muted' : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
