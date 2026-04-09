/**
 * GET /api/clients/last-contact
 *
 * Returns the most recent communication date per client across
 * gmail_summaries, fathom_entries (meeting_date), and gchat_summaries (date).
 *
 * Response shape:
 *   { [client_id]: { last_contact_date: string, days_ago: number, source: string } }
 *
 * CANNOT: write data, accept POST/PATCH/DELETE, query tables other than
 * the three communication sources listed above.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface LastContactRow {
  client_id: string;
  last_contact: string;
  source: string;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Single query: get MAX date per client across all communication sources,
    // plus which source had the most recent contact.
    const { data, error } = await supabase.rpc('get_last_contact_per_client');

    // If the RPC doesn't exist yet, fall back to raw SQL via three parallel queries
    if (error) {
      const [gmailRes, fathomRes, gchatRes] = await Promise.all([
        supabase
          .from('gmail_summaries')
          .select('client_id, date')
          .not('client_id', 'is', null)
          .order('date', { ascending: false })
          .limit(1000),
        supabase
          .from('fathom_entries')
          .select('client_id, meeting_date')
          .not('client_id', 'is', null)
          .order('meeting_date', { ascending: false })
          .limit(1000),
        supabase
          .from('gchat_summaries')
          .select('client_id, date')
          .not('client_id', 'is', null)
          .order('date', { ascending: false })
          .limit(1000),
      ]);

      if (gmailRes.error) console.error('[last-contact] gmail_summaries query error:', gmailRes.error.message);
      if (fathomRes.error) console.error('[last-contact] fathom_entries query error:', fathomRes.error.message);
      if (gchatRes.error) console.error('[last-contact] gchat_summaries query error:', gchatRes.error.message);

      // Build a map: client_id -> { date, source }
      const contactMap: Record<string, { date: string; source: string }> = {};

      const updateMap = (clientId: string, dateStr: string, source: string) => {
        if (!clientId || !dateStr) return;
        const existing = contactMap[clientId];
        if (!existing || dateStr > existing.date) {
          contactMap[clientId] = { date: dateStr, source };
        }
      };

      for (const row of gmailRes.data ?? []) {
        updateMap(row.client_id, row.date, 'email');
      }
      for (const row of fathomRes.data ?? []) {
        updateMap(row.client_id, row.meeting_date, 'call');
      }
      for (const row of gchatRes.data ?? []) {
        updateMap(row.client_id, row.date, 'chat');
      }

      const now = new Date();
      const result: Record<string, { last_contact_date: string; days_ago: number; source: string }> = {};

      for (const [clientId, info] of Object.entries(contactMap)) {
        const contactDate = new Date(info.date);
        const diffMs = now.getTime() - contactDate.getTime();
        const daysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        result[clientId] = {
          last_contact_date: info.date,
          days_ago: daysAgo,
          source: info.source,
        };
      }

      return NextResponse.json(result);
    }

    // RPC succeeded — transform rows
    const now = new Date();
    const result: Record<string, { last_contact_date: string; days_ago: number; source: string }> = {};

    for (const row of (data as LastContactRow[]) ?? []) {
      const contactDate = new Date(row.last_contact);
      const diffMs = now.getTime() - contactDate.getTime();
      const daysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      result[row.client_id] = {
        last_contact_date: row.last_contact,
        days_ago: daysAgo,
        source: row.source,
      };
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
