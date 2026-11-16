import { gstinWithChecksum } from '@kenzo/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVEAL_SECONDS, RevealDialog } from '@/components/vendors/reveal-dialog';
import { ExpiryBadge } from '@/components/vendors/vendor-ui';
import { DuplicateReview, IdentityStep } from '@/components/vendors/wizard-steps';
import { INITIAL_WIZARD, changeGstType, gstFieldRules, persistableDraft, stepForPath, validateWizard, type WizardState } from '@/lib/vendor-wizard';
import { documentExpiryState, duplicateOverrideRequired, expiryLabel, vendorActions, type ActionContext, type DuplicateMatch } from '@/lib/vendors';
import { jsonResponse, mockFetch, renderWithProviders } from './utils';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const GSTIN = gstinWithChecksum('29ABCDE1234F1Z'); // Karnataka
const VALID: WizardState = {
  ...INITIAL_WIZARD,
  legalName: 'Acme Technologies Private Limited',
  category: 'IT hardware',
  gstRegistrationType: 'REGISTERED',
  gstin: GSTIN,
  pan: 'ABCDE1234F',
  addressLine1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  contacts: [{ name: 'Priya Rao', designation: '', email: 'priya@acme.example', phone: '', isPrimary: true }],
};

describe('vendor wizard — conditional GST rules and validation', () => {
  it('derives which tax fields apply to each registration type', () => {
    expect(gstFieldRules('REGISTERED')).toMatchObject({ showGstin: true, gstinRequired: true, showPan: true, overseas: false });
    expect(gstFieldRules('UNREGISTERED')).toMatchObject({ showGstin: false, showPan: true, panRequired: true });
    expect(gstFieldRules('OVERSEAS')).toMatchObject({ showGstin: false, showPan: false, overseas: true });
  });

  it('clears fields that no longer apply when the type changes', () => {
    const unreg = changeGstType(VALID, 'UNREGISTERED');
    expect(unreg.gstin).toBe('');
    expect(unreg.pan).toBe('ABCDE1234F');
    const overseas = changeGstType(VALID, 'OVERSEAS');
    expect(overseas.pan).toBe('');
    expect(overseas.country).toBe('');
    expect(overseas.bank.accountType).toBe('OVERSEAS');
  });

  it('accepts a complete, consistent vendor', () => {
    expect(validateWizard(VALID)).toEqual({});
  });

  it('requires a GSTIN for registered vendors and validates its check digit', () => {
    expect(validateWizard({ ...VALID, gstin: '' }).gstin).toMatch(/required/i);
    const badCheck = GSTIN.slice(0, 14) + (GSTIN.endsWith('A') ? 'B' : 'A');
    expect(validateWizard({ ...VALID, gstin: badCheck }).gstin).toMatch(/check digit/i);
  });

  it('cross-checks PAN, state code and PIN code', () => {
    expect(validateWizard({ ...VALID, pan: 'ZZZZZ9999Z' }).pan).toMatch(/does not match/i);
    expect(validateWizard({ ...VALID, state: 'Maharashtra' }).gstin).toMatch(/state code/i);
    expect(validateWizard({ ...VALID, postalCode: '12345' }).postalCode).toMatch(/6 digits/);
  });

  it('requires a Udyam number when MSME is ticked', () => {
    expect(validateWizard({ ...VALID, msmeRegistered: true }).msmeNumber).toMatch(/required/i);
    expect(validateWizard({ ...VALID, msmeRegistered: true, msmeNumber: 'UDYAM-KA-03-0001234' }).msmeNumber).toBeUndefined();
  });

  it('validates bank details only when included, and maps errors to the right step', () => {
    const errs = validateWizard({
      ...VALID,
      includeBank: true,
      bank: { ...VALID.bank, accountHolderName: 'Acme', bankName: 'HDFC', ifsc: 'BAD', accountNumber: '123456789012', confirmAccountNumber: '123456789013' },
    });
    expect(errs['bankAccount.ifsc']).toBeDefined();
    expect(errs['bankAccount.confirmAccountNumber']).toMatch(/do not match/);
    expect(stepForPath('bankAccount.ifsc')).toBe(3);
    expect(stepForPath('contacts.0.email')).toBe(1);
    expect(stepForPath('gstin')).toBe(0);
  });

  it('never persists bank details in the session draft', () => {
    const draft = persistableDraft({
      ...VALID,
      includeBank: true,
      bank: { ...VALID.bank, accountNumber: '123456789012', confirmAccountNumber: '123456789012' },
    });
    expect(JSON.stringify(draft)).not.toContain('123456789012');
    expect(draft.includeBank).toBe(false);
  });

  it('shows and hides tax fields as the registration type changes', async () => {
    function Harness() {
      const [s, setS] = useState<WizardState>(VALID);
      return <IdentityStep state={s} update={(p) => setS((x) => ({ ...x, ...p }))} replace={setS} errors={{}} />;
    }
    render(<Harness />);
    expect(screen.getByLabelText(/GSTIN/)).toBeInTheDocument();
    expect(screen.getByText(/check digit valid/i)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Not GST registered'));
    expect(screen.queryByLabelText(/GSTIN/)).toBeNull();
    expect(screen.getByLabelText(/^PAN/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Overseas (non-resident)'));
    expect(screen.queryByLabelText(/^PAN/)).toBeNull();
    expect(screen.getByLabelText(/Country/)).toBeInTheDocument();
  });
});

describe('duplicate warning', () => {
  const strong: DuplicateMatch = {
    vendorId: 'v1',
    vendorCode: 'VEN-1',
    legalName: 'Acme Technologies Pvt Ltd',
    tradeName: null,
    status: 'ACTIVE',
    city: 'Bengaluru',
    gstin: GSTIN,
    reasons: ['GSTIN', 'NAME_EXACT'],
    similarity: 1,
    strong: true,
  };
  const weak: DuplicateMatch = { ...strong, vendorId: 'v2', reasons: ['NAME_SIMILAR'], similarity: 0.86, strong: false };

  it('requires an override reason only for strong duplicates', () => {
    expect(duplicateOverrideRequired([weak])).toBe(false);
    expect(duplicateOverrideRequired([weak, strong])).toBe(true);
    expect(duplicateOverrideRequired([])).toBe(false);
  });

  it('asks for a reason and lists match reasons for strong duplicates', () => {
    const { rerender } = renderWithProviders(<DuplicateReview matches={[weak]} loading={false} overrideReason="" onOverrideReason={() => undefined} />);
    expect(screen.getByText('Similar vendors found')).toBeInTheDocument();
    expect(screen.queryByLabelText(/different vendor/i)).toBeNull();
    rerender(
      <DuplicateReview matches={[strong]} loading={false} overrideReason="" onOverrideReason={() => undefined} error="Explain in at least 10 characters" />,
    );
    expect(screen.getByText(/1 likely duplicate found/i)).toBeInTheDocument();
    expect(screen.getByText('Same GSTIN')).toBeInTheDocument();
    expect(screen.getByLabelText(/different vendor/i)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('reveal dialog', () => {
  it('requires a reason, reveals the value, then hides it automatically', async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { accountNumber: '123456789012', revealedAt: '2026-11-16T00:00:00Z' }));
    renderWithProviders(
      <RevealDialog
        open
        onOpenChange={() => undefined}
        title="Reveal account number"
        endpoint="/vendors/v1/bank-accounts/a1/reveal"
        pick={(r) => r.accountNumber as string}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reveal$/i }));
    expect(await screen.findByText(/at least|required|state why/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/reason for access/i), { target: { value: 'Verify against bank letter' } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: /reveal$/i }));
    expect(await screen.findByTestId('revealed-value')).toHaveTextContent('123456789012');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ reason: 'Verify against bank letter' });

    await act(async () => {
      vi.advanceTimersByTime((REVEAL_SECONDS + 1) * 1000);
    });
    expect(screen.queryByTestId('revealed-value')).toBeNull();
  });
});

describe('lifecycle action availability', () => {
  const base: ActionContext = { status: 'DRAFT', canEdit: true, canApprove: true, isCreator: false, compliant: true, hasPendingTask: false };
  const visible = (ctx: Partial<ActionContext>) =>
    vendorActions({ ...base, ...ctx })
      .filter((a) => a.visible)
      .map((a) => a.action)
      .sort();

  it('offers the right actions for each status', () => {
    expect(visible({ status: 'DRAFT' })).toEqual(['archive', 'submit']);
    expect(visible({ status: 'SUBMITTED' })).toEqual(['start-review', 'withdraw']);
    expect(visible({ status: 'UNDER_REVIEW' })).toEqual(['withdraw']);
    expect(visible({ status: 'APPROVED' })).toEqual(['activate', 'archive', 'suspend']);
    expect(visible({ status: 'ACTIVE' })).toEqual(['archive', 'suspend']);
    expect(visible({ status: 'SUSPENDED' })).toEqual(['archive', 'reactivate']);
    expect(visible({ status: 'REJECTED' })).toEqual(['archive', 'reopen']);
    expect(visible({ status: 'ARCHIVED' })).toEqual([]);
  });

  it('explains why activation is blocked (creator, compliance, permission)', () => {
    const act = (ctx: Partial<ActionContext>) => vendorActions({ ...base, status: 'APPROVED', ...ctx }).find((a) => a.action === 'activate')!;
    expect(act({}).disabledReason).toBeNull();
    expect(act({ isCreator: true }).disabledReason).toMatch(/separation of duties/);
    expect(act({ compliant: false }).disabledReason).toMatch(/documents/);
    expect(act({ canApprove: false }).disabledReason).toMatch(/permission/);
  });

  it('requires reasons for destructive or reversing actions', () => {
    const byAction = Object.fromEntries(vendorActions({ ...base, status: 'ACTIVE' }).map((a) => [a.action, a.requiresReason]));
    expect(byAction.suspend).toBe(true);
    expect(byAction.archive).toBe(true);
    expect(byAction.withdraw).toBe(true);
    expect(byAction.submit).toBe(false);
  });
});

describe('document expiry', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  it('classifies expiry dates', () => {
    expect(documentExpiryState(null, now)).toEqual({ kind: 'none' });
    expect(documentExpiryState('2026-11-15', now)).toEqual({ kind: 'expired', days: 1 });
    expect(documentExpiryState('2026-11-16', now)).toEqual({ kind: 'expiring', days: 0 });
    expect(documentExpiryState('2026-12-16', now)).toEqual({ kind: 'expiring', days: 30 });
    expect(documentExpiryState('2026-12-17', now)).toEqual({ kind: 'valid', days: 31 });
    expect(documentExpiryState('2026-12-17T00:00:00.000Z', now)).toEqual({ kind: 'valid', days: 31 });
  });

  it('labels them for people', () => {
    expect(expiryLabel({ kind: 'expired', days: 3 })).toBe('Expired 3 days ago');
    expect(expiryLabel({ kind: 'expiring', days: 1 })).toBe('Expires in 1 day');
    expect(expiryLabel({ kind: 'expiring', days: 0 })).toBe('Expires today');
  });

  it('renders badges with text, not colour alone', () => {
    const { rerender } = render(<ExpiryBadge expiryDate="2026-11-10" now={now} />);
    expect(screen.getByText('Expired 6 days ago')).toBeInTheDocument();
    rerender(<ExpiryBadge expiryDate={null} now={now} />);
    expect(screen.getByText('No expiry')).toBeInTheDocument();
  });
});
