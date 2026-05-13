// POST /api/meta-audit/run
// Body: { accountId: string }
// Pulls Meta data via PipeBoard, evaluates the 70-item checklist, calls Claude
// for narrative synthesis, generates two PDFs, returns them base64-encoded.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { pullAuditData } from '@/lib/meta-audit/data-puller';
import { evaluateAudit } from '@/lib/meta-audit/checklist';
import { generateAuditPdf, generateLoomBriefPdf } from '@/lib/meta-audit/pdf-generator';
import type { AuditOutput } from '@/lib/meta-audit/types';
import { checkRateLimit } from '@/lib/utils/rate-limiter';

// Audits take 30-120 seconds. Default Next.js function timeout (10s) is not enough.
export const maxDuration = 300;

interface NarrativeFinding {
  id: string;
  title: string;
  whatWeFound: string;
  whyItMatters: string;
  theFix: string;
}

interface NarrativePayload {
  executiveSummary: string;
  auditPosture: string;
  findingNarratives: NarrativeFinding[];
  phase1: string;
  phase2: string;
  phase3: string;
}

// Rule-based fallback narrative. Used when Claude isn't available, the API call
// fails, or its JSON response can't be parsed. Produces per-finding "What we
// found / Why it matters / The fix" narratives derived directly from the
// checklist evidence so the PDF is still rich and useful.
const TEMPLATE_NARRATIVE = (
  accountName: string,
  score: number,
  grade: string,
  findings: ReturnType<typeof evaluateAudit>,
  insights: AuditOutput['data']['insights30dAccount']
): NarrativePayload => {
  const topFails = [...findings.criticalFails, ...findings.highFails].slice(0, 8);

  const findingNarratives: NarrativeFinding[] = topFails.map((item) => {
    const whyItMatters =
      item.severity === 'CRITICAL'
        ? "This is actively reducing performance or violating Meta best practice. It's the highest-priority fix."
        : 'This is a significant performance drag. Compounds into lower ROAS and higher CPA over time.';
    const theFix = item.recommendation
      ? item.recommendation
      : 'Address the issue per Meta best practice. Re-audit after change to confirm improvement.';
    return {
      id: item.id,
      title: item.question,
      whatWeFound: item.evidence,
      whyItMatters,
      theFix,
    };
  });

  const spendStr = insights && insights.spend > 0
    ? `In the last 30 days the account spent $${insights.spend.toLocaleString()} and generated ${insights.purchases} purchases at $${insights.cpa.toFixed(2)} CPA.`
    : 'The account has no ad activity in the last 30 days, so performance-based items could not be evaluated. The structural findings below apply regardless of campaign activity.';

  const executiveSummary = `${accountName}'s Meta Ads account scored ${score}% on the Creekside 70-point audit (grade ${grade}). ${spendStr} The audit identified ${findings.criticalFails.length} critical and ${findings.highFails.length} high-priority issues, with ${findings.easySellFails.length} of those being easy-sell flags (visible, demonstrable, fixable in week one).`;

  return {
    executiveSummary,
    auditPosture: 'Understand the framework before changing it. Every recommendation in this audit assumes the open questions get answered first.',
    findingNarratives,
    phase1: `Pause any confirmed budget leaks and consolidate spend into the top-performing campaign or ad set. Address the ${findings.criticalFails.length} critical findings first: ${findings.criticalFails.slice(0, 3).map((f) => f.question).join('; ')}. Refresh stale audiences and document any tracking gaps. Goal: account has a clean structural foundation by Day 30.`,
    phase2: `Layer in optimization on top of the Phase 1 foundation. Tackle high-priority findings: ${findings.highFails.slice(0, 3).map((f) => f.question).join('; ')}. Launch a dedicated retargeting funnel, brief 2-3 new creative variants based on what's already working, and switch to Campaign Budget Optimization where ad sets share audiences. Goal: testing cadence in place, retargeting funnel live, attribution clean by Day 60.`,
    phase3: 'Scale validated winners in 20-30% budget increments while ROAS holds. Test Reels and Advantage+ Catalog placements. Build LTV-based 1% lookalikes from your top-quartile customers. Goal: predictable scaling at protected CPA, refresh cadence established for ongoing optimization.',
  };
};

async function generateNarrative(
  accountName: string,
  findings: ReturnType<typeof evaluateAudit>,
  insights: AuditOutput['data']['insights30dAccount']
): Promise<NarrativePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[meta-audit] ANTHROPIC_API_KEY not set, using rule-based narrative fallback');
    return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
  }

  const topFails = [...findings.criticalFails, ...findings.highFails].slice(0, 6);
  const findingsForPrompt = topFails.map((i) => ({
    id: i.id,
    section: i.section,
    severity: i.severity,
    question: i.question,
    evidence: i.evidence,
    recommendation: i.recommendation,
  }));

  const prompt = `You are Creekside Marketing's senior paid social strategist writing an audit for ${accountName}.

The audit has been evaluated programmatically. Your job is to produce the prose narrative sections. Match this voice:
- Direct, declarative sentences
- No em dashes anywhere (use double hyphens -- or restructure)
- No emojis, no hedging language ("might", "could potentially")
- Lead with the observation, follow with the implication
- Plain language, written for the business owner
- Contractions OK in narrative

Audit context:
- Account: ${accountName}
- Overall score: ${findings.overallScore}% (Grade ${findings.overallGrade})
- Critical fails: ${findings.criticalFails.length}
- High fails: ${findings.highFails.length}
- Easy-sell flags: ${findings.easySellFails.length}
${insights ? `- Last 30d spend: $${insights.spend.toLocaleString()}, ${insights.purchases} purchases, $${insights.cpa.toFixed(2)} CPA, ${insights.roas.toFixed(2)} ROAS` : ''}
${findings.topWinningAd ? `- Top performing ad: ${findings.topWinningAd.name} at $${findings.topWinningAd.cpa.toFixed(2)} CPA` : ''}
${findings.budgetLeakAd ? `- Budget leak detected: ${findings.budgetLeakAd.name} spent $${findings.budgetLeakAd.spend.toFixed(2)} with ${findings.budgetLeakAd.purchases} purchases` : ''}

Findings to write narrative for:
${JSON.stringify(findingsForPrompt, null, 2)}

Return a JSON object matching this exact shape (no markdown, just JSON):
{
  "executiveSummary": "2-3 sentences framing what we found in plain language.",
  "auditPosture": "One italicized quote stating the audit's philosophical posture.",
  "findingNarratives": [
    {
      "id": "x.x",
      "title": "Short directive headline (5-9 words)",
      "whatWeFound": "2-3 sentences with specific evidence",
      "whyItMatters": "1-2 sentences quantifying the impact",
      "theFix": "1-2 sentences prescribing the action"
    }
  ],
  "phase1": "Phase 1 description (30-50 words): Foundation, Days 1-30. What gets done.",
  "phase2": "Phase 2 description (30-50 words): Optimization, Days 31-60. What gets done.",
  "phase3": "Phase 3 description (30-50 words): Scale, Days 61-90. What gets done."
}

Produce findingNarratives for each finding in the input list, in the same order.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.warn('[meta-audit] Claude returned no text block, falling back');
      return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
    }
    // Extract JSON tolerantly: handle code fences, preamble text, trailing text
    const text = textBlock.text;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      console.warn('[meta-audit] Claude response had no JSON object, falling back');
      return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
    }
    const raw = text.slice(first, last + 1);
    try {
      const parsed = JSON.parse(raw) as NarrativePayload;
      // Validate the parsed payload has the required shape; if not, merge with fallback
      const fallback = TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
      return {
        executiveSummary: parsed.executiveSummary || fallback.executiveSummary,
        auditPosture: parsed.auditPosture || fallback.auditPosture,
        findingNarratives: Array.isArray(parsed.findingNarratives) && parsed.findingNarratives.length > 0
          ? parsed.findingNarratives
          : fallback.findingNarratives,
        phase1: parsed.phase1 || fallback.phase1,
        phase2: parsed.phase2 || fallback.phase2,
        phase3: parsed.phase3 || fallback.phase3,
      };
    } catch (parseErr) {
      console.warn('[meta-audit] Claude JSON parse failed, falling back:', parseErr);
      return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
    }
  } catch (err) {
    console.error('[meta-audit] Narrative generation failed:', err);
    return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade, findings, insights);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const { allowed, retryAfter } = checkRateLimit(ip, 'meta-audit');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many audit requests. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const body = await req.json();
    const accountId = body.accountId as string | undefined;
    if (!accountId) {
      return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    }

    // 1. Pull all account data
    const data = await pullAuditData(accountId);
    if (!data.account?.account_id) {
      return NextResponse.json(
        { error: 'Account not found or PipeBoard returned no data' },
        { status: 404 }
      );
    }

    // 2. Evaluate checklist
    const findings = evaluateAudit(data);

    // 3. Generate Claude narrative
    const narrative = await generateNarrative(
      data.account.name || data.account.account_id,
      findings,
      data.insights30dAccount
    );

    // 4. Build the audit output object
    const output: AuditOutput = {
      account: data.account,
      findings,
      data,
      narrative,
      generatedAt: new Date().toISOString(),
    };

    // 5. Generate both PDFs
    const auditPdf = generateAuditPdf(output);
    const loomPdf = generateLoomBriefPdf(output);

    // 6. Build filename slug
    const slug = (data.account.name || data.account.account_id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const dateStr = new Date().toISOString().split('T')[0];

    return NextResponse.json({
      audit: {
        filename: `meta-audit-${slug}-${dateStr}.pdf`,
        base64: auditPdf.toString('base64'),
      },
      loomBrief: {
        filename: `meta-audit-loom-brief-${slug}-${dateStr}.pdf`,
        base64: loomPdf.toString('base64'),
      },
      summary: {
        accountName: data.account.name,
        accountId: data.account.account_id,
        overallScore: findings.overallScore,
        overallGrade: findings.overallGrade,
        easySellFails: findings.easySellFails.length,
        criticalFails: findings.criticalFails.length,
        highFails: findings.highFails.length,
        topFindings: [...findings.easySellFails, ...findings.criticalFails, ...findings.highFails]
          .slice(0, 5)
          .map((f) => ({ id: f.id, severity: f.severity, question: f.question })),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Meta audit run failed:', err);
    const status = msg.includes('PIPEBOARD_API_KEY') ? 500 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
