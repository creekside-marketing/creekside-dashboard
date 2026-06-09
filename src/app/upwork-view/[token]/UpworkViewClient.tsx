'use client';

import dynamic from 'next/dynamic';

const UpworkFunnel = dynamic(
  () => import('@/app/(dashboard)/upwork/page'),
  { ssr: false, loading: () => <div className="p-12 text-center text-slate-400">Loading Upwork funnel...</div> },
);

export default function UpworkViewClient() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:p-10">
      <UpworkFunnel />
    </div>
  );
}
