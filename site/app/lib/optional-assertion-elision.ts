import {
  hasExperienceFacetLanguage,
  parseTripRequest,
  type ExperienceFacet,
} from './planner';
import type { TripRequestDraftV2 } from './trip-request-draft-v2-runtime';

const EXPERIENCE_FACETS: ExperienceFacet[] = [
  'museum_exhibition',
  'history_heritage',
  'parks_gardens',
  'river_city_walk',
  'city_icons_views',
  'performance_music',
  'sports_venues',
  'market_local_life',
];

function experiencePath(facet: ExperienceFacet): string {
  return `/experiencePreferences/${facet}`;
}

/**
 * Conservative local experiment: remove only an ungrounded optional family
 * assertion when the source contains no family-related language at all.
 * Every input is cloned so the provider Draft remains immutable.
 */
export function elideUnprovenOptionalFamilyAssertion(
  input: TripRequestDraftV2,
  rawText: string,
): TripRequestDraftV2 {
  const draft = structuredClone(input);
  if (
    draft.family !== false ||
    draft.evidence.some((item) => item.path === '/family') ||
    parseTripRequest(rawText).family !== false ||
    hasFamilyLanguage(rawText)
  )
    return draft;
  draft.family = null;
  return draft;
}

/**
 * Conservative local experiment: remove an optional experience assertion only
 * when the source has no generic language for that facet. A named POI may
 * remain as its own constraint, but must not silently turn into a category-wide
 * preference. Explicit positive and negative facet language is never elided.
 *
 * The draft and its evidence array are cloned, so provider output stays
 * immutable. Removing the matching evidence prevents an orphan coordinate
 * after the optional assertion becomes null.
 */
export function elideUnprovenOptionalAssertions(
  input: TripRequestDraftV2,
  rawText: string,
): TripRequestDraftV2 {
  const draft = elideUnprovenOptionalFamilyAssertion(input, rawText);
  const parsed = parseTripRequest(rawText);
  const pathsToElide = new Set<string>();

  for (const facet of EXPERIENCE_FACETS) {
    if (draft.experiencePreferences[facet] === null) continue;
    if (
      parsed.experiencePreferences[facet] !== 'neutral' ||
      hasExperienceFacetLanguage(rawText, facet)
    )
      continue;
    draft.experiencePreferences[facet] = null;
    pathsToElide.add(experiencePath(facet));
  }
  if (pathsToElide.size > 0)
    draft.evidence = draft.evidence.filter(
      (item) => !pathsToElide.has(item.path),
    );
  return draft;
}

/**
 * This is deliberately a deny-list rather than an attempt to understand
 * negation. A hit means that the source is not clearly absent, so elision is
 * forbidden. Keep additions conservative and covered by tests.
 */
export function hasFamilyLanguage(rawText: string): boolean {
  return /家庭|亲子|两大一小|一大一小|带娃|带孩子|带崽|宝宝|宝贝|小宝|娃娃|小朋友|小孩(?:儿)?|儿童|孩子|孩童|幼童|未成年人|母婴|父母|家长|女儿|儿子|闺女|孙子|孙女|家人|一家|family|families|parent(?:s)?|kid(?:s)?|child(?:ren)?|baby|babies|infant(?:s)?|toddler(?:s)?|daughter|daughters|son|sons|(?:\d+|[一二三四五六七八九十百两零〇]+)\s*(?:岁|个月|月)/iu.test(
    rawText.normalize('NFKC'),
  );
}
