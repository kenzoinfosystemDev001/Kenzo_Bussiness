import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordForm } from '@/components/workflow/change-password-form';
import { jsonResponse, mockFetch, renderWithProviders } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('ChangePasswordForm', () => {
  it('validates client-side with the shared password policy before calling the API', async () => {
    const fetchMock = mockFetch(() => jsonResponse(204, undefined));
    renderWithProviders(<ChangePasswordForm />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'whatever');
    await userEvent.type(screen.getByLabelText(/new password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText(/at least 12 characters/i, { selector: '[role=alert]' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows server field errors returned by the API', async () => {
    mockFetch(() =>
      jsonResponse(422, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields are invalid',
          fieldErrors: [{ path: 'currentPassword', message: 'Current password is incorrect' }],
          correlationId: 'c1',
        },
      }),
    );
    renderWithProviders(<ChangePasswordForm />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'not-my-password');
    await userEvent.type(screen.getByLabelText(/new password/i), 'Another-Strong-Pass-42');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toHaveAttribute('aria-invalid', 'true');
  });
});
