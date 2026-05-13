// Server-side PDF generation for the meta-audit-agent dashboard integration.
// Uses jsPDF programmatically (no DOM dependency). Produces two PDFs:
//
//   1. The full audit document (multi-section, branded, JSM-Sensate + B2B Rocket format)
//   2. The Loom Recording Brief (top 5 findings + UI breadcrumbs for Lindsey/Scott)
//
// Both return Buffer.

import { jsPDF } from 'jspdf';
import type { AuditOutput } from './types';

interface DocState {
  doc: jsPDF;
  y: number;
  pageNumber: number;
}

const MARGIN_X = 56;
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BOTTOM_LIMIT = PAGE_HEIGHT - 90;

const COLOR = {
  text: [15, 23, 42] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  accent: [37, 99, 235] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  red: [185, 28, 28] as [number, number, number],
  amber: [161, 98, 7] as [number, number, number],
  green: [21, 128, 61] as [number, number, number],
  bg: [248, 250, 252] as [number, number, number],
};

function newDoc(): DocState {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'normal');
  return { doc, y: 60, pageNumber: 1 };
}

function setFill(s: DocState, c: [number, number, number]) {
  s.doc.setFillColor(c[0], c[1], c[2]);
}

function setText(s: DocState, c: [number, number, number]) {
  s.doc.setTextColor(c[0], c[1], c[2]);
}

function setDraw(s: DocState, c: [number, number, number]) {
  s.doc.setDrawColor(c[0], c[1], c[2]);
}

function ensureSpace(s: DocState, needed: number, account: string, audit: string) {
  if (s.y + needed > BOTTOM_LIMIT) {
    newPage(s, account, audit);
  }
}

function newPage(s: DocState, account: string, audit: string) {
  pageFooter(s, account, audit);
  s.doc.addPage();
  s.pageNumber += 1;
  s.y = 60;
  pageHeader(s, account, audit);
}

function pageHeader(s: DocState, account: string, audit: string) {
  s.doc.setFontSize(8);
  setText(s, COLOR.muted);
  s.doc.text(`${account.toUpperCase()} · ${audit}`, MARGIN_X, 36);
  setDraw(s, COLOR.border);
  s.doc.setLineWidth(0.5);
  s.doc.line(MARGIN_X, 44, PAGE_WIDTH - MARGIN_X, 44);
  s.y = 70;
}

function pageFooter(s: DocState, account: string, audit: string) {
  s.doc.setFontSize(8);
  setText(s, COLOR.muted);
  s.doc.text(
    `Creekside Marketing · ${account} · ${audit} · Page ${s.pageNumber}`,
    MARGIN_X,
    PAGE_HEIGHT - 30
  );
}

function h1(s: DocState, text: string) {
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(22);
  setText(s, COLOR.text);
  s.doc.text(text, MARGIN_X, s.y);
  s.y += 28;
}

function h2(s: DocState, text: string, account: string, audit: string) {
  ensureSpace(s, 40, account, audit);
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(15);
  setText(s, COLOR.text);
  s.doc.text(text, MARGIN_X, s.y);
  s.y += 20;
}

function h3(s: DocState, text: string, account: string, audit: string) {
  ensureSpace(s, 28, account, audit);
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(12);
  setText(s, COLOR.text);
  s.doc.text(text, MARGIN_X, s.y);
  s.y += 16;
}

function body(s: DocState, text: string, account: string, audit: string) {
  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(10);
  setText(s, COLOR.text);
  const lines = s.doc.splitTextToSize(text, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(s, 14, account, audit);
    s.doc.text(line, MARGIN_X, s.y);
    s.y += 13;
  }
  s.y += 4;
}

function muted(s: DocState, text: string, account: string, audit: string) {
  s.doc.setFont('helvetica', 'italic');
  s.doc.setFontSize(9);
  setText(s, COLOR.muted);
  const lines = s.doc.splitTextToSize(text, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(s, 12, account, audit);
    s.doc.text(line, MARGIN_X, s.y);
    s.y += 12;
  }
  s.y += 4;
}

function table(
  s: DocState,
  headers: string[],
  rows: string[][],
  widths: number[],
  account: string,
  audit: string
) {
  const rowHeight = 18;
  ensureSpace(s, rowHeight * (rows.length + 1) + 10, account, audit);

  // Header
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(9);
  setFill(s, COLOR.bg);
  s.doc.rect(MARGIN_X, s.y - 12, CONTENT_WIDTH, rowHeight, 'F');
  setText(s, COLOR.text);
  let x = MARGIN_X + 6;
  headers.forEach((h, i) => {
    s.doc.text(h, x, s.y);
    x += widths[i];
  });
  s.y += rowHeight - 2;

  // Rows
  s.doc.setFont('helvetica', 'normal');
  setDraw(s, COLOR.border);
  s.doc.setLineWidth(0.3);
  for (const row of rows) {
    ensureSpace(s, rowHeight + 2, account, audit);
    s.doc.line(MARGIN_X, s.y - 12, PAGE_WIDTH - MARGIN_X, s.y - 12);
    x = MARGIN_X + 6;
    setText(s, COLOR.text);
    row.forEach((cell, i) => {
      const truncated = s.doc.splitTextToSize(cell, widths[i] - 6)[0] || '';
      s.doc.text(truncated, x, s.y);
      x += widths[i];
    });
    s.y += rowHeight - 2;
  }
  s.y += 10;
}

function severityBadge(severity: string): [string, [number, number, number]] {
  switch (severity) {
    case 'CRITICAL':
      return ['CRITICAL', COLOR.red];
    case 'HIGH':
      return ['HIGH', COLOR.amber];
    case 'MEDIUM':
      return ['MEDIUM', COLOR.muted];
    default:
      return ['LOW', COLOR.muted];
  }
}

// ============ AUDIT PDF ============

export function generateAuditPdf(output: AuditOutput): Buffer {
  const { account, findings, data, narrative } = output;
  const accountName = account.name || account.account_id;
  const auditTitle = 'META ADS AUDIT';
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const s = newDoc();

  // ===== Cover Page =====
  setText(s, COLOR.accent);
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(10);
  s.doc.text('CREEKSIDE MARKETING', MARGIN_X, s.y);
  s.doc.setFont('helvetica', 'normal');
  setText(s, COLOR.muted);
  s.doc.setFontSize(8);
  s.doc.text('PAID MEDIA INTELLIGENCE', MARGIN_X, s.y + 14);
  s.y += 60;

  setText(s, COLOR.muted);
  s.doc.setFontSize(9);
  s.doc.text(`CONFIDENTIAL · FOR ${accountName.toUpperCase()}`, MARGIN_X, s.y);
  s.y += 30;

  setText(s, COLOR.text);
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(28);
  s.doc.text('Meta Ads Account Audit', MARGIN_X, s.y);
  s.y += 36;

  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(14);
  setText(s, COLOR.accent);
  s.doc.text(accountName, MARGIN_X, s.y);
  s.y += 30;

  setText(s, COLOR.text);
  body(s, narrative.executiveSummary, accountName, auditTitle);

  // KPI tiles
  const tile = (label: string, value: string, x: number, y: number) => {
    setFill(s, COLOR.bg);
    s.doc.rect(x, y, 110, 60, 'F');
    setText(s, COLOR.muted);
    s.doc.setFontSize(8);
    s.doc.text(label.toUpperCase(), x + 8, y + 14);
    setText(s, COLOR.text);
    s.doc.setFont('helvetica', 'bold');
    s.doc.setFontSize(14);
    s.doc.text(value, x + 8, y + 38);
    s.doc.setFont('helvetica', 'normal');
  };

  const insights = data.insights30dAccount;
  if (insights) {
    s.y += 10;
    tile('Spend (30d)', `$${Math.round(insights.spend).toLocaleString()}`, MARGIN_X, s.y);
    tile('Purchases', String(insights.purchases), MARGIN_X + 120, s.y);
    tile('ROAS', insights.roas.toFixed(2), MARGIN_X + 240, s.y);
    tile('CPA', `$${insights.cpa.toFixed(0)}`, MARGIN_X + 360, s.y);
    s.y += 80;
  }

  setText(s, COLOR.muted);
  s.doc.setFontSize(9);
  s.doc.text(`Account ID: ${account.account_id}`, MARGIN_X, s.y);
  s.y += 14;
  s.doc.text(`Audit date: ${dateStr}`, MARGIN_X, s.y);
  s.y += 14;
  s.doc.text(`Prepared by: Creekside Marketing`, MARGIN_X, s.y);

  // ===== Scorecard Page =====
  newPage(s, accountName, auditTitle);
  h1(s, 'Audit Scorecard');
  body(s, `Overall score: ${findings.overallScore}% (Grade ${findings.overallGrade})`, accountName, auditTitle);
  s.y += 6;

  table(
    s,
    ['Section', 'Pass', 'Fail', 'N/A', 'Gap', 'Score'],
    findings.sectionScores.map((sc) => [
      sc.section,
      String(sc.pass),
      String(sc.fail),
      String(sc.na),
      String(sc.gap),
      sc.pass + sc.fail === 0 ? 'N/A' : `${sc.scorePct}%`,
    ]),
    [200, 50, 50, 50, 50, 50],
    accountName,
    auditTitle
  );

  // ===== Top Findings Page =====
  h2(s, 'Easy-Win Highlights', accountName, auditTitle);
  if (findings.easySellFails.length === 0) {
    body(s, 'No easy-sell flags identified. Account fundamentals are in good shape.', accountName, auditTitle);
  } else {
    findings.easySellFails.slice(0, 5).forEach((item, i) => {
      const [badgeText, badgeColor] = severityBadge(item.severity);
      setText(s, badgeColor);
      s.doc.setFont('helvetica', 'bold');
      s.doc.setFontSize(8);
      s.doc.text(`#${i + 1}  ${badgeText}  ·  ${item.id}`, MARGIN_X, s.y);
      s.y += 12;
      h3(s, item.question, accountName, auditTitle);
      body(s, item.evidence, accountName, auditTitle);
      if (item.recommendation) {
        setText(s, COLOR.muted);
        s.doc.setFont('helvetica', 'italic');
        s.doc.setFontSize(9);
        const lines = s.doc.splitTextToSize(`Fix: ${item.recommendation}`, CONTENT_WIDTH);
        for (const line of lines) {
          ensureSpace(s, 12, accountName, auditTitle);
          s.doc.text(line, MARGIN_X, s.y);
          s.y += 12;
        }
        s.y += 4;
      }
      s.y += 8;
    });
  }

  // ===== Critical & High Findings =====
  newPage(s, accountName, auditTitle);
  h1(s, "What's Holding This Account Back");
  const detailed = [...findings.criticalFails, ...findings.highFails];
  detailed.forEach((item) => {
    const matchingNarrative = narrative.findingNarratives.find((n) => n.id === item.id);
    const [badgeText, badgeColor] = severityBadge(item.severity);
    setText(s, badgeColor);
    s.doc.setFont('helvetica', 'bold');
    s.doc.setFontSize(8);
    s.doc.text(`${badgeText} · ${item.id}`, MARGIN_X, s.y);
    s.y += 12;
    h3(s, matchingNarrative?.title || item.question, accountName, auditTitle);
    if (matchingNarrative) {
      h3(s, 'What we found', accountName, auditTitle);
      body(s, matchingNarrative.whatWeFound, accountName, auditTitle);
      h3(s, 'Why it matters', accountName, auditTitle);
      body(s, matchingNarrative.whyItMatters, accountName, auditTitle);
      h3(s, 'The fix', accountName, auditTitle);
      body(s, matchingNarrative.theFix, accountName, auditTitle);
    } else {
      body(s, item.evidence, accountName, auditTitle);
      if (item.recommendation) muted(s, `Fix: ${item.recommendation}`, accountName, auditTitle);
    }
    s.y += 8;
  });

  // ===== Performance Snapshot =====
  newPage(s, accountName, auditTitle);
  h1(s, 'Performance Snapshot: Last 30 Days');
  if (insights) {
    table(
      s,
      ['Metric', 'Value'],
      [
        ['Total Spend', `$${insights.spend.toLocaleString()}`],
        ['Impressions', insights.impressions.toLocaleString()],
        ['Reach', insights.reach.toLocaleString()],
        ['Clicks', insights.clicks.toLocaleString()],
        ['CTR', `${insights.ctr.toFixed(2)}%`],
        ['CPC', `$${insights.cpc.toFixed(2)}`],
        ['CPM', `$${insights.cpm.toFixed(2)}`],
        ['Frequency', insights.frequency.toFixed(2)],
        ['Purchases', insights.purchases.toString()],
        ['Purchase value', `$${insights.purchaseValue.toLocaleString()}`],
        ['ROAS', insights.roas.toFixed(2)],
        ['Blended CPA', `$${insights.cpa.toFixed(2)}`],
      ],
      [300, 150],
      accountName,
      auditTitle
    );
  }

  if (findings.topWinningAd) {
    h3(s, 'Top Performing Ad (Last 7 Days)', accountName, auditTitle);
    body(
      s,
      `${findings.topWinningAd.name} -- ${findings.topWinningAd.purchases} purchases at $${findings.topWinningAd.cpa.toFixed(2)} CPA on $${findings.topWinningAd.spend.toFixed(2)} spend.`,
      accountName,
      auditTitle
    );
  }
  if (findings.budgetLeakAd) {
    h3(s, 'Budget Leak (Last 7 Days)', accountName, auditTitle);
    body(
      s,
      `${findings.budgetLeakAd.name} -- $${findings.budgetLeakAd.spend.toFixed(2)} spent, ${findings.budgetLeakAd.purchases} purchases. Pause and audit.`,
      accountName,
      auditTitle
    );
  }

  // ===== 90-Day Plan =====
  newPage(s, accountName, auditTitle);
  h1(s, 'The 90-Day Plan');
  h2(s, 'Phase 1 -- Foundation (Days 1-30)', accountName, auditTitle);
  body(s, narrative.phase1, accountName, auditTitle);
  h2(s, 'Phase 2 -- Optimization (Days 31-60)', accountName, auditTitle);
  body(s, narrative.phase2, accountName, auditTitle);
  h2(s, 'Phase 3 -- Scale (Days 61-90)', accountName, auditTitle);
  body(s, narrative.phase3, accountName, auditTitle);

  // ===== Appendix: Full Checklist =====
  newPage(s, accountName, auditTitle);
  h1(s, 'Appendix: Full Checklist Results');
  table(
    s,
    ['ID', 'Item', 'Result', 'Evidence'],
    findings.items.map((i) => [i.id, i.question, i.result, i.evidence.slice(0, 80)]),
    [40, 180, 60, 200],
    accountName,
    auditTitle
  );

  pageFooter(s, accountName, auditTitle);

  return Buffer.from(s.doc.output('arraybuffer'));
}

// ============ LOOM BRIEF PDF ============

export function generateLoomBriefPdf(output: AuditOutput): Buffer {
  const { account, findings } = output;
  const accountName = account.name || account.account_id;
  const audit = 'LOOM RECORDING BRIEF';
  const acctNumeric = (account.account_id || '').replace('act_', '');

  const s = newDoc();

  // Cover
  setText(s, COLOR.accent);
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(10);
  s.doc.text('CREEKSIDE MARKETING', MARGIN_X, s.y);
  s.y += 24;

  s.doc.setFontSize(22);
  setText(s, COLOR.text);
  s.doc.text('Loom Recording Brief', MARGIN_X, s.y);
  s.y += 26;

  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(13);
  setText(s, COLOR.accent);
  s.doc.text(`Meta Ads Audit: ${accountName}`, MARGIN_X, s.y);
  s.y += 24;

  setText(s, COLOR.muted);
  s.doc.setFontSize(9);
  s.doc.text(`Prepared for: Lindsey / Scott (freelance screen-recorders)`, MARGIN_X, s.y);
  s.y += 12;
  s.doc.text(`Account: ${accountName} (${account.account_id})`, MARGIN_X, s.y);
  s.y += 12;
  s.doc.text(
    `Audit Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    MARGIN_X,
    s.y
  );
  s.y += 24;

  setText(s, COLOR.text);
  body(
    s,
    'Record a Loom video walking through the 5 findings below. For each finding: navigate to the screen shown, hover over the key metric, and read the talking points in your own words. Keep the recording under 10 minutes total.',
    accountName,
    audit
  );

  s.y += 8;
  h3(s, 'Before You Start', accountName, audit);
  body(s, `Account URL: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acctNumeric}`, accountName, audit);
  body(
    s,
    'Login: Use the Creekside team login in the shared 1Password vault. If you do not have access, message Peterson on Google Chat before starting.',
    accountName,
    audit
  );

  // Findings -- pick top 5 from easy-sell fails, then critical, then high
  const candidates = [
    ...findings.easySellFails,
    ...findings.criticalFails.filter((c) => !findings.easySellFails.includes(c)),
    ...findings.highFails.filter((h) => !findings.easySellFails.includes(h) && !findings.criticalFails.includes(h)),
  ];
  const top5 = candidates.slice(0, 5);

  top5.forEach((item, i) => {
    newPage(s, accountName, audit);
    setText(s, COLOR.accent);
    s.doc.setFont('helvetica', 'bold');
    s.doc.setFontSize(11);
    s.doc.text(`FINDING ${i + 1}`, MARGIN_X, s.y);
    s.y += 18;
    h2(s, item.question, accountName, audit);

    h3(s, 'What this finding is (context, do not say on camera)', accountName, audit);
    body(s, item.evidence, accountName, audit);

    h3(s, 'Navigate to', accountName, audit);
    body(s, breadcrumbsFor(item.id), accountName, audit);

    h3(s, 'What to show on screen', accountName, audit);
    body(s, screenFor(item.id, item.evidence), accountName, audit);

    h3(s, 'Talking points (your own words)', accountName, audit);
    body(s, item.recommendation || 'Explain the finding to the prospect in plain language.', accountName, audit);
  });

  // Closing
  newPage(s, accountName, audit);
  h2(s, 'Closing (on camera)', accountName, audit);
  body(
    s,
    `This account scored ${findings.overallScore}% on our 70-point audit. The foundation is ${findings.overallScore >= 75 ? 'solid' : 'workable'}, with specific gaps that are operational, not structural. Most of the fixes here can be done in week one. If you have any questions about what you saw, just reply to the Loom and we will follow up.`,
    accountName,
    audit
  );

  s.y += 16;
  h3(s, 'Escalation', accountName, audit);
  body(
    s,
    'If the prospect wants to discuss the audit or asks technical questions you cannot answer: loop Peterson Rainey or Cade Maclean via ClickUp chat. Sales calls are handled by Peterson and Cade.',
    accountName,
    audit
  );

  pageFooter(s, accountName, audit);

  return Buffer.from(s.doc.output('arraybuffer'));
}

// Static breadcrumb lookup keyed by checklist item ID. Falls back to generic
// guidance when the item ID has no specific path.
function breadcrumbsFor(id: string): string {
  const map: Record<string, string> = {
    '1.1': 'Open Ads Manager > hamburger menu > Events Manager > Data Sources. Find the pixel for this account and check "Last activity" timestamp.',
    '1.2': 'Events Manager > pixel name > Overview tab. Show the events listed and last fire time per event.',
    '1.3': 'Events Manager > pixel name > Settings tab. Look for "Conversions API" status.',
    '2.1': 'Ads Manager > Campaigns tab. Look at the "Objective" column (you may need to customize columns to show it).',
    '2.11': 'Ads Manager > Campaigns tab > "Last 30 days" date range. Count active campaigns and look at the Spend column distribution.',
    '3.1': 'Ads Manager > hamburger menu > Audiences. Filter by "Website" subtype.',
    '3.2': 'Ads Manager > Audiences. Filter by "Customer List" subtype.',
    '3.6': 'Ads Manager > Campaigns > [campaign] > Ad Sets > [ad set] > Edit > Audience Controls > "Exclusions" section.',
    '3.11': 'Ads Manager > Audiences. Sort by "Last updated" and look for stale lookalikes.',
    '4.1': 'Ads Manager > Ad Sets tab. Click into each ad set and check the Ads count.',
    '4.2': 'Ads Manager > Ads tab. Filter by format = Video.',
    '4.4': 'Ads Manager > Ads tab > customize columns to include Frequency. Set date range to "Last 7 days".',
    '4.9': 'Ads Manager > [Ad] > Edit > Ad creative section > "Advantage+ Creative" toggles.',
    '4.13': 'Ads Manager > Ads tab > Sort by Created date ascending. Look at the oldest active creatives.',
    '5.1': 'Ads Manager > Ad Sets tab > Delivery column. Look for "Learning" or "Learning Limited" badges.',
    '5.4': 'Ads Manager > Campaigns tab > customize columns to include "Cost per result" and ROAS.',
    '5.5': 'Ads Manager > Campaigns tab > sort by Amount Spent. Show how spend distributes across active campaigns.',
    '6.1': 'Ads Manager > Account Overview > top-right Columns dropdown > Customize Columns > "Attribution Setting".',
    '6.2': 'Ads Manager > [Ad Set] > Edit > Conversion section. Show the optimization event.',
    '7.2': 'Ads Manager > [Ad Set] > Edit > Placements section. Show whether Audience Network is checked.',
  };
  return map[id] || 'Navigate in Ads Manager to the relevant section. Take your time finding the right view -- you can edit the Loom afterwards.';
}

function screenFor(_id: string, evidence: string): string {
  return `Have the data visible. Specifically: ${evidence}`;
}
