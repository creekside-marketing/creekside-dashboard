import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Performance Report | Creekside Marketing',
  robots: { index: false, follow: false },
};

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#2563eb] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">CM</span>
          </div>
          <div>
            <span className="text-slate-900 font-semibold text-lg leading-tight">
              Creekside Marketing
            </span>
            <p className="text-xs text-slate-400 leading-tight">Performance Report</p>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between text-xs text-slate-400">
          <span>Powered by Creekside Marketing</span>
          <span>&copy; {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
