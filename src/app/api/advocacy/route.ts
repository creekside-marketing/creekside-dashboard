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

    const eligibleClientIds = new Set<string>();
    const retainerClientIds = new Set<string>();
    for (const r of reporting ?? []) {
      if (r.platform === 'other') continue; // exclude Jybr-only rows
      if (r.client_id) {
        eligibleClientIds.add(r.client_id as string);
        if (r.client_category === 'retainer') {
          retainerClientIds.add(r.client_id as string);
        }
      }
    }

    // 3. Pull all clients across all lifecycle statuses. archived = anything
    // other than 'active'. Includes churned/inactive/lost/lead.
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, advocacy_hidden')
      .in('id', Array.from(eligibleClientIds));
    if (clientsErr) throw clientsErr;

    // 4. Statuses (all clients — UI decides which to sum in totals based on
    // advocacy_hidden). Backend does not pre-filter so we can atomically show
    // hidden clients' preserved history if the user un-hides.
    const { data: statuses, error: stErr } = await supabase
      .from('client_advocacy_status')
      .select('client_id, item_key, asked_at, asked_by, completed_at, completed_by, notes');
    if (stErr) throw stErr;

    return NextResponse.json({
      items: items ?? [],
      clients: (clients ?? [])
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
