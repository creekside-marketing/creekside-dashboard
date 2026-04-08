/**
 * Fee Calculation Engine
 *
 * Pure functions for calculating expected revenue from fee_config JSON + live spend data.
 * Each reporting_clients row stores a fee_config JSONB. This module interprets that config
 * and returns the calculated fee for a single platform row.
 *
 * CANNOT: mutate state, call APIs, access the DOM, or import React.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface FeeConfigPercentage {
  type: 'percentage';
  rate: number;
  minimum?: number;
}

export interface FeeConfigFixed {
  type: 'fixed';
  monthly_fee: number;
}

export interface FeeConfigTiered {
  type: 'tiered';
  minimum?: number;
  tiers: Array<{ up_to: number | null; rate: number }>;
  scope: 'total' | 'per_platform';
}

export interface FeeConfigFlat {
  type: 'flat';
  amount: number;
}

export interface FeeConfigGreaterOf {
  type: 'greater_of';
  flat: number;
  rate: number;
}

export type FeeConfig =
  | FeeConfigPercentage
  | FeeConfigFixed
  | FeeConfigTiered
  | FeeConfigFlat
  | FeeConfigGreaterOf;

// ── Internal helpers ───────────────────────────────────────────────────────

/** Calculate fee from marginal (tax-bracket-style) tiers. */
function calcTieredFee(spend: number, tiers: FeeConfigTiered['tiers']): number {
  if (spend <= 0) return 0;

  let fee = 0;
  let previousCap = 0;

  for (const tier of tiers) {
    const cap = tier.up_to ?? Infinity;
    if (spend <= previousCap) break;

    const taxableInBracket = Math.min(spend, cap) - previousCap;
    fee += taxableInBracket * tier.rate;
    previousCap = cap;
  }

  return fee;
}

/** Proportional share: what fraction of totalClientSpend this platform represents. */
function proportionalShare(thisPlatformSpend: number, totalClientSpend: number): number {
  if (totalClientSpend <= 0) return 0;
  return thisPlatformSpend / totalClientSpend;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Calculate expected revenue for a single platform row.
 *
 * For "fixed" and "tiered" with scope "total", the caller must provide
 * totalClientSpend (sum of spend across all platform rows for the same client).
 * For per-platform types, totalClientSpend is ignored.
 */
export function calculatePlatformRevenue(
  feeConfig: FeeConfig,
  thisPlatformSpend: number,
  totalClientSpend: number,
): number {
  switch (feeConfig.type) {
    case 'percentage': {
      const raw = thisPlatformSpend * feeConfig.rate;
      return Math.max(raw, feeConfig.minimum ?? 0);
    }

    case 'fixed': {
      // Split the fixed monthly fee proportionally by spend.
      // If totalClientSpend is 0, we cannot split — return 0.
      if (totalClientSpend <= 0) return 0;
      return feeConfig.monthly_fee * proportionalShare(thisPlatformSpend, totalClientSpend);
    }

    case 'tiered': {
      if (feeConfig.scope === 'per_platform') {
        const raw = calcTieredFee(thisPlatformSpend, feeConfig.tiers);
        return Math.max(raw, feeConfig.minimum ?? 0);
      }
      // scope === "total": calculate on combined spend, split proportionally
      const totalFee = Math.max(
        calcTieredFee(totalClientSpend, feeConfig.tiers),
        feeConfig.minimum ?? 0,
      );
      if (totalClientSpend <= 0) return 0;
      return totalFee * proportionalShare(thisPlatformSpend, totalClientSpend);
    }

    case 'flat': {
      return feeConfig.amount;
    }

    case 'greater_of': {
      return Math.max(feeConfig.flat, thisPlatformSpend * feeConfig.rate);
    }

    default:
      return 0;
  }
}

/**
 * Human-readable description of the fee config for tooltips.
 */
export function describeFeeConfig(feeConfig: FeeConfig): string {
  switch (feeConfig.type) {
    case 'percentage': {
      const pct = `${(feeConfig.rate * 100).toFixed(0)}% of ad spend`;
      if (feeConfig.minimum) {
        return `${pct}, ${formatDollar(feeConfig.minimum)} min`;
      }
      return pct;
    }

    case 'fixed': {
      return `Fixed ${formatDollar(feeConfig.monthly_fee)}/mo`;
    }

    case 'tiered': {
      const rates = feeConfig.tiers
        .filter(t => t.rate > 0)
        .map(t => `${(t.rate * 100).toFixed(0)}%`)
        .join('/');
      const scope = feeConfig.scope === 'per_platform' ? ' per platform' : '';
      const min = feeConfig.minimum ? `, ${formatDollar(feeConfig.minimum)} min` : '';
      return `Tiered: ${rates}${scope}${min}`;
    }

    case 'flat': {
      return `Flat ${formatDollar(feeConfig.amount)}/platform`;
    }

    case 'greater_of': {
      return `Greater of ${formatDollar(feeConfig.flat)} or ${(feeConfig.rate * 100).toFixed(0)}%`;
    }

    default:
      return 'Unknown fee type';
  }
}

function formatDollar(value: number): string {
  if (value >= 1000) {
    const k = value / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${value.toLocaleString()}`;
}
