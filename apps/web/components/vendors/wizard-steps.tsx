'use client';

import {
  BANK_ACCOUNT_TYPES,
  GSTIN_PATTERN,
  GST_REGISTRATION_LABELS,
  GST_REGISTRATION_TYPES,
  INDIAN_STATES,
  VENDOR_CATEGORY_SUGGESTIONS,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
  isValidGstinChecksum,
  stateCodeFor,
  type BankAccountType,
  type GstRegistrationType,
  type VendorType,
} from '@kenzo/shared';
import { CheckCircle2, Eye, EyeOff, Plus, Star, Trash2, XCircle } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, FieldError, FormField, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/cn';
import { changeGstType, gstFieldRules, type ContactDraft, type WizardState } from '@/lib/vendor-wizard';
import { DUPLICATE_REASON_LABELS, OVERRIDE_REASON_MIN, type DuplicateMatch } from '@/lib/vendors';
import { DuplicateList } from './vendor-ui';

export interface StepProps {
  state: WizardState;
  update: (patch: Partial<WizardState>) => void;
  replace: (next: WizardState) => void;
  errors: Record<string, string>;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-md font-semibold text-fg">{title}</h3>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function GstinStatus({ gstin, state }: { gstin: string; state: string }) {
  if (!gstin) return null;
  const g = gstin.toUpperCase();
  if (g.length < 15) return <span className="text-xs text-fg-subtle">{15 - g.length} more characters</span>;
  const shapeOk = GSTIN_PATTERN.test(g);
  const sumOk = shapeOk && isValidGstinChecksum(g);
  const sc = stateCodeFor(state);
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
      {sumOk ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="size-3.5" aria-hidden /> Check digit valid
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-danger">
          <XCircle className="size-3.5" aria-hidden /> {shapeOk ? 'Check digit invalid' : 'Not a valid GSTIN format'}
        </span>
      )}
      {sumOk && (
        <span className="text-fg-subtle">
          State code {g.slice(0, 2)}
          {sc ? (sc === g.slice(0, 2) ? ' matches address' : ` ≠ ${state} (${sc})`) : ''}
        </span>
      )}
    </span>
  );
}

export function IdentityStep({ state, update, replace, errors, categories = [] }: StepProps & { categories?: string[] }) {
  const rules = gstFieldRules(state.gstRegistrationType);
  const listId = useId();
  const suggestions = [...new Set([...categories, ...VENDOR_CATEGORY_SUGGESTIONS])];
  const panFromGstin = state.gstin.length === 15 && GSTIN_PATTERN.test(state.gstin.toUpperCase()) ? state.gstin.slice(2, 12).toUpperCase() : null;
  return (
    <div className="flex flex-col gap-8">
      <Section title="Business identity" description="Use the exact legal name from the registration certificate.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Legal name" required error={errors.legalName} className="sm:col-span-2">
            <Input
              value={state.legalName}
              onChange={(e) => update({ legalName: e.target.value })}
              autoComplete="organization"
              placeholder="e.g. Acme Technologies Private Limited"
            />
          </FormField>
          <FormField label="Trade name" hint="If different from the legal name" error={errors.tradeName}>
            <Input value={state.tradeName} onChange={(e) => update({ tradeName: e.target.value })} />
          </FormField>
          <FormField label="Vendor type" required error={errors.vendorType}>
            <Select value={state.vendorType} onChange={(e) => update({ vendorType: e.target.value as VendorType })}>
              {VENDOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VENDOR_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Category" required hint="Pick a suggestion or type your own" error={errors.category}>
            <Input list={listId} value={state.category} onChange={(e) => update({ category: e.target.value })} />
          </FormField>
          <datalist id={listId}>
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <FormField label="Registration number" hint="CIN / LLPIN / firm registration (optional)" error={errors.registrationNumber}>
            <Input value={state.registrationNumber} onChange={(e) => update({ registrationNumber: e.target.value.toUpperCase() })} className="font-mono" />
          </FormField>
        </div>
      </Section>

      <Section title="Tax registration" description="Fields adapt to the vendor's GST status.">
        <fieldset>
          <legend className="sr-only">GST registration type</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="GST registration type">
            {GST_REGISTRATION_TYPES.map((t) => {
              const on = state.gstRegistrationType === t;
              return (
                <label
                  key={t}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-[border-color,background-color,box-shadow] duration-150',
                    on ? 'border-primary bg-primary-soft ring-2 ring-primary/20' : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="gstRegistrationType"
                    value={t}
                    checked={on}
                    onChange={() => replace(changeGstType(state, t as GstRegistrationType))}
                    className="accent-[rgb(var(--primary))]"
                  />
                  <span className={cn(on ? 'font-medium text-fg' : 'text-fg-muted')}>{GST_REGISTRATION_LABELS[t]}</span>
                </label>
              );
            })}
          </div>
          <FieldError>{errors.gstRegistrationType}</FieldError>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          {rules.showGstin && (
            <div className="flex flex-col gap-1.5 animate-fade-in">
              <FormField label="GSTIN" required={rules.gstinRequired} error={errors.gstin}>
                <Input
                  value={state.gstin}
                  maxLength={15}
                  onChange={(e) => update({ gstin: e.target.value.toUpperCase().replace(/\s/g, '') })}
                  className="font-mono tracking-wide"
                  placeholder="29ABCDE1234F1Z5"
                />
              </FormField>
              {!errors.gstin && <GstinStatus gstin={state.gstin} state={state.state} />}
            </div>
          )}
          {rules.showPan && (
            <div className="flex flex-col gap-1.5 animate-fade-in">
              <FormField label="PAN" required={rules.panRequired} error={errors.pan} hint="Stored encrypted; shown masked after saving">
                <Input
                  value={state.pan}
                  maxLength={10}
                  onChange={(e) => update({ pan: e.target.value.toUpperCase().replace(/\s/g, '') })}
                  className="font-mono tracking-wide"
                  placeholder="ABCDE1234F"
                  autoComplete="off"
                />
              </FormField>
              {panFromGstin && state.pan !== panFromGstin && (
                <button type="button" onClick={() => update({ pan: panFromGstin })} className="self-start text-xs font-medium text-primary hover:underline">
                  Use PAN from GSTIN ({panFromGstin})
                </button>
              )}
            </div>
          )}
          {rules.overseas && (
            <FormField label="Country (ISO code)" required hint="Two letters, e.g. US, SG, DE" error={errors.country}>
              <Input
                value={state.country}
                maxLength={2}
                onChange={(e) => update({ country: e.target.value.toUpperCase() })}
                className="w-24 font-mono uppercase"
              />
            </FormField>
          )}
        </div>
        {rules.overseas && <Alert tone="info">Overseas vendors need an incorporation document instead of PAN/GST, and an overseas (SWIFT) bank account.</Alert>}
        <div className="rounded-md border border-border p-3">
          <Switch
            checked={state.msmeRegistered}
            onCheckedChange={(v) => update({ msmeRegistered: v, msmeNumber: v ? state.msmeNumber : '' })}
            label="MSME (Udyam) registered"
            description="MSME vendors have statutory payment timelines — their certificate is required."
          />
          {state.msmeRegistered && (
            <div className="mt-3 animate-fade-in">
              <FormField label="Udyam registration number" required error={errors.msmeNumber}>
                <Input
                  value={state.msmeNumber}
                  onChange={(e) => update({ msmeNumber: e.target.value.toUpperCase() })}
                  className="font-mono"
                  placeholder="UDYAM-KA-03-0001234"
                />
              </FormField>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

export function AddressStep({ state, update, errors }: StepProps) {
  const overseas = state.gstRegistrationType === 'OVERSEAS';
  const code = stateCodeFor(state.state);
  const setContact = (i: number, patch: Partial<ContactDraft>) =>
    update({ contacts: state.contacts.map((c, j) => (j === i ? { ...c, ...patch } : patch.isPrimary ? { ...c, isPrimary: false } : c)) });
  return (
    <div className="flex flex-col gap-8">
      <Section title="Registered address">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Address line 1" required error={errors.addressLine1} className="sm:col-span-2">
            <Input value={state.addressLine1} onChange={(e) => update({ addressLine1: e.target.value })} autoComplete="address-line1" />
          </FormField>
          <FormField label="Address line 2" error={errors.addressLine2} className="sm:col-span-2">
            <Input value={state.addressLine2} onChange={(e) => update({ addressLine2: e.target.value })} autoComplete="address-line2" />
          </FormField>
          <FormField label="City" required error={errors.city}>
            <Input value={state.city} onChange={(e) => update({ city: e.target.value })} autoComplete="address-level2" />
          </FormField>
          {overseas ? (
            <FormField label="State / region" required error={errors.state}>
              <Input value={state.state} onChange={(e) => update({ state: e.target.value })} />
            </FormField>
          ) : (
            <FormField label="State / UT" required hint={code ? `GST state code ${code}` : 'Determines the GSTIN state code'} error={errors.state}>
              <Select value={state.state} onChange={(e) => update({ state: e.target.value })}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label={overseas ? 'Postal code' : 'PIN code'} required hint={overseas ? undefined : '6 digits'} error={errors.postalCode}>
            <Input
              value={state.postalCode}
              inputMode={overseas ? 'text' : 'numeric'}
              maxLength={overseas ? 20 : 6}
              onChange={(e) => update({ postalCode: overseas ? e.target.value : e.target.value.replace(/\D/g, '') })}
              autoComplete="postal-code"
              className="tabular"
            />
          </FormField>
        </div>
      </Section>
      <Section title="Contact people" description="At least one contact is needed before submission. Mark one as primary.">
        {errors.contacts && <FieldError>{errors.contacts}</FieldError>}
        <ul className="flex flex-col gap-3">
          {state.contacts.map((c, i) => (
            <li
              key={i}
              className={cn('rounded-lg border p-3 transition-colors duration-150', c.isPrimary ? 'border-primary/40 bg-primary-soft/30' : 'border-border')}
            >
              <div className="mb-2 flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <input
                    type="radio"
                    name="primary-contact"
                    checked={c.isPrimary}
                    onChange={() => setContact(i, { isPrimary: true })}
                    className="accent-[rgb(var(--primary))]"
                  />
                  <Star className={cn('size-3.5', c.isPrimary ? 'fill-warning text-warning' : 'text-fg-subtle')} aria-hidden /> Primary contact
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  aria-label={`Remove contact ${i + 1}`}
                  disabled={state.contacts.length === 1}
                  onClick={() => update({ contacts: state.contacts.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Name" required error={errors[`contacts.${i}.name`]}>
                  <Input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} />
                </FormField>
                <FormField label="Designation" error={errors[`contacts.${i}.designation`]}>
                  <Input value={c.designation} onChange={(e) => setContact(i, { designation: e.target.value })} />
                </FormField>
                <FormField label="Email" error={errors[`contacts.${i}.email`]}>
                  <Input type="email" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} />
                </FormField>
                <FormField label="Phone" error={errors[`contacts.${i}.phone`]}>
                  <Input type="tel" value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} placeholder="+91 98450 00000" />
                </FormField>
              </div>
            </li>
          ))}
        </ul>
        {state.contacts.length < 10 && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              update({ contacts: [...state.contacts, { name: '', designation: '', email: '', phone: '', isPrimary: state.contacts.length === 0 }] })
            }
          >
            <Plus aria-hidden /> Add contact
          </Button>
        )}
      </Section>
    </div>
  );
}

export function CommercialStep({ state, update, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-8">
      <Section title="Commercial terms">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Payment terms (days)" required hint="Credit period from invoice date" error={errors.paymentTermsDays}>
            <Input
              inputMode="numeric"
              value={state.paymentTermsDays}
              onChange={(e) => update({ paymentTermsDays: e.target.value.replace(/\D/g, '').slice(0, 3) })}
              className="tabular w-32"
            />
          </FormField>
          <FormField label="Preferred currency" required hint="ISO 4217, e.g. INR, USD" error={errors.preferredCurrency}>
            <Input
              value={state.preferredCurrency}
              maxLength={3}
              onChange={(e) => update({ preferredCurrency: e.target.value.toUpperCase() })}
              className="w-24 font-mono uppercase"
            />
          </FormField>
        </div>
      </Section>
      <Section title="Company channels" description="General company contact details (optional).">
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Website" error={errors.website}>
            <Input value={state.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://" inputMode="url" />
          </FormField>
          <FormField label="Email" error={errors.email}>
            <Input type="email" value={state.email} onChange={(e) => update({ email: e.target.value })} placeholder="accounts@vendor.com" />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <Input type="tel" value={state.phone} onChange={(e) => update({ phone: e.target.value })} />
          </FormField>
        </div>
      </Section>
      <Section title="Internal notes" description="Visible to colleagues only — never shared with the vendor.">
        <FormField label="Notes" error={errors.internalNotes}>
          <Textarea rows={4} value={state.internalNotes} onChange={(e) => update({ internalNotes: e.target.value })} maxLength={4000} />
        </FormField>
      </Section>
    </div>
  );
}

/** Account-number input that never displays the value unless the user holds "show". */
function SecretInput({ value, onChange, label, error, hint }: { value: string; onChange: (v: string) => void; label: string; error?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <FormField label={label} required error={error} hint={hint}>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, ''))}
          autoComplete="off"
          spellCheck={false}
          className="pr-10 font-mono tracking-wider"
          onBlur={() => setShow(false)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-fg"
          aria-label={show ? 'Hide account number' : 'Show account number while held'}
          onPointerDown={() => setShow(true)}
          onPointerUp={() => setShow(false)}
          onPointerLeave={() => setShow(false)}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </FormField>
  );
}

export function BankFields({
  bank,
  onChange,
  errors,
  prefix = 'bankAccount',
  overseasOnly = false,
}: {
  bank: WizardState['bank'];
  onChange: (b: WizardState['bank']) => void;
  errors: Record<string, string>;
  prefix?: string;
  overseasOnly?: boolean;
}) {
  const overseas = bank.accountType === 'OVERSEAS';
  const e = (k: string) => errors[prefix ? `${prefix}.${k}` : k];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Account holder name" required hint="Exactly as on the bank record" error={e('accountHolderName')}>
        <Input value={bank.accountHolderName} onChange={(ev) => onChange({ ...bank, accountHolderName: ev.target.value })} />
      </FormField>
      <FormField label="Account type" required error={e('accountType')}>
        <Select value={bank.accountType} onChange={(ev) => onChange({ ...bank, accountType: ev.target.value as BankAccountType })} disabled={overseasOnly}>
          {BANK_ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'CASH_CREDIT' ? 'Cash credit' : t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Bank name" required error={e('bankName')}>
        <Input value={bank.bankName} onChange={(ev) => onChange({ ...bank, bankName: ev.target.value })} />
      </FormField>
      <FormField label="Branch" error={e('branchName')}>
        <Input value={bank.branchName} onChange={(ev) => onChange({ ...bank, branchName: ev.target.value })} />
      </FormField>
      {overseas ? (
        <FormField label="SWIFT / BIC" required error={e('swiftCode')}>
          <Input
            value={bank.swiftCode}
            maxLength={11}
            onChange={(ev) => onChange({ ...bank, swiftCode: ev.target.value.toUpperCase() })}
            className="font-mono"
          />
        </FormField>
      ) : (
        <FormField label="IFSC" required hint="11 characters, e.g. HDFC0001234" error={e('ifsc')}>
          <Input value={bank.ifsc} maxLength={11} onChange={(ev) => onChange({ ...bank, ifsc: ev.target.value.toUpperCase() })} className="font-mono" />
        </FormField>
      )}
      <div className="hidden sm:block" />
      <SecretInput
        label={overseas ? 'IBAN / account number' : 'Account number'}
        value={bank.accountNumber}
        onChange={(v) => onChange({ ...bank, accountNumber: v })}
        error={e('accountNumber')}
        hint={overseas ? undefined : '9–18 digits'}
      />
      <SecretInput
        label="Confirm account number"
        value={bank.confirmAccountNumber}
        onChange={(v) => onChange({ ...bank, confirmAccountNumber: v })}
        error={e('confirmAccountNumber')}
      />
    </div>
  );
}

export function BankStep({ state, update, errors }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Bank details"
        description="Optional now — you can add them later. They are encrypted, masked everywhere, and must be verified by an independent approver before any payment."
      >
        <Checkbox
          label="Add bank details now"
          description="Requires a bank verification document (cancelled cheque or bank letter) before submission."
          checked={state.includeBank}
          onChange={(ev) => update({ includeBank: ev.target.checked })}
        />
        {state.includeBank && (
          <div className="animate-fade-in">
            <BankFields bank={state.bank} onChange={(bank) => update({ bank })} errors={errors} overseasOnly={state.gstRegistrationType === 'OVERSEAS'} />
            <p className="mt-3 text-xs text-fg-subtle">Bank details are never saved in your browser draft — re-enter them if you leave this page.</p>
          </div>
        )}
      </Section>
    </div>
  );
}

/** Duplicate results and the mandatory override reason for strong matches. */
export function DuplicateReview({
  matches,
  loading,
  overrideReason,
  onOverrideReason,
  error,
}: {
  matches: DuplicateMatch[];
  loading: boolean;
  overrideReason: string;
  onOverrideReason: (v: string) => void;
  error?: string | null;
}) {
  const strong = matches.filter((m) => m.strong);
  if (loading) return <p className="text-sm text-fg-muted">Checking for existing vendors…</p>;
  if (matches.length === 0)
    return (
      <Alert tone="success" title="No duplicates found">
        No existing vendor shares this name, GSTIN, PAN or bank account.
      </Alert>
    );
  return (
    <div className="flex flex-col gap-3">
      <Alert
        tone={strong.length ? 'danger' : 'warning'}
        title={strong.length ? `${strong.length} likely duplicate${strong.length > 1 ? 's' : ''} found` : 'Similar vendors found'}
      >
        {strong.length
          ? 'A vendor with the same identity already exists. Vendors are never merged automatically — confirm this is genuinely a different vendor and record why.'
          : 'These look similar but are not conclusive. Check before continuing.'}
      </Alert>
      <DuplicateList matches={matches} />
      {strong.length > 0 && (
        <FormField
          label="Why is this a different vendor?"
          required
          hint={`Recorded in the audit trail (at least ${OVERRIDE_REASON_MIN} characters).`}
          error={error}
        >
          <Textarea
            value={overrideReason}
            onChange={(e) => onOverrideReason(e.target.value)}
            maxLength={1000}
            placeholder="e.g. Separate legal entity with its own GSTIN for the Pune branch"
          />
        </FormField>
      )}
      <p className="text-xs text-fg-subtle">Match reasons: {Object.values(DUPLICATE_REASON_LABELS).join(' · ')}</p>
    </div>
  );
}

export function SummaryRow({ label, value, badge }: { label: string; value: ReactNode; badge?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right text-fg">
        {value || <span className="text-fg-subtle">—</span>}
        {badge && <Badge className="ml-2">{badge}</Badge>}
      </dd>
    </div>
  );
}
