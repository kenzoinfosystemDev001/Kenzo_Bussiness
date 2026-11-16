'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Lightweight CSS tooltip (no extra dependency). Shown on hover and on keyboard
 * focus within the wrapper; the text is also exposed via aria-describedby.
 * Wrap disabled buttons so the explanation is reachable: the wrapper is focusable
 * when `focusable` is set.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  focusable = false,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  focusable?: boolean;
  className?: string;
}) {
  const id = useId();
  if (!content) return <>{children}</>;
  return (
    <span className={cn('group/tt relative inline-flex', className)} tabIndex={focusable ? 0 : undefined} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md bg-navy px-2.5 py-1.5 text-xs font-normal leading-snug text-white opacity-0 shadow-overlay transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
