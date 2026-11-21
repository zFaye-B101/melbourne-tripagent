import type {
  AdapterFailureCode,
  NluDraftAdapter,
} from '../app/lib/nlu-contract';
import {
  normalizeProviderDraft,
  PROMPT_VERSION,
  schemaPrompt,
} from './provider-shared';

const ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

export interface ZhipuProviderEnv {
  ZHIPU_API_KEY?: string;
  ZHIPU_MODEL?: string;
}

export function createZhipuAdapter(
  env: ZhipuProviderEnv,
  fetchImpl: typeof fetch = fetch,
): NluDraftAdapter {
  return {
    async extractDraft(input, { signal }) {
      if (!env.ZHIPU_API_KEY || !env.ZHIPU_MODEL)
        return { ok: false, code: 'auth_or_config' };
      try {
        const response = await fetchImpl(ZHIPU_URL, {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${env.ZHIPU_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: env.ZHIPU_MODEL,
            messages: [
              { role: 'system', content: schemaPrompt() },
              { role: 'user', content: input.text },
            ],
            max_tokens: 1_600,
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
        });
        const payload = (await readJsonBody(response)) as {
          error?: { code?: unknown; message?: unknown };
          choices?: Array<{
            finish_reason?: unknown;
            message?: { content?: unknown; reasoning_content?: unknown };
          }>;
        } | null;
        if (!response.ok || payload?.error) {
          const mapped = mapZhipuFailure(response.status, payload?.error?.code);
          return { ok: false, code: mapped };
        }
        const choice = payload?.choices?.[0];
        if (choice?.finish_reason !== 'stop')
          return {
            ok: false,
            code:
              choice?.finish_reason === 'length'
                ? 'invalid_json'
                : 'provider_unavailable',
          };
        if (typeof choice.message?.content !== 'string')
          return { ok: false, code: 'invalid_json' };
        let draft: unknown;
        try {
          draft = normalizeProviderDraft(JSON.parse(choice.message.content));
        } catch {
          return { ok: false, code: 'invalid_json' };
        }
        return {
          ok: true,
          draft,
          promptVersion: PROMPT_VERSION,
          datasetVersion: input.datasetVersion,
        };
      } catch {
        if (signal.aborted) return { ok: false, code: 'deadline_exceeded' };
        return { ok: false, code: 'provider_unavailable' };
      }
    },
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapZhipuFailure(
  status: number,
  businessCode: unknown,
): AdapterFailureCode {
  const code =
    typeof businessCode === 'string' || typeof businessCode === 'number'
      ? String(businessCode)
      : '';
  if (code === '1305') return 'provider_unavailable';
  if (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    [
      '1000',
      '1001',
      '1003',
      '1113',
      '1210',
      '1211',
      '1212',
      '1213',
      '1214',
      '1215',
      '1220',
      '1261',
    ].includes(code)
  )
    return 'auth_or_config';
  if (status === 429 || ['1302', '1308'].includes(code)) return 'rate_limited';
  return 'provider_unavailable';
}
