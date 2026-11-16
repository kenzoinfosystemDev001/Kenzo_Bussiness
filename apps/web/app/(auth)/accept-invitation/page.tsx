'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SetPasswordForm } from '@/components/workflow/set-password-form';

function Accept() {
  const params = useSearchParams();
  const router = useRouter();
  return (
    <SetPasswordForm
      token={params.get('token') ?? ''}
      type="INVITATION"
      title="Activate your account"
      submitLabel="Activate account"
      endpoint="/auth/invitations/accept"
      askName
      onDone={() => router.replace('/login?activated=1')}
    />
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
