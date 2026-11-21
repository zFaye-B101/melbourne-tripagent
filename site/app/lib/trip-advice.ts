/**
 * 出发准备：交通避坑、行李清单、购物建议。
 *
 * 全部由已确认的行程结果推导（纯函数），所以换点、撤销后自动随整份结果更新。
 * 每条建议都写明“为什么给你”（触发条件）和依据：官方页面摘要（带核验日）
 * 或项目自写的通用规则。没有依据的具体断言不生成——例如不判断某一段电车
 * 是否在免费区内，不给实时天气，不保证店铺营业或退税资格。
 */
import adviceSnapshot from '@/data/visitor-advice-v1.json';

import type { PlannerResult } from './planner';

export type VisitorAdviceSnapshot = typeof adviceSnapshot;

export type AdviceSourceKey = keyof VisitorAdviceSnapshot['sources'];

export interface AdviceSource {
  label: string;
  url: string;
}

export type AdviceStatus =
  /** 来自官方页面的摘要，且在复核期内。 */
  | 'verified'
  /** 官方摘要已超过复核日期，需要游客自己再看一次官网。 */
  | 'stale'
  /** 项目自写的通用建议，不是官方发布内容。 */
  | 'project_rule';

export interface AdviceCard {
  id: string;
  category: 'transport' | 'shopping';
  title: string;
  body: string;
  /** 面向游客：为什么这条和你的行程有关。 */
  trigger: string;
  status: AdviceStatus;
  priority: 'high' | 'normal';
  sources: AdviceSource[];
}

export interface PackingItem {
  id: string;
  text: string;
  /** 面向游客：为什么建议带。 */
  reason: string;
}

export type Season = 'summer' | 'autumn' | 'winter' | 'spring';

export interface TripAdvice {
  snapshotVersion: string;
  verifiedAt: string;
  transport: AdviceCard[];
  packing: {
    season: Season | null;
    seasonLabel: string | null;
    items: PackingItem[];
    note: string;
    sources: AdviceSource[];
  };
  shopping: AdviceCard[];
}

let ADVICE_SNAPSHOT: VisitorAdviceSnapshot = structuredClone(adviceSnapshot);
let SOURCES: VisitorAdviceSnapshot['sources'] = ADVICE_SNAPSHOT.sources;

export function applyTripAdviceRuntime(
  snapshot: VisitorAdviceSnapshot,
): void {
  ADVICE_SNAPSHOT = structuredClone(snapshot);
  SOURCES = ADVICE_SNAPSHOT.sources;
}

export function resetTripAdviceRuntime(): void {
  applyTripAdviceRuntime(adviceSnapshot);
}
const source = (key: AdviceSourceKey): AdviceSource => ({
  label: SOURCES[key].label,
  url: SOURCES[key].url,
});

const QVM_ID = 'mel-cbd-qvm';
const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const SEASON_LABEL: Record<Season, string> = {
  summer: '夏季（12–2 月）',
  autumn: '秋季（3–5 月）',
  winter: '冬季（6–8 月）',
  spring: '春季（9–11 月）',
};

/** 南半球月份 → 季节。 */
export function melbourneSeason(isoDate: string): Season {
  const month = Number(isoDate.slice(5, 7));
  if (month === 12 || month <= 2) return 'summer';
  if (month <= 5) return 'autumn';
  if (month <= 8) return 'winter';
  return 'spring';
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const weekdayOf = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).getUTCDay();

export function buildTripAdvice(
  result: PlannerResult,
  today: string = new Date().toISOString().slice(0, 10),
): TripAdvice {
  const officialStatus: AdviceStatus =
    today > ADVICE_SNAPSHOT.reviewAfter ? 'stale' : 'verified';
  const request = result.request;
  const startDate = request.dateText;
  const tripDates = startDate
    ? result.days.map((_, index) => addDays(startDate, index))
    : [];
  const transitDays = result.days.filter((day) =>
    day.stops.some((stop) => stop.travelFromPrevious.mode === 'public_transport'),
  );
  const usesTransit = transitDays.length > 0;
  const party = request.pricingParty;
  const hasChildren = party.childAges.length > 0 || request.family;
  const hasConcession = party.concessionEligibleCount > 0;
  const text = request.rawText;

  // ---------- 交通 ----------
  const transport: AdviceCard[] = [];
  if (usesTransit) {
    const dayList = transitDays.map((day) => `Day ${day.day}`).join('、');
    transport.push({
      id: 'transport-payment',
      category: 'transport',
      title: '刷卡：银行卡或手机可以直接“嘀”，但只按全价',
      body:
        '墨尔本的火车、电车和公交可以用 Visa／Mastercard 实体卡、手机或手表感应付款，也可以用 myki 卡。感应付款只收全价；优惠票或儿童票需要用 myki，具体资格以官网为准。' +
        (hasConcession || hasChildren
          ? ' 你的同行人里有优惠票或儿童旅客，出发前请在官网确认他们该用哪种卡。'
          : ''),
      trigger: `你的行程在 ${dayList} 有需要乘公共交通的路段。`,
      status: officialStatus,
      priority: hasConcession || hasChildren ? 'high' : 'normal',
      sources: [source('tvVisitors')],
    });
    transport.push({
      id: 'transport-tap-rules',
      category: 'transport',
      title: '上车刷、下车要不要刷：火车和公交要，市区电车通常不用',
      body:
        '乘火车和公交要上车刷、下车也刷；只在 1 区内坐电车，上车刷一次即可。忘记下车刷卡会按默认票价扣费，不一定是最便宜的价格。',
      trigger: '本行程包含公共交通路段，刷卡规则会影响实际扣费。',
      status: officialStatus,
      priority: 'normal',
      sources: [source('tvTapOnOff'), source('tvVisitors')],
    });
    transport.push({
      id: 'transport-free-tram-zone',
      category: 'transport',
      title: '免费电车区：起点和终点都在区内才免费',
      body:
        '只有整段电车的起点和终点都在免费电车区内，才不用刷卡；只要有一端在区外，就按普通电车上车刷卡。本网站没有逐段线路数据，不能替你判断每一段是否在免费区内，请对照官方免费区地图。',
      trigger: '行程里的地点距离是直线估算，无法据此确认某段电车免费。',
      status: officialStatus,
      priority: 'high',
      sources: [source('tvTapOnOff'), source('tvMaps')],
    });
    const halfPriceUntil = ADVICE_SNAPSHOT.transport.halfPriceUntil;
    const afterHalfPrice = tripDates.some((date) => date >= halfPriceUntil);
    transport.push({
      id: 'transport-half-price',
      category: 'transport',
      title: afterHalfPrice
        ? '你的出行日期在半价政策结束之后'
        : `公共交通半价到 ${halfPriceUntil} 前`,
      body: afterHalfPrice
        ? `维州公共交通半价政策写明截至 ${halfPriceUntil}。你有行程日期在这之后，本网站的交通费用估算按半价快照计算，不适用，请出发前查官网现行票价。`
        : `维州公共交通目前半价，官方写明截至 ${halfPriceUntil}。本网站的交通预留按半价快照计算。${startDate ? '' : '你还没填出行日期，如果在这之后出发，费用会不同。'}`,
      trigger: startDate
        ? `你的出行日期是 ${startDate} 起 ${result.days.length} 天。`
        : '你还没有填写具体出行日期。',
      status: officialStatus,
      priority: afterHalfPrice ? 'high' : 'normal',
      sources: [source('halfPrice'), source('tvVisitors')],
    });
  }

  // ---------- 行李 ----------
  const season = startDate ? melbourneSeason(startDate) : null;
  const items: PackingItem[] = [
    {
      id: 'layers',
      text: '可以随时穿脱的分层衣物（薄外套 + 内搭）',
      reason: '墨尔本一天之内天气变化常常较大，分层更好应对。',
    },
    {
      id: 'rain',
      text: '折叠雨伞或轻便防雨外套',
      reason: '一年四季都可能下雨。',
    },
    {
      id: 'shoes',
      text: '走起来舒服的鞋',
      reason: `行程共 ${result.summary.totalPois} 个地点，步行不可避免${request.lowWalking ? '；你要求少走路，更要选好鞋' : ''}。`,
    },
    {
      id: 'plug',
      text: '澳洲规格的转换插头',
      reason: '澳大利亚使用 I 型插座，出发前核对自己的充电器电压范围。',
    },
  ];
  if (season === 'summer' || season === 'spring')
    items.push({
      id: 'sun',
      text: '防晒霜、帽子、太阳镜',
      reason: `你的出行日期在南半球${SEASON_LABEL[season]}，日照较强。`,
    });
  if (season === 'winter' || season === 'autumn')
    items.push({
      id: 'warm',
      text: '保暖外套、围巾',
      reason: `你的出行日期在南半球${SEASON_LABEL[season]}，早晚偏凉。`,
    });
  if (usesTransit)
    items.push({
      id: 'payment-card',
      text: '一张能感应付款的 Visa／Mastercard（或已开通的手机支付），另备一张实体卡',
      reason: '行程里有公共交通路段，可以直接感应付款。',
    });
  if (hasChildren)
    items.push({
      id: 'kids',
      text: '孩子的水壶、零食和替换衣物',
      reason: '你的同行人里有孩子。',
    });
  if (request.venuePreference.value.includes('indoor') || /下雨|雨天/.test(text))
    items.push({
      id: 'rain-backup',
      text: '把室内备选地点存在手机里',
      reason: '你提到担心下雨或偏好室内。',
    });

  // ---------- 购物 ----------
  const shopping: AdviceCard[] = [];
  const qvmDayIndex = result.days.findIndex((day) =>
    day.stops.some((stop) => stop.poiId === QVM_ID),
  );
  if (qvmDayIndex >= 0) {
    const qvmDate = tripDates[qvmDayIndex];
    const closed =
      qvmDate != null &&
      ADVICE_SNAPSHOT.qvm.closedWeekdays.includes(weekdayOf(qvmDate));
    shopping.push({
      id: 'shopping-qvm',
      category: 'shopping',
      title: closed
        ? `维多利亚女王市场：Day ${qvmDayIndex + 1}（${qvmDate}，${WEEKDAY_ZH[weekdayOf(qvmDate)]}）可能不开市`
        : '维多利亚女王市场：先确认开市日',
      body:
        '市场官网列出的开市日是周二、周四、周五、周六和周日（周一、周三不开）；特色店铺 9 点开门。适合买本地食品和纪念品。' +
        (closed
          ? ' 你安排去的那天不在开市日内，建议换一天或用“换一个”替换这一站。'
          : qvmDate
            ? ` 你安排在 ${qvmDate}（${WEEKDAY_ZH[weekdayOf(qvmDate)]}）。`
            : ' 你还没填出行日期，无法判断当天是否开市。'),
      trigger: `你的行程 Day ${qvmDayIndex + 1} 安排了维多利亚女王市场。`,
      status: officialStatus,
      priority: closed || !qvmDate ? 'high' : 'normal',
      sources: [source('qvmVisit')],
    });
  }
  if (/(购物|买点|买些|想买|买什么|哪里买|哪儿买|去哪[^,，。；;\n]{0,4}买|特产|纪念品|伴手礼|手信|shopping)/i.test(text)) {
    const hasMuseum = result.days.some((day) =>
      day.stops.some((stop) =>
        /museum|ngv|acmi|library|potter|gallery/i.test(stop.poiId),
      ),
    );
    shopping.push({
      id: 'shopping-categories',
      category: 'shopping',
      title: '想买点东西：按类别找地方',
      body: [
        '本地食品和小礼物：市场类地点（如维多利亚女王市场）。',
        hasMuseum
          ? '设计感的纪念品：可以留意你行程里博物馆、美术馆的馆内商店。'
          : '设计感的纪念品：博物馆、美术馆的馆内商店通常是好选择。',
        '日用品、零食：市区的超市和药房。',
        '本网站不掌握具体店铺的库存、价格和营业时间，去之前请看店家官网。',
      ].join(''),
      trigger: '你在描述里提到想买东西。',
      status: 'project_rule',
      priority: 'normal',
      sources: qvmDayIndex >= 0 ? [source('qvmVisit')] : [],
    });
    shopping.push({
      id: 'shopping-refund-customs',
      category: 'shopping',
      title: '退税和带回国：以官方规定为准',
      body:
        '在澳洲购物的消费税可能可以在离境时申请退还，条件和办理方式请看澳洲边防局的官方页面；本网站不计算退税资格或金额。食品、动植物制品能否带回，请查询你目的地海关的规定。',
      trigger: '你提到购物；这些规定因人、因目的地而异。',
      status: 'project_rule',
      priority: 'normal',
      sources: [source('abfTrs')],
    });
  }

  return {
    snapshotVersion: ADVICE_SNAPSHOT.snapshotVersion,
    verifiedAt: ADVICE_SNAPSHOT.verifiedAt,
    transport,
    packing: {
      season,
      seasonLabel: season ? SEASON_LABEL[season] : null,
      items,
      note: season
        ? '按出行日期所在季节和你的行程给出，是项目的通用建议，不是天气预报；出发前请看当地天气预报。'
        : '你还没填出行日期，这是通用清单；填了日期后会按南半球季节调整。',
      sources: [source('bomClimate')],
    },
    shopping,
  };
}
