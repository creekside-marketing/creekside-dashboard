'use client';

interface KpiCardProps {
  label: string;
  value: string;
  change?: string;
  changeDirection?: 'up' | 'down' | 'flat';
  /** Controls the semantic meaning of the change direction:
   *  - 'positive-up': up = good (green), down = bad (red) — for Leads, Impressions, Clicks, CTR
   *  - 'negative-up': up = bad (red), down = good (green) — for CPL, CPC
   *  - 'neutral': always gray — for Spend
   */
  changeSentiment?: 'positive-up' | 'negative-up' | 'neutral';
  size?: 'lg' | 'sm';
}

export default function KpiCard({
  label,
  value,
  change,
  changeDirection,
  changeSentiment = 'neutral',
  size = 'sm',
}: KpiCardProps) {
  // Determine color based on direction + sentiment
  let changeColor = 'text-slate-400';
  let arrow = '';

  if (changeDirection === 'up') {
    arrow = '\u2191';
    if (changeSentiment === 'positive-up') changeColor = 'text-emerald-600';
    else if (changeSentiment === 'negative-up') changeColor = 'text-red-600';
    else changeColor = 'text-slate-500';
  } else if (changeDirection === 'down') {
    arrow = '\u2193';
    if (changeSentiment === 'positive-up') changeColor = 'text-red-600';
    else if (changeSentiment === 'negative-up') changeColor = 'text-emerald-600';
    else changeColor = 'text-slate-500';
  }

  const isLarge = size === 'lg';

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${isLarge ? 'p-6' : 'p-4'}`}>
      <p className={`font-semibold text-slate-500 uppercase tracking-wider ${isLarge ? 'text-xs' : 'text-[11px]'}`}>
        {label}
      </p>
      <p className={`font-bold text-slate-900 mt-1 tabular-nums ${isLarge ? 'text-3xl' : 'text-xl'}`}>
        {value}
      </p>
      {change && (
        <p className={`mt-1 font-medium ${changeColor} ${isLarge ? 'text-sm' : 'text-xs'}`}>
          {arrow}{arrow ? ' ' : ''}{change}
        </p>
      )}
    </div>
  );
}
