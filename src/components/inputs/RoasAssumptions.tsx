'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { NumberInput } from '@/components/ui/NumberInput';

export function RoasAssumptionsPanel() {
  const { state, dispatch } = useCalculator();
  const { roasAssumptions } = state;

  const update = (field: string, value: number) => {
    dispatch({ type: 'UPDATE_ROAS_ASSUMPTIONS', payload: { [field]: value } });
  };

  return (
    <div>
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-2">ROAS Assumptions</h3>
      <div className="space-y-0">
        <div className="border-l-2 border-[var(--danger)] pl-3">
          <NumberInput label="Conservative (Low)" value={roasAssumptions.low} onChange={(v) => update('low', v)} min={0} step={0.1} suffix="x" />
        </div>
        <div className="border-l-2 border-[var(--accent)] pl-3">
          <NumberInput label="Benchmark" value={roasAssumptions.bench} onChange={(v) => update('bench', v)} min={0} step={0.1} suffix="x" />
        </div>
        <div className="border-l-2 border-[var(--success)] pl-3">
          <NumberInput label="Optimistic (High)" value={roasAssumptions.high} onChange={(v) => update('high', v)} min={0} step={0.1} suffix="x" />
        </div>
      </div>
    </div>
  );
}
