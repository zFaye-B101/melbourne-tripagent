import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

import diagnosticSchema from '../../../data/local-nlu-diagnostic-v1.schema.json';
import diagnosticSchemaV2 from '../../../data/local-nlu-diagnostic-v2.schema.json';
import {
  BINDING_REASONS,
  BINDING_STATUSES,
  createLocalNluDiagnosticsSink,
  SAFE_EVIDENCE_PATHS,
  SAFE_VALIDATION_REASONS,
  sanitizeLocalDiagnostic,
} from './local-nlu-diagnostics';

const accepted = {
  version: 1,
  event: 'nlu_validation',
  outcome: 'accepted',
  binding: {
    policy: 'evidence-binding-v1',
    status: 'applied',
    reason: 'scope_coordinate_reused',
    addedPath: '/geography/strength',
    addedCount: 1,
  },
  firstFailure: null,
} as const;

describe('local NLU diagnostics', () => {
  it('accepts only the frozen applied binding shape', () =>
    expect(sanitizeLocalDiagnostic(accepted)).toEqual(accepted));

  it.each([
    { ...accepted, binding: { ...accepted.binding, addedCount: 0 } },
    { ...accepted, binding: { ...accepted.binding, reason: 'proof_failed' } },
    {
      ...accepted,
      firstFailure: {
        stage: 'evidence',
        reason: 'evidence.quote_not_in_source',
        path: '/not-allowlisted',
      },
    },
    {
      ...accepted,
      firstFailure: {
        stage: 'semantic',
        reason: 'evidence.quote_not_in_source',
        path: null,
      },
    },
    { ...accepted, outcome: 'fallback' },
    {
      ...accepted,
      binding: {
        ...accepted.binding,
        status: 'not_run',
        reason: 'proof_failed',
        addedPath: null,
        addedCount: 0,
      },
    },
    {
      ...accepted,
      binding: {
        ...accepted.binding,
        status: 'internal_error',
        reason: 'post_validation_failed',
        addedPath: null,
        addedCount: 0,
      },
    },
  ])('drops malformed or contradictory data', (value) =>
    expect(sanitizeLocalDiagnostic(value)).toBeNull(),
  );

  it('rebuilds the event and never passes through extra keys', () => {
    const malicious = {
      ...accepted,
      secret: 'top-level-secret',
      binding: { ...accepted.binding, secret: 'binding-secret' },
    };
    const sanitized = sanitizeLocalDiagnostic(malicious);
    expect(sanitized).toEqual(accepted);
    expect(JSON.stringify(sanitized)).not.toContain('secret');
  });

  it('keeps v1 frozen and requires null cause for v2 accepted events', () => {
    expect(sanitizeLocalDiagnostic(accepted)).toEqual(accepted);
    expect(
      sanitizeLocalDiagnostic({
        ...accepted,
        version: 2,
        mustIncludeCause: null,
      }),
    ).toMatchObject({ version: 2, mustIncludeCause: null });
    expect(sanitizeLocalDiagnostic({ ...accepted, version: 2 })).toBeNull();
    expect(
      sanitizeLocalDiagnostic({ ...accepted, mustIncludeCause: null }),
    ).toEqual(accepted);
  });

  it.each([
    'opposite_only',
    'intent_marker_absent',
    'opposite_nearer_or_tied',
    'unclassified',
  ] as const)(
    'accepts only the four v2 cause codes on must-include semantic failures',
    (code) => {
      const value = {
        ...accepted,
        version: 2,
        outcome: 'fallback',
        firstFailure: {
          stage: 'semantic',
          reason: 'semantic.evidence_not_proven',
          path: '/mustIncludeNames',
        },
        mustIncludeCause: { code },
      };
      expect(sanitizeLocalDiagnostic(value)).toMatchObject(value);
    },
  );

  it.each([
    {
      stage: 'evidence',
      reason: 'evidence.quote_not_in_source',
      path: '/evidence',
    },
    { stage: 'semantic', reason: 'semantic.rule_mismatch', path: '/days' },
    { stage: 'normalization', reason: 'normalization.exception', path: null },
  ] as const)(
    'requires null cause outside must-include semantic failure (%s)',
    (firstFailure) => {
      const base = {
        ...accepted,
        version: 2,
        outcome: 'fallback',
        firstFailure,
        mustIncludeCause: null,
      };
      expect(sanitizeLocalDiagnostic(base)).toMatchObject(base);
      expect(
        sanitizeLocalDiagnostic({
          ...base,
          mustIncludeCause: { code: 'unclassified' },
        }),
      ).toBeNull();
    },
  );

  it('fails closed for malformed causes and strips extra sensitive fields', () => {
    const base = {
      ...accepted,
      version: 2,
      outcome: 'fallback',
      firstFailure: {
        stage: 'semantic',
        reason: 'semantic.evidence_not_proven',
        path: '/mustIncludeNames',
      },
      mustIncludeCause: { code: 'unclassified', rawQuote: 'secret' },
      rawText: 'private user request',
    };
    expect(sanitizeLocalDiagnostic(base)).toEqual({
      version: 2,
      event: 'nlu_validation',
      outcome: 'fallback',
      binding: accepted.binding,
      firstFailure: base.firstFailure,
      mustIncludeCause: { code: 'unclassified' },
    });
    expect(
      sanitizeLocalDiagnostic({ ...base, mustIncludeCause: {} }),
    ).toBeNull();
    expect(
      sanitizeLocalDiagnostic({
        ...base,
        mustIncludeCause: { code: 'secret' },
      }),
    ).toBeNull();
  });

  it('keeps implementation allowlists equal to the checked-in schema enums', () => {
    const failure = diagnosticSchema.properties.firstFailure.oneOf[1];
    expect(failure.properties?.reason.enum).toEqual(
      Object.values(SAFE_VALIDATION_REASONS).flat(),
    );
    expect(failure.properties?.path.enum).toEqual([
      null,
      '/schemaVersion',
      '/evidence',
      ...SAFE_EVIDENCE_PATHS,
    ]);
    expect(diagnosticSchema.properties.binding.properties.status.enum).toEqual(
      BINDING_STATUSES,
    );
    expect(diagnosticSchema.properties.binding.properties.reason.enum).toEqual(
      BINDING_REASONS,
    );
  });

  it('validates v2 conditional cause contract with AJV', () => {
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(diagnosticSchema);
    const validate = ajv.compile(diagnosticSchemaV2);
    const mustFailure = {
      ...accepted,
      version: 2,
      outcome: 'fallback',
      firstFailure: {
        stage: 'semantic',
        reason: 'semantic.evidence_not_proven',
        path: '/mustIncludeNames',
      },
      mustIncludeCause: { code: 'opposite_only' },
    };
    const nonMustFailure = {
      ...accepted,
      version: 2,
      outcome: 'fallback',
      firstFailure: {
        stage: 'evidence',
        reason: 'evidence.quote_not_in_source',
        path: '/evidence',
      },
      mustIncludeCause: null,
    };
    const acceptedV2 = { ...accepted, version: 2, mustIncludeCause: null };
    expect(validate(mustFailure)).toBe(true);
    expect(validate(nonMustFailure)).toBe(true);
    expect(validate(acceptedV2)).toBe(true);
    expect(validate({ ...mustFailure, mustIncludeCause: null })).toBe(false);
    expect(
      validate({
        ...nonMustFailure,
        mustIncludeCause: { code: 'unclassified' },
      }),
    ).toBe(false);
    expect(
      validate({ ...acceptedV2, mustIncludeCause: { code: 'unclassified' } }),
    ).toBe(false);
    expect(
      diagnosticSchemaV2.properties.mustIncludeCause.oneOf[1]!.properties!.code!
        .enum,
    ).toEqual([
      'unclassified',
      'opposite_only',
      'intent_marker_absent',
      'opposite_nearer_or_tied',
    ]);
  });

  it.each([
    'http://localhost/v1/trip-requests/parse',
    'http://127.0.0.1/v1/trip-requests/parse',
    'http://[::1]/v1/trip-requests/parse',
  ])('emits exactly one line for a permitted loopback request', (url) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = createLocalNluDiagnosticsSink(
      { LLM_LOCAL_DIAGNOSTICS: 'true', LLM_RUNTIME_ENV: 'local' },
      new Request(url),
    );
    void sink?.emit(accepted);
    void sink?.emit(accepted);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(
      `TRIPAGENT_NLU_LOCAL_DIAG_V1 ${JSON.stringify(accepted)}`,
    );
    spy.mockRestore();
  });

  it('emits exactly one v2-prefixed line with sanitized cause', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = createLocalNluDiagnosticsSink(
      { LLM_LOCAL_DIAGNOSTICS: 'true', LLM_RUNTIME_ENV: 'local' },
      new Request('http://localhost/x'),
    );
    void sink?.emit({
      ...accepted,
      version: 2,
      outcome: 'fallback',
      firstFailure: {
        stage: 'semantic',
        reason: 'semantic.evidence_not_proven',
        path: '/mustIncludeNames',
      },
      mustIncludeCause: { code: 'opposite_only', secret: 'drop' } as never,
      secret: 'drop',
    } as never);
    void sink?.emit(accepted);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(
      `TRIPAGENT_NLU_LOCAL_DIAG_V2 ${JSON.stringify({
        version: 2,
        event: 'nlu_validation',
        outcome: 'fallback',
        binding: accepted.binding,
        firstFailure: {
          stage: 'semantic',
          reason: 'semantic.evidence_not_proven',
          path: '/mustIncludeNames',
        },
        mustIncludeCause: { code: 'opposite_only' },
      })}`,
    );
    spy.mockRestore();
  });

  it.each([
    [
      { LLM_LOCAL_DIAGNOSTICS: 'false', LLM_RUNTIME_ENV: 'local' },
      'http://localhost/x',
    ],
    [
      { LLM_LOCAL_DIAGNOSTICS: 'true', LLM_RUNTIME_ENV: 'production' },
      'http://localhost/x',
    ],
    [
      { LLM_LOCAL_DIAGNOSTICS: 'true', LLM_RUNTIME_ENV: 'local' },
      'https://example.test/x',
    ],
  ] as const)('requires every gate', (env, url) =>
    expect(
      createLocalNluDiagnosticsSink(env, new Request(url)),
    ).toBeUndefined(),
  );

  it('cannot be enabled by request headers or body fields', () => {
    const request = new Request('http://localhost/x', {
      method: 'POST',
      headers: {
        LLM_LOCAL_DIAGNOSTICS: 'true',
        LLM_RUNTIME_ENV: 'local',
      },
      body: JSON.stringify({
        LLM_LOCAL_DIAGNOSTICS: 'true',
        LLM_RUNTIME_ENV: 'local',
      }),
    });
    expect(createLocalNluDiagnosticsSink({}, request)).toBeUndefined();
  });

  it('fails open when the console sink throws and still attempts one line only', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('test-only sink failure');
    });
    const sink = createLocalNluDiagnosticsSink(
      { LLM_LOCAL_DIAGNOSTICS: 'true', LLM_RUNTIME_ENV: 'local' },
      new Request('http://localhost/x'),
    );
    expect(() => sink?.emit(accepted)).not.toThrow();
    expect(() => sink?.emit(accepted)).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
