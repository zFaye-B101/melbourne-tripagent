export const SAFE_EVIDENCE_PATHS = [
  '/destination/text',
  '/destination/supportedCity',
  '/days',
  '/date/text',
  '/date/isoDate',
  '/date/resolution',
  '/originText',
  '/dailyStartText',
  '/dailyStartMinutes',
  '/geography/scope',
  '/geography/strength',
  '/pace',
  '/venuePreference',
  '/experiencePreferences/museum_exhibition',
  '/experiencePreferences/history_heritage',
  '/experiencePreferences/parks_gardens',
  '/experiencePreferences/river_city_walk',
  '/experiencePreferences/city_icons_views',
  '/experiencePreferences/performance_music',
  '/experiencePreferences/sports_venues',
  '/experiencePreferences/market_local_life',
  '/lowWalking',
  '/family',
  '/avoidCrowds',
  '/party/adultFullFareCount',
  '/party/concessionEligibleCount',
  '/party/childAges',
  '/party/ptvPaymentMedium',
  '/budget/currency',
  '/budget/totalCents',
  '/costAssumptions/accommodation',
  '/costAssumptions/accommodation/nights',
  '/costAssumptions/food',
  '/mustIncludeNames',
  '/excludeNames',
  '/unhandledRequirements',
  '/unresolvedPhrases',
] as const;
export type SafePath =
  | (typeof SAFE_EVIDENCE_PATHS)[number]
  | '/schemaVersion'
  | '/evidence'
  | null;
export const BINDING_STATUSES = [
  'not_run',
  'not_needed',
  'applied',
  'skipped',
  'internal_error',
] as const;
export const BINDING_REASONS = [
  'schema_not_passed',
  'invalid_existing',
  'missing_count_not_one',
  'target_not_allowlisted',
  'source_missing_or_ambiguous',
  'proof_failed',
  'post_validation_failed',
  'disabled',
  'scope_coordinate_reused',
  'binding_exception',
] as const;
type LocalDiagnosticBinding = {
  policy: 'evidence-binding-v1';
  status: (typeof BINDING_STATUSES)[number];
  reason: (typeof BINDING_REASONS)[number];
  addedPath: '/geography/strength' | null;
  addedCount: 0 | 1;
};
type LocalDiagnosticFailure = {
  stage: 'schema' | 'evidence' | 'semantic' | 'normalization';
  reason: SafeValidationReason;
  path: SafePath;
};
export type MustIncludeCauseCode =
  | 'unclassified'
  | 'opposite_only'
  | 'intent_marker_absent'
  | 'opposite_nearer_or_tied';
export type MustIncludeCause = { code: MustIncludeCauseCode };
export type LocalDiagnosticEventV1 = {
  version: 1;
  event: 'nlu_validation';
  outcome: 'accepted' | 'fallback';
  binding: LocalDiagnosticBinding;
  firstFailure: LocalDiagnosticFailure | null;
};
export type LocalDiagnosticEvent =
  | LocalDiagnosticEventV1
  | LocalDiagnosticEventV2;
export type LocalDiagnosticEventV2 = Omit<
  LocalDiagnosticEventV1,
  'version' | 'firstFailure'
> & {
  version: 2;
  firstFailure: LocalDiagnosticFailure | null;
  mustIncludeCause: MustIncludeCause | null;
};
export type SafeValidationIssue = {
  stage: 'schema' | 'evidence' | 'semantic' | 'normalization';
  reason: SafeValidationReason;
  path: SafePath;
};
export type SafeValidationReason =
  | 'schema.invalid'
  | 'schema.post_binding_invalid'
  | 'schema.validator_exception'
  | 'evidence.unexpected_coordinate'
  | 'evidence.duplicate_coordinate'
  | 'evidence.quote_not_in_source'
  | 'evidence.occurrence_out_of_range'
  | 'evidence.child_coordinate_reused'
  | 'evidence.literal_mismatch'
  | 'evidence.missing_required_coordinate'
  | 'evidence.binding_exception'
  | 'evidence.validator_exception'
  | 'semantic.input_too_long'
  | 'semantic.invalid_cross_field_state'
  | 'semantic.rule_mismatch'
  | 'semantic.evidence_not_proven'
  | 'semantic.unhandled_requirement_missing'
  | 'semantic.validator_exception'
  | 'normalization.exception';
export interface LocalNluDiagnosticsSink {
  emit(
    event: LocalDiagnosticEventV1 | LocalDiagnosticEventV2,
  ): void | Promise<void>;
}
export const SAFE_VALIDATION_REASONS = {
  schema: [
    'schema.invalid',
    'schema.post_binding_invalid',
    'schema.validator_exception',
  ],
  evidence: [
    'evidence.unexpected_coordinate',
    'evidence.duplicate_coordinate',
    'evidence.quote_not_in_source',
    'evidence.occurrence_out_of_range',
    'evidence.child_coordinate_reused',
    'evidence.literal_mismatch',
    'evidence.missing_required_coordinate',
    'evidence.binding_exception',
    'evidence.validator_exception',
  ],
  semantic: [
    'semantic.input_too_long',
    'semantic.invalid_cross_field_state',
    'semantic.rule_mismatch',
    'semantic.evidence_not_proven',
    'semantic.unhandled_requirement_missing',
    'semantic.validator_exception',
  ],
  normalization: ['normalization.exception'],
} as const satisfies Record<
  SafeValidationIssue['stage'],
  readonly SafeValidationReason[]
>;
const SAFE_PATHS = [
  '/schemaVersion',
  '/evidence',
  ...SAFE_EVIDENCE_PATHS,
] as const;

export function safeDiagnosticPath(path: string): SafePath {
  if (path === '/schemaVersion') return path;
  if (path === '/evidence' || path.startsWith('/evidence/')) return '/evidence';
  for (const safePath of SAFE_EVIDENCE_PATHS) {
    if (path === safePath || path.startsWith(`${safePath}/`)) return safePath;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function includesValue<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
export function sanitizeLocalDiagnostic(
  value: unknown,
): LocalDiagnosticEventV1 | LocalDiagnosticEventV2 | null {
  if (!isRecord(value)) return null;
  const e = value;
  if (
    (e.version !== 1 && e.version !== 2) ||
    e.event !== 'nlu_validation' ||
    !includesValue(['accepted', 'fallback'] as const, e.outcome) ||
    !isRecord(e.binding)
  )
    return null;
  const b = e.binding;
  if (
    b.policy !== 'evidence-binding-v1' ||
    !includesValue(BINDING_STATUSES, b.status) ||
    !includesValue(BINDING_REASONS, b.reason) ||
    (b.addedPath !== null && b.addedPath !== '/geography/strength') ||
    (b.addedCount !== 0 && b.addedCount !== 1)
  )
    return null;
  const applied = b.status === 'applied';
  if (
    applied !==
    (b.addedCount === 1 &&
      b.addedPath === '/geography/strength' &&
      b.reason === 'scope_coordinate_reused')
  )
    return null;
  if (!applied && (b.addedCount !== 0 || b.addedPath !== null)) return null;
  if (
    (b.status === 'not_run') !== (b.reason === 'schema_not_passed') ||
    (b.status === 'internal_error') !== (b.reason === 'binding_exception')
  )
    return null;
  const f = e.firstFailure;
  if ((e.outcome === 'accepted') !== (f === null)) return null;
  if (f === null) {
    if (e.version === 2) {
      if (
        !Object.prototype.hasOwnProperty.call(e, 'mustIncludeCause') ||
        e.mustIncludeCause !== null
      )
        return null;
      return {
        version: 2,
        event: 'nlu_validation',
        outcome: 'accepted',
        binding: {
          policy: 'evidence-binding-v1',
          status: b.status,
          reason: b.reason,
          addedPath: b.addedPath,
          addedCount: b.addedCount,
        },
        firstFailure: null,
        mustIncludeCause: null,
      };
    }
    return {
      version: 1,
      event: 'nlu_validation',
      outcome: 'accepted',
      binding: {
        policy: 'evidence-binding-v1',
        status: b.status,
        reason: b.reason,
        addedPath: b.addedPath,
        addedCount: b.addedCount,
      },
      firstFailure: null,
    };
  }
  if (!isRecord(f)) return null;
  const x = f;
  if (
    !includesValue(
      ['schema', 'evidence', 'semantic', 'normalization'] as const,
      x.stage,
    )
  )
    return null;
  if (!includesValue(SAFE_VALIDATION_REASONS[x.stage], x.reason)) return null;
  if (x.path !== null && !includesValue(SAFE_PATHS, x.path)) return null;
  if (e.version === 2) {
    if (!Object.prototype.hasOwnProperty.call(e, 'mustIncludeCause'))
      return null;
    const causeValue = e.mustIncludeCause;
    const validCause =
      causeValue === null ||
      (isRecord(causeValue) &&
        includesValue(
          [
            'unclassified',
            'opposite_only',
            'intent_marker_absent',
            'opposite_nearer_or_tied',
          ] as const,
          causeValue.code,
        ));
    if (!validCause) return null;
    const cause: MustIncludeCause | null =
      causeValue === null
        ? null
        : {
            code: causeValue.code as MustIncludeCauseCode,
          };
    const isMustFailure =
      x.stage === 'semantic' &&
      x.reason === 'semantic.evidence_not_proven' &&
      x.path === '/mustIncludeNames';
    if (isMustFailure ? cause === null : cause !== null) return null;
    return {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: {
        policy: 'evidence-binding-v1',
        status: b.status,
        reason: b.reason,
        addedPath: b.addedPath,
        addedCount: b.addedCount,
      },
      firstFailure: { stage: x.stage, reason: x.reason, path: x.path },
      mustIncludeCause: cause,
    };
  }
  return {
    version: 1,
    event: 'nlu_validation',
    outcome: 'fallback',
    binding: {
      policy: 'evidence-binding-v1',
      status: b.status,
      reason: b.reason,
      addedPath: b.addedPath,
      addedCount: b.addedCount,
    },
    firstFailure: {
      stage: x.stage,
      reason: x.reason,
      path: x.path,
    },
  };
}
export function createLocalNluDiagnosticsSink(
  env: { LLM_LOCAL_DIAGNOSTICS?: string; LLM_RUNTIME_ENV?: string },
  request: Request,
): LocalNluDiagnosticsSink | undefined {
  let h = '';
  try {
    h = new URL(request.url).hostname;
  } catch {
    return undefined;
  }
  if (
    env.LLM_LOCAL_DIAGNOSTICS !== 'true' ||
    env.LLM_RUNTIME_ENV !== 'local' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(h)
  )
    return undefined;
  let emitted = false;
  return {
    emit(v) {
      if (emitted) return;
      const e = sanitizeLocalDiagnostic(v);
      if (!e) return;
      emitted = true;
      try {
        console.error(
          `TRIPAGENT_NLU_LOCAL_DIAG_V${e.version} ${JSON.stringify(e)}`,
        );
      } catch {}
    },
  };
}
