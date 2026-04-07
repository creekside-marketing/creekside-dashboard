'use client';

import { useEffect, useState } from 'react';

interface Invoice {
  id: string;
  customer_name: string;
  amount: number;
  status: 'paid' | 'unpaid';
  invoice_number: string;
  source_timestamp: string;
}

interface Payment {
  id: string;
  customer_name: string;
  amount: number;
  payment_status: string;
  payment_method: string;
  source_timestamp: string;
}

interface UnpaidInvoice {
  id: string;
  customer_name: string;
  amount: number;
  invoice_number: string;
  source_timestamp: string;
  days_outstanding: number | null;
}

interface FailedPayment {
  id: string;
  customer_name: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  source_timestamp: string;
}

interface BillingData {
  recentInvoices: Invoice[];
  recentPayments: Payment[];
  summary: {
    totalInvoiced30d: number;
    totalPaid30d: number;
    failedCount: number;
    unpaidCount: number;
  };
  unpaidInvoices: UnpaidInvoice[];
  failedPayments: FailedPayment[];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StatusBadge({ status, variant }: { status: string; variant: 'paid' | 'unpaid' | 'completed' | 'failed' | 'pending' }) {
  const styles: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700',
    completed: 'bg-emerald-50 text-emerald-700',
    unpaid: 'bg-red-50 text-red-600',
    failed: 'bg-red-50 text-red-600',
    pending: 'bg-amber-50 text-amber-600',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${styles[variant] || 'bg-slate-50 text-slate-600'}`}>
      {status}
    </span>
  );
}

function paymentStatusVariant(status: string): 'completed' | 'failed' | 'pending' {
  const s = status?.toUpperCase();
  if (s === 'COMPLETED') return 'completed';
  if (s === 'FAILED') return 'failed';
  return 'pending';
}

function daysColor(days: number): string {
  if (days > 30) return 'text-red-600 font-semibold';
  if (days >= 15) return 'text-amber-600 font-semibold';
  return 'text-slate-700';
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/billing');
        if (!res.ok) throw new Error('Failed to load billing data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Billing Health</h2>
          <p className="text-sm text-slate-500 mt-1">Invoice and payment overview</p>
        </div>
        <div className="p-12 text-center text-slate-400 text-sm">Loading billing data...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Billing Health</h2>
          <p className="text-sm text-slate-500 mt-1">Invoice and payment overview</p>
        </div>
        <div className="p-12 text-center text-red-500 text-sm">Error: {error ?? 'No data'}</div>
      </div>
    );
  }

  const { summary, unpaidInvoices, failedPayments, recentInvoices, recentPayments } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Billing Health</h2>
        <p className="text-sm text-slate-500 mt-1">Invoice and payment overview</p>
      </div>

      {/* Row 1 — Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-medium text-slate-500">Invoiced (Last 30 Days)</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{formatCurrency(summary.totalInvoiced30d)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-medium text-slate-500">Collected (Last 30 Days)</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{formatCurrency(summary.totalPaid30d)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-medium text-slate-500">Unpaid Invoices</p>
          <p className={`text-3xl font-bold mt-1 ${summary.unpaidCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {summary.unpaidCount}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-sm font-medium text-slate-500">Failed Payments</p>
          <p className={`text-3xl font-bold mt-1 ${summary.failedCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {summary.failedCount}
          </p>
        </div>
      </div>

      {/* Row 2 — Unpaid Invoices */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">Unpaid Invoices</h3>
          <p className="text-sm text-slate-500">Sorted by most overdue first</p>
        </div>
        {unpaidInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            No unpaid invoices — all caught up!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoice #</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date Sent</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Days Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {unpaidInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{inv.customer_name ?? '--'}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">#{inv.invoice_number}</td>
                    <td className="py-3 px-4 text-sm text-slate-700 text-right">{formatCurrency(inv.amount)}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{formatDate(inv.source_timestamp)}</td>
                    <td className={`py-3 px-4 text-sm text-right ${inv.days_outstanding != null ? daysColor(inv.days_outstanding) : 'text-slate-300'}`}>
                      {inv.days_outstanding != null ? `${inv.days_outstanding}d` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Row 3 — Failed Payments (conditional) */}
      {failedPayments.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-900">Failed Payments</h3>
            <p className="text-sm text-slate-500">Last 90 days</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Method</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {failedPayments.map((pmt) => (
                  <tr key={pmt.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{pmt.customer_name ?? '--'}</td>
                    <td className="py-3 px-4 text-sm text-slate-700 text-right">{formatCurrency(pmt.amount)}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{pmt.payment_method}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{formatDate(pmt.source_timestamp)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status="Failed" variant="failed" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 4 — Recent Activity (two columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Invoices */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-900">Recent Invoices</h3>
          </div>
          {recentInvoices.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No recent invoices</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {recentInvoices.slice(0, 10).map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{inv.customer_name ?? '--'}</p>
                    <p className="text-xs text-slate-500">{formatDate(inv.source_timestamp)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm font-medium text-slate-700">{formatCurrency(inv.amount)}</span>
                    <StatusBadge status={inv.status === 'paid' ? 'Paid' : 'Unpaid'} variant={inv.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-lg font-semibold text-slate-900">Recent Payments</h3>
          </div>
          {recentPayments.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No recent payments</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {recentPayments.slice(0, 10).map((pmt) => (
                <div key={pmt.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{pmt.customer_name ?? '--'}</p>
                    <p className="text-xs text-slate-500">{formatDate(pmt.source_timestamp)}</p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <span className="text-sm font-medium text-slate-700">{formatCurrency(pmt.amount)}</span>
                    <StatusBadge
                      status={pmt.payment_status ?? '--'}
                      variant={paymentStatusVariant(pmt.payment_status)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
