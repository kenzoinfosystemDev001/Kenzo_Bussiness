'use client';

import { PASSWORD_MIN_LENGTH, changePasswordSchema } from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { FormField, Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { errorMessage, post } from '@/lib/api';
import { serverFieldErrors, validate } from '@/lib/forms';

/** Change-password form; shows client and server field errors. */
export function ChangePasswordForm() {
  const toast = useToast();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: unknown) => post('/auth/password/change', body),
    onSuccess: () => {
      toast.success('Password changed', 'Your other sessions were signed out.');
      setCurrent('');
      setNew('');
    },
    onError: (e) => {
      const fields = serverFieldErrors(e);
      setErrors(Object.keys(fields).length ? fields : { form: errorMessage(e) });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(changePasswordSchema, { currentPassword, newPassword });
    if (v.errors) return setErrors(v.errors);
    setErrors({});
    m.mutate(v.data);
  };
  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
      <FormField label="Current password" required error={errors.currentPassword}>
        <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
      </FormField>
      <FormField label="New password" required hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} error={errors.newPassword}>
        <Input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
      </FormField>
      <Button type="submit" loading={m.isPending} className="self-start">
        Change password
      </Button>
    </form>
  );
}
