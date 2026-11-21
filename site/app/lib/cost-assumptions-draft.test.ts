/**
 * “假模型输出”测试：不调用任何真实模型，用手写的 TripRequestDraft v2（v2.9 提示词形状）
 * 检查住宿/餐饮估算能否安全地走模型路径——对得上原文时被采纳，编造或漏掉时整次回退规则。
 */
import exampleDraft from '../../../data/examples/trip-request-v2.example.json';
import { describe, expect, it } from 'vitest';

import type { NluDraftAdapter } from './nlu-contract';
import { interpretTripRequest } from './nlu-orchestrator';
import { POI_DATASET, planTrip } from './planner';
import {
  normalizeDraftToParsedTripRequest,
  validateDraftEvidence,
  validateDraftSchema,
  validateDraftSemantics,
  type TripRequestDraftV2,
} from './trip-request-draft-v2-runtime';

const BASE =
  '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
const RAW = `${BASE}；住宿每晚 A$100-150、住 1 晚，餐饮每人每天 A$30-50`;

function draftWithCosts(): TripRequestDraftV2 {
  const draft = structuredClone(exampleDraft) as TripRequestDraftV2;
  draft.costAssumptions = {
    accommodation: { perNightMinCents: 10000, perNightMaxCents: 15000, nights: 1 },
    food: { perPersonPerDayMinCents: 3000, perPersonPerDayMaxCents: 5000 },
  };
  draft.evidence.push(
    { path: '/costAssumptions/accommodation', quote: '住宿每晚 A$100-150', occurrence: 1 },
    { path: '/costAssumptions/accommodation/nights', quote: '住 1 晚', occurrence: 1 },
    { path: '/costAssumptions/food', quote: '餐饮每人每天 A$30-50', occurrence: 1 },
  );
  return draft;
}

function validate(draft: unknown, text: string) {
  const schema = validateDraftSchema(draft);
  if (!schema.ok) return schema;
  const evidence = validateDraftEvidence(schema.draft, text);
  if (!evidence.ok) return evidence;
  return validateDraftSemantics(schema.draft, text);
}

function adapterFor(draft: unknown): NluDraftAdapter {
  return {
    extractDraft: async () => ({
      ok: true,
      draft,
      promptVersion: 'nlu-extraction-system-v2.9',
      datasetVersion: POI_DATASET.dataVersion,
    }),
  };
}

describe('costAssumptions on the model path (fake model output, no API calls)', () => {
  it('accepts a draft whose assumptions match the text and carries them into the plan', async () => {
    const draft = draftWithCosts();
    expect(validate(draft, RAW)).toEqual({ ok: true });
    const normalized = normalizeDraftToParsedTripRequest(draft, RAW);
    expect(normalized.costAssumptions?.accommodation).toMatchObject({
      perNightMinCents: 10000,
      nights: 1,
      source: 'text',
      evidence: '住宿每晚 A$100-150',
    });

    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'fp',
      adapter: adapterFor(draft),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics.acceptedMode).toBe('llm');
    expect(outcome.request.costAssumptions?.food?.perPersonPerDayMaxCents).toBe(5000);
    const plan = planTrip(outcome.request);
    expect(plan.ok).toBe(true);
    if (plan.ok)
      expect(plan.result.budget.assumptionItems.map((item) => item.id)).toEqual([
        'accommodation',
        'food',
      ]);
  });

  it('falls back to rules when the model drops assumptions the text states', async () => {
    const draft = draftWithCosts();
    draft.costAssumptions = { accommodation: null, food: null };
    draft.evidence = draft.evidence.filter((item) => !item.path.startsWith('/costAssumptions'));
    const result = validate(draft, RAW);
    expect(result.ok).toBe(false);
    const outcome = await interpretTripRequest({
      rawText: RAW,
      sourceFingerprint: 'fp',
      adapter: adapterFor(draft),
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status !== 'complete') return;
    expect(outcome.diagnostics.acceptedMode).toBe('rules');
    expect(outcome.diagnostics.fallbackReasonCode).toBe('semantic_rejected');
    // The rules path still reads the assumptions, so nothing is lost.
    expect(outcome.request.costAssumptions?.accommodation?.nights).toBe(1);
  });

  it('rejects nights the traveller never stated', () => {
    const text = `${BASE}；住宿每晚 A$100-150`;
    const draft = draftWithCosts();
    draft.costAssumptions.food = null;
    draft.costAssumptions.accommodation = { perNightMinCents: 10000, perNightMaxCents: 15000, nights: 3 };
    draft.evidence = draft.evidence
      .filter((item) => item.path !== '/costAssumptions/food')
      .map((item) =>
        item.path === '/costAssumptions/accommodation/nights'
          ? { ...item, quote: '玩 3 天' }
          : item,
      );
    const result = validate(draft, text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('/costAssumptions/accommodation/nights');
  });

  it('rejects evidence that does not show a per-night AUD amount', () => {
    const draft = draftWithCosts();
    draft.evidence = draft.evidence.map((item) =>
      item.path === '/costAssumptions/accommodation' ? { ...item, quote: '住 1 晚' } : item,
    );
    const result = validate(draft, RAW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('/costAssumptions/accommodation');
  });

  it('rejects a model that converts a non-AUD lodging price', () => {
    const text = `${BASE}；住宿每晚 500 人民币`;
    const draft = draftWithCosts();
    draft.costAssumptions = {
      accommodation: { perNightMinCents: 50000, perNightMaxCents: 50000, nights: null },
      food: null,
    };
    draft.evidence = draft.evidence
      .filter((item) => item.path === '/costAssumptions/accommodation' || !item.path.startsWith('/costAssumptions'))
      .map((item) =>
        item.path === '/costAssumptions/accommodation' ? { ...item, quote: '住宿每晚 500 人民币' } : item,
      );
    // Keep the pre-existing non-AUD rule satisfied so the failure is ours.
    const index = draft.unhandledRequirements.length;
    draft.unhandledRequirements.push({ kind: 'budget', text: '住宿每晚 500 人民币', hardness: 'unclear' });
    draft.evidence.push({ path: '/unhandledRequirements', quote: '住宿每晚 500 人民币', occurrence: 1, itemIndex: index });
    const result = validate(draft, text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('/costAssumptions/accommodation');
  });

  it('treats a v2.8-shaped draft without costAssumptions as a schema failure', () => {
    const old = structuredClone(exampleDraft) as Record<string, unknown>;
    delete old.costAssumptions;
    expect(validateDraftSchema(old).ok).toBe(false);
  });
});
