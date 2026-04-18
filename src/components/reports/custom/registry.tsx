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
 * Run the CLI from the repo root:
 *   npm run branch-report -- "<client name>" <google|meta>
 *
 * The script copies the right default template into this directory, renames
 * the exported component, adds a registry entry below, flips report_mode to
 * 'custom' in Supabase, typechecks, and commits + pushes to main.
 * Idempotent: running it twice for the same (client, platform) is a no-op.
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
// Entries here are managed by `npm run branch-report` — prefer that over
// hand-editing. Format: 'slug': dynamic(() => import('./slug'), { loading: Spinner })

const registry: Record<string, ComponentType<ReportProps>> = {
  // Example (managed by npm run branch-report):
  // 'integrity-naturopathics-meta': dynamic(() => import('./integrity-naturopathics-meta'), { loading: Spinner }),
  'aura-displays-google': dynamic(() => import('./aura-displays-google'), { loading: Spinner }),
};

export default registry;
export type { ReportProps as CustomReportProps };
