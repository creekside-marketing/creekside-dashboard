import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const UPWORK_JOB_COLUMNS = [
  'id', 'application_date', 'week_number', 'job_name',
  'script_used', 'source_type', 'profile_used', 'platform', 'business_type',
  'connects_spent', 'competing_proposals', 'hours_after_post',
  'viewed', 'messaged', 'sales_call', 'won', 'client_name', 'upwork_url',
  'clickup_task_id',
].join(', ');

const UPWORK_LEAD_COLUMNS = [
  'clickup_task_id', 'lead_name', 'status', 'assignees',
  'lead_funnel_stage', 'upwork_proposal_url', 'how_found', 'date_last_contacted',
  'due_date', 'date_created', 'date_closed', 'ai_summary',
].join(', ');

const PAGE_SIZE = 1000;

async function fetchAllJobs(): Promise<{ data: any[]; error: any }> {
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase()
      .from('upwork_jobs')
      .select(UPWORK_JOB_COLUMNS)
      .order('application_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { data: [], error };
    if (!data || data.length === 0) break;

    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { data: allRows, error: null };
}

export async function GET() {
  try {
    const [jobsResult, leadsResult] = await Promise.all([
      fetchAllJobs(),
      supabase()
        .from('upwork_leads')
        .select(UPWORK_LEAD_COLUMNS)
        .order('date_created', { ascending: false })
        .limit(10000),
    ]);

    if (jobsResult.error) throw jobsResult.error;
    if (leadsResult.error) throw leadsResult.error;

    return NextResponse.json({
      upworkJobs: jobsResult.data ?? [],
      upworkLeads: leadsResult.data ?? [],
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch Upwork funnel data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
