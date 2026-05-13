'use client';

// Client component for the Meta Audits page. Handles search/filter, the
// Run Audit click flow, and downloading the two returned PDFs.

import { useMemo, useState, useTransition } from 'react';

export interface MetaAccount {
  id: string;
  name: string;
  account_id: string;
  account_status: number;
  amount_spent?: string;
  balance?: string;
  currency?: string;
  business_city?: string;
  business_country_code?: string;
}

interface AuditSummary {
  accountName: string;
  accountId: string;
  overallScore: number;
  overallGrade: string;
  easySellFails: number;
  criticalFails: number;
  highFails: number;
  topFindings: Array<{ id: string; severity: string; question: string }>;
}

interface RunResult {
  audit: { filename: string; base64: string };
  loomBrief: { filename: string; base64: string };
  summary: AuditSummary;
}

const ACCOUNT_STATUS: Record<number, { label: string; tone: string }> = {
  1: { label: 'Active', tone: 'text-emerald-300 bg-emerald-500/10' },
  2: { label: 'Disabled', tone: 'text-red-300 bg-red-500/10' },
  3: { label: 'Unsettled', tone: 'text-amber-300 bg-amber-500/10' },
  7: { label: 'Pending Risk Review', tone: 'text-amber-300 bg-amber-500/10' },
  9: { label: 'Grace Period', tone: 'text-amber-300 bg-amber-500/10' },
  101: { label: 'Closed', tone: 'text-slate-400 bg-slate-500/10' },
};

function statusBadge(code: number) {
  const meta = ACCOUNT_STATUS[code] || { label: `Status ${code}`, tone: 'text-slate-400 bg-slate-500/10' };
  return <span className={`px-2 py-0.5 rounded text-xs ${meta.tone}`}>{meta.label}</span>;
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    CRITICAL: 'text-red-300 bg-red-500/15',
    HIGH: 'text-amber-300 bg-amber-500/15',
    MEDIUM: 'text-slate-300 bg-slate-500/15',
    LOW: 'text-slate-400 bg-slate-500/10',
  };
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${map[severity] || map.LOW}`}>{severity}</span>;
}

function downloadBase64Pdf(filename: string, base64: string) {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke a tick later so the download has time to initiate
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MetaAuditsClient({
  initialAccounts,
  initialError,
}: {
  initialAccounts: MetaAccount[];
  initialError: string | null;
}) {
  const [accounts] = useState<MetaAccount[]>(initialAccounts);
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(initialError);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter(
      (a) => a.name?.toLowerCase().includes(q) || a.account_id?.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  async function handleRun(account: MetaAccount) {
    setError(null);
    setRunning((r) => ({ ...r, [account.account_id]: true }));
    try {
      const res = await fetch('/api/meta-audit/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: account.account_id }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Run failed with status ${res.status}`);
      }
      const result = (await res.json()) as RunResult;
      // Trigger both downloads
      downloadBase64Pdf(result.audit.filename, result.audit.base64);
      // Stagger second download by 300ms to avoid browser popup blocker
      setTimeout(() => downloadBase64Pdf(result.loomBrief.filename, result.loomBrief.base64), 350);
      startTransition(() => setLastResult(result));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error running audit');
    } finally {
      setRunning((r) => {
        const copy = { ...r };
        delete copy[account.account_id];
        return copy;
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Meta Audits</h1>
          <p className="text-sm text-slate-400 mt-1">
            {accounts.length} ad account{accounts.length === 1 ? '' : 's'} accessible. Click Run Audit to generate the audit + Loom brief PDFs for any account.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name or ID..."
          className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-white placeholder-slate-500 w-64 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              Audit complete: {lastResult.summary.accountName} ({lastResult.summary.overallScore}% / {lastResult.summary.overallGrade})
            </div>
            <div className="text-xs text-slate-400">Both PDFs downloaded</div>
          </div>
          <div className="text-xs text-slate-400">
            Easy-sell fails: {lastResult.summary.easySellFails} · Critical: {lastResult.summary.criticalFails} · High: {lastResult.summary.highFails}
          </div>
          <div className="space-y-1 mt-2">
            <div className="text-xs uppercase tracking-wide text-slate-500">Top findings</div>
            {lastResult.summary.topFindings.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-500">{f.id}</span>
                {severityBadge(f.severity)}
                <span className="text-slate-300">{f.question}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/60">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3 text-right">Lifetime Spend</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {accounts.length === 0
                    ? 'No accounts returned. Check PIPEBOARD_API_KEY on the server.'
                    : 'No accounts match your filter.'}
                </td>
              </tr>
            )}
            {filtered.map((acct) => {
              const isRunning = !!running[acct.account_id];
              const spent = Number(acct.amount_spent || 0);
              return (
                <tr key={acct.account_id} className="hover:bg-slate-900/40">
                  <td className="px-4 py-3 text-slate-200">
                    <div className="font-medium">{acct.name || acct.account_id}</div>
                    {acct.business_city && (
                      <div className="text-xs text-slate-500">{acct.business_city}{acct.business_country_code ? `, ${acct.business_country_code}` : ''}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{acct.account_id}</td>
                  <td className="px-4 py-3 text-right text-slate-300">
                    {acct.currency || '$'}{spent.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-4 py-3">{statusBadge(acct.account_status)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRun(acct)}
                      disabled={isRunning}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        isRunning
                          ? 'bg-slate-700 text-slate-400 cursor-wait'
                          : 'bg-blue-600 hover:bg-blue-500 text-white'
                      }`}
                    >
                      {isRunning ? 'Running...' : 'Run Audit'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500 leading-relaxed">
        <p className="font-semibold text-slate-400">How this works</p>
        <p>
          When you click Run Audit, the server pulls live data from Meta via PipeBoard, evaluates the 70-item Creekside audit checklist, generates a branded PDF audit document plus a Loom recording brief for Lindsey or Scott, and triggers two downloads to your device. Each audit takes 30 to 90 seconds. No files are stored on the server.
        </p>
      </div>
    </div>
  );
}
