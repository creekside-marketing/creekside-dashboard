// Meta locale ID -> human-readable language name.
// Used by the audit to translate targeting.locales numeric IDs into
// language names a prospect can actually read in the report.
// Source: https://developers.facebook.com/docs/marketing-api/audiences/reference/advanced-targeting/

const LOCALES: Record<number, string> = {
  6: 'English (US)',
  16: 'English (US) -- legacy',
  24: 'English (UK)',
  46: 'English (All)',
  23: 'Spanish',
  7: 'Spanish (Spain)',
  9: 'Spanish (Latin America)',
  1: 'French',
  10: 'German',
  11: 'Italian',
  17: 'Italian',
  19: 'Portuguese (Brazil)',
  31: 'Portuguese (Portugal)',
  30: 'Russian',
  35: 'Japanese',
  41: 'Korean',
  14: 'Polish',
  5: 'Dutch',
  4: 'Danish',
  3: 'Swedish',
  18: 'Norwegian',
  20: 'Finnish',
  26: 'Greek',
  27: 'Turkish',
  29: 'Czech',
  43: 'Hungarian',
  45: 'Romanian',
  1003: 'Chinese (Simplified)',
  1086: 'Chinese (Traditional)',
  1056: 'Arabic',
  44: 'Hebrew',
  42: 'Hindi',
  56: 'Thai',
  64: 'Vietnamese',
  68: 'Indonesian',
  1001: 'Multi-language',
};

/**
 * Return human-readable language names for a list of Meta locale IDs.
 * If the list is empty or undefined, returns ["All languages (no restriction)"].
 */
export function decodeLocales(locales: number[] | undefined | null): string[] {
  if (!locales || locales.length === 0) return ['All languages (no restriction)'];
  return locales.map((id) => LOCALES[id] || `Locale ${id}`);
}

/**
 * Quick heuristic: is the ad set restricted to English-only?
 * Used by the language checklist item.
 */
export function isEnglishOnly(locales: number[] | undefined | null): boolean {
  if (!locales || locales.length === 0) return false;
  const englishIds = new Set([6, 16, 24, 46]);
  return locales.every((id) => englishIds.has(id));
}

/**
 * True if the locales field is missing or empty (which means "all languages").
 */
export function isUnrestricted(locales: number[] | undefined | null): boolean {
  return !locales || locales.length === 0;
}
