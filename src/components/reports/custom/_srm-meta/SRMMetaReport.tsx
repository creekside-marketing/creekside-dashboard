'use client';

/**
 * SRMMetaReport -- Custom report for South River Mortgage (Meta).
 *
 * Wraps the standard LeadGenMetaReport with overrides:
 *   - Leads counted from `conversions` field: (JTC) Pre-qualified Lead
 *   - PQL + Cost/PQL columns added to campaign table from: (JTC) Pricing Qualified
 *
 * Data sources (all from the `conversions` field, NOT `actions`):
 *   - Pre-Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead
 *   - Pricing Qualified Leads: offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified
 */

import LeadGenMetaReport from '../../LeadGenMetaReport';
import type { ReportProps } from '../../types';

const PQL_ACTION = 'offsite_conversion.fb_pixel_custom.(JTC) Pricing Qualified';
const PREQ_ACTION = 'offsite_conversion.fb_pixel_custom.(JTC) Pre-qualified Lead';

export default function SRMMetaReport({ client, mode }: ReportProps) {
  return (
    <LeadGenMetaReport
      client={client}
      mode={mode}
      leadConversionTypes={[PREQ_ACTION]}
      pqlConversionType={PQL_ACTION}
    />
  );
}
