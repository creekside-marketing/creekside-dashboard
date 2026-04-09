import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const clientId = searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('report_notes')
    .select('id, created_at, author, content, archived')
    .eq('client_id', clientId)
    .eq('archived', false)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { client_id, author, content } = body;
  if (!client_id || !content) return NextResponse.json({ error: 'client_id and content required' }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('report_notes')
    .insert({ client_id, author: author || 'Unknown', content })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, archived } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('report_notes')
    .update({ archived: archived ?? true })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
