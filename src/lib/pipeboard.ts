import { callMetaGraphAPI, isGraphSupported } from './meta-graph';

const PIPEBOARD_URL = 'https://meta-ads.mcp.pipeboard.co';

/**
 * Call a Meta Ads API method.
 *
 * Routing: Graph API first (free, system-user token), PipeBoard fallback ($20/mo backup).
 * If META_ADS_ACCESS_TOKEN is set AND the method is supported, uses direct Graph API.
 * Otherwise (or on Graph API failure), falls back to PipeBoard.
 */
export async function callPipeboard(method: string, args: Record<string, unknown> = {}) {
  // Try direct Graph API first (if token exists and method is supported)
  if (process.env.META_ADS_ACCESS_TOKEN && isGraphSupported(method)) {
    try {
      const result = await callMetaGraphAPI(method, args);
      return result;
    } catch (graphError) {
      console.warn(
        `[meta-graph] ${method} failed, falling back to PipeBoard:`,
        graphError instanceof Error ? graphError.message : graphError,
      );
      // Fall through to PipeBoard
    }
  }

  // PipeBoard fallback
  return callPipeboardDirect(method, args);
}

/** Original PipeBoard JSON-RPC call. */
async function callPipeboardDirect(method: string, args: Record<string, unknown> = {}) {
  const token = process.env.PIPEBOARD_API_KEY;
  if (!token) throw new Error('PIPEBOARD_API_KEY not configured');

  const response = await fetch(`${PIPEBOARD_URL}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: method,
        arguments: args,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`PipeBoard error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`PipeBoard RPC error: ${data.error.message}`);
  }

  // PipeBoard returns token errors inside result.isError (not top-level error)
  const result = data.result;
  if (result?.isError) {
    const msg = result.structuredContent?.error_description
      ?? result.content?.[0]?.text
      ?? 'Unknown PipeBoard error';
    throw new Error(`PipeBoard error: ${msg}`);
  }

  return result;
}
