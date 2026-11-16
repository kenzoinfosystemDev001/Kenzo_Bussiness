'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';

export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary',
        size === 'sm' ? 'size-6 text-2xs' : 'size-8 text-xs',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

/** Accessible tablist (arrow-key navigation). Content is rendered by the caller. */
export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (v: string) => void; className?: string }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = items[(index + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    if (next) {
      onChange(next.value);
      document.getElementById(`tab-${next.value}`)?.focus();
    }
  };
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-border', className)}>
      {items.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            id={`tab-${t.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150',
              active ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular rounded-full bg-surface-muted px-1.5 text-2xs text-fg-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Debounced search box; emits after the user pauses typing. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  label = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to debounced input
  }, [debounced]);
  // Follow external changes (e.g. "Clear filters", back/forward navigation).
  useEffect(() => {
    if (value !== debounced) setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the controlled value
  }, [value]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-8 text-base text-fg shadow-sm placeholder:text-fg-subtle hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0"
      />
      {text && (
        <button
          type="button"
          onClick={() => setText('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b border-border px-4 py-3', className)}>{children}</div>;
}

/** Monospace pre-formatted JSON rendered as text (never as HTML). */
export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  const text = value === undefined || value === null ? '—' : JSON.stringify(value, null, 2);
  return (
    <pre
      className={cn(
        'scrollbar-thin max-h-80 overflow-auto rounded-md border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed text-fg',
        className,
      )}
    >
      {text}
    </pre>
  );
}
