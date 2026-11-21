import type { NluDraftAdapter } from '../app/lib/nlu-contract';
import {
  EXTRACTION_PROMPT,
  normalizeProviderDraft,
  PROMPT_VERSION,
  structuredDraftSchema,
} from './provider-shared';

const DEEPSEEK_URL = 'https://api.deepseek.com/responses';

export interface DeepSeekProviderEnv {
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
}

export function createDeepSeekAdapter(
  env: DeepSeekProviderEnv,
  fetchImpl: typeof fetch = fetch,
): NluDraftAdapter {
  return {
    async extractDraft(input, { signal }) {
      if (!env.DEEPSEEK_API_KEY || !env.DEEPSEEK_MODEL)
        return { ok: false, code: 'auth_or_config' };
      try {
        const response = await fetchImpl(DEEPSEEK_URL, {
          method: 'POST',
          signal,
          headers: {
            authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: env.DEEPSEEK_MODEL,
            max_output_tokens: 1_600,
            input: [
              {
                role: 'system',
                content: [{ type: 'input_text', text: EXTRACTION_PROMPT }],
              },
              {
                role: 'user',
                content: [{ type: 'input_text', text: input.text }],
              },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'trip_request_draft_v2',
                schema: structuredDraftSchema(),
              },
            },
          }),
        });
        if (
          response.status === 401 ||
          response.status === 402 ||
          response.status === 403
        )
          return { ok: false, code: 'auth_or_config' };
        if (response.status === 400 || response.status === 422)
          return { ok: false, code: 'auth_or_config' };
        if (response.status === 429) return { ok: false, code: 'rate_limited' };
        if (!response.ok) return { ok: false, code: 'provider_unavailable' };

        const payload = (await response.json()) as {
          status?: unknown;
          error?: unknown;
          output?: Array<{
            type?: unknown;
            content?: Array<{ type?: unknown; text?: unknown }>;
          }>;
        };
        if (payload.status !== 'completed' || payload.error)
          return { ok: false, code: 'provider_unavailable' };
        const outputText = payload.output
          ?.filter((item) => item.type === 'message')
          .flatMap((item) => item.content ?? [])
          .find(
            (item) =>
              item.type === 'output_text' && typeof item.text === 'string',
          )?.text;
        if (typeof outputText !== 'string')
          return { ok: false, code: 'invalid_json' };
        let draft: unknown;
        try {
          draft = normalizeProviderDraft(JSON.parse(outputText));
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
