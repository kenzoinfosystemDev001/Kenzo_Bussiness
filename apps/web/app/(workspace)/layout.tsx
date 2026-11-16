'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorState, Spinner } from '@/components/ui/feedback';
import { useSession } from '@/lib/session';

/**
 * Authenticated workspace. The session is loaded from the API; a missing or
 * expired session is redirected to /login by the API client, and a session
 * that still needs its TOTP step goes to /login/mfa.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { data: session, error, isLoading, refetch } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session?.mfa.pending) router.replace('/login/mfa');
  }, [session, router]);

  if (isLoading || session?.mfa.pending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your workspace" />
      </div>
    );
  }
  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  return <AppShell session={session}>{children}</AppShell>;
}
