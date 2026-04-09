import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const UPWORK_LEADS_FOLDER_ID = '90172601496';

const UPWORK_JOB_COLUMNS = [
  'id', 'application_date', 'week_number', 'job_name',
  'script_used', 'source_type', 'profile_used', 'platform', 'business_type',
  'connects_spent', 'competing_proposals', 'hours_after_post',
  'viewed', 'messaged', 'sales_call', 'won', 'client_name',
].join(', ');

const CLICKUP_LEAD_COLUMNS = [
  'clickup_task_id', 'task_name', 'status', 'assignees', 'due_date',
  'date_created', 'date_closed', 'ai_summary',
].join(', ');

export async function GET() {
  try {
    const [jobsResult, leadsResult] = await Promise.all([
      supabase()
        .from('upwork_jobs')
        .select(UPWORK_JOB_COLUMNS)
        .order('application_date', { ascending: false })
        .limit(10000),
      supabase()
        .from('clickup_entries')
        .select(CLICKUP_LEAD_COLUMNS)
        .eq('folder_id', UPWORK_LEADS_FOLDER_ID)
        .order('date_created', { ascending: false }),
    ]);

    if (jobsResult.error) throw jobsResult.error;
    if (leadsResult.error) throw leadsResult.error;

    return NextResponse.json({
      upworkJobs: jobsResult.data ?? [],
      clickupLeads: leadsResult.data ?? [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Upwork funnel data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
