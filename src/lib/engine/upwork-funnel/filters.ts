import type { UpworkJob, UpworkFunnelFilters } from '@/lib/types/upwork-funnel';

export function applyFilters(jobs: UpworkJob[], filters: UpworkFunnelFilters): UpworkJob[] {
  return jobs.filter((job) => {
    if (filters.dateRange.start && (!job.application_date || job.application_date < filters.dateRange.start)) return false;
    if (filters.dateRange.end && (!job.application_date || job.application_date > filters.dateRange.end)) return false;

    if (filters.scriptUsed.length > 0 && !filters.scriptUsed.includes(job.script_used ?? 'Unknown')) return false;
    if (filters.sourceType.length > 0 && !filters.sourceType.includes(job.source_type ?? 'Unknown')) return false;
    if (filters.businessType.length > 0 && !filters.businessType.includes(job.business_type ?? 'Unknown')) return false;
    if (filters.profileUsed.length > 0 && !filters.profileUsed.includes(job.profile_used ?? 'Unknown')) return false;
    if (filters.platform.length > 0 && !filters.platform.includes(job.platform ?? 'Unknown')) return false;

    return true;
  });
}
