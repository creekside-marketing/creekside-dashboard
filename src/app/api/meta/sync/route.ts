import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { createServiceClient } from '@/lib/supabase';

// ── Auth helper ───────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const expectedKey = process.env.SYNC_API_KEY;
  // Deny access if SYNC_API_KEY is not configured — set this env var to enable the sync endpoint
  if (!expectedKey) return false;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  return token === expectedKey;
}

// ── Sync endpoint ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized. Ensure SYNC_API_KEY is set in environment variables.' },
      { status: 401 }
    );
  }

  const supabase = createServiceClient();
  const errors: string[] = [];
  let synced = 0;

  try {
    // Fetch all Meta reporting clients with a valid ad_account_id
    const { data: clients, error: clientsError } = await supabase
      .from('reporting_clients')
      .select('id, client_name, ad_account_id')
      .eq('platform', 'meta')
      .not('ad_account_id', 'is', null);

    if (clientsError) {
      return NextResponse.json(
        { error: `Failed to fetch clients: ${clientsError.message}` },
        { status: 500 }
      );
    }

    if (!clients || clients.length === 0) {
      return NextResponse.json({
        synced: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });
    }

    // Compute date range: last 30 days
    const until = new Date();
    until.setDate(until.getDate() - 1);
    const since = new Date(until);
    since.setDate(since.getDate() - 29);

    const sinceStr = since.toISOString().split('T')[0];
    const untilStr = until.toISOString().split('T')[0];

    for (const client of clients) {
      try {
        const result = await callPipeboard('get_insights', {
          object_id: client.ad_account_id,
          level: 'campaign',
          time_range: { since: sinceStr, until: untilStr },
        });

        // Parse the PipeBoard response — data may be nested
        const rawData = result?.data ?? result ?? [];
        const rows = Array.isArray(rawData) ? rawData : [];

        if (rows.length === 0) continue;

        // Build upsert rows
        const upsertRows = rows.map((row: Record<string, unknown>) => ({
          account_id: client.ad_account_id,
          campaign_id: String(row.campaign_id ?? ''),
          campaign_name: String(row.campaign_name ?? 'Unknown'),
          date: String(row.date_start ?? row.date ?? sinceStr),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          spend: Number(row.spend ?? 0),
          ctr: Number(row.ctr ?? 0),
          cpc: Number(row.cpc ?? 0),
          actions: row.actions ?? null,
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from('meta_insights_daily')
          .upsert(upsertRows, { onConflict: 'campaign_id,date' });

        if (upsertError) {
          errors.push(`${client.client_name}: upsert failed — ${upsertError.message}`);
        } else {
          synced += upsertRows.length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${client.client_name}: ${msg}`);
      }
    }

    return NextResponse.json({
      synced,
      errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
