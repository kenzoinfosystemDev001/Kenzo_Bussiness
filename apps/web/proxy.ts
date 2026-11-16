import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-only redirect (Next 16 "proxy", formerly middleware): visitors without a
 * session cookie are sent to /login before the workspace renders. This is NOT
 * a security boundary — every API call is authenticated and authorised by the
 * backend, and a forged cookie gets nothing but 401s.
 */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/accept-invitation'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.has('kk_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|theme-init.js|robots.txt).*)'],
};
