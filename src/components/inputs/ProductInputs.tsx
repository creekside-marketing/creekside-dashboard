'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { NumberInput } from '@/components/ui/NumberInput';

export function ProductInputsPanel() {
  const { state, dispatch } = useCalculator();
  const { productInputs } = state;
  const grossMargin = productInputs.price > 0
    ? ((productInputs.price - productInputs.cogs) / productInputs.price * 100).toFixed(1)
    : '0.0';

  const update = (field: string, value: number) => {
    dispatch({ type: 'UPDATE_PRODUCT_INPUTS', payload: { [field]: value } });
  };

  return (
    <div>
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-2">Product Details</h3>
      <NumberInput label="Price" value={productInputs.price} onChange={(v) => update('price', v)} min={0} prefix="$" />
      <NumberInput label="Cost of Goods (COGS)" value={productInputs.cogs} onChange={(v) => update('cogs', v)} min={0} prefix="$" />
      <NumberInput label="Average Order Value" value={productInputs.aov} onChange={(v) => update('aov', v)} min={1} prefix="$" />
      <NumberInput label="Estimated LTV" value={productInputs.estimatedLtv} onChange={(v) => update('estimatedLtv', v)} min={0} prefix="$" />
      <div className="mb-3">
        <label className="block text-[var(--text-secondary)] text-sm mb-1">Gross Margin</label>
        <div className="bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--accent)] text-sm">{grossMargin}%</div>
      </div>
    </div>
  );
}
