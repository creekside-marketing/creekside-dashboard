// Creekside Dashboard — Client API
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const ALLOWED_UPDATE_FIELDS = [
  'client_name',
  'monthly_budget',
  'monthly_revenue',
  'goals',
  'notes',
  'priority',
  'account_manager',
  'platform_operator',
  'status',
  'ad_account_id',
  'churned_date',
  'churn_reason',
  'report_token',
  'client_type',
  'client_report_notes',
  'fee_config',
  'revenue_override',
  'goal_type',
  'goal_target',
  'client_category',
];

// Fields that should be tracked in manual_overrides when changed by a user
const MANUAL_OVERRIDE_FIELDS = new Set([
  'monthly_budget',
  'monthly_revenue',
  'goals',
  'priority',
  'account_manager',
  'platform_operator',
  'status',
  'ad_account_id',
  'churned_date',
  'churn_reason',
  'revenue_override',
]);

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch reporting_clients and contact names in parallel
    const [rcResult, contactsResult] = await Promise.all([
      supabase
        .from('reporting_clients')
        .select('*')
        .order('priority', { ascending: true })
        .order('client_name', { ascending: true }),
      supabase
        .from('clients')
        .select('id, name, primary_contact_name')
        .eq('status', 'active'),
    ]);

    const { data, error } = rcResult;
    const contactMap = new Map<string, string>();
    for (const c of contactsResult.data ?? []) {
      if (c.primary_contact_name) {
        contactMap.set(c.id, c.primary_contact_name);
        contactMap.set(c.name, c.primary_contact_name);
      }
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Re-sort so priority order is high > medium > low
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = (data ?? []).sort((a, b) => {
      const pa = priorityOrder[a.priority?.toLowerCase() ?? 'low'] ?? 3;
      const pb = priorityOrder[b.priority?.toLowerCase() ?? 'low'] ?? 3;
      if (pa !== pb) return pa - pb;
      return (a.client_name ?? '').localeCompare(b.client_name ?? '');
    });

    // Attach contact names
    const enriched = sorted.map((row) => ({
      ...row,
      contact_name: (row.client_id && contactMap.get(row.client_id))
        || contactMap.get(row.client_name)
        || null,
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

const ALLOWED_CREATE_FIELDS = [
  'client_name',
  'platform',
  'monthly_budget',
  'monthly_revenue',
  'goals',
  'notes',
  'priority',
  'account_manager',
  'platform_operator',
  'status',
  'client_id',
  'client_type',
];

export async function POST(request: NextRequest) {
  const authCookie = request.cookies.get('cm_auth')?.value;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
  if (!sessionSecret || authCookie !== sessionSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.client_name || !body.platform) {
      return NextResponse.json({ error: 'client_name and platform are required' }, { status: 400 });
    }

    const insertData: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (ALLOWED_CREATE_FIELDS.includes(key)) {
        insertData[key] = body[key];
      }
    }

    if (!insertData.status) insertData.status = 'active';

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('reporting_clients')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  // Auth check — only internal dashboard users can write
  const authCookie = request.cookies.get('cm_auth')?.value;
  const sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
  if (!sessionSecret || authCookie !== sessionSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // Filter to only allowed fields
    const updateData: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
      if (ALLOWED_UPDATE_FIELDS.includes(key)) {
        updateData[key] = fields[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Auto-set churned_date when status changes to churned (if not already provided)
    if (updateData.status === 'churned' && !updateData.churned_date) {
      updateData.churned_date = new Date().toISOString().split('T')[0];
    }
    // Clear churned fields only when explicitly reactivating to active
    if (updateData.status === 'active') {
      updateData.churned_date = null;
      updateData.churn_reason = null;
    }

    const supabase = createServiceClient();

    // Track manual overrides for fields that aren't just 'notes'
    const manualFields = Object.keys(updateData).filter(k => MANUAL_OVERRIDE_FIELDS.has(k));
    if (manualFields.length > 0) {
      const { data: current } = await supabase
        .from('reporting_clients')
        .select('manual_overrides')
        .eq('id', id)
        .single();

      const existing = (current?.manual_overrides ?? []) as string[];
      const merged = [...new Set([...existing, ...manualFields])];
      updateData.manual_overrides = merged;
    }

    const { data, error } = await supabase
      .from('reporting_clients')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
