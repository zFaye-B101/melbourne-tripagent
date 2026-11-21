import poiSnapshot from '@/data/melbourne-pois-v0.1.json';
import fareSnapshotJson from '@/data/ptv-fares-v0.4.json';
import admissionSnapshotJson from '../../../data/verified/poi-admission-price-v0.4.json';
import visitorAdviceSnapshot from '@/data/visitor-advice-v1.json';

import {
  DEFAULT_RUNTIME_RULES,
  type RuntimeRules,
} from './runtime-config-state';
import {
  assumptionCostItems,
  NO_COST_ASSUMPTIONS,
  parseCostAssumptions,
  type AssumptionCostItem,
  type CostAssumptions,
} from './cost-assumptions';

export type Interest = 'art' | 'history' | 'nature' | 'food' | 'family';
export type Pace = 'relaxed' | 'balanced' | 'packed';
export type CheckStatus = 'pass' | 'fail' | 'not_verifiable';
export type PreferenceState = 'prefer' | 'neutral' | 'avoid';
export type FieldSource = 'structured' | 'text' | 'legacy_v1' | 'default';
export type VenuePreference =
  | 'strong_outdoor'
  | 'outdoor'
  | 'neutral'
  | 'indoor'
  | 'strong_indoor';
export type GeoScope =
  | 'cbd_core_v1'
  | 'central_city_v1'
  | 'supported_inner_city';
export type PoiCategory =
  | 'art_culture'
  | 'history'
  | 'nature'
  | 'city_landmark'
  | 'market_food'
  | 'family';
export type ExperienceFacet =
  | 'museum_exhibition'
  | 'history_heritage'
  | 'parks_gardens'
  | 'river_city_walk'
  | 'city_icons_views'
  | 'performance_music'
  | 'sports_venues'
  | 'market_local_life';
export type SettingConflictField =
  | 'days'
  | 'start_time'
  | 'origin'
  | 'area'
  | 'venue'
  | 'pace'
  | 'experiences'
  | 'date'
  | 'budget'
  | 'party';

const NON_AUD_CURRENCY_PATTERN =
  /(?:CNY|RMB|人民币|人民币元|¥|JPY|日元|USD|美元|US\$|EUR|欧元|€|GBP|英镑|£|HKD|港币|港元|SGD|新元|新币|CAD|加元|NZD|纽币|新西兰元)/i;

export function containsExplicitNonAudCurrency(text: string): boolean {
  return NON_AUD_CURRENCY_PATTERN.test(text.normalize('NFKC'));
}

export function isValidIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export interface SettingConflict {
  field: SettingConflictField;
  message: string;
}

export interface ExperienceFacetDefinition {
  id: ExperienceFacet;
  label: string;
  shortLabel: string;
  description: string;
}

export interface Poi {
  id: string;
  nameZh: string;
  nameEn: string;
  aliases: string[];
  category: PoiCategory;
  tags: string[];
  latitude: number;
  longitude: number;
  cluster: string;
  area: string;
  suggestedMinutes: number;
  indoorOutdoor: 'indoor' | 'outdoor' | 'mixed' | 'conditional' | 'unknown';
  familyFriendly: boolean | null;
  lowWalkingFriendly: boolean | null;
  priceStatus:
    | 'free_general_entry_official'
    | 'mixed_official'
    | 'paid_not_verified'
    | 'not_verified';
  summary: string;
  sourceTheme: string;
  sourceSubTheme: string;
  sourceRowKey: string;
  referenceUrl: string;
  referenceKind:
    | 'venue_official'
    | 'government'
    | 'transport_official'
    | 'dataset';
  referenceStatus: 'verified' | 'unverified';
  referenceVerifiedAt: string | null;
}

export interface PoiDataset {
  dataVersion: string;
  generatedAt: string;
  sourceDatasetId: string;
  sourceDatasetUrl: string;
  license: string;
  attribution: string;
  pois: Poi[];
}

export interface ResolvedOrigin {
  kind: 'poi' | 'preset_proxy';
  refId: string;
  label: string;
  latitude: number;
  longitude: number;
  resolution: 'exact_poi' | 'area_proxy' | 'default_proxy';
  source: FieldSource;
  evidence: string | null;
}

export interface DailyWindow {
  startMinutes: number;
  endMinutes: number;
  startSource: FieldSource;
  endSource: 'default';
  evidence: string | null;
}

export interface PricingParty {
  totalTravelers: number | null;
  ticketBreakdownStatus: 'complete' | 'partial' | 'unknown' | 'conflict';
  adultFullFareCount: number;
  concessionEligibleCount: number;
  childAges: number[];
  ptvPaymentMedium: 'contactless' | 'existing_myki' | 'new_physical_myki';
  source: 'visible_default_one_adult' | 'user_selected' | 'text';
}

export interface ParsedTripRequest {
  requestVersion: 'parsed-trip-request-v2';
  rawText: string;
  city: string;
  days: number | null;
  daysSource: FieldSource;
  pace: Pace;
  paceSource: FieldSource;
  requestedPace: Pace;
  effectivePace: Pace;
  interests: Interest[];
  preferIndoor: boolean;
  origin: ResolvedOrigin;
  dailyWindow: DailyWindow;
  geography: {
    scope: GeoScope;
    strength: 'soft' | 'hard';
    zoneVersion: 'mel-central-zones-v1';
    source: FieldSource;
    evidence: string | null;
  };
  venuePreference: {
    value: VenuePreference;
    source: FieldSource;
    evidence: string | null;
  };
  categoryPreferences: Record<PoiCategory, PreferenceState>;
  experiencePreferences: Record<ExperienceFacet, PreferenceState>;
  lowWalking: boolean;
  family: boolean;
  avoidCrowds: boolean;
  pricingParty: PricingParty;
  totalBudgetCents: number | null;
  mustIncludePoiIds: string[];
  excludePoiIds: string[];
  unknownHardConstraints: string[];
  dateText: string | null;
  assumptions: string[];
  warnings: string[];
  errors: string[];
  settingConflicts: SettingConflict[];
  needsClarification: Array<'days'>;
  /** 用户自填的住宿/餐饮费用假设；缺省视为都未提供。 */
  costAssumptions?: CostAssumptions;
}

export interface StructuredTripSettings {
  days?: number | null;
  startMinutes?: number | null;
  originPoiId?: string | null;
  geography?: GeoScope | null;
  venuePreference?: VenuePreference | null;
  pace?: Pace | null;
  categoryPreferences?: Partial<Record<PoiCategory, PreferenceState>>;
  experiencePreferences?: Partial<Record<ExperienceFacet, PreferenceState>>;
  originText?: string | null;
  lowWalking?: boolean | null;
  family?: boolean | null;
  dateText?: string | null;
  totalBudgetCents?: number | null;
  pricingParty?: Partial<PricingParty>;
  /** 提供的键覆盖描述中的同名假设；值为 null 表示清除。 */
  costAssumptions?: Partial<CostAssumptions>;
}

export interface TravelEstimate {
  distanceKm: number;
  minutes: number;
  mode: 'walk' | 'public_transport';
  method: 'straight_line_estimate';
}

export interface ItineraryStop {
  poiId: string;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  reasonTags: StopReasonTag[];
  reason: string;
  travelFromPrevious: TravelEstimate;
}

export type StopReasonTagCode =
  | 'experience_preference'
  | 'category_preference'
  | 'venue_preference'
  | 'central_city_preference'
  | 'family_friendly'
  | 'low_walking_friendly';

export interface StopReasonTag {
  code: StopReasonTagCode;
  label: string;
}

export interface MealBreak {
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  label: string;
}

export interface DayPlan {
  day: number;
  title: string;
  cluster: string;
  departureTime: string;
  originLabel: string;
  stops: ItineraryStop[];
  mealBreak: MealBreak;
  totalDistanceKm: number;
  finishTime: string;
}

export interface ConstraintCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  hard: boolean;
}

export interface MoneyRange {
  minCents: number | null;
  maxCents: number | null;
}

export interface BudgetEnvelopeV2 {
  currency: 'AUD';
  totalLimitCents: number | null;
  pricingParty: PricingParty;
  admissionRange: MoneyRange;
  transitRange: MoneyRange;
  mykiSetupRange: MoneyRange;
  knownComponentsRange: MoneyRange;
  totalRange: MoneyRange;
  coverage: {
    admission: 'complete' | 'partial' | 'none';
    transit:
      | 'daily_cap_allowance'
      | 'ftz_confirmed_zero'
      | 'walking_only_zero'
      | 'unknown';
    unknownItems: string[];
    excludedItems: string[];
  };
  comparison:
    | 'known_min_exceeds_limit'
    | 'known_components_within_limit'
    | 'indeterminate'
    | null;
  /** 按用户假设算出的住宿/餐饮分项；与已核实金额分开，不是价格事实。 */
  assumptionItems: AssumptionCostItem[];
  /** 已核实金额 + 用户假设。有任一假设项算不出或没有假设时为 null。 */
  estimateRange: MoneyRange | null;
  estimateComparison:
    | 'estimate_min_exceeds_limit'
    | 'estimate_within_limit'
    | 'indeterminate'
    | null;
  policyVersions: string[];
  verifiedAt: string;
}

export interface PlannerResult {
  resultId: string;
  plannerVersion: string;
  dataVersion: string;
  request: ParsedTripRequest;
  days: DayPlan[];
  checks: ConstraintCheck[];
  budget: BudgetEnvelopeV2;
  summary: {
    totalPois: number;
    totalDistanceKm: number;
    hardFailures: number;
    notVerifiable: number;
    centralCityPois: number;
    outdoorPois: number;
  };
}

export type PlanOutcome =
  | { ok: true; result: PlannerResult }
  | {
      ok: false;
      kind: 'clarification' | 'scope' | 'insufficient_data';
      message: string;
      request: ParsedTripRequest;
    };

export interface ReplaceOutcome {
  ok: boolean;
  result: PlannerResult;
  message: string;
  replacementId?: string;
  nextAttemptedPoiIds: string[];
  cycled: boolean;
}

export interface ReplacementOption {
  poi: Poi;
  startTime: string;
  endTime: string;
  dayFinishTime: string;
  dayDistanceKm: number;
  distanceDeltaKm: number;
  priceDisplay: string;
}

export type ReplacementBlockReasonCode =
  | 'already_in_itinerary'
  | 'excluded_by_user'
  | 'outside_hard_geography'
  | 'incomplete_data'
  | 'target_is_required'
  | 'would_break_day'
  | 'closed_on_day';

export interface ReplacementUnavailableOption {
  poi: Poi;
  reasonCode: ReplacementBlockReasonCode;
  reason: string;
}

export interface ReplacementAudit {
  checkedCount: number;
  eligible: ReplacementOption[];
  ineligible: ReplacementUnavailableOption[];
}

export type AdmissionBasis =
  | 'free_general_entry'
  | 'not_ticketed_public_space'
  | 'paid_fixed'
  | 'paid_from'
  | 'paid_range'
  | 'event_dependent'
  | 'unknown';

export interface AdmissionPriceRecord {
  poiId: string;
  currency: 'AUD' | null;
  basis: AdmissionBasis;
  tiers: Array<{
    ticketType: 'adult' | 'child' | 'concession';
    minCents: number | null;
    maxCents: number | null;
    eligibilityText: string | null;
  }>;
  displayText: string;
  inclusions: string[];
  exclusions: string[];
  bookingRequired: boolean | null;
  includedByDefault: boolean;
  verificationStatus:
    | 'verified_current'
    | 'verified_time_bounded'
    | 'review_due'
    | 'stale'
    | 'conflicted'
    | 'unknown';
  evidence: Array<{
    sourceUrl: string;
    sourceTitle: string;
    authority: 'official';
    retrievedAt: string;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    reviewAfter: string;
  }>;
}

export interface AdmissionSnapshot {
  snapshotVersion: string;
  currency: 'AUD';
  verifiedAt: string;
  records: AdmissionPriceRecord[];
}

export interface FareSnapshot {
  policyVersion: string;
  currency: 'AUD';
  effectiveFrom: string;
  effectiveUntil: string;
  verifiedAt: string;
  zone12: {
    fullFare: {
      twoHourCents: number;
      weekdayDailyCapCents: number;
      weekendHolidayDailyCapCents: number;
    };
    concession: {
      twoHourCents: number;
      weekdayDailyCapCents: number;
      weekendHolidayDailyCapCents: number;
    };
  };
  physicalCard: {
    fullFareCents: number;
    concessionCents: number;
    youthCents: number;
  };
  sourceUrl: string;
  policySourceUrl: string;
  notes: string[];
}

export let POI_DATASET = poiSnapshot as PoiDataset;
export let POIS = POI_DATASET.pois;
export let ADMISSION_PRICE_SNAPSHOT =
  admissionSnapshotJson as AdmissionSnapshot;
export let PTV_FARE_SNAPSHOT = fareSnapshotJson as FareSnapshot;
export const PLANNER_VERSION = 'trip-planner-v0.4.3-local';

let PLANNER_RULES: RuntimeRules = structuredClone(DEFAULT_RUNTIME_RULES);
const FLINDERS_ID = 'mel-flinders-street-railway-station-f898426a';
const CATEGORY_KEYS: PoiCategory[] = [
  'art_culture',
  'history',
  'nature',
  'city_landmark',
  'market_food',
  'family',
];
export const EXPERIENCE_FACETS: ExperienceFacetDefinition[] = [
  {
    id: 'museum_exhibition',
    label: '博物馆与展览',
    shortLabel: '博物馆展览',
    description: '博物馆、美术馆、影像与展览空间',
  },
  {
    id: 'history_heritage',
    label: '历史与遗产',
    shortLabel: '历史遗产',
    description: '历史建筑、城市记忆与文化遗产',
  },
  {
    id: 'parks_gardens',
    label: '公园与花园',
    shortLabel: '公园花园',
    description: '花园、公园、植物与户外绿地',
  },
  {
    id: 'river_city_walk',
    label: '河畔与城市散步',
    shortLabel: '河畔散步',
    description: '河畔、步道、桥梁与城市漫步',
  },
  {
    id: 'city_icons_views',
    label: '城市地标与观景',
    shortLabel: '地标观景',
    description: '代表性建筑、城市地标与观景点',
  },
  {
    id: 'performance_music',
    label: '演出与音乐',
    shortLabel: '演出音乐',
    description: '剧院、音乐厅与表演空间',
  },
  {
    id: 'sports_venues',
    label: '体育场馆',
    shortLabel: '体育场馆',
    description: '体育赛事与代表性场馆',
  },
  {
    id: 'market_local_life',
    label: '市集与本地生活',
    shortLabel: '市集生活',
    description: '市集和本地城市生活体验',
  },
];
const EXPERIENCE_KEYS = EXPERIENCE_FACETS.map((facet) => facet.id);
const CENTRAL_AREAS = new Set([
  'CBD 东南',
  'CBD 西南',
  'North CBD',
  'Federation Square',
  'Southbank',
  'Arts Precinct',
  '雅拉河畔',
  'East Melbourne',
]);
const CBD_CORE_AREAS = new Set([
  'CBD 东南',
  'CBD 西南',
  'North CBD',
  'Federation Square',
]);
const AREA_ORIGIN_PRESETS: Array<{
  id: string;
  label: string;
  aliases: RegExp;
  anchorPoiId: string;
}> = [
  {
    id: 'mel-cbd-proxy-flinders',
    label: 'Melbourne CBD（以弗林德斯街车站坐标估算）',
    aliases: /(?<![a-z])cbd(?![a-z])|市中心|墨尔本市中心/i,
    anchorPoiId: FLINDERS_ID,
  },
  {
    id: 'mel-southbank-proxy-skydeck',
    label: 'Southbank（以 Melbourne Skydeck 附近坐标估算）',
    aliases: /southbank|南岸/i,
    anchorPoiId: 'mel-eureka-skydeck-88-dc7ebb76',
  },
  {
    id: 'mel-docklands-proxy-park',
    label: 'Docklands（以 Docklands Park 附近坐标估算）',
    aliases: /docklands|码头区|港区/i,
    anchorPoiId: 'mel-docklands-park-80a8dcf4',
  },
  {
    id: 'mel-carlton-proxy-museum',
    label: 'Carlton（以墨尔本博物馆附近坐标估算）',
    aliases: /carlton|卡尔顿/i,
    anchorPoiId: 'mel-carlton-melbourne-museum',
  },
  {
    id: 'mel-east-melbourne-proxy-fitzroy',
    label: 'East Melbourne（以菲茨罗伊花园附近坐标估算）',
    aliases: /east\s*melbourne|东墨尔本/i,
    anchorPoiId: 'mel-east-fitzroy-gardens',
  },
];
let EXTRA_POI_ALIASES: Record<string, string[]> = structuredClone(
  DEFAULT_RUNTIME_RULES.extraPoiAliases,
);
function buildPoiAliasIndex(
  pois: readonly Poi[],
  extraAliases: Record<string, string[]>,
): Array<{ alias: string; poiId: string }> {
  return pois
    .flatMap((poi) =>
      [
        ...new Set([
          poi.nameZh,
          poi.nameEn,
          ...poi.aliases,
          ...(extraAliases[poi.id] ?? []),
        ]),
      ]
        .filter(Boolean)
        .map((alias) => ({ alias, poiId: poi.id })),
    )
    .sort(
      (a, b) =>
        b.alias.length - a.alias.length || a.poiId.localeCompare(b.poiId),
    );
}
let POI_ALIAS_INDEX = buildPoiAliasIndex(POIS, EXTRA_POI_ALIASES);

export type PoiNameResolution =
  | { status: 'resolved'; poiId: string }
  | { status: 'unknown'; poiId: null }
  | { status: 'ambiguous'; poiId: null; candidatePoiIds: string[] };

export function resolvePoiNameCandidate(name: string): PoiNameResolution {
  const normalized = name.normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalized) return { status: 'unknown', poiId: null };
  const candidatePoiIds = [
    ...new Set(
      POI_ALIAS_INDEX.filter(
        ({ alias }) =>
          alias.normalize('NFKC').trim().toLocaleLowerCase() === normalized,
      ).map(({ poiId }) => poiId),
    ),
  ].sort();
  if (candidatePoiIds.length === 1)
    return { status: 'resolved', poiId: candidatePoiIds[0] };
  if (candidatePoiIds.length > 1)
    return { status: 'ambiguous', poiId: null, candidatePoiIds };
  return { status: 'unknown', poiId: null };
}
const CHINESE_NUMBERS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};
const CITY_KEYWORDS: Array<[RegExp, string]> = [
  [/(墨尔本|melbourne)/i, 'Melbourne'],
  [/(悉尼|sydney)/i, 'Sydney'],
  [/(布里斯班|brisbane)/i, 'Brisbane'],
  [/(珀斯|perth)/i, 'Perth'],
  [/(阿德莱德|adelaide)/i, 'Adelaide'],
  [/(堪培拉|canberra)/i, 'Canberra'],
  [/(霍巴特|hobart)/i, 'Hobart'],
];
const INTEREST_MATCHERS: Array<[Interest, PoiCategory, RegExp]> = [
  ['art', 'art_culture', /(艺术|美术|画廊|影像|设计|art|gallery)/i],
  ['history', 'history', /(历史|人文|建筑|遗产|监狱|history|heritage)/i],
  ['nature', 'nature', /(花园|自然|公园|植物|garden|nature|park)/i],
  ['food', 'market_food', /(市场|市集|market)/i],
  ['family', 'family', /(亲子|孩子|儿童|家庭|family|kid)/i],
];
const EXPERIENCE_MATCHERS: Array<[ExperienceFacet, RegExp]> = [
  [
    'museum_exhibition',
    /(博物馆|美术馆|展览|画廊|影像|museum|gallery|exhibition)/i,
  ],
  ['history_heritage', /(历史|人文|建筑|遗产|监狱|教堂|history|heritage)/i],
  ['parks_gardens', /(花园|自然|公园|植物|garden|nature|park)/i],
  ['river_city_walk', /(河畔|河边|散步|步道|漫步|桥梁|river|walk|promenade)/i],
  ['city_icons_views', /(地标|城市风景|观景|天际线|landmark|skyline|view)/i],
  ['performance_music', /(演出|音乐|剧院|音乐厅|concert|theatre|performance)/i],
  ['sports_venues', /(体育|球场|网球|赛事|sport|stadium|arena)/i],
  ['market_local_life', /(市场|市集|本地生活|market|local life)/i],
];

/**
 * Returns whether the traveller wrote an explicit generic experience cue for
 * a facet. Catalogued POI names and aliases are removed before matching, so a
 * request for one known venue does not become a preference for every venue in
 * that category. Unknown venue names are deliberately not guessed here.
 */
export function hasExperienceFacetLanguage(
  rawText: string,
  facet: ExperienceFacet,
): boolean {
  const matcher = EXPERIENCE_MATCHERS.find(
    ([candidate]) => candidate === facet,
  );
  return Boolean(matcher?.[1].test(stripCataloguedPoiNames(rawText)));
}

function stripCataloguedPoiNames(rawText: string): string {
  let remaining = rawText.normalize('NFKC');
  for (const { alias } of POI_ALIAS_INDEX) {
    const escapedAlias = alias
      .normalize('NFKC')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedAlias)
      remaining = remaining.replace(new RegExp(escapedAlias, 'giu'), ' ');
  }
  return remaining;
}
const CATEGORY_INTEREST: Record<PoiCategory, Interest | null> = {
  art_culture: 'art',
  history: 'history',
  nature: 'nature',
  city_landmark: null,
  market_food: 'food',
  family: 'family',
};
const CLUSTER_TITLES: Record<string, string> = {
  cbd_river: '河畔文化线',
  arts_south: '艺术花园线',
  north_cbd: '北城历史线',
  carlton_east: 'Carlton 博物馆线',
};

function startWindowText(): string {
  return `${formatTime(PLANNER_RULES.earliestStartMinutes)}–${formatTime(PLANNER_RULES.latestStartMinutes)}`;
}

export function parseTripRequest(rawText: string): ParsedTripRequest {
  const text = rawText.normalize('NFKC').trim();
  const preferenceText = stripNegatedPreferenceClauses(text);
  const city =
    CITY_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1] ?? 'Melbourne';
  const dayMatch = text.match(/([1-9一二两三四五六七八九])\s*天/);
  const dayToken = dayMatch?.[1];
  const days = dayToken
    ? Number.isNaN(Number(dayToken))
      ? CHINESE_NUMBERS[dayToken]
      : Number(dayToken)
    : null;
  const matchedInterests = INTEREST_MATCHERS.filter(([, , pattern]) =>
    pattern.test(preferenceText),
  );
  const interests = [
    ...new Set(matchedInterests.map(([interest]) => interest)),
  ];
  const categoryPreferences = neutralCategoryPreferences();
  for (const [, category] of matchedInterests)
    categoryPreferences[category] = 'prefer';
  if (/(地标|城市风景|landmark)/i.test(preferenceText))
    categoryPreferences.city_landmark = 'prefer';
  const experiencePreferences = neutralExperiencePreferences();
  for (const [facet, pattern] of EXPERIENCE_MATCHERS) {
    if (pattern.test(preferenceText)) experiencePreferences[facet] = 'prefer';
  }
  // 否定子句里的体验类别（「不想去室内博物馆」）记为避开；具体地点名先去掉，由必去/避开地点处理。
  const negatedText = stripCataloguedPoiNames(negatedPreferenceText(text));
  for (const [facet, pattern] of EXPERIENCE_MATCHERS) {
    if (pattern.test(negatedText) && experiencePreferences[facet] !== 'prefer')
      experiencePreferences[facet] = 'avoid';
  }

  const relaxedPaceCue =
    text.match(/(轻松|休闲|慢慢|relaxed)/i)?.[0] ??
    text.match(
      /(?:别|不要|不想|不愿|避免|尽量不)[^，。；;]{0,8}(?:太赶|赶时间|排(?:得)?太满|安排(?:得)?太满|太紧|太紧凑)|慢悠悠|悠闲|从容|不赶时间/i,
    )?.[0] ??
    null;
  const packedPaceCue = text.match(/(充实|多安排|紧凑|packed)/i)?.[0] ?? null;
  const paceEvidence = packedPaceCue ?? relaxedPaceCue;
  const pace: Pace =
    relaxedPaceCue && !packedPaceCue
      ? 'relaxed'
      : packedPaceCue
        ? 'packed'
        : 'balanced';
  const neutralVenue =
    /(室内外都可以|室内外都行|室内外无所谓|没有室内外偏好)/i.test(
      preferenceText,
    );
  const outdoorEvidence =
    preferenceText.match(
      /(?:(?:喜欢|偏好|优先|多安排|主要|以)[^,，。；;\n]{0,8}(?:户外|室外|露天)(?:[^,，。；;\n]{0,4}为主)?|(?:户外|室外|露天)[^,，。；;\n]{0,4}(?:为主|优先))/i,
    )?.[0] ?? null;
  const indoorEvidence =
    preferenceText.match(
      /(?:(?:喜欢|偏好|优先|多安排|安排|主要|以|下雨[^,，。；;\n]{0,4}优先)[^,，。；;\n]{0,8}(?:室内|室内场馆)(?:[^,，。；;\n]{0,4}为主)?|(?:室内|室内场馆)[^,，。；;\n]{0,4}(?:为主|优先))/i,
    )?.[0] ?? null;
  const venueValue: VenuePreference = neutralVenue
    ? 'neutral'
    : outdoorEvidence
      ? 'outdoor'
      : indoorEvidence
        ? 'indoor'
        : 'neutral';
  const venueEvidence = neutralVenue
    ? (preferenceText.match(/室内外[^，。；;\n]*/i)?.[0] ?? null)
    : (outdoorEvidence ?? indoorEvidence);
  const hardGeoEvidence =
    text.match(
      /(?:只在|仅限|不要离开|不能超出)[^,，。；;\n]{0,8}(?:CBD|市区|市中心)/i,
    )?.[0] ?? null;
  const softGeoEvidence =
    text.match(
      /(?:主要在|以[^,，。；;\n]{0,6}为主|尽量在|优先在)[^,，。；;\n]{0,8}(?:市内|市区|市中心|CBD)/i,
    )?.[0] ?? null;
  const geography = hardGeoEvidence
    ? {
        scope: 'cbd_core_v1' as const,
        strength: 'hard' as const,
        zoneVersion: 'mel-central-zones-v1' as const,
        source: 'text' as const,
        evidence: hardGeoEvidence,
      }
    : softGeoEvidence
      ? {
          scope: 'central_city_v1' as const,
          strength: 'soft' as const,
          zoneVersion: 'mel-central-zones-v1' as const,
          source: 'text' as const,
          evidence: softGeoEvidence,
        }
      : {
          scope: 'supported_inner_city' as const,
          strength: 'soft' as const,
          zoneVersion: 'mel-central-zones-v1' as const,
          source: 'default' as const,
          evidence: null,
        };

  const origin = parseOrigin(text);
  const parsedStart = parseStartTime(text);
  const hardPoiConstraints = parseHardPoiConstraints(text);
  const party = parsePricingParty(text);
  const costAssumptions = parseCostAssumptions(text);
  const dateText = text.match(/\b20\d{2}-\d{2}-\d{2}\b/)?.[0] ?? null;
  const budgetClause = text.match(/(?:预算|budget)[^,，。；;\n]*/i)?.[0] ?? '';
  const nonAudBudgetCurrency = containsExplicitNonAudCurrency(budgetClause);
  const budgetMatch = nonAudBudgetCurrency
    ? null
    : text.match(
        /(?:预算|budget)[^\d]{0,8}(\d+(?:\.\d{1,2})?)\s*(?:澳元|AUD|A\$)?/i,
      );
  const totalBudgetCents = budgetMatch
    ? Math.round(Number(budgetMatch[1]) * 100)
    : null;
  const lowWalking =
    /(少走路|少步行|不想走|老人|长辈|low walking)/i.test(text) &&
    !/(?:不需要|无需|不用|不必|没有|不带)[^,，。；;\n]{0,8}(?:少走路|少步行|老人|长辈|low walking)/i.test(
      text,
    );
  const family =
    /(亲子|孩子|儿童|家庭|family|kid)/i.test(text) &&
    !/(?:没有|不带|不是|无需|不需要)[^,，。；;\n]{0,8}(?:亲子|孩子|儿童|家庭|family|kid)/i.test(
      text,
    );
  const avoidCrowds =
    /(避开.{0,4}(热门|网红|人多|拥挤)|小众|少人|quiet|crowd)/i.test(text) &&
    !/(?:不需要|无需|不用|不必|不想)[^,，。；;\n]{0,10}(?:避开|小众|少人|quiet|crowd)/i.test(
      text,
    );
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const needsClarification: Array<'days'> = [];

  if (!text) errors.push('请先描述旅行需求，或打开详细设置补充条件。');
  if (city !== 'Melbourne')
    errors.push(`当前版本只支持 Melbourne，不能生成 ${city} 行程。`);
  if (days === null) needsClarification.push('days');
  if (days !== null && (days < 1 || days > 3))
    errors.push('当前版本只支持 1–3 天，不能静默缩短或延长。');
  if (parsedStart.error) errors.push(parsedStart.error);
  if (origin.error) errors.push(origin.error);
  if (origin.note) warnings.push(origin.note);
  if (dateText && !isValidIsoCalendarDate(dateText))
    errors.push('日期无效，请使用真实的 YYYY-MM-DD 日期。');
  if (hardPoiConstraints.unknown.length > 0)
    errors.push(
      `当前 ${POIS.length} 个地点中还没有：${hardPoiConstraints.unknown.join('、')}。请换一个地点或取消指定。`,
    );
  const hardConflict = hardPoiConstraints.mustInclude.find((id) =>
    hardPoiConstraints.exclude.includes(id),
  );
  if (hardConflict)
    errors.push(`“${poiName(hardConflict)}”不能同时设为必去和避开。`);
  if (geography.strength === 'hard') {
    const outside = hardPoiConstraints.mustInclude.find((id) => {
      const poi = POIS.find((item) => item.id === id);
      return poi ? !CBD_CORE_AREAS.has(poi.area) : false;
    });
    if (outside)
      errors.push(
        `“${poiName(outside)}”不在 CBD 范围内，请调整必去地点或主要活动区域。`,
      );
  }
  if (interests.length === 0)
    assumptions.push('未识别明确兴趣，将优先数据完整度与区域聚合。');
  if (!paceEvidence) assumptions.push('未指定节奏，按均衡节奏安排。');
  if (!dateText)
    warnings.push('未提供明确日期，营业时间与周末票价暂不可精确核实。');
  if (/(周末|下周|明天|后天)/.test(text))
    warnings.push('相对日期只保留为文字，不自动换算。');
  if (avoidCrowds)
    warnings.push('现场拥挤程度缺少实时数据，只能标为暂不可核实。');
  if (nonAudBudgetCurrency)
    errors.push('当前预算只支持 AUD；其他币种不会自动换算，请改用澳元金额。');
  errors.push(...party.errors);
  warnings.push(...costAssumptions.warnings);
  if (
    /(咖啡|餐厅|餐馆|夜生活|coffee|restaurant|nightlife)/i.test(preferenceText)
  ) {
    warnings.push(
      '当前地点库不足以可靠按咖啡、餐厅或夜生活偏好排程；该偏好已保留在原文，但尚未用于排序。',
    );
  }

  return {
    requestVersion: 'parsed-trip-request-v2',
    rawText,
    city,
    days,
    daysSource: days === null ? 'default' : 'text',
    pace,
    paceSource: paceEvidence ? 'text' : 'default',
    requestedPace: pace,
    effectivePace: pace,
    interests,
    preferIndoor: venueValue === 'indoor',
    origin: origin.value,
    dailyWindow: {
      startMinutes: parsedStart.minutes ?? PLANNER_RULES.defaultStartMinutes,
      endMinutes: PLANNER_RULES.defaultEndMinutes,
      startSource: parsedStart.evidence ? 'text' : 'default',
      endSource: 'default',
      evidence: parsedStart.evidence,
    },
    geography,
    venuePreference: {
      value: venueValue,
      source: venueEvidence ? 'text' : 'default',
      evidence: venueEvidence,
    },
    categoryPreferences,
    experiencePreferences,
    lowWalking,
    family,
    avoidCrowds,
    pricingParty: party.value,
    totalBudgetCents,
    mustIncludePoiIds: hardPoiConstraints.mustInclude,
    excludePoiIds: hardPoiConstraints.exclude,
    unknownHardConstraints: hardPoiConstraints.unknown,
    dateText,
    assumptions,
    warnings,
    errors,
    settingConflicts: [],
    needsClarification,
    costAssumptions: costAssumptions.value,
  };
}

export function mergeStructuredTripRequest(
  request: ParsedTripRequest,
  settings: StructuredTripSettings,
): ParsedTripRequest {
  const next = structuredClone(request);
  const conflicts: SettingConflict[] = [];
  const addConflict = (field: SettingConflictField, message: string) =>
    conflicts.push({ field, message });
  if (settings.days != null) {
    if (request.daysSource === 'text' && request.days !== settings.days)
      addConflict(
        'days',
        `天数：描述中是 ${request.days} 天，详细设置中是 ${settings.days} 天`,
      );
    next.days = settings.days;
    next.daysSource = 'structured';
    next.needsClarification = [];
  }
  if (settings.startMinutes != null) {
    if (
      request.dailyWindow.startSource === 'text' &&
      request.dailyWindow.startMinutes !== settings.startMinutes
    )
      addConflict(
        'start_time',
        `出发时间：描述中是 ${formatTime(request.dailyWindow.startMinutes)}，详细设置中是 ${formatTime(settings.startMinutes)}`,
      );
    next.dailyWindow.startMinutes = settings.startMinutes;
    next.dailyWindow.startSource = 'structured';
    next.dailyWindow.evidence = '详细设置';
  }
  if (settings.originText?.trim()) {
    const normalizedOrigin = parseOrigin(
      `出发点在 ${settings.originText.trim()}`,
    );
    if (normalizedOrigin.error) {
      next.errors.push(normalizedOrigin.error);
    } else {
      const structuredOrigin = {
        ...normalizedOrigin.value,
        source: 'structured' as const,
        evidence: `详细设置：${settings.originText.trim()}`,
      };
      if (
        request.origin.source === 'text' &&
        request.origin.refId !== structuredOrigin.refId
      ) {
        addConflict(
          'origin',
          `每天起点：描述中是 ${request.origin.label}，详细设置中是 ${structuredOrigin.label}`,
        );
      }
      next.origin = structuredOrigin;
    }
  } else if (settings.originPoiId != null) {
    const structuredOrigin =
      settings.originPoiId === 'cbd_proxy'
        ? makeCbdOrigin('structured', 'area_proxy', '详细设置')
        : makePoiOrigin(settings.originPoiId, 'structured', '详细设置');
    if (!structuredOrigin)
      next.errors.push('详细设置中的起点不在当前 40 个地点中。');
    else {
      if (
        request.origin.source === 'text' &&
        request.origin.refId !== structuredOrigin.refId
      )
        addConflict(
          'origin',
          `每天起点：描述中是 ${request.origin.label}，详细设置中是 ${structuredOrigin.label}`,
        );
      next.origin = structuredOrigin;
    }
  }
  if (settings.geography != null) {
    if (
      request.geography.source === 'text' &&
      request.geography.scope !== settings.geography
    )
      addConflict(
        'area',
        `主要活动区域：描述中是${geoScopeLabel(request.geography.scope)}，详细设置中是${geoScopeLabel(settings.geography)}`,
      );
    next.geography = {
      scope: settings.geography,
      strength: settings.geography === 'cbd_core_v1' ? 'hard' : 'soft',
      zoneVersion: 'mel-central-zones-v1',
      source: 'structured',
      evidence: '详细设置',
    };
  }
  if (settings.venuePreference != null) {
    if (
      request.venuePreference.source === 'text' &&
      request.venuePreference.value !== settings.venuePreference
    )
      addConflict(
        'venue',
        `室内外偏好：描述中是${venuePreferenceLabel(request.venuePreference.value)}，详细设置中是${venuePreferenceLabel(settings.venuePreference)}`,
      );
    next.venuePreference = {
      value: settings.venuePreference,
      source: 'structured',
      evidence: '详细设置',
    };
    next.preferIndoor =
      settings.venuePreference === 'indoor' ||
      settings.venuePreference === 'strong_indoor';
  }
  if (settings.pace != null) {
    if (request.paceSource === 'text' && request.pace !== settings.pace)
      addConflict(
        'pace',
        `游玩节奏：描述中是${paceLabel(request.pace)}，详细设置中是${paceLabel(settings.pace)}`,
      );
    next.pace = settings.pace;
    next.requestedPace = settings.pace;
    next.effectivePace = settings.pace;
    next.paceSource = 'structured';
  }
  if (settings.categoryPreferences) {
    for (const category of CATEGORY_KEYS) {
      const value = settings.categoryPreferences[category];
      if (!value) continue;
      const current = request.categoryPreferences[category];
      if (current !== 'neutral' && value !== 'neutral' && current !== value)
        addConflict(
          'experiences',
          `“${categoryLabel(category)}”：描述中希望${current === 'prefer' ? '多安排' : '少安排'}，详细设置中选择了${value === 'prefer' ? '多安排' : '少安排'}`,
        );
      next.categoryPreferences[category] = value;
    }
    next.interests = interestsFromCategories(next.categoryPreferences);
  }
  if (settings.experiencePreferences) {
    for (const facet of EXPERIENCE_KEYS) {
      const value = settings.experiencePreferences[facet];
      if (!value) continue;
      const current = request.experiencePreferences[facet];
      if (current !== 'neutral' && value !== 'neutral' && current !== value) {
        addConflict(
          'experiences',
          `“${experienceFacetLabel(facet)}”：描述中希望${current === 'prefer' ? '多安排' : '少安排'}，详细设置中选择了${value === 'prefer' ? '多安排' : '少安排'}`,
        );
      }
      next.experiencePreferences[facet] = value;
    }
  }
  if (settings.lowWalking != null) next.lowWalking = settings.lowWalking;
  if (settings.family != null) next.family = settings.family;
  if (settings.dateText !== undefined) {
    if (
      request.dateText &&
      settings.dateText &&
      request.dateText !== settings.dateText
    )
      addConflict(
        'date',
        `旅行日期：描述中是 ${request.dateText}，详细设置中是 ${settings.dateText}`,
      );
    next.dateText = settings.dateText || null;
  }
  if (settings.totalBudgetCents !== undefined) {
    if (
      request.totalBudgetCents != null &&
      settings.totalBudgetCents != null &&
      request.totalBudgetCents !== settings.totalBudgetCents
    )
      addConflict(
        'budget',
        `旅行预算：描述中是 A$${(request.totalBudgetCents / 100).toFixed(0)}，详细设置中是 A$${(settings.totalBudgetCents / 100).toFixed(0)}`,
      );
    next.totalBudgetCents = settings.totalBudgetCents;
  }
  if (settings.costAssumptions) {
    const current = next.costAssumptions ?? NO_COST_ASSUMPTIONS;
    const updated: CostAssumptions = { ...current };
    const describe = (key: keyof CostAssumptions, value: CostAssumptions[keyof CostAssumptions]) => {
      if (!value) return '未填写';
      if (key === 'accommodation' && 'perNightMinCents' in value)
        return `每晚 A$${value.perNightMinCents / 100}–${value.perNightMaxCents / 100}${value.nights ? `、${value.nights} 晚` : ''}`;
      if ('perPersonPerDayMinCents' in value)
        return `每人每天 A$${value.perPersonPerDayMinCents / 100}–${value.perPersonPerDayMaxCents / 100}`;
      return '已填写';
    };
    for (const key of ['accommodation', 'food'] as const) {
      if (!(key in settings.costAssumptions)) continue;
      const incoming = settings.costAssumptions[key] ?? null;
      const fromText = current[key];
      if (
        fromText?.source === 'text' &&
        incoming &&
        JSON.stringify({ ...fromText, source: null, evidence: null }) !==
          JSON.stringify({ ...incoming, source: null, evidence: null })
      )
        addConflict(
          'budget',
          `${key === 'accommodation' ? '住宿估算' : '餐饮估算'}：描述中是${describe(key, fromText)}，详细设置中是${describe(key, incoming)}`,
        );
      if (key === 'accommodation')
        updated.accommodation = incoming as CostAssumptions['accommodation'];
      else updated.food = incoming as CostAssumptions['food'];
    }
    next.costAssumptions = updated;
  }
  if (settings.pricingParty) {
    const setting = settings.pricingParty;
    const changesTicketCounts =
      setting.adultFullFareCount !== undefined ||
      setting.concessionEligibleCount !== undefined ||
      setting.childAges !== undefined;
    const selectedCount =
      (setting.adultFullFareCount ?? next.pricingParty.adultFullFareCount) +
      (setting.concessionEligibleCount ?? next.pricingParty.concessionEligibleCount) +
      (setting.childAges ?? next.pricingParty.childAges).length;
    if (
      changesTicketCounts &&
      request.pricingParty.source === 'text' &&
      request.pricingParty.totalTravelers !== null &&
      request.pricingParty.totalTravelers !== selectedCount
    )
      addConflict(
        'party',
        `同行人数：描述中是 ${request.pricingParty.totalTravelers} 人，详细设置中是 ${selectedCount} 人`,
      );
    next.pricingParty = reconcilePricingParty({
      ...next.pricingParty,
      ...setting,
      totalTravelers: changesTicketCounts
        ? selectedCount
        : next.pricingParty.totalTravelers,
      source: changesTicketCounts ? 'user_selected' : next.pricingParty.source,
    });
  }
  if (request.rawText.trim().length === 0 && settings.days != null) {
    next.errors = next.errors.filter(
      (item) => !item.startsWith('请先描述旅行需求'),
    );
  }
  if (
    next.dailyWindow.startMinutes < PLANNER_RULES.earliestStartMinutes ||
    next.dailyWindow.startMinutes > PLANNER_RULES.latestStartMinutes ||
    next.dailyWindow.startMinutes % 15 !== 0
  )
    next.errors.push(`每日开始时间须在 ${startWindowText()}，且按 15 分钟选择。`);
  if (next.totalBudgetCents != null && next.totalBudgetCents < 0)
    next.errors.push('旅行预算不能为负数。');
  next.settingConflicts = conflicts;
  if (conflicts.length > 0)
    next.errors.push(
      `旅行描述和详细设置有 ${conflicts.length} 处不一致：${conflicts.map((item) => item.message).join('；')}。请修改其中一处后再继续。`,
    );
  return next;
}

export function mergePoiPreferenceConstraints(
  request: ParsedTripRequest,
  mustIds: string[],
  avoidIds: string[],
): ParsedTripRequest {
  const next = structuredClone(request);
  const cardMust = [...new Set(mustIds)];
  const cardAvoid = [...new Set(avoidIds)];
  const conflict =
    cardMust.find((id) => next.excludePoiIds.includes(id)) ??
    cardAvoid.find((id) => next.mustIncludePoiIds.includes(id));
  if (conflict)
    next.errors.push(
      `热门卡与文字对“${poiName(conflict)}”给出了相反选择，请统一后再生成。`,
    );
  next.mustIncludePoiIds = [
    ...new Set([...next.mustIncludePoiIds, ...cardMust]),
  ];
  next.excludePoiIds = [...new Set([...next.excludePoiIds, ...cardAvoid])];
  return next;
}

/**
 * 已核实的固定休市日（目前只有维多利亚女王市场，来源见 visitor-advice-v1.json）。
 * 只有用户给了明确日期时才生效；没有日期时照旧规划，由出发准备里的提醒兜底。
 */
let CLOSED_WEEKDAYS: Record<string, number[]> = {
  'mel-cbd-qvm': visitorAdviceSnapshot.qvm.closedWeekdays,
};
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function tripDayWeekday(request: ParsedTripRequest, dayIndex: number): number | null {
  if (!request.dateText || !isValidIsoCalendarDate(request.dateText)) return null;
  const date = new Date(`${request.dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayIndex);
  return date.getUTCDay();
}

function isClosedOnTripDay(
  poiId: string,
  request: ParsedTripRequest,
  dayIndex: number,
): boolean {
  const weekday = tripDayWeekday(request, dayIndex);
  return weekday !== null && (CLOSED_WEEKDAYS[poiId] ?? []).includes(weekday);
}

export interface PlannerRuntimeAdvice {
  qvm: { closedWeekdays: number[] };
}

export interface PlannerRuntimeInput {
  poiDataset: PoiDataset;
  admissionSnapshot: AdmissionSnapshot;
  fareSnapshot: FareSnapshot;
  adviceSnapshot: PlannerRuntimeAdvice;
  rules: RuntimeRules;
}

function installPlannerRuntime(input: PlannerRuntimeInput): void {
  if (input.poiDataset.pois.length === 0)
    throw new Error('运行时 POI 快照不能为空。');
  POI_DATASET = input.poiDataset;
  POIS = POI_DATASET.pois;
  ADMISSION_PRICE_SNAPSHOT = input.admissionSnapshot;
  PTV_FARE_SNAPSHOT = input.fareSnapshot;
  PLANNER_RULES = {
    ...structuredClone(DEFAULT_RUNTIME_RULES),
    ...input.rules,
    extraPoiAliases: {
      ...DEFAULT_RUNTIME_RULES.extraPoiAliases,
      ...input.rules.extraPoiAliases,
    },
  };
  EXTRA_POI_ALIASES = PLANNER_RULES.extraPoiAliases;
  POI_ALIAS_INDEX = buildPoiAliasIndex(POIS, EXTRA_POI_ALIASES);
  CLOSED_WEEKDAYS = {
    'mel-cbd-qvm': input.adviceSnapshot.qvm.closedWeekdays,
  };
}

export function applyPlannerRuntime(input: PlannerRuntimeInput): void {
  installPlannerRuntime(input);
}

export function resetPlannerRuntime(): void {
  installPlannerRuntime({
    poiDataset: structuredClone(poiSnapshot) as PoiDataset,
    admissionSnapshot: structuredClone(
      admissionSnapshotJson,
    ) as AdmissionSnapshot,
    fareSnapshot: structuredClone(fareSnapshotJson) as FareSnapshot,
    adviceSnapshot: visitorAdviceSnapshot as PlannerRuntimeAdvice,
    rules: structuredClone(DEFAULT_RUNTIME_RULES),
  });
}

export function planTrip(
  request: ParsedTripRequest,
  dataset: PoiDataset = POI_DATASET,
): PlanOutcome {
  if (request.errors.length > 0)
    return { ok: false, kind: 'scope', message: request.errors[0], request };
  if (request.days === null)
    return {
      ok: false,
      kind: 'clarification',
      message: '计划在墨尔本玩几天？请选择 1、2 或 3 天。',
      request,
    };
  const excluded = new Set(request.excludePoiIds);
  const validPois = dataset.pois.filter(
    (poi) =>
      isValidPoi(poi) &&
      !excluded.has(poi.id) &&
      isAllowedByHardGeography(poi, request),
  );
  const mustPois = request.mustIncludePoiIds
    .map((id) => validPois.find((poi) => poi.id === id))
    .filter((poi): poi is Poi => Boolean(poi));
  if (mustPois.length !== request.mustIncludePoiIds.length)
    return {
      ok: false,
      kind: 'insufficient_data',
      message: '有必去地点不在当前可用范围内，行程未更新。',
      request,
    };
  if (mustPois.length > request.days * 4)
    return {
      ok: false,
      kind: 'insufficient_data',
      message: `必去地点数量超过 ${request.days} 天最多可容纳的 ${request.days * 4} 个活动。`,
      request,
    };
  const clusterScores = [...new Set(validPois.map((poi) => poi.cluster))]
    .map((cluster) => ({
      cluster,
      score: validPois
        .filter((poi) => poi.cluster === cluster)
        .sort(
          (a, b) =>
            candidateRank(b, request, cluster) -
            candidateRank(a, request, cluster),
        )
        .slice(0, 4)
        .reduce((sum, poi) => sum + candidateRank(poi, request, cluster), 0),
    }))
    .sort((a, b) => b.score - a.score || a.cluster.localeCompare(b.cluster));
  const daySeeds: Poi[][] = Array.from({ length: request.days }, () => []);
  for (const must of mustPois) {
    const tripDays = request.days;
    const openDays = daySeeds.filter(
      (_, index) => !isClosedOnTripDay(must.id, request, index),
    );
    if (openDays.length === 0) {
      const closedNames = Array.from({ length: tripDays }, (_, index) =>
        WEEKDAY_NAMES[tripDayWeekday(request, index) ?? 0],
      ).join('、');
      return {
        ok: false,
        kind: 'insufficient_data',
        message: `“${poiName(must.id)}”在你的行程日期（${closedNames}）都不开市，请换日期、加一天或取消必去；行程未更新。`,
        request,
      };
    }
    const matching = daySeeds
      .map((seed, index) => ({
        index,
        seed,
        clusterMatch: seed[0]?.cluster === must.cluster ? 1 : 0,
      }))
      .filter((item) => !isClosedOnTripDay(must.id, request, item.index))
      .filter((item) => item.seed.length < 4)
      .sort(
        (a, b) =>
          b.clusterMatch - a.clusterMatch ||
          a.seed.length - b.seed.length ||
          a.index - b.index,
      )[0];
    if (!matching)
      return {
        ok: false,
        kind: 'insufficient_data',
        message: '必去地点超过行程容量，行程未更新。',
        request,
      };
    matching.seed.push(must);
  }
  const usedClusters = new Set<string>();
  const dayClusters = daySeeds.map((seed, index) => {
    const preferred =
      seed[0]?.cluster ??
      clusterScores.find((item) => !usedClusters.has(item.cluster))?.cluster ??
      clusterScores[index % Math.max(1, clusterScores.length)]?.cluster ??
      'cbd_river';
    usedClusters.add(preferred);
    return preferred;
  });
  const used = new Set<string>();
  const days: DayPlan[] = [];
  for (let index = 0; index < request.days; index += 1) {
    const required = daySeeds[index];
    const available = validPois.filter(
      (poi) =>
        (!used.has(poi.id) || required.some((item) => item.id === poi.id)) &&
        !isClosedOnTripDay(poi.id, request, index),
    );
    const day = findBestDay(
      index + 1,
      dayClusters[index],
      required,
      available,
      request,
    );
    if (!day)
      return {
        ok: false,
        kind: 'insufficient_data',
        message: `Day ${index + 1} 无法同时满足 ${formatTime(request.dailyWindow.startMinutes)}–${formatTime(request.dailyWindow.endMinutes)}、午餐和“${paceLabel(request.pace)}”全天覆盖；上一份行程保持不变。`,
        request,
      };
    day.stops.forEach((stop) => used.add(stop.poiId));
    days.push(day);
  }
  const plannedIds = days.flatMap((day) => day.stops.map((stop) => stop.poiId));
  const missingMust = request.mustIncludePoiIds.find(
    (id) => plannedIds.filter((item) => item === id).length !== 1,
  );
  if (missingMust)
    return {
      ok: false,
      kind: 'insufficient_data',
      message: `必去地点“${poiName(missingMust)}”无法在 ${formatTime(request.dailyWindow.startMinutes)}–${formatTime(request.dailyWindow.endMinutes)} 内合法排入，行程未更新。`,
      request,
    };
  return { ok: true, result: finalizeResult(request, days, dataset) };
}

export function auditReplacementOptions(
  result: PlannerResult,
  dayIndex: number,
  stopIndex: number,
  dataset: PoiDataset = POI_DATASET,
): ReplacementAudit {
  const day = result.days[dayIndex];
  const target = day?.stops[stopIndex];
  if (!day || !target) return { checkedCount: 0, eligible: [], ineligible: [] };
  const targetPoi = dataset.pois.find((poi) => poi.id === target.poiId);
  if (!targetPoi) return { checkedCount: 0, eligible: [], ineligible: [] };
  const used = new Set(
    result.days.flatMap((item) => item.stops.map((stop) => stop.poiId)),
  );
  const candidates = dataset.pois
    .filter((poi) => poi.id !== target.poiId)
    .sort((a, b) =>
      compareReplacementCandidates(a, b, targetPoi, result.request),
    );
  const eligible: ReplacementOption[] = [];
  const ineligible: ReplacementUnavailableOption[] = [];
  const targetIsRequired = result.request.mustIncludePoiIds.includes(
    target.poiId,
  );

  for (const candidate of candidates) {
    const blocked = replacementBlockReason(
      candidate,
      result,
      used,
      targetIsRequired,
    );
    if (blocked) {
      ineligible.push({ poi: candidate, ...blocked });
      continue;
    }
    if (isClosedOnTripDay(candidate.id, result.request, dayIndex)) {
      ineligible.push({
        poi: candidate,
        reasonCode: 'closed_on_day',
        reason: `这一天是${WEEKDAY_NAMES[tripDayWeekday(result.request, dayIndex) ?? 0]}，不开市`,
      });
      continue;
    }
    const pois = day.stops
      .map((stop, index) =>
        dataset.pois.find(
          (poi) => poi.id === (index === stopIndex ? candidate.id : stop.poiId),
        ),
      )
      .filter((poi): poi is Poi => Boolean(poi));
    const preview =
      pois.length === day.stops.length
        ? buildDayExact(day.day, day.cluster, pois, result.request)
        : null;
    if (!preview || !validDayCoverage(preview, result.request)) {
      ineligible.push({
        poi: candidate,
        reasonCode: 'would_break_day',
        reason: '无法保持当天时间、午餐或节奏覆盖',
      });
      continue;
    }
    const previewStop = preview.stops[stopIndex];
    eligible.push({
      poi: candidate,
      startTime: previewStop.startTime,
      endTime: previewStop.endTime,
      dayFinishTime: preview.finishTime,
      dayDistanceKm: preview.totalDistanceKm,
      distanceDeltaKm: round(preview.totalDistanceKm - day.totalDistanceKm, 1),
      priceDisplay: replacementPriceDisplay(candidate.id),
    });
  }

  return { checkedCount: candidates.length, eligible, ineligible };
}

export function listReplacementOptions(
  result: PlannerResult,
  dayIndex: number,
  stopIndex: number,
  dataset: PoiDataset = POI_DATASET,
): ReplacementOption[] {
  return auditReplacementOptions(result, dayIndex, stopIndex, dataset).eligible;
}

export function replaceStopWithPoi(
  result: PlannerResult,
  dayIndex: number,
  stopIndex: number,
  candidatePoiId: string,
  dataset: PoiDataset = POI_DATASET,
): ReplaceOutcome {
  const day = result.days[dayIndex];
  const target = day?.stops[stopIndex];
  if (!day || !target)
    return failedReplace(result, '找不到要替换的地点，原行程保持不变。');
  const option = listReplacementOptions(
    result,
    dayIndex,
    stopIndex,
    dataset,
  ).find((item) => item.poi.id === candidatePoiId);
  if (!option)
    return failedReplace(
      result,
      '该候选无法通过当前时间、范围或去重检查，原行程保持不变。',
    );
  const pois = day.stops
    .map((stop, index) =>
      dataset.pois.find(
        (poi) => poi.id === (index === stopIndex ? candidatePoiId : stop.poiId),
      ),
    )
    .filter((poi): poi is Poi => Boolean(poi));
  const rebuilt = buildDayExact(day.day, day.cluster, pois, result.request);
  if (!rebuilt || !validDayCoverage(rebuilt, result.request))
    return failedReplace(result, '替换预演失败，原行程保持不变。');
  const nextDays = result.days.map((item, index) =>
    index === dayIndex ? rebuilt : item,
  );
  const nextResult = finalizeResult(result.request, nextDays, dataset);
  if (nextResult.checks.some((item) => item.hard && item.status === 'fail'))
    return failedReplace(result, '替换后不再满足必要条件，原行程保持不变。');
  return {
    ok: true,
    result: nextResult,
    message: `已将“${poiName(target.poiId)}”替换为“${option.poi.nameZh}”。`,
    replacementId: option.poi.id,
    nextAttemptedPoiIds: [option.poi.id],
    cycled: false,
  };
}

export function replaceStop(
  result: PlannerResult,
  dayIndex: number,
  stopIndex: number,
  attemptedPoiIds: string[] = [],
  dataset: PoiDataset = POI_DATASET,
): ReplaceOutcome {
  const options = listReplacementOptions(result, dayIndex, stopIndex, dataset);
  const candidate =
    options.find((item) => !attemptedPoiIds.includes(item.poi.id)) ??
    options[0];
  if (!candidate)
    return failedReplace(
      result,
      '暂无满足时间、范围和去重规则的替换地点，原行程保持不变。',
      attemptedPoiIds,
    );
  const outcome = replaceStopWithPoi(
    result,
    dayIndex,
    stopIndex,
    candidate.poi.id,
    dataset,
  );
  return outcome.ok
    ? {
        ...outcome,
        nextAttemptedPoiIds: [...attemptedPoiIds, candidate.poi.id],
        cycled: attemptedPoiIds.includes(candidate.poi.id),
      }
    : outcome;
}

export function getAdmissionPriceRecord(
  poiId: string,
): AdmissionPriceRecord | undefined {
  return ADMISSION_PRICE_SNAPSHOT.records.find(
    (record) => record.poiId === poiId,
  );
}
export function calculateBudgetEnvelope(
  result: Pick<PlannerResult, 'request' | 'days'>,
): BudgetEnvelopeV2 {
  return computeBudget(result.request, result.days);
}

function findBestDay(
  dayNumber: number,
  cluster: string,
  required: Poi[],
  available: Poi[],
  request: ParsedTripRequest,
): DayPlan | null {
  const requiredIds = new Set(required.map((poi) => poi.id));
  const ranked = available
    .filter((poi) => !requiredIds.has(poi.id))
    .sort(
      (a, b) =>
        candidateRank(b, request, cluster) -
          candidateRank(a, request, cluster) || a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(12 - required.length, 7));
  const pool = [...required, ...ranked];
  const counts =
    request.pace === 'packed'
      ? [4]
      : request.pace === 'balanced'
        ? [4, 3]
        : [3, 2];
  for (const count of counts) {
    if (required.length > count || pool.length < count) continue;
    const feasible: Array<{ day: DayPlan; quality: number; ids: string }> = [];
    const visit = (chosen: Poi[]) => {
      if (chosen.length === count) {
        if (required.some((poi) => !chosen.some((item) => item.id === poi.id)))
          return;
        const day = buildDayExact(dayNumber, cluster, chosen, request);
        if (!day || !validDayCoverage(day, request)) return;
        const quality =
          chosen.reduce(
            (sum, poi) => sum + candidateRank(poi, request, cluster),
            0,
          ) -
          day.totalDistanceKm * 3;
        const ids = chosen.map((poi) => poi.id).join('|');
        feasible.push({ day, quality, ids });
        return;
      }
      const remainingSlots = count - chosen.length;
      const missingRequired = required.filter(
        (poi) => !chosen.some((item) => item.id === poi.id),
      );
      if (missingRequired.length > remainingSlots) return;
      for (const poi of pool) {
        if (!chosen.some((item) => item.id === poi.id)) visit([...chosen, poi]);
      }
    };
    visit([]);
    feasible.sort(
      (a, b) => b.quality - a.quality || a.ids.localeCompare(b.ids),
    );
    if (feasible[0]) return feasible[0].day;
  }
  return null;
}

function buildDayExact(
  dayNumber: number,
  cluster: string,
  candidates: Poi[],
  request: ParsedTripRequest,
): DayPlan | null {
  let cursor = request.dailyWindow.startMinutes;
  let previous = {
    latitude: request.origin.latitude,
    longitude: request.origin.longitude,
  };
  let mealBreak: MealBreak | null = null;
  const stops: ItineraryStop[] = [];
  for (const poi of candidates) {
    const travel = estimateTravelFromPoint(previous, poi);
    let start = cursor + travel.minutes;
    if (!mealBreak && start >= PLANNER_RULES.lunchStartMinutes) {
      if (start > PLANNER_RULES.latestLunchStartMinutes) return null;
      mealBreak = makeMealBreak(
        Math.max(start, PLANNER_RULES.lunchStartMinutes),
      );
      cursor = mealBreak.endMinutes;
      start = cursor;
    }
    const end = start + poi.suggestedMinutes;
    if (end > request.dailyWindow.endMinutes) return null;
    const reasonTags = selectionReasonTags(poi, request);
    stops.push({
      poiId: poi.id,
      startMinutes: start,
      endMinutes: end,
      startTime: formatTime(start),
      endTime: formatTime(end),
      reasonTags,
      reason: reasonTags.map((tag) => tag.label).join('；'),
      travelFromPrevious: travel,
    });
    cursor = end;
    previous = poi;
    if (!mealBreak && cursor >= PLANNER_RULES.lunchStartMinutes) {
      if (cursor > PLANNER_RULES.latestLunchStartMinutes) return null;
      mealBreak = makeMealBreak(cursor);
      cursor = mealBreak.endMinutes;
    }
  }
  if (!mealBreak) {
    const lunchStart = Math.max(cursor, PLANNER_RULES.lunchStartMinutes);
    if (lunchStart > PLANNER_RULES.latestLunchStartMinutes) return null;
    mealBreak = makeMealBreak(lunchStart);
  }
  const totalDistanceKm = round(
    stops.reduce((sum, stop) => sum + stop.travelFromPrevious.distanceKm, 0),
    1,
  );
  return {
    day: dayNumber,
    title: CLUSTER_TITLES[cluster] ?? '墨尔本探索线',
    cluster,
    departureTime: formatTime(request.dailyWindow.startMinutes),
    originLabel: request.origin.label,
    stops,
    mealBreak,
    totalDistanceKm,
    finishTime: formatTime(
      stops.at(-1)?.endMinutes ?? request.dailyWindow.startMinutes,
    ),
  };
}

function validDayCoverage(day: DayPlan, request: ParsedTripRequest): boolean {
  const count = day.stops.length;
  const countOk =
    request.pace === 'relaxed'
      ? count >= 2 && count <= 3
      : request.pace === 'balanced'
        ? count >= 3 && count <= 4
        : count === 4;
  const threshold =
    request.dailyWindow.endMinutes -
    (request.pace === 'relaxed' ? 150 : request.pace === 'balanced' ? 90 : 60);
  const finish = day.stops.at(-1)?.endMinutes ?? 0;
  const hasAfternoon = day.stops.some(
    (stop) => stop.startMinutes >= day.mealBreak.endMinutes,
  );
  return (
    countOk &&
    finish >= threshold &&
    hasAfternoon &&
    day.mealBreak.endMinutes - day.mealBreak.startMinutes ===
      PLANNER_RULES.lunchMinutes
  );
}

function finalizeResult(
  request: ParsedTripRequest,
  days: DayPlan[],
  dataset: PoiDataset,
): PlannerResult {
  const checks = buildChecks(days, request, dataset);
  const seed = JSON.stringify({
    request,
    dataVersion: dataset.dataVersion,
    plannerVersion: PLANNER_VERSION,
    plan: days.map((day) => day.stops.map((stop) => stop.poiId)),
  });
  const ids = days.flatMap((day) => day.stops.map((stop) => stop.poiId));
  const resultBase = {
    resultId: stableHash(seed),
    plannerVersion: PLANNER_VERSION,
    dataVersion: dataset.dataVersion,
    request,
    days,
    checks,
    summary: {
      totalPois: ids.length,
      totalDistanceKm: round(
        days.reduce((sum, day) => sum + day.totalDistanceKm, 0),
        1,
      ),
      hardFailures: checks.filter((item) => item.hard && item.status === 'fail')
        .length,
      notVerifiable: checks.filter((item) => item.status === 'not_verifiable')
        .length,
      centralCityPois: ids.filter((id) => {
        const poi = dataset.pois.find((item) => item.id === id);
        return poi ? isCentralCityPoi(poi) : false;
      }).length,
      outdoorPois: ids.filter(
        (id) =>
          dataset.pois.find((item) => item.id === id)?.indoorOutdoor ===
          'outdoor',
      ).length,
    },
  };
  return { ...resultBase, budget: computeBudget(request, days) };
}

function buildChecks(
  days: DayPlan[],
  request: ParsedTripRequest,
  dataset: PoiDataset,
): ConstraintCheck[] {
  const stops = days.flatMap((day) => day.stops);
  const ids = stops.map((stop) => stop.poiId);
  const hasDuplicates = new Set(ids).size !== ids.length;
  const outOfWindow = stops.some(
    (stop) =>
      stop.startMinutes < request.dailyWindow.startMinutes ||
      stop.endMinutes > request.dailyWindow.endMinutes,
  );
  const hasOverlap = days.some((day) =>
    day.stops.some(
      (stop, index) =>
        index > 0 && day.stops[index - 1].endMinutes > stop.startMinutes,
    ),
  );
  const coverageFailure = days.some((day) => !validDayCoverage(day, request));
  const validSources = ids.every((id) => {
    const poi = dataset.pois.find((item) => item.id === id);
    return Boolean(
      poi?.sourceRowKey &&
      Number.isFinite(poi.latitude) &&
      Number.isFinite(poi.longitude),
    );
  });
  const checks: ConstraintCheck[] = [
    check(
      'unique',
      '地点不重复',
      hasDuplicates ? 'fail' : 'pass',
      hasDuplicates ? '检测到重复 POI。' : '所有 POI ID 唯一。',
      true,
    ),
    check(
      'window',
      '每日时间窗口',
      outOfWindow ? 'fail' : 'pass',
      outOfWindow
        ? '有活动超出时间窗口。'
        : `所有活动均在 ${formatTime(request.dailyWindow.startMinutes)}–${formatTime(request.dailyWindow.endMinutes)} 内。`,
      true,
    ),
    check(
      'overlap',
      '活动不重叠',
      hasOverlap ? 'fail' : 'pass',
      hasOverlap ? '同一天存在时间重叠。' : '时间线没有活动重叠。',
      true,
    ),
    check(
      'coverage',
      '全天与午餐覆盖',
      coverageFailure ? 'fail' : 'pass',
      coverageFailure
        ? '有一天缺少下午活动或未达到节奏覆盖。'
        : `每天均有 ${PLANNER_RULES.lunchMinutes} 分钟午餐、下午活动和足够的结束覆盖。`,
      true,
    ),
    check(
      'source',
      'POI 来源完整',
      validSources ? 'pass' : 'fail',
      validSources ? '地点均有坐标和来源行键。' : '有地点缺少必要来源字段。',
      true,
    ),
  ];
  for (const poiId of request.mustIncludePoiIds) {
    const count = ids.filter((id) => id === poiId).length;
    checks.push(
      check(
        `must_include:${poiId}`,
        `必去：${poiName(poiId)}`,
        count === 1 ? 'pass' : 'fail',
        count === 1
          ? '该地点已且仅已安排一次。'
          : `该地点出现 ${count} 次，必须恰好一次。`,
        true,
      ),
    );
  }
  for (const poiId of request.excludePoiIds) {
    const count = ids.filter((id) => id === poiId).length;
    checks.push(
      check(
        `exclude:${poiId}`,
        `避开：${poiName(poiId)}`,
        count === 0 ? 'pass' : 'fail',
        count === 0 ? '该地点未进入行程。' : `该地点仍出现 ${count} 次。`,
        true,
      ),
    );
  }
  const walkingDistance = round(
    stops.reduce(
      (sum, stop) =>
        sum +
        (stop.travelFromPrevious.mode === 'walk'
          ? stop.travelFromPrevious.distanceKm
          : 0),
      0,
    ),
    1,
  );
  if (request.lowWalking) {
    checks.push(
      check(
        'low_walking',
        '少走路偏好（估算）',
        walkingDistance <= (request.days ?? 1) * 2.5 ? 'pass' : 'fail',
        `直线距离换算的步行段合计约 ${walkingDistance.toFixed(1)} km；不代表真实步行路线。`,
        false,
      ),
    );
    checks.push(
      check(
        'accessibility',
        '真实无障碍路线',
        'not_verifiable',
        '本地快照不含坡度、电梯故障或无障碍通行状态。',
        false,
      ),
    );
  }
  if (request.geography.scope === 'central_city_v1') {
    const count = ids.filter((id) => {
      const poi = dataset.pois.find((item) => item.id === id);
      return poi ? isCentralCityPoi(poi) : false;
    }).length;
    checks.push(
      check(
        'central_city',
        '中央城区优先',
        count > ids.length / 2 ? 'pass' : 'fail',
        `${count}/${ids.length} 个地点位于中央城区定义内。`,
        false,
      ),
    );
  }
  if (request.venuePreference.value !== 'neutral') {
    const target = venuePreferenceDirection(request.venuePreference.value);
    if (!target) throw new Error('非中性场所偏好必须有明确方向。');
    const matches = ids.filter(
      (id) =>
        dataset.pois.find((item) => item.id === id)?.indoorOutdoor === target,
    ).length;
    checks.push(
      check(
        'venue_preference',
        target === 'outdoor' ? '户外优先' : '室内优先',
        matches > 0 ? 'pass' : 'fail',
        `${matches}/${ids.length} 个地点明确标注为${target === 'outdoor' ? '户外' : '室内'}。`,
        false,
      ),
    );
  }
  checks.push(
    check(
      'opening_hours',
      '指定日期营业时间',
      'not_verifiable',
      request.dateText
        ? `未接入 ${request.dateText} 的实时营业信息。`
        : '未提供日期，且快照不保存营业时间。',
      false,
    ),
    check(
      'live_transit',
      '实时交通与路况',
      'not_verifiable',
      '交通仅按坐标直线距离估算。',
      false,
    ),
    check(
      'prices',
      '门票与预算覆盖',
      'not_verifiable',
      '使用离线官方票价快照；活动、餐饮和动态价格仍需确认。',
      false,
    ),
  );
  if (request.avoidCrowds)
    checks.push(
      check(
        'crowds',
        '避开拥挤地点',
        'not_verifiable',
        '本地数据没有实时客流或可靠的“网红程度”。',
        false,
      ),
    );
  return checks;
}

function computeBudget(
  request: ParsedTripRequest,
  days: DayPlan[],
): BudgetEnvelopeV2 {
  return withCostAssumptions(computeVerifiedBudget(request, days), request, days);
}

type VerifiedBudget = Omit<
  BudgetEnvelopeV2,
  'assumptionItems' | 'estimateRange' | 'estimateComparison'
>;

/**
 * 把用户的住宿/餐饮假设接到已核实预算上：分项单列、未知项如实增减，
 * 只有所有假设项都算得出时才给“带假设的估算区间”。
 */
function withCostAssumptions(
  verified: VerifiedBudget,
  request: ParsedTripRequest,
  days: DayPlan[],
): BudgetEnvelopeV2 {
  const assumptions = request.costAssumptions ?? NO_COST_ASSUMPTIONS;
  const partyKnown = request.pricingParty.ticketBreakdownStatus === 'complete';
  const items = assumptionCostItems(assumptions, {
    travelers: partyKnown ? request.pricingParty.totalTravelers : null,
    tripDays: days.length,
  });
  const lodging = items.find((item) => item.id === 'accommodation');
  const food = items.find((item) => item.id === 'food');
  const foodPriced = food != null && food.missing == null;
  const unknownItems = verified.coverage.unknownItems.filter(
    (item) => !(foodPriced && item === '餐饮'),
  );
  if (!lodging) unknownItems.push('住宿');
  else if (lodging.missing) unknownItems.push('住宿晚数');
  if (food && !foodPriced && !unknownItems.includes('餐饮'))
    unknownItems.push('餐饮');
  const excludedItems = verified.coverage.excludedItems.filter(
    (item) => !(foodPriced && item === '餐饮'),
  );
  const knownMin = verified.knownComponentsRange.minCents;
  const knownMax = verified.knownComponentsRange.maxCents;
  const allPriced = items.length > 0 && items.every((item) => item.missing == null);
  const estimateRange =
    partyKnown && allPriced && knownMin != null
      ? {
          minCents: knownMin + items.reduce((sum, item) => sum + (item.minCents ?? 0), 0),
          maxCents:
            knownMax == null
              ? null
              : knownMax + items.reduce((sum, item) => sum + (item.maxCents ?? 0), 0),
        }
      : null;
  const limit = verified.totalLimitCents;
  const estimateComparison: BudgetEnvelopeV2['estimateComparison'] =
    limit == null || estimateRange == null || estimateRange.minCents == null
      ? null
      : estimateRange.minCents > limit
        ? 'estimate_min_exceeds_limit'
        : estimateRange.maxCents != null && estimateRange.maxCents <= limit
          ? 'estimate_within_limit'
          : 'indeterminate';
  return {
    ...verified,
    coverage: {
      ...verified.coverage,
      unknownItems: [...new Set(unknownItems)],
      excludedItems,
    },
    assumptionItems: items,
    estimateRange,
    estimateComparison,
  };
}

function computeVerifiedBudget(
  request: ParsedTripRequest,
  days: DayPlan[],
): VerifiedBudget {
  if (request.pricingParty.ticketBreakdownStatus !== 'complete') {
    const unknownRange = { minCents: null, maxCents: null };
    return {
      currency: 'AUD',
      totalLimitCents: request.totalBudgetCents,
      pricingParty: request.pricingParty,
      admissionRange: unknownRange,
      transitRange: unknownRange,
      mykiSetupRange: unknownRange,
      knownComponentsRange: unknownRange,
      totalRange: unknownRange,
      coverage: {
        admission: 'none',
        transit: 'unknown',
        unknownItems: ['同行旅客的票型或儿童年龄', '餐饮'],
        excludedItems: ['机场接驳与未选择的附加体验'],
      },
      comparison: request.totalBudgetCents === null ? null : 'indeterminate',
      policyVersions: [
        ADMISSION_PRICE_SNAPSHOT.snapshotVersion,
        PTV_FARE_SNAPSHOT.policyVersion,
      ],
      verifiedAt: ADMISSION_PRICE_SNAPSHOT.verifiedAt,
    };
  }
  const ids = days.flatMap((day) => day.stops.map((stop) => stop.poiId));
  let admissionMin = 0;
  let admissionMax = 0;
  let hasKnownAdmission = false;
  let admissionComplete = true;
  const unknownItems: string[] = [];
  const excludedItems = [
    '餐饮',
    '机场接驳、SkyBus、出租车、网约车与停车',
    '未明确选择的附加体验',
  ];
  for (const id of ids) {
    const record = getAdmissionPriceRecord(id);
    if (
      !record ||
      !isAdmissionRecordUsable(record, request.dateText) ||
      record.basis === 'event_dependent' ||
      record.basis === 'unknown'
    ) {
      admissionComplete = false;
      unknownItems.push(`${poiName(id)}票价`);
      continue;
    }
    if (!record.includedByDefault) {
      excludedItems.push(`${poiName(id)}的可选付费体验`);
      continue;
    }
    if (
      record.basis === 'free_general_entry' ||
      record.basis === 'not_ticketed_public_space'
    ) {
      hasKnownAdmission = true;
      continue;
    }
    const partyCost = priceForParty(record, request.pricingParty);
    partyCost.unknownLabels.forEach((label) =>
      unknownItems.push(`${poiName(id)}${label}`),
    );
    if (partyCost.minCents == null) {
      admissionComplete = false;
      unknownItems.push(`${poiName(id)}的当前旅客票种`);
      continue;
    }
    hasKnownAdmission = true;
    admissionMin += partyCost.minCents;
    if (partyCost.maxCents == null) admissionComplete = false;
    else admissionMax += partyCost.maxCents;
  }
  const travelDate = request.dateText;
  const transitDayIndexes = days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) =>
      day.stops.some(
        (stop) => stop.travelFromPrevious.mode === 'public_transport',
      ),
    )
    .map(({ index }) => index);
  const transitDays = transitDayIndexes.length;
  const fareExpired =
    travelDate != null &&
    transitDayIndexes.some((dayIndex) => {
      const date = addDaysIso(travelDate, dayIndex);
      return (
        date < PTV_FARE_SNAPSHOT.effectiveFrom ||
        date >= PTV_FARE_SNAPSHOT.effectiveUntil
      );
    });
  let transitMax: number | null = 0;
  let transitCoverage: BudgetEnvelopeV2['coverage']['transit'] =
    'walking_only_zero';
  if (transitDays > 0) {
    const childFareNeedsVerification =
      request.pricingParty.childAges.length > 0;
    const contactlessCannotPriceConcession =
      request.pricingParty.ptvPaymentMedium === 'contactless' &&
      request.pricingParty.concessionEligibleCount > 0;
    if (
      fareExpired ||
      childFareNeedsVerification ||
      contactlessCannotPriceConcession
    ) {
      transitMax = null;
      transitCoverage = 'unknown';
      if (fareExpired) unknownItems.push('PTV 费率已超出当前快照有效期');
      if (childFareNeedsVerification) unknownItems.push('儿童 PTV 票价与资格');
      if (contactlessCannotPriceConcession)
        unknownItems.push('优惠旅客的 PTV 支付介质');
    } else {
      transitMax = transitDayIndexes.reduce((sum, dayIndex) => {
        const date = travelDate ? addDaysIso(travelDate, dayIndex) : null;
        const weekend = date
          ? [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())
          : false;
        const fullCap = weekend
          ? PTV_FARE_SNAPSHOT.zone12.fullFare.weekendHolidayDailyCapCents
          : PTV_FARE_SNAPSHOT.zone12.fullFare.weekdayDailyCapCents;
        const concessionCap = weekend
          ? PTV_FARE_SNAPSHOT.zone12.concession.weekendHolidayDailyCapCents
          : PTV_FARE_SNAPSHOT.zone12.concession.weekdayDailyCapCents;
        return (
          sum +
          request.pricingParty.adultFullFareCount * fullCap +
          request.pricingParty.concessionEligibleCount * concessionCap
        );
      }, 0);
      transitCoverage = 'daily_cap_allowance';
    }
  }
  const mykiSetup =
    request.pricingParty.ptvPaymentMedium === 'new_physical_myki'
      ? request.pricingParty.adultFullFareCount *
          PTV_FARE_SNAPSHOT.physicalCard.fullFareCents +
        request.pricingParty.concessionEligibleCount *
          PTV_FARE_SNAPSHOT.physicalCard.concessionCents +
        request.pricingParty.childAges.length *
          PTV_FARE_SNAPSHOT.physicalCard.youthCents
      : 0;
  const admissionRange = {
    minCents: hasKnownAdmission ? admissionMin : null,
    maxCents: admissionComplete && hasKnownAdmission ? admissionMax : null,
  };
  const transitRange = { minCents: 0, maxCents: transitMax };
  const mykiSetupRange = { minCents: mykiSetup, maxCents: mykiSetup };
  // Only verified admission components contribute here. A missing admission
  // range remains null above and is separately disclosed in unknownItems; it
  // is never converted into a claim that the unknown ticket itself costs A$0.
  const coveredAdmissionMin = hasKnownAdmission ? admissionMin : 0;
  const knownMin = coveredAdmissionMin + mykiSetup;
  const knownMax =
    admissionRange.maxCents != null && transitMax != null
      ? admissionRange.maxCents + transitMax + mykiSetup
      : null;
  let comparison: BudgetEnvelopeV2['comparison'] =
    request.totalBudgetCents == null ? null : 'indeterminate';
  if (request.totalBudgetCents != null && knownMin > request.totalBudgetCents)
    comparison = 'known_min_exceeds_limit';
  else if (
    request.totalBudgetCents != null &&
    knownMax != null &&
    knownMax <= request.totalBudgetCents
  )
    comparison = 'known_components_within_limit';
  return {
    currency: 'AUD',
    totalLimitCents: request.totalBudgetCents,
    pricingParty: request.pricingParty,
    admissionRange,
    transitRange,
    mykiSetupRange,
    knownComponentsRange: { minCents: knownMin, maxCents: knownMax },
    totalRange: { minCents: knownMin, maxCents: null },
    coverage: {
      admission: !hasKnownAdmission
        ? 'none'
        : admissionComplete
          ? 'complete'
          : 'partial',
      transit: transitCoverage,
      unknownItems: [...new Set([...unknownItems, '餐饮'])],
      excludedItems: [...new Set(excludedItems)],
    },
    comparison,
    policyVersions: [
      ADMISSION_PRICE_SNAPSHOT.snapshotVersion,
      PTV_FARE_SNAPSHOT.policyVersion,
    ],
    verifiedAt: ADMISSION_PRICE_SNAPSHOT.verifiedAt,
  };
}

function priceForParty(
  record: AdmissionPriceRecord,
  party: PricingParty,
): MoneyRange & { unknownLabels: string[] } {
  let min = 0;
  let max = 0;
  let hasCoveredTraveller = false;
  let complete = true;
  const unknownLabels: string[] = [];
  const groups: Array<{ type: 'adult' | 'concession'; count: number }> = [
    { type: 'adult', count: party.adultFullFareCount },
    { type: 'concession', count: party.concessionEligibleCount },
  ];
  for (const group of groups) {
    if (group.count === 0) continue;
    const tier = record.tiers.find((item) => item.ticketType === group.type);
    if (!tier || tier.minCents == null) {
      complete = false;
      unknownLabels.push(
        group.type === 'adult' ? '成人票种待确认' : '优惠票种待确认',
      );
      continue;
    }
    hasCoveredTraveller = true;
    min += tier.minCents * group.count;
    if (tier.maxCents == null) {
      complete = false;
      unknownLabels.push(
        group.type === 'adult' ? '成人票价上限待确认' : '优惠票价上限待确认',
      );
    } else {
      max += tier.maxCents * group.count;
    }
  }
  if (party.childAges.length > 0) {
    // The snapshot stores human-readable child eligibility rather than
    // machine-readable age bands. Preserve known adult/concession costs, but
    // do not apply one generic child tier to every supplied age.
    complete = false;
    unknownLabels.push('儿童年龄对应票种待确认');
  }
  return {
    minCents: hasCoveredTraveller ? min : null,
    maxCents: complete && hasCoveredTraveller ? max : null,
    unknownLabels,
  };
}

function isAdmissionRecordUsable(
  record: AdmissionPriceRecord,
  travelDate: string | null,
): boolean {
  if (
    ['unknown', 'stale', 'review_due', 'conflicted'].includes(
      record.verificationStatus,
    )
  )
    return false;
  if (!travelDate) return true;
  return record.evidence.every(
    (item) =>
      (!item.effectiveFrom || travelDate >= item.effectiveFrom) &&
      (!item.effectiveUntil || travelDate < item.effectiveUntil) &&
      travelDate <= item.reviewAfter,
  );
}

function addDaysIso(dateText: string, days: number): string {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseOrigin(text: string): {
  value: ResolvedOrigin;
  error: string | null;
  note: string | null;
} {
  // 「住宿预计…」「住宿属性」不是起点：住宿 须后接 在/区域，单字 住 后面不能是 宿。「按住 CBD、玩 3 天」里是「按｜住 CBD」，仍读起点。
  const match = text.match(
    /(?:从|出发点(?:在|是)?|起点(?:在|是)?|住宿(?:区域)?(?:在|是)|住(?!宿)(?!\s*[\d一二两三四五六七八九十]+\s*(?:晚|天|夜))(?:在)?)\s*([^,，、。；;\n]+)/i,
  );
  if (!match)
    return {
      value: makeCbdOrigin('default', 'default_proxy', null),
      error: null,
      note: null,
    };
  const segment = match[1]
    .trim()
    .replace(/\s*(?:出发|出门|开始|开逛)\s*$/i, '')
    .trim();
  const preset = AREA_ORIGIN_PRESETS.find((item) => item.aliases.test(segment));
  if (preset) {
    return {
      value: makeAreaOrigin(preset, 'text', match[0]),
      error: null,
      note: null,
    };
  }
  const hit = POI_ALIAS_INDEX.find(({ alias }) =>
    segment.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
  );
  if (hit)
    return {
      value:
        makePoiOrigin(hit.poiId, 'text', match[0]) ??
        makeCbdOrigin('default', 'default_proxy', null),
      error: null,
      note: null,
    };
  // 「从上海出发，…来墨尔本」说的是来墨尔本之前的出发地，不是在墨尔本每天出门的起点。
  const departureCity =
    match[0].startsWith('从') &&
    new RegExp(
      `从\\s*${escapeRegExp(segment)}\\s*出发[^。；;\\n]{0,24}?(?:来|到|飞(?:往|到)?|去)\\s*(?:墨尔本|melbourne)`,
      'iu',
    ).test(text);
  if (departureCity)
    return {
      value: makeCbdOrigin('default', 'default_proxy', null),
      error: null,
      note: `“从${segment}出发”被理解为来墨尔本之前的出发地，不作为在墨尔本每天出门的起点；已按 CBD 默认起点安排，可在详细设置修改。`,
    };
  return {
    value: makeCbdOrigin('default', 'default_proxy', null),
    error: `暂时无法准确定位起点“${segment}”；请改用 CBD、Southbank、Docklands、Carlton、East Melbourne 或当前 40 个地点。`,
    note: null,
  };
}

export function resolveOriginCandidate(originText: string): {
  value: ResolvedOrigin;
  error: string | null;
} {
  return parseOrigin(`出发点在 ${originText.normalize('NFKC').trim()}`);
}

function parseStartTime(text: string): {
  minutes: number | null;
  evidence: string | null;
  error: string | null;
} {
  const numeric = text.match(
    /(早上|上午|中午|下午)?\s*(\d{1,2})(?::(\d{2})|\s*点\s*(半)?)\s*(?:才)?\s*(?:出门|出发|开始|开逛)/i,
  );
  const chinese = text.match(
    // 「晚一点／早一点出门」是模糊时间，不是 1 点。
    /(早上|上午|中午|下午)?\s*(?<![晚早快慢多少再差])([一二三四五六七八九十两]{1,3})点(半)?\s*(?:才)?\s*(?:出门|出发|开始|开逛)/i,
  );
  // 只说「下午（才）出发/开始」而没有具体钟点：按当前允许的最晚开始 13:00，
  // 并作为原文证据显示在核对摘要里，由用户确认或修改，而不是静默按上午排。
  const vagueAfternoon = text.match(
    /下午\s*(?:才|再)?\s*(?:出门|出发|开始|开逛)|(?:出门|出发|开始)[^,，。；;\n]{0,2}(?:在|是)?下午/i,
  );
  let hour: number | null = null;
  let minute = 0;
  let evidence: string | null = null;
  const toAfternoon = (period: string | undefined, value: number | null) =>
    value !== null && (period === '下午' || period === '中午') && value < 12
      ? value + 12
      : value;
  if (numeric) {
    hour = toAfternoon(numeric[1], Number(numeric[2]));
    minute = numeric[4] ? 30 : Number(numeric[3] ?? 0);
    evidence = numeric[0].trim();
  } else if (chinese) {
    hour = toAfternoon(chinese[1], chineseHour(chinese[2]));
    minute = chinese[3] ? 30 : 0;
    evidence = chinese[0].trim();
  } else if (vagueAfternoon) {
    hour = 13;
    minute = 0;
    evidence = vagueAfternoon[0];
  }
  if (hour == null) return { minutes: null, evidence: null, error: null };
  const minutes = hour * 60 + minute;
  if (
    minutes < PLANNER_RULES.earliestStartMinutes ||
    minutes > PLANNER_RULES.latestStartMinutes ||
    minutes % 15 !== 0
  )
    return {
      minutes: null,
      evidence,
      error: `每日开始时间须在 ${startWindowText()}，且按 15 分钟选择。`,
    };
  return { minutes, evidence, error: null };
}

function chineseHour(value: string): number | null {
  if (value === '十') return 10;
  if (value.startsWith('十'))
    return 10 + (CHINESE_NUMBERS[value.slice(1)] ?? 0);
  if (value.endsWith('十'))
    return (CHINESE_NUMBERS[value.slice(0, -1)] ?? 0) * 10;
  return CHINESE_NUMBERS[value] ?? null;
}

function parseHardPoiConstraints(text: string): {
  mustInclude: string[];
  exclude: string[];
  unknown: string[];
} {
  const mustInclude: string[] = [];
  const exclude: string[] = [];
  const unknown: string[] = [];
  const patterns: Array<{ kind: 'must' | 'exclude'; pattern: RegExp }> = [
    {
      kind: 'must',
      pattern:
        /(?<!不)(?<!未)(必去|一定(?:要)?去|必须安排|必须去)\s*([^,，。；;\n]+)/giu,
    },
    {
      kind: 'exclude',
      pattern: /(不要去|不去|避开|排除)\s*([^,，。；;\n]+)/giu,
    },
  ];
  // 地点写在触发词前面：「Federation Square 必须去」「大洋路一定要排进行程」。
  // 只取同一子句内触发词之前的文字，并去掉人称和连接词；剩下不足 2 个字就不当作地点。
  const prefixMust =
    /([^,，、。；;\n]{1,40}?)\s*(?<!不)(?:必须|一定要|一定得|务必)\s*(?:去|安排|排进|排上|包括)/giu;
  const prefixMatches = [...text.matchAll(prefixMust)].map((match) => ({
    kind: 'must' as const,
    raw: match[1]
      .replace(
        /^(?:(?:但是|但|而且|并且|所以|然后|首先|其次|最后|先|再|我们|我|也|还|都|就|第[一二三四五六七八九十\d]+天|每天|今天|明天|后天|早上|上午|中午|下午|晚上|真的|特别|最好|是)\s*)+/u,
        '',
      )
      .replace(/(?:(?:我们|我|也|还|都|就|是)\s*)+$/u, '')
      .trim(),
  }));
  for (const { kind, raw } of prefixMatches) {
    const segment = raw;
    if (segment.length < 2) continue;
    const hits = POI_ALIAS_INDEX.filter(({ alias }) =>
      segment.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
    );
    if (hits.length === 0) {
      unknown.push(segment);
      continue;
    }
    const target = kind === 'must' ? mustInclude : exclude;
    hits.forEach(({ poiId }) => {
      if (!target.includes(poiId)) target.push(poiId);
    });
  }
  for (const { kind, pattern } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const segment = match[2].trim();
      const hits = POI_ALIAS_INDEX.filter(({ alias }) =>
        segment.toLocaleLowerCase().includes(alias.toLocaleLowerCase()),
      ).filter(
        (item, index, items) =>
          items.findIndex((candidate) => candidate.poiId === item.poiId) ===
          index,
      );
      if (hits.length === 0) {
        const crowd =
          kind === 'exclude' && /(热门|网红|人多|拥挤)/.test(segment);
        if (!crowd) unknown.push(segment);
        continue;
      }
      const remaining = hits
        .reduce(
          (value, { alias }) =>
            value.replace(new RegExp(escapeRegExp(alias), 'giu'), ''),
          segment,
        )
        .replace(
          /(和|与|、|以及|还有|及|the|a|an|景点|地方|场馆|博物馆|美术馆|花园|市场)/giu,
          '',
        )
        .replace(/[\s,，.。!！?？()（）\-_/]/g, '');
      if (remaining.length > 0) unknown.push(remaining);
      const target = kind === 'must' ? mustInclude : exclude;
      hits.forEach(({ poiId }) => {
        if (!target.includes(poiId)) target.push(poiId);
      });
    }
  }
  return { mustInclude, exclude, unknown: [...new Set(unknown)] };
}

const NEGATED_PREFERENCE_CLAUSE =
  /(?:不喜欢|不爱|不想看|不想去|不要去|别去|不去|不要安排|少安排|避开|排除)[^,，。；;\n]*/giu;

function stripNegatedPreferenceClauses(text: string): string {
  return text.replace(NEGATED_PREFERENCE_CLAUSE, '');
}

function negatedPreferenceText(text: string): string {
  return [...text.matchAll(NEGATED_PREFERENCE_CLAUSE)]
    .map((match) => match[0])
    .join('，');
}

function neutralCategoryPreferences(): Record<PoiCategory, PreferenceState> {
  return {
    art_culture: 'neutral',
    history: 'neutral',
    nature: 'neutral',
    city_landmark: 'neutral',
    market_food: 'neutral',
    family: 'neutral',
  };
}
function neutralExperiencePreferences(): Record<
  ExperienceFacet,
  PreferenceState
> {
  return {
    museum_exhibition: 'neutral',
    history_heritage: 'neutral',
    parks_gardens: 'neutral',
    river_city_walk: 'neutral',
    city_icons_views: 'neutral',
    performance_music: 'neutral',
    sports_venues: 'neutral',
    market_local_life: 'neutral',
  };
}
function defaultPricingParty(): PricingParty {
  return {
    totalTravelers: 1,
    ticketBreakdownStatus: 'complete',
    adultFullFareCount: 1,
    concessionEligibleCount: 0,
    childAges: [],
    ptvPaymentMedium: 'contactless',
    source: 'visible_default_one_adult',
  };
}

export function reconcilePricingParty(party: PricingParty): PricingParty {
  const known =
    party.adultFullFareCount +
    party.concessionEligibleCount +
    party.childAges.length;
  const total = party.totalTravelers;
  return {
    ...party,
    ticketBreakdownStatus:
      total !== null && (total < 1 || total > 20 || known > total)
        ? 'conflict'
        : total === null
          ? 'unknown'
          : known === total
            ? 'complete'
            : known === 0
              ? 'unknown'
              : 'partial',
  };
}

function parsePricingParty(text: string): {
  value: PricingParty;
  errors: string[];
} {
  const errors: string[] = [];
  const value = defaultPricingParty();
  const numberToken = '(?:\\d+|[零〇一二两三四五六七八九十百千万]{1,4})';
  const readCount = (token: string): number | null => {
    if (/^\d+$/.test(token)) return Number(token);
    if (token === '十') return 10;
    if (token.startsWith('十'))
      return 10 + (CHINESE_NUMBERS[token.slice(1)] ?? 0);
    if (token.endsWith('十'))
      return (CHINESE_NUMBERS[token.slice(0, -1)] ?? 0) * 10;
    const exact = CHINESE_NUMBERS[token];
    return exact === undefined ? null : exact;
  };
  const collect = (pattern: RegExp, label: string): number[] => {
    const counts: number[] = [];
    for (const match of text.matchAll(pattern)) {
      const count = readCount(match[1]);
      if (count === null || count > 20) {
        errors.push(`${label}人数必须是 0–20，且不能含糊指定。`);
      } else counts.push(count);
    }
    const unique = [...new Set(counts)];
    if (unique.length > 1)
      errors.push(
        `${label}人数出现冲突（${unique.join('、')}），请只保留一个明确数量。`,
      );
    return unique;
  };
  const adults = collect(
    new RegExp(
      `(${numberToken})\\s*(?:位|名|个)?\\s*(?:成人|成年人|大人|adults?)`,
      'giu',
    ),
    '成人',
  );
  const adultsAfter = collect(
    new RegExp(
      `(?:成人|成年人|大人|adults?)\\s*(${numberToken})\\s*(?:位|名|个)?`,
      'giu',
    ),
    '成人',
  );
  const concessions = collect(
    new RegExp(
      `(${numberToken})\\s*(?:位|名|张|个)?\\s*(?:优惠票|优惠|concessions?)`,
      'giu',
    ),
    '优惠票',
  );
  const concessionsAfter = collect(
    new RegExp(
      `(?:优惠票|优惠|concessions?)\\s*(${numberToken})\\s*(?:位|名|张|个)?`,
      'giu',
    ),
    '优惠票',
  );
  if (
    /(?:不使用|不用|没有|无|不需要|无需|不带)\s*(?:任何)?\s*(?:优惠票|优惠|concessions?)/iu.test(
      text,
    )
  )
    concessions.push(0);
  const adultValues = [...new Set([...adults, ...adultsAfter])];
  const concessionValues = [...new Set([...concessions, ...concessionsAfter])];
  const totals = collect(
    new RegExp(
      `(${numberToken})\\s*(?:(?:个|名)\\s*人|人(?:同行)?|位同行)`,
      'giu',
    ),
    '同行总',
  );
  const childAges = [...text.matchAll(/(?:一个|一位|1个|1位)?\s*(\d{1,2})\s*岁\s*(?:的)?\s*(?:孩子|儿童)|(?:孩子|儿童)\s*(\d{1,2})\s*岁/giu)].map(
    (match) => Number(match[1] ?? match[2]),
  );
  const childCounts = collect(
    new RegExp(`(${numberToken})\\s*(?:位|名|个)?\\s*(?:孩子|儿童)`, 'giu'),
    '儿童',
  );
  const statedChildCount = childCounts.length === 1 ? childCounts[0] : 0;
  const oneAdultOneChild = /一大一小|1大1小/iu.test(text);
  if (adultValues.length > 1)
    errors.push('成人人数出现冲突，请只保留一个明确数量。');
  if (concessionValues.length > 1)
    errors.push('优惠票人数出现冲突，请只保留一个明确数量。');
  if (adultValues.length === 1) {
    value.adultFullFareCount = adultValues[0];
    value.source = 'text';
  }
  if (oneAdultOneChild && adultValues.length === 0) {
    value.adultFullFareCount = 1;
    value.source = 'text';
  }
  if (concessionValues.length === 1) {
    value.concessionEligibleCount = concessionValues[0];
    value.source = 'text';
  }
  if (childAges.length > 0) {
    value.childAges = childAges;
    value.source = 'text';
  }
  const explicitTotal = totals.length === 1 ? totals[0] : oneAdultOneChild ? 2 : null;
  const hasTypedPeople =
    adultValues.length === 1 ||
    (concessionValues.length === 1 && value.concessionEligibleCount > 0) ||
    childAges.length > 0 ||
    statedChildCount > 0 ||
    oneAdultOneChild;
  if (explicitTotal !== null) {
    value.totalTravelers = explicitTotal;
    value.source = 'text';
    if (adultValues.length === 0 && !oneAdultOneChild)
      value.adultFullFareCount = 0;
  } else if (hasTypedPeople) {
    if (adultValues.length === 0 && !oneAdultOneChild)
      value.adultFullFareCount = 0;
    value.totalTravelers =
      value.adultFullFareCount +
      (concessionValues.length === 1 ? value.concessionEligibleCount : 0) +
      Math.max(childAges.length, statedChildCount) +
      (oneAdultOneChild && childAges.length === 0 ? 1 : 0);
  }
  if (adultValues.length === 1 || concessionValues.length === 1) {
    if (value.adultFullFareCount + value.concessionEligibleCount === 0)
      errors.push('至少需要 1 位成人或优惠票同行人。');
  }
  // 「带孩子」但没说几个、几岁：不能继续按“1 位成人、票型完整”计价。
  const uncountedChild =
    /(?:带|和|陪|跟)\s*(?:着)?\s*(?:孩子|小孩|娃|儿童|宝宝)/u.test(text) &&
    childAges.length === 0 &&
    statedChildCount === 0 &&
    !oneAdultOneChild &&
    explicitTotal === null;
  if (uncountedChild) {
    value.totalTravelers = null;
    value.source = 'text';
  }
  const reconciled = reconcilePricingParty(value);
  if (reconciled.ticketBreakdownStatus === 'conflict')
    errors.push('同行总人数与已说明的成人、儿童或优惠票人数不一致。');
  return { value: reconciled, errors };
}
function makeCbdOrigin(
  source: FieldSource,
  resolution: 'area_proxy' | 'default_proxy',
  evidence: string | null,
): ResolvedOrigin {
  const preset = AREA_ORIGIN_PRESETS[0];
  const origin = makeAreaOrigin(preset, source, evidence);
  return { ...origin, resolution };
}
function makeAreaOrigin(
  preset: (typeof AREA_ORIGIN_PRESETS)[number],
  source: FieldSource,
  evidence: string | null,
): ResolvedOrigin {
  const poi = POIS.find((item) => item.id === preset.anchorPoiId);
  return {
    kind: 'preset_proxy',
    refId: preset.id,
    label: preset.label,
    latitude: poi?.latitude ?? -37.8179063007545,
    longitude: poi?.longitude ?? 144.967064817875,
    resolution: 'area_proxy',
    source,
    evidence,
  };
}
function makePoiOrigin(
  poiId: string,
  source: FieldSource,
  evidence: string | null,
): ResolvedOrigin | null {
  const poi = POIS.find((item) => item.id === poiId);
  return poi
    ? {
        kind: 'poi',
        refId: poi.id,
        label: `${poi.nameZh}（地点起点）`,
        latitude: poi.latitude,
        longitude: poi.longitude,
        resolution: 'exact_poi',
        source,
        evidence,
      }
    : null;
}
function interestsFromCategories(
  preferences: Record<PoiCategory, PreferenceState>,
): Interest[] {
  return CATEGORY_KEYS.flatMap((category) =>
    preferences[category] === 'prefer' && CATEGORY_INTEREST[category]
      ? [CATEGORY_INTEREST[category] as Interest]
      : [],
  );
}
export function isCentralCityPoi(poi: Poi): boolean {
  return CENTRAL_AREAS.has(poi.area);
}
export function poiExperienceFacets(poi: Poi): ExperienceFacet[] {
  const text = [
    poi.nameZh,
    poi.nameEn,
    poi.sourceTheme,
    poi.sourceSubTheme,
    ...poi.tags,
  ].join(' ');
  const facets: ExperienceFacet[] = [];
  if (/(博物馆|美术馆|展览|影像|museum|gallery|exhibition)/i.test(text))
    facets.push('museum_exhibition');
  if (
    poi.category === 'history' ||
    /(历史|遗产|教堂|纪念|heritage|cathedral)/i.test(text)
  )
    facets.push('history_heritage');
  if (poi.category === 'nature' || /(花园|公园|植物|garden|park)/i.test(text))
    facets.push('parks_gardens');
  if (/(河畔|散步|步道|海滨|桥梁|river|walk|promenade|bridge)/i.test(text))
    facets.push('river_city_walk');
  if (
    poi.category === 'city_landmark' ||
    /(地标|观景|天际线|landmark|observation)/i.test(text)
  )
    facets.push('city_icons_views');
  if (/(演出|音乐|剧院|音乐厅|theatre|concert|recital|performance)/i.test(text))
    facets.push('performance_music');
  if (/(体育|球场|网球|赛事|sport|stadium|arena|cricket)/i.test(text))
    facets.push('sports_venues');
  if (
    poi.category === 'market_food' ||
    /(市场|市集|market|本地生活)/i.test(text)
  )
    facets.push('market_local_life');
  return [...new Set(facets)];
}
export function experienceFacetCounts(
  dataset: PoiDataset = POI_DATASET,
): Record<ExperienceFacet, number> {
  return Object.fromEntries(
    EXPERIENCE_KEYS.map((facet) => [
      facet,
      dataset.pois.filter((poi) => poiExperienceFacets(poi).includes(facet))
        .length,
    ]),
  ) as Record<ExperienceFacet, number>;
}
function isAllowedByHardGeography(
  poi: Poi,
  request: ParsedTripRequest,
): boolean {
  return (
    request.geography.strength !== 'hard' ||
    request.geography.scope !== 'cbd_core_v1' ||
    CBD_CORE_AREAS.has(poi.area)
  );
}
function candidateRank(
  poi: Poi,
  request: ParsedTripRequest,
  cluster: string,
): number {
  return scorePoi(poi, request) + (poi.cluster === cluster ? 35 : 0);
}
function scorePoi(poi: Poi, request: ParsedTripRequest): number {
  let score = 10;
  const preference = request.categoryPreferences[poi.category];
  score += preference === 'prefer' ? 45 : preference === 'avoid' ? -32 : 0;
  for (const facet of poiExperienceFacets(poi)) {
    const facetPreference = request.experiencePreferences[facet];
    score +=
      facetPreference === 'prefer' ? 34 : facetPreference === 'avoid' ? -28 : 0;
  }
  const venueDirection = venuePreferenceDirection(
    request.venuePreference.value,
  );
  const venueStrength = venuePreferenceStrength(request.venuePreference.value);
  if (venueDirection) {
    score +=
      poi.indoorOutdoor === venueDirection
        ? 24 + venueStrength * 8
        : poi.indoorOutdoor ===
            (venueDirection === 'outdoor' ? 'indoor' : 'outdoor')
          ? -(14 + venueStrength * 7)
          : 3;
  }
  if (request.geography.scope === 'central_city_v1')
    score += isCentralCityPoi(poi) ? 32 : -8;
  if (request.family)
    score +=
      poi.familyFriendly === true ? 24 : poi.familyFriendly === false ? -12 : 0;
  if (request.lowWalking)
    score +=
      poi.lowWalkingFriendly === true
        ? 12
        : poi.lowWalkingFriendly === false
          ? -14
          : 0;
  return score;
}
function compareReplacementCandidates(
  a: Poi,
  b: Poi,
  target: Poi,
  request: ParsedTripRequest,
): number {
  const categoryDifference =
    Number(b.category === target.category) -
    Number(a.category === target.category);
  if (categoryDifference !== 0) return categoryDifference;
  const areaDifference =
    Number(b.area === target.area) - Number(a.area === target.area);
  if (areaDifference !== 0) return areaDifference;
  const preferenceDifference = scorePoi(b, request) - scorePoi(a, request);
  return preferenceDifference || a.id.localeCompare(b.id);
}

function replacementBlockReason(
  candidate: Poi,
  result: PlannerResult,
  used: Set<string>,
  targetIsRequired: boolean,
): Pick<ReplacementUnavailableOption, 'reasonCode' | 'reason'> | null {
  if (targetIsRequired)
    return {
      reasonCode: 'target_is_required',
      reason: '当前地点已设为必去，不能替换',
    };
  if (used.has(candidate.id))
    return { reasonCode: 'already_in_itinerary', reason: '已在当前行程中' };
  if (result.request.excludePoiIds.includes(candidate.id))
    return { reasonCode: 'excluded_by_user', reason: '已设为避开' };
  if (!isAllowedByHardGeography(candidate, result.request))
    return {
      reasonCode: 'outside_hard_geography',
      reason: '不在当前活动区域内',
    };
  if (!isValidPoi(candidate))
    return { reasonCode: 'incomplete_data', reason: '地点数据不完整' };
  return null;
}

function replacementPriceDisplay(poiId: string): string {
  const record = getAdmissionPriceRecord(poiId);
  if (!record) return '需确认';
  if (['event_dependent', 'unknown'].includes(record.basis)) return '需确认';
  if (
    !['verified_current', 'verified_time_bounded'].includes(
      record.verificationStatus,
    )
  )
    return '需确认';
  return record.displayText;
}

function selectionReasonTags(
  poi: Poi,
  request: ParsedTripRequest,
): StopReasonTag[] {
  const tags: StopReasonTag[] = [];
  const preferredFacet = poiExperienceFacets(poi).find(
    (facet) => request.experiencePreferences[facet] === 'prefer',
  );
  if (preferredFacet) {
    tags.push({
      code: 'experience_preference',
      label: experienceFacetLabel(preferredFacet),
    });
  }
  if (request.categoryPreferences[poi.category] === 'prefer') {
    tags.push({
      code: 'category_preference',
      label: `喜欢${categoryLabel(poi.category)}`,
    });
  }
  const venueDirection = venuePreferenceDirection(
    request.venuePreference.value,
  );
  if (venueDirection && poi.indoorOutdoor === venueDirection) {
    tags.push({
      code: 'venue_preference',
      label: venueDirection === 'outdoor' ? '适合户外安排' : '适合室内安排',
    });
  }
  if (request.geography.scope === 'central_city_v1' && isCentralCityPoi(poi)) {
    tags.push({ code: 'central_city_preference', label: '市中心内' });
  }
  if (request.family && poi.familyFriendly === true) {
    tags.push({ code: 'family_friendly', label: '适合亲子' });
  }
  if (request.lowWalking && poi.lowWalkingFriendly === true) {
    tags.push({ code: 'low_walking_friendly', label: '少走一点' });
  }
  return tags
    .filter(
      (tag, index, items) =>
        items.findIndex((item) => item.label === tag.label) === index,
    )
    .slice(0, 2);
}
function estimateTravelFromPoint(
  from: { latitude: number; longitude: number },
  to: Poi,
): TravelEstimate {
  const distanceKm = round(
    haversineKm(from.latitude, from.longitude, to.latitude, to.longitude),
    1,
  );
  const mode = distanceKm <= 1.2 ? 'walk' : 'public_transport';
  const minutes =
    mode === 'walk'
      ? Math.max(3, Math.ceil((distanceKm / 4.5) * 60 + 2))
      : Math.max(12, Math.ceil((distanceKm / 18) * 60 + 8));
  return { distanceKm, minutes, mode, method: 'straight_line_estimate' };
}
function isValidPoi(poi: Poi): boolean {
  return Boolean(
    poi.id &&
    poi.nameEn &&
    poi.sourceRowKey &&
    Number.isFinite(poi.latitude) &&
    Number.isFinite(poi.longitude) &&
    poi.latitude >= -90 &&
    poi.latitude <= 90 &&
    poi.longitude >= -180 &&
    poi.longitude <= 180,
  );
}
function makeMealBreak(startMinutes: number): MealBreak {
  const endMinutes = startMinutes + PLANNER_RULES.lunchMinutes;
  return {
    startMinutes,
    endMinutes,
    startTime: formatTime(startMinutes),
    endTime: formatTime(endMinutes),
    label: `午餐与休息（${PLANNER_RULES.lunchMinutes} 分钟占位，餐厅暂不推荐）`,
  };
}
function failedReplace(
  result: PlannerResult,
  message: string,
  attempted: string[] = [],
): ReplaceOutcome {
  return {
    ok: false,
    result,
    message,
    nextAttemptedPoiIds: attempted,
    cycled: false,
  };
}
function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  hard: boolean,
): ConstraintCheck {
  return { id, label, status, detail, hard };
}
function categoryLabel(category: PoiCategory): string {
  return {
    art_culture: '艺术与文化',
    history: '历史与遗产',
    nature: '公园与花园',
    city_landmark: '城市地标与观景',
    market_food: '市集与本地生活',
    family: '亲子活动',
  }[category];
}
export function experienceFacetLabel(facet: ExperienceFacet): string {
  return EXPERIENCE_FACETS.find((item) => item.id === facet)?.label ?? facet;
}
function venuePreferenceDirection(
  value: VenuePreference,
): 'indoor' | 'outdoor' | null {
  if (value === 'indoor' || value === 'strong_indoor') return 'indoor';
  if (value === 'outdoor' || value === 'strong_outdoor') return 'outdoor';
  return null;
}
function venuePreferenceStrength(value: VenuePreference): 0 | 1 | 2 {
  if (value === 'strong_indoor' || value === 'strong_outdoor') return 2;
  if (value === 'indoor' || value === 'outdoor') return 1;
  return 0;
}
function venuePreferenceLabel(value: VenuePreference): string {
  return {
    strong_indoor: '室内为主',
    indoor: '偏室内',
    neutral: '室内外均衡',
    outdoor: '偏户外',
    strong_outdoor: '户外为主',
  }[value];
}
function geoScopeLabel(value: GeoScope): string {
  return {
    cbd_core_v1: '只在 CBD',
    central_city_v1: '市中心优先',
    supported_inner_city: '市区及内城',
  }[value];
}
function paceLabel(pace: Pace): string {
  return pace === 'relaxed' ? '轻松' : pace === 'packed' ? '紧凑' : '均衡';
}
function poiName(id: string): string {
  return POIS.find((poi) => poi.id === id)?.nameZh ?? id;
}
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radius = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLon = degreesToRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}
export function formatTime(totalMinutes: number): string {
  return `${Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0')}:${(totalMinutes % 60).toString().padStart(2, '0')}`;
}
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `trip-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
