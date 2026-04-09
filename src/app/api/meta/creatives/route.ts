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

    // Single bulk call to get_ad_creatives (returns creative metadata)
    // If this fails (premium feature), return empty — reports use ad_id links as fallback
    const thumbnails: Record<string, { thumbnail: string | null; imageUrl: string | null }> = {};

    try {
      const capped = adIds.slice(0, 50);
      const rawResult = await callPipeboard('bulk_get_ad_creatives', {
        ad_ids: capped,
        limit: capped.length,
      });

      const result = (rawResult && typeof rawResult === 'object')
        ? unwrapPipeboardResponse(rawResult as Record<string, unknown>)
        : rawResult;

      const p = result as Record<string, unknown>;
      const items = Array.isArray(p?.results) ? p.results : (Array.isArray(p?.data) ? p.data : []);

      for (const item of items as Record<string, unknown>[]) {
        const adId = item.ad_id ?? item.id;
        if (!adId) continue;
        const creative = (item.creative ?? item) as Record<string, unknown>;
        const oss = creative.object_story_spec as Record<string, unknown> | undefined;
        const thumb = (creative.thumbnail_url ?? creative.image_url ?? (oss?.link_data && (oss.link_data as Record<string, unknown>).image_url)) as string | null;
        const img = (creative.image_url ?? thumb) as string | null;
        if (thumb || img) thumbnails[String(adId)] = { thumbnail: thumb, imageUrl: img };
      }
    } catch (err) {
      console.log('[creatives] bulk_get_ad_creatives failed (may be premium):', err instanceof Error ? err.message : 'unknown');
    }

    return NextResponse.json({ data: thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
