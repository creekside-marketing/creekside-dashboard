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

/**
 * Map a PipeBoard-style method name to AdKit's adkit_manage call.
 * Returns the tool name and arguments for AdKit's JSON-RPC endpoint.
 */
function mapToAdKit(method: string, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
  const accountId = String(args.object_id ?? args.account_id ?? '');

  switch (method) {
    case 'get_insights': {
      const params: Record<string, unknown> = {};
      if (args.level) params.level = args.level;

      // Map time_range
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
        arguments: {
          platform: 'meta',
          entity: 'results',
          action: 'list',
          accountId,
          params,
        },
      };
    }

    case 'get_ad_accounts':
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'accounts',
          action: 'list',
        },
      };

    case 'get_campaigns':
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'campaigns',
          action: 'list',
          accountId,
        },
      };

    case 'get_adsets':
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'adsets',
          action: 'list',
          accountId,
        },
      };

    case 'get_ads':
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'ads',
          action: 'list',
          accountId,
        },
      };

    case 'bulk_get_insights': {
      // AdKit doesn't have a bulk endpoint — pass through as individual per-account calls
      // For now, use adkit_manage with results entity
      const accountIds = (args.account_ids ?? []) as string[];
      const timeRange = args.time_range;
      const params: Record<string, unknown> = { level: 'account' };
      if (typeof timeRange === 'string') params.period = timeRange;

      // We can only call one account at a time via adkit_manage
      // Return results for the first account and let the caller handle batching
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'results',
          action: 'list',
          accountId: accountIds[0] ?? '',
          params,
        },
      };
    }

    case 'bulk_get_ad_creatives': {
      // Map to ads entity with creative details
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: 'ads',
          action: 'list',
          accountId,
        },
      };
    }

    default:
      // Pass through as-is for unsupported methods
      return {
        name: 'adkit_manage',
        arguments: {
          platform: 'meta',
          entity: method.replace('get_', ''),
          action: 'list',
          accountId,
          params: args,
        },
      };
  }
}

/** Call AdKit MCP endpoint via JSON-RPC. */
async function callAdKit(method: string, args: Record<string, unknown> = {}) {
  const token = process.env.ADKIT_API_KEY;
  if (!token) throw new Error('ADKIT_API_KEY not configured');

  const mapped = mapToAdKit(method, args);

  // AdKit requires a projectId — resolve from env or skip if not set
  const projectId = process.env.ADKIT_PROJECT_ID;
  if (projectId && !mapped.arguments.projectId) {
    mapped.arguments.projectId = projectId;
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
      params: {
        name: mapped.name,
        arguments: mapped.arguments,
      },
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
    const msg = result.content?.[0]?.text
      ?? 'Unknown AdKit error';
    // Try to parse the error JSON for a better message
    try {
      const parsed = JSON.parse(msg);
      throw new Error(`AdKit error: ${parsed.error ?? msg}`);
    } catch {
      throw new Error(`AdKit error: ${msg}`);
    }
  }

  return result;
}
