/**
 * POST /api/finance/snapshot-mrr?month=YYYY-MM
 *
 * Snapshots each active non-retainer non-AI-agent client's MRR for the given
 * calendar month into client_mrr_history. Idempotent — re-running for the
 * same month upserts.
 *
 * MRR resolution (per client):
 *   1. Latest paid Square invoice in the month → 'square'
 *   2. Else sum of reporting_clients.monthly_revenue → 'fallback_reporting_clients'
 *   3. Else 0 → 'manual'
 *
 * Designed to be triggered by GitHub Actions cron on the 1st of each month
 * at ~6am CT (captures the prior month's final values).
 *
 * Returns counts per source + total snapshotted MRR.
 *
 * CANNOT: query historical snapshots (read directly from client_mrr_history).
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type Source = 'square' | 'fallback_reporting_clients' | 'manual';

function monthBounds(monthStr: string): { start: string; endExclusive: string; firstDay: string } {
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error('month must be YYYY-MM');
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonthY = m === 12 ? y + 1 : y;
  const nextMonthM = m === 12 ? 1 : m + 1;
  const endExclusive = `${nextMonthY}-${String(nextMonthM).padStart(2, '0')}-01`;
  return { start: firstDay, endExclusive, firstDay };
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get('month');
    if (!monthParam) {
      return NextResponse.json({ error: 'month parameter required, e.g. ?month=2026-05' }, { status: 400 });
    }
    const { start, endExclusive, firstDay } = monthBounds(monthParam);
    const supabase = createServiceClient();

    // Pull active non-retainer non-AI-agent clients
    const { data: rcRows, error: rcErr } = await supabase
      .from('reporting_clients')
      .select('client_id, monthly_revenue, client_category, status, platform')
      .eq('status', 'active');
    if (rcErr) return NextResponse.json({ error: rcErr.message }, { status: 500 });

    const activeClientIds = new Set<string>();
    const fallbackByClient: Record<string, number> = {};
    for (const r of rcRows ?? []) {
      if (!r.client_id) continue;
      if (r.client_category === 'retainer') continue;
      if (r.platform === 'other') continue;
      activeClientIds.add(r.client_id);
      const amt = Number(r.monthly_revenue ?? 0);
      if (amt > 0) fallbackByClient[r.client_id] = (fallbackByClient[r.client_id] ?? 0) + amt;
    }

    // Pull canonical client info
    const { data: clientsRows, error: cErr } = await supabase
      .from('clients')
      .select('id, name, engagement_details')
      .in('id', Array.from(activeClientIds));
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    // Pull paid Square invoices in the month
    const { data: squareRows, error: sErr } = await supabase
      .from('square_entries')
      .select('client_id, amount_cents, source_timestamp')
      .eq('payment_status', 'COMPLETED')
      .gt('amount_cents', 0)
      .not('client_id', 'is', null)
      .gte('source_timestamp', start)
      .lt('source_timestamp', endExclusive);
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    // Latest paid invoice per client
    const latestByClient: Record<string, { amount: number; ts: string }> = {};
    for (const row of squareRows ?? []) {
      const cid = row.client_id as string;
      const ts = row.source_timestamp as string;
      const amt = Number(row.amount_cents ?? 0) / 100;
      const existing = latestByClient[cid];
      if (!existing || ts > existing.ts) latestByClient[cid] = { amount: amt, ts };
    }

    // Build upsert payload
    const rows = (clientsRows ?? []).map(c => {
      const sqAmt = latestByClient[c.id]?.amount;
      const fbAmt = fallbackByClient[c.id];
      const mrr = sqAmt ?? fbAmt ?? 0;
      const source: Source = sqAmt != null ? 'square' : (fbAmt != null ? 'fallback_reporting_clients' : 'manual');
      const acquisitionSource =
        (c.engagement_details && typeof c.engagement_details === 'object' && 'acquisition_source' in c.engagement_details)
          ? (c.engagement_details as Record<string, unknown>).acquisition_source as string | null
          : null;
      return {
        month_date: firstDay,
        client_id: c.id,
        client_name: c.name,
        mrr_amount: mrr,
        source,
        acquisition_source: acquisitionSource ?? null,
        client_category: 'active',
        snapshot_at: new Date().toISOString(),
      };
    });

    const { error: upsertErr } = await supabase
      .from('client_mrr_history')
      .upsert(rows, { onConflict: 'month_date,client_id' });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    // Summary
    const summary = { square: { count: 0, total: 0 }, fallback_reporting_clients: { count: 0, total: 0 }, manual: { count: 0, total: 0 } };
    let grandTotal = 0;
    for (const r of rows) {
      summary[r.source].count += 1;
      summary[r.source].total += r.mrr_amount;
      grandTotal += r.mrr_amount;
    }

    return NextResponse.json({
      month: monthParam,
      clients_snapshotted: rows.length,
      total_mrr: Math.round(grandTotal * 100) / 100,
      by_source: summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
