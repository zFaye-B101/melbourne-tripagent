/**
 * 规则解析与模型草稿校验之间的一致性（本地 qwen3.5:9b 试跑发现，docs/44 §9.2）。
 * 全部使用手写草稿，不调用模型。
 */
import exampleDraft from '../../../data/examples/trip-request-v2.example.json';
import { describe, expect, it } from 'vitest';

import type { NluDraftAdapter } from './nlu-contract';
import { interpretTripRequest } from './nlu-orchestrator';
import { POI_DATASET } from './planner';

import {
  normalizeDraftToParsedTripRequest,
  validateDraftEvidence,
  validateDraftSchema,
  validateDraftSemantics,
  type TripRequestDraftV2,
} from './trip-request-draft-v2-runtime';

function emptyDraft(): TripRequestDraftV2 {
  const draft = structuredClone(exampleDraft) as TripRequestDraftV2;
  draft.destination = { text: null, supportedCity: null };
  draft.days = null;
  draft.date = { text: null, isoDate: null, resolution: 'missing' };
  draft.originText = null;
  draft.dailyStartText = null;
  draft.dailyStartMinutes = null;
  draft.geography = { scope: null, strength: null };
  draft.pace = null;
  draft.venuePreference = null;
  for (const key of Object.keys(draft.experiencePreferences))
    (draft.experiencePreferences as Record<string, null>)[key] = null;
  draft.lowWalking = null;
  draft.family = null;
  draft.avoidCrowds = null;
  draft.party = { adultFullFareCount: null, concessionEligibleCount: null, childAges: [], ptvPaymentMedium: null };
  draft.budget = { currency: null, totalCents: null };
  draft.costAssumptions = { accommodation: null, food: null };
  draft.mustIncludeNames = [];
  draft.excludeNames = [];
  draft.unhandledRequirements = [];
  draft.unresolvedPhrases = [];
  draft.evidence = [];
  return draft;
}

function validate(draft: TripRequestDraftV2, text: string) {
  const schema = validateDraftSchema(draft);
  if (!schema.ok) return schema;
  const evidence = validateDraftEvidence(schema.draft, text);
  if (!evidence.ok) return evidence;
  return validateDraftSemantics(schema.draft, text);
}

describe('rules/model alignment', () => {
  it('accepts 下午才开始 left without minutes; the confirmed start stays 13:00 from the rules', () => {
    const text = '从 East Melbourne 出发，下午才开始，玩 1 天，想看花园和历史地点。';
    const draft = emptyDraft();
    draft.days = 1;
    draft.originText = '从 East Melbourne 出发';
    draft.dailyStartText = '下午才开始';
    draft.experiencePreferences.parks_gardens = 'prefer';
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.evidence = [
      { path: '/days', quote: '玩 1 天', occurrence: 1 },
      { path: '/originText', quote: '从 East Melbourne 出发', occurrence: 1 },
      { path: '/dailyStartText', quote: '下午才开始', occurrence: 1 },
      { path: '/experiencePreferences/parks_gardens', quote: '想看花园', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '历史地点', occurrence: 1 },
    ];
    expect(validate(draft, text)).toEqual({ ok: true });
    const request = normalizeDraftToParsedTripRequest(draft, text);
    expect(request.dailyWindow.startMinutes).toBe(13 * 60);
    expect(request.dailyWindow.startSource).toBe('text');
    expect(request.errors).toEqual([]);
  });

  it('still rejects a model that turns an explicit clock time into null', () => {
    const text = '我住 CBD，只玩 1 天，11 点开始，想看历史。';
    const draft = emptyDraft();
    draft.days = 1;
    draft.originText = 'CBD';
    draft.dailyStartText = '11 点开始';
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.evidence = [
      { path: '/days', quote: '只玩 1 天', occurrence: 1 },
      { path: '/originText', quote: '我住 CBD', occurrence: 1 },
      { path: '/dailyStartText', quote: '11 点开始', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '想看历史', occurrence: 1 },
    ];
    expect(validate(draft, text).ok).toBe(false);
  });

  it('binds a place written before 必须去 / 一定要排进 to its intent', () => {
    const text = '玩 1 天，Federation Square 必须去，喜欢历史。';
    const draft = emptyDraft();
    draft.days = 1;
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.mustIncludeNames = ['Federation Square'];
    draft.evidence = [
      { path: '/days', quote: '玩 1 天', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '喜欢历史', occurrence: 1 },
      { path: '/mustIncludeNames', quote: 'Federation Square 必须去', occurrence: 1, itemIndex: 0 },
    ];
    expect(validate(draft, text)).toEqual({ ok: true });

    const gor = '只玩 2 天，但大洋路一定要排进墨尔本市区行程。';
    const unknown = emptyDraft();
    unknown.days = 2;
    unknown.mustIncludeNames = ['大洋路'];
    unknown.evidence = [
      { path: '/days', quote: '只玩 2 天', occurrence: 1 },
      { path: '/mustIncludeNames', quote: '大洋路一定要排进', occurrence: 1, itemIndex: 0 },
    ];
    const result = validate(unknown, gor);
    // Evidence binding must pass; the unknown place is then blocked downstream, not silently dropped.
    if (!result.ok) expect(result.issue.path).not.toBe('/mustIncludeNames');
  });
});

describe('harmless draft hygiene (local qwen3.5:9b, prompt v2.10)', () => {
  it('drops evidence for fields the model left null instead of rejecting the draft', () => {
    const text = '我住 CBD，只玩 1 天，11 点开始，想看历史和艺术，别太赶。';
    const draft = emptyDraft();
    draft.days = 1;
    draft.originText = 'CBD';
    draft.dailyStartText = '11 点开始';
    draft.dailyStartMinutes = 660;
    draft.pace = 'relaxed';
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.evidence = [
      { path: '/days', quote: '只玩 1 天', occurrence: 1 },
      { path: '/originText', quote: '我住 CBD', occurrence: 1 },
      { path: '/dailyStartText', quote: '11 点开始', occurrence: 1 },
      { path: '/dailyStartMinutes', quote: '11 点开始', occurrence: 1 },
      { path: '/pace', quote: '别太赶', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '想看历史', occurrence: 1 },
      // museum_exhibition stayed null, but the model still cited 艺术.
      { path: '/experiencePreferences/museum_exhibition', quote: '艺术', occurrence: 1 },
      { path: '/date/resolution', quote: '11 点开始', occurrence: 1 },
    ];
    const schema = validateDraftSchema(draft);
    expect(schema.ok).toBe(true);
    if (!schema.ok) return;
    expect(schema.draft.evidence.map((item) => item.path)).not.toContain(
      '/experiencePreferences/museum_exhibition',
    );
    expect(validate(draft, text)).toEqual({ ok: true });
  });

  it('does not let an unresolved 下午才开始 block a plan the rules can make', () => {
    const text = '从 East Melbourne 出发，下午才开始，玩 1 天，想看花园和历史地点。';
    const draft = emptyDraft();
    draft.days = 1;
    draft.originText = '从 East Melbourne 出发';
    draft.dailyStartText = '下午才开始';
    draft.unresolvedPhrases = ['下午才开始'];
    draft.experiencePreferences.parks_gardens = 'prefer';
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.evidence = [
      { path: '/days', quote: '玩 1 天', occurrence: 1 },
      { path: '/originText', quote: '从 East Melbourne 出发', occurrence: 1 },
      { path: '/dailyStartText', quote: '下午才开始', occurrence: 1 },
      { path: '/experiencePreferences/parks_gardens', quote: '想看花园', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '历史地点', occurrence: 1 },
      { path: '/unresolvedPhrases', quote: '下午才开始', occurrence: 1, itemIndex: 0 },
    ];
    expect(validate(draft, text)).toEqual({ ok: true });
    const request = normalizeDraftToParsedTripRequest(draft, text);
    expect(request.errors).toEqual([]);
    expect(request.dailyWindow.startMinutes).toBe(13 * 60);
  });
});

describe('a model result must not be worse than the rules (docs/44 §9.4, task 19)', () => {
  const adapterFor = (draft: TripRequestDraftV2): NluDraftAdapter => ({
    extractDraft: async () => ({
      ok: true,
      draft,
      promptVersion: 'test',
      datasetVersion: POI_DATASET.dataVersion,
    }),
  });

  it('falls back to rules when only a filler phrase like 先生成 would block the plan', async () => {
    const text = '先生成 2 天历史与花园行程。';
    const draft = emptyDraft();
    draft.days = 2;
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.experiencePreferences.parks_gardens = 'prefer';
    draft.unresolvedPhrases = ['先生成'];
    draft.evidence = [
      { path: '/days', quote: '2 天', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '历史', occurrence: 1 },
      { path: '/experiencePreferences/parks_gardens', quote: '花园', occurrence: 1 },
      { path: '/unresolvedPhrases', quote: '先生成', occurrence: 1, itemIndex: 0 },
    ];
    const outcome = await interpretTripRequest({ rawText: text, sourceFingerprint: 'fp', adapter: adapterFor(draft) });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics.acceptedMode).toBe('rules');
    expect(outcome.diagnostics.fallbackReasonCode).toBe('worse_than_rules');
    expect(outcome.request.errors).toEqual([]);
  });

  it('keeps blocking a vague start time the rules would silently default', async () => {
    const text = '墨尔本玩 2 天，晚一点出门，喜欢历史。';
    const draft = emptyDraft();
    draft.destination = { text: '墨尔本', supportedCity: 'Melbourne' };
    draft.days = 2;
    draft.dailyStartText = '晚一点出门';
    draft.experiencePreferences.history_heritage = 'prefer';
    draft.unresolvedPhrases = ['晚一点出门'];
    draft.evidence = [
      { path: '/destination/text', quote: '墨尔本', occurrence: 1 },
      { path: '/destination/supportedCity', quote: '墨尔本', occurrence: 1 },
      { path: '/days', quote: '玩 2 天', occurrence: 1 },
      { path: '/dailyStartText', quote: '晚一点出门', occurrence: 1 },
      { path: '/experiencePreferences/history_heritage', quote: '喜欢历史', occurrence: 1 },
      { path: '/unresolvedPhrases', quote: '晚一点出门', occurrence: 1, itemIndex: 0 },
    ];
    const outcome = await interpretTripRequest({ rawText: text, sourceFingerprint: 'fp', adapter: adapterFor(draft) });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics.acceptedMode).toBe('llm');
    expect(outcome.request.errors.join()).toContain('晚一点出门');
  });
});
