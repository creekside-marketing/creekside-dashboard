import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

const ALLOWED_UPDATE_FIELDS = [
  'hourly_rate',
  'notes',
  'role',
  'employment_type',
  'status',
  'specialties',
  'estimated_hours_per_month',
];

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('team_members')
      .select('id, name, role, employment_type, hourly_rate, status, notes, specialties, prework_spreadsheet_id, estimated_hours_per_month')
      .order('name', { ascending: true });

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
      .from('team_members')
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
