'use client';

import { forgotPasswordSchema } from '@kenzo/shared';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormField, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { validate } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate(forgotPasswordSchema, { email });
    if (v.errors) return setError(v.errors.email ?? 'Enter a valid email');
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: v.data, skipAuthRedirect: true });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div>
        <div className="flex size-10 items-center justify-center rounded-full bg-success-soft text-success">
          <MailCheck className="size-5" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-fg">Check your email</h1>
        <p className="mt-1 text-sm text-fg-muted">If an active account exists for {email}, we have sent a reset link. It expires in 60 minutes.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg">Reset your password</h1>
      <p className="mt-1 text-sm text-fg-muted">We will email you a single-use link.</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        <FormField label="Work email" error={error} required>
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </FormField>
        <Button type="submit" size="lg" loading={submitting}>
          Send reset link
        </Button>
        <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </form>
    </>
  );
}
