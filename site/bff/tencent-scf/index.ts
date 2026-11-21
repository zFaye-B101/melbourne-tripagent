import { createBudgetedNluAdapter } from '../budget-gate';
import { handleParseRequest, providerForEnv, type Env } from '../index';
import type { NluDraftAdapter } from '../../app/lib/nlu-contract';
import {
  createCloudbaseBudgetPort,
  type CloudbaseBudgetDatabase,
} from './budget-cloudbase';

type ScfEvent = {
  body?: unknown;
  headers?: unknown;
  httpMethod?: unknown;
  path?: unknown;
};

type ScfResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type ScfEnvironment = Env & {
  CLOUDBASE_ENV_ID?: string;
  CLOUDBASE_APIKEY?: string;
  LLM_BUDGET_PERIOD?: string;
  LLM_BUDGET_LIMIT_UNITS?: string;
  LLM_MAX_CALLS_PER_MINUTE?: string;
};

const parsePath = '/v1/trip-requests/parse';
const publicDeadlineMs = 20_000;

type ScfDependencies = {
  database?: (env: ScfEnvironment) => Promise<CloudbaseBudgetDatabase>;
};

/** Event-type SCF Function URL entry; no provider key is sent to the browser. */
export function createScfHandler(dependencies: ScfDependencies = {}) {
  return async function main_handler(
    event: ScfEvent,
    _context?: unknown,
    environment?: ScfEnvironment,
  ): Promise<ScfResult> {
    try {
      const env = environment ?? (process.env as unknown as ScfEnvironment);
      if (!event || typeof event !== 'object') return errorResult(400);
      if (event.path !== parsePath) return errorResult(404);
      if (event.httpMethod !== 'POST' && event.httpMethod !== 'OPTIONS')
        return errorResult(405);
      if (event.body !== undefined && typeof event.body !== 'string')
        return errorResult(400);
      const headers = safeHeaders(event.headers);
      const request = new Request(`https://scf.tripagent.invalid${parsePath}`, {
        method: event.httpMethod,
        headers,
        body: event.httpMethod === 'POST' ? (event.body ?? '') : undefined,
      });
      const response = await handleParseRequest(request, env, {
        resolveAdapter: async (env, _request, requestId) => {
          if (env.LLM_ENABLED !== 'true') return undefined;
          const scfEnv = env as ScfEnvironment;
          if (!publicConfigReady(scfEnv))
            return failureAdapter('auth_or_config');
          const provider = providerForEnv(scfEnv);
          if (!provider) return failureAdapter('auth_or_config');
          try {
            const db = await (dependencies.database ?? cloudbaseDatabase)(
              scfEnv,
            );
            const budget = createCloudbaseBudgetPort(db, {
              budgetPeriod: scfEnv.LLM_BUDGET_PERIOD!,
              limitUnits: Number(scfEnv.LLM_BUDGET_LIMIT_UNITS),
              maxCallsPerMinute: Number(scfEnv.LLM_MAX_CALLS_PER_MINUTE),
            });
            return createBudgetedNluAdapter(
              provider,
              budget,
              requestId,
              Number(scfEnv.LLM_MAX_COST_UNITS),
            );
          } catch {
            return failureAdapter('provider_unavailable');
          }
        },
        deadlineMs: publicDeadlineMs,
        enableOptionalAssertionElision: false,
      });
      return {
        statusCode: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      };
    } catch {
      // Do not leak provider credentials or request text through the URL.
      return errorResult(503);
    }
  };
}

export const main_handler = createScfHandler();

function publicConfigReady(env: ScfEnvironment): boolean {
  const origins = env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? [];
  return (
    origins.length > 0 &&
    origins.every((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol === 'https:' && url.origin === origin;
      } catch {
        return false;
      }
    }) &&
    Boolean(env.CLOUDBASE_ENV_ID?.trim()) &&
    Boolean(env.CLOUDBASE_APIKEY?.trim()) &&
    /^[A-Za-z0-9._-]{1,80}$/.test(env.LLM_BUDGET_PERIOD ?? '') &&
    positiveInteger(env.LLM_BUDGET_LIMIT_UNITS) &&
    positiveInteger(env.LLM_MAX_COST_UNITS) &&
    positiveInteger(env.LLM_MAX_CALLS_PER_MINUTE) &&
    Number(env.LLM_MAX_COST_UNITS) <= Number(env.LLM_BUDGET_LIMIT_UNITS)
  );
}

async function cloudbaseDatabase(
  env: ScfEnvironment,
): Promise<CloudbaseBudgetDatabase> {
  const sdkModule = await import('@cloudbase/node-sdk');
  const app = sdkModule.default.init({
    env: env.CLOUDBASE_ENV_ID!,
    accessKey: env.CLOUDBASE_APIKEY!,
  });
  return app.database() as CloudbaseBudgetDatabase;
}

function positiveInteger(value: string | undefined): boolean {
  return (
    !!value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
  );
}

function safeHeaders(value: unknown): Headers {
  const headers = new Headers();
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return headers;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') continue;
    if (key.toLowerCase() === 'origin') headers.set('origin', entry);
    if (key.toLowerCase() === 'content-type')
      headers.set('content-type', entry);
  }
  return headers;
}

function failureAdapter(
  code: 'auth_or_config' | 'provider_unavailable',
): NluDraftAdapter {
  return {
    async extractDraft() {
      return { ok: false, code };
    },
  };
}

function errorResult(statusCode: number): ScfResult {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ error: 'invalid_request' }),
  };
}
