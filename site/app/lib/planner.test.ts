import { describe, expect, it } from 'vitest';

import {
  ADMISSION_PRICE_SNAPSHOT,
  POI_DATASET,
  PTV_FARE_SNAPSHOT,
  auditReplacementOptions,
  experienceFacetCounts,
  isCentralCityPoi,
  listReplacementOptions,
  mergeStructuredTripRequest,
  parseTripRequest,
  planTrip,
  replaceStop,
  replaceStopWithPoi,
  type PlannerResult,
} from './planner';

function validResult(text: string): PlannerResult {
  const outcome = planTrip(parseTripRequest(text));
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.result;
}

describe('parseTripRequest', () => {
  it.each([
    ['两个人', 2, 0, [], 'unknown'],
    ['2 人同行', 2, 0, [], 'unknown'],
    ['两位成人', 2, 2, [], 'complete'],
    ['两位大人', 2, 2, [], 'complete'],
    ['两个大人带一个 8 岁孩子', 3, 2, [8], 'complete'],
    ['一大一小', 2, 1, [], 'partial'],
    ['两个人，其中一个是 8 岁孩子', 2, 0, [8], 'partial'],
    ['两个大人带两个孩子', 4, 2, [], 'partial'],
  ] as const)('keeps total and fare categories separate: %s', (phrase, total, adults, ages, status) => {
    const request = parseTripRequest(`墨尔本玩 1 天，${phrase}`);
    expect(request.pricingParty).toMatchObject({
      totalTravelers: total,
      adultFullFareCount: adults,
      childAges: ages,
      ticketBreakdownStatus: status,
    });
    expect(request.errors).toEqual([]);
    const outcome = planTrip(request);
    expect(outcome.ok).toBe(true);
    if (outcome.ok && status !== 'complete') {
      expect(outcome.result.budget.admissionRange.minCents).toBeNull();
      expect(outcome.result.budget.transitRange.maxCents).toBeNull();
      expect(outcome.result.budget.comparison).not.toBe('known_components_within_limit');
    }
  });

  it('flags a disagreement between described and selected party size', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 1 天，两个人'),
      { pricingParty: { adultFullFareCount: 3, concessionEligibleCount: 0, childAges: [] } },
    );
    expect(request.settingConflicts).toEqual([
      expect.objectContaining({ field: 'party' }),
    ]);
    expect(request.errors.join('')).toContain('同行人数');
  });

  it.each([
    ['墨尔本玩 1 天，喜欢艺术', 1],
    ['墨尔本玩两天，喜欢历史', 2],
    ['墨尔本三天，喜欢花园', 3],
  ])('parses supported duration: %s', (text, days) => {
    const request = parseTripRequest(text);
    expect(request.days).toBe(days);
    expect(request.errors).toEqual([]);
  });

  it.each(['别太赶', '别排太满', '悠闲地逛', '不赶时间'])(
    'keeps a clearly slower schedule when rules take over: %s',
    (phrase) => {
      const request = parseTripRequest(`墨尔本玩 2 天，行程${phrase}`);
      expect(request.pace).toBe('relaxed');
      expect(request.paceSource).toBe('text');
    },
  );

  it('does not treat a contradictory packed schedule as relaxed', () => {
    const request = parseTripRequest('墨尔本玩 2 天，别太赶，但行程紧凑');
    expect(request.pace).toBe('packed');
  });

  it('requires clarification when days are missing', () => {
    const request = parseTripRequest('想在墨尔本看看艺术和花园');
    const outcome = planTrip(request);
    expect(request.days).toBeNull();
    expect(request.needsClarification).toContain('days');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe('clarification');
  });

  it.each([
    '墨尔本玩 2 天，预算 500 日元',
    '墨尔本玩 2 天，budget GBP 500',
    '墨尔本玩 2 天，预算 500 港币',
    '墨尔本玩 2 天，预算 USD 500',
  ])(
    'blocks an explicit non-AUD budget without treating it as AUD: %s',
    (text) => {
      const request = parseTripRequest(text);
      expect(request.totalBudgetCents).toBeNull();
      expect(request.errors.join('')).toContain('只支持 AUD');
      expect(planTrip(request).ok).toBe(false);
    },
  );

  it('still accepts an explicit AUD budget', () => {
    const request = parseTripRequest('墨尔本玩 2 天，预算 A$500');
    expect(request.totalBudgetCents).toBe(50_000);
    expect(request.errors).toEqual([]);
  });

  it('does not turn explicit negations into traveler needs', () => {
    const request = parseTripRequest(
      '墨尔本玩 2 天，没有孩子，不需要少走路，也不需要避开人多',
    );
    expect(request.family).toBe(false);
    expect(request.lowWalking).toBe(false);
    expect(request.avoidCrowds).toBe(false);
  });

  it('blocks an impossible ISO calendar date', () => {
    const request = parseTripRequest('墨尔本玩 2 天，2026-02-31 出发');
    expect(request.dateText).toBe('2026-02-31');
    expect(request.errors.join('')).toContain('日期无效');
    expect(planTrip(request).ok).toBe(false);
  });

  it('rejects another city without silently changing it', () => {
    const request = parseTripRequest('悉尼玩两天，喜欢海边');
    const outcome = planTrip(request);
    expect(request.city).toBe('Sydney');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.kind).toBe('scope');
  });

  it('preserves and rejects a four-day request', () => {
    const request = parseTripRequest('墨尔本玩四天');
    expect(request.days).toBe(4);
    expect(planTrip(request).ok).toBe(false);
  });

  it('parses known must-include and exclude POIs as hard constraints', () => {
    const request = parseTripRequest(
      '墨尔本三天，第一天一定要去 NGV，不要去 Queen Victoria Market',
    );
    expect(request.mustIncludePoiIds).toEqual(['mel-arts-ngv-international']);
    expect(request.excludePoiIds).toEqual(['mel-cbd-qvm']);
    const outcome = planTrip(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ids = outcome.result.days.flatMap((day) =>
      day.stops.map((stop) => stop.poiId),
    );
    expect(
      ids.filter((id) => id === 'mel-arts-ngv-international'),
    ).toHaveLength(1);
    expect(ids).not.toContain('mel-cbd-qvm');
    expect(
      outcome.result.checks.find((check) =>
        check.id.startsWith('must_include:'),
      )?.status,
    ).toBe('pass');
    expect(
      outcome.result.checks.find((check) => check.id.startsWith('exclude:'))
        ?.status,
    ).toBe('pass');
  });

  it('parses explicitly bound party counts without using generic people or children', () => {
    const request = parseTripRequest(
      '墨尔本玩 2 天，2 位成人，不使用优惠票，一定去 NGV，不要去 SEA LIFE',
    );
    expect(request.pricingParty).toMatchObject({
      adultFullFareCount: 2,
      concessionEligibleCount: 0,
      source: 'text',
    });
    expect(request.mustIncludePoiIds).toEqual(['mel-arts-ngv-international']);
    expect(request.excludePoiIds).toEqual(['mel-melbourne-aquarium-ce537795']);
    expect(request.errors).toEqual([]);
    expect(
      parseTripRequest('墨尔本玩 1 天，2个人，一家人，两个孩子').pricingParty,
    ).toMatchObject({
      totalTravelers: 2,
      ticketBreakdownStatus: 'unknown',
      adultFullFareCount: 0,
      concessionEligibleCount: 0,
      source: 'text',
    });
  });

  it('rejects conflicting or out-of-range bound counts and an empty party', () => {
    expect(
      parseTripRequest('墨尔本玩 1 天，两位成人、一位优惠票').pricingParty,
    ).toMatchObject({
      adultFullFareCount: 2,
      concessionEligibleCount: 1,
      source: 'text',
    });
    expect(
      parseTripRequest('墨尔本玩 1 天，不使用优惠票').pricingParty,
    ).toMatchObject({
      adultFullFareCount: 1,
      concessionEligibleCount: 0,
      source: 'text',
    });
    expect(
      parseTripRequest('墨尔本玩 1 天，2 位成人，3 位成人').errors.join(''),
    ).toContain('冲突');
    expect(
      parseTripRequest('墨尔本玩 1 天，21 位成人').errors.join(''),
    ).toContain('0–20');
    expect(
      parseTripRequest('墨尔本玩 1 天，1000 位成人').errors.join(''),
    ).toContain('0–20');
    expect(
      parseTripRequest('墨尔本玩 1 天，一百位成人').errors.join(''),
    ).toContain('0–20');
    expect(
      parseTripRequest('墨尔本玩 1 天，0 位成人，不使用优惠票').errors.join(''),
    ).toContain('至少需要');
  });

  it('recognizes 一定去 while protecting negated must wording', () => {
    expect(
      parseTripRequest('墨尔本玩 1 天，一定去 NGV').mustIncludePoiIds,
    ).toEqual(['mel-arts-ngv-international']);
    expect(
      parseTripRequest('墨尔本玩 1 天，不一定去 NGV').mustIncludePoiIds,
    ).toEqual([]);
    expect(
      parseTripRequest('墨尔本玩 1 天，不必去 NGV').mustIncludePoiIds,
    ).toEqual([]);
    expect(
      parseTripRequest('墨尔本玩 1 天，未必去 NGV').mustIncludePoiIds,
    ).toEqual([]);
  });

  it('blocks a conflicting hard constraint on the same POI', () => {
    const request = parseTripRequest('墨尔本玩 2 天，必去 NGV，不要去 NGV');
    expect(request.errors.join('')).toContain('同时设为必去和避开');
    expect(planTrip(request).ok).toBe(false);
  });

  it('blocks an unknown hard-constraint place', () => {
    const request = parseTripRequest('墨尔本玩 1 天，必去 Luna Park');
    expect(request.unknownHardConstraints).toEqual(['Luna Park']);
    expect(planTrip(request).ok).toBe(false);
  });

  it('matches both the current and source names of an expanded POI', () => {
    const currentName = parseTripRequest(
      '墨尔本玩 1 天，必去 Melbourne Skydeck',
    );
    const sourceName = parseTripRequest(
      '墨尔本玩 1 天，必去 Eureka Skydeck 88',
    );
    expect(currentName.mustIncludePoiIds).toEqual([
      'mel-eureka-skydeck-88-dc7ebb76',
    ]);
    expect(sourceName.mustIncludePoiIds).toEqual([
      'mel-eureka-skydeck-88-dc7ebb76',
    ]);
    expect(planTrip(currentName).ok).toBe(true);
    expect(planTrip(sourceName).ok).toBe(true);
  });

  it('does not turn negated interests or a casual want into positive hard preferences', () => {
    const request = parseTripRequest('墨尔本玩 1 天，不喜欢历史，想去 NGV');
    expect(request.categoryPreferences.history).toBe('neutral');
    expect(request.mustIncludePoiIds).toEqual([]);
  });

  it('allows generation from quick settings with an empty text supplement', () => {
    const request = mergeStructuredTripRequest(parseTripRequest(''), {
      days: 2,
      pace: 'relaxed',
      categoryPreferences: { nature: 'prefer' },
    });
    expect(request.rawText).toBe('');
    expect(request.errors).toEqual([]);
    const outcome = planTrip(request);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.days).toHaveLength(2);
  });

  it('returns machine-readable targets for conflicts with detailed settings', () => {
    const parsed = parseTripRequest(
      '墨尔本玩 2 天，主要在市内，喜欢室外，从 CBD 出发，每天 11 点出门，轻松一点，2026-10-01，预算 100 澳元',
    );
    const request = mergeStructuredTripRequest(parsed, {
      days: 3,
      startMinutes: 10 * 60,
      originText: 'Southbank',
      geography: 'cbd_core_v1',
      venuePreference: 'indoor',
      pace: 'packed',
      dateText: '2026-10-02',
      totalBudgetCents: 20_000,
    });

    expect(request.settingConflicts.map((item) => item.field)).toEqual([
      'days',
      'start_time',
      'origin',
      'area',
      'venue',
      'pace',
      'date',
      'budget',
    ]);
    expect(request.errors.join('')).toContain(
      '旅行描述和详细设置有 8 处不一致',
    );
  });

  it('maps an opposite experience preference to the experience controls', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 2 天，喜欢历史'),
      { experiencePreferences: { history_heritage: 'avoid' } },
    );

    expect(request.settingConflicts).toEqual([
      expect.objectContaining({ field: 'experiences' }),
    ]);
    expect(request.settingConflicts[0].message).toContain('历史与遗产');
  });

  it('has no conflict targets before detailed settings are merged', () => {
    expect(parseTripRequest('墨尔本玩 2 天').settingConflicts).toEqual([]);
  });
});

describe('deterministic planner', () => {
  it('uses exactly the sourced 40-POI snapshot', () => {
    expect(POI_DATASET.pois).toHaveLength(40);
    for (const poi of POI_DATASET.pois) {
      expect(poi.sourceRowKey).toContain('|');
      expect(poi.aliases).toBeInstanceOf(Array);
      expect(poi.referenceUrl).toMatch(/^https:\/\//);
      expect([
        'venue_official',
        'government',
        'transport_official',
        'dataset',
      ]).toContain(poi.referenceKind);
      expect(['verified', 'unverified']).toContain(poi.referenceStatus);
      expect(
        poi.referenceStatus === 'verified' ? poi.referenceVerifiedAt : null,
      ).toBe(poi.referenceVerifiedAt);
      expect(Number.isFinite(poi.latitude)).toBe(true);
      expect(Number.isFinite(poi.longitude)).toBe(true);
    }
  });

  it('returns identical output for identical input and versions', () => {
    const input = '墨尔本玩 2 天，喜欢艺术和自然，少走路';
    expect(validResult(input)).toEqual(validResult(input));
  });

  it('creates the requested day count without duplicates or overlaps', () => {
    const result = validResult('墨尔本玩 3 天，喜欢历史和艺术，均衡节奏');
    expect(result.days).toHaveLength(3);
    const ids = result.days.flatMap((day) =>
      day.stops.map((stop) => stop.poiId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const day of result.days) {
      for (const [index, stop] of day.stops.entries()) {
        expect(stop.startMinutes).toBeGreaterThanOrEqual(570);
        expect(stop.endMinutes).toBeLessThanOrEqual(1050);
        if (index > 0)
          expect(stop.startMinutes).toBeGreaterThanOrEqual(
            day.stops[index - 1].endMinutes,
          );
      }
    }
    expect(result.summary.hardFailures).toBe(0);
  });

  it('keeps dynamic facts not verifiable', () => {
    const result = validResult('墨尔本玩 2 天，喜欢艺术，避开拥挤');
    expect(
      result.checks.find((check) => check.id === 'opening_hours')?.status,
    ).toBe('not_verifiable');
    expect(result.checks.find((check) => check.id === 'prices')?.status).toBe(
      'not_verifiable',
    );
    expect(result.checks.find((check) => check.id === 'crowds')?.status).toBe(
      'not_verifiable',
    );
  });

  it('parses the v0.4 fixed CBD, 11:00, outdoor, central-city example', () => {
    const request = parseTripRequest(
      '墨尔本 3天 主要在市内，喜欢室外。出发点在cbd。早上11点出门',
    );
    expect(request.city).toBe('Melbourne');
    expect(request.days).toBe(3);
    expect(request.geography).toMatchObject({
      scope: 'central_city_v1',
      strength: 'soft',
      source: 'text',
    });
    expect(request.venuePreference).toMatchObject({
      value: 'outdoor',
      source: 'text',
    });
    expect(request.origin).toMatchObject({
      kind: 'preset_proxy',
      resolution: 'area_proxy',
      source: 'text',
    });
    expect(request.dailyWindow).toMatchObject({
      startMinutes: 660,
      endMinutes: 1050,
      startSource: 'text',
    });
    expect(request.errors).toEqual([]);
  });

  it('distinguishes default and explicitly requested CBD origins', () => {
    const implicit = parseTripRequest('墨尔本玩 1 天');
    const explicit = parseTripRequest('墨尔本玩 1 天，出发点在 CBD');
    expect(implicit.origin.latitude).toBe(explicit.origin.latitude);
    expect(implicit.origin.longitude).toBe(explicit.origin.longitude);
    expect(implicit.origin.resolution).toBe('default_proxy');
    expect(explicit.origin.resolution).toBe('area_proxy');
  });

  it('recognizes compact origin wording without silently treating it as a default', () => {
    const request = parseTripRequest(
      '墨尔本3天主要在市内，喜欢室外，出发点CBD，11点出门',
    );
    expect(request.origin).toMatchObject({
      refId: 'mel-cbd-proxy-flinders',
      resolution: 'area_proxy',
      source: 'text',
    });
    expect(request.origin.evidence).toContain('出发点CBD');
    expect(request.dailyWindow.startMinutes).toBe(660);
  });

  it.each([
    ['住 Southbank', 'mel-southbank-proxy-skydeck'],
    ['从CBD出发', 'mel-cbd-proxy-flinders'],
    ['从Southbank出发', 'mel-southbank-proxy-skydeck'],
    ['住宿在 Docklands', 'mel-docklands-proxy-park'],
    ['从 Carlton 出发', 'mel-carlton-proxy-museum'],
    ['起点 East Melbourne', 'mel-east-melbourne-proxy-fitzroy'],
  ])('resolves a supported named-area origin: %s', (originText, refId) => {
    const request = parseTripRequest(`墨尔本玩 1 天，${originText}`);
    expect(request.origin).toMatchObject({
      refId,
      resolution: 'area_proxy',
      source: 'text',
    });
    expect(request.errors).toEqual([]);
  });

  it('keeps an unknown hotel explicit and blocks generation', () => {
    const request = parseTripRequest('墨尔本玩 1 天，住在 Example Hotel');
    expect(request.origin.resolution).toBe('default_proxy');
    expect(request.errors.join('')).toContain('暂时无法准确定位起点');
    expect(planTrip(request).ok).toBe(false);
  });

  it('exposes transparent multi-facet coverage for the 40 places', () => {
    const counts = experienceFacetCounts();
    expect(counts.market_local_life).toBe(1);
    expect(counts.museum_exhibition).toBeGreaterThan(3);
    expect(counts.parks_gardens).toBeGreaterThan(3);
    expect(counts.sports_venues).toBeGreaterThan(2);
    expect(Object.values(counts).every((count) => count <= 40)).toBe(true);
  });

  it('keeps unsupported food preferences in warnings instead of pretending they are ranked', () => {
    const request = parseTripRequest('墨尔本玩 1 天，喜欢咖啡和餐厅');
    expect(request.categoryPreferences.market_food).toBe('neutral');
    expect(request.experiencePreferences.market_local_life).toBe('neutral');
    expect(request.warnings.join('')).toContain('尚未用于排序');
  });

  it.each(['主要室外', '活动以户外为主', '室内场馆为主'])(
    'recognizes a common venue-preference phrase: %s',
    (phrase) => {
      const request = parseTripRequest(`墨尔本玩 1 天，${phrase}`);
      expect(request.venuePreference.source).toBe('text');
      expect(request.venuePreference.value).not.toBe('neutral');
    },
  );

  it('merges named origin, five-step venue bias, traveler needs and experience facets', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 2 天'),
      {
        originText: 'Southbank',
        venuePreference: 'strong_outdoor',
        family: true,
        experiencePreferences: {
          river_city_walk: 'prefer',
          sports_venues: 'avoid',
        },
      },
    );
    expect(request.origin).toMatchObject({
      refId: 'mel-southbank-proxy-skydeck',
      source: 'structured',
    });
    expect(request.venuePreference.value).toBe('strong_outdoor');
    expect(request.family).toBe(true);
    expect(request.experiencePreferences.river_city_walk).toBe('prefer');
    expect(request.experiencePreferences.sports_venues).toBe('avoid');
  });

  it('builds three full non-empty days from 11:00 with an origin leg', () => {
    const result = validResult(
      '墨尔本 3天 主要在市内，喜欢室外。出发点在cbd。早上11点出门',
    );
    expect(result.days).toHaveLength(3);
    for (const day of result.days) {
      expect(day.departureTime).toBe('11:00');
      expect(day.stops.length).toBeGreaterThanOrEqual(3);
      expect(day.stops[0].startMinutes).toBeGreaterThan(660);
      expect(day.stops[0].travelFromPrevious).toBeDefined();
      expect(day.stops.at(-1)?.endMinutes).toBeGreaterThanOrEqual(960);
      expect(
        day.stops.some((stop) => stop.startMinutes >= day.mealBreak.endMinutes),
      ).toBe(true);
    }
    expect(result.summary.centralCityPois).toBeGreaterThan(
      result.summary.totalPois / 2,
    );
    const selectedPois = result.days.flatMap((day) =>
      day.stops.map((stop) =>
        POI_DATASET.pois.find((poi) => poi.id === stop.poiId),
      ),
    );
    expect(
      selectedPois.filter((poi) => poi && isCentralCityPoi(poi)),
    ).toHaveLength(result.summary.centralCityPois);
  });

  it('fills every relaxed day through the afternoon with a 55 minute lunch', () => {
    const result = validResult('墨尔本玩 2 天，轻松节奏，喜欢历史和花园');
    for (const day of result.days) {
      expect(day.stops.length).toBeGreaterThanOrEqual(2);
      expect(day.stops.length).toBeLessThanOrEqual(3);
      expect(day.stops.at(-1)?.endMinutes).toBeGreaterThanOrEqual(900);
      expect(day.mealBreak.endMinutes - day.mealBreak.startMinutes).toBe(55);
      expect(
        day.stops.some((stop) => stop.startMinutes >= day.mealBreak.endMinutes),
      ).toBe(true);
    }
  });

  it('uses only evidence-backed reason tags and has no generic route claim', () => {
    const neutral = validResult('墨尔本玩 1 天');
    for (const stop of neutral.days[0].stops) {
      expect(stop.reasonTags).toEqual([]);
      expect(stop.reason).not.toMatch(/减少折返|补足全天/);
    }

    const preferred = validResult('墨尔本玩 1 天，喜欢历史，主要在市内');
    for (const stop of preferred.days[0].stops) {
      expect(stop.reasonTags.length).toBeLessThanOrEqual(2);
      const poi = POI_DATASET.pois.find((item) => item.id === stop.poiId);
      for (const tag of stop.reasonTags) {
        if (tag.code === 'category_preference') {
          expect(poi?.category).toBe('history');
          expect(preferred.request.categoryPreferences.history).toBe('prefer');
        }
        if (tag.code === 'central_city_preference') {
          expect(poi && isCentralCityPoi(poi)).toBe(true);
          expect(preferred.request.geography.scope).toBe('central_city_v1');
        }
      }
    }
  });

  it('keeps must-include status out of the generic reason text', () => {
    const result = validResult('墨尔本玩 1 天，必去 NGV');
    const stop = result.days[0].stops.find(
      (item) => item.poiId === 'mel-arts-ngv-international',
    );
    expect(stop).toBeDefined();
    expect(stop?.reason).not.toContain('必去');
    expect(
      stop?.reasonTags.every((tag) => tag.code !== 'category_preference'),
    ).toBe(true);
  });

  it('uses versioned price and PTV snapshots without treating unknown as zero', () => {
    expect(ADMISSION_PRICE_SNAPSHOT.records).toHaveLength(40);
    expect(
      ADMISSION_PRICE_SNAPSHOT.records.filter((record) =>
        ['free_general_entry', 'not_ticketed_public_space'].includes(
          record.basis,
        ),
      ),
    ).toHaveLength(22);
    expect(
      ADMISSION_PRICE_SNAPSHOT.records.filter((record) =>
        ['paid_fixed', 'paid_from', 'paid_range'].includes(record.basis),
      ),
    ).toHaveLength(9);
    expect(
      ADMISSION_PRICE_SNAPSHOT.records.filter(
        (record) => record.basis === 'event_dependent',
      ),
    ).toHaveLength(8);
    expect(
      ADMISSION_PRICE_SNAPSHOT.records.filter(
        (record) => record.basis === 'unknown',
      ),
    ).toHaveLength(1);
    expect(PTV_FARE_SNAPSHOT.zone12.fullFare.weekdayDailyCapCents).toBe(570);
    expect(PTV_FARE_SNAPSHOT.zone12.fullFare.weekendHolidayDailyCapCents).toBe(
      400,
    );
    const result = validResult('墨尔本玩 1 天，必去 Old Melbourne Gaol');
    expect(result.budget.admissionRange.minCents).toBeGreaterThanOrEqual(3800);
    expect(result.budget.totalRange.maxCents).toBeNull();
    expect(result.budget.coverage.unknownItems).toContain('餐饮');
  });

  it('uses weekday and weekend PTV caps and stops at the policy boundary', () => {
    const weekday = validResult(
      '墨尔本玩 1 天，必去 Melbourne Zoo，2026-09-16',
    );
    const weekend = validResult(
      '墨尔本玩 1 天，必去 Melbourne Zoo，2026-09-19',
    );
    const expired = validResult(
      '墨尔本玩 1 天，必去 Melbourne Zoo，2027-01-01',
    );
    expect(weekday.budget.transitRange.maxCents).toBe(570);
    expect(weekend.budget.transitRange.maxCents).toBe(400);
    expect(expired.budget.transitRange.maxCents).toBeNull();
  });

  it('does not omit child fares from an existing-myki transit estimate', () => {
    const parsed = parseTripRequest(
      '墨尔本玩 1 天，必去 Melbourne Zoo，2026-09-16',
    );
    const request = mergeStructuredTripRequest(parsed, {
      pricingParty: {
        adultFullFareCount: 1,
        childAges: [10],
        ptvPaymentMedium: 'existing_myki',
      },
    });
    const outcome = planTrip(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.budget.transitRange.maxCents).toBeNull();
    expect(outcome.result.budget.coverage.transit).toBe('unknown');
    expect(outcome.result.budget.coverage.unknownItems).toContain(
      '儿童 PTV 票价与资格',
    );
    expect(
      outcome.result.budget.coverage.unknownItems.some((item) =>
        item.includes('儿童年龄对应票种待确认'),
      ),
    ).toBe(true);
  });

  it('adds a physical myki card only when selected', () => {
    const parsed = parseTripRequest(
      '墨尔本玩 1 天，必去 Melbourne Zoo，2026-09-16',
    );
    const request = mergeStructuredTripRequest(parsed, {
      pricingParty: { ptvPaymentMedium: 'new_physical_myki' },
    });
    const outcome = planTrip(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.budget.mykiSetupRange).toEqual({
      minCents: 600,
      maxCents: 600,
    });
  });

  it('reports definite over-budget only from the known minimum', () => {
    const result = validResult(
      '墨尔本玩 1 天，必去 Old Melbourne Gaol，预算 10 澳元',
    );
    expect(result.budget.comparison).toBe('known_min_exceeds_limit');
    expect(result.budget.totalRange.maxCents).toBeNull();
  });
});

describe('atomic replacement', () => {
  it('changes one slot while preserving the other day and non-target IDs', () => {
    const original = validResult('墨尔本玩 2 天，喜欢艺术和历史');
    const beforeDayZero = original.days[0].stops.map((stop) => stop.poiId);
    const otherDay = original.days[1];
    const outcome = replaceStop(original, 0, 1);
    expect(outcome.ok).toBe(true);
    expect(outcome.result.days[1]).toEqual(otherDay);
    const afterDayZero = outcome.result.days[0].stops.map((stop) => stop.poiId);
    expect(afterDayZero[1]).not.toBe(beforeDayZero[1]);
    expect(afterDayZero.filter((_, index) => index !== 1)).toEqual(
      beforeDayZero.filter((_, index) => index !== 1),
    );
    expect(outcome.result.summary.hardFailures).toBe(0);
  });

  it('returns the original object when no candidate exists', () => {
    const original = validResult('墨尔本玩 1 天，喜欢艺术');
    const used = new Set(
      original.days.flatMap((day) => day.stops.map((stop) => stop.poiId)),
    );
    const exhaustedDataset = {
      ...POI_DATASET,
      pois: POI_DATASET.pois.filter((poi) => used.has(poi.id)),
    };
    const outcome = replaceStop(original, 0, 0, [], exhaustedDataset);
    expect(outcome.ok).toBe(false);
    expect(outcome.result).toBe(original);
  });

  it('uses stable replacement order across the same operation sequence', () => {
    const original = validResult('墨尔本玩 2 天，喜欢历史');
    const firstA = replaceStop(original, 0, 0);
    const firstB = replaceStop(original, 0, 0);
    expect(firstA.replacementId).toBe(firstB.replacementId);
    expect(firstA.result).toEqual(firstB.result);
  });

  it('does not replace a must-include stop or introduce an excluded POI', () => {
    const original = validResult(
      '墨尔本玩 2 天，必去 NGV，不要去 Queen Victoria Market',
    );
    const requiredLocation = original.days
      .flatMap((day, dayIndex) =>
        day.stops.map((stop, stopIndex) => ({
          dayIndex,
          stopIndex,
          poiId: stop.poiId,
        })),
      )
      .find((item) => item.poiId === 'mel-arts-ngv-international');
    expect(requiredLocation).toBeDefined();
    const blocked = replaceStop(
      original,
      requiredLocation?.dayIndex ?? 0,
      requiredLocation?.stopIndex ?? 0,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.result).toBe(original);

    const ordinary = original.days
      .flatMap((day, dayIndex) =>
        day.stops.map((stop, stopIndex) => ({
          dayIndex,
          stopIndex,
          poiId: stop.poiId,
        })),
      )
      .find((item) => item.poiId !== 'mel-arts-ngv-international');
    const replaced = replaceStop(
      original,
      ordinary?.dayIndex ?? 0,
      ordinary?.stopIndex ?? 0,
    );
    const ids = replaced.result.days.flatMap((day) =>
      day.stops.map((stop) => stop.poiId),
    );
    expect(ids).not.toContain('mel-cbd-qvm');
  });

  it('lists all feasible options first and applies only the selected option', () => {
    const original = validResult('墨尔本玩 2 天，喜欢艺术和历史');
    const before = structuredClone(original);
    const options = listReplacementOptions(original, 0, 1);
    expect(options.length).toBeGreaterThan(1);
    expect(original).toEqual(before);
    const chosen = options.at(-1);
    expect(chosen).toBeDefined();
    const outcome = replaceStopWithPoi(original, 0, 1, chosen?.poi.id ?? '');
    expect(outcome.ok).toBe(true);
    expect(outcome.result.days[1]).toEqual(original.days[1]);
    expect(outcome.result.days[0].stops[1].poiId).toBe(chosen?.poi.id);
  });

  it('audits every non-target POI and explains each unavailable option', () => {
    const original = validResult('墨尔本玩 2 天，喜欢艺术和历史');
    const audit = auditReplacementOptions(original, 0, 1);
    expect(audit.checkedCount).toBe(POI_DATASET.pois.length - 1);
    expect(audit.eligible.length + audit.ineligible.length).toBe(
      POI_DATASET.pois.length - 1,
    );
    expect(
      new Set([
        ...audit.eligible.map((option) => option.poi.id),
        ...audit.ineligible.map((option) => option.poi.id),
      ]).size,
    ).toBe(POI_DATASET.pois.length - 1);
    for (const option of audit.ineligible) {
      expect(option.reasonCode).toBeTruthy();
      expect(option.reason.length).toBeGreaterThan(0);
    }
  });

  it('accepts every audited feasible ID and rejects every unavailable ID atomically', () => {
    const original = validResult('墨尔本玩 1 天，喜欢艺术');
    const audit = auditReplacementOptions(original, 0, 1);
    expect(audit.eligible.length).toBeGreaterThan(0);
    for (const option of audit.eligible) {
      const outcome = replaceStopWithPoi(original, 0, 1, option.poi.id);
      expect(outcome.ok, option.poi.id).toBe(true);
    }
    for (const option of audit.ineligible) {
      const outcome = replaceStopWithPoi(original, 0, 1, option.poi.id);
      expect(outcome.ok, option.poi.id).toBe(false);
      expect(outcome.result).toBe(original);
    }
  });

  it('orders feasible alternatives by same category before same area', () => {
    const original = validResult('墨尔本玩 2 天，喜欢艺术和历史');
    const targetId = original.days[0].stops[1].poiId;
    const target = POI_DATASET.pois.find((poi) => poi.id === targetId);
    expect(target).toBeDefined();
    const options = auditReplacementOptions(original, 0, 1).eligible;
    const tuples = options.map((option) => [
      Number(option.poi.category === target?.category),
      Number(option.poi.area === target?.area),
    ]);
    for (let index = 1; index < tuples.length; index += 1) {
      const previous = tuples[index - 1];
      const current = tuples[index];
      expect(
        previous[0] > current[0] ||
          (previous[0] === current[0] && previous[1] >= current[1]),
      ).toBe(true);
    }
  });
});
