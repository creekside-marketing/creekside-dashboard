/* ── Raw data from /api/sales-funnel ── */

export interface RawSalesLead {
  id: string;
  clickup_task_id: string | null;
  lead_name: string | null;
  status: string | null;
  lead_funnel_stage: string | null;
  how_found: string | null;
  date_created: string | null;
  date_closed: string | null;
  date_last_contacted: string | null;
  salesman: string | null;
  appt_setter: string | null;
  referred_to: string | null;
  deal_value: string | null;
  mrr: number | null;
  qualified: string | null;
  business_name: string | null;
  salesman_inferred: string | null;
  mrr_inferred: number | null; // Square-billing-derived (median month), won leads missing the ClickUp MRR field
  loss_reason_inferred: string | null; // AI-classified from Upwork threads + ClickUp comments (backfill 2026-08-26)
  loss_reason_confidence: string | null; // high | medium | low
}

/** Row from upwork_lead_status_history (populated by the ClickUp sync + backfill). */
export interface RawStatusTransition {
  clickup_task_id: string;
  from_status: string | null;
  to_status: string;
  detected_at: string;
  source: string;
}

export interface SalesFunnelApiResponse {
  leads: RawSalesLead[];
  transitions: RawStatusTransition[];
  fetchedAt: string;
}

/* ── Normalized lead ── */

export type Outcome = 'open' | 'won' | 'nurture' | 'lost' | 'referred';
export type Salesperson = 'Peterson' | 'Cade' | 'Lindsey' | 'Unassigned';
export type Partner = 'Brad' | 'Scott' | 'Keith' | 'Other';

export interface NormalizedLead {
  raw: RawSalesLead;
  outcome: Outcome;
  salesperson: Salesperson;
  partner: Partner | null;
  stageIndex: number;
  wonValue: number | null; // mrr preferred, parsed deal_value fallback
}

/* ── Aggregates ── */

export interface FunnelStageRow {
  name: string;
  count: number;
  pctOfTotal: number;      // 0-100
  stepConversion: number;  // 0-100, vs previous stage
}

export type OutcomeSummary = Record<Outcome, number>;

export interface SalespersonRow {
  segment: Salesperson | 'Total';
  leads: number;
  callsBooked: number;
  callRate: number; // 0-100
  won: number;
  winRate: number;  // 0-100
  mrrWon: number;
  referred: number; // leads referred out to a partner
}

/* ── Leaks & Saves (from status transitions) ── */

export interface LeakStats {
  callBookedEntries: number; // transitions INTO a call-booked status
  noShows: number;           // call-booked → backward status
  noShowRate: number;        // 0-100, noShows / callBookedEntries
  nurtureEntries: number;    // transitions INTO nurture / lost (follow up)
  nurtureSaves: number;      // nurture → re-engaged (non-lost) status
  saveRate: number;          // 0-100, nurtureSaves / nurtureEntries
  trackingSince: string | null; // earliest detected_at (ISO) — null when no data
}

export interface ReferralData {
  total: number;
  byPartner: { partner: Partner; count: number }[];
  monthly: ({ month: string } & Record<Partner, number>)[];
  referredAndWon: number;
}

export interface LostReasonRow {
  key: string;
  label: string;
  count: number;
  nurture: number; // still in nurture (winback possible)
  lost: number;    // hard lost
}

export interface LostBreakdown {
  total: number;
  nurtureTotal: number;
  lostTotal: number;
  reasons: LostReasonRow[];
}
