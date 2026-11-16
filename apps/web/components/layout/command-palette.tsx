'use client';

import * as RD from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, CornerDownLeft, Monitor, Moon, Plus, Search, Store, Sun, User, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { get } from '@/lib/api';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { hasPermission } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { Page, Session, TaskRow, UserRow } from '@/lib/types';
import type { VendorListResponse } from '@/lib/vendors';
import { visibleNav } from './nav-config';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

/** Subsequence fuzzy match with a simple score (lower is better), or -1 if no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

/** Opens with ⌘K / Ctrl+K anywhere in the workspace. */
export function useCommandPaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

export function CommandPalette({ session, open, onOpenChange }: { session: Session; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { setPreference } = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(query, 200);
  const canUsers = hasPermission(session, 'user.read');
  const canAct = hasPermission(session, 'approval.task.act');
  const canVendors = hasPermission(session, 'vendor.read');

  const users = useQuery({
    queryKey: ['palette', 'users', debounced],
    queryFn: () => get<Page<UserRow>>('/users', { q: debounced, limit: 5 }),
    enabled: open && canUsers && debounced.trim().length >= 2,
  });
  const vendors = useQuery({
    queryKey: ['palette', 'vendors', debounced],
    queryFn: () => get<VendorListResponse>('/vendors', { q: debounced, pageSize: 5 }),
    enabled: open && canVendors && debounced.trim().length >= 2,
  });
  const tasks = useQuery({
    queryKey: ['palette', 'tasks'],
    queryFn: () => get<Page<TaskRow>>('/approvals/tasks', { status: 'PENDING', limit: 5 }),
    enabled: open && canAct,
  });

  const go = (href: string) => () => {
    onOpenChange(false);
    router.push(href);
  };

  const commands = useMemo<Command[]>(() => {
    const nav = visibleNav(session.permissions).flatMap((g) =>
      g.items.map((i) => ({ id: `nav:${i.href}`, group: 'Go to', label: i.label, hint: g.label, icon: i.icon, keywords: i.href, run: go(i.href) })),
    );
    const actions: Command[] = [
      ...(hasPermission(session, 'vendor.create')
        ? [{ id: 'act:new-vendor', group: 'Actions', label: 'New vendor', icon: Plus, keywords: 'add onboard supplier create', run: go('/vendors/new') }]
        : []),
      ...(hasPermission(session, 'user.invite')
        ? [{ id: 'act:invite', group: 'Actions', label: 'Invite a user', icon: User, keywords: 'new add', run: go('/admin/users?invite=1') }]
        : []),
      ...(hasPermission(session, 'approval.delegation.manage')
        ? [{ id: 'act:delegate', group: 'Actions', label: 'Delegate my approvals', icon: CheckSquare, keywords: 'leave', run: go('/approvals/delegations') }]
        : []),
      { id: 'theme:light', group: 'Theme', label: 'Light theme', icon: Sun, run: () => setPreference('light') },
      { id: 'theme:dark', group: 'Theme', label: 'Dark theme', icon: Moon, run: () => setPreference('dark') },
      { id: 'theme:system', group: 'Theme', label: 'Match system theme', icon: Monitor, run: () => setPreference('system') },
    ];
    const pending: Command[] = (tasks.data?.items ?? []).map((t) => ({
      id: `task:${t.id}`,
      group: 'Waiting for you',
      label: `${humanize(t.instance.entityType)} ${t.instance.entityReference ?? ''}`.trim(),
      hint: t.instance.requester.fullName,
      icon: CheckSquare,
      keywords: t.instance.entitySummary ?? '',
      run: go(`/approvals/${t.instance.id}`),
    }));
    const people: Command[] = (users.data?.items ?? []).map((u) => ({
      id: `user:${u.id}`,
      group: 'People',
      label: u.fullName,
      hint: u.email,
      icon: User,
      keywords: u.email,
      run: go(`/admin/users/${u.id}`),
    }));
    const scored = [...nav, ...pending, ...actions]
      .map((c) => ({ c, s: fuzzyScore(query, `${c.label} ${c.keywords ?? ''}`) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.c);
    const vendorHits: Command[] = (vendors.data?.items ?? []).map((v) => ({
      id: `vendor:${v.id}`,
      group: 'Vendors',
      label: v.legalName,
      hint: `${v.vendorCode} · ${v.city}`,
      icon: Store,
      run: go(`/vendors/${v.id}`),
    }));
    return [...scored, ...vendorHits, ...people];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` is stable for a render
  }, [session, query, tasks.data, users.data, vendors.data, setPreference]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = commands[active];
      if (cmd) {
        cmd.run();
        if (cmd.group === 'Theme') onOpenChange(false);
      }
    }
  };

  let lastGroup = '';
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-navy/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RD.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-overlay focus:outline-none data-[state=open]:animate-scale-in">
          <RD.Title className="sr-only">Command palette</RD.Title>
          <RD.Description className="sr-only">Search pages, people and actions. Use arrow keys and Enter.</RD.Description>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={commands[active] ? `palette-${active}` : undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                canVendors ? 'Search vendors, pages, people and actions…' : canUsers ? 'Search pages, people and actions…' : 'Search pages and actions…'
              }
              className="h-12 w-full bg-transparent text-md text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-2xs text-fg-subtle sm:inline">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="scrollbar-thin max-h-[50vh] overflow-y-auto p-2">
            {commands.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-fg-muted">
                {users.isFetching || vendors.isFetching ? 'Searching…' : `No results for “${query}”`}
              </p>
            )}
            {commands.map((c, i) => {
              const header = c.group !== lastGroup ? c.group : null;
              lastGroup = c.group;
              return (
                <div key={c.id}>
                  {header && <p className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">{header}</p>}
                  <div
                    id={`palette-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => {
                      c.run();
                      if (c.group === 'Theme') onOpenChange(false);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors duration-150',
                      i === active ? 'bg-primary-soft text-fg' : 'text-fg-muted',
                    )}
                  >
                    <c.icon className={cn('size-4 shrink-0', i === active ? 'text-primary' : 'text-fg-subtle')} aria-hidden />
                    <span className="truncate font-medium">{c.label}</span>
                    {c.hint && <span className="ml-auto truncate text-xs text-fg-subtle">{c.hint}</span>}
                    {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 border-t border-border bg-surface-muted/60 px-4 py-2 text-2xs text-fg-subtle">
            <span>
              <kbd className="font-sans">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-sans">↵</kbd> open
            </span>
            <span className="ml-auto">Results respect your permissions</span>
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
