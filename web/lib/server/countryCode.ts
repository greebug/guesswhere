import type { CityRow } from './grader';

/**
 * The city corpus carries TWO spellings for a lot of countries, because it is
 * built from two upstream sources that disagree: GHSL uses UN long forms
 * ("United States of America", "Iran (Islamic Republic of)", "Viet Nam") and
 * the GeoNames coverage layer added in the 2026-07-24 pass uses short forms
 * ("United States", "Iran", "Vietnam"). 31 ISO codes have two country strings
 * between them, including US (931 + 320 cities), RU (321 + 247) and CN.
 *
 * That matters twice over:
 *
 *   * Round selection guarantees no two cities from the same country. Keyed on
 *     the raw string, that guarantee silently did NOT hold across a split pair
 *     -- a game could legitimately hand you Chicago and then Houston, or two
 *     Korean cities, because "United States" and "United States of America"
 *     looked like different countries. A real (pre-existing, unreported) bug.
 *   * The eliminated-country tint on the minimap would then be lying: greying
 *     out the US after you solve one US city, while another US city is still
 *     waiting in round 8.
 *
 * `iso2` is the fix for both -- it collapses every variant spelling onto one
 * key. 92 of 18,749 playable cities have no iso2 at all, in 11 country names,
 * every one of which is a spelling of a country that IS represented elsewhere
 * in the corpus; NULL_ISO_FALLBACK maps exactly those.
 */
const NULL_ISO_FALLBACK: Record<string, string> = {
  'China, Taiwan Province of China': 'TW',
  Congo: 'CG',
  "Dem. People's Republic of Korea": 'KP',
  'Democratic Republic of the Congo': 'CD',
  Myanmar: 'MM',
  'Republic of Korea': 'KR',
  'Russian Federation': 'RU',
  'State of Palestine': 'PS',
  'United Republic of Tanzania': 'TZ',
  'United States of America': 'US',
  'Viet Nam': 'VN',
};

/**
 * The ISO 3166-1 alpha-2 code for a city's country, or null when the corpus
 * gives no usable one. Callers that need a lookup key (not a real country
 * code) should fall back to the raw country string -- see countryKey().
 */
export function isoCodeFor(city: Pick<CityRow, 'iso2' | 'country'>): string | null {
  if (city.iso2) return city.iso2;
  return NULL_ISO_FALLBACK[city.country] ?? null;
}

/**
 * A stable per-country identity for "these two cities are in the same
 * country". Prefers the ISO code; falls back to the raw string so a country
 * the corpus knows only by name still groups with itself.
 */
export function countryKey(city: Pick<CityRow, 'iso2' | 'country'>): string {
  return isoCodeFor(city) ?? city.country;
}
