/**
 * 报表 A：现有版本（规则路径）30 题基线。
 *
 * - 只跑规则理解 + 确定性规划器，不调用任何真实模型（第 29 题用注入的“永不返回”适配器模拟超时）。
 * - 自动检查只覆盖程序能判定的硬约束；五维质量分、页面文案与无障碍披露等仍需人工复核。
 * - 结果写入 eval/reports/。失败是数据而不是测试失败，所以本文件不会让 vitest 变红，
 *   也不在 `npm test` 的匹配范围内。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, it, vi } from 'vitest';

import {
  buildPlanProposal,
  canCommitPlanning,
  isProposalCurrent,
} from '@/app/lib/agent-session';
import type { NluDraftAdapter } from '@/app/lib/nlu-contract';
import { interpretTripRequest } from '@/app/lib/nlu-orchestrator';
import { getRuntimeConfig } from '@/app/lib/runtime-config-state';
import { buildTripAdvice } from '@/app/lib/trip-advice';
import {
  PLANNER_VERSION,
  POI_DATASET,
  POIS,
  auditReplacementOptions,
  parseTripRequest,
  planTrip,
  poiExperienceFacets,
  replaceStopWithPoi,
  type ParsedTripRequest,
  type PlanOutcome,
  type PlannerResult,
} from '@/app/lib/planner';

import taskSet from './tasks.v1.json';

const EVAL_CLOCK = '2026-09-28T10:00:00+10:00';
const RUNNER_VERSION = 'baseline-rules-runner-v1';

type Support = 'supported' | 'partial' | 'unsupported';
interface Task {
  id: string;
  kind: string;
  support: Support;
  featureTag: string;
  text: string;
  editedText?: string;
  followUp?: string;
}
interface Check {
  id: string;
  label: string;
  hard: boolean;
  status: 'pass' | 'fail';
  detail: string;
}
interface TaskRecord {
  id: string;
  kind: string;
  support: Support;
  featureTag: string;
  input: string;
  actions: string[];
  parsed: Record<string, unknown>;
  outcome: Record<string, unknown>;
  checks: Check[];
  hardResult: 'pass' | 'fail';
  unsupportedParts: string[];
  manualReview: string[];
  elapsedMs: number;
}

function poiIdByEn(fragment: string): string {
  const poi = POIS.find((item) =>
    String(item.nameEn ?? '')
      .toLowerCase()
      .includes(fragment.toLowerCase()),
  );
  if (!poi) throw new Error(`POI not found: ${fragment}`);
  return poi.id;
}
const ID = {
  ngv: poiIdByEn('NGV International'),
  fedSquare: poiIdByEn('Federation Square'),
  slv: poiIdByEn('State Library Victoria'),
  zoo: poiIdByEn('Melbourne Zoo'),
  skydeck: poiIdByEn('Skydeck'),
  aquarium: poiIdByEn('Aquarium'),
};

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const experience = (r: ParsedTripRequest) =>
  r.experiencePreferences as Record<string, string>;
const pref = (r: ParsedTripRequest, facet: string) =>
  experience(r)[facet] === 'prefer';
const isIndoor = (r: ParsedTripRequest) =>
  r.venuePreference.value === 'indoor' ||
  r.venuePreference.value === 'strong_indoor';

function summarizeRequest(r: ParsedTripRequest): Record<string, unknown> {
  return {
    days: r.days,
    interests: r.interests,
    origin: `${r.origin.refId} (${r.origin.source})`,
    start: `${hhmm(r.dailyWindow.startMinutes)} (${r.dailyWindow.startSource})`,
    pace: r.pace,
    venue: r.venuePreference.value,
    preferredExperiences: Object.entries(experience(r))
      .filter(([, v]) => v === 'prefer')
      .map(([k]) => k),
    avoidedExperiences: Object.entries(experience(r))
      .filter(([, v]) => v === 'avoid')
      .map(([k]) => k),
    lowWalking: r.lowWalking,
    family: r.family,
    party: {
      total: r.pricingParty.totalTravelers,
      adults: r.pricingParty.adultFullFareCount,
      childAges: r.pricingParty.childAges,
      status: r.pricingParty.ticketBreakdownStatus,
      source: r.pricingParty.source,
    },
    budgetCents: r.totalBudgetCents,
    dateText: r.dateText,
    mustInclude: r.mustIncludePoiIds,
    exclude: r.excludePoiIds,
    unknownHardConstraints: r.unknownHardConstraints,
    errors: r.errors,
    warnings: r.warnings,
    needsClarification: r.needsClarification,
  };
}

function summarizeOutcome(o: PlanOutcome): Record<string, unknown> {
  if (!o.ok) return { ok: false, kind: o.kind, message: o.message };
  const r = o.result;
  return {
    ok: true,
    days: r.days.map((d) => ({
      day: d.day,
      stops: d.stops.map((s) => `${s.startTime}-${s.endTime} ${s.poiId}`),
    })),
    hardFailures: r.summary.hardFailures,
    notVerifiable: r.summary.notVerifiable,
    budget: {
      comparison: r.budget.comparison,
      knownMinCents: r.budget.knownComponentsRange.minCents,
      knownMaxCents: r.budget.knownComponentsRange.maxCents,
      transitCoverage: r.budget.coverage.transit,
      unknownItems: r.budget.coverage.unknownItems,
      excludedItems: r.budget.coverage.excludedItems,
    },
  };
}

function mk(
  id: string,
  label: string,
  hard: boolean,
  pass: boolean,
  detail = '',
): Check {
  return { id, label, hard, status: pass ? 'pass' : 'fail', detail };
}

const allStops = (r: PlannerResult) => r.days.flatMap((d) => d.stops);

function structuralChecks(result: PlannerResult): Check[] {
  const checks: Check[] = [];
  const overlaps: string[] = [];
  for (const d of result.days) {
    const spans = d.stops
      .map((s) => [s.startMinutes, s.endMinutes, s.poiId] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i += 1)
      if (spans[i][0] < spans[i - 1][1])
        overlaps.push(`D${d.day} ${spans[i - 1][2]}/${spans[i][2]}`);
  }
  checks.push(
    mk('no_overlap', '同日地点时间不重叠', true, overlaps.length === 0, overlaps.join('; ')),
  );
  const ids = allStops(result).map((s) => s.poiId);
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
  checks.push(mk('no_duplicate', '跨天不重复', true, dups.length === 0, dups.join(', ')));
  const req = result.request;
  const missing = req.mustIncludePoiIds.filter((id) => !ids.includes(id));
  checks.push(
    mk('must_included', '必去地点都在行程中', true, missing.length === 0, missing.join(', ')),
  );
  const leaked = req.excludePoiIds.filter((id) => ids.includes(id));
  checks.push(
    mk('excluded_absent', '避开地点不在行程中', true, leaked.length === 0, leaked.join(', ')),
  );
  const early = result.days.filter(
    (d) => d.stops.length > 0 && d.stops[0].startMinutes < req.dailyWindow.startMinutes,
  );
  checks.push(
    mk(
      'respects_start',
      '首站不早于出发时间',
      true,
      early.length === 0,
      early.map((d) => `D${d.day}`).join(', '),
    ),
  );
  checks.push(
    mk(
      'no_hard_fail',
      '规划器自身硬检查无失败',
      true,
      result.summary.hardFailures === 0,
      result.checks
        .filter((c) => c.hard && c.status === 'fail')
        .map((c) => c.label)
        .join('; '),
    ),
  );
  checks.push(
    mk(
      'budget_not_overclaimed',
      '未把未知费用当作已覆盖',
      true,
      !(
        result.budget.comparison === 'known_components_within_limit' &&
        result.budget.coverage.unknownItems.length === 0 &&
        result.budget.coverage.excludedItems.length === 0
      ),
      `comparison=${result.budget.comparison}`,
    ),
  );
  return checks;
}

function accommodationDisclosed(result: PlannerResult): Check {
  const all = [
    ...result.budget.coverage.unknownItems,
    ...result.budget.coverage.excludedItems,
  ];
  const assumed = result.budget.assumptionItems?.some((item) => item.id === 'accommodation');
  return mk(
    'accommodation_disclosed',
    '住宿要么列为未知/未计入，要么作为用户假设单列（诊断）',
    false,
    assumed || all.some((x) => x.includes('住宿') || x.includes('酒店')),
    `unknown+excluded=${all.join('、')} assumption=${Boolean(assumed)}`,
  );
}

function afternoonStart(r: ParsedTripRequest, o: PlanOutcome): Check {
  const parsedAfternoon =
    r.dailyWindow.startSource !== 'default' && r.dailyWindow.startMinutes >= 12 * 60;
  const asked = !o.ok && o.kind === 'clarification';
  return mk(
    'afternoon_not_silently_morning',
    '“下午出发”不被静默改成上午',
    true,
    parsedAfternoon || asked,
    `start=${hhmm(r.dailyWindow.startMinutes)} source=${r.dailyWindow.startSource}`,
  );
}

const ADVICE_TODAY = EVAL_CLOCK.slice(0, 10);
function adviceChecks(result: PlannerResult, want: { transit?: boolean; packing?: boolean; shopping?: boolean }): Check[] {
  const advice = buildTripAdvice(result, ADVICE_TODAY);
  const checks: Check[] = [];
  const usesTransit = result.days.some((d) => d.stops.some((s) => s.travelFromPrevious.mode === 'public_transport'));
  if (want.transit) {
    checks.push(mk('transit_tips', '有公共交通路段时给出带官方来源的刷卡/免费区提醒', true, !usesTransit || (advice.transport.length > 0 && advice.transport.every((c) => c.sources.length > 0 && c.trigger.length > 0)), `usesTransit=${usesTransit} cards=${advice.transport.map((c) => c.id).join(',')}`));
    const ftz = advice.transport.find((c) => c.id === 'transport-free-tram-zone');
    checks.push(mk('ftz_not_asserted', '不断言某段电车在免费区内', true, !ftz || ftz.body.includes('不能替你判断')));
  }
  if (want.packing) {
    checks.push(mk('packing_reasons', '行李清单每项都有触发原因', true, advice.packing.items.length > 0 && advice.packing.items.every((i) => i.reason.length > 0), `${advice.packing.items.length} items`));
    checks.push(mk('no_forecast', '不把季节常识写成天气预报', true, !/预报[:：]|明天.{0,4}(下雨|晴)|气温将/.test(JSON.stringify(advice.packing.items)) && /不是天气预报|还没填出行日期/.test(advice.packing.note)));
  }
  if (want.shopping) {
    checks.push(mk('shopping_present', '提到购物时给出购物建议', true, advice.shopping.some((c) => c.id === 'shopping-categories')));
    checks.push(mk('no_stock_claim', '不保证具体店铺库存、价格或退税资格', true, advice.shopping.every((c) => c.id !== 'shopping-categories' || c.body.includes('不掌握具体店铺')) && !/(保证有货|一定能退税)/.test(JSON.stringify(advice.shopping))));
  }
  return checks;
}

type Runner = (t: Task, rec: TaskRecord) => void | Promise<void>;
type Add = (c: Check) => void;

function planText(rec: TaskRecord, text: string) {
  const request = parseTripRequest(text);
  const outcome = planTrip(request);
  rec.actions.push(`输入：${text}`, '确认条件', '生成行程');
  rec.parsed = summarizeRequest(request);
  rec.outcome = summarizeOutcome(outcome);
  return { request, outcome };
}

function coreTask(
  expect: (r: ParsedTripRequest, o: PlanOutcome, add: Add) => void,
): Runner {
  return (t, rec) => {
    const { request, outcome } = planText(rec, t.text);
    const add: Add = (c) => rec.checks.push(c);
    add(mk('plan_ok', '生成了行程', true, outcome.ok, outcome.ok ? '' : outcome.message));
    if (outcome.ok) structuralChecks(outcome.result).forEach(add);
    expect(request, outcome, add);
  };
}

const RUNNERS: Record<
  string,
  { run: Runner; unsupported?: string[]; manual?: string[] }
> = {
  '01': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=1', true, r.days === 1, `${r.days}`));
      add(mk('origin', '起点=CBD（来自原文）', true, r.origin.refId === 'mel-cbd-proxy-flinders' && r.origin.source === 'text', `${r.origin.refId}/${r.origin.source}`));
      add(mk('start', '11:00 开始', true, r.dailyWindow.startMinutes === 660, hhmm(r.dailyWindow.startMinutes)));
      add(mk('interests', '识别历史与艺术偏好', true, pref(r, 'history_heritage') && (r.interests.includes('art') || pref(r, 'museum_exhibition')), `interests=${r.interests.join(',')}`));
      add(mk('pace', '“别太赶”→轻松节奏', true, r.pace === 'relaxed', r.pace));
    }),
  },
  '02': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=2', true, r.days === 2, `${r.days}`));
      add(mk('origin', '起点=Southbank', true, r.origin.refId === 'mel-southbank-proxy-skydeck', r.origin.refId));
      add(mk('indoor', '室内优先', true, isIndoor(r), r.venuePreference.value));
      add(mk('must_ngv', '必去 NGV International 被识别', true, r.mustIncludePoiIds.includes(ID.ngv), r.mustIncludePoiIds.join(',')));
      add(mk('low_walking', '少走路', true, r.lowWalking));
    }),
    manual: ['直线估距不能被当作步行导航：核对页面文案'],
  },
  '03': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=3', true, r.days === 3, `${r.days}`));
      add(mk('origin', '起点=Carlton', true, r.origin.refId === 'mel-carlton-proxy-museum', r.origin.refId));
      add(mk('family', '带孩子→亲子', true, r.family));
      add(mk('child_fare_not_guessed', '未给年龄时不把儿童票型当作已知', true, r.pricingParty.ticketBreakdownStatus !== 'complete' || r.pricingParty.childAges.length > 0, `${r.pricingParty.ticketBreakdownStatus} total=${r.pricingParty.totalTravelers} adults=${r.pricingParty.adultFullFareCount}`));
    }),
  },
  '04': {
    run: coreTask((r, o, add) => {
      add(mk('days', '天数=2', true, r.days === 2, `${r.days}`));
      add(mk('origin', '起点=Docklands', true, r.origin.refId === 'mel-docklands-proxy-park', r.origin.refId));
      add(mk('budget', '预算 A$500', true, r.totalBudgetCents === 50000, `${r.totalBudgetCents}`));
      if (o.ok) add(accommodationDisclosed(o.result));
    }),
    unsupported: ['酒店星级/设施比较（资料来源门未过）'],
  },
  '05': {
    run: coreTask((r, o, add) => {
      add(mk('origin', '起点=East Melbourne', true, r.origin.refId === 'mel-east-melbourne-proxy-fitzroy', r.origin.refId));
      add(afternoonStart(r, o));
    }),
  },
  '06': {
    run: coreTask((r, _o, add) => {
      add(mk('date', '识别绝对日期 2026-10-17', true, (r.dateText ?? '').includes('2026-10-17'), `${r.dateText}`));
      add(mk('indoor', '室内优先', true, isIndoor(r), r.venuePreference.value));
      add(mk('family', '带孩子→亲子', true, r.family));
      if (_o.ok) adviceChecks(_o.result, { packing: true }).forEach(add);
    }),
    manual: ['不得声称已知当天天气'],
  },
  '07': {
    run: coreTask((r, o, add) => {
      add(mk('days', '天数=3', true, r.days === 3, `${r.days}`));
      add(mk('prefs', '公园与城市风景为偏好', true, pref(r, 'parks_gardens') && pref(r, 'city_icons_views'), JSON.stringify(summarizeRequest(r).preferredExperiences)));
      add(mk('avoid_museum', '识别“不想去室内博物馆”', true, experience(r).museum_exhibition === 'avoid' || r.venuePreference.value.includes('outdoor'), `museum=${experience(r).museum_exhibition} venue=${r.venuePreference.value}`));
      if (o.ok) {
        const museums = allStops(o.result).filter((s) => {
          const poi = POIS.find((p) => p.id === s.poiId);
          return poi ? poiExperienceFacets(poi).includes('museum_exhibition') : false;
        });
        add(mk('no_museum_stops', '行程中没有博物馆/展览类地点', true, museums.length === 0, museums.map((s) => s.poiId).join(', ')));
      }
    }),
  },
  '08': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=1', true, r.days === 1, `${r.days}`));
      add(mk('must_ngv', '必去 NGV International', true, r.mustIncludePoiIds.includes(ID.ngv), r.mustIncludePoiIds.join(',')));
      add(mk('avoid_aquarium', '避开水族馆', true, r.excludePoiIds.includes(ID.aquarium), r.excludePoiIds.join(',')));
      if (_o.ok) adviceChecks(_o.result, { shopping: true }).forEach(add);
    }),
  },
  '09': {
    run: coreTask((r, o, add) => {
      add(mk('party', '两位成人票型', true, r.pricingParty.adultFullFareCount === 2 && r.pricingParty.totalTravelers === 2, JSON.stringify(r.pricingParty)));
      add(mk('budget', '预算 A$300', true, r.totalBudgetCents === 30000, `${r.totalBudgetCents}`));
      if (o.ok) add(accommodationDisclosed(o.result));
    }),
  },
  '10': {
    run: coreTask((r, o, add) => {
      add(mk('party', '1 成人 + 8 岁儿童', true, r.pricingParty.adultFullFareCount === 1 && r.pricingParty.childAges.includes(8) && r.pricingParty.totalTravelers === 2, JSON.stringify(r.pricingParty)));
      if (o.ok)
        add(mk('child_fare_flagged', '儿童票资格未知处被列出', true, o.result.budget.coverage.unknownItems.some((x) => x.includes('儿童')), o.result.budget.coverage.unknownItems.join('、')));
    }),
  },
  '11': {
    run: coreTask((r, o, add) => {
      add(mk('days', '天数=2', true, r.days === 2, `${r.days}`));
      add(mk('low_walking', '少走路', true, r.lowWalking));
      add(afternoonStart(r, o));
    }),
    manual: ['无障碍信息未核实处是否明确披露（页面）'],
  },
  '12': {
    run: coreTask((r, _o, add) => {
      add(mk('must_two', '两个必去都被识别', true, r.mustIncludePoiIds.includes(ID.fedSquare) && r.mustIncludePoiIds.includes(ID.slv), r.mustIncludePoiIds.join(',')));
      add(mk('avoid_zoo', '避开动物园', true, r.excludePoiIds.includes(ID.zoo), r.excludePoiIds.join(',')));
    }),
  },
  '13': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=3', true, r.days === 3, `${r.days}`));
      add(mk('prefs', '历史/花园/地标为偏好', true, pref(r, 'history_heritage') && pref(r, 'parks_gardens') && pref(r, 'city_icons_views'), JSON.stringify(summarizeRequest(r).preferredExperiences)));
      add(mk('pace', '节奏均衡', true, r.pace === 'balanced', r.pace));
      add(mk('origin', '起点=CBD（来自原文）', true, r.origin.refId === 'mel-cbd-proxy-flinders' && r.origin.source === 'text', `${r.origin.refId}/${r.origin.source}`));
    }),
  },
  '14': {
    run: coreTask((r, _o, add) => {
      add(mk('date', '识别 2026-11-14', true, (r.dateText ?? '').includes('2026-11-14'), `${r.dateText}`));
    }),
    unsupported: ['日期活动候选与购票提醒（资料来源门未过）'],
  },
  '15': {
    run: coreTask((_r, o, add) => {
      if (o.ok) {
        add(mk('transit_disclosed', '有公共交通费用覆盖说明（诊断）', false, o.result.budget.coverage.transit !== 'unknown', o.result.budget.coverage.transit));
        adviceChecks(o.result, { transit: true }).forEach(add);
      }
    }),
  },
  '16': {
    run: coreTask((r, _o, add) => {
      add(mk('days', '天数=3', true, r.days === 3, `${r.days}`));
      add(mk('art', '艺术偏好', true, pref(r, 'museum_exhibition') || r.interests.includes('art'), r.interests.join(',')));
    }),
    unsupported: ['酒店属性比较（资料来源门未过）'],
  },
  '17': {
    run: coreTask((r, _o, add) => {
      add(mk('date', '识别 2026-12-05', true, (r.dateText ?? '').includes('2026-12-05'), `${r.dateText}`));
      add(mk('origin_not_shanghai', '“从上海出发”不被当作墨尔本本地起点', true, !r.origin.label.includes('上海'), r.origin.label));
      if (_o.ok) {
        adviceChecks(_o.result, { packing: true, shopping: true }).forEach(add);
        const advice = buildTripAdvice(_o.result, ADVICE_TODAY);
        add(mk('summer_packing', '2026-12-05 按南半球夏季给出清单', true, advice.packing.season === 'summer', `${advice.packing.season}`));
      }
    }),
    unsupported: ['出发国字段（仅作出发地提示，未用于个性化建议）'],
  },
  '18': {
    run: coreTask((_r, o, add) => {
      if (o.ok) adviceChecks(o.result, { transit: true, packing: true }).forEach(add);
    }),
    unsupported: ['逐站营业时间避坑（目前只有维多利亚女王市场的开市日）'],
    manual: ['现有“出发前确认”提示是否与行程相关'],
  },
  '19': {
    run: (t, rec) => {
      const { outcome } = planText(rec, t.text);
      rec.checks.push(mk('plan_ok', '生成了行程', true, outcome.ok, outcome.ok ? '' : outcome.message));
      if (!outcome.ok) return;
      const before = structuredClone(outcome.result);
      const audit = auditReplacementOptions(outcome.result, 0, 0);
      rec.actions.push(`打开第 1 天第 1 站候选：${audit.eligible.length} 个可替换`);
      const pick = audit.eligible[0];
      rec.checks.push(mk('has_candidate', '第 1 天第 1 站有可行候选', true, Boolean(pick)));
      if (!pick) return;
      const rep = replaceStopWithPoi(outcome.result, 0, 0, pick.poi.id);
      rec.actions.push(`替换为 ${pick.poi.id}`);
      rec.checks.push(mk('replace_ok', '替换成功', true, rep.ok, rep.message));
      rec.checks.push(mk('day2_frozen', '第二天完全不变', true, JSON.stringify(rep.result.days[1]) === JSON.stringify(before.days[1])));
      rec.checks.push(mk('input_not_mutated', '原行程对象未被改写（可撤销）', true, JSON.stringify(outcome.result) === JSON.stringify(before)));
      structuralChecks(rep.result).forEach((c) => rec.checks.push({ ...c, id: `after_${c.id}` }));
      rec.outcome = { ...rec.outcome, afterReplace: summarizeOutcome({ ok: true, result: rep.result }) };
    },
  },
  '20': {
    run: (t, rec) => {
      const { outcome } = planText(rec, t.text);
      rec.checks.push(mk('plan_ok', '生成了行程', true, outcome.ok, outcome.ok ? '' : outcome.message));
      if (!outcome.ok) return;
      const history: PlannerResult[] = [];
      let current = outcome.result;
      const original = JSON.stringify(current);
      for (const [d, s] of [
        [0, 0],
        [1, 0],
      ] as const) {
        const pick = auditReplacementOptions(current, d, s).eligible[0];
        if (!pick) {
          rec.checks.push(mk(`candidate_d${d + 1}`, `第 ${d + 1} 天有可行候选`, true, false));
          return;
        }
        const rep = replaceStopWithPoi(current, d, s, pick.poi.id);
        rec.actions.push(`第 ${d + 1} 天第 ${s + 1} 站换成 ${pick.poi.id}：${rep.ok ? '成功' : rep.message}`);
        rec.checks.push(mk(`replace_d${d + 1}`, `第 ${d + 1} 次替换成功`, true, rep.ok, rep.message));
        if (!rep.ok) return;
        structuralChecks(rep.result).forEach((c) => rec.checks.push({ ...c, id: `r${d + 1}_${c.id}` }));
        history.push(current);
        current = rep.result;
      }
      const afterTwo = JSON.stringify(current);
      current = history.pop() as PlannerResult;
      current = history.pop() as PlannerResult;
      rec.actions.push('撤销两次（按页面的 LIFO 整份结果栈语义模拟）');
      rec.checks.push(mk('undo_restores', '两次撤销后行程与预算完全恢复', true, JSON.stringify(current) === original));
      rec.checks.push(mk('changed_in_between', '中间状态确实发生了变化', true, afterTwo !== original));
    },
    manual: ['页面撤销按钮与本脚本的栈语义一致（page.tsx 撤销状态）'],
  },
  '21': {
    run: (t, rec) => {
      const edited = t.editedText as string;
      const a = parseTripRequest(t.text);
      const proposalA = buildPlanProposal(a, t.text);
      rec.actions.push(`输入 A：${t.text}`, '生成提案 A', `改输入为：${edited}`, '点击旧提案的确认');
      rec.parsed = summarizeRequest(a);
      rec.checks.push(mk('a_days', '提案 A 天数=2', true, a.days === 2, `${a.days}`));
      rec.checks.push(mk('stale_proposal', '改输入后旧提案失效', true, !isProposalCurrent(proposalA, edited)));
      rec.checks.push(
        mk('cannot_commit', '旧确认无法提交规划', true, !canCommitPlanning({ revision: 1, activeRevision: 2, proposalFingerprint: proposalA.createdFrom, currentFingerprint: edited })),
      );
      const b = parseTripRequest(edited);
      rec.checks.push(mk('b_reparsed', '新描述重新解析为 3 天/历史', true, b.days === 3 && pref(b, 'history_heritage'), `${b.days}`));
    },
    manual: ['页面上旧确认按钮的可见状态'],
  },
  '22': {
    run: (t, rec) => {
      const edited = t.editedText as string;
      const a = parseTripRequest(t.text);
      const pa = buildPlanProposal(a, t.text);
      const { request: b, outcome } = planText(rec, edited);
      rec.actions.unshift(`原输入：${t.text}`);
      rec.checks.push(mk('stale_proposal', '改条件后旧提案失效', true, !isProposalCurrent(pa, edited)));
      rec.checks.push(mk('budget', '新预算 A$150', true, b.totalBudgetCents === 15000, `${b.totalBudgetCents}`));
      rec.checks.push(mk('indoor', '室内优先', true, isIndoor(b), b.venuePreference.value));
      rec.checks.push(mk('plan_ok', '生成了行程', true, outcome.ok, outcome.ok ? '' : outcome.message));
      if (outcome.ok) {
        structuralChecks(outcome.result).forEach((c) => rec.checks.push(c));
        rec.checks.push(accommodationDisclosed(outcome.result));
        const items = outcome.result.budget.assumptionItems ?? [];
        const lodging = items.find((item) => item.id === 'accommodation');
        rec.checks.push(mk('lodging_assumption', '住宿假设按 A$100–150 × 1 晚单列', true, lodging?.minCents === 10000 && lodging?.maxCents === 15000, JSON.stringify(lodging ?? null)));
        rec.checks.push(mk('food_assumption', '餐饮假设已单列（按确认人数与天数）', true, items.some((item) => item.id === 'food' && item.missing == null), JSON.stringify(items.find((item) => item.id === 'food') ?? null)));
        rec.checks.push(mk('estimate_not_verified', '估算与已核实金额分开，不改写已核实小计', true, outcome.result.budget.knownComponentsRange.minCents !== outcome.result.budget.estimateRange?.minCents));
      }
    },
  },
  '23': {
    run: (t, rec) => {
      const { request, outcome } = planText(rec, t.text);
      rec.checks.push(mk('must_two', '两个必去都被识别', true, request.mustIncludePoiIds.includes(ID.zoo) && request.mustIncludePoiIds.includes(ID.skydeck), request.mustIncludePoiIds.join(',')));
      rec.checks.push(mk('start', '13:00 开始', true, request.dailyWindow.startMinutes === 780, hhmm(request.dailyWindow.startMinutes)));
      if (outcome.ok) {
        const ids = allStops(outcome.result).map((s) => s.poiId);
        rec.checks.push(mk('not_dropped', '若生成行程则两个必去都在，不能静默丢弃', true, ids.includes(ID.zoo) && ids.includes(ID.skydeck), ids.join(',')));
        structuralChecks(outcome.result).forEach((c) => rec.checks.push(c));
      } else {
        rec.checks.push(mk('blocked_with_reason', '排不下时阻断并说明原因', true, outcome.message.length > 0, outcome.message));
      }
    },
    manual: ['阻断文案是否告诉用户“该改什么”'],
  },
  '24': {
    run: coreTask((r, _o, add) => add(mk('days', '天数=3', true, r.days === 3, `${r.days}`))),
    unsupported: ['住宿属性', '当期活动', '交通避坑', '行李购物', '含住宿/餐饮假设的逐项预算'],
  },
  '25': {
    run: (t, rec) => {
      const { outcome } = planText(rec, t.text);
      rec.checks.push(mk('asks_days', '先问天数，不直接规划', true, !outcome.ok && outcome.kind === 'clarification', outcome.ok ? '直接生成了行程' : outcome.message));
    },
  },
  '26': {
    run: (t, rec) => {
      const { request, outcome } = planText(rec, t.text);
      rec.checks.push(mk('blocks_4_days', '4 天被明确拒绝，不偷偷缩成 3 天', true, !outcome.ok && request.days !== 3, outcome.ok ? `生成了 ${outcome.result.days.length} 天` : outcome.message));
    },
  },
  '27': {
    run: (t, rec) => {
      const { request, outcome } = planText(rec, t.text);
      rec.checks.push(mk('unknown_poi_flagged', '大洋路被识别为库外硬约束', true, request.unknownHardConstraints.length > 0, request.unknownHardConstraints.join(',')));
      rec.checks.push(mk('blocked', '不静默忽略、不发明景点：阻断并解释', true, !outcome.ok, outcome.ok ? '直接生成了行程' : outcome.message));
    },
  },
  '28': {
    run: (t, rec) => {
      const { request, outcome } = planText(rec, t.text);
      rec.checks.push(mk('both_sides_parsed', '“必须去”与“避开”都被识别', true, request.mustIncludePoiIds.includes(ID.fedSquare) && request.excludePoiIds.includes(ID.fedSquare), `must=${request.mustIncludePoiIds.join(',')} exclude=${request.excludePoiIds.join(',')}`));
      rec.checks.push(mk('blocked', '冲突被阻断并解释', true, !outcome.ok, outcome.ok ? '直接生成了行程' : outcome.message));
    },
  },
  '29': {
    run: async (t, rec) => {
      const edited = t.editedText as string;
      const { outcome } = planText(rec, t.text);
      rec.checks.push(mk('plan_ok', '初始行程生成', true, outcome.ok));
      if (!outcome.ok) return;
      const snapshot = JSON.stringify(outcome.result);
      let adapterCalls = 0;
      const hanging: NluDraftAdapter = {
        extractDraft: (_input, { signal }) =>
          new Promise((resolve) => {
            adapterCalls += 1;
            signal.addEventListener('abort', () =>
              resolve({ ok: false, code: 'deadline_exceeded' }),
            );
          }),
      };
      const started = Date.now();
      const interp = await interpretTripRequest({
        rawText: edited,
        sourceFingerprint: edited,
        adapter: hanging,
        deadlineMs: 50,
      });
      const waited = Date.now() - started;
      rec.actions.push(`修改为：${edited}`, '请求 AI 理解（注入永不返回的适配器，截止 50 ms）');
      rec.checks.push(mk('adapter_called', '确实走了模型路径', true, adapterCalls === 1, `${adapterCalls}`));
      rec.checks.push(
        mk(
          'fallback_rules',
          '超时后回退规则并记录 deadline_exceeded',
          true,
          interp.status === 'complete' &&
            interp.diagnostics.acceptedMode === 'rules' &&
            interp.diagnostics.fallbackReasonCode === 'deadline_exceeded',
          interp.status === 'aborted' ? 'aborted' : JSON.stringify(interp.diagnostics),
        ),
      );
      rec.checks.push(mk('bounded_wait', '等待时间受截止时间约束（< 1 s）', true, waited < 1000, `${waited} ms`));
      rec.checks.push(mk('old_plan_kept', '上一份成功行程未被改动', true, JSON.stringify(outcome.result) === snapshot));
    },
    manual: ['页面在回退时保留旧行程、显示回退提示（page.tsx）'],
  },
  '30': {
    run: (t, rec) => {
      const { request, outcome } = planText(rec, t.text);
      rec.checks.push(mk('days', '仍按 2 天理解', true, request.days === 2, `${request.days}`));
      const proposal = buildPlanProposal(request, t.text);
      rec.checks.push(mk('gate_structural', '文本不能跳过确认门：规划仍需与当前输入匹配的提案', true, isProposalCurrent(proposal, t.text) && !isProposalCurrent(null, t.text)));
      // 只看输出部分；request.rawText 里本来就有用户写的“房价/余票”。
      const serialized = JSON.stringify(outcome.ok ? { ...outcome.result, request: null } : {});
      rec.checks.push(mk('no_live_price_claim', '输出中没有酒店房价或活动余票', true, !/房价|余票/.test(serialized)));
    },
    manual: ['页面是否向用户说明“无法保证实时房价与余票”'],
  },
};

const records: TaskRecord[] = [];
const tasks = taskSet.tasks as Task[];

for (const task of tasks) {
  it(`task ${task.id}`, async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(EVAL_CLOCK));
    const def = RUNNERS[task.id];
    const rec: TaskRecord = {
      id: task.id,
      kind: task.kind,
      support: task.support,
      featureTag: task.featureTag,
      input: task.text,
      actions: [],
      parsed: {},
      outcome: {},
      checks: [],
      hardResult: 'pass',
      unsupportedParts: def?.unsupported ?? [],
      manualReview: ['五维质量分（43 号 §3）', ...(def?.manual ?? [])],
      elapsedMs: 0,
    };
    const t0 = performance.now();
    try {
      if (!def) throw new Error('no runner for task');
      await def.run(task, rec);
    } catch (error) {
      rec.checks.push(mk('runner_error', '运行器异常', true, false, String(error)));
    } finally {
      vi.useRealTimers();
    }
    rec.elapsedMs = Math.round(performance.now() - t0);
    rec.hardResult = rec.checks.some((c) => c.hard && c.status === 'fail') ? 'fail' : 'pass';
    records.push(rec);
  });
}

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

afterAll(() => {
  records.sort((a, b) => a.id.localeCompare(b.id));
  const bySupport = (s: Support) => records.filter((r) => r.support === s);
  const passed = (rs: TaskRecord[]) => rs.filter((r) => r.hardResult === 'pass').length;
  const status = git('status --porcelain');
  const runStamp = new Date().toISOString().slice(0, 10);
  const meta = {
    runner: RUNNER_VERSION,
    taskSet: taskSet.taskSetVersion,
    path: 'rules-only（未调用真实模型）',
    evalClock: EVAL_CLOCK,
    runDate: runStamp,
    runtimeConfigVersion: getRuntimeConfig().version,
    gitCommit: git('rev-parse --short HEAD') ?? 'unknown',
    workingTreeDirty: status === null ? 'unknown' : status.length > 0,
    plannerVersion: PLANNER_VERSION,
    poiDataVersion: POI_DATASET.dataVersion,
    node: process.version,
  };
  const summary = {
    total: records.length,
    supported: bySupport('supported').length,
    partial: bySupport('partial').length,
    unsupported: bySupport('unsupported').length,
    fullCoverage: `${bySupport('supported').length}/${records.length}`,
    supportedHardPass: `${passed(bySupport('supported'))}/${bySupport('supported').length}`,
    partialCoreHardPass: `${passed(bySupport('partial'))}/${bySupport('partial').length}（43 号初判为部分支持；各题仍未交付的部分见逐题表）`,
    unsupportedCoreHardPass: `${passed(bySupport('unsupported'))}/${bySupport('unsupported').length}（仅核心行程部分；不代表该题通过）`,
  };
  const outDir = fileURLToPath(new URL('./reports/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    `${outDir}baseline-rules-${runStamp}.json`,
    `${JSON.stringify({ meta, summary, records }, null, 2)}\n`,
  );

  const lines: string[] = [];
  lines.push(`# 报表 A：现有版本 30 题规则路径基线（${runStamp}）`, '');
  lines.push('> 由 `npm run eval:baseline` 生成，请勿手改。解读与结论见 docs/45。', '');
  lines.push('| 项 | 值 |', '|---|---|');
  for (const [k, v] of Object.entries(meta)) lines.push(`| ${k} | ${String(v)} |`);
  lines.push('', '## 汇总', '', '| 指标 | 值 |', '|---|---|');
  for (const [k, v] of Object.entries(summary)) lines.push(`| ${k} | ${String(v)} |`);
  lines.push(
    '',
    '## 逐题',
    '',
    '| ID | 类型 | 支持 | 硬检查 | 未通过的硬检查 | 未通过的诊断项 | 未交付部分 |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of records) {
    const hardFails = r.checks
      .filter((c) => c.hard && c.status === 'fail')
      .map((c) => `${c.label}${c.detail ? `（${c.detail}）` : ''}`.replaceAll('|', '/'));
    const softFails = r.checks.filter((c) => !c.hard && c.status === 'fail').map((c) => c.label);
    lines.push(
      `| ${r.id} | ${r.kind} | ${r.support} | ${r.hardResult === 'pass' ? '✅' : '❌'} | ${hardFails.join('<br>') || '—'} | ${softFails.join('<br>') || '—'} | ${r.unsupportedParts.join('、') || '—'} |`,
    );
  }
  lines.push('', '人工复核（五维分、页面文案）尚未进行；上表只代表程序可判定的硬约束。');
  writeFileSync(`${outDir}baseline-rules-${runStamp}.md`, `${lines.join('\n')}\n`);
});
