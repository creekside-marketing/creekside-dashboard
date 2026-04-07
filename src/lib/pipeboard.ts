const PIPEBOARD_URL = 'https://meta-ads.mcp.pipeboard.co';

export async function callPipeboard(method: string, args: Record<string, unknown> = {}) {
  const token = process.env.PIPEBOARD_API_KEY;
  if (!token) throw new Error('PIPEBOARD_API_KEY not configured');

  // PipeBoard requires token as URL query parameter (per their docs)
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

  return data.result;
}
