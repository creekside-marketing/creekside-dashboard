// Required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/utils/rate-limiter';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const { allowed, retryAfter } = checkRateLimit(ip, 'leads');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { email, name, businessName, phone, industry, businessType, inputs, resultsSummary } = body;

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Insert lead
    const { data: lead, error: leadError } = await supabase
      .from('roas_leads')
      .insert({
        email,
        name: name || null,
        business_name: businessName || null,
        phone: phone || null,
        industry: industry || null,
        business_type: businessType || null,
      })
      .select('id')
      .single();

    if (leadError) {
      console.error('Lead insert error:', leadError);
      return NextResponse.json(
        { error: 'Failed to save lead' },
        { status: 500 }
      );
    }

    // Insert calculation record
    const { error: calcError } = await supabase
      .from('roas_calculations')
      .insert({
        roas_lead_id: lead.id,
        inputs: inputs || null,
        results_summary: resultsSummary || null,
      });

    if (calcError) {
      console.error('Calculation insert error:', calcError);
      // Lead was saved, so still return success
    }

    return NextResponse.json({ success: true, leadId: lead.id });
  } catch (error) {
    console.error('Leads API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
