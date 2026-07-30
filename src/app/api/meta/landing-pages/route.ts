/**
 * GET /api/meta/landing-pages — Campaign-level Meta spend grouped by destination URL.
 *
 * Three-step approach:
 *   1. get_insights at level=campaign → exact spend/impressions/clicks/conversions
 *   2. get_ads → campaign_id + creative{id} mapping
 *   3. get_creative_details (batch Graph API) → resolves destination URL per creative:
 *        a. child_attachments[0].link — carousel ads
 *        b. link_url                  — legacy single-image (often null on modern ads)
 *        c. effective_object_story_id → second batch GET /{story_id}?fields=link
 *           for VIDEO/SHARE type creatives (the common case for SRM)
 *
 * URL resolution order (matches extractUrlFromCreative):
 *   1. link_url                                               — legacy (often null)
 *   2. object_story_spec.video_data.call_to_action.value.link — VIDEO type
 *   3. object_story_spec.link_data.link                       — LINK/SHARE type
 *   4. object_story_spec.link_data.child_attachments[0].link  — carousel
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
  return match ? (Number(match.value) || 0) : 0; // keep as float; round at aggregation end
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
  console.error('[meta/landing-pages] unwrapMcp: could not parse response envelope', JSON.stringify(raw).slice(0, 300));
  return raw;
}

/**
 * Decode Meta's l.facebook.com/l.php?u=<encoded-url> click-tracking wrappers.
 * The Graph API frequently returns these instead of the actual destination URL.
 */
function decodeFbRedirect(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'l.facebook.com' && parsed.pathname === '/l.php') {
      const target = parsed.searchParams.get('u');
      if (target) return decodeURIComponent(target);
    }
  } catch { /* not a valid URL — return as-is */ }
  return url;
}

/**
 * Extract destination URL from a creative details object.
 *   1. link_url                                               — legacy (often null)
 *   2. object_story_spec.video_data.call_to_action.value.link — VIDEO type
 *   3. object_story_spec.link_data.link                       — LINK/SHARE type
 *   4. object_story_spec.link_data.child_attachments[0].link  — carousel
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUrlFromCreative(creative: any): string | null {
  if (!creative || typeof creative !== 'object') return null;
  if (creative.link_url) return decodeFbRedirect(String(creative.link_url));
  const spec = creative.object_story_spec;
  if (spec && typeof spec === 'object') {
    // VIDEO
    const videoLink = spec.video_data?.call_to_action?.value?.link;
    if (videoLink) return decodeFbRedirect(String(videoLink));
    // LINK / SHARE
    const linkDataLink = spec.link_data?.link;
    if (linkDataLink) return decodeFbRedirect(String(linkDataLink));
    // Carousel
    const carouselLink = spec.link_data?.child_attachments?.[0]?.link;
    if (carouselLink) return decodeFbRedirect(String(carouselLink));
  }
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
    if (!/^(act_)?\d+$/.test(account_id.trim())) {
      return NextResponse.json({ error: 'Invalid account_id format' }, { status: 400 });
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

    // ── Steps 2+3: resolve campaign → destination URL ────────────────────
    //
    // Step 2: get_ads → campaign_id + creative{id} mapping
    // Step 3: get_creative_details → batch GET /{creative_id}?fields=id,link_url,
    //         object_story_spec for each unique creative. object_story_spec works
    //         on direct creative calls with system-user tokens (unlike field
    //         expansion from /ads which is blocked, or the post endpoint which
    //         requires pages_read_engagement).
    //
    const campaignUrlMap: Record<string, string> = {}; // campaign_id → URL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _debug: Record<string, any> = { campaignCount: campaignRows.length };
    try {
      // Step 2 — ad→campaign→creative mapping
      const adsRaw = await callPipeboard('get_ads', { account_id, limit: 200 });
      const ads = (unwrapMcp(adsRaw)?.data ?? []) as Array<{
        campaign_id?: unknown;
        creative?: { id?: unknown };
      }>;
      _debug.adsCount = ads.length;

      const campaignToCreativeId: Record<string, string> = {};
      for (const ad of ads) {
        const cmpId = String(ad.campaign_id ?? '');
        const crtId = String(ad.creative?.id ?? '');
        if (cmpId && crtId && !campaignToCreativeId[cmpId]) {
          campaignToCreativeId[cmpId] = crtId;
        }
      }

      // Step 3 — creative details → URL via object_story_spec
      const uniqueCreativeIds = [...new Set(Object.values(campaignToCreativeId))];
      _debug.uniqueCreatives = uniqueCreativeIds.length;
      if (uniqueCreativeIds.length > 0) {
        const creativesRaw = await callPipeboard('get_creative_details', {
          creative_ids: uniqueCreativeIds,
        });
        const creatives = (unwrapMcp(creativesRaw)?.data ?? []) as Array<{
          id?: unknown;
          link_url?: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          object_story_spec?: Record<string, any>;
        }>;
        _debug.creativesReturned = creatives.length;

        // Sample the first creative's keys+values so failures are self-explaining
        if (creatives.length > 0) {
          const sample = creatives[0];
          const spec = sample.object_story_spec;
          _debug.sampleCreative = {
            id: sample.id,
            link_url: sample.link_url ?? null,
            has_object_story_spec: !!spec,
            spec_type: spec ? Object.keys(spec).filter(k => k !== 'page_id' && k !== 'instagram_user_id').join(',') : null,
            resolved_url: extractUrlFromCreative(sample) ?? null,
          };
          _debug.creativesWithSpec = creatives.filter((c) => !!c.object_story_spec).length;
          _debug.creativesWithUrl = creatives.filter((c) => !!extractUrlFromCreative(c)).length;
        }

        const creativeToUrl: Record<string, string> = {};
        for (const creative of creatives) {
          const crtId = String(creative.id ?? '');
          const url = extractUrlFromCreative(creative);
          if (crtId && url) creativeToUrl[crtId] = url;
        }

        for (const [cmpId, crtId] of Object.entries(campaignToCreativeId)) {
          const url = creativeToUrl[crtId];
          if (url) campaignUrlMap[cmpId] = url;
        }
      }

      _debug.urlsResolved = Object.keys(campaignUrlMap).length;
      console.log(`[meta/landing-pages] ads=${ads.length} unique_creatives=${uniqueCreativeIds.length} urls_resolved=${_debug.urlsResolved}`);
    } catch (e) {
      _debug.error = e instanceof Error ? e.message : String(e);
      console.error('[meta/landing-pages] URL resolution error:', _debug.error);
    }

    const hasUrls = Object.keys(campaignUrlMap).length > 0;

    // Only bail with urlResolutionFailed when the creative API itself errored
    // (captured in _debug.error). If the API succeeded but all creatives are
    // dynamic ads (no static URL), we still show the table with UNRESOLVED_LABEL rows.
    if (!hasUrls && _debug.error) {
      return NextResponse.json({ data: [], hasUrls: false, urlResolutionFailed: true, _debug });
    }

    // Campaigns without a resolved URL get bucketed under this label so their
    // spend still shows in the table (typically dynamic/catalog ads whose URL
    // comes from a product feed, not the creative).
    const UNRESOLVED_LABEL = '(dynamic ad — URL not in creative)';

    // ── Step 4: aggregate campaign spend by URL ──────────────────────────
    const byUrl: Record<string, {
      impressions: number; clicks: number; spend: number; preq: number; pql: number;
    }> = {};

    for (const row of campaignRows) {
      const campaignId = String(row.campaign_id ?? '');
      const url = campaignUrlMap[campaignId] ?? UNRESOLVED_LABEL;

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
      .map(([landing_page, v]) => {
        const preq = Math.round(v.preq);
        const pql  = Math.round(v.pql);
        return {
          landing_page,
          impressions:          v.impressions,
          clicks:               v.clicks,
          ctr:                  v.impressions > 0 ? v.clicks / v.impressions : 0,
          spend:                v.spend,
          conversions:          preq,
          cost_per_conversion:  preq > 0 ? v.spend / preq : 0,
          pql_conversions:      pql,
          cost_per_pql:         pql > 0 ? v.spend / pql : 0,
        };
      })
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    return NextResponse.json({ data, hasUrls: true, _debug });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
