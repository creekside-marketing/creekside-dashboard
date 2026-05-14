// Pulls all account data the audit needs from PipeBoard MCP via the
// existing callPipeboard helper. Mirrors steps 4a-4h of the
// meta-audit-agent workflow.

import { callPipeboard } from '@/lib/pipeboard';
import type {
  AccountSummary,
  CampaignSummary,
  AdSetSummary,
  AdSummary,
  CreativeSummary,
  PixelSummary,
  AudienceSummary,
  InsightsTotals,
  AuditDataBundle,
} from './types';

interface PipeboardResult {
  content?: Array<{ type: string; text: string }>;
  result?: unknown;
}

function extractData<T>(raw: unknown, fallback: T): T {
  if (!raw) return fallback;
  // PipeBoard returns either a direct object or a JSON-RPC content block
  const r = raw as PipeboardResult;
  if (r.content && Array.isArray(r.content) && r.content[0]?.type === 'text') {
    try {
      return JSON.parse(r.content[0].text) as T;
    } catch {
      return fallback;
    }
  }
  // Some tools return result wrapped or raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

// Meta stores call-to-action and image URL in different locations depending
// on the creative type (single image, link ad, video, carousel, Advantage+).
// The previous version only checked top-level fields, which produced false
// negatives like "missing CTA" on ads that had Shop Now buttons configured
// via object_story_spec.link_data.call_to_action.
//
// This normalizer walks every known location and writes the resolved value
// back to the top-level fields so downstream code can read one canonical
// place. Top-level wins if already set; otherwise we fall back through the
// nested locations in priority order.
function normalizeCreative(c: CreativeSummary): CreativeSummary {
  const oss = c.object_story_spec;
  const afs = c.asset_feed_spec;

  // Resolve CTA. Meta surfaces this in many places depending on creative
  // type (single image, link ad, video, carousel, Advantage+, dynamic).
  // We try every known location and take the first hit.
  if (!c.call_to_action_type) {
    const cas = oss?.link_data?.child_attachments || [];
    const childCta = cas.find((a) => a.call_to_action?.type)?.call_to_action?.type;
    const resolvedCta =
      oss?.link_data?.call_to_action?.type ||
      oss?.video_data?.call_to_action?.type ||
      childCta ||
      afs?.call_to_action_types?.[0] ||
      undefined;
    if (resolvedCta) c.call_to_action_type = resolvedCta;
  }

  // Resolve image URL. Priority: explicit image_url
  // > object_story_spec.link_data.image_url > carousel first child image_url
  // > asset_feed_spec.images first url.
  //
  // Deliberately NOT using `picture` (200x200 preview) or `thumbnail_url`
  // (video preview) -- those are low-res and look blurry at PDF size. The
  // PDF fetcher rejects sub-400px images anyway, but skipping them at
  // resolution time saves an unnecessary HTTP fetch.
  if (!c.image_url) {
    const resolvedImage =
      oss?.link_data?.image_url ||
      oss?.video_data?.image_url ||
      oss?.link_data?.child_attachments?.find((a) => a.image_url)?.image_url ||
      afs?.images?.find((img) => img.url)?.url ||
      undefined;
    if (resolvedImage) c.image_url = resolvedImage;
  }

  // Resolve link URL similarly so the Landing page field + the homepage check
  // both work for nested link ads.
  if (!c.link_url) {
    const resolvedLink =
      oss?.link_data?.link ||
      oss?.link_data?.call_to_action?.value?.link ||
      oss?.link_data?.child_attachments?.find((a) => a.link)?.link ||
      undefined;
    if (resolvedLink) c.link_url = resolvedLink;
  }

  return c;
}

function totalsFromInsights(row: Record<string, unknown> | null | undefined): InsightsTotals | null {
  if (!row) return null;
  const num = (v: unknown) => Number(v ?? 0);
  const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
  const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) || [];
  const purchases = num(actions.find((a) => a.action_type === 'purchase')?.value);
  const purchaseValue = num(actionValues.find((a) => a.action_type === 'purchase')?.value);
  const spend = num(row.spend);
  return {
    spend,
    impressions: num(row.impressions),
    reach: num(row.reach),
    clicks: num(row.clicks),
    ctr: num(row.ctr),
    cpc: num(row.cpc),
    cpm: num(row.cpm),
    frequency: num(row.frequency),
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
  };
}

export async function pullAuditData(accountId: string): Promise<AuditDataBundle> {
  // Strip act_ if present so we always send the canonical form
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const [
    accountRaw,
    campaignsRaw,
    adsetsRaw,
    adsRaw,
    pixelsRaw,
    audiencesRaw,
    insightsAccountRaw,
    insightsCampaignRaw,
    insightsAd7dRaw,
  ] = await Promise.all([
    callPipeboard('get_account_info', { account_id: acct }),
    callPipeboard('get_campaigns', { account_id: acct, limit: 50 }),
    callPipeboard('get_adsets', { account_id: acct, limit: 50 }),
    callPipeboard('get_ads', { account_id: acct, limit: 50 }),
    callPipeboard('get_pixels', { account_id: acct }),
    callPipeboard('get_custom_audiences', { account_id: acct, limit: 50 }),
    callPipeboard('get_insights', { object_id: acct, time_range: 'last_30d', level: 'account' }),
    callPipeboard('get_insights', { object_id: acct, time_range: 'last_30d', level: 'campaign', limit: 25 }),
    callPipeboard('get_insights', { object_id: acct, time_range: 'last_7d', level: 'ad', limit: 50 }),
  ]);

  // Optional: per-adset details for placements + attribution (top 3 active ad sets)
  const adsetsParsed = extractData<{ data?: AdSetSummary[] }>(adsetsRaw, { data: [] });
  const adsets = adsetsParsed.data || [];
  const topActiveAdsets = adsets.filter((a) => a.status === 'ACTIVE').slice(0, 5);
  const adsetDetails = await Promise.all(
    topActiveAdsets.map((a) => callPipeboard('get_adset_details', { adset_id: a.id }).catch(() => null))
  );
  // Merge details back
  topActiveAdsets.forEach((a, i) => {
    const detail = extractData<AdSetSummary | null>(adsetDetails[i], null);
    if (detail) {
      Object.assign(a, detail);
    }
  });

  const adsParsed = extractData<{ data?: AdSummary[] }>(adsRaw, { data: [] });
  const ads = adsParsed.data || [];

  // Pull creatives for active ads only (cap at 10 to keep API calls bounded).
  // Explicitly request nested fields (object_story_spec, asset_feed_spec) so
  // the normalizer below can resolve CTA + image_url from carousel /
  // link-data / Advantage+ creatives. Without this fields list PipeBoard
  // returns a minimal default response that drops the nested data we need.
  const CREATIVE_FIELDS = [
    'id',
    'name',
    'status',
    'title',
    'body',
    'call_to_action_type',
    'image_url',
    'thumbnail_url',
    'video_id',
    'object_type',
    'link_url',
    'url_tags',
    // Graph API quirk: call_to_action requires explicit sub-field expansion
    // ({type,value{link}}). Requesting it as a bare field returns null on
    // many creative types -- which is why some Sensate cards had image but
    // no CTA in the previous run. Same expansion for child_attachments.
    'object_story_spec{link_data{call_to_action{type,value{link,application,page}},image_url,picture,link,child_attachments{call_to_action{type,value{link}},image_url,picture,link,name,description}},video_data{call_to_action{type,value{link}},image_url,video_id,title,message}}',
    'asset_feed_spec{bodies,titles,descriptions,images,videos,call_to_action_types,link_urls}',
    'degrees_of_freedom_spec',
  ].join(',');
  const activeAds = ads.filter((a) => a.status === 'ACTIVE').slice(0, 10);

  // Two-step fetch. Previous single-call (get_ad_creatives + fields=) was
  // proven not to work -- PipeBoard ignored the fields parameter and
  // returned its minimal default shape, dropping all nested data (CTA,
  // image_url, link). The byte-identical 997.4KB PDFs across runs confirmed
  // this. Switching to get_creative_details, which is the dedicated full-
  // detail endpoint that returns nested fields by default. Falls back to
  // the basic get_ad_creatives data if the details call fails.
  const creativeBasic = await Promise.all(
    activeAds.map((a) =>
      callPipeboard('get_ad_creatives', { ad_id: a.id, fields: CREATIVE_FIELDS }).catch(() => null)
    )
  );
  const basicCreatives = creativeBasic
    .map((r) => extractData<{ data?: CreativeSummary[] }>(r, { data: [] }).data?.[0])
    .map((c) => c || null);

  // Now fetch full details per creative ID. If any individual call fails,
  // fall back to the basic creative we already have.
  const creativeDetails = await Promise.all(
    basicCreatives.map(async (basic) => {
      if (!basic?.id) return basic;
      const detailRaw = await callPipeboard('get_creative_details', {
        creative_id: basic.id,
        fields: CREATIVE_FIELDS,
      }).catch(() => null);
      if (!detailRaw) return basic;
      const detail = extractData<CreativeSummary | null>(detailRaw, null);
      if (!detail) return basic;
      // Merge: detail wins for nested fields, but preserve basic fields
      // not returned by detail (e.g. some status/name fields).
      return { ...basic, ...detail };
    })
  );

  // Last-resort: for any creative still missing a CTA after the two
  // creative-level fetches, try to get it from the ad-level details.
  // Modern Meta sometimes stores the CTA selection on the ad object
  // rather than the creative (this matches what shows in Ads Manager
  // UI under "Call to action" in the ad-level edit panel). Different
  // endpoint, may return different fields. If this also fails to
  // surface a CTA, we accept the data gap rather than fabricate.
  const creativesWithAdLevelFallback = await Promise.all(
    creativeDetails.map(async (creative, idx) => {
      if (!creative) return creative;
      if (creative.call_to_action_type) return creative; // already have it
      const ad = activeAds[idx];
      if (!ad) return creative;
      const adDetailRaw = await callPipeboard('get_ad_details', {
        ad_id: ad.id,
        fields:
          'id,name,creative{id,call_to_action_type,object_story_spec{link_data{call_to_action{type,value{link}}},video_data{call_to_action{type}}},asset_feed_spec{call_to_action_types}}',
      }).catch(() => null);
      if (!adDetailRaw) return creative;
      const adDetail = extractData<{
        creative?: {
          call_to_action_type?: string;
          object_story_spec?: CreativeSummary['object_story_spec'];
          asset_feed_spec?: CreativeSummary['asset_feed_spec'];
        };
      }>(adDetailRaw, {});
      const adCreative = adDetail.creative;
      if (!adCreative) return creative;
      const adLevelCta =
        adCreative.call_to_action_type ||
        adCreative.object_story_spec?.link_data?.call_to_action?.type ||
        adCreative.object_story_spec?.video_data?.call_to_action?.type ||
        adCreative.asset_feed_spec?.call_to_action_types?.[0];
      if (adLevelCta) {
        return { ...creative, call_to_action_type: adLevelCta };
      }
      return creative;
    })
  );

  const creatives: CreativeSummary[] = creativesWithAdLevelFallback
    .filter((c): c is CreativeSummary => !!c)
    .map(normalizeCreative);

  const account = extractData<AccountSummary>(accountRaw, {} as AccountSummary);
  const campaignsParsed = extractData<{ data?: CampaignSummary[] }>(campaignsRaw, { data: [] });
  const pixelsParsed = extractData<{ data?: PixelSummary[] }>(pixelsRaw, { data: [] });
  const audiencesParsed = extractData<{ audiences?: AudienceSummary[]; data?: AudienceSummary[] }>(
    audiencesRaw,
    { audiences: [] }
  );
  const insightsAcct = extractData<{ data?: Array<Record<string, unknown>> }>(insightsAccountRaw, { data: [] });
  const insightsCamp = extractData<{ data?: Array<Record<string, unknown>> }>(insightsCampaignRaw, { data: [] });
  const insightsAd = extractData<{ data?: Array<Record<string, unknown>> }>(insightsAd7dRaw, { data: [] });

  return {
    account,
    campaigns: campaignsParsed.data || [],
    adsets,
    ads,
    creatives,
    pixels: pixelsParsed.data || [],
    audiences: audiencesParsed.audiences || audiencesParsed.data || [],
    insights30dAccount: totalsFromInsights(insightsAcct.data?.[0]),
    insightsByCampaign: (insightsCamp.data || [])
      .map((r) => {
        const totals = totalsFromInsights(r);
        if (!totals) return null;
        return {
          ...totals,
          campaign_id: String(r.campaign_id || ''),
          campaign_name: String(r.campaign_name || ''),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    insightsByAd7d: (insightsAd.data || [])
      .map((r) => {
        const totals = totalsFromInsights(r);
        if (!totals) return null;
        return {
          ...totals,
          ad_id: String(r.ad_id || ''),
          ad_name: String(r.ad_name || ''),
          campaign_id: String(r.campaign_id || ''),
          adset_id: String(r.adset_id || ''),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    pulledAt: new Date().toISOString(),
  };
}
