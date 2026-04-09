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

    // Try multiple unwrap strategies — PipeBoard response shape varies
    let parsed = rawResult;

    // Strategy 1: unwrap MCP content envelope { content: [{ text: "..." }] }
    if (parsed && typeof parsed === 'object') {
      parsed = unwrapPipeboardResponse(parsed as Record<string, unknown>);
    }

    // Strategy 2: if still wrapped in structuredContent.result string
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).result === 'string') {
      try { parsed = JSON.parse((parsed as Record<string, unknown>).result as string); } catch { /* keep current */ }
    }

    // Log shape for debugging (visible in Railway logs)
    const topKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed as object).slice(0, 10) : [];
    console.log('[creatives] rawResult type:', typeof rawResult, '| parsed keys:', topKeys);

    // Build a map of ad_id → { thumbnail, imageUrl }
    const thumbnails: Record<string, { thumbnail: string | null; imageUrl: string | null }> = {};

    // Try .results (bulk_get_ad_creatives format) or .data (standard format)
    const p = parsed as Record<string, unknown>;
    const resultsList = p?.results ?? p?.data ?? [];
    const items = Array.isArray(resultsList) ? resultsList : [];

    console.log('[creatives] items count:', items.length, '| first item keys:', items[0] ? Object.keys(items[0]).slice(0, 10) : 'none');

    for (const item of items) {
      const adId = item.ad_id ?? item.id;
      if (!adId) continue;

      const creative = item.creative ?? item;
      const thumb =
        creative.thumbnail_url ??
        creative.image_url ??
        creative.object_story_spec?.link_data?.image_url ??
        creative.object_story_spec?.link_data?.picture ??
        creative.object_story_spec?.video_data?.image_url ??
        null;

      // Also grab the full-size image URL separately for hyperlinks
      const imageUrl =
        creative.image_url ??
        creative.object_story_spec?.link_data?.image_url ??
        creative.thumbnail_url ??
        null;

      thumbnails[String(adId)] = { thumbnail: thumb, imageUrl };
    }

    return NextResponse.json({ data: thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
