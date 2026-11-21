/**
 * 运行时配置加载器。
 *
 * 配置由静态站点的 `/runtime-config/` 目录提供，页面启动和轮询时重新取。
 * 取不到、格式不对或版本没变时保持当前配置；打包时的配置始终是回退值。
 *
 * 规则只外置“可调参数”，不把规划不变量交给配置：时间不重叠、必去/避开、
 * 预算披露、换点冻结等仍由代码保证。
 */
import type {
  AdmissionSnapshot,
  FareSnapshot,
  PoiDataset,
} from './planner';
import { applyPlannerRuntime, resetPlannerRuntime } from './planner';
import {
  applyTripAdviceRuntime,
  resetTripAdviceRuntime,
  type VisitorAdviceSnapshot,
} from './trip-advice';
import {
  DEFAULT_RUNTIME_PROMPT,
  DEFAULT_RUNTIME_RULES,
  getRuntimeConfig,
  resetRuntimeConfig,
  setRuntimeConfig,
  subscribeRuntimeConfig,
  type RuntimeConfigState,
  type RuntimePrompt,
  type RuntimeRules,
} from './runtime-config-state';

export { subscribeRuntimeConfig };

const RUNTIME_CONFIG_BASE = '/runtime-config/';
const MANIFEST_FILE = 'manifest.json';
const FILES = {
  poiDataset: 'poi.json',
  admissionSnapshot: 'admission.json',
  fareSnapshot: 'fares.json',
  adviceSnapshot: 'visitor-advice.json',
  rules: 'rules.json',
  prompt: 'prompt.json',
} as const;

export type RuntimeConfigFileKey = keyof typeof FILES;

export interface RuntimeManifest {
  version: string;
}

export interface RuntimeConfigBundle {
  version: string;
  poiDataset: PoiDataset;
  admissionSnapshot: AdmissionSnapshot;
  fareSnapshot: FareSnapshot;
  adviceSnapshot: VisitorAdviceSnapshot;
  rules: RuntimeRules;
  prompt: RuntimePrompt;
}

export interface LoadRuntimeConfigOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== 'string' || field.trim().length === 0)
    throw new RuntimeConfigError(`${label}.${key} 缺失。`);
  return field;
}

function requiredArray(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown[] {
  const field = value[key];
  if (!Array.isArray(field)) throw new RuntimeConfigError(`${label}.${key} 必须是数组。`);
  return field;
}

function parseManifest(value: unknown): RuntimeManifest {
  if (!isRecord(value)) throw new RuntimeConfigError('manifest 必须是对象。');
  return { version: requiredString(value, 'version', 'manifest') };
}

function parsePoiDataset(value: unknown): PoiDataset {
  if (!isRecord(value)) throw new RuntimeConfigError('POI 快照必须是对象。');
  const pois = requiredArray(value, 'pois', 'poi');
  if (pois.length === 0) throw new RuntimeConfigError('POI 快照不能为空。');
  for (const [index, poi] of pois.entries()) {
    if (!isRecord(poi)) throw new RuntimeConfigError(`poi[${index}] 必须是对象。`);
    requiredString(poi, 'id', `poi[${index}]`);
    requiredString(poi, 'nameZh', `poi[${index}]`);
    requiredString(poi, 'nameEn', `poi[${index}]`);
    requiredArray(poi, 'aliases', `poi[${index}]`);
    requiredArray(poi, 'tags', `poi[${index}]`);
  }
  return {
    ...value,
    sourceDatasetId: requiredString(value, 'sourceDatasetId', 'poi'),
    sourceDatasetUrl: requiredString(value, 'sourceDatasetUrl', 'poi'),
    license: requiredString(value, 'license', 'poi'),
    attribution: requiredString(value, 'attribution', 'poi'),
    generatedAt: requiredString(value, 'generatedAt', 'poi'),
    dataVersion: requiredString(value, 'dataVersion', 'poi'),
    pois: pois as PoiDataset['pois'],
  } as PoiDataset;
}

function parseAdmissionSnapshot(value: unknown): AdmissionSnapshot {
  if (!isRecord(value)) throw new RuntimeConfigError('门票快照必须是对象。');
  const records = requiredArray(value, 'records', 'admission');
  for (const [index, record] of records.entries()) {
    if (!isRecord(record)) throw new RuntimeConfigError(`admission.records[${index}] 必须是对象。`);
    requiredString(record, 'poiId', `admission.records[${index}]`);
  }
  return {
    ...value,
    snapshotVersion: requiredString(value, 'snapshotVersion', 'admission'),
    currency: 'AUD',
    verifiedAt: requiredString(value, 'verifiedAt', 'admission'),
    records: records as AdmissionSnapshot['records'],
  } as AdmissionSnapshot;
}

function parseFareSnapshot(value: unknown): FareSnapshot {
  if (!isRecord(value)) throw new RuntimeConfigError('票价快照必须是对象。');
  const zone12 = value.zone12;
  if (!isRecord(zone12) || !isRecord(zone12.fullFare))
    throw new RuntimeConfigError('fares.zone12.fullFare 缺失。');
  if (typeof zone12.fullFare.twoHourCents !== 'number')
    throw new RuntimeConfigError('fares.zone12.fullFare.twoHourCents 缺失。');
  if (!isRecord(value.physicalCard))
    throw new RuntimeConfigError('fares.physicalCard 缺失。');
  return {
    ...value,
    policyVersion: requiredString(value, 'policyVersion', 'fares'),
    effectiveFrom: requiredString(value, 'effectiveFrom', 'fares'),
    effectiveUntil: requiredString(value, 'effectiveUntil', 'fares'),
    verifiedAt: requiredString(value, 'verifiedAt', 'fares'),
    zone12: zone12 as FareSnapshot['zone12'],
    physicalCard: value.physicalCard as FareSnapshot['physicalCard'],
    sourceUrl: requiredString(value, 'sourceUrl', 'fares'),
    policySourceUrl: requiredString(value, 'policySourceUrl', 'fares'),
    notes: requiredArray(value, 'notes', 'fares') as string[],
  } as FareSnapshot;
}

function parseAdviceSnapshot(value: unknown): VisitorAdviceSnapshot {
  if (!isRecord(value)) throw new RuntimeConfigError('出发准备快照必须是对象。');
  if (!isRecord(value.sources)) throw new RuntimeConfigError('advice.sources 缺失。');
  for (const key of [
    'tvVisitors',
    'tvTapOnOff',
    'tvMaps',
    'halfPrice',
    'qvmVisit',
    'abfTrs',
    'bomClimate',
  ])
    if (!isRecord(value.sources[key]))
      throw new RuntimeConfigError(`advice.sources.${key} 缺失。`);
  if (!isRecord(value.qvm)) throw new RuntimeConfigError('advice.qvm 缺失。');
  if (!isRecord(value.transport))
    throw new RuntimeConfigError('advice.transport 缺失。');
  const closedWeekdays = value.qvm.closedWeekdays;
  if (
    !Array.isArray(closedWeekdays) ||
    closedWeekdays.some((day) => !Number.isInteger(day))
  )
    throw new RuntimeConfigError('advice.qvm.closedWeekdays 必须是整数数组。');
  return {
    ...value,
    snapshotVersion: requiredString(value, 'snapshotVersion', 'advice'),
    verifiedAt: requiredString(value, 'verifiedAt', 'advice'),
    reviewAfter: requiredString(value, 'reviewAfter', 'advice'),
    sources: value.sources,
    qvm: value.qvm,
    transport: value.transport,
  } as VisitorAdviceSnapshot;
}

function integerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return value >= min && value <= max ? value : fallback;
}

function parseRules(value: unknown): RuntimeRules {
  const raw = isRecord(value) ? value : {};
  const defaults = DEFAULT_RUNTIME_RULES;
  const aliases = isRecord(raw.extraPoiAliases)
    ? Object.fromEntries(
        Object.entries(raw.extraPoiAliases)
          .filter(([, list]) => Array.isArray(list))
          .map(([poiId, list]) => [
            poiId,
            (list as unknown[]).filter(
              (alias): alias is string => typeof alias === 'string',
            ),
          ])
          .filter(([, list]) => (list as string[]).length > 0),
      )
    : {};
  let earliestStartMinutes = integerInRange(
    raw.earliestStartMinutes,
    defaults.earliestStartMinutes,
    0,
    23 * 60 + 59,
  );
  let latestStartMinutes = integerInRange(
    raw.latestStartMinutes,
    defaults.latestStartMinutes,
    0,
    23 * 60 + 59,
  );
  if (earliestStartMinutes > latestStartMinutes) {
    earliestStartMinutes = defaults.earliestStartMinutes;
    latestStartMinutes = defaults.latestStartMinutes;
  }
  let lunchStartMinutes = integerInRange(
    raw.lunchStartMinutes,
    defaults.lunchStartMinutes,
    0,
    23 * 60 + 59,
  );
  let latestLunchStartMinutes = integerInRange(
    raw.latestLunchStartMinutes,
    defaults.latestLunchStartMinutes,
    0,
    23 * 60 + 59,
  );
  if (lunchStartMinutes > latestLunchStartMinutes) {
    lunchStartMinutes = defaults.lunchStartMinutes;
    latestLunchStartMinutes = defaults.latestLunchStartMinutes;
  }
  let defaultStartMinutes = integerInRange(
    raw.defaultStartMinutes,
    defaults.defaultStartMinutes,
    0,
    23 * 60 + 59,
  );
  if (
    defaultStartMinutes < earliestStartMinutes ||
    defaultStartMinutes > latestStartMinutes
  )
    defaultStartMinutes = defaults.defaultStartMinutes;
  return {
    version:
      typeof raw.version === 'string' && raw.version.trim()
        ? raw.version
        : defaults.version,
    minRecognizedFields: integerInRange(
      raw.minRecognizedFields,
      defaults.minRecognizedFields,
      1,
      12,
    ),
    defaultStartMinutes,
    defaultEndMinutes: integerInRange(
      raw.defaultEndMinutes,
      defaults.defaultEndMinutes,
      0,
      23 * 60 + 59,
    ),
    earliestStartMinutes,
    latestStartMinutes,
    lunchStartMinutes,
    latestLunchStartMinutes,
    lunchMinutes: integerInRange(
      raw.lunchMinutes,
      defaults.lunchMinutes,
      15,
      120,
    ),
    extraPoiAliases: {
      ...defaults.extraPoiAliases,
      ...aliases,
    },
  };
}

function parsePrompt(value: unknown): RuntimePrompt {
  if (!isRecord(value)) throw new RuntimeConfigError('prompt 必须是对象。');
  const version = requiredString(value, 'version', 'prompt');
  const text = requiredString(value, 'text', 'prompt');
  if (text.trim().length < 200)
    throw new RuntimeConfigError('prompt.text 太短，拒绝替换。');
  return { version, text };
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok)
    throw new RuntimeConfigError(`${url} 返回 ${response.status}。`);
  return response.json();
}

export async function loadRuntimeConfig(
  options: LoadRuntimeConfigOptions = {},
): Promise<RuntimeConfigState | null> {
  const baseUrl = options.baseUrl ?? RUNTIME_CONFIG_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const manifest = parseManifest(
    await fetchJson(`${baseUrl}${MANIFEST_FILE}`, fetchImpl, options.signal),
  );
  const current = getRuntimeConfig();
  if (current.version === manifest.version) return current;

  const read = (key: RuntimeConfigFileKey) =>
    fetchJson(`${baseUrl}${FILES[key]}`, fetchImpl, options.signal);
  const [poiDataset, admissionSnapshot, fareSnapshot, adviceSnapshot, rules, prompt] =
    await Promise.all([
      read('poiDataset'),
      read('admissionSnapshot'),
      read('fareSnapshot'),
      read('adviceSnapshot'),
      read('rules'),
      read('prompt'),
    ]);

  const bundle: RuntimeConfigBundle = {
    version: manifest.version,
    poiDataset: parsePoiDataset(poiDataset),
    admissionSnapshot: parseAdmissionSnapshot(admissionSnapshot),
    fareSnapshot: parseFareSnapshot(fareSnapshot),
    adviceSnapshot: parseAdviceSnapshot(adviceSnapshot),
    rules: parseRules(rules),
    prompt: parsePrompt(prompt),
  };
  applyRuntimeConfigBundle(bundle);
  return getRuntimeConfig();
}

export function applyRuntimeConfigBundle(bundle: RuntimeConfigBundle): void {
  applyPlannerRuntime({
    poiDataset: bundle.poiDataset,
    admissionSnapshot: bundle.admissionSnapshot,
    fareSnapshot: bundle.fareSnapshot,
    adviceSnapshot: bundle.adviceSnapshot,
    rules: bundle.rules,
  });
  applyTripAdviceRuntime(bundle.adviceSnapshot);
  setRuntimeConfig({
    version: bundle.version,
    rules: bundle.rules,
    prompt: bundle.prompt,
    loadedAt: new Date().toISOString(),
  });
}

export function resetRuntimeConfigAll(): void {
  resetPlannerRuntime();
  resetTripAdviceRuntime();
  resetRuntimeConfig();
}

export { DEFAULT_RUNTIME_PROMPT, DEFAULT_RUNTIME_RULES };
