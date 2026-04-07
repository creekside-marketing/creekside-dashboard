'use client';

import { useState } from 'react';
import { useCalculator } from '@/lib/context/calculator-context';
import { BusinessTypeToggle } from './BusinessTypeToggle';
import { IndustrySelector } from './IndustrySelector';
import { ProductInputsPanel } from './ProductInputs';
import { ServiceInputsPanel } from './ServiceInputs';
import { ForecastDuration } from './ForecastDuration';
import { AdSpendPlan } from './AdSpendPlan';
import { RoasAssumptionsPanel } from './RoasAssumptions';
import { LtvVariantsPanel } from './LtvVariants';
import { INDUSTRY_BENCHMARKS } from '@/lib/engine';
import { formatCurrency } from '@/lib/utils/formatters';

export function InputPanel() {
  const { state } = useCalculator();
  const benchmark = INDUSTRY_BENCHMARKS[state.industry];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="w-full lg:w-[380px] shrink-0 bg-[var(--bg-secondary)] border-b lg:border-b-0 lg:border-r border-[var(--border)] lg:h-screen overflow-y-auto">
      <div className="flex items-center justify-between p-6 pb-0 lg:pb-0">
        <div>
          <h2 className="text-[var(--text-primary)] text-lg font-semibold mb-1">
            Calculator Inputs
          </h2>
          <p className="text-[var(--text-muted)] text-xs">
            Adjust parameters to see projections update in real-time
          </p>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="lg:hidden flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent)]/20 rounded-lg"
        >
          {collapsed ? 'Show' : 'Hide'}
          <svg
            className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div
        className={`p-6 pt-4 space-y-6 transition-all overflow-hidden ${
          collapsed ? 'max-h-0 p-0 lg:max-h-none lg:p-6 lg:pt-4' : 'max-h-[2000px]'
        }`}
      >
        <section>
          <BusinessTypeToggle />
          <IndustrySelector />
          {benchmark && (
            <div className="bg-[var(--accent-glow)] border border-[var(--accent)]/20 rounded-lg p-3 text-xs text-[var(--text-secondary)]">
              <span className="text-[var(--accent)] font-medium">Industry benchmark:</span>{' '}
              {benchmark.benchmarkRoas}x ROAS · CPA {formatCurrency(benchmark.cpaRange[0])}-
              {formatCurrency(benchmark.cpaRange[1])} · Min budget{' '}
              {formatCurrency(benchmark.recommendedMinBudget)}/mo
            </div>
          )}
        </section>

        <section>
          {state.businessType === 'product' ? <ProductInputsPanel /> : <ServiceInputsPanel />}
        </section>

        <section>
          <ForecastDuration />
        </section>

        <section>
          <AdSpendPlan />
        </section>

        <section>
          <RoasAssumptionsPanel />
        </section>

        <section>
          <LtvVariantsPanel />
        </section>
      </div>
    </div>
  );
}
