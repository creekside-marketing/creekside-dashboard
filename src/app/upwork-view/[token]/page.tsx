import { notFound } from 'next/navigation';
import UpworkViewClient from './UpworkViewClient';

export default async function UpworkViewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!process.env.UPWORK_VIEW_TOKEN || token !== process.env.UPWORK_VIEW_TOKEN) {
    notFound();
  }

  return <UpworkViewClient />;
}
