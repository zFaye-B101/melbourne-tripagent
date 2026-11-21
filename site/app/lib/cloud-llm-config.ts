import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';
import type { NluDraftAdapter } from './nlu-contract';
import {
  createCloudLlmDraftAdapter,
  type CloudLlmClient,
} from './cloud-llm-draft-adapter';

/**
 * WorkBuddy cloud service configuration for the published site.
 *
 * Both values are the integration-time `publicConfig` of this app's cloud
 * service. They are semi-public and safe to ship in the client bundle:
 * `publishableKey` only identifies which app is calling and carries no
 * permission on its own — the server enforces an exact Origin match. Provider
 * keys and the environment id stay server-side and must never appear here.
 *
 * The data plane and the page share one release domain, so `endpoint` is this
 * app's own origin. A page served from any other origin (for example a local
 * dev server) cannot use the channel — the request is rejected by Origin and
 * the app falls back to the rules path.
 */
export const CLOUD_LLM_PARSE_ENABLED = true;
export const CLOUD_LLM_ENDPOINT = 'https://melbourne-tripagent.app.workbuddy.host';
export const CLOUD_LLM_PUBLISHABLE_KEY =
  'wbpk_cFS2bnfmLJu6A0MoVMgysh_KfsW7LrQRcJzcYuBkFx60vw3kS2i6rNx';

/**
 * Model preference for the extraction call, tried in order before directory
 * order is used. Overridable at deployment time; a missing or non-selectable id
 * is skipped, never fatal.
 *
 * Chosen from live measurements against the production prompt, not from the
 * directory's own `isDefault`. Three things were measured repeatedly rather
 * than assumed:
 *
 * - `auto` (the directory default) and `default` (an alias that routes to the
 *   same backend) are not models of their own. With no `reasoning_effort` they
 *   fall to `high` effort and stream nothing but `reasoning_content` — 81 s and
 *   88 s+ observed, never a draft. That is a guaranteed timeout, not a coin flip.
 * - `glm-5.3-flash` with `reasoning_effort=minimal` returned a schema-valid
 *   draft in 6.2 s, 6.9 s and 7.6 s for 0.03–0.04 credits, and `low` behaved
 *   identically. It is the fastest reliable entry and ~24x cheaper than the
 *   `default` alias (0.03 vs 0.71 credits for the same answer).
 * - `hunyuan-chat` needs no reasoning at all and looks like the safe pick, but
 *   it does not honour the output contract: it nests an `evidence` array inside
 *   each section object (`/destination/evidence`, `/date/evidence`, …) instead
 *   of emitting the single top-level `evidence` list, and it produced a
 *   non-string `quote`. Every run was rejected by `validateDraftSchema`. Being
 *   quick at producing a rejected answer is still a failure.
 */
export const CLOUD_LLM_PREFERRED_MODELS: readonly string[] = ['glm-5.3-flash'];

/**
 * How much the model may think before answering. This single parameter is the
 * difference between this feature working and never working: without it every
 * reasoning entry runs at its declared `high` default and never emits `content`
 * inside a page interaction.
 *
 * The directory declares `supportedEfforts: ['low', 'high', 'max']` for
 * `glm-5.3-flash`, so `low` was verified as the declared alternative and
 * measured identically (6.3 s / 7.5 s, 0.03 credits). `minimal` is used because
 * it is the strongest reduction the API accepts and the gateway honoured it on
 * every model tested, including the aliases.
 */
export const CLOUD_LLM_REASONING_EFFORT = 'minimal' as const;

/**
 * Wall-clock budget for one extraction. The orchestrator aborts the adapter at
 * this deadline and falls back to rules, so this also bounds the worst-case
 * wait a visitor sees before the rules path takes over.
 *
 * Measured: the pinned model lands a complete valid draft in 6.2–7.6 s, and the
 * slowest fallback that still produced a draft was 12.2 s (`auto` with minimal
 * effort). This is roughly a 2.6x margin over the pinned model rather than a
 * tuned target. Anything slower than this is a model that is not going to answer
 * usefully — the rules path is instant, so waiting longer only spends the
 * visitor's click.
 */
export const CLOUD_LLM_DEADLINE_MS = 20_000;

export function isCloudLlmParseConfigured(origin?: string): boolean {
  // The WorkBuddy channel enforces an exact Origin match server-side. Other
  // hosts (for example a GitHub Pages demo) must keep the free rules path
  // instead of firing a call that can only be rejected.
  const currentOrigin =
    origin ??
    (typeof window === 'undefined' ? '' : window.location.origin);
  return (
    CLOUD_LLM_PARSE_ENABLED &&
    CLOUD_LLM_ENDPOINT.startsWith('https://') &&
    CLOUD_LLM_PUBLISHABLE_KEY.startsWith('wbpk_') &&
    currentOrigin === CLOUD_LLM_ENDPOINT
  );
}

let adapter: NluDraftAdapter | null = null;

/**
 * Create the cloud adapter once per page load. The SDK client holds the shared
 * fetch and credential state, so it must not be re-created per request.
 */
export function resolveCloudLlmDraftAdapter(): NluDraftAdapter | null {
  if (!isCloudLlmParseConfigured()) return null;
  adapter ??= createCloudLlmDraftAdapter({
    client: createWorkBuddyCloud({
      endpoint: CLOUD_LLM_ENDPOINT,
      publishableKey: CLOUD_LLM_PUBLISHABLE_KEY,
    }) as CloudLlmClient,
    preferredModelIds: CLOUD_LLM_PREFERRED_MODELS,
    reasoningEffort: CLOUD_LLM_REASONING_EFFORT,
  });
  return adapter;
}
