'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';

interface ArchivedClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  priority: string | null;
  account_manager: string | null;
  platform_operator: string | null;
  contact_name: string | null;
  notes: string | null;
  segment_name: string | null;
  churned_date: string | null;
  churn_reason: string | null;
  status: string;
  [key: string]: unknown;
}

interface ClientGroup {
  clientName: string;
  rows: ArchivedClient[];
}

type SortKey = 'client_name' | 'platform' | 'monthly_budget' | 'priority' | 'account_manager' | 'platform_operator' | 'churned_date';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const PARTNER_NOTES: Record<string, string> = {
  'Chris Ideson Meal Prep': 'via Bottle.com',
  'Punch Drunk Chef Meal Prep': 'via Bottle.com',
  'Unrefined Meal Prep': 'via Bottle.com',
  'Tilly Mill Auto Center': 'via FirstUp Marketing',
  'Polaris Dentistry': 'via FirstUp Marketing',
};

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function PlatformBadge({ platform }: { platform: string }) {
  const isMeta = platform?.toLowerCase() === 'meta';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${
      isMeta
        ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20'
        : 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isMeta ? 'bg-blue-500' : 'bg-emerald-500'}`} />
      {isMeta ? 'Meta' : 'Google'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-slate-300 text-sm">--</span>;
  const lower = priority.toLowerCase();
  const styles: Record<string, string> = {
    high: 'bg-red-100 text-red-900 ring-1 ring-inset ring-red-700/30',
    medium: 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-500/20',
    low: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold capitalize ${styles[lower] || styles.low}`}>
      {priority}
    </span>
  );
}

function InlineTextArea({
  clientId,
  field,
  value,
  placeholder,
  onSaved,
}: {
  clientId: string;
  field: string;
  value: string | null;
  placeholder: string;
  onSaved: (clientId: string, field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (draft === (value ?? '')) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, [field]: draft }),
      });
      if (res.ok) onSaved(clientId, field, draft);
    } catch (err) { console.error('Failed to save:', err); }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); } }}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] resize-none"
        placeholder={placeholder}
      />
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setDraft(value ?? ''); setEditing(true); }}
      className={`cursor-pointer text-sm hover:text-[var(--creekside-blue)] transition-colors ${
        value ? 'text-slate-700 border-b border-dashed border-transparent hover:border-[var(--creekside-blue)]' : 'text-slate-300 italic'
      }`}
    >
      {saving ? '...' : value || placeholder}
    </span>
  );
}

function SortHeader({ label, sortKey: key, currentKey, direction, onSort }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  direction: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const isActive = currentKey === key;
  return (
    <th
      onClick={() => onSort(key)}
      className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6 cursor-pointer select-none hover:text-slate-900 transition-colors group"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <svg className={`w-3.5 h-3.5 transition-all ${isActive ? 'text-slate-700' : 'text-slate-300 group-hover:text-slate-400'}`} viewBox="0 0 14 14" fill="currentColor">
          {isActive && direction === 'asc' ? (
            <path d="M7 3l5 8H2z" />
          ) : isActive && direction === 'desc' ? (
            <path d="M7 11L2 3h10z" />
          ) : (
            <>
              <path d="M7 3l4 5H3z" opacity="0.4" />
              <path d="M7 11L3 6h8z" opacity="0.4" />
            </>
          )}
        </svg>
      </span>
    </th>
  );
}

export default function ArchivePage() {
  const [clients, setClients] = useState<ArchivedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('churned_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetch('/api/clients')
      .then(res => res.json())
      .then((data: ArchivedClient[]) => {
        setClients(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const churned = useMemo(
    () => clients.filter(c => c.status?.toLowerCase() === 'churned'),
    [clients]
  );

  // Sort churned clients
  const sorted = useMemo(() => {
    const arr = [...churned];
    arr.sort((a, b) => {
      const nameCompare = (a.client_name ?? '').localeCompare(b.client_name ?? '');
      if (sortKey === 'client_name') {
        return sortDir === 'asc' ? nameCompare : -nameCompare;
      }
      let cmp = 0;
      if (sortKey === 'priority') {
        const pa = PRIORITY_ORDER[a.priority?.toLowerCase() ?? ''] ?? 3;
        const pb = PRIORITY_ORDER[b.priority?.toLowerCase() ?? ''] ?? 3;
        cmp = pa - pb;
      } else if (sortKey === 'monthly_budget') {
        cmp = (a.monthly_budget ?? 0) - (b.monthly_budget ?? 0);
      } else if (sortKey === 'churned_date') {
        cmp = (a.churned_date ?? '').localeCompare(b.churned_date ?? '');
      } else {
        const va = (a[sortKey] as string) ?? '';
        const vb = (b[sortKey] as string) ?? '';
        cmp = va.localeCompare(vb);
      }
      cmp = sortDir === 'asc' ? cmp : -cmp;
      return cmp !== 0 ? cmp : nameCompare;
    });
    return arr;
  }, [churned, sortKey, sortDir]);

  // Group by client name
  const grouped = useMemo((): ClientGroup[] => {
    const groups: ClientGroup[] = [];
    let currentGroup: ClientGroup | null = null;
    for (const row of sorted) {
      if (!currentGroup || currentGroup.clientName !== row.client_name) {
        currentGroup = { clientName: row.client_name, rows: [row] };
        groups.push(currentGroup);
      } else {
        currentGroup.rows.push(row);
      }
    }
    return groups;
  }, [sorted]);

  const handleFieldSaved = useCallback((clientId: string, field: string, value: string) => {
    setClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, [field]: value } : c
    ));
  }, []);

  const handleReactivate = async (clientName: string, rows: ArchivedClient[]) => {
    if (!confirm(`Reactivate ${clientName}? This will move them back to the active client list.`)) return;
    setReactivating(clientName);
    try {
      const responses = await Promise.all(rows.map(row =>
        fetch('/api/clients', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id, status: 'active' }),
        })
      ));
      if (responses.every(r => r.ok)) {
        setClients(prev => prev.map(c =>
          rows.some(r => r.id === c.id)
            ? { ...c, status: 'active', churned_date: null, churn_reason: null }
            : c
        ));
      } else {
        console.error('Some reactivation requests failed');
      }
    } catch (err) { console.error('Failed to reactivate:', err); }
    setReactivating(null);
  };

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // Stats
  const stats = useMemo(() => {
    const uniqueClients = new Set(churned.map(c => c.client_name)).size;
    const googleCount = churned.filter(c => c.platform?.toLowerCase() === 'google').length;
    const metaCount = churned.filter(c => c.platform?.toLowerCase() === 'meta').length;
    const seen = new Set<string>();
    let totalLostBudget = 0;
    for (const c of churned) {
      if (!seen.has(c.client_name)) {
        seen.add(c.client_name);
        totalLostBudget += Number(c.monthly_revenue ?? c.monthly_budget ?? 0);
      }
    }
    return { uniqueClients, googleCount, metaCount, total: churned.length, totalLostBudget };
  }, [churned]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[var(--creekside-blue)]" />
          <span className="text-sm text-slate-500">Loading archive...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-xl">
        <p className="font-semibold">Error loading clients</p>
        <p className="text-sm mt-1 text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Client Archive</h2>
        <p className="text-sm text-slate-500 mt-1">Former clients — track why they left and reactivate when they return</p>
      </div>

      {/* Summary Stats — matches ClientTable grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Archived Clients</p>
          <p className="text-3xl font-bold text-slate-900 mt-1">{stats.uniqueClients}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Google Accounts</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{stats.googleCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Meta Accounts</p>
          <p className="text-3xl font-bold text-blue-600 mt-1">{stats.metaCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Last Known Monthly Revenue</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{formatCurrency(stats.totalLostBudget)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <SortHeader label="Client" sortKey="client_name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Platform</th>
                <SortHeader label="Last Budget" sortKey="monthly_budget" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Priority" sortKey="priority" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Manager" sortKey="account_manager" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Operator" sortKey="platform_operator" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Churned Date" sortKey="churned_date" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6 min-w-[250px]">Reason</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-slate-400 py-16 text-sm">
                    No archived clients. When a client is marked as &quot;churned&quot;, they&apos;ll appear here.
                  </td>
                </tr>
              ) : (
                grouped.map((group, groupIdx) => (
                  group.rows.map((client, rowIdx) => {
                    const isFirstInGroup = rowIdx === 0;
                    return (
                      <tr
                        key={client.id}
                        className={`transition-colors duration-150 hover:bg-blue-50/50 ${
                          isFirstInGroup && groupIdx > 0 ? 'border-t border-slate-200' : ''
                        } ${!isFirstInGroup ? 'border-t border-slate-100' : ''}`}
                      >
                        {/* Client Name — only show for first row in group */}
                        <td className="py-4 px-6">
                          {isFirstInGroup ? (
                            <div>
                              <span className="text-sm font-semibold text-slate-900">{client.client_name}</span>
                              {(client.contact_name as string) && (
                                <span className="block text-xs text-slate-400 font-normal mt-0.5">{client.contact_name as string}</span>
                              )}
                              {PARTNER_NOTES[client.client_name] && (
                                <span className="block text-[11px] text-slate-400 font-normal mt-0.5">{PARTNER_NOTES[client.client_name]}</span>
                              )}
                            </div>
                          ) : null}
                        </td>
                        {/* Platform */}
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <PlatformBadge platform={client.platform} />
                            {(client.segment_name as string) && (
                              <span className="text-xs text-slate-500 font-medium">{client.segment_name as string}</span>
                            )}
                          </div>
                        </td>
                        {/* Budget */}
                        <td className="py-4 px-6 text-sm text-slate-700 font-medium">
                          {client.monthly_budget != null
                            ? `$${Number(client.monthly_budget).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                            : <span className="text-slate-300">--</span>}
                        </td>
                        {/* Priority */}
                        <td className="py-4 px-6">
                          {isFirstInGroup ? <PriorityBadge priority={client.priority} /> : null}
                        </td>
                        {/* Manager */}
                        <td className="py-4 px-6 text-sm text-slate-600">
                          {isFirstInGroup ? (client.account_manager ?? <span className="text-slate-300">--</span>) : null}
                        </td>
                        {/* Operator */}
                        <td className="py-4 px-6 text-sm text-slate-600">
                          {client.platform_operator ?? <span className="text-slate-300">--</span>}
                        </td>
                        {/* Churned Date */}
                        <td className="py-4 px-6 text-sm text-slate-600">
                          {isFirstInGroup ? (client.churned_date ?? <span className="text-slate-300">--</span>) : null}
                        </td>
                        {/* Churn Reason */}
                        <td className="py-4 px-6">
                          {isFirstInGroup ? (
                            <InlineTextArea
                              clientId={client.id}
                              field="churn_reason"
                              value={client.churn_reason}
                              placeholder="Click to add reason..."
                              onSaved={handleFieldSaved}
                            />
                          ) : null}
                        </td>
                        {/* Reactivate */}
                        <td className="py-4 px-6 text-right">
                          {isFirstInGroup ? (
                            <button
                              onClick={() => handleReactivate(group.clientName, group.rows)}
                              disabled={reactivating === group.clientName}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            >
                              {reactivating === group.clientName ? 'Reactivating...' : 'Reactivate'}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <span className="text-sm text-slate-500">
            {stats.uniqueClients} clients &middot; {stats.total} accounts
          </span>
        </div>
      </div>
    </div>
  );
}
