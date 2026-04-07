import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const ALLOWED_UPDATE_FIELDS = [
  'achieved',
  'goal_target',
  'bonus_amount',
  'notes',
  'goal_metric',
  'platform',
  'team_member_id',
  'client_name',
  'month',
];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientName = searchParams.get('client_name');
    const teamMemberId = searchParams.get('team_member_id');
    const month = searchParams.get('month') || getCurrentMonth();

    const supabase = createServiceClient();

    let query = supabase
      .from('contractor_client_goals')
      .select('*, team_members(name)')
      .eq('month', month)
      .order('created_at', { ascending: false });

    if (clientName) {
      query = query.eq('client_name', clientName);
    }

    if (teamMemberId) {
      query = query.eq('team_member_id', teamMemberId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { team_member_id, client_name, platform, goal_metric, goal_target, bonus_amount, month } = body;

    if (!team_member_id || !client_name || !goal_metric || goal_target == null) {
      return NextResponse.json(
        { error: 'Missing required fields: team_member_id, client_name, goal_metric, goal_target' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('contractor_client_goals')
      .insert({
        team_member_id,
        client_name,
        platform: platform || null,
        goal_metric,
        goal_target,
        bonus_amount: bonus_amount || 0,
        month: month || getCurrentMonth(),
        achieved: false,
      })
      .select('*, team_members(name)')
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

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

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('contractor_client_goals')
      .update(updateData)
      .eq('id', id)
      .select('*, team_members(name)')
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

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('contractor_client_goals')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
