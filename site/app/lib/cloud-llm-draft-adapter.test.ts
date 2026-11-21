import { describe, expect, it } from 'vitest';

import { PROMPT_VERSION } from '../../bff/provider-shared';
import {
  createCloudLlmDraftAdapter,
  type CloudLlmChatRequest,
  type CloudLlmClient,
} from './cloud-llm-draft-adapter';

const DATASET_VERSION = 'melbourne-poi-v0.1';
const DEADLINE_MS = 20_000;

interface FakeOptions {
  models?: Array<{
    id: string;
    enabled?: boolean;
    disabled?: boolean;
    isDefault?: boolean;
    supportsReasoning?: boolean;
    onlyReasoning?: boolean;
    maxOutputTokens?: number;
    reasoning?: { canDisableThinking?: boolean; defaultEffort?: string };
  }>;
  chunks?: string[];
  listError?: unknown;
  streamError?: unknown;
  /** Throw after these chunks have been yielded, like a stream cut without [DONE]. */
  streamErrorAfter?: { chunks: string[]; error: unknown };
}

function fakeClient(options: FakeOptions) {
  const requests: CloudLlmChatRequest[] = [];
  let listCalls = 0;
  const client: CloudLlmClient = {
    llm: {
      models: {
        async list() {
          listCalls += 1;
          if (options.listError) throw options.listError;
          return options.models ?? [];
        },
      },
      chat: {
        completions: {
          create(input) {
            requests.push(input);
            return (async function* () {
              if (input.signal?.aborted)
                throw Object.assign(new Error('aborted'), { name: 'AbortError' });
              if (options.streamError) throw options.streamError;
              if (options.streamErrorAfter) {
                for (const text of options.streamErrorAfter.chunks)
                  yield {
                    choices: [{ delta: { content: text }, finish_reason: null }],
                  };
                throw options.streamErrorAfter.error;
              }
              for (const text of options.chunks ?? []) {
                if (input.signal?.aborted)
                  throw Object.assign(new Error('aborted'), { name: 'AbortError' });
                yield {
                  choices: [{ delta: { content: text }, finish_reason: null }],
                };
              }
            })();
          },
        },
      },
    },
  };
  return { client, requests, listCalls: () => listCalls };
}

function adapterFor(options: FakeOptions, extra: Record<string, unknown> = {}) {
  const fake = fakeClient(options);
  return {
    ...fake,
    adapter: createCloudLlmDraftAdapter({ client: fake.client, ...extra }),
  };
}

function extract(adapter: ReturnType<typeof createCloudLlmDraftAdapter>) {
  return adapter.extractDraft(
    { text: '墨尔本三天，主要在市内，喜欢博物馆', locale: 'zh-CN', datasetVersion: DATASET_VERSION },
    { signal: new AbortController().signal, deadlineMs: DEADLINE_MS },
  );
}

function cloudError(code: string, status?: number) {
  return {
    error: { message: code, type: 'invalid_request_error', param: null, code },
    status,
  };
}

describe('cloud LLM draft adapter', () => {
  it('collects the streamed JSON and reports the draft with its provenance', async () => {
    const chunked = ['{"city":"Melbourne",', '"days":3}'];
    const { adapter, requests, listCalls } = adapterFor({
      models: [{ id: 'model-a' }],
      chunks: chunked,
    });

    const result = await extract(adapter);

    expect(result).toEqual({
      ok: true,
      draft: { city: 'Melbourne', days: 3 },
      promptVersion: PROMPT_VERSION,
      datasetVersion: DATASET_VERSION,
    });
    expect(listCalls()).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.stream).toBe(true);
    expect(requests[0]?.model).toBe('model-a');
    expect(requests[0]?.messages[0]?.role).toBe('system');
    expect(requests[0]?.messages[0]?.content).toContain('你是旅行需求抽取器');
    expect(requests[0]?.messages[1]).toEqual({
      role: 'user',
      content: '墨尔本三天，主要在市内，喜欢博物馆',
    });
  });

  it('sends no sampling or length parameter unless the caller opts in', async () => {
    const bare = adapterFor({ models: [{ id: 'model-a' }], chunks: ['{}'] });
    await extract(bare.adapter);
    expect(bare.requests[0]?.temperature).toBeUndefined();
    expect(bare.requests[0]?.max_tokens).toBeUndefined();
    expect(bare.requests[0]?.reasoning_effort).toBeUndefined();

    const tuned = adapterFor(
      { models: [{ id: 'model-a' }], chunks: ['{}'] },
      { temperature: 1, maxOutputTokens: 1_200, reasoningEffort: 'minimal' },
    );
    await extract(tuned.adapter);
    expect(tuned.requests[0]?.temperature).toBe(1);
    expect(tuned.requests[0]?.max_tokens).toBe(1_200);
    // Without this parameter a reasoning entry runs at high effort and never
    // emits content inside a page interaction, so it must reach the request.
    expect(tuned.requests[0]?.reasoning_effort).toBe('minimal');
  });

  it('prefers an entry whose thinking can be capped', async () => {
    // The live directory declares this on `glm-5.3-flash`, the cheapest entry
    // that reliably produces an accepted draft.
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'default', enabled: true, isDefault: true, maxOutputTokens: 24_000 },
        {
          id: 'cappable',
          enabled: true,
          maxOutputTokens: 32_000,
          reasoning: { canDisableThinking: true, defaultEffort: 'high' },
        },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('cappable');
  });

  it('prefers a declared-reasoning entry over a plain chat entry', async () => {
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'plain', enabled: true, maxOutputTokens: 8_192 },
        { id: 'declared', enabled: true, maxOutputTokens: 32_000, reasoning: { defaultEffort: 'high' } },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('declared');
  });

  it('skips disabled directory entries and reuses the resolved model', async () => {
    const { adapter, requests, listCalls } = adapterFor({
      models: [
        { id: 'off', disabled: true },
        { id: 'on', disabled: false, maxOutputTokens: 8_000 },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);
    await extract(adapter);

    expect(requests.map((request) => request.model)).toEqual(['on', 'on']);
    expect(listCalls()).toBe(1);
  });

  it('honours the enabled flag, not only the optional disabled flag', async () => {
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'off', enabled: false, maxOutputTokens: 8_000 },
        { id: 'on', enabled: true, maxOutputTokens: 8_000 },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('on');
  });

  it('prefers a fast text model over the reasoning directory default', async () => {
    // Mirrors the live directory: `auto` is isDefault but is reasoning-only and
    // needs ~81s, while the plain text entry returns the same draft in ~4.8s.
    const { adapter, requests } = adapterFor({
      models: [
        {
          id: 'auto',
          enabled: true,
          isDefault: true,
          supportsReasoning: true,
          onlyReasoning: true,
          maxOutputTokens: 32_000,
        },
        { id: 'fast-text', enabled: true, maxOutputTokens: 24_000 },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('fast-text');
  });

  it('skips a directory entry that is not a chat model at all', async () => {
    // An image entry declares no output ceiling; picking it would never stream JSON.
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'image-model', enabled: true },
        { id: 'text-model', enabled: true, maxOutputTokens: 8_192 },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('text-model');
  });

  it('prefers a text-capable reasoning model over a non-chat entry', async () => {
    // A reasoning-only entry with no declared effort control still lands above
    // an entry with no output ceiling at all: the former can answer, while an
    // image model can never stream a draft.
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'image-model', enabled: true },
        { id: 'reasoner', enabled: true, maxOutputTokens: 32_000, onlyReasoning: true },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('reasoner');
  });

  it('falls back to plain directory order when nothing declares capabilities', async () => {
    const { adapter, requests } = adapterFor({
      models: [
        { id: 'first', enabled: true },
        { id: 'second', enabled: true },
      ],
      chunks: ['{}'],
    });

    await extract(adapter);

    expect(requests[0]?.model).toBe('first');
  });

  it('breaks ties inside a tier with isDefault', async () => {
    const { adapter, requests } = adapterFor(
      {
        models: [
          { id: 'first', enabled: true, maxOutputTokens: 8_000 },
          { id: 'second', enabled: true, maxOutputTokens: 8_000, isDefault: true },
        ],
        chunks: ['{}'],
      },
    );

    await extract(adapter);

    expect(requests[0]?.model).toBe('second');
  });

  it('honours a preferred model over directory order', async () => {
    const { adapter, requests } = adapterFor(
      {
        models: [
          { id: 'fast-but-unstable', enabled: true, maxOutputTokens: 24_000 },
          { id: 'steady', enabled: true, maxOutputTokens: 8_192 },
        ],
        chunks: ['{}'],
      },
      { preferredModelIds: ['steady'] },
    );

    await extract(adapter);

    expect(requests[0]?.model).toBe('steady');
  });

  it('ignores a preferred model that is absent or disabled', async () => {
    const absent = adapterFor(
      {
        models: [{ id: 'only', enabled: true, maxOutputTokens: 8_000 }],
        chunks: ['{}'],
      },
      { preferredModelIds: ['gone', 'only'] },
    );
    await extract(absent.adapter);
    expect(absent.requests[0]?.model).toBe('only');

    const disabled = adapterFor(
      {
        models: [
          { id: 'pinned', enabled: false, maxOutputTokens: 8_000 },
          { id: 'fallback', enabled: true, maxOutputTokens: 8_000 },
        ],
        chunks: ['{}'],
      },
      { preferredModelIds: ['pinned'] },
    );
    await extract(disabled.adapter);
    expect(disabled.requests[0]?.model).toBe('fallback');
  });

  it('never accumulates reasoning_content into the draft', async () => {
    // Reasoning models stream their scratch work into reasoning_content; only
    // delta.content is the answer.
    const fake = fakeClient({
      models: [{ id: 'reasoner', enabled: true, maxOutputTokens: 8_000 }],
      chunks: ['{"days":', '2}'],
    });
    const client: CloudLlmClient = {
      llm: {
        models: fake.client.llm.models,
        chat: {
          completions: {
            create() {
              return (async function* () {
                yield {
                  choices: [
                    { delta: { content: '', reasoning_content: 'let me think' }, finish_reason: null },
                  ],
                };
                yield {
                  choices: [{ delta: { content: '{"days":' }, finish_reason: null }],
                };
                yield {
                  choices: [
                    { delta: { content: '2}', reasoning_content: ' done' }, finish_reason: 'stop' },
                  ],
                };
              })();
            },
          },
        },
      },
    };
    const adapter = createCloudLlmDraftAdapter({ client });

    const result = await extract(adapter);

    expect(result).toEqual({
      ok: true,
      draft: { days: 2 },
      promptVersion: PROMPT_VERSION,
      datasetVersion: DATASET_VERSION,
    });
  });

  it('keeps a complete draft when the stream is cut without the [DONE] sentinel', async () => {
    // Observed live: the gateway ends the SSE stream after the last data frame
    // without sending `[DONE]`, so the transport reports an interruption even
    // though the whole JSON payload arrived.
    const { adapter } = adapterFor({
      models: [{ id: 'm', enabled: true, maxOutputTokens: 8_000 }],
      streamErrorAfter: {
        chunks: ['{"city":"Melbourne",', '"days":3}'],
        error: cloudError('gateway_stream_interrupted'),
      },
    });

    expect(await extract(adapter)).toEqual({
      ok: true,
      draft: { city: 'Melbourne', days: 3 },
      promptVersion: PROMPT_VERSION,
      datasetVersion: DATASET_VERSION,
    });
  });

  it('reports a fallback when the stream is cut mid-JSON', async () => {
    const { adapter } = adapterFor({
      models: [{ id: 'm', enabled: true, maxOutputTokens: 8_000 }],
      streamErrorAfter: {
        chunks: ['{"city":"Melbourne",'],
        error: cloudError('gateway_stream_interrupted'),
      },
    });

    expect(await extract(adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });

  it('reports a fallback when the stream dies before any content', async () => {
    const { adapter } = adapterFor({
      models: [{ id: 'm', enabled: true, maxOutputTokens: 8_000 }],
      streamErrorAfter: { chunks: [], error: cloudError('gateway_stream_interrupted') },
    });

    expect(await extract(adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });

  it('falls back instead of inventing a model when the directory is empty', async () => {
    const { adapter, requests } = adapterFor({ models: [], chunks: ['{}'] });

    expect(await extract(adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
    expect(requests).toHaveLength(0);
  });

  it('falls back when every directory entry is disabled', async () => {
    const { adapter, requests } = adapterFor({
      models: [{ id: 'off', disabled: true }],
      chunks: ['{}'],
    });

    expect(await extract(adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
    expect(requests).toHaveLength(0);
  });

  it('rejects non-JSON output and an empty completion', async () => {
    const notJson = adapterFor({ models: [{ id: 'm' }], chunks: ['```json'] });
    expect(await extract(notJson.adapter)).toEqual({
      ok: false,
      code: 'invalid_json',
    });

    const empty = adapterFor({ models: [{ id: 'm' }], chunks: [] });
    expect(await extract(empty.adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });

  it('drops a null itemIndex from the provider draft before validation', async () => {
    const { adapter } = adapterFor({
      models: [{ id: 'm' }],
      chunks: [
        '{"evidence":[{"path":"/days","quote":"三天","occurrence":1,"itemIndex":null}]}',
      ],
    });

    const result = await extract(adapter);

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.draft).toEqual({
        evidence: [{ path: '/days', quote: '三天', occurrence: 1 }],
      });
  });

  it('maps cloud failures onto the existing fallback vocabulary', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['rate limit status', cloudError('rate_limited', 429), 'rate_limited'],
      ['rate limit code', cloudError('quota_rate_limited'), 'rate_limited'],
      ['origin rejected', cloudError('auth_origin_mismatch'), 'auth_or_config'],
      ['unauthorized status', cloudError('unauthorized', 401), 'auth_or_config'],
      ['quota exhausted', cloudError('quota_exceeded'), 'auth_or_config'],
      ['bad request', cloudError('request_stream_required'), 'auth_or_config'],
      ['gateway down', cloudError('gateway_unavailable'), 'provider_unavailable'],
      ['model missing', cloudError('model_not_found'), 'provider_unavailable'],
      ['network failure', new TypeError('fetch failed'), 'provider_unavailable'],
    ];

    for (const [name, error, expected] of cases) {
      const { adapter } = adapterFor({ models: [{ id: 'm' }], streamError: error });
      expect(await extract(adapter), name).toEqual({ ok: false, code: expected });
    }
  });

  it('reports a deadline and a directory failure as fallbacks, never a throw', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const controller = adapterFor({ models: [{ id: 'm' }], chunks: ['{}'] });
    expect(
      await controller.adapter.extractDraft(
        { text: '墨尔本', locale: 'zh-CN', datasetVersion: DATASET_VERSION },
        { signal: aborted.signal, deadlineMs: DEADLINE_MS },
      ),
    ).toEqual({ ok: false, code: 'deadline_exceeded' });

    const listing = adapterFor({
      listError: cloudError('gateway_unavailable'),
      chunks: ['{}'],
    });
    expect(await extract(listing.adapter)).toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
  });
});
