/**
 * GET /api/finance/arr-summary
 *
 * Powers the four Tier-1 Net New MRR enhancements on the Finance page:
 *   1. ARR + month-over-month growth rate
 *   2. Per-acquisition-source MRR breakdown (current totals + new this period)
 *   3. Trailing 6-month MRR history (from client_mrr_history snapshots + live current)
 *   4. Linear run-rate forecast (ARR projected 12 months out)
 *
 * Reads:
 *   - client_mrr_history (snapshot table populated by the monthly cron)
 *   - reporting_clients (live current state, used for fallback + current-month MRR)
 *   - square_entries (live paid invoices for current month MRR)
 *   - clients (engagement_details.acquisition_source for per-source attribution)
 *
 * CANNOT: write data. Pure aggregation.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { computeRevenueByClientId } from '@/lib/client-revenue';

type Source = 'upwork' | 'partner' | 'other' | 'unknown';

type TrailingMonth = {
  month: string;
  total_mrr: number;
  net_change_pct: number | null;
};

type ArrBySource = Record<Source, number>;

function emptySources(): ArrBySource {
  return { upwork: 0, partner: 0, other: 0, unknown: 0 };
}

function normalizeSource(raw: string | null | undefined): Source {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'upwork') return 'upwork';
  if (lower === 'partner') return 'partner';
  if (lower === 'other') return 'other';
  return 'unknown';
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const thisMonth = firstOfMonth(now);

    // -- 1. Pull canonical client info (for current-month MRR + acquisition source) --
    const { data: clientsRows, error: cErr } = await supabase
      .from('clients')
      .select('id, name, engagement_details');
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    const sourceByClientId: Record<string, Source> = {};
    const nameById: Record<string, string> = {};
    for (const c of clientsRows ?? []) {
      if (!c?.id) continue;
      nameById[c.id] = c.name;
      const ed = c.engagement_details as Record<string, unknown> | null;
      const src = ed && typeof ed.acquisition_source === 'string' ? (ed.acquisition_source as string) : null;
      sourceByClientId[c.id] = normalizeSource(src);
    }

    // -- 2. Pull active non-retainer non-AI-agent reporting_clients (for fallback MRR + filter) --
    const { data: rcRows, error: rcErr } = await supabase
      .from('reporting_clients')
      .select('client_id, monthly_revenue, client_category, status, platform');
    if (rcErr) return NextResponse.json({ error: rcErr.message }, { status: 500 });

    const activeClientIds = new Set<string>();
    const fallbackByClient: Record<string, number> = {};
    for (const r of rcRows ?? []) {
      if (!r.client_id) continue;
      if (r.status !== 'active') continue;
      if (r.client_category === 'retainer') continue;
      if (r.platform === 'other') continue;
      activeClientIds.add(r.client_id);
      const amt = Number(r.monthly_revenue ?? 0);
      if (amt > 0) fallbackByClient[r.client_id] = (fallbackByClient[r.client_id] ?? 0) + amt;
    }

    // -- 3. Live current MRR: latest paid Square invoice per client across the last 60 days --
    // Using 60d (not just this calendar month) avoids the "everyone looks churned on the
    // 1st" problem. Each client's most recent billing is their current rate.
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000).toISOString();
    const { data: squareRecent, error: sqErr } = await supabase
      .from('square_entries')
      .select('client_id, amount_cents, source_timestamp')
      .eq('payment_status', 'COMPLETED')
      .gt('amount_cents', 0)
      .not('client_id', 'is', null)
      .gte('source_timestamp', sixtyDaysAgo);
    if (sqErr) return NextResponse.json({ error: sqErr.message }, { status: 500 });

    const latestSquareByClient: Record<string, { amount: number; ts: string }> = {};
    for (const row of squareRecent ?? []) {
      const cid = row.client_id as string;
      if (!activeClientIds.has(cid)) continue;
      const ts = row.source_timestamp as string;
      const amt = Number(row.amount_cents ?? 0) / 100;
      const existing = latestSquareByClient[cid];
      if (!existing || ts > existing.ts) latestSquareByClient[cid] = { amount: amt, ts };
    }

    // Current MRR uses the SAME live fee engine the Client tab uses for "Est. Monthly
    // Revenue" so both views always agree. For percentage clients (South River, AIW,
    // Master Spa Parts, etc.) this pulls live ad spend × the rate from fee_config —
    // far more accurate than "latest paid Square invoice" which lags by a full
    // billing cycle on growing accounts. Falls back to Square / stored revenue only
    // if the fee engine returns 0 (very rare — only for clients with no fee_config
    // AND no monthly_budget AND no monthly_revenue).
    const revenueByClientId = await computeRevenueByClientId(supabase);
    let currentMrr = 0;
    const currentMrrBySource = emptySources();
    for (const cid of activeClientIds) {
      const feeEngineAmt = revenueByClientId[cid] ?? 0;
      const amt = feeEngineAmt > 0
        ? feeEngineAmt
        : (latestSquareByClient[cid]?.amount ?? fallbackByClient[cid] ?? 0);
      currentMrr += amt;
      const src = sourceByClientId[cid] ?? 'unknown';
      currentMrrBySource[src] += amt;
    }

    // -- 4. Pull last 6 months of snapshots from client_mrr_history --
    const sixMonthsAgo = addMonths(thisMonth, -5); // captures current month + 5 prior = 6 total
    const { data: histRows, error: hErr } = await supabase
      .from('client_mrr_history')
      .select('month_date, client_id, mrr_amount, acquisition_source')
      .gte('month_date', sixMonthsAgo.toISOString().slice(0, 10))
      .order('month_date', { ascending: true });
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

    // Aggregate by month
    const totalByMonth: Record<string, number> = {};
    for (const row of histRows ?? []) {
      const m = (row.month_date as string).slice(0, 7); // YYYY-MM
      totalByMonth[m] = (totalByMonth[m] ?? 0) + Number(row.mrr_amount ?? 0);
    }
    // Add current month from live data
    const currentMonthKey = monthKey(thisMonth);
    totalByMonth[currentMonthKey] = currentMrr;

    // Build trailing array for the last 6 calendar months
    const trailing: TrailingMonth[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = addMonths(thisMonth, -i);
      const key = monthKey(m);
      const total = totalByMonth[key] ?? 0;
      const prior = i < 5 ? trailing[trailing.length - 1]?.total_mrr ?? 0 : 0;
      const netChangePct = prior > 0 ? ((total - prior) / prior) * 100 : null;
      trailing.push({
        month: key,
        total_mrr: round2(total),
        net_change_pct: netChangePct !== null ? round2(netChangePct) : null,
      });
    }

    // -- 5. MoM growth (current vs prior month) --
    const priorMonthMrr = trailing.length >= 2 ? trailing[trailing.length - 2].total_mrr : 0;
    const mrrChange = currentMrr - priorMonthMrr;
    const mrrChangePct = priorMonthMrr > 0 ? (mrrChange / priorMonthMrr) * 100 : null;

    // -- 6. Run-rate forecast: MEDIAN of monthly absolute $ deltas, projected linearly --
    //    Compounding percentage growth blows up over 12-24 months for early-stage SaaS
    //    (every $51K -> $193K month becomes $193K -> $730K next year, which is unrealistic).
    //    Linear additive projection from the median month-to-month $ change is more honest
    //    for agencies at this scale and matches how operators actually plan.
    const absDeltas: number[] = [];
    for (let i = 1; i < trailing.length; i++) {
      const prior = trailing[i - 1].total_mrr;
      const curr = trailing[i].total_mrr;
      if (prior > 0 && curr > 0) absDeltas.push(curr - prior);
    }
    const sortedAbs = [...absDeltas].sort((a, b) => a - b);
    const medianMonthlyDelta = sortedAbs.length === 0
      ? 0
      : sortedAbs.length % 2 === 1
        ? sortedAbs[Math.floor(sortedAbs.length / 2)]
        : (sortedAbs[sortedAbs.length / 2 - 1] + sortedAbs[sortedAbs.length / 2]) / 2;

    // Also compute median percentage for display context
    const pctDeltas: number[] = [];
    for (let i = 1; i < trailing.length; i++) {
      const pct = trailing[i].net_change_pct;
      if (pct !== null && Number.isFinite(pct)) pctDeltas.push(pct);
    }
    const sortedPct = [...pctDeltas].sort((a, b) => a - b);
    const medianMonthlyGrowthPct = sortedPct.length === 0
      ? 0
      : sortedPct.length % 2 === 1
        ? sortedPct[Math.floor(sortedPct.length / 2)]
        : (sortedPct[sortedPct.length / 2 - 1] + sortedPct[sortedPct.length / 2]) / 2;

    // Linear projection forward
    const projectedMrr12 = Math.max(0, currentMrr + medianMonthlyDelta * 12);
    const projectedMrr24 = Math.max(0, currentMrr + medianMonthlyDelta * 24);

    // Month-by-month forecast curve (linear additive)
    const monthlyForecast: Array<{ month: string; mrr: number }> = [];
    for (let i = 1; i <= 6; i++) {
      const projected = Math.max(0, currentMrr + medianMonthlyDelta * i);
      const m = addMonths(thisMonth, i);
      monthlyForecast.push({ month: monthKey(m), mrr: round2(projected) });
    }

    // Confidence based on data quantity
    let confidence: 'low' | 'medium' | 'high' = 'low';
    if (absDeltas.length >= 5) confidence = 'high';
    else if (absDeltas.length >= 3) confidence = 'medium';

    return NextResponse.json({
      current_mrr: round2(currentMrr),
      current_arr: round2(currentMrr * 12),
      prior_month_mrr: round2(priorMonthMrr),
      mrr_change: round2(mrrChange),
      mrr_change_pct: mrrChangePct !== null ? round2(mrrChangePct) : null,
      mrr_by_source: {
        upwork: round2(currentMrrBySource.upwork),
        partner: round2(currentMrrBySource.partner),
        other: round2(currentMrrBySource.other),
        unknown: round2(currentMrrBySource.unknown),
      },
      arr_by_source: {
        upwork: round2(currentMrrBySource.upwork * 12),
        partner: round2(currentMrrBySource.partner * 12),
        other: round2(currentMrrBySource.other * 12),
        unknown: round2(currentMrrBySource.unknown * 12),
      },
      trailing_6_months: trailing,
      forecast: {
        method: 'linear_median',
        median_monthly_delta: round2(medianMonthlyDelta),
        median_monthly_growth_pct: round2(medianMonthlyGrowthPct),
        projected_mrr_12mo: round2(projectedMrr12),
        projected_arr_12mo: round2(projectedMrr12 * 12),
        projected_mrr_24mo: round2(projectedMrr24),
        projected_arr_24mo: round2(projectedMrr24 * 12),
        confidence,
        based_on_months: absDeltas.length,
        monthly_forecast: monthlyForecast,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
