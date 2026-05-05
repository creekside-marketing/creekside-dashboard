/**
 * Server-side live ad spend fetcher.
 *
 * Mirrors what ClientTable does client-side: bulk-fetch Meta insights via PipeBoard,
 * fetch each Google account via the Google Ads SDK, return a flat Map<ad_account_id, spend>.
 *
 * Used by the Finance API to compute projected revenue using actual current spend
 * (matching the Clients dashboard tile exactly), rather than the budget proxy.
 *
 * CANNOT: mutate state, run in the browser, write to the DB.
 */

import { callPipeboard } from '@/lib/pipeboard';
import { getCustomer } from '@/lib/google-ads';

type AccountRef = { ad_account_id: string; platform: string };

/** Unwrap PipeBoard's MCP JSON-RPC envelope. */
function unwrapPipeboardResponse(json: Record<string, unknown>): Record<string, unknown> {
  if (json.structuredContent) {
    const sc = json.structuredContent as Record<string, unknown>;
    if (typeof sc.result === 'string') {
      try { return JSON.parse(sc.result); } catch { /* fall through */ }
    }
  }
  if (Array.isArray(json.content) && json.content.length > 0) {
    const first = json.content[0] as Record<string, unknown>;
    if (typeof first.text === 'string') {
      try { return JSON.parse(first.text); } catch { /* fall through */ }
    }
  }
  return json;
}

/**
 * Fetch live last-30-day spend per ad_account_id.
 * Returns a Map keyed by ad_account_id with spend in dollars.
 * Accounts that error or have no spend are simply omitted from the map (caller falls back).
 */
export async function fetchLiveSpend(accounts: AccountRef[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  const metaIds = new Set<string>();
  const googleIds = new Set<string>();
  for (const a of accounts) {
    if (!a.ad_account_id) continue;
    const p = a.platform?.toLowerCase();
    if (p === 'meta') metaIds.add(a.ad_account_id);
    else if (p === 'google') googleIds.add(a.ad_account_id);
  }

  // Bulk Meta call
  if (metaIds.size > 0) {
    try {
      const raw = await callPipeboard('bulk_get_insights', {
        level: 'account',
        account_ids: [...metaIds],
        time_range: 'last_30d',
        limit: 50,
      });
      const unwrapped = unwrapPipeboardResponse(raw as Record<string, unknown>);
      const results = (unwrapped as { results?: Array<Record<string, unknown>> }).results ?? [];
      for (const acct of results) {
        if (acct.status !== 'success') continue;
        const acctId = (acct.account_id as string) ?? '';
        const insights = acct.insights as Record<string, unknown> | undefined;
        if (!insights) continue;
        const spend = Number(insights.spend ?? 0);
        // Match how ClientTable keys the map: prefer the original id, fall back to act_-prefixed
        const keyId = metaIds.has(acctId)
          ? acctId
          : metaIds.has(`act_${acctId}`)
            ? `act_${acctId}`
            : acctId;
        result.set(keyId, spend);
      }
    } catch {
      // swallow — caller falls back to budget proxy for unmapped accounts
    }
  }

  // Per-account Google calls in parallel
  if (googleIds.size > 0) {
    await Promise.all([...googleIds].map(async (customerId) => {
      try {
        const customer = getCustomer(customerId);
        const rows = await customer.query(`
          SELECT metrics.cost_micros
          FROM customer
          WHERE segments.date DURING LAST_30_DAYS
        `);
        let micros = 0;
        for (const row of rows as Array<{ metrics?: { cost_micros?: number | string } }>) {
          micros += Number(row.metrics?.cost_micros ?? 0);
        }
        result.set(customerId, micros / 1_000_000);
      } catch {
        // swallow
      }
    }));
  }

  return result;
}
