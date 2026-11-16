'use client';

import {
  GST_REGISTRATION_LABELS,
  GST_REGISTRATION_TYPES,
  INDIAN_STATES,
  VENDOR_TYPES,
  VENDOR_TYPE_LABELS,
  type GstRegistrationType,
  type VendorType,
} from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { FormField, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { errorMessage, isApiError, patch } from '@/lib/api';
import { serverFieldErrors } from '@/lib/forms';
import type { VendorRecord } from '@/lib/vendors';

/** Fields the API locks once a vendor has been approved (legal & tax identity). */
export const IDENTITY_FIELDS = ['legalName', 'gstRegistrationType', 'gstin', 'pan', 'registrationNumber', 'msmeRegistered', 'msmeNumber', 'country'] as const;

type Form = {
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
  website: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  paymentTermsDays: string;
  preferredCurrency: string;
  internalNotes: string;
};

function fromVendor(v: VendorRecord): Form {
  return {
    legalName: v.legalName,
    tradeName: v.tradeName ?? '',
    vendorType: v.vendorType,
    category: v.category,
    gstRegistrationType: v.gstRegistrationType,
    gstin: v.gstin ?? '',
    pan: '',
    registrationNumber: v.registrationNumber ?? '',
    msmeRegistered: v.msmeRegistered,
    msmeNumber: v.msmeNumber ?? '',
    website: v.website ?? '',
    email: v.email ?? '',
    phone: v.phone ?? '',
    addressLine1: v.addressLine1,
    addressLine2: v.addressLine2 ?? '',
    city: v.city,
    state: v.state,
    postalCode: v.postalCode,
    country: v.country,
    paymentTermsDays: String(v.paymentTermsDays),
    preferredCurrency: v.preferredCurrency,
    internalNotes: v.internalNotes ?? '',
  };
}

export function EditVendorDrawer({ vendor, onClose, onSaved }: { vendor: VendorRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const identityLocked = !['DRAFT', 'REJECTED'].includes(vendor.status);
  const initial = fromVendor(vendor);
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const locked = (k: string) => identityLocked && (IDENTITY_FIELDS as readonly string[]).includes(k);

  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/vendors/${vendor.id}`, body),
    onSuccess: async () => {
      toast.success('Vendor updated');
      onClose();
      await onSaved();
    },
    onError: (e) => {
      const lockedFields = isApiError(e) && Array.isArray(e.details?.lockedFields) ? (e.details.lockedFields as string[]) : [];
      setErrors({ ...serverFieldErrors(e), ...Object.fromEntries(lockedFields.map((f) => [f, 'Locked after approval'])), form: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changes: Record<string, unknown> = {};
    (Object.keys(form) as Array<keyof Form>).forEach((k) => {
      if (k === 'pan') {
        if (form.pan.trim()) changes.pan = form.pan.trim();
        return;
      }
      if (form[k] === initial[k]) return;
      if (locked(k)) return;
      const v = form[k];
      changes[k] = k === 'paymentTermsDays' ? Number(v) : typeof v === 'string' ? v.trim() || null : v;
    });
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    if (changes.paymentTermsDays !== undefined && !Number.isInteger(changes.paymentTermsDays)) return setErrors({ paymentTermsDays: 'Enter whole days' });
    setErrors({});
    m.mutate({ ...changes, version: vendor.version });
  };

  const lbl = (k: string, children: ReactNode) => (
    <span className="inline-flex items-center gap-1">
      {children}
      {locked(k) && <Lock className="size-3 text-fg-subtle" aria-label="Locked after approval" />}
    </span>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width="lg"
      title="Edit vendor profile"
      description={
        identityLocked
          ? 'Legal and tax identity fields are locked after approval. Contact an administrator or raise a new vendor to change them.'
          : 'Changes are audited.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-vendor" loading={m.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-vendor" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={lbl('legalName', 'Legal name')} required error={errors.legalName} className="sm:col-span-2">
            <Input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} disabled={locked('legalName')} />
          </FormField>
          <FormField label="Trade name" error={errors.tradeName}>
            <Input value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} />
          </FormField>
          <FormField label="Vendor type" error={errors.vendorType}>
            <Select value={form.vendorType} onChange={(e) => set('vendorType', e.target.value as VendorType)}>
              {VENDOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VENDOR_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Category" required error={errors.category}>
            <Input value={form.category} onChange={(e) => set('category', e.target.value)} />
          </FormField>
          <FormField label={lbl('gstRegistrationType', 'GST registration')} error={errors.gstRegistrationType}>
            <Select
              value={form.gstRegistrationType}
              onChange={(e) => set('gstRegistrationType', e.target.value as GstRegistrationType)}
              disabled={locked('gstRegistrationType')}
            >
              {GST_REGISTRATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {GST_REGISTRATION_LABELS[t]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={lbl('gstin', 'GSTIN')} error={errors.gstin}>
            <Input
              value={form.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase())}
              disabled={locked('gstin')}
              className="font-mono"
              maxLength={15}
            />
          </FormField>
          <FormField
            label={lbl('pan', 'New PAN')}
            hint={locked('pan') ? undefined : `Current: ${vendor.panMasked ?? 'none'} — leave blank to keep`}
            error={errors.pan}
          >
            <Input
              value={form.pan}
              onChange={(e) => set('pan', e.target.value.toUpperCase())}
              disabled={locked('pan')}
              className="font-mono"
              maxLength={10}
              autoComplete="off"
            />
          </FormField>
          <FormField label={lbl('registrationNumber', 'Registration number')} error={errors.registrationNumber}>
            <Input
              value={form.registrationNumber}
              onChange={(e) => set('registrationNumber', e.target.value.toUpperCase())}
              disabled={locked('registrationNumber')}
              className="font-mono"
            />
          </FormField>
        </div>
        <div className="rounded-md border border-border p-3">
          <Switch
            checked={form.msmeRegistered}
            onCheckedChange={(v) => set('msmeRegistered', v)}
            disabled={locked('msmeRegistered')}
            label="MSME (Udyam) registered"
          />
          {form.msmeRegistered && (
            <FormField label={lbl('msmeNumber', 'Udyam number')} error={errors.msmeNumber} className="mt-3">
              <Input
                value={form.msmeNumber}
                onChange={(e) => set('msmeNumber', e.target.value.toUpperCase())}
                disabled={locked('msmeNumber')}
                className="font-mono"
              />
            </FormField>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Address line 1" required error={errors.addressLine1} className="sm:col-span-2">
            <Input value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
          </FormField>
          <FormField label="Address line 2" error={errors.addressLine2} className="sm:col-span-2">
            <Input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} />
          </FormField>
          <FormField label="City" required error={errors.city}>
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="State" required error={errors.state}>
            {form.gstRegistrationType === 'OVERSEAS' ? (
              <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
            ) : (
              <Select value={form.state} onChange={(e) => set('state', e.target.value)}>
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Postal code" required error={errors.postalCode}>
            <Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
          </FormField>
          <FormField label="Payment terms (days)" error={errors.paymentTermsDays}>
            <Input inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value.replace(/\D/g, ''))} />
          </FormField>
          <FormField label="Website" error={errors.website}>
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} />
          </FormField>
          <FormField label="Email" error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </FormField>
          <FormField label="Phone" error={errors.phone}>
            <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </FormField>
          <FormField label="Currency" error={errors.preferredCurrency}>
            <Input
              value={form.preferredCurrency}
              onChange={(e) => set('preferredCurrency', e.target.value.toUpperCase())}
              maxLength={3}
              className="w-24 font-mono"
            />
          </FormField>
        </div>
        <FormField label="Internal notes" error={errors.internalNotes}>
          <Textarea rows={3} value={form.internalNotes} onChange={(e) => set('internalNotes', e.target.value)} />
        </FormField>
      </form>
    </Drawer>
  );
}
