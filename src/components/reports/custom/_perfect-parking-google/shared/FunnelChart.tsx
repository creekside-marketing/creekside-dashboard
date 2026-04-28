'use client';

/**
 * FunnelChart — Horizontal funnel visualization showing stage-by-stage drop-off.
 *
 * Renders horizontal bars that decrease in width to represent conversion funnel
 * stages. Shows absolute values and drop-off percentages between stages.
 *
 * CANNOT: Handle click/drill-down interactions.
 * CANNOT: Fetch data — receives all stage values via props.
 * CANNOT: Render more than ~8 stages legibly.
 */

import { REPORT_COLORS } from './report-colors';
import { fmt } from '../ReportHeader';

// ── Types ────────────────────────────────────────────────────────────────

interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

interface FunnelChartProps {
  stages: FunnelStage[];
  title?: string;
}

// ── Default stage colors ─────────────────────────────────────────────────

const DEFAULT_STAGE_COLORS = [
  REPORT_COLORS.spend,
  REPORT_COLORS.efficiency,
  REPORT_COLORS.revenue,
  '#06B6D4', // cyan-500
  '#EC4899', // pink-500
  '#F97316', // orange-500
  '#14B8A6', // teal-500
  '#6366F1', // indigo-500
];

// ── Component ────────────────────────────────────────────────────────────

export default function FunnelChart({ stages, title }: FunnelChartProps) {
  if (stages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        {title && (
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
            {title}
          </h3>
        )}
        <div className="flex items-center justify-center h-[120px] text-sm text-slate-400">
          No funnel data available
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...stages.map((s) => s.value), 1);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {title && (
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          {title}
        </h3>
      )}

      <div className="space-y-1">
        {stages.map((stage, i) => {
          const widthPct = Math.max((stage.value / maxValue) * 100, 8);
          const color = stage.color ?? DEFAULT_STAGE_COLORS[i % DEFAULT_STAGE_COLORS.length];
          const dropOff = i > 0 ? computeDropOff(stages[i - 1].value, stage.value) : null;

          return (
            <div key={stage.label}>
              {/* Drop-off indicator between stages */}
              {dropOff !== null && (
                <div className="flex items-center gap-2 py-1 pl-2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    className="shrink-0 text-slate-300"
                  >
                    <path
                      d="M6 1 L6 8 M3 6 L6 9 L9 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {dropOff} drop-off
                  </span>
                </div>
              )}

              {/* Funnel bar */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600 font-medium w-24 shrink-0 text-right truncate">
                  {stage.label}
                </span>
                <div className="flex-1 relative">
                  <div
                    className="h-8 rounded-md flex items-center transition-all duration-300"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: color,
                      minWidth: '60px',
                    }}
                  >
                    <span className="text-xs font-semibold text-white px-2.5 tabular-nums">
                      {fmt(stage.value)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function computeDropOff(previous: number, current: number): string | null {
  if (previous <= 0) return null;
  const pct = ((previous - current) / previous) * 100;
  if (pct <= 0) return null;
  return `${pct.toFixed(1)}%`;
}
