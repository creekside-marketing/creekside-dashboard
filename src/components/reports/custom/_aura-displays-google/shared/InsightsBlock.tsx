'use client';

/**
 * InsightsBlock — Renders a list of categorized insights in a clean card layout.
 *
 * Each insight is tagged as a win (green), concern (amber), or action (blue)
 * and displayed with a colored indicator dot.
 *
 * CANNOT: Generate insights — receives them fully formed via props.
 * CANNOT: Handle editing or dismissing insights.
 * CANNOT: Render markdown or rich text — plain text only.
 */

import { REPORT_COLORS } from './report-colors';

// ── Types ────────────────────────────────────────────────────────────────

type InsightType = 'win' | 'concern' | 'action';

interface Insight {
  type: InsightType;
  text: string;
}

interface InsightsBlockProps {
  insights: Insight[];
  title?: string;
}

// ── Color mapping ────────────────────────────────────────────────────────

const INSIGHT_COLORS: Record<InsightType, string> = {
  win: REPORT_COLORS.revenue,
  concern: REPORT_COLORS.warning,
  action: REPORT_COLORS.spend,
};

const INSIGHT_LABELS: Record<InsightType, string> = {
  win: 'Win',
  concern: 'Concern',
  action: 'Action',
};

// ── Component ────────────────────────────────────────────────────────────

export default function InsightsBlock({
  insights,
  title = 'Insights & Recommendations',
}: InsightsBlockProps) {
  if (insights.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
          {title}
        </h3>
        <p className="text-sm text-slate-400">No insights available for this period.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        {title}
      </h3>

      <ul className="space-y-3">
        {insights.map((insight, i) => {
          const color = INSIGHT_COLORS[insight.type];

          return (
            <li key={i} className="flex items-start gap-3">
              {/* Colored dot */}
              <span
                className="mt-1.5 shrink-0 w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />

              <div className="min-w-0 flex-1">
                <span
                  className="text-[10px] font-bold uppercase tracking-wider mr-2"
                  style={{ color }}
                >
                  {INSIGHT_LABELS[insight.type]}
                </span>
                <span className="text-sm text-slate-700 leading-relaxed">{insight.text}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
