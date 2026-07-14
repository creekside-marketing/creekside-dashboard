import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * PATCH /api/advocacy/hide
 * Body: { client_id: uuid, hidden: boolean }
 * Sets clients.advocacy_hidden — used when no further asks are planned for a
 * client: either we've already gotten everything we think we can from them,
 * or we don't expect they'll give us advocacy items. Hidden clients still
 * exist and preserve their status toggles; they're just filtered out of the
 * UI + top-of-page totals.
 * Peterson/Cade can un-hide from the same row action if we change our mind.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { client_id, hidden } = body ?? {};
    if (typeof client_id !== 'string' || typeof hidden !== 'boolean') {
      return NextResponse.json({ error: 'client_id (uuid) and hidden (boolean) required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('clients')
      .update({ advocacy_hidden: hidden })
      .eq('id', client_id);
    if (error) throw error;

    return NextResponse.json({ ok: true, client_id, hidden });
  } catch (err) {
    console.error('advocacy hide PATCH error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
