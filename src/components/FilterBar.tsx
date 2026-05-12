'use client';

import { useState, useRef, useEffect } from 'react';

interface FilterBarProps {
  platforms: string[];
  managers: string[];
  selectedPlatform: string;
  selectedManagers: string[];
  selectedPriority: string;
  selectedContact: string;
  onPlatformChange: (value: string) => void;
  onManagerChange: (value: string[]) => void;
  onPriorityChange: (value: string) => void;
  onContactChange: (value: string) => void;
}

export default function FilterBar({
  platforms,
  managers,
  selectedPlatform,
  selectedManagers,
  onPlatformChange,
  onManagerChange,
  selectedPriority,
  onPriorityChange,
  selectedContact,
  onContactChange,
}: FilterBarProps) {
  const platformOptions = ['All', ...platforms];
  const priorityOptions = ['All', 'High', 'Medium', 'Low'];
  const contactOptions: { label: string; value: string; dot?: string }[] = [
    { label: 'All', value: '' },
    { label: '0\u201314d', value: 'green', dot: 'bg-emerald-500' },
    { label: '14\u201330d', value: 'yellow', dot: 'bg-yellow-500' },
    { label: '30d+', value: 'red', dot: 'bg-red-500' },
  ];

  const [managerOpen, setManagerOpen] = useState(false);
  const managerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (managerRef.current && !managerRef.current.contains(e.target as Node)) {
        setManagerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleManager = (m: string) => {
    if (selectedManagers.includes(m)) {
      onManagerChange(selectedManagers.filter(v => v !== m));
    } else {
      onManagerChange([...selectedManagers, m]);
    }
  };

  const managerLabel =
    selectedManagers.length === 0
      ? 'All'
      : selectedManagers.length === 1
        ? selectedManagers[0]
        : `${selectedManagers.length} selected`;

  const pillBase = 'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer';
  const pillActive = 'bg-[var(--creekside-navy)] text-white shadow-sm';
  const pillInactive = 'text-slate-600 hover:bg-slate-100';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center gap-8">
      {/* Platform */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">Platform</span>
        <div className="flex items-center bg-slate-50 rounded-lg p-1">
          {platformOptions.map((p) => (
            <button
              key={p}
              onClick={() => onPlatformChange(p === 'All' ? '' : p)}
              className={`${pillBase} ${
                (p === 'All' && selectedPlatform === '') ||
                p.toLowerCase() === selectedPlatform.toLowerCase()
                  ? pillActive
                  : pillInactive
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Priority */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">Priority</span>
        <div className="flex items-center bg-slate-50 rounded-lg p-1">
          {priorityOptions.map((p) => (
            <button
              key={p}
              onClick={() => onPriorityChange(p === 'All' ? '' : p.toLowerCase())}
              className={`${pillBase} ${
                (p === 'All' && selectedPriority === '') ||
                p.toLowerCase() === selectedPriority.toLowerCase()
                  ? pillActive
                  : pillInactive
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Manager (multi-select dropdown) */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Manager</span>
        <div className="relative" ref={managerRef}>
          <button
            onClick={() => setManagerOpen(o => !o)}
            className={`text-sm font-medium border rounded-lg px-4 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent cursor-pointer flex items-center gap-2 min-w-[120px] ${
              selectedManagers.length > 0 ? 'border-[var(--creekside-blue)]' : 'border-slate-200'
            }`}
          >
            <span className="flex-1 text-left">{managerLabel}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" className={`text-slate-400 transition-transform ${managerOpen ? 'rotate-180' : ''}`}>
              <path fill="currentColor" d="M6 8L1 3h10z" />
            </svg>
          </button>

          {managerOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[180px] py-1">
              {/* Clear all */}
              <button
                onClick={() => onManagerChange([])}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                  selectedManagers.length === 0 ? 'font-semibold text-[var(--creekside-navy)]' : 'text-slate-600'
                }`}
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  {selectedManagers.length === 0 && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </span>
                All
              </button>
              <div className="border-t border-slate-100 my-1" />
              {managers.map((m) => (
                <button
                  key={m}
                  onClick={() => toggleManager(m)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                    selectedManagers.includes(m) ? 'font-semibold text-[var(--creekside-navy)]' : 'text-slate-600'
                  }`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center text-white ${
                    selectedManagers.includes(m)
                      ? 'bg-[var(--creekside-navy)] border-[var(--creekside-navy)]'
                      : 'border-slate-300'
                  }`}>
                    {selectedManagers.includes(m) && (
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </span>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Last Contact */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">Contact</span>
        <div className="flex items-center bg-slate-50 rounded-lg p-1">
          {contactOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onContactChange(opt.value)}
              className={`${pillBase} flex items-center gap-1.5 ${
                selectedContact === opt.value ? pillActive : pillInactive
              }`}
            >
              {opt.dot && <span className={`inline-block w-2 h-2 rounded-full ${selectedContact === opt.value ? 'bg-white/80' : opt.dot}`} />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
