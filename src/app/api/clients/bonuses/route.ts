/**
 * GET /api/clients/bonuses
 *
 * Returns every client_bonuses row so the Client tab can render a popover with
 * per-bonus Yes/No toggles. Grouped by `${client_id}::${platform}` on the
 * client side — server just returns the flat list.
 *
 * Fields returned per row:
 *   - id, client_id, platform, description, expected_monthly_amount, active,
 *     team_member_id (nullable — untagged bonuses get split across platforms
 *     by the profitability route, but the toggle applies to the whole row).
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('client_bonuses')
      .select('id, client_id, platform, description, expected_monthly_amount, active, team_member_id')
      .order('description', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ bonuses: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
