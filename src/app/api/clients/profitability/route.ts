/**
 * GET /api/clients/profitability
 *
 * Returns per-client operating cost from the seeded allocation tables:
 *   - client_labor_allocations  (labor $ per client per team member)
 *   - client_bonuses            (expected monthly bonus accruals)
 *   - client_software_costs     (per-client software / SaaS / ad-tooling)
 *
 * operator_cost = sum(labor) + sum(bonuses) + sum(software)
 *
 * Response shape (kept backward compatible — existing UI consumes operator_cost):
 *   {
 *     clients: { [client_name]: { operator_cost, labor_cost, bonus_cost, software_cost } },
 *     totals:  { operator_cost, labor_cost, bonus_cost, software_cost }
 *   }
 *
 * client_name keys map to reporting_clients.client_name (the dashboard's display key),
 * not the master clients.name. We resolve via clients.id -> reporting_clients.client_name.
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Pull master clients with their reporting_clients display names + the three cost streams.
    const [
      reportingClientsResult,
      laborResult,
      bonusesResult,
      softwareResult,
    ] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('client_id, client_name, status')
        .eq('status', 'active'),
      supabase
        .from('client_labor_allocations')
        .select('client_id, monthly_amount'),
      supabase
        .from('client_bonuses')
        .select('client_id, expected_monthly_amount'),
      supabase
        .from('client_software_costs')
        .select('client_id, monthly_amount'),
    ]);

    const errors = [reportingClientsResult, laborResult, bonusesResult, softwareResult]
      .map(r => r.error?.message)
      .filter(Boolean);
    if (errors.length) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
    }

    // Map master client_id -> set of reporting client_names that share it.
    // (Multiple platform rows for the same master client all show the same operator_cost.)
    const clientIdToNames: Record<string, Set<string>> = {};
    for (const row of reportingClientsResult.data ?? []) {
      if (!row.client_id || !row.client_name) continue;
      if (!clientIdToNames[row.client_id]) clientIdToNames[row.client_id] = new Set();
      clientIdToNames[row.client_id].add(row.client_name);
    }

    // Aggregate each cost stream by client_id.
    const laborByClient: Record<string, number> = {};
    for (const row of laborResult.data ?? []) {
      if (!row.client_id) continue;
      laborByClient[row.client_id] = (laborByClient[row.client_id] ?? 0) + Number(row.monthly_amount ?? 0);
    }

    const bonusByClient: Record<string, number> = {};
    for (const row of bonusesResult.data ?? []) {
      if (!row.client_id) continue;
      bonusByClient[row.client_id] = (bonusByClient[row.client_id] ?? 0) + Number(row.expected_monthly_amount ?? 0);
    }

    const softwareByClient: Record<string, number> = {};
    for (const row of softwareResult.data ?? []) {
      if (!row.client_id) continue;
      softwareByClient[row.client_id] = (softwareByClient[row.client_id] ?? 0) + Number(row.monthly_amount ?? 0);
    }

    // Project onto reporting_clients.client_name keyspace.
    const result: Record<string, {
      operator_cost: number;
      labor_cost: number;
      bonus_cost: number;
      software_cost: number;
    }> = {};

    let totalLabor = 0;
    let totalBonus = 0;
    let totalSoftware = 0;

    for (const [clientId, names] of Object.entries(clientIdToNames)) {
      const labor = laborByClient[clientId] ?? 0;
      const bonus = bonusByClient[clientId] ?? 0;
      const software = softwareByClient[clientId] ?? 0;
      const total = labor + bonus + software;

      // Each platform row for this master client gets the same totals
      // (the UI splits across grouped rows for display).
      for (const name of names) {
        result[name] = {
          operator_cost: round2(total),
          labor_cost: round2(labor),
          bonus_cost: round2(bonus),
          software_cost: round2(software),
        };
      }

      // Totals counted once per master client (not once per platform row).
      totalLabor += labor;
      totalBonus += bonus;
      totalSoftware += software;
    }

    return NextResponse.json({
      clients: result,
      totals: {
        operator_cost: round2(totalLabor + totalBonus + totalSoftware),
        labor_cost: round2(totalLabor),
        bonus_cost: round2(totalBonus),
        software_cost: round2(totalSoftware),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
