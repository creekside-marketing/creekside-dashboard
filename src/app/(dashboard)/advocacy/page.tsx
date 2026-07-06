'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';

type CatalogItem = {
  item_key: string;
  label: string;
  category: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};

type ClientRow = {
  id: string;
  name: string;
  status: string;
  category: string; // 'active' | 'retainer'
};

type StatusRow = {
  client_id: string;
  item_key: string;
  asked_at: string | null;
  asked_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  notes: string | null;
};

type ApiPayload = {
  items: CatalogItem[];
  clients: ClientRow[];
  statuses: StatusRow[];
};

function statusKey(clientId: string, itemKey: string) {
  return `${clientId}::${itemKey}`;
}

export default function AdvocacyPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeChurned, setIncludeChurned] = useState(false);
  const [includeInactiveItems, setIncludeInactiveItems] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (includeChurned) q.set('include_churned', 'true');
      if (includeInactiveItems) q.set('include_inactive_items', 'true');
      const res = await fetch(`/api/advocacy?${q.toString()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as ApiPayload;
      setData(json);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [includeChurned, includeInactiveItems]);

  useEffect(() => {
    load();
  }, [load]);

  const statusMap = useMemo(() => {
    const m = new Map<string, StatusRow>();
    for (const s of data?.statuses ?? []) m.set(statusKey(s.client_id, s.item_key), s);
    return m;
  }, [data]);

  const toggle = useCallback(
    async (clientId: string, itemKey: string, field: 'asked' | 'completed', value: boolean) => {
      const key = `${clientId}::${itemKey}::${field}`;
      setSavingKey(key);
      try {
        const res = await fetch('/api/advocacy/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, item_key: itemKey, field, value }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? res.statusText);
        }
        await load();
      } catch (e) {
        alert(`Failed: ${e}`);
      } finally {
        setSavingKey(null);
      }
    },
    [load],
  );

  const itemsByCategory = useMemo(() => {
    const g: Record<string, CatalogItem[]> = {};
    for (const it of data?.items ?? []) {
      (g[it.category] ??= []).push(it);
    }
    return g;
  }, [data]);

  const categoryOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const it of data?.items ?? []) {
      if (!seen.has(it.category)) {
        seen.add(it.category);
        order.push(it.category);
      }
    }
    return order;
  }, [data]);

  const rollup = useMemo(() => {
    if (!data) return { asked: 0, done: 0, total: 0, byItem: {} as Record<string, { asked: number; done: number }> };
    const eligibleClients = data.clients.length;
    const byItem: Record<string, { asked: number; done: number }> = {};
    let asked = 0;
    let done = 0;
    for (const it of data.items) {
      byItem[it.item_key] = { asked: 0, done: 0 };
    }
    for (const c of data.clients) {
      for (const it of data.items) {
        const s = statusMap.get(statusKey(c.id, it.item_key));
        if (s?.asked_at) {
          asked++;
          byItem[it.item_key].asked++;
        }
        if (s?.completed_at) {
          done++;
          byItem[it.item_key].done++;
        }
      }
    }
    return { asked, done, total: eligibleClients * data.items.length, byItem };
  }, [data, statusMap]);

  if (loading) return <div className="p-6 text-slate-500">Loading advocacy data…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Advocacy</h1>
          <p className="text-sm text-slate-500 mt-1">
            Growth asks per client. Toggle <span className="font-semibold">Asked?</span> once we&rsquo;ve requested it, then{' '}
            <span className="font-semibold">Done?</span> once they follow through.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={includeChurned}
              onChange={(e) => setIncludeChurned(e.target.checked)}
            />
            Include churned
          </label>
          <button
            onClick={() => setShowAdmin((s) => !s)}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50"
          >
            {showAdmin ? 'Close admin' : 'Manage items'}
          </button>
        </div>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Clients" value={String(data.clients.length)} />
        <StatCard label="Items" value={String(data.items.length)} />
        <StatCard label="Asked" value={`${rollup.asked} / ${rollup.total}`} accent="amber" />
        <StatCard label="Done" value={`${rollup.done} / ${rollup.total}`} accent="green" />
      </div>

      {/* Admin section */}
      {showAdmin && (
        <AdminSection
          items={data.items}
          includeInactive={includeInactiveItems}
          onToggleInactive={setIncludeInactiveItems}
          onChanged={load}
        />
      )}

      {/* Main table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-slate-50 z-10 min-w-[200px]">
                Client
              </th>
              {categoryOrder.map((cat) => (
                <th
                  key={cat}
                  className="text-center px-3 py-2 border-l border-slate-200"
                  colSpan={itemsByCategory[cat].length}
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    {cat}
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 bg-slate-50 z-10"></th>
              {categoryOrder.flatMap((cat) =>
                itemsByCategory[cat].map((it) => {
                  const r = rollup.byItem[it.item_key];
                  return (
                    <th
                      key={it.item_key}
                      className="px-2 py-2 border-l border-slate-100 text-[11px] font-medium text-slate-700 min-w-[140px] align-bottom"
                      title={it.description ?? ''}
                    >
                      <div>{it.label}</div>
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                        {r.done}/{r.asked} done · {r.asked}/{data.clients.length} asked
                      </div>
                    </th>
                  );
                }),
              )}
            </tr>
          </thead>
          <tbody>
            {data.clients.map((client) => (
              <tr key={client.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                <td className="px-3 py-2 sticky left-0 bg-white hover:bg-slate-50/60 z-10 font-medium text-slate-800">
                  <div>{client.name}</div>
                  {client.category === 'retainer' && (
                    <span className="text-[10px] uppercase tracking-wide text-purple-600 font-semibold">
                      retainer
                    </span>
                  )}
                  {client.status !== 'active' && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold ml-1">
                      {client.status}
                    </span>
                  )}
                </td>
                {categoryOrder.flatMap((cat) =>
                  itemsByCategory[cat].map((it) => {
                    const s = statusMap.get(statusKey(client.id, it.item_key));
                    const asked = !!s?.asked_at;
                    const done = !!s?.completed_at;
                    const askedKey = `${client.id}::${it.item_key}::asked`;
                    const doneKey = `${client.id}::${it.item_key}::completed`;
                    return (
                      <td
                        key={it.item_key}
                        className="px-2 py-2 border-l border-slate-100 text-center align-middle"
                      >
                        <div className="flex flex-col items-center gap-1">
                          <ToggleChip
                            label="Asked"
                            value={asked}
                            disabled={savingKey === askedKey}
                            onClick={() => toggle(client.id, it.item_key, 'asked', !asked)}
                          />
                          <ToggleChip
                            label="Done"
                            value={done}
                            disabled={!asked || savingKey === doneKey}
                            onClick={() => toggle(client.id, it.item_key, 'completed', !done)}
                            variant="green"
                          />
                        </div>
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'amber';
}) {
  const color =
    accent === 'green'
      ? 'text-emerald-700 border-emerald-200'
      : accent === 'amber'
      ? 'text-amber-700 border-amber-200'
      : 'text-slate-700 border-slate-200';
  return (
    <div className={`rounded-lg border ${color} bg-white px-4 py-3`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function ToggleChip({
  label,
  value,
  disabled,
  onClick,
  variant,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: 'green';
}) {
  const on =
    variant === 'green'
      ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
      : 'bg-amber-100 text-amber-800 ring-1 ring-amber-300';
  const off = 'bg-slate-50 text-slate-500 ring-1 ring-slate-200';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded transition-opacity ${
        value ? on : off
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
    >
      {label}: {value ? 'Yes' : 'No'}
    </button>
  );
}

function AdminSection({
  items,
  includeInactive,
  onToggleInactive,
  onChanged,
}: {
  items: CatalogItem[];
  includeInactive: boolean;
  onToggleInactive: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [newItem, setNewItem] = useState({
    label: '',
    category: 'Public proof',
    description: '',
    item_key: '',
  });
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!newItem.label.trim() || !newItem.category.trim()) {
      alert('Label and category required');
      return;
    }
    const key =
      newItem.item_key.trim() ||
      newItem.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    setSaving(true);
    try {
      const res = await fetch('/api/advocacy/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_key: key,
          label: newItem.label,
          category: newItem.category,
          description: newItem.description,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? res.statusText);
      }
      setNewItem({ label: '', category: newItem.category, description: '', item_key: '' });
      onChanged();
    } catch (e) {
      alert(`Failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (item_key: string, updates: Partial<CatalogItem>) => {
    try {
      const res = await fetch('/api/advocacy/catalog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_key, ...updates }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? res.statusText);
      }
      onChanged();
    } catch (e) {
      alert(`Failed: ${e}`);
    }
  };

  return (
    <div className="mb-6 rounded-lg border border-slate-300 bg-slate-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Manage advocacy items</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Add new asks, rename existing ones, or deactivate items you no longer track. Peterson-friendly.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onToggleInactive(e.target.checked)}
          />
          Show inactive
        </label>
      </div>

      {/* Add new */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4 bg-white rounded p-3 border border-slate-200">
        <input
          type="text"
          value={newItem.label}
          onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
          placeholder="Label (e.g. Podcast interview)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm col-span-2"
        />
        <input
          type="text"
          value={newItem.category}
          onChange={(e) => setNewItem({ ...newItem, category: e.target.value })}
          placeholder="Category"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          value={newItem.description}
          onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
          placeholder="Description (optional)"
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={saving}
          className="bg-slate-800 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add item'}
        </button>
      </div>

      {/* Existing */}
      <div className="space-y-1">
        {items.map((it) => (
          <div
            key={it.item_key}
            className="flex items-center gap-2 bg-white rounded px-3 py-2 border border-slate-200 text-sm"
          >
            <input
              type="text"
              defaultValue={it.label}
              onBlur={(e) => {
                if (e.target.value !== it.label) patch(it.item_key, { label: e.target.value });
              }}
              className="border border-slate-200 rounded px-2 py-1 text-sm flex-1"
            />
            <input
              type="text"
              defaultValue={it.category}
              onBlur={(e) => {
                if (e.target.value !== it.category) patch(it.item_key, { category: e.target.value });
              }}
              className="border border-slate-200 rounded px-2 py-1 text-sm w-40"
            />
            <input
              type="number"
              defaultValue={it.sort_order}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (!Number.isNaN(n) && n !== it.sort_order) patch(it.item_key, { sort_order: n });
              }}
              className="border border-slate-200 rounded px-2 py-1 text-sm w-20"
            />
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={it.active}
                onChange={(e) => patch(it.item_key, { active: e.target.checked })}
              />
              Active
            </label>
            <span className="text-[10px] text-slate-400 font-mono">{it.item_key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
