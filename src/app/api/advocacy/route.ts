import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * GET /api/advocacy
 * Returns:
 *   - items: active catalog items (sorted by category, sort_order)
 *   - clients: eligible clients (active, includes retainers — advocacy is
 *     about growth not P&L, per Cade). Grouped as { active, churned }.
 *   - statuses: per-(client_id, item_key) status rows (only rows that exist)
 * The UI joins these three arrays client-side.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeChurned = url.searchParams.get('include_churned') === 'true';
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

    // 2. Clients — union of active canonical clients that have at least one
    // active reporting_clients row (excludes Jybr 'other' AI-agent rows only
    // when the client has no non-'other' rows — retainers are IN).
    const { data: reporting, error: repErr } = await supabase
      .from('reporting_clients')
      .select('client_id, client_category, status, platform')
      .eq('status', 'active');
    if (repErr) throw repErr;

    const eligibleClientIds = new Set<string>();
    for (const r of reporting ?? []) {
      // Skip 'other'-platform rows (Jybr AI-agent bookkeeping — not a Creekside client)
      if (r.platform === 'other') continue;
      if (r.client_id) eligibleClientIds.add(r.client_id as string);
    }

    let clientsQuery = supabase
      .from('clients')
      .select('id, name, status')
      .in('id', Array.from(eligibleClientIds));
    if (!includeChurned) clientsQuery = clientsQuery.eq('status', 'active');
    const { data: clients, error: clientsErr } = await clientsQuery;
    if (clientsErr) throw clientsErr;

    // Attach category (retainer vs standard) per client — take first row's category
    const categoryByClient: Record<string, string> = {};
    for (const r of reporting ?? []) {
      if (!r.client_id) continue;
      const existing = categoryByClient[r.client_id as string];
      // Prefer 'active'/standard over 'retainer' when a client has both platforms
      if (!existing || existing === 'retainer') {
        categoryByClient[r.client_id as string] = (r.client_category as string) ?? 'active';
      }
    }

    // 3. Statuses
    const { data: statuses, error: stErr } = await supabase
      .from('client_advocacy_status')
      .select('client_id, item_key, asked_at, asked_by, completed_at, completed_by, notes');
    if (stErr) throw stErr;

    return NextResponse.json({
      items: items ?? [],
      clients: (clients ?? [])
        .map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          category: categoryByClient[c.id as string] ?? 'active',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      statuses: statuses ?? [],
    });
  } catch (err) {
    console.error('advocacy GET error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
