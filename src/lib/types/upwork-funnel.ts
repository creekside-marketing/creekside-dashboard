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
  viewed: boolean;
  messaged: boolean;
  sales_call: boolean;
  won: boolean;
  client_name: string | null;
}

export interface ClickUpLead {
  id: string;
  task_name: string;
  status: string | null;
  assignees: string | null;
  due_date: string | null;
  date_created: string;
  date_closed: string | null;
  ai_summary: string | null;
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

export interface ScriptPerformanceRow {
  scriptName: string;
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
  avgConnects: number;
}

export interface HoursAfterPostBucket {
  label: string;
  range: [number, number];
  count: number;
  viewRate: number;
  replyRate: number;
}

export interface BreakdownRow {
  name: string;
  count: number;
  viewRate: number;
  replyRate: number;
  callRate: number;
  winRate: number;
}

export interface UpworkFunnelApiResponse {
  upworkJobs: UpworkJob[];
  clickupLeads: ClickUpLead[];
  fetchedAt: string;
}
