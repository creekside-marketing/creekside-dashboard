'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { calculatePlatformRevenue } from '@/lib/fee-engine';
import type { FeeConfig } from '@/lib/fee-engine';

interface TeamMember {
  id: string;
  name: string;
  role: string;
  employment_type: string;
  hourly_rate: number | null;
  status: string;
  notes: string | null;
  specialties: string[] | null;
  prework_spreadsheet_id: string | null;
  estimated_hours_per_month: number | null;
}

interface ClientRow {
  client_name: string;
  account_manager: string | null;
  platform_operator: string | null;
  monthly_revenue: number | null;
  monthly_budget: number | null;
  fee_config: FeeConfig | null;
  revenue_override: boolean;
  status: string;
  platform: string | null;
}

interface TeamMemberError {
  id: string;
  team_member_id: string;
  description: string;
  error_date: string;
  created_at: string;
  updated_at: string;
}

// Partners — excluded from all calculations (same as ClientTable)
const PARTNER_NAMES = new Set([
  'Bottle.com',
  'Comet Fuel',
  'FirstUp Marketing',
  'Full Circle Media',
  'Suff Digital',
]);

// Map full team_members names to the short names used in reporting_clients
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'Kenneth Cade MacLean': 'Cade',
  'Peterson Rainey': 'Peterson',
};

function toShortName(fullName: string): string {
  if (DISPLAY_NAME_OVERRIDES[fullName]) return DISPLAY_NAME_OVERRIDES[fullName];
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return fullName;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * Calculate revenue for a single client row using the same cascade as ClientTable:
 * 1. revenue_override === true -> use monthly_revenue
 * 2. fee_config + monthly_budget -> calculate via fee engine
 * 3. monthly_revenue from DB -> use as-is
 * 4. Nothing -> 0
 */
function getRowRevenue(
  row: ClientRow,
  totalBudgetByClient: Record<string, number>,
): number {
  // 1. Manual override
  if (row.revenue_override && row.monthly_revenue != null) {
    return Number(row.monthly_revenue);
  }

  // 2. Fee config + budget
  if (row.fee_config && row.monthly_budget != null && Number(row.monthly_budget) > 0) {
    const budgetAsSpend = Number(row.monthly_budget);
    const totalClientSpend = totalBudgetByClient[row.client_name] ?? budgetAsSpend;
    return calculatePlatformRevenue(row.fee_config, budgetAsSpend, totalClientSpend);
  }

  // 3. Raw monthly_revenue fallback
  if (row.monthly_revenue != null) {
    return Number(row.monthly_revenue);
  }

  // 4. Nothing
  return 0;
}

function _StatusDot({ status }: { status: string }) {
  const lower = status?.toLowerCase() ?? '';
  const dotColor = lower === 'active' ? 'bg-emerald-500' : 'bg-slate-300';
  const textColor = lower === 'active' ? 'text-emerald-700' : 'text-[var(--text-secondary)]';
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium capitalize ${textColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    contractor: 'Contractor',
    full_time: 'Full-Time',
    owner: 'Owner',
  };
  const styles: Record<string, string> = {
    contractor: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20',
    full_time: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
    owner: 'bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-600/20',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${styles[type] || styles.contractor}`}>
      {labels[type] || type}
    </span>
  );
}

function InlineRateEditor({
  member,
  onSaved,
}: {
  member: TeamMember;
  onSaved: (id: string, rate: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.hourly_rate?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed === member.hourly_rate) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/team/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, hourly_rate: parsed }),
      });
      if (res.ok) {
        onSaved(member.id, parsed);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        step="0.01"
        className="w-24 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        disabled={saving}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm text-[var(--text-primary)] hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
      title="Click to edit"
    >
      {member.hourly_rate != null ? `$${member.hourly_rate.toFixed(2)}` : '--'}
    </button>
  );
}

function NotesCell({
  member,
  onSaved,
}: {
  member: TeamMember;
  onSaved: (id: string, notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (value === (member.notes ?? '')) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/team/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, notes: value }),
      });
      if (res.ok) {
        onSaved(member.id, value);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <textarea
        className="w-full px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent resize-none"
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        disabled={saving}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm text-[var(--text-secondary)] hover:text-[var(--creekside-blue)] cursor-pointer transition-colors text-left max-w-[200px] truncate"
      title={member.notes || 'Click to add notes'}
    >
      {member.notes || '--'}
    </button>
  );
}

function InlineHoursEditor({
  member,
  onSaved,
}: {
  member: TeamMember;
  onSaved: (id: string, hours: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(member.estimated_hours_per_month?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed === member.estimated_hours_per_month) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/team/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id, estimated_hours_per_month: parsed }),
      });
      if (res.ok) {
        onSaved(member.id, parsed);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        step="1"
        className="w-20 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
        disabled={saving}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm text-[var(--text-primary)] hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
      title="Click to edit"
    >
      {member.estimated_hours_per_month != null ? member.estimated_hours_per_month : '--'}
    </button>
  );
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [clientData, setClientData] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [allErrors, setAllErrors] = useState<TeamMemberError[]>([]);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [memberErrors, setMemberErrors] = useState<TeamMemberError[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [newErrorDesc, setNewErrorDesc] = useState('');
  const [newErrorDate, setNewErrorDate] = useState(new Date().toISOString().split('T')[0]);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editDate, setEditDate] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [membersRes, clientsRes] = await Promise.all([
        fetch('/api/team/members'),
        fetch('/api/clients'),
      ]);
      const membersData = await membersRes.json();
      const clientsData = await clientsRes.json();
      if (Array.isArray(membersData)) setMembers(membersData);
      if (Array.isArray(clientsData)) setClientData(clientsData);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllErrors = useCallback(async () => {
    try {
      const res = await fetch('/api/team/errors');
      const data = await res.json();
      if (Array.isArray(data)) setAllErrors(data);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); fetchAllErrors(); }, [fetchData, fetchAllErrors]);

  // Filter out partner companies from client data
  const activeClients = useMemo(() => {
    return clientData.filter(c => !PARTNER_NAMES.has(c.client_name));
  }, [clientData]);

  // Pre-compute total budget per client (needed for tiered/fixed fee_config calculations)
  const totalBudgetByClient = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of activeClients) {
      if (c.monthly_budget != null) {
        map[c.client_name] = (map[c.client_name] ?? 0) + Number(c.monthly_budget);
      }
    }
    return map;
  }, [activeClients]);

  // Calculate revenue per client (sum across platforms, using fee_config cascade)
  const clientRevenueByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of activeClients) {
      const rev = getRowRevenue(c, totalBudgetByClient);
      map[c.client_name] = (map[c.client_name] ?? 0) + rev;
    }
    return map;
  }, [activeClients, totalBudgetByClient]);

  // Calculate revenue contribution per team member (from clients they manage)
  const memberRevenue = useMemo(() => {
    const revenueMap: Record<string, number> = {};
    // Attribute revenue to account managers (deduplicate by client_name)
    const clientManagerSeen = new Set<string>();
    for (const c of activeClients) {
      if (c.account_manager && !clientManagerSeen.has(c.client_name)) {
        clientManagerSeen.add(c.client_name);
        const rev = clientRevenueByName[c.client_name] ?? 0;
        revenueMap[c.account_manager] = (revenueMap[c.account_manager] ?? 0) + rev;
      }
    }
    return revenueMap;
  }, [activeClients, clientRevenueByName]);

  // Client counts per team member (using toShortName for matching)
  const memberClientCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const clientsByRole: Record<string, Set<string>> = {};
    for (const c of activeClients) {
      for (const role of [c.account_manager, c.platform_operator]) {
        if (role) {
          if (!clientsByRole[role]) clientsByRole[role] = new Set();
          clientsByRole[role].add(c.client_name);
        }
      }
    }
    for (const [name, clients] of Object.entries(clientsByRole)) {
      counts[name] = clients.size;
    }
    return counts;
  }, [activeClients]);

  // Summary stats
  const summaryStats = useMemo(() => {
    // Total cost: sum of hourly_rate * estimated_hours_per_month for active members
    let totalCost = 0;
    for (const m of members) {
      if (m.status !== 'active') continue;
      if (m.hourly_rate != null && m.estimated_hours_per_month != null) {
        totalCost += m.hourly_rate * m.estimated_hours_per_month;
      }
    }

    // Total revenue: sum of calculated revenue across all active clients
    const totalRevenue = Object.values(clientRevenueByName).reduce((sum, v) => sum + v, 0);

    const laborRatio = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0;
    let ratioColor: string;
    if (laborRatio < 50) ratioColor = 'text-emerald-600';
    else if (laborRatio <= 65) ratioColor = 'text-amber-600';
    else ratioColor = 'text-red-600';
    return { totalCost, totalRevenue, laborRatio, ratioColor };
  }, [members, clientRevenueByName]);

  const errorSummary = useMemo(() => {
    const now = new Date();
    const d30 = new Date(now); d30.setDate(d30.getDate() - 30);
    const d90 = new Date(now); d90.setDate(d90.getDate() - 90);
    return {
      lifetime: allErrors.length,
      last30: allErrors.filter(e => new Date(e.error_date) >= d30).length,
      last90: allErrors.filter(e => new Date(e.error_date) >= d90).length,
    };
  }, [allErrors]);

  const filtered = members.filter((m) => {
    // Only show active team members
    if (m.status !== 'active') return false;
    if (typeFilter !== 'all' && m.employment_type !== typeFilter) return false;
    return true;
  });

  const handleRateSaved = (id: string, rate: number) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, hourly_rate: rate } : m))
    );
  };

  const handleNotesSaved = (id: string, notes: string) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, notes } : m))
    );
  };

  const handleHoursSaved = (id: string, hours: number) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, estimated_hours_per_month: hours } : m))
    );
  };

  const toggleExpand = async (memberId: string) => {
    if (expandedMember === memberId) {
      setExpandedMember(null);
      setMemberErrors([]);
      return;
    }
    setExpandedMember(memberId);
    setLoadingErrors(true);
    setNewErrorDesc('');
    setNewErrorDate(new Date().toISOString().split('T')[0]);
    setEditingError(null);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/team/errors?team_member_id=${memberId}`);
      const data = await res.json();
      if (Array.isArray(data)) setMemberErrors(data);
    } finally {
      setLoadingErrors(false);
    }
  };

  const addError = async (memberId: string) => {
    if (!newErrorDesc.trim()) return;
    try {
      const res = await fetch('/api/team/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_member_id: memberId, description: newErrorDesc.trim(), error_date: newErrorDate }),
      });
      if (res.ok) {
        const created = await res.json();
        setMemberErrors(prev => [created, ...prev]);
        setAllErrors(prev => [created, ...prev]);
        setNewErrorDesc('');
        setNewErrorDate(new Date().toISOString().split('T')[0]);
      }
    } catch {
      setErrorMsg('Failed to add error');
    }
  };

  const updateError = async (errorId: string) => {
    if (!editDesc.trim()) return;
    try {
      const res = await fetch('/api/team/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: errorId, description: editDesc.trim(), error_date: editDate }),
      });
      if (res.ok) {
        const updated = await res.json();
        setMemberErrors(prev => prev.map(e => e.id === errorId ? updated : e));
        setAllErrors(prev => prev.map(e => e.id === errorId ? updated : e));
        setEditingError(null);
      }
    } catch {
      setErrorMsg('Failed to update error');
    }
  };

  const deleteError = async (errorId: string) => {
    try {
      const res = await fetch('/api/team/errors', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: errorId }),
      });
      if (res.ok) {
        setMemberErrors(prev => prev.filter(e => e.id !== errorId));
        setAllErrors(prev => prev.filter(e => e.id !== errorId));
      }
    } catch {
      setErrorMsg('Failed to delete error');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Team Members</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Manage team members, rates, and notes</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
          >
            <option value="all">All</option>
            <option value="contractor">Contractor</option>
            <option value="full_time">Full-Time</option>
            <option value="owner">Owner</option>
          </select>
        </div>
      </div>

      {/* Utilization Summary */}
      {!loading && (
        <>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Total Team Cost / Mo</p>
            <p className="text-xl font-bold text-[var(--text-primary)] mt-1">
              ${summaryStats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Total Revenue / Mo</p>
            <p className="text-xl font-bold text-[var(--text-primary)] mt-1">
              ${summaryStats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Labor Ratio</p>
            <p className={`text-xl font-bold mt-1 ${summaryStats.ratioColor}`}>
              {summaryStats.laborRatio.toFixed(1)}%
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Errors — Lifetime</p>
            <p className="text-xl font-bold text-[var(--text-primary)] mt-1">{errorSummary.lifetime}</p>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Errors — Last 30 Days</p>
            <p className={`text-xl font-bold mt-1 ${errorSummary.last30 > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{errorSummary.last30}</p>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm p-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Errors — Last 90 Days</p>
            <p className={`text-xl font-bold mt-1 ${errorSummary.last90 > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{errorSummary.last90}</p>
          </div>
        </div>
        </>
      )}

      {/* Table */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading team members...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No team members found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Rate</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Est. Hours/Mo</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Clients</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Est. Monthly Cost</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Revenue Contribution</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Pre-work Sheet</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => {
                  const shortName = toShortName(member.name);
                  return (
                  <React.Fragment key={member.id}>
                    <tr className="border-b border-[var(--border)] hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          onClick={() => toggleExpand(member.id)}
                          className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--creekside-blue)] cursor-pointer transition-colors flex items-center gap-1.5"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className={`h-3.5 w-3.5 transition-transform ${expandedMember === member.id ? 'rotate-90' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {member.name}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-[var(--text-secondary)]">{member.role}</span>
                      </td>
                      <td className="py-3 px-4">
                        <TypeBadge type={member.employment_type} />
                      </td>
                      <td className="py-3 px-4">
                        <InlineRateEditor member={member} onSaved={handleRateSaved} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <InlineHoursEditor member={member} onSaved={handleHoursSaved} />
                      </td>
                      <td className="py-3 px-4 text-center text-sm text-[var(--text-primary)]">
                        {(() => {
                          const count = memberClientCounts[shortName] ?? 0;
                          return count > 0 ? count : <span className="text-slate-300">--</span>;
                        })()}
                      </td>
                      <td className="py-3 px-4 text-right text-sm text-[var(--text-secondary)]">
                        {(() => {
                          if (member.hourly_rate != null && member.estimated_hours_per_month != null) {
                            const cost = member.hourly_rate * member.estimated_hours_per_month;
                            return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                          }
                          return <span className="text-slate-300">--</span>;
                        })()}
                      </td>
                      <td className="py-3 px-4 text-right text-sm font-medium text-emerald-700">
                        {(() => {
                          const rev = memberRevenue[shortName];
                          if (rev && rev > 0) return `$${rev.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                          return <span className="text-slate-300">--</span>;
                        })()}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {member.prework_spreadsheet_id ? (
                          <a
                            href={`https://docs.google.com/spreadsheets/d/${member.prework_spreadsheet_id}/edit`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center text-[var(--creekside-blue)] hover:text-blue-800 transition-colors"
                            title="Open pre-work spreadsheet"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-slate-300">--</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <NotesCell member={member} onSaved={handleNotesSaved} />
                      </td>
                    </tr>
                    {expandedMember === member.id && (
                      <tr>
                        <td colSpan={10} className="bg-[var(--bg-tertiary)]/30 px-4 py-4">
                          <div className="max-w-3xl space-y-3">
                            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Error Log — {member.name}</h4>

                            {errorMsg && (
                              <div className="flex items-center justify-between px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md">
                                <span>{errorMsg}</span>
                                <button onClick={() => setErrorMsg(null)} className="text-red-500 hover:text-red-700 font-medium text-xs">Dismiss</button>
                              </div>
                            )}

                            {/* Add new error form */}
                            <div className="flex items-center gap-2">
                              <input
                                type="date"
                                value={newErrorDate}
                                onChange={(e) => setNewErrorDate(e.target.value)}
                                className="px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
                              />
                              <input
                                type="text"
                                placeholder="Describe the error..."
                                value={newErrorDesc}
                                onChange={(e) => setNewErrorDesc(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') addError(member.id); }}
                                className="flex-1 px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
                              />
                              <button
                                onClick={() => addError(member.id)}
                                disabled={!newErrorDesc.trim()}
                                className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--creekside-blue)] rounded-md hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                Add
                              </button>
                            </div>

                            {/* Error list */}
                            {loadingErrors ? (
                              <p className="text-sm text-slate-400">Loading errors...</p>
                            ) : memberErrors.length === 0 ? (
                              <p className="text-sm text-slate-400">No errors recorded</p>
                            ) : (
                              <div className="space-y-1.5">
                                {memberErrors.map((err) => (
                                  <div key={err.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)]">
                                    {editingError === err.id ? (
                                      <>
                                        <input
                                          type="date"
                                          value={editDate}
                                          onChange={(e) => setEditDate(e.target.value)}
                                          className="px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)]"
                                        />
                                        <input
                                          type="text"
                                          value={editDesc}
                                          onChange={(e) => setEditDesc(e.target.value)}
                                          onKeyDown={(e) => { if (e.key === 'Enter') updateError(err.id); if (e.key === 'Escape') setEditingError(null); }}
                                          className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)]"
                                          autoFocus
                                        />
                                        <button onClick={() => updateError(err.id)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Save</button>
                                        <button onClick={() => setEditingError(null)} className="text-xs text-slate-400 hover:text-slate-600 font-medium">Cancel</button>
                                      </>
                                    ) : (
                                      <>
                                        <span className="text-xs text-[var(--text-secondary)] shrink-0 w-24">{err.error_date}</span>
                                        <span className="text-sm text-[var(--text-primary)] flex-1">{err.description}</span>
                                        <button
                                          onClick={() => { setEditingError(err.id); setEditDesc(err.description); setEditDate(err.error_date); }}
                                          className="text-xs text-[var(--creekside-blue)] hover:text-blue-800 font-medium"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={() => deleteError(err.id)}
                                          className="text-xs text-red-500 hover:text-red-700 font-medium"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
