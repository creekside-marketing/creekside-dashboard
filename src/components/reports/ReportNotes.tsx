'use client';

import { useState } from 'react';

interface ReportNotesProps {
  clientId: string;
  initialNotes: string;
  mode: 'internal' | 'public';
}

export default function ReportNotes({ clientId, initialNotes, mode }: ReportNotesProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, client_report_notes: notes }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert('Failed to save notes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'public') {
    if (!notes?.trim()) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Notes</h2>
        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{notes}</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Client-Facing Notes</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-emerald-600 font-medium">Saved</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#2563eb] text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
          >
            {saving ? 'Saving...' : 'Save Notes'}
          </button>
        </div>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add notes visible to the client..."
        rows={6}
        className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent resize-y ring-1 ring-inset ring-slate-200"
      />
    </div>
  );
}
