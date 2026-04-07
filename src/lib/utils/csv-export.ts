import type { MonthlyProjection } from '@/lib/engine';

export function generateCsv(monthly: MonthlyProjection[]): string {
  const headers = [
    'Month', 'Phase', 'Ad Spend',
    'Revenue (Low)', 'Revenue (Bench)', 'Revenue (High)',
    'Customers (Low)', 'Customers (Bench)', 'Customers (High)',
    'CAC',
    'Profit (Low)', 'Profit (Bench)', 'Profit (High)',
    'Cum. Profit (Low)', 'Cum. Profit (Bench)', 'Cum. Profit (High)',
  ];

  const rows = monthly.map((m) => [
    m.month,
    m.phase,
    m.adSpend.toFixed(2),
    m.revenue.low.toFixed(2), m.revenue.bench.toFixed(2), m.revenue.high.toFixed(2),
    m.customers.low.toFixed(2), m.customers.bench.toFixed(2), m.customers.high.toFixed(2),
    m.cac.toFixed(2),
    m.profit.low.toFixed(2), m.profit.bench.toFixed(2), m.profit.high.toFixed(2),
    m.cumulativeProfit.low.toFixed(2), m.cumulativeProfit.bench.toFixed(2), m.cumulativeProfit.high.toFixed(2),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadCsv(monthly: MonthlyProjection[], filename = 'roas-projections.csv') {
  const csv = generateCsv(monthly);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
