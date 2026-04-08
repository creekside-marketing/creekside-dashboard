import { NextRequest, NextResponse } from 'next/server';

function getBaseUrl(request: NextRequest): string {
  // Use X-Forwarded headers from Railway/proxy, fall back to request.url
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return request.url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get('password') as string;
  const baseUrl = getBaseUrl(request);

  const correctPassword = process.env.DASHBOARD_PASSWORD;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

  if (!correctPassword || !sessionSecret) {
    return NextResponse.redirect(new URL('/login?error=1', baseUrl));
  }

  if (password !== correctPassword) {
    return NextResponse.redirect(new URL('/login?error=1', baseUrl));
  }

  const response = NextResponse.redirect(new URL('/', baseUrl));
  response.cookies.set('cm_auth', sessionSecret, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
