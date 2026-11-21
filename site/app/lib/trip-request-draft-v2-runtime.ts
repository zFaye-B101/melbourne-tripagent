import Ajv2020 from 'ajv/dist/2020.js';

import draftSchema from '../../../data/trip-request-draft-v2.schema.json';
import {
  POIS,
  containsExplicitNonAudCurrency,
  isValidIsoCalendarDate,
  mergeStructuredTripRequest,
  parseTripRequest,
  reconcilePricingParty,
  resolveOriginCandidate,
  resolvePoiNameCandidate,
  type ExperienceFacet,
  type ParsedTripRequest,
  type PreferenceState,
  type PricingParty,
} from './planner';
import type { FieldEvidenceV2 } from './nlu-contract';
import { NO_COST_ASSUMPTIONS } from './cost-assumptions';
import {
  safeDiagnosticPath,
  type SafePath,
  type SafeValidationIssue,
} from './local-nlu-diagnostics';
import type { MustIncludeCauseCode } from './local-nlu-diagnostics';

const EXPERIENCE_PATHS: ExperienceFacet[] = [
  'museum_exhibition',
  'history_heritage',
  'parks_gardens',
  'river_city_walk',
  'city_icons_views',
  'performance_music',
  'sports_venues',
  'market_local_life',
];

export interface TripRequestDraftV2 {
  schemaVersion: 'trip-request-draft-v2';
  destination: { text: string | null; supportedCity: 'Melbourne' | null };
  days: number | null;
  date: {
    text: string | null;
    isoDate: string | null;
    resolution: 'explicit' | 'relative_unresolved' | 'missing';
  };
  originText: string | null;
  dailyStartText: string | null;
  dailyStartMinutes: number | null;
  geography: {
    scope: 'cbd_core_v1' | 'central_city_v1' | 'supported_inner_city' | null;
    strength: 'hard' | 'soft' | 'unclear' | null;
  };
  pace: 'relaxed' | 'balanced' | 'packed' | null;
  venuePreference:
    | 'strong_indoor'
    | 'indoor'
    | 'neutral'
    | 'outdoor'
    | 'strong_outdoor'
    | null;
  experiencePreferences: Record<ExperienceFacet, PreferenceState | null>;
  lowWalking: boolean | null;
  family: boolean | null;
  avoidCrowds: boolean | null;
  party: {
    adultFullFareCount: number | null;
    concessionEligibleCount: number | null;
    childAges: number[];
    ptvPaymentMedium: PricingParty['ptvPaymentMedium'] | null;
  };
  budget: { currency: 'AUD' | null; totalCents: number | null };
  /** 用户自填的住宿/餐饮估算（澳分），不是价格事实。v2.9 起必填，可为 null。 */
  costAssumptions: {
    accommodation: {
      perNightMinCents: number;
      perNightMaxCents: number;
      nights: number | null;
    } | null;
    food: {
      perPersonPerDayMinCents: number;
      perPersonPerDayMaxCents: number;
    } | null;
  };
  mustIncludeNames: string[];
  excludeNames: string[];
  unhandledRequirements: Array<{
    kind: string;
    text: string;
    hardness: 'hard' | 'soft' | 'unclear';
  }>;
  unresolvedPhrases: string[];
  evidence: Array<{
    path: string;
    quote: string;
    occurrence: number;
    itemIndex?: number;
  }>;
}

export type DraftValidationResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      issue: SafeValidationIssue;
      mustIncludeCause?: MustIncludeCauseCode;
    };
export type DraftSchemaValidationResult =
  | { ok: true; draft: TripRequestDraftV2 }
  | Extract<DraftValidationResult, { ok: false }>;

function validationFailure(
  issue: SafeValidationIssue,
  message: string,
): Extract<DraftValidationResult, { ok: false }> {
  return { ok: false, issue, message };
}

function semanticFailure(
  reason: Extract<
    SafeValidationIssue['reason'],
    | 'semantic.input_too_long'
    | 'semantic.invalid_cross_field_state'
    | 'semantic.rule_mismatch'
    | 'semantic.evidence_not_proven'
    | 'semantic.unhandled_requirement_missing'
  >,
  path: SafePath,
  message: string,
  mustIncludeCause?: MustIncludeCauseCode,
): Extract<DraftValidationResult, { ok: false }> {
  return {
    ...validationFailure({ stage: 'semantic', reason, path }, message),
    ...(mustIncludeCause ? { mustIncludeCause } : {}),
  };
}

function experiencePath(facet: ExperienceFacet): SafePath {
  return `/experiencePreferences/${facet}`;
}

export type EvidenceBindingReport = {
  policy: 'evidence-binding-v1';
  status: 'not_needed' | 'applied' | 'skipped' | 'internal_error';
  addedPath: string | null;
  addedCount: number;
  reason:
    | 'invalid_existing'
    | 'missing_count_not_one'
    | 'target_not_allowlisted'
    | 'source_missing_or_ambiguous'
    | 'proof_failed'
    | 'post_validation_failed'
    | 'disabled'
    | 'scope_coordinate_reused'
    | 'binding_exception';
};

const EVIDENCE_BINDING_V1_ENABLED = true;

/**
 * Repairs exactly one mechanical evidence omission. This intentionally does
 * not search rawText: the copied coordinate must already be present in the
 * provider draft and must independently prove the target meaning.
 */
export function bindEvidenceV1(
  input: TripRequestDraftV2,
  rawText: string,
): { draft: TripRequestDraftV2; report: EvidenceBindingReport } {
  const draft = structuredClone(input);
  const report = (
    status: EvidenceBindingReport['status'],
    reason: EvidenceBindingReport['reason'],
  ) => ({
    policy: 'evidence-binding-v1' as const,
    status,
    addedPath: status === 'applied' ? '/geography/strength' : null,
    addedCount: status === 'applied' ? 1 : 0,
    reason,
  });
  if (!EVIDENCE_BINDING_V1_ENABLED)
    return { draft, report: report('skipped', 'disabled') };
  try {
    const targetEvidence = draft.evidence.filter(
      (item) => item.path === '/geography/strength',
    );
    if (draft.geography.strength === null)
      return { draft, report: report('not_needed', 'target_not_allowlisted') };
    if (targetEvidence.length !== 0)
      return { draft, report: report('not_needed', 'missing_count_not_one') };
    const scopeEvidence = draft.evidence.filter(
      (item) => item.path === '/geography/scope',
    );
    if (
      scopeEvidence.length !== 1 ||
      scopeEvidence[0].itemIndex !== undefined ||
      !['hard', 'soft'].includes(draft.geography.strength)
    )
      return {
        draft,
        report: report('skipped', 'source_missing_or_ambiguous'),
      };

    // Validate every existing coordinate while the missing target is omitted.
    const partial = structuredClone(draft);
    partial.geography.strength = null;
    const existing = validateDraftEvidence(partial, rawText);
    if (!existing.ok)
      return { draft, report: report('skipped', 'invalid_existing') };

    const source = scopeEvidence[0];
    const fromQuote = parseTripRequest(source.quote).geography;
    const fromRaw = parseTripRequest(rawText).geography;
    if (
      fromQuote.source !== 'text' ||
      fromRaw.source !== 'text' ||
      fromQuote.scope !== draft.geography.scope ||
      fromQuote.strength !== draft.geography.strength ||
      fromRaw.scope !== draft.geography.scope ||
      fromRaw.strength !== draft.geography.strength
    )
      return { draft, report: report('skipped', 'proof_failed') };

    draft.evidence.push({
      path: '/geography/strength',
      quote: source.quote,
      occurrence: source.occurrence,
    });
    return { draft, report: report('applied', 'scope_coordinate_reused') };
  } catch {
    return {
      draft,
      report: report('internal_error', 'binding_exception'),
    };
  }
}

let validateSchema: ReturnType<
  InstanceType<typeof Ajv2020>['compile']
> | null = null;

function schemaValidator() {
  validateSchema ??= new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile<TripRequestDraftV2>(draftSchema);
  return validateSchema;
}

export function validateDraftSchema(
  value: unknown,
): DraftSchemaValidationResult {
  const validate = schemaValidator();
  if (!validate(value as TripRequestDraftV2)) {
    const instancePath = validate.errors?.[0]?.instancePath ?? '';
    return {
      ok: false,
      issue: {
        stage: 'schema',
        reason: 'schema.invalid',
        path: safeDiagnosticPath(instancePath),
      },
      message: 'Draft 不符合 v2 Schema。',
    };
  }
  return { ok: true, draft: withoutOrphanEvidence(value as TripRequestDraftV2) };
}

/**
 * 模型有时为自己留空（null）的字段也写一条 evidence。这种“孤儿证据”不能给任何值
 * 提供依据，也不会改变抽取结果，所以直接丢掉，而不是整次拒绝草稿；真正缺证据、
 * 引用不在原文、证明不了值的情况仍由后续校验拦下。
 */
function withoutOrphanEvidence(draft: TripRequestDraftV2): TripRequestDraftV2 {
  const expectedKeys = new Set(expectedEvidence(draft).map(evidenceKey));
  const evidence = draft.evidence.filter((item) =>
    expectedKeys.has(evidenceKey({ path: item.path, itemIndex: item.itemIndex ?? null })),
  );
  return evidence.length === draft.evidence.length ? draft : { ...draft, evidence };
}

interface ExpectedEvidence {
  path: string;
  itemIndex: number | null;
  literal?: string;
}

export function validateDraftEvidence(
  draft: TripRequestDraftV2,
  rawText: string,
): DraftValidationResult {
  const text = normalizeText(rawText);
  const expected = expectedEvidence(draft);
  const expectedKeys = new Set(expected.map(evidenceKey));
  const seenKeys = new Set<string>();
  const childEvidenceCoordinates = new Set<string>();

  for (const item of draft.evidence) {
    const normalizedQuote = normalizeText(item.quote);
    const index = item.itemIndex ?? null;
    const key = evidenceKey({ path: item.path, itemIndex: index });
    if (!expectedKeys.has(key))
      return validationFailure(
        {
          stage: 'evidence',
          reason: 'evidence.unexpected_coordinate',
          path: '/evidence',
        },
        `Evidence ${key} 没有对应的抽取值。`,
      );
    if (seenKeys.has(key))
      return validationFailure(
        {
          stage: 'evidence',
          reason: 'evidence.duplicate_coordinate',
          path: '/evidence',
        },
        `Evidence ${key} 重复。`,
      );
    seenKeys.add(key);

    const count = countOccurrences(text, normalizedQuote);
    if (count === 0 || item.occurrence > count)
      return validationFailure(
        {
          stage: 'evidence',
          reason:
            count === 0
              ? 'evidence.quote_not_in_source'
              : 'evidence.occurrence_out_of_range',
          path: '/evidence',
        },
        `Evidence ${key} 不是原文中的有效片段。`,
      );
    if (item.path === '/party/childAges') {
      const coordinate = `${normalizedQuote}#${item.occurrence}`;
      if (childEvidenceCoordinates.has(coordinate))
        return {
          ok: false,
          issue: {
            stage: 'evidence',
            reason: 'evidence.child_coordinate_reused',
            path: '/party/childAges',
          },
          message: '每个儿童年龄必须由独立的 evidence 坐标证明。',
        };
      childEvidenceCoordinates.add(coordinate);
    }
    const target = expected.find((candidate) => evidenceKey(candidate) === key);
    if (
      target?.literal &&
      !normalizedQuote
        .toLocaleLowerCase()
        .includes(normalizeText(target.literal).toLocaleLowerCase())
    )
      return validationFailure(
        {
          stage: 'evidence',
          reason: 'evidence.literal_mismatch',
          path: '/evidence',
        },
        `Evidence ${key} 未包含对应原文值。`,
      );
  }

  const missing = expected.find((item) => !seenKeys.has(evidenceKey(item)));
  if (missing)
    return {
      ok: false,
      issue: {
        stage: 'evidence',
        reason: 'evidence.missing_required_coordinate',
        path: safeDiagnosticPath(missing.path),
      },
      message: `抽取值 ${evidenceKey(missing)} 缺少原文 evidence。`,
    };
  return { ok: true };
}

export function validateDraftSemantics(
  draft: TripRequestDraftV2,
  rawText: string,
): DraftValidationResult {
  const text = normalizeText(rawText);
  if (text.length > 2_000)
    return semanticFailure(
      'semantic.input_too_long',
      null,
      '旅行描述超过 2,000 字符。',
    );

  if (draft.date.resolution === 'missing') {
    if (draft.date.text !== null || draft.date.isoDate !== null)
      return semanticFailure(
        'semantic.invalid_cross_field_state',
        '/date/resolution',
        '缺失日期不能携带日期文字或 ISO 日期。',
      );
  } else if (draft.date.text === null) {
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/date/text',
      '已识别日期必须保留日期原文。',
    );
  }
  if (
    draft.date.resolution === 'relative_unresolved' &&
    draft.date.isoDate !== null
  )
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/date/isoDate',
      '相对日期不能被静默换算为 ISO 日期。',
    );
  if (draft.date.resolution === 'explicit' && draft.date.isoDate === null)
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/date/isoDate',
      '明确日期必须携带 ISO 日期。',
    );
  if (
    draft.date.isoDate !== null &&
    !isValidIsoCalendarDate(draft.date.isoDate)
  )
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/date/isoDate',
      '明确日期不是有效的日历日期。',
    );

  if ((draft.budget.currency === null) !== (draft.budget.totalCents === null))
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      draft.budget.currency === null
        ? '/budget/currency'
        : '/budget/totalCents',
      '预算币种与金额必须成对出现。',
    );
  if (
    (draft.geography.scope === null &&
      ![null, 'unclear'].includes(draft.geography.strength)) ||
    (draft.geography.scope !== null &&
      !['hard', 'soft'].includes(draft.geography.strength ?? ''))
  )
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/geography/strength',
      '活动范围与强度组合不一致。',
    );
  if (
    draft.dailyStartMinutes !== null &&
    (draft.dailyStartText === null ||
      draft.dailyStartMinutes < 8 * 60 ||
      draft.dailyStartMinutes > 13 * 60 ||
      draft.dailyStartMinutes % 15 !== 0)
  )
    return semanticFailure(
      'semantic.invalid_cross_field_state',
      '/dailyStartMinutes',
      '每日开始时间不在当前规划器支持范围内。',
    );
  if (
    draft.dailyStartText !== null &&
    draft.dailyStartMinutes === null &&
    !isVagueAfternoonRuleStart(parseTripRequest(rawText)) &&
    !draft.unhandledRequirements.some((item) => item.kind === 'daily_start') &&
    !draft.unresolvedPhrases.some((item) =>
      normalizeText(draft.dailyStartText ?? '').includes(normalizeText(item)),
    )
  )
    return semanticFailure(
      'semantic.unhandled_requirement_missing',
      '/dailyStartText',
      '模糊出发时间必须保留为 unresolved。',
    );
  if (
    draft.destination.text !== null &&
    draft.destination.supportedCity === null &&
    !draft.unhandledRequirements.some(
      (item) => item.kind === 'destination_scope' && item.hardness === 'hard',
    )
  )
    return semanticFailure(
      'semantic.unhandled_requirement_missing',
      '/unhandledRequirements',
      '不支持的目的地必须保留为硬范围要求。',
    );
  if (
    draft.geography.strength === 'unclear' &&
    !draft.unhandledRequirements.some((item) => item.kind === 'geography') &&
    draft.unresolvedPhrases.length === 0
  )
    return semanticFailure(
      'semantic.unhandled_requirement_missing',
      '/unhandledRequirements',
      '不明确的活动范围必须保留为 unresolved。',
    );
  if (
    containsExplicitNonAudCurrency(text) &&
    !draft.unhandledRequirements.some((item) => item.kind === 'budget')
  )
    return semanticFailure(
      'semantic.unhandled_requirement_missing',
      '/unhandledRequirements',
      '非 AUD 预算必须保留为未处理要求。',
    );

  const rules = parseTripRequest(rawText);
  const evidenceSemantics = validateFieldEvidenceSemantics(draft);
  if (!evidenceSemantics.ok) return evidenceSemantics;
  const costCheck = validateCostAssumptionsAgainstRules(draft, rules);
  if (!costCheck.ok) return costCheck;
  if (rules.city !== 'Melbourne') {
    const hasScopeError = draft.unhandledRequirements.some(
      (item) => item.kind === 'destination_scope' && item.hardness === 'hard',
    );
    if (draft.destination.supportedCity !== null)
      return semanticFailure(
        'semantic.rule_mismatch',
        '/destination/supportedCity',
        '外地城市不能标记为受支持的 Melbourne。',
      );
    if (!hasScopeError)
      return semanticFailure(
        'semantic.unhandled_requirement_missing',
        '/unhandledRequirements',
        '外地城市必须忠实保留为硬范围要求。',
      );
  } else if (
    // 「East Melbourne」「东墨尔本」是墨尔本内的地区名（起点），不是在说目的地。
    /墨尔本|melbourne/i.test(
      text.replace(/east\s*melbourne|东墨尔本|墨尔本(?:市中心|市区|博物馆|动物园|水族馆|板球场|市政厅|演奏中心|IMAX)|melbourne\s+(?:museum|zoo|cricket|town\s*hall|recital|skydeck|aquarium)/giu, ' '),
    ) &&
    draft.destination.supportedCity !== 'Melbourne'
  ) {
    return semanticFailure(
      'semantic.rule_mismatch',
      '/destination/supportedCity',
      '原文中的 Melbourne 被遗漏或改写。',
    );
  }

  if (rules.days !== null) {
    if (rules.days >= 1 && rules.days <= 3 && draft.days !== rules.days)
      return semanticFailure(
        'semantic.rule_mismatch',
        '/days',
        '原文天数与 Draft 不一致。',
      );
    if (rules.days > 3) {
      const hasDurationError = draft.unhandledRequirements.some(
        (item) => item.kind === 'duration_scope' && item.hardness === 'hard',
      );
      if (draft.days !== null)
        return semanticFailure(
          'semantic.rule_mismatch',
          '/days',
          '超范围天数不能被静默缩短。',
        );
      if (!hasDurationError)
        return semanticFailure(
          'semantic.unhandled_requirement_missing',
          '/unhandledRequirements',
          '超范围天数不能被静默缩短。',
        );
    }
  }
  if (
    rules.dailyWindow.startSource === 'text' &&
    draft.dailyStartMinutes !== rules.dailyWindow.startMinutes &&
    !(draft.dailyStartMinutes === null && isVagueAfternoonRuleStart(rules))
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      '/dailyStartMinutes',
      '原文出发时间与 Draft 不一致。',
    );
  if (rules.paceSource === 'text' && draft.pace !== rules.pace)
    return semanticFailure(
      'semantic.rule_mismatch',
      '/pace',
      '原文节奏与 Draft 不一致。',
    );
  if (
    rules.venuePreference.source === 'text' &&
    draft.venuePreference !== rules.venuePreference.value
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      '/venuePreference',
      '原文室内外偏好与 Draft 不一致。',
    );
  if (
    rules.geography.source === 'text' &&
    (draft.geography.scope !== rules.geography.scope ||
      draft.geography.strength !== rules.geography.strength)
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      draft.geography.scope !== rules.geography.scope
        ? '/geography/scope'
        : '/geography/strength',
      '原文活动范围与 Draft 不一致。',
    );
  if (
    rules.totalBudgetCents !== null &&
    (draft.budget.currency !== 'AUD' ||
      draft.budget.totalCents !== rules.totalBudgetCents)
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      '/budget/totalCents',
      '原文 AUD 预算与 Draft 不一致。',
    );
  if (containsExplicitNonAudCurrency(text) && draft.budget.totalCents !== null)
    return semanticFailure(
      'semantic.rule_mismatch',
      '/budget/totalCents',
      '非 AUD 预算不能被模型换算。',
    );

  if (rules.origin.source === 'text') {
    if (!draft.originText)
      return semanticFailure(
        'semantic.rule_mismatch',
        '/originText',
        '原文起点被遗漏。',
      );
    const candidate = resolveOriginCandidate(draft.originText);
    if (candidate.error || candidate.value.refId !== rules.origin.refId)
      return semanticFailure(
        'semantic.rule_mismatch',
        '/originText',
        '原文起点与 Draft 不一致。',
      );
  }
  for (const facet of EXPERIENCE_PATHS) {
    if (
      rules.experiencePreferences[facet] !== 'neutral' &&
      draft.experiencePreferences[facet] !== rules.experiencePreferences[facet]
    )
      return semanticFailure(
        'semantic.rule_mismatch',
        experiencePath(facet),
        `体验偏好 ${facet} 与原文不一致。`,
      );
  }
  const candidateMust = resolveNames(draft.mustIncludeNames);
  const candidateExclude = resolveNames(draft.excludeNames);
  if (
    !isSubset(rules.mustIncludePoiIds, candidateMust.ids) ||
    !isSubset(rules.excludePoiIds, candidateExclude.ids)
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      !isSubset(rules.mustIncludePoiIds, candidateMust.ids)
        ? '/mustIncludeNames'
        : '/excludeNames',
      '必去或避开地点与原文不一致。',
    );
  if (
    rules.unknownHardConstraints.length > 0 &&
    !rules.unknownHardConstraints.every((name) =>
      [...draft.mustIncludeNames, ...draft.excludeNames].some((candidate) =>
        normalizeText(candidate)
          .toLocaleLowerCase()
          .includes(normalizeText(name).toLocaleLowerCase()),
      ),
    )
  )
    return semanticFailure(
      'semantic.unhandled_requirement_missing',
      '/unhandledRequirements',
      '原文中的未知硬地点要求被遗漏。',
    );
  for (const [value, candidate, label, path] of [
    [rules.lowWalking, draft.lowWalking, '少走路', '/lowWalking'],
    [rules.family, draft.family, '亲子', '/family'],
    [rules.avoidCrowds, draft.avoidCrowds, '避开拥挤', '/avoidCrowds'],
  ] as const) {
    if (value && candidate !== true)
      return semanticFailure(
        'semantic.rule_mismatch',
        path,
        `原文“${label}”要求被遗漏。`,
      );
  }

  return { ok: true };
}

export function normalizeDraftToParsedTripRequest(
  draft: TripRequestDraftV2,
  rawText: string,
): ParsedTripRequest {
  let request = parseTripRequest(rawText);
  const evidence = (path: string) =>
    draft.evidence.find((item) => item.path === path)?.quote ?? null;

  const settings = {
    days: draft.days,
    startMinutes: draft.dailyStartMinutes,
    originText: draft.originText,
    geography: draft.geography.scope,
    venuePreference: draft.venuePreference,
    pace: draft.pace,
    experiencePreferences: Object.fromEntries(
      EXPERIENCE_PATHS.flatMap((facet) => {
        const value = draft.experiencePreferences[facet];
        return value === null ? [] : [[facet, value]];
      }),
    ),
    lowWalking: draft.lowWalking,
    family: draft.family,
    dateText: draft.date.text,
    totalBudgetCents: draft.budget.totalCents,
  };
  request = mergeStructuredTripRequest(request, settings);
  request.costAssumptions = {
    accommodation: draft.costAssumptions.accommodation
      ? {
          ...draft.costAssumptions.accommodation,
          source: 'text',
          evidence: evidence('/costAssumptions/accommodation'),
        }
      : null,
    food: draft.costAssumptions.food
      ? {
          ...draft.costAssumptions.food,
          source: 'text',
          evidence: evidence('/costAssumptions/food'),
        }
      : null,
  };
  request.settingConflicts = [];
  request.errors = request.errors.filter(
    (item) => !item.startsWith('旅行描述和详细设置有 '),
  );

  if (draft.days !== null) request.daysSource = 'text';
  if (draft.dailyStartMinutes !== null) {
    request.dailyWindow.startSource = 'text';
    request.dailyWindow.evidence = evidence('/dailyStartMinutes');
  }
  if (draft.originText !== null) {
    const origin = resolveOriginCandidate(draft.originText);
    if (origin.error) request.errors.push(origin.error);
    else
      request.origin = {
        ...origin.value,
        source: 'text',
        evidence: evidence('/originText'),
      };
  }
  if (
    draft.geography.scope !== null &&
    draft.geography.strength !== 'unclear'
  ) {
    request.geography.source = 'text';
    request.geography.evidence =
      evidence('/geography/scope') ?? evidence('/geography/strength');
  }
  if (draft.pace !== null) request.paceSource = 'text';
  if (draft.venuePreference !== null) {
    request.venuePreference.source = 'text';
    request.venuePreference.evidence = evidence('/venuePreference');
  }

  request.lowWalking = draft.lowWalking ?? request.lowWalking;
  request.family = draft.family ?? request.family;
  request.avoidCrowds = draft.avoidCrowds ?? request.avoidCrowds;
  if (
    draft.party.adultFullFareCount !== null ||
    draft.party.concessionEligibleCount !== null ||
    draft.party.childAges.length > 0 ||
    draft.party.ptvPaymentMedium !== null
  ) {
    const paymentOnlyParty =
      draft.party.adultFullFareCount === null &&
      draft.party.concessionEligibleCount === null &&
      draft.party.childAges.length === 0;
    request.pricingParty = {
      adultFullFareCount:
        draft.party.adultFullFareCount ??
        request.pricingParty.adultFullFareCount,
      concessionEligibleCount:
        draft.party.concessionEligibleCount ??
        request.pricingParty.concessionEligibleCount,
      childAges:
        draft.party.childAges.length > 0
          ? [...draft.party.childAges]
          : [...request.pricingParty.childAges],
      ptvPaymentMedium:
        draft.party.ptvPaymentMedium ?? request.pricingParty.ptvPaymentMedium,
      totalTravelers: request.pricingParty.totalTravelers,
      ticketBreakdownStatus: request.pricingParty.ticketBreakdownStatus,
      source: 'text',
    };
    if (
      request.pricingParty.totalTravelers === 1 &&
      paymentOnlyParty === false &&
      parseTripRequest(rawText).pricingParty.source ===
        'visible_default_one_adult'
    )
      request.pricingParty.totalTravelers =
        request.pricingParty.adultFullFareCount +
        request.pricingParty.concessionEligibleCount +
        request.pricingParty.childAges.length;
    request.pricingParty = reconcilePricingParty(request.pricingParty);
  }
  if (request.pricingParty.ticketBreakdownStatus === 'conflict')
    request.errors.push('同行总人数与票型人数不一致。');
  if (
    draft.party.adultFullFareCount === 0 &&
    draft.party.concessionEligibleCount === 0 &&
    draft.party.childAges.length === 0
  )
    request.errors.push('至少需要 1 位同行人。');

  if (draft.destination.supportedCity === null && draft.destination.text) {
    request.city = draft.destination.text;
    request.errors.push(
      `当前版本只支持 Melbourne，不能生成 ${draft.destination.text} 行程。`,
    );
  }
  if (draft.date.resolution === 'explicit')
    request.dateText = draft.date.isoDate;
  else if (draft.date.text !== null) request.dateText = draft.date.text;

  const resolvedMust = resolveNames(draft.mustIncludeNames);
  const resolvedExclude = resolveNames(draft.excludeNames);
  request.mustIncludePoiIds = resolvedMust.ids;
  request.excludePoiIds = resolvedExclude.ids;
  request.unknownHardConstraints = [
    ...new Set([...resolvedMust.unknown, ...resolvedExclude.unknown]),
  ];
  if (request.unknownHardConstraints.length > 0)
    request.errors.push(
      `当前 ${POIS.length} 个地点中还没有：${request.unknownHardConstraints.join('、')}。请换一个地点或取消指定。`,
    );
  const conflict = request.mustIncludePoiIds.find((id) =>
    request.excludePoiIds.includes(id),
  );
  if (conflict) {
    const poi = POIS.find((item) => item.id === conflict);
    request.errors.push(`“${poi?.nameZh ?? conflict}”不能同时设为必去和避开。`);
  }

  for (const requirement of draft.unhandledRequirements) {
    if (requirement.hardness !== 'hard') continue;
    if (requirement.kind === 'destination_scope') continue;
    if (requirement.kind === 'duration_scope') {
      request.days = null;
      request.needsClarification = [];
      request.errors.push('当前版本只支持 1–3 天，不能静默缩短或延长。');
      continue;
    }
    request.errors.push(`暂时不能可靠处理这项必要条件：${requirement.text}。`);
  }
  // 「下午才开始」已由规则按 13:00 放进核对摘要；模型把它列为待确认时不再重复阻断。
  const vagueStart = isVagueAfternoonRuleStart(parseTripRequest(rawText))
    ? normalizeText(draft.dailyStartText ?? '')
    : null;
  const unresolved = draft.unresolvedPhrases.filter(
    (item) => !(vagueStart && vagueStart.includes(normalizeText(item))),
  );
  if (unresolved.length > 0)
    request.errors.push(`还需要确认这些描述：${unresolved.join('、')}。`);
  request.errors = [...new Set(request.errors)];
  request.warnings = [...new Set(request.warnings)];
  return request;
}

export function validatedEvidence(
  draft: TripRequestDraftV2,
): FieldEvidenceV2[] {
  return draft.evidence.map((item) => ({
    path: item.path,
    quote: item.quote,
    occurrence: item.occurrence,
    itemIndex: item.itemIndex ?? null,
  }));
}

export function validateFieldEvidenceSemantics(
  draft: TripRequestDraftV2,
): DraftValidationResult {
  const quote = (path: string) =>
    draft.evidence.find(
      (item) => item.path === path && item.itemIndex === undefined,
    )?.quote ?? '';

  if (
    draft.destination.supportedCity === 'Melbourne' &&
    !/(墨尔本|melbourne)/i.test(quote('/destination/supportedCity'))
  )
    return semanticFailure(
      'semantic.evidence_not_proven',
      '/destination/supportedCity',
      '目的地 evidence 不能证明 Melbourne。',
    );
  if (draft.days !== null) {
    const parsed = parseTripRequest(quote('/days'));
    if (parsed.days !== draft.days)
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/days',
        '天数 evidence 与抽取值不一致。',
      );
  }
  if (draft.date.isoDate !== null) {
    if (!quote('/date/isoDate').includes(draft.date.isoDate))
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/date/isoDate',
        '日期 evidence 不能证明 ISO 日期。',
      );
  }
  if (draft.originText !== null) {
    const candidate = resolveOriginCandidate(draft.originText);
    const fromQuote = resolveOriginCandidate(quote('/originText'));
    const unknownOriginRecorded = draft.unhandledRequirements.some(
      (item) => item.kind === 'origin',
    );
    if (candidate.error) {
      if (!unknownOriginRecorded)
        return semanticFailure(
          'semantic.unhandled_requirement_missing',
          '/unhandledRequirements',
          '未知起点必须保留为未处理要求。',
        );
    } else if (
      fromQuote.error ||
      candidate.value.refId !== fromQuote.value.refId
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/originText',
        '起点 evidence 与抽取值不一致。',
      );
  }
  if (draft.dailyStartMinutes !== null) {
    const parsed = parseTripRequest(quote('/dailyStartMinutes'));
    if (
      parsed.dailyWindow.startSource !== 'text' ||
      parsed.dailyWindow.startMinutes !== draft.dailyStartMinutes
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/dailyStartMinutes',
        '出发时间 evidence 与分钟值不一致。',
      );
  }
  if (draft.geography.scope !== null) {
    const parsed = parseTripRequest(
      `${quote('/geography/scope')} ${quote('/geography/strength')}`,
    );
    if (
      parsed.geography.source !== 'text' ||
      parsed.geography.scope !== draft.geography.scope ||
      parsed.geography.strength !== draft.geography.strength
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        parsed.geography.scope !== draft.geography.scope
          ? '/geography/scope'
          : '/geography/strength',
        '活动范围 evidence 与抽取值不一致。',
      );
  }
  if (draft.pace !== null) {
    const paceQuote = quote('/pace');
    const parsed = parseTripRequest(paceQuote);
    const locallyProven =
      parsed.paceSource === 'text' && parsed.pace === draft.pace;
    const relaxedParaphraseProven =
      draft.pace === 'relaxed' && provesRelaxedPaceParaphrase(paceQuote);
    if (!locallyProven && !relaxedParaphraseProven)
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/pace',
        '节奏 evidence 与抽取值不一致。',
      );
  }
  if (draft.venuePreference !== null) {
    const evidenceQuote = quote('/venuePreference');
    const indoor = /室内|indoor/i.test(evidenceQuote);
    const outdoor = /户外|室外|露天|outdoor/i.test(evidenceQuote);
    const neutral = /都可以|都行|无所谓|没有.{0,8}偏好|均衡/i.test(
      evidenceQuote,
    );
    const strong = /为主|只安排|尽量都|strong/i.test(evidenceQuote);
    const negated = /(不喜欢|不爱|不要|不想|避开|排除|不需要)/i.test(
      evidenceQuote,
    );
    const proven =
      (draft.venuePreference === 'neutral' && neutral) ||
      (draft.venuePreference === 'indoor' && indoor && !strong && !negated) ||
      (draft.venuePreference === 'strong_indoor' &&
        indoor &&
        strong &&
        !negated) ||
      (draft.venuePreference === 'outdoor' && outdoor && !strong && !negated) ||
      (draft.venuePreference === 'strong_outdoor' &&
        outdoor &&
        strong &&
        !negated);
    if (!proven)
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/venuePreference',
        '室内外 evidence 与抽取值不一致。',
      );
  }

  for (const facet of EXPERIENCE_PATHS) {
    const value = draft.experiencePreferences[facet];
    if (value === null) continue;
    const evidenceQuote = quote(`/experiencePreferences/${facet}`);
    const negative = /(不喜欢|不爱|不想|不要|少安排|避开|排除)/i.test(
      evidenceQuote,
    );
    const positiveText = evidenceQuote.replace(
      /(不喜欢|不爱|不想看?|不要安排|少安排|避开|排除)/giu,
      '喜欢',
    );
    const recognized =
      parseTripRequest(positiveText).experiencePreferences[facet];
    if (
      (value === 'prefer' && (negative || recognized !== 'prefer')) ||
      (value === 'avoid' && (!negative || recognized !== 'prefer')) ||
      (value === 'neutral' &&
        !/(都可以|都行|无所谓|没有.{0,8}偏好|均衡)/i.test(evidenceQuote))
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        experiencePath(facet),
        `体验偏好 ${facet} 无法由 evidence 证明。`,
      );
  }

  const booleanChecks: Array<{
    path: '/lowWalking' | '/family' | '/avoidCrowds';
    value: boolean | null;
    positive: (text: string) => boolean;
  }> = [
    {
      path: '/lowWalking',
      value: draft.lowWalking,
      positive: (text) => parseTripRequest(text).lowWalking,
    },
    {
      path: '/family',
      value: draft.family,
      positive: (text) => parseTripRequest(text).family,
    },
    {
      path: '/avoidCrowds',
      value: draft.avoidCrowds,
      positive: (text) => parseTripRequest(text).avoidCrowds,
    },
  ];
  for (const check of booleanChecks) {
    if (check.value === null) continue;
    const evidenceQuote = quote(check.path);
    const isNegative = /(不需要|无需|不必|没有|不用|可以多|不介意)/i.test(
      evidenceQuote,
    );
    if (
      (check.value && (isNegative || !check.positive(evidenceQuote))) ||
      (!check.value && !isNegative)
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        check.path,
        `${check.path} 无法由 evidence 证明。`,
      );
  }

  const adultCount = draft.party.adultFullFareCount;
  if (
    adultCount !== null &&
    !countQuoteMatches(
      quote('/party/adultFullFareCount'),
      adultCount,
      /成人|成年人|大人|adults?|一大一小|1大1小/i,
    )
  )
    return semanticFailure(
      'semantic.evidence_not_proven',
      '/party/adultFullFareCount',
      '成人数量 evidence 与抽取值不一致。',
    );
  const concessionCount = draft.party.concessionEligibleCount;
  if (
    concessionCount !== null &&
    !countQuoteMatches(
      quote('/party/concessionEligibleCount'),
      concessionCount,
      /优惠|concession/i,
    )
  )
    return semanticFailure(
      'semantic.evidence_not_proven',
      '/party/concessionEligibleCount',
      '优惠票数量 evidence 与抽取值不一致。',
    );
  for (const [itemIndex, age] of draft.party.childAges.entries()) {
    const ageQuote =
      draft.evidence.find(
        (item) =>
          item.path === '/party/childAges' && item.itemIndex === itemIndex,
      )?.quote ?? '';
    if (!ageQuote.match(/\d+/g)?.map(Number).includes(age))
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/party/childAges',
        '儿童年龄 evidence 与抽取值不一致。',
      );
  }
  if (draft.party.ptvPaymentMedium !== null) {
    const paymentQuote = quote('/party/ptvPaymentMedium');
    const supported =
      draft.party.ptvPaymentMedium === 'contactless'
        ? /银行卡|信用卡|contactless|手机支付/i.test(paymentQuote)
        : draft.party.ptvPaymentMedium === 'existing_myki'
          ? /已有|现有|自己的.{0,4}myki/i.test(paymentQuote)
          : /新.{0,4}myki|购买.{0,4}myki|实体.{0,4}myki/i.test(paymentQuote);
    if (!supported)
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/party/ptvPaymentMedium',
        '交通支付方式无法由 evidence 证明。',
      );
  }
  if (draft.budget.currency === 'AUD') {
    if (!/(A\$|AUD|澳元)/i.test(quote('/budget/currency')))
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/budget/currency',
        '预算币种 evidence 不能证明 AUD。',
      );
    const amount = Number(
      quote('/budget/totalCents').match(/\d+(?:\.\d{1,2})?/)?.[0],
    );
    if (
      !Number.isFinite(amount) ||
      Math.round(amount * 100) !== draft.budget.totalCents
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/budget/totalCents',
        '预算金额 evidence 与抽取值不一致。',
      );
  }
  const lodging = draft.costAssumptions.accommodation;
  if (lodging) {
    const lodgingQuote = quote('/costAssumptions/accommodation');
    if (
      !/(每晚|一晚|每夜|一夜)/.test(lodgingQuote) ||
      containsExplicitNonAudCurrency(lodgingQuote) ||
      !quoteHasAmounts(lodgingQuote, [lodging.perNightMinCents, lodging.perNightMaxCents])
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/costAssumptions/accommodation',
        '住宿估算 evidence 不能证明每晚澳元金额。',
      );
    if (
      lodging.nights !== null &&
      !new RegExp(`(?:${lodging.nights}|${'零一两三四五六七八九十'[lodging.nights] ?? '#'})\\s*(?:晚|夜)`).test(
        quote('/costAssumptions/accommodation/nights'),
      )
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/costAssumptions/accommodation/nights',
        '住宿晚数 evidence 与抽取值不一致。',
      );
  }
  const food = draft.costAssumptions.food;
  if (food) {
    const foodQuote = quote('/costAssumptions/food');
    if (
      !/每人每天/.test(foodQuote) ||
      containsExplicitNonAudCurrency(foodQuote) ||
      !quoteHasAmounts(foodQuote, [food.perPersonPerDayMinCents, food.perPersonPerDayMaxCents])
    )
      return semanticFailure(
        'semantic.evidence_not_proven',
        '/costAssumptions/food',
        '餐饮估算 evidence 不能证明每人每天澳元金额。',
      );
  }
  for (const [path, names, intent] of [
    ['/mustIncludeNames', draft.mustIncludeNames, 'must'],
    ['/excludeNames', draft.excludeNames, 'exclude'],
  ] as const) {
    for (const [itemIndex, name] of names.entries()) {
      const itemQuote =
        draft.evidence.find(
          (item) => item.path === path && item.itemIndex === itemIndex,
        )?.quote ?? '';
      let intentCheck: ReturnType<typeof evidenceSupportsNamedPoiIntent>;
      try {
        intentCheck = evidenceSupportsNamedPoiIntent(itemQuote, name, intent);
      } catch {
        intentCheck = { ok: false, cause: 'unclassified' };
      }
      if (!intentCheck.ok)
        return semanticFailure(
          'semantic.evidence_not_proven',
          path,
          `${path} evidence 未把地点与明确意图绑定。`,
          intent === 'must' ? intentCheck.cause : undefined,
        );
    }
  }
  return { ok: true };
}

function provesRelaxedPaceParaphrase(quote: string): boolean {
  const text = normalizeText(quote);
  // This is a narrow evidence proof, not a planner default. An LLM may
  // recognize an idiom that the local parser does not, but the quoted words
  // must still explicitly express a slower schedule without a contrary cue.
  if (/(充实|多安排|紧凑|packed|越多越好|尽量多跑)/i.test(text)) return false;
  return (
    /(?:别|不要|不想|不愿|避免|尽量不)[^，。；;]{0,8}(?:太赶|赶时间|排(?:得)?太满|安排(?:得)?太满|太紧|太紧凑)/i.test(
      text,
    ) || /(?:慢悠悠|悠闲|从容|不赶时间)/i.test(text)
  );
}

function evidenceSupportsNamedPoiIntent(
  quote: string,
  name: string,
  expected: 'must' | 'exclude',
): { ok: true } | { ok: false; cause: MustIncludeCauseCode } {
  const normalizedQuote = normalizeText(quote).toLocaleLowerCase();
  const normalizedName = normalizeText(name).toLocaleLowerCase();
  if (!normalizedQuote || !normalizedName)
    return { ok: false, cause: 'unclassified' };
  const nameStart = normalizedQuote.indexOf(normalizedName);
  if (nameStart < 0) return { ok: false, cause: 'unclassified' };
  const nameEnd = nameStart + normalizedName.length;
  const matches = [
    ...intentMatches(
      normalizedQuote,
      /(必去|一定(?:要)?去|必须安排|必须去|(?:必须|一定要|一定得|务必)(?:去|安排|排进|排上|包括)|must)/giu,
      'must',
    ),
    ...intentMatches(
      normalizedQuote,
      /(不要去|不去|避开|排除|exclude|avoid)/giu,
      'exclude',
    ),
  ].map((item) => ({
    ...item,
    distance:
      item.end <= nameStart
        ? nameStart - item.end
        : item.start >= nameEnd
          ? item.start - nameEnd
          : 0,
  }));
  const closestExpected = Math.min(
    ...matches
      .filter((item) => item.intent === expected)
      .map((item) => item.distance),
  );
  const closestOpposite = Math.min(
    ...matches
      .filter((item) => item.intent !== expected)
      .map((item) => item.distance),
  );
  if (Number.isFinite(closestExpected) && closestExpected < closestOpposite)
    return { ok: true };
  if (!Number.isFinite(closestExpected) && Number.isFinite(closestOpposite))
    return { ok: false, cause: 'opposite_only' };
  if (!Number.isFinite(closestExpected) && !Number.isFinite(closestOpposite))
    return { ok: false, cause: 'intent_marker_absent' };
  if (expected === 'must' && closestOpposite <= closestExpected)
    return { ok: false, cause: 'opposite_nearer_or_tied' };
  return { ok: false, cause: 'unclassified' };
}

function intentMatches(
  text: string,
  pattern: RegExp,
  intent: 'must' | 'exclude',
): Array<{ intent: 'must' | 'exclude'; start: number; end: number }> {
  return [...text.matchAll(pattern)].map((match) => ({
    intent,
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function countQuoteMatches(
  quote: string,
  expected: number,
  subject: RegExp,
): boolean {
  if (!subject.test(quote)) return false;
  if (expected === 0 && /(不使用|没有|无|0|零)/.test(quote)) return true;
  const token = quote.match(/\d+|[零〇一二两三四五六七八九十]{1,3}/)?.[0];
  if (token === undefined) return false;
  const count = /^\d+$/.test(token)
    ? Number(token)
    : token === '十'
      ? 10
      : token.startsWith('十')
        ? 10 +
          ({
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
          }[token.slice(1)] ?? 0)
        : token.endsWith('十')
          ? ({ 一: 1, 二: 2, 两: 2 }[token.slice(0, -1)] ?? 0) * 10
          : ({
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
            }[token] ?? -1);
  return count === expected;
}

function isSubset(required: string[], candidate: string[]): boolean {
  const candidateSet = new Set(candidate);
  return required.every((value) => candidateSet.has(value));
}

function expectedEvidence(draft: TripRequestDraftV2): ExpectedEvidence[] {
  const items: ExpectedEvidence[] = [];
  const scalar = (path: string, value: unknown, literal?: string) => {
    if (value !== null) items.push({ path, itemIndex: null, literal });
  };
  scalar(
    '/destination/text',
    draft.destination.text,
    draft.destination.text ?? undefined,
  );
  scalar('/destination/supportedCity', draft.destination.supportedCity);
  scalar('/days', draft.days);
  scalar('/date/text', draft.date.text, draft.date.text ?? undefined);
  scalar('/date/isoDate', draft.date.isoDate);
  if (draft.date.resolution !== 'missing')
    scalar('/date/resolution', draft.date.resolution);
  scalar('/originText', draft.originText, draft.originText ?? undefined);
  scalar(
    '/dailyStartText',
    draft.dailyStartText,
    draft.dailyStartText ?? undefined,
  );
  scalar('/dailyStartMinutes', draft.dailyStartMinutes);
  scalar('/geography/scope', draft.geography.scope);
  scalar('/geography/strength', draft.geography.strength);
  scalar('/pace', draft.pace);
  scalar('/venuePreference', draft.venuePreference);
  for (const facet of EXPERIENCE_PATHS)
    scalar(
      `/experiencePreferences/${facet}`,
      draft.experiencePreferences[facet],
    );
  scalar('/lowWalking', draft.lowWalking);
  scalar('/family', draft.family);
  scalar('/avoidCrowds', draft.avoidCrowds);
  scalar('/party/adultFullFareCount', draft.party.adultFullFareCount);
  scalar('/party/concessionEligibleCount', draft.party.concessionEligibleCount);
  draft.party.childAges.forEach((age, itemIndex) =>
    items.push({ path: '/party/childAges', itemIndex, literal: String(age) }),
  );
  scalar('/party/ptvPaymentMedium', draft.party.ptvPaymentMedium);
  scalar('/budget/currency', draft.budget.currency);
  scalar('/budget/totalCents', draft.budget.totalCents);
  scalar('/costAssumptions/accommodation', draft.costAssumptions.accommodation);
  scalar(
    '/costAssumptions/accommodation/nights',
    draft.costAssumptions.accommodation?.nights ?? null,
  );
  scalar('/costAssumptions/food', draft.costAssumptions.food);
  for (const [path, values] of [
    ['/mustIncludeNames', draft.mustIncludeNames],
    ['/excludeNames', draft.excludeNames],
    [
      '/unhandledRequirements',
      draft.unhandledRequirements.map((item) => item.text),
    ],
    ['/unresolvedPhrases', draft.unresolvedPhrases],
  ] as const)
    values.forEach((value, itemIndex) =>
      items.push({ path, itemIndex, literal: value }),
    );
  return items;
}

function evidenceKey(item: { path: string; itemIndex: number | null }): string {
  return `${item.path}#${item.itemIndex ?? 'scalar'}`;
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim();
}

function countOccurrences(text: string, quote: string): number {
  if (!quote) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= text.length - quote.length) {
    const found = text.indexOf(quote, cursor);
    if (found < 0) break;
    count += 1;
    cursor = found + quote.length;
  }
  return count;
}

function resolveNames(names: string[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const result = resolvePoiNameCandidate(name);
    if (result.status === 'resolved') ids.push(result.poiId);
    else unknown.push(name);
  }
  return { ids: [...new Set(ids)], unknown: [...new Set(unknown)] };
}

function quoteHasAmounts(quote: string, cents: number[]): boolean {
  const found = (quote.match(/\d+(?:\.\d{1,2})?/g) ?? []).map((value) =>
    Math.round(Number(value) * 100),
  );
  return cents.every((value) => found.includes(value));
}

/**
 * 模型抽到的住宿/餐饮估算必须与本地规则一致；规则读到而模型漏掉、或写了非澳元
 * 却被模型填成金额，都整次回退规则。
 */
function validateCostAssumptionsAgainstRules(
  draft: TripRequestDraftV2,
  rules: ParsedTripRequest,
): DraftValidationResult {
  const ruleCost = rules.costAssumptions ?? NO_COST_ASSUMPTIONS;
  const ruleLodging = ruleCost.accommodation;
  const draftLodging = draft.costAssumptions.accommodation;
  if (
    ruleLodging &&
    (!draftLodging ||
      draftLodging.perNightMinCents !== ruleLodging.perNightMinCents ||
      draftLodging.perNightMaxCents !== ruleLodging.perNightMaxCents ||
      draftLodging.nights !== ruleLodging.nights)
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      '/costAssumptions/accommodation',
      '原文住宿估算与 Draft 不一致。',
    );
  const ruleFood = ruleCost.food;
  const draftFood = draft.costAssumptions.food;
  if (
    ruleFood &&
    (!draftFood ||
      draftFood.perPersonPerDayMinCents !== ruleFood.perPersonPerDayMinCents ||
      draftFood.perPersonPerDayMaxCents !== ruleFood.perPersonPerDayMaxCents)
  )
    return semanticFailure(
      'semantic.rule_mismatch',
      '/costAssumptions/food',
      '原文餐饮估算与 Draft 不一致。',
    );
  const nonAud = rules.warnings.join('');
  if (draftLodging && !ruleLodging && nonAud.includes('住宿费用只接受澳元'))
    return semanticFailure(
      'semantic.rule_mismatch',
      '/costAssumptions/accommodation',
      '非澳元住宿费用不能被模型换算。',
    );
  if (draftFood && !ruleFood && nonAud.includes('餐饮费用只接受澳元'))
    return semanticFailure(
      'semantic.rule_mismatch',
      '/costAssumptions/food',
      '非澳元餐饮费用不能被模型换算。',
    );
  return { ok: true };
}

/**
 * 规则把只说「下午（才）出发/开始」、没有钟点的描述按 13:00 放进核对摘要。
 * 提示词要求模型不要猜分钟，所以这种情况下模型留空 dailyStartMinutes 是正确的，
 * 规范化时沿用规则的 13:00，由用户在确认时修改。
 */
function isVagueAfternoonRuleStart(rules: ParsedTripRequest): boolean {
  const evidence = rules.dailyWindow.evidence ?? '';
  return (
    rules.dailyWindow.startSource === 'text' &&
    /下午/.test(evidence) &&
    !/(\d|[一二两三四五六七八九十]\s*点|:)/.test(evidence)
  );
}
