import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * PATCH /api/advocacy/notes
 * Body: { client_id: uuid, notes: string }
 * Writes clients.advocacy_notes — free-text shown under the client name on the
 * Advocacy tab. Empty string clears the field.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { client_id, notes } = body ?? {};
    if (typeof client_id !== 'string' || typeof notes !== 'string') {
      return NextResponse.json({ error: 'client_id (uuid) and notes (string) required' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('clients')
      .update({ advocacy_notes: notes.length > 0 ? notes : null })
      .eq('id', client_id);
    if (error) throw error;

    return NextResponse.json({ ok: true, client_id, notes });
  } catch (err) {
    console.error('advocacy notes PATCH error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
