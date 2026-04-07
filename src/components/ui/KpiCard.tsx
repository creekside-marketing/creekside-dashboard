'use client';

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export function KpiCard({ label, value, subtitle, trend }: KpiCardProps) {
  const trendColor = trend === 'up' ? 'text-[var(--success)]' : trend === 'down' ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]';
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-4 hover:shadow-[0_0_20px_var(--accent-glow)] transition-shadow">
      <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl font-semibold ${trendColor}`}>{value}</p>
      {subtitle && <p className="text-[var(--text-muted)] text-xs mt-1">{subtitle}</p>}
    </div>
  );
}
