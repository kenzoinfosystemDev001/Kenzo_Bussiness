'use client';

import type { PermissionScope } from '@kenzo/shared';
import { Lock, ShieldAlert } from 'lucide-react';
import { Badge, ScopeBadge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';
import type { Grant, PermissionDef } from '@/lib/types';

function groupByModule(defs: PermissionDef[]): Array<[string, PermissionDef[]]> {
  const map = new Map<string, PermissionDef[]>();
  for (const d of defs) map.set(d.module, [...(map.get(d.module) ?? []), d]);
  return [...map.entries()];
}

interface Props {
  catalogue: PermissionDef[];
  grants: Grant[];
  /** When provided the matrix is editable. */
  onChange?: (grants: Grant[]) => void;
  /** Permissions the editor holds (anti-escalation: others are disabled). */
  editorPermissions?: Record<string, PermissionScope>;
}

const SCOPES: PermissionScope[] = ['OWN', 'DEPARTMENT', 'COMPANY'];
const RANK: Record<PermissionScope, number> = { OWN: 1, DEPARTMENT: 2, COMPANY: 3 };

/** Permission catalogue grouped by module; read-only or editable with scope selection. */
export function PermissionMatrix({ catalogue, grants, onChange, editorPermissions }: Props) {
  const byKey = new Map(grants.map((g) => [g.key, g.scope]));
  const toggle = (key: string, on: boolean, scope: PermissionScope = 'COMPANY') => {
    if (!onChange) return;
    const rest = grants.filter((g) => g.key !== key);
    onChange(on ? [...rest, { key, scope }] : rest);
  };

  return (
    <div className="flex flex-col gap-5">
      {groupByModule(catalogue).map(([module, defs]) => {
        const granted = defs.filter((d) => byKey.has(d.key)).length;
        return (
          <section key={module} aria-labelledby={`mod-${module}`}>
            <div className="mb-2 flex items-center gap-2">
              <h3 id={`mod-${module}`} className="text-sm font-semibold text-fg">
                {humanize(module)}
              </h3>
              <span className="tabular text-xs text-fg-subtle">
                {granted}/{defs.length}
              </span>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {defs.map((d) => {
                const scope = byKey.get(d.key);
                const mine = editorPermissions?.[d.key] as PermissionScope | undefined;
                const editable = !!onChange && !!mine;
                return (
                  <li key={d.key} className={cn('flex flex-wrap items-center gap-3 px-3 py-2', !scope && !onChange && 'opacity-60')}>
                    {onChange ? (
                      <input
                        type="checkbox"
                        aria-label={d.key}
                        className="size-4 accent-[rgb(var(--primary))]"
                        checked={!!scope}
                        disabled={!editable}
                        onChange={(e) => toggle(d.key, e.target.checked, d.scopable ? (mine ?? 'OWN') : 'COMPANY')}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-fg">
                        <span className="font-mono text-xs text-fg-muted">{d.key}</span>
                        {d.phase > 1 && <span className="ml-2 text-2xs text-fg-subtle">Phase {d.phase}</span>}
                      </p>
                      <p className="text-xs text-fg-subtle">{d.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {d.sensitive && (
                        <Badge tone="warning" icon={ShieldAlert}>
                          Sensitive
                        </Badge>
                      )}
                      {d.requiresMfa && (
                        <Badge tone="info" icon={Lock}>
                          MFA
                        </Badge>
                      )}
                      {onChange && scope && d.scopable ? (
                        <select
                          aria-label={`Scope for ${d.key}`}
                          value={scope}
                          disabled={!editable}
                          onChange={(e) => toggle(d.key, true, e.target.value as PermissionScope)}
                          className="h-7 rounded border border-border bg-surface px-1.5 text-xs"
                        >
                          {SCOPES.filter((s) => !mine || RANK[s] <= RANK[mine]).map((s) => (
                            <option key={s} value={s}>
                              {humanize(s)}
                            </option>
                          ))}
                        </select>
                      ) : scope ? (
                        <ScopeBadge scope={scope} />
                      ) : !onChange ? (
                        <span className="text-xs text-fg-subtle">Not granted</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
