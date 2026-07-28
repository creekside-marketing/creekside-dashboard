/**
 * GET /api/meta/landing-pages — Ad-level Meta insights grouped by destination URL.
 *
 * Used by the SRM Meta report's internal-only Landing Page Performance section.
 * Two-step approach:
 *   1. get_insights at level=ad with fields=conversions → per-ad metrics + PQL/Pre-Q counts
 *   2. bulk_get_ad_creatives → destination URL per ad (best-effort; falls back to ad name)
 *
 * Returns rows grouped by URL (or ad name if URL unavailable), sorted by spend desc.
 * hasUrls flag tells the client whether real URLs were resolved or ad names used.
 *
 * CANNOT: Modify ads — read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';

const PQL_ACTION  = 'offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified';
const PREQ_ACTION = 'offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead';

type MetaAction = { action_type: string; value: string };

function convVal(actions: MetaAction[] | undefined, type: string): number {
  if (!Array.isArray(actions)) return 0;
  const match = actions.find((a) => a.action_type === type);
  return match ? Math.round(Number(match.value) || 0) : 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapMcp(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  if (Array.isArray(raw.content) && raw.content.length > 0) {
    const first = raw.content[0];
    if (typeof first?.text === 'string') {
      try { return JSON.parse(first.text); } catch { /* fall through */ }
    }
  }
  if (raw.structuredContent) {
    const sc = raw.structuredContent;
    if (typeof sc.result === 'string') {
      try { return JSON.parse(sc.result); } catch { /* fall through */ }
    }
  }
  return raw;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUrl(creative: any): string | null {
  if (!creative || typeof creative !== 'object') return null;
  // link ads
  const spec = creative.object_story_spec;
  if (spec?.link_data?.link) return String(spec.link_data.link);
  // video ads with CTA
  const ctaLink = spec?.video_data?.call_to_action?.value?.link;
  if (ctaLink) return String(ctaLink);
  // flat fields
  if (creative.link) return String(creative.link);
  if (creative.destination_url) return String(creative.destination_url);
  return null;
}

function resolveTimeRange(
  preset: string,
  since: string | null,
  until: string | null,
): { since: string; until: string } {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (since && until && datePattern.test(since) && datePattern.test(until)) {
    return { since, until };
  }
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case 'last_7d':    return { since: fmt(daysAgo(7)),  until: fmt(daysAgo(1)) };
    case 'last_14d':   return { since: fmt(daysAgo(14)), until: fmt(daysAgo(1)) };
    case 'last_30d':   return { since: fmt(daysAgo(30)), until: fmt(daysAgo(1)) };
    case 'this_month': return { since: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmt(now) };
    case 'last_month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return { since: fmt(first), until: fmt(last) };
    }
    default: return { since: fmt(daysAgo(30)), until: fmt(daysAgo(1)) };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const account_id = searchParams.get('account_id');
    if (!account_id || account_id === 'null' || account_id.trim() === '') {
      return NextResponse.json({ error: 'account_id required' }, { status: 400 });
    }

    const since     = searchParams.get('since');
    const until     = searchParams.get('until');
    const time_range = searchParams.get('time_range') || 'last_30d';
    const dates     = resolveTimeRange(time_range, since, until);

    // ── Step 1: ad-level insights ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let insightsArr: Record<string, any>[] = [];
    try {
      const raw = await callPipeboard('get_insights', {
        object_id: account_id,
        level: 'ad',
        fields: ['ad_id', 'ad_name', 'spend', 'impressions', 'clicks', 'conversions'],
        time_range: { since: dates.since, until: dates.until },
      });
      const unwrapped = unwrapMcp(raw);
      const arr = unwrapped?.data ?? unwrapped;
      if (Array.isArray(arr)) insightsArr = arr;
    } catch (e) {
      console.error('[meta/landing-pages] insights error:', e instanceof Error ? e.message : String(e));
      return NextResponse.json({ data: [], error: 'insights_failed' }, { status: 502 });
    }

    if (insightsArr.length === 0) return NextResponse.json({ data: [], hasUrls: false });

    // ── Step 2: creative URLs (best-effort) ────────────────────────────
    const adIds = [...new Set(insightsArr.map((r) => String(r.ad_id ?? '')).filter(Boolean))];
    const urlMap: Record<string, string> = {};
    try {
      const capped = adIds.slice(0, 100);
      const raw = await callPipeboard('bulk_get_ad_creatives', {
        ad_ids: capped,
        limit: capped.length,
      });
      const parsed = unwrapMcp(raw);
      const items = (parsed?.results ?? parsed?.data ?? []) as unknown[];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const it = item as Record<string, any>;
        const adId = String(it.ad_id ?? it.id ?? '');
        if (!adId) continue;
        const url = extractUrl(it.creative ?? it);
        if (url) urlMap[adId] = url;
      }
    } catch { /* best-effort — fall back to ad names */ }

    // ── Step 3: aggregate by URL (fallback: ad name) ───────────────────
    const byKey: Record<string, {
      impressions: number; clicks: number; spend: number; preq: number; pql: number;
    }> = {};

    for (const row of insightsArr) {
      const adId  = String(row.ad_id ?? '');
      const adName = String(row.ad_name ?? 'Unknown');
      const key   = urlMap[adId] || adName;

      if (!byKey[key]) byKey[key] = { impressions: 0, clicks: 0, spend: 0, preq: 0, pql: 0 };
      const agg  = byKey[key];
      const convs = (row.conversions ?? []) as MetaAction[];

      agg.impressions += Number(row.impressions ?? 0);
      agg.clicks      += Number(row.clicks      ?? 0);
      agg.spend       += Number(row.spend       ?? 0);
      agg.preq        += convVal(convs, PREQ_ACTION);
      agg.pql         += convVal(convs, PQL_ACTION);
    }

    const data = Object.entries(byKey)
      .map(([landing_page, v]) => ({
        landing_page,
        impressions: v.impressions,
        clicks:      v.clicks,
        ctr:         v.impressions > 0 ? v.clicks / v.impressions : 0,
        spend:       v.spend,
        conversions: v.preq,
        cost_per_conversion: v.preq > 0 ? v.spend / v.preq : 0,
        pql_conversions: v.pql,
        cost_per_pql: v.pql > 0 ? v.spend / v.pql : 0,
      }))
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    const hasUrls = Object.keys(urlMap).length > 0;
    return NextResponse.json({ data, hasUrls });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
