/**
 * In-memory reuse of model-backed interpretations, keyed by request fingerprint.
 *
 * Why this exists
 * ---------------
 * Clicking 「整理我的需求」 twice with the same text and the same detailed settings
 * used to call the model twice: the fingerprint only ever decided whether a
 * result was still *current*, never whether it was still *usable*. Reusing it
 * is pure arithmetic — it involves no judgement about answer quality — so an
 * identical request is served instantly and costs nothing.
 *
 * What is deliberately not cached
 * ------------------------------
 * Only outcomes that a model call actually produced are worth keeping, and only
 * when repeat behaviour is predictable:
 *
 * - Rules-only runs are free and instant, so caching them saves nothing.
 * - Transport-shaped failures (`deadline_exceeded`, `rate_limited`,
 *   `provider_unavailable`, `auth_or_config`, `invalid_json`, `circuit_open`)
 *   are transient. Caching them would pin a visitor to a fallback answer for
 *   that text after a single timeout, so they are re-tried on the next click.
 *
 * Scope: one page instance, cleared by a reload. It is a cost lever, not a
 * store — nothing is persisted and nothing is shared between visitors.
 */

import type {
  InterpretationOutcome,
  ParserFallbackReasonCode,
} from './nlu-contract';

export const INTERPRETATION_CACHE = {
  /** Keeps the map small; a session realistically holds a handful of texts. */
  maxEntries: 20,
} as const;

/**
 * Fallback reasons that are a verdict on the model's *content* rather than on
 * the connection, so asking again for the same text would ask the same
 * question and get the same class of answer.
 */
const CONTENT_FALLBACK_REASONS: readonly ParserFallbackReasonCode[] = [
  'schema_rejected',
  'evidence_rejected',
  'semantic_rejected',
  'version_mismatch',
];

export type CachedInterpretation = Extract<
  InterpretationOutcome,
  { status: 'complete' }
>;

/** True when repeating the same request would predictably repeat this outcome. */
export function isReusableOutcome(
  outcome: InterpretationOutcome,
): outcome is CachedInterpretation {
  if (outcome.status !== 'complete') return false;
  const { diagnostics } = outcome;
  if (diagnostics.attemptedMode !== 'llm') return false;
  if (diagnostics.acceptedMode === 'llm') return true;
  return (
    diagnostics.fallbackReasonCode !== null &&
    CONTENT_FALLBACK_REASONS.includes(diagnostics.fallbackReasonCode)
  );
}

export interface InterpretationCache {
  /** Returns an isolated copy, or `null` on miss. Unknown keys return `null`. */
  get(fingerprint: string): CachedInterpretation | null;
  /** Stores the outcome when it is reusable; returns whether it was stored. */
  set(fingerprint: string, outcome: InterpretationOutcome): boolean;
  size(): number;
}

export function createInterpretationCache(
  maxEntries: number = INTERPRETATION_CACHE.maxEntries,
): InterpretationCache {
  const entries = new Map<string, CachedInterpretation>();

  return {
    get(fingerprint) {
      const hit = entries.get(fingerprint);
      if (!hit) return null;
      // Refresh recency so the working set survives a burst of one-off texts.
      entries.delete(fingerprint);
      entries.set(fingerprint, hit);
      // Hand out a copy: the caller composes a proposal from this and the page
      // must not be able to mutate what a later click will read back.
      return structuredClone(hit);
    },

    set(fingerprint, outcome) {
      if (!isReusableOutcome(outcome)) return false;
      entries.delete(fingerprint);
      entries.set(fingerprint, outcome);
      while (entries.size > Math.max(1, maxEntries)) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return true;
    },

    size() {
      return entries.size;
    },
  };
}
