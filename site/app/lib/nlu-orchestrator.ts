import {
  DEFAULT_RULES_DIAGNOSTICS,
  type InterpretationOutcome,
  type NluDraftAdapter,
  type ParserDiagnostics,
  type ParserFallbackReasonCode,
} from './nlu-contract';
import { POI_DATASET, parseTripRequest, type ParsedTripRequest } from './planner';
import {
  normalizeDraftToParsedTripRequest,
  bindEvidenceV1,
  validateDraftEvidence,
  validateDraftSchema,
  validateDraftSemantics,
  validatedEvidence,
  type DraftSchemaValidationResult,
  type DraftValidationResult,
  type EvidenceBindingReport,
  type TripRequestDraftV2,
} from './trip-request-draft-v2-runtime';
import type {
  LocalDiagnosticEvent,
  LocalDiagnosticEventV2,
  LocalNluDiagnosticsSink,
} from './local-nlu-diagnostics';
import { elideUnprovenOptionalAssertions } from './optional-assertion-elision';

const bindingFor = (
  report: EvidenceBindingReport,
): LocalDiagnosticEvent['binding'] => ({
  policy: report.policy,
  status: report.status,
  reason: report.reason,
  addedPath:
    report.addedPath === '/geography/strength' ? report.addedPath : null,
  addedCount: report.addedCount === 1 ? 1 : 0,
});

const NOT_RUN_BINDING: LocalDiagnosticEvent['binding'] = {
  policy: 'evidence-binding-v1',
  status: 'not_run',
  reason: 'schema_not_passed',
  addedPath: null,
  addedCount: 0,
};

interface ValidationDependencies {
  validateSchema(value: unknown): DraftSchemaValidationResult;
  bindEvidence(
    draft: TripRequestDraftV2,
    rawText: string,
  ): { draft: TripRequestDraftV2; report: EvidenceBindingReport };
  validateEvidence(
    draft: TripRequestDraftV2,
    rawText: string,
  ): DraftValidationResult;
  validateSemantics(
    draft: TripRequestDraftV2,
    rawText: string,
  ): DraftValidationResult;
  elideOptionalAssertions(
    draft: TripRequestDraftV2,
    rawText: string,
  ): TripRequestDraftV2;
  normalize(
    draft: TripRequestDraftV2,
    rawText: string,
  ): ReturnType<typeof normalizeDraftToParsedTripRequest>;
}

const DEFAULT_VALIDATION_DEPENDENCIES: ValidationDependencies = {
  validateSchema: validateDraftSchema,
  bindEvidence: bindEvidenceV1,
  validateEvidence: validateDraftEvidence,
  validateSemantics: validateDraftSemantics,
  elideOptionalAssertions: elideUnprovenOptionalAssertions,
  normalize: normalizeDraftToParsedTripRequest,
};

const DEFAULT_DEADLINE_MS = 4_000;

export interface InterpretTripRequestOptions {
  rawText: string;
  locale?: 'zh-CN';
  sourceFingerprint: string;
  adapter?: NluDraftAdapter;
  signal?: AbortSignal;
  deadlineMs?: number;
  /** Local experiment only; callers must gate this before enabling it. */
  enableOptionalAssertionElision?: boolean;
  localDiagnostics?: LocalNluDiagnosticsSink;
  /** Test-only fault injection; it does not cross the HTTP Parse API. */
  validationDependencies?: Partial<ValidationDependencies>;
}

export function canCommitInterpretation({
  runId,
  activeRunId,
  aborted,
  outcomeFingerprint,
  currentFingerprint,
}: {
  runId: number;
  activeRunId: number;
  aborted: boolean;
  outcomeFingerprint: string;
  currentFingerprint: string;
}): boolean {
  return (
    runId === activeRunId &&
    !aborted &&
    outcomeFingerprint === currentFingerprint
  );
}

export async function interpretTripRequest({
  rawText,
  locale = 'zh-CN',
  sourceFingerprint,
  adapter,
  signal,
  deadlineMs = DEFAULT_DEADLINE_MS,
  localDiagnostics,
  validationDependencies,
  enableOptionalAssertionElision = false,
}: InterpretTripRequestOptions): Promise<InterpretationOutcome> {
  if (signal?.aborted) return { status: 'aborted', sourceFingerprint };

  if (!adapter || rawText.normalize('NFKC').trim().length === 0) {
    await Promise.resolve();
    if (signal?.aborted) return { status: 'aborted', sourceFingerprint };
    return {
      status: 'complete',
      sourceFingerprint,
      request: parseTripRequest(rawText),
      diagnostics: { ...DEFAULT_RULES_DIAGNOSTICS },
      fieldEvidence: [],
    };
  }

  const provider = await callAdapterWithDeadline(
    adapter,
    {
      text: rawText.normalize('NFKC').trim().slice(0, 2_000),
      locale,
      datasetVersion: POI_DATASET.dataVersion,
    },
    deadlineMs,
    signal,
  );
  if (provider.status === 'aborted')
    return { status: 'aborted', sourceFingerprint };
  if (provider.status === 'fallback')
    return rulesFallback(
      rawText,
      sourceFingerprint,
      provider.reason,
      provider.promptVersion,
    );

  if (provider.value.datasetVersion !== POI_DATASET.dataVersion)
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'version_mismatch',
      provider.value.promptVersion,
    );
  const validators: ValidationDependencies = {
    ...DEFAULT_VALIDATION_DEPENDENCIES,
    ...validationDependencies,
  };
  let schema: DraftSchemaValidationResult;
  try {
    schema = validators.validateSchema(provider.value.draft);
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: NOT_RUN_BINDING,
      firstFailure: {
        stage: 'schema',
        reason: 'schema.validator_exception',
        path: null,
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'schema_rejected',
      provider.value.promptVersion,
    );
  }
  if (!schema.ok) {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: NOT_RUN_BINDING,
      firstFailure: schema.issue,
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'schema_rejected',
      provider.value.promptVersion,
    );
  }
  let postSchemaDraft = schema.draft;
  if (enableOptionalAssertionElision) {
    try {
      postSchemaDraft = validators.elideOptionalAssertions(
        postSchemaDraft,
        rawText,
      );
    } catch {
      // Local diagnostics v1 cannot truthfully represent a failure before
      // Evidence Binding runs. Do not mislabel this as either a schema or
      // binding failure; fail closed without emitting a misleading event.
      return rulesFallback(
        rawText,
        sourceFingerprint,
        'evidence_rejected',
        provider.value.promptVersion,
      );
    }
  }
  let elidedSchema: DraftSchemaValidationResult = schema;
  if (enableOptionalAssertionElision) {
    try {
      elidedSchema = validators.validateSchema(postSchemaDraft);
    } catch {
      emitDiagnostic(localDiagnostics, {
        version: 2,
        event: 'nlu_validation',
        outcome: 'fallback',
        binding: NOT_RUN_BINDING,
        firstFailure: {
          stage: 'schema',
          reason: 'schema.validator_exception',
          path: null,
        },
      });
      return rulesFallback(
        rawText,
        sourceFingerprint,
        'schema_rejected',
        provider.value.promptVersion,
      );
    }
  }
  if (!elidedSchema.ok) {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: NOT_RUN_BINDING,
      firstFailure: elidedSchema.issue,
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'schema_rejected',
      provider.value.promptVersion,
    );
  }
  let bound: ReturnType<ValidationDependencies['bindEvidence']>;
  try {
    bound = validators.bindEvidence(elidedSchema.draft, rawText);
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: {
        policy: 'evidence-binding-v1',
        status: 'internal_error',
        reason: 'binding_exception',
        addedPath: null,
        addedCount: 0,
      },
      firstFailure: {
        stage: 'evidence',
        reason: 'evidence.binding_exception',
        path: '/evidence',
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  if (bound.report.status === 'internal_error') {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        stage: 'evidence',
        reason: 'evidence.binding_exception',
        path: '/evidence',
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  let boundSchema: DraftSchemaValidationResult;
  try {
    boundSchema = validators.validateSchema(bound.draft);
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        stage: 'schema',
        reason: 'schema.validator_exception',
        path: null,
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  if (!boundSchema.ok) {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        ...boundSchema.issue,
        reason: 'schema.post_binding_invalid',
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  let evidence: DraftValidationResult;
  try {
    evidence = validators.validateEvidence(boundSchema.draft, rawText);
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        stage: 'evidence',
        reason: 'evidence.validator_exception',
        path: '/evidence',
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  if (!evidence.ok) {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: evidence.issue,
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'evidence_rejected',
      provider.value.promptVersion,
    );
  }
  let semantics: DraftValidationResult;
  try {
    semantics = validators.validateSemantics(boundSchema.draft, rawText);
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        stage: 'semantic',
        reason: 'semantic.validator_exception',
        path: null,
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'semantic_rejected',
      provider.value.promptVersion,
    );
  }
  if (!semantics.ok) {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: semantics.issue,
      mustIncludeCause: semantics.mustIncludeCause
        ? { code: semantics.mustIncludeCause }
        : null,
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'semantic_rejected',
      provider.value.promptVersion,
    );
  }
  if (signal?.aborted) return { status: 'aborted', sourceFingerprint };

  try {
    const request = validators.normalize(boundSchema.draft, rawText);
    if (onlyFillerMakesItWorse(request, boundSchema.draft.unresolvedPhrases, rawText))
      return rulesFallback(
        rawText,
        sourceFingerprint,
        'worse_than_rules',
        provider.value.promptVersion,
      );
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'accepted',
      binding: bindingFor(bound.report),
      firstFailure: null,
    });
    return {
      status: 'complete',
      sourceFingerprint,
      request,
      diagnostics: {
        attemptedMode: 'llm',
        acceptedMode: 'llm',
        fallbackReasonCode: null,
        draftSchemaVersion: 'trip-request-draft-v2',
        normalizedRequestVersion: 'parsed-trip-request-v2',
        semanticPolicyVersion: 'trip-semantic-v1',
        promptVersion: provider.value.promptVersion,
      },
      fieldEvidence: validatedEvidence(boundSchema.draft),
    };
  } catch {
    emitDiagnostic(localDiagnostics, {
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: bindingFor(bound.report),
      firstFailure: {
        stage: 'normalization',
        reason: 'normalization.exception',
        path: null,
      },
    });
    return rulesFallback(
      rawText,
      sourceFingerprint,
      'semantic_rejected',
      provider.value.promptVersion,
    );
  }
}

function emitDiagnostic(
  sink: LocalNluDiagnosticsSink | undefined,
  event: Omit<LocalDiagnosticEventV2, 'mustIncludeCause'> & {
    mustIncludeCause?: LocalDiagnosticEventV2['mustIncludeCause'];
  },
): void {
  if (!sink) return;
  try {
    const result = sink.emit({
      ...event,
      mustIncludeCause: event.mustIncludeCause ?? null,
    });
    if (result) void result.catch(() => undefined);
  } catch {}
}

/**
 * 模型结果不能比规则更差：规则本来可以直接规划，而模型结果多出的阻断只来自
 * “无法确定的描述”，且这些描述都不含时间、地点、约束、人数等实质内容（如“先生成”）
 * 时，整次回退规则。含实质内容的描述（如“晚一点出门”）仍然阻断，以免被默认值悄悄替代。
 */
function onlyFillerMakesItWorse(
  request: ParsedTripRequest,
  unresolvedPhrases: string[],
  rawText: string,
): boolean {
  const rules = parseTripRequest(rawText);
  if (rules.errors.length > 0 || rules.needsClarification.length > 0) return false;
  const extra = request.errors.filter((item) => !rules.errors.includes(item));
  if (extra.length === 0) return false;
  const onlyUnresolved = extra.every((item) => item.startsWith('还需要确认这些描述：'));
  return onlyUnresolved && unresolvedPhrases.every((phrase) => !isSubstantivePhrase(phrase));
}

const SUBSTANTIVE_PHRASE =
  /(\d|[一二两三四五六七八九十]|点|时|早|晚|午|出门|出发|开始|结束|回|必|一定|不|别|避|只|预算|钱|价|费|人|岁|孩|娃|老|长辈|天|日|周|月|住|酒店|景点|地方|去|看|玩|吃|买|走|车|区|城|市)/u;

function isSubstantivePhrase(phrase: string): boolean {
  return SUBSTANTIVE_PHRASE.test(phrase.normalize('NFKC'));
}

function rulesFallback(
  rawText: string,
  sourceFingerprint: string,
  reason: ParserFallbackReasonCode,
  promptVersion: string | null,
): InterpretationOutcome {
  const diagnostics: ParserDiagnostics = {
    attemptedMode: 'llm',
    acceptedMode: 'rules',
    fallbackReasonCode: reason,
    draftSchemaVersion: null,
    normalizedRequestVersion: 'parsed-trip-request-v2',
    semanticPolicyVersion: 'trip-semantic-v1',
    promptVersion,
  };
  return {
    status: 'complete',
    sourceFingerprint,
    request: parseTripRequest(rawText),
    diagnostics,
    fieldEvidence: [],
  };
}

type AdapterCallResult =
  | {
      status: 'success';
      value: Extract<
        Awaited<ReturnType<NluDraftAdapter['extractDraft']>>,
        { ok: true }
      >;
    }
  | {
      status: 'fallback';
      reason: ParserFallbackReasonCode;
      promptVersion: string | null;
    }
  | { status: 'aborted' };

async function callAdapterWithDeadline(
  adapter: NluDraftAdapter,
  input: Parameters<NluDraftAdapter['extractDraft']>[0],
  deadlineMs: number,
  externalSignal?: AbortSignal,
): Promise<AdapterCallResult> {
  const controller = new AbortController();
  let resolveExternalAbort: (() => void) | undefined;
  const externalAbort = new Promise<'external-abort'>((resolve) => {
    resolveExternalAbort = () => resolve('external-abort');
  });
  const abortFromOutside = () => {
    controller.abort(externalSignal?.reason);
    resolveExternalAbort?.();
  };
  externalSignal?.addEventListener('abort', abortFromOutside, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(
        () => {
          controller.abort('deadline');
          resolve('deadline');
        },
        Math.max(1, deadlineMs),
      );
    });
    const called = Promise.resolve()
      .then(() =>
        adapter.extractDraft(input, {
          signal: controller.signal,
          deadlineMs,
        }),
      )
      .then((value) => ({ kind: 'result' as const, value }))
      .catch(() => ({ kind: 'error' as const }));
    const settled = await Promise.race([called, timeout, externalAbort]);
    if (externalSignal?.aborted) return { status: 'aborted' };
    if (settled === 'external-abort') return { status: 'aborted' };
    if (settled === 'deadline')
      return {
        status: 'fallback',
        reason: 'deadline_exceeded',
        promptVersion: null,
      };
    if (settled.kind === 'error')
      return {
        status: 'fallback',
        reason: 'provider_unavailable',
        promptVersion: null,
      };
    if (!settled.value.ok)
      return {
        status: 'fallback',
        reason: settled.value.code,
        promptVersion: null,
      };
    return { status: 'success', value: settled.value };
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromOutside);
  }
}
