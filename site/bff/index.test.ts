import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  deadlineMsForRequest,
  optionalAssertionElisionEnabled,
} from './index';
import example from '../../data/examples/trip-request-v2.example.json';

const env = { LLM_ENABLED: 'false', ALLOWED_ORIGINS: 'http://localhost:3000' };

describe('trip parse BFF', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a longer provider deadline only for explicit local loopback requests', () => {
    expect(
      deadlineMsForRequest(
        { LLM_RUNTIME_ENV: 'local' },
        new Request('http://localhost:8787/v1/trip-requests/parse'),
      ),
    ).toBe(60_000);
    expect(
      deadlineMsForRequest(
        { LLM_RUNTIME_ENV: 'production' },
        new Request('http://localhost:8787/v1/trip-requests/parse'),
      ),
    ).toBe(4_000);
    expect(
      deadlineMsForRequest(
        { LLM_RUNTIME_ENV: 'local' },
        new Request('https://bff.example/v1/trip-requests/parse'),
      ),
    ).toBe(4_000);
  });

  it('keeps optional assertion elision private to local loopback', () => {
    const enabled = {
      LLM_RUNTIME_ENV: 'local',
      LLM_OPTIONAL_ASSERTION_ELISION: 'true',
    };
    expect(
      optionalAssertionElisionEnabled(
        enabled,
        new Request('http://localhost:8787/v1/trip-requests/parse'),
      ),
    ).toBe(true);
    expect(
      optionalAssertionElisionEnabled(
        enabled,
        new Request('https://bff.example/v1/trip-requests/parse'),
      ),
    ).toBe(false);
    expect(
      optionalAssertionElisionEnabled(
        {
          LLM_RUNTIME_ENV: 'production',
          LLM_OPTIONAL_ASSERTION_ELISION: 'true',
        },
        new Request('http://localhost:8787/v1/trip-requests/parse'),
      ),
    ).toBe(false);
  });

  it('keeps remote parsing disabled by default and returns a provider-neutral response', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      env,
    );
    const body = (await response.json()) as {
      apiVersion?: unknown;
      parser?: { acceptedMode?: unknown };
      request?: Record<string, unknown> | null;
    };
    expect(response.status).toBe(200);
    expect(body.apiVersion).toBe('trip-parse-api-v1');
    expect(body.parser?.acceptedMode).toBe('rules');
    expect(body.request).not.toHaveProperty('rawText');
    expect(body).not.toHaveProperty('provider');
  });

  it('keeps HTTP body and headers identical when the local diagnostic flag changes', async () => {
    const randomUuid = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000001');
    const input = {
      text: '墨尔本玩三天',
      locale: 'zh-CN',
      datasetVersion: 'mel-poi-v0.1-2026-09-14',
    };
    const call = (flag: 'true' | 'false') =>
      worker.fetch(
        new Request('http://localhost:8787/v1/trip-requests/parse', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: JSON.stringify(input),
        }),
        {
          ...env,
          LLM_RUNTIME_ENV: 'local',
          LLM_LOCAL_DIAGNOSTICS: flag,
        },
      );
    const disabled = await call('false');
    const enabled = await call('true');
    expect(enabled.status).toBe(disabled.status);
    expect([...enabled.headers.entries()]).toEqual([
      ...disabled.headers.entries(),
    ]);
    expect(await enabled.text()).toBe(await disabled.text());
    randomUuid.mockRestore();
  });

  it('rejects dataset version mismatch before parsing', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'old',
        }),
      }),
      env,
    );
    expect(response.status).toBe(409);
  });

  it('does not call OpenAI while the remote switch is off', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      { ...env, OPENAI_API_KEY: 'not-used', OPENAI_MODEL: 'not-used' },
    );
    expect(response.status).toBe(200);
  });

  it('refuses remote calls when the server-side rate limiter is missing', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        OPENAI_API_KEY: 'must-not-be-used',
        OPENAI_MODEL: 'must-not-be-used',
      },
    );
    const body = (await response.json()) as {
      parser?: {
        attemptedMode?: unknown;
        acceptedMode?: unknown;
        fallbackReasonCode?: unknown;
      };
    };
    expect(body.parser).toMatchObject({
      attemptedMode: 'llm',
      acceptedMode: 'rules',
      fallbackReasonCode: 'auth_or_config',
    });
  });

  it.each(['openai', 'deepseek', 'zhipu', 'dashscope'])(
    'keeps public %s calls closed even with credentials and a limiter',
    async (provider) => {
      const providerFetch = vi.fn();
      const limiter = vi.fn(async () => ({ success: true }));
      vi.stubGlobal('fetch', providerFetch);
      const response = await worker.fetch(
        new Request('https://bff.example/v1/trip-requests/parse', {
          method: 'POST',
          headers: { origin: 'https://melbourne-tripagent.app.workbuddy.host' },
          body: JSON.stringify({
            text: '墨尔本玩三天',
            locale: 'zh-CN',
            datasetVersion: 'mel-poi-v0.1-2026-09-14',
          }),
        }),
        {
          ...env,
          LLM_ENABLED: 'true',
          LLM_PROVIDER: provider,
          LLM_RUNTIME_ENV: 'production',
          ALLOWED_ORIGINS: 'https://melbourne-tripagent.app.workbuddy.host',
          LLM_RATE_LIMITER: { limit: limiter },
          OPENAI_API_KEY: 'server-only',
          OPENAI_MODEL: 'mock-model',
          DEEPSEEK_API_KEY: 'server-only',
          DEEPSEEK_MODEL: 'mock-model',
          ZHIPU_API_KEY: 'server-only',
          ZHIPU_MODEL: 'mock-model',
          DASHSCOPE_API_KEY: 'server-only',
          DASHSCOPE_WORKSPACE_ID: 'mock-workspace',
          DASHSCOPE_MODEL: 'mock-model',
          DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
        },
      );
      const body = (await response.json()) as {
        parser?: {
          attemptedMode?: unknown;
          acceptedMode?: unknown;
          fallbackReasonCode?: unknown;
        };
      };
      expect(response.status).toBe(200);
      expect(body.parser).toMatchObject({
        attemptedMode: 'llm',
        acceptedMode: 'rules',
        fallbackReasonCode: 'auth_or_config',
      });
      expect(limiter).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    },
  );

  it('falls back before the provider when the anonymous quota is exhausted', async () => {
    const response = await worker.fetch(
      new Request('http://localhost:8787/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_RUNTIME_ENV: 'local',
        LLM_RATE_LIMITER: { limit: async () => ({ success: false }) },
        OPENAI_API_KEY: 'must-not-be-used',
        OPENAI_MODEL: 'must-not-be-used',
      },
    );
    const body = (await response.json()) as {
      parser?: { fallbackReasonCode?: unknown };
    };
    expect(body.parser?.fallbackReasonCode).toBe('rate_limited');
  });

  it('allows an explicit local-only limiter bypass for a configured provider', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: JSON.stringify(example) },
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const text =
      '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
    const response = await worker.fetch(
      new Request('http://localhost:8787/v1/trip-requests/parse', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: JSON.stringify({
          text,
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'zhipu',
        LLM_RUNTIME_ENV: 'local',
        LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
        ZHIPU_API_KEY: 'server-only',
        ZHIPU_MODEL: 'glm-4.7-flash',
      },
    );
    const body = (await response.json()) as {
      parser?: { attemptedMode?: unknown; acceptedMode?: unknown };
    };
    expect(response.status).toBe(200);
    expect(body.parser).toMatchObject({
      attemptedMode: 'llm',
      acceptedMode: 'llm',
    });
  });

  it('selects DashScope on local loopback and accepts its LLM draft', async () => {
    const providerFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(example) },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', providerFetch);
    const response = await worker.fetch(
      new Request('http://127.0.0.1:8787/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'dashscope',
        LLM_RUNTIME_ENV: 'local',
        LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
        DASHSCOPE_API_KEY: 'server-only',
        DASHSCOPE_WORKSPACE_ID: 'workspace-1',
        DASHSCOPE_MODEL: 'qwen3.8-flash',
        DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
      },
    );
    expect(
      ((await response.json()) as { parser?: unknown }).parser,
    ).toMatchObject({ attemptedMode: 'llm', acceptedMode: 'llm' });
    expect(providerFetch).toHaveBeenCalledTimes(1);
  });

  it('never calls DashScope off loopback even after a successful server limiter check', async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await worker.fetch(
      new Request('https://bff.example/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩 3 天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'dashscope',
        LLM_RUNTIME_ENV: 'local',
        LLM_RATE_LIMITER: { limit: async () => ({ success: true }) },
        DASHSCOPE_API_KEY: 'server-only',
        DASHSCOPE_WORKSPACE_ID: 'workspace-1',
        DASHSCOPE_MODEL: 'qwen3.8-flash',
        DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
      },
    );
    expect(
      ((await response.json()) as { parser?: unknown }).parser,
    ).toMatchObject({ fallbackReasonCode: 'auth_or_config' });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('keeps the public gate shut even with a budget binding and local budget flag', async () => {
    const providerFetch = vi.fn();
    const getByName = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await worker.fetch(
      new Request('https://bff.example/v1/trip-requests/parse', {
        method: 'POST',
        headers: { origin: 'https://melbourne-tripagent.app.workbuddy.host' },
        body: JSON.stringify({
          text: '墨尔本玩两天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_RUNTIME_ENV: 'production',
        LLM_PROVIDER: 'dashscope',
        LLM_LOCAL_BUDGET_ENABLED: 'true',
        LLM_MAX_COST_UNITS: '1',
        LLM_BUDGET_DO: { getByName } as unknown as NonNullable<
          Parameters<typeof worker.fetch>[1]['LLM_BUDGET_DO']
        >,
        ALLOWED_ORIGINS: 'https://melbourne-tripagent.app.workbuddy.host',
        LLM_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
        DASHSCOPE_API_KEY: 'server-only',
        DASHSCOPE_WORKSPACE_ID: 'workspace-1',
        DASHSCOPE_MODEL: 'qwen3.8-flash',
        DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
      },
    );
    expect(
      ((await response.json()) as { parser?: unknown }).parser,
    ).toMatchObject({ attemptedMode: 'llm', acceptedMode: 'rules' });
    expect(getByName).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('uses the opt-in budget reservation on loopback before trying the model', async () => {
    const providerFetch = vi.fn();
    const reserve = vi.fn(async () => null);
    const settle = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await worker.fetch(
      new Request('http://localhost:8787/v1/trip-requests/parse', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: JSON.stringify({
          text: '墨尔本玩两天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_RUNTIME_ENV: 'local',
        LLM_PROVIDER: 'dashscope',
        LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
        LLM_LOCAL_BUDGET_ENABLED: 'true',
        LLM_MAX_COST_UNITS: '1',
        LLM_BUDGET_DO: {
          getByName: vi.fn(() => ({ reserve, settle })),
        } as unknown as NonNullable<
          Parameters<typeof worker.fetch>[1]['LLM_BUDGET_DO']
        >,
        DASHSCOPE_API_KEY: 'server-only',
        DASHSCOPE_WORKSPACE_ID: 'workspace-1',
        DASHSCOPE_MODEL: 'qwen3.8-flash',
        DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
      },
    );
    expect(
      ((await response.json()) as { parser?: unknown }).parser,
    ).toMatchObject({
      attemptedMode: 'llm',
      acceptedMode: 'rules',
      fallbackReasonCode: 'rate_limited',
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ subjectKey: 'public-demo', maxCostUnits: 1 }),
    );
    expect(settle).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('never permits the local limiter bypass on a non-loopback host', async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const response = await worker.fetch(
      new Request('https://bff.example/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      {
        ...env,
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'zhipu',
        LLM_RUNTIME_ENV: 'local',
        LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
        ZHIPU_API_KEY: 'server-only',
        ZHIPU_MODEL: 'glm-4.7-flash',
      },
    );
    const body = (await response.json()) as {
      parser?: { fallbackReasonCode?: unknown };
    };
    expect(body.parser?.fallbackReasonCode).toBe('auth_or_config');
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('never permits the local bypass outside the explicit local runtime', async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal('fetch', providerFetch);
    const request = new Request(
      'http://localhost:8787/v1/trip-requests/parse',
      {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      },
    );
    const response = await worker.fetch(request, {
      ...env,
      LLM_ENABLED: 'true',
      LLM_PROVIDER: 'zhipu',
      LLM_RUNTIME_ENV: 'production',
      LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
      ZHIPU_API_KEY: 'server-only',
      ZHIPU_MODEL: 'glm-4.7-flash',
    });
    const body = (await response.json()) as {
      parser?: { fallbackReasonCode?: unknown };
    };
    expect(body.parser?.fallbackReasonCode).toBe('auth_or_config');
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('rejects browser attempts to select a provider or model', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
          model: 'browser-selected-model',
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
    });
  });

  it('rejects disallowed browser origins', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        headers: { origin: 'https://untrusted.example' },
        body: JSON.stringify({
          text: '墨尔本玩三天',
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('only exposes the documented parse route', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/unknown', {
        method: 'POST',
        body: '{}',
      }),
      env,
    );
    expect(response.status).toBe(404);
  });

  it('rejects oversized request bodies before parsing JSON', async () => {
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        body: JSON.stringify({
          text: '墨'.repeat(6_000),
          locale: 'zh-CN',
          datasetVersion: 'mel-poi-v0.1-2026-09-14',
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
  });

  it('rejects an oversized declared content length before parsing JSON', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      },
    });
    const response = await worker.fetch(
      new Request('https://bff.test/v1/trip-requests/parse', {
        method: 'POST',
        headers: { 'content-length': '16001' },
        body: stream,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }),
      env,
    );
    expect(response.status).toBe(400);
  });
});
