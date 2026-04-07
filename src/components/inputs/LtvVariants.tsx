'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { NumberInput } from '@/components/ui/NumberInput';

export function LtvVariantsPanel() {
  const { state, dispatch } = useCalculator();
  const { ltvMultipliers } = state;

  const update = (field: string, value: number) => {
    dispatch({ type: 'UPDATE_LTV_MULTIPLIERS', payload: { [field]: value } });
  };

  return (
    <div>
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-2">LTV Multipliers</h3>
      <p className="text-[var(--text-muted)] text-xs mb-3">Adjust scenario multipliers applied to base LTV</p>
      <div className="space-y-0">
        <div className="border-l-2 border-[var(--danger)] pl-3">
          <NumberInput label="Conservative" value={ltvMultipliers.conservative} onChange={(v) => update('conservative', v)} min={0.1} max={3} step={0.1} suffix="x" />
        </div>
        <div className="border-l-2 border-[var(--accent)] pl-3">
          <NumberInput label="Base" value={ltvMultipliers.base} onChange={(v) => update('base', v)} min={0.1} max={3} step={0.1} suffix="x" />
        </div>
        <div className="border-l-2 border-[var(--success)] pl-3">
          <NumberInput label="Optimistic" value={ltvMultipliers.optimistic} onChange={(v) => update('optimistic', v)} min={0.1} max={3} step={0.1} suffix="x" />
        </div>
      </div>
    </div>
  );
}
