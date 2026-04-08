import { NextRequest, NextResponse } from 'next/server';

function getBaseUrl(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return request.url;
}

export function middleware(request: NextRequest) {
  const authCookie = request.cookies.get('cm_auth')?.value;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

  if (!sessionSecret || authCookie !== sessionSecret) {
    const loginUrl = new URL('/login', getBaseUrl(request));
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!report|api|login|tools|roas-calculator|_next|favicon\\.ico).*)'],
};
