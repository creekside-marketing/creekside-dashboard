'use client';

/**
 * ReferralBanner — Promotional banner for Creekside's client referral program.
 *
 * Displays the tiered referral offer (ongoing 10% commission, plus $1,000
 * upfront for $10k+ ad-spend referrals) in a visually distinct card that
 * sits within the report layout.
 *
 * CANNOT: Track referrals or handle submissions — display only.
 */

export default function ReferralBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-blue-50 shadow-sm">
      {/* Decorative accent */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#2563eb] via-[#3b82f6] to-[#2563eb]" />

      <div className="px-6 py-5 sm:px-8 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: offer copy */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#2563eb]">
              Referral Reward Program
            </p>
            <p className="text-base sm:text-lg font-bold text-slate-900">
              Know someone who could use results like yours?
            </p>
            <p className="text-sm text-slate-600 max-w-xl leading-relaxed">
              Refer a business to Creekside Marketing and earn{' '}
              <span className="font-semibold text-slate-900">10% of what they pay us every month</span>
              {' '}for as long as they stay a client. If they spend{' '}
              <span className="font-semibold text-slate-900">$10,000+/mo on ads</span>, you also get{' '}
              <span className="font-semibold text-slate-900">$1,000 upfront</span>.
              {' '}No cap, no expiration. Just send them our way or make an intro.
            </p>
          </div>

          {/* Right: highlight card */}
          <div className="shrink-0 flex flex-col items-center gap-1 rounded-lg bg-white border border-blue-100 px-5 py-4 shadow-sm text-center min-w-[140px]">
            <span className="text-sm font-bold text-[#2563eb]">10% recurring</span>
            <span className="text-xs text-slate-500">every month, no cap</span>
            <div className="w-8 h-px bg-slate-200 my-1" />
            <span className="text-2xl font-extrabold text-[#2563eb]">+ $1,000</span>
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">for $10k+ ad spend</span>
          </div>
        </div>
      </div>
    </div>
  );
}
