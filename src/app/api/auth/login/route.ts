import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get('password') as string;

  const correctPassword = process.env.DASHBOARD_PASSWORD;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;

  if (!correctPassword || !sessionSecret) {
    return NextResponse.redirect(new URL('/login?error=1', request.url));
  }

  if (password !== correctPassword) {
    return NextResponse.redirect(new URL('/login?error=1', request.url));
  }

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set('cm_auth', sessionSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
