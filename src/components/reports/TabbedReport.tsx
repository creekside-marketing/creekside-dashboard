'use client';

/**
 * TabbedReport — Renders platform tabs (Google | Meta) when a client has accounts on both.
 * Falls back to a single report when only one platform is available.
 *
 * CANNOT: Fetch data — delegates entirely to platform-specific report components.
 * CANNOT: Modify client records.
 */

import { useState } from 'react';
import LeadGenGoogleReport from './LeadGenGoogleReport';
import LeadGenMetaReport from './LeadGenMetaReport';
import EcomGoogleReport from './EcomGoogleReport';
import EcomMetaReport from './EcomMetaReport';
import LeadGenReport from './LeadGenReport';
import EcomReport from './EcomReport';
import registry from './custom/registry';
import ReportErrorBoundary from './custom/ReportErrorBoundary';
import { ReportingClient } from './types';

// ── Types ────────────────────────────────────────────────────────────────

interface TabbedReportProps {
  clients: ReportingClient[];  // 1 or 2 clients (one per platform)
  mode: 'internal' | 'public';
  initialPlatform?: string;    // which tab to show first (the one whose token was used)
}

// ── Platform ordering ────────────────────────────────────────────────────

const PLATFORM_ORDER: Record<string, number> = { google: 0, meta: 1 };

function sortByPlatform(clients: ReportingClient[]): ReportingClient[] {
  return [...clients].sort(
    (a, b) => (PLATFORM_ORDER[a.platform?.toLowerCase()] ?? 99) - (PLATFORM_ORDER[b.platform?.toLowerCase()] ?? 99)
  );
}

// ── Report component resolver ────────────────────────────────────────────

function getReportComponent(client: ReportingClient, mode: 'internal' | 'public') {
  // Custom report path — fully isolated per-client component
  if (client.report_mode === 'custom' && client.custom_report_slug) {
    const CustomComponent = registry[client.custom_report_slug];
    if (CustomComponent) {
      const defaultReport = getDefaultReportComponent(client, mode);
      return (
        <ReportErrorBoundary fallback={defaultReport} clientName={client.client_name}>
          <CustomComponent client={client} mode={mode} />
        </ReportErrorBoundary>
      );
    }
    // Slug set but not in registry — fall through to default
  }

  return getDefaultReportComponent(client, mode);
}

// Extracted from original getReportComponent — unchanged logic
function getDefaultReportComponent(client: ReportingClient, mode: 'internal' | 'public') {
  const clientType = client.client_type || (client.platform === 'google' ? 'lead_gen' : client.platform === 'meta' ? 'ecom' : null);
  const platform = client.platform?.toLowerCase();

  if (clientType === 'lead_gen' && platform === 'google') return <LeadGenGoogleReport client={client} mode={mode} />;
  if (clientType === 'lead_gen' && platform === 'meta') return <LeadGenMetaReport client={client} mode={mode} />;
  if (clientType === 'ecom' && platform === 'google') return <EcomGoogleReport client={client} mode={mode} />;
  if (clientType === 'ecom' && platform === 'meta') return <EcomMetaReport client={client} mode={mode} />;

  // Legacy fallback
  if (clientType === 'lead_gen') return <LeadGenReport client={client} mode={mode} />;
  if (clientType === 'ecom') return <EcomReport client={client} mode={mode} />;

  return null;
}

// ── Tab labels ───────────────────────────────────────────────────────────

const TAB_CONFIG: Record<string, { label: string; dotColor: string }> = {
  google: { label: 'Google Ads', dotColor: 'bg-emerald-500' },
  meta:   { label: 'Meta Ads',   dotColor: 'bg-blue-500' },
};

// ── Component ────────────────────────────────────────────────────────────

export default function TabbedReport({ clients, mode, initialPlatform }: TabbedReportProps) {
  const sorted = sortByPlatform(clients);

  // Determine initial active index based on initialPlatform prop
  const initialIndex = initialPlatform
    ? Math.max(0, sorted.findIndex(c => c.platform?.toLowerCase() === initialPlatform.toLowerCase()))
    : 0;

  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // Single client — render directly with no tabs
  if (sorted.length === 1) {
    return getReportComponent(sorted[0], mode);
  }

  // Multi-platform — render tab bar + active report
  const activeClient = sorted[activeIndex];

  return (
    <div>
      {/* Tab bar — matches ReportHeader date-range pill selector style */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-2">
        <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 gap-0.5">
          {sorted.map((client, i) => {
            const platform = client.platform?.toLowerCase() ?? '';
            const config = TAB_CONFIG[platform] ?? { label: platform, dotColor: 'bg-slate-400' };
            const isActive = i === activeIndex;

            return (
              <button
                key={client.id}
                onClick={() => setActiveIndex(i)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
                {config.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active report — keyed to force remount on tab switch */}
      <div key={activeClient.id}>
        {getReportComponent(activeClient, mode)}
      </div>
    </div>
  );
}
