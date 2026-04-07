// Required env vars: ANTHROPIC_API_KEY

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkRateLimit } from '@/lib/utils/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const { allowed, retryAfter } = checkRateLimit(ip, 'insights');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const { state, results } = await req.json();

    if (!state || !results) {
      return NextResponse.json(
        { error: 'Missing state or results in request body' },
        { status: 400 }
      );
    }

    // Sanitize user-controlled strings to prevent prompt injection / cost abuse
    const cap = (s: unknown, max = 100): string => String(s ?? '').slice(0, max);

    const { totals, monthly, phases } = results;
    const breakEvenBench = totals.breakEvenMonth?.bench;
    const ltvCacBench = totals.ltvCacRatio?.bench;

    const prompt = `You are a marketing ROI advisor for small and mid-size businesses. Analyze the following ROAS calculator projections and provide actionable insights.

## Business Profile
- Business type: ${cap(state.businessType, 20)}
- Industry: ${cap(state.industry, 50).replace(/_/g, ' ')}
- Total ad budget: $${Number(state.totalBudget || 0).toLocaleString()}
- Forecast duration: ${Number(state.duration || 0)} months
- Spend model: ${cap(state.spendModel, 30)}

## Key Metrics
- Total ad spend: $${totals.totalAdSpend.toLocaleString()}
- Projected revenue (base): $${totals.totalRevenue.bench.toLocaleString()}
- Projected profit (base): $${totals.totalProfit.bench.toLocaleString()}
- Average CAC: $${totals.avgCac.toFixed(2)}
- Estimated LTV (base): $${totals.estimatedLtv.bench.toLocaleString()}
- LTV:CAC ratio (base): ${ltvCacBench?.toFixed(2) ?? 'N/A'}
- Break-even month (base): ${breakEvenBench ?? 'Not reached within forecast'}
- Total customers acquired (base): ${totals.totalCustomers.bench.toFixed(0)}

## ROAS Assumptions
- Conservative: ${state.roasAssumptions.low}x
- Base: ${state.roasAssumptions.bench}x
- Optimistic: ${state.roasAssumptions.high}x

## Phases
${phases.map((p: { label: string; startMonth: number; endMonth: number; roasMultiplier: number }) => `- ${p.label}: Months ${p.startMonth}-${p.endMonth} (ROAS multiplier: ${p.roasMultiplier}x)`).join('\n')}

## Monthly Trend (first and last 3 months)
${monthly.slice(0, 3).concat(monthly.slice(-3)).map((m: { month: number; adSpend: number; revenue: { bench: number }; profit: { bench: number }; cumulativeProfit: { bench: number } }) =>
  `Month ${m.month}: Spend $${m.adSpend.toFixed(0)}, Revenue $${m.revenue.bench.toFixed(0)}, Profit $${m.profit.bench.toFixed(0)}, Cumulative $${m.cumulativeProfit.bench.toFixed(0)}`
).join('\n')}

---

Provide exactly 3-5 insights as markdown. For each insight use this format:

### [Category] Insight Title
Brief explanation and specific recommendation.

Categories to use: Strategy, Warning, Opportunity, Optimization, Timeline

Rules:
- Flag red flags: ROAS below 2x, break-even beyond 6 months, LTV:CAC below 3:1
- Be specific with numbers from the data
- Tailor advice to the ${state.industry.replace(/_/g, ' ')} industry
- Write for business owners, not marketers — keep it professional but accessible
- Do NOT use emojis`;

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    const insights = textBlock ? textBlock.text : 'Unable to generate insights.';

    return NextResponse.json({ insights });
  } catch (error) {
    console.error('Insights API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    );
  }
}
