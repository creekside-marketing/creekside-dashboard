/**
 * GET /api/clients/profitability
 *
 * Calculates per-client profitability by matching operator costs to client revenue.
 *
 * Logic:
 *   1. Fetch active reporting_clients with monthly_revenue and platform_operator
 *   2. Fetch team_members with hourly_rate and estimated_hours_per_month
 *   3. For each operator, count distinct clients they serve
 *   4. Divide estimated_hours_per_month evenly across their clients
 *   5. operator_cost = hours_per_client * hourly_rate
 *   6. profit = revenue - operator_cost
 *   7. margin_pct = (profit / revenue) * 100
 *
 * Response shape:
 *   {
 *     clients: { [client_name]: { revenue, operator_cost, profit, margin_pct } },
 *     totals: { revenue, operator_cost, profit, margin_pct }
 *   }
 *
 * CANNOT: write data, accept POST/PATCH/DELETE, modify team_members or reporting_clients.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface ClientProfitability {
  revenue: number;
  operator_cost: number;
  profit: number;
  margin_pct: number;
}

// Fee tier calculator — mirrors the one in ClientTable.tsx
function calcExpectedFee(totalAdSpend: number, platformCount: number): number {
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

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch reporting_clients and team_members in parallel
    const [clientsResult, teamResult] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('client_name, monthly_revenue, monthly_budget, platform_operator, status')
        .neq('status', 'churned'),
      supabase
        .from('team_members')
        .select('name, role, hourly_rate, estimated_hours_per_month, status')
        .eq('status', 'active'),
    ]);

    if (clientsResult.error) {
      return NextResponse.json({ error: clientsResult.error.message }, { status: 500 });
    }
    if (teamResult.error) {
      return NextResponse.json({ error: teamResult.error.message }, { status: 500 });
    }

    const clients = clientsResult.data ?? [];
    const team = teamResult.data ?? [];

    // Build operator lookup: short_name -> { hourly_rate, estimated_hours_per_month }
    // Dashboard uses short names for platform_operator (e.g., "Peterson", "Cade", "Scott H.")
    const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
      'Kenneth Cade MacLean': 'Cade',
      'Peterson Rainey': 'Peterson',
    };

    function toShortName(fullName: string): string {
      if (DISPLAY_NAME_OVERRIDES[fullName]) return DISPLAY_NAME_OVERRIDES[fullName];
      const parts = fullName.trim().split(/\s+/);
      if (parts.length <= 1) return fullName;
      return `${parts[0]} ${parts[parts.length - 1][0]}.`;
    }

    const operatorMap: Record<string, { hourly_rate: number; estimated_hours: number }> = {};
    for (const member of team) {
      const shortName = toShortName(member.name);
      if (member.hourly_rate != null && member.estimated_hours_per_month != null) {
        operatorMap[shortName] = {
          hourly_rate: Number(member.hourly_rate),
          estimated_hours: Number(member.estimated_hours_per_month),
        };
      }
    }

    // Aggregate client data: revenue per client_name, and which operators serve them
    // Also count how many clients each operator serves
    const clientData: Record<string, {
      totalRevenue: number;
      totalBudget: number;
      platformCount: number;
      hasManualRevenue: boolean;
      operators: Set<string>;
    }> = {};

    for (const row of clients) {
      const name = row.client_name;
      if (!clientData[name]) {
        clientData[name] = {
          totalRevenue: 0,
          totalBudget: 0,
          platformCount: 0,
          hasManualRevenue: false,
          operators: new Set(),
        };
      }

      clientData[name].platformCount += 1;
      clientData[name].totalBudget += Number(row.monthly_budget ?? 0);

      if (row.monthly_revenue != null) {
        clientData[name].totalRevenue += Number(row.monthly_revenue);
        clientData[name].hasManualRevenue = true;
      }

      if (row.platform_operator) {
        clientData[name].operators.add(row.platform_operator);
      }
    }

    // Count how many unique clients each operator serves
    const operatorClientCount: Record<string, number> = {};
    for (const data of Object.values(clientData)) {
      for (const op of data.operators) {
        operatorClientCount[op] = (operatorClientCount[op] ?? 0) + 1;
      }
    }

    // Calculate profitability per client
    const result: Record<string, ClientProfitability> = {};
    let totalRevenue = 0;
    let totalCost = 0;

    for (const [clientName, data] of Object.entries(clientData)) {
      // Revenue: use manual if available, otherwise fee tier formula
      const revenue = data.hasManualRevenue
        ? data.totalRevenue
        : (data.totalBudget > 0 ? calcExpectedFee(data.totalBudget, data.platformCount) : 0);

      // Operator cost: sum across all operators serving this client
      let operatorCost = 0;
      for (const opName of data.operators) {
        const op = operatorMap[opName];
        if (op && operatorClientCount[opName] > 0) {
          const hoursForClient = op.estimated_hours / operatorClientCount[opName];
          operatorCost += hoursForClient * op.hourly_rate;
        }
      }

      operatorCost = Math.round(operatorCost * 100) / 100;
      const profit = Math.round((revenue - operatorCost) * 100) / 100;
      const marginPct = revenue > 0
        ? Math.round((profit / revenue) * 10000) / 100
        : 0;

      result[clientName] = {
        revenue: Math.round(revenue * 100) / 100,
        operator_cost: operatorCost,
        profit,
        margin_pct: marginPct,
      };

      totalRevenue += revenue;
      totalCost += operatorCost;
    }

    const totalProfit = Math.round((totalRevenue - totalCost) * 100) / 100;
    const avgMargin = totalRevenue > 0
      ? Math.round((totalProfit / totalRevenue) * 10000) / 100
      : 0;

    return NextResponse.json({
      clients: result,
      totals: {
        revenue: Math.round(totalRevenue * 100) / 100,
        operator_cost: Math.round(totalCost * 100) / 100,
        profit: totalProfit,
        margin_pct: avgMargin,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
