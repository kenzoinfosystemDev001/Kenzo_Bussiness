'use client';

import { PASSWORD_MIN_LENGTH, passwordSchema } from '@kenzo/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { FormField, Input } from '@/components/ui/form';
import { api, errorMessage, isApiError } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';

interface Props {
  token: string;
  type: 'INVITATION' | 'PASSWORD_RESET';
  title: string;
  submitLabel: string;
  endpoint: string;
  askName?: boolean;
  onDone: () => void;
}

function validatePasswords(password: string, confirm: string): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const v = validate(passwordSchema, password);
  if (v.errors) errors.password = v.errors['(root)'] ?? Object.values(v.errors)[0] ?? 'Invalid password';
  if (password !== confirm) errors.confirm = 'Passwords do not match';
  return Object.keys(errors).length ? errors : null;
}

/** Shared by reset-password and accept-invitation: describes the token, then sets a password. */
export function SetPasswordForm({ token, type, title, submitLabel, endpoint, askName, onDone }: Props) {
  const described = useQuery({
    queryKey: ['token', type, token],
    queryFn: () => api<{ email: string; fullName: string }>('/auth/tokens/describe', { method: 'POST', body: { token, type }, skipAuthRedirect: true }),
    enabled: token.length >= 20,
    retry: false,
  });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fullName, setFullName] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token.length < 20 || (described.error && isApiError(described.error) && described.error.code === 'TOKEN_INVALID')) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-fg">Link invalid or expired</h1>
        <p className="mt-1 text-sm text-fg-muted">This link can only be used once and expires after a short time. Ask for a new one.</p>
        <Link href={type === 'INVITATION' ? '/login' : '/forgot-password'} className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          {type === 'INVITATION' ? 'Back to sign in' : 'Request a new link'}
        </Link>
      </div>
    );
  }
  if (described.isLoading) return <Spinner label="Checking link" />;
  if (described.error) return <Alert tone="danger">{errorMessage(described.error)}</Alert>;

  const name = fullName ?? described.data?.fullName ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const invalid = validatePasswords(password, confirm);
    if (invalid) return setErrors(invalid);
    setErrors({});
    setSubmitting(true);
    try {
      await api(endpoint, { method: 'POST', body: { token, password, ...(askName && name ? { fullName: name } : {}) }, skipAuthRedirect: true });
      onDone();
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFormError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-1 text-sm text-fg-muted">
        For <span className="font-medium text-fg">{described.data?.email}</span>
      </p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        {askName && (
          <FormField label="Full name" error={errors.fullName}>
            <Input autoComplete="name" value={name} onChange={(e) => setFullName(e.target.value)} />
          </FormField>
        )}
        <FormField
          label="New password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters; mix letters with numbers or symbols.`}
          error={errors.password}
          required
        >
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirm password" error={errors.confirm} required>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <Button type="submit" size="lg" loading={submitting}>
          {submitLabel}
        </Button>
      </form>
    </>
  );
}
