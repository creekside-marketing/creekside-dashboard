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

type ClientCategory = 'active' | 'retainer' | 'archived';

type ClientRow = {
  id: string;
  name: string;
  status: string;
  category: ClientCategory;
  advocacy_hidden: boolean;
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

const SECTION_ORDER: ClientCategory[] = ['active', 'retainer', 'archived'];
const SECTION_LABEL: Record<ClientCategory, string> = {
  active: 'Active clients',
  retainer: 'Retainer clients',
  archived: 'Archived clients (churned / inactive)',
};

export default function AdvocacyPage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeInactiveItems, setIncludeInactiveItems] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
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
  }, [includeInactiveItems]);

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

      let previousStatuses: StatusRow[] | null = null;
      setData((prev) => {
        if (!prev) return prev;
        previousStatuses = prev.statuses;
        const now = new Date().toISOString();
        const existing = prev.statuses.find(
          (s) => s.client_id === clientId && s.item_key === itemKey,
        );
        const base: StatusRow = existing ?? {
          client_id: clientId,
          item_key: itemKey,
          asked_at: null,
          asked_by: null,
          completed_at: null,
          completed_by: null,
          notes: null,
        };
        const next: StatusRow = { ...base };
        if (field === 'asked') {
          next.asked_at = value ? (base.asked_at ?? now) : null;
          if (!value) {
            next.completed_at = null;
            next.completed_by = null;
          }
        } else {
          next.completed_at = value ? (base.completed_at ?? now) : null;
        }
        const others = prev.statuses.filter(
          (s) => !(s.client_id === clientId && s.item_key === itemKey),
        );
        return { ...prev, statuses: [...others, next] };
      });

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
        const json = (await res.json()) as { ok: boolean; row: StatusRow };
        if (json?.row) {
          setData((prev) => {
            if (!prev) return prev;
            const others = prev.statuses.filter(
              (s) => !(s.client_id === clientId && s.item_key === itemKey),
            );
            return { ...prev, statuses: [...others, json.row] };
          });
        }
      } catch (e) {
        if (previousStatuses) {
          const rollback = previousStatuses;
          setData((prev) => (prev ? { ...prev, statuses: rollback } : prev));
        }
        alert(`Failed: ${e}`);
      } finally {
        setSavingKey(null);
      }
    },
    [],
  );

  const toggleHidden = useCallback(async (clientId: string, hidden: boolean) => {
    const previousClients = data?.clients;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clients: prev.clients.map((c) =>
          c.id === clientId ? { ...c, advocacy_hidden: hidden } : c,
        ),
      };
    });
    try {
      const res = await fetch('/api/advocacy/hide', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, hidden }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? res.statusText);
      }
    } catch (e) {
      if (previousClients) {
        const rollback = previousClients;
        setData((prev) => (prev ? { ...prev, clients: rollback } : prev));
      }
      alert(`Failed: ${e}`);
    }
  }, [data]);

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

  // Group clients by section (active / retainer / archived), filter hidden ones
  // out of the visible list unless "showHidden" is on.
  const clientsBySection = useMemo(() => {
    const g: Record<ClientCategory, ClientRow[]> = { active: [], retainer: [], archived: [] };
    for (const c of data?.clients ?? []) {
      if (c.advocacy_hidden && !showHidden) continue;
      g[c.category].push(c);
    }
    return g;
  }, [data, showHidden]);

  // Rollup counts EXCLUDE hidden clients (per Cade: hidden clients drop out of
  // the totals so the Asked/Done tallies reflect only the ones we're actively
  // pursuing).
  const rollup = useMemo(() => {
    if (!data) return { asked: 0, done: 0, total: 0, visibleClients: 0, byItem: {} as Record<string, { asked: number; done: number }> };
    const visible = data.clients.filter((c) => !c.advocacy_hidden);
    const byItem: Record<string, { asked: number; done: number }> = {};
    let asked = 0;
    let done = 0;
    for (const it of data.items) {
      byItem[it.item_key] = { asked: 0, done: 0 };
    }
    for (const c of visible) {
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
    return {
      asked,
      done,
      total: visible.length * data.items.length,
      visibleClients: visible.length,
      byItem,
    };
  }, [data, statusMap]);

  const hiddenCount = useMemo(
    () => (data?.clients ?? []).filter((c) => c.advocacy_hidden).length,
    [data],
  );

  if (loading) return <div className="p-6 text-slate-500">Loading advocacy data…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!data) return null;

  // Column width tracking so section header rows can span the full item grid
  const totalItemCols = categoryOrder.reduce(
    (sum, cat) => sum + (itemsByCategory[cat]?.length ?? 0),
    0,
  );

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
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden ({hiddenCount})
          </label>
          <button
            onClick={() => setShowAdmin((s) => !s)}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50"
          >
            {showAdmin ? 'Close admin' : 'Manage items'}
          </button>
        </div>
      </div>

      {/* Rollup — reflects visible (non-hidden) clients only */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Clients (visible)" value={String(rollup.visibleClients)} />
        <StatCard label="Items" value={String(data.items.length)} />
        <StatCard label="Asked" value={`${rollup.asked} / ${rollup.total}`} accent="amber" />
        <StatCard label="Done" value={`${rollup.done} / ${rollup.total}`} accent="green" />
      </div>

      {showAdmin && (
        <AdminSection
          items={data.items}
          includeInactive={includeInactiveItems}
          onToggleInactive={setIncludeInactiveItems}
          onChanged={load}
        />
      )}

      {/* Main table — no overflow wrapper so sticky headers latch to the page viewport */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 top-0 bg-slate-50 z-30 min-w-[200px] shadow-[0_1px_0_0_#e2e8f0]">
                Client
              </th>
              {categoryOrder.map((cat) => (
                <th
                  key={cat}
                  className="text-center px-3 py-2 border-l border-slate-200 sticky top-0 bg-slate-50 z-20 shadow-[0_1px_0_0_#e2e8f0]"
                  colSpan={itemsByCategory[cat].length}
                >
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    {cat}
                  </div>
                </th>
              ))}
              <th className="sticky top-0 bg-slate-50 z-20 shadow-[0_1px_0_0_#e2e8f0] w-16"></th>
            </tr>
            <tr>
              <th className="sticky left-0 top-[33px] bg-slate-50 z-30 shadow-[0_1px_0_0_#e2e8f0]"></th>
              {categoryOrder.flatMap((cat) =>
                itemsByCategory[cat].map((it) => {
                  const r = rollup.byItem[it.item_key];
                  return (
                    <th
                      key={it.item_key}
                      className="px-2 py-2 border-l border-slate-100 text-[11px] font-medium text-slate-700 min-w-[140px] align-bottom sticky top-[33px] bg-slate-50 z-20 shadow-[0_1px_0_0_#e2e8f0]"
                      title={it.description ?? ''}
                    >
                      <div>{it.label}</div>
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                        {r.done}/{r.asked} done · {r.asked}/{rollup.visibleClients} asked
                      </div>
                    </th>
                  );
                }),
              )}
              <th className="sticky top-[33px] bg-slate-50 z-20 shadow-[0_1px_0_0_#e2e8f0]"></th>
            </tr>
          </thead>
          <tbody>
            {SECTION_ORDER.map((section) => {
              const rows = clientsBySection[section];
              if (rows.length === 0) return null;
              const isArchived = section === 'archived';
              return (
                <React.Fragment key={section}>
                  <tr className="bg-slate-100 border-y-2 border-slate-300">
                    <td
                      colSpan={1 + totalItemCols + 1}
                      className="px-3 py-2 sticky left-0 bg-slate-100 text-xs font-semibold text-slate-700 uppercase tracking-wider"
                    >
                      {SECTION_LABEL[section]} · {rows.length}
                    </td>
                  </tr>
                  {rows.map((client) => (
                    <tr key={client.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2 sticky left-0 bg-white hover:bg-slate-50/60 z-10 font-medium text-slate-800">
                        <div>{client.name}</div>
                        <div className="flex gap-1 mt-0.5">
                          {client.category === 'retainer' && (
                            <span className="text-[10px] uppercase tracking-wide text-purple-600 font-semibold">
                              retainer
                            </span>
                          )}
                          {client.status !== 'active' && (
                            <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                              {client.status}
                            </span>
                          )}
                          {client.advocacy_hidden && (
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold bg-slate-200 px-1 rounded">
                              hidden
                            </span>
                          )}
                        </div>
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
                                />
                              </div>
                            </td>
                          );
                        }),
                      )}
                      <td className="px-2 py-2 text-center align-middle">
                        {isArchived && (
                          <button
                            onClick={() => toggleHidden(client.id, !client.advocacy_hidden)}
                            className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded text-slate-600 hover:bg-slate-200"
                            title={
                              client.advocacy_hidden
                                ? 'Un-hide — bring back into totals'
                                : "Hide — we don't think they'll give us any advocacy items"
                            }
                          >
                            {client.advocacy_hidden ? 'Unhide' : 'Hide'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
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
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const on = 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300';
  const off = 'bg-red-100 text-red-800 ring-1 ring-red-300';
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
