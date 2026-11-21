import { afterEach, describe, expect, it } from 'vitest';

import admissionJson from '../../../data/verified/poi-admission-price-v0.4.json';
import adviceJson from '@/data/visitor-advice-v1.json';
import fareJson from '@/data/ptv-fares-v0.4.json';
import poiJson from '@/data/melbourne-pois-v0.1.json';
import {
  POIS,
  POI_DATASET,
  parseTripRequest,
  resolvePoiNameCandidate,
  type AdmissionSnapshot,
  type FareSnapshot,
  type PoiDataset,
} from './planner';
import {
  RuntimeConfigError,
  applyRuntimeConfigBundle,
  loadRuntimeConfig,
  resetRuntimeConfigAll,
  type RuntimeConfigBundle,
} from './runtime-config';
import {
  DEFAULT_RUNTIME_RULES,
  getRuntimeConfig,
  type RuntimePrompt,
} from './runtime-config-state';
import type { VisitorAdviceSnapshot } from './trip-advice';

const prompt = (text = '测试提示词。'.repeat(60)): RuntimePrompt => ({
  version: 'test-prompt',
  text,
});

function bundle(overrides: Partial<RuntimeConfigBundle> = {}): RuntimeConfigBundle {
  return {
    version: 'test-config',
    poiDataset: structuredClone(poiJson) as PoiDataset,
    admissionSnapshot: structuredClone(admissionJson) as AdmissionSnapshot,
    fareSnapshot: structuredClone(fareJson) as FareSnapshot,
    adviceSnapshot: structuredClone(adviceJson) as VisitorAdviceSnapshot,
    rules: structuredClone(DEFAULT_RUNTIME_RULES),
    prompt: prompt(),
    ...overrides,
  };
}

afterEach(() => {
  resetRuntimeConfigAll();
});

describe('runtime config bundle', () => {
  it('swaps POI data, aliases, rules and prompt together', () => {
    const poiDataset = structuredClone(poiJson) as PoiDataset;
    poiDataset.dataVersion = 'test-poi-2026-11-20';
    poiDataset.pois[0].nameZh = '测试地点';
    applyRuntimeConfigBundle(
      bundle({
        poiDataset,
        rules: {
          ...DEFAULT_RUNTIME_RULES,
          minRecognizedFields: 6,
          defaultStartMinutes: 600,
          lunchMinutes: 30,
          extraPoiAliases: {
            'mel-cbd-federation-square': ['测试别名'],
          },
        },
      }),
    );

    expect(POI_DATASET.dataVersion).toBe('test-poi-2026-11-20');
    expect(POIS[0].nameZh).toBe('测试地点');
    expect(resolvePoiNameCandidate('测试别名')).toEqual({
      status: 'resolved',
      poiId: 'mel-cbd-federation-square',
    });
    expect(getRuntimeConfig().version).toBe('test-config');
    expect(getRuntimeConfig().rules.minRecognizedFields).toBe(6);
    expect(getRuntimeConfig().prompt.version).toBe('test-prompt');

    const request = parseTripRequest('我玩 1 天，喜欢历史。');
    expect(request.dailyWindow.startMinutes).toBe(600);
  });

  it('restores the bundled config on reset', () => {
    applyRuntimeConfigBundle(
      bundle({
        rules: { ...DEFAULT_RUNTIME_RULES, defaultStartMinutes: 600 },
      }),
    );
    resetRuntimeConfigAll();
    expect(getRuntimeConfig().version).toBe('bundled');
    expect(POI_DATASET.dataVersion).toBe(poiJson.dataVersion);
    expect(parseTripRequest('我玩 1 天，喜欢历史。').dailyWindow.startMinutes).toBe(
      DEFAULT_RUNTIME_RULES.defaultStartMinutes,
    );
  });
});

describe('runtime config loader', () => {
  it('loads once, then skips unchanged versions', async () => {
    const bodies: Record<string, unknown> = {
      'manifest.json': { version: 'loader-test' },
      'poi.json': poiJson,
      'admission.json': admissionJson,
      'fares.json': fareJson,
      'visitor-advice.json': adviceJson,
      'rules.json': DEFAULT_RUNTIME_RULES,
      'prompt.json': prompt(),
    };
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const key = url.split('/').at(-1) ?? '';
      return {
        ok: true,
        status: 200,
        json: async () => bodies[key],
      };
    }) as unknown as typeof fetch;

    await loadRuntimeConfig({ fetchImpl, baseUrl: '/runtime-config/' });
    expect(getRuntimeConfig().version).toBe('loader-test');
    expect(calls).toHaveLength(7);

    await loadRuntimeConfig({ fetchImpl, baseUrl: '/runtime-config/' });
    expect(calls).toHaveLength(8);
  });

  it('rejects a bad prompt without changing the current config', async () => {
    applyRuntimeConfigBundle(bundle({ version: 'before-bad-prompt' }));
    const bodies: Record<string, unknown> = {
      'manifest.json': { version: 'bad-prompt' },
      'poi.json': poiJson,
      'admission.json': admissionJson,
      'fares.json': fareJson,
      'visitor-advice.json': adviceJson,
      'rules.json': DEFAULT_RUNTIME_RULES,
      'prompt.json': { version: 'bad', text: 'too short' },
    };
    const fetchImpl = (async (url: string) => {
      const key = url.split('/').at(-1) ?? '';
      return { ok: true, status: 200, json: async () => bodies[key] };
    }) as unknown as typeof fetch;

    await expect(
      loadRuntimeConfig({ fetchImpl, baseUrl: '/runtime-config/' }),
    ).rejects.toBeInstanceOf(RuntimeConfigError);
    expect(getRuntimeConfig().version).toBe('before-bad-prompt');
  });
});
