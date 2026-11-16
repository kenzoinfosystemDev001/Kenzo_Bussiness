'use client';

import { revealSchema } from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { FormField, Textarea } from '@/components/ui/form';
import { errorMessage, post } from '@/lib/api';
import { validate } from '@/lib/forms';

export const REVEAL_SECONDS = 30;

interface RevealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** POST endpoint, e.g. /vendors/:id/pan/reveal */
  endpoint: string;
  /** Picks the sensitive value from the response. */
  pick: (res: Record<string, unknown>) => string | null;
}

/**
 * Restricted-data reveal: the user must state a reason (audited server-side),
 * the value is shown for a limited time, then hidden again automatically.
 */
export function RevealDialog({ open, onOpenChange, title, endpoint, pick }: RevealDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(REVEAL_SECONDS);
  const [copied, setCopied] = useState(false);
  const m = useMutation({
    mutationFn: (r: string) => post<Record<string, unknown>>(endpoint, { reason: r }),
    onSuccess: (res) => {
      setValue(pick(res));
      setRemaining(REVEAL_SECONDS);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  useEffect(() => {
    if (value === null) return;
    const t = setInterval(() => setRemaining((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [value]);
  useEffect(() => {
    if (value !== null && remaining <= 0) setValue(null);
  }, [remaining, value]);

  const close = (o: boolean) => {
    if (!o) {
      setValue(null);
      setReason('');
      setError(null);
      setCopied(false);
    }
    onOpenChange(o);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(revealSchema, { reason });
    if (v.errors) return setError(v.errors.reason ?? 'Reason is required');
    setError(null);
    m.mutate(v.data.reason);
  };

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={title}
      description="Restricted information. Every reveal is recorded with your name, time and reason."
      size="sm"
    >
      {value !== null ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Full value</p>
            <p data-testid="revealed-value" className="mt-1 select-all break-all font-mono text-lg font-semibold tracking-wider text-fg">
              {value}
            </p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <div className="h-full bg-warning transition-[width] duration-1000 ease-linear" style={{ width: `${(remaining / REVEAL_SECONDS) * 100}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-fg-muted" aria-live="polite">
              Hides automatically in {remaining}s
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={copy}>
              <Copy aria-hidden /> {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button onClick={() => close(false)}>
              <EyeOff aria-hidden /> Hide now
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Alert tone="warning">
            <span className="inline-flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              Only reveal when you need the full value for an authorised task. Do not paste it into email or chat.
            </span>
          </Alert>
          <FormField label="Reason for access" required error={error}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="e.g. Verifying details against the vendor's bank letter"
              autoFocus
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={m.isPending}>
              <Eye aria-hidden /> Reveal
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
