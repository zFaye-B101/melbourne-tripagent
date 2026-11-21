/**
 * 用户自填的费用假设（住宿、餐饮）与由此得出的估算分项。
 *
 * 这些数字不是价格事实：它们来自旅行者自己的描述或详细设置，只用于给出
 * “带假设的行程估算区间”。已核实的门票与交通仍由规划器按快照计算；
 * 这里不从酒店星级或天数推断房价或住宿晚数。
 */
import type { FieldSource } from './planner';

export interface AccommodationAssumption {
  /** 整个同行团体每晚的住宿估算（澳分）。 */
  perNightMinCents: number;
  perNightMaxCents: number;
  /** 用户明确说出的晚数；没说就是 null，不从旅行天数推断。 */
  nights: number | null;
  source: Extract<FieldSource, 'text' | 'structured'>;
  evidence: string | null;
}

export interface FoodAssumption {
  perPersonPerDayMinCents: number;
  perPersonPerDayMaxCents: number;
  source: Extract<FieldSource, 'text' | 'structured'>;
  evidence: string | null;
}

export interface CostAssumptions {
  accommodation: AccommodationAssumption | null;
  food: FoodAssumption | null;
}

export const NO_COST_ASSUMPTIONS: CostAssumptions = {
  accommodation: null,
  food: null,
};

export interface AssumptionCostItem {
  id: 'accommodation' | 'food';
  label: string;
  basis: 'user_assumption';
  minCents: number | null;
  maxCents: number | null;
  /** 面向游客的计算方式，例如「A$100–150 × 1 晚」。 */
  quantity: string;
  /** 为什么还算不出来；能算出时为 null。 */
  missing: string | null;
}

const NON_AUD =
  /(?:CNY|RMB|人民币|¥|JPY|日元|USD|美元|US\$|EUR|欧元|€|GBP|英镑|£|HKD|港币|港元|SGD|新币|CAD|加元|NZD|纽币)/i;
const AMOUNT = String.raw`(?:A\$|AUD|澳元)?\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:澳元|AUD)?`;
const RANGE = String.raw`${AMOUNT}(?:\s*(?:-|–|—|~|～|到|至)\s*${AMOUNT})?`;
const CHINESE_COUNT: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

const toCents = (value: string) => Math.round(Number(value) * 100);

function readRange(
  match: RegExpMatchArray,
  firstGroup: number,
): { min: number; max: number } | null {
  const a = match[firstGroup];
  const b = match[firstGroup + 1];
  if (!a) return null;
  const min = toCents(a);
  const max = b ? toCents(b) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min)
    return null;
  return { min, max };
}

/**
 * 从旅行描述里读取住宿与餐饮的费用假设。只接受澳元（或未写币种的数字）；
 * 写了其他币种时不换算，给出提示并保持未知。
 */
export function parseCostAssumptions(rawText: string): {
  value: CostAssumptions;
  warnings: string[];
} {
  const text = rawText.normalize('NFKC');
  const warnings: string[] = [];
  const value: CostAssumptions = { accommodation: null, food: null };

  const lodgingClause = text.match(
    /(?:住宿|酒店|住)[^,，。；;\n]{0,10}?(?:每晚|一晚|每夜|一夜)[^,，。；;\n]*/u,
  )?.[0];
  if (lodgingClause) {
    if (NON_AUD.test(lodgingClause)) {
      warnings.push('住宿费用只接受澳元，其他币种不会自动换算；住宿暂按未知处理。');
    } else {
      const match = lodgingClause.match(
        new RegExp(String.raw`(?:每晚|一晚|每夜|一夜)[^\d]{0,6}?${RANGE}`, 'u'),
      );
      const range = match ? readRange(match, 1) : null;
      if (range) {
        const nightsMatch = text.match(
          /住\s*(\d{1,2}|[一两二三四五六七])\s*(?:晚|夜)|(\d{1,2}|[一两二三四五六七])\s*(?:晚|夜)/u,
        );
        const token = nightsMatch?.[1] ?? nightsMatch?.[2];
        const nights = token
          ? /^\d+$/.test(token)
            ? Number(token)
            : (CHINESE_COUNT[token] ?? null)
          : null;
        value.accommodation = {
          perNightMinCents: range.min,
          perNightMaxCents: range.max,
          nights: nights && nights > 0 ? nights : null,
          source: 'text',
          evidence: lodgingClause.trim(),
        };
      }
    }
  }

  const foodClause = text.match(
    /(?:餐饮|吃饭|餐费|伙食)[^,，。；;\n]{0,8}?每人每天[^,，。；;\n]*/u,
  )?.[0];
  if (foodClause) {
    if (NON_AUD.test(foodClause)) {
      warnings.push('餐饮费用只接受澳元，其他币种不会自动换算；餐饮暂按未知处理。');
    } else {
      const match = foodClause.match(
        new RegExp(String.raw`每人每天[^\d]{0,6}?${RANGE}`, 'u'),
      );
      const range = match ? readRange(match, 1) : null;
      if (range)
        value.food = {
          perPersonPerDayMinCents: range.min,
          perPersonPerDayMaxCents: range.max,
          source: 'text',
          evidence: foodClause.trim(),
        };
    }
  }
  return { value, warnings };
}

const aud = (cents: number) =>
  `A$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const audRange = (min: number, max: number) =>
  min === max ? aud(min) : `${aud(min)}–${aud(max).replace('A$', '')}`;

/**
 * 按假设算出住宿与餐饮分项。人数未确认时餐饮算不出；住宿没说晚数时也算不出。
 * 算不出时金额为 null，并写明缺什么，绝不当作 A$0。
 */
export function assumptionCostItems(
  assumptions: CostAssumptions | undefined,
  context: { travelers: number | null; tripDays: number },
): AssumptionCostItem[] {
  const items: AssumptionCostItem[] = [];
  const lodging = assumptions?.accommodation;
  if (lodging) {
    const perNight = audRange(lodging.perNightMinCents, lodging.perNightMaxCents);
    items.push(
      lodging.nights == null
        ? {
            id: 'accommodation',
            label: '住宿（你的估算）',
            basis: 'user_assumption',
            minCents: null,
            maxCents: null,
            quantity: `每晚 ${perNight} × ? 晚`,
            missing: '住几晚还没说明',
          }
        : {
            id: 'accommodation',
            label: '住宿（你的估算）',
            basis: 'user_assumption',
            minCents: lodging.perNightMinCents * lodging.nights,
            maxCents: lodging.perNightMaxCents * lodging.nights,
            quantity: `每晚 ${perNight} × ${lodging.nights} 晚`,
            missing: null,
          },
    );
  }
  const food = assumptions?.food;
  if (food) {
    const perDay = audRange(food.perPersonPerDayMinCents, food.perPersonPerDayMaxCents);
    items.push(
      context.travelers == null
        ? {
            id: 'food',
            label: '餐饮（你的估算）',
            basis: 'user_assumption',
            minCents: null,
            maxCents: null,
            quantity: `每人每天 ${perDay} × ? 人 × ${context.tripDays} 天`,
            missing: '同行人数还没确认',
          }
        : {
            id: 'food',
            label: '餐饮（你的估算）',
            basis: 'user_assumption',
            minCents: food.perPersonPerDayMinCents * context.travelers * context.tripDays,
            maxCents: food.perPersonPerDayMaxCents * context.travelers * context.tripDays,
            quantity: `每人每天 ${perDay} × ${context.travelers} 人 × ${context.tripDays} 天`,
            missing: null,
          },
    );
  }
  return items;
}

/** 解析详细设置里「100-150」「120」这类澳元输入；空串为 undefined，格式不对为 null。 */
export function parseAudRangeInput(
  input: string,
): { min: number; max: number } | null | undefined {
  const trimmed = input.normalize('NFKC').trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(
    /^(?:A\$)?\s*(\d{1,5}(?:\.\d{1,2})?)\s*(?:(?:-|–|—|~|～|到|至)\s*(?:A\$)?\s*(\d{1,5}(?:\.\d{1,2})?))?$/u,
  );
  return match ? readRange(match, 1) : null;
}
