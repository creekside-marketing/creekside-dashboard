'use client';

import { useEffect, useState, useCallback } from 'react';

interface Goal {
  id: string;
  team_member_id: string;
  client_name: string;
  platform: string | null;
  goal_metric: string;
  goal_target: number;
  bonus_amount: number;
  month: string;
  achieved: boolean;
  notes: string | null;
  team_members: { name: string } | null;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

const GOAL_METRICS = ['Leads', 'CPL', 'ROAS', 'Spend Target'];

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatMonthDisplay(month: string): string {
  const d = new Date(month + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

function getMonthOptions(): { value: string; label: string }[] {
  const options = [];
  const now = new Date();
  for (let i = -2; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    options.push({ value, label });
  }
  return options;
}

export default function PerformanceGoals({ clientName }: { clientName: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(getCurrentMonth());
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // New goal form state
  const [newGoal, setNewGoal] = useState({
    team_member_id: '',
    goal_metric: 'Leads',
    goal_target: '',
    bonus_amount: '',
    platform: '',
  });

  const fetchGoals = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals?client_name=${encodeURIComponent(clientName)}&month=${month}`);
      const data = await res.json();
      if (Array.isArray(data)) setGoals(data);
    } finally {
      setLoading(false);
    }
  }, [clientName, month]);

  const fetchTeamMembers = useCallback(async () => {
    const res = await fetch('/api/team');
    const data = await res.json();
    if (Array.isArray(data)) setTeamMembers(data);
  }, []);

  useEffect(() => { fetchGoals(); }, [fetchGoals]);
  useEffect(() => { fetchTeamMembers(); }, [fetchTeamMembers]);

  const handleAddGoal = async () => {
    if (!newGoal.team_member_id || !newGoal.goal_target) return;

    setSaving(true);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_member_id: newGoal.team_member_id,
          client_name: clientName,
          platform: newGoal.platform || null,
          goal_metric: newGoal.goal_metric,
          goal_target: parseFloat(newGoal.goal_target),
          bonus_amount: parseFloat(newGoal.bonus_amount) || 0,
          month,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setGoals((prev) => [created, ...prev]);
        setShowAddForm(false);
        setNewGoal({ team_member_id: '', goal_metric: 'Leads', goal_target: '', bonus_amount: '', platform: '' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAchieved = async (goal: Goal) => {
    const res = await fetch('/api/goals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: goal.id, achieved: !goal.achieved }),
    });
    if (res.ok) {
      setGoals((prev) =>
        prev.map((g) => (g.id === goal.id ? { ...g, achieved: !g.achieved } : g))
      );
    }
  };

  const handleInlineUpdate = async (goalId: string, field: string, value: unknown) => {
    const res = await fetch('/api/goals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: goalId, [field]: value }),
    });
    if (res.ok) {
      const updated = await res.json();
      setGoals((prev) => prev.map((g) => (g.id === goalId ? updated : g)));
    }
  };

  const handleDelete = async (goalId: string) => {
    const res = await fetch(`/api/goals?id=${goalId}`, { method: 'DELETE' });
    if (res.ok) {
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    }
  };

  const monthOptions = getMonthOptions();

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Performance Goals & Bonuses</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatMonthDisplay(month)} — contractor performance targets
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={month}
            onChange={(e) => { setMonth(e.target.value); setLoading(true); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
          >
            {monthOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[var(--creekside-blue)] rounded-lg hover:bg-[var(--creekside-light-blue)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Goal
          </button>
        </div>
      </div>

      {/* Add Goal Form */}
      {showAddForm && (
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <select
              value={newGoal.team_member_id}
              onChange={(e) => setNewGoal({ ...newGoal, team_member_id: e.target.value })}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            >
              <option value="">Select contractor...</option>
              {teamMembers.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </select>
            <select
              value={newGoal.goal_metric}
              onChange={(e) => setNewGoal({ ...newGoal, goal_metric: e.target.value })}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            >
              {GOAL_METRICS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Target value"
              value={newGoal.goal_target}
              onChange={(e) => setNewGoal({ ...newGoal, goal_target: e.target.value })}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Bonus ($)"
              value={newGoal.bonus_amount}
              onChange={(e) => setNewGoal({ ...newGoal, bonus_amount: e.target.value })}
              className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            />
            <button
              onClick={handleAddGoal}
              disabled={saving || !newGoal.team_member_id || !newGoal.goal_target}
              className="text-sm font-medium text-white bg-[var(--creekside-blue)] rounded-lg px-4 py-2 hover:bg-[var(--creekside-light-blue)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Goals Table */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm">Loading goals...</div>
      ) : goals.length === 0 ? (
        <div className="p-12 text-center text-slate-400 text-sm">No goals set for this month</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contractor</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Goal Metric</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Target</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Bonus</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Achieved</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {goals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  onToggleAchieved={handleToggleAchieved}
                  onUpdate={handleInlineUpdate}
                  onDelete={handleDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GoalRow({
  goal,
  onToggleAchieved,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  onToggleAchieved: (goal: Goal) => void;
  onUpdate: (id: string, field: string, value: unknown) => void;
  onDelete: (id: string) => void;
}) {
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetValue, setTargetValue] = useState(goal.goal_target.toString());
  const [editingBonus, setEditingBonus] = useState(false);
  const [bonusValue, setBonusValue] = useState(goal.bonus_amount.toString());
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(goal.notes ?? '');
  const [editingMetric, setEditingMetric] = useState(false);

  const saveTarget = () => {
    const parsed = parseFloat(targetValue);
    if (!isNaN(parsed) && parsed !== goal.goal_target) {
      onUpdate(goal.id, 'goal_target', parsed);
    }
    setEditingTarget(false);
  };

  const saveBonus = () => {
    const parsed = parseFloat(bonusValue);
    if (!isNaN(parsed) && parsed !== goal.bonus_amount) {
      onUpdate(goal.id, 'bonus_amount', parsed);
    }
    setEditingBonus(false);
  };

  const saveNotes = () => {
    if (notesValue !== (goal.notes ?? '')) {
      onUpdate(goal.id, 'notes', notesValue);
    }
    setEditingNotes(false);
  };

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
      <td className="py-3 px-4">
        <span className="text-sm font-medium text-slate-900">
          {goal.team_members?.name ?? 'Unknown'}
        </span>
      </td>
      <td className="py-3 px-4">
        {editingMetric ? (
          <select
            value={goal.goal_metric}
            onChange={(e) => { onUpdate(goal.id, 'goal_metric', e.target.value); setEditingMetric(false); }}
            onBlur={() => setEditingMetric(false)}
            className="text-sm border border-slate-300 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            autoFocus
          >
            {GOAL_METRICS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditingMetric(true)}
            className="text-sm text-slate-600 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
          >
            {goal.goal_metric}
          </button>
        )}
      </td>
      <td className="py-3 px-4">
        {editingTarget ? (
          <input
            type="number"
            step="0.01"
            className="w-24 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            onBlur={saveTarget}
            onKeyDown={(e) => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditingTarget(false); }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingTarget(true)}
            className="text-sm text-slate-700 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
          >
            {goal.goal_target.toLocaleString()}
          </button>
        )}
      </td>
      <td className="py-3 px-4">
        {editingBonus ? (
          <input
            type="number"
            step="0.01"
            className="w-24 px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            value={bonusValue}
            onChange={(e) => setBonusValue(e.target.value)}
            onBlur={saveBonus}
            onKeyDown={(e) => { if (e.key === 'Enter') saveBonus(); if (e.key === 'Escape') setEditingBonus(false); }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingBonus(true)}
            className="text-sm text-slate-700 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors"
          >
            ${goal.bonus_amount.toFixed(2)}
          </button>
        )}
      </td>
      <td className="py-3 px-4 text-center">
        <input
          type="checkbox"
          checked={goal.achieved}
          onChange={() => onToggleAchieved(goal)}
          className="w-4 h-4 rounded border-slate-300 text-[var(--creekside-blue)] focus:ring-[var(--creekside-blue)] cursor-pointer"
        />
      </td>
      <td className="py-3 px-4">
        {editingNotes ? (
          <input
            type="text"
            className="w-full px-2 py-1 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent"
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            onBlur={saveNotes}
            onKeyDown={(e) => { if (e.key === 'Enter') saveNotes(); if (e.key === 'Escape') setEditingNotes(false); }}
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingNotes(true)}
            className="text-sm text-slate-500 hover:text-[var(--creekside-blue)] cursor-pointer transition-colors text-left max-w-[180px] truncate"
            title={goal.notes || 'Click to add notes'}
          >
            {goal.notes || '--'}
          </button>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <button
          onClick={() => onDelete(goal.id)}
          className="text-slate-300 hover:text-red-500 transition-colors"
          title="Delete goal"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </td>
    </tr>
  );
}
