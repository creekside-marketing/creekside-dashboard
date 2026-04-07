'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const hasError = searchParams.get('error') === '1';
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-[#2563eb] flex items-center justify-center">
            <span className="text-white font-bold text-base">CM</span>
          </div>
          <span className="text-slate-900 font-semibold text-xl">
            Creekside Dashboard
          </span>
        </div>

        <form
          action="/api/auth/login"
          method="POST"
          onSubmit={() => setLoading(true)}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
        >
          {hasError && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg border border-red-200">
              Incorrect password. Try again.
            </div>
          )}

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:border-transparent"
              placeholder="Enter dashboard password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2563eb] text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
