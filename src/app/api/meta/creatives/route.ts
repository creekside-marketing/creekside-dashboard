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

      // Debug: log the raw shape so we can see exactly what callPipeboard returns
      console.log('[creatives] rawResult type:', typeof rawResult);
      console.log('[creatives] rawResult keys:', rawResult && typeof rawResult === 'object' ? Object.keys(rawResult as object) : 'not-object');
      console.log('[creatives] rawResult snippet:', JSON.stringify(rawResult).slice(0, 500));

      // Deep unwrap: try every possible wrapping layer
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: any = rawResult;

      // Layer 1: MCP content envelope { content: [{ text: "..." }] }
      if (parsed && typeof parsed === 'object') {
        parsed = unwrapPipeboardResponse(parsed as Record<string, unknown>);
      }

      // Layer 2: nested result string
      if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string') {
        try { parsed = JSON.parse(parsed.result); } catch { /* keep */ }
      }

      // Layer 3: structuredContent.result
      if (parsed && typeof parsed === 'object' && parsed.structuredContent) {
        const sc = parsed.structuredContent;
        if (typeof sc.result === 'string') {
          try { parsed = JSON.parse(sc.result); } catch { /* keep */ }
        }
      }

      console.log('[creatives] parsed keys:', parsed && typeof parsed === 'object' ? Object.keys(parsed) : 'not-object');

      // Extract results array
      const items = parsed?.results ?? parsed?.data ?? [];
      console.log('[creatives] items count:', Array.isArray(items) ? items.length : 'not-array');

      if (Array.isArray(items)) {
        for (const item of items) {
          const adId = item.ad_id ?? item.id;
          if (!adId) continue;
          const creative = item.creative ?? item;
          const thumb = creative.thumbnail_url ?? creative.image_url ?? creative.object_story_spec?.link_data?.image_url ?? null;
          const img = creative.image_url ?? thumb ?? null;
          if (thumb || img) thumbnails[String(adId)] = { thumbnail: thumb, imageUrl: img };
        }
      }

      console.log('[creatives] thumbnails found:', Object.keys(thumbnails).length);
    } catch (err) {
      console.log('[creatives] bulk_get_ad_creatives failed:', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ data: thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
