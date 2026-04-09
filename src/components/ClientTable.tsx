'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import FilterBar from './FilterBar';
import { calculatePlatformRevenue, describeFeeConfig } from '@/lib/fee-engine';
import type { FeeConfig } from '@/lib/fee-engine';

interface Client {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  ad_account_name: string | null;
  monthly_budget: number | null;
  monthly_revenue: number | null;
  priority: string | null;
  account_manager: string | null;
  platform_operator: string | null;
  status: string;
  fee_config: FeeConfig | null;
  revenue_override: boolean;
  [key: string]: unknown;
}

interface ClientGroup {
  clientName: string;
  rows: Client[];
}

interface ConversionEntry {
  type: string;
  label: string;
  count: number;
}

interface LiveAccountData {
  spend: number;
  conversions: number;
  costPerConversion: number;
  conversionBreakdown: ConversionEntry[];
  error?: string;
}

type SortKey = 'client_name' | 'platform' | 'monthly_budget' | 'est_revenue' | 'priority' | 'account_manager' | 'platform_operator';

// Partners — excluded from the client dashboard entirely
const PARTNER_NAMES = new Set([
  'Bottle.com',
  'Comet Fuel',
  'FirstUp Marketing',
  'Full Circle Media',
  'Suff Digital',
]);

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const COOLDOWN_SECONDS = 300; // 5 minutes

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString();
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

function InlineNotes({
  clientId,
  value,
  onSaved,
}: {
  clientId: string;
  value: string;
  onSaved: (id: string, field: string, val: string) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const notes = value ? value.split('\n').filter(n => n.trim()) : [];

  const saveNotes = async (updatedNotes: string[]) => {
    const newValue = updatedNotes.filter(n => n.trim()).join('\n');
    if (newValue === value) {
      setEditingIdx(null);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, notes: newValue || null }),
      });
      if (res.ok) onSaved(clientId, 'notes', newValue);
    } finally {
      setSaving(false);
      setEditingIdx(null);
    }
  };

  const startEdit = (idx: number, text: string) => {
    setEditingIdx(idx);
    setEditText(text);
  };

  const startAdd = () => {
    setEditingIdx(notes.length);
    setEditText('');
  };

  const handleSave = () => {
    if (editingIdx === null) return;
    const updated = [...notes];
    if (editText.trim()) {
      updated[editingIdx] = editText.trim();
    } else if (editingIdx < notes.length) {
      updated.splice(editingIdx, 1);
    }
    saveNotes(updated);
  };

  return (
    <div className="mt-1 max-w-[320px]" onClick={(e) => e.stopPropagation()}>
      {notes.map((note, idx) => (
        <div key={idx}>
          {editingIdx === idx ? (
            <textarea
              className="w-full px-2 py-1 text-xs text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent resize-y"
              rows={2}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
                if (e.key === 'Escape') setEditingIdx(null);
              }}
              autoFocus
              disabled={saving}
            />
          ) : (
            <button
              onClick={() => startEdit(idx, note)}
              className="block w-full text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-0.5 whitespace-pre-wrap text-left font-normal cursor-pointer hover:bg-amber-100 transition-colors"
            >
              {note}
            </button>
          )}
        </div>
      ))}
      {editingIdx === notes.length ? (
        <textarea
          className="w-full px-2 py-1 text-xs text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent resize-y"
          rows={2}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
            if (e.key === 'Escape') setEditingIdx(null);
          }}
          autoFocus
          disabled={saving}
          placeholder="Type a note..."
        />
      ) : (
        <button
          onClick={startAdd}
          className="text-[11px] text-slate-300 hover:text-slate-500 cursor-pointer transition-colors"
        >
          + Add note
        </button>
      )}
    </div>
  );
}

function InlineCurrencyInput({
  clientId,
  field,
  value,
  onSaved,
  placeholder = '--',
  className = '',
  extraPatchFields,
}: {
  clientId: string;
  field: string;
  value: number | null;
  onSaved: (clientId: string, field: string, val: string) => void;
  placeholder?: string;
  className?: string;
  extraPatchFields?: Record<string, unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(value != null ? String(value) : '');
    setEditing(true);
    setSaved(false);
  };

  const handleSave = async () => {
    const numValue = editValue.trim() === '' ? null : parseFloat(editValue.replace(/[^0-9.]/g, ''));
    if (numValue === value || (numValue === null && value === null)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, [field]: numValue, ...extraPatchFields }),
      });
      if (res.ok) {
        onSaved(clientId, field, numValue as unknown as string);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="text-slate-400 text-sm">$</span>
        <input
          type="text"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          disabled={saving}
          className="w-24 px-1.5 py-0.5 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent text-right tabular-nums"
        />
      </div>
    );
  }

  const displayValue = value != null
    ? `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : null;

  return (
    <span
      onClick={startEdit}
      className={`cursor-pointer inline-flex items-center gap-1 group/edit rounded px-1 -mx-1 transition-colors hover:bg-slate-50 ${className}`}
      title="Click to edit"
    >
      {saving ? (
        <span className="text-slate-400 text-sm">...</span>
      ) : saved ? (
        <span className="text-emerald-500 text-sm">&#10003;</span>
      ) : displayValue ? (
        <>
          <span>{displayValue}</span>
          <svg className="w-3 h-3 text-slate-300 opacity-0 group-hover/edit:opacity-100 transition-opacity flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.15 2.85a1.2 1.2 0 0 1 1.7 1.7l-8.5 8.5-2.5.7.7-2.5 8.6-8.4z" />
          </svg>
        </>
      ) : (
        <span className={`${className ? '' : 'text-slate-300'} group-hover/edit:text-[var(--creekside-blue)] transition-colors`}>{placeholder}</span>
      )}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const lower = status?.toLowerCase() ?? '';
  const dotColor = lower === 'active' ? 'bg-emerald-500' : lower === 'paused' ? 'bg-amber-500' : lower === 'churned' ? 'bg-red-500' : 'bg-slate-300';
  const textColor = lower === 'active' ? 'text-emerald-700' : lower === 'paused' ? 'text-amber-700' : lower === 'churned' ? 'text-red-700' : 'text-slate-500';
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium capitalize ${textColor}`}>
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      {status}
    </span>
  );
}

function LastContactBadge({ daysAgo, source }: { daysAgo: number; source: string }) {
  const sourceLabel = source === 'email' ? 'Email' : source === 'call' ? 'Call' : source === 'chat' ? 'Chat' : source;
  let colorClasses: string;
  if (daysAgo >= 30) {
    colorClasses = 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-600/20';
  } else if (daysAgo >= 21) {
    colorClasses = 'bg-yellow-50 text-yellow-800 ring-1 ring-inset ring-yellow-500/20';
  } else {
    colorClasses = 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20';
  }
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${colorClasses}`}
      title={`Last contact: ${daysAgo}d ago via ${sourceLabel}`}
    >
      {daysAgo}d
    </span>
  );
}

function InlineTableSelect({
  clientId,
  field,
  value,
  options,
  placeholder,
  onSaved,
}: {
  clientId: string;
  field: string;
  value: string | null;
  options: { value: string; label: string }[];
  placeholder: string;
  onSaved: (clientId: string, field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newValue = e.target.value;
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, [field]: newValue }),
      });
      if (res.ok) onSaved(clientId, field, newValue);
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value ?? ''}
        onChange={handleChange}
        onBlur={(e) => { e.stopPropagation(); setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] max-w-[140px]"
      >
        <option value="">--</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`cursor-pointer inline-flex items-center gap-1 group/edit min-w-[60px] min-h-[28px] px-1.5 py-0.5 rounded transition-colors ${
        value
          ? 'hover:text-[var(--creekside-blue)] border-b border-dashed border-transparent hover:border-[var(--creekside-blue)]'
          : 'text-slate-300 hover:text-[var(--creekside-blue)] hover:bg-slate-50'
      }`}
      title={`Click to change`}
    >
      {saving ? '...' : value || placeholder}
      <svg className="w-3 h-3 text-slate-300 opacity-0 group-hover/edit:opacity-100 transition-opacity flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.15 2.85a1.2 1.2 0 0 1 1.7 1.7l-8.5 8.5-2.5.7.7-2.5 8.6-8.4z" />
      </svg>
    </span>
  );
}

function InlinePrioritySelect({
  clientId,
  value,
  onSaved,
}: {
  clientId: string;
  value: string | null;
  onSaved: (clientId: string, field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newValue = e.target.value;
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, priority: newValue }),
      });
      if (res.ok) onSaved(clientId, 'priority', newValue);
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value ?? ''}
        onChange={handleChange}
        onBlur={(e) => { e.stopPropagation(); setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)]"
      >
        <option value="">None</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    );
  }

  if (saving) return <span className="text-xs text-slate-400">...</span>;

  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="cursor-pointer inline-flex items-center gap-1 group/edit">
      <PriorityBadge priority={value} />
      <svg className="w-3 h-3 text-slate-300 opacity-0 group-hover/edit:opacity-100 transition-opacity flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M12.15 2.85a1.2 1.2 0 0 1 1.7 1.7l-8.5 8.5-2.5.7.7-2.5 8.6-8.4z" />
      </svg>
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function InlineStatusSelect({
  clientId,
  value,
  onSaved,
}: {
  clientId: string;
  value: string;
  onSaved: (clientId: string, field: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newValue = e.target.value;
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, status: newValue }),
      });
      if (res.ok) onSaved(clientId, 'status', newValue);
    } catch { /* ignore */ }
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value}
        onChange={handleChange}
        onBlur={(e) => { e.stopPropagation(); setEditing(false); }}
        onClick={(e) => e.stopPropagation()}
        className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)]"
      >
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="churned">Churned</option>
      </select>
    );
  }

  if (saving) return <span className="text-xs text-slate-400">...</span>;

  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="cursor-pointer">
      <StatusDot status={value} />
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

// ── Meta response parsing ──────────────────────────────────────────────

function unwrapPipeboardResponse(json: Record<string, unknown>): Record<string, unknown> {
  // PipeBoard returns MCP JSON-RPC format: { content: [{ text: "{...}" }], structuredContent: { result: "{...}" } }
  if (json.structuredContent) {
    const sc = json.structuredContent as Record<string, unknown>;
    if (typeof sc.result === 'string') {
      try { return JSON.parse(sc.result); } catch { /* fall through */ }
    }
  }
  if (Array.isArray(json.content) && json.content.length > 0) {
    const first = json.content[0] as Record<string, unknown>;
    if (typeof first.text === 'string') {
      try { return JSON.parse(first.text); } catch { /* fall through */ }
    }
  }
  // Already unwrapped or direct format
  return json;
}

// Human-readable labels for Meta action types
// Only track actual business outcomes — no funnel events (add to cart, checkout, etc.)
// Removed duplicates: 'lead' and 'onsite_conversion.lead_grouped' duplicate fb_pixel_lead;
// 'contact_total' duplicates fb_pixel_contact
const META_CONVERSION_LABELS: Record<string, string> = {
  'offsite_conversion.fb_pixel_purchase': 'Purchase',
  'offsite_conversion.fb_pixel_lead': 'Lead',
  'offsite_conversion.fb_pixel_complete_registration': 'Registration',
  'offsite_conversion.fb_pixel_schedule': 'Schedule',
  'offsite_conversion.fb_pixel_contact': 'Contact',
  'offsite_conversion.fb_pixel_submit_application': 'Application',
  'offsite_conversion.fb_pixel_subscribe': 'Subscribe',
  'offsite_conversion.fb_pixel_custom': 'Custom Event',
  'onsite_conversion.messaging_first_reply': 'Messaging Reply',
  'submit_form': 'Form Submit',
};

const META_CONVERSION_TYPES = new Set(Object.keys(META_CONVERSION_LABELS));

function parseMetaInsights(rawJson: Record<string, unknown>): { spend: number; conversions: number; conversionBreakdown: ConversionEntry[] } {
  const json = unwrapPipeboardResponse(rawJson) as { data?: Array<Record<string, unknown>> };
  let totalSpend = 0;
  const breakdownMap: Record<string, number> = {};

  const rows = json?.data ?? [];
  for (const row of rows) {
    totalSpend += parseFloat((row.spend as string) ?? '0');

    const actions = (row.actions ?? []) as Array<{ action_type: string; value: string }>;
    for (const action of actions) {
      const t = action.action_type ?? '';
      if (META_CONVERSION_TYPES.has(t)) {
        const count = parseInt(action.value, 10) || 0;
        breakdownMap[t] = (breakdownMap[t] ?? 0) + count;
      }
    }
  }

  const conversionBreakdown: ConversionEntry[] = Object.entries(breakdownMap)
    .map(([type, count]) => ({ type, label: META_CONVERSION_LABELS[type] || type, count }))
    .sort((a, b) => b.count - a.count);

  const totalConversions = conversionBreakdown.reduce((sum, e) => sum + e.count, 0);

  return { spend: totalSpend, conversions: totalConversions, conversionBreakdown };
}

// ── Google response parsing ────────────────────────────────────────────

function parseGoogleInsights(json: {
  data?: Array<{ cost?: number; conversions?: number }>;
  conversionBreakdown?: Array<{ name: string; conversions: number }>;
}): { spend: number; conversions: number; conversionBreakdown: ConversionEntry[] } {
  let totalSpend = 0;
  let totalConversions = 0;

  const rows = json?.data ?? [];
  for (const row of rows) {
    totalSpend += row.cost ?? 0;
    totalConversions += row.conversions ?? 0;
  }

  const conversionBreakdown: ConversionEntry[] = (json?.conversionBreakdown ?? [])
    .map(cb => ({ type: cb.name, label: cb.name, count: cb.conversions }))
    .sort((a, b) => b.count - a.count);

  return { spend: totalSpend, conversions: totalConversions, conversionBreakdown };
}

// ── Main component ─────────────────────────────────────────────────────

export default function ClientTable() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [selectedManager, setSelectedManager] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('client_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Live data states
  const [liveData, setLiveData] = useState<Record<string, LiveAccountData>>({});
  const [tooltip, setTooltip] = useState<{ x: number; y: number; breakdown: ConversionEntry[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Team members for inline selects
  const [teamMembers, setTeamMembers] = useState<{id: string; name: string; short_name: string; role: string}[]>([]);

  // Last contact data per client
  const [lastContact, setLastContact] = useState<Record<string, { last_contact_date: string; days_ago: number; source: string }>>({});

  // Operator cost data from API (revenue/profit computed client-side)
  const [operatorCosts, setOperatorCosts] = useState<{
    clients: Record<string, { operator_cost: number }>;
    totals: { operator_cost: number };
  } | null>(null);

  useEffect(() => {
    fetch('/api/team')
      .then(res => res.json())
      .then(data => setTeamMembers(data))
      .catch(() => {});
    fetch('/api/clients/last-contact')
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) setLastContact(data);
      })
      .catch(() => {});
    fetch('/api/clients/profitability')
      .then(res => res.json())
      .then(data => {
        if (data && !data.error && data.clients) setOperatorCosts(data);
      })
      .catch(() => {});
  }, []);

  const handleFieldSaved = useCallback((clientId: string, field: string, value: string) => {
    setClients(prev => prev.map(c => {
      if (c.id !== clientId) return c;
      const updated = { ...c, [field]: value };
      // When user manually edits revenue, also set revenue_override
      if (field === 'monthly_revenue' && value != null) {
        updated.revenue_override = true;
      }
      return updated;
    }));
  }, []);

  /** Reset revenue override — clears manual value and lets fee_config recalculate */
  const handleResetRevenue = useCallback(async (clientId: string) => {
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, revenue_override: false, monthly_revenue: null }),
      });
      if (res.ok) {
        setClients(prev => prev.map(c =>
          c.id === clientId ? { ...c, revenue_override: false, monthly_revenue: null } : c
        ));
      }
    } catch { /* ignore */ }
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldownRemaining <= 0) {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
      return;
    }

    cooldownRef.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, [cooldownRemaining]);

  // Fetch client list
  useEffect(() => {
    async function fetchClients() {
      try {
        const res = await fetch('/api/clients');
        if (!res.ok) throw new Error('Failed to fetch clients');
        const data = await res.json();
        setClients(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchClients();
  }, []);

  // ── Refresh live data ───────────────────────────────────────────────

  const refreshData = useCallback(async () => {
    if (refreshing || cooldownRemaining > 0) return;
    setRefreshing(true);

    // Deduplicate accounts by platform + ad_account_id
    const metaAccounts = new Set<string>();
    const googleAccounts = new Set<string>();

    for (const c of clients) {
      const accountId = c.ad_account_id;
      if (!accountId) continue;
      const platform = c.platform?.toLowerCase();
      if (platform === 'meta') metaAccounts.add(accountId);
      else if (platform === 'google') googleAccounts.add(accountId);
    }

    // Build fetch promises
    const fetches: Array<{ accountId: string; platform: 'meta' | 'google'; promise: Promise<Response> }> = [];

    for (const accountId of metaAccounts) {
      fetches.push({
        accountId,
        platform: 'meta',
        promise: fetch(`/api/meta/insights?account_id=${encodeURIComponent(accountId)}&level=account&time_range=last_30d`),
      });
    }

    for (const customerId of googleAccounts) {
      fetches.push({
        accountId: customerId,
        platform: 'google',
        promise: fetch(`/api/google/insights?customer_id=${encodeURIComponent(customerId)}&level=account&date_range=LAST_30_DAYS`),
      });
    }

    // Execute all in parallel
    const results = await Promise.allSettled(fetches.map(f => f.promise));

    const newLiveData: Record<string, LiveAccountData> = {};

    for (let i = 0; i < fetches.length; i++) {
      const { accountId, platform } = fetches[i];
      const result = results[i];

      if (result.status === 'rejected') {
        newLiveData[accountId] = { spend: 0, conversions: 0, costPerConversion: 0, conversionBreakdown: [], error: 'Network error' };
        continue;
      }

      const response = result.value;
      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          errMsg = errBody.error || errMsg;
        } catch { /* ignore parse errors */ }
        newLiveData[accountId] = { spend: 0, conversions: 0, costPerConversion: 0, conversionBreakdown: [], error: errMsg };
        continue;
      }

      try {
        const json = await response.json();
        let spend: number;
        let conversions: number;
        let conversionBreakdown: ConversionEntry[];

        if (platform === 'meta') {
          const parsed = parseMetaInsights(json);
          spend = parsed.spend;
          conversions = parsed.conversions;
          conversionBreakdown = parsed.conversionBreakdown;
        } else {
          const parsed = parseGoogleInsights(json);
          spend = parsed.spend;
          conversions = parsed.conversions;
          conversionBreakdown = parsed.conversionBreakdown;
        }

        newLiveData[accountId] = {
          spend,
          conversions,
          costPerConversion: conversions > 0 ? spend / conversions : 0,
          conversionBreakdown,
        };
      } catch {
        newLiveData[accountId] = { spend: 0, conversions: 0, costPerConversion: 0, conversionBreakdown: [], error: 'Parse error' };
      }
    }

    setLiveData(newLiveData);
    setRefreshing(false);
    setLastRefreshed(new Date());
    setCooldownRemaining(COOLDOWN_SECONDS);
  }, [clients, refreshing, cooldownRemaining]);

  // ── Derived data ────────────────────────────────────────────────────

  const platforms = useMemo(() => [...new Set(clients.map(c => c.platform).filter(Boolean))].sort(), [clients]);
  const managers = useMemo(() => [...new Set(clients.map(c => c.account_manager).filter(Boolean))] as string[], [clients]);

  const filtered = useMemo(() => {
    return clients.filter(c => {
      // Hide partners — they are not clients
      if (PARTNER_NAMES.has(c.client_name)) return false;
      if (selectedPlatform && c.platform?.toLowerCase() !== selectedPlatform.toLowerCase()) return false;
      if (selectedManager && c.account_manager !== selectedManager) return false;
      if (selectedPriority && c.priority?.toLowerCase() !== selectedPriority.toLowerCase()) return false;
      // Hide churned clients — they show in the Archive tab
      if (c.status?.toLowerCase() === 'churned') return false;
      return true;
    });
  }, [clients, selectedPlatform, selectedManager, selectedPriority]);

  // ── Per-row revenue calculation using fee_config + live spend ────────
  // Returns { value: number | null, source: 'override' | 'calculated' | 'none' } keyed by row id
  const calculatedRevenue = useMemo(() => {
    const result: Record<string, { value: number | null; source: 'override' | 'calculated' | 'none' }> = {};

    // Pre-compute total live spend per client_name (needed for "fixed" and "tiered" scope "total")
    const totalSpendByClient: Record<string, number> = {};
    for (const c of clients) {
      const spend = c.ad_account_id ? (liveData[c.ad_account_id]?.spend ?? 0) : 0;
      totalSpendByClient[c.client_name] = (totalSpendByClient[c.client_name] ?? 0) + spend;
    }

    for (const c of clients) {
      // 1. If revenue_override is true, use monthly_revenue as-is
      if (c.revenue_override && c.monthly_revenue != null) {
        result[c.id] = { value: c.monthly_revenue, source: 'override' };
        continue;
      }

      // 2. If fee_config exists and we have live spend, calculate
      if (c.fee_config && c.ad_account_id && liveData[c.ad_account_id]) {
        const live = liveData[c.ad_account_id];
        if (!live.error) {
          const thisPlatformSpend = live.spend;
          const totalClientSpend = totalSpendByClient[c.client_name] ?? thisPlatformSpend;
          const fee = calculatePlatformRevenue(c.fee_config, thisPlatformSpend, totalClientSpend);
          result[c.id] = { value: fee, source: 'calculated' };
          continue;
        }
      }

      // 3. Fall back to budget-based calculation when live data is missing or errored
      if (c.fee_config && c.monthly_budget != null && c.monthly_budget > 0) {
        const budgetAsSpend = Number(c.monthly_budget);
        const totalBudgetByClient = clients
          .filter(cl => cl.client_name === c.client_name)
          .reduce((sum, cl) => sum + Number(cl.monthly_budget ?? 0), 0);
        const fee = calculatePlatformRevenue(c.fee_config, budgetAsSpend, totalBudgetByClient);
        result[c.id] = { value: fee, source: 'calculated' };
        continue;
      }

      // 4. No fee_config — fall back to monthly_revenue from DB if it exists
      if (c.monthly_revenue != null && Number(c.monthly_revenue) > 0) {
        result[c.id] = { value: Number(c.monthly_revenue), source: 'override' };
        continue;
      }

      // 5. Nothing available
      result[c.id] = { value: null, source: 'none' };
    }

    return result;
  }, [clients, liveData]);

  // Aggregate revenue per client name for summary stats and sorting
  const clientRevenue = useMemo(() => {
    const revenueMap: Record<string, number> = {};
    for (const c of clients) {
      const rev = calculatedRevenue[c.id]?.value ?? 0;
      revenueMap[c.client_name] = (revenueMap[c.client_name] ?? 0) + rev;
    }
    return revenueMap;
  }, [clients, calculatedRevenue]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
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
      } else if (sortKey === 'est_revenue') {
        cmp = (clientRevenue[a.client_name] ?? 0) - (clientRevenue[b.client_name] ?? 0);
      } else {
        const va = (a[sortKey] as string) ?? '';
        const vb = (b[sortKey] as string) ?? '';
        cmp = va.localeCompare(vb);
      }
      cmp = sortDir === 'asc' ? cmp : -cmp;
      return cmp !== 0 ? cmp : nameCompare;
    });
    return arr;
  }, [filtered, sortKey, sortDir, clientRevenue]);

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

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  // Summary stats
  const stats = useMemo(() => {
    const uniqueClients = new Set(filtered.map(c => c.client_name)).size;
    const googleCount = filtered.filter(c => c.platform === 'google').length;
    const metaCount = filtered.filter(c => c.platform === 'meta').length;
    const totalEstRevenue = filtered.reduce((sum, c) => sum + (calculatedRevenue[c.id]?.value ?? 0), 0);
    const googleRevenue = filtered.filter(c => c.platform === 'google').reduce((sum, c) => sum + (calculatedRevenue[c.id]?.value ?? 0), 0);
    const metaRevenue = filtered.filter(c => c.platform === 'meta').reduce((sum, c) => sum + (calculatedRevenue[c.id]?.value ?? 0), 0);
    const totalOperatorCost = operatorCosts?.totals.operator_cost ?? 0;
    const profit = totalEstRevenue - totalOperatorCost;
    const marginPct = totalEstRevenue > 0 ? Math.round((profit / totalEstRevenue) * 10000) / 100 : 0;
    return { uniqueClients, googleCount, metaCount, total: filtered.length, totalEstRevenue, googleRevenue, metaRevenue, totalOperatorCost, profit, marginPct };
  }, [filtered, calculatedRevenue, operatorCosts]);

  // ── Render helpers ──────────────────────────────────────────────────

  function renderLiveCell(client: Client, field: 'spend' | 'conversions' | 'costPerConversion') {
    const accountId = client.ad_account_id;
    if (!accountId || !liveData[accountId]) {
      return <span className="text-slate-300">--</span>;
    }

    const data = liveData[accountId];
    if (data.error) {
      return (
        <span className="text-red-400 text-xs" title={data.error}>
          err
        </span>
      );
    }

    if (field === 'spend') return formatCurrency(data.spend);
    if (field === 'conversions') {
      if (data.conversions === 0 && data.conversionBreakdown.length === 0) {
        return <span className="text-slate-300">0</span>;
      }
      return (
        <span
          className="cursor-help"
          onMouseEnter={(e) => {
            if (data.conversionBreakdown.length > 0) {
              setTooltip({ x: e.clientX, y: e.clientY, breakdown: data.conversionBreakdown });
            }
          }}
          onMouseLeave={() => setTooltip(null)}
        >
          <span className="border-b border-dashed border-slate-300">{formatInteger(data.conversions)}</span>
        </span>
      );
    }
    // costPerConversion
    if (data.conversions === 0) return <span className="text-slate-300">--</span>;
    return formatCurrency(data.costPerConversion);
  }

  // ── Loading / Error states ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-[var(--creekside-blue)]" />
          <span className="text-sm text-slate-500">Loading clients...</span>
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
      {/* Summary Stats */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Active Clients</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stats.uniqueClients}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Est. Monthly Revenue</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(stats.totalEstRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Operator Costs</p>
          <p className="text-2xl font-bold text-slate-700 mt-1">
            {operatorCosts ? formatCurrency(stats.totalOperatorCost) : <span className="text-slate-300">--</span>}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Profit / Margin</p>
          <p className={`text-2xl font-bold mt-1 ${
            stats.marginPct >= 30 ? 'text-emerald-600' : stats.marginPct >= 15 ? 'text-amber-600' : 'text-red-600'
          }`}>
            {formatCurrency(stats.profit)}
            <span className="text-sm font-semibold ml-1">({stats.marginPct}%)</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Google Revenue</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(stats.googleRevenue)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{stats.googleCount} accounts</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-4">
          <p className="text-sm font-medium text-slate-500">Meta Revenue</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{formatCurrency(stats.metaRevenue)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{stats.metaCount} accounts</p>
        </div>
      </div>

      {/* Refresh bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-slate-400">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          {refreshing && (
            <span className="text-xs text-blue-500 animate-pulse">Fetching live data...</span>
          )}
        </div>
        <button
          onClick={refreshData}
          disabled={refreshing || cooldownRemaining > 0}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            refreshing || cooldownRemaining > 0
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-[var(--creekside-blue)] text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20 hover:shadow-md active:scale-[0.98]'
          }`}
        >
          {refreshing ? 'Refreshing...' : cooldownRemaining > 0 ? `Wait ${Math.ceil(cooldownRemaining / 60)}m ${cooldownRemaining % 60}s` : 'Refresh Data'}
        </button>
      </div>

      {/* Filters */}
      <FilterBar
        platforms={platforms}
        managers={managers}
        selectedPlatform={selectedPlatform}
        selectedManager={selectedManager}
        selectedPriority={selectedPriority}
        onPlatformChange={setSelectedPlatform}
        onManagerChange={setSelectedManager}
        onPriorityChange={setSelectedPriority}
      />

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden relative">
        {/* Loading progress bar */}
        {refreshing && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-slate-100 overflow-hidden z-10">
            <div className="h-full bg-[var(--creekside-blue)] animate-[progress_1.5s_ease-in-out_infinite]"
              style={{ width: '40%', animation: 'progress 1.5s ease-in-out infinite' }} />
          </div>
        )}
        <style>{`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <SortHeader label="Client" sortKey="client_name" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Platform</th>
                <SortHeader label="Est. Revenue" sortKey="est_revenue" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Proj. Cost</th>
                <SortHeader label="Priority" sortKey="priority" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Manager" sortKey="account_manager" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Operator" sortKey="platform_operator" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <SortHeader label="Budget" sortKey="monthly_budget" currentKey={sortKey} direction={sortDir} onSort={handleSort} />
                <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Spend</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Conv.</th>
                <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider py-4 px-6">Cost/Conv</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center text-slate-400 py-16 text-sm">
                    No clients match the current filters.
                  </td>
                </tr>
              ) : (
                grouped.map((group, groupIdx) => (
                  group.rows.map((client, rowIdx) => {
                    const isFirstInGroup = rowIdx === 0;
                    return (
                      <tr
                        key={client.id}
                        onClick={() => router.push(`/client/${client.id}`)}
                        className={`cursor-pointer transition-colors duration-150 hover:bg-blue-50/50 ${
                          isFirstInGroup && groupIdx > 0 ? 'border-t border-slate-200' : ''
                        } ${!isFirstInGroup ? 'border-t border-slate-100' : ''}`}
                      >
                        {/* Client Name — only show for first row in group */}
                        <td className="py-4 px-6">
                          {isFirstInGroup ? (
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">{client.client_name}</span>
                                {!!client.client_id && lastContact[client.client_id as string] && (
                                  <LastContactBadge
                                    daysAgo={lastContact[client.client_id as string].days_ago}
                                    source={lastContact[client.client_id as string].source}
                                  />
                                )}
                              </div>
                              {(client.contact_name as string) && (
                                <span className="block text-xs text-slate-400 font-normal mt-0.5">{client.contact_name as string}</span>
                              )}
                              <InlineNotes
                                clientId={client.id}
                                value={(client.notes as string) ?? ''}
                                onSaved={handleFieldSaved}
                              />
                            </div>
                          ) : null}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <PlatformBadge platform={client.platform} />
                            {(client.segment_name as string) && (
                              <span className="text-xs text-slate-500 font-medium">{client.segment_name as string}</span>
                            )}
                          </div>
                        </td>
                        {/* Est. Revenue — per-row, calculated from fee_config + live spend */}
                        <td className="py-4 px-6 text-right text-sm font-medium text-slate-900" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const rev = calculatedRevenue[client.id];
                            if (!rev || rev.value == null) {
                              return (
                                <InlineCurrencyInput
                                  clientId={client.id}
                                  field="monthly_revenue"
                                  value={client.monthly_revenue}
                                  onSaved={handleFieldSaved}
                                  extraPatchFields={{ revenue_override: true }}
                                  placeholder="--"
                                  className="text-slate-900"
                                />
                              );
                            }

                            const feeTooltip = client.fee_config ? describeFeeConfig(client.fee_config) : undefined;
                            const displayValue = rev.source === 'override' || rev.source === 'none'
                              ? client.monthly_revenue
                              : null;
                            const displayPlaceholder = rev.source === 'calculated'
                              ? `$${Math.round(rev.value).toLocaleString()}`
                              : '--';
                            const showReset = rev.source === 'override' && client.fee_config;

                            return (
                              <span className="inline-flex items-center gap-1" title={feeTooltip}>
                                <InlineCurrencyInput
                                  clientId={client.id}
                                  field="monthly_revenue"
                                  value={displayValue}
                                  onSaved={handleFieldSaved}
                                  extraPatchFields={{ revenue_override: true }}
                                  placeholder={displayPlaceholder}
                                  className="text-slate-900"
                                />
                                {showReset && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleResetRevenue(client.id); }}
                                    className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
                                    title="Reset to calculated value"
                                  >
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                                      <path d="M2.5 1a.5.5 0 0 1 .5.5V4h2.5a.5.5 0 0 1 0 1H2.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5zM4.54 3.827a4.5 4.5 0 1 1-.724 6.28.5.5 0 1 1 .748-.662A3.5 3.5 0 1 0 4.5 4.5H4.54l-.01-.673z" />
                                    </svg>
                                  </button>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        {/* Proj. Cost — per-row */}
                        <td className="py-4 px-6 text-right text-sm font-medium text-slate-500">
                          {(() => {
                            const costs = operatorCosts?.clients[client.client_name];
                            if (!costs || costs.operator_cost === 0) {
                              return <span className="text-slate-300">--</span>;
                            }
                            const groupRows = group.rows.length;
                            const rowCost = costs.operator_cost / groupRows;
                            const rowRevenue = calculatedRevenue[client.id]?.value ?? 0;
                            const rowProfit = rowRevenue - rowCost;
                            const costStr = rowCost >= 1000
                              ? `$${(rowCost / 1000).toFixed(1).replace(/\.0$/, '')}K`
                              : `$${Math.round(rowCost)}`;
                            return (
                              <div title={`Cost: ${formatCurrency(rowCost)} | Profit: ${formatCurrency(rowProfit)}`}>
                                <span className="text-slate-700">{costStr}</span>
                              </div>
                            );
                          })()}
                        </td>
                        {/* Priority — per-row */}
                        <td className="py-4 px-6" onClick={(e) => e.stopPropagation()}>
                          <InlinePrioritySelect
                            clientId={client.id}
                            value={client.priority}
                            onSaved={handleFieldSaved}
                          />
                        </td>
                        {/* Manager — grouped (first row only) */}
                        <td className="py-4 px-6 text-sm text-slate-600" onClick={(e) => e.stopPropagation()}>
                          {isFirstInGroup ? (
                            <InlineTableSelect
                              clientId={client.id}
                              field="account_manager"
                              value={client.account_manager}
                              options={teamMembers
                                .filter(t => ['Cade', 'Peterson', 'Scott', 'Lindsey', 'Baran'].some(n => t.short_name?.includes(n) || t.name?.includes(n)))
                                .map(t => ({ value: t.short_name, label: t.short_name }))}
                              placeholder="--"
                              onSaved={handleFieldSaved}
                            />
                          ) : null}
                        </td>
                        <td className="py-4 px-6 text-sm text-slate-600" onClick={(e) => e.stopPropagation()}>
                          <InlineTableSelect
                            clientId={client.id}
                            field="platform_operator"
                            value={client.platform_operator}
                            options={teamMembers
                              .filter(t => !['Jordan', 'Cindy', 'Cyndelsa', 'Queenie', 'Melvin'].some(n => t.short_name?.includes(n) || t.name?.includes(n)))
                              .map(t => ({ value: t.short_name, label: t.short_name }))}
                            placeholder="--"
                            onSaved={handleFieldSaved}
                          />
                        </td>
                        <td className="py-4 px-6 text-sm text-slate-700 font-medium" onClick={(e) => e.stopPropagation()}>
                          <InlineCurrencyInput
                            clientId={client.id}
                            field="monthly_budget"
                            value={client.monthly_budget}
                            onSaved={handleFieldSaved}
                          />
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-medium">
                          {(() => {
                            const accountId = client.ad_account_id;
                            const budget = client.monthly_budget;
                            const live = accountId ? liveData[accountId] : null;
                            const spend = live && !live.error ? live.spend : null;

                            // Determine color: red if >10% over or under budget, green if within range
                            let colorClass = 'text-slate-700'; // default when no data
                            if (spend != null && budget != null && budget > 0) {
                              if (spend > budget * 1.10 || spend < budget * 0.90) {
                                colorClass = 'text-red-600';
                              } else {
                                colorClass = 'text-emerald-600';
                              }
                            }

                            return (
                              <span className={colorClass}>
                                {renderLiveCell(client, 'spend')}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-medium text-slate-700">
                          {renderLiveCell(client, 'conversions')}
                        </td>
                        <td className="py-4 px-6 text-right text-sm font-medium text-slate-700">
                          {renderLiveCell(client, 'costPerConversion')}
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

      {/* Conversion breakdown tooltip — rendered outside table overflow */}
      {tooltip && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-slate-900 text-white text-xs rounded-lg py-3 px-4 whitespace-nowrap shadow-xl">
            <div className="font-semibold text-slate-300 mb-1.5 text-[10px] uppercase tracking-wider">Conversion Breakdown</div>
            {tooltip.breakdown.map((entry) => (
              <div key={entry.type} className="flex items-center justify-between gap-6 py-0.5">
                <span className="text-slate-300">{entry.label}</span>
                <span className="font-semibold tabular-nums">{entry.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="w-2 h-2 bg-slate-900 rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </div>
  );
}
