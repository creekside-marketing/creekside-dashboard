/**
 * POST /api/finance/projections
 *
 * Upsert a single category's projected amount for a given month.
 * Used by the inline-editable cells on the Finance dashboard.
 *
 * Body:
 *   { month_date: 'YYYY-MM-01', category: string, projected_amount: number, notes?: string }
 *
 * CANNOT: GET (use /api/finance/expenses), DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { month_date, category, projected_amount, notes } = body ?? {};

    if (!month_date || !category || typeof projected_amount !== 'number') {
      return NextResponse.json(
        { error: 'month_date, category, and projected_amount (number) are required' },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('monthly_expense_projections')
      .upsert(
        { month_date, category, projected_amount, notes: notes ?? null },
        { onConflict: 'month_date,category' },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
