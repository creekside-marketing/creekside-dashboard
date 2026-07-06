/**
 * PATCH /api/clients/bonuses/[id]
 *
 * Toggles a single client_bonuses row's `active` flag.
 * Body: { active: boolean }
 *
 * When active=false, the profitability route filters this bonus OUT of
 * operator_cost / profit / margin. The bonus row itself is preserved so it
 * can be re-enabled with one click.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    if (typeof body?.active !== 'boolean') {
      return NextResponse.json({ error: 'active must be boolean' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('client_bonuses')
      .update({ active: body.active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, active')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ bonus: data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
