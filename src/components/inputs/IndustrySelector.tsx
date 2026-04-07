'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { SelectInput } from '@/components/ui/SelectInput';
import { INDUSTRY_BENCHMARKS, type Industry } from '@/lib/engine';

const options = Object.entries(INDUSTRY_BENCHMARKS).map(([value, b]) => ({
  value,
  label: b.label,
}));

export function IndustrySelector() {
  const { state, dispatch } = useCalculator();
  return (
    <SelectInput
      label="Industry"
      value={state.industry}
      onChange={(v) => dispatch({ type: 'SET_INDUSTRY', payload: v as Industry })}
      options={options}
    />
  );
}
