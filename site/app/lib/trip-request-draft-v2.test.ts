import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), '../data/trip-request-draft-v2.schema.json'),
    'utf8',
  ),
);

const example = JSON.parse(
  fs.readFileSync(
    path.resolve(
      process.cwd(),
      '../data/examples/trip-request-v2.example.json',
    ),
    'utf8',
  ),
);

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function expectValid(draft: unknown) {
  expect(validate(draft), JSON.stringify(validate.errors)).toBe(true);
}

function expectInvalid(draft: unknown) {
  expect(validate(draft)).toBe(false);
}

describe('TripRequestDraft v2 schema', () => {
  it('accepts the checked-in provider-neutral example', () => {
    expectValid(example);
  });

  it('rejects the legacy schema version and provider implementation details', () => {
    expectInvalid({ ...example, schemaVersion: 'trip-request-draft-v1' });
    for (const extra of ['provider', 'model', 'poiIds']) {
      expectInvalid({ ...example, [extra]: 'not-allowed' });
    }
  });

  it('does not silently truncate an out-of-scope four-day request', () => {
    expectInvalid({ ...example, days: 4 });

    const representedAsScopeError = structuredClone(example);
    representedAsScopeError.days = null;
    representedAsScopeError.unhandledRequirements = [
      { kind: 'duration_scope', text: '4 天', hardness: 'hard' },
    ];
    representedAsScopeError.evidence.push({
      path: '/unhandledRequirements',
      quote: '4 天',
      occurrence: 1,
      itemIndex: 0,
    });
    expectValid(representedAsScopeError);
  });

  it('keeps precise start minutes bounded without inventing a time', () => {
    expectInvalid({ ...example, dailyStartMinutes: -1 });
    expectInvalid({ ...example, dailyStartMinutes: 1440 });
    expectInvalid({ ...example, dailyStartMinutes: 660.5 });
    expectValid({
      ...example,
      dailyStartText: '上午出门',
      dailyStartMinutes: null,
    });
  });

  it('requires all eight experience facets and only known preference states', () => {
    const missingFacet = structuredClone(example);
    delete missingFacet.experiencePreferences.parks_gardens;
    expectInvalid(missingFacet);

    const misspelledFacet = structuredClone(example);
    misspelledFacet.experiencePreferences.park_garden = 'prefer';
    expectInvalid(misspelledFacet);

    expectInvalid({
      ...example,
      experiencePreferences: {
        ...example.experiencePreferences,
        parks_gardens: 'like',
      },
    });
  });

  it('distinguishes unexpressed nulls from explicit boolean flags', () => {
    expectValid({
      ...example,
      venuePreference: null,
      experiencePreferences: Object.fromEntries(
        Object.keys(example.experiencePreferences).map((key) => [key, null]),
      ),
      lowWalking: false,
      family: false,
      avoidCrowds: false,
    });
    expectInvalid({
      ...example,
      experiencePreferences: {
        ...example.experiencePreferences,
        parks_gardens: false,
      },
    });
  });

  it('accepts AUD only and never converts another currency inside the draft', () => {
    expectInvalid({
      ...example,
      budget: { currency: 'CNY', totalCents: 250000 },
    });
    expectValid({ ...example, budget: { currency: null, totalCents: null } });
  });

  it('bounds party values and keeps fare eligibility explicit', () => {
    expectValid({
      ...example,
      party: { ...example.party, childAges: [8, 8] },
    });
    expectInvalid({
      ...example,
      party: { ...example.party, childAges: [-1] },
    });
    expectInvalid({
      ...example,
      party: { ...example.party, childAges: [18] },
    });
    expectInvalid({
      ...example,
      party: { ...example.party, adultFullFareCount: 1.5 },
    });
  });

  it('keeps place names as text rather than accepting generated POI IDs', () => {
    expectInvalid({
      ...example,
      mustIncludeNames: [{ poiId: 'mel-ngv-international' }],
    });
  });

  it('requires precise, non-empty evidence coordinates', () => {
    const missingOccurrence = structuredClone(example);
    delete missingOccurrence.evidence[0].occurrence;
    expectInvalid(missingOccurrence);

    const unknownPath = structuredClone(example);
    unknownPath.evidence[0].path = '/provider';
    expectInvalid(unknownPath);

    const emptyQuote = structuredClone(example);
    emptyQuote.evidence[0].quote = '';
    expectInvalid(emptyQuote);
  });

  it('keeps the schema capacity above the worst-case evidence count', () => {
    const dense = structuredClone(example);
    dense.evidence = Array.from({ length: 89 }, () => ({
      path: '/days',
      quote: '3 天',
      occurrence: 1,
    }));
    expectValid(dense);

    dense.evidence = Array.from({ length: 129 }, () => ({
      path: '/days',
      quote: '3 天',
      occurrence: 1,
    }));
    expectInvalid(dense);
  });

  it('represents an unsupported city without changing it to Melbourne', () => {
    const draft = structuredClone(example);
    draft.destination = { text: 'Sydney', supportedCity: null };
    draft.unhandledRequirements = [
      { kind: 'destination_scope', text: 'Sydney', hardness: 'hard' },
    ];
    expectValid(draft);
  });

  it('keeps relative dates unresolved instead of inventing an ISO date', () => {
    expectValid({
      ...example,
      date: {
        text: '下周末',
        isoDate: null,
        resolution: 'relative_unresolved',
      },
    });
  });
});
