/**
 * Custom Report Registry
 *
 * Maps client slugs to their custom report components.
 * Each entry is added when a client report is "branched" from the default.
 *
 * CANNOT: Auto-discover files — entries must be explicitly added here.
 * CANNOT: Fall back to defaults — that logic lives in TabbedReport.
 *
 * == How to branch a client report ==
 * 1. Copy the default report (e.g. LeadGenGoogleReport.tsx) into this directory
 *    as [slug].tsx (e.g. integrity-naturopathics-meta.tsx)
 * 2. Add a dynamic import entry to the registry below
 * 3. UPDATE reporting_clients SET report_mode = 'custom', custom_report_slug = '[slug]' WHERE id = '[client-id]'
 * 4. Commit, push, deploy
 *
 * == How to switch back to default ==
 * UPDATE reporting_clients SET report_mode = 'default' WHERE id = '[client-id]'
 * (Custom file and registry entry are preserved for later reuse)
 */

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { ReportProps } from '../types';

const Spinner = () => (
  <div className="flex items-center justify-center py-16">
    <div className="flex flex-col items-center gap-3">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[#2563eb]" />
      <span className="text-sm text-slate-500">Loading custom report...</span>
    </div>
  </div>
);

// ── Registry ──────────────────────────────────────────────────────────────
// Add entries below when branching a client report.
// Format: 'slug': dynamic(() => import('./slug'), { loading: Spinner })

const registry: Record<string, ComponentType<ReportProps>> = {
  // Example:
  // 'integrity-naturopathics-meta': dynamic(() => import('./integrity-naturopathics-meta'), { loading: Spinner }),
};

export default registry;
export type { ReportProps as CustomReportProps };
