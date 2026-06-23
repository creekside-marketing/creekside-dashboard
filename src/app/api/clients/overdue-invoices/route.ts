/**
 * GET /api/clients/overdue-invoices
 *
 * Returns per-client outstanding-invoice rollup from Square.
 *
 * Filters (per Cade's spec):
 *   - payment_status = 'UNPAID' OR (NULL status with '(unpaid)' in title)
 *   - source_timestamp within last 60 days (older invoices are stale receivables / write-offs)
 *   - Client must have at least one ACTIVE, non-retainer, non-'other' reporting_clients row
 *     (excludes Jybr AI clients, churned clients, retainer-only clients like Dominnik)
 *   - Per-client total outstanding >= $1,000 (small balances ignored)
 *
 * Color thresholds:
 *   - < 14 days since invoice  → 'current' (no flag)
 *   - 14 - 29 days             → 'overdue' (yellow)
 *   - 30+ days                 → 'severe'  (red)
 *
 * Amounts rounded to whole dollars (no decimals).
 *
 * Response shape:
 *   {
 *     clients: {
 *       [client_id]: {
 *         total_outstanding: number,
 *         invoice_count: number,
 *         oldest_days_since: number,
 *         status: 'current' | 'overdue' | 'severe',
 *         invoices: Array<{ amount, date, days_since, title, status }>
 *       }
 *     },
 *     unmatched: Array<{...}>  // invoices not linked to a canonical client
 *     totals: { invoice_count, total_outstanding }
 *   }
 *
 * READ-ONLY. No writes.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type InvoiceStatus = 'current' | 'overdue' | 'severe';

interface InvoiceRow {
  amount: number;
  date: string;
  days_since: number;
  title: string | null;
  status: InvoiceStatus;
}

interface ClientRollup {
  total_outstanding: number;
  invoice_count: number;
  oldest_days_since: number;
  status: InvoiceStatus;
  invoices: InvoiceRow[];
}

function statusFor(daysSince: number): InvoiceStatus {
  if (daysSince >= 30) return 'severe';
  if (daysSince >= 14) return 'overdue';
  return 'current';
}

function rankStatus(s: InvoiceStatus): number {
  if (s === 'severe') return 2;
  if (s === 'overdue') return 1;
  return 0;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Build set of eligible client_ids: at least one ACTIVE, non-retainer, non-'other' reporting_clients row.
    // Excludes Jybr AI agent clients, retainer-only clients, churned clients.
    const { data: rcRows } = await supabase
      .from('reporting_clients')
      .select('client_id, client_category, status, platform');

    const eligibleClientIds = new Set<string>();
    for (const r of rcRows ?? []) {
      const id = r.client_id as string | null;
      if (!id) continue;
      const cat = (r.client_category ?? 'active') as string;
      const status = (r.status ?? 'active') as string;
      const platform = (r.platform ?? '') as string;
      if (cat !== 'retainer' && status === 'active' && platform !== 'other') {
        eligibleClientIds.add(id);
      }
    }

    // Pull all candidate Square invoices in last 60 days
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('square_entries')
      .select('client_id, customer_name, amount_cents, source_timestamp, payment_status, title')
      .or('payment_status.eq.UNPAID,and(payment_status.is.null,title.ilike.%unpaid%)')
      .gte('source_timestamp', sixtyDaysAgo)
      .order('source_timestamp', { ascending: false });

    if (error) {
      return NextResponse.json({ error: `square_entries read failed: ${error.message}` }, { status: 500 });
    }

    const clients: Record<string, ClientRollup> = {};
    const unmatched: Array<InvoiceRow & { customer_name: string | null }> = [];
    const today = new Date();

    for (const r of rows ?? []) {
      const amount = Math.round(Number(r.amount_cents ?? 0) / 100);
      if (amount <= 0) continue;
      const ts = r.source_timestamp as string;
      const date = ts.slice(0, 10);
      const daysSince = Math.floor((today.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
      const status = statusFor(daysSince);

      const inv: InvoiceRow = {
        amount,
        date,
        days_since: daysSince,
        title: (r.title as string | null) ?? null,
        status,
      };

      const clientId = r.client_id as string | null;
      if (!clientId) {
        unmatched.push({ ...inv, customer_name: (r.customer_name as string | null) ?? null });
        continue;
      }

      // Skip if client isn't eligible (retainer-only, AI agent, churned, inactive)
      if (!eligibleClientIds.has(clientId)) continue;

      if (!clients[clientId]) {
        clients[clientId] = {
          total_outstanding: 0,
          invoice_count: 0,
          oldest_days_since: 0,
          status: 'current',
          invoices: [],
        };
      }
      const c = clients[clientId];
      c.total_outstanding += amount;
      c.invoice_count += 1;
      c.invoices.push(inv);
      if (daysSince > c.oldest_days_since) c.oldest_days_since = daysSince;
      if (rankStatus(status) > rankStatus(c.status)) c.status = status;
    }

    // Per-client threshold: only include clients whose TOTAL outstanding >= $1,000
    let totalCount = 0;
    let totalOutstanding = 0;
    for (const id of Object.keys(clients)) {
      if (clients[id].total_outstanding < 1000) {
        delete clients[id];
        continue;
      }
      totalCount += clients[id].invoice_count;
      totalOutstanding += clients[id].total_outstanding;
    }

    return NextResponse.json({
      clients,
      unmatched,
      totals: {
        invoice_count: totalCount,
        total_outstanding: totalOutstanding,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
