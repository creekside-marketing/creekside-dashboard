/**
 * GET /api/clients/churn-risk
 *
 * Returns a churn risk score per client (keyed by client_id) based on:
 *   1. Days since last contact (0-40 pts)
 *   2. Payment status from accounting_entries (0-30 pts)
 *   3. Budget trend from revenue_by_client (0-20 pts)
 *   4. Tenure — newer clients churn more (0-10 pts)
 *   5. Communication frequency trend (0-10 pts)
 *
 * Score ranges: 0-15 = LOW, 16-35 = MEDIUM, 36+ = HIGH
 *
 * Response shape:
 *   { [client_id]: { score, level, factors: string[], client_name } }
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

interface ChurnRiskResult {
  score: number;
  level: RiskLevel;
  factors: string[];
  client_name: string;
}

function scoreToLevel(score: number): RiskLevel {
  if (score <= 15) return 'LOW';
  if (score <= 35) return 'MEDIUM';
  return 'HIGH';
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();

    // ── Parallel data fetches ──────────────────────────────────────────
    const [
      clientsRes,
      masterClientsRes,
      lastContactRes,
      revenueRes,
      unpaidRes,
      recentCommsRes,
      priorCommsRes,
    ] = await Promise.all([
      // Active reporting_clients (links client_id + client_name)
      supabase
        .from('reporting_clients')
        .select('id, client_id, client_name, status')
        .neq('status', 'churned'),

      // Master clients table for start_date (tenure)
      supabase
        .from('clients')
        .select('id, name, start_date')
        .eq('status', 'active'),

      // Last contact: reuse the same three-source approach
      Promise.all([
        supabase
          .from('gmail_summaries')
          .select('client_id, date')
          .not('client_id', 'is', null)
          .order('date', { ascending: false }),
        supabase
          .from('fathom_entries')
          .select('client_id, meeting_date')
          .not('client_id', 'is', null)
          .order('meeting_date', { ascending: false }),
        supabase
          .from('gchat_summaries')
          .select('client_id, date')
          .not('client_id', 'is', null)
          .order('date', { ascending: false }),
      ]),

      // Revenue by client — last 4 months for trend analysis
      (() => {
        const fourMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 4, 1);
        const cutoff = fourMonthsAgo.toISOString().split('T')[0];
        return supabase
          .from('revenue_by_client')
          .select('client_id, month_date, total_revenue')
          .not('client_id', 'is', null)
          .gte('month_date', cutoff)
          .order('month_date', { ascending: false });
      })(),

      // Unpaid invoices: income entries with no matching payment
      // Look for income entries in last 90 days that haven't been paid
      supabase
        .from('accounting_entries')
        .select('client_id, entry_type, category, transaction_date, amount_cents')
        .not('client_id', 'is', null)
        .eq('entry_type', 'income')
        .eq('category', 'Revenue')
        .gte('transaction_date', new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]),

      // Communication frequency — last 30 days
      (() => {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        return Promise.all([
          supabase
            .from('gmail_summaries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('date', thirtyDaysAgo),
          supabase
            .from('fathom_entries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('meeting_date', thirtyDaysAgo),
          supabase
            .from('gchat_summaries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('date', thirtyDaysAgo),
        ]);
      })(),

      // Communication frequency — prior 30 days (30-60 days ago)
      (() => {
        const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        return Promise.all([
          supabase
            .from('gmail_summaries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('date', sixtyDaysAgo)
            .lt('date', thirtyDaysAgo),
          supabase
            .from('fathom_entries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('meeting_date', sixtyDaysAgo)
            .lt('meeting_date', thirtyDaysAgo),
          supabase
            .from('gchat_summaries')
            .select('client_id')
            .not('client_id', 'is', null)
            .gte('date', sixtyDaysAgo)
            .lt('date', thirtyDaysAgo),
        ]);
      })(),
    ]);

    // ── Build lookup maps ──────────────────────────────────────────────

    // Unique active clients (deduplicate by client_id)
    const clientMap = new Map<string, string>(); // client_id -> client_name
    for (const row of clientsRes.data ?? []) {
      if (row.client_id && !clientMap.has(row.client_id)) {
        clientMap.set(row.client_id, row.client_name);
      }
    }

    // 1. Last contact days per client_id
    const [gmailRes, fathomRes, gchatRes] = lastContactRes;
    const contactMap: Record<string, string> = {}; // client_id -> latest date string

    const updateContact = (clientId: string, dateStr: string) => {
      if (!clientId || !dateStr) return;
      if (!contactMap[clientId] || dateStr > contactMap[clientId]) {
        contactMap[clientId] = dateStr;
      }
    };

    for (const row of gmailRes.data ?? []) updateContact(row.client_id, row.date);
    for (const row of fathomRes.data ?? []) updateContact(row.client_id, row.meeting_date);
    for (const row of gchatRes.data ?? []) updateContact(row.client_id, row.date);

    // 2. Tenure from clients table (start_date)
    const tenureMap = new Map<string, Date | null>();
    for (const row of masterClientsRes.data ?? []) {
      tenureMap.set(row.id, row.start_date ? new Date(row.start_date) : null);
    }

    // 3. Revenue trend: group by client, compare recent vs prior months
    const revenueByClient: Record<string, Record<string, number>> = {};
    for (const row of revenueRes.data ?? []) {
      if (!row.client_id) continue;
      if (!revenueByClient[row.client_id]) revenueByClient[row.client_id] = {};
      const month = row.month_date;
      revenueByClient[row.client_id][month] =
        (revenueByClient[row.client_id][month] ?? 0) + parseFloat(row.total_revenue);
    }

    // 4. Payment status: count revenue entries per client (proxy for unpaid)
    // Since we only have income/Revenue entries, count months with revenue vs expected
    const revenueEntries: Record<string, number> = {};
    for (const row of unpaidRes.data ?? []) {
      if (!row.client_id) continue;
      revenueEntries[row.client_id] = (revenueEntries[row.client_id] ?? 0) + 1;
    }

    // 5. Communication frequency: count touches per client in each period
    const [recentGmail, recentFathom, recentGchat] = recentCommsRes;
    const [priorGmail, priorFathom, priorGchat] = priorCommsRes;

    const recentComms: Record<string, number> = {};
    const priorComms: Record<string, number> = {};

    for (const row of recentGmail.data ?? []) recentComms[row.client_id] = (recentComms[row.client_id] ?? 0) + 1;
    for (const row of recentFathom.data ?? []) recentComms[row.client_id] = (recentComms[row.client_id] ?? 0) + 1;
    for (const row of recentGchat.data ?? []) recentComms[row.client_id] = (recentComms[row.client_id] ?? 0) + 1;

    for (const row of priorGmail.data ?? []) priorComms[row.client_id] = (priorComms[row.client_id] ?? 0) + 1;
    for (const row of priorFathom.data ?? []) priorComms[row.client_id] = (priorComms[row.client_id] ?? 0) + 1;
    for (const row of priorGchat.data ?? []) priorComms[row.client_id] = (priorComms[row.client_id] ?? 0) + 1;

    // ── Score each client ──────────────────────────────────────────────

    const result: Record<string, ChurnRiskResult> = {};

    for (const [clientId, clientName] of clientMap) {
      let score = 0;
      const factors: string[] = [];

      // Factor 1: Days since last contact
      const lastDate = contactMap[clientId];
      if (lastDate) {
        const daysAgo = Math.floor(
          (now.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysAgo >= 30) {
          score += 40;
          factors.push(`No contact in ${daysAgo} days`);
        } else if (daysAgo >= 21) {
          score += 25;
          factors.push(`Last contact ${daysAgo} days ago`);
        } else if (daysAgo >= 14) {
          score += 10;
          factors.push(`Last contact ${daysAgo} days ago`);
        }
      } else {
        // No contact data at all — treat as high risk
        score += 40;
        factors.push('No contact data found');
      }

      // Factor 2: Payment status
      // Check if this client has revenue entries in the last 3 months
      // Clients expected to pay monthly: 0 entries = unpaid, 1 = partial, 2-3 = OK
      const entryCount = revenueEntries[clientId] ?? 0;
      if (entryCount === 0) {
        // No revenue entries could mean data gap — check if they have any revenue data
        const hasRevenueData = revenueByClient[clientId] && Object.keys(revenueByClient[clientId]).length > 0;
        if (hasRevenueData) {
          score += 15;
          factors.push('No recent payment recorded');
        }
        // If no revenue data at all, skip this factor (data gap, not risk signal)
      }

      // Factor 3: Budget/revenue trend
      const clientRevenue = revenueByClient[clientId];
      if (clientRevenue) {
        const months = Object.keys(clientRevenue).sort().reverse();
        if (months.length >= 2) {
          const recent = clientRevenue[months[0]];
          const prior = clientRevenue[months[1]];
          if (prior > 0) {
            const changePct = ((recent - prior) / prior) * 100;
            if (changePct <= -25) {
              score += 20;
              factors.push(`Revenue declined ${Math.abs(Math.round(changePct))}%`);
            } else if (changePct <= -10) {
              score += 10;
              factors.push(`Revenue declining ${Math.abs(Math.round(changePct))}%`);
            }
          }
        }
      }

      // Factor 4: Tenure
      const startDate = tenureMap.get(clientId);
      if (startDate) {
        const tenureMonths = Math.floor(
          (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        );
        if (tenureMonths < 6) {
          score += 10;
          factors.push(`New client (${tenureMonths} months)`);
        } else if (tenureMonths < 12) {
          score += 5;
          factors.push(`Under 1 year tenure (${tenureMonths} months)`);
        }
      }

      // Factor 5: Communication frequency trend
      const recent = recentComms[clientId] ?? 0;
      const prior = priorComms[clientId] ?? 0;
      if (prior > 0 && recent < prior) {
        score += 10;
        factors.push(`Communication declining (${recent} vs ${prior} prior)`);
      } else if (prior === 0 && recent === 0) {
        // No comms in 60 days — already captured by factor 1
      }

      result[clientId] = {
        score,
        level: scoreToLevel(score),
        factors,
        client_name: clientName,
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
