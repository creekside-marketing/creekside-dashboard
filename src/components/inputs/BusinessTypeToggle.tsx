'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import type { BusinessType } from '@/lib/engine';

const options = [
  { value: 'product', label: 'Product' },
  { value: 'service', label: 'Service' },
];

export function BusinessTypeToggle() {
  const { state, dispatch } = useCalculator();
  return (
    <div className="mb-4">
      <label className="block text-[var(--text-secondary)] text-sm mb-1">Business Type</label>
      <ToggleGroup
        options={options}
        value={state.businessType}
        onChange={(v) => dispatch({ type: 'SET_BUSINESS_TYPE', payload: v as BusinessType })}
      />
    </div>
  );
}
