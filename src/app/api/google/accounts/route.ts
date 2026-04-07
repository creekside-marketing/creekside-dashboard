import { NextRequest, NextResponse } from 'next/server';
import { getCustomer } from '@/lib/google-ads';

export async function GET(_request: NextRequest) {
  try {
    const mccId = process.env.GOOGLE_ADS_MCC_ID;

    if (!mccId) {
      return NextResponse.json(
        { error: 'GOOGLE_ADS_MCC_ID is not configured' },
        { status: 500 }
      );
    }

    const customer = getCustomer(mccId);

    const results = await customer.query(`
      SELECT
        customer_client.client_customer,
        customer_client.descriptive_name,
        customer_client.id,
        customer_client.status,
        customer_client.currency_code
      FROM customer_client
      WHERE customer_client.manager = FALSE
      ORDER BY customer_client.descriptive_name
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = results.map((row: any) => ({
      id: row.customer_client.id,
      name: row.customer_client.descriptive_name,
      status: row.customer_client.status,
      currency: row.customer_client.currency_code,
    }));

    return NextResponse.json(accounts);
  } catch (error: unknown) {
    console.error('Google Ads accounts error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch Google Ads accounts';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
