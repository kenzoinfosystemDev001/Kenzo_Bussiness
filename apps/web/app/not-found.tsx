import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="text-xl font-semibold text-fg">Page not found</h1>
      <p className="max-w-sm text-sm text-fg-muted">The page you are looking for does not exist or you do not have access to it.</p>
      <Link href="/overview" className="mt-2 text-sm font-medium text-primary hover:underline">
        Back to overview
      </Link>
    </main>
  );
}
