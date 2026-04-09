/**
 * GET /api/meta/bulk-insights
 *
 * Fetches account-level insights for ALL Meta ad accounts in a single PipeBoard call.
 * Returns spend, conversions, and conversion breakdown per account_id.
 *
 * Query params:
 *   account_ids - comma-separated list of Meta ad account IDs (with act_ prefix)
 *   time_range - preset time range (default: last_30d)
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const accountIdsParam = searchParams.get('account_ids');
    const timeRange = searchParams.get('time_range') || 'last_30d';

    if (!accountIdsParam) {
      return NextResponse.json({ error: 'Missing account_ids' }, { status: 400 });
    }

    const accountIds = accountIdsParam.split(',').filter(id => id.trim());
    if (accountIds.length === 0) {
      return NextResponse.json({ error: 'No valid account IDs' }, { status: 400 });
    }

    const result = await callPipeboard('bulk_get_insights', {
      level: 'account',
      account_ids: accountIds,
      time_range: timeRange,
      limit: 50,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not configured') ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
