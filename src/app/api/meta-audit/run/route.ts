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

const TEMPLATE_NARRATIVE = (
  accountName: string,
  score: number,
  grade: string
): NarrativePayload => ({
  executiveSummary: `${accountName}'s Meta Ads account scored ${score}% on the Creekside 70-point audit (grade ${grade}). The full findings, prioritized fixes, and 90-day plan follow.`,
  auditPosture: 'Understand the framework before changing it. Every recommendation in this audit assumes the open questions get answered first.',
  findingNarratives: [],
  phase1: 'Pause confirmed budget leaks. Consolidate budget into the top-performing campaign. Refresh stale audiences. Document any tracking gaps.',
  phase2: 'Add dedicated retargeting funnel. Test creative variants based on the winner brief. Move to Campaign Budget Optimization where appropriate.',
  phase3: 'Scale budget on validated winners in 20-30% increments. Test Reels and Advantage+ Catalog. Build LTV-based optimization.',
});

async function generateNarrative(
  accountName: string,
  findings: ReturnType<typeof evaluateAudit>,
  insights: AuditOutput['data']['insights30dAccount']
): Promise<NarrativePayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade);
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
      return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade);
    }
    // Strip code fences if Claude wrapped the JSON
    const raw = textBlock.text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(raw) as NarrativePayload;
  } catch (err) {
    console.error('Narrative generation failed:', err);
    return TEMPLATE_NARRATIVE(accountName, findings.overallScore, findings.overallGrade);
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
