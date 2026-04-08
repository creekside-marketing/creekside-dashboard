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

    // Aggregate operators per client
    const clientOperators: Record<string, Set<string>> = {};
    for (const row of clients) {
      if (!clientOperators[row.client_name]) {
        clientOperators[row.client_name] = new Set();
      }
      if (row.platform_operator) {
        clientOperators[row.client_name].add(row.platform_operator);
      }
    }

    // Count how many unique clients each operator serves
    const operatorClientCount: Record<string, number> = {};
    for (const ops of Object.values(clientOperators)) {
      for (const op of ops) {
        operatorClientCount[op] = (operatorClientCount[op] ?? 0) + 1;
      }
    }

    // Calculate operator cost per client (revenue computed client-side from fee_config)
    const result: Record<string, { operator_cost: number }> = {};
    let totalCost = 0;

    for (const [clientName, ops] of Object.entries(clientOperators)) {
      let operatorCost = 0;
      for (const opName of ops) {
        const op = operatorMap[opName];
        if (op && operatorClientCount[opName] > 0) {
          const hoursForClient = op.estimated_hours / operatorClientCount[opName];
          operatorCost += hoursForClient * op.hourly_rate;
        }
      }
      operatorCost = Math.round(operatorCost * 100) / 100;
      result[clientName] = { operator_cost: operatorCost };
      totalCost += operatorCost;
    }

    return NextResponse.json({
      clients: result,
      totals: {
        operator_cost: Math.round(totalCost * 100) / 100,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
