'use client';

/**
 * ReportNotesTimeline — Report notes with create, archive, and pagination.
 *
 * Shows the "New Report" button, editor, timeline, and archive controls
 * for all users (internal and public). Auth is enforced at the API layer.
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

const NOTES_PER_PAGE = 5;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function ReportNotesTimeline({ clientId }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [saveError, setSaveError] = useState('');

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
    setSaveError('');
    try {
      const res = await fetch('/api/report-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, author: 'Creekside', content: newContent.trim() }),
      });
      if (res.ok) {
        setNewContent('');
        setShowEditor(false);
        setPage(0);
        await fetchNotes();
      } else {
        setSaveError('Unable to save. Please try again.');
      }
    } catch {
      setSaveError('Unable to save. Please try again.');
    }
    finally { setSaving(false); }
  };

  const handleArchive = async (noteId: string) => {
    try {
      const res = await fetch('/api/report-notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: noteId, archived: true }),
      });
      if (res.ok) {
        await fetchNotes();
      }
    } catch { /* silent */ }
  };

  if (loading) return null;

  const totalPages = Math.max(1, Math.ceil(notes.length / NOTES_PER_PAGE));
  const pagedNotes = notes.slice(page * NOTES_PER_PAGE, (page + 1) * NOTES_PER_PAGE);

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
          <div className="mb-3">
            <span className="text-xs font-medium text-slate-500">{formatDate(new Date().toISOString())}</span>
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your report notes..."
            rows={6}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent resize-y mb-3"
          />
          {saveError && (
            <p className="text-xs text-red-500 mb-2">{saveError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !newContent.trim()}
              className="bg-[#2563eb] text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => { setShowEditor(false); setNewContent(''); setSaveError(''); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 && !showEditor ? (
        <p className="text-sm text-slate-400">No report notes yet.</p>
      ) : notes.length > 0 ? (
        <>
          <div className="space-y-4">
            {pagedNotes.map((note) => (
              <div key={note.id} className="border-l-2 border-slate-200 pl-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">{formatDate(note.created_at)}</div>
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

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                onClick={() => setPage(Math.max(page - 1, 0))}
                disabled={page <= 0}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                Newer
              </button>
              <span className="text-xs text-slate-400">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(page + 1, totalPages - 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
              >
                Older
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
