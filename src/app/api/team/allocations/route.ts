import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { computeRevenueByClientPlatform } from '@/lib/client-revenue';

// New endpoint powering the redesigned Team tab.
// Returns one entry per team member (filtered to active people we currently
// staff client work with) with their per-client labor allocations and a
// bandwidth-remaining hint sourced from a static map below.

// Bandwidth remaining (hours/week) per Peterson + Cade — May 18 2026 call.
// Single source of truth lives here; edit in code if it changes.
const BANDWIDTH_REMAINING_HOURS: Record<string, number> = {
  'Scott Caldwell': 0,   // Cade Jun 9 clarification: current hours ~35, bandwidth gone
  'Trent Lucas': 18,
  'Ahmed Imran': 15,
  'Ade Aderibigbe': 10,
  'Baran Eris': 20,
  'David': 11,           // 15 hrs/wk capacity − 4.5 currently allocated = ~11 hrs/wk available
  // Lindsey is dynamic: 45-hr weekly capacity − 5-hr admin buffer − allocated hours.
  // Jordan Tryon + Aamir: bandwidth not yet specified — will show as `--` until set.
};

// Lindsey is the full-time salaried hire — her bandwidth flexes as we add/remove
// client work. Capacity is 45 hrs/wk total, with a 5-hr admin buffer for downtime,
// onboarding, and internal coordination. Remaining = 45 − 5 − sum(allocated).
const LINDSEY_WEEKLY_CAPACITY = 45;
const LINDSEY_ADMIN_BUFFER = 5;

// Order in which members render on the page. Tobi remains excluded (AI-agent-only).
const DISPLAY_ORDER: string[] = [
  'Lindsey Bouffard',
  'Scott Caldwell',
  'Trent Lucas',
  'Ahmed Imran',
  'Ade Aderibigbe',
  'David',
  'Baran Eris',
  'Jordan Tryon',
  'Aamir',
];

interface AllocationRow {
  client_name: string;
  platform: string | null;
  hours_per_week: number | null;
  monthly_amount: number;        // member's labor cost on this (client, platform)
  bonus_amount: number;          // member's bonus on this (client, platform), 0 if none
  cost: number;                  // monthly_amount + bonus_amount
  client_revenue: number;        // total revenue from this (client, platform)
  client_total_labor: number;    // total labor across all members on this (client, platform)
  attributed_revenue: number;    // member's share = monthly_amount / client_total_labor × client_revenue
  profit: number;                // attributed_revenue − cost
  margin_pct: number;            // profit / attributed_revenue × 100
}

interface TeamMemberPayload {
  id: string;
  name: string;
  role: string | null;
  hourly_rate: number | null;
  monthly_retainer: number | null;
  status: string;
  bandwidth_remaining_hours: number | null;
  current_hours_per_week: number;
  total_monthly_pay: number;
  // Per-member profitability totals (sum across all allocations)
  total_attributed_revenue: number;
  total_cost: number;
  total_profit: number;
  margin_pct: number;
  allocations: AllocationRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Parallel fetch: team members, ALL labor allocations (not just ours — we need
    // the total cost per client to compute attribution shares), bonuses,
    // reporting_clients (for revenue per platform), and clients (for names/status).
    const [
      membersResult,
      allLaborResult,
      bonusesResult,
      reportingClientsResult,
      clientsResult,
    ] = await Promise.all([
      supabase
        .from('team_members')
        .select('id, name, role, hourly_rate, monthly_retainer, status')
        .in('name', DISPLAY_ORDER),
      supabase
        .from('client_labor_allocations')
        .select('team_member_id, client_id, platform, avg_hours_per_week, monthly_amount'),
      supabase
        .from('client_bonuses')
        .select('team_member_id, client_id, platform, expected_monthly_amount'),
      supabase
        .from('reporting_clients')
        .select('client_id, platform, monthly_revenue, status, client_category'),
      supabase
        .from('clients')
        .select('id, name, status'),
    ]);

    const errors = [membersResult, allLaborResult, bonusesResult, reportingClientsResult, clientsResult]
      .map(r => r.error?.message)
      .filter(Boolean);
    if (errors.length) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 500 });
    }

    const members = membersResult.data ?? [];

    // Build lookups
    const clientNameById: Record<string, string> = {};
    const clientStatusById: Record<string, string> = {};
    for (const c of clientsResult.data ?? []) {
      clientNameById[c.id] = c.name;
      clientStatusById[c.id] = c.status;
    }

    // Revenue per (client_id, platform) — uses the SAME live fee engine the
    // Client tab uses for "Est. Revenue" so attribution math matches the per-
    // client revenue numbers you see there (Blush Camera $2,632, AIW ≈$517 live,
    // Fusion DI Meta $5,237, etc.) rather than stale stored values.
    const revenueByCP = await computeRevenueByClientPlatform(supabase);
    // Retainer (client, platform) rows — excluded entirely from Team profitability
    // per Cade. Retainer clients live on the Client tab Retainer section with
    // a separate 25% margin assumption; they don't roll up into freelancer P&L.
    const retainerCP = new Set<string>();
    // Active (non-retainer, non-churned) platforms per client — for splitting
    // platform=null allocations.
    const activePlatformsByClient: Record<string, string[]> = {};
    for (const r of reportingClientsResult.data ?? []) {
      if (!r.client_id || !r.platform) continue;
      if (r.status === 'churned') continue;
      const cpKey = `${r.client_id}::${r.platform}`;
      if (r.client_category === 'retainer') {
        retainerCP.add(cpKey);
        continue;
      }
      if (!activePlatformsByClient[r.client_id]) activePlatformsByClient[r.client_id] = [];
      if (!activePlatformsByClient[r.client_id].includes(r.platform)) {
        activePlatformsByClient[r.client_id].push(r.platform);
      }
    }

    // Total labor per (client_id, platform). Splits platform=null evenly across the
    // client's active platforms (same convention the profitability route uses).
    const totalLaborByCP: Record<string, number> = {};
    for (const l of allLaborResult.data ?? []) {
      if (!l.client_id) continue;
      const amount = Number(l.monthly_amount ?? 0);
      if (amount === 0) continue;
      if (l.platform) {
        const cpKey = `${l.client_id}::${l.platform}`;
        totalLaborByCP[cpKey] = (totalLaborByCP[cpKey] ?? 0) + amount;
      } else {
        const platforms = activePlatformsByClient[l.client_id] ?? [];
        if (platforms.length > 0) {
          const split = amount / platforms.length;
          for (const p of platforms) {
            const cpKey = `${l.client_id}::${p}`;
            totalLaborByCP[cpKey] = (totalLaborByCP[cpKey] ?? 0) + split;
          }
        }
      }
    }

    // Retainer (client, platform) rows: excluded entirely from the Team tab
    // per-freelancer profitability view. They live on the Client tab Retainer
    // section with their own 25% margin treatment and shouldn't roll up into
    // freelancer P&L. No revenue override needed here — the cpKey simply gets
    // skipped when building enriched allocations below.

    // Bonuses per (member_id, client_id, platform)
    const bonusByMCP: Record<string, number> = {};
    for (const b of bonusesResult.data ?? []) {
      if (!b.team_member_id || !b.client_id) continue;
      const amount = Number(b.expected_monthly_amount ?? 0);
      if (amount === 0) continue;
      if (b.platform) {
        const key = `${b.team_member_id}::${b.client_id}::${b.platform}`;
        bonusByMCP[key] = (bonusByMCP[key] ?? 0) + amount;
      } else {
        // Untagged bonus → split across active platforms
        const platforms = activePlatformsByClient[b.client_id] ?? [];
        if (platforms.length > 0) {
          const split = amount / platforms.length;
          for (const p of platforms) {
            const key = `${b.team_member_id}::${b.client_id}::${p}`;
            bonusByMCP[key] = (bonusByMCP[key] ?? 0) + split;
          }
        }
      }
    }

    // For each member, build enriched allocations with attribution.
    // Untagged member allocations get split across the client's active platforms;
    // each split shows as its own row so attribution math is clean.
    const allocByMember = new Map<string, AllocationRow[]>();
    for (const row of allLaborResult.data ?? []) {
      if (!row.team_member_id || !row.client_id) continue;
      // Skip orphan allocations on inactive/paused/churned canonical clients
      // — these have no revenue and just create noise on the Team tab.
      const cStatus = clientStatusById[row.client_id];
      if (cStatus === 'churned' || cStatus === 'inactive' || cStatus === 'paused') continue;

      const memberLabor = Number(row.monthly_amount ?? 0);
      if (memberLabor === 0) continue;
      const hours = row.avg_hours_per_week !== null ? Number(row.avg_hours_per_week) : null;

      // Determine platforms this allocation contributes to + the split amount per
      const platforms: string[] = row.platform
        ? [row.platform]
        : (activePlatformsByClient[row.client_id] ?? []);
      if (platforms.length === 0) continue;
      const splitLabor = row.platform ? memberLabor : memberLabor / platforms.length;
      const splitHours = hours !== null && !row.platform ? hours / platforms.length : hours;

      for (const platform of platforms) {
        const cpKey = `${row.client_id}::${platform}`;
        // Skip retainer-category (client, platform) rows entirely.
        if (retainerCP.has(cpKey)) continue;
        const revenue = revenueByCP[cpKey] ?? 0;
        const totalLabor = totalLaborByCP[cpKey] ?? 0;
        const share = totalLabor > 0 ? splitLabor / totalLabor : 0;
        const attributedRevenue = revenue * share;

        const bonusKey = `${row.team_member_id}::${row.client_id}::${platform}`;
        const bonus = bonusByMCP[bonusKey] ?? 0;
        const cost = splitLabor + bonus;
        const profit = attributedRevenue - cost;
        const marginPct = attributedRevenue > 0 ? (profit / attributedRevenue) * 100 : 0;

        const list = allocByMember.get(row.team_member_id) ?? [];
        list.push({
          client_name: clientNameById[row.client_id] ?? 'Unknown',
          platform,
          hours_per_week: splitHours,
          monthly_amount: round2(splitLabor),
          bonus_amount: round2(bonus),
          cost: round2(cost),
          client_revenue: round2(revenue),
          client_total_labor: round2(totalLabor),
          attributed_revenue: round2(attributedRevenue),
          profit: round2(profit),
          margin_pct: round2(marginPct),
        });
        allocByMember.set(row.team_member_id, list);
      }
    }

    const payload: TeamMemberPayload[] = members.map(m => {
      const allocs = (allocByMember.get(m.id) ?? []).sort((a, b) =>
        a.client_name.localeCompare(b.client_name)
      );
      const totalHours = allocs.reduce((sum, a) => sum + (a.hours_per_week ?? 0), 0);
      const totalPay = allocs.reduce((sum, a) => sum + a.monthly_amount, 0);
      const totalAttributedRevenue = allocs.reduce((sum, a) => sum + a.attributed_revenue, 0);
      const totalCost = allocs.reduce((sum, a) => sum + a.cost, 0);
      const totalProfit = totalAttributedRevenue - totalCost;
      const marginPct = totalAttributedRevenue > 0 ? (totalProfit / totalAttributedRevenue) * 100 : 0;

      const bandwidth_remaining_hours = m.name === 'Lindsey Bouffard'
        ? Math.round((LINDSEY_WEEKLY_CAPACITY - LINDSEY_ADMIN_BUFFER - totalHours) * 10) / 10
        : (BANDWIDTH_REMAINING_HOURS[m.name] ?? null);

      return {
        id: m.id,
        name: m.name,
        role: m.role,
        hourly_rate: m.hourly_rate !== null ? Number(m.hourly_rate) : null,
        monthly_retainer: m.monthly_retainer !== null ? Number(m.monthly_retainer) : null,
        status: m.status,
        bandwidth_remaining_hours,
        current_hours_per_week: round2(totalHours),
        total_monthly_pay: round2(totalPay),
        total_attributed_revenue: round2(totalAttributedRevenue),
        total_cost: round2(totalCost),
        total_profit: round2(totalProfit),
        margin_pct: round2(marginPct),
        allocations: allocs,
      };
    });

    payload.sort(
      (a, b) => DISPLAY_ORDER.indexOf(a.name) - DISPLAY_ORDER.indexOf(b.name)
    );

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
