/**
 * Stable color palette for team-member chips on the Client + Team dashboards.
 *
 * The labor breakdown chip uses the FIRST NAME to look up a color so the same
 * person always renders the same hue regardless of how their full name is
 * spelled across labor allocations vs the Team tab.
 *
 * Unknown / ad-hoc names fall back to slate so the chip still renders cleanly.
 */

export type TeamColor = {
  bg: string;
  text: string;
  ring: string;
  dot: string;
};

const FALLBACK: TeamColor = {
  bg: 'bg-slate-100',
  text: 'text-slate-700',
  ring: 'ring-slate-300',
  dot: 'bg-slate-400',
};

const TEAM_COLORS: Record<string, TeamColor> = {
  lindsey: { bg: 'bg-orange-100', text: 'text-orange-800', ring: 'ring-orange-300', dot: 'bg-orange-500' },
  scott:   { bg: 'bg-red-100',    text: 'text-red-800',    ring: 'ring-red-300',    dot: 'bg-red-500' },
  trent:   { bg: 'bg-yellow-100', text: 'text-yellow-800', ring: 'ring-yellow-400', dot: 'bg-yellow-500' },
  ahmed:   { bg: 'bg-emerald-100', text: 'text-emerald-800', ring: 'ring-emerald-300', dot: 'bg-emerald-500' },
  ade:     { bg: 'bg-purple-100', text: 'text-purple-800', ring: 'ring-purple-300', dot: 'bg-purple-500' },
  baran:   { bg: 'bg-cyan-100',   text: 'text-cyan-800',   ring: 'ring-cyan-300',   dot: 'bg-cyan-500' },
  jordan:  { bg: 'bg-blue-100',   text: 'text-blue-800',   ring: 'ring-blue-300',   dot: 'bg-blue-500' },
};

export function getTeamColor(fullName: string | null | undefined): TeamColor {
  if (!fullName) return FALLBACK;
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return TEAM_COLORS[first] ?? FALLBACK;
}

/** First-name shorthand for display chips (Lindsey Bouffard → Lindsey). */
export function shortName(fullName: string | null | undefined): string {
  if (!fullName) return '—';
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
