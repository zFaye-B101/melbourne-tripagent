import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../../bff/index';
import exampleDraft from '../../../data/examples/trip-request-v2.example.json';
import { interpretTripRequestViaBff, parseEndpoint } from './bff-parse-client';
import { POI_DATASET, parseTripRequest } from './planner';

const RAW =
  '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢博物馆和美术馆';
const BFF_FIXTURE_RAW =
  '墨尔本玩 3 天，主要在市内，从 CBD 出发，每天早上十一点出发，轻松，喜欢室外、博物馆和美术馆、历史，少走路，避开人多，2 位成人，不使用优惠票，预算 A$500，一定去 NGV，不要去 SEA LIFE';
const FINGERPRINT = 'test-fingerprint';

function validResponse() {
  const { rawText: _rawText, ...request } = parseTripRequest(RAW);
  return {
    apiVersion: 'trip-parse-api-v1',
    requestId: 'request-1',
    decision: 'ready',
    parser: {
      attemptedMode: 'llm',
      acceptedMode: 'llm',
      fallbackReasonCode: null,
      draftSchemaVersion: 'trip-request-draft-v2',
      normalizedRequestVersion: 'parsed-trip-request-v2',
      semanticPolicyVersion: 'trip-semantic-v1',
      promptVersion: 'test-prompt',
    },
    datasetVersion: POI_DATASET.dataVersion,
    request,
    fieldEvidence: [
      {
        path: '/destination/text',
        quote: '墨尔本',
        occurrence: 1,
        itemIndex: null,
      },
      {
        path: '/destination/supportedCity',
        quote: '墨尔本',
        occurrence: 1,
        itemIndex: null,
      },
      { path: '/days', quote: '3 天', occurrence: 1, itemIndex: null },
    ],
    question: null,
    warnings: [],
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BFF parse client', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('only accepts HTTPS or explicit loopback HTTP parse endpoints', () => {
    expect(parseEndpoint('https://bff.example/v1/trip-requests/parse')).toBe(
      'https://bff.example/v1/trip-requests/parse',
    );
    expect(parseEndpoint('http://localhost:8787/v1/trip-requests/parse')).toBe(
      'http://localhost:8787/v1/trip-requests/parse',
    );
    expect(
      parseEndpoint('http://bff.example/v1/trip-requests/parse'),
    ).toBeNull();
    expect(parseEndpoint('https://bff.example/other')).toBeNull();
  });

  it('sends only the Parse API input and turns a valid response into an outcome', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(validResponse()));
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      text: RAW,
      locale: 'zh-CN',
      datasetVersion: POI_DATASET.dataVersion,
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      sourceFingerprint: FINGERPRINT,
      diagnostics: { acceptedMode: 'llm' },
    });
  });

  it('accepts an actual normalized LLM response from the BFF fixture', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(exampleDraft) },
            },
          ],
        }),
      ),
    );
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return worker.fetch(new Request(url, init), {
        LLM_ENABLED: 'true',
        LLM_PROVIDER: 'zhipu',
        LLM_RUNTIME_ENV: 'local',
        LLM_LOCAL_DEV_BYPASS_RATE_LIMITER: 'true',
        ZHIPU_API_KEY: 'test-only',
        ZHIPU_MODEL: 'test-only',
      });
    };
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'http://localhost:8787/v1/trip-requests/parse',
      rawText: BFF_FIXTURE_RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl,
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: { attemptedMode: 'llm', acceptedMode: 'llm' },
    });
  });

  it('fails closed to rules for malformed versions, evidence, or HTTP failures', async () => {
    for (const mutate of [
      (body: ReturnType<typeof validResponse>) => {
        body.datasetVersion = 'stale';
      },
      (body: ReturnType<typeof validResponse>) => {
        body.fieldEvidence = [];
      },
      (body: ReturnType<typeof validResponse>) => {
        (body as { fieldEvidence: unknown[] }).fieldEvidence = [
          {
            path: '/days',
            quote: 'not in input',
            occurrence: 1,
            itemIndex: null,
          },
        ];
      },
      (body: ReturnType<typeof validResponse>) => {
        (body as { fieldEvidence: unknown[] }).fieldEvidence = [
          {
            path: '/not-a-contract-path',
            quote: '墨尔本',
            occurrence: 1,
            itemIndex: null,
          },
        ];
      },
    ]) {
      const body = validResponse();
      mutate(body);
      const outcome = await interpretTripRequestViaBff({
        endpoint: 'https://bff.example/v1/trip-requests/parse',
        rawText: RAW,
        sourceFingerprint: FINGERPRINT,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
      });
      expect(outcome).toMatchObject({
        status: 'complete',
        diagnostics: { acceptedMode: 'rules', attemptedMode: 'llm' },
      });
    }
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response({}, 502)),
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: { fallbackReasonCode: 'provider_unavailable' },
    });
    for (const [status, reason] of [
      [429, 'rate_limited'],
      [409, 'version_mismatch'],
      [403, 'auth_or_config'],
    ] as const) {
      const failed = await interpretTripRequestViaBff({
        endpoint: 'https://bff.example/v1/trip-requests/parse',
        rawText: RAW,
        sourceFingerprint: FINGERPRINT,
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(response({}, status)),
      });
      expect(failed).toMatchObject({
        status: 'complete',
        diagnostics: { acceptedMode: 'rules', fallbackReasonCode: reason },
      });
    }
  });

  it('does not locally reparse a BFF scope error into a ready or clarification result', async () => {
    const rawText = '墨尔本玩 3 天';
    expect(parseTripRequest(rawText).errors).toEqual([]);
    const baseline = validResponse();
    const body = {
      ...baseline,
      decision: 'scope_error',
      request: null,
      question: null,
      fieldEvidence: [],
      parser: {
        ...baseline.parser,
        attemptedMode: 'llm',
        acceptedMode: 'rules',
        fallbackReasonCode: 'semantic_rejected',
        draftSchemaVersion: null,
        promptVersion: null,
      },
    };
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText,
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      diagnostics: { acceptedMode: 'rules' },
      message: '这次需求超出当前行程范围；上一份成功行程仍然保留。',
    });
  });

  it('returns a safe scope error without exposing server response text', async () => {
    const baseline = validResponse();
    const body = {
      ...baseline,
      decision: 'scope_error',
      request: null,
      question: null,
      fieldEvidence: [],
    };
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: 'Sydney 玩 3 天',
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      diagnostics: {
        attemptedMode: 'llm',
        acceptedMode: 'llm',
      },
      message: '这次需求超出当前行程范围；上一份成功行程仍然保留。',
    });
    expect(outcome).not.toHaveProperty('request');
    expect(outcome).not.toHaveProperty('fieldEvidence');
  });

  it('keeps a valid BFF rules-ready response without fabricated evidence', async () => {
    const baseline = validResponse();
    const body = {
      ...baseline,
      fieldEvidence: [],
      parser: {
        ...baseline.parser,
        attemptedMode: 'llm',
        acceptedMode: 'rules',
        fallbackReasonCode: 'evidence_rejected',
        draftSchemaVersion: null,
        promptVersion: null,
      },
    };
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: {
        acceptedMode: 'rules',
        fallbackReasonCode: 'evidence_rejected',
      },
    });
  });

  it('fails closed when a request collection has an invalid nested value', async () => {
    const body = validResponse();
    (body.request as unknown as { warnings: unknown[] }).warnings = [
      { message: 'not a string' },
    ];
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: {
        acceptedMode: 'rules',
        fallbackReasonCode: 'invalid_json',
      },
    });
  });

  it('fails closed for invalid city, origin, party, or daily window values', async () => {
    for (const mutate of [
      (body: ReturnType<typeof validResponse>) => {
        body.request.city = 'Sydney';
      },
      (body: ReturnType<typeof validResponse>) => {
        body.request.origin.latitude += 0.01;
      },
      (body: ReturnType<typeof validResponse>) => {
        body.request.pricingParty.adultFullFareCount = -1;
      },
      (body: ReturnType<typeof validResponse>) => {
        body.request.dailyWindow.endMinutes =
          body.request.dailyWindow.startMinutes;
      },
    ]) {
      const body = validResponse();
      mutate(body);
      const outcome = await interpretTripRequestViaBff({
        endpoint: 'https://bff.example/v1/trip-requests/parse',
        rawText: RAW,
        sourceFingerprint: FINGERPRINT,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(body)),
      });
      expect(outcome).toMatchObject({
        status: 'complete',
        diagnostics: { fallbackReasonCode: 'invalid_json' },
      });
    }
  });

  it('uses normalized text for evidence while preserving the original raw text', async () => {
    const rawText = RAW.replace('3 天', '３ 天');
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText,
      sourceFingerprint: FINGERPRINT,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(response(validResponse())),
    });
    if (outcome.status === 'complete')
      expect(outcome.request.rawText).toBe(rawText);
    else expect.unreachable('a normalized response should be accepted');
  });

  it('fails closed on the deadline before an unbounded response can arrive', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      )) as typeof fetch;
    const outcome = await interpretTripRequestViaBff({
      endpoint: 'https://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl,
      deadlineMs: 1,
    });
    expect(outcome).toMatchObject({
      status: 'complete',
      diagnostics: { fallbackReasonCode: 'deadline_exceeded' },
    });
  });

  it('does not issue a request for an invalid endpoint and preserves aborts', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const fallback = await interpretTripRequestViaBff({
      endpoint: 'http://bff.example/v1/trip-requests/parse',
      rawText: RAW,
      sourceFingerprint: FINGERPRINT,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fallback).toMatchObject({
      status: 'complete',
      diagnostics: { fallbackReasonCode: 'auth_or_config' },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      interpretTripRequestViaBff({
        endpoint: 'https://bff.example/v1/trip-requests/parse',
        rawText: RAW,
        sourceFingerprint: FINGERPRINT,
        signal: controller.signal,
        fetchImpl,
      }),
    ).resolves.toEqual({ status: 'aborted', sourceFingerprint: FINGERPRINT });
  });
});
