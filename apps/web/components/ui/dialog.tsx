'use client';

import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { FormField, Textarea } from './form';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

const overlay = 'fixed inset-0 z-40 bg-navy/40 backdrop-blur-[1px] data-[state=open]:animate-fade-in';

/** Centered modal (Radix Dialog: focus trap, Esc to close, aria-labelled). */
export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }: BaseProps & { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-scale-in',
            { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RD.Title className="text-md font-semibold text-fg">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-sm text-fg-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{title}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </RD.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** Right-side drawer for create/edit forms and record previews. */
export function Drawer({ open, onOpenChange, title, description, children, footer, width = 'md' }: BaseProps & { width?: 'md' | 'lg' }) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className={overlay} />
        <RD.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-slide-in-right',
            width === 'md' ? 'max-w-md' : 'max-w-2xl',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <RD.Title className="text-md font-semibold text-fg">{title}</RD.Title>
              {description ? (
                <RD.Description className="mt-1 text-sm text-fg-muted">{description}</RD.Description>
              ) : (
                <RD.Description className="sr-only">{title}</RD.Description>
              )}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X />
              </Button>
            </RD.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Explain downstream impact of the action (PRD §5.4). */
  impact?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  /** When true the user must enter a reason, which is passed to onConfirm. */
  requireReason?: boolean;
  reasonLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
}

/** Confirmation for destructive or irreversible actions, optionally with a mandatory reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel = 'Confirm',
  tone = 'danger',
  requireReason = false,
  reasonLabel = 'Reason',
  loading = false,
  error,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = requireReason && reason.trim().length === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missing) return;
    void onConfirm(reason.trim());
  };

  const change = (next: boolean) => {
    if (!next) {
      setReason('');
      setTouched(false);
    }
    onOpenChange(next);
  };

  return (
    <Modal open={open} onOpenChange={change} title={title} description={description} size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {impact && <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-fg">{impact}</div>}
        {requireReason && (
          <FormField label={reasonLabel} required error={touched && missing ? `${reasonLabel} is required` : null}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
          </FormField>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => change(false)} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
