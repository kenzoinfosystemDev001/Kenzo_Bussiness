'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/workflow/set-password-form';

function Reset() {
  const params = useSearchParams();
  const router = useRouter();
  return (
    <SetPasswordForm
      token={params.get('token') ?? ''}
      type="PASSWORD_RESET"
      title="Choose a new password"
      submitLabel="Update password"
      endpoint="/auth/password/reset"
      onDone={() => router.replace('/login?reset=1')}
    />
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
