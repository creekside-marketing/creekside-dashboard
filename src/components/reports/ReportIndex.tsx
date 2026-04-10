'use client';

/**
 * ReportIndex — Client-side search and display for the report index page.
 * Handles search filtering and copy-to-clipboard for report URLs.
 *
 * CANNOT: Fetch or modify data — receives all data via props from the server component.
 */

import { useState, useCallback } from 'react';

interface ReportingClient {
  id: string;
  client_name: string;
  platform: string;
  ad_account_id: string | null;
  client_type: string | null;
  report_token: string;
}

interface ReportIndexProps {
  groupedClients: Record<string, ReportingClient[]>;
  sortedNames: string[];
}

// ── Platform badge colors ─────────────────────────────────────────────────

function platformBadge(platform: string) {
  const p = platform?.toLowerCase();
  if (p === 'google')
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
        Google
      </span>
    );
  if (p === 'meta')
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
        Meta
      </span>
    );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
      {platform}
    </span>
  );
}

function clientTypeBadge(clientType: string | null) {
  if (clientType === 'lead_gen')
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        Lead Gen
      </span>
    );
  if (clientType === 'ecom')
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        Ecom
      </span>
    );
  return null;
}

// ── Copy button ───────────────────────────────────────────────────────────

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [url]);

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 px-2.5 py-1 rounded text-xs font-medium transition-colors border cursor-pointer
        bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
      title="Copy report URL"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ReportIndex({ groupedClients, sortedNames }: ReportIndexProps) {
  const [search, setSearch] = useState('');

  const query = search.toLowerCase().trim();
  const filteredNames = query
    ? sortedNames.filter((name) => {
        const clients = groupedClients[name];
        const nameMatch = name.toLowerCase().includes(query);
        const platformMatch = clients.some((c) => c.platform?.toLowerCase().includes(query));
        const typeMatch = clients.some((c) => c.client_type?.toLowerCase().includes(query));
        return nameMatch || platformMatch || typeMatch;
      })
    : sortedNames;

  return (
    <>
      {/* Search input */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by client name, platform, or type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-900
            placeholder:text-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        />
      </div>

      {/* Client list */}
      {filteredNames.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
          <p className="text-sm text-slate-500">
            {query ? 'No clients match your search.' : 'No clients with active reports found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
          {filteredNames.map((name) => {
            const clients = groupedClients[name];
            const clientType = clients[0]?.client_type;

            return (
              <div key={name} className="px-5 py-4">
                {/* Client header */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h2 className="text-sm font-semibold text-slate-900">{name}</h2>
                  {clientTypeBadge(clientType)}
                </div>

                {/* Platform rows */}
                <div className="flex flex-col gap-2">
                  {clients.map((client) => {
                    const fullUrl =
                      typeof window !== 'undefined'
                        ? `${window.location.origin}/report/${client.report_token}`
                        : `/report/${client.report_token}`;

                    return (
                      <div
                        key={client.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        {platformBadge(client.platform)}
                        <a
                          href={`/report/${client.report_token}`}
                          className="text-teal-600 hover:text-teal-800 hover:underline truncate min-w-0"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          /report/{client.report_token}
                        </a>
                        <CopyButton url={fullUrl} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer count */}
      {query && filteredNames.length > 0 && (
        <p className="text-xs text-slate-400 mt-4 text-center">
          Showing {filteredNames.length} of {sortedNames.length} clients
        </p>
      )}
    </>
  );
}
