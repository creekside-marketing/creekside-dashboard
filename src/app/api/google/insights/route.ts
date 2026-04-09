/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';
import { getCustomer } from '@/lib/google-ads';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customer_id');
    const dateRange = searchParams.get('date_range') || 'LAST_30_DAYS';
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const level = searchParams.get('level') || 'campaign';

    // Validate date inputs to prevent GAQL injection
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const validPresets = new Set(['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']);

    const hasExplicitDates = since && until && datePattern.test(since) && datePattern.test(until);

    // Build the date filter clause — explicit range overrides preset
    const dateFilter = hasExplicitDates
      ? `segments.date BETWEEN '${since}' AND '${until}'`
      : `segments.date DURING ${validPresets.has(dateRange) ? dateRange : 'LAST_30_DAYS'}`;

    if (!customerId) {
      return NextResponse.json(
        { error: 'customer_id query parameter is required' },
        { status: 400 }
      );
    }

    const customer = getCustomer(customerId);

    if (level === 'account') {
      const results = await customer.query(`
        SELECT
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion,
          segments.date
        FROM customer
        WHERE ${dateFilter}
        ORDER BY segments.date DESC
      `);

      const data = results.map((row: any) => ({
        date: row.segments.date,
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        ctr: row.metrics.ctr,
        average_cpc: Number(row.metrics.average_cpc) / 1_000_000,
        cost: Number(row.metrics.cost_micros) / 1_000_000,
        conversions: row.metrics.conversions,
        cost_per_conversion: Number(row.metrics.cost_per_conversion) / 1_000_000,
      }));

      // Also fetch conversion action breakdown
      let conversionBreakdown: Array<{ name: string; conversions: number }> = [];
      try {
        const convResults = await customer.query(`
          SELECT
            segments.conversion_action_name,
            metrics.conversions
          FROM customer
          WHERE ${dateFilter}
        `);
        const breakdownMap: Record<string, number> = {};
        for (const row of convResults as any[]) {
          const conversions = row.metrics.conversions ?? 0;
          if (conversions === 0) continue;
          const name = row.segments.conversion_action_name || 'Unknown';
          breakdownMap[name] = (breakdownMap[name] ?? 0) + conversions;
        }
        conversionBreakdown = Object.entries(breakdownMap)
          .map(([name, conversions]) => ({ name, conversions }))
          .sort((a, b) => b.conversions - a.conversions);
      } catch {
        // Conversion breakdown is optional — don't fail the whole request
      }

      return NextResponse.json({ level: 'account', customer_id: customerId, data, conversionBreakdown });
    }

    // ── Keyword level ──────────────────────────────────────────────────
    if (level === 'keyword') {
      const results = await customer.query(`
        SELECT
          ad_group_criterion.keyword.text,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM keyword_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
          AND ad_group.status != 'REMOVED'
          AND ad_group_criterion.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `);

      const data = results.map((row: any) => ({
        keyword: (row.ad_group_criterion as any)?.keyword?.text ?? 'Unknown',
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        ctr: Number(row.metrics.ctr ?? 0),
        average_cpc: Number(row.metrics.average_cpc) / 1_000_000,
        cost: Number(row.metrics.cost_micros) / 1_000_000,
        conversions: row.metrics.conversions,
        cost_per_conversion: Number(row.metrics.cost_per_conversion) / 1_000_000,
      }));

      return NextResponse.json({ level: 'keyword', customer_id: customerId, data });
    }

    // ── Search term level ───────────────────────────────────────────────
    if (level === 'search_term') {
      const results = await customer.query(`
        SELECT
          search_term_view.search_term,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM search_term_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `);

      const data = results.map((row: any) => ({
        search_term: row.search_term_view?.search_term ?? 'Unknown',
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        ctr: Number(row.metrics.ctr ?? 0),
        average_cpc: Number(row.metrics.average_cpc) / 1_000_000,
        cost: Number(row.metrics.cost_micros) / 1_000_000,
        conversions: row.metrics.conversions,
        cost_per_conversion: Number(row.metrics.cost_per_conversion) / 1_000_000,
      }));

      return NextResponse.json({ level: 'search_term', customer_id: customerId, data });
    }

    // ── Geographic level ────────────────────────────────────────────────
    if (level === 'geo') {
      const results = await customer.query(`
        SELECT
          user_location_view.targeting_location,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM user_location_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
        LIMIT 50
      `);

      const data = results.map((row: any) => ({
        city: row.user_location_view?.targeting_location ?? 'Unknown',
        impressions: row.metrics.impressions,
        clicks: row.metrics.clicks,
        ctr: Number(row.metrics.ctr ?? 0),
        average_cpc: Number(row.metrics.average_cpc) / 1_000_000,
        cost: Number(row.metrics.cost_micros) / 1_000_000,
        conversions: row.metrics.conversions,
        cost_per_conversion: Number(row.metrics.cost_per_conversion) / 1_000_000,
      }));

      return NextResponse.json({ level: 'geo', customer_id: customerId, data });
    }

    // ── Age level ───────────────────────────────────────────────────────
    if (level === 'age') {
      const results = await customer.query(`
        SELECT
          ad_group_criterion.age_range.type,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM age_range_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `);

      const ageLabels: Record<string, string> = {
        // String enum names
        AGE_RANGE_18_24: '18-24', AGE_RANGE_25_34: '25-34', AGE_RANGE_35_44: '35-44',
        AGE_RANGE_45_54: '45-54', AGE_RANGE_55_64: '55-64', AGE_RANGE_65_UP: '65+',
        AGE_RANGE_UNDETERMINED: 'Undetermined',
        // Numeric enum values (google-ads-api can return either)
        '503001': '18-24', '503002': '25-34', '503003': '35-44',
        '503004': '45-54', '503005': '55-64', '503006': '65+',
        '503999': 'Undetermined',
      };

      // Aggregate by age range
      const agg: Record<string, { impressions: number; clicks: number; cost: number; conversions: number }> = {};
      for (const row of results as any[]) {
        const raw = String((row.ad_group_criterion as any)?.age_range?.type ?? 'UNKNOWN');
        const label = ageLabels[raw] ?? raw;
        if (!agg[label]) agg[label] = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
        agg[label].impressions += Number(row.metrics.impressions ?? 0);
        agg[label].clicks += Number(row.metrics.clicks ?? 0);
        agg[label].cost += Number(row.metrics.cost_micros ?? 0) / 1_000_000;
        agg[label].conversions += Number(row.metrics.conversions ?? 0);
      }

      const data = Object.entries(agg)
        .map(([age_range, v]) => ({
          age_range,
          impressions: v.impressions,
          clicks: v.clicks,
          ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
          average_cpc: v.clicks > 0 ? v.cost / v.clicks : 0,
          cost: v.cost,
          conversions: v.conversions,
          cost_per_conversion: v.conversions > 0 ? v.cost / v.conversions : 0,
        }))
        .sort((a, b) => b.cost - a.cost);

      return NextResponse.json({ level: 'age', customer_id: customerId, data });
    }

    // ── Gender level ────────────────────────────────────────────────────
    if (level === 'gender') {
      const results = await customer.query(`
        SELECT
          ad_group_criterion.gender.type,
          metrics.impressions,
          metrics.clicks,
          metrics.ctr,
          metrics.average_cpc,
          metrics.cost_micros,
          metrics.conversions,
          metrics.cost_per_conversion
        FROM gender_view
        WHERE ${dateFilter}
          AND campaign.status != 'REMOVED'
        ORDER BY metrics.cost_micros DESC
      `);

      const genderLabels: Record<string, string> = {
        // String enum names
        MALE: 'Male', FEMALE: 'Female', UNDETERMINED: 'Undetermined',
        // Numeric enum values (google-ads-api can return either)
        '10': 'Male', '11': 'Female', '20': 'Undetermined',
      };

      const agg: Record<string, { impressions: number; clicks: number; cost: number; conversions: number }> = {};
      for (const row of results as any[]) {
        const raw = String((row.ad_group_criterion as any)?.gender?.type ?? 'UNKNOWN');
        const label = genderLabels[raw] ?? raw;
        if (!agg[label]) agg[label] = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };
        agg[label].impressions += Number(row.metrics.impressions ?? 0);
        agg[label].clicks += Number(row.metrics.clicks ?? 0);
        agg[label].cost += Number(row.metrics.cost_micros ?? 0) / 1_000_000;
        agg[label].conversions += Number(row.metrics.conversions ?? 0);
      }

      const data = Object.entries(agg)
        .map(([gender, v]) => ({
          gender,
          impressions: v.impressions,
          clicks: v.clicks,
          ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
          average_cpc: v.clicks > 0 ? v.cost / v.clicks : 0,
          cost: v.cost,
          conversions: v.conversions,
          cost_per_conversion: v.conversions > 0 ? v.cost / v.conversions : 0,
        }))
        .sort((a, b) => b.cost - a.cost);

      return NextResponse.json({ level: 'gender', customer_id: customerId, data });
    }

    // ── Campaign level (default) ────────────────────────────────────────
    const results = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE ${dateFilter}
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
    `);

    const data = results.map((row: any) => ({
      campaign_id: row.campaign.id,
      campaign_name: row.campaign.name,
      status: row.campaign.status,
      channel_type: row.campaign.advertising_channel_type,
      impressions: row.metrics.impressions,
      clicks: row.metrics.clicks,
      ctr: row.metrics.ctr,
      average_cpc: Number(row.metrics.average_cpc) / 1_000_000,
      cost: Number(row.metrics.cost_micros) / 1_000_000,
      conversions: row.metrics.conversions,
      cost_per_conversion: Number(row.metrics.cost_per_conversion) / 1_000_000,
    }));

    return NextResponse.json({ level: 'campaign', customer_id: customerId, data });
  } catch (error: unknown) {
    console.error('Google Ads insights error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch Google Ads insights';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
