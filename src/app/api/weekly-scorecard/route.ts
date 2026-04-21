import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Auto-generate current week's snapshot via DB function
    await supabase.rpc('generate_weekly_snapshot');

    // Get current MRR by summing each client's actual monthly_revenue
    const { data: clients } = await supabase
      .from('reporting_clients')
      .select('monthly_revenue')
      .eq('status', 'active');

    const currentMRR = (clients ?? []).reduce((sum, c) => sum + (c.monthly_revenue ?? 0), 0);

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

