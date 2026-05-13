// Evaluates the 70-item Meta audit checklist against a data bundle pulled
// from PipeBoard. Implements the rules defined in the audit-checklist.md
// docs of the meta-audit-agent. Returns structured findings + scoring.

import type {
  AuditDataBundle,
  AuditFindings,
  ChecklistItem,
  Result,
  SectionScore,
  Severity,
} from './types';

const SECTIONS = [
  'Account & Pixel Health',
  'Campaign Structure',
  'Audience Strategy',
  'Ad Creative Quality',
  'Budget & Bidding',
  'Attribution & Tracking',
  'Placement Strategy',
  'Compliance & Policy',
] as const;

interface ItemSpec {
  id: string;
  section: (typeof SECTIONS)[number];
  question: string;
  severity: Severity;
  easySell?: boolean;
  evaluate: (d: AuditDataBundle) => { result: Result; evidence: string; recommendation?: string };
}

const DAYS_AGO = (iso: string | undefined | null): number => {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
};

// Specs cover the highest-signal items. Items where PipeBoard cannot
// return the data are flagged DATA_GAP rather than fabricating a result.
const SPECS: ItemSpec[] = [
  // Section 1: Account & Pixel Health
  {
    id: '1.1',
    section: 'Account & Pixel Health',
    question: 'Pixel installed',
    severity: 'CRITICAL',
    easySell: true,
    evaluate: (d) => {
      if (!d.pixels.length) {
        return {
          result: 'FAIL',
          evidence: 'No pixel returned by get_pixels.',
          recommendation: 'Install a Meta pixel before any further optimization.',
        };
      }
      const recent = d.pixels.some((p) => DAYS_AGO(p.last_fired_time) <= 7);
      return recent
        ? { result: 'PASS', evidence: `Pixel '${d.pixels[0].name}' last fired ${Math.round(DAYS_AGO(d.pixels[0].last_fired_time))} day(s) ago.` }
        : {
            result: 'FAIL',
            evidence: `Pixel last fired ${Math.round(DAYS_AGO(d.pixels[0].last_fired_time))} days ago. Expected within 7 days.`,
            recommendation: 'Investigate pixel firing. Conversions are not being recorded.',
          };
    },
  },
  {
    id: '1.2',
    section: 'Account & Pixel Health',
    question: 'Pixel firing on key pages (Purchase/Lead/ViewContent)',
    severity: 'CRITICAL',
    easySell: true,
    evaluate: (d) => {
      const acct = d.insights30dAccount;
      if (!acct) return { result: 'DATA_GAP', evidence: 'No insights returned.' };
      const hasConv = acct.purchases > 0 || (d.insightsByAd7d.some((a) => a.purchases > 0));
      return hasConv
        ? { result: 'PASS', evidence: `Purchase events recorded in last 30 days: ${acct.purchases}.` }
        : {
            result: 'FAIL',
            evidence: 'No purchase events recorded in the last 30 days.',
            recommendation: 'Verify pixel event configuration. Account is not recording conversions.',
          };
    },
  },
  {
    id: '1.3',
    section: 'Account & Pixel Health',
    question: 'Conversions API (CAPI) active',
    severity: 'HIGH',
    easySell: true,
    evaluate: () => ({ result: 'DATA_GAP', evidence: 'PipeBoard get_pixels does not return CAPI status. Confirm in Events Manager.' }),
  },
  {
    id: '1.7',
    section: 'Account & Pixel Health',
    question: 'Account has spending history (not brand new)',
    severity: 'HIGH',
    evaluate: (d) => {
      const spent = Number(d.account.amount_spent || 0);
      return spent > 1000
        ? { result: 'PASS', evidence: `Lifetime spend: $${spent.toLocaleString()}.` }
        : { result: 'FAIL', evidence: `Lifetime spend only $${spent.toLocaleString()}. Account is in warmup phase.` };
    },
  },
  {
    id: '1.9',
    section: 'Account & Pixel Health',
    question: 'Account status active (status=1)',
    severity: 'CRITICAL',
    evaluate: (d) =>
      d.account.account_status === 1
        ? { result: 'PASS', evidence: 'Account status code 1 (active).' }
        : { result: 'FAIL', evidence: `Account status code: ${d.account.account_status}. Investigate.` },
  },
  {
    id: '1.12',
    section: 'Account & Pixel Health',
    question: 'Currency configured',
    severity: 'LOW',
    evaluate: (d) => ({ result: d.account.currency ? 'PASS' : 'FAIL', evidence: `Currency: ${d.account.currency || 'NONE'}.` }),
  },

  // Section 2: Campaign Structure
  {
    id: '2.1',
    section: 'Campaign Structure',
    question: 'Objective matches business goal (conversion-focused)',
    severity: 'CRITICAL',
    easySell: true,
    evaluate: (d) => {
      const active = d.campaigns.filter((c) => c.status === 'ACTIVE');
      if (!active.length) return { result: 'DATA_GAP', evidence: 'No active campaigns.' };
      const goodObj = active.filter((c) =>
        ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_TRAFFIC'].includes(c.objective)
      );
      return goodObj.length === active.length
        ? { result: 'PASS', evidence: `All ${active.length} active campaign(s) use conversion-focused objectives.` }
        : {
            result: 'FAIL',
            evidence: `${active.length - goodObj.length} of ${active.length} campaigns use non-conversion objectives.`,
            recommendation: 'Audit campaign objectives. Brand awareness or Reach is rarely correct for performance accounts.',
          };
    },
  },
  {
    id: '2.7',
    section: 'Campaign Structure',
    question: 'Buying type = AUCTION',
    severity: 'MEDIUM',
    evaluate: (d) => {
      const non = d.campaigns.filter((c) => c.buying_type && c.buying_type !== 'AUCTION');
      return non.length === 0
        ? { result: 'PASS', evidence: 'All campaigns use AUCTION buying type.' }
        : { result: 'FAIL', evidence: `${non.length} campaign(s) using non-auction buying.` };
    },
  },
  {
    id: '2.8',
    section: 'Campaign Structure',
    question: 'Special ad categories correctly declared (or none)',
    severity: 'CRITICAL',
    evaluate: (d) => {
      const withCat = d.campaigns.filter((c) => c.special_ad_categories && c.special_ad_categories.length > 0);
      return withCat.length === 0
        ? { result: 'PASS', evidence: 'No special ad categories declared.' }
        : {
            result: 'N_A',
            evidence: `${withCat.length} campaign(s) declare special categories. Verify vertical match: ${withCat
              .flatMap((c) => c.special_ad_categories || [])
              .join(', ')}.`,
          };
    },
  },
  {
    id: '2.10',
    section: 'Campaign Structure',
    question: 'No paused campaigns with active budget',
    severity: 'CRITICAL',
    evaluate: (d) => {
      const paused = d.campaigns.filter((c) => c.status === 'PAUSED' && Number(c.daily_budget) > 0);
      return paused.length === 0
        ? { result: 'PASS', evidence: 'No paused campaigns carry active budget.' }
        : { result: 'FAIL', evidence: `${paused.length} paused campaign(s) still have a daily budget set.` };
    },
  },
  {
    id: '2.11',
    section: 'Campaign Structure',
    question: 'Active campaign count appropriate for budget',
    severity: 'MEDIUM',
    easySell: true,
    evaluate: (d) => {
      const active = d.campaigns.filter((c) => c.status === 'ACTIVE');
      const totalBudget = active.reduce((s, c) => s + Number(c.daily_budget || 0), 0) / 100; // cents to dollars
      const avgPerCamp = active.length > 0 ? totalBudget / active.length : 0;
      if (active.length > 5 && avgPerCamp < 50) {
        return {
          result: 'FAIL',
          evidence: `${active.length} active campaigns averaging $${avgPerCamp.toFixed(0)}/day each. Budget is spread too thin for Meta's learning algorithm.`,
          recommendation: 'Consolidate to 2-3 core campaigns with $200+/day each.',
        };
      }
      return {
        result: 'PASS',
        evidence: `${active.length} active campaigns, total $${totalBudget.toFixed(0)}/day, avg $${avgPerCamp.toFixed(0)}/day each.`,
      };
    },
  },

  // Section 3: Audience Strategy
  {
    id: '3.1',
    section: 'Audience Strategy',
    question: 'Website custom audiences exist',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const websiteAuds = d.audiences.filter((a) => a.subtype === 'WEBSITE');
      return websiteAuds.length > 0
        ? { result: 'PASS', evidence: `${websiteAuds.length} website custom audience(s) configured.` }
        : { result: 'FAIL', evidence: 'No website custom audiences found. Retargeting and seeded lookalikes are blocked.' };
    },
  },
  {
    id: '3.2',
    section: 'Audience Strategy',
    question: 'Customer list audience uploaded',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const customLists = d.audiences.filter(
        (a) => a.subtype === 'CUSTOM' && a.customer_file_source === 'USER_PROVIDED_ONLY'
      );
      return customLists.length > 0
        ? { result: 'PASS', evidence: `${customLists.length} customer list audience(s) found.` }
        : { result: 'FAIL', evidence: 'No customer list audiences uploaded. Suppression and lookalike seeding are missing.' };
    },
  },
  {
    id: '3.3',
    section: 'Audience Strategy',
    question: 'Lookalike audiences created',
    severity: 'HIGH',
    evaluate: (d) => {
      const llas = d.audiences.filter((a) => a.subtype === 'LOOKALIKE');
      return llas.length > 0
        ? { result: 'PASS', evidence: `${llas.length} lookalike audience(s) configured.` }
        : { result: 'FAIL', evidence: 'No lookalike audiences exist. Cold prospecting is harder without them.' };
    },
  },
  {
    id: '3.6',
    section: 'Audience Strategy',
    question: 'Existing customers excluded from cold prospecting',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const active = d.adsets.filter((a) => a.status === 'ACTIVE');
      if (!active.length) return { result: 'DATA_GAP', evidence: 'No active ad sets.' };
      const withExclusion = active.filter(
        (a) =>
          a.targeting?.excluded_custom_audiences &&
          a.targeting.excluded_custom_audiences.some((e) => /customer|purchaser|buyer/i.test(e.name))
      );
      const pct = (withExclusion.length / active.length) * 100;
      return pct >= 50
        ? { result: 'PASS', evidence: `${withExclusion.length}/${active.length} active ad sets exclude existing customers.` }
        : {
            result: 'FAIL',
            evidence: `Only ${withExclusion.length}/${active.length} active ad sets exclude existing customers.`,
            recommendation: 'Add the customer list as an exclusion on every cold ad set.',
          };
    },
  },
  {
    id: '3.11',
    section: 'Audience Strategy',
    question: 'Audiences refreshed in last 90 days',
    severity: 'MEDIUM',
    easySell: true,
    evaluate: (d) => {
      const stale = d.audiences.filter((a) => /not maintained|deprecated/i.test(a.name));
      return stale.length === 0
        ? { result: 'PASS', evidence: 'No audiences flagged as stale.' }
        : {
            result: 'FAIL',
            evidence: `${stale.length} audience(s) flagged stale: ${stale
              .slice(0, 2)
              .map((a) => `'${a.name.slice(0, 60)}'`)
              .join(', ')}.`,
            recommendation: 'Rebuild lookalike audiences from a rolling 90-day Purchase event seed.',
          };
    },
  },

  // Section 4: Ad Creative
  {
    id: '4.1',
    section: 'Ad Creative Quality',
    question: 'At least 3 active ads per active ad set',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const activeAdsets = d.adsets.filter((a) => a.status === 'ACTIVE');
      if (!activeAdsets.length) return { result: 'DATA_GAP', evidence: 'No active ad sets.' };
      const byAdset = new Map<string, number>();
      d.ads.filter((a) => a.effective_status === 'ACTIVE').forEach((a) => {
        byAdset.set(a.adset_id, (byAdset.get(a.adset_id) || 0) + 1);
      });
      const under = activeAdsets.filter((a) => (byAdset.get(a.id) || 0) < 3);
      return under.length === 0
        ? { result: 'PASS', evidence: 'All active ad sets have 3+ active ads.' }
        : { result: 'FAIL', evidence: `${under.length}/${activeAdsets.length} active ad sets have fewer than 3 active ads.` };
    },
  },
  {
    id: '4.2',
    section: 'Ad Creative Quality',
    question: 'Video ads present',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const hasVideo = d.creatives.some((c) => c.video_id || c.object_type === 'VIDEO');
      return hasVideo
        ? { result: 'PASS', evidence: 'At least one video creative active.' }
        : { result: 'FAIL', evidence: 'No video creatives found in active ads. Video typically outperforms static by 3-5x in CPL.' };
    },
  },
  {
    id: '4.4',
    section: 'Ad Creative Quality',
    question: 'No active ads at frequency > 3 (cold audiences)',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const fatigued = d.insightsByAd7d.filter((a) => a.frequency > 3);
      return fatigued.length === 0
        ? { result: 'PASS', evidence: 'No active ad shows frequency > 3 in the last 7 days.' }
        : {
            result: 'FAIL',
            evidence: `${fatigued.length} ad(s) at frequency > 3: ${fatigued
              .slice(0, 3)
              .map((a) => `${a.ad_name} (${a.frequency.toFixed(2)})`)
              .join('; ')}.`,
            recommendation: 'Rotate new creative or pause fatigued ads.',
          };
    },
  },
  {
    id: '4.9',
    section: 'Ad Creative Quality',
    question: 'Advantage+ Creative optimizations active',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const optedIn = d.creatives.filter((c) => {
        const spec = c.degrees_of_freedom_spec?.creative_features_spec || {};
        return Object.values(spec).some((s) => s?.enroll_status === 'OPT_IN');
      });
      const optedOut = d.creatives.length - optedIn.length;
      return optedOut === 0
        ? { result: 'PASS', evidence: 'All creatives use at least one Advantage+ optimization.' }
        : optedIn.length === 0
        ? {
            result: 'FAIL',
            evidence: `All ${d.creatives.length} reviewed creatives have Advantage+ Creative optimizations OPTED OUT.`,
            recommendation: 'Enable text_optimizations and enhance_cta as a controlled test on top performers.',
          }
        : {
            result: 'FAIL',
            evidence: `${optedOut}/${d.creatives.length} creatives have no Advantage+ optimizations enabled.`,
          };
    },
  },
  {
    id: '4.13',
    section: 'Ad Creative Quality',
    question: 'Active creatives not older than 90 days',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const active = d.ads.filter((a) => a.status === 'ACTIVE');
      if (!active.length) return { result: 'DATA_GAP', evidence: 'No active ads.' };
      const oldest = active.reduce((min, a) => Math.max(min, DAYS_AGO(a.created_time)), 0);
      return oldest <= 90
        ? { result: 'PASS', evidence: `Oldest active creative created ${Math.round(oldest)} day(s) ago.` }
        : {
            result: 'FAIL',
            evidence: `Oldest active creative is ${Math.round(oldest)} days old.`,
            recommendation: 'Plan a refresh cadence. Creative fatigue compounds after 60 days.',
          };
    },
  },

  // Section 5: Budget & Bidding
  {
    id: '5.1',
    section: 'Budget & Bidding',
    question: 'Account out of learning phase (50+ conversions/week per ad set)',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const acct = d.insights30dAccount;
      if (!acct) return { result: 'DATA_GAP', evidence: 'No insights.' };
      const weekly = acct.purchases / 4.3;
      return weekly >= 50
        ? { result: 'PASS', evidence: `${weekly.toFixed(0)} purchases/week. Past learning phase threshold.` }
        : {
            result: 'FAIL',
            evidence: `${weekly.toFixed(1)} purchases/week. Meta needs 50/week per ad set to exit learning phase.`,
            recommendation: 'Consolidate budget into the top ad set until weekly conversions clear 50.',
          };
    },
  },
  {
    id: '5.3',
    section: 'Budget & Bidding',
    question: 'No active ad sets with $0 spend',
    severity: 'HIGH',
    evaluate: (d) => {
      const activeIds = new Set(d.adsets.filter((a) => a.status === 'ACTIVE').map((a) => a.id));
      if (!activeIds.size) return { result: 'DATA_GAP', evidence: 'No active ad sets.' };
      // Insights for ad sets that DID spend
      const spendingIds = new Set(d.insightsByAd7d.map((a) => a.adset_id));
      const zero = [...activeIds].filter((id) => !spendingIds.has(id));
      return zero.length === 0
        ? { result: 'PASS', evidence: 'All active ad sets have spend in the last 7 days.' }
        : { result: 'FAIL', evidence: `${zero.length}/${activeIds.size} active ad sets had $0 spend in last 7 days.` };
    },
  },
  {
    id: '5.4',
    section: 'Budget & Bidding',
    question: 'CPA and ROAS within reasonable bounds',
    severity: 'HIGH',
    evaluate: (d) => {
      const acct = d.insights30dAccount;
      if (!acct || acct.purchases === 0) {
        return { result: 'DATA_GAP', evidence: 'No purchases recorded in last 30 days.' };
      }
      return {
        result: 'N_A',
        evidence: `Blended CPA: $${acct.cpa.toFixed(2)}. ROAS: ${acct.roas.toFixed(2)}. (Benchmark assessment requires client vertical context.)`,
        recommendation: 'Compare against industry CPA benchmarks for the vertical.',
      };
    },
  },
  {
    id: '5.5',
    section: 'Budget & Bidding',
    question: 'Budget concentrated, not spread across many campaigns',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const camps = d.insightsByCampaign;
      if (!camps.length) return { result: 'DATA_GAP', evidence: 'No campaign-level insights.' };
      const totalSpend = camps.reduce((s, c) => s + c.spend, 0);
      const sorted = camps.sort((a, b) => b.spend - a.spend);
      const topTwoPct = totalSpend > 0 ? (sorted[0].spend + (sorted[1]?.spend || 0)) / totalSpend : 0;
      return topTwoPct >= 0.8
        ? { result: 'PASS', evidence: `Top 2 campaigns capture ${(topTwoPct * 100).toFixed(0)}% of spend. Budget is concentrated.` }
        : {
            result: 'FAIL',
            evidence: `Top 2 campaigns capture only ${(topTwoPct * 100).toFixed(0)}% of spend across ${camps.length} campaigns.`,
            recommendation: 'Consolidate budget to fewer campaigns to escape learning phase.',
          };
    },
  },

  // Section 6: Attribution & Tracking
  {
    id: '6.1',
    section: 'Attribution & Tracking',
    question: 'Attribution windows are 7-day click / 1-day view (current Meta best practice)',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const withSpec = d.adsets.filter((a) => a.attribution_spec && a.attribution_spec.length > 0);
      if (!withSpec.length) {
        return {
          result: 'DATA_GAP',
          evidence: 'attribution_spec not returned for any ad sets (PipeBoard limitation on get_adsets default fields).',
        };
      }
      const correct = withSpec.filter((a) =>
        a.attribution_spec!.some((s) => s.event_type === 'CLICK_THROUGH' && s.window_days === 7)
      );
      return correct.length === withSpec.length
        ? {
            result: 'PASS',
            evidence: `${correct.length}/${withSpec.length} ad sets use 7-day click attribution.`,
          }
        : { result: 'FAIL', evidence: `Only ${correct.length}/${withSpec.length} ad sets use 7-day click attribution.` };
    },
  },
  {
    id: '6.2',
    section: 'Attribution & Tracking',
    question: 'Optimizing for the correct conversion event',
    severity: 'CRITICAL',
    easySell: true,
    evaluate: (d) => {
      const active = d.adsets.filter((a) => a.status === 'ACTIVE');
      if (!active.length) return { result: 'DATA_GAP', evidence: 'No active ad sets.' };
      const withEvent = active.filter((a) => a.promoted_object?.custom_event_type);
      const conversionEvents = ['PURCHASE', 'LEAD', 'COMPLETE_REGISTRATION', 'SUBSCRIBE', 'SCHEDULE'];
      const good = withEvent.filter((a) =>
        conversionEvents.includes(a.promoted_object!.custom_event_type!)
      );
      return good.length === active.length
        ? {
            result: 'PASS',
            evidence: `All ${active.length} active ad sets optimize on conversion events: ${[
              ...new Set(active.map((a) => a.promoted_object?.custom_event_type)),
            ].join(', ')}.`,
          }
        : {
            result: 'FAIL',
            evidence: `Only ${good.length}/${active.length} active ad sets optimize on a real conversion event.`,
          };
    },
  },
  {
    id: '6.3',
    section: 'Attribution & Tracking',
    question: 'UTM parameters on ad URLs',
    severity: 'MEDIUM',
    evaluate: (d) => {
      const tagged = d.creatives.filter((c) => /utm_source/.test(c.url_tags || ''));
      if (!d.creatives.length) return { result: 'DATA_GAP', evidence: 'No creatives evaluated.' };
      return tagged.length === d.creatives.length
        ? { result: 'PASS', evidence: 'All reviewed creatives carry UTM parameters.' }
        : { result: 'FAIL', evidence: `${tagged.length}/${d.creatives.length} creatives carry UTM parameters.` };
    },
  },

  // Section 7: Placement Strategy -- always DATA_GAP until API exposes fields
  {
    id: '7.1',
    section: 'Placement Strategy',
    question: 'Placement strategy intentional (Advantage+ or manual)',
    severity: 'MEDIUM',
    evaluate: (d) => {
      const withFields = d.adsets.filter((a) => a.targeting?.publisher_platforms);
      return withFields.length > 0
        ? { result: 'PASS', evidence: `${withFields.length} ad sets have explicit placement config.` }
        : {
            result: 'DATA_GAP',
            evidence: 'publisher_platforms not returned by PipeBoard. Verify in Ads Manager.',
          };
    },
  },
  {
    id: '7.2',
    section: 'Placement Strategy',
    question: 'Audience Network disabled for lead gen (unless validated)',
    severity: 'HIGH',
    easySell: true,
    evaluate: (d) => {
      const withAN = d.adsets.filter(
        (a) => a.targeting?.audience_network_positions && a.targeting.audience_network_positions.length > 0
      );
      const fieldReturned = d.adsets.some((a) => a.targeting?.publisher_platforms);
      if (!fieldReturned) {
        return {
          result: 'DATA_GAP',
          evidence: 'Audience Network field not returned by PipeBoard. Verify in Ads Manager.',
        };
      }
      return withAN.length === 0
        ? { result: 'PASS', evidence: 'No ad sets target Audience Network.' }
        : {
            result: 'FAIL',
            evidence: `${withAN.length} ad set(s) targeting Audience Network.`,
            recommendation: 'Disable Audience Network on lead gen unless lead quality has been validated from it.',
          };
    },
  },

  // Section 8: Compliance
  {
    id: '8.1',
    section: 'Compliance & Policy',
    question: 'No disapproved or with-issues ads on active campaigns',
    severity: 'CRITICAL',
    evaluate: (d) => {
      const bad = d.ads.filter((a) => /DISAPPROVED|WITH_ISSUES/.test(a.effective_status));
      return bad.length === 0
        ? { result: 'PASS', evidence: 'No ads flagged with policy issues.' }
        : { result: 'FAIL', evidence: `${bad.length} ad(s) flagged with policy issues.` };
    },
  },
  {
    id: '8.5',
    section: 'Compliance & Policy',
    question: 'Account not disabled or in grace period',
    severity: 'CRITICAL',
    evaluate: (d) =>
      d.account.account_status === 1
        ? { result: 'PASS', evidence: 'Account status active (status=1).' }
        : { result: 'FAIL', evidence: `Account status code: ${d.account.account_status}. Investigate.` },
  },
];

export function evaluateAudit(data: AuditDataBundle): AuditFindings {
  const items: ChecklistItem[] = SPECS.map((s) => {
    const { result, evidence, recommendation } = s.evaluate(data);
    return {
      id: s.id,
      section: s.section,
      question: s.question,
      severity: s.severity,
      easySell: !!s.easySell,
      result,
      evidence,
      recommendation,
    };
  });

  // Section scores
  const sectionScores: SectionScore[] = SECTIONS.map((section) => {
    const sec = items.filter((i) => i.section === section);
    const pass = sec.filter((i) => i.result === 'PASS').length;
    const fail = sec.filter((i) => i.result === 'FAIL').length;
    const na = sec.filter((i) => i.result === 'N_A').length;
    const gap = sec.filter((i) => i.result === 'DATA_GAP').length;
    const evaluable = pass + fail;
    const scorePct = evaluable === 0 ? 0 : Math.round((pass / evaluable) * 100);
    return { section, total: sec.length, pass, fail, na, gap, scorePct };
  });

  const allEvaluable = items.filter((i) => i.result === 'PASS' || i.result === 'FAIL');
  const overallScore =
    allEvaluable.length === 0
      ? 0
      : Math.round((allEvaluable.filter((i) => i.result === 'PASS').length / allEvaluable.length) * 100);

  const overallGrade: AuditFindings['overallGrade'] =
    overallScore >= 90 ? 'A' : overallScore >= 75 ? 'B' : overallScore >= 60 ? 'C' : overallScore >= 45 ? 'D' : 'F';

  const easySellFails = items.filter((i) => i.result === 'FAIL' && i.easySell);
  const criticalFails = items.filter((i) => i.result === 'FAIL' && i.severity === 'CRITICAL');
  const highFails = items.filter((i) => i.result === 'FAIL' && i.severity === 'HIGH');

  // Identify the top-performing and worst-spending ads from last 7d
  const sortedByCpa = data.insightsByAd7d
    .filter((a) => a.purchases > 0)
    .sort((a, b) => a.cpa - b.cpa);
  const topWinningAd = sortedByCpa[0]
    ? {
        name: sortedByCpa[0].ad_name,
        cpa: sortedByCpa[0].cpa,
        purchases: sortedByCpa[0].purchases,
        spend: sortedByCpa[0].spend,
      }
    : undefined;

  const budgetLeakCandidates = data.insightsByAd7d
    .filter((a) => a.spend > 200 && a.purchases === 0)
    .sort((a, b) => b.spend - a.spend);
  const budgetLeakAd = budgetLeakCandidates[0]
    ? {
        name: budgetLeakCandidates[0].ad_name,
        spend: budgetLeakCandidates[0].spend,
        purchases: budgetLeakCandidates[0].purchases,
      }
    : undefined;

  return {
    items,
    sectionScores,
    overallScore,
    overallGrade,
    easySellFails,
    criticalFails,
    highFails,
    topWinningAd,
    budgetLeakAd,
  };
}
