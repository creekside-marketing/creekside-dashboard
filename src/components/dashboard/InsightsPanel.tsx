'use client';

import { useState, useCallback } from 'react';
import { useCalculator } from '@/lib/context/calculator-context';

interface Insight {
  category: string;
  title: string;
  body: string;
}

function parseInsights(markdown: string): Insight[] {
  const sections = markdown.split(/###\s+/).filter(Boolean);
  return sections.map((section) => {
    const firstLine = section.split('\n')[0].trim();
    const body = section.split('\n').slice(1).join('\n').trim();
    const match = firstLine.match(/^\[(\w+)\]\s*(.+)$/);
    if (match) {
      return { category: match[1], title: match[2], body };
    }
    return { category: 'Insight', title: firstLine, body };
  });
}

function getCategoryStyle(category: string): { border: string; text: string; bg: string } {
  switch (category.toLowerCase()) {
    case 'warning':
      return {
        border: 'border-[var(--warning)]/30',
        text: 'text-[var(--warning)]',
        bg: 'bg-[var(--warning)]/10',
      };
    case 'opportunity':
      return {
        border: 'border-[var(--success)]/30',
        text: 'text-[var(--success)]',
        bg: 'bg-[var(--success)]/10',
      };
    case 'strategy':
      return {
        border: 'border-[var(--chart-bench)]/30',
        text: 'text-[var(--chart-bench)]',
        bg: 'bg-[var(--chart-bench)]/10',
      };
    case 'optimization':
      return {
        border: 'border-[var(--accent)]/30',
        text: 'text-[var(--accent)]',
        bg: 'bg-[var(--accent)]/10',
      };
    case 'timeline':
      return {
        border: 'border-purple-500/30',
        text: 'text-purple-400',
        bg: 'bg-purple-500/10',
      };
    default:
      return {
        border: 'border-[var(--border)]',
        text: 'text-[var(--text-secondary)]',
        bg: 'bg-[var(--bg-tertiary)]',
      };
  }
}

export function InsightsPanel() {
  const { state, results } = useCalculator();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetched, setFetched] = useState(false);

  const fetchInsights = useCallback(async () => {
    if (!results) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, results }),
      });

      if (!res.ok) throw new Error('Failed to fetch insights');

      const data = await res.json();
      setInsights(parseInsights(data.insights));
      setFetched(true);
    } catch {
      setError('Unable to generate insights. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [state, results]);

  if (!results) return null;

  if (loading) {
    return (
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 mt-6">
        <h3 className="text-[var(--text-primary)] font-semibold mb-4">
          Generating AI Insights...
        </h3>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[var(--bg-tertiary)] rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-[var(--border)] rounded w-1/3 mb-3" />
              <div className="h-3 bg-[var(--border)] rounded w-full mb-2" />
              <div className="h-3 bg-[var(--border)] rounded w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (fetched && insights.length > 0) {
    return (
      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[var(--text-primary)] font-semibold">AI Insights</h3>
          <button
            onClick={fetchInsights}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            Refresh
          </button>
        </div>
        <div className="space-y-3">
          {insights.map((insight, i) => {
            const style = getCategoryStyle(insight.category);
            return (
              <div key={i} className={`border ${style.border} rounded-lg p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.text} ${style.bg}`}
                  >
                    {insight.category}
                  </span>
                  <span className="text-[var(--text-primary)] text-sm font-medium">
                    {insight.title}
                  </span>
                </div>
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                  {insight.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 mt-6 text-center">
      <h3 className="text-[var(--text-primary)] font-semibold mb-2">AI-Powered Insights</h3>
      <p className="text-[var(--text-secondary)] text-sm mb-4">
        Get personalized recommendations based on your projections.
      </p>
      {error && <p className="text-[var(--danger)] text-sm mb-3">{error}</p>}
      <button
        onClick={() => {
          const captured = localStorage.getItem('roas_lead_captured');
          if (captured) {
            fetchInsights();
          } else {
            window.dispatchEvent(
              new CustomEvent('show-lead-modal', { detail: { then: 'insights' } })
            );
          }
        }}
        className="px-6 py-3 text-sm font-semibold rounded-lg bg-[var(--accent)] text-white hover:brightness-110 transition-all shadow-[0_0_20px_var(--accent-glow)]"
      >
        Get AI Insights
      </button>
    </div>
  );
}
