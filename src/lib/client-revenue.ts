/**
 * Shared helper: compute total monthly revenue per client_id using the same
 * fee_engine + live spend logic as the Clients dashboard.
 *
 * Returns Map<client_id, total_revenue> where total = sum across all of that client's
 * active reporting_clients rows. Used by Finance to show accurate per-client MRR
 * when auto-suggesting amounts for new clients.
 *
 * CANNOT: mutate state, run in the browser.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { calculatePlatformRevenue, type FeeConfig } from '@/lib/fee-engine';
import { fetchLiveSpend } from '@/lib/live-spend-server';

type ReportingRow = {
  id: string;
  client_id: string | null;
  client_name: string;
  platform: string | null;
  ad_account_id: string | null;
  fee_config: FeeConfig | null;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  revenue_override: boolean | null;
};

export async function computeRevenueByClientId(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('reporting_clients')
    .select('id, client_id, client_name, platform, ad_account_id, fee_config, monthly_budget, monthly_revenue, revenue_override, status')
    .eq('status', 'active');

  if (error || !data) return {};

  const rows = data as ReportingRow[];

  // Fetch live spend for all visible accounts (parallel Meta bulk + Google).
  const liveSpend = await fetchLiveSpend(
    rows
      .filter(r => !!r.ad_account_id && !!r.platform)
      .map(r => ({ ad_account_id: r.ad_account_id as string, platform: r.platform as string }))
  );

  // Pre-compute per-client totals for the fee engine
  const platformCountByName: Record<string, number> = {};
  const totalSpendByName: Record<string, number> = {};
  const totalBudgetByName: Record<string, number> = {};
  for (const row of rows) {
    const name = row.client_name;
    platformCountByName[name] = (platformCountByName[name] ?? 0) + 1;
    const live = row.ad_account_id ? liveSpend.get(row.ad_account_id) : undefined;
    const spendOrBudget = live ?? Number(row.monthly_budget ?? 0);
    totalSpendByName[name] = (totalSpendByName[name] ?? 0) + spendOrBudget;
    totalBudgetByName[name] = (totalBudgetByName[name] ?? 0) + Number(row.monthly_budget ?? 0);
  }

  const revenueByClientId: Record<string, number> = {};
  for (const row of rows) {
    if (!row.client_id) continue;
    const platformCount = platformCountByName[row.client_name] ?? 1;
    const live = row.ad_account_id ? liveSpend.get(row.ad_account_id) : undefined;
    const monthlyRev = row.monthly_revenue == null ? null : Number(row.monthly_revenue);

    let value = 0;
    if (row.revenue_override && monthlyRev != null) {
      value = monthlyRev;
    } else if (row.fee_config && live !== undefined) {
      const totalSpend = totalSpendByName[row.client_name] ?? live;
      value = calculatePlatformRevenue(row.fee_config, live, totalSpend, platformCount);
    } else if (row.fee_config && Number(row.monthly_budget ?? 0) > 0) {
      const thisBudget = Number(row.monthly_budget ?? 0);
      const totalBudget = totalBudgetByName[row.client_name] ?? thisBudget;
      value = calculatePlatformRevenue(row.fee_config, thisBudget, totalBudget, platformCount);
    } else if (monthlyRev != null && monthlyRev > 0) {
      value = monthlyRev;
    }
    revenueByClientId[row.client_id] = (revenueByClientId[row.client_id] ?? 0) + value;
  }

  return revenueByClientId;
}
