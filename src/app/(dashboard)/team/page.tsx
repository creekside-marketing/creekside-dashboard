'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';

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
}

function _StatusDot({ status }: { status: string }) {
  const lower = status?.toLowerCase() ?? '';
  const dotColor = lower === 'active' ? 'bg-emerald-500' : 'bg-slate-300';
  const textColor = lower === 'active' ? 'text-emerald-700' : 'text-slate-500';
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
      className="text-sm text-slate-700 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
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
      className="text-sm text-slate-500 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors text-left max-w-[200px] truncate"
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
      className="text-sm text-slate-700 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
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

  useEffect(() => { fetchData(); }, [fetchData]);

  // Calculate revenue contribution per team member (from clients they manage or operate)
  const memberRevenue = useMemo(() => {
    const revenueMap: Record<string, number> = {};
    // Group client revenue by client_name (sum across platforms)
    const clientRevByName: Record<string, number> = {};
    for (const c of clientData) {
      if (c.monthly_revenue != null) {
        clientRevByName[c.client_name] = (clientRevByName[c.client_name] ?? 0) + Number(c.monthly_revenue);
      }
    }
    // Attribute revenue to managers
    const clientManagerSeen = new Set<string>();
    for (const c of clientData) {
      if (c.account_manager && !clientManagerSeen.has(c.client_name)) {
        clientManagerSeen.add(c.client_name);
        const rev = clientRevByName[c.client_name] ?? 0;
        const shortName = c.account_manager;
        revenueMap[shortName] = (revenueMap[shortName] ?? 0) + rev;
      }
    }
    return revenueMap;
  }, [clientData]);

  // Estimated monthly cost per team member
  const memberCost = useMemo(() => {
    const costMap: Record<string, { cost: number; note: string }> = {};
    for (const m of members) {
      const firstName = m.name.split(' ')[0];
      if (m.employment_type === 'owner') {
        costMap[firstName] = { cost: 8500, note: '$8,500/mo' };
      } else if (m.hourly_rate) {
        // Estimate: contractors ~20hrs/week, full-time based on notes
        const notesStr = m.notes ?? '';
        const monthlyMatch = notesStr.match(/\$([0-9,]+)\/month/);
        if (monthlyMatch) {
          costMap[firstName] = { cost: parseFloat(monthlyMatch[1].replace(',', '')), note: `${monthlyMatch[0]}` };
        } else if (notesStr.includes('44 hours/week')) {
          costMap[firstName] = { cost: m.hourly_rate * 44 * 4.33, note: `$${m.hourly_rate}/hr × 44hrs/wk` };
        } else {
          costMap[firstName] = { cost: 0, note: `$${m.hourly_rate}/hr` };
        }
      }
    }
    return costMap;
  }, [members]);

  // Utilization: estimated_hours_per_month / capacity
  const getUtilization = useCallback((member: TeamMember): { pct: number; color: string; label: string } | null => {
    if (member.employment_type === 'owner') return null;
    if (member.estimated_hours_per_month == null) return null;
    const capacity = member.employment_type === 'full_time' ? 173 : 160;
    const pct = (member.estimated_hours_per_month / capacity) * 100;
    let color: string;
    let label: string;
    if (pct > 90) { color = 'text-red-600'; label = 'Overloaded'; }
    else if (pct >= 70) { color = 'text-emerald-600'; label = 'Healthy'; }
    else if (pct >= 50) { color = 'text-amber-600'; label = 'Under'; }
    else { color = 'text-red-600'; label = 'Low'; }
    return { pct, color, label };
  }, []);

  // Client counts per team member (by first name match on platform_operator or account_manager)
  const memberClientCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    // Deduplicate clients by client_name (multiple platform rows per client)
    const clientsByManager: Record<string, Set<string>> = {};
    for (const c of clientData) {
      for (const role of [c.account_manager, c.platform_operator]) {
        if (role) {
          if (!clientsByManager[role]) clientsByManager[role] = new Set();
          clientsByManager[role].add(c.client_name);
        }
      }
    }
    for (const [name, clients] of Object.entries(clientsByManager)) {
      counts[name] = clients.size;
    }
    return counts;
  }, [clientData]);

  // Summary stats
  const summaryStats = useMemo(() => {
    let totalCost = 0;
    let totalRevenue = 0;
    for (const m of members) {
      if (m.status !== 'active') continue;
      const firstName = m.name.split(' ')[0];
      if (m.estimated_hours_per_month != null && m.hourly_rate != null) {
        totalCost += m.hourly_rate * m.estimated_hours_per_month;
      } else {
        const cost = memberCost[firstName];
        if (cost && cost.cost > 0) totalCost += cost.cost;
      }
    }
    // Sum unique client revenue
    const clientRevByName: Record<string, number> = {};
    for (const c of clientData) {
      if (c.monthly_revenue != null) {
        clientRevByName[c.client_name] = (clientRevByName[c.client_name] ?? 0) + Number(c.monthly_revenue);
      }
    }
    totalRevenue = Object.values(clientRevByName).reduce((sum, v) => sum + v, 0);
    const laborRatio = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0;
    let ratioColor: string;
    if (laborRatio < 50) ratioColor = 'text-emerald-600';
    else if (laborRatio <= 65) ratioColor = 'text-amber-600';
    else ratioColor = 'text-red-600';
    return { totalCost, totalRevenue, laborRatio, ratioColor };
  }, [members, clientData, memberCost]);

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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Team Members</h2>
        <p className="text-sm text-slate-500 mt-1">Manage team members, rates, and notes</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
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
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Team Cost / Mo</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              ${summaryStats.totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Revenue / Mo</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              ${summaryStats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Labor Ratio</p>
            <p className={`text-xl font-bold mt-1 ${summaryStats.ratioColor}`}>
              {summaryStats.laborRatio.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Loading team members...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">No team members found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rate</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Est. Hours/Mo</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Utilization</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Clients</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Est. Monthly Cost</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Revenue Contribution</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Pre-work Sheet</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium text-slate-900">{member.name}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-slate-600">{member.role}</span>
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
                    <td className="py-3 px-4 text-center text-sm">
                      {(() => {
                        const util = getUtilization(member);
                        if (!util) return <span className="text-slate-300">--</span>;
                        return (
                          <span className={`font-medium ${util.color}`} title={util.label}>
                            {util.pct.toFixed(0)}%
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4 text-center text-sm text-slate-700">
                      {(() => {
                        const firstName = member.name.split(' ')[0];
                        const count = memberClientCounts[firstName] ?? 0;
                        return count > 0 ? count : <span className="text-slate-300">--</span>;
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-slate-600">
                      {(() => {
                        // Prefer estimated_hours_per_month * hourly_rate when both are set
                        if (member.estimated_hours_per_month != null && member.hourly_rate != null) {
                          const cost = member.hourly_rate * member.estimated_hours_per_month;
                          return `$${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                        }
                        const firstName = member.name.split(' ')[0];
                        const cost = memberCost[firstName];
                        if (!cost) return <span className="text-slate-300">--</span>;
                        if (cost.cost > 0) return `$${cost.cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                        return <span className="text-slate-400" title={cost.note}>{cost.note}</span>;
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right text-sm font-medium text-emerald-700">
                      {(() => {
                        const firstName = member.name.split(' ')[0];
                        // Check common short names used in reporting_clients
                        const nameVariants = [firstName, member.name.split(' ').map(n => n[0] + n.slice(1)).join(' ')];
                        const rev = nameVariants.reduce((found, n) => found || memberRevenue[n], 0 as number | undefined);
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
