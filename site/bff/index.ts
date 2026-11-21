import { interpretTripRequest } from '../app/lib/nlu-orchestrator';
import { POI_DATASET } from '../app/lib/planner';
import type {
  AdapterFailureCode,
  InterpretationOutcome,
  NluDraftAdapter,
} from '../app/lib/nlu-contract';
import type {
  ParseErrorBody,
  ParseRequestV1,
  ParseResponseV1,
  NoticeV1,
} from '../app/lib/llm-api';
import { createDeepSeekAdapter } from './provider-deepseek';
import { createOpenAIAdapter } from './provider-openai';
import { createZhipuAdapter } from './provider-zhipu';
import { createDashscopeAdapter } from './provider-dashscope';
import { createLocalNluDiagnosticsSink } from '../app/lib/local-nlu-diagnostics';
import { createBudgetedNluAdapter } from './budget-gate';
import type { TripBudgetDurableObject } from './budget-do';

export interface Env {
  LLM_ENABLED?: string;
  LLM_LOCAL_DIAGNOSTICS?: string;
  LLM_PROVIDER?: string;
  LLM_RUNTIME_ENV?: string;
  LLM_OPTIONAL_ASSERTION_ELISION?: string;
  LLM_LOCAL_DEV_BYPASS_RATE_LIMITER?: string;
  LLM_LOCAL_BUDGET_ENABLED?: string;
  LLM_MAX_COST_UNITS?: string;
  LLM_BUDGET_DO?: DurableObjectNamespace<TripBudgetDurableObject>;
  ALLOWED_ORIGINS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  ZHIPU_API_KEY?: string;
  ZHIPU_MODEL?: string;
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_WORKSPACE_ID?: string;
  DASHSCOPE_MODEL?: string;
  DASHSCOPE_FREE_TIER_ONLY_CONFIRMED?: string;
  LLM_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

const datasetVersion = POI_DATASET.dataVersion;
const parsePath = '/v1/trip-requests/parse';
const maxRequestBytes = 16_000;
const defaultDeadlineMs = 4_000;
const localDeadlineMs = 60_000;

export interface ParseRuntime {
  resolveAdapter?: (
    env: Env,
    request: Request,
    requestId: string,
  ) => Promise<NluDraftAdapter | undefined>;
  deadlineMs?: number;
  enableOptionalAssertionElision?: boolean;
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleParseRequest(request, env);
  },
};

export async function handleParseRequest(
  request: Request,
  env: Env,
  runtime: ParseRuntime = {},
): Promise<Response> {
  if (new URL(request.url).pathname !== parsePath)
    return jsonError(404, { error: 'not_found', message: '接口不存在。' }, {});
  const origin = request.headers.get('Origin');
  const corsOrigin = allowedOrigin(origin, env.ALLOWED_ORIGINS);
  const cors: Record<string, string> = corsOrigin
    ? { 'access-control-allow-origin': corsOrigin, vary: 'Origin' }
    : {};
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: corsOrigin ? 204 : 403,
      headers: {
        ...cors,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  if (request.method !== 'POST')
    return jsonError(
      405,
      { error: 'method_not_allowed', message: '只支持 POST。' },
      cors,
    );
  if (origin && !corsOrigin)
    return jsonError(
      403,
      { error: 'invalid_request', message: '请求来源不在允许列表中。' },
      {},
    );
  let body: unknown;
  try {
    const rawBody = await readBodyWithLimit(request, maxRequestBytes);
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(
      400,
      { error: 'invalid_request', message: '请求体必须是有效 JSON。' },
      cors,
    );
  }
  const parsed = validateRequest(body);
  if (!parsed.ok)
    return jsonError(
      400,
      { error: 'invalid_request', message: parsed.message },
      cors,
    );
  if (parsed.value.datasetVersion !== datasetVersion)
    return jsonError(
      409,
      { error: 'dataset_version_mismatch', message: '数据版本不匹配。' },
      cors,
    );

  const requestId = crypto.randomUUID();
  const adapter = await (runtime.resolveAdapter ?? adapterForRequest)(
    env,
    request,
    requestId,
  );
  const outcome = await interpretTripRequest({
    rawText: parsed.value.text,
    locale: parsed.value.locale,
    sourceFingerprint: requestId,
    adapter,
    enableOptionalAssertionElision:
      runtime.enableOptionalAssertionElision ??
      optionalAssertionElisionEnabled(env, request),
    deadlineMs: runtime.deadlineMs ?? deadlineMsForRequest(env, request),
    localDiagnostics: createLocalNluDiagnosticsSink(env, request),
  });
  const response = toResponse(requestId, outcome, datasetVersion);
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default worker;

async function adapterForRequest(
  env: Env,
  request: Request,
  requestId: string,
): Promise<NluDraftAdapter | undefined> {
  if (env.LLM_ENABLED !== 'true') return undefined;
  // Public model calls require a real identity and atomic budget gate. The
  // existing anonymous limiter is insufficient, so only local trials run.
  if (!isLocalRequest(env, request)) return failureAdapter('auth_or_config');
  const localBypass =
    isLocalRequest(env, request) &&
    env.LLM_LOCAL_DEV_BYPASS_RATE_LIMITER === 'true';
  if (!env.LLM_RATE_LIMITER && !localBypass)
    return failureAdapter('auth_or_config');
  if (env.LLM_RATE_LIMITER) {
    try {
      const { success } = await env.LLM_RATE_LIMITER.limit({
        key: 'anonymous:trip-request-parse',
      });
      if (!success) return failureAdapter('rate_limited');
    } catch {
      return failureAdapter('provider_unavailable');
    }
  }
  const provider = providerForEnv(env);
  if (!provider) return failureAdapter('auth_or_config');

  // This optional path exercises the persistent-budget contract on loopback.
  // Public requests are still rejected above, regardless of bindings/flags.
  if (env.LLM_LOCAL_BUDGET_ENABLED !== 'true') return provider;
  const maxCostUnits = parsePositiveInteger(env.LLM_MAX_COST_UNITS);
  if (!env.LLM_BUDGET_DO || maxCostUnits === null)
    return failureAdapter('auth_or_config');
  try {
    const stub = env.LLM_BUDGET_DO.getByName('melbourne-tripagent-demo-global');
    return createBudgetedNluAdapter(
      provider,
      {
        reserve: (input) => stub.reserve(input),
        settle: (input) => stub.settle(input),
      },
      requestId,
      maxCostUnits,
    );
  } catch {
    return failureAdapter('provider_unavailable');
  }
}

export function providerForEnv(env: Env): NluDraftAdapter | null {
  switch (env.LLM_PROVIDER?.trim().toLowerCase()) {
    case 'openai':
      return createOpenAIAdapter(env);
    case 'deepseek':
      return createDeepSeekAdapter(env);
    case 'zhipu':
      return createZhipuAdapter(env);
    case 'dashscope':
      return createDashscopeAdapter(env);
    default:
      return null;
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function deadlineMsForRequest(env: Env, request: Request): number {
  return isLocalRequest(env, request) ? localDeadlineMs : defaultDeadlineMs;
}

export function optionalAssertionElisionEnabled(
  env: Env,
  request: Request,
): boolean {
  return (
    env.LLM_OPTIONAL_ASSERTION_ELISION === 'true' &&
    isLocalRequest(env, request)
  );
}

function isLocalRequest(env: Env, request: Request): boolean {
  return (
    env.LLM_RUNTIME_ENV === 'local' &&
    isLoopbackHost(new URL(request.url).hostname)
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  );
}

function failureAdapter(code: AdapterFailureCode): NluDraftAdapter {
  return {
    async extractDraft() {
      return { ok: false, code };
    },
  };
}

async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isFinite(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maxBytes
    )
      throw new Error('request_too_large');
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('request_too_large');
        throw new Error('request_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function validateRequest(
  value: unknown,
): { ok: true; value: ParseRequestV1 } | { ok: false; message: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return { ok: false, message: '请求字段无效。' };
  const input = value as Record<string, unknown>;
  const allowed = new Set(['text', 'locale', 'datasetVersion']);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    return { ok: false, message: '请求包含未知字段。' };
  const normalizedText =
    typeof input.text === 'string' ? input.text.normalize('NFKC').trim() : '';
  if (normalizedText.length === 0 || normalizedText.length > 2_000)
    return { ok: false, message: 'text 必须是 1–2,000 字符。' };
  if (
    input.locale !== 'zh-CN' ||
    typeof input.datasetVersion !== 'string' ||
    input.datasetVersion.length === 0 ||
    input.datasetVersion.length > 120
  )
    return { ok: false, message: 'locale 或 datasetVersion 无效。' };
  return {
    ok: true,
    value: {
      text: normalizedText,
      locale: 'zh-CN',
      datasetVersion: input.datasetVersion,
    },
  };
}

function toResponse(
  requestId: string,
  outcome: InterpretationOutcome,
  version: string,
): ParseResponseV1 {
  if (outcome.status === 'aborted') throw new Error('aborted');
  if (outcome.status === 'failed')
    return {
      apiVersion: 'trip-parse-api-v1',
      requestId,
      decision: 'service_error',
      parser: outcome.diagnostics,
      datasetVersion: version,
      request: null,
      fieldEvidence: [],
      question: null,
      warnings: [],
    };
  const request = outcome.request;
  const warnings: NoticeV1[] = request.warnings.map((message, index) => ({
    code: `planner_warning_${index + 1}`,
    message,
  }));
  if (request.errors.length > 0)
    return {
      apiVersion: 'trip-parse-api-v1',
      requestId,
      decision: 'scope_error',
      parser: outcome.diagnostics,
      datasetVersion: version,
      request: null,
      fieldEvidence: outcome.fieldEvidence,
      question: null,
      warnings: [
        ...warnings,
        ...request.errors.map((message) => ({ code: 'scope_error', message })),
      ],
    };
  if (request.needsClarification.includes('days'))
    return {
      apiVersion: 'trip-parse-api-v1',
      requestId,
      decision: 'clarification',
      parser: outcome.diagnostics,
      datasetVersion: version,
      request: stripRawText(request),
      fieldEvidence: outcome.fieldEvidence,
      question: {
        id: 'days',
        field: 'days',
        prompt: '计划在墨尔本玩几天？',
        options: [
          { value: '1', label: '1 天' },
          { value: '2', label: '2 天' },
          { value: '3', label: '3 天' },
        ],
      },
      warnings,
    };
  return {
    apiVersion: 'trip-parse-api-v1',
    requestId,
    decision: 'ready',
    parser: outcome.diagnostics,
    datasetVersion: version,
    request: stripRawText(request),
    fieldEvidence: outcome.fieldEvidence,
    question: null,
    warnings,
  };
}

function stripRawText<T extends { rawText: string }>(
  request: T,
): Omit<T, 'rawText'> {
  const { rawText: _rawText, ...safe } = request;
  return safe;
}

function allowedOrigin(
  origin: string | null,
  configured?: string,
): string | null {
  if (!origin) return null;
  const allowlist = (configured ?? 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return allowlist.includes(origin) ? origin : null;
}

function jsonError(
  status: number,
  body: ParseErrorBody,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
