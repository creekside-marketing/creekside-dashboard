import { createServiceClient } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import LeadGenGoogleReport from '@/components/reports/LeadGenGoogleReport';
import LeadGenMetaReport from '@/components/reports/LeadGenMetaReport';
import EcomGoogleReport from '@/components/reports/EcomGoogleReport';
import EcomMetaReport from '@/components/reports/EcomMetaReport';
import LeadGenReport from '@/components/reports/LeadGenReport';
import EcomReport from '@/components/reports/EcomReport';

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Validate UUID format to prevent junk queries
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(token)) {
    notFound();
  }

  const supabase = createServiceClient();
  const { data: client } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, ad_account_id, monthly_budget, client_report_notes, client_type, report_token')
    .eq('report_token', token)
    .single();

  if (!client) {
    notFound();
  }

  // Determine report type — explicit client_type takes priority, then platform-based detection
  const clientType = client.client_type || (client.platform === 'google' ? 'lead_gen' : client.platform === 'meta' ? 'ecom' : null);
  const platform = client.platform?.toLowerCase();

  // Explicit 4-way routing
  if (clientType === 'lead_gen' && platform === 'google') return <LeadGenGoogleReport client={client} mode="public" />;
  if (clientType === 'lead_gen' && platform === 'meta') return <LeadGenMetaReport client={client} mode="public" />;
  if (clientType === 'ecom' && platform === 'google') return <EcomGoogleReport client={client} mode="public" />;
  if (clientType === 'ecom' && platform === 'meta') return <EcomMetaReport client={client} mode="public" />;

  // Fallback for clients without explicit platform — use legacy reports
  if (clientType === 'lead_gen') return <LeadGenReport client={client} mode="public" />;
  if (clientType === 'ecom') return <EcomReport client={client} mode="public" />;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
      <h2 className="text-lg font-semibold text-slate-900">Report Not Available</h2>
      <p className="text-sm text-slate-500 mt-2">
        This client&apos;s report type has not been configured yet. Please contact Creekside Marketing.
      </p>
    </div>
  );
}
