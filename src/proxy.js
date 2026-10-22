import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/sessionToken';

// Keeps signed-out visitors out of the dashboard and sends signed-in users past the login
// page. This only checks the signed cookie; API routes also check the database, so a
// disabled or deleted user is rejected there immediately.
export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);

  if (pathname === '/' && session) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname.startsWith('/dashboard') && !session) {
    const login = new URL('/', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/dashboard/:path*'],
};
