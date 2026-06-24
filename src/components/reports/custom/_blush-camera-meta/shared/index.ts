/**
 * Barrel export for shared report components.
 *
 * Usage:
 *   import { SparklineKpiCard, FunnelChart, REPORT_COLORS } from '@/components/reports/shared';
 */

export { default as SparklineKpiCard } from './SparklineKpiCard';
export { default as FunnelChart } from './FunnelChart';
export { default as BudgetPacingGauge } from './BudgetPacingGauge';
export { default as InsightsBlock } from './InsightsBlock';
export { default as DemographicChart } from './DemographicChart';
export { REPORT_COLORS, getChangeColor } from './report-colors';
export type { ReportColorKey } from './report-colors';
