// Meta Audits dashboard page. Lists all accessible Meta ad accounts via
// PipeBoard, lets the user trigger an audit per account. Audit runs are
// handled by /api/meta-audit/run -- this page is the entry point.

import { callPipeboard } from '@/lib/pipeboard';
import MetaAuditsClient, { type MetaAccount } from './MetaAuditsClient';

export const metadata = {
  title: 'Meta Audits | Creekside Dashboard',
};

// Force server-side rendering on every request so the account list is fresh.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PipeboardAccountsResult {
  data?: MetaAccount[];
  summary?: { total_accounts?: number };
}

interface PipeboardEnvelope {
  content?: Array<{ type: string; text: string }>;
}

function parseAccounts(raw: unknown): MetaAccount[] {
  if (!raw) return [];
  const envelope = raw as PipeboardEnvelope;
  if (envelope.content?.[0]?.type === 'text') {
    try {
      const parsed = JSON.parse(envelope.content[0].text) as PipeboardAccountsResult;
      return parsed.data || [];
    } catch {
      return [];
    }
  }
  // Direct object case
  const result = raw as PipeboardAccountsResult;
  return result.data || [];
}

export default async function MetaAuditsPage() {
  let accounts: MetaAccount[] = [];
  let error: string | null = null;

  try {
    const raw = await callPipeboard('get_ad_accounts');
    accounts = parseAccounts(raw);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load Meta accounts';
  }

  return <MetaAuditsClient initialAccounts={accounts} initialError={error} />;
}
