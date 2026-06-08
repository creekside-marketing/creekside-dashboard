import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// New endpoint powering the redesigned Team tab.
// Returns one entry per team member (filtered to active people we currently
// staff client work with) with their per-client labor allocations and a
// bandwidth-remaining hint sourced from a static map below.

// Bandwidth remaining (hours/week) per Peterson + Cade — May 18 2026 call.
// Single source of truth lives here; edit in code if it changes.
const BANDWIDTH_REMAINING_HOURS: Record<string, number> = {
  'Lindsey Bouffard': 7,  // +1 from Mark Wolf hours transferred to Trent
  'Scott Caldwell': 10,
  'Trent Lucas': 18,  // -2 from Mark Wolf 2-hr allocation
  'Ahmed Imran': 15,
  'Ade Aderibigbe': 10,
  'Baran Eris': 20,
  // Jordan Tryon + Aamir: bandwidth not yet specified — will show as `--` until set.
};

// Order in which members render on the page. Tobi remains excluded (AI-agent-only).
const DISPLAY_ORDER: string[] = [
  'Lindsey Bouffard',
  'Scott Caldwell',
  'Trent Lucas',
  'Ahmed Imran',
  'Ade Aderibigbe',
  'Baran Eris',
  'Jordan Tryon',
  'Aamir',
];

interface AllocationRow {
  client_name: string;
  platform: string | null;
  hours_per_week: number | null;
  monthly_amount: number;
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
  allocations: AllocationRow[];
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data: members, error: membersError } = await supabase
      .from('team_members')
      .select('id, name, role, hourly_rate, monthly_retainer, status')
      .in('name', DISPLAY_ORDER);

    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const memberIds = (members ?? []).map(m => m.id);

    const { data: allocations, error: allocError } = await supabase
      .from('client_labor_allocations')
      .select(`
        team_member_id,
        platform,
        avg_hours_per_week,
        monthly_amount,
        clients ( name, status )
      `)
      .in('team_member_id', memberIds);

    if (allocError) {
      return NextResponse.json({ error: allocError.message }, { status: 500 });
    }

    // Group allocations by team_member_id, excluding churned clients.
    // Supabase returns the joined `clients` as either a single object or an
    // array depending on FK introspection; normalize before reading.
    const allocByMember = new Map<string, AllocationRow[]>();
    for (const row of allocations ?? []) {
      const raw = (row as { clients: { name: string; status: string } | { name: string; status: string }[] | null }).clients;
      const client = Array.isArray(raw) ? raw[0] ?? null : raw;
      if (!client || client.status === 'churned') continue;
      const list = allocByMember.get(row.team_member_id) ?? [];
      list.push({
        client_name: client.name,
        platform: row.platform,
        hours_per_week: row.avg_hours_per_week !== null ? Number(row.avg_hours_per_week) : null,
        monthly_amount: Number(row.monthly_amount ?? 0),
      });
      allocByMember.set(row.team_member_id, list);
    }

    const payload: TeamMemberPayload[] = (members ?? []).map(m => {
      const allocs = (allocByMember.get(m.id) ?? []).sort((a, b) =>
        a.client_name.localeCompare(b.client_name)
      );
      const totalHours = allocs.reduce((sum, a) => sum + (a.hours_per_week ?? 0), 0);
      const totalPay = allocs.reduce((sum, a) => sum + a.monthly_amount, 0);
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        hourly_rate: m.hourly_rate !== null ? Number(m.hourly_rate) : null,
        monthly_retainer: m.monthly_retainer !== null ? Number(m.monthly_retainer) : null,
        status: m.status,
        bandwidth_remaining_hours: BANDWIDTH_REMAINING_HOURS[m.name] ?? null,
        current_hours_per_week: totalHours,
        total_monthly_pay: totalPay,
        allocations: allocs,
      };
    });

    // Sort to match DISPLAY_ORDER.
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
