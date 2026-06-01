/**
 * POST /api/finance/detect-new-clients?windowHours=24&dryRun=false
 *
 * Scans recent paid Square invoices to find FIRST-PAYMENT events (= new client conversions).
 * For each conversion, looks up the matching ClickUp lead and tags the canonical client with
 * an acquisition_source.
 *
 * Source mapping (locked May 2026):
 *   - ClickUp Upwork Leads list (901705082579)        → acquisition_source = 'upwork'
 *   - ClickUp Other Leads list (901705085023)         → acquisition_source = 'other'
 *   - Partners/Connections (901710537605)             → IGNORED (partner Rolodex, not a lead pipeline)
 *
 * Writes are idempotent — clients with `engagement_details.acquisition_source` already set
 * are skipped unless ?force=true is passed.
 *
 * Triggered by Railway cron daily (POST). Also callable manually for backfill/debug.
 *
 * Returns a JSON report so the operator can see what was detected, matched, and written.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const UPWORK_LEADS_LIST_ID = '901705082579';
const OTHER_LEADS_LIST_ID = '901705085023';

type SourceTag = 'upwork' | 'other' | 'unknown';

interface ConversionResult {
  client_id: string | null;
  client_name: string | null;
  square_customer_name: string;
  first_payment_date: string;
  first_payment_amount: number;
  matched_clickup_task: string | null;
  matched_list_id: string | null;
  acquisition_source: SourceTag;
  action: 'wrote' | 'skipped_already_tagged' | 'skipped_no_canonical_client' | 'flagged_no_match';
  notes?: string;
}

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const windowHours = Math.max(1, Math.min(720, Number(searchParams.get('windowHours') ?? 24)));
    const dryRun = searchParams.get('dryRun') === 'true';
    const force = searchParams.get('force') === 'true';

    const supabase = createServiceClient();
    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    // 1. Pull all completed Square payments. For each customer (by client_id), determine
    //    earliest paid timestamp ever. If earliest falls in our window → conversion event.
    const { data: payments, error: payErr } = await supabase
      .from('square_entries')
      .select('client_id, customer_name, source_timestamp, amount_cents, payment_status, data_type')
      .eq('data_type', 'payment')
      .eq('payment_status', 'COMPLETED');

    if (payErr) {
      return NextResponse.json({ error: `square_entries read failed: ${payErr.message}` }, { status: 500 });
    }

    // Group by client_id (fallback to customer_name when client_id is null)
    const firstByKey = new Map<string, { key: string; client_id: string | null; customer_name: string; firstAt: string; firstAmount: number }>();
    for (const p of payments ?? []) {
      const key = (p.client_id as string | null) ?? `name::${normalizeName(p.customer_name as string)}`;
      if (!key || key === 'name::') continue;
      const existing = firstByKey.get(key);
      const ts = p.source_timestamp as string;
      if (!existing || ts < existing.firstAt) {
        firstByKey.set(key, {
          key,
          client_id: (p.client_id as string | null) ?? null,
          customer_name: (p.customer_name as string) ?? '',
          firstAt: ts,
          firstAmount: Number(p.amount_cents ?? 0) / 100,
        });
      }
    }

    const conversionsInWindow = Array.from(firstByKey.values()).filter(c => c.firstAt >= windowStart);

    if (conversionsInWindow.length === 0) {
      return NextResponse.json({ window_hours: windowHours, dry_run: dryRun, conversions_detected: 0, conversions: [] });
    }

    // 2. For each conversion, look up the canonical client + matching ClickUp lead.
    //    Match strategy:
    //      a. Resolve canonical client via square_entries.client_id (preferred) or fuzzy name match
    //      b. Get client.primary_contact_name + display_names
    //      c. Search clickup_entries for matching task_name in either Upwork Leads or Other Leads
    //      d. Upwork Leads match → upwork, Other Leads match → other, neither → unknown
    const clientIds = Array.from(new Set(conversionsInWindow.map(c => c.client_id).filter(Boolean))) as string[];

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, primary_contact_name, display_names, engagement_details')
      .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000']);

    const clientMap = new Map<string, { id: string; name: string; primary_contact_name: string | null; display_names: string[] | null; engagement_details: Record<string, unknown> | null }>();
    for (const c of clients ?? []) {
      clientMap.set(c.id as string, {
        id: c.id as string,
        name: c.name as string,
        primary_contact_name: c.primary_contact_name as string | null,
        display_names: (c.display_names as string[] | null) ?? null,
        engagement_details: (c.engagement_details as Record<string, unknown> | null) ?? null,
      });
    }

    // Pull all relevant ClickUp leads in one shot for matching
    const { data: clickupLeads } = await supabase
      .from('clickup_entries')
      .select('task_name, list_id, status, date_created')
      .in('list_id', [UPWORK_LEADS_LIST_ID, OTHER_LEADS_LIST_ID]);

    // Map normalized name → set of list_ids it appears in
    const nameToLists = new Map<string, { list_id: string; task_name: string }[]>();
    for (const lead of clickupLeads ?? []) {
      const norm = normalizeName(lead.task_name as string);
      if (!norm) continue;
      const arr = nameToLists.get(norm) ?? [];
      arr.push({ list_id: lead.list_id as string, task_name: lead.task_name as string });
      nameToLists.set(norm, arr);
    }

    const findClickUpMatch = (candidateNames: string[]): { list_id: string; task_name: string } | null => {
      for (const candidate of candidateNames) {
        const norm = normalizeName(candidate);
        if (!norm) continue;
        const hits = nameToLists.get(norm);
        if (hits && hits.length > 0) {
          // Prefer Upwork Leads if matched in both (deterministic tiebreak)
          const upwork = hits.find(h => h.list_id === UPWORK_LEADS_LIST_ID);
          return upwork ?? hits[0];
        }
        // Partial match: any task_name containing the candidate (or vice versa)
        for (const [leadNorm, hitArr] of nameToLists.entries()) {
          if (leadNorm.includes(norm) || norm.includes(leadNorm)) {
            const upwork = hitArr.find(h => h.list_id === UPWORK_LEADS_LIST_ID);
            return upwork ?? hitArr[0];
          }
        }
      }
      return null;
    };

    // 3. Build result rows, write updates (unless dryRun)
    const results: ConversionResult[] = [];

    for (const conv of conversionsInWindow) {
      const canonical = conv.client_id ? clientMap.get(conv.client_id) ?? null : null;

      // Build candidate names to search ClickUp by
      const candidates: string[] = [];
      if (canonical?.primary_contact_name) candidates.push(canonical.primary_contact_name);
      if (canonical?.display_names) candidates.push(...canonical.display_names);
      if (canonical?.name) candidates.push(canonical.name);
      candidates.push(conv.customer_name);

      const match = findClickUpMatch(candidates);
      const source: SourceTag = match
        ? match.list_id === UPWORK_LEADS_LIST_ID ? 'upwork'
          : match.list_id === OTHER_LEADS_LIST_ID ? 'other'
          : 'unknown'
        : 'unknown';

      let action: ConversionResult['action'] = 'flagged_no_match';
      let notes: string | undefined;

      if (!canonical) {
        action = 'skipped_no_canonical_client';
        notes = 'Square customer has no client_id link in square_entries. Backfill the link first.';
      } else {
        const alreadyTagged = canonical.engagement_details?.acquisition_source != null;
        if (alreadyTagged && !force) {
          action = 'skipped_already_tagged';
          notes = `Already tagged as ${String(canonical.engagement_details?.acquisition_source)}`;
        } else if (source === 'unknown') {
          action = 'flagged_no_match';
          notes = 'Customer name did not match any lead in Upwork Leads or Other Leads. Manual review needed.';
        } else if (!dryRun) {
          // Write the source
          const nextEngagement = {
            ...(canonical.engagement_details ?? {}),
            acquisition_source: source,
            acquisition_source_detail: match?.task_name ?? null,
            acquisition_source_set_at: new Date().toISOString(),
            acquisition_source_set_by: 'detect-new-clients (auto)',
          };
          const { error: updErr } = await supabase
            .from('clients')
            .update({ engagement_details: nextEngagement })
            .eq('id', canonical.id);
          if (updErr) {
            action = 'flagged_no_match';
            notes = `Write failed: ${updErr.message}`;
          } else {
            action = 'wrote';
          }
        } else {
          action = 'wrote'; // would-be-wrote in dry-run
          notes = '[dry run] would have written';
        }
      }

      results.push({
        client_id: canonical?.id ?? null,
        client_name: canonical?.name ?? null,
        square_customer_name: conv.customer_name,
        first_payment_date: conv.firstAt.slice(0, 10),
        first_payment_amount: conv.firstAmount,
        matched_clickup_task: match?.task_name ?? null,
        matched_list_id: match?.list_id ?? null,
        acquisition_source: source,
        action,
        notes,
      });
    }

    return NextResponse.json({
      window_hours: windowHours,
      dry_run: dryRun,
      conversions_detected: results.length,
      summary: {
        wrote: results.filter(r => r.action === 'wrote').length,
        skipped_already_tagged: results.filter(r => r.action === 'skipped_already_tagged').length,
        skipped_no_canonical_client: results.filter(r => r.action === 'skipped_no_canonical_client').length,
        flagged_no_match: results.filter(r => r.action === 'flagged_no_match').length,
      },
      conversions: results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

// Allow GET as a no-write dry-run for convenience
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  url.searchParams.set('dryRun', 'true');
  const fakeReq = new Request(url, { method: 'POST' }) as NextRequest;
  return POST(fakeReq);
}
