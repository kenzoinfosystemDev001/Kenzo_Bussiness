'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, ErrorState, Skeleton } from '@/components/ui/feedback';
import { FormField, Input } from '@/components/ui/form';
import { ChangePasswordForm } from '@/components/workflow/change-password-form';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { del, errorMessage, get, post } from '@/lib/api';
import { chunk, formatDateTime, relativeTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { List, SessionRow } from '@/lib/types';

function MfaCard() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const begin = useMutation({
    mutationFn: () => post<{ secret: string; otpauthUri: string }>('/auth/mfa/totp/setup'),
    onSuccess: setSetup,
    onError: (e) => setError(errorMessage(e)),
  });
  const confirm = useMutation({
    mutationFn: () => post('/auth/mfa/totp/confirm', { code }),
    onSuccess: async () => {
      toast.success('Two-step verification enabled');
      setSetup(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => post('/auth/mfa/totp/disable', { code: disableCode }),
    onSuccess: async () => {
      toast.success('Two-step verification disabled');
      setDisableCode('');
      await qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const enabled = session?.mfa.enabled;

  return (
    <Card>
      <CardHeader
        title="Two-step verification"
        description="An authenticator app (Microsoft/Google Authenticator, 1Password…) protects your account and is required for privileged actions when your company enforces it."
        actions={
          enabled ? (
            <Badge tone="success" icon={ShieldCheck}>
              Enabled
            </Badge>
          ) : (
            <Badge tone="warning" icon={ShieldOff}>
              Not enabled
            </Badge>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!enabled && !setup && (
          <Button onClick={() => begin.mutate()} loading={begin.isPending} className="self-start">
            Set up authenticator app
          </Button>
        )}
        {!enabled && setup && (
          <div className="flex flex-col gap-4">
            <ol className="list-inside list-decimal space-y-1 text-sm text-fg-muted">
              <li>Open your authenticator app and add an account with a setup key.</li>
              <li>Enter the key below (time-based, 6 digits, 30 seconds).</li>
              <li>Type the 6-digit code the app shows to confirm.</li>
            </ol>
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <p className="text-xs uppercase tracking-wide text-fg-subtle">Setup key</p>
              <p className="mt-1 select-all break-all font-mono text-md tracking-wider text-fg">{chunk(setup.secret)}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-fg-subtle">Show otpauth:// URI</summary>
                <p className="mt-1 select-all break-all font-mono text-xs text-fg-muted">{setup.otpauthUri}</p>
              </details>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                confirm.mutate();
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <FormField label="6-digit code">
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="tabular w-32 tracking-widest"
                />
              </FormField>
              <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>
                Confirm
              </Button>
            </form>
          </div>
        )}
        {enabled && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              disable.mutate();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <FormField label="Code to disable" hint={session?.mfa.enforced ? 'Your company requires MFA, so it cannot be disabled.' : undefined}>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                className="tabular w-32 tracking-widest"
                disabled={session?.mfa.enforced}
              />
            </FormField>
            <Button type="submit" variant="danger-outline" loading={disable.isPending} disabled={disableCode.length !== 6 || session?.mfa.enforced}>
              Disable
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const q = useQuery({ queryKey: ['my-sessions'], queryFn: () => get<List<SessionRow>>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: async () => {
      toast.success('Session signed out');
      await qc.invalidateQueries({ queryKey: ['my-sessions'] });
    },
  });
  const revokeOthers = useMutation({
    mutationFn: () => post<{ revoked: number }>('/auth/sessions/revoke-others'),
    onSuccess: async (r) => {
      toast.success(`${r.revoked} other session(s) signed out`);
      setConfirmOthers(false);
      await qc.invalidateQueries({ queryKey: ['my-sessions'] });
    },
  });
  const others = (q.data?.items ?? []).filter((s) => !s.current).length;
  return (
    <Card>
      <CardHeader
        title="Active sessions"
        description="Devices currently signed in to your account."
        actions={
          others > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setConfirmOthers(true)}>
              Sign out other sessions
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <CardBody>
          <Skeleton className="h-24" />
        </CardBody>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ul className="divide-y divide-border">
          {q.data?.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Laptop className="size-4 text-fg-subtle" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">
                  {s.userAgent ?? 'Unknown device'}{' '}
                  {s.current && (
                    <Badge tone="info" className="ml-1">
                      This device
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-fg-subtle">
                  {s.ipAddress ?? 'Unknown IP'} · signed in {formatDateTime(s.createdAt)} · last active {relativeTime(s.lastSeenAt)}
                  {s.mfaVerifiedAt ? ' · MFA verified' : ''}
                </p>
              </div>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out all other sessions?"
        impact={`${others} other session(s) will be signed out immediately.`}
        confirmLabel="Sign out others"
        loading={revokeOthers.isPending}
        error={revokeOthers.error ? errorMessage(revokeOthers.error) : null}
        onConfirm={() => revokeOthers.mutate()}
      />
    </Card>
  );
}

export default function SecuritySettingsPage() {
  return (
    <>
      <PageHeader
        title="Security"
        description="Your password, two-step verification and signed-in devices."
        breadcrumbs={[{ label: 'Account' }, { label: 'Security' }]}
      />
      <div className="flex flex-col gap-6">
        <MfaCard />
        <Card>
          <CardHeader title="Password" description="Changing your password signs out your other sessions." />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
        <SessionsCard />
      </div>
    </>
  );
}
