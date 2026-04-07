import NavTabs from '@/components/NavTabs';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <nav className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">CM</span>
            </div>
            <span className="text-[var(--text-primary)] font-semibold hidden sm:inline">
              Creekside Dashboard
            </span>
          </div>
          <NavTabs />
        </div>
      </nav>
      <main className="px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
