'use client';

import { useMemo } from 'react';
import { useCalculator } from '@/lib/context/calculator-context';
import { NumberInput } from '@/components/ui/NumberInput';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { generateSpendAllocation, type SpendModel } from '@/lib/engine';
import { BarChart, Bar, ResponsiveContainer } from 'recharts';

const modelOptions = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'ramp', label: 'Ramp Up' },
  { value: 'front_load', label: 'Front Load' },
  { value: 'seasonal', label: 'Seasonal' },
  { value: 'pilot', label: 'Pilot' },
];

export function AdSpendPlan() {
  const { state, dispatch } = useCalculator();

  const spendPreview = useMemo(() => {
    const allocation = generateSpendAllocation(state.spendModel, state.totalBudget, state.duration);
    return allocation.map((spend, i) => ({ month: i + 1, spend }));
  }, [state.spendModel, state.totalBudget, state.duration]);

  return (
    <div>
      <NumberInput
        label="Total Ad Budget"
        value={state.totalBudget}
        onChange={(v) => dispatch({ type: 'SET_TOTAL_BUDGET', payload: v })}
        min={100}
        prefix="$"
      />
      <label className="block text-[var(--text-secondary)] text-sm mb-1">Spend Model</label>
      <ToggleGroup
        options={modelOptions}
        value={state.spendModel}
        onChange={(v) => dispatch({ type: 'SET_SPEND_MODEL', payload: v as SpendModel })}
      />
      <div className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg p-2 mt-1">
        <ResponsiveContainer width="100%" height={60}>
          <BarChart data={spendPreview} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
            <Bar dataKey="spend" fill="var(--accent)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-[var(--text-muted)] text-[10px] text-center mt-1">Monthly spend distribution</p>
      </div>
    </div>
  );
}
