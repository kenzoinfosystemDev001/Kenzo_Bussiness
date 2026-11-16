'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, RotateCcw, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormField, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { errorMessage, post } from '@/lib/api';
import { cn } from '@/lib/cn';

type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

const LABEL: Record<Decision, string> = { APPROVE: 'Approve', REJECT: 'Reject', RETURN: 'Return for changes' };
const DONE: Record<Decision, string> = { APPROVE: 'Approved', REJECT: 'Rejected', RETURN: 'Returned for changes' };

/**
 * Inline approval decision for a task (POST /approvals/tasks/:id/decision).
 * Reason is mandatory for reject/return; separation-of-duties errors from the
 * API are surfaced verbatim.
 */
export function DecisionPanel({
  taskId,
  subject,
  onDecided,
  compact,
}: {
  taskId: string;
  subject: string;
  onDecided: () => void | Promise<void>;
  compact?: boolean;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/approvals/tasks/${taskId}/decision`, { decision, ...(reason.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: async () => {
      toast.success(DONE[decision!], subject);
      setDecision(null);
      setReason('');
      await onDecided();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    if (decision !== 'APPROVE' && !reason.trim()) return setError('A reason is required to reject or return.');
    setError(null);
    m.mutate();
  };
  const choose = (d: Decision) => {
    setDecision(d);
    setError(null);
  };

  return (
    <form onSubmit={submit} noValidate className={cn('flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary-soft/40 p-4', compact && 'p-3')}>
      <div>
        <p className="text-sm font-semibold text-fg">Your decision</p>
        <p className="text-xs text-fg-muted">Recorded permanently with your name, time and reason.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
        {(['APPROVE', 'RETURN', 'REJECT'] as Decision[]).map((d) => (
          <Button
            key={d}
            role="radio"
            aria-checked={decision === d}
            variant={decision === d ? (d === 'REJECT' ? 'danger' : 'primary') : 'secondary'}
            size="sm"
            onClick={() => choose(d)}
          >
            {d === 'APPROVE' ? <Check aria-hidden /> : d === 'RETURN' ? <RotateCcw aria-hidden /> : <X aria-hidden />} {LABEL[d]}
          </Button>
        ))}
      </div>
      {decision && (
        <div className="flex flex-col gap-3 animate-fade-in">
          <FormField label={decision === 'APPROVE' ? 'Comment (optional)' : 'Reason'} required={decision !== 'APPROVE'}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} rows={2} autoFocus />
          </FormField>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant={decision === 'REJECT' ? 'danger' : 'primary'} loading={m.isPending}>
              Confirm: {LABEL[decision]}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
