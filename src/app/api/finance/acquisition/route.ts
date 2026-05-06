/**
 * GET /api/finance/acquisition
 *
 * Returns rolling-30-day customer acquisition metrics for the Finance dashboard.
 *
 * Definitions:
 *   - Marketing spend = accounting_entries entries in the last 30 days where:
 *       category = 'Marketing' AND name does NOT match excluded one-time tools
 *       PLUS Queenie's PayPal payments (Labor category, name match)
 *   - New client = a name whose FIRST income transaction across all of accounting_entries
 *       falls within the last 30 days. Identified by client_name match.
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

    // First-payment lookup across ALL of accounting_entries (income only) to identify new clients
    const { data: firstPayments, error: fpErr } = await supabase
      .from('accounting_entries')
      .select('name, transaction_date, entry_type')
      .eq('entry_type', 'income')
      .eq('is_balance_row', false)
      .eq('is_summary_row', false)
      .not('name', 'is', null);

    if (fpErr) {
      return NextResponse.json({ error: fpErr.message }, { status: 500 });
    }

    // Compute first payment date per CASE-INSENSITIVE normalized name.
    // Track display name (first/most-formal version seen) for showing in UI.
    const firstPaymentByNormName: Record<string, { date: string; displayName: string }> = {};
    for (const row of firstPayments ?? []) {
      const name = row.name as string;
      if (!name || isNonClientIncome(name)) continue;
      const norm = normalizeName(name);
      if (!norm) continue;
      const date = row.transaction_date as string;
      const existing = firstPaymentByNormName[norm];
      if (!existing || date < existing.date) {
        // Prefer titlecased display name (with capitals) over lowercase variants
        const isMoreFormal = !existing || /[A-Z]/.test(name);
        firstPaymentByNormName[norm] = {
          date,
          displayName: isMoreFormal ? name : existing.displayName,
        };
      }
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

    // Auto-suggest MRR by matching payment names to clients (via primary_contact_name + display_names),
    // then summing reporting_clients.monthly_revenue for that client. Manual mrrByKey wins.
    const { data: clientsRows } = await supabase
      .from('clients')
      .select('id, name, primary_contact_name, display_names');
    const { data: reportingRevRows } = await supabase
      .from('reporting_clients')
      .select('client_id, monthly_revenue, status')
      .eq('status', 'active');
    const revenueByClientId: Record<string, number> = {};
    for (const r of reportingRevRows ?? []) {
      if (!r.client_id) continue;
      revenueByClientId[r.client_id] = (revenueByClientId[r.client_id] ?? 0) + Number(r.monthly_revenue ?? 0);
    }
    // Build normalized-name → suggested MRR (sum across all matching clients)
    const suggestedMrrByNormName: Record<string, number> = {};
    for (const c of clientsRows ?? []) {
      const candidates: string[] = [];
      if (c.primary_contact_name) candidates.push(c.primary_contact_name);
      if (Array.isArray(c.display_names)) candidates.push(...(c.display_names as string[]));
      const clientRev = revenueByClientId[c.id] ?? 0;
      if (clientRev <= 0) continue;
      for (const cand of candidates) {
        const norm = normalizeName(cand);
        if (!norm) continue;
        suggestedMrrByNormName[norm] = (suggestedMrrByNormName[norm] ?? 0) + clientRev;
      }
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

      // New clients in window (first ever payment falls in window, case-insensitive)
      const newClients: Array<{ name: string; first_payment_date: string; monthly_mrr: number; mrr_source: 'manual' | 'auto' | 'none' }> = [];
      for (const [norm, info] of Object.entries(firstPaymentByNormName)) {
        if (info.date >= windowStart && info.date <= windowEnd) {
          const key = `${norm}::${info.date}`;
          const manual = mrrByKey[key];
          const suggested = suggestedMrrByNormName[norm];
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
