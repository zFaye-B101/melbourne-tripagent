import {
  POI_DATASET,
  parseTripRequest,
  reconcilePricingParty,
  resolveOriginCandidate,
  type ParsedTripRequest,
} from './planner';
import {
  DEFAULT_RULES_DIAGNOSTICS,
  type InterpretationOutcome,
  type ParserDiagnostics,
} from './nlu-contract';
import type { ParseResponseV1 } from './llm-api';
import { SAFE_EVIDENCE_PATHS } from './local-nlu-diagnostics';

const PARSE_PATH = '/v1/trip-requests/parse';
const MAX_RESPONSE_BYTES = 64_000;
const DEFAULT_DEADLINE_MS = 6_000;
const LOCAL_DEADLINE_MS = 65_000;
const DIAGNOSTIC_FALLBACKS = new Set([
  'deadline_exceeded',
  'rate_limited',
  'provider_unavailable',
  'auth_or_config',
  'invalid_json',
  'schema_rejected',
  'evidence_rejected',
  'semantic_rejected',
  'version_mismatch',
  'circuit_open',
  'worse_than_rules',
]);

export interface BffParseClientOptions {
  /** A caller-owned, explicit endpoint. This module never reads browser config. */
  endpoint: string;
  rawText: string;
  sourceFingerprint: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Calls the provider-neutral Parse API only when the page passes the endpoint
 * after an explicit per-request opt-in click. This module never chooses a
 * provider, discovers an endpoint, or requests consent on its own.
 */
export async function interpretTripRequestViaBff(
  options: BffParseClientOptions,
): Promise<InterpretationOutcome> {
  if (options.signal?.aborted)
    return { status: 'aborted', sourceFingerprint: options.sourceFingerprint };
  const normalizedText = options.rawText.normalize('NFKC').trim();
  if (normalizedText.length === 0 || normalizedText.length > 2_000)
    return rulesFallback(
      options.rawText,
      options.sourceFingerprint,
      'auth_or_config',
    );
  const endpoint = parseEndpoint(options.endpoint);
  if (!endpoint)
    return rulesFallback(
      options.rawText,
      options.sourceFingerprint,
      'auth_or_config',
    );

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort('deadline');
    },
    Math.max(
      1,
      options.deadlineMs ??
        (new URL(endpoint).protocol === 'http:'
          ? LOCAL_DEADLINE_MS
          : DEFAULT_DEADLINE_MS),
    ),
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: options.rawText,
        locale: 'zh-CN',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    if (options.signal?.aborted)
      return {
        status: 'aborted',
        sourceFingerprint: options.sourceFingerprint,
      };
    if (!response.ok)
      return rulesFallback(
        options.rawText,
        options.sourceFingerprint,
        response.status === 429
          ? 'rate_limited'
          : response.status === 409
            ? 'version_mismatch'
            : response.status === 401 || response.status === 403
              ? 'auth_or_config'
              : 'provider_unavailable',
      );
    const value = await readJsonResponse(response, controller.signal);
    if (options.signal?.aborted)
      return {
        status: 'aborted',
        sourceFingerprint: options.sourceFingerprint,
      };
    if (value === null)
      return rulesFallback(
        options.rawText,
        options.sourceFingerprint,
        timedOut ? 'deadline_exceeded' : 'invalid_json',
      );
    const parsed = validateParseResponse(value, normalizedText);
    if (!parsed)
      return rulesFallback(
        options.rawText,
        options.sourceFingerprint,
        'invalid_json',
      );
    return toOutcome(parsed, options.rawText, options.sourceFingerprint);
  } catch {
    if (options.signal?.aborted)
      return {
        status: 'aborted',
        sourceFingerprint: options.sourceFingerprint,
      };
    return rulesFallback(
      options.rawText,
      options.sourceFingerprint,
      timedOut ? 'deadline_exceeded' : 'provider_unavailable',
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function parseEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.pathname !== PARSE_PATH ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

function toOutcome(
  response: ParseResponseV1,
  rawText: string,
  sourceFingerprint: string,
): InterpretationOutcome {
  if (response.decision === 'service_error')
    return {
      status: 'failed',
      sourceFingerprint,
      diagnostics: response.parser,
      message: '远程理解暂时不可用；上一份成功行程仍然保留。',
    };
  if (response.decision === 'scope_error')
    return {
      status: 'failed',
      sourceFingerprint,
      diagnostics: response.parser,
      message: '这次需求超出当前行程范围；上一份成功行程仍然保留。',
    };
  if (response.request === null)
    return {
      status: 'failed',
      sourceFingerprint,
      diagnostics: response.parser,
      message: '远程理解返回了无效结果。',
    };
  return {
    status: 'complete',
    sourceFingerprint,
    request: { ...response.request, rawText },
    diagnostics: response.parser,
    fieldEvidence: response.fieldEvidence,
  };
}

function rulesFallback(
  rawText: string,
  sourceFingerprint: string,
  reason: NonNullable<ParserDiagnostics['fallbackReasonCode']>,
): InterpretationOutcome {
  return {
    status: 'complete',
    sourceFingerprint,
    request: parseTripRequest(rawText),
    diagnostics: {
      ...DEFAULT_RULES_DIAGNOSTICS,
      attemptedMode: 'llm',
      fallbackReasonCode: reason,
    },
    fieldEvidence: [],
  };
}

function validateParseResponse(
  value: unknown,
  rawText: string,
): ParseResponseV1 | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'apiVersion',
      'requestId',
      'decision',
      'parser',
      'datasetVersion',
      'request',
      'fieldEvidence',
      'question',
      'warnings',
    ])
  )
    return null;
  if (
    value.apiVersion !== 'trip-parse-api-v1' ||
    !nonEmptyString(value.requestId) ||
    value.datasetVersion !== POI_DATASET.dataVersion ||
    !isParser(value.parser) ||
    !isEvidence(value.fieldEvidence, rawText) ||
    !isWarnings(value.warnings)
  )
    return null;
  const request =
    value.request === null ? null : parseRequest(value.request, rawText);
  if (value.request !== null && !request) return null;
  if (value.decision === 'ready')
    return request &&
      value.question === null &&
      request.errors.length === 0 &&
      request.needsClarification.length === 0 &&
      value.parser.acceptedMode !== 'none' &&
      (value.parser.acceptedMode !== 'llm' ||
        hasCoreEvidence(value.fieldEvidence, rawText))
      ? ({ ...value, request } as unknown as ParseResponseV1)
      : null;
  if (value.decision === 'clarification')
    return request &&
      isDaysQuestion(value.question) &&
      request.days === null &&
      request.needsClarification.length === 1 &&
      request.needsClarification[0] === 'days' &&
      value.parser.acceptedMode !== 'none'
      ? ({ ...value, request } as unknown as ParseResponseV1)
      : null;
  if (value.decision === 'scope_error')
    return request === null &&
      value.question === null &&
      value.parser.acceptedMode !== 'none'
      ? (value as unknown as ParseResponseV1)
      : null;
  if (value.decision === 'service_error')
    return request === null &&
      value.question === null &&
      value.parser.acceptedMode === 'none'
      ? (value as unknown as ParseResponseV1)
      : null;
  return null;
}

function parseRequest(
  value: unknown,
  rawText: string,
): Omit<ParsedTripRequest, 'rawText'> | null {
  if (!isRecord(value)) return null;
  const template = parseTripRequest(rawText);
  const { rawText: _rawText, ...shape } = template;
  if (!hasExactKeys(value, Object.keys(shape)) || !matchesShape(value, shape))
    return null;
  const request = value as Omit<ParsedTripRequest, 'rawText'>;
  if (
    request.requestVersion !== 'parsed-trip-request-v2' ||
    request.city !== 'Melbourne' ||
    !['relaxed', 'balanced', 'packed'].includes(request.pace) ||
    !['relaxed', 'balanced', 'packed'].includes(request.requestedPace) ||
    !['relaxed', 'balanced', 'packed'].includes(request.effectivePace) ||
    !['cbd_core_v1', 'central_city_v1', 'supported_inner_city'].includes(
      request.geography.scope,
    ) ||
    !['soft', 'hard'].includes(request.geography.strength) ||
    request.geography.zoneVersion !== 'mel-central-zones-v1' ||
    ![
      'strong_outdoor',
      'outdoor',
      'neutral',
      'indoor',
      'strong_indoor',
    ].includes(request.venuePreference.value) ||
    !['poi', 'preset_proxy'].includes(request.origin.kind) ||
    !['exact_poi', 'area_proxy', 'default_proxy'].includes(
      request.origin.resolution,
    ) ||
    !['contactless', 'existing_myki', 'new_physical_myki'].includes(
      request.pricingParty.ptvPaymentMedium,
    ) ||
    !validMinutes(request.dailyWindow.startMinutes) ||
    !validMinutes(request.dailyWindow.endMinutes) ||
    request.dailyWindow.startMinutes >= request.dailyWindow.endMinutes ||
    !validDays(request.days) ||
    !validIds(request.mustIncludePoiIds) ||
    !validIds(request.excludePoiIds) ||
    request.mustIncludePoiIds.some((id) =>
      request.excludePoiIds.includes(id),
    ) ||
    request.needsClarification.some((item) => item !== 'days') ||
    !Object.values(request.categoryPreferences).every((item) =>
      ['prefer', 'neutral', 'avoid'].includes(item),
    ) ||
    !Object.values(request.experiencePreferences).every((item) =>
      ['prefer', 'neutral', 'avoid'].includes(item),
    ) ||
    request.pricingParty.ticketBreakdownStatus !==
      reconcilePricingParty(request.pricingParty).ticketBreakdownStatus ||
    (template.pricingParty.source === 'text' &&
      request.pricingParty.totalTravelers !==
        template.pricingParty.totalTravelers) ||
    !isRequestCollectionsSafe(request)
  )
    return null;
  return request;
}

function hasCoreEvidence(value: unknown, rawText: string): boolean {
  if (!Array.isArray(value)) return false;
  const paths = new Set(
    value
      .filter(isRecord)
      .map((item) => item.path)
      .filter(nonEmptyString),
  );
  const local = parseTripRequest(rawText);
  if (
    /(?:墨尔本|melbourne)/i.test(rawText) &&
    (!paths.has('/destination/text') ||
      !paths.has('/destination/supportedCity'))
  )
    return false;
  return local.days === null || paths.has('/days');
}

function isRequestCollectionsSafe(
  request: Omit<ParsedTripRequest, 'rawText'>,
): boolean {
  const stringArrays = [
    request.mustIncludePoiIds,
    request.excludePoiIds,
    request.unknownHardConstraints,
    request.assumptions,
    request.warnings,
    request.errors,
  ];
  if (
    !stringArrays.every((items) =>
      items.every((item) => typeof item === 'string'),
    ) ||
    !request.interests.every((item) =>
      ['art', 'history', 'nature', 'food', 'family'].includes(item),
    ) ||
    new Set(request.interests).size !== request.interests.length ||
    !request.pricingParty.childAges.every(
      (age) => Number.isInteger(age) && age >= 0 && age <= 17,
    ) ||
    !request.settingConflicts.every(
      (conflict) =>
        isRecord(conflict) &&
        hasExactKeys(conflict, ['field', 'message']) &&
        [
          'days',
          'start_time',
          'origin',
          'area',
          'venue',
          'pace',
          'experiences',
          'date',
          'budget',
          'party',
        ].includes(conflict.field as string) &&
        nonEmptyString(conflict.message),
    )
  )
    return false;
  return (
    isFiniteNumber(request.origin.latitude) &&
    isFiniteNumber(request.origin.longitude) &&
    nonEmptyString(request.origin.refId) &&
    nonEmptyString(request.origin.label) &&
    validSource(request.origin.source) &&
    nullableString(request.origin.evidence) &&
    originMatchesKnown(request) &&
    validSource(request.dailyWindow.startSource) &&
    request.dailyWindow.endSource === 'default' &&
    nullableString(request.dailyWindow.evidence) &&
    validSource(request.geography.source) &&
    nullableString(request.geography.evidence) &&
    validSource(request.venuePreference.source) &&
    nullableString(request.venuePreference.evidence) &&
    validSource(request.daysSource) &&
    validSource(request.paceSource) &&
    nullableString(request.dateText) &&
    nonNegativeInt(request.pricingParty.adultFullFareCount) &&
    nonNegativeInt(request.pricingParty.concessionEligibleCount) &&
    (request.pricingParty.totalTravelers === null ||
      (Number.isInteger(request.pricingParty.totalTravelers) &&
        request.pricingParty.totalTravelers >= 1 &&
        request.pricingParty.totalTravelers <= 20)) &&
    ['complete', 'partial', 'unknown', 'conflict'].includes(
      request.pricingParty.ticketBreakdownStatus,
    ) &&
    (request.pricingParty.totalTravelers !== null ||
      request.pricingParty.adultFullFareCount +
        request.pricingParty.concessionEligibleCount +
        request.pricingParty.childAges.length >
        0) &&
    (request.totalBudgetCents === null ||
      (Number.isInteger(request.totalBudgetCents) &&
        request.totalBudgetCents >= 0))
  );
}

function isParser(value: unknown): value is ParserDiagnostics {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'attemptedMode',
      'acceptedMode',
      'fallbackReasonCode',
      'draftSchemaVersion',
      'normalizedRequestVersion',
      'semanticPolicyVersion',
      'promptVersion',
    ])
  )
    return false;
  if (
    !['llm', 'rules'].includes(value.attemptedMode as string) ||
    !['llm', 'rules', 'none'].includes(value.acceptedMode as string) ||
    value.normalizedRequestVersion !== 'parsed-trip-request-v2' ||
    value.semanticPolicyVersion !== 'trip-semantic-v1' ||
    !(
      value.draftSchemaVersion === null ||
      value.draftSchemaVersion === 'trip-request-draft-v2'
    ) ||
    !(
      value.promptVersion === null || typeof value.promptVersion === 'string'
    ) ||
    !(
      value.fallbackReasonCode === null ||
      DIAGNOSTIC_FALLBACKS.has(value.fallbackReasonCode as string)
    )
  )
    return false;
  return (
    value.acceptedMode !== 'llm' ||
    (value.attemptedMode === 'llm' &&
      value.fallbackReasonCode === null &&
      value.draftSchemaVersion === 'trip-request-draft-v2')
  );
}

function isEvidence(value: unknown, rawText: string): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (
        !isRecord(item) ||
        !hasExactKeys(item, ['path', 'quote', 'occurrence', 'itemIndex']) ||
        !nonEmptyString(item.path) ||
        !SAFE_EVIDENCE_PATHS.includes(item.path as never) ||
        !nonEmptyString(item.quote) ||
        !positiveInt(item.occurrence) ||
        !(
          item.itemIndex === null ||
          (Number.isInteger(item.itemIndex) &&
            typeof item.itemIndex === 'number' &&
            item.itemIndex >= 0 &&
            item.itemIndex < 20)
        )
      )
        return false;
      let start = -1;
      for (let index = 0; index < item.occurrence; index += 1) {
        start = rawText.indexOf(item.quote, start + 1);
        if (start < 0) return false;
      }
      return true;
    })
  );
}

function isWarnings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, ['code', 'message']) &&
        nonEmptyString(item.code) &&
        nonEmptyString(item.message),
    )
  );
}

function isDaysQuestion(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'field', 'prompt', 'options']) &&
    value.id === 'days' &&
    value.field === 'days' &&
    nonEmptyString(value.prompt) &&
    Array.isArray(value.options) &&
    value.options.length === 3 &&
    value.options.every(
      (item, index) =>
        isRecord(item) &&
        hasExactKeys(item, ['value', 'label']) &&
        item.value === String(index + 1) &&
        nonEmptyString(item.label),
    )
  );
}

function matchesShape(value: unknown, template: unknown): boolean {
  if (template === null)
    return (
      value === null || typeof value === 'string' || typeof value === 'number'
    );
  if (Array.isArray(template))
    return (
      Array.isArray(value) &&
      value.every(
        (item) =>
          item !== null &&
          (typeof item === 'object' ||
            typeof item === 'string' ||
            typeof item === 'number' ||
            typeof item === 'boolean'),
      )
    );
  if (typeof template === 'object')
    return (
      isRecord(value) &&
      isRecord(template) &&
      hasExactKeys(value, Object.keys(template)) &&
      Object.keys(template).every((key) =>
        matchesShape(value[key], template[key]),
      )
    );
  return typeof value === typeof template;
}

function validDays(value: number | null): boolean {
  return value === null || [1, 2, 3].includes(value);
}
function validMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 1_440;
}
function validIds(ids: string[]): boolean {
  const allowed = new Set(POI_DATASET.pois.map((poi) => poi.id));
  return new Set(ids).size === ids.length && ids.every((id) => allowed.has(id));
}
function validSource(value: unknown): boolean {
  return ['structured', 'text', 'legacy_v1', 'default'].includes(
    value as string,
  );
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function nonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function originMatchesKnown(
  request: Omit<ParsedTripRequest, 'rawText'>,
): boolean {
  const origin = request.origin;
  const poi = POI_DATASET.pois.find((item) => item.id === origin.refId);
  if (origin.kind === 'poi')
    return Boolean(
      poi &&
      origin.resolution === 'exact_poi' &&
      origin.label === `${poi.nameZh}（地点起点）` &&
      origin.latitude === poi.latitude &&
      origin.longitude === poi.longitude,
    );
  const proxies = [
    parseTripRequest('').origin,
    ...['CBD', 'Southbank', 'Docklands', 'Carlton', 'East Melbourne'].map(
      (text) => resolveOriginCandidate(text).value,
    ),
  ];
  return proxies.some(
    (known) =>
      origin.kind === known.kind &&
      origin.refId === known.refId &&
      origin.label === known.label &&
      origin.latitude === known.latitude &&
      origin.longitude === known.longitude &&
      origin.resolution === known.resolution,
  );
}

async function readJsonResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!nonNegativeInt(Number(declared)) || Number(declared) > MAX_RESPONSE_BYTES)
  )
    return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) return null;
      const { done, value } = await reader.read();
      if (signal.aborted) return null;
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel('response_too_large');
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
