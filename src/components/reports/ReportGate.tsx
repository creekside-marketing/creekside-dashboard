'use client';

import { useState } from 'react';

const CORRECT_PASSWORD = 'creekside';
const COOKIE_NAME = 'report_index_auth';

export default function ReportGate() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password === CORRECT_PASSWORD) {
      document.cookie = `${COOKIE_NAME}=true; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
      window.location.reload();
    } else {
      setError(true);
      setPassword('');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 w-full max-w-sm">
        <h1 className="text-xl font-bold text-slate-900 text-center">Client Reports</h1>
        <p className="text-sm text-slate-500 mt-1 text-center">
          Enter the password to continue
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(false);
              }}
              placeholder="Password"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
            />
            {error && (
              <p className="text-xs text-red-500 mt-1.5">Incorrect password. Try again.</p>
            )}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
