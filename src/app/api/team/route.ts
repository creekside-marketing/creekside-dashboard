import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// Founders go by first name only; everyone else is First + Last Initial
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'Kenneth Cade MacLean': 'Cade',
  'Peterson Rainey': 'Peterson',
};

function toShortName(fullName: string): string {
  if (DISPLAY_NAME_OVERRIDES[fullName]) return DISPLAY_NAME_OVERRIDES[fullName];
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('team_members')
      .select('id, name, role')
      .eq('status', 'active')
      .order('name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const enriched = (data ?? []).map(m => ({
      ...m,
      short_name: toShortName(m.name),
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
