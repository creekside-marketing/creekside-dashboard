/**
 * GET /api/clients/profitability
 *
 * Returns per-client per-platform operating cost from the seeded allocation tables:
 *   - client_labor_allocations  (labor $ per client per team member, tagged by platform)
 *   - client_bonuses            (expected monthly bonus accruals, tagged by platform)
 *   - client_software_costs     (per-client software / SaaS / ad-tooling, optionally tagged)
 *
 * Each cost row carries a `platform` tag (google / meta / programmatic / other / etc).
 * Costs match the corresponding reporting_clients row by exact platform match.
 * Untagged software costs (platform IS NULL) split evenly across all of the client's
 * active platform rows — used for general tools like Slack that don't belong to one platform.
 *
 * operator_cost = labor + bonuses + software (per platform row)
 *
 * Response shape:
 *   {
 *     clients: {
 *       [client_name]: {
 *         [platform]: { operator_cost, labor_cost, bonus_cost, software_cost }
 *       }
 *     },
 *     totals:  { operator_cost, labor_cost, bonus_cost, software_cost }
 *   }
 *
 * client_name keys map to reporting_clients.client_name. The nested platform key
 * matches reporting_clients.platform for that row.
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type CostBucket = {
  operator_cost: number;
  labor_cost: number;
  bonus_cost: number;
  software_cost: number;
};

export async function GET() {
  try {
    const supabase = createServiceClient();

    const [
      reportingClientsResult,
      laborResult,
      bonusesResult,
      softwareResult,
    ] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('client_id, client_name, platform, status, client_category')
        .eq('status', 'active')
        .neq('client_category', 'retainer'),
      supabase
        .from('client_labor_allocations')
        .select('client_id, platform, monthly_amount'),
      supabase
        .from('client_bonuses')
        .select('client_id, platform, expected_monthly_amount'),
      supabase
        .from('client_software_costs')
        .select('client_id, platform, monthly_amount'),
    ]);

    const errors = [reportingClientsResult, laborResult, bonusesResult, softwareResult]
      .map(r => r.error?.message)
      .filter(Boolean);
    if (errors.length) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
    }

    // Map client_id -> { platforms: Set, names: Set } for grouping + untagged-cost splitting.
    const clientPlatforms: Record<string, Set<string>> = {};
    const clientNames: Record<string, string> = {};
    for (const row of reportingClientsResult.data ?? []) {
      if (!row.client_id || !row.client_name || !row.platform) continue;
      if (!clientPlatforms[row.client_id]) clientPlatforms[row.client_id] = new Set();
      clientPlatforms[row.client_id].add(row.platform);
      clientNames[row.client_id] = row.client_name;
    }

    // Aggregate tagged costs by client_id::platform key.
    const laborByKey: Record<string, number> = {};
    for (const row of laborResult.data ?? []) {
      if (!row.client_id || !row.platform) continue;
      const key = `${row.client_id}::${row.platform}`;
      laborByKey[key] = (laborByKey[key] ?? 0) + Number(row.monthly_amount ?? 0);
    }

    const bonusByKey: Record<string, number> = {};
    for (const row of bonusesResult.data ?? []) {
      if (!row.client_id || !row.platform) continue;
      const key = `${row.client_id}::${row.platform}`;
      bonusByKey[key] = (bonusByKey[key] ?? 0) + Number(row.expected_monthly_amount ?? 0);
    }

    // Software: tagged costs go to specific platform; untagged splits across all platforms of the client.
    const softwareByKey: Record<string, number> = {};
    for (const row of softwareResult.data ?? []) {
      if (!row.client_id) continue;
      const amount = Number(row.monthly_amount ?? 0);
      if (row.platform) {
        const key = `${row.client_id}::${row.platform}`;
        softwareByKey[key] = (softwareByKey[key] ?? 0) + amount;
      } else {
        const platforms = clientPlatforms[row.client_id];
        if (platforms && platforms.size > 0) {
          const splitAmount = amount / platforms.size;
          for (const p of platforms) {
            const key = `${row.client_id}::${p}`;
            softwareByKey[key] = (softwareByKey[key] ?? 0) + splitAmount;
          }
        }
      }
    }

    // Build nested output: client_name -> platform -> CostBucket
    const result: Record<string, Record<string, CostBucket>> = {};
    let totalLabor = 0;
    let totalBonus = 0;
    let totalSoftware = 0;

    for (const [clientId, platforms] of Object.entries(clientPlatforms)) {
      const clientName = clientNames[clientId];
      if (!clientName) continue;
      if (!result[clientName]) result[clientName] = {};
      for (const platform of platforms) {
        const key = `${clientId}::${platform}`;
        const labor = laborByKey[key] ?? 0;
        const bonus = bonusByKey[key] ?? 0;
        const software = softwareByKey[key] ?? 0;
        const total = labor + bonus + software;
        result[clientName][platform] = {
          operator_cost: round2(total),
          labor_cost: round2(labor),
          bonus_cost: round2(bonus),
          software_cost: round2(software),
        };
        totalLabor += labor;
        totalBonus += bonus;
        totalSoftware += software;
      }
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
