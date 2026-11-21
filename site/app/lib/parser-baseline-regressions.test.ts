/**
 * Regressions found by the 30-task rules baseline (docs/44, 2026-09-28).
 * Each case quotes the eval task text so a failure maps back to the report.
 */
import { describe, expect, it } from 'vitest';

import { parseTripRequest, planTrip } from './planner';

const FED = 'mel-cbd-federation-square';
const AQUARIUM = 'mel-melbourne-aquarium-ce537795';

describe('baseline regressions: origin parsing (P6/P7)', () => {
  it('does not treat 按住 or 住宿 phrases as the local origin (tasks 16/22/24)', () => {
    const t16 = parseTripRequest(
      '先按住 CBD、玩 3 天、喜欢艺术给我行程；再比较几个适合的酒店，只要星级、设施、位置和特色，不用房价。',
    );
    expect(t16.errors).toEqual([]);
    expect(t16.origin.refId).toBe('mel-cbd-proxy-flinders');
    expect(t16.origin.source).toBe('text');

    const t22 = parseTripRequest(
      '现在预算降到 A$150、室内优先，玩 2 天；住宿预计每晚 A$100–150、住 1 晚，餐饮每人每天 A$30–50，请重新估算。',
    );
    expect(t22.errors).toEqual([]);

    const t24 = parseTripRequest(
      '给第一次来墨尔本的我做 3 天方案：行程、住宿属性、当期活动、交通避坑、行李购物和逐项预算都放在一起。',
    );
    expect(t24.errors).toEqual([]);
  });

  it('still reads 住宿在 / 住 as the origin when a place follows', () => {
    expect(parseTripRequest('住宿在 Southbank，玩 1 天').origin.refId).toBe(
      'mel-southbank-proxy-skydeck',
    );
    expect(parseTripRequest('住 Carlton，玩 2 天').origin.refId).toBe(
      'mel-carlton-proxy-museum',
    );
  });

  it('treats 从上海出发来墨尔本 as a departure city, not a Melbourne origin (task 17)', () => {
    const r = parseTripRequest(
      '我从上海出发，2026-12-05 来墨尔本玩 3 天，带一名孩子；按季节列行李，并说可以买什么、去哪类地方买。',
    );
    expect(r.errors).toEqual([]);
    expect(r.origin.source).toBe('default');
    expect(r.warnings.join()).toContain('上海');
  });

  it('keeps rejecting an unknown local origin', () => {
    expect(parseTripRequest('从 Footscray 出发玩 1 天').errors.length).toBe(1);
  });
});

describe('baseline regressions: hard POI constraints (P1/P2/P5)', () => {
  it('reads a POI written before 必须去 and blocks the must/avoid conflict (task 28)', () => {
    const r = parseTripRequest(
      '玩 1 天，Federation Square 必须去，但也必须避开 Federation Square。',
    );
    expect(r.mustIncludePoiIds).toContain(FED);
    expect(r.excludePoiIds).toContain(FED);
    expect(planTrip(r).ok).toBe(false);
  });

  it('flags an out-of-catalogue place written before 一定要 (task 27)', () => {
    const r = parseTripRequest('只玩 2 天，但大洋路一定要排进墨尔本市区行程。');
    expect(r.unknownHardConstraints).toContain('大洋路');
    expect(planTrip(r).ok).toBe(false);
  });

  it('does not invent an unknown constraint from filler before 一定要去', () => {
    const r = parseTripRequest('玩 1 天，我一定要去 NGV International。');
    expect(r.unknownHardConstraints).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('resolves 水族馆 to the catalogued aquarium (task 08)', () => {
    const r = parseTripRequest(
      '只有 1 天，我想看艺术，必去 NGV International，避开水族馆，最后想买点当地特色东西。',
    );
    expect(r.errors).toEqual([]);
    expect(r.excludePoiIds).toContain(AQUARIUM);
  });
});

describe('baseline regressions: preferences, time, budget, party (P3/P4/P8/P9/P10)', () => {
  it('turns 不想去室内博物馆 into an avoided facet, not a preferred one (task 07)', () => {
    const r = parseTripRequest('我玩 3 天，更喜欢公园和城市风景，不想去室内博物馆。');
    expect(r.experiencePreferences.museum_exhibition).toBe('avoid');
    expect(r.experiencePreferences.parks_gardens).toBe('prefer');
    const plan = planTrip(r);
    expect(plan.ok).toBe(true);
  });

  it('does not silently start at 09:30 when the traveller says 下午 (tasks 05/11)', () => {
    for (const text of [
      '从 East Melbourne 出发，下午才开始，玩 1 天，想看花园和历史地点。',
      '陪长辈在市区玩 2 天，下午出发，尽量少走路。',
    ]) {
      const r = parseTripRequest(text);
      expect(r.dailyWindow.startSource).toBe('text');
      expect(r.dailyWindow.startMinutes).toBe(13 * 60);
    }
    expect(parseTripRequest('下午1点出发，玩 1 天').dailyWindow.startMinutes).toBe(13 * 60);
  });

  it('reads 预算降到 A$150 (task 22)', () => {
    expect(parseTripRequest('预算降到 A$150，玩 2 天').totalBudgetCents).toBe(15000);
  });

  it('does not mark tickets complete when an uncounted child travels (task 03)', () => {
    const r = parseTripRequest('住 Carlton，带孩子玩 3 天，想看博物馆和花园。');
    expect(r.pricingParty.ticketBreakdownStatus).not.toBe('complete');
  });

  it('reads 安排室内活动 as an indoor preference (task 06)', () => {
    const r = parseTripRequest('2026-10-17 来 2 天，带孩子，担心下雨；安排室内活动。');
    expect(['indoor', 'strong_indoor']).toContain(r.venuePreference.value);
  });
});

describe('found via local model eval (docs/44 §9.4)', () => {
  it('does not read 晚一点出门 as a 1 o\'clock start', () => {
    const r = parseTripRequest('墨尔本玩 2 天，晚一点出门，喜欢历史。');
    expect(r.errors).toEqual([]);
    expect(r.dailyWindow.startSource).toBe('default');
    expect(parseTripRequest('下午一点出发，玩 1 天').dailyWindow.startMinutes).toBe(13 * 60);
  });
});
