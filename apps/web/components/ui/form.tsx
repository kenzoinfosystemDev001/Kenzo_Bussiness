import { ChevronDown } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-md border border-border bg-surface px-3 text-base text-fg shadow-sm transition-colors duration-150 placeholder:text-fg-subtle hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/30';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, 'h-9', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'min-h-[72px] py-2', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(control, 'h-9 appearance-none pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
    </div>
  );
});

export function Label({ htmlFor, children, required, className }: { htmlFor?: string; children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('text-sm font-medium text-fg', className)}>
      {children}
      {required && (
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-danger">
      {children}
    </p>
  );
}

interface FormFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }>;
}

/** Wires label, hint and error text to the control with ids and aria attributes. */
export function FormField({ label, hint, error, required, className, children }: FormFieldProps) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {isValidElement(children)
        ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, required })
        : children}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export function Checkbox({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={props.id ?? id}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-border-strong text-primary accent-[rgb(var(--primary))] focus-visible:ring-2 focus-visible:ring-ring"
        {...props}
      />
      <label htmlFor={props.id ?? id} className="text-sm">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </label>
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-subtle">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-white shadow transition-transform duration-150',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
