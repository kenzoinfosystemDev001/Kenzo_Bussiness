import { createVendorSchema, stateCodeFor, type BankAccountType, type GstRegistrationType, type VendorType } from '@kenzo/shared';
import { validate } from './forms';

export interface ContactDraft {
  name: string;
  designation: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

export interface BankDraft {
  accountHolderName: string;
  bankName: string;
  branchName: string;
  accountType: BankAccountType;
  ifsc: string;
  swiftCode: string;
  accountNumber: string;
  confirmAccountNumber: string;
}

export interface WizardState {
  legalName: string;
  tradeName: string;
  vendorType: VendorType;
  category: string;
  gstRegistrationType: GstRegistrationType;
  gstin: string;
  pan: string;
  registrationNumber: string;
  msmeRegistered: boolean;
  msmeNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  contacts: ContactDraft[];
  paymentTermsDays: string;
  preferredCurrency: string;
  website: string;
  email: string;
  phone: string;
  internalNotes: string;
  includeBank: boolean;
  bank: BankDraft;
}

export const EMPTY_BANK: BankDraft = {
  accountHolderName: '',
  bankName: '',
  branchName: '',
  accountType: 'CURRENT',
  ifsc: '',
  swiftCode: '',
  accountNumber: '',
  confirmAccountNumber: '',
};

export const INITIAL_WIZARD: WizardState = {
  legalName: '',
  tradeName: '',
  vendorType: 'GOODS_SUPPLIER',
  category: '',
  gstRegistrationType: 'REGISTERED',
  gstin: '',
  pan: '',
  registrationNumber: '',
  msmeRegistered: false,
  msmeNumber: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'IN',
  contacts: [{ name: '', designation: '', email: '', phone: '', isPrimary: true }],
  paymentTermsDays: '30',
  preferredCurrency: 'INR',
  website: '',
  email: '',
  phone: '',
  internalNotes: '',
  includeBank: false,
  bank: EMPTY_BANK,
};

export const WIZARD_STEPS = [
  { key: 'identity', label: 'Business identity', description: 'Legal name, type and tax registration' },
  { key: 'address', label: 'Address & contacts', description: 'Registered address and people' },
  { key: 'commercial', label: 'Commercial terms', description: 'Payment terms and channels' },
  { key: 'bank', label: 'Bank details', description: 'Optional — verified by maker-checker' },
  { key: 'review', label: 'Review & check', description: 'Duplicate check and create draft' },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]['key'];

const STEP_FIELDS: Record<Exclude<WizardStepKey, 'review'>, string[]> = {
  identity: [
    'legalName',
    'tradeName',
    'vendorType',
    'category',
    'gstRegistrationType',
    'gstin',
    'pan',
    'registrationNumber',
    'msmeRegistered',
    'msmeNumber',
    'country',
  ],
  address: ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'contacts'],
  commercial: ['paymentTermsDays', 'preferredCurrency', 'website', 'email', 'phone', 'internalNotes'],
  bank: ['bankAccount'],
};

/** Index of the step that owns a field path (server or client error). */
export function stepForPath(path: string): number {
  const root = path.split('.')[0] ?? '';
  const idx = WIZARD_STEPS.findIndex((s) => s.key !== 'review' && STEP_FIELDS[s.key].includes(root));
  return idx === -1 ? WIZARD_STEPS.length - 1 : idx;
}

export interface GstFieldRules {
  showGstin: boolean;
  gstinRequired: boolean;
  showPan: boolean;
  panRequired: boolean;
  overseas: boolean;
}

/** Which tax fields apply to a GST registration type (mirrors vendorProfileIssues on the server). */
export function gstFieldRules(type: GstRegistrationType): GstFieldRules {
  const gst = type === 'REGISTERED' || type === 'COMPOSITION' || type === 'SEZ';
  const overseas = type === 'OVERSEAS';
  return { showGstin: gst, gstinRequired: gst, showPan: !overseas, panRequired: !overseas, overseas };
}

/** Applies a registration-type change, clearing fields that no longer apply. */
export function changeGstType(state: WizardState, type: GstRegistrationType): WizardState {
  const rules = gstFieldRules(type);
  return {
    ...state,
    gstRegistrationType: type,
    gstin: rules.showGstin ? state.gstin : '',
    pan: rules.showPan ? state.pan : '',
    country: rules.overseas ? (state.country === 'IN' ? '' : state.country) : 'IN',
    state: rules.overseas ? state.state : stateCodeFor(state.state) ? state.state : '',
    bank: rules.overseas
      ? { ...state.bank, accountType: 'OVERSEAS' }
      : state.bank.accountType === 'OVERSEAS'
        ? { ...state.bank, accountType: 'CURRENT' }
        : state.bank,
  };
}

/** The request body for POST /vendors (shape of createVendorSchema input). */
export function toCreatePayload(s: WizardState, duplicateOverrideReason?: string) {
  const contacts = s.contacts
    .filter((c) => c.name.trim() || c.email.trim() || c.phone.trim())
    .map((c) => ({ name: c.name, designation: c.designation || null, email: c.email || null, phone: c.phone || null, isPrimary: c.isPrimary }));
  return {
    legalName: s.legalName,
    tradeName: s.tradeName || null,
    vendorType: s.vendorType,
    category: s.category,
    gstRegistrationType: s.gstRegistrationType,
    gstin: s.gstin || null,
    pan: s.pan || null,
    registrationNumber: s.registrationNumber || null,
    msmeRegistered: s.msmeRegistered,
    msmeNumber: s.msmeRegistered ? s.msmeNumber || null : null,
    website: s.website || null,
    email: s.email || null,
    phone: s.phone || null,
    addressLine1: s.addressLine1,
    addressLine2: s.addressLine2 || null,
    city: s.city,
    state: s.state,
    postalCode: s.postalCode,
    country: s.country || 'IN',
    paymentTermsDays: s.paymentTermsDays.trim() === '' ? Number.NaN : Number(s.paymentTermsDays),
    preferredCurrency: s.preferredCurrency,
    internalNotes: s.internalNotes || null,
    contacts,
    bankAccount: s.includeBank
      ? {
          accountHolderName: s.bank.accountHolderName,
          bankName: s.bank.bankName,
          branchName: s.bank.branchName || null,
          accountType: s.bank.accountType,
          ifsc: s.bank.accountType === 'OVERSEAS' ? null : s.bank.ifsc || null,
          swiftCode: s.bank.accountType === 'OVERSEAS' ? s.bank.swiftCode || null : null,
          accountNumber: s.bank.accountNumber,
          confirmAccountNumber: s.bank.confirmAccountNumber,
        }
      : null,
    ...(duplicateOverrideReason ? { duplicateOverrideReason } : {}),
  };
}

/** Full client-side validation with the shared schema (incl. GSTIN checksum, PAN/GSTIN match, PIN). */
export function validateWizard(s: WizardState): Record<string, string> {
  const v = validate(createVendorSchema, toCreatePayload(s));
  const errors = v.errors ?? {};
  if (s.contacts.length && !s.contacts.some((c) => c.name.trim())) errors['contacts'] ??= 'Add at least one contact person';
  if (!/^\d+$/.test(s.paymentTermsDays.trim())) errors['paymentTermsDays'] = 'Enter whole days, e.g. 30';
  return errors;
}

export function errorsForStep(errors: Record<string, string>, step: number): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([path]) => stepForPath(path) === step));
}

/** Draft persisted to sessionStorage — bank details are NEVER stored. */
export function persistableDraft(s: WizardState): Omit<WizardState, 'bank'> & { bank: BankDraft } {
  return { ...s, includeBank: false, bank: EMPTY_BANK };
}

export const WIZARD_STORAGE_KEY = 'kk-vendor-wizard-draft';

export function loadDraft(): WizardState | null {
  try {
    const raw = window.sessionStorage.getItem(WIZARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    return { ...INITIAL_WIZARD, ...parsed, bank: EMPTY_BANK, includeBank: false };
  } catch {
    return null;
  }
}

export function saveDraft(s: WizardState): void {
  try {
    window.sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(persistableDraft(s)));
  } catch {
    /* storage unavailable */
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(WIZARD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isPristine(s: WizardState): boolean {
  return JSON.stringify(persistableDraft(s)) === JSON.stringify(persistableDraft(INITIAL_WIZARD));
}
