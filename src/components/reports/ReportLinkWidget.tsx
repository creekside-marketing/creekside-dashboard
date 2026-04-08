'use client';

import { useState } from 'react';

interface ReportLinkWidgetProps {
  clientId: string;
  reportToken: string;
}

export default function ReportLinkWidget({ clientId, reportToken }: ReportLinkWidgetProps) {
  const [token, setToken] = useState(reportToken);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/report/${token}`
    : `/report/${token}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const input = document.createElement('input');
      input.value = fullUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('Regenerate this report link? The old link will stop working.')) return;
    setRegenerating(true);
    setError(null);
    try {
      const newToken = crypto.randomUUID();
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, report_token: newToken }),
      });
      if (res.ok) {
        setToken(newToken);
      } else {
        setError(res.status === 401 ? 'Session expired — refresh the page' : 'Failed to regenerate');
        setTimeout(() => setError(null), 5000);
      }
    } catch {
      setError('Network error — try again');
      setTimeout(() => setError(null), 5000);
    }
    setRegenerating(false);
  };

  return (
    <div className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-2 border border-slate-200">
      {error && <span className="text-xs font-medium text-red-500 shrink-0">{error}</span>}
      <span className="text-xs font-medium text-slate-500 shrink-0">Report URL:</span>
      <code className="text-xs text-slate-600 truncate flex-1">{fullUrl}</code>
      <button
        onClick={handleCopy}
        className="text-xs font-medium text-[var(--creekside-blue)] hover:text-blue-700 transition-colors shrink-0"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <span className="text-slate-200">|</span>
      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        className="text-xs font-medium text-slate-500 hover:text-red-600 transition-colors shrink-0 disabled:opacity-50"
      >
        {regenerating ? 'Regenerating...' : 'Regenerate'}
      </button>
    </div>
  );
}
