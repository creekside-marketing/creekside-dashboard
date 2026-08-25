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
}

export interface SalesFunnelApiResponse {
  leads: RawSalesLead[];
  fetchedAt: string;
}

/* ── Normalized lead ── */

export type Outcome = 'open' | 'won' | 'lost_followup' | 'lost_dnd' | 'referred';
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
}

export interface LostBreakdown {
  total: number;
  reasons: LostReasonRow[];
}
