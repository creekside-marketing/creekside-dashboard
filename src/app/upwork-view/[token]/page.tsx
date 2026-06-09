import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';

const UpworkFunnel = dynamic(
  () => import('@/app/(dashboard)/upwork/page'),
  { ssr: false, loading: () => <div className="p-12 text-center text-slate-400">Loading Upwork funnel...</div> },
);

export default async function UpworkViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!process.env.UPWORK_VIEW_TOKEN || token !== process.env.UPWORK_VIEW_TOKEN) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 lg:p-10">
      <UpworkFunnel />
    </div>
  );
}
