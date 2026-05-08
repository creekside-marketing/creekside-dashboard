/**
 * GET /api/meta/bulk-insights
 *
 * Fetches account-level insights for ALL Meta ad accounts in a single PipeBoard call.
 * Returns spend, conversions, and conversion breakdown per account_id.
 *
 * Resilience: On PipeBoard failure, falls back to meta_account_insights_cache in Supabase.
 * On PipeBoard success, writes results to cache for next time.
 *
 * Query params:
 *   account_ids - comma-separated list of Meta ad account IDs (with act_ prefix)
 *   time_range - preset time range (default: last_30d)
 */

import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { createServiceClient } from '@/lib/supabase';

interface PipeboardAccountResult {
  account_id: string;
  account_name?: string;
  status: string;
  insights?: {
    spend?: number;
    conversions?: number;
    purchase_conversions?: number;
    roas?: number;
    [key: string]: unknown;
  };
}

interface PipeboardBulkResponse {
  results?: PipeboardAccountResult[];
  [key: string]: unknown;
}

/** Write successful PipeBoard results to cache (fire-and-forget). */
function updateCache(results: PipeboardAccountResult[], timeRange: string) {
  const supabase = createServiceClient();
  const rows = results
    .filter(r => r.status === 'success' && r.insights)
    .map(r => ({
      account_id: r.account_id,
      account_name: r.account_name ?? null,
      spend: Number(r.insights!.spend ?? 0),
      conversions: Number(r.insights!.conversions ?? 0),
      purchase_conversions: Number(r.insights!.purchase_conversions ?? 0),
      roas: r.insights!.roas != null ? Number(r.insights!.roas) : null,
      time_range: timeRange,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return;

  supabase
    .from('meta_account_insights_cache')
    .upsert(rows, { onConflict: 'account_id' })
    .then(({ error }) => {
      if (error) console.error('Cache write failed:', error.message);
    });
}

/** Read cached insights for the requested account IDs. */
async function readCache(accountIds: string[]): Promise<NextResponse> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('meta_account_insights_cache')
    .select('*')
    .in('account_id', accountIds);

  if (error || !data || data.length === 0) {
    return NextResponse.json(
      { error: 'PipeBoard unavailable and no cached data', source: 'none' },
      { status: 502 },
    );
  }

  // Reshape cache rows into PipeBoard-compatible response format
  const results = data.map(row => ({
    account_id: row.account_id,
    account_name: row.account_name,
    status: 'success' as const,
    insights: {
      spend: Number(row.spend ?? 0),
      conversions: Number(row.conversions ?? 0),
      purchase_conversions: Number(row.purchase_conversions ?? 0),
      roas: row.roas != null ? Number(row.roas) : undefined,
    },
  }));

  const cacheAge = data[0]?.updated_at
    ? Math.round((Date.now() - new Date(data[0].updated_at).getTime()) / 60000)
    : null;

  return NextResponse.json({
    results,
    source: 'cache',
    cache_age_minutes: cacheAge,
    summary: { total_accounts: results.length, successful: results.length, failed: 0, cached: results.length },
  });
}

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

    // Try PipeBoard first
    try {
      const result = await callPipeboard('bulk_get_insights', {
        level: 'account',
        account_ids: accountIds,
        time_range: timeRange,
        limit: 50,
      }) as PipeboardBulkResponse;

      // Cache successful results in background
      if (result?.results) {
        updateCache(result.results, timeRange);
      }

      return NextResponse.json(result);
    } catch (pipeboardError) {
      // PipeBoard failed — fall back to cache
      console.error('PipeBoard bulk-insights failed, using cache:', pipeboardError instanceof Error ? pipeboardError.message : pipeboardError);
      return readCache(accountIds);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
