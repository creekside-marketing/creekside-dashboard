/* ── Raw data from API ── */

export interface UpworkJob {
  id: string;
  application_date: string | null;
  week_number: number | null;
  job_name: string | null;
  script_used: string | null;
  source_type: string | null;
  profile_used: string | null;
  platform: string | null;
  business_type: string | null;
  connects_spent: number | null;
  competing_proposals: number | null;
  hours_after_post: number | null;
  viewed: boolean | null;
  messaged: boolean | null;
  sales_call: boolean | null;
  won: boolean | null;
  client_name: string | null;
  upwork_url: string | null;
  clickup_task_id: string | null;
  boosted: boolean | null;
  boost_spend: number | null;
  client_max_rate: string | null;
}

export interface UpworkLead {
  clickup_task_id: string;
  lead_name: string;
  status: string | null;
  assignees: string | null;
  lead_funnel_stage: string | null;
  upwork_proposal_url: string | null;
  how_found: string | null;
  date_last_contacted: string | null;
  due_date: string | null;
  date_created: string;
  date_closed: string | null;
  ai_summary: string | null;
  salesman: string | null;
}

/* ── Filter state ── */

export interface UpworkFunnelFilters {
  dateRange: { start: string | null; end: string | null };
  scriptUsed: string[];
  sourceType: string[];
  businessType: string[];
  profileUsed: string[];
  platform: string[];
}

/* ── Derived metrics ── */

export interface FunnelMetrics {
  totalApplications: number;
  totalViewed: number;
  totalMessaged: number;
  totalSalesCalls: number;
  totalWon: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  callToCloseRate: number;
  totalConnectsSpent: number;
  avgConnectsPerApp: number;
  connectsPerCall: number;
  connectsPerWin: number;
  avgCompetingProposals: number;
  avgHoursAfterPost: number;
}

export interface MonthlyDataPoint {
  month: string;
  applications: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  avgCompetingProposals: number;
  avgHoursAfterPost: number;
}

export type TrendGranularity = 'monthly' | 'weekly' | 'daily';

export interface TrendDataPoint {
  label: string;
  applications: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  viewToReply: number;
  replyToCall: number;
  callToWin: number;
  replyToWin: number;
}

export interface ScriptPerformanceRow {
  scriptName: string;
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  avgConnects: number;
}

export interface ScriptMonthCell {
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
}

export interface ScriptMonthlyComparison {
  months: string[];
  scripts: string[];
  data: Map<string, Map<string, ScriptMonthCell>>; // month -> script -> cell
}

export interface HoursAfterPostBucket {
  label: string;
  range: [number, number];
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
}

export interface BreakdownRow {
  name: string;
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
}

export interface WeeklyDataPoint {
  weekOf: string;        // ISO date of Monday
  weekLabel: string;     // e.g. "8/4/25"
  applied: number;
  viewed: number;
  messaged: number;
  salesCalls: number;
  won: number;
  viewRate: number;          // viewed / applied * 100
  viewsToReplies: number;   // messaged / viewed * 100
  repliesToCalls: number;   // salesCalls / messaged * 100
  callsToClients: number;   // won / salesCalls * 100
}

export interface RateBreakdownRow {
  bucket: string;
  apps: number;
  views: number;
  viewRate: number;
  replies: number;
  replyRate: number;
  calls: number;
  callRate: number;
  won: number;
  winRate: number;
}

export interface BoostComparisonMetrics {
  label: string;
  applications: number;
  views: number;
  replies: number;
  calls: number;
  won: number;
  totalConnects: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  costPerView: number;
  costPerReply: number;
  costPerCall: number;
  costPerWin: number;
}

export interface UpworkFunnelApiResponse {
  upworkJobs: UpworkJob[];
  upworkLeads: UpworkLead[];
  fetchedAt: string;
}
