import { callMetaGraphAPI, isGraphSupported } from './meta-graph';

const ADKIT_URL = 'https://mcp.adkit.so';

/**
 * Call a Meta Ads API method.
 *
 * Routing: Graph API first (free, system-user token), AdKit fallback.
 * If META_ADS_ACCESS_TOKEN is set AND the method is supported, uses direct Graph API.
 * Otherwise (or on Graph API failure), falls back to AdKit MCP.
 */
export async function callPipeboard(method: string, args: Record<string, unknown> = {}) {
  if (process.env.META_ADS_ACCESS_TOKEN && isGraphSupported(method)) {
    try {
      const result = await callMetaGraphAPI(method, args);
      return result;
    } catch (graphError) {
      console.warn(
        `[meta-graph] ${method} failed, falling back to AdKit:`,
        graphError instanceof Error ? graphError.message : graphError,
      );
    }
  }

  return callAdKit(method, args);
}

// ── AdKit project resolution ────────────────────────────────────────────

interface AdKitProject {
  projectId: string;
  name: string;
  metaAccountIds: string[];
  googleAccountIds: string[];
}

let projectCache: AdKitProject[] | null = null;
let projectCacheTime = 0;
const PROJECT_CACHE_TTL = 10 * 60 * 1000;

async function adkitCall(token: string, toolName: string, toolArgs: Record<string, unknown>): Promise<string | null> {
  const resp = await fetch(ADKIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data?.result?.content?.[0]?.text ?? null;
}

async function getAdKitProjects(): Promise<AdKitProject[]> {
  if (projectCache && Date.now() - projectCacheTime < PROJECT_CACHE_TTL) {
    return projectCache;
  }

  const token = process.env.ADKIT_API_KEY;
  if (!token) return [];

  try {
    const listText = await adkitCall(token, 'adkit_projects', { action: 'list', limit: 50 });
    if (!listText) return [];
    const parsed = JSON.parse(listText);
    const rawProjects = parsed.projects ?? [];

    const connectedProjects = rawProjects.filter(
      (p: { platforms?: Record<string, number> }) =>
        (p.platforms?.meta ?? 0) > 0 || (p.platforms?.google ?? 0) > 0,
    );

    // Fetch status for all connected projects in parallel
    const statusResults = await Promise.all(
      connectedProjects.map(async (p: { projectId: string; name: string }) => {
        const statusText = await adkitCall(token, 'adkit_status', { projectId: p.projectId });
        const metaIds: string[] = [];
        const googleIds: string[] = [];
        if (statusText) {
          const status = JSON.parse(statusText);
          const platforms = status.platforms ?? {};
          for (const acct of platforms.meta?.accounts ?? []) {
            if (acct.id) metaIds.push(acct.id);
          }
          for (const acct of platforms.google?.accounts ?? []) {
            if (acct.id) googleIds.push(acct.id);
          }
        }
        return { projectId: p.projectId, name: p.name, metaAccountIds: metaIds, googleAccountIds: googleIds };
      }),
    );

    // Only cache non-empty results
    if (statusResults.length > 0) {
      projectCache = statusResults;
      projectCacheTime = Date.now();
    }
    return statusResults;
  } catch {
    return [];
  }
}

async function resolveProjectId(accountId: string): Promise<string | null> {
  const projects = await getAdKitProjects();
  const numericId = accountId.replace('act_', '');
  for (const p of projects) {
    if (p.metaAccountIds.includes(accountId)) return p.projectId;
    if (p.googleAccountIds.includes(numericId)) return p.projectId;
    if (p.googleAccountIds.includes(accountId)) return p.projectId;
  }
  return null;
}

// ── Method mapping ──────────────────────────────────────────────────────

function mapToAdKit(method: string, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
  const accountId = String(args.object_id ?? args.account_id ?? '');

  switch (method) {
    case 'get_insights': {
      const params: Record<string, unknown> = {};
      const level = String(args.level ?? 'campaigns');
      params.level = (level === 'account' || level === 'campaign') ? 'campaigns' : level;

      const timeRange = args.time_range;
      if (typeof timeRange === 'string') {
        params.period = timeRange;
      } else if (timeRange && typeof timeRange === 'object') {
        const tr = timeRange as { since?: string; until?: string };
        if (tr.since) params.from = tr.since;
        if (tr.until) params.to = tr.until;
      }
      if (args.breakdowns) params.breakdowns = args.breakdowns;
      if (args.time_breakdown) params.breakdown = args.time_breakdown;
      if (args.fields) params.fields = args.fields;

      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'results', action: 'list', accountId, params },
      };
    }

    case 'get_ad_accounts':
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'accounts', action: 'list' },
      };

    case 'get_campaigns':
      return { name: 'adkit_manage', arguments: { platform: 'meta', entity: 'campaigns', action: 'list', accountId } };

    case 'get_adsets':
      return { name: 'adkit_manage', arguments: { platform: 'meta', entity: 'adsets', action: 'list', accountId } };

    case 'get_ads':
      return { name: 'adkit_manage', arguments: { platform: 'meta', entity: 'ads', action: 'list', accountId } };

    case 'bulk_get_ad_creatives':
      return { name: 'adkit_manage', arguments: { platform: 'meta', entity: 'ads', action: 'list', accountId } };

    default:
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: method.replace('get_', ''), action: 'list', accountId, params: args },
      };
  }
}

// ── AdKit caller ────────────────────────────────────────────────────────

async function callAdKit(method: string, args: Record<string, unknown> = {}) {
  const token = process.env.ADKIT_API_KEY;
  if (!token) throw new Error('ADKIT_API_KEY not configured');

  // bulk_get_insights: fan out per account, return combined results
  if (method === 'bulk_get_insights') {
    return callAdKitBulkInsights(token, args);
  }

  const mapped = mapToAdKit(method, args);

  // get_ad_accounts doesn't need a projectId -- uses any connected project
  const needsProject = method !== 'get_ad_accounts';

  if (needsProject) {
    const accountId = String(mapped.arguments.accountId ?? args.object_id ?? args.account_id ?? '');
    if (accountId) {
      const projectId = await resolveProjectId(accountId);
      if (projectId) {
        mapped.arguments.projectId = projectId;
      }
    }
    if (!mapped.arguments.projectId) {
      throw new Error(`AdKit: no project found for account ${accountId}. Connect this account in AdKit.`);
    }
  } else {
    // For accounts listing, use any project that has Meta connected
    const projects = await getAdKitProjects();
    const metaProject = projects.find(p => p.metaAccountIds.length > 0);
    if (metaProject) {
      mapped.arguments.projectId = metaProject.projectId;
    }
  }

  return callAdKitRaw(token, mapped.name, mapped.arguments);
}

/** Fan out bulk_get_insights across all requested accounts in parallel. */
async function callAdKitBulkInsights(token: string, args: Record<string, unknown>) {
  const accountIds = (args.account_ids ?? []) as string[];
  const timeRange = args.time_range;
  const params: Record<string, unknown> = { level: 'campaigns' };
  if (typeof timeRange === 'string') params.period = timeRange;

  const results = await Promise.all(
    accountIds.map(async (acctId) => {
      try {
        const projectId = await resolveProjectId(acctId);
        if (!projectId) {
          return { account_id: acctId, status: 'error', error: 'No AdKit project' };
        }
        const text = await adkitCall(token, 'adkit_manage', {
          projectId, platform: 'meta', entity: 'results', action: 'list', accountId: acctId, params,
        });
        if (!text) return { account_id: acctId, status: 'error', error: 'Empty response' };

        const parsed = JSON.parse(text);
        if (parsed.error) return { account_id: acctId, status: 'error', error: parsed.error };

        const totals = parsed.totals?.metrics ?? {};
        return {
          account_id: acctId,
          status: 'success',
          insights: {
            spend: totals.spend ?? 0,
            conversions: 0,
            purchase_conversions: 0,
          },
        };
      } catch (err) {
        return { account_id: acctId, status: 'error', error: err instanceof Error ? err.message : 'Unknown' };
      }
    }),
  );

  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;

  // Wrap in the same shape the route files expect
  return wrapAdKitResponse({
    results,
    summary: { total_accounts: results.length, successful, failed, cached: 0 },
  });
}

function wrapAdKitResponse(data: unknown): unknown {
  const text = JSON.stringify(data);
  return { content: [{ type: 'text', text }], structuredContent: { result: text } };
}

async function callAdKitRaw(token: string, toolName: string, toolArgs: Record<string, unknown>) {
  const response = await fetch(ADKIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    }),
  });

  if (!response.ok) {
    throw new Error(`AdKit error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`AdKit RPC error: ${data.error.message}`);
  }

  const result = data.result;
  if (result?.isError) {
    const msg = result.content?.[0]?.text ?? 'Unknown AdKit error';
    try {
      const parsed = JSON.parse(msg);
      throw new Error(`AdKit error: ${parsed.error ?? msg}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('AdKit error:')) throw e;
      throw new Error(`AdKit error: ${msg}`);
    }
  }

  return result;
}
