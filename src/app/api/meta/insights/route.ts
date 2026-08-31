import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { createServiceClient } from '@/lib/supabase';

/**
 * Log a Meta API error to pipeline_alerts (max 1 per day).
 * Also sends an email notification via the notify edge function.
 */
async function logMetaApiAlert(accountId: string, errorMessage: string) {
  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];

  // Dedup: check if we already alerted today for this error type
  const { data: existing } = await supabase
    .from('pipeline_alerts')
    .select('id')
    .eq('alert_type', 'meta_api_error')
    .gte('created_at', `${today}T00:00:00Z`)
    .limit(1);

  if (existing && existing.length > 0) return; // already alerted today

  await supabase.from('pipeline_alerts').insert({
    alert_type: 'meta_api_error',
    severity: 'critical',
    message: `Meta API error for account ${accountId}: ${errorMessage}`,
    details: { account_id: accountId, error: errorMessage, date: today, content_table: 'meta_insights_daily' },
    acknowledged: false,
  });
}

/** Convert a time_range preset to { since, until } date strings. */
function resolveTimeRange(
  preset: string,
  explicitSince?: string | null,
  explicitUntil?: string | null,
): { since: string; until: string } {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (explicitSince && explicitUntil && datePattern.test(explicitSince) && datePattern.test(explicitUntil)) {
    return { since: explicitSince, until: explicitUntil };
  }
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'last_7d': return { since: fmt(daysAgo(7)), until: fmt(daysAgo(1)) };
    case 'last_14d': return { since: fmt(daysAgo(14)), until: fmt(daysAgo(1)) };
    case 'last_30d': return { since: fmt(daysAgo(30)), until: fmt(daysAgo(1)) };
    case 'this_month': return { since: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmt(now) };
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: fmt(first), until: fmt(last) };
    }
    default: return { since: fmt(daysAgo(30)), until: fmt(daysAgo(1)) };
  }
}

interface CachedRow {
  campaign_id: string; date: string; spend: number; impressions: number;
  clicks: number; reach: number; frequency: number; conversions: number;
  ctr: number; cpc: number; cpm: number;
}

/**
 * Serve a daily time series directly from meta_insights_daily.
 * AdKit's results endpoint has no time breakdown, so day-series requests
 * never hit the live API — the Railway pipeline keeps this table current.
 * Synthesizes an actions[] array from the conversions scalar so default
 * lead counting (action_type 'lead') keeps working in the charts.
 */
async function serveDaySeries(
  account_id: string,
  time_range: string,
  since: string | null,
  until: string | null,
): Promise<NextResponse> {
  const supabase = createServiceClient();

  const { data: campaigns } = await supabase
    .from('meta_campaigns')
    .select('campaign_id')
    .eq('account_id', account_id);

  const campaignIds = (campaigns ?? []).map(c => c.campaign_id);
  if (campaignIds.length === 0) {
    return NextResponse.json({ segmented_metrics: [], source: 'cache' });
  }

  const dates = resolveTimeRange(time_range, since, until);

  const { data: cachedData, error: dbError } = await supabase
    .from('meta_insights_daily')
    .select('*')
    .in('campaign_id', campaignIds)
    .gte('date', dates.since)
    .lte('date', dates.until)
    .order('date', { ascending: true });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 502 });
  }

  const byDate: Record<string, { date_start: string; spend: number; impressions: number; clicks: number; inline_link_clicks: number; reach: number; conversions: number }> = {};
  for (const r of (cachedData ?? []) as CachedRow[]) {
    if (!byDate[r.date]) {
      byDate[r.date] = { date_start: r.date, spend: 0, impressions: 0, clicks: 0, inline_link_clicks: 0, reach: 0, conversions: 0 };
    }
    const d = byDate[r.date];
    d.spend += Number(r.spend || 0);
    d.impressions += Number(r.impressions || 0);
    d.clicks += Number(r.clicks || 0);
    // meta_insights_daily has no inline_link_clicks column — approximate with
    // clicks (consumers fall back to clicks anyway via `?? row.clicks`)
    d.inline_link_clicks += Number(r.clicks || 0);
    d.reach += Number(r.reach || 0);
    d.conversions += Number(r.conversions || 0);
  }

  const sorted = Object.values(byDate).sort((a, b) => a.date_start.localeCompare(b.date_start));
  return NextResponse.json({
    segmented_metrics: sorted.map(m => ({
      period: m.date_start,
      metrics: { ...m, actions: [{ action_type: 'lead', value: String(m.conversions) }] },
    })),
    source: 'cache',
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const account_id = searchParams.get('account_id');
    if (!account_id || account_id === 'null' || account_id === 'undefined' || account_id.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid ad account ID' },
        { status: 400 }
      );
    }

    const time_range = searchParams.get('time_range') || 'last_30d';
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const level = searchParams.get('level') || 'account';

    // Validate date inputs
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const hasValidDates = since && until && datePattern.test(since) && datePattern.test(until);

    // Map breakdown levels to API params
    const breakdownLevels: Record<string, { apiLevel: string; breakdowns: string }> = {
      age: { apiLevel: 'account', breakdowns: 'age' },
      gender: { apiLevel: 'account', breakdowns: 'gender' },
      placement: { apiLevel: 'account', breakdowns: 'publisher_platform,platform_position' },
    };

    const breakdownConfig = breakdownLevels[level];
    const time_breakdown = searchParams.get('time_breakdown');
    const extraFields = searchParams.get('fields');

    // Daily series comes straight from meta_insights_daily — AdKit cannot
    // segment by day, and the pipeline refreshes this table every morning.
    if (time_breakdown === 'day' && !breakdownConfig) {
      return serveDaySeries(account_id, time_range, since, until);
    }

    // Build API args -- explicit date range overrides preset time_range
    const apiArgs: Record<string, unknown> = {
      object_id: account_id,
      level: breakdownConfig?.apiLevel ?? level,
    };

    // When extra fields are requested (e.g. "conversions"), pass them through.
    if (extraFields) {
      apiArgs.fields = extraFields.split(',').map((f) => f.trim());
    }

    if (time_breakdown) {
      apiArgs.time_breakdown = time_breakdown;
    }

    if (breakdownConfig) {
      apiArgs.breakdowns = breakdownConfig.breakdowns;
    }

    if (hasValidDates) {
      apiArgs.time_range = { since, until };
    } else if (since || until) {
      // One date provided but invalid — ignore and use preset
      apiArgs.time_range = time_range;
    } else {
      apiArgs.time_range = time_range;
    }

    try {
      const result = await callPipeboard('get_insights', apiArgs);
      return NextResponse.json(result);
    } catch (apiError) {
      // Log to pipeline_alerts (deduped: max 1 per error per day)
      const errMsg = apiError instanceof Error ? apiError.message : 'Unknown Meta API error';
      logMetaApiAlert(account_id, errMsg).catch(() => {/* fire-and-forget */});

      // API failed -- fall back to cached data via meta_campaigns join
      try {
        const supabase = createServiceClient();

        // Resolve campaign IDs for this account
        const { data: campaigns } = await supabase
          .from('meta_campaigns')
          .select('campaign_id, campaign_name')
          .eq('account_id', account_id);

        if (!campaigns || campaigns.length === 0) throw apiError;

        const campaignIds = campaigns.map(c => c.campaign_id);
        const campaignNames: Record<string, string> = {};
        for (const c of campaigns) campaignNames[c.campaign_id] = c.campaign_name ?? 'Unknown';

        // Compute date range from time_range preset or explicit dates
        const dates = resolveTimeRange(time_range, since, until);

        const { data: cachedData, error: dbError } = await supabase
          .from('meta_insights_daily')
          .select('*')
          .in('campaign_id', campaignIds)
          .gte('date', dates.since)
          .lte('date', dates.until)
          .order('date', { ascending: false });

        if (dbError || !cachedData || cachedData.length === 0) throw apiError;

        const rows = cachedData as CachedRow[];

        // Shape response based on requested level
        if (level === 'campaign' || breakdownConfig) {
          const byCampaign: Record<string, { campaign_id: string; campaign_name: string; spend: number; impressions: number; clicks: number; reach: number; conversions: number; inline_link_clicks: number }> = {};
          for (const r of rows) {
            if (!byCampaign[r.campaign_id]) {
              byCampaign[r.campaign_id] = { campaign_id: r.campaign_id, campaign_name: campaignNames[r.campaign_id] || 'Unknown', spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, inline_link_clicks: 0 };
            }
            const c = byCampaign[r.campaign_id];
            c.spend += Number(r.spend || 0);
            c.impressions += Number(r.impressions || 0);
            c.clicks += Number(r.clicks || 0);
            c.inline_link_clicks += Number(r.clicks || 0);
            c.reach += Number(r.reach || 0);
            c.conversions += Number(r.conversions || 0);
          }
          const campaignRows = Object.values(byCampaign).filter(c => c.spend > 0);
          return NextResponse.json({ data: campaignRows, source: 'cache' });
        }

        if (time_breakdown === 'day') {
          const byDate: Record<string, { date_start: string; spend: number; impressions: number; clicks: number; inline_link_clicks: number; reach: number; conversions: number }> = {};
          for (const r of rows) {
            if (!byDate[r.date]) {
              byDate[r.date] = { date_start: r.date, spend: 0, impressions: 0, clicks: 0, inline_link_clicks: 0, reach: 0, conversions: 0 };
            }
            const d = byDate[r.date];
            d.spend += Number(r.spend || 0);
            d.impressions += Number(r.impressions || 0);
            d.clicks += Number(r.clicks || 0);
            d.inline_link_clicks += Number(r.clicks || 0);
            d.reach += Number(r.reach || 0);
            d.conversions += Number(r.conversions || 0);
          }
          const sorted = Object.values(byDate).sort((a, b) => a.date_start.localeCompare(b.date_start));
          return NextResponse.json({ segmented_metrics: sorted.map(m => ({ period: m.date_start, metrics: m })), source: 'cache' });
        }

        // Default: account-level aggregate
        const agg = { spend: 0, impressions: 0, clicks: 0, inline_link_clicks: 0, reach: 0, conversions: 0 };
        for (const r of rows) {
          agg.spend += Number(r.spend || 0);
          agg.impressions += Number(r.impressions || 0);
          agg.clicks += Number(r.clicks || 0);
          agg.inline_link_clicks += Number(r.clicks || 0);
          agg.reach += Number(r.reach || 0);
          agg.conversions += Number(r.conversions || 0);
        }
        return NextResponse.json({ data: [agg], source: 'cache' });
      } catch {
        const message = apiError instanceof Error ? apiError.message : 'Unknown error';
        const status = message.includes('not configured') ? 500 : 502;
        return NextResponse.json({ error: message }, { status });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not configured') ? 500 : 502;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
