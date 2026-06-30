import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { createServiceClient } from '@/lib/supabase';

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

    // Map breakdown levels to PipeBoard params
    const breakdownLevels: Record<string, { pipeboardLevel: string; breakdowns: string }> = {
      age: { pipeboardLevel: 'account', breakdowns: 'age' },
      gender: { pipeboardLevel: 'account', breakdowns: 'gender' },
      placement: { pipeboardLevel: 'account', breakdowns: 'publisher_platform,platform_position' },
    };

    const breakdownConfig = breakdownLevels[level];
    const time_breakdown = searchParams.get('time_breakdown');
    const extraFields = searchParams.get('fields');

    // Build PipeBoard args — explicit date range overrides preset time_range
    const pipeboardArgs: Record<string, unknown> = {
      object_id: account_id,
      level: breakdownConfig?.pipeboardLevel ?? level,
    };

    // When extra fields are requested (e.g. "conversions"), pass them to PipeBoard.
    // PipeBoard merges these with its defaults.
    if (extraFields) {
      pipeboardArgs.fields = extraFields.split(',').map((f) => f.trim());
    }

    if (time_breakdown) {
      pipeboardArgs.time_breakdown = time_breakdown;
    }

    if (breakdownConfig) {
      pipeboardArgs.breakdowns = breakdownConfig.breakdowns;
    }

    if (hasValidDates) {
      pipeboardArgs.time_range = { since, until };
    } else if (since || until) {
      // One date provided but invalid — ignore and use preset
      pipeboardArgs.time_range = time_range;
    } else {
      pipeboardArgs.time_range = time_range;
    }

    try {
      const result = await callPipeboard('get_insights', pipeboardArgs);
      return NextResponse.json(result);
    } catch (pipeboardError) {
      // PipeBoard failed — fall back to cached data via meta_campaigns join
      try {
        const supabase = createServiceClient();

        // Resolve campaign IDs for this account
        const { data: campaigns } = await supabase
          .from('meta_campaigns')
          .select('campaign_id, campaign_name')
          .eq('account_id', account_id);

        if (!campaigns || campaigns.length === 0) throw pipeboardError;

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

        if (dbError || !cachedData || cachedData.length === 0) throw pipeboardError;

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
        const message = pipeboardError instanceof Error ? pipeboardError.message : 'Unknown error';
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
