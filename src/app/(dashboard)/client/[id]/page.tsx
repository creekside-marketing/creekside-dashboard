import { createServiceClient } from '@/lib/supabase';
import ClientReport from '@/components/ClientReport';
import PerformanceGoals from '@/components/PerformanceGoals';
import ClientTypeToggle from '@/components/ClientTypeToggle';
import Link from 'next/link';
import { notFound } from 'next/navigation';

function QuickLink({ href, label, icon, disabled }: { href: string | null; label: string; icon: string; disabled?: boolean }) {
  if (disabled || !href) {
    return (
      <span
        className="inline-flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-medium text-slate-300 cursor-not-allowed select-none"
        title={`No ${label} link available`}
      >
        <span>{icon}</span>
        {label}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
    >
      <span>{icon}</span>
      {label}
    </a>
  );
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServiceClient();

  // Fetch reporting_clients row
  const { data: client, error: clientError } = await supabase
    .from('reporting_clients')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (clientError) {
    return (
      <div className="p-8 text-red-500">
        <p className="font-semibold">Failed to load client</p>
        <p className="text-sm mt-1">{clientError.message}</p>
      </div>
    );
  }

  if (!client) {
    notFound();
  }

  // Fetch linked clients table data for Drive/ClickUp/contact info
  let clientMeta: {
    gdrive_folder_id: string | null;
    clickup_folder_id: string | null;
    contract_url: string | null;
    primary_contact_name: string | null;
    primary_contact_email: string | null;
    website: string | null;
    gchat_url: string | null;
  } | null = null;

  try {
    if (client.client_id) {
      const { data } = await supabase
        .from('clients')
        .select('gdrive_folder_id, clickup_folder_id, contract_url, primary_contact_name, primary_contact_email, website, gchat_url')
        .eq('id', client.client_id)
        .maybeSingle();
      clientMeta = data;
    } else {
      const baseName = client.client_name.replace(/ —.*$/, '');
      const { data } = await supabase
        .from('clients')
        .select('gdrive_folder_id, clickup_folder_id, contract_url, primary_contact_name, primary_contact_email, website, gchat_url')
        .eq('name', baseName)
        .limit(1)
        .maybeSingle();
      clientMeta = data;
    }
  } catch {
    // clientMeta stays null — page still renders without quick links
  }

  const driveUrl = clientMeta?.gdrive_folder_id
    ? `https://drive.google.com/drive/folders/${clientMeta.gdrive_folder_id}`
    : null;
  const clickupUrl = clientMeta?.clickup_folder_id
    ? `https://app.clickup.com/9017100244/v/f/${clientMeta.clickup_folder_id}`
    : null;
  const reportUrl = client.report_token ? `/report/${client.report_token}` : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-[var(--creekside-blue)] transition-colors group"
        >
          <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to all clients
        </Link>

        {/* Quick Links */}
        <div className="flex items-center gap-2">
          <QuickLink href={reportUrl} label="Client Report" icon="📊" />
          <QuickLink href={clientMeta?.contract_url ?? null} label="Contract" icon="📄" />
          <QuickLink href={driveUrl} label="Google Drive" icon="📁" />
          <QuickLink href={clickupUrl} label="ClickUp" icon="📋" />
          <QuickLink href={clientMeta?.gchat_url ?? null} label="Google Chat" icon="💬" />
          {clientMeta?.website && <QuickLink href={clientMeta.website.startsWith('http') ? clientMeta.website : `https://${clientMeta.website}`} label="Website" icon="🌐" />}
        </div>
      </div>

      {/* Client Type + Contact Info */}
      <div className="flex items-center gap-4 text-sm text-slate-500">
        <ClientTypeToggle clientId={client.id} initialType={client.client_type} />
        {clientMeta?.primary_contact_name && (
          <>
            <span className="text-slate-200">|</span>
            <span>Contact: <strong className="text-slate-700">{clientMeta.primary_contact_name}</strong></span>
            {clientMeta.primary_contact_email && (
              <a href={`mailto:${clientMeta.primary_contact_email}`} className="text-[var(--creekside-blue)] hover:underline">
                {clientMeta.primary_contact_email}
              </a>
            )}
          </>
        )}
      </div>

      <ClientReport client={client} />
      <PerformanceGoals clientName={client.client_name} />
    </div>
  );
}
