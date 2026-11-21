import { describe, expect, it } from 'vitest';
import exampleDraft from '../../../data/examples/trip-request-v2.example.json';
import { hasExperienceFacetLanguage } from './planner';
import {
  elideUnprovenOptionalAssertions,
  elideUnprovenOptionalFamilyAssertion,
  hasFamilyLanguage,
} from './optional-assertion-elision';
import type { TripRequestDraftV2 } from './trip-request-draft-v2-runtime';

const raw = '墨尔本玩 2 天，预算 A$500';

function draft(): TripRequestDraftV2 {
  return structuredClone(exampleDraft) as TripRequestDraftV2;
}

describe('optional assertion elision', () => {
  it('elides only an ungrounded false family assertion and preserves the input', () => {
    const input = draft();
    input.family = false;
    const before = structuredClone(input);
    const result = elideUnprovenOptionalFamilyAssertion(input, raw);
    expect(result.family).toBeNull();
    expect(input).toEqual(before);
    expect(result).not.toBe(input);
  });

  it.each([
    ['true', true, raw],
    ['explicit negative', false, `${raw}，没有孩子`],
    ['explicit positive', false, `${raw}，带孩子`],
    ['child age', false, `${raw}，一个 8 岁孩子`],
    ['ambiguous', false, `${raw}，可能带娃`],
    ['age only', false, `${raw}，同行 5 岁`],
    ['two adults and one child', false, `${raw}，两大一小`],
    ['one adult and one child', false, `${raw}，一大一小`],
    ['baby', false, `${raw}，带 baby 同行`],
    ['infant', false, `${raw}，有 infant 同行`],
    ['toddler', false, `${raw}，toddler friendly`],
    ['daughter', false, `${raw}，with my daughter`],
    ['son', false, `${raw}，with my son`],
    ['parents', false, `${raw}，for parents and children`],
  ])('does not elide %s', (_label, family, text) => {
    const input = draft();
    input.family = family;
    expect(elideUnprovenOptionalFamilyAssertion(input, text).family).toBe(
      family,
    );
  });

  it('distinguishes a catalogued venue name from an explicit category preference', () => {
    expect(
      hasExperienceFacetLanguage(
        '想去 Melbourne Museum。',
        'museum_exhibition',
      ),
    ).toBe(false);
    expect(
      hasExperienceFacetLanguage(
        '想去 Melbourne Museum，也喜欢博物馆。',
        'museum_exhibition',
      ),
    ).toBe(true);
  });

  it('does not elide when family evidence already exists, including a repeated coordinate', () => {
    const input = draft();
    input.family = false;
    input.evidence.push(
      { path: '/family', quote: '2 天', occurrence: 1 },
      { path: '/family', quote: '2 天', occurrence: 1 },
    );
    expect(elideUnprovenOptionalFamilyAssertion(input, raw).family).toBe(false);
  });

  it('uses a conservative family-language deny-list', () => {
    expect(hasFamilyLanguage('没有孩子')).toBe(true);
    expect(hasFamilyLanguage('family 行程')).toBe(true);
    expect(hasFamilyLanguage('两大一小')).toBe(true);
    expect(hasFamilyLanguage('带 baby 同行')).toBe(true);
    expect(hasFamilyLanguage('墨尔本玩两天，预算 A$500')).toBe(false);
  });

  it('elides a category inference from a named POI without changing the place constraint', () => {
    const input = draft();
    input.experiencePreferences.museum_exhibition = 'prefer';
    input.mustIncludeNames = ['NGV'];
    input.evidence = [
      {
        path: '/experiencePreferences/museum_exhibition',
        quote: '想去 NGV',
        occurrence: 1,
      },
      {
        path: '/mustIncludeNames',
        quote: '想去 NGV',
        occurrence: 1,
        itemIndex: 0,
      },
    ];
    const before = structuredClone(input);
    const result = elideUnprovenOptionalAssertions(
      input,
      '下周末去墨尔本玩 2 天，每天晚一点出门，想去 NGV。',
    );
    expect(result.experiencePreferences.museum_exhibition).toBeNull();
    expect(result.mustIncludeNames).toEqual(['NGV']);
    expect(result.evidence).toEqual([
      {
        path: '/mustIncludeNames',
        quote: '想去 NGV',
        occurrence: 1,
        itemIndex: 0,
      },
    ]);
    expect(input).toEqual(before);
  });

  it.each([
    ['positive preference', '喜欢博物馆', 'prefer'],
    ['negative preference', '不喜欢博物馆', 'avoid'],
    ['English preference', 'avoid museums', 'avoid'],
  ] as const)('does not elide explicit %s language', (_label, text, value) => {
    const input = draft();
    input.experiencePreferences.museum_exhibition = value;
    input.evidence = [
      {
        path: '/experiencePreferences/museum_exhibition',
        quote: text,
        occurrence: 1,
      },
    ];
    const result = elideUnprovenOptionalAssertions(input, text);
    expect(result.experiencePreferences.museum_exhibition).toBe(value);
    expect(result.evidence).toEqual(input.evidence);
  });
});
