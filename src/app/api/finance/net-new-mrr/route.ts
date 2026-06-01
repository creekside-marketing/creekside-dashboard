/**
 * GET /api/finance/net-new-mrr?month=YYYY-MM
 *
 * Computes the Net New MRR breakdown for a target month:
 *
 *   Net New MRR = New + Expansion - Contraction - Churn
 *
 *   - NEW         = sum of MRR for clients whose first invoice is in target month
 *   - EXPANSION   = sum of MRR increases on clients who paid in both months
 *   - CONTRACTION = sum of MRR decreases on clients who paid in both months
 *   - CHURN       = sum of MRR for clients who paid last month but not this month
 *
 * MRR per client per month = amount of the LATEST paid Square invoice dated in that
 * month (closest proxy to "their current monthly fee"). Falls back to
 * reporting_clients.monthly_revenue for clients not yet in Square (currently
 * Lindsey's 4 brought clients; they onboard to Square in June 2026).
 *
 * Excluded from the math (per design decisions):
 *   - reporting_clients.client_category = 'retainer'   (retainer revenue is separate)
 *   - reporting_clients.platform = 'other'             (AI Agent rows aren't real MRR)
 *
 * For the NEW bucket, looks up clients.engagement_details.acquisition_source
 * so the response also reports new MRR split by source (upwork / other / unknown).
 *
 * Default target month = current month. Returns full breakdown plus per-client
 * detail rows for each bucket.
 *
 * READ-ONLY. No writes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Bucket = 'new' | 'expansion' | 'contraction' | 'churn';

interface PerClientRow {
  client_id: string | null;
  client_name: string;
  this_month_mrr: number;
  last_month_mrr: number;
  delta: number;
  bucket: Bucket | 'no_change';
  acquisition_source: string | null;
}

function rollingWindow(daysAgoStart: number, daysAgoEnd: number) {
  const now = Date.now();
  const start = new Date(now - daysAgoStart * 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(now - daysAgoEnd * 24 * 60 * 60 * 1000).toISOString();
  return { start, end };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    // Default = last 30 days vs prior 30 days. Configurable via ?windowDays= for analytics.
    const windowDays = Math.max(7, Math.min(120, Number(searchParams.get('windowDays') ?? 30)));
    const thisWindow = rollingWindow(windowDays, 0);
    const prevWindow = rollingWindow(windowDays * 2, windowDays);
    const thisStart = thisWindow.start;
    const thisEnd = thisWindow.end;
    const prevStart = prevWindow.start;
    const prevEnd = prevWindow.end;

    const supabase = createServiceClient();

    // 1. Pull paid Square invoices spanning both windows (~60 days total).
    const { data: squareRows, error: sqErr } = await supabase
      .from('square_entries')
      .select('client_id, amount_cents, source_timestamp, customer_name')
      .eq('data_type', 'payment')
      .eq('payment_status', 'COMPLETED')
      .gte('source_timestamp', prevStart)
      .lte('source_timestamp', thisEnd);

    if (sqErr) return NextResponse.json({ error: `square_entries read failed: ${sqErr.message}` }, { status: 500 });

    // 2. Determine which client_ids to include — must have at least one active,
    //    non-retainer, non-'other'-platform reporting_clients row.
    const { data: rcRows } = await supabase
      .from('reporting_clients')
      .select('client_id, client_category, status, platform, monthly_revenue');

    const eligibleIds = new Set<string>();
    const fallbackMrrById: Record<string, number> = {};
    for (const r of rcRows ?? []) {
      const id = r.client_id as string | null;
      if (!id) continue;
      const cat = (r.client_category ?? 'active') as string;
      const status = (r.status ?? 'active') as string;
      const platform = (r.platform ?? '') as string;
      if (cat !== 'retainer' && status !== 'churned' && platform !== 'other') {
        eligibleIds.add(id);
        fallbackMrrById[id] = (fallbackMrrById[id] ?? 0) + Number(r.monthly_revenue ?? 0);
      }
    }

    // 3. latestInWindow(client, start, end) = amount of the latest paid Square invoice
    //    for this client whose source_timestamp falls in [start, end]. Returns 0 if none.
    function latestInWindow(clientId: string, windowStart: string, windowEnd: string): number {
      let best = 0;
      let bestTsStr = '';
      for (const row of squareRows ?? []) {
        if (row.client_id !== clientId) continue;
        const tsStr = row.source_timestamp as string;
        if (tsStr < windowStart || tsStr > windowEnd) continue;
        if (tsStr > bestTsStr) {
          bestTsStr = tsStr;
          best = Number(row.amount_cents ?? 0) / 100;
        }
      }
      return best;
    }

    // 4. Build per-client comparison for every eligible client.
    const { data: clientsData, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, engagement_details');

    if (clientsErr) {
      return NextResponse.json({ error: `clients read failed: ${clientsErr.message}` }, { status: 500 });
    }

    const clientMeta = new Map<string, { name: string; source: string | null; status: string }>();
    for (const c of clientsData ?? []) {
      clientMeta.set(c.id as string, {
        name: c.name as string,
        source: (c.engagement_details as { acquisition_source?: string } | null)?.acquisition_source ?? null,
        status: (c.status as string) ?? 'active',
      });
    }

    const rows: PerClientRow[] = [];
    for (const id of eligibleIds) {
      const meta = clientMeta.get(id);
      if (!meta) continue;

      let thisMrr = latestInWindow(id, thisStart, thisEnd);
      let lastMrr = latestInWindow(id, prevStart, prevEnd);

      // Fallback: client has no Square data at all → use stored monthly_revenue
      // for both months (treated as steady-state, no expansion or contraction).
      const noSquareEver = thisMrr === 0 && lastMrr === 0;
      if (noSquareEver && (fallbackMrrById[id] ?? 0) > 0) {
        thisMrr = fallbackMrrById[id];
        lastMrr = fallbackMrrById[id];
      }

      // Churn override: client marked status='churned' counts as 0 this month.
      if (meta.status === 'churned' || meta.status === 'inactive') thisMrr = 0;

      const delta = thisMrr - lastMrr;
      let bucket: Bucket | 'no_change' = 'no_change';
      if (lastMrr === 0 && thisMrr > 0) bucket = 'new';
      else if (lastMrr > 0 && thisMrr === 0) bucket = 'churn';
      else if (delta > 0.01) bucket = 'expansion';
      else if (delta < -0.01) bucket = 'contraction';

      if (bucket === 'no_change') continue;

      rows.push({
        client_id: id,
        client_name: meta.name,
        this_month_mrr: round2(thisMrr),
        last_month_mrr: round2(lastMrr),
        delta: round2(delta),
        bucket,
        acquisition_source: meta.source,
      });
    }

    // 5. Aggregate.
    const newRows = rows.filter(r => r.bucket === 'new');
    const expRows = rows.filter(r => r.bucket === 'expansion');
    const conRows = rows.filter(r => r.bucket === 'contraction');
    const chrRows = rows.filter(r => r.bucket === 'churn');

    const summary = {
      new_mrr: round2(newRows.reduce((s, r) => s + r.this_month_mrr, 0)),
      expansion_mrr: round2(expRows.reduce((s, r) => s + r.delta, 0)),
      contraction_mrr: round2(conRows.reduce((s, r) => s + Math.abs(r.delta), 0)),
      churn_mrr: round2(chrRows.reduce((s, r) => s + r.last_month_mrr, 0)),
      net_new_mrr: 0,
    };
    summary.net_new_mrr = round2(summary.new_mrr + summary.expansion_mrr - summary.contraction_mrr - summary.churn_mrr);

    const newBySource = newRows.reduce<Record<string, number>>((acc, r) => {
      const key = r.acquisition_source ?? 'unknown';
      acc[key] = round2((acc[key] ?? 0) + r.this_month_mrr);
      return acc;
    }, {});

    return NextResponse.json({
      window_days: windowDays,
      this_window: { start: thisStart, end: thisEnd },
      prev_window: { start: prevStart, end: prevEnd },
      summary,
      new_by_source: newBySource,
      new_clients: newRows.sort((a, b) => b.this_month_mrr - a.this_month_mrr),
      expansion_clients: expRows.sort((a, b) => b.delta - a.delta),
      contraction_clients: conRows.sort((a, b) => a.delta - b.delta),
      churn_clients: chrRows.sort((a, b) => b.last_month_mrr - a.last_month_mrr),
      _debug: searchParams.get('debug') === 'true' ? {
        this_window: { start: thisStart, end: thisEnd },
        prev_window: { start: prevStart, end: prevEnd },
        square_payments_in_window: (squareRows ?? []).length,
        reporting_clients_total: (rcRows ?? []).length,
        eligible_client_count: eligibleIds.size,
        clients_meta_count: clientMeta.size,
        first_square_row: (squareRows ?? [])[0] ?? null,
      } : undefined,
      notes: [
        `Last ${windowDays} days vs prior ${windowDays} days.`,
        'MRR = latest paid Square invoice in the window per client.',
        'Excludes retainer-category rows and platform="other" (AI Agent) rows.',
        'Clients with no Square data fall back to reporting_clients.monthly_revenue (no expansion/contraction).',
      ],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
