import { NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';

export async function GET() {
  try {
    const result = await callPipeboard('get_ad_accounts');

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not configured') ? 500 : 502;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
