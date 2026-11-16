'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'kk-theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function apply(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const pref = readPreference();
    const r = pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
    // Sync with what theme-init.js already applied before hydration.
    setPref(pref);
    setResolved(r);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readPreference() !== 'system') return;
      const next = mq?.matches ? 'dark' : 'light';
      setResolved(next);
      apply(next);
    };
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* storage unavailable — keep in memory */
    }
    const r = p === 'system' ? (systemDark() ? 'dark' : 'light') : p;
    setPref(p);
    setResolved(r);
    apply(r);
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
