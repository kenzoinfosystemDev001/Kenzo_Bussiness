'use client';

import { VENDOR_DOCUMENT_LABELS, VENDOR_DOCUMENT_TYPES, vendorDocumentMetaSchema, type VendorDocumentType } from '@kenzo/shared';
import { useMutation } from '@tanstack/react-query';
import { Check, Download, FileUp, UploadCloud, X } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { FormField, Input, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { errorMessage, get, post, uploadFile } from '@/lib/api';
import { cn } from '@/lib/cn';
import { serverFieldErrors, validate } from '@/lib/forms';
import { formatBytes } from '@/lib/vendors';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv';
const MAX_BYTES = 15 * 1024 * 1024;

/** Downloads through a short-lived signed URL; never exposes storage locations. */
export function useDocumentDownload() {
  const toast = useToast();
  return useMutation({
    mutationFn: (documentId: string) => get<{ url: string; expiresAt: string }>(`/documents/${documentId}/download-url`),
    onSuccess: (r) => {
      const a = document.createElement('a');
      a.href = r.url;
      a.rel = 'noopener';
      a.target = '_blank';
      a.click();
    },
    onError: (e) => toast.error('Download unavailable', errorMessage(e)),
  });
}

export function DownloadButton({ documentId, label = 'Download' }: { documentId: string; label?: string }) {
  const dl = useDocumentDownload();
  return (
    <Button variant="ghost" size="sm" onClick={() => dl.mutate(documentId)} loading={dl.isPending} aria-label={label}>
      <Download aria-hidden /> <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

interface UploadProps {
  vendorId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultType?: VendorDocumentType;
  onUploaded: () => Promise<void>;
}

export function UploadDocumentDrawer({ vendorId, open, onOpenChange, defaultType = 'GST_CERTIFICATE', onUploaded }: UploadProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [meta, setMeta] = useState({
    documentType: defaultType as string,
    title: VENDOR_DOCUMENT_LABELS[defaultType],
    documentNumber: '',
    issueDate: '',
    expiryDate: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: () => uploadFile(`/vendors/${vendorId}/documents`, file!, Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== ''))),
    onSuccess: async () => {
      toast.success('Document uploaded', 'It now awaits independent verification.');
      onOpenChange(false);
      await onUploaded();
    },
    onError: (e) => setErrors({ ...serverFieldErrors(e), form: errorMessage(e) }),
  });

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > MAX_BYTES) return setErrors({ file: `File is ${formatBytes(f.size)} — the limit is 15 MB` });
    setErrors({});
    setFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(vendorDocumentMetaSchema, meta);
    const errs = { ...(v.errors ?? {}), ...(file ? {} : { file: 'Choose a file to upload' }) };
    setErrors(errs);
    if (Object.keys(errs).length === 0) m.mutate();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Upload document"
      description="PDF, image or Office files up to 15 MB. Content is checked against the file type; storage is private."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="doc-upload" loading={m.isPending}>
            <FileUp aria-hidden /> Upload
          </Button>
        </>
      }
    >
      <form id="doc-upload" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a file or drop it here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' ? inputRef.current?.click() : undefined)}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-[border-color,background-color] duration-150',
            drag
              ? 'border-primary bg-primary-soft'
              : errors.file
                ? 'border-danger/50 bg-danger-soft/40'
                : 'border-border-strong hover:border-primary/60 hover:bg-surface-muted/50',
          )}
        >
          <UploadCloud className={cn('size-8 transition-transform duration-200', drag ? 'scale-110 text-primary' : 'text-fg-subtle')} aria-hidden />
          {file ? (
            <p className="text-sm">
              <span className="font-medium text-fg">{file.name}</span> <span className="text-fg-subtle">· {formatBytes(file.size)}</span>
            </p>
          ) : (
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-primary">Choose a file</span> or drag it here
            </p>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} tabIndex={-1} />
        </div>
        {errors.file && <p className="text-xs text-danger">{errors.file}</p>}
        <FormField label="Document type" required error={errors.documentType}>
          <Select
            value={meta.documentType}
            onChange={(e) => {
              const t = e.target.value as VendorDocumentType;
              setMeta((m0) => ({
                ...m0,
                documentType: t,
                title: Object.values(VENDOR_DOCUMENT_LABELS).includes(m0.title) || !m0.title ? VENDOR_DOCUMENT_LABELS[t] : m0.title,
              }));
            }}
          >
            {VENDOR_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {VENDOR_DOCUMENT_LABELS[t]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Title" required error={errors.title}>
          <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
        </FormField>
        <FormField label="Document number" error={errors.documentNumber}>
          <Input value={meta.documentNumber} onChange={(e) => setMeta({ ...meta, documentNumber: e.target.value.toUpperCase() })} className="font-mono" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Issue date" error={errors.issueDate}>
            <Input type="date" value={meta.issueDate} onChange={(e) => setMeta({ ...meta, issueDate: e.target.value })} />
          </FormField>
          <FormField label="Expiry date" hint="Leave blank if it does not expire" error={errors.expiryDate}>
            <Input type="date" value={meta.expiryDate} onChange={(e) => setMeta({ ...meta, expiryDate: e.target.value })} />
          </FormField>
        </div>
        <p className="text-xs text-fg-subtle">
          Uploading a GST, PAN, incorporation, bank or MSME document replaces the current version; earlier versions stay in history.
        </p>
      </form>
    </Drawer>
  );
}

/** Inline verify/reject for a vendor document. The uploader cannot verify their own upload (enforced by the API). */
export function VerifyControls({
  vendorId,
  vendorDocumentId,
  onDone,
  size = 'sm',
}: {
  vendorId: string;
  vendorDocumentId: string;
  onDone: () => Promise<void>;
  size?: 'sm' | 'md';
}) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: { decision: 'VERIFIED' | 'REJECTED'; note?: string }) => post(`/vendors/${vendorId}/documents/${vendorDocumentId}/verify`, body),
    onSuccess: async (_d, vars) => {
      toast.success(vars.decision === 'VERIFIED' ? 'Document verified' : 'Document rejected');
      setRejecting(false);
      setNote('');
      await onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (rejecting) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return setError('Explain why the document is rejected');
          setError(null);
          m.mutate({ decision: 'REJECTED', note: note.trim() });
        }}
        className="flex w-full flex-col gap-2 animate-fade-in"
      >
        <Textarea
          aria-label="Rejection reason"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What is wrong with this document?"
          autoFocus
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm" loading={m.isPending}>
            Reject document
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button size={size} variant="secondary" onClick={() => setRejecting(true)}>
          <X aria-hidden /> Reject
        </Button>
        <Button size={size} onClick={() => m.mutate({ decision: 'VERIFIED' })} loading={m.isPending}>
          <Check aria-hidden /> Verify
        </Button>
      </div>
      {error && <p className="max-w-xs text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
