/**
 * GET /api/finance/trends
 *
 * Returns month-over-month financial trends for the Finance dashboard charts.
 *
 * For each of the last 6 calendar months, computes:
 *   - revenue (sum of accounting_entries income)
 *   - total_expenses (sum of accounting_entries expense)
 *   - expenses_by_category (breakdown)
 *   - marketing_spend (Marketing category minus excludes + Queenie Labor)
 *   - profit (revenue - total_expenses)
 *   - new_clients_count (clients whose first ever payment fell in that month)
 *   - cac (marketing_spend / new_clients_count)
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const MARKETING_EXCLUDE_NAMES = ['ZIPRECRUITER', 'ONLINEJOBSPH'];
const QUEENIE_NAME_PATTERNS = ['lovely queen del rosario', 'queenie', 'queen del rosario'];
const NEW_CLIENT_EXCLUDE_PATTERNS = ['interest', 'savings', 'tax refund', 'refund', 'transfer', 'square fee', 'paypal fee', 'reversal'];

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
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
function ymKey(date: string): string {
  return date.slice(0, 7); // 'YYYY-MM'
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const today = new Date();
    // Build last 6 month-keys (oldest first)
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const earliestMonthDate = `${months[0]}-01`;

    // Fetch all entries spanning the window
    const { data: entries, error: entriesErr } = await supabase
      .from('accounting_entries')
      .select('transaction_date, category, name, amount_cents, entry_type')
      .gte('transaction_date', earliestMonthDate)
      .lte('transaction_date', today.toISOString().slice(0, 10))
      .eq('is_balance_row', false)
      .eq('is_summary_row', false);

    if (entriesErr) {
      return NextResponse.json({ error: entriesErr.message }, { status: 500 });
    }

    // Pull all-time first payments to identify new clients per month
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

    const firstPayByNorm: Record<string, string> = {};
    for (const row of firstPayments ?? []) {
      const name = row.name as string;
      if (!name || isNonClientIncome(name)) continue;
      const norm = normalizeName(name);
      if (!norm) continue;
      const date = row.transaction_date as string;
      if (!firstPayByNorm[norm] || date < firstPayByNorm[norm]) {
        firstPayByNorm[norm] = date;
      }
    }
    // Bucket new clients per YYYY-MM
    const newClientsByMonth: Record<string, number> = {};
    for (const date of Object.values(firstPayByNorm)) {
      const m = ymKey(date);
      if (months.includes(m)) {
        newClientsByMonth[m] = (newClientsByMonth[m] ?? 0) + 1;
      }
    }

    // Aggregate per month
    const monthData = months.map(m => ({
      month: m,
      revenue: 0,
      total_expenses: 0,
      marketing_spend: 0,
      expenses_by_category: {} as Record<string, number>,
      new_clients_count: newClientsByMonth[m] ?? 0,
    }));
    const monthIndex: Record<string, number> = {};
    monthData.forEach((d, i) => { monthIndex[d.month] = i; });

    for (const e of entries ?? []) {
      const m = ymKey(e.transaction_date as string);
      const idx = monthIndex[m];
      if (idx === undefined) continue;
      const amt = Number(e.amount_cents ?? 0) / 100;
      const cat = (e.category as string) ?? 'Uncategorized';
      const name = e.name as string | null;
      if (e.entry_type === 'income') {
        monthData[idx].revenue += amt;
      } else if (e.entry_type === 'expense') {
        monthData[idx].total_expenses += amt;
        monthData[idx].expenses_by_category[cat] = (monthData[idx].expenses_by_category[cat] ?? 0) + amt;
        if (cat === 'Marketing' && !isExcludedMarketing(name)) {
          monthData[idx].marketing_spend += amt;
        } else if (cat === 'Labor' && isQueenie(name)) {
          monthData[idx].marketing_spend += amt;
        }
      }
    }

    const trend = monthData.map(d => ({
      month: d.month,
      revenue: round2(d.revenue),
      total_expenses: round2(d.total_expenses),
      profit: round2(d.revenue - d.total_expenses),
      margin_pct: d.revenue > 0 ? round2(((d.revenue - d.total_expenses) / d.revenue) * 100) : 0,
      marketing_spend: round2(d.marketing_spend),
      new_clients_count: d.new_clients_count,
      cac: d.new_clients_count > 0 ? round2(d.marketing_spend / d.new_clients_count) : null,
      expenses_by_category: Object.fromEntries(
        Object.entries(d.expenses_by_category).map(([k, v]) => [k, round2(v)])
      ),
    }));

    return NextResponse.json({ months: trend });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
