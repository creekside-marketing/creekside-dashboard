/**
 * GET /api/finance/expenses
 *
 * Returns last full month's actuals + this month's projection state for the Finance dashboard.
 *
 * Sources:
 *   - accounting_entries  (Square + manual sheet sync; last actual month)
 *   - monthly_expense_projections  (editable per-category projections for current month)
 *
 * Response:
 *   {
 *     last_month:    { month_date, revenue, expenses_by_category, total_expenses, profit, margin_pct }
 *     this_month:    { month_date, projected_revenue, projected_expenses_by_category, projected_total_expenses, projected_profit, projected_margin_pct }
 *     categories:    string[]   (canonical expense categories present in either month)
 *   }
 *
 * "Last month" = most recent full calendar month with any expense activity in accounting_entries.
 * "This month projected" = each category defaults to last month's actual unless overridden in monthly_expense_projections.
 *
 * CANNOT: write data, accept POST/PATCH/DELETE.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculatePlatformRevenue, type FeeConfig } from '@/lib/fee-engine';

export async function GET() {
  try {
    const supabase = createServiceClient();

    // 1. Find the most recent month with expense activity.
    const { data: latestRow, error: latestErr } = await supabase
      .from('accounting_entries')
      .select('month_date')
      .eq('entry_type', 'expense')
      .eq('is_balance_row', false)
      .eq('is_summary_row', false)
      .lte('month_date', new Date().toISOString().slice(0, 10))
      .order('month_date', { ascending: false })
      .limit(1);

    if (latestErr) {
      return NextResponse.json({ error: latestErr.message }, { status: 500 });
    }

    const lastMonthDate = latestRow?.[0]?.month_date as string | undefined;
    if (!lastMonthDate) {
      return NextResponse.json({ error: 'No expense data found in accounting_entries' }, { status: 404 });
    }

    // Compute this month's date (first of current month).
    const now = new Date();
    const thisMonthDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    // 2. Pull last month's actuals grouped by category.
    const { data: lastMonthRows, error: lmErr } = await supabase
      .from('accounting_entries')
      .select('category, entry_type, amount_cents')
      .eq('month_date', lastMonthDate)
      .eq('is_balance_row', false)
      .eq('is_summary_row', false);

    if (lmErr) {
      return NextResponse.json({ error: lmErr.message }, { status: 500 });
    }

    const lastExpensesByCategory: Record<string, number> = {};
    let lastRevenue = 0;
    for (const row of lastMonthRows ?? []) {
      const amt = Number(row.amount_cents ?? 0) / 100;
      if (row.entry_type === 'income') {
        lastRevenue += amt;
      } else if (row.entry_type === 'expense') {
        const cat = row.category ?? 'Uncategorized';
        lastExpensesByCategory[cat] = (lastExpensesByCategory[cat] ?? 0) + amt;
      }
    }
    const lastTotalExpenses = Object.values(lastExpensesByCategory).reduce((s, v) => s + v, 0);
    const lastProfit = lastRevenue - lastTotalExpenses;
    const lastMargin = lastRevenue > 0 ? (lastProfit / lastRevenue) * 100 : 0;

    // 3. Pull this month's projections (overrides).
    const { data: projRows, error: projErr } = await supabase
      .from('monthly_expense_projections')
      .select('category, projected_amount, notes')
      .eq('month_date', thisMonthDate);

    if (projErr) {
      return NextResponse.json({ error: projErr.message }, { status: 500 });
    }

    const projectionsByCategory: Record<string, number> = {};
    const notesByCategory: Record<string, string> = {};
    for (const row of projRows ?? []) {
      projectionsByCategory[row.category] = Number(row.projected_amount ?? 0);
      if (row.notes) notesByCategory[row.category] = row.notes;
    }

    // 4. Compose this month's projected expenses (default = last month's actual).
    const allCategories = Array.from(
      new Set([...Object.keys(lastExpensesByCategory), ...Object.keys(projectionsByCategory)])
    ).sort();

    const projectedByCategory: Record<string, { last_actual: number; projected: number; overridden: boolean; notes?: string }> = {};
    let projectedTotalExpenses = 0;
    for (const cat of allCategories) {
      const lastActual = lastExpensesByCategory[cat] ?? 0;
      const overridden = Object.prototype.hasOwnProperty.call(projectionsByCategory, cat);
      const projected = overridden ? projectionsByCategory[cat] : lastActual;
      projectedByCategory[cat] = {
        last_actual: round2(lastActual),
        projected: round2(projected),
        overridden,
        notes: notesByCategory[cat],
      };
      projectedTotalExpenses += projected;
    }

    // 5. Projected revenue: pull from active non-retainer reporting_clients using fee_engine.
    // Mirrors the Clients dashboard "Est. Monthly Revenue" tile (budget-based fallback path).
    const { data: revenueRows, error: revErr } = await supabase
      .from('reporting_clients')
      .select('id, client_name, fee_config, monthly_budget, monthly_revenue, revenue_override, status, client_category')
      .eq('status', 'active')
      .neq('client_category', 'retainer');

    if (revErr) {
      return NextResponse.json({ error: revErr.message }, { status: 500 });
    }

    // Pre-compute per-client totals (sum of budgets, count of platform rows)
    const totalBudgetByClient: Record<string, number> = {};
    const platformCountByClient: Record<string, number> = {};
    for (const row of revenueRows ?? []) {
      const name = row.client_name;
      totalBudgetByClient[name] = (totalBudgetByClient[name] ?? 0) + Number(row.monthly_budget ?? 0);
      platformCountByClient[name] = (platformCountByClient[name] ?? 0) + 1;
    }

    let projectedRevenue = 0;
    for (const row of revenueRows ?? []) {
      const name = row.client_name;
      const platformCount = platformCountByClient[name] ?? 1;
      const totalBudget = totalBudgetByClient[name] ?? 0;
      const thisBudget = Number(row.monthly_budget ?? 0);
      const monthlyRev = row.monthly_revenue == null ? null : Number(row.monthly_revenue);

      let value = 0;
      if (row.revenue_override && monthlyRev != null) {
        value = monthlyRev;
      } else if (row.fee_config && thisBudget > 0) {
        value = calculatePlatformRevenue(row.fee_config as FeeConfig, thisBudget, totalBudget, platformCount);
      } else if (monthlyRev != null && monthlyRev > 0) {
        value = monthlyRev;
      }
      projectedRevenue += value;
    }

    const projectedProfit = projectedRevenue - projectedTotalExpenses;
    const projectedMargin = projectedRevenue > 0 ? (projectedProfit / projectedRevenue) * 100 : 0;

    return NextResponse.json({
      last_month: {
        month_date: lastMonthDate,
        revenue: round2(lastRevenue),
        expenses_by_category: Object.fromEntries(
          Object.entries(lastExpensesByCategory).map(([k, v]) => [k, round2(v)])
        ),
        total_expenses: round2(lastTotalExpenses),
        profit: round2(lastProfit),
        margin_pct: round2(lastMargin),
      },
      this_month: {
        month_date: thisMonthDate,
        projected_revenue: round2(projectedRevenue),
        projected_expenses_by_category: projectedByCategory,
        projected_total_expenses: round2(projectedTotalExpenses),
        projected_profit: round2(projectedProfit),
        projected_margin_pct: round2(projectedMargin),
      },
      categories: allCategories,
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
