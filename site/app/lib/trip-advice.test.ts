import { describe, expect, it } from 'vitest';

import {
  parseTripRequest,
  planTrip,
  replaceStopWithPoi,
  auditReplacementOptions,
  type PlannerResult,
} from './planner';
import { buildTripAdvice, melbourneSeason } from './trip-advice';

const TODAY = '2026-09-28';

function plan(text: string): PlannerResult {
  const outcome = planTrip(parseTripRequest(text));
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.result;
}

function withTransit(result: PlannerResult): boolean {
  return result.days.some((day) =>
    day.stops.some((stop) => stop.travelFromPrevious.mode === 'public_transport'),
  );
}

describe('melbourneSeason', () => {
  it('uses southern-hemisphere seasons', () => {
    expect(melbourneSeason('2026-01-10')).toBe('summer');
    expect(melbourneSeason('2026-04-10')).toBe('autumn');
    expect(melbourneSeason('2026-07-10')).toBe('winter');
    expect(melbourneSeason('2026-10-17')).toBe('spring');
    expect(melbourneSeason('2026-12-05')).toBe('summer');
  });
});

describe('transport advice (eval tasks 15/18)', () => {
  const result = plan('第一次来墨尔本玩 2 天，主要坐电车，喜欢历史和花园。');

  it('only gives transit tips when the plan actually uses public transport', () => {
    const advice = buildTripAdvice(result, TODAY);
    expect(withTransit(result)).toBe(true);
    const walkOnly = plan('2026-10-06 来墨尔本玩 1 天，必去 Queen Victoria Market。');
    expect(withTransit(walkOnly)).toBe(false);
    expect(buildTripAdvice(walkOnly, TODAY).transport).toEqual([]);
    if (withTransit(result)) {
      expect(advice.transport.map((card) => card.id)).toEqual([
        'transport-payment',
        'transport-tap-rules',
        'transport-free-tram-zone',
        'transport-half-price',
      ]);
    } else {
      expect(advice.transport).toEqual([]);
    }
  });

  it('never claims a specific leg is inside the Free Tram Zone', () => {
    const card = buildTripAdvice(result, TODAY).transport.find(
      (item) => item.id === 'transport-free-tram-zone',
    );
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.body).toContain('不能替你判断');
    expect(card.sources.map((s) => s.url).join()).toContain('transport.vic.gov.au');
  });

  it('every official card carries a source and a trigger; stale after review date', () => {
    const fresh = buildTripAdvice(result, TODAY);
    for (const card of fresh.transport) {
      expect(card.sources.length).toBeGreaterThan(0);
      expect(card.trigger.length).toBeGreaterThan(0);
      expect(card.status).toBe('verified');
    }
    const later = buildTripAdvice(result, '2027-03-01');
    for (const card of later.transport) expect(card.status).toBe('stale');
  });

  it('flags trips after the half-price end date', () => {
    const late = plan('2027-01-05 来墨尔本玩 2 天，主要坐电车，喜欢历史和花园。');
    const card = buildTripAdvice(late, TODAY).transport.find(
      (item) => item.id === 'transport-half-price',
    );
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.title).toContain('结束之后');
    expect(card.priority).toBe('high');
  });
});

describe('packing list (eval tasks 06/17)', () => {
  it('gives a generic list without a date and says how to improve it', () => {
    const advice = buildTripAdvice(plan('墨尔本玩 1 天，喜欢花园。'), TODAY);
    expect(advice.packing.season).toBeNull();
    expect(advice.packing.note).toContain('还没填出行日期');
    expect(advice.packing.items.every((item) => item.reason.length > 0)).toBe(true);
  });

  it('adapts to season, children and rain worries, and never predicts weather', () => {
    const advice = buildTripAdvice(
      plan('2026-10-17 来 2 天，带孩子，担心下雨；安排室内活动。'),
      TODAY,
    );
    const ids = advice.packing.items.map((item) => item.id);
    expect(advice.packing.season).toBe('spring');
    expect(ids).toContain('sun');
    expect(ids).toContain('kids');
    expect(ids).toContain('rain-backup');
    expect(advice.packing.note).toContain('不是天气预报');
    const winter = buildTripAdvice(plan('2026-07-10 来墨尔本玩 1 天，喜欢历史。'), TODAY);
    expect(winter.packing.items.map((item) => item.id)).toContain('warm');
  });
});

describe('shopping advice (eval tasks 08/17)', () => {
  it('only appears when the traveller mentions shopping or visits the market', () => {
    const none = buildTripAdvice(plan('墨尔本玩 1 天，喜欢花园。'), TODAY);
    expect(none.shopping).toEqual([]);
    const wants = buildTripAdvice(
      plan('只有 1 天，我想看艺术，必去 NGV International，最后想买点当地特色东西。'),
      TODAY,
    );
    expect(wants.shopping.map((card) => card.id)).toEqual(
      expect.arrayContaining(['shopping-categories', 'shopping-refund-customs']),
    );
    const asksWhere = buildTripAdvice(
      plan('2026-12-05 来墨尔本玩 3 天；按季节列行李，并说可以买什么、去哪类地方买。'),
      TODAY,
    );
    expect(asksWhere.shopping.map((card) => card.id)).toContain('shopping-categories');
    const categories = wants.shopping.find((card) => card.id === 'shopping-categories');
    expect(categories?.body).toContain('不掌握具体店铺');
  });

  it('warns when Queen Victoria Market falls on a non-trading day', () => {
    // The planner no longer schedules the market on a known closed day when a
    // date is given; this guards the advice layer if data and date disagree.
    const open = plan('2026-10-06 来墨尔本玩 1 天，必去 Queen Victoria Market。');
    const openCard = buildTripAdvice(open, TODAY).shopping.find(
      (item) => item.id === 'shopping-qvm',
    );
    expect(openCard?.title).not.toContain('可能不开市');
    const inconsistent = structuredClone(open);
    inconsistent.request.dateText = '2026-10-05'; // a Monday
    const card = buildTripAdvice(inconsistent, TODAY).shopping.find(
      (item) => item.id === 'shopping-qvm',
    );
    expect(card?.title).toContain('可能不开市');
    expect(card?.priority).toBe('high');
  });

  it('shows the market on the trading day the planner chose', () => {
    const result = plan('2026-10-05 来墨尔本玩 2 天，必去 Queen Victoria Market，喜欢历史。');
    const card = buildTripAdvice(result, TODAY).shopping.find((item) => item.id === 'shopping-qvm');
    expect(card?.title).not.toContain('可能不开市');
    expect(card?.body).toContain('2026-10-06');
  });

  it('is recomputed from the replaced result (TripBundle consistency)', () => {
    const result = plan('2026-10-06 来墨尔本玩 1 天，必去 Queen Victoria Market，喜欢历史。');
    const qvmStop = result.days[0].stops.findIndex((stop) => stop.poiId === 'mel-cbd-qvm');
    const others = result.days[0].stops
      .map((stop, index) => ({ stop, index }))
      .filter(({ index }) => index !== qvmStop);
    const target = others[0];
    const option = auditReplacementOptions(result, 0, target.index).eligible[0];
    if (!option) return;
    const replaced = replaceStopWithPoi(result, 0, target.index, option.poi.id);
    expect(replaced.ok).toBe(true);
    const before = buildTripAdvice(result, TODAY);
    const after = buildTripAdvice(replaced.result, TODAY);
    expect(after.shopping.map((c) => c.id)).toEqual(before.shopping.map((c) => c.id));
  });
});
