'use client';

import { useCalculator } from '@/lib/context/calculator-context';
import { SliderInput } from '@/components/ui/SliderInput';

export function ForecastDuration() {
  const { state, dispatch } = useCalculator();

  const phasePreview = () => {
    const d = state.duration;
    if (d <= 3) return 'Pilot';
    if (d <= 6) return 'Pilot → Scale';
    if (d <= 18) return 'Pilot → Scale → Optimize';
    return 'Pilot → Scale → Optimize → Scale';
  };

  return (
    <div>
      <SliderInput
        label="Forecast Duration"
        value={state.duration}
        onChange={(v) => dispatch({ type: 'SET_DURATION', payload: v })}
        min={3}
        max={24}
        step={1}
        suffix=" months"
      />
      <p className="text-[var(--text-muted)] text-xs mt-1">Phases: {phasePreview()}</p>
    </div>
  );
}
