import { describe, expect, it, vi } from 'vitest';
import example from '../../data/examples/trip-request-v2.example.json';
import { validateDraftSchema } from '../app/lib/trip-request-draft-v2-runtime';
import { createDeepSeekAdapter } from './provider-deepseek';

const input = {
  text: '墨尔本玩 3 天',
  locale: 'zh-CN' as const,
  datasetVersion: 'v1',
};

describe('DeepSeek Responses provider', () => {
  it('uses Responses JSON schema without unsupported OpenAI-only fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe('https://api.deepseek.com/responses');
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer server-only',
      });
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as Record<string, unknown>;
      expect(body.model).toBe('deepseek-flash');
      expect(body.store).toBeUndefined();
      const text = body.text as { format: Record<string, unknown> };
      expect(text.format.type).toBe('json_schema');
      expect(text.format.strict).toBeUndefined();
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              content: [{ type: 'reasoning_text', text: 'not json' }],
            },
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(example) }],
            },
          ],
        }),
        { status: 200 },
      );
    });
    const adapter = createDeepSeekAdapter(
      { DEEPSEEK_API_KEY: 'server-only', DEEPSEEK_MODEL: 'deepseek-flash' },
      fetchMock,
    );
    const result = await adapter.extractDraft(input, {
      signal: new AbortController().signal,
      deadlineMs: 4_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDraftSchema(result.draft).ok).toBe(true);
  });

  it('does not mistake reasoning text for the JSON answer', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'reasoning',
                content: [{ type: 'reasoning_text', text: '{}' }],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const adapter = createDeepSeekAdapter(
      { DEEPSEEK_API_KEY: 'server-only', DEEPSEEK_MODEL: 'deepseek-flash' },
      fetchMock,
    );
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'invalid_json' });
  });

  it('maps balance and rate failures to stable local fallback codes', async () => {
    const responses = [402, 422, 429];
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('', { status: responses.shift() }),
    );
    const adapter = createDeepSeekAdapter(
      { DEEPSEEK_API_KEY: 'server-only', DEEPSEEK_MODEL: 'deepseek-flash' },
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
    ).resolves.toEqual({ ok: false, code: 'auth_or_config' });
    await expect(
      adapter.extractDraft(input, {
        signal: new AbortController().signal,
        deadlineMs: 4_000,
      }),
    ).resolves.toEqual({ ok: false, code: 'rate_limited' });
  });
});
