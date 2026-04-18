'use client';

/**
 * BudgetPacingGauge — Horizontal progress bar showing budget spend vs. expected pace.
 *
 * Compares actual spend percentage against the expected pace (daysElapsed / daysInPeriod)
 * and color-codes the bar:
 * - Green: within 10% of expected pace
 * - Amber: 10-20% off pace
 * - Red: more than 20% off pace
 *
 * CANNOT: Modify budget values — display only.
 * CANNOT: Fetch data — receives all values via props.
 * CANNOT: Handle date calculations — caller provides elapsed/total days.
 */

import { REPORT_COLORS } from './report-colors';
import { fmtMoney } from '../ReportHeader';

// ── Types ────────────────────────────────────────────────────────────────

interface BudgetPacingGaugeProps {
  spent: number;
  budget: number;
  daysElapsed: number;
  daysInPeriod: number;
  title?: string;
}

// ── Component ────────────────────────────────────────────────────────────

export default function BudgetPacingGauge({
  spent,
  budget,
  daysElapsed,
  daysInPeriod,
  title = 'Budget Pacing',
}: BudgetPacingGaugeProps) {
  const spentPct = budget > 0 ? (spent / budget) * 100 : 0;
  const expectedPct = daysInPeriod > 0 ? (daysElapsed / daysInPeriod) * 100 : 0;
  const deviation = Math.abs(spentPct - expectedPct);

  // Determine pacing status and color
  const pacingColor =
    deviation <= 10
      ? REPORT_COLORS.revenue
      : deviation <= 20
      ? REPORT_COLORS.warning
      : REPORT_COLORS.critical;

  const pacingLabel =
    deviation <= 10 ? 'On pace' : spentPct > expectedPct ? 'Over-pacing' : 'Under-pacing';

  // Clamp display width to 100%
  const barWidth = Math.min(spentPct, 100);
  const markerLeft = Math.min(expectedPct, 100);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{
            color: pacingColor,
            backgroundColor: `${pacingColor}15`,
          }}
        >
          {pacingLabel}
        </span>
      </div>

      {/* Progress bar container */}
      <div className="relative h-4 bg-slate-100 rounded-full overflow-hidden">
        {/* Spent bar */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${barWidth}%`,
            backgroundColor: pacingColor,
          }}
        />

        {/* Expected pace marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-slate-900 opacity-40"
          style={{ left: `${markerLeft}%` }}
        >
          <div
            className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0"
            style={{
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '5px solid rgba(15,23,42,0.4)',
            }}
          />
        </div>
      </div>

      {/* Labels below the bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mt-2.5 gap-1">
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700 tabular-nums">
            {spentPct.toFixed(1)}%
          </span>{' '}
          spent ({fmtMoney(spent)} of {fmtMoney(budget)})
        </p>
        <p className="text-xs text-slate-400 tabular-nums">
          {expectedPct.toFixed(1)}% of period elapsed ({daysElapsed}/{daysInPeriod} days)
        </p>
      </div>
    </div>
  );
}
