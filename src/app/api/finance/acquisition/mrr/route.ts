/**
 * POST /api/finance/acquisition/mrr
 *
 * Upsert a per-new-client MRR entry. Used by the Finance dashboard's
 * inline editor when you confirm what a newly-paying client is worth.
 *
 * Body:
 *   { client_name: string, first_payment_date: 'YYYY-MM-DD', monthly_mrr: number, notes?: string }
 *
 * CANNOT: GET (use /api/finance/acquisition), DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { client_name, first_payment_date, monthly_mrr, notes } = body ?? {};

    if (!client_name || !first_payment_date || typeof monthly_mrr !== 'number') {
      return NextResponse.json(
        { error: 'client_name, first_payment_date, and monthly_mrr (number) are required' },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('new_client_mrr')
      .upsert(
        { client_name, first_payment_date, monthly_mrr, notes: notes ?? null },
        { onConflict: 'client_name,first_payment_date' },
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
