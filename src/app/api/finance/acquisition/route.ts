/**
 * GET /api/finance/acquisition
 *
 * Returns rolling-30-day customer acquisition metrics for the Finance dashboard.
 *
 * Definitions:
 *   - Marketing spend = accounting_entries entries in the last 30 days where:
 *       category = 'Marketing' AND name does NOT match excluded one-time tools
 *       PLUS Queenie's PayPal payments (Labor category, name match)
 *   - New client = a name whose FIRST EVER payment falls within the last 30 days.
 *       Detection reads from BOTH accounting_entries (manual Google Sheet upload) AND
 *       square_entries (live paid invoices) and dedups by canonical client_id so a new
 *       client appears the moment Square sees a paid invoice — no waiting on accounting.
 *   - New MRR = sum of manually-entered MRR per new client (new_client_mrr table).
 *   - CAC = marketing_spend / new_client_count  (NULL if no new clients)
 *   - Cost of New MRR = marketing_spend / total_new_mrr  (NULL if 0 MRR)
 *
 * Returns the same metrics for the prior 30-day window (days 31-60 back) for delta comparison.
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { computeRevenueByClientId } from '@/lib/client-revenue';

// Names to EXCLUDE from marketing spend (one-time hires / tools that don't drive ongoing acquisition)
const MARKETING_EXCLUDE_NAMES = ['ZIPRECRUITER', 'ONLINEJOBSPH'];

// Names to INCLUDE as marketing spend even though Labor-categorized (Queenie's contractor payment)
const QUEENIE_NAME_PATTERNS = ['lovely queen del rosario', 'queenie', 'queen del rosario'];

// Income-name patterns that are NOT new clients (interest, fees, refunds, internal transfers)
const NEW_CLIENT_EXCLUDE_PATTERNS = [
  'interest',
  'savings',
  'tax refund',
  'refund',
  'transfer',
  'square fee',
  'paypal fee',
  'reversal',
];

function isExcludedMarketing(name: string | null | undefined): boolean {
  if (!name) return false;
  const upper = name.toUpperCase();
  return MARKETING_EXCLUDE_NAMES.some(ex => upper.includes(ex));
}

function isQueenie(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return QUEENIE_NAME_PATTERNS.some(p => lower.includes(p));
}

function isNonClientIncome(name: string | null | undefined): boolean {
  if (!name) return true;
  const lower = name.toLowerCase();
  return NEW_CLIENT_EXCLUDE_PATTERNS.some(p => lower.includes(p));
}

/** Normalize a payer name for grouping (case-insensitive, whitespace-trimmed, common annotations stripped). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ') // strip "(Feb inv)" etc
    .replace(/\s+/g, ' ')
    .trim();
}

type WindowMetrics = {
  marketing_spend: number;
  new_client_count: number;
  new_clients: Array<{ name: string; first_payment_date: string; monthly_mrr: number; mrr_source: 'manual' | 'auto' | 'none' }>;
  new_mrr_total: number;
  cac: number | null;
  cost_of_new_mrr: number | null;
};

export async function GET() {
  try {
    const supabase = createServiceClient();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const day30 = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const day60 = new Date(today.getTime() - 60 * 86400000).toISOString().slice(0, 10);

    // Pull all marketing-eligible entries in the last 60 days (covers both windows in one fetch)
    const { data: entries, error: entriesErr } = await supabase
      .from('accounting_entries')
      .select('transaction_date, category, name, amount_cents, entry_type')
      .gte('transaction_date', day60)
      .lte('transaction_date', todayStr)
      .eq('is_balance_row', false)
      .eq('is_summary_row', false);

    if (entriesErr) {
      return NextResponse.json({ error: entriesErr.message }, { status: 500 });
    }

    // Pull canonical clients FIRST so we can dedup payment sources by client_id.
    const { data: clientsRows } = await supabase
      .from('clients')
      .select('id, name, primary_contact_name, display_names');

    // normalizedNameVariant → canonical client_id (first variant wins for ties)
    const clientIdByNormName: Record<string, string> = {};
    const clientNameById: Record<string, string> = {};
    for (const c of clientsRows ?? []) {
      if (!c?.id) continue;
      clientNameById[c.id] = c.name;
      const variants = new Set<string>();
      variants.add(normalizeName(c.name));
      if (c.primary_contact_name) variants.add(normalizeName(c.primary_contact_name));
      if (Array.isArray(c.display_names)) {
        for (const dn of c.display_names as string[]) variants.add(normalizeName(dn));
      }
      variants.delete('');
      for (const v of variants) {
        if (!clientIdByNormName[v]) clientIdByNormName[v] = c.id;
      }
    }

    // First-payment-ever map. Key = canonical client_id when known, else 'name::<normalized>'.
    // Reads from BOTH accounting_entries (manual Google Sheet upload) AND square_entries
    // (live Square sync). This way new clients show up the moment they pay an invoice in
    // Square — no waiting on the monthly accounting upload.
    type FirstPayment = { date: string; displayName: string; normName: string; clientId: string | null };
    const firstPaymentByKey: Record<string, FirstPayment> = {};

    const recordFirstPayment = (rawName: string | null | undefined, date: string | null | undefined) => {
      if (!rawName || !date || isNonClientIncome(rawName)) return;
      const norm = normalizeName(rawName);
      if (!norm) return;
      const clientId = clientIdByNormName[norm] ?? null;
      const key = clientId ?? `name::${norm}`;
      const preferredName = clientId ? clientNameById[clientId] : rawName;
      const existing = firstPaymentByKey[key];
      if (!existing || date < existing.date) {
        firstPaymentByKey[key] = { date, displayName: preferredName, normName: norm, clientId };
      }
    };

    // Feed: accounting_entries income (historical, includes pre-Square-sync data)
    const { data: firstPayments, error: fpErr } = await supabase
      .from('accounting_entries')
      .select('name, transaction_date')
      .eq('entry_type', 'income')
      .eq('is_balance_row', false)
      .eq('is_summary_row', false)
      .not('name', 'is', null);
    if (fpErr) {
      return NextResponse.json({ error: fpErr.message }, { status: 500 });
    }
    for (const row of firstPayments ?? []) {
      recordFirstPayment(row.name as string, row.transaction_date as string);
    }

    // Feed: square_entries (live paid invoices — no manual upload required)
    const { data: squarePayments, error: spErr } = await supabase
      .from('square_entries')
      .select('customer_name, source_timestamp, amount_cents, payment_status')
      .eq('payment_status', 'COMPLETED')
      .gt('amount_cents', 0)
      .not('customer_name', 'is', null);
    if (spErr) {
      return NextResponse.json({ error: spErr.message }, { status: 500 });
    }
    for (const row of squarePayments ?? []) {
      const date = (row.source_timestamp as string | null)?.slice(0, 10) ?? null;
      recordFirstPayment(row.customer_name as string, date);
    }

    // Pull manually-entered MRR per client
    const { data: mrrRows, error: mrrErr } = await supabase
      .from('new_client_mrr')
      .select('client_name, first_payment_date, monthly_mrr');
    if (mrrErr) {
      return NextResponse.json({ error: mrrErr.message }, { status: 500 });
    }
    const mrrByKey: Record<string, number> = {};
    for (const row of mrrRows ?? []) {
      const key = `${normalizeName(row.client_name)}::${row.first_payment_date}`;
      mrrByKey[key] = Number(row.monthly_mrr ?? 0);
    }

    // Auto-suggest MRR via canonical client_id → fee-engine revenue. Reuses the same
    // name-variant lookup as firstPayment so behaviour stays consistent.
    const revenueByClientId = await computeRevenueByClientId(supabase);
    const suggestedMrrByNormName: Record<string, number> = {};
    for (const [norm, id] of Object.entries(clientIdByNormName)) {
      const rev = revenueByClientId[id] ?? 0;
      if (rev > 0) suggestedMrrByNormName[norm] = rev;
    }

    // Helper to compute window metrics
    const buildWindow = (windowStart: string, windowEnd: string): WindowMetrics => {
      // Marketing spend in window
      let spend = 0;
      for (const e of entries ?? []) {
        const d = e.transaction_date as string;
        if (d < windowStart || d > windowEnd) continue;
        if (e.entry_type !== 'expense') continue;
        const amt = Number(e.amount_cents ?? 0) / 100;
        const cat = e.category;
        const name = e.name as string | null;
        if (cat === 'Marketing' && !isExcludedMarketing(name)) {
          spend += amt;
        } else if (cat === 'Labor' && isQueenie(name)) {
          spend += amt;
        }
      }

      // New clients in window (first ever payment falls in window, case-insensitive).
      // Excludes unmatched payments (no canonical client_id) — these are one-time/audit
      // payments or new clients that haven't been added to the clients table yet. The
      // "every new client must be in the dashboard" workflow enforces canonical-first.
      const newClients: Array<{ name: string; first_payment_date: string; monthly_mrr: number; mrr_source: 'manual' | 'auto' | 'none' }> = [];
      for (const info of Object.values(firstPaymentByKey)) {
        if (!info.clientId) continue;
        if (info.date >= windowStart && info.date <= windowEnd) {
          const key = `${info.normName}::${info.date}`;
          const manual = mrrByKey[key];
          const suggested = suggestedMrrByNormName[info.normName];
          let mrr = 0;
          let source: 'manual' | 'auto' | 'none' = 'none';
          if (manual !== undefined) {
            mrr = manual; source = 'manual';
          } else if (suggested !== undefined && suggested > 0) {
            mrr = suggested; source = 'auto';
          }
          newClients.push({
            name: info.displayName,
            first_payment_date: info.date,
            monthly_mrr: mrr,
            mrr_source: source,
          });
        }
      }
      newClients.sort((a, b) => a.first_payment_date.localeCompare(b.first_payment_date));

      const newMrrTotal = newClients.reduce((s, c) => s + c.monthly_mrr, 0);
      const cac = newClients.length > 0 ? spend / newClients.length : null;
      const costOfNewMrr = newMrrTotal > 0 ? spend / newMrrTotal : null;

      return {
        marketing_spend: round2(spend),
        new_client_count: newClients.length,
        new_clients: newClients,
        new_mrr_total: round2(newMrrTotal),
        cac: cac !== null ? round2(cac) : null,
        cost_of_new_mrr: costOfNewMrr !== null ? round2(costOfNewMrr) : null,
      };
    };

    const current = buildWindow(day30, todayStr);
    const prior = buildWindow(day60, day30);

    return NextResponse.json({
      current_window: { start: day30, end: todayStr, ...current },
      prior_window: { start: day60, end: day30, ...prior },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
