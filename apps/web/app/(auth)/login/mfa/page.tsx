'use client';

import { mfaCodeSchema } from '@kenzo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormField, Input } from '@/components/ui/form';
import { api, isApiError } from '@/lib/api';
import { safeNext, validate } from '@/lib/forms';

function MfaForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(mfaCodeSchema, { code });
    if (v.errors) return setError(v.errors.code ?? 'Enter the 6-digit code');
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/mfa/verify', { method: 'POST', body: v.data, skipAuthRedirect: true });
      await qc.invalidateQueries();
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (isApiError(err) && (err.code === 'UNAUTHENTICATED' || err.code === 'SESSION_EXPIRED')) {
        router.replace('/login');
        return;
      }
      setError(isApiError(err) ? err.message : 'Verification failed');
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST', skipAuthRedirect: true });
    } finally {
      router.replace('/login');
    }
  };

  return (
    <>
      <div className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <ShieldCheck className="size-5" aria-hidden />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-fg">Two-step verification</h1>
      <p className="mt-1 text-sm text-fg-muted">Enter the 6-digit code from your authenticator app.</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <FormField label="Authentication code" required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="tabular text-center text-lg tracking-[0.5em]"
            autoFocus
          />
        </FormField>
        <Button type="submit" size="lg" loading={submitting}>
          Verify
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Use a different account
        </Button>
      </form>
    </>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
