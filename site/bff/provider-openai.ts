import type { NluDraftAdapter } from '../app/lib/nlu-contract';
import { createOpenAIResponsesProvider } from 'llm-gateway-kit';
import {
  EXTRACTION_PROMPT,
  normalizeProviderDraft,
  PROMPT_VERSION,
  structuredDraftSchema,
} from './provider-shared';

export { EXTRACTION_PROMPT, PROMPT_VERSION } from './provider-shared';

export function openAIStructuredSchema(): Record<string, unknown> {
  return structuredDraftSchema();
}

export interface OpenAIProviderEnv {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

export function createOpenAIAdapter(
  env: OpenAIProviderEnv,
  fetchImpl: typeof fetch = fetch,
): NluDraftAdapter {
  const provider = createOpenAIResponsesProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    fetchImpl,
    maxOutputTokens: 1_600,
  });
  return {
    async extractDraft(input, { signal }) {
      const result = await provider.generate({
        systemPrompt: EXTRACTION_PROMPT,
        userText: input.text,
        schemaName: 'trip_request_draft_v2',
        jsonSchema: openAIStructuredSchema(),
        signal,
      });
      if (!result.ok) return result;

      let draft: unknown;
      try {
        draft = normalizeProviderDraft(JSON.parse(result.outputText));
      } catch {
        return { ok: false, code: 'invalid_json' };
      }
      return {
        ok: true,
        draft,
        promptVersion: PROMPT_VERSION,
        datasetVersion: input.datasetVersion,
      };
    },
  };
}
