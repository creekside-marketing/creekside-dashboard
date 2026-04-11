import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const ALLOWED_UPDATE_FIELDS = ['description', 'error_date'];

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const teamMemberId = request.nextUrl.searchParams.get('team_member_id');

    let query = supabase
      .from('team_member_errors')
      .select('id, team_member_id, description, error_date, created_at, updated_at')
      .order('error_date', { ascending: false });

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
    const { team_member_id, description, error_date } = body;

    if (!team_member_id || !description) {
      return NextResponse.json(
        { error: 'Missing required fields: team_member_id, description' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('team_member_errors')
      .insert({
        team_member_id,
        description,
        error_date: error_date ?? new Date().toISOString().split('T')[0],
      })
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

export async function PATCH(request: NextRequest) {
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

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('team_member_errors')
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

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { error } = await supabase
      .from('team_member_errors')
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
