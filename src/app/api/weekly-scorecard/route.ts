import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Auto-generate current week's snapshot via DB function
    await supabase.rpc('generate_weekly_snapshot');

    // Get current MRR from reporting_clients for goal tracking
    const { data: clients } = await supabase
      .from('reporting_clients')
      .select('client_name, platform, monthly_budget')
      .eq('status', 'active');

    const clientBudgets: Record<string, { total: number; platforms: Set<string> }> = {};
    for (const row of clients ?? []) {
      if (!clientBudgets[row.client_name]) {
        clientBudgets[row.client_name] = { total: 0, platforms: new Set() };
      }
      clientBudgets[row.client_name].total += row.monthly_budget ?? 0;
      if (row.platform) {
        clientBudgets[row.client_name].platforms.add(row.platform.toLowerCase());
      }
    }

    let currentMRR = 0;
    for (const info of Object.values(clientBudgets)) {
      currentMRR += calcFee(info.total, info.platforms.size);
    }

    // MRR Goal: $50K by 6/30/26
    const targetMRR = 50000;
    const goalDate = '6/30/26';
    const goalDateObj = new Date('2026-06-30');
    const now = new Date();
    const weeksRemaining = Math.max(0, Math.ceil((goalDateObj.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const mrrGap = targetMRR - currentMRR;
    const mrrNeededPerWeek = weeksRemaining > 0 ? mrrGap / weeksRemaining : 0;

    // Fetch last 12 weeks of scorecard data
    const { data: weeklyData } = await supabase
      .from('weekly_scorecard')
      .select('*')
      .order('week_of', { ascending: false })
      .limit(12);

    const weeks = (weeklyData ?? []).map((w: Record<string, unknown>) => ({
      weekOf: w.week_of as string,
      currentClients: (w.current_clients as number) ?? 0,
      projectedMRR: (w.projected_mrr as number) ?? 0,
      newMRR: (w.new_mrr as number) ?? 0,
      lostMRR: (w.lost_mrr as number) ?? 0,
      netNewMRR: (w.net_new_mrr as number) ?? 0,
      callsBooked: (w.calls_booked as number) ?? 0,
      callsShowed: (w.calls_showed as number) ?? 0,
      dealsClose: (w.deals_closed as number) ?? 0,
      closeRate: (w.close_rate as number) ?? 0,
      qualifiedCallRate: (w.qualified_call_rate as number) ?? 0,
      qaErrors: (w.qa_errors as number) ?? 0,
      lostClients: (w.lost_clients as number) ?? 0,
      mrrAtRisk: (w.mrr_at_risk as number) ?? 0,
      activeOnboarding: (w.active_onboarding as number) ?? 0,
    }));

    return NextResponse.json({
      goal: {
        targetMRR,
        goalDate,
        currentMRR: Math.round(currentMRR),
        mrrNeededPerWeek: Math.round(Math.max(0, mrrNeededPerWeek)),
        weeksRemaining,
        onTrack: currentMRR >= targetMRR || mrrNeededPerWeek <= 2000,
      },
      weeks,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

function calcFee(totalAdSpend: number, platformCount: number): number {
  if (totalAdSpend <= 0) return 0;
  let fee = 0;
  let remaining = totalAdSpend;

  const t1 = Math.min(remaining, 15000);
  fee += t1 * 0.20;
  remaining -= t1;

  if (remaining > 0) {
    const t2 = Math.min(remaining, 15000);
    fee += t2 * 0.15;
    remaining -= t2;
  }

  if (remaining > 0) {
    const t3 = Math.min(remaining, 15000);
    fee += t3 * 0.10;
    remaining -= t3;
  }

  if (remaining > 0) {
    fee += remaining * 0.05;
  }

  const minimum = platformCount >= 2 ? 2000 : 1000;
  return Math.max(fee, minimum);
}
