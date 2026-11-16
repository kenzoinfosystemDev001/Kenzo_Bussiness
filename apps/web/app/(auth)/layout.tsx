import type { ReactNode } from 'react';

/** Minimal, focused layout for sign-in and account-recovery screens. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(480px,560px)]">
      <aside className="relative hidden flex-col justify-between bg-navy p-10 text-navy-fg lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-white">K</span>
          <span className="leading-tight">
            <span className="block text-base font-semibold text-white">Kenzo-Kore</span>
            <span className="block text-xs uppercase tracking-wider text-navy-fg/70">BusinessOS</span>
          </span>
        </div>
        <div className="max-w-md">
          <p className="text-2xl font-semibold leading-snug text-white">One traceable record from requisition to payment.</p>
          <ul className="mt-6 flex flex-col gap-2.5 text-sm text-navy-fg/80">
            <li>Policy-driven approvals with separation of duties</li>
            <li>Company-scoped access with a complete audit trail</li>
            <li>Vendors, procurement, billing and payments in one place</li>
          </ul>
        </div>
        <p className="text-xs text-navy-fg/50">Kenzo Infosystems Pvt. Ltd. · Internal system — authorised use only</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
