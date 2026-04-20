/**
 * Shared types for all report components (default and custom).
 *
 * CANNOT: Import from any report component — this is a leaf dependency.
 */

export interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  monthly_budget: number | null;
  client_report_notes: string | null;
  client_type: string | null;
  report_token: string;
  report_mode?: string;
  custom_report_slug?: string;
}

export interface ReportProps {
  client: ReportingClient;
  mode: 'internal' | 'public';
}
