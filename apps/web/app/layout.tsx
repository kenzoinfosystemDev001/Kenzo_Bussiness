import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Kenzo-Kore BusinessOS', template: '%s · Kenzo-Kore BusinessOS' },
  description: 'Vendor, procurement, billing, payments and approvals for Kenzo Infosystems.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F9FC' },
    { media: '(prefers-color-scheme: dark)', color: '#080F1A' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" className={inter.variable} suppressHydrationWarning>
      <body>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
