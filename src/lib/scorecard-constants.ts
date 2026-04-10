/**
 * Shared constants for scorecard API routes.
 *
 * CANNOT: contain business logic, call APIs, or import React.
 */

/** White-label and partner clients excluded from scorecard metrics. */
export const PARTNER_NAMES = new Set([
  'Bottle.com',
  'Comet Fuel',
  'FirstUp Marketing',
  'Full Circle Media',
  'Suff Digital',
]);

/**
 * Maps reporting_clients.platform_operator abbreviations to
 * team_members.name full names for labor cost matching.
 */
export const OPERATOR_MAP: Record<string, string> = {
  'Ahmed I.': 'Ahmed Imran',
  'Scott C.': 'Scott Caldwell',
  'Lindsey B.': 'Lindsey Bouffard',
  'Trent L.': 'Trent Lucas',
  'Adam G.': 'Adam Guzman',
  'Ade A.': 'Ade Aderibigbe',
};
