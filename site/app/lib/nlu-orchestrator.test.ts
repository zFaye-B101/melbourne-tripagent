import exampleDraft from '../../../data/examples/trip-request-v2.example.json';
import { describe, expect, it } from 'vitest';

import type { NluDraftAdapter } from './nlu-contract';
import {
  canCommitInterpretation,
  interpretTripRequest,
} from './nlu-orchestrator';
import { POI_DATASET, parseTripRequest } from './planner';
import {
  normalizeDraftToParsedTripRequest,
  bindEvidenceV1,
  validateDraftEvidence,
  validateFieldEvidenceSemantics,
  validateDraftSchema,
  validateDraftSemantics,
  type TripRequestDraftV2,
} from './trip-request-draft-v2-runtime';
import type {
  LocalDiagnosticEvent,
  SafeValidationIssue,
} from './local-nlu-diagnostics';
import { elideUnprovenOptionalFamilyAssertion } from './optional-assertion-elision';

const RAW =
  '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';

function draft(): TripRequestDraftV2 {
  return structuredClone(exampleDraft) as TripRequestDraftV2;
}

function adapterFor(
  result:
    | Awaited<ReturnType<NluDraftAdapter['extractDraft']>>
    | (() => Promise<Awaited<ReturnType<NluDraftAdapter['extractDraft']>>>),
): NluDraftAdapter {
  return {
    extractDraft: () =>
      typeof result === 'function' ? result() : Promise.resolve(result),
  };
}

function expectIssue(
  result: ReturnType<typeof validateDraftEvidence>,
  issue: SafeValidationIssue,
): void {
  expect(result).toMatchObject({ ok: false, issue });
}

describe('TripRequestDraft v2 runtime gate', () => {
  it('retains generic companion count without inventing adult tickets when draft party is empty', () => {
    const value = draft();
    value.party.adultFullFareCount = null;
    value.party.concessionEligibleCount = null;
    value.party.childAges = [];
    const request = normalizeDraftToParsedTripRequest(
      value,
      '墨尔本玩 2 天，两个人',
    );
    expect(request.pricingParty).toMatchObject({
      totalTravelers: 2,
      adultFullFareCount: 0,
      ticketBreakdownStatus: 'unknown',
    });
  });

  it('optionally elides an ungrounded false family assertion before evidence validation', async () => {
    const value = draft();
    value.family = false;
    const before = structuredClone(value);
    let calls = 0;
    let providerCalls = 0;
    const result = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'elision-enabled',
      enableOptionalAssertionElision: true,
      adapter: {
        extractDraft: async () => {
          providerCalls += 1;
          return {
            ok: true,
            draft: value,
            promptVersion: 'test',
            datasetVersion: POI_DATASET.dataVersion,
          };
        },
      },
      validationDependencies: {
        validateSchema: (input) => validateDraftSchema(input),
        elideOptionalAssertions: (input, rawText) => {
          calls += 1;
          return elideUnprovenOptionalFamilyAssertion(input, rawText);
        },
      },
    });
    if (result.status !== 'complete')
      throw new Error('unexpected aborted result');
    expect(result.status).toBe('complete');
    expect(result.diagnostics.acceptedMode).toBe('llm');
    expect(calls).toBe(1);
    expect(providerCalls).toBe(1);
    expect(value).toEqual(before);
  });

  it('keeps the default disabled path evidence-rejected for the same ungrounded assertion', async () => {
    const value = draft();
    value.family = false;
    const result = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'elision-disabled',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    if (result.status !== 'complete')
      throw new Error('unexpected aborted result');
    expect(result.diagnostics.acceptedMode).toBe('rules');
    expect(result.diagnostics.fallbackReasonCode).toBe('evidence_rejected');
  });

  it('keeps a named POI constraint but elides a category preference inferred only from it', async () => {
    const rawText = RAW.replace('、博物馆和美术馆', '');
    const value = draft();
    const inferredFacetEvidence = value.evidence.find(
      (item) => item.path === '/experiencePreferences/museum_exhibition',
    );
    if (!inferredFacetEvidence)
      throw new Error('missing fixture museum evidence');
    inferredFacetEvidence.quote = '一定去 NGV';

    const disabled = await interpretTripRequest({
      rawText,
      sourceFingerprint: 'poi-inference-disabled',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(disabled).toMatchObject({
      status: 'complete',
      diagnostics: {
        acceptedMode: 'rules',
        fallbackReasonCode: 'semantic_rejected',
      },
    });

    const enabled = await interpretTripRequest({
      rawText,
      sourceFingerprint: 'poi-inference-enabled',
      enableOptionalAssertionElision: true,
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(enabled).toMatchObject({
      status: 'complete',
      diagnostics: { acceptedMode: 'llm' },
      request: {
        mustIncludePoiIds: ['mel-arts-ngv-international'],
        experiencePreferences: { museum_exhibition: 'neutral' },
      },
    });
  });

  it.each(['行程别太赶', '别排太满', '想悠闲地逛'])(
    'accepts grounded relaxed-pace paraphrase %s',
    (phrase) => {
      const value = draft();
      const paceEvidence = value.evidence.find((item) => item.path === '/pace');
      if (!paceEvidence) throw new Error('missing fixture pace evidence');
      paceEvidence.quote = phrase;
      const source = RAW.replace('轻松', phrase);
      expect(validateDraftEvidence(value, source)).toEqual({ ok: true });
      expect(validateFieldEvidenceSemantics(value)).toEqual({ ok: true });
      expect(validateDraftSemantics(value, source)).toEqual({ ok: true });
    },
  );

  it.each(['太赶', '别太赶但行程紧凑'])(
    'rejects ungrounded or contradictory relaxed pace %s',
    (phrase) => {
      const value = draft();
      const paceEvidence = value.evidence.find((item) => item.path === '/pace');
      if (!paceEvidence) throw new Error('missing fixture pace evidence');
      paceEvidence.quote = phrase;
      const source = RAW.replace('轻松', phrase);
      expect(validateDraftEvidence(value, source)).toEqual({ ok: true });
      expect(validateFieldEvidenceSemantics(value)).toMatchObject({
        ok: false,
        issue: { reason: 'semantic.evidence_not_proven', path: '/pace' },
      });
    },
  );

  it.each([
    ['forged', [{ path: '/family', quote: 'not in source', occurrence: 1 }]],
    [
      'repeated',
      [
        { path: '/family', quote: '3 天', occurrence: 1 },
        { path: '/family', quote: '3 天', occurrence: 1 },
      ],
    ],
  ] as const)(
    'keeps a %s family coordinate on the evidence-rejected path',
    async (_label, familyEvidence) => {
      const value = draft();
      value.family = false;
      value.evidence.push(...familyEvidence);
      const result = await interpretTripRequest({
        rawText: RAW,
        sourceFingerprint: `elision-family-${_label}`,
        enableOptionalAssertionElision: true,
        adapter: adapterFor({
          ok: true,
          draft: value,
          promptVersion: 'test',
          datasetVersion: POI_DATASET.dataVersion,
        }),
      });
      expect(result).toMatchObject({
        status: 'complete',
        diagnostics: {
          acceptedMode: 'rules',
          fallbackReasonCode: 'evidence_rejected',
        },
      });
    },
  );

  it.each([
    ['outside Melbourne', '悉尼玩 2 天', '只支持 Melbourne'],
    ['four days', '墨尔本玩 4 天', '只支持 1–3 天'],
    ['non-AUD budget', '墨尔本玩 2 天，预算 500 日元', '只支持 AUD'],
    [
      'unknown hard place',
      '墨尔本玩 2 天，必去 Luna Park',
      '还没有：Luna Park',
    ],
  ] as const)(
    'does not loosen %s when optional assertion elision is enabled',
    async (_label, rawText, expectedError) => {
      const value = draft();
      value.family = false;
      const result = await interpretTripRequest({
        rawText,
        sourceFingerprint: `elision-constraint-${_label}`,
        enableOptionalAssertionElision: true,
        adapter: adapterFor({
          ok: true,
          draft: value,
          promptVersion: 'test',
          datasetVersion: POI_DATASET.dataVersion,
        }),
      });
      expect(result).toMatchObject({
        status: 'complete',
        diagnostics: { acceptedMode: 'rules' },
      });
      if (result.status === 'complete')
        expect(result.request.errors.join('')).toContain(expectedError);
    },
  );

  it('binds one missing geography-strength coordinate without mutating input', () => {
    const input = draft();
    input.evidence = input.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = input.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '主要在市内';
    const before = structuredClone(input);
    const result = bindEvidenceV1(input, RAW);
    expect(result.report).toMatchObject({
      policy: 'evidence-binding-v1',
      status: 'applied',
      addedPath: '/geography/strength',
      addedCount: 1,
    });
    expect(
      result.draft.evidence.filter(
        (item) => item.path === '/geography/strength',
      ),
    ).toEqual([
      { path: '/geography/strength', quote: '主要在市内', occurrence: 1 },
    ]);
    expect(input).toEqual(before);
    expect(validateDraftEvidence(result.draft, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(result.draft, RAW)).toEqual({ ok: true });
    expect(bindEvidenceV1(result.draft, RAW).report.status).toBe('not_needed');
  });

  it('fails closed for weak or unrelated coordinates and never searches raw text', () => {
    const cbd = draft();
    cbd.evidence = cbd.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = cbd.evidence.find((item) => item.path === '/geography/scope');
    if (scope) scope.quote = 'CBD';
    expect(bindEvidenceV1(cbd, '墨尔本 3 天，主要在市内').report.status).toBe(
      'skipped',
    );

    const wrongQuote = draft();
    wrongQuote.evidence = wrongQuote.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const wrongScope = wrongQuote.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (wrongScope) wrongScope.quote = '市内';
    expect(bindEvidenceV1(wrongQuote, RAW).report.status).toBe('skipped');
  });

  it('accepts a hard geography proof and rejects hard/soft quote mismatches', () => {
    const hard = draft();
    hard.geography = { scope: 'cbd_core_v1', strength: 'hard' };
    hard.evidence = hard.evidence.filter(
      (item) =>
        !['/geography/strength', '/geography/scope'].includes(item.path),
    );
    hard.evidence.push({
      path: '/geography/scope',
      quote: '只在CBD',
      occurrence: 1,
    });
    expect(
      bindEvidenceV1(hard, RAW.replace('主要在市内', '只在CBD')).report,
    ).toEqual({
      policy: 'evidence-binding-v1',
      status: 'applied',
      addedPath: '/geography/strength',
      addedCount: 1,
      reason: 'scope_coordinate_reused',
    });

    const mismatch = draft();
    mismatch.evidence = mismatch.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = mismatch.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '只在CBD';
    expect(bindEvidenceV1(mismatch, RAW).report.status).toBe('skipped');
  });

  it('does not bind when an unrelated evidence item is also missing', () => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) => !['/geography/strength', '/days'].includes(item.path),
    );
    const scope = value.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '主要在市内';
    expect(bindEvidenceV1(value, RAW).report.status).toBe('skipped');
    expect(bindEvidenceV1(value, RAW).report.reason).toBe('invalid_existing');
  });

  it('does not bind other missing fields or array evidence', () => {
    const date = draft();
    date.evidence = date.evidence.filter(
      (item) => item.path !== '/date/resolution',
    );
    expect(bindEvidenceV1(date, RAW).report.status).toBe('not_needed');
    const array = draft();
    array.evidence = array.evidence.filter(
      (item) => item.path !== '/mustIncludeNames',
    );
    expect(bindEvidenceV1(array, RAW).report.status).toBe('not_needed');
  });

  it.each([
    [
      'duplicate scope',
      (value: TripRequestDraftV2) => {
        value.evidence.push({
          path: '/geography/scope',
          quote: 'CBD',
          occurrence: 1,
        });
      },
    ],
    [
      'wrong occurrence',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/geography/scope',
        );
        if (item) item.occurrence = 2;
      },
    ],
    [
      'source item index',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/geography/scope',
        );
        if (item) item.itemIndex = 0;
      },
    ],
    [
      'missing two fields',
      (value: TripRequestDraftV2) => {
        value.evidence = value.evidence.filter(
          (item) =>
            !['/geography/strength', '/geography/scope'].includes(item.path),
        );
      },
    ],
  ])('fails closed for %s', (_name, mutate) => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    mutate(value);
    expect(bindEvidenceV1(value, RAW).report.status).toBe('skipped');
  });

  it('does not use a correct phrase elsewhere in raw text when the sibling quote is wrong', () => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = value.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '市内';
    expect(bindEvidenceV1(value, `${RAW}，主要在市内`).report.status).toBe(
      'skipped',
    );
  });

  it('leaves a complete fixture unchanged', () => {
    const value = draft();
    const before = structuredClone(value);
    const result = bindEvidenceV1(value, RAW);
    expect(result.report).toMatchObject({
      status: 'not_needed',
      reason: 'missing_count_not_one',
    });
    expect(result.draft).toEqual(before);
  });
  it('accepts the checked-in draft only when schema, evidence and semantics agree', () => {
    const schema = validateDraftSchema(draft());
    expect(schema.ok).toBe(true);
    expect(validateDraftEvidence(draft(), RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(draft(), RAW)).toEqual({ ok: true });
  });

  it('keeps daily start time separate from a missing travel date', () => {
    const fixed = draft();
    expect(fixed.date).toEqual({
      text: null,
      isoDate: null,
      resolution: 'missing',
    });
    expect(fixed.dailyStartText).toBe('每天早上十一点出发');
    expect(fixed.dailyStartMinutes).toBe(660);
    expect(fixed.evidence.some((item) => item.path.startsWith('/date/'))).toBe(
      false,
    );
    expect(validateDraftSchema(fixed).ok).toBe(true);
    expect(validateDraftEvidence(fixed, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(fixed, RAW)).toEqual({ ok: true });
  });

  it('rejects missing, orphaned and incorrectly addressed evidence', () => {
    const missing = draft();
    missing.evidence = missing.evidence.filter((item) => item.path !== '/days');
    expect(validateDraftEvidence(missing, RAW)).toMatchObject({ ok: false });

    const orphaned = draft();
    orphaned.family = null;
    orphaned.evidence.push({
      path: '/family',
      quote: '2 位成人',
      occurrence: 1,
    });
    expect(validateDraftEvidence(orphaned, RAW)).toMatchObject({ ok: false });

    const wrongOccurrence = draft();
    wrongOccurrence.evidence[0].occurrence = 2;
    expect(validateDraftEvidence(wrongOccurrence, RAW)).toMatchObject({
      ok: false,
    });

    const wrongArrayIndex = draft();
    const must = wrongArrayIndex.evidence.find(
      (item) => item.path === '/mustIncludeNames',
    );
    if (must) must.itemIndex = 1;
    expect(validateDraftEvidence(wrongArrayIndex, RAW)).toMatchObject({
      ok: false,
    });
  });

  it('requires evidence for explicit false and zero values', () => {
    const explicit = draft();
    explicit.lowWalking = false;
    explicit.evidence = explicit.evidence.filter(
      (item) => item.path !== '/lowWalking',
    );
    expect(validateDraftEvidence(explicit, RAW)).toMatchObject({ ok: false });

    explicit.evidence = explicit.evidence.filter(
      (item) => item.path !== '/party/concessionEligibleCount',
    );
    expect(validateDraftEvidence(explicit, RAW)).toMatchObject({ ok: false });
  });

  it('normalizes verified names and keeps user-derived sources visible', () => {
    const request = normalizeDraftToParsedTripRequest(draft(), RAW);
    expect(request.days).toBe(3);
    expect(request.dailyWindow).toMatchObject({
      startMinutes: 660,
      startSource: 'text',
    });
    expect(request.origin.source).toBe('text');
    expect(request.pricingParty).toMatchObject({
      adultFullFareCount: 2,
      concessionEligibleCount: 0,
      source: 'text',
    });
    expect(request.mustIncludePoiIds).toContain('mel-arts-ngv-international');
    expect(request.excludePoiIds).toHaveLength(1);
  });

  it('does not accept changed hard anchors or silent scope truncation', () => {
    const changed = draft();
    changed.days = 2;
    expect(validateDraftSemantics(changed, RAW)).toMatchObject({ ok: false });

    const fourDayRaw = '墨尔本玩 4 天';
    const fourDays = draft();
    fourDays.days = null;
    fourDays.unhandledRequirements = [];
    expect(validateDraftSemantics(fourDays, fourDayRaw)).toMatchObject({
      ok: false,
    });
  });

  it('rejects grounded quotes that do not prove the claimed field or intent', () => {
    const crossAxisFacet = draft();
    crossAxisFacet.experiencePreferences.parks_gardens = 'prefer';
    const parksEvidence = crossAxisFacet.evidence.find(
      (item) => item.path === '/experiencePreferences/parks_gardens',
    );
    if (parksEvidence) parksEvidence.quote = '喜欢室外';
    else
      crossAxisFacet.evidence.push({
        path: '/experiencePreferences/parks_gardens',
        quote: '喜欢室外',
        occurrence: 1,
      });
    expect(validateDraftEvidence(crossAxisFacet, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(crossAxisFacet, RAW)).toMatchObject({
      ok: false,
      message: '体验偏好 parks_gardens 无法由 evidence 证明。',
    });

    const inventedFamily = draft();
    inventedFamily.family = true;
    inventedFamily.evidence.push({
      path: '/family',
      quote: '轻松',
      occurrence: 1,
    });
    expect(validateDraftEvidence(inventedFamily, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(inventedFamily, RAW)).toMatchObject({
      ok: false,
    });

    const missingIntent = draft();
    const mustEvidence = missingIntent.evidence.find(
      (item) => item.path === '/mustIncludeNames',
    );
    if (mustEvidence) mustEvidence.quote = 'NGV';
    expect(validateDraftEvidence(missingIntent, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(missingIntent, RAW)).toMatchObject({
      ok: false,
    });

    const reversedIntent = draft();
    reversedIntent.mustIncludeNames = ['SEA LIFE'];
    reversedIntent.excludeNames = ['NGV'];
    const reversedMust = reversedIntent.evidence.find(
      (item) => item.path === '/mustIncludeNames',
    );
    const reversedExclude = reversedIntent.evidence.find(
      (item) => item.path === '/excludeNames',
    );
    if (reversedMust) reversedMust.quote = '不要去 SEA LIFE';
    if (reversedExclude) reversedExclude.quote = '一定去 NGV';
    expect(validateDraftEvidence(reversedIntent, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(reversedIntent, RAW)).toMatchObject({
      ok: false,
    });

    const sharedLongQuote = draft();
    sharedLongQuote.mustIncludeNames = ['SEA LIFE'];
    sharedLongQuote.excludeNames = ['NGV'];
    for (const item of sharedLongQuote.evidence) {
      if (item.path === '/mustIncludeNames' || item.path === '/excludeNames')
        item.quote = '一定去 NGV，不要去 SEA LIFE';
    }
    expect(validateDraftEvidence(sharedLongQuote, RAW)).toEqual({ ok: true });
    expect(validateDraftSemantics(sharedLongQuote, RAW)).toMatchObject({
      ok: false,
    });

    const negatedVenue = draft();
    negatedVenue.venuePreference = 'indoor';
    const venueEvidence = negatedVenue.evidence.find(
      (item) => item.path === '/venuePreference',
    );
    if (venueEvidence) venueEvidence.quote = '不喜欢室内';
    const negatedVenueRaw = RAW.replace('喜欢室外', '不喜欢室内');
    expect(validateDraftEvidence(negatedVenue, negatedVenueRaw)).toEqual({
      ok: true,
    });
    expect(validateDraftSemantics(negatedVenue, negatedVenueRaw)).toMatchObject(
      { ok: false },
    );
  });

  it('requires independent evidence coordinates for repeated child ages', () => {
    const repeatedAge = draft();
    repeatedAge.party.childAges = [8, 8];
    repeatedAge.evidence.push(
      {
        path: '/party/childAges',
        quote: '两个 8 岁孩子',
        occurrence: 1,
        itemIndex: 0,
      },
      {
        path: '/party/childAges',
        quote: '两个 8 岁孩子',
        occurrence: 1,
        itemIndex: 1,
      },
    );
    expect(
      validateDraftEvidence(repeatedAge, `${RAW}，两个 8 岁孩子`),
    ).toMatchObject({ ok: false });
  });

  it('rejects negated booleans claimed as true and invalid calendar dates', () => {
    const negated = draft();
    negated.lowWalking = true;
    negated.family = true;
    const lowWalkingEvidence = negated.evidence.find(
      (item) => item.path === '/lowWalking',
    );
    if (lowWalkingEvidence) lowWalkingEvidence.quote = '不需要少走路';
    negated.evidence.push({
      path: '/family',
      quote: '没有孩子',
      occurrence: 1,
    });
    const negatedRaw = RAW.replace('少走路', '不需要少走路').concat(
      '，没有孩子',
    );
    expect(validateDraftEvidence(negated, negatedRaw)).toEqual({ ok: true });
    expect(validateDraftSemantics(negated, negatedRaw)).toMatchObject({
      ok: false,
    });

    const invalidDate = draft();
    invalidDate.date = {
      text: '2026-02-31',
      isoDate: '2026-02-31',
      resolution: 'explicit',
    };
    invalidDate.evidence.push(
      {
        path: '/date/text',
        quote: '2026-02-31',
        occurrence: 1,
      },
      {
        path: '/date/isoDate',
        quote: '2026-02-31',
        occurrence: 1,
      },
      {
        path: '/date/resolution',
        quote: '2026-02-31',
        occurrence: 1,
      },
    );
    const invalidDateRaw = `${RAW}，2026-02-31`;
    expect(validateDraftEvidence(invalidDate, invalidDateRaw)).toEqual({
      ok: true,
    });
    expect(validateDraftSemantics(invalidDate, invalidDateRaw)).toMatchObject({
      ok: false,
    });
  });

  it('preserves the explicit party when only payment is extracted and blocks an empty party', () => {
    const paymentOnly = draft();
    paymentOnly.party.adultFullFareCount = null;
    paymentOnly.party.concessionEligibleCount = null;
    paymentOnly.party.ptvPaymentMedium = 'existing_myki';
    paymentOnly.evidence = paymentOnly.evidence.filter(
      (item) =>
        item.path !== '/party/adultFullFareCount' &&
        item.path !== '/party/concessionEligibleCount',
    );
    paymentOnly.evidence.push({
      path: '/party/ptvPaymentMedium',
      quote: '已有 myki',
      occurrence: 1,
    });
    const paymentRequest = normalizeDraftToParsedTripRequest(
      paymentOnly,
      `${RAW}，已有 myki`,
    );
    expect(paymentRequest.pricingParty).toMatchObject({
      adultFullFareCount: 2,
      concessionEligibleCount: 0,
      ptvPaymentMedium: 'existing_myki',
    });

    const nobody = draft();
    nobody.party.adultFullFareCount = 0;
    nobody.party.concessionEligibleCount = 0;
    nobody.party.childAges = [];
    const emptyPartyRequest = normalizeDraftToParsedTripRequest(nobody, RAW);
    expect(emptyPartyRequest.errors.join('')).toContain('至少需要 1 位同行人');
  });
});

describe('NLU orchestrator', () => {
  it('accepts the uniquely bindable missing geography strength', async () => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = value.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '主要在市内';
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'mock-binding-success',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics).toMatchObject({
      acceptedMode: 'llm',
      fallbackReasonCode: null,
    });
    expect(
      outcome.fieldEvidence.some((item) => item.path === '/geography/strength'),
    ).toBe(true);
  });

  it('rejects a double omission, then accepts only geography binding after destination evidence is restored', async () => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) =>
        !['/destination/supportedCity', '/geography/strength'].includes(
          item.path,
        ),
    );
    const scope = value.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = '主要在市内';
    const invalid = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'mock-double-omission',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(invalid.status).toBe('complete');
    if (invalid.status === 'complete') {
      expect(invalid.diagnostics).toMatchObject({
        acceptedMode: 'rules',
        fallbackReasonCode: 'evidence_rejected',
      });
      expect(invalid.fieldEvidence).toEqual([]);
    }

    value.evidence.push({
      path: '/destination/supportedCity',
      quote: '墨尔本',
      occurrence: 1,
    });
    const repaired = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'mock-destination-restored',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(repaired.status).toBe('complete');
    if (repaired.status === 'complete') {
      expect(repaired.diagnostics).toMatchObject({
        acceptedMode: 'llm',
        fallbackReasonCode: null,
      });
      expect(
        repaired.fieldEvidence.filter(
          (item) => item.path === '/geography/strength',
        ),
      ).toHaveLength(1);
      expect(
        repaired.fieldEvidence.some(
          (item) => item.path === '/destination/supportedCity',
        ),
      ).toBe(true);
    }
  });

  it('falls back with empty field evidence when binding cannot prove the target', async () => {
    const value = draft();
    value.evidence = value.evidence.filter(
      (item) => item.path !== '/geography/strength',
    );
    const scope = value.evidence.find(
      (item) => item.path === '/geography/scope',
    );
    if (scope) scope.quote = 'CBD';
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'mock-binding-failure',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics.fallbackReasonCode).toBe('evidence_rejected');
    expect(outcome.fieldEvidence).toEqual([]);
  });

  it('uses the existing rule parser unchanged when no adapter is configured', async () => {
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'rules-only',
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.request).toEqual(parseTripRequest(RAW));
    expect(outcome.diagnostics).toMatchObject({
      attemptedMode: 'rules',
      acceptedMode: 'rules',
      fallbackReasonCode: null,
    });
  });

  it('accepts a fully verified mock draft without exposing a provider', async () => {
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'mock-success',
      adapter: adapterFor({
        ok: true,
        draft: draft(),
        promptVersion: 'nlu-extraction-v2',
        datasetVersion: POI_DATASET.dataVersion,
      }),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics).toMatchObject({
      attemptedMode: 'llm',
      acceptedMode: 'llm',
      fallbackReasonCode: null,
    });
    expect(outcome.fieldEvidence.length).toBeGreaterThan(0);
  });

  it.each([
    ['schema_rejected', { extra: true }],
    ['semantic_rejected', { ...draft(), days: 2 }],
  ] as const)(
    'falls back as one whole request on %s',
    async (reason, value) => {
      const outcome = await interpretTripRequest({
        rawText: RAW,
        sourceFingerprint: reason,
        adapter: adapterFor({
          ok: true,
          draft: value,
          promptVersion: 'test',
          datasetVersion: POI_DATASET.dataVersion,
        }),
      });
      expect(outcome.status).toBe('complete');
      if (outcome.status !== 'complete') return;
      expect(outcome.request).toEqual(parseTripRequest(RAW));
      expect(outcome.fieldEvidence).toEqual([]);
      expect(outcome.diagnostics).toMatchObject({
        attemptedMode: 'llm',
        acceptedMode: 'rules',
        fallbackReasonCode: reason,
      });
    },
  );

  it('falls back on timeout and version mismatch', async () => {
    const timeout = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'timeout',
      deadlineMs: 5,
      adapter: adapterFor(() => new Promise(() => undefined)),
    });
    expect(timeout.status).toBe('complete');
    if (timeout.status === 'complete')
      expect(timeout.diagnostics.fallbackReasonCode).toBe('deadline_exceeded');

    const version = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'version',
      adapter: adapterFor({
        ok: true,
        draft: draft(),
        promptVersion: 'test',
        datasetVersion: 'wrong-version',
      }),
    });
    expect(version.status).toBe('complete');
    if (version.status === 'complete')
      expect(version.diagnostics.fallbackReasonCode).toBe('version_mismatch');
  });

  it('keeps unsupported currencies blocked after whole-request fallback', async () => {
    const rawText = '墨尔本玩 2 天，预算 500 日元';
    const outcome = await interpretTripRequest({
      rawText,
      sourceFingerprint: 'non-aud-fallback',
      adapter: adapterFor({ ok: false, code: 'invalid_json' }),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.request.totalBudgetCents).toBeNull();
    expect(outcome.request.errors.join('')).toContain('只支持 AUD');
    expect(outcome.diagnostics).toMatchObject({
      acceptedMode: 'rules',
      fallbackReasonCode: 'invalid_json',
    });
  });

  it('turns a synchronous adapter exception into a safe rules fallback', async () => {
    const adapter: NluDraftAdapter = {
      extractDraft: () => {
        throw new Error('test-only adapter failure');
      },
    };
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'sync-throw',
      adapter,
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.request).toEqual(parseTripRequest(RAW));
    expect(outcome.diagnostics.fallbackReasonCode).toBe('provider_unavailable');
  });

  it('treats caller abort as control flow rather than a fallback', async () => {
    const controller = new AbortController();
    const pending = interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'abort',
      signal: controller.signal,
      deadlineMs: 100,
      adapter: adapterFor(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  draft: draft(),
                  promptVersion: 'late',
                  datasetVersion: POI_DATASET.dataVersion,
                }),
              20,
            ),
          ),
      ),
    });
    controller.abort();
    await expect(pending).resolves.toEqual({
      status: 'aborted',
      sourceFingerprint: 'abort',
    });
  });

  it('rejects late A responses even after the input returns A → B → A', () => {
    expect(
      canCommitInterpretation({
        runId: 1,
        activeRunId: 3,
        aborted: false,
        outcomeFingerprint: 'A',
        currentFingerprint: 'A',
      }),
    ).toBe(false);
    expect(
      canCommitInterpretation({
        runId: 3,
        activeRunId: 3,
        aborted: false,
        outcomeFingerprint: 'A',
        currentFingerprint: 'A',
      }),
    ).toBe(true);
  });
});

describe('safe validation issue contract', () => {
  it('maps AJV instancePath without leaking additionalProperty names or messages', () => {
    const malicious = {
      ...draft(),
      'secret-provider-field': 'must-not-leak',
    };
    const root = validateDraftSchema(malicious);
    expect(root).toEqual({
      ok: false,
      message: 'Draft 不符合 v2 Schema。',
      issue: { stage: 'schema', reason: 'schema.invalid', path: null },
    });
    expect(JSON.stringify(root)).not.toContain('secret-provider-field');

    const known = draft();
    known.days = 4;
    expect(validateDraftSchema(known)).toMatchObject({
      ok: false,
      issue: { stage: 'schema', reason: 'schema.invalid', path: '/days' },
    });

    const evidenceProperty = draft();
    const poisoned = evidenceProperty.evidence[0] as Record<string, unknown>;
    poisoned['secret-coordinate-field'] = 'must-not-leak';
    const nested = validateDraftSchema(evidenceProperty);
    expect(nested).toMatchObject({
      ok: false,
      issue: {
        stage: 'schema',
        reason: 'schema.invalid',
        path: '/evidence',
      },
    });
    expect(JSON.stringify(nested)).not.toContain('secret-coordinate-field');
  });

  it('assigns every evidence failure reason and its safe path precisely', () => {
    const unexpected = draft();
    unexpected.evidence.push({
      path: '/family',
      quote: '轻松',
      occurrence: 1,
    });
    expectIssue(validateDraftEvidence(unexpected, RAW), {
      stage: 'evidence',
      reason: 'evidence.unexpected_coordinate',
      path: '/evidence',
    });

    const duplicate = draft();
    duplicate.evidence.push(structuredClone(duplicate.evidence[0]));
    expectIssue(validateDraftEvidence(duplicate, RAW), {
      stage: 'evidence',
      reason: 'evidence.duplicate_coordinate',
      path: '/evidence',
    });

    const missingQuote = draft();
    missingQuote.evidence[0].quote = 'provider-only secret quote';
    expectIssue(validateDraftEvidence(missingQuote, RAW), {
      stage: 'evidence',
      reason: 'evidence.quote_not_in_source',
      path: '/evidence',
    });

    const badOccurrence = draft();
    badOccurrence.evidence[0].occurrence = 2;
    expectIssue(validateDraftEvidence(badOccurrence, RAW), {
      stage: 'evidence',
      reason: 'evidence.occurrence_out_of_range',
      path: '/evidence',
    });

    const reusedChild = draft();
    reusedChild.party.childAges = [8, 8];
    reusedChild.evidence.push(
      {
        path: '/party/childAges',
        quote: '两个 8 岁孩子',
        occurrence: 1,
        itemIndex: 0,
      },
      {
        path: '/party/childAges',
        quote: '两个 8 岁孩子',
        occurrence: 1,
        itemIndex: 1,
      },
    );
    expectIssue(validateDraftEvidence(reusedChild, `${RAW}，两个 8 岁孩子`), {
      stage: 'evidence',
      reason: 'evidence.child_coordinate_reused',
      path: '/party/childAges',
    });

    const literal = draft();
    literal.destination.text = 'Melbourne';
    expectIssue(validateDraftEvidence(literal, RAW), {
      stage: 'evidence',
      reason: 'evidence.literal_mismatch',
      path: '/evidence',
    });

    const missing = draft();
    missing.evidence = missing.evidence.filter((item) => item.path !== '/days');
    expectIssue(validateDraftEvidence(missing, RAW), {
      stage: 'evidence',
      reason: 'evidence.missing_required_coordinate',
      path: '/days',
    });
  });

  it('assigns all semantic reason families before normalization', () => {
    expect(
      validateDraftSemantics(draft(), `${RAW}${'x'.repeat(2_001)}`),
    ).toMatchObject({
      ok: false,
      issue: { reason: 'semantic.input_too_long', path: null },
    });

    const crossField = draft();
    crossField.budget.currency = null;
    expect(validateDraftSemantics(crossField, RAW)).toMatchObject({
      ok: false,
      issue: {
        reason: 'semantic.invalid_cross_field_state',
        path: '/budget/currency',
      },
    });

    const ruleMismatch = draft();
    expect(
      validateDraftSemantics(ruleMismatch, RAW.replace('3 天', '2 天')),
    ).toMatchObject({
      ok: false,
      issue: { reason: 'semantic.rule_mismatch', path: '/days' },
    });

    const evidence = draft();
    const destinationEvidence = evidence.evidence.find(
      (item) => item.path === '/destination/supportedCity',
    );
    if (destinationEvidence) destinationEvidence.quote = '3 天';
    expect(validateFieldEvidenceSemantics(evidence)).toMatchObject({
      ok: false,
      issue: {
        reason: 'semantic.evidence_not_proven',
        path: '/destination/supportedCity',
      },
    });

    const unhandled = draft();
    unhandled.days = null;
    unhandled.unhandledRequirements = [];
    expect(validateDraftSemantics(unhandled, '墨尔本玩 4 天')).toMatchObject({
      ok: false,
      issue: {
        reason: 'semantic.unhandled_requirement_missing',
        path: '/unhandledRequirements',
      },
    });
  });

  it.each([
    [
      '/date/isoDate',
      (value: TripRequestDraftV2) => {
        value.date = {
          text: '2026-09-20',
          isoDate: '2026-09-20',
          resolution: 'explicit',
        };
        value.evidence.push({
          path: '/date/isoDate',
          quote: '2026-09-21',
          occurrence: 1,
        });
      },
    ],
    [
      '/originText',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/originText',
        );
        if (item) item.quote = '从 Southbank 出发';
      },
    ],
    [
      '/dailyStartMinutes',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/dailyStartMinutes',
        );
        if (item) item.quote = '早上十点出发';
      },
    ],
    [
      '/geography/strength',
      (value: TripRequestDraftV2) => {
        value.geography.strength = 'hard';
      },
    ],
    [
      '/pace',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find((entry) => entry.path === '/pace');
        if (item) item.quote = '紧凑';
      },
    ],
    [
      '/venuePreference',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/venuePreference',
        );
        if (item) item.quote = '不喜欢室外';
      },
    ],
    [
      '/experiencePreferences/museum_exhibition',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/experiencePreferences/museum_exhibition',
        );
        if (item) item.quote = '喜欢室外';
      },
    ],
    [
      '/lowWalking',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/lowWalking',
        );
        if (item) item.quote = '不需要少走路';
      },
    ],
    [
      '/family',
      (value: TripRequestDraftV2) => {
        value.family = true;
        value.evidence.push({
          path: '/family',
          quote: '没有孩子',
          occurrence: 1,
        });
      },
    ],
    [
      '/avoidCrowds',
      (value: TripRequestDraftV2) => {
        value.avoidCrowds = false;
      },
    ],
    [
      '/party/adultFullFareCount',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/party/adultFullFareCount',
        );
        if (item) item.quote = '3 位成人';
      },
    ],
    [
      '/party/concessionEligibleCount',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/party/concessionEligibleCount',
        );
        if (item) item.quote = '2 位成人';
      },
    ],
    [
      '/party/childAges',
      (value: TripRequestDraftV2) => {
        value.party.childAges = [8];
        value.evidence.push({
          path: '/party/childAges',
          quote: '9 岁孩子',
          occurrence: 1,
          itemIndex: 0,
        });
      },
    ],
    [
      '/party/ptvPaymentMedium',
      (value: TripRequestDraftV2) => {
        value.party.ptvPaymentMedium = 'existing_myki';
        value.evidence.push({
          path: '/party/ptvPaymentMedium',
          quote: '购买新 myki',
          occurrence: 1,
        });
      },
    ],
    [
      '/budget/currency',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/budget/currency',
        );
        if (item) item.quote = '预算 500';
      },
    ],
    [
      '/budget/totalCents',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/budget/totalCents',
        );
        if (item) item.quote = 'A$400';
      },
    ],
    [
      '/mustIncludeNames',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/mustIncludeNames',
        );
        if (item) item.quote = 'NGV';
      },
    ],
    [
      '/excludeNames',
      (value: TripRequestDraftV2) => {
        const item = value.evidence.find(
          (entry) => entry.path === '/excludeNames',
        );
        if (item) item.quote = 'SEA LIFE';
      },
    ],
  ] as const)(
    'uses the field path %s for evidence proof failures',
    (path, mutate) => {
      const value = draft();
      mutate(value);
      expect(validateFieldEvidenceSemantics(value)).toMatchObject({
        ok: false,
        issue: { reason: 'semantic.evidence_not_proven', path },
      });
    },
  );
});

describe('orchestrator diagnostic exception containment', () => {
  async function collect(
    validationDependencies: NonNullable<
      Parameters<typeof interpretTripRequest>[0]['validationDependencies']
    >,
    sinkMode: 'collect' | 'throw' | 'reject' = 'collect',
  ): Promise<{
    events: LocalDiagnosticEvent[];
    outcome: Awaited<ReturnType<typeof interpretTripRequest>>;
  }> {
    const events: LocalDiagnosticEvent[] = [];
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'diagnostic-exception-test',
      adapter: adapterFor({
        ok: true,
        draft: draft(),
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
      localDiagnostics: {
        emit(event) {
          if (sinkMode === 'throw')
            throw new Error('test-only sync sink error');
          if (sinkMode === 'reject')
            return Promise.reject(new Error('test-only async sink error'));
          events.push(event);
        },
      },
      validationDependencies,
    });
    await Promise.resolve();
    return { events, outcome };
  }

  it.each([
    ['opposite_only', '不要去 NGV', '一定去 NGV', '不要去 NGV'] as const,
    ['intent_marker_absent', 'NGV', '一定去 NGV', 'NGV'] as const,
    [
      'opposite_nearer_or_tied',
      '不要去 NGV，一定去 NGV',
      '一定去 NGV',
      '不要去 NGV，一定去 NGV',
    ] as const,
  ])(
    'emits the real validator must-include cause %s',
    async (cause, quote, oldQuote, rawQuote) => {
      const value = draft();
      const must = value.evidence.find(
        (item) => item.path === '/mustIncludeNames',
      );
      if (!must) throw new Error('fixture must include evidence');
      must.quote = quote;
      const rawText = RAW.replace(oldQuote, rawQuote);
      const events: LocalDiagnosticEvent[] = [];
      const outcome = await interpretTripRequest({
        rawText,
        sourceFingerprint: `real-cause-${cause}`,
        adapter: adapterFor({
          ok: true,
          draft: value,
          promptVersion: 'test',
          datasetVersion: POI_DATASET.dataVersion,
        }),
        localDiagnostics: {
          emit: (event) => {
            events.push(event);
          },
        },
      });
      expect(outcome).toMatchObject({
        status: 'complete',
        diagnostics: {
          acceptedMode: 'rules',
          fallbackReasonCode: 'semantic_rejected',
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        version: 2,
        outcome: 'fallback',
        firstFailure: {
          stage: 'semantic',
          reason: 'semantic.evidence_not_proven',
          path: '/mustIncludeNames',
        },
        mustIncludeCause: { code: cause },
      });
    },
  );

  it('emits unclassified for a real validator exception-shaped cause and null for earlier failures', async () => {
    const value = draft();
    const must = value.evidence.find(
      (item) => item.path === '/mustIncludeNames',
    );
    if (!must) throw new Error('fixture must include evidence');
    must.quote = 'NGV';
    const events: LocalDiagnosticEvent[] = [];
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'real-earlier-failure',
      adapter: adapterFor({
        ok: true,
        draft: value,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
      localDiagnostics: {
        emit: (event) => {
          events.push(event);
        },
      },
      validationDependencies: {
        validateSchema: (input) => validateDraftSchema(input),
        validateSemantics: () => ({
          ok: false,
          message: 'test',
          issue: {
            stage: 'semantic',
            reason: 'semantic.evidence_not_proven',
            path: '/mustIncludeNames',
          },
          mustIncludeCause: 'unclassified',
        }),
      },
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: { acceptedMode: 'rules' },
    });
    expect(events[0]).toMatchObject({
      mustIncludeCause: { code: 'unclassified' },
    });

    const earlierEvents: LocalDiagnosticEvent[] = [];
    const earlierValue = draft();
    earlierValue.days = 4;
    const earlier = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'real-earlier-schema',
      adapter: adapterFor({
        ok: true,
        draft: earlierValue,
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
      localDiagnostics: {
        emit: (event) => {
          earlierEvents.push(event);
        },
      },
    });
    expect(earlier).toMatchObject({
      status: 'complete',
      diagnostics: { acceptedMode: 'rules' },
    });
    expect(earlierEvents[0]).toMatchObject({
      firstFailure: { stage: 'schema' },
      mustIncludeCause: null,
    });
  });

  it.each([
    [
      'schema.validator_exception',
      {
        validateSchema: () => {
          throw new Error('schema');
        },
      },
      'schema_rejected',
    ],
    [
      'evidence.binding_exception',
      {
        bindEvidence: () => {
          throw new Error('binding');
        },
      },
      'evidence_rejected',
    ],
    [
      'evidence.validator_exception',
      {
        validateEvidence: () => {
          throw new Error('evidence');
        },
      },
      'evidence_rejected',
    ],
    [
      'semantic.validator_exception',
      {
        validateSemantics: () => {
          throw new Error('semantic');
        },
      },
      'semantic_rejected',
    ],
    [
      'normalization.exception',
      {
        normalize: () => {
          throw new Error('normalization');
        },
      },
      'semantic_rejected',
    ],
  ] as const)(
    'emits one safe %s event and falls back',
    async (reason, validationDependencies, fallbackReasonCode) => {
      const { events, outcome } = await collect(validationDependencies);
      expect(events).toHaveLength(1);
      expect(events[0].firstFailure?.reason).toBe(reason);
      expect(outcome.status).toBe('complete');
      if (outcome.status === 'complete')
        expect(outcome.diagnostics.fallbackReasonCode).toBe(fallbackReasonCode);
    },
  );

  it('falls back without emitting a false binding diagnostic when elision throws', async () => {
    const events: LocalDiagnosticEvent[] = [];
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'elision-exception-test',
      enableOptionalAssertionElision: true,
      adapter: adapterFor({
        ok: true,
        draft: draft(),
        promptVersion: 'test',
        datasetVersion: POI_DATASET.dataVersion,
      }),
      validationDependencies: {
        elideOptionalAssertions: () => {
          throw new Error('elision');
        },
      },
      localDiagnostics: {
        emit(event) {
          events.push(event);
        },
      },
    });
    expect(events).toEqual([]);
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: {
        acceptedMode: 'rules',
        fallbackReasonCode: 'evidence_rejected',
      },
    });
  });

  it('overwrites a post-binding schema reason without parsing its message', async () => {
    let calls = 0;
    const { events } = await collect({
      validateSchema(value) {
        calls += 1;
        if (calls === 1) return validateDraftSchema(value);
        return {
          ok: false,
          message: 'malicious provider detail',
          issue: { stage: 'schema', reason: 'schema.invalid', path: '/days' },
        };
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].firstFailure).toEqual({
      stage: 'schema',
      reason: 'schema.post_binding_invalid',
      path: '/days',
    });
    expect(JSON.stringify(events[0])).not.toContain(
      'malicious provider detail',
    );
  });

  it('reports a binding internal_error as binding_exception with a complete report', async () => {
    const { events } = await collect({
      bindEvidence(value) {
        return {
          draft: value,
          report: {
            policy: 'evidence-binding-v1',
            status: 'internal_error',
            reason: 'binding_exception',
            addedPath: null,
            addedCount: 0,
          },
        };
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
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
      }),
    ]);
  });

  it('emits at most once for an accepted provider-success validation chain', async () => {
    const { events, outcome } = await collect({});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: 'accepted',
      firstFailure: null,
    });
    expect(outcome.status).toBe('complete');
  });

  it.each(['throw', 'reject'] as const)(
    'keeps the parser result when the diagnostic sink %s mode fails',
    async (sinkMode) => {
      const { outcome } = await collect({}, sinkMode);
      expect(outcome.status).toBe('complete');
      if (outcome.status === 'complete')
        expect(outcome.diagnostics.acceptedMode).toBe('llm');
    },
  );
});
