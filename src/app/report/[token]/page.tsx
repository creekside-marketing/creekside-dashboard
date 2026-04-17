import { createServiceClient } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import TabbedReport from '@/components/reports/TabbedReport';

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Check if user is authenticated (dashboard session) → internal mode with editing
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('cm_auth')?.value;
  const isAuthenticated = sessionCookie === process.env.DASHBOARD_SESSION_SECRET;
  const mode = isAuthenticated ? 'internal' : 'public';

  // Validate UUID format to prevent junk queries
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(token)) {
    notFound();
  }

  const supabase = createServiceClient();
  const { data: client } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, ad_account_id, monthly_budget, client_report_notes, client_type, report_token, report_mode, custom_report_slug')
    .eq('report_token', token)
    .single();

  if (!client) {
    notFound();
  }

  // Look up sibling records (same client_name, different platform) for tabbed view
  const { data: allClients } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, ad_account_id, monthly_budget, client_report_notes, client_type, report_token, report_mode, custom_report_slug')
    .eq('client_name', client.client_name)
    .not('ad_account_id', 'is', null);

  // Filter to only include clients with valid accounts and known types
  const validClients = (allClients ?? []).filter(c => c.ad_account_id && (c.client_type || c.platform));

  if (validClients.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Report Not Available</h2>
        <p className="text-sm text-slate-500 mt-2">
          This client&apos;s report type has not been configured yet. Please contact Creekside Marketing.
        </p>
      </div>
    );
  }

  return <TabbedReport clients={validClients} mode={mode} initialPlatform={client.platform} />;
}
