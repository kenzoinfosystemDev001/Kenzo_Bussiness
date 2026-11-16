import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        'surface-muted': token('surface-muted'),
        border: token('border'),
        'border-strong': token('border-strong'),
        fg: token('fg'),
        'fg-muted': token('fg-muted'),
        'fg-subtle': token('fg-subtle'),
        navy: token('navy'),
        'navy-fg': token('navy-fg'),
        primary: token('primary'),
        'primary-hover': token('primary-hover'),
        'primary-fg': token('primary-fg'),
        'primary-soft': token('primary-soft'),
        success: token('success'),
        'success-soft': token('success-soft'),
        warning: token('warning'),
        'warning-soft': token('warning-soft'),
        danger: token('danger'),
        'danger-hover': token('danger-hover'),
        'danger-soft': token('danger-soft'),
        info: token('info'),
        'info-soft': token('info-soft'),
        ring: token('ring'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['1rem', { lineHeight: '1.5rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 36 58 / 0.04), 0 1px 3px 0 rgb(16 36 58 / 0.06)',
        overlay: '0 12px 32px -8px rgb(16 36 58 / 0.25), 0 4px 8px -4px rgb(16 36 58 / 0.12)',
      },
      transitionDuration: { DEFAULT: '160ms', 150: '150ms', 220: '220ms' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(16px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        'scale-in': { from: { transform: 'scale(0.97)', opacity: '0' }, to: { transform: 'scale(1)', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 160ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
