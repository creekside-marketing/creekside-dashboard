/**
 * Report Index — Lists all clients and their report URLs.
 * Contractor-accessible (no auth required, lives under /report which is excluded from middleware).
 *
 * CANNOT: Modify client records.
 * CANNOT: Access any authenticated routes or data beyond reporting_clients.
 */

import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase';
import ReportIndex from '@/components/reports/ReportIndex';
import ReportGate from '@/components/reports/ReportGate';

interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  client_type: string | null;
  report_token: string;
}

export const metadata = {
  title: 'Client Reports',
};

export const dynamic = 'force-dynamic';

export default async function ReportIndexPage() {
  const cookieStore = await cookies();
  const isAuthed = cookieStore.get('report_index_auth')?.value === 'true';

  if (!isAuthed) {
    return <ReportGate />;
  }

  const supabase = createServiceClient();

  const { data: clients, error } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, ad_account_id, client_type, report_token')
    .not('report_token', 'is', null)
    .not('ad_account_id', 'is', null)
    .order('client_name', { ascending: true });

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center max-w-md">
          <h2 className="text-lg font-semibold text-slate-900">Unable to load reports</h2>
          <p className="text-sm text-slate-500 mt-2">
            Something went wrong loading the client list. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Group clients by name for dual-platform display
  const grouped: Record<string, ReportingClient[]> = {};
  for (const client of clients ?? []) {
    if (!client.report_token) continue;
    const name = client.client_name;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(client);
  }

  // Sort platforms within each group: Google first, then Meta
  const platformOrder: Record<string, number> = { google: 0, meta: 1 };
  for (const name of Object.keys(grouped)) {
    grouped[name].sort(
      (a, b) =>
        (platformOrder[a.platform?.toLowerCase()] ?? 99) -
        (platformOrder[b.platform?.toLowerCase()] ?? 99),
    );
  }

  const sortedNames = Object.keys(grouped).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Client Reports</h1>
          <p className="text-sm text-slate-500 mt-1">
            {sortedNames.length} client{sortedNames.length !== 1 ? 's' : ''} with active reports
          </p>
        </header>

        <ReportIndex groupedClients={grouped} sortedNames={sortedNames} />
      </div>
    </div>
  );
}
