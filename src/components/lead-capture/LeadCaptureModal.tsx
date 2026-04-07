'use client';

import { useState } from 'react';
import { useCalculator } from '@/lib/context/calculator-context';

interface LeadCaptureModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function LeadCaptureModal({ onClose, onSuccess }: LeadCaptureModalProps) {
  const { state, results } = useCalculator();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          businessName: businessName || undefined,
          phone: phone || undefined,
          industry: state.industry,
          businessType: state.businessType,
          inputs: {
            businessType: state.businessType,
            industry: state.industry,
            totalBudget: state.totalBudget,
            duration: state.duration,
            spendModel: state.spendModel,
            roasAssumptions: state.roasAssumptions,
          },
          resultsSummary: results
            ? {
                totalRevenue: results.totals.totalRevenue,
                totalProfit: results.totals.totalProfit,
                avgCac: results.totals.avgCac,
                breakEvenMonth: results.totals.breakEvenMonth,
                ltvCacRatio: results.totals.ltvCacRatio,
              }
            : null,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit');

      localStorage.setItem('roas_lead_captured', 'true');
      onSuccess();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-8 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[var(--text-primary)] text-xl font-bold mb-2">
          Unlock Full Report & AI Insights
        </h3>
        <p className="text-[var(--text-secondary)] text-sm mb-6">
          Get your complete ROAS projection report with AI-powered recommendations and downloadable
          PDF.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">
              Email *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">
              Business Name
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Your business"
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[var(--text-secondary)] text-xs font-medium mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {error && <p className="text-[var(--danger)] text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !email}
            className="w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 bg-[var(--accent)] text-white hover:brightness-110"
          >
            {submitting ? 'Submitting...' : 'Get My Full Report'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[var(--border)] text-center">
          <p className="text-[var(--text-muted)] text-xs mb-2">Want help hitting these numbers?</p>
          <a
            href="https://calendar.app.google/4ierPN3nNxLMMTAz7"
            className="text-[var(--accent)] text-sm font-medium hover:text-[var(--accent-light)] transition-colors"
          >
            Book a free strategy call with Creekside
          </a>
        </div>
      </div>
    </div>
  );
}
