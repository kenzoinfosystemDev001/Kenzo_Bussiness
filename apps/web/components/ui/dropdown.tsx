'use client';

import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = DM.Root;
export const DropdownTrigger = DM.Trigger;

export function DropdownContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[200px] rounded-md border border-border bg-surface p-1 shadow-overlay animate-scale-in', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  disabled,
  destructive,
}: {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2.5 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-muted data-[disabled]:opacity-50 [&_svg]:size-4',
        destructive ? 'text-danger' : 'text-fg',
      )}
    >
      {children}
    </DM.Item>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <DM.Label className="px-2.5 py-1.5 text-xs font-medium text-fg-subtle">{children}</DM.Label>;
}

export function DropdownSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}
