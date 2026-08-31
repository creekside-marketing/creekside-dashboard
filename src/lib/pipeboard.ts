/**
 * Meta Ads API client — AdKit-primary.
 *
 * All insights methods route through AdKit MCP (https://mcp.adkit.so).
 * Creatives methods (get_ads, get_creative_details, bulk_get_ad_creatives)
 * route to the Meta Graph API — AdKit has no creatives entity.
 *
 * AdKit responses are translated into Meta Graph API-compatible row shapes
 * (campaign_id/campaign_name, actions[], conversions[], action_values[], ...)
 * so all route files and report components work unchanged.
 *
 * Hardening:
 * - 429 retry honoring Retry-After (cap 30s), 5xx exponential backoff
 * - Global concurrency semaphore (max 8 in-flight AdKit requests)
 * - Single-flight project resolution with 30-min TTL; never caches empty
 *   results; serves stale cache when a refresh fails
 * - AdKit tool errors (returned as {error} payloads with HTTP 200) are
 *   thrown as real errors, never swallowed as null
 */

import { callMetaGraphAPI } from './meta-graph';

const ADKIT_URL = 'https://mcp.adkit.so';

/** Methods that must go to the Meta Graph API (AdKit has no creatives entity). */
const GRAPH_ONLY = new Set(['get_ads', 'get_creative_details', 'bulk_get_ad_creatives']);

/**
 * Call a Meta Ads API method. AdKit-primary; Graph API for creatives only.
 */
export async function callPipeboard(method: string, args: Record<string, unknown> = {}) {
  if (GRAPH_ONLY.has(method)) {
    return callMetaGraphAPI(method, args);
  }

  switch (method) {
    case 'get_insights':
      return adkitGetInsights(args);
    case 'bulk_get_insights':
      return adkitBulkInsights(args);
    case 'get_ad_accounts':
      return adkitGetAdAccounts();
    default:
      throw new Error(`callPipeboard: unsupported method ${method}`);
  }
}

// ── Concurrency semaphore ───────────────────────────────────────────────

const MAX_CONCURRENT = 8;
let activeRequests = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRequests >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeRequests++;
}

function releaseSlot(): void {
  activeRequests--;
  const next = waiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── AdKit transport (retry + error surfacing) ───────────────────────────

const MAX_ATTEMPTS = 4;

async function adkitRpc(
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = process.env.ADKIT_API_KEY;
  if (!token) throw new Error('ADKIT_API_KEY not configured');

  await acquireSlot();
  try {
    let lastError = new Error('AdKit: request failed');

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(ADKIT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'tools/call',
            params: { name: toolName, arguments: toolArgs },
          }),
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Math.min(
          (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** (attempt + 1)) * 1000,
          30_000,
        );
        lastError = new Error('AdKit: rate limited (429)');
        await sleep(waitMs);
        continue;
      }

      if (response.status >= 500) {
        lastError = new Error(`AdKit: server error ${response.status}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      if (!response.ok) {
        throw new Error(`AdKit error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        error?: { message?: string };
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };

      if (data.error) {
        throw new Error(`AdKit RPC error: ${data.error.message ?? 'unknown'}`);
      }

      const text = data.result?.content?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error('AdKit: empty response payload');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`AdKit: non-JSON payload: ${text.slice(0, 200)}`);
      }

      // AdKit tool errors come back as {error: ...} inside content text with HTTP 200
      if (parsed && typeof parsed === 'object' && 'error' in parsed && (parsed as { error: unknown }).error) {
        const errVal = (parsed as { error: unknown }).error;
        const msg = typeof errVal === 'string' ? errVal : JSON.stringify(errVal).slice(0, 300);
        throw new Error(`AdKit tool error: ${msg}`);
      }

      return parsed as Record<string, unknown>;
    }

    throw lastError;
  } finally {
    releaseSlot();
  }
}

// ── Project resolution (single-flight, poison-proof, stale-serving) ─────

interface AdKitAccount {
  id: string;
  name: string;
}

interface AdKitProject {
  projectId: string;
  name: string;
  metaAccounts: AdKitAccount[];
}

let projectCache: AdKitProject[] | null = null;
let projectCacheTime = 0;
let projectFetchInFlight: Promise<AdKitProject[]> | null = null;
const PROJECT_CACHE_TTL = 30 * 60 * 1000;

async function fetchProjects(): Promise<AdKitProject[]> {
  const list = await adkitRpc('adkit_projects', { action: 'list', limit: 50 });
  const rawProjects = (list.projects ?? []) as Array<{
    projectId: string;
    name: string;
    platforms?: Record<string, number>;
  }>;

  const connected = rawProjects.filter((p) => (p.platforms?.meta ?? 0) > 0);

  return Promise.all(
    connected.map(async (p) => {
      const metaAccounts: AdKitAccount[] = [];
      try {
        const status = await adkitRpc('adkit_status', { projectId: p.projectId });
        const platforms = (status.platforms ?? {}) as {
          meta?: { accounts?: Array<{ id?: string; name?: string }> };
        };
        for (const acct of platforms.meta?.accounts ?? []) {
          if (acct.id) metaAccounts.push({ id: String(acct.id), name: String(acct.name ?? '') });
        }
      } catch (err) {
        console.warn(`[adkit] status failed for project ${p.projectId}:`,
          err instanceof Error ? err.message : err);
      }
      return { projectId: p.projectId, name: p.name, metaAccounts };
    }),
  );
}

async function getAdKitProjects(): Promise<AdKitProject[]> {
  if (projectCache && Date.now() - projectCacheTime < PROJECT_CACHE_TTL) {
    return projectCache;
  }
  if (projectFetchInFlight) return projectFetchInFlight;

  projectFetchInFlight = fetchProjects()
    .then((projects) => {
      // Only cache results that actually resolved accounts — never poison
      // the cache with an empty/partial fetch (e.g. mid-rate-limit).
      if (projects.some((p) => p.metaAccounts.length > 0)) {
        projectCache = projects;
        projectCacheTime = Date.now();
        return projects;
      }
      return projectCache ?? projects;
    })
    .catch((err) => {
      if (projectCache) return projectCache; // serve stale on failure
      throw err;
    })
    .finally(() => {
      projectFetchInFlight = null;
    });

  return projectFetchInFlight;
}

function normalizeActId(accountId: string): string {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

async function resolveProjectId(accountId: string): Promise<string | null> {
  const projects = await getAdKitProjects();
  const withPrefix = normalizeActId(accountId);
  const bare = accountId.replace(/^act_/, '');
  for (const p of projects) {
    if (p.metaAccounts.some((a) => a.id === withPrefix || a.id === bare || a.id === accountId)) {
      return p.projectId;
    }
  }
  return null;
}

// ── Row translation: AdKit results → Graph API-compatible shapes ────────

const LEVEL_TO_ADKIT: Record<string, string> = {
  account: 'campaigns',
  campaign: 'campaigns',
  campaigns: 'campaigns',
  adset: 'adsets',
  adsets: 'adsets',
  ad: 'ads',
  ads: 'ads',
};

interface ConversionEvent {
  platformKey?: string;
  count?: number;
  value?: number;
  totalValue?: number;
}

interface AdKitRow {
  entity?: { type?: string; platformId?: string | number; name?: string };
  metrics?: Record<string, unknown>;
  conversionEvents?: Record<string, ConversionEvent>;
  breakdown?: Record<string, unknown>;
}

type ActionEntry = { action_type: string; value: string };

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/** Normalize an AdKit conversionEvent key to a Graph API action_type. */
function toActionType(key: string, ev: ConversionEvent): string {
  let actionType = String(ev.platformKey ?? key);
  if (actionType.startsWith('actions:')) actionType = actionType.slice('actions:'.length);
  return actionType;
}

function translateRow(raw: AdKitRow, accountId: string, accountName: string): Record<string, unknown> {
  const metrics = raw.metrics ?? {};
  const row: Record<string, unknown> = {
    account_id: accountId,
    account_name: accountName,
    spend: Number(metrics.spend ?? 0),
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    reach: Number(metrics.reach ?? 0),
  };
  for (const k of ['ctr', 'cpc', 'cpm', 'frequency']) {
    if (metrics[k] != null) row[k] = Number(metrics[k]);
  }

  const entity = raw.entity;
  if (entity?.type && entity.platformId != null) {
    row[`${entity.type}_id`] = String(entity.platformId);
    row[`${entity.type}_name`] = String(entity.name ?? '');
  }

  const actions: ActionEntry[] = [];
  const actionValues: ActionEntry[] = [];
  for (const [key, ev] of Object.entries(raw.conversionEvents ?? {})) {
    if (!ev) continue;
    const actionType = toActionType(key, ev);
    actions.push({ action_type: actionType, value: String(Number(ev.count ?? 0)) });
    const val = ev.value ?? ev.totalValue;
    if (val != null) actionValues.push({ action_type: actionType, value: String(val) });
  }
  row.actions = actions;
  // Graph's `conversions` field carries the same {action_type, value} shape;
  // readers filter by exact action_type (e.g. custom pixel events).
  row.conversions = actions.map((a) => ({ ...a }));
  row.action_values = actionValues;

  // Breakdown dims: AdKit returns camelCase (publisherPlatform, dateStart);
  // Graph consumers expect snake_case (publisher_platform, date_start).
  for (const [k, v] of Object.entries(raw.breakdown ?? {})) {
    row[camelToSnake(k)] = v;
  }

  return row;
}

// ── Account-level aggregation ───────────────────────────────────────────

interface Accumulator {
  base: Record<string, unknown>;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  actions: Map<string, number>;
  values: Map<string, number>;
}

function mergeActionEntries(target: Map<string, number>, entries: unknown): void {
  if (!Array.isArray(entries)) return;
  for (const e of entries as ActionEntry[]) {
    if (!e?.action_type) continue;
    target.set(e.action_type, (target.get(e.action_type) ?? 0) + Number(e.value ?? 0));
  }
}

function mapToEntries(m: Map<string, number>): ActionEntry[] {
  return [...m.entries()].map(([action_type, value]) => ({ action_type, value: String(value) }));
}

/**
 * Aggregate campaign-level rows up to account level.
 * groupKeys = breakdown dims to group by (empty = single account row).
 * Derived metrics (ctr/cpc/cpm/frequency) are recomputed from sums.
 * Note: summed reach over-counts cross-campaign overlap (acceptable).
 */
function aggregateRows(rows: Record<string, unknown>[], groupKeys: string[]): Record<string, unknown>[] {
  const groups = new Map<string, Accumulator>();

  for (const row of rows) {
    const key = groupKeys.map((k) => String(row[k] ?? '')).join('|');
    let acc = groups.get(key);
    if (!acc) {
      const base: Record<string, unknown> = {
        account_id: row.account_id,
        account_name: row.account_name,
      };
      for (const k of groupKeys) base[k] = row[k];
      if (row.date_start != null) base.date_start = row.date_start;
      if (row.date_stop != null) base.date_stop = row.date_stop;
      acc = { base, spend: 0, impressions: 0, clicks: 0, reach: 0, actions: new Map(), values: new Map() };
      groups.set(key, acc);
    }
    acc.spend += Number(row.spend ?? 0);
    acc.impressions += Number(row.impressions ?? 0);
    acc.clicks += Number(row.clicks ?? 0);
    acc.reach += Number(row.reach ?? 0);
    mergeActionEntries(acc.actions, row.actions);
    mergeActionEntries(acc.values, row.action_values);
  }

  return [...groups.values()].map((acc) => {
    const actions = mapToEntries(acc.actions);
    const out: Record<string, unknown> = {
      ...acc.base,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      ctr: acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : 0,
      cpc: acc.clicks > 0 ? acc.spend / acc.clicks : 0,
      cpm: acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : 0,
      frequency: acc.reach > 0 ? acc.impressions / acc.reach : 0,
      actions,
      conversions: actions.map((a) => ({ ...a })),
      action_values: mapToEntries(acc.values),
    };
    return out;
  });
}

// ── Method handlers ─────────────────────────────────────────────────────

function buildTimeParams(timeRange: unknown, params: Record<string, unknown>): void {
  if (typeof timeRange === 'string') {
    params.period = timeRange;
  } else if (timeRange && typeof timeRange === 'object') {
    const tr = timeRange as { since?: string; until?: string };
    if (tr.since) params.from = tr.since;
    if (tr.until) params.to = tr.until;
  }
}

async function fetchAdkitInsights(
  projectId: string,
  accountId: string,
  params: Record<string, unknown>,
): Promise<{ rows: AdKitRow[]; totals?: { metrics?: Record<string, unknown>; conversionEvents?: Record<string, ConversionEvent> } }> {
  const payload = await adkitRpc('adkit_manage', {
    projectId, platform: 'meta', entity: 'results', action: 'list', accountId, params,
  });
  return {
    rows: (payload.rows ?? []) as AdKitRow[],
    totals: payload.totals as { metrics?: Record<string, unknown>; conversionEvents?: Record<string, ConversionEvent> } | undefined,
  };
}

async function adkitGetInsights(args: Record<string, unknown>): Promise<unknown> {
  if (args.time_breakdown) {
    // AdKit's results endpoint rejects time breakdowns. The insights route
    // serves day-series from meta_insights_daily instead of calling here.
    throw new Error('AdKit does not support time_breakdown; day series must come from meta_insights_daily');
  }

  const rawId = String(args.object_id ?? args.account_id ?? '');
  if (!rawId) throw new Error('No account ID provided');
  const accountId = normalizeActId(rawId);

  const level = String(args.level ?? 'account');
  const params: Record<string, unknown> = { level: LEVEL_TO_ADKIT[level] ?? 'campaigns' };
  buildTimeParams(args.time_range, params);
  if (args.breakdowns) params.breakdowns = String(args.breakdowns);

  const projectId = await resolveProjectId(accountId);
  if (!projectId) {
    throw new Error(`AdKit: account ${accountId} is not connected to any AdKit project. Connect it in AdKit.`);
  }

  const { rows: rawRows } = await fetchAdkitInsights(projectId, accountId, params);
  let data = rawRows.map((r) => translateRow(r, accountId, ''));

  if (level === 'account') {
    const groupKeys = args.breakdowns
      ? String(args.breakdowns).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    data = aggregateRows(data, groupKeys);
  }

  return wrapResponse({ data });
}

async function adkitBulkInsights(args: Record<string, unknown>): Promise<unknown> {
  const accountIds = (args.account_ids ?? []) as string[];
  const timeRange = args.time_range ?? 'last_30d';

  const results = await Promise.all(
    accountIds.map(async (acctId) => {
      try {
        const accountId = normalizeActId(acctId);
        const projectId = await resolveProjectId(accountId);
        if (!projectId) {
          return { account_id: acctId, status: 'error' as const, error: 'Not connected in AdKit' };
        }

        const params: Record<string, unknown> = { level: 'campaigns' };
        buildTimeParams(timeRange, params);

        const { rows, totals } = await fetchAdkitInsights(projectId, accountId, params);

        // Prefer report totals; fall back to summing rows.
        let spend: number;
        let events: Array<[string, ConversionEvent]>;
        if (totals?.metrics) {
          spend = Number(totals.metrics.spend ?? 0);
          events = Object.entries(totals.conversionEvents ?? {});
        } else {
          spend = rows.reduce((sum, r) => sum + Number(r.metrics?.spend ?? 0), 0);
          const merged = new Map<string, ConversionEvent>();
          for (const r of rows) {
            for (const [key, ev] of Object.entries(r.conversionEvents ?? {})) {
              if (!ev) continue;
              const existing = merged.get(key);
              merged.set(key, {
                platformKey: ev.platformKey,
                count: Number(existing?.count ?? 0) + Number(ev.count ?? 0),
                value: (existing?.value ?? 0) + Number(ev.value ?? ev.totalValue ?? 0),
              });
            }
          }
          events = [...merged.entries()];
        }

        let conversions = 0;
        let purchaseConversions = 0;
        let purchaseValue = 0;
        for (const [key, ev] of events) {
          if (!ev) continue;
          const actionType = toActionType(key, ev);
          const count = Number(ev.count ?? 0);
          if (actionType.startsWith('offsite_conversion') || actionType === 'lead') {
            conversions += count;
          }
          if (actionType.includes('purchase')) {
            purchaseConversions += count;
            purchaseValue += Number(ev.value ?? ev.totalValue ?? 0);
          }
        }

        const roas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : undefined;

        return {
          account_id: acctId,
          status: 'success' as const,
          insights: { spend, conversions, purchase_conversions: purchaseConversions, roas },
        };
      } catch (err) {
        return {
          account_id: acctId,
          status: 'error' as const,
          error: err instanceof Error ? err.message : 'Unknown',
        };
      }
    }),
  );

  const successful = results.filter((r) => r.status === 'success').length;
  const failed = results.filter((r) => r.status === 'error').length;

  return wrapResponse({
    results,
    summary: { total_accounts: results.length, successful, failed, cached: 0 },
  });
}

async function adkitGetAdAccounts(): Promise<unknown> {
  const projects = await getAdKitProjects();
  const seen = new Map<string, Record<string, unknown>>();
  for (const p of projects) {
    for (const a of p.metaAccounts) {
      if (!seen.has(a.id)) {
        seen.set(a.id, { id: a.id, name: a.name, account_status: 1 });
      }
    }
  }
  return wrapResponse({ data: [...seen.values()] });
}

// ── Response wrapper (MCP content envelope, same shape as before) ───────

function wrapResponse(data: unknown): unknown {
  const text = JSON.stringify(data);
  return { content: [{ type: 'text', text }], structuredContent: { result: text } };
}
