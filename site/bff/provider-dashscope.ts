import { createDashscopeCompatibleProvider } from 'llm-gateway-kit';
import type { NluDraftAdapter } from '../app/lib/nlu-contract';
import {
  EXTRACTION_PROMPT,
  normalizeProviderDraft,
  PROMPT_VERSION,
  structuredDraftSchema,
} from './provider-shared';

export interface DashscopeProviderEnv {
  DASHSCOPE_API_KEY?: string;
  DASHSCOPE_WORKSPACE_ID?: string;
  DASHSCOPE_MODEL?: string;
  DASHSCOPE_FREE_TIER_ONLY_CONFIRMED?: string;
}

// Keep this state across adapter instances: the BFF creates one per request.
let freeTierExhausted = false;
export function resetDashscopeCircuitForTests(): void {
  freeTierExhausted = false;
}

export function createDashscopeAdapter(
  env: DashscopeProviderEnv,
  fetchImpl: typeof fetch = fetch,
): NluDraftAdapter {
  return {
    async extractDraft(input, { signal }) {
      if (freeTierExhausted) return { ok: false, code: 'circuit_open' };
      const workspaceId = env.DASHSCOPE_WORKSPACE_ID?.trim();
      const apiKey = env.DASHSCOPE_API_KEY?.trim();
      const model = env.DASHSCOPE_MODEL?.trim();
      // This is TripAgent's local free-tier policy, not a general provider rule.
      if (
        !apiKey ||
        !workspaceId ||
        !/^[A-Za-z0-9-]{1,128}$/.test(workspaceId) ||
        model !== 'qwen3.8-flash' ||
        env.DASHSCOPE_FREE_TIER_ONLY_CONFIRMED !== 'true' ||
        apiKey.startsWith('sk-sp-')
      )
        return { ok: false, code: 'auth_or_config' };

      const provider = createDashscopeCompatibleProvider({
        apiKey,
        workspaceId,
        model,
        maxOutputTokens: 4096,
        outputTokenLimitField: 'max_completion_tokens',
        fetchImpl,
        onFreeTierQuotaExhausted: () => {
          freeTierExhausted = true;
        },
      });
      const result = await provider.generate({
        systemPrompt: EXTRACTION_PROMPT,
        userText: input.text,
        schemaName: 'trip_request_draft_v2',
        jsonSchema: structuredDraftSchema(),
        signal,
      });
      if (!result.ok) return result;
      try {
        return {
          ok: true,
          draft: normalizeProviderDraft(JSON.parse(result.outputText)),
          promptVersion: PROMPT_VERSION,
          datasetVersion: input.datasetVersion,
        };
      } catch {
        return { ok: false, code: 'invalid_json' };
      }
    },
  };
}
