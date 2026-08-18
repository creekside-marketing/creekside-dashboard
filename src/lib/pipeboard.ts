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
  // Try direct Graph API first (if token exists and method is supported)
  if (process.env.META_ADS_ACCESS_TOKEN && isGraphSupported(method)) {
    try {
      const result = await callMetaGraphAPI(method, args);
      return result;
    } catch (graphError) {
      console.warn(
        `[meta-graph] ${method} failed, falling back to AdKit:`,
        graphError instanceof Error ? graphError.message : graphError,
      );
      // Fall through to AdKit
    }
  }

  // AdKit fallback
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
const PROJECT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Fetch all AdKit projects and their connected account IDs. */
async function getAdKitProjects(): Promise<AdKitProject[]> {
  if (projectCache && Date.now() - projectCacheTime < PROJECT_CACHE_TTL) {
    return projectCache;
  }

  const token = process.env.ADKIT_API_KEY;
  if (!token) return [];

  try {
    // Step 1: list all projects
    const listResp = await fetch(ADKIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'adkit_projects', arguments: { action: 'list', limit: 50 } },
      }),
    });
    if (!listResp.ok) return [];

    const listData = await listResp.json();
    const listText = listData?.result?.content?.[0]?.text;
    if (!listText) return [];
    const parsed = JSON.parse(listText);
    const rawProjects = parsed.projects ?? [];

    // Step 2: for projects with connected accounts, get their account IDs
    const projects: AdKitProject[] = [];
    for (const p of rawProjects) {
      const metaCount = p.platforms?.meta ?? 0;
      const googleCount = p.platforms?.google ?? 0;
      if (metaCount === 0 && googleCount === 0) continue;

      // Get status to resolve account IDs
      const statusResp = await fetch(ADKIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'tools/call',
          params: { name: 'adkit_status', arguments: { projectId: p.projectId } },
        }),
      });

      const metaIds: string[] = [];
      const googleIds: string[] = [];

      if (statusResp.ok) {
        const statusData = await statusResp.json();
        const statusText = statusData?.result?.content?.[0]?.text;
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
      }

      projects.push({
        projectId: p.projectId,
        name: p.name,
        metaAccountIds: metaIds,
        googleAccountIds: googleIds,
      });
    }

    projectCache = projects;
    projectCacheTime = Date.now();
    console.log(`[adkit] Cached ${projects.length} projects with connected accounts`);
    return projects;
  } catch (err) {
    console.error('[adkit] Failed to fetch projects:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** Resolve an ad account ID to an AdKit projectId. */
async function resolveProjectId(accountId: string): Promise<string | null> {
  const projects = await getAdKitProjects();
  for (const p of projects) {
    if (p.metaAccountIds.includes(accountId)) return p.projectId;
    // Also check without act_ prefix for Google
    const numericId = accountId.replace('act_', '');
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
      // AdKit only accepts campaigns/adsets/ads, not "account" or "campaign"
      if (level === 'account' || level === 'campaign') {
        params.level = 'campaigns';
      } else {
        params.level = level;
      }

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
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'campaigns', action: 'list', accountId },
      };

    case 'get_adsets':
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'adsets', action: 'list', accountId },
      };

    case 'get_ads':
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'ads', action: 'list', accountId },
      };

    case 'bulk_get_insights': {
      const accountIds = (args.account_ids ?? []) as string[];
      const timeRange = args.time_range;
      const params: Record<string, unknown> = { level: 'campaigns' };
      if (typeof timeRange === 'string') params.period = timeRange;

      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'results', action: 'list', accountId: accountIds[0] ?? '', params },
      };
    }

    case 'bulk_get_ad_creatives':
      return {
        name: 'adkit_manage',
        arguments: { platform: 'meta', entity: 'ads', action: 'list', accountId },
      };

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

  const mapped = mapToAdKit(method, args);

  // Resolve projectId from the account ID
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

  const response = await fetch(ADKIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: mapped.name, arguments: mapped.arguments },
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
