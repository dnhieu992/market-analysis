import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'market_analysis_session';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isLoginRoute = pathname === '/login';
  const isStaticAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api');

  if (isStaticAsset) {
    return NextResponse.next();
  }

  if (isLoginRoute) {
    if (hasSession) {
      return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
  }

  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
