'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCalculator } from '@/lib/context/calculator-context';
import { KpiBar } from './KpiBar';
import { RevenueForecastChart } from './RevenueForecastChart';
import { CacVsLtvChart } from './CacVsLtvChart';
import { CustomerGrowthChart } from './CustomerGrowthChart';
import { CumulativeProfitChart } from './CumulativeProfitChart';
import { MonthlyProjectionsTable } from './MonthlyProjectionsTable';
import { InsightsPanel } from './InsightsPanel';
import { ComparisonPanel } from './ComparisonPanel';
import { LeadCaptureModal } from '../lead-capture/LeadCaptureModal';
import { downloadCsv } from '@/lib/utils/csv-export';
import { exportPdf } from '@/lib/utils/pdf-export';

export function DashboardPanel() {
  const { results, savedScenario, saveCurrentScenario, clearSavedScenario } = useCalculator();
  const [showModal, setShowModal] = useState(false);
  const [modalCallback, setModalCallback] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const handlePdfExport = useCallback(async () => {
    const captured = localStorage.getItem('roas_lead_captured');
    if (!captured) {
      setModalCallback('pdf');
      setShowModal(true);
      return;
    }
    setPdfLoading(true);
    try {
      await exportPdf();
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setPdfLoading(false);
    }
  }, []);

  const handleModalSuccess = useCallback(() => {
    setShowModal(false);
    if (modalCallback === 'pdf') {
      setPdfLoading(true);
      exportPdf()
        .catch(console.error)
        .finally(() => setPdfLoading(false));
    }
    setModalCallback(null);
  }, [modalCallback]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setModalCallback(detail?.then || null);
      setShowModal(true);
    };
    window.addEventListener('show-lead-modal', handler);
    return () => window.removeEventListener('show-lead-modal', handler);
  }, []);

  return (
    <>
      <div id="dashboard-panel" className="flex-1 lg:h-screen overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-[var(--text-primary)] text-lg font-semibold">
            Projections Dashboard
          </h2>
          {results && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {!savedScenario ? (
                <button
                  onClick={saveCurrentScenario}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  Save & Compare
                </button>
              ) : (
                <button
                  onClick={clearSavedScenario}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--warning)] bg-[var(--warning)]/10 border border-[var(--warning)]/20 rounded-lg hover:bg-[var(--warning)]/20 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                  Clear Comparison
                </button>
              )}
              <button
                onClick={() => downloadCsv(results.monthly)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent)]/20 rounded-lg hover:bg-[var(--accent)]/10 transition-colors"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Export CSV
              </button>
              <button
                onClick={handlePdfExport}
                disabled={pdfLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent)]/20 rounded-lg hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                {pdfLoading ? 'Generating...' : 'Download PDF'}
              </button>
            </div>
          )}
        </div>

        {savedScenario && (
          <div className="mb-4 px-3 py-2 bg-[var(--accent-glow)] border border-[var(--accent)]/20 rounded-lg text-xs text-[var(--accent)]">
            Comparing against saved scenario. Adjust inputs to see the difference below.
          </div>
        )}

        <KpiBar />
        <RevenueForecastChart />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <CacVsLtvChart />
          <CustomerGrowthChart />
        </div>
        <CumulativeProfitChart />
        <ComparisonPanel />
        <MonthlyProjectionsTable />
        <InsightsPanel />
      </div>

      {showModal && (
        <LeadCaptureModal
          onClose={() => {
            setShowModal(false);
            setModalCallback(null);
          }}
          onSuccess={handleModalSuccess}
        />
      )}
    </>
  );
}
