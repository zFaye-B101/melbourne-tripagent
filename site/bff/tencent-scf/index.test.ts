import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScfHandler, type ScfEnvironment } from './index';
import type { CloudbaseBudgetDatabase } from './budget-cloudbase';

const origin = 'https://melbourne-tripagent.app.workbuddy.host';
const body = JSON.stringify({
  text: '墨尔本玩三天',
  locale: 'zh-CN',
  datasetVersion: 'mel-poi-v0.1-2026-09-14',
});
const baseEnv: ScfEnvironment = {
  LLM_ENABLED: 'false',
  LLM_RUNTIME_ENV: 'production',
  ALLOWED_ORIGINS: origin,
};

function event(headers: Record<string, string> = { origin }) {
  return {
    path: '/v1/trip-requests/parse',
    httpMethod: 'POST',
    headers,
    body,
  };
}

describe('Tencent SCF Function URL adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('translates the event-function HTTP envelope without exposing a key', async () => {
    const handler = createScfHandler();
    const result = await handler(event(), undefined, baseEnv);
    expect(result.statusCode).toBe(200);
    expect(result.headers['access-control-allow-origin']).toBe(origin);
    const parsed = JSON.parse(result.body);
    expect(parsed.apiVersion).toBe('trip-parse-api-v1');
    expect(parsed.parser.acceptedMode).toBe('rules');
    expect(result.body).not.toContain('API_KEY');
  });

  it('answers preflight and rejects a different browser origin', async () => {
    const handler = createScfHandler();
    const preflight = await handler(
      {
        path: '/v1/trip-requests/parse',
        httpMethod: 'OPTIONS',
        headers: { origin },
      },
      undefined,
      baseEnv,
    );
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    const rejected = await handler(
      event({ origin: 'https://other.example' }),
      undefined,
      baseEnv,
    );
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('fails closed if the shared budget configuration is absent', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const database = vi.fn();
    const handler = createScfHandler({ database });
    const result = await handler(event(), undefined, {
      ...baseEnv,
      LLM_ENABLED: 'true',
      LLM_PROVIDER: 'dashscope',
      DASHSCOPE_API_KEY: 'server-only',
    });
    const parsed = JSON.parse(result.body);
    expect(parsed.parser).toMatchObject({
      attemptedMode: 'llm',
      acceptedMode: 'rules',
      fallbackReasonCode: 'auth_or_config',
    });
    expect(database).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reserves a shared unit before attempting the provider', async () => {
    let allocated = 0;
    const db: CloudbaseBudgetDatabase = {
      async runTransaction(callback) {
        const result = await callback({
          collection() {
            return {
              doc() {
                return {
                  async get() {
                    return {
                      data: {
                        limitUnits: 2,
                        allocatedUnits: allocated,
                        windowMinute: '',
                        windowCount: 0,
                      },
                    };
                  },
                  async set(data) {
                    allocated = data.allocatedUnits;
                  },
                };
              },
            };
          },
        });
        return { result, errMsg: 'runTransaction:ok' };
      },
    };
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 503 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const handler = createScfHandler({ database: async () => db });
    const result = await handler(event(), undefined, {
      ...baseEnv,
      LLM_ENABLED: 'true',
      LLM_PROVIDER: 'dashscope',
      LLM_BUDGET_PERIOD: 'demo-2026-09',
      LLM_BUDGET_LIMIT_UNITS: '2',
      LLM_MAX_COST_UNITS: '1',
      LLM_MAX_CALLS_PER_MINUTE: '2',
      CLOUDBASE_ENV_ID: 'cloudbase-env',
      CLOUDBASE_APIKEY: 'server-only-cloudbase-key',
      DASHSCOPE_API_KEY: 'server-only-provider-key',
      DASHSCOPE_WORKSPACE_ID: 'workspace-1',
      DASHSCOPE_MODEL: 'qwen3.8-flash',
      DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
    });
    const parsed = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(parsed.parser.attemptedMode).toBe('llm');
    expect(parsed.parser.acceptedMode).toBe('rules');
    expect(allocated).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.body).not.toContain('server-only');
  });
});
