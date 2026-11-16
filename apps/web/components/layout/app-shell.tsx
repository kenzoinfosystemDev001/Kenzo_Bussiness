'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Building2, Check, ChevronsLeft, ChevronsRight, ChevronsUpDown, LogOut, Menu, Monitor, Moon, Search, ShieldCheck, Sun, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui/dropdown';
import { Avatar } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { errorMessage, get, post } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Session } from '@/lib/types';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { CommandPalette, useCommandPaletteShortcut } from './command-palette';
import { visibleNav } from './nav-config';

const COLLAPSE_KEY = 'kk-sidebar-collapsed';

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/overview" className="flex items-center gap-2.5 px-3 py-4" aria-label="Kenzo-Kore BusinessOS home">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">K</span>
      {!collapsed && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-white">Kenzo-Kore</span>
          <span className="block text-2xs uppercase tracking-wider text-navy-fg/70">BusinessOS</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ session, collapsed, onNavigate }: { session: Session; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = visibleNav(session.permissions);
  // Longest matching nav entry wins; record pages map to their list (e.g. /vendors/:id → Directory).
  const effective = /^\/vendors\/(?!directory|review|documents|bank-verification|performance)[^/]+/.test(pathname) ? '/vendors/directory' : pathname;
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const best = hrefs.filter((h) => effective === h || effective.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === best;
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 pb-4 scrollbar-thin">
      {groups.map((g, i) => (
        <div key={g.label ?? i}>
          {g.label && !collapsed && <p className="mb-1.5 px-2.5 text-2xs font-semibold uppercase tracking-wider text-navy-fg/50">{g.label}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                      active ? 'bg-white/10 font-medium text-white' : 'text-navy-fg/80 hover:bg-white/5 hover:text-white',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function CompanySwitcher({ session }: { session: Session }) {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const switcher = useMutation({
    mutationFn: (companyId: string) => post('/auth/switch-company', { companyId }),
    onSuccess: async () => {
      await qc.resetQueries();
      router.push('/overview');
    },
    onError: (e) => toast.error('Could not switch company', errorMessage(e)),
  });
  const current = session.company;
  if (session.companies.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Building2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <span className="truncate font-medium text-fg">{current?.displayName ?? 'No company access'}</span>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownTrigger className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Building2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <span className="truncate font-medium text-fg">{current?.displayName ?? 'Select company'}</span>
        <ChevronsUpDown className="size-3.5 text-fg-subtle" aria-hidden />
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>Switch company</DropdownLabel>
        {session.companies.map((c) => (
          <DropdownItem key={c.id} disabled={switcher.isPending} onSelect={() => c.id !== current?.id && switcher.mutate(c.id)}>
            <span className="flex-1">{c.displayName}</span>
            {c.id === current?.id && <Check aria-label="Current" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </DropdownMenu>
  );
}

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  return (
    <Link
      href="/notifications"
      className="relative rounded-md p-2 text-fg-muted hover:bg-surface-muted hover:text-fg"
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
    >
      <Bell className="size-4" aria-hidden />
      {count > 0 && (
        <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-2xs font-semibold leading-4 text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function UserMenu({ session }: { session: Session }) {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => post('/auth/logout'),
    onSettled: () => {
      qc.clear();
      window.location.replace(new URL('/login', window.location.origin).toString());
    },
  });
  return (
    <DropdownMenu>
      <DropdownTrigger
        className="flex items-center gap-2 rounded-md p-1 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
      >
        <Avatar name={session.user.fullName} />
      </DropdownTrigger>
      <DropdownContent>
        <div className="px-2.5 py-2">
          <p className="text-sm font-medium text-fg">{session.user.fullName}</p>
          <p className="text-xs text-fg-subtle">{session.user.email}</p>
        </div>
        <DropdownSeparator />
        <DropdownLabel>Theme</DropdownLabel>
        {THEMES.map((t) => (
          <DropdownItem key={t.value} onSelect={() => setPreference(t.value)}>
            <t.icon aria-hidden />
            <span className="flex-1">{t.label}</span>
            {preference === t.value && <Check aria-label="Selected" />}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/settings/security')}>
          <ShieldCheck aria-hidden /> Security settings
        </DropdownItem>
        <DropdownItem destructive onSelect={() => logout.mutate()}>
          <LogOut aria-hidden /> Sign out
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only z-50 rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col bg-navy transition-[width] duration-220 lg:flex', collapsed ? 'w-16' : 'w-60')}>
        <Brand collapsed={collapsed} />
        <Sidebar session={session} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          className="m-2 flex items-center justify-center gap-2 rounded-md py-1.5 text-xs text-navy-fg/70 hover:bg-white/5 hover:text-white"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </aside>
      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-64 flex-col bg-navy animate-slide-in-right">
            <div className="flex items-center justify-between pr-2">
              <Brand collapsed={false} />
              <button type="button" onClick={() => setMobileOpen(false)} className="rounded p-1.5 text-navy-fg hover:bg-white/10" aria-label="Close navigation">
                <X className="size-4" />
              </button>
            </div>
            <Sidebar session={session} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            className="rounded p-1.5 text-fg-muted hover:bg-surface-muted lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <CompanySwitcher session={session} />
          <button
            type="button"
            onClick={openPalette}
            className="ml-auto flex h-8 items-center gap-2 rounded-md border border-border bg-surface-muted/60 px-2.5 text-sm text-fg-subtle transition-colors duration-150 hover:border-border-strong hover:text-fg-muted sm:w-64"
            aria-label="Search and quick navigation (Ctrl+K)"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden sm:inline">Search or jump to…</span>
            <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 text-2xs font-medium sm:inline">Ctrl K</kbd>
          </button>
          <div className="flex items-center gap-1">
            {!session.mfa.enabled && session.mfa.enforced && (
              <Link
                href="/settings/security"
                className="hidden rounded-md border border-warning/30 bg-warning-soft px-2 py-1 text-xs font-medium text-warning sm:inline"
              >
                MFA required for privileged actions
              </Link>
            )}
            <NotificationBell />
            <UserMenu session={session} />
          </div>
        </header>
        <main id="main" key={pathname} className="mx-auto w-full max-w-[1400px] flex-1 animate-fade-in px-4 py-6 lg:px-8">
          {children}
        </main>
        <CommandPalette session={session} open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </div>
  );
}
