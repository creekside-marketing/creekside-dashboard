import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// ── Fee tier calculator ─────────────────────────────────────────────────
// Creekside charges % of ad spend: 20% ($0-15k), 15% ($15-30k), 10% ($30-45k), 5% ($45k+)
// Minimums: $1,000/platform; $2,000 when managing both Google + Meta
function calcExpectedFee(totalAdSpend: number, platformCount: number): number {
  if (totalAdSpend <= 0) return 0;

  let fee = 0;
  let remaining = totalAdSpend;

  // Tier 1: 0-15k at 20%
  const t1 = Math.min(remaining, 15000);
  fee += t1 * 0.20;
  remaining -= t1;

  // Tier 2: 15k-30k at 15%
  if (remaining > 0) {
    const t2 = Math.min(remaining, 15000);
    fee += t2 * 0.15;
    remaining -= t2;
  }

  // Tier 3: 30k-45k at 10%
  if (remaining > 0) {
    const t3 = Math.min(remaining, 15000);
    fee += t3 * 0.10;
    remaining -= t3;
  }

  // Tier 4: 45k+ at 5%
  if (remaining > 0) {
    fee += remaining * 0.05;
  }

  // Enforce minimums
  const minimum = platformCount >= 2 ? 2000 : 1000;
  return Math.max(fee, minimum);
}

interface ClientRow {
  id: string;
  client_name: string;
  platform: string;
  monthly_budget: number | null;
  status: string;
  account_manager: string | null;
  platform_operator: string | null;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('reporting_clients')
      .select('id, client_name, platform, monthly_budget, status, account_manager, platform_operator');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ClientRow[];
    const activeRows = rows.filter((r) => r.status === 'active');

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

    // ── Estimated MRR (fee tiers applied per client) ────────────────────
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
    for (const [name, info] of Object.entries(clientBudgets)) {
      const fee = calcExpectedFee(info.total, info.platforms.size);
      estimatedMRR += fee;
      clientRevenues.push({ name, budget: info.total, fee });
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
