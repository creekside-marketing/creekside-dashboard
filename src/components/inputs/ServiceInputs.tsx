'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { NumberInput } from '@/components/ui/NumberInput';

export function ServiceInputsPanel() {
  const { state, dispatch } = useCalculator();
  const { serviceInputs } = state;

  const update = (field: string, value: number) => {
    dispatch({ type: 'UPDATE_SERVICE_INPUTS', payload: { [field]: value } });
  };

  return (
    <div>
      <h3 className="text-[var(--text-primary)] text-sm font-medium mb-2">Service Details</h3>
      <NumberInput label="Avg Contract Value" value={serviceInputs.avgContractValue} onChange={(v) => update('avgContractValue', v)} min={0} prefix="$" />
      <NumberInput label="Close Rate from Lead" value={serviceInputs.closeRateFromLead * 100} onChange={(v) => update('closeRateFromLead', v / 100)} min={0} max={100} step={1} suffix="%" />
      <NumberInput label="Client Retention (months)" value={serviceInputs.clientRetentionMonths} onChange={(v) => update('clientRetentionMonths', v)} min={1} max={120} />
      <NumberInput label="Monthly Recurring Value" value={serviceInputs.monthlyRecurringValue} onChange={(v) => update('monthlyRecurringValue', v)} min={0} prefix="$" />
    </div>
  );
}
