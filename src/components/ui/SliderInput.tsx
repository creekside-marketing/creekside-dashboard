'use client';

interface SliderInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  formatValue?: (v: number) => string;
}

export function SliderInput({ label, value, onChange, min, max, step, prefix, suffix, formatValue }: SliderInputProps) {
  const display = formatValue ? formatValue(value) : `${prefix || ''}${value}${suffix || ''}`;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <label className="text-[var(--text-secondary)] text-sm">{label}</label>
        <span className="text-[var(--accent)] text-sm font-medium">{display}</span>
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}
