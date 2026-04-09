'use client';

/**
 * SparklineKpiCard — KPI card with an optional inline sparkline chart.
 *
 * Extends the existing KpiCard pattern with:
 * - Optional `sparklineData` array rendered as a tiny Recharts LineChart
 * - Optional `target` value shown as a dashed reference line on the sparkline
 *
 * CANNOT: Fetch data — receives all values via props.
 * CANNOT: Handle click interactions — display only.
 * CANNOT: Render axes, grids, tooltips, or legends on the sparkline.
 */

import { LineChart, Line, ReferenceLine, ResponsiveContainer } from 'recharts';
import { REPORT_COLORS, getChangeColor } from './report-colors';

// ── Types ────────────────────────────────────────────────────────────────

interface SparklineKpiCardProps {
  label: string;
  value: string;
  change?: string;
  changeDirection?: 'up' | 'down' | 'flat';
  /** Controls semantic meaning of change direction */
  changeSentiment?: 'positive-up' | 'negative-up' | 'neutral';
  size?: 'lg' | 'sm';
  /** Optional array of numeric values for the sparkline */
  sparklineData?: number[];
  /** Optional target value — rendered as a dashed reference line */
  target?: number;
}

interface SparklinePoint {
  value: number;
}

// ── Component ────────────────────────────────────────────────────────────

export default function SparklineKpiCard({
  label,
  value,
  change,
  changeDirection,
  changeSentiment = 'neutral',
  size = 'sm',
  sparklineData,
  target,
}: SparklineKpiCardProps) {
  const isLarge = size === 'lg';

  // Determine change indicator color and arrow
  let changeColorClass = 'text-slate-400';
  let arrow = '';

  if (changeDirection === 'up') {
    arrow = '\u2191';
    const hex = getChangeColor('up', changeSentiment);
    changeColorClass = hexToTailwindText(hex);
  } else if (changeDirection === 'down') {
    arrow = '\u2193';
    const hex = getChangeColor('down', changeSentiment);
    changeColorClass = hexToTailwindText(hex);
  }

  // Build sparkline data points
  const chartData: SparklinePoint[] | null =
    sparklineData && sparklineData.length > 1
      ? sparklineData.map((v) => ({ value: v }))
      : null;

  // Pick sparkline stroke color based on trend
  const sparklineColor =
    changeSentiment === 'neutral'
      ? REPORT_COLORS.spend
      : changeDirection === 'up' && changeSentiment === 'positive-up'
      ? REPORT_COLORS.revenue
      : changeDirection === 'down' && changeSentiment === 'negative-up'
      ? REPORT_COLORS.revenue
      : changeDirection === 'flat'
      ? REPORT_COLORS.prior
      : REPORT_COLORS.efficiency;

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-sm ${
        isLarge ? 'p-6 pb-3' : 'p-4 pb-2'
      }`}
    >
      <p
        className={`font-semibold text-slate-500 uppercase tracking-wider ${
          isLarge ? 'text-xs' : 'text-[11px]'
        }`}
      >
        {label}
      </p>
      <p
        className={`font-bold text-slate-900 mt-1 tabular-nums ${
          isLarge ? 'text-3xl' : 'text-xl'
        }`}
      >
        {value}
      </p>
      {change && (
        <p
          className={`mt-1 font-medium ${changeColorClass} ${
            isLarge ? 'text-sm' : 'text-xs'
          }`}
        >
          {arrow}
          {arrow ? ' ' : ''}
          {change}
        </p>
      )}

      {/* Sparkline at bottom — full width */}
      {chartData && (
        <div className={`${isLarge ? 'mt-3' : 'mt-2'} -mx-1`} style={{ height: 32 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={sparklineColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              {target !== undefined && (
                <ReferenceLine
                  y={target}
                  stroke={REPORT_COLORS.prior}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Maps known hex colors to Tailwind text classes for change indicators. */
function hexToTailwindText(hex: string): string {
  switch (hex) {
    case '#10B981':
      return 'text-emerald-500';
    case '#EF4444':
      return 'text-red-500';
    case '#64748B':
      return 'text-slate-500';
    default:
      return 'text-slate-400';
  }
}
