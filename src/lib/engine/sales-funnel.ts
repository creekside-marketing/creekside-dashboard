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
  RawStatusTransition, LeakStats,
} from '@/lib/types/sales-funnel';

/**
 * Stage order mirrors the ClickUp status workflow: Pursuing is a POST-call
 * stage (white-label/deal pursuit after the call), per Peterson 2026-08-24.
 * Values still match the "Lead Funnel Tracker" dropdown for exact matching.
 */
export const FUNNEL_STAGES = [
  'New Lead',
  'In Discussion',
  'Call Requested',
  'Booking Link Sent',
  'Call Booked',
  'Pursuing',
  'Contract Proposed',
] as const;

/** Display names where the tracker value reads poorly. */
export const STAGE_LABELS: Record<string, string> = {
  'Contract Proposed': 'Invoice & Contract',
};

const CALL_BOOKED_INDEX = FUNNEL_STAGES.indexOf('Call Booked');
const PURSUING_INDEX = FUNNEL_STAGES.indexOf('Pursuing');
const CONTRACT_PROPOSED_INDEX = FUNNEL_STAGES.indexOf('Contract Proposed');

export const OUTCOME_LABELS: Record<Outcome, string> = {
  open: 'Open',
  won: 'Won',
  nurture: 'Nurture',
  lost: 'Lost',
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
 * Status vocabulary changed 2026-08: "lost (follow up)" → "nurture",
 * "lost (dnd)" → "lost"; both legacy and current forms map to the same bucket.
 * "referred to lindsey" is an internal reassignment, not a partner referral.
 * "send invoice & contract" is late-stage open; the win is recorded when the
 * status flips to "won".
 */
export function resolveOutcome(status: string | null): Outcome {
  const s = cleanStatus(status);
  if (s === 'won') return 'won';
  if (s === 'lost' || s.startsWith('lost (dnd')) return 'lost';
  if (s === 'nurture' || s.startsWith('lost (follow')) return 'nurture';
  if (s.startsWith('referred to ') && s !== 'referred to lindsey') return 'referred';
  return 'open';
}

/**
 * Salesperson attribution. The salesman column is primary, then
 * salesman_inferred (convo/assignee-derived, see infer script), then status.
 * Lindsey rarely appears in the column, so her attribution leans on the
 * fallbacks and is likely undercounted (surface this as a footnote in the UI).
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
 * "New Lead" — every lead reached that by definition. The current status
 * floors the stage when the tracker field wasn't advanced: post-call
 * statuses imply Call Booked, "pursuing" implies Pursuing, "send invoice &
 * contract" and won imply Invoice & Contract. Keeps the funnel monotonic.
 */
export function resolveStageIndex(leadFunnelStage: string | null, status: string | null, outcome: Outcome): number {
  let index = FUNNEL_STAGES.indexOf((leadFunnelStage ?? '') as typeof FUNNEL_STAGES[number]);
  if (index < 0) index = 0;

  const s = cleanStatus(status);
  if (s.startsWith('call booked') || s === 'follow up post-call') index = Math.max(index, CALL_BOOKED_INDEX);
  if (s === 'pursuing') index = Math.max(index, PURSUING_INDEX);
  if (s === 'send invoice & contract' || outcome === 'won') index = Math.max(index, CONTRACT_PROPOSED_INDEX);
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
      salesperson: resolveSalesperson(lead.salesman ?? lead.salesman_inferred, lead.status),
      partner: resolvePartner(lead.status, lead.referred_to),
      stageIndex: resolveStageIndex(lead.lead_funnel_stage, lead.status, outcome),
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
  const summary: OutcomeSummary = { open: 0, won: 0, nurture: 0, lost: 0, referred: 0 };
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
      referred: segLeads.filter((l) => l.partner !== null).length,
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
  const nurture = leads.filter((l) => l.outcome === 'nurture').length;
  const lost = leads.filter((l) => l.outcome === 'lost').length;
  return {
    total: nurture + lost,
    reasons: [
      { key: 'nurture', label: 'Nurture (went quiet — weekly/monthly touches to win back)', count: nurture },
      { key: 'lost', label: 'Lost (asked us to stop, or outright dead)', count: lost },
    ],
  };
}

/* ── Leaks & Saves (status-transition history) ── */

const NO_SHOW_DESTINATIONS = new Set([
  'follow up pre-call', 'in discussion', 'call requested', 'new lead',
  // Legacy board statuses (pre-2026 vocabulary, present in backfilled history)
  'follow-up', 'follow up - pre-call', 'follow up 1', 'follow up 2', 'follow up 3',
]);
const NURTURE_STATUSES = new Set(['nurture', 'lost (follow up)']);
const LOST_STATUSES = new Set(['lost', 'lost (dnd)']);

export function filterTransitionsByDateRange(
  transitions: RawStatusTransition[],
  range: { start: string | null; end: string | null },
): RawStatusTransition[] {
  if (!range.start && !range.end) return transitions;
  return transitions.filter((t) => {
    const d = t.detected_at?.slice(0, 10);
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });
}

/**
 * No-show: a lead moves from a call-booked status BACKWARD (follow up
 * pre-call, in discussion, call requested, new lead) — Peterson's definition.
 * Nurture save: a lead leaves nurture (or legacy lost (follow up)) for any
 * non-lost status, i.e. we re-engaged them.
 */
export function computeLeaks(transitions: RawStatusTransition[]): LeakStats {
  let callBookedEntries = 0;
  let noShows = 0;
  let nurtureEntries = 0;
  let nurtureSaves = 0;
  let trackingSince: string | null = null;

  for (const t of transitions) {
    const from = cleanStatus(t.from_status);
    const to = cleanStatus(t.to_status);

    if (!trackingSince || t.detected_at < trackingSince) trackingSince = t.detected_at;

    if (to.startsWith('call booked')) callBookedEntries += 1;
    if (from.startsWith('call booked') && NO_SHOW_DESTINATIONS.has(to)) noShows += 1;

    if (NURTURE_STATUSES.has(to)) nurtureEntries += 1;
    if (NURTURE_STATUSES.has(from) && !NURTURE_STATUSES.has(to) && !LOST_STATUSES.has(to)) nurtureSaves += 1;
  }

  return {
    callBookedEntries,
    noShows,
    noShowRate: callBookedEntries > 0 ? (noShows / callBookedEntries) * 100 : 0,
    nurtureEntries,
    nurtureSaves,
    saveRate: nurtureEntries > 0 ? (nurtureSaves / nurtureEntries) * 100 : 0,
    trackingSince,
  };
}
