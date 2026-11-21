import { describe, expect, it, vi } from 'vitest';
import example from '../../data/examples/trip-request-v2.example.json';
import { validateDraftSchema } from '../app/lib/trip-request-draft-v2-runtime';
import { createZhipuAdapter } from './provider-zhipu';

const input = {
  text: '墨尔本玩 3 天',
  locale: 'zh-CN' as const,
  datasetVersion: 'v1',
};

describe('Zhipu Chat Completions provider', () => {
  it('uses the configured free model and requests a JSON object', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer server-only',
      });
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {
        model?: unknown;
        response_format?: unknown;
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      expect(body.model).toBe('glm-4.7-flash');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages?.[0]?.content).toContain('TripRequestDraft v2');
      expect(body.messages?.[0]?.content).toContain('"schemaVersion"');
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                reasoning_content: 'must not be parsed',
                content: JSON.stringify(example),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    const adapter = createZhipuAdapter(
      { ZHIPU_API_KEY: 'server-only', ZHIPU_MODEL: 'glm-4.7-flash' },
      fetchMock,
    );
    const result = await adapter.extractDraft(input, {
      signal: new AbortController().signal,
      deadlineMs: 4_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDraftSchema(result.draft).ok).toBe(true);
  });

  it('rejects truncated JSON output', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'length', message: { content: '{' } }],
          }),
          { status: 200 },
        ),
    );
    const adapter = createZhipuAdapter(
      { ZHIPU_API_KEY: 'server-only', ZHIPU_MODEL: 'glm-4.7-flash' },
      fetchMock,
    );
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'invalid_json' });
  });

  it('maps provider business errors without exposing their messages', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: '1302', message: 'provider detail' },
          }),
          { status: 429 },
        ),
    );
    const adapter = createZhipuAdapter(
      { ZHIPU_API_KEY: 'server-only', ZHIPU_MODEL: 'glm-4.7-flash' },
      fetchMock,
    );
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'rate_limited' });
  });

  it('distinguishes bad configuration from provider overload', async () => {
    const responses = [
      new Response(JSON.stringify({ error: { code: '1210' } }), {
        status: 400,
      }),
      new Response(JSON.stringify({ error: { code: '1305' } }), {
        status: 429,
      }),
    ];
    const fetchMock = vi.fn<typeof fetch>(async () => responses.shift()!);
    const adapter = createZhipuAdapter(
      { ZHIPU_API_KEY: 'server-only', ZHIPU_MODEL: 'glm-4.7-flash' },
      fetchMock,
    );
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'auth_or_config' });
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'provider_unavailable' });
  });
});
