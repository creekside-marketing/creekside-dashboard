'use client';

interface ToggleGroupProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}

export function ToggleGroup({ options, value, onChange }: ToggleGroupProps) {
  return (
    <div className="flex flex-wrap bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg overflow-hidden mb-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            value === opt.value
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
