import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize } from '@/lib/format';
import type { AuditRow } from '@/lib/types';

/** Compact audit-event timeline for record detail pages. */
export function ActivityTimeline({ events, onSelect }: { events: AuditRow[]; onSelect?: (e: AuditRow) => void }) {
  return (
    <ol className="flex flex-col" aria-label="Activity">
      {events.map((e, i) => {
        const Icon = e.outcome === 'SUCCESS' ? ShieldCheck : e.outcome === 'DENIED' ? ShieldAlert : ShieldX;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < events.length - 1 && <span aria-hidden className="absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px bg-border" />}
            <Icon className={cn('relative z-10 mt-0.5 size-4 shrink-0 bg-surface', e.outcome === 'SUCCESS' ? 'text-fg-subtle' : 'text-danger')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-fg">
                {onSelect ? (
                  <button type="button" onClick={() => onSelect(e)} className="font-medium hover:underline">
                    {humanize(e.action)}
                  </button>
                ) : (
                  <span className="font-medium">{humanize(e.action)}</span>
                )}
                {e.actor && <span className="text-fg-muted"> · {e.actor.fullName}</span>}
              </p>
              {e.reason && <p className="text-sm text-fg-muted">Reason: {e.reason}</p>}
              <time dateTime={e.occurredAt} className="text-xs text-fg-subtle">
                {formatDateTime(e.occurredAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
