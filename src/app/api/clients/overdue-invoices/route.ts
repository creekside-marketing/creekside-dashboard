/**
 * GET /api/clients/overdue-invoices
 *
 * Returns per-client outstanding-invoice rollup from Square.
 *
 * Filter:
 *   - payment_status = 'UNPAID' (or NULL with '(unpaid)' in title)
 *   - amount >= $1,000 (filters out small one-off charges)
 *   - source_timestamp within last 180 days (cutoff to avoid stale data)
 *
 * Color thresholds:
 *   - < 14 days since invoice  → 'current' (no flag)
 *   - 14 - 29 days             → 'overdue' (yellow)
 *   - 30+ days                 → 'severe'  (red)
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

    const { data: rows, error } = await supabase
      .from('square_entries')
      .select('client_id, customer_name, amount_cents, source_timestamp, payment_status, title')
      .or('payment_status.eq.UNPAID,and(payment_status.is.null,title.ilike.%unpaid%)')
      .gte('amount_cents', 100000)
      .gte('source_timestamp', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .order('source_timestamp', { ascending: false });

    if (error) {
      return NextResponse.json({ error: `square_entries read failed: ${error.message}` }, { status: 500 });
    }

    const clients: Record<string, ClientRollup> = {};
    const unmatched: Array<InvoiceRow & { customer_name: string | null }> = [];
    const today = new Date();

    let totalCount = 0;
    let totalOutstanding = 0;

    for (const r of rows ?? []) {
      const amount = Number(r.amount_cents ?? 0) / 100;
      if (amount < 1000) continue;
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

      totalCount++;
      totalOutstanding += amount;

      const clientId = r.client_id as string | null;
      if (!clientId) {
        unmatched.push({ ...inv, customer_name: (r.customer_name as string | null) ?? null });
        continue;
      }

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

    // Round totals
    for (const id of Object.keys(clients)) {
      clients[id].total_outstanding = Math.round(clients[id].total_outstanding * 100) / 100;
    }

    return NextResponse.json({
      clients,
      unmatched,
      totals: {
        invoice_count: totalCount,
        total_outstanding: Math.round(totalOutstanding * 100) / 100,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
