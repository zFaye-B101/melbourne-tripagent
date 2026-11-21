import { afterEach, describe, expect, it, vi } from 'vitest';
import example from '../../data/examples/trip-request-v2.example.json';
import { validateDraftSchema } from '../app/lib/trip-request-draft-v2-runtime';
import {
  createDashscopeAdapter,
  resetDashscopeCircuitForTests,
} from './provider-dashscope';

const input = {
  text: '墨尔本玩 3 天',
  locale: 'zh-CN' as const,
  datasetVersion: 'v1',
};
const configured = {
  DASHSCOPE_API_KEY: 'server-only',
  DASHSCOPE_WORKSPACE_ID: 'workspace-1',
  DASHSCOPE_MODEL: 'qwen3.8-flash',
  DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'true',
};
const options = () => ({
  signal: new AbortController().signal,
  deadlineMs: 4_000,
});
const success = () =>
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
  );

describe('DashScope compatible-mode provider', () => {
  afterEach(() => resetDashscopeCircuitForTests());

  it('uses the workspace endpoint and strict JSON schema without optional capabilities', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(
        'https://workspace-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      );
      expect(init?.headers).toEqual({
        authorization: 'Bearer server-only',
        'content-type': 'application/json',
      });
      if (typeof init?.body !== 'string')
        throw new Error('expected JSON request body');
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body.model).toBe('qwen3.8-flash');
      expect(body.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { name: 'trip_request_draft_v2', strict: true },
      });
      expect(body).toMatchObject({
        enable_thinking: false,
        enable_search: false,
        stream: false,
      });
      expect(body.max_completion_tokens).toBe(4096);
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('tools');
      return success();
    });
    const result = await createDashscopeAdapter(
      configured,
      fetchMock,
    ).extractDraft(input, options());
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDraftSchema(result.draft).ok).toBe(true);
  });

  it.each([
    [{ ...configured, DASHSCOPE_API_KEY: undefined }],
    [{ ...configured, DASHSCOPE_WORKSPACE_ID: undefined }],
    [{ ...configured, DASHSCOPE_MODEL: undefined }],
    [{ ...configured, DASHSCOPE_MODEL: 'qwen-plus' }],
    [{ ...configured, DASHSCOPE_API_KEY: 'sk-sp-secret' }],
    [{ ...configured, DASHSCOPE_WORKSPACE_ID: 'bad.workspace/path' }],
    [{ ...configured, DASHSCOPE_FREE_TIER_ONLY_CONFIRMED: 'false' }],
  ])('rejects invalid local configuration before fetch', async (env) => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      createDashscopeAdapter(env, fetchMock).extractDraft(input, options()),
    ).resolves.toEqual({ ok: false, code: 'auth_or_config' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'auth_or_config'],
    [401, 'auth_or_config'],
    [402, 'auth_or_config'],
    [403, 'auth_or_config'],
    [404, 'auth_or_config'],
    [422, 'auth_or_config'],
    [429, 'rate_limited'],
    [500, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 'ordinary' } }), {
          status,
        }),
    );
    await expect(
      createDashscopeAdapter(configured, fetchMock).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code });
  });

  it('maps truncated, malformed, and oversized successful bodies to invalid_json', async () => {
    for (const response of [
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'length', message: { content: '{' } }],
        }),
        { status: 200 },
      ),
      new Response('{', { status: 200 }),
      new Response('x'.repeat(65_537), { status: 200 }),
    ]) {
      const fetchMock = vi.fn<typeof fetch>(async () => response);
      await expect(
        createDashscopeAdapter(configured, fetchMock).extractDraft(
          input,
          options(),
        ),
      ).resolves.toEqual({ ok: false, code: 'invalid_json' });
    }
  });

  it('maps an aborted request to deadline_exceeded', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('aborted');
    });
    await expect(
      createDashscopeAdapter(configured, fetchMock).extractDraft(input, {
        signal: controller.signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'deadline_exceeded' });
  });

  it('opens the process circuit after a free-tier quota error', async () => {
    const firstFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            code: 'Throttling.AllocationQuota',
            message: 'quota exhausted',
          }),
          { status: 429 },
        ),
    );
    await expect(
      createDashscopeAdapter(configured, firstFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'rate_limited' });
    const secondFetch = vi.fn<typeof fetch>(async () => success());
    await expect(
      createDashscopeAdapter(configured, secondFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'circuit_open' });
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('also opens the circuit for an OpenAI-compatible nested free-tier error', async () => {
    const firstFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'AllocationQuota.FreeTierOnly' },
          }),
          { status: 403 },
        ),
    );
    await expect(
      createDashscopeAdapter(configured, firstFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'auth_or_config' });
    const secondFetch = vi.fn<typeof fetch>(async () => success());
    await expect(
      createDashscopeAdapter(configured, secondFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'circuit_open' });
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it('does not open the circuit for an ordinary rate limit', async () => {
    const rateLimited = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ code: 'Throttling.RateLimit' }), {
          status: 429,
        }),
    );
    await expect(
      createDashscopeAdapter(configured, rateLimited).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'rate_limited' });
    const nextFetch = vi.fn<typeof fetch>(async () => success());
    await expect(
      createDashscopeAdapter(configured, nextFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(nextFetch).toHaveBeenCalledOnce();
  });

  it('opens the circuit for a quota error even with HTTP 200', async () => {
    const quotaError = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: { code: 'FreeTierOnly' } }), {
          status: 200,
        }),
    );
    await expect(
      createDashscopeAdapter(configured, quotaError).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'provider_unavailable' });
    const nextFetch = vi.fn<typeof fetch>(async () => success());
    await expect(
      createDashscopeAdapter(configured, nextFetch).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'circuit_open' });
    expect(nextFetch).not.toHaveBeenCalled();
  });

  it('keeps HTTP error mapping when its response body is malformed', async () => {
    const malformed = vi.fn<typeof fetch>(
      async () => new Response('{', { status: 403 }),
    );
    await expect(
      createDashscopeAdapter(configured, malformed).extractDraft(
        input,
        options(),
      ),
    ).resolves.toEqual({ ok: false, code: 'auth_or_config' });
  });
});
