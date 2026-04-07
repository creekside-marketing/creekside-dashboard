'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Clients', href: '/' },
  { label: 'Team', href: '/team' },
  { label: 'Weekly Scorecard', href: '/weekly' },
  { label: 'Archive', href: '/archive' },
  { label: 'Billing', href: '/billing' },
  { label: 'Scorecard', href: '/scorecard' },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => {
        const isActive =
          tab.href === '/'
            ? pathname === '/' || pathname.startsWith('/client')
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
