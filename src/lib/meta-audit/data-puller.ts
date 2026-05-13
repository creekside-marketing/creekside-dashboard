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

  // Pull creatives for active ads only (cap at 10 to keep API calls bounded)
  const activeAds = ads.filter((a) => a.status === 'ACTIVE').slice(0, 10);
  const creativeRaw = await Promise.all(
    activeAds.map((a) => callPipeboard('get_ad_creatives', { ad_id: a.id }).catch(() => null))
  );
  const creatives: CreativeSummary[] = creativeRaw
    .map((r) => extractData<{ data?: CreativeSummary[] }>(r, { data: [] }).data?.[0])
    .filter((c): c is CreativeSummary => !!c);

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
