/**
 * GET /api/clients/revenue
 *
 * Returns actual Square revenue data per client from the `revenue_by_client` view.
 * Aggregates the last 3 months to compute avg monthly revenue, last month total,
 * and a simple trend indicator.
 *
 * Response shape:
 *   { [client_id]: { avg_monthly: number, last_month: number, trend: 'up'|'down'|'flat' } }
 *
 * CANNOT: write data, accept POST/PATCH/DELETE, query tables other than revenue_by_client.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

interface RevenueRow {
  client_id: string;
  month_date: string;
  total_revenue: string;
}

interface ClientRevenueSummary {
  avg_monthly: number;
  last_month: number;
  trend: 'up' | 'down' | 'flat';
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Get revenue data for the last 3 full months
    // Use first-of-month 3 months ago as the cutoff
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const cutoff = threeMonthsAgo.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('revenue_by_client')
      .select('client_id, month_date, total_revenue')
      .not('client_id', 'is', null)
      .gte('month_date', cutoff)
      .order('month_date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Group by client_id, aggregate per month
    const byClient: Record<string, Record<string, number>> = {};
    for (const row of (data as RevenueRow[]) ?? []) {
      if (!row.client_id) continue;
      if (!byClient[row.client_id]) byClient[row.client_id] = {};
      const month = row.month_date;
      byClient[row.client_id][month] =
        (byClient[row.client_id][month] ?? 0) + parseFloat(row.total_revenue);
    }

    // Compute avg, last month, and trend per client
    const result: Record<string, ClientRevenueSummary> = {};

    for (const [clientId, monthMap] of Object.entries(byClient)) {
      const months = Object.keys(monthMap).sort().reverse(); // newest first
      const values = months.map((m) => monthMap[m]);

      const lastMonth = values[0] ?? 0;
      const avg =
        values.length > 0
          ? values.reduce((sum, v) => sum + v, 0) / values.length
          : 0;

      // Trend: compare most recent month to the one before it
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (values.length >= 2) {
        const diff = values[0] - values[1];
        const threshold = values[1] * 0.1; // 10% change threshold
        if (diff > threshold) trend = 'up';
        else if (diff < -threshold) trend = 'down';
      }

      result[clientId] = {
        avg_monthly: Math.round(avg * 100) / 100,
        last_month: Math.round(lastMonth * 100) / 100,
        trend,
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
