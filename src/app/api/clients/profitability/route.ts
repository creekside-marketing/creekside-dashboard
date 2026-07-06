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

type LaborByMember = { member: string; amount: number };

type CostBucket = {
  operator_cost: number;
  labor_cost: number;
  bonus_cost: number;
  software_cost: number;
  // Per-team-member breakdown of labor + bonus on this (client, platform).
  // Drives the color-coded chips under the Labor column in ClientTable.
  labor_by_member: LaborByMember[];
};

export async function GET() {
  try {
    const supabase = createServiceClient();

    const [
      reportingClientsResult,
      laborResult,
      bonusesResult,
      softwareResult,
      teamMembersResult,
    ] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('client_id, client_name, platform, status, client_category')
        .eq('status', 'active')
        .neq('client_category', 'retainer'),
      supabase
        .from('client_labor_allocations')
        .select('client_id, platform, monthly_amount, team_member_id'),
      supabase
        .from('client_bonuses')
        .select('client_id, platform, expected_monthly_amount, team_member_id')
        .eq('active', true),
      supabase
        .from('client_software_costs')
        .select('client_id, platform, monthly_amount'),
      supabase
        .from('team_members')
        .select('id, name, monthly_retainer'),
    ]);

    const errors = [reportingClientsResult, laborResult, bonusesResult, softwareResult, teamMembersResult]
      .map(r => r.error?.message)
      .filter(Boolean);
    if (errors.length) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
    }

    // Build member_id → name lookup for the per-row team-member breakdown.
    const memberNameById: Record<string, string> = {};
    // Build member_NAME → monthly_retainer lookup. Retainer members have their
    // total contribution to operator cost pinned to monthly_retainer regardless
    // of how many hours of attribution they have. Hourly members (no retainer)
    // contribute the raw sum of their allocations.
    const retainerByMember: Record<string, number> = {};
    for (const tm of teamMembersResult.data ?? []) {
      if (!tm?.id) continue;
      const name = tm.name?.trim() || 'Unassigned';
      memberNameById[tm.id] = name;
      if (tm.monthly_retainer != null && Number(tm.monthly_retainer) > 0) {
        retainerByMember[name] = Number(tm.monthly_retainer);
      }
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

    // Aggregate labor + bonuses by client_id::platform key.
    // Untagged rows (platform IS NULL) split evenly across all of the client's active platforms
    // — used for cross-platform work like Jordan's tracking/GTM setup.
    const laborByKey: Record<string, number> = {};
    const laborByKeyMember: Record<string, Record<string, number>> = {}; // key -> { member: amount }
    const memberName = (row: { team_member_id?: string | null }): string => {
      if (!row.team_member_id) return 'Unassigned';
      return memberNameById[row.team_member_id] ?? 'Unassigned';
    };
    const addLabor = (clientId: string, platform: string, member: string, amount: number) => {
      const key = `${clientId}::${platform}`;
      laborByKey[key] = (laborByKey[key] ?? 0) + amount;
      if (!laborByKeyMember[key]) laborByKeyMember[key] = {};
      laborByKeyMember[key][member] = (laborByKeyMember[key][member] ?? 0) + amount;
    };
    // Members whose cost we DON'T want attributed to individual client rows on
    // the Client tab. Their full monthly_retainer still lands in Operator Cost
    // via the salary-gap mechanism below (they're in FULL_TIME_SALARIED_MEMBERS),
    // just not distributed across specific clients. The Team tab still uses
    // raw allocations so it shows which clients they touch.
    // Jordan: Peterson+Cade decision — evaluate his cost as fixed overhead
    // rather than trying to attribute across clients (2026-07-06).
    const UNATTRIBUTED_TO_CLIENTS = new Set(['Jordan Tryon']);

    for (const row of laborResult.data ?? []) {
      if (!row.client_id) continue;
      const amount = Number(row.monthly_amount ?? 0);
      if (amount === 0) continue;
      const member = memberName(row);
      // Skip this member's labor from per-client attribution. Their full
      // retainer still shows up in totalLabor via the salary-gap add-back
      // below (activeAttributed will be 0 for them).
      if (UNATTRIBUTED_TO_CLIENTS.has(member)) continue;
      if (row.platform) {
        addLabor(row.client_id, row.platform, member, amount);
      } else {
        // Untagged → split across the client's active platforms
        const platforms = clientPlatforms[row.client_id];
        if (platforms && platforms.size > 0) {
          const splitAmount = amount / platforms.size;
          for (const p of platforms) addLabor(row.client_id, p, member, splitAmount);
        }
      }
    }

    const bonusByKey: Record<string, number> = {};
    const bonusByKeyMember: Record<string, Record<string, number>> = {};
    const addBonus = (clientId: string, platform: string, member: string, amount: number) => {
      const key = `${clientId}::${platform}`;
      bonusByKey[key] = (bonusByKey[key] ?? 0) + amount;
      if (!bonusByKeyMember[key]) bonusByKeyMember[key] = {};
      bonusByKeyMember[key][member] = (bonusByKeyMember[key][member] ?? 0) + amount;
    };
    for (const row of bonusesResult.data ?? []) {
      if (!row.client_id) continue;
      const amount = Number(row.expected_monthly_amount ?? 0);
      if (amount === 0) continue;
      const member = memberName(row);
      if (row.platform) {
        addBonus(row.client_id, row.platform, member, amount);
      } else {
        const platforms = clientPlatforms[row.client_id];
        if (platforms && platforms.size > 0) {
          const splitAmount = amount / platforms.size;
          for (const p of platforms) addBonus(row.client_id, p, member, splitAmount);
        }
      }
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

        // Labor-only breakdown per member so the chip amounts sum to the Labor column total.
        // Bonuses are intentionally excluded — they have their own column on the table.
        const labor_by_member: LaborByMember[] = Object.entries(laborByKeyMember[key] ?? {})
          .map(([member, amount]) => ({ member, amount: round2(amount) }))
          .filter(b => b.amount > 0)
          .sort((a, b) => b.amount - a.amount);

        result[clientName][platform] = {
          operator_cost: round2(total),
          labor_cost: round2(labor),
          bonus_cost: round2(bonus),
          software_cost: round2(software),
          labor_by_member,
        };
        totalLabor += labor;
        totalBonus += bonus;
        totalSoftware += software;
      }
    }

    // Salary-gap reconciliation: ONLY applies to full-time salaried hires (Lindsey today).
    // Their full monthly_retainer should contribute to Operator Costs even when some of
    // their time goes to retainer-category clients or admin/overhead that isn't visible
    // in the active client breakdown. Everyone else (Scott/Ahmed/Ade/Jordan/etc) is on
    // per-client fixed rates — their monthly_retainer field is the SUM of those rates,
    // not a cap target, so their allocations naturally equal their retainer with no gap.
    const FULL_TIME_SALARIED_MEMBERS = new Set(['Lindsey Bouffard', 'David', 'Jordan Tryon']);
    let salaryGap = 0;
    for (const [memberName, retainer] of Object.entries(retainerByMember)) {
      if (!FULL_TIME_SALARIED_MEMBERS.has(memberName)) continue;
      let activeAttributed = 0;
      for (const [clientId, platforms] of Object.entries(clientPlatforms)) {
        for (const platform of platforms) {
          const key = `${clientId}::${platform}`;
          activeAttributed += laborByKeyMember[key]?.[memberName] ?? 0;
        }
      }
      salaryGap += (retainer - activeAttributed);
    }
    totalLabor += salaryGap;

    // 'Other' platform (AI Agent / Toby work) is tracked separately on the
    // dashboard and is excluded from the headline Operator Costs number that
    // drives the Client tab tile and the Finance tab Variable Labor row.
    // Salary gap stays IN — Lindsey's $671 of admin/overhead is part of what
    // we pay her, just not allocated to any specific client.
    let otherPlatformOperatorCost = 0;
    for (const clientName of Object.keys(result)) {
      const otherRow = result[clientName]['other'];
      if (otherRow) otherPlatformOperatorCost += otherRow.operator_cost;
    }
    const active_operator_cost = (totalLabor + totalBonus + totalSoftware) - otherPlatformOperatorCost;

    return NextResponse.json({
      clients: result,
      totals: {
        operator_cost: round2(totalLabor + totalBonus + totalSoftware),
        active_operator_cost: round2(active_operator_cost),
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
