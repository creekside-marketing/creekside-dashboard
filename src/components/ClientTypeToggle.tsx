'use client';

import { useState } from 'react';

export default function ClientTypeToggle({
  clientId,
  initialType,
}: {
  clientId: string;
  initialType: string | null;
}) {
  const [clientType, setClientType] = useState(initialType ?? '');
  const [saving, setSaving] = useState(false);

  const handleChange = async (newType: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: clientId, client_type: newType || null }),
      });
      if (res.ok) setClientType(newType);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      {['lead_gen', 'ecom'].map((type) => {
        const isActive = clientType === type;
        const label = type === 'lead_gen' ? 'Lead Gen' : 'Ecom';
        return (
          <button
            key={type}
            onClick={() => handleChange(isActive ? '' : type)}
            disabled={saving}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
              isActive
                ? type === 'lead_gen'
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-600/20'
                  : 'bg-purple-100 text-purple-700 ring-1 ring-inset ring-purple-600/20'
                : 'bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100 ring-1 ring-inset ring-slate-200'
            } ${saving ? 'opacity-50' : ''}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
