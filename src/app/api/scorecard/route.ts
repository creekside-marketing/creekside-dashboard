import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculatePlatformRevenue } from '@/lib/fee-engine';
import type { FeeConfig } from '@/lib/fee-engine';

const PARTNER_NAMES = new Set(['Bottle.com', 'Comet Fuel', 'FirstUp Marketing', 'Full Circle Media', 'Suff Digital']);

interface ClientRow {
  id: string;
  client_name: string;
  platform: string;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  fee_config: FeeConfig | null;
  revenue_override: boolean;
  status: string;
  account_manager: string | null;
  platform_operator: string | null;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('reporting_clients')
      .select('id, client_name, platform, monthly_budget, monthly_revenue, fee_config, revenue_override, status, account_manager, platform_operator');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ClientRow[];
    const activeRows = rows.filter((r) => r.status === 'active' && !PARTNER_NAMES.has(r.client_name));

    // ── Unique active clients ───────────────────────────────────────────
    const activeClientNames = [...new Set(activeRows.map((r) => r.client_name))];
    const activeClients = activeClientNames.length;

    // ── Total active accounts ───────────────────────────────────────────
    const totalAccounts = activeRows.length;

    // ── Total monthly budget ────────────────────────────────────────────
    const totalMonthlyBudget = activeRows.reduce(
      (sum, r) => sum + (r.monthly_budget ?? 0),
      0
    );

    // ── Platform split ──────────────────────────────────────────────────
    const metaCount = activeRows.filter(
      (r) => r.platform?.toLowerCase() === 'meta'
    ).length;
    const googleCount = activeRows.filter(
      (r) => r.platform?.toLowerCase() === 'google'
    ).length;

    // ── Estimated MRR (per-client fee_config calculation using budget as spend) ──
    const clientBudgets: Record<string, { total: number; platforms: Set<string> }> = {};
    for (const row of activeRows) {
      if (!clientBudgets[row.client_name]) {
        clientBudgets[row.client_name] = { total: 0, platforms: new Set() };
      }
      clientBudgets[row.client_name].total += row.monthly_budget ?? 0;
      if (row.platform) {
        clientBudgets[row.client_name].platforms.add(row.platform.toLowerCase());
      }
    }

    let estimatedMRR = 0;
    const clientRevenues: { name: string; budget: number; fee: number }[] = [];

    // Calculate revenue per row using the same cascade as the dashboard
    const revenueByClient: Record<string, number> = {};
    for (const row of activeRows) {
      let rowRevenue = 0;

      if (row.revenue_override && row.monthly_revenue != null) {
        // Manual override
        rowRevenue = Number(row.monthly_revenue);
      } else if (row.fee_config && row.monthly_budget != null && row.monthly_budget > 0) {
        // Calculate from fee_config using budget as spend
        const totalBudget = clientBudgets[row.client_name]?.total ?? Number(row.monthly_budget);
        rowRevenue = calculatePlatformRevenue(row.fee_config, Number(row.monthly_budget), totalBudget);
      } else if (row.monthly_revenue != null && Number(row.monthly_revenue) > 0) {
        // DB fallback
        rowRevenue = Number(row.monthly_revenue);
      }

      revenueByClient[row.client_name] = (revenueByClient[row.client_name] ?? 0) + rowRevenue;
    }

    for (const [name, fee] of Object.entries(revenueByClient)) {
      estimatedMRR += fee;
      clientRevenues.push({ name, budget: clientBudgets[name]?.total ?? 0, fee });
    }

    // ── Top 5 clients by revenue ────────────────────────────────────────
    clientRevenues.sort((a, b) => b.fee - a.fee);
    const topClients = clientRevenues.slice(0, 5).map((c) => ({
      name: c.name,
      budget: c.budget,
      fee: c.fee,
      pctOfMRR: estimatedMRR > 0 ? (c.fee / estimatedMRR) * 100 : 0,
    }));

    // ── Ownership gaps ──────────────────────────────────────────────────
    const clientsWithNoManager = new Set<string>();
    const clientsWithNoOperator = new Set<string>();
    const clientManagerMap: Record<string, boolean> = {};
    const clientOperatorMap: Record<string, boolean> = {};

    for (const row of activeRows) {
      if (row.account_manager) clientManagerMap[row.client_name] = true;
      if (row.platform_operator) clientOperatorMap[row.client_name] = true;
    }

    for (const name of activeClientNames) {
      if (!clientManagerMap[name]) clientsWithNoManager.add(name);
      if (!clientOperatorMap[name]) clientsWithNoOperator.add(name);
    }

    // ── Churned clients ─────────────────────────────────────────────────
    const churnedNames = new Set(
      rows.filter((r) => r.status === 'churned').map((r) => r.client_name)
    );
    const churnedCount = churnedNames.size;

    // ── Budget tiers ────────────────────────────────────────────────────
    const budgetTiers = { under2k: 0, '2k_5k': 0, '5k_15k': 0, over15k: 0 };
    for (const info of Object.values(clientBudgets)) {
      const b = info.total;
      if (b < 2000) budgetTiers.under2k++;
      else if (b < 5000) budgetTiers['2k_5k']++;
      else if (b < 15000) budgetTiers['5k_15k']++;
      else budgetTiers.over15k++;
    }

    // ── Budget coverage ─────────────────────────────────────────────────
    const clientsWithBudget = Object.values(clientBudgets).filter(
      (c) => c.total > 0
    ).length;

    return NextResponse.json({
      activeClients,
      totalAccounts,
      totalMonthlyBudget,
      estimatedMRR,
      platformSplit: { meta: metaCount, google: googleCount },
      ownershipGaps: {
        noManager: clientsWithNoManager.size,
        noOperator: clientsWithNoOperator.size,
      },
      topClients,
      churnedCount,
      budgetTiers,
      budgetCoverage: { withBudget: clientsWithBudget, total: activeClients },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
