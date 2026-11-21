import type { AdapterFailureCode, NluDraftAdapter } from './nlu-contract';
import {
  normalizeProviderDraft,
  schemaPrompt,
} from '../../bff/provider-shared';
import { getRuntimeConfig } from './runtime-config-state';

/**
 * Minimal structural surface of the WorkBuddy cloud SDK that this adapter uses.
 * Declaring it locally keeps the adapter testable with a fake client and keeps
 * the SDK out of every module that only needs the extraction behaviour.
 */
export interface CloudLlmModelEntry {
  id: string;
  /**
   * Directory selection hint and the authoritative selectable flag: it is
   * present on every entry, while `disabled` is only sent when the server has
   * an explicit value. Prefer `enabled` and treat `disabled` as a second guard.
   */
  enabled?: boolean;
  disabled?: boolean;
  isDefault?: boolean;
  /** Reasoning-capable models stream their work into `reasoning_content`. */
  supportsReasoning?: boolean;
  /** Reasoning-only models never emit `content` until reasoning finishes. */
  onlyReasoning?: boolean;
  /**
   * Reasoning configuration, present only on entries that expose it. Before
   * `reasoning_effort` is sent, such a model spends an unbounded amount of time
   * in `reasoning_content` and emits no answer at all — this field is what makes
   * the difference between an unusable entry and a fast one, so it is the first
   * thing {@link selectModel} looks for.
   */
  reasoning?: {
    /** Declared default when the caller sends no effort. */
    defaultEffort?: string;
    /** When present, the caller can turn thinking down or off. */
    canDisableThinking?: boolean;
    supportedEfforts?: string[];
    effort?: string;
    summary?: string;
  };
  /**
   * Declared output ceiling. Absent on entries that are not chat models at all
   * (for example an image-generation model), which makes it the cheapest way to
   * tell a usable text model from an unusable one.
   */
  maxOutputTokens?: number;
}

export interface CloudLlmChunk {
  choices: Array<{
    delta?: {
      content?: string | null;
      /**
       * Reasoning models stream their scratch work here. It is never the answer
       * and must not reach the draft.
       */
      reasoning_content?: string | null;
    } | null;
    finish_reason?: string | null;
  }>;
}

export interface CloudLlmChatRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  stream: true;
  temperature?: number;
  max_tokens?: number;
  /**
   * Caps how long the model may think before answering. Without it a
   * reasoning model defaults to high effort and streams no `content` at all
   * inside any page interaction; with it the same models answer in seconds and
   * pass the draft schema. See {@link CloudLlmDraftAdapterOptions.reasoningEffort}.
   */
  reasoning_effort?: ReasoningEffort;
  signal?: AbortSignal;
}

/** Values accepted by the provider's `reasoning_effort` parameter. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface CloudLlmClient {
  llm: {
    models: { list(signal?: AbortSignal): Promise<CloudLlmModelEntry[]> };
    chat: { completions: { create(input: CloudLlmChatRequest): AsyncIterable<CloudLlmChunk> } };
  };
}

export interface CloudLlmDraftAdapterOptions {
  client: CloudLlmClient;
  /**
   * Model ids to try before falling back to directory order. This is a
   * preference, never a requirement: an id that is absent or not selectable in
   * the current directory is skipped, and if none matches, the tier rules in
   * {@link selectModel} decide.
   *
   * It exists because two entries that look identical in the directory can
   * differ by more than 20x in cost — see the measurements in `selectModel`.
   */
  preferredModelIds?: readonly string[];
  /**
   * How much the model may think before answering.
   *
   * Against the production prompt, at 20 s and with `reasoning_effort=minimal`,
   * `glm-5.3-flash` finished in 6.2–7.6 s for 0.03 credits with a schema-valid
   * draft on every run; the same entry with no effort sent took 22–60 s on the
   * fallback entry and the `default` alias reached 88 s. Turning effort down is
   * what makes a reasoning model usable inside a click, so it is sent whenever
   * it is configured, for every model.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Leave undefined to use the model's own default. The model directory is not
   * a stable contract, so no sampling or output-length parameter is sent
   * unless the deployment opts in.
   */
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Choose the model for one extraction.
 *
 * Measured on this app's directory against the production prompt (~9.2k chars
 * of system prompt, one short trip description). Every figure is wall clock to
 * a schema-valid draft, or to the point where the caller's deadline gives up:
 *
 * | entry                     | reasoning_effort | wall       | credits | schema |
 * | `glm-5.3-flash`           | `minimal`        | 6.2–7.6 s  |  0.03   | pass   |
 * | `glm-5.3-flash`           | `low`            | 6.3–7.5 s  |  0.03   | pass   |
 * | `glm-5.3`                 | `minimal`        | 10.3 s     |  0.75   | pass   |
 * | `default` (alias)         | `minimal`        | 7.7 s      |  0.71   | pass   |
 * | `auto` (alias)            | `minimal`        | 12.2 s     |  0.78   | pass   |
 * | `deepseek-v4.1-flash`     | `minimal`        | 19.4 s     |  0.27   | pass   |
 * | `hy3`                     | `minimal`        | 55.7 s     |  0.00   | pass   |
 * | `hunyuan-chat`            | (not sent)       | 26.4 s     |  0.02   | **fail** |
 * | `default` (alias)         | (not sent)       | 88 s+      |   —     | never  |
 * | `auto` (alias)            | (not sent)       | 81 s       |  3.82   | —      |
 *
 * The decisive variable is not which entry is picked but whether
 * `reasoning_effort` is sent. Without it, every reasoning entry runs at its
 * declared default of `high` and streams nothing but `reasoning_content` for
 * far longer than a page can wait — that is what made `auto` and `default`
 * look unusable. With it, the whole class becomes fast and schema-valid, and
 * the remaining differences are price (`glm-5.3-flash` is ~24x cheaper than
 * `default`) and consistency.
 *
 * `hunyuan-chat` is the one entry that never reasons and therefore looks like
 * the safest pick, but it violates the output contract — it nests an `evidence`
 * array inside each section instead of emitting one top-level list — so the
 * schema rejects it on every run. Being fast at producing a rejected answer is
 * still a failure.
 *
 * Tiers, used when no preferred id matches. Entries that expose reasoning
 * configuration come first, because their thinking can be capped:
 *   1. declares a ceiling and `canDisableThinking`
 *   2. declares a ceiling and any reasoning configuration
 *   3. declares a ceiling and no reasoning capability at all
 *   4. declares a ceiling
 *   5. any selectable entry
 *
 * `isDefault` only breaks ties inside a tier. No model id is required to exist:
 * a directory that renames or drops models keeps working, and if every tier is
 * empty we report a fallback rather than inventing an id.
 */
function selectModel(
  models: readonly CloudLlmModelEntry[],
  preferredModelIds: readonly string[] = [],
): CloudLlmModelEntry | null {
  const selectable = models.filter(
    (model) => model.enabled !== false && model.disabled !== true,
  );

  for (const id of preferredModelIds) {
    const preferred = selectable.find((model) => model.id === id);
    if (preferred) return preferred;
  }

  const textCapable = selectable.filter(
    (model) =>
      typeof model.maxOutputTokens === 'number' && model.maxOutputTokens > 0,
  );
  const cappableThinking = textCapable.filter(
    (model) => model.reasoning?.canDisableThinking === true,
  );
  const declaredReasoning = textCapable.filter(
    (model) => model.reasoning !== undefined,
  );
  const plainChat = textCapable.filter(
    (model) => model.supportsReasoning !== true && model.onlyReasoning !== true,
  );

  for (const tier of [
    cappableThinking,
    declaredReasoning,
    plainChat,
    textCapable,
    selectable,
  ]) {
    if (tier.length === 0) continue;
    return tier.find((model) => model.isDefault === true) ?? tier[0] ?? null;
  }
  return null;
}

/**
 * Draft adapter backed by the WorkBuddy cloud LLM channel.
 *
 * The model only extracts a TripRequestDraft v2; every deterministic check
 * (schema, evidence binding, semantics, normalization) stays where it already
 * lives, outside this adapter. Any failure is reported as a fallback code so
 * the orchestrator can keep the previous successful plan and use the rules path.
 */
export function createCloudLlmDraftAdapter(
  options: CloudLlmDraftAdapterOptions,
): NluDraftAdapter {
  const { client } = options;
  let resolvedModelId: string | null = null;
  let modelLookup: Promise<string | null> | null = null;

  /**
   * Resolve the model once per page load. An empty directory is a legal answer:
   * report a fallback instead of inventing an id.
   */
  async function resolveModelId(signal?: AbortSignal): Promise<string | null> {
    if (resolvedModelId !== null) return resolvedModelId;
    modelLookup ??= (async () => {
      const models = await client.llm.models.list(signal);
      return selectModel(models, options.preferredModelIds)?.id ?? null;
    })().finally(() => {
      modelLookup = null;
    });
    const id = await modelLookup;
    resolvedModelId = id;
    return id;
  }

  return {
    async extractDraft(input, { signal }) {
      try {
        const model = await resolveModelId(signal);
        if (model === null) return { ok: false, code: 'provider_unavailable' };
        const prompt = getRuntimeConfig().prompt;

        const request: CloudLlmChatRequest = {
          model,
          messages: [
            { role: 'system', content: schemaPrompt(prompt.text) },
            { role: 'user', content: input.text },
          ],
          stream: true,
          signal,
        };
        if (options.temperature !== undefined)
          request.temperature = options.temperature;
        if (options.maxOutputTokens !== undefined)
          request.max_tokens = options.maxOutputTokens;
        if (options.reasoningEffort !== undefined)
          request.reasoning_effort = options.reasoningEffort;

        // The API is streaming-only; collect the content deltas ourselves.
        //
        // A stream can end without its `[DONE]` sentinel — the transport then
        // reports a terminal failure (`gateway_stream_interrupted`) even though
        // every data frame, including the complete JSON, already arrived. This
        // was observed in practice, so a terminal transport error must not by
        // itself discard the answer: keep the payload and let JSON parsing
        // decide whether it was actually complete.
        let output = '';
        let transportFailure: unknown = null;
        try {
          for await (const chunk of client.llm.chat.completions.create(request)) {
            const delta = chunk.choices[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) output += delta;
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          transportFailure = error;
        }

        if (output.trim().length === 0) {
          return {
            ok: false,
            code:
              transportFailure === null
                ? 'provider_unavailable'
                : failureCodeFor(transportFailure, signal),
          };
        }

        let draft: unknown;
        try {
          draft = JSON.parse(output);
        } catch {
          // Truncated JSON means the stream really was cut short.
          return {
            ok: false,
            code:
              transportFailure === null
                ? 'invalid_json'
                : failureCodeFor(transportFailure, signal),
          };
        }
        return {
          ok: true,
          draft: normalizeProviderDraft(draft),
          promptVersion: prompt.version,
          datasetVersion: input.datasetVersion,
        };
      } catch (error) {
        return { ok: false, code: failureCodeFor(error, signal) };
      }
    },
  };
}

/**
 * Map a cloud LLM failure onto the existing fallback vocabulary.
 *
 * `request_*` means our request is malformed (wrong model id, missing system
 * message, non-streaming call) — a wiring problem on our side, so it is
 * reported as a configuration failure rather than as a transient outage.
 */
function failureCodeFor(
  error: unknown,
  signal: AbortSignal | undefined,
): AdapterFailureCode {
  if (signal?.aborted) return 'deadline_exceeded';
  if (error && typeof error === 'object' && 'error' in error) {
    const cloudError = error as {
      error?: { code?: unknown } | null;
      status?: unknown;
    };
    const code =
      typeof cloudError.error?.code === 'string' ? cloudError.error.code : '';
    const status =
      typeof cloudError.status === 'number' ? cloudError.status : undefined;
    if (status === 429 || code === 'quota_rate_limited') return 'rate_limited';
    if (status === 401 || status === 403) return 'auth_or_config';
    if (
      code.startsWith('auth_') ||
      code.startsWith('request_') ||
      code.startsWith('quota_')
    )
      return 'auth_or_config';
    return 'provider_unavailable';
  }
  return 'provider_unavailable';
}
