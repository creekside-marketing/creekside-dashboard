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

  const clientType = client.client_type || (client.platform === 'google' ? 'lead_gen' : 'ecom');

  return clientType === 'lead_gen'
    ? <LeadGenReport client={client} mode="public" />
    : <EcomReport client={client} mode="public" />;
}
