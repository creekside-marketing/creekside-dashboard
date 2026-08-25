/*
 * Sales funnel engine — pure normalization + aggregation over upwork_leads
 * (ClickUp "Upwork Sales & Leads" board sync). All ClickUp-string messiness
 * is contained here; the page and any future consumers use these functions.
 *
 * Stage definitions source: agent_knowledge 6e2fefcc-c4fb-40f9-a651-aaf3fba40e94
 * ("Training Extraction: Sales Pipeline Management").
 */

import type {
  RawSalesLead, NormalizedLead, Outcome, Salesperson, Partner,
  FunnelStageRow, OutcomeSummary, SalespersonRow, ReferralData, LostBreakdown,
} from '@/lib/types/sales-funnel';

export const FUNNEL_STAGES = [
  'New Lead',
  'Pursuing',
  'In Discussion',
  'Call Requested',
  'Booking Link Sent',
  'Call Booked',
  'Contract Proposed',
] as const;

const CALL_BOOKED_INDEX = FUNNEL_STAGES.indexOf('Call Booked');
const CONTRACT_PROPOSED_INDEX = FUNNEL_STAGES.indexOf('Contract Proposed');

export const OUTCOME_LABELS: Record<Outcome, string> = {
  open: 'Open',
  won: 'Won',
  lost_followup: 'Lost (Follow Up)',
  lost_dnd: 'Lost (DND)',
  referred: 'Referred Out',
};

export const SALESPEOPLE: Salesperson[] = ['Peterson', 'Cade', 'Lindsey', 'Unassigned'];
export const PARTNERS: Partner[] = ['Brad', 'Scott', 'Keith', 'Other'];

/* ── Normalization primitives ── */

/** Lowercase + collapse whitespace (handles e.g. "follow up  pre-call"). */
export function cleanStatus(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Canonical outcome from ClickUp status only (mutually exclusive partition).
 * "referred to lindsey" is an internal reassignment, not a partner referral.
 * "send invoice & contract" is late-stage open; the win is recorded when the
 * status flips to "won".
 */
export function resolveOutcome(status: string | null): Outcome {
  const s = cleanStatus(status);
  if (s === 'won') return 'won';
  if (s.startsWith('lost (dnd')) return 'lost_dnd';
  if (s.startsWith('lost (follow')) return 'lost_followup';
  if (s.startsWith('referred to ') && s !== 'referred to lindsey') return 'referred';
  return 'open';
}

/**
 * Salesperson attribution. The salesman column is primary; Lindsey never
 * appears there, so her attribution is entirely status-derived and likely
 * undercounted (surface this as a footnote in the UI).
 */
export function resolveSalesperson(salesman: string | null, status: string | null): Salesperson {
  const col = (salesman ?? '').trim().toLowerCase();
  if (col === 'peterson') return 'Peterson';
  if (col === 'cade') return 'Cade';
  if (col === 'lindsey') return 'Lindsey';

  const s = cleanStatus(status);
  if (s === 'call booked pete') return 'Peterson';
  if (s === 'call booked cade') return 'Cade';
  if (s === 'call booked lindsey' || s === 'referred to lindsey') return 'Lindsey';

  return 'Unassigned';
}

function normalizePartnerName(name: string): Partner | null {
  const n = name.trim().toLowerCase();
  if (n === 'brad' || n === 'brady') return 'Brad';
  if (n === 'scott') return 'Scott';
  if (n === 'keith') return 'Keith';
  if (n === 'lindsey') return null;              // internal, not a partner
  if (n.length === 0 || n.includes('/') || n.includes('http')) return null; // junk / URLs
  return 'Other';                                 // e.g. Baran (legacy) — never silently dropped
}

/**
 * Partner referral flag — union of the status string and the referred_to
 * column, deduped per lead (status wins). Independent of outcome: a referred
 * lead can also later close as won.
 */
export function resolvePartner(status: string | null, referredTo: string | null): Partner | null {
  const s = cleanStatus(status);
  const fromStatus = s.startsWith('referred to ') ? normalizePartnerName(s.slice('referred to '.length)) : null;
  if (fromStatus) return fromStatus;
  if (referredTo) return normalizePartnerName(referredTo);
  return null;
}

/**
 * Furthest funnel stage reached. Null stage (42 legacy rows) counts as
 * "New Lead" — every lead reached that by definition. Won leads are floored
 * to Contract Proposed so the funnel stays monotonic.
 */
export function resolveStageIndex(leadFunnelStage: string | null, outcome: Outcome): number {
  let index = FUNNEL_STAGES.indexOf((leadFunnelStage ?? '') as typeof FUNNEL_STAGES[number]);
  if (index < 0) index = 0;
  if (outcome === 'won') index = Math.max(index, CONTRACT_PROPOSED_INDEX);
  return index;
}

/** Parse "$1,500/mo"-style text into a number. Never returns NaN. */
export function parseDealValue(text: string | null): number | null {
  if (!text) return null;
  const match = text.replace(/[$,]/g, '').match(/\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/* ── Normalize + filter ── */

export function normalizeLeads(raw: RawSalesLead[]): NormalizedLead[] {
  return raw.map((lead) => {
    const outcome = resolveOutcome(lead.status);
    return {
      raw: lead,
      outcome,
      salesperson: resolveSalesperson(lead.salesman, lead.status),
      partner: resolvePartner(lead.status, lead.referred_to),
      stageIndex: resolveStageIndex(lead.lead_funnel_stage, outcome),
      wonValue: lead.mrr ?? parseDealValue(lead.deal_value),
    };
  });
}

export function filterByDateRange(
  leads: NormalizedLead[],
  range: { start: string | null; end: string | null },
): NormalizedLead[] {
  if (!range.start && !range.end) return leads;
  return leads.filter((l) => {
    const d = l.raw.date_created?.slice(0, 10);
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });
}

/* ── Aggregations ── */

/**
 * Cumulative reached-stage funnel: bar N = leads whose furthest stage is >= N,
 * so bar 0 always equals total leads. A final "Won" bar is appended from
 * outcome counts.
 */
export function computeFunnel(leads: NormalizedLead[]): FunnelStageRow[] {
  const total = leads.length;
  const rows: FunnelStageRow[] = FUNNEL_STAGES.map((name, i) => {
    const count = leads.filter((l) => l.stageIndex >= i).length;
    return { name, count, pctOfTotal: 0, stepConversion: 0 };
  });
  rows.push({
    name: 'Won',
    count: leads.filter((l) => l.outcome === 'won').length,
    pctOfTotal: 0,
    stepConversion: 0,
  });
  return rows.map((row, i) => ({
    ...row,
    pctOfTotal: total > 0 ? (row.count / total) * 100 : 0,
    stepConversion: i === 0 ? 100 : rows[i - 1].count > 0 ? (row.count / rows[i - 1].count) * 100 : 0,
  }));
}

export function computeOutcomeSummary(leads: NormalizedLead[]): OutcomeSummary {
  const summary: OutcomeSummary = { open: 0, won: 0, lost_followup: 0, lost_dnd: 0, referred: 0 };
  for (const l of leads) summary[l.outcome] += 1;
  return summary;
}

export function computeBySalesperson(leads: NormalizedLead[]): SalespersonRow[] {
  const segmentRow = (segment: SalespersonRow['segment'], segLeads: NormalizedLead[]): SalespersonRow => {
    const callsBooked = segLeads.filter((l) => l.stageIndex >= CALL_BOOKED_INDEX).length;
    const won = segLeads.filter((l) => l.outcome === 'won');
    return {
      segment,
      leads: segLeads.length,
      callsBooked,
      callRate: segLeads.length > 0 ? (callsBooked / segLeads.length) * 100 : 0,
      won: won.length,
      winRate: segLeads.length > 0 ? (won.length / segLeads.length) * 100 : 0,
      mrrWon: won.reduce((sum, l) => sum + (l.wonValue ?? 0), 0),
    };
  };

  const rows = SALESPEOPLE.map((sp) => segmentRow(sp, leads.filter((l) => l.salesperson === sp)));
  rows.push(segmentRow('Total', leads));
  return rows;
}

export function computeReferrals(leads: NormalizedLead[]): ReferralData {
  const referred = leads.filter((l) => l.partner !== null);

  const byPartner = PARTNERS
    .map((partner) => ({ partner, count: referred.filter((l) => l.partner === partner).length }))
    .filter((row) => row.count > 0);

  // Bucketed by lead-created month (only reliable date available); noted in UI.
  const monthMap = new Map<string, Record<Partner, number>>();
  for (const l of referred) {
    const month = l.raw.date_created?.slice(0, 7);
    if (!month || !l.partner) continue;
    if (!monthMap.has(month)) monthMap.set(month, { Brad: 0, Scott: 0, Keith: 0, Other: 0 });
    monthMap.get(month)![l.partner] += 1;
  }
  const monthly = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({ month, ...counts }));

  return {
    total: referred.length,
    byPartner,
    monthly,
    referredAndWon: referred.filter((l) => l.outcome === 'won').length,
  };
}

/**
 * Lost-deal breakdown. The reasons[] array shape is the scaffold for
 * structured loss reasons: when ClickUp gains a loss-reason field, only this
 * function changes — the UI renders whatever reasons come back.
 */
export function computeLostBreakdown(leads: NormalizedLead[]): LostBreakdown {
  const lostFollowup = leads.filter((l) => l.outcome === 'lost_followup').length;
  const lostDnd = leads.filter((l) => l.outcome === 'lost_dnd').length;
  return {
    total: lostFollowup + lostDnd,
    reasons: [
      { key: 'lost_followup', label: 'Lost — Follow Up (went quiet, still contactable)', count: lostFollowup },
      { key: 'lost_dnd', label: 'Lost — Do Not Disturb (asked us to stop)', count: lostDnd },
    ],
  };
}
