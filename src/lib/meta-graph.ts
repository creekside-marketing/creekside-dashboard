/**
 * Direct Meta Graph API client.
 *
 * Replaces AdKit as the primary data source for Meta Ads.
 * Uses META_ADS_ACCESS_TOKEN (system-user token, permanent).
 * Falls back gracefully — caller should catch errors and retry via AdKit.
 *
 * Response shapes match what AdKit returns after callPipeboard() unwraps
 * the JSON-RPC envelope, so existing route files need zero changes.
 */

const META_BASE = 'https://graph.facebook.com/v21.0';

function getToken(): string {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  if (!token) throw new Error('META_ADS_ACCESS_TOKEN not configured');
  return token;
}

async function graphGet(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
  params.access_token = getToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${META_BASE}${endpoint}?${qs}`;

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph API ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

// ── Method handlers ──────────────────────────────────────────────────────

async function getAdAccounts(): Promise<unknown> {
  const allAccounts: unknown[] = [];
  let url: string | null = `${META_BASE}/me/adaccounts`;
  const token = getToken();

  while (url) {
    const fetchUrl = url.includes('access_token') ? url : `${url}?access_token=${token}&fields=id,name,account_status,currency,timezone_name&limit=100`;
    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error(`Graph API ${response.status}`);
    const json = await response.json() as { data?: unknown[]; paging?: { next?: string } };
    if (json.data) allAccounts.push(...json.data);
    url = json.paging?.next ?? null;
  }

  // Wrap in AdKit-compatible envelope
  return wrapResponse({ data: allAccounts });
}

async function getInsights(args: Record<string, unknown>): Promise<unknown> {
  const accountId = String(args.object_id ?? args.account_id ?? '');
  if (!accountId) throw new Error('No account ID provided');

  const level = String(args.level ?? 'account');

  // Default fields — always included. AdKit merges caller fields with defaults;
  // we do the same so `fields=conversions` doesn't strip spend/clicks/etc.
  // NOTE: Do NOT include inline_link_clicks here. AdKit never returned it,
  // and the frontend falls back to total `clicks` for CPC/CTR calculations.
  // Adding it changes client-facing CONV. RATE and AVG CPC numbers.
  const DEFAULT_FIELDS = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,unique_clicks,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,conversions,action_values,outbound_clicks';

  // Merge caller-requested fields with defaults
  let fields = DEFAULT_FIELDS;
  if (Array.isArray(args.fields) && args.fields.length > 0) {
    const defaultSet = new Set(DEFAULT_FIELDS.split(','));
    for (const f of args.fields as string[]) {
      if (!defaultSet.has(f.trim())) {
        fields += ',' + f.trim();
      }
    }
  }

  const params: Record<string, string> = { level, fields };

  // Handle time_range — can be a preset string or {since, until} object
  const timeRange = args.time_range;
  if (typeof timeRange === 'string') {
    params.date_preset = timeRange;
  } else if (timeRange && typeof timeRange === 'object') {
    const tr = timeRange as { since?: string; until?: string };
    if (tr.since && tr.until) {
      params.time_range = JSON.stringify({ since: tr.since, until: tr.until });
    }
  }

  // Handle breakdowns
  if (args.breakdowns) {
    params.breakdowns = String(args.breakdowns);
  }

  // Handle time_breakdown
  if (args.time_breakdown) {
    params.time_increment = args.time_breakdown === 'day' ? '1' : String(args.time_breakdown);
  }

  const result = await graphGet(`/${accountId}/insights`, params) as { data?: Record<string, unknown>[] };

  // Post-process: add AdKit-compatible fields that Graph API doesn't include
  if (result.data) {
    for (const row of result.data) {
      // AdKit adds account_id and account_name to every row
      if (!('account_id' in row)) row.account_id = accountId;
      if (!('account_name' in row)) row.account_name = '';
      enrichRow(row);
    }
  }

  return wrapResponse(result);
}

/**
 * Enrich a Graph API insights row with top-level fields that AdKit provided.
 * The frontend expects these as top-level fields, not buried in actions[].
 */
function enrichRow(row: Record<string, unknown>): void {
  const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
  const costPerAction = (row.cost_per_action_type ?? []) as Array<{ action_type: string; value: string }>;

  // NOTE: Do NOT promote inline_link_clicks from actions array.
  // AdKit never provided it as a top-level field. The frontend falls back
  // to total `clicks` for CPC/CTR/CONV calculations. Adding inline_link_clicks
  // changes client-facing report numbers (CPC doubles, conv rate doubles).

  // outbound_clicks — Graph API returns this as an array [{action_type, value}],
  // but frontend expects a number. Normalize either way.
  if (Array.isArray(row.outbound_clicks)) {
    const oc = (row.outbound_clicks as Array<{ action_type: string; value: string }>)[0];
    row.outbound_clicks = oc ? Number(oc.value) : 0;
  } else if (!('outbound_clicks' in row)) {
    const outbound = actions.find(a => a.action_type === 'outbound_click');
    row.outbound_clicks = outbound ? Number(outbound.value) : 0;
  }

  // landing_page_views
  if (!('landing_page_views' in row)) {
    const lpv = actions.find(a => a.action_type === 'landing_page_view');
    row.landing_page_views = lpv ? Number(lpv.value) : 0;
  }

  // cost_per_inline_link_click
  if (!('cost_per_inline_link_click' in row)) {
    const cplc = costPerAction.find(a => a.action_type === 'link_click');
    row.cost_per_inline_link_click = cplc ? Number(cplc.value) : 0;
  }
}

async function bulkGetInsights(args: Record<string, unknown>): Promise<unknown> {
  const accountIds = args.account_ids as string[] ?? [];
  const timeRange = args.time_range ?? 'last_30d';
  const token = getToken();

  // Parallel fetch per account (cap at 50)
  const capped = accountIds.slice(0, 50);
  const results = await Promise.all(
    capped.map(async (accountId) => {
      try {
        const params: Record<string, string> = {
          access_token: token,
          level: 'account',
          fields: 'spend,impressions,clicks,actions,action_values',
        };

        if (typeof timeRange === 'string') {
          params.date_preset = timeRange;
        } else if (typeof timeRange === 'object' && timeRange) {
          const tr = timeRange as { since?: string; until?: string };
          if (tr.since && tr.until) {
            params.time_range = JSON.stringify(tr);
          }
        }

        const qs = new URLSearchParams(params).toString();
        const response = await fetch(`${META_BASE}/${accountId}/insights?${qs}`);

        if (!response.ok) {
          return { account_id: accountId, status: 'error', error: `HTTP ${response.status}` };
        }

        const json = await response.json() as { data?: Array<Record<string, unknown>> };
        const row = json.data?.[0];

        if (!row) {
          return { account_id: accountId, status: 'success', insights: { spend: 0, conversions: 0, purchase_conversions: 0 } };
        }

        // Extract conversions from actions array
        const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
        const totalConversions = actions.reduce((sum, a) => {
          if (a.action_type.startsWith('offsite_conversion')) sum += Number(a.value ?? 0);
          return sum;
        }, 0);
        const purchaseConversions = actions
          .filter(a => a.action_type.includes('purchase'))
          .reduce((sum, a) => sum + Number(a.value ?? 0), 0);

        // Extract ROAS from action_values
        const actionValues = (row.action_values ?? []) as Array<{ action_type: string; value: string }>;
        const purchaseValue = actionValues
          .filter(a => a.action_type.includes('purchase'))
          .reduce((sum, a) => sum + Number(a.value ?? 0), 0);
        const spend = Number(row.spend ?? 0);
        const roas = spend > 0 ? purchaseValue / spend : undefined;

        return {
          account_id: accountId,
          status: 'success',
          insights: {
            spend,
            conversions: totalConversions,
            purchase_conversions: purchaseConversions,
            roas,
          },
        };
      } catch (err) {
        return { account_id: accountId, status: 'error', error: err instanceof Error ? err.message : 'Unknown' };
      }
    }),
  );

  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;

  return wrapResponse({
    results,
    summary: { total_accounts: results.length, successful, failed, cached: 0 },
  });
}

async function bulkGetAdCreatives(args: Record<string, unknown>): Promise<unknown> {
  const adIds = (args.ad_ids ?? []) as string[];
  const token = getToken();
  const capped = adIds.slice(0, 50);

  const results = await Promise.all(
    capped.map(async (adId) => {
      try {
        const response = await fetch(
          `${META_BASE}/${adId}?fields=id,creative{id,thumbnail_url,image_url,object_story_spec}&access_token=${token}`,
        );
        if (!response.ok) return null;
        const json = await response.json() as Record<string, unknown>;
        return { ad_id: adId, creative: json.creative ?? {} };
      } catch {
        return null;
      }
    }),
  );

  return wrapResponse({ results: results.filter(Boolean) });
}

/**
 * Paginate through all ads in an account.
 * Requests only id, campaign_id, and creative{id} — the minimum needed to
 * build a campaign→creative map. URL extraction is done separately via
 * getCreativeDetails (which uses the direct creative endpoint, not field
 * expansion from ads — field expansion on creatives is unreliable with
 * system-user tokens: object_story_spec, destination_url, link_url are all
 * rejected or empty depending on creative type).
 */
async function getAds(args: Record<string, unknown>): Promise<unknown> {
  const rawAccountId = String(args.account_id ?? '');
  if (!rawAccountId) throw new Error('No account_id provided');
  const token = getToken();

  // Accept both "act_123" and "123" formats
  const accountId = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;

  // creative{id} is always safe — id is a valid field on any Graph API node
  const FIELDS = 'id,campaign_id,creative{id}';
  const pageLimit = Math.min(Number(args.limit ?? 200), 200);
  const allAds: unknown[] = [];
  let after: string | null = null;

  do {
    const params: Record<string, string> = {
      access_token: token,
      fields: FIELDS,
      limit: String(pageLimit),
    };
    if (after) params.after = after;

    const response = await fetch(`${META_BASE}/${accountId}/ads?${new URLSearchParams(params)}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph API ${response.status}: ${body.slice(0, 300)}`);
    }

    const json = await response.json() as {
      data?: unknown[];
      paging?: { cursors?: { after?: string }; next?: string };
    };

    if (Array.isArray(json.data)) allAds.push(...json.data);
    after = (json.paging?.next && json.paging.cursors?.after) ? json.paging.cursors.after : null;
  } while (after && allAds.length < 2000);

  return wrapResponse({ data: allAds });
}

/**
 * Batch-fetch creative details for a list of creative IDs.
 *
 * URL resolution via object_story_spec (works with system-user tokens when
 * called directly on /{creative_id} — unlike field expansion from /ads which
 * is blocked). The URL lives at:
 *   - object_story_spec.video_data.call_to_action.value.link  (VIDEO type)
 *   - object_story_spec.link_data.link                        (LINK/SHARE type)
 *   - object_story_spec.link_data.child_attachments[0].link   (carousel)
 *   - link_url                                                 (legacy, often null)
 *
 * Note: the post endpoint (effective_object_story_id) was tried and rejected —
 * it requires pages_read_engagement permission which the system-user token lacks.
 */
async function getCreativeDetails(args: Record<string, unknown>): Promise<unknown> {
  const creativeIds = (args.creative_ids as string[] | undefined) ?? [];
  if (creativeIds.length === 0) return wrapResponse({ data: [] });
  const token = getToken();
  const FIELDS = 'id,link_url,object_url,object_story_spec,asset_feed_spec';
  const BATCH_SIZE = 50;
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < creativeIds.length; i += BATCH_SIZE) {
    const batch = creativeIds.slice(i, i + BATCH_SIZE).map((id) => ({
      method: 'GET',
      relative_url: `${id}?fields=${FIELDS}`,
    }));

    const response = await fetch(`${META_BASE}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph API batch ${response.status}: ${body.slice(0, 300)}`);
    }

    const batchResults = await response.json() as Array<{ code: number; body: string } | null>;
    for (const item of batchResults) {
      if (item?.code === 200) {
        try { results.push(JSON.parse(item.body) as Record<string, unknown>); } catch { /* skip malformed */ }
      } else if (item) {
        console.warn(`[meta-graph] creative batch item error ${item.code}:`, item.body?.slice(0, 200));
      }
    }
  }

  console.log(`[meta-graph] getCreativeDetails: ${creativeIds.length} requested, ${results.length} returned`);
  return wrapResponse({ data: results });
}

// ── Response wrapper ─────────────────────────────────────────────────────

/**
 * Wrap Graph API response in AdKit's MCP content envelope.
 * This ensures existing route files that pass the result straight through
 * (or unwrap via unwrapMcpResponse) continue to work unchanged.
 */
function wrapResponse(data: unknown): unknown {
  const text = JSON.stringify(data);
  return {
    content: [{ type: 'text', text }],
    structuredContent: { result: text },
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/** Supported methods that can be routed to the Graph API. */
/** Supported methods that can be routed to the Graph API.
 *
 * NOTE: bulk_get_insights and bulk_get_ad_creatives intentionally stay on AdKit.
 * Bulk calls mix accounts that Graph API can reach with accounts it can't (MedWriter,
 * LA Smiles). AdKit handles all accounts uniformly. The cost impact is minimal --
 * bulk calls happen once per overview page load, not per-client report view.
 */
const GRAPH_METHODS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_ad_accounts: getAdAccounts,
  get_insights: getInsights,
  get_ads: getAds,
  get_creative_details: getCreativeDetails,
};

/**
 * Try to handle a AdKit method call via direct Graph API.
 * Returns the result if successful, or throws if:
 * - META_ADS_ACCESS_TOKEN is not set
 * - The method is not supported (caller should fall back to AdKit)
 * - The Graph API call fails
 */
export async function callMetaGraphAPI(
  method: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const handler = GRAPH_METHODS[method];
  if (!handler) {
    throw new Error(`Graph API does not support method: ${method}`);
  }
  return handler(args);
}

/** Check if a method can be handled by the Graph API. */
export function isGraphSupported(method: string): boolean {
  return method in GRAPH_METHODS;
}
