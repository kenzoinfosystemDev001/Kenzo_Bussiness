import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-canvas active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-fg shadow-sm hover:bg-surface-muted',
        ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        danger: 'bg-danger text-white shadow-sm hover:bg-danger-hover',
        'danger-outline': 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-2.5 text-sm',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-4 text-base',
        icon: 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, disabled, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
