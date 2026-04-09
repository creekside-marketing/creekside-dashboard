'use client';

interface FilterBarProps {
  platforms: string[];
  managers: string[];
  selectedPlatform: string;
  selectedManager: string;
  selectedPriority: string;
  selectedContact: string;
  onPlatformChange: (value: string) => void;
  onManagerChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onContactChange: (value: string) => void;
}

export default function FilterBar({
  platforms,
  managers,
  selectedPlatform,
  selectedManager,
  selectedPriority,
  onPlatformChange,
  onManagerChange,
  onPriorityChange,
  selectedContact,
  onContactChange,
}: FilterBarProps) {
  const platformOptions = ['All', ...platforms];
  const priorityOptions = ['All', 'High', 'Medium', 'Low'];
  const contactOptions: { label: string; value: string; dot?: string }[] = [
    { label: 'All', value: '' },
    { label: '0–14d', value: 'green', dot: 'bg-emerald-500' },
    { label: '14–30d', value: 'yellow', dot: 'bg-yellow-500' },
    { label: '30d+', value: 'red', dot: 'bg-red-500' },
  ];

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

      {/* Manager */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Manager</span>
        <select
          value={selectedManager}
          onChange={(e) => onManagerChange(e.target.value)}
          className="text-sm font-medium border border-slate-200 rounded-lg px-4 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--creekside-blue)] focus:border-transparent appearance-none pr-8 cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394A3B8' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
        >
          <option value="">All</option>
          {managers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
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
