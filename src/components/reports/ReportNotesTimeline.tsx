'use client';

/**
 * ReportNotesTimeline — Bi-weekly report notes with pagination.
 *
 * Internal mode: Create new timestamped notes, view all past notes.
 * Public mode: View most recent note with prev/next navigation.
 *
 * CANNOT: Delete notes — only archive (soft delete).
 */

import { useState, useEffect, useCallback } from 'react';

interface Note {
  id: string;
  created_at: string;
  author: string;
  content: string;
  archived: boolean;
}

interface Props {
  clientId: string;
  mode: 'internal' | 'public';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function ReportNotesTimeline({ clientId, mode }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [author, setAuthor] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/report-notes?client_id=${clientId}`);
      if (res.ok) {
        const json = await res.json();
        setNotes(json.data ?? []);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const handleSave = async () => {
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/report-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, author: author.trim() || 'Team', content: newContent.trim() }),
      });
      if (res.ok) {
        setNewContent('');
        setShowEditor(false);
        await fetchNotes();
      }
    } catch { /* silent */ }
    finally { setSaving(false); }
  };

  const handleArchive = async (noteId: string) => {
    try {
      await fetch('/api/report-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: noteId, archived: true }),
      });
      await fetchNotes();
    } catch { /* silent */ }
  };

  if (loading) return null;
  if (notes.length === 0 && mode === 'public') return null;

  // -- Public mode: single note with prev/next pagination --
  if (mode === 'public') {
    if (notes.length === 0) return null;
    const note = notes[currentIndex];
    if (!note) return null;

    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</h2>
          {notes.length > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentIndex(Math.min(currentIndex + 1, notes.length - 1))}
                disabled={currentIndex >= notes.length - 1}
                className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                Older
              </button>
              <span className="text-xs text-slate-400">{currentIndex + 1} / {notes.length}</span>
              <button
                onClick={() => setCurrentIndex(Math.max(currentIndex - 1, 0))}
                disabled={currentIndex <= 0}
                className="px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                Newer
              </button>
            </div>
          )}
        </div>
        <div className="text-xs text-slate-400 mb-2">{formatDate(note.created_at)} — {note.author}</div>
        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{note.content}</div>
      </div>
    );
  }

  // -- Internal mode: editor + full list --
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Report Notes</h2>
        {!showEditor && (
          <button
            onClick={() => setShowEditor(true)}
            className="bg-[#2563eb] text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
          >
            New Report
          </button>
        )}
      </div>

      {showEditor && (
        <div className="mb-6 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-medium text-slate-500">{formatDate(new Date().toISOString())}</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Your name"
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent w-40"
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your report notes..."
            rows={6}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent resize-y mb-3"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !newContent.trim()}
              className="bg-[#2563eb] text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowEditor(false); setNewContent(''); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-slate-400">No report notes yet.</p>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="border-l-2 border-slate-200 pl-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">{formatDate(note.created_at)} — {note.author}</div>
                <button
                  onClick={() => handleArchive(note.id)}
                  className="text-xs text-slate-300 hover:text-red-400 transition-colors"
                  title="Archive this note"
                >
                  Archive
                </button>
              </div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed mt-1">{note.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
