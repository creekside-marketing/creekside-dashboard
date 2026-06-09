/**
 * GET /api/finance/fixed-costs
 *
 * Returns the active Fixed Costs (monthly recurring costs not tied to client work):
 *
 *   - Internal-only people (founders, ops, support)
 *   - Internal SaaS subscriptions
 *   - Lead acquisition marketing (Upwork Connects, etc.)
 *   - Payment processing fees
 *   - Misc
 *
 * Excludes variable / client-attributed costs which live in client_labor_allocations,
 * client_bonuses, and client_software_costs (those flow through the profitability route).
 *
 * Powers the Fixed Costs tile on the Client tab and the Fixed Costs breakdown panel
 * on the Finance tab.
 *
 * Response:
 *   {
 *     totals: { all: number, by_category: { [category]: number } },
 *     items: Array<{ id, category, name, monthly_amount, notes }>
 *   }
 *
 * READ-ONLY. No writes.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface FixedCostItem {
  id: string;
  category: string;
  name: string;
  monthly_amount: number;
  notes: string | null;
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('fixed_costs')
      .select('id, category, name, monthly_amount, notes, display_order')
      .eq('active', true)
      .order('display_order', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items: FixedCostItem[] = (data ?? []).map(r => ({
      id: r.id as string,
      category: r.category as string,
      name: r.name as string,
      monthly_amount: Number(r.monthly_amount ?? 0),
      notes: (r.notes as string | null) ?? null,
    }));

    const byCategory: Record<string, number> = {};
    let all = 0;
    for (const i of items) {
      byCategory[i.category] = round2((byCategory[i.category] ?? 0) + i.monthly_amount);
      all += i.monthly_amount;
    }

    return NextResponse.json({
      totals: { all: round2(all), by_category: byCategory },
      items,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
