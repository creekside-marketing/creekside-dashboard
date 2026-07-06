import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

/**
 * POST /api/advocacy/catalog
 * Body: { item_key, label, category, description?, sort_order? }
 * Creates a new advocacy item. Peterson uses this from the admin section
 * on the Advocacy tab to add new asks without a code push.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { item_key, label, category, description, sort_order } = body as {
      item_key: string;
      label: string;
      category: string;
      description?: string;
      sort_order?: number;
    };

    if (!item_key || !label || !category) {
      return NextResponse.json({ error: 'item_key, label, category required' }, { status: 400 });
    }

    // Normalize item_key to snake_case-safe slug
    const cleanKey = item_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('advocacy_items_catalog')
      .insert({
        item_key: cleanKey,
        label: label.trim(),
        category: category.trim(),
        description: description?.trim() || null,
        sort_order: sort_order ?? 999,
      })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('advocacy catalog POST error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PATCH /api/advocacy/catalog
 * Body: { item_key, label?, category?, description?, sort_order?, active? }
 * Edits an existing catalog item. Used to rename, re-categorize, reorder,
 * or deactivate items.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { item_key, ...updates } = body as Record<string, unknown>;

    if (!item_key || typeof item_key !== 'string') {
      return NextResponse.json({ error: 'item_key required' }, { status: 400 });
    }

    const allowed = ['label', 'category', 'description', 'sort_order', 'active'];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in updates) patch[k] = updates[k];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('advocacy_items_catalog')
      .update(patch)
      .eq('item_key', item_key)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ item: data });
  } catch (err) {
    console.error('advocacy catalog PATCH error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
