'use client';

import { loginSchema } from '@kenzo/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormField, Input } from '@/components/ui/form';
import { api, isApiError } from '@/lib/api';
import { safeNext, serverFieldErrors, validate } from '@/lib/forms';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const next = safeNext(params.get('next'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const v = validate(loginSchema, { email, password });
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    setSubmitting(true);
    try {
      const res = await api<{ mfaRequired: boolean }>('/auth/login', { method: 'POST', body: v.data, skipAuthRedirect: true });
      qc.clear();
      router.replace(res.mfaRequired ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(isApiError(err) ? err.message : 'Sign-in failed. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Use your Kenzo work account.</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <FormField label="Work email" error={errors.email} required>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Password" error={errors.password} required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={submitting}>
          Sign in
        </Button>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
