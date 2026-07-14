import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/advocacy
 * Returns:
 *   - items: active catalog items (sorted by category, sort_order)
 *   - clients: all canonical clients across active/churned/inactive/lost that
 *     have at least one non-'other' reporting_clients row (filters out Jybr
 *     AI-agent bookkeeping). Includes `status`, `category` (active/retainer/
 *     archived) and `advocacy_hidden` flag.
 *   - statuses: per-(client_id, item_key) status rows (only rows that exist)
 * The UI joins these three arrays client-side and groups by category.
 * archived = any status other than 'active'; retainer = has retainer-category row;
 * active = has active reporting_clients row and is not a retainer.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeInactive = url.searchParams.get('include_inactive_items') === 'true';

    const supabase = createServiceClient();

    // 1. Catalog
    let catalogQuery = supabase
      .from('advocacy_items_catalog')
      .select('item_key, label, category, description, sort_order, active')
      .order('sort_order', { ascending: true });
    if (!includeInactive) catalogQuery = catalogQuery.eq('active', true);
    const { data: items, error: itemsErr } = await catalogQuery;
    if (itemsErr) throw itemsErr;

    // 2. Pull ALL reporting_clients rows (all statuses) so we can classify
    // archived clients — they may still have reporting rows even if status
    // is not 'active'. We just need to know whether they have any non-'other'
    // platform to filter out pure Jybr entries.
    const { data: reporting, error: repErr } = await supabase
      .from('reporting_clients')
      .select('client_id, client_category, status, platform');
    if (repErr) throw repErr;

    // Track which client IDs have any non-'other' reporting row (used to gate
    // ACTIVE clients — Jybr AI-agent-only entries shouldn't appear). Archived
    // clients (churned/inactive/lost/lead) bypass this gate entirely — many of
    // them no longer have reporting_clients rows at all but we still want them
    // in the Archived section so Cade can chase advocacy items from past
    // clients.
    const nonOtherClientIds = new Set<string>();
    const retainerClientIds = new Set<string>();
    for (const r of reporting ?? []) {
      if (r.platform === 'other') continue;
      if (r.client_id) {
        nonOtherClientIds.add(r.client_id as string);
        if (r.client_category === 'retainer') {
          retainerClientIds.add(r.client_id as string);
        }
      }
    }

    // 3. Pull ALL canonical clients regardless of reporting_clients state,
    // then filter in memory: keep any client that either (a) has a
    // non-'other' reporting row, or (b) is archived (any status != 'active').
    // This includes all 64 inactive + 8 churned + 2 lost + 1 lead in the
    // Archived section, while still excluding pure Jybr AI-agent entries that
    // are 'active' but only exist via 'other'-platform rows.
    const { data: allClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, advocacy_hidden, advocacy_notes');
    if (clientsErr) throw clientsErr;

    // 4. Statuses (all clients — UI decides which to sum in totals based on
    // advocacy_hidden). Backend does not pre-filter so we can atomically show
    // hidden clients' preserved history if the user un-hides.
    const { data: statuses, error: stErr } = await supabase
      .from('client_advocacy_status')
      .select('client_id, item_key, asked_at, asked_by, completed_at, completed_by, na_at, na_by, notes');
    if (stErr) throw stErr;

    return NextResponse.json({
      items: items ?? [],
      clients: (allClients ?? [])
        .filter(c => {
          const isActive = c.status === 'active';
          // Active clients must have a non-'other' reporting row (excludes Jybr).
          // Archived clients (any non-active status) always pass — they may not
          // have any reporting rows anymore but we still want them visible.
          return isActive ? nonOtherClientIds.has(c.id as string) : true;
        })
        .map(c => {
          const isActive = c.status === 'active';
          const isRetainer = retainerClientIds.has(c.id as string);
          const category: 'active' | 'retainer' | 'archived' =
            !isActive ? 'archived' : isRetainer ? 'retainer' : 'active';
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            category,
            advocacy_hidden: c.advocacy_hidden ?? false,
            advocacy_notes: (c.advocacy_notes as string | null) ?? '',
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      statuses: statuses ?? [],
    });
  } catch (err) {
    console.error('advocacy GET error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
