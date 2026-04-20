/**
 * report-colors.ts — Centralized color constants for all report components.
 *
 * CANNOT: Define Tailwind classes (use hex values for Recharts/inline styles).
 * CANNOT: Import React or render anything — pure data module.
 */

// ── Color palette ────────────────────────────────────────────────────────

export const REPORT_COLORS = {
  /** Revenue, positive metrics, wins */
  revenue: '#10B981',
  /** Ad spend, cost metrics — NOT red */
  spend: '#3B82F6',
  /** ROAS, efficiency metrics */
  efficiency: '#8B5CF6',
  /** Warnings, pacing concerns */
  warning: '#F59E0B',
  /** Critical problems only */
  critical: '#EF4444',
  /** Prior period / comparison dashed lines */
  prior: '#94A3B8',
} as const;

export type ReportColorKey = keyof typeof REPORT_COLORS;

// ── Change color helper ──────────────────────────────────────────────────

type ChangeDirection = 'up' | 'down' | 'flat';
type ChangeSentiment = 'positive-up' | 'negative-up' | 'neutral';

/**
 * Returns the appropriate hex color for a metric change indicator.
 *
 * @param direction — Whether the metric went up, down, or stayed flat
 * @param sentiment — How to interpret the direction:
 *   - 'positive-up': up is good (revenue, conversions)
 *   - 'negative-up': up is bad (CPC, CPL)
 *   - 'neutral': always slate (spend)
 */
export function getChangeColor(direction: ChangeDirection, sentiment: ChangeSentiment): string {
  if (direction === 'flat' || sentiment === 'neutral') {
    return '#64748B'; // slate-500
  }

  const isGood =
    (direction === 'up' && sentiment === 'positive-up') ||
    (direction === 'down' && sentiment === 'negative-up');

  return isGood ? REPORT_COLORS.revenue : REPORT_COLORS.critical;
}
