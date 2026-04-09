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

/** Unwrap MCP content envelope: { content: [{ type: "text", text: "..." }] } → parsed JSON */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapMcpResponse(raw: any): any {
  if (!raw || typeof raw !== 'object') return raw;
  if (Array.isArray(raw.content) && raw.content.length > 0) {
    const first = raw.content[0];
    if (typeof first?.text === 'string') {
      try { return JSON.parse(first.text); } catch { /* fall through */ }
    }
  }
  if (raw.structuredContent) {
    const sc = raw.structuredContent;
    if (typeof sc.result === 'string') {
      try { return JSON.parse(sc.result); } catch { /* fall through */ }
    }
  }
  return raw;
}

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

      // Unwrap MCP content envelope (server-side — can't use client ReportHeader)
      const parsed = unwrapMcpResponse(rawResult);

      // Extract results array
      const items = parsed?.results ?? parsed?.data ?? [];
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
    } catch (err) {
      console.log('[creatives] bulk_get_ad_creatives failed:', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ data: thumbnails });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
