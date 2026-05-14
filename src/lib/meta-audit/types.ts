// Type definitions for the meta-audit-agent dashboard integration.
// Mirrors the workflow defined in .claude/agents/meta-audit-agent.md in
// the creekside-agent-system repo. When the agent's checklist changes,
// update this file + checklist.ts to match.

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Result = 'PASS' | 'FAIL' | 'N_A' | 'DATA_GAP';

export interface ChecklistItem {
  id: string;
  section: string;
  question: string;
  severity: Severity;
  easySell: boolean;
  result: Result;
  evidence: string;
  recommendation?: string;
}

export interface SectionScore {
  section: string;
  total: number;
  pass: number;
  fail: number;
  na: number;
  gap: number;
  scorePct: number;
}

export interface AccountSummary {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  amount_spent: string;
  currency: string;
  business_country_code?: string;
  business_city?: string;
}

export interface InsightsTotals {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  objective: string;
  buying_type: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  special_ad_categories?: string[];
}

export interface AdSetSummary {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  daily_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  targeting: {
    age_min?: number;
    age_max?: number;
    geo_locations?: { countries?: string[] };
    locales?: number[];
    custom_audiences?: { id: string; name: string }[];
    excluded_custom_audiences?: { id: string; name: string }[];
    targeting_automation?: { advantage_audience?: number };
    publisher_platforms?: string[];
    facebook_positions?: string[];
    instagram_positions?: string[];
    audience_network_positions?: string[];
    messenger_positions?: string[];
  };
  attribution_spec?: { event_type: string; window_days: number }[];
  promoted_object?: { pixel_id?: string; custom_event_type?: string };
}

export interface AdSummary {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: string;
  effective_status: string;
  creative?: { id: string };
  created_time: string;
}

export interface CreativeSummary {
  id: string;
  name?: string;
  status?: string;
  title?: string;
  body?: string;
  // Top-level CTA + image. Meta also stores these in nested locations
  // depending on creative type (link ad, video, carousel, Advantage+).
  // The data puller normalizes nested locations into these fields so
  // downstream code (PDF generator, checklist) reads one canonical value.
  call_to_action_type?: string;
  description?: string;
  image_url?: string;
  thumbnail_url?: string;
  video_id?: string;
  object_type?: string;
  link_url?: string;
  // Nested locations Meta may populate instead of (or in addition to)
  // the top-level fields above. Captured so the normalizer can resolve.
  object_story_spec?: {
    link_data?: {
      call_to_action?: { type?: string; value?: { link?: string } };
      image_url?: string;
      picture?: string;
      link?: string;
      name?: string;
      description?: string;
      message?: string;
      child_attachments?: Array<{
        call_to_action?: { type?: string };
        image_url?: string;
        picture?: string;
        link?: string;
        name?: string;
        description?: string;
      }>;
    };
    video_data?: {
      call_to_action?: { type?: string };
      image_url?: string;
      video_id?: string;
      title?: string;
      message?: string;
      description?: string;
    };
  };
  asset_feed_spec?: {
    bodies?: { text: string }[];
    titles?: { text: string }[];
    descriptions?: { text: string }[];
    images?: Array<{ url?: string; hash?: string }>;
    videos?: Array<{ thumbnail_url?: string; video_id?: string }>;
    call_to_action_types?: string[];
  };
  degrees_of_freedom_spec?: {
    creative_features_spec?: Record<string, { enroll_status?: string }>;
  };
  url_tags?: string;
}

export interface PixelSummary {
  id: string;
  name: string;
  creation_time: string;
  last_fired_time: string;
  is_unavailable: boolean;
}

export interface AudienceSummary {
  id: string;
  name: string;
  subtype: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
  retention_days?: number;
  is_value_based?: boolean;
  customer_file_source?: string;
  delivery_status?: { code?: number; description?: string };
}

export interface AuditDataBundle {
  account: AccountSummary;
  campaigns: CampaignSummary[];
  adsets: AdSetSummary[];
  ads: AdSummary[];
  creatives: CreativeSummary[];
  pixels: PixelSummary[];
  audiences: AudienceSummary[];
  insights30dAccount: InsightsTotals | null;
  insightsByCampaign: Array<InsightsTotals & { campaign_id: string; campaign_name: string }>;
  insightsByAd7d: Array<InsightsTotals & { ad_id: string; ad_name: string; campaign_id: string; adset_id: string }>;
  pulledAt: string;
}

export interface AuditFindings {
  items: ChecklistItem[];
  sectionScores: SectionScore[];
  overallScore: number;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  easySellFails: ChecklistItem[];
  criticalFails: ChecklistItem[];
  highFails: ChecklistItem[];
  topWinningAd?: { name: string; cpa: number; purchases: number; spend: number };
  budgetLeakAd?: { name: string; spend: number; purchases: number };
}

export interface AuditOutput {
  account: AccountSummary;
  findings: AuditFindings;
  data: AuditDataBundle;
  narrative: {
    executiveSummary: string;
    auditPosture: string;
    findingNarratives: Array<{ id: string; title: string; whatWeFound: string; whyItMatters: string; theFix: string }>;
    phase1: string;
    phase2: string;
    phase3: string;
  };
  generatedAt: string;
}
