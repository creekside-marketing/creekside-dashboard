/**
 * GET /api/meta/landing-pages — Campaign-level Meta spend grouped by destination URL.
 *
 * Two-step approach:
 *   1. get_insights at level=campaign with fields=conversions
 *      → exact spend/impressions/clicks/Pre-Q/PQL per campaign_id
 *   2. get_ads for the account with creative URL fields
 *      → campaign_id → destination URL map (one URL per campaign)
 *
 * Groups campaign spend by resolved URL. If URL resolution fails entirely,
 * returns urlResolutionFailed=true so the UI can surface a clear message
 * rather than silently falling back to ad names.
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

/** Extract the destination URL from a Meta ad creative object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUrl(creative: any): string | null {
  if (!creative || typeof creative !== 'object') return null;
  // Link / carousel ads
  const spec = creative.object_story_spec;
  if (spec?.link_data?.link)                          return String(spec.link_data.link);
  if (spec?.link_data?.call_to_action?.value?.link)   return String(spec.link_data.call_to_action.value.link);
  // Video ads with CTA
  if (spec?.video_data?.call_to_action?.value?.link)  return String(spec.video_data.call_to_action.value.link);
  // Flat fields sometimes present on the creative itself
  if (creative.link_url)        return String(creative.link_url);
  if (creative.link)            return String(creative.link);
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

    const since      = searchParams.get('since');
    const until      = searchParams.get('until');
    const time_range = searchParams.get('time_range') || 'last_30d';
    const dates      = resolveTimeRange(time_range, since, until);

    // ── Step 1: campaign-level insights ──────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let campaignRows: Record<string, any>[] = [];
    try {
      const raw = await callPipeboard('get_insights', {
        object_id: account_id,
        level: 'campaign',
        fields: ['campaign_id', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions'],
        time_range: { since: dates.since, until: dates.until },
      });
      const unwrapped = unwrapMcp(raw);
      const arr = unwrapped?.data ?? unwrapped;
      if (Array.isArray(arr)) campaignRows = arr;
    } catch (e) {
      console.error('[meta/landing-pages] insights error:', e instanceof Error ? e.message : String(e));
      return NextResponse.json({ data: [], error: 'insights_failed' }, { status: 502 });
    }

    if (campaignRows.length === 0) return NextResponse.json({ data: [], hasUrls: false });

    // ── Step 2: resolve campaign → destination URL via get_ads ────────────
    // Request creative sub-fields so Meta returns link_data.link for each ad.
    const campaignUrlMap: Record<string, string> = {}; // campaign_id → first resolved URL
    try {
      const raw = await callPipeboard('get_ads', {
        account_id,
        fields: [
          'id',
          'campaign_id',
          'creative{object_story_spec{link_data{link,call_to_action{value{link}}},video_data{call_to_action{value{link}}}},link_url,link}',
        ],
        limit: 500,
      });
      const unwrapped = unwrapMcp(raw);
      // PipeBoard may return { data: [...] } or a plain array
      const ads = unwrapped?.data ?? (Array.isArray(unwrapped) ? unwrapped : []);
      for (const ad of ads) {
        const campaignId = String(ad?.campaign_id ?? '');
        if (!campaignId || campaignUrlMap[campaignId]) continue; // one URL per campaign
        const url = extractUrl(ad?.creative ?? ad);
        if (url) campaignUrlMap[campaignId] = url;
      }
    } catch (e) {
      console.error('[meta/landing-pages] get_ads error:', e instanceof Error ? e.message : String(e));
      // Don't bail — fall through; urlResolutionFailed will be set below
    }

    const hasUrls = Object.keys(campaignUrlMap).length > 0;

    // If no URLs resolved at all, tell the client so it can show a message
    if (!hasUrls) {
      return NextResponse.json({ data: [], hasUrls: false, urlResolutionFailed: true });
    }

    // ── Step 3: aggregate campaign spend by URL ───────────────────────────
    const byUrl: Record<string, {
      impressions: number; clicks: number; spend: number; preq: number; pql: number;
    }> = {};

    for (const row of campaignRows) {
      const campaignId = String(row.campaign_id ?? '');
      const url = campaignUrlMap[campaignId];
      if (!url) continue; // skip campaigns whose URL couldn't be resolved

      if (!byUrl[url]) byUrl[url] = { impressions: 0, clicks: 0, spend: 0, preq: 0, pql: 0 };
      const agg   = byUrl[url];
      const convs = (row.conversions ?? []) as MetaAction[];

      agg.impressions += Number(row.impressions ?? 0);
      agg.clicks      += Number(row.clicks      ?? 0);
      agg.spend       += Number(row.spend       ?? 0);
      agg.preq        += convVal(convs, PREQ_ACTION);
      agg.pql         += convVal(convs, PQL_ACTION);
    }

    const data = Object.entries(byUrl)
      .map(([landing_page, v]) => ({
        landing_page,
        impressions:          v.impressions,
        clicks:               v.clicks,
        ctr:                  v.impressions > 0 ? v.clicks / v.impressions : 0,
        spend:                v.spend,
        conversions:          v.preq,
        cost_per_conversion:  v.preq > 0 ? v.spend / v.preq : 0,
        pql_conversions:      v.pql,
        cost_per_pql:         v.pql > 0 ? v.spend / v.pql : 0,
      }))
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ data, hasUrls: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
