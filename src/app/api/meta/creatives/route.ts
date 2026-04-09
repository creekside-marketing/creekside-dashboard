/**
 * GET /api/meta/creatives — Fetch ad creative thumbnails via PipeBoard.
 *
 * Accepts comma-separated ad_ids, calls bulk_get_ad_creatives, and returns
 * a map of ad_id → thumbnail URL for rendering in report tables.
 *
 * CANNOT: Modify ads or creatives — read-only endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { callPipeboard } from '@/lib/pipeboard';
import { unwrapPipeboardResponse } from '@/components/reports/ReportHeader';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const adIdsParam = searchParams.get('ad_ids');
    if (!adIdsParam || adIdsParam.trim() === '') {
      return NextResponse.json({ error: 'ad_ids parameter is required' }, { status: 400 });
    }

    const adIds = adIdsParam.split(',').map(id => id.trim()).filter(Boolean);
    if (adIds.length === 0) {
      return NextResponse.json({ data: {} });
    }

    // Cap at 50 to avoid oversized requests
    const capped = adIds.slice(0, 50);

    const rawResult = await callPipeboard('bulk_get_ad_creatives', {
      ad_ids: capped,
      limit: capped.length,
    });

    // Unwrap MCP content envelope if present (PipeBoard wraps responses)
    const result = (rawResult && typeof rawResult === 'object')
      ? unwrapPipeboardResponse(rawResult as Record<string, unknown>)
      : rawResult;

    // Build a map of ad_id → thumbnail URL
    const thumbnails: Record<string, string> = {};
    const results = result?.results ?? result?.data ?? [];
    if (Array.isArray(results)) {
      for (const item of results) {
        const adId = item.ad_id ?? item.id;
        if (!adId) continue;

        // Look for image URL in various possible locations in the creative response
        const creative = item.creative ?? item;
        const thumb =
          creative.thumbnail_url ??
          creative.image_url ??
          creative.object_story_spec?.link_data?.image_url ??
          creative.object_story_spec?.link_data?.picture ??
          creative.object_story_spec?.video_data?.image_url ??
          creative.image_crops?.['100x100'] ??
          null;

        if (thumb) thumbnails[String(adId)] = thumb;
      }
    }

    return NextResponse.json({ data: thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
