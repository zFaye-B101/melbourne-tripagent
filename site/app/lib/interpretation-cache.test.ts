import { describe, expect, it } from 'vitest';

import type {
  InterpretationOutcome,
  ParserDiagnostics,
} from './nlu-contract';
import { createInterpretationCache, isReusableOutcome } from './interpretation-cache';
import { parseTripRequest } from './planner';

const request = parseTripRequest('墨尔本3天，喜欢户外和历史，别太赶');

function complete(
  diagnostics: Partial<ParserDiagnostics> = {},
): InterpretationOutcome {
  return {
    status: 'complete',
    sourceFingerprint: 'fingerprint-1',
    request,
    diagnostics: {
      attemptedMode: 'llm',
      acceptedMode: 'llm',
      fallbackReasonCode: null,
      draftSchemaVersion: 'trip-request-draft-v2',
      normalizedRequestVersion: 'parsed-trip-request-v2',
      semanticPolicyVersion: 'trip-semantic-v1',
      promptVersion: 'nlu-extraction-system-v2.7',
      ...diagnostics,
    },
    fieldEvidence: [],
  };
}

describe('what is worth reusing', () => {
  it('keeps an accepted model answer', () => {
    expect(isReusableOutcome(complete())).toBe(true);
  });

  it('keeps a content-level rejection, which would repeat byte for byte', () => {
    for (const reason of [
      'schema_rejected',
      'evidence_rejected',
      'semantic_rejected',
      'version_mismatch',
    ] as const) {
      expect(
        isReusableOutcome(
          complete({ acceptedMode: 'rules', fallbackReasonCode: reason }),
        ),
      ).toBe(true);
    }
  });

  it('never pins a visitor to a transport failure', () => {
    for (const reason of [
      'deadline_exceeded',
      'rate_limited',
      'provider_unavailable',
      'auth_or_config',
      'invalid_json',
      'circuit_open',
    ] as const) {
      expect(
        isReusableOutcome(
          complete({ acceptedMode: 'rules', fallbackReasonCode: reason }),
        ),
      ).toBe(false);
    }
  });

  it('skips rules-only runs, which cost nothing to repeat', () => {
    expect(
      isReusableOutcome(complete({ attemptedMode: 'rules', acceptedMode: 'rules' })),
    ).toBe(false);
  });

  it('skips outcomes that never produced a request', () => {
    expect(
      isReusableOutcome({ status: 'aborted', sourceFingerprint: 'fingerprint-1' }),
    ).toBe(false);
    expect(
      isReusableOutcome({
        status: 'failed',
        sourceFingerprint: 'fingerprint-1',
        diagnostics: {
          attemptedMode: 'llm',
          acceptedMode: 'none',
          fallbackReasonCode: 'provider_unavailable',
          draftSchemaVersion: null,
          normalizedRequestVersion: 'parsed-trip-request-v2',
          semanticPolicyVersion: 'trip-semantic-v1',
          promptVersion: null,
        },
        message: 'failed',
      }),
    ).toBe(false);
  });
});

describe('cache behaviour', () => {
  it('reports a miss for an unknown fingerprint', () => {
    expect(createInterpretationCache().get('nope')).toBeNull();
  });

  it('stores and returns an accepted answer', () => {
    const cache = createInterpretationCache();
    expect(cache.set('f1', complete())).toBe(true);
    expect(cache.size()).toBe(1);
    const hit = cache.get('f1');
    expect(hit?.request.days).toBe(request.days);
    expect(hit?.diagnostics.acceptedMode).toBe('llm');
  });

  it('hands out a copy so a later click cannot read a mutated answer', () => {
    const cache = createInterpretationCache();
    cache.set('f1', complete());
    const first = cache.get('f1');
    expect(first).not.toBeNull();
    if (first) first.request.rawText = 'mutated';
    expect(cache.get('f1')?.request.rawText).toBe(request.rawText);
  });

  it('refuses to store anything it would not reuse', () => {
    const cache = createInterpretationCache();
    expect(
      cache.set('f1', complete({ acceptedMode: 'rules', fallbackReasonCode: 'deadline_exceeded' })),
    ).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it('evicts the least recently used entry, not the oldest written', () => {
    const cache = createInterpretationCache(2);
    cache.set('a', complete());
    cache.set('b', complete());
    expect(cache.get('a')).not.toBeNull();
    cache.set('c', complete());
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.size()).toBe(2);
  });

  it('overwrites an existing fingerprint instead of duplicating it', () => {
    const cache = createInterpretationCache();
    cache.set('f1', complete());
    cache.set('f1', complete({ promptVersion: 'nlu-extraction-system-v2.8' }));
    expect(cache.size()).toBe(1);
    expect(cache.get('f1')?.diagnostics.promptVersion).toBe(
      'nlu-extraction-system-v2.8',
    );
  });
});
