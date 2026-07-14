import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * PATCH /api/advocacy/status
 * Body: { client_id, item_key, field: 'asked'|'completed'|'na', value: boolean, actor?: string, notes?: string }
 * Upserts one status row. Setting asked=false also clears completed (can't have
 * "did it" if we never asked). Setting na=true marks the item not applicable /
 * won't happen (e.g. white-label partner can't do a case study, or client
 * declined) — it clears completed but preserves asked as history.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { client_id, item_key, field, value, actor, notes } = body as {
      client_id: string;
      item_key: string;
      field: 'asked' | 'completed' | 'na';
      value: boolean;
      actor?: string;
      notes?: string;
    };

    if (!client_id || !item_key || (field !== 'asked' && field !== 'completed' && field !== 'na')) {
      return NextResponse.json({ error: 'missing/invalid fields' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch existing row (if any) so we can preserve other fields
    const { data: existing } = await supabase
      .from('client_advocacy_status')
      .select('*')
      .eq('client_id', client_id)
      .eq('item_key', item_key)
      .maybeSingle();

    const now = new Date().toISOString();
    const row: Record<string, unknown> = {
      client_id,
      item_key,
      asked_at: existing?.asked_at ?? null,
      asked_by: existing?.asked_by ?? null,
      completed_at: existing?.completed_at ?? null,
      completed_by: existing?.completed_by ?? null,
      na_at: existing?.na_at ?? null,
      na_by: existing?.na_by ?? null,
      notes: notes !== undefined ? notes : (existing?.notes ?? null),
    };

    if (field === 'asked') {
      row.asked_at = value ? (existing?.asked_at ?? now) : null;
      row.asked_by = value ? (existing?.asked_by ?? actor ?? null) : null;
      // Turning "asked" off also clears "completed" — can't have done what wasn't asked
      if (!value) {
        row.completed_at = null;
        row.completed_by = null;
      }
    } else if (field === 'na') {
      row.na_at = value ? (existing?.na_at ?? now) : null;
      row.na_by = value ? (existing?.na_by ?? actor ?? null) : null;
      // N/A and completed are mutually exclusive — marking N/A clears completed.
      // asked is left untouched (asked-but-declined is valid history).
      if (value) {
        row.completed_at = null;
        row.completed_by = null;
      }
    } else {
      // completed can only be set if asked is truthy
      if (value && !row.asked_at) {
        return NextResponse.json(
          { error: 'cannot mark completed before marking asked' },
          { status: 400 }
        );
      }
      // completed can't be set while the item is marked N/A
      if (value && row.na_at) {
        return NextResponse.json(
          { error: 'cannot mark completed while item is N/A — clear N/A first' },
          { status: 400 }
        );
      }
      row.completed_at = value ? (existing?.completed_at ?? now) : null;
      row.completed_by = value ? (existing?.completed_by ?? actor ?? null) : null;
    }

    const { error: upErr } = await supabase
      .from('client_advocacy_status')
      .upsert(row, { onConflict: 'client_id,item_key' });
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true, row });
  } catch (err) {
    console.error('advocacy status PATCH error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH notes only — separate endpoint via query param for simpler UI wiring.
 * Actually reusing the main PATCH by accepting notes in body already handles it.
 */
