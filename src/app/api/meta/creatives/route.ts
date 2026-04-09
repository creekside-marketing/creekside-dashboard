/**
 * GET /api/meta/creatives — Fetch ad creatives with thumbnail URLs.
 *
 * Returns ads with their creative thumbnail_url and image_url fields
 * for rendering ad creative previews in report tables.
 *
 * CANNOT: Modify ads or creatives — read-only endpoint.
 * CANNOT: Operate without a valid ad account ID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const account_id = searchParams.get('account_id');
    if (!account_id || account_id === 'null' || account_id === 'undefined' || account_id.trim() === '') {
      return NextResponse.json({ error: 'Invalid ad account ID' }, { status: 400 });
    }

    const result = await callPipeboard('get_ads', {
      object_id: account_id,
      fields: 'id,name,creative{id,thumbnail_url,effective_object_story_id,image_url,object_story_spec}',
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
