import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// description / ai_summary intentionally excluded (large text, unused by the Sales tab)
const SALES_LEAD_COLUMNS = [
  'id', 'clickup_task_id', 'lead_name', 'status', 'lead_funnel_stage',
  'how_found', 'date_created', 'date_closed', 'date_last_contacted',
  'salesman', 'appt_setter', 'referred_to', 'deal_value', 'mrr',
  'qualified', 'business_name', 'salesman_inferred',
].join(', ');

const TRANSITION_COLUMNS = 'clickup_task_id, from_status, to_status, detected_at, source';

const PAGE_SIZE = 1000;

async function fetchAll(
  table: string,
  columns: string,
  orderColumn: string,
): Promise<{ data: any[]; error: any }> {
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase()
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: false })
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
    const [leads, transitions] = await Promise.all([
      fetchAll('upwork_leads', SALES_LEAD_COLUMNS, 'date_created'),
      fetchAll('upwork_lead_status_history', TRANSITION_COLUMNS, 'detected_at'),
    ]);
    if (leads.error) throw leads.error;
    if (transitions.error) throw transitions.error;

    return NextResponse.json({
      leads: leads.data,
      transitions: transitions.data,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch sales funnel data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
