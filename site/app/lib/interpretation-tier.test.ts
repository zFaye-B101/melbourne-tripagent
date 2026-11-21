import { describe, expect, it } from 'vitest';

import { parseTripRequest } from './planner';
import {
  RULES_TIER,
  assessRulesTier,
  planRulesFirstClick,
  recognizedFields,
} from './interpretation-tier';
import type { CachedInterpretation } from './interpretation-cache';

const assess = (text: string) => assessRulesTier(parseTripRequest(text));

const cachedAnswer: CachedInterpretation = {
  status: 'complete',
  sourceFingerprint: 'pretty-printed-fingerprint',
  request: parseTripRequest('墨尔本玩 3 天，住 CBD，每天 11 点出门，喜欢户外和历史，行程别太赶'),
  diagnostics: {
    attemptedMode: 'llm',
    acceptedMode: 'llm',
    fallbackReasonCode: null,
    draftSchemaVersion: 'trip-request-draft-v2',
    normalizedRequestVersion: 'parsed-trip-request-v2',
    semanticPolicyVersion: 'trip-semantic-v1',
    promptVersion: 'nlu-extraction-system-v2.7',
  },
  fieldEvidence: [],
};

describe('rules-first gate: answers published without a model call', () => {
  it('publishes a rich request that names days, pace and interests', () => {
    const tier = assess(
      '墨尔本玩 3 天，住 CBD，每天 11 点出门，喜欢户外和历史，行程别太赶',
    );
    expect(tier.verdict).toBe('rules');
    expect(tier.escalatedBecause).toBeNull();
    expect(tier.datasetGap).toBe(false);
    expect(tier.recognized).toEqual([
      'days',
      'pace',
      'venue',
      'startWindow',
      'interests',
    ]);
  });

  it('publishes a request that names days, pace and interests without settings', () => {
    const tier = assess(
      '我想去大洋路和菲利普岛，3天，住CBD，喜欢自然风光，节奏轻松一点',
    );
    expect(tier.recognized).toEqual(['days', 'pace', 'interests']);
    expect(tier.verdict).toBe('rules');
  });

  it('does not require every field to be present', () => {
    const tier = assess(
      '下周去墨尔本，3天，住市中心，喜欢历史和建筑，预算300澳元一个人',
    );
    expect(tier.recognized).toEqual(['days', 'interests', 'budget', 'party']);
    expect(tier.verdict).toBe('rules');
  });
});

describe('rules-first gate: escalations', () => {
  it('escalates when days and budget are known but no preference was expressed', () => {
    const tier = assess('两个人去墨尔本玩两天，预算500澳元');
    expect(tier.recognized).toEqual(['days', 'budget', 'party']);
    expect(tier.verdict).toBe('model');
    expect(tier.escalatedBecause).toBe('no_preference_field');
  });

  it('escalates flags-only requests that name no preference', () => {
    const tier = assess('墨尔本2天，带娃，少走路，避开人多的地方');
    // 「带娃」自 2026-09-28 起记为同行人信息（未说人数，票型不再标为完整）。
    expect(tier.recognized).toEqual(['days', 'party', 'lowWalking', 'avoidCrowds']);
    expect(tier.escalatedBecause).toBe('no_preference_field');
  });

  it('escalates when too few fields came from the text', () => {
    const coffeeTier = assess('两位成人，3天，住CBD，喜欢咖啡');
    expect(coffeeTier.recognized).toEqual(['days', 'party']);
    expect(coffeeTier.escalatedBecause).toBe('too_few_fields');

    const vagueTier = assess('帮我安排墨尔本3天行程');
    expect(vagueTier.recognized).toEqual(['days']);
    expect(vagueTier.escalatedBecause).toBe('too_few_fields');
  });

  it('escalates when a required field is missing', () => {
    const tier = assess('墨尔本，喜欢户外和历史，别太赶');
    expect(tier.verdict).toBe('model');
    expect(tier.escalatedBecause).toBe('needs_clarification');
  });

  it('escalates hard errors, including ones a model can actually read', () => {
    expect(assess('墨尔本4天，喜欢户外和历史').escalatedBecause).toBe('errors');
    const originTier = assess('从悉尼出发去墨尔本玩 3 天，喜欢户外');
    expect(originTier.escalatedBecause).toBe('errors');
    expect(originTier.datasetGap).toBe(false);
  });
});

describe('rules-first gate: dataset gaps are published, not paid for', () => {
  it('keeps a named place the dataset lacks on the rules path', () => {
    const tier = assess('墨尔本3天，必须去大洋路');
    expect(tier.datasetGap).toBe(true);
    expect(tier.verdict).toBe('rules');
    expect(tier.escalatedBecause).toBeNull();
    expect(parseTripRequest('墨尔本3天，必须去大洋路').errors.length).toBeGreaterThan(0);
  });
});

describe('recognizedFields counts only what the user actually said', () => {
  it('ignores fields left at their defaults', () => {
    // The visible default party (one adult) is not evidence about the visitor.
    expect(recognizedFields(parseTripRequest('墨尔本3天'))).toEqual(['days']);
    expect(recognizedFields(parseTripRequest(''))).toEqual([]);
  });
});

describe('the field threshold is a knob, not a constant', () => {
  it('can be raised to force the model path', () => {
    const text = '墨尔本玩 3 天，住 CBD，每天 11 点出门，喜欢户外和历史，行程别太赶';
    expect(assessRulesTier(parseTripRequest(text)).verdict).toBe('rules');
    expect(
      assessRulesTier(parseTripRequest(text), { minRecognizedFields: 6 }).verdict,
    ).toBe('model');
    expect(RULES_TIER.minRecognizedFields).toBe(3);
  });
});

describe('the first step of an auto click keeps its order', () => {
  const base = { wantsModel: true, alreadyRunning: false, cached: null };

  it('runs the free rules pass when nothing else applies', () => {
    expect(planRulesFirstClick({ ...base, rawText: '墨尔本3天' }).kind).toBe(
      'run_rules',
    );
  });

  it('serves a cached answer without touching the guard', () => {
    const plan = planRulesFirstClick({
      ...base,
      rawText: '墨尔本3天',
      cached: cachedAnswer,
    });
    expect(plan.kind).toBe('answer_from_cache');
    expect(plan.kind === 'answer_from_cache' && plan.outcome).toBe(cachedAnswer);
  });

  it('rejects an over-long description before it can reach the cache', () => {
    const plan = planRulesFirstClick({
      ...base,
      rawText: '好'.repeat(2_001),
      cached: cachedAnswer,
    });
    expect(plan.kind).toBe('input_too_long');
  });

  it('waits for a model request in flight instead of aborting it for a cache hit', () => {
    const plan = planRulesFirstClick({
      ...base,
      rawText: '墨尔本3天',
      alreadyRunning: true,
      cached: cachedAnswer,
    });
    expect(plan.kind).toBe('already_running');
  });

  it('never blocks the free rules path, even mid-request', () => {
    const plan = planRulesFirstClick({
      wantsModel: false,
      alreadyRunning: true,
      cached: null,
      rawText: '墨尔本3天',
    });
    expect(plan.kind).toBe('run_rules');
  });
});
