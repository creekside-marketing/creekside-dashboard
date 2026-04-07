import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const authCookie = request.cookies.get('cm_auth')?.value;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

  if (!sessionSecret || authCookie !== sessionSecret) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!report|api|login|tools|roas-calculator|_next|favicon\\.ico).*)'],
};
