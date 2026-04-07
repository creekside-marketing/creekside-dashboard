import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

function parseInvoiceStatus(title: string): 'paid' | 'unpaid' {
  if (title.toLowerCase().includes('(paid)')) return 'paid';
  return 'unpaid';
}

function parseInvoiceNumber(title: string): string {
  const match = title.match(/#(\d+)/);
  return match ? match[1] : '--';
}

function parsePaymentMethod(title: string): string {
  // Match patterns like "VISA ending 4406", "Mastercard ending 1234", etc.
  const match = title.match(/\(([^)]+ending\s+\d+)\)/i);
  if (match) return match[1];
  // Fallback: look for card type anywhere
  const cardMatch = title.match(/(VISA|Mastercard|AMEX|Discover|ACH)\s+ending\s+\d+/i);
  if (cardMatch) return cardMatch[0];
  return '--';
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      recentInvoicesRes,
      recentPaymentsRes,
      invoices30dRes,
      payments30dRes,
      failedPayments30dRes,
      unpaidInvoicesRes,
      failedPaymentsRes,
    ] = await Promise.all([
      // Recent 20 invoices
      supabase
        .from('square_entries')
        .select('id, customer_name, amount_cents, title, source_timestamp')
        .eq('data_type', 'invoice')
        .order('source_timestamp', { ascending: false })
        .limit(20),
      // Recent 20 payments
      supabase
        .from('square_entries')
        .select('id, customer_name, amount_cents, title, payment_status, source_timestamp')
        .eq('data_type', 'payment')
        .order('source_timestamp', { ascending: false })
        .limit(20),
      // Invoices last 30 days (for summary)
      supabase
        .from('square_entries')
        .select('amount_cents')
        .eq('data_type', 'invoice')
        .gte('source_timestamp', thirtyDaysAgo),
      // Completed payments last 30 days (for summary)
      supabase
        .from('square_entries')
        .select('amount_cents')
        .eq('data_type', 'payment')
        .eq('payment_status', 'COMPLETED')
        .gte('source_timestamp', thirtyDaysAgo),
      // Failed payments last 30 days (for summary count)
      supabase
        .from('square_entries')
        .select('id', { count: 'exact', head: true })
        .eq('data_type', 'payment')
        .eq('payment_status', 'FAILED')
        .gte('source_timestamp', thirtyDaysAgo),
      // All unpaid invoices
      supabase
        .from('square_entries')
        .select('id, customer_name, amount_cents, title, source_timestamp')
        .eq('data_type', 'invoice')
        .ilike('title', '%(unpaid)%')
        .order('source_timestamp', { ascending: true }),
      // Failed payments last 90 days
      supabase
        .from('square_entries')
        .select('id, customer_name, amount_cents, title, payment_status, source_timestamp')
        .eq('data_type', 'payment')
        .eq('payment_status', 'FAILED')
        .gte('source_timestamp', ninetyDaysAgo)
        .order('source_timestamp', { ascending: false }),
    ]);

    // Check for errors
    for (const res of [recentInvoicesRes, recentPaymentsRes, invoices30dRes, payments30dRes, failedPayments30dRes, unpaidInvoicesRes, failedPaymentsRes]) {
      if (res.error) {
        return NextResponse.json({ error: res.error.message }, { status: 500 });
      }
    }

    // Build recent invoices
    const recentInvoices = (recentInvoicesRes.data ?? []).map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      amount: (row.amount_cents ?? 0) / 100,
      status: parseInvoiceStatus(row.title ?? ''),
      invoice_number: parseInvoiceNumber(row.title ?? ''),
      source_timestamp: row.source_timestamp,
    }));

    // Build recent payments
    const recentPayments = (recentPaymentsRes.data ?? []).map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      amount: (row.amount_cents ?? 0) / 100,
      payment_status: row.payment_status,
      payment_method: parsePaymentMethod(row.title ?? ''),
      source_timestamp: row.source_timestamp,
    }));

    // Summary
    const totalInvoiced30d = (invoices30dRes.data ?? []).reduce(
      (sum, r) => sum + (r.amount_cents ?? 0),
      0
    ) / 100;

    const totalPaid30d = (payments30dRes.data ?? []).reduce(
      (sum, r) => sum + (r.amount_cents ?? 0),
      0
    ) / 100;

    const failedCount = failedPayments30dRes.count ?? 0;
    const unpaidCount = (unpaidInvoicesRes.data ?? []).length;

    // Unpaid invoices
    const unpaidInvoices = (unpaidInvoicesRes.data ?? []).map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      amount: (row.amount_cents ?? 0) / 100,
      invoice_number: parseInvoiceNumber(row.title ?? ''),
      source_timestamp: row.source_timestamp,
      days_outstanding: row.source_timestamp
        ? Math.floor((now.getTime() - new Date(row.source_timestamp).getTime()) / (1000 * 60 * 60 * 24))
        : null,
    }));

    // Failed payments
    const failedPayments = (failedPaymentsRes.data ?? []).map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      amount: (row.amount_cents ?? 0) / 100,
      payment_method: parsePaymentMethod(row.title ?? ''),
      payment_status: row.payment_status,
      source_timestamp: row.source_timestamp,
    }));

    return NextResponse.json({
      recentInvoices,
      recentPayments,
      summary: {
        totalInvoiced30d,
        totalPaid30d,
        failedCount,
        unpaidCount,
      },
      unpaidInvoices,
      failedPayments,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
