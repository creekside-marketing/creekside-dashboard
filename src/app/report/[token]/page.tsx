import { createServiceClient } from '@/lib/supabase';
import { notFound } from 'next/navigation';
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
    .select('*')
    .eq('report_token', token)
    .single();

  if (!client) {
    notFound();
  }

  // Determine report type — explicit client_type takes priority, then platform-based detection
  const clientType = client.client_type || (client.platform === 'google' ? 'lead_gen' : client.platform === 'meta' ? 'ecom' : null);

  if (!clientType) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
        <h2 className="text-lg font-semibold text-slate-900">Report Not Available</h2>
        <p className="text-sm text-slate-500 mt-2">
          This client&apos;s report type has not been configured yet. Please contact Creekside Marketing.
        </p>
      </div>
    );
  }

  return clientType === 'lead_gen'
    ? <LeadGenReport client={client} mode="public" />
    : <EcomReport client={client} mode="public" />;
}
