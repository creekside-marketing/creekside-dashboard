// Server-side PDF generation for the meta-audit-agent dashboard integration.
// Uses jsPDF programmatically (no DOM dependency). Produces two PDFs:
//
//   1. The full audit document (multi-section, branded, JSM-Sensate + B2B Rocket format)
//   2. The Loom Recording Brief (top 5 findings + UI breadcrumbs for Lindsey/Scott)
//
// Both return Buffer.

import { jsPDF } from 'jspdf';
import type { AuditOutput, CreativeSummary } from './types';
import { decodeLocales, isUnrestricted } from './locales';

interface DocState {
  doc: jsPDF;
  y: number;
  pageNumber: number;
}

interface FetchedImage {
  dataUri: string;
  format: 'JPEG' | 'PNG';
  width: number;
  height: number;
}

// Fetches an image URL server-side and returns a base64 data URI plus
// dimensions so jsPDF.addImage can size it. Returns null on any failure
// (timeout, non-2xx, oversized, unsupported format) so the caller can fall
// back to a text-only card gracefully.
//
// Caps: 8s timeout, 2MB max payload. Meta image CDN is usually well under.
async function fetchImageForPdf(url: string): Promise<FetchedImage | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'image/jpeg,image/png,image/*;q=0.8' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    let format: 'JPEG' | 'PNG';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      format = 'JPEG';
    } else if (contentType.includes('png')) {
      format = 'PNG';
    } else {
      // Try sniffing from extension as a fallback
      const lower = url.toLowerCase();
      if (lower.includes('.jpg') || lower.includes('.jpeg')) format = 'JPEG';
      else if (lower.includes('.png')) format = 'PNG';
      else return null;
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2 * 1024 * 1024) return null; // 2MB cap

    const base64 = Buffer.from(buf).toString('base64');
    const dataUri = `data:image/${format.toLowerCase()};base64,${base64}`;

    // jsPDF needs concrete dimensions. Use a sane default and let the
    // caller scale to width-fit. Meta creatives are typically square
    // (1080x1080) or 4:5 (1080x1350). We'll compute aspect from the
    // PNG/JPEG header to size correctly.
    const dims = readImageDimensions(Buffer.from(buf), format);
    if (!dims) return null;

    // Reject low-resolution preview/thumbnail images. Meta's nested fields
    // sometimes only expose ~200x200 thumbnails (object_story_spec.picture,
    // some video thumbnail_url) which look terrible when scaled up to
    // 160pt in the PDF. Skipping them lets the card render text-only,
    // which is cleaner than showing a blurry image to a prospect.
    if (dims.width < 400 || dims.height < 400) return null;

    return { dataUri, format, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

// Minimal header parser for JPEG/PNG to extract intrinsic dimensions.
// Avoids pulling in a dependency. Returns null if it can't read.
function readImageDimensions(buf: Buffer, format: 'JPEG' | 'PNG'): { width: number; height: number } | null {
  try {
    if (format === 'PNG') {
      // PNG: bytes 16-19 = width (big-endian), 20-23 = height (big-endian)
      if (buf.length < 24) return null;
      if (buf.readUInt32BE(0) !== 0x89504e47) return null;
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
    // JPEG: scan for SOF0/SOF2 markers
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      // SOF markers (skip SOF1/SOF5..SOF7 which we don't care about here)
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(i + 5);
        const width = buf.readUInt16BE(i + 7);
        return { width, height };
      }
      const segLen = buf.readUInt16BE(i + 2);
      i += 2 + segLen;
    }
    return null;
  } catch {
    return null;
  }
}

// Resolve the best image URL for a creative. Prefers static image_url, falls
// back to video thumbnail if present. Returns null if neither.
function bestImageUrl(c: CreativeSummary): string | null {
  if (c.image_url) return c.image_url;
  // video_id alone doesn't give us a URL; the data puller would need to
  // separately call get_ad_video for thumbnails. Out of scope for tier 1.
  return null;
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

function renderTableHeader(s: DocState, headers: string[], widths: number[]) {
  const rowHeight = 18;
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
  // Reserve room for at least the header + 1 row. If less, start fresh page.
  ensureSpace(s, rowHeight * 2 + 4, account, audit);
  renderTableHeader(s, headers, widths);

  // Rows
  s.doc.setFont('helvetica', 'normal');
  setDraw(s, COLOR.border);
  s.doc.setLineWidth(0.3);
  for (const row of rows) {
    // If a row won't fit, paginate and re-render the header on the new page.
    if (s.y + rowHeight + 2 > BOTTOM_LIMIT) {
      newPage(s, account, audit);
      renderTableHeader(s, headers, widths);
      s.doc.setFont('helvetica', 'normal');
    }
    s.doc.line(MARGIN_X, s.y - 12, PAGE_WIDTH - MARGIN_X, s.y - 12);
    let x = MARGIN_X + 6;
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

// Renders a card header (numbered name) and wraps long names so they never
// overflow the page width. Used by Ad Set Breakdown + Creative Review cards.
function cardHeader(s: DocState, idx: number, name: string, account: string, audit: string) {
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(11);
  setText(s, COLOR.text);
  const display = `${idx + 1}. ${name}`;
  const lines = s.doc.splitTextToSize(display, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(s, 14, account, audit);
    s.doc.text(line, MARGIN_X, s.y);
    s.y += 14;
  }
}

// Renders a label/value row inside a card. Wraps the value across multiple
// lines if needed; never overflows page width. Label column is fixed width.
function fieldRow(
  s: DocState,
  label: string,
  value: string,
  valueColor: [number, number, number],
  account: string,
  audit: string,
  labelWidth = 95
) {
  ensureSpace(s, 12, account, audit);
  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(9);
  setText(s, COLOR.muted);
  s.doc.text(label, MARGIN_X, s.y);
  setText(s, valueColor);
  const valueLines = s.doc.splitTextToSize(value, CONTENT_WIDTH - labelWidth);
  valueLines.forEach((line: string, i: number) => {
    if (i > 0) {
      ensureSpace(s, 11, account, audit);
    }
    s.doc.text(line, MARGIN_X + labelWidth, s.y);
    if (i < valueLines.length - 1) s.y += 11;
  });
  s.y += 12;
}

// Renders a multi-line value below its label (label on its own line).
// Used for audience lists which can be many items long.
function fieldBlock(
  s: DocState,
  label: string,
  value: string,
  account: string,
  audit: string
) {
  ensureSpace(s, 22, account, audit);
  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(9);
  setText(s, COLOR.muted);
  s.doc.text(label, MARGIN_X, s.y);
  s.y += 11;
  setText(s, COLOR.text);
  const lines = s.doc.splitTextToSize(value, CONTENT_WIDTH - 12);
  lines.forEach((line: string) => {
    ensureSpace(s, 11, account, audit);
    s.doc.text(line, MARGIN_X + 12, s.y);
    s.y += 11;
  });
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

export async function generateAuditPdf(output: AuditOutput): Promise<Buffer> {
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
  if (insights && insights.impressions > 0) {
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

    // Performance commentary
    const roasText = insights.roas >= 1
      ? `ROAS of ${insights.roas.toFixed(2)} is above breakeven.`
      : `ROAS of ${insights.roas.toFixed(2)} is below breakeven. Either LTV is expected to make up the difference, or unit economics need review.`;
    const learningPhase = insights.purchases < 50 * 4.3
      ? `At ${(insights.purchases / 4.3).toFixed(1)} purchases per week, the account is below Meta's 50/week learning-phase exit threshold.`
      : `At ${(insights.purchases / 4.3).toFixed(1)} purchases per week, the account is past learning phase.`;
    body(s, `${roasText} ${learningPhase}`, accountName, auditTitle);
  } else {
    body(
      s,
      `This account had no Meta Ads activity in the last 30 days. Lifetime spend on the account is $${Number(account.amount_spent || 0).toLocaleString()}, so it has historical data but is currently paused or dormant.`,
      accountName,
      auditTitle
    );
    body(
      s,
      'The structural findings in the previous sections (pixel health, audience architecture, campaign structure, attribution setup) apply regardless of campaign activity. Performance-based items (CPA, ROAS, frequency, ad fatigue) cannot be evaluated until campaigns are live again.',
      accountName,
      auditTitle
    );
    if (data.campaigns.length > 0) {
      const paused = data.campaigns.filter((c) => c.status === 'PAUSED').length;
      const active = data.campaigns.filter((c) => c.status === 'ACTIVE').length;
      muted(
        s,
        `Account state: ${active} active campaign(s), ${paused} paused campaign(s).`,
        accountName,
        auditTitle
      );
    }
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

  // ===== Ad Set Targeting Breakdown =====
  // Per active ad set, show language, geo, age range, included/excluded audiences,
  // optimization goal, attribution. This is the headline section for "they're
  // targeting all languages" type findings -- prospects can SEE it on the page.
  const activeAdsets = data.adsets.filter((a) => a.status === 'ACTIVE');
  if (activeAdsets.length > 0) {
    newPage(s, accountName, auditTitle);
    h1(s, 'Ad Set Targeting Breakdown');
    body(
      s,
      `This section shows exactly what each of the ${activeAdsets.length} active ad set${activeAdsets.length === 1 ? '' : 's'} is targeting. Targeting issues like "all languages" or "all countries" are often the highest-impact, fastest fixes in an audit.`,
      accountName,
      auditTitle
    );
    s.y += 8;

    activeAdsets.slice(0, 8).forEach((adset, idx) => {
      const languages = decodeLocales(adset.targeting?.locales);
      const isUnrestrictedLang = isUnrestricted(adset.targeting?.locales);
      const countries = adset.targeting?.geo_locations?.countries?.join(', ') || 'not set';
      const ageMin = adset.targeting?.age_min;
      const ageMax = adset.targeting?.age_max;
      const ageRange = ageMin && ageMax ? `${ageMin}-${ageMax}` : 'not set';
      const includedAudiences = adset.targeting?.custom_audiences?.map((a) => a.name).slice(0, 4) || [];
      const excludedAudiences = adset.targeting?.excluded_custom_audiences?.map((a) => a.name).slice(0, 4) || [];
      const optGoal = adset.optimization_goal || 'not set';
      const attribution = adset.attribution_spec
        ?.map((sp) => `${sp.window_days}d ${sp.event_type.toLowerCase().replace('_', '-')}`)
        .join(', ') || 'default';
      const advantage = adset.targeting?.targeting_automation?.advantage_audience === 1 ? 'On' : 'Off';

      // Card header with wrapped name
      cardHeader(s, idx, adset.name, accountName, auditTitle);

      // Field rows (each wraps its value if needed)
      fieldRow(s, 'Languages:', languages.join(', '), isUnrestrictedLang ? COLOR.red : COLOR.text, accountName, auditTitle);
      fieldRow(s, 'Countries:', countries, COLOR.text, accountName, auditTitle);
      fieldRow(s, 'Age range:', ageRange, COLOR.text, accountName, auditTitle);
      fieldRow(s, 'Optimizing for:', optGoal, COLOR.text, accountName, auditTitle);
      fieldRow(s, 'Attribution:', attribution, COLOR.text, accountName, auditTitle);
      fieldRow(s, 'Advantage+ Audience:', advantage, COLOR.text, accountName, auditTitle, 135);

      if (includedAudiences.length > 0) {
        fieldBlock(s, 'Includes audiences:', includedAudiences.join(', '), accountName, auditTitle);
      }
      if (excludedAudiences.length > 0) {
        fieldBlock(s, 'Excludes audiences:', excludedAudiences.join(', '), accountName, auditTitle);
      }

      // Inline flag if unrestricted languages
      if (isUnrestrictedLang) {
        ensureSpace(s, 14, accountName, auditTitle);
        s.y += 2;
        setText(s, COLOR.red);
        s.doc.setFont('helvetica', 'italic');
        s.doc.setFontSize(9);
        const flagText = '! Language not restricted -- ads can deliver in any language to anyone in the targeted region.';
        const flagLines = s.doc.splitTextToSize(flagText, CONTENT_WIDTH);
        flagLines.forEach((line: string) => {
          ensureSpace(s, 11, accountName, auditTitle);
          s.doc.text(line, MARGIN_X, s.y);
          s.y += 11;
        });
        s.doc.setFont('helvetica', 'normal');
      }

      // Separator line
      s.y += 6;
      ensureSpace(s, 8, accountName, auditTitle);
      setDraw(s, COLOR.border);
      s.doc.setLineWidth(0.3);
      s.doc.line(MARGIN_X, s.y - 4, PAGE_WIDTH - MARGIN_X, s.y - 4);
      s.y += 6;
    });

    if (activeAdsets.length > 8) {
      muted(
        s,
        `Showing 8 of ${activeAdsets.length} active ad sets. Full list available on request.`,
        accountName,
        auditTitle
      );
    }
  }

  // ===== Active Creative Review =====
  // Show the actual ad copy a prospect is running. Surfaces issues like
  // generic homepages, missing CTAs, weak hooks.
  if (data.creatives.length > 0) {
    newPage(s, accountName, auditTitle);
    h1(s, 'Active Creative Review');
    body(
      s,
      `The following ${data.creatives.length} creative${data.creatives.length === 1 ? ' is' : 's are'} active in the account. We've reviewed each for clarity, CTA presence, and landing-page specificity.`,
      accountName,
      auditTitle
    );
    s.y += 8;

    // Pre-fetch all creative images in parallel before the render loop.
    // jsPDF.addImage is synchronous, so we have to materialize the bytes
    // up front. Failures are caught per-image; cards without images still
    // render text-only (the Tier 3 fallback Cade signed off on).
    const creativesToRender = data.creatives.slice(0, 8);
    const imageResults = await Promise.all(
      creativesToRender.map(async (c) => {
        const url = bestImageUrl(c);
        if (!url) return null;
        return fetchImageForPdf(url);
      })
    );

    creativesToRender.forEach((c, idx) => {
      // Use ID for the header label since Meta auto-names creatives with the
      // body text + date hash (which collides visually with the body block).
      // Fall back to a short label if no ID.
      const displayName = c.title && c.title.length < 80
        ? c.title
        : c.id
        ? `Creative ${c.id}`
        : `Creative ${idx + 1}`;
      cardHeader(s, idx, displayName, accountName, auditTitle);

      // Embed the actual creative image if we successfully fetched it.
      // Sizing: max 140pt wide (leaves room for text below); preserve aspect.
      const img = imageResults[idx];
      if (img) {
        const maxW = 160;
        const aspect = img.height / Math.max(img.width, 1);
        const drawW = maxW;
        const drawH = Math.min(maxW * aspect, 200); // cap height for tall creatives
        ensureSpace(s, drawH + 8, accountName, auditTitle);
        try {
          s.doc.addImage(img.dataUri, img.format, MARGIN_X, s.y, drawW, drawH);
          s.y += drawH + 8;
        } catch {
          // jsPDF rejected the image bytes; skip silently and fall through
          // to text-only card.
        }
      }

      // Title (headline) -- only show if not already used as the card header
      if (c.title && c.title !== displayName) {
        fieldRow(s, 'Headline:', c.title, COLOR.text, accountName, auditTitle);
      }

      // Body (primary text excerpt)
      if (c.body) {
        const bodyExcerpt = c.body.length > 220 ? c.body.slice(0, 220) + '...' : c.body;
        fieldBlock(s, 'Primary text:', bodyExcerpt, accountName, auditTitle);
      }

      // CTA. Only show "missing CTA button" warning if the creative has a
      // resolvable link_url -- that confirms it's a clickable ad where a
      // CTA is required. For creatives where we couldn't detect anything,
      // it's more likely a data gap than a real config issue. Don't lie to
      // prospects.
      if (c.call_to_action_type) {
        fieldRow(s, 'Call to action:', c.call_to_action_type, COLOR.text, accountName, auditTitle);
      } else if (c.link_url) {
        fieldRow(
          s,
          'Call to action:',
          'NONE (missing CTA button)',
          COLOR.red,
          accountName,
          auditTitle
        );
      } else {
        fieldRow(
          s,
          'Call to action:',
          '(not returned by Meta API for this creative type)',
          COLOR.muted,
          accountName,
          auditTitle
        );
      }

      // Link URL
      if (c.link_url) {
        let pathDisplay = c.link_url;
        let isHomepage = false;
        try {
          const parsed = new URL(c.link_url);
          pathDisplay = parsed.hostname + parsed.pathname;
          const path = parsed.pathname.replace(/\/$/, '');
          isHomepage = path === '' || path === '/';
        } catch {
          // keep raw URL
        }
        if (pathDisplay.length > 90) pathDisplay = pathDisplay.slice(0, 87) + '...';
        fieldRow(s, 'Landing page:', pathDisplay, COLOR.text, accountName, auditTitle);

        if (isHomepage) {
          ensureSpace(s, 14, accountName, auditTitle);
          setText(s, COLOR.red);
          s.doc.setFont('helvetica', 'italic');
          s.doc.setFontSize(9);
          const flag = '! Landing page is the homepage -- not optimized for conversion.';
          const flagLines = s.doc.splitTextToSize(flag, CONTENT_WIDTH);
          flagLines.forEach((line: string) => {
            ensureSpace(s, 11, accountName, auditTitle);
            s.doc.text(line, MARGIN_X, s.y);
            s.y += 11;
          });
          s.doc.setFont('helvetica', 'normal');
        }
      }

      s.y += 4;
      ensureSpace(s, 8, accountName, auditTitle);
      setDraw(s, COLOR.border);
      s.doc.setLineWidth(0.3);
      s.doc.line(MARGIN_X, s.y - 4, PAGE_WIDTH - MARGIN_X, s.y - 4);
      s.y += 6;
    });

    if (data.creatives.length > 8) {
      muted(
        s,
        `Showing 8 of ${data.creatives.length} active creatives. Full review available on request.`,
        accountName,
        auditTitle
      );
    }
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
