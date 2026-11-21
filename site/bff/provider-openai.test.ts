import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAIAdapter,
  EXTRACTION_PROMPT,
  openAIStructuredSchema,
  PROMPT_VERSION,
} from './provider-openai';
import example from '../../data/examples/trip-request-v2.example.json';
import {
  validateDraftEvidence,
  validateDraftSchema,
  validateDraftSemantics,
  validateFieldEvidenceSemantics,
  type TripRequestDraftV2,
} from '../app/lib/trip-request-draft-v2-runtime';
import { interpretTripRequest } from '../app/lib/nlu-orchestrator';

describe('OpenAI Responses provider', () => {
  it('makes every object strict and requires nullable itemIndex', () => {
    const schema = openAIStructuredSchema();
    const visit = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const value = node as Record<string, unknown>;
      if (value.type === 'object') {
        const properties = value.properties as Record<string, unknown>;
        expect(value.additionalProperties).toBe(false);
        expect(value.required).toEqual(Object.keys(properties));
      }
      Object.values(value).forEach(visit);
    };
    visit(schema);
    const root = schema.properties as Record<string, unknown>;
    const evidence = root.evidence as Record<string, unknown>;
    const item = evidence.items as Record<string, unknown>;
    const itemProperties = item.properties as Record<string, unknown>;
    expect(item.required).toContain('itemIndex');
    expect((itemProperties.itemIndex as Record<string, unknown>).type).toEqual([
      'integer',
      'null',
    ]);
  });

  it('normalizes nullable itemIndex through the canonical runtime gate', async () => {
    const draft = structuredClone(example) as Record<string, unknown>;
    (draft.evidence as Array<Record<string, unknown>>).forEach((item) => {
      item.itemIndex = null;
    });
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(draft) }), {
          status: 200,
        }),
    );
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      fetchMock,
    );
    const result = await adapter.extractDraft(
      { text: '墨尔本玩三天', locale: 'zh-CN', datasetVersion: 'v1' },
      { signal: new AbortController().signal, deadlineMs: 4000 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDraftSchema(result.draft).ok).toBe(true);
  });

  it('uses the server model and strict JSON schema without tools', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {
        model?: unknown;
        store?: unknown;
        tools?: unknown;
        text: { format: { type: unknown; strict: unknown } };
      };
      expect(body.model).toBe('configured-model');
      expect(body.store).toBe(false);
      expect((body as Record<string, unknown>).max_output_tokens).toBe(1600);
      expect(body.tools).toBeUndefined();
      expect(body.text.format.type).toBe('json_schema');
      expect(body.text.format.strict).toBe(true);
      return new Response(
        JSON.stringify({
          status: 'completed',
          output_text: '{"schemaVersion":"trip-request-draft-v2"}',
        }),
        { status: 200 },
      );
    });
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      fetchMock,
    );
    const result = await adapter.extractDraft(
      { text: '墨尔本玩三天', locale: 'zh-CN', datasetVersion: 'v1' },
      { signal: new AbortController().signal, deadlineMs: 4000 },
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(EXTRACTION_PROMPT.length).toBeGreaterThan(200);
    expect(PROMPT_VERSION).toBe('nlu-extraction-system-v2.10');
  });

  it('documents the date versus daily-start evidence contract', () => {
    expect(EXTRACTION_PROMPT).toContain('不得把出发时间当成旅行日期');
    expect(EXTRACTION_PROMPT).toContain('不得出现 /date/* evidence');
    expect(EXTRACTION_PROMPT).toContain(
      'dailyStartText 必须完整保留为“每天早上十一点出发”',
    );
    expect(EXTRACTION_PROMPT).toContain('dailyStartMinutes 为 660');
    expect(EXTRACTION_PROMPT).toContain(
      'geography（活动区域）、venuePreference（室内外环境）和八个 experiencePreferences（体验主题）是三个完全独立的轴',
    );
    expect(EXTRACTION_PROMPT).toContain('不得生成 parks_gardens evidence');
    expect(EXTRACTION_PROMPT).toContain(
      'destination.text 和 destination.supportedCity 都必须非 null',
    );
    expect(EXTRACTION_PROMPT).toContain(
      '用户没有表达目的地时，destination.text 和 destination.supportedCity 都必须为 null',
    );
    expect(EXTRACTION_PROMPT).toContain(
      '必须保留 destination_scope hard 未处理项',
    );
    expect(EXTRACTION_PROMPT).toContain(
      'geography.scope 与 geography.strength 同时非 null 时，二者必须分别拥有 evidence',
    );
    expect(EXTRACTION_PROMPT).toContain(
      '“主要在市内”时，geography.scope 必须为 `central_city_v1`、strength 必须为 `soft`',
    );
    expect(EXTRACTION_PROMPT).toContain(
      '“从 CBD 出发”只证明 originText，不表示活动区域',
    );
    expect(EXTRACTION_PROMPT).toContain('不要把“未提及”写成 false、0 或默认值');
    expect(EXTRACTION_PROMPT).toContain(
      'concessionEligibleCount 是 null，不是 0',
    );
    expect(EXTRACTION_PROMPT).toContain('currency 和 totalCents 都为 null');
    expect(EXTRACTION_PROMPT).toContain('4 天及以上时 days 为 null');
    expect(EXTRACTION_PROMPT).toContain('其他城市时 supportedCity 为 null');
    expect(EXTRACTION_PROMPT).toContain('意图词和地点名的同一连续原文片段');
    expect(EXTRACTION_PROMPT).toContain(
      'evidence.quote 必须确实出现在用户原文中',
    );
    expect(EXTRACTION_PROMPT).toContain('城市是否受支持与天数抽取彼此独立');
    expect(EXTRACTION_PROMPT).toContain('只放入 duration_scope/hard');
    expect(EXTRACTION_PROMPT).toContain(
      '/date/text 与 /date/resolution 都要有 evidence',
    );
  });

  it('sends v2.7 and accepts a mock geography draft through all local gates', async () => {
    const raw =
      '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
    const draft = structuredClone(example) as TripRequestDraftV2;
    expect(validateDraftSchema(draft).ok).toBe(true);
    expect(validateDraftEvidence(draft, raw).ok).toBe(true);
    expect(validateFieldEvidenceSemantics(draft).ok).toBe(true);
    expect(validateDraftSemantics(draft, raw).ok).toBe(true);
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const sent = JSON.parse(
        typeof init?.body === 'string' ? init.body : '',
      ) as {
        input?: Array<{
          role?: string;
          content?: Array<{ text?: string }>;
        }>;
      };
      const systemPrompt = sent.input?.find((entry) => entry.role === 'system')
        ?.content?.[0]?.text;
      expect(systemPrompt).toContain(
        '“从 CBD 出发”只证明 originText，不表示活动区域',
      );
      expect(systemPrompt).toContain(
        '“主要在市内”时，geography.scope 必须为 `central_city_v1`、strength 必须为 `soft`',
      );
      return new Response(
        JSON.stringify({ status: 'completed', output_text: JSON.stringify(draft) }),
        {
          status: 200,
        },
      );
    });
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      fetchMock,
    );
    const outcome = await interpretTripRequest({
      rawText: raw,
      sourceFingerprint: 'geography-full-quote',
      adapter,
    });
    expect(outcome.status).toBe('complete');
    expect(fetchMock).toHaveBeenCalledOnce();
    if (outcome.status === 'complete') {
      expect(outcome.diagnostics.acceptedMode).toBe('llm');
      expect(outcome.request.geography.scope).toBe('central_city_v1');
      expect(outcome.request.geography.strength).toBe('soft');
      for (const path of ['/geography/scope', '/geography/strength'])
        expect(outcome.fieldEvidence).toContainEqual({
          path,
          quote: '主要在市内',
          occurrence: 1,
          itemIndex: null,
        });
    }
  });

  it('rejects geography inferred from an origin-only CBD quote', async () => {
    const raw =
      '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
    const draft = structuredClone(example) as TripRequestDraftV2;
    draft.geography = { scope: 'cbd_core_v1', strength: 'hard' };
    draft.evidence = draft.evidence.map((item) =>
      item.path === '/geography/scope' || item.path === '/geography/strength'
        ? { ...item, quote: '从 CBD 出发' }
        : item,
    );
    expect(validateFieldEvidenceSemantics(draft)).toMatchObject({
      ok: false,
      issue: {
        reason: 'semantic.evidence_not_proven',
        path: '/geography/scope',
      },
    });
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(draft) }), {
            status: 200,
          }),
      ),
    );
    const outcome = await interpretTripRequest({
      rawText: raw,
      sourceFingerprint: 'geography-origin-only',
      adapter,
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status === 'complete') {
      expect(outcome.diagnostics.acceptedMode).toBe('rules');
      expect(outcome.diagnostics.fallbackReasonCode).toBe('semantic_rejected');
    }
  });

  it('rejects the stale supported-inner-city mapping for “主要在市内”', async () => {
    const raw =
      '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
    const draft = structuredClone(example) as TripRequestDraftV2;
    draft.geography = { scope: 'supported_inner_city', strength: 'soft' };
    draft.evidence = draft.evidence.map((item) =>
      item.path === '/geography/scope' || item.path === '/geography/strength'
        ? { ...item, quote: '主要在市内' }
        : item,
    );
    expect(validateFieldEvidenceSemantics(draft)).toMatchObject({
      ok: false,
      issue: {
        reason: 'semantic.evidence_not_proven',
        path: '/geography/scope',
      },
    });
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(draft) }), {
            status: 200,
          }),
      ),
    );
    const outcome = await interpretTripRequest({
      rawText: raw,
      sourceFingerprint: 'geography-stale-scope',
      adapter,
    });
    expect(outcome.status).toBe('complete');
    if (outcome.status === 'complete')
      expect(outcome.diagnostics.acceptedMode).toBe('rules');
  });

  it('maps provider status failures to stable fallback codes', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('', { status: 429 }),
    );
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      fetchMock,
    );
    const result = await adapter.extractDraft(
      { text: '墨尔本', locale: 'zh-CN', datasetVersion: 'v1' },
      { signal: new AbortController().signal, deadlineMs: 4000 },
    );
    expect(result).toEqual({ ok: false, code: 'rate_limited' });
  });

  it('does not accept incomplete Responses output through the trip adapter', async () => {
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              status: 'incomplete',
              output_text: JSON.stringify(example),
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await adapter.extractDraft(
      { text: '墨尔本', locale: 'zh-CN', datasetVersion: 'v1' },
      { signal: new AbortController().signal, deadlineMs: 4_000 },
    );
    expect(result).toEqual({ ok: false, code: 'provider_unavailable' });
  });

  it('maps an aborted provider request to the deadline fallback code', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      controller.abort('deadline');
      throw init?.signal?.reason ?? new Error('aborted');
    });
    const adapter = createOpenAIAdapter(
      { OPENAI_API_KEY: 'server-only', OPENAI_MODEL: 'configured-model' },
      fetchMock,
    );
    const result = await adapter.extractDraft(
      { text: '墨尔本', locale: 'zh-CN', datasetVersion: 'v1' },
      { signal: controller.signal, deadlineMs: 4_000 },
    );
    expect(result).toEqual({ ok: false, code: 'deadline_exceeded' });
  });
});
