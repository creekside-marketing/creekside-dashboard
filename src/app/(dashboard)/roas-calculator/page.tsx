'use client';

import { CalculatorProvider, useCalculator } from '@/lib/context/calculator-context';
import { InputPanel } from '@/components/inputs/InputPanel';
import { DashboardPanel } from '@/components/dashboard/DashboardPanel';
import { ToolModeToggle } from '@/components/ai-interview/ToolModeToggle';

function RoasCalculatorInner() {
  const { state, results } = useCalculator();

  const toolContext = results ? {
    businessType: state.businessType,
    industry: state.industry,
    totalBudget: state.totalBudget,
    duration: state.duration,
    spendModel: state.spendModel,
    roasAssumptions: state.roasAssumptions,
    totalRevenue: results.totals.totalRevenue,
    totalProfit: results.totals.totalProfit,
    avgCac: results.totals.avgCac,
    breakEvenMonth: results.totals.breakEvenMonth,
  } : undefined;

  return (
    <ToolModeToggle
      tool="roas-calculator"
      toolLabel="ROAS projection"
      toolContext={toolContext}
    >
      <div className="flex flex-col lg:flex-row flex-1 bg-[var(--bg-primary)]">
        <InputPanel />
        <DashboardPanel />
      </div>
    </ToolModeToggle>
  );
}

export default function CalculatorPage() {
  return (
    <CalculatorProvider>
      <RoasCalculatorInner />
    </CalculatorProvider>
  );
}
