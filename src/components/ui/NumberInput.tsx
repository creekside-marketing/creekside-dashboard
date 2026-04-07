'use client';

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}

export function NumberInput({ label, value, onChange, min, max, step = 1, prefix, suffix }: NumberInputProps) {
  return (
    <div className="mb-3">
      <label className="block text-[var(--text-secondary)] text-sm mb-1">{label}</label>
      <div className="flex items-center bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg overflow-hidden">
        {prefix && <span className="px-3 text-[var(--text-muted)] text-sm">{prefix}</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const raw = parseFloat(e.target.value);
            onChange(isNaN(raw) ? 0 : parseFloat(raw.toPrecision(10)));
          }}
          min={min}
          max={max}
          step={step}
          className="flex-1 bg-transparent text-[var(--text-primary)] px-3 py-2 text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && <span className="px-3 text-[var(--text-muted)] text-sm">{suffix}</span>}
      </div>
    </div>
  );
}
