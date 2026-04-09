import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const account_id = searchParams.get('account_id');
    if (!account_id || account_id === 'null' || account_id === 'undefined' || account_id.trim() === '') {
      return NextResponse.json(
        { error: 'Invalid ad account ID' },
        { status: 400 }
      );
    }

    const time_range = searchParams.get('time_range') || 'last_30d';
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const level = searchParams.get('level') || 'account';

    // Validate date inputs
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const hasValidDates = since && until && datePattern.test(since) && datePattern.test(until);

    // Map breakdown levels to PipeBoard params
    const breakdownLevels: Record<string, { pipeboardLevel: string; breakdowns: string }> = {
      age: { pipeboardLevel: 'account', breakdowns: 'age' },
      gender: { pipeboardLevel: 'account', breakdowns: 'gender' },
      placement: { pipeboardLevel: 'account', breakdowns: 'publisher_platform,platform_position' },
    };

    const breakdownConfig = breakdownLevels[level];
    const time_breakdown = searchParams.get('time_breakdown');

    // Build PipeBoard args — explicit date range overrides preset time_range
    const pipeboardArgs: Record<string, unknown> = {
      object_id: account_id,
      level: breakdownConfig?.pipeboardLevel ?? level,
    };

    if (time_breakdown) {
      pipeboardArgs.time_breakdown = time_breakdown;
    }

    if (breakdownConfig) {
      pipeboardArgs.breakdowns = breakdownConfig.breakdowns;
    }

    if (hasValidDates) {
      pipeboardArgs.time_range = { since, until };
    } else if (since || until) {
      // One date provided but invalid — ignore and use preset
      pipeboardArgs.time_range = time_range;
    } else {
      pipeboardArgs.time_range = time_range;
    }

    try {
      const result = await callPipeboard('get_insights', pipeboardArgs);
      return NextResponse.json(result);
    } catch (pipeboardError) {
      // PipeBoard failed — fall back to cached data in meta_insights_daily
      const supabase = createServiceClient();
      const { data: cachedData, error: dbError } = await supabase
        .from('meta_insights_daily')
        .select('*')
        .eq('account_id', account_id)
        .order('date', { ascending: false });

      if (dbError || !cachedData || cachedData.length === 0) {
        // Both PipeBoard and DB fallback failed — return the original error
        const message = pipeboardError instanceof Error ? pipeboardError.message : 'Unknown error';
        const status = message.includes('not configured') ? 500 : 502;
        return NextResponse.json({ error: message }, { status });
      }

      return NextResponse.json({ data: cachedData, source: 'cache' });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('not configured') ? 500 : 502;

    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
