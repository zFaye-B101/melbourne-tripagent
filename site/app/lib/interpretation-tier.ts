/**
 * Rules-first tier for trip-request understanding.
 *
 * The page runs the deterministic rules parser before it spends anything. This
 * module decides whether that free answer is good enough to publish, or whether
 * the request should escalate to the cloud model.
 *
 * Why a gate is needed at all
 * ---------------------------
 * The rules parser is keyword matching. It never reports "I did not understand
 * your sentence": an unrecognised word simply leaves the field at its default
 * and, at best, adds a line to `assumptions`. So "no errors" is *not* evidence
 * that the user's meaning survived — a gate that accepted that would quietly
 * publish a worse answer than the model would have produced.
 *
 * What is actually observable
 * ---------------------------
 * There is no confidence / score / unmatched-token signal anywhere in the
 * deterministic pipeline, so the gate is built from what does exist:
 *
 * - `errors` — hard failures. Some are genuine misreads and worth escalating
 *   (`从悉尼出发去墨尔本玩 3 天` fails to resolve the origin, which a model can
 *   read correctly), some are product or dataset limits a model cannot fix.
 * - `unknownHardConstraints` — a named place that is not in the 40-POI dataset.
 *   This is a data gap by definition, so it is the one error class that is
 *   published rather than escalated: no model call can conjure a POI that the
 *   dataset does not contain, and silently dropping the constraint would be
 *   worse than the parser's explicit message.
 * - `needsClarification` — the parser knows a required field is missing.
 * - per-field `FieldSource` — `'text'` means the value was read from the user's
 *   own words, `'default'` means it was filled in for them.
 *
 * Measured effect (11 representative inputs, docs/36): the rules path answers 5
 * and escalates 6 — so a little under half of clicks avoid a model call at all.
 * This is a quota lever, not a quality bar; docs/36 records the alternative
 * gates that were measured and rejected.
 */

import type { ParsedTripRequest } from './planner';
import type { CachedInterpretation } from './interpretation-cache';
import { checkLlmInput, type LlmLocalLimits } from './llm-local-guard';
import { getRuntimeConfig } from './runtime-config-state';

export const RULES_TIER = {
  /**
   * Fields that must have been read from the user's own words before the rules
   * answer is trusted on its own. Below three, the parser is usually working
   * from defaults and the request is genuinely vague — exactly the case the
   * model is worth paying for.
   */
  minRecognizedFields: 3,
} as const;

export interface RulesTierOptions {
  minRecognizedFields: number;
}

/** Fields the rules parser can read straight out of the user's text. */
export type RecognizedField =
  | 'days'
  | 'pace'
  | 'geography'
  | 'venue'
  | 'startWindow'
  | 'interests'
  | 'budget'
  | 'party'
  | 'date'
  | 'lowWalking'
  | 'family'
  | 'avoidCrowds';

/** Fields whose presence shows the user expressed a *preference*. */
const PREFERENCE_FIELDS: readonly RecognizedField[] = ['interests', 'pace'];

export function recognizedFields(request: ParsedTripRequest): RecognizedField[] {
  const fields: RecognizedField[] = [];
  if (request.daysSource === 'text' && request.days !== null) fields.push('days');
  if (request.paceSource === 'text') fields.push('pace');
  if (request.geography.source === 'text') fields.push('geography');
  if (request.venuePreference.source === 'text') fields.push('venue');
  if (request.dailyWindow.startSource === 'text') fields.push('startWindow');
  if (request.interests.length > 0) fields.push('interests');
  if (request.totalBudgetCents !== null) fields.push('budget');
  if (request.pricingParty.source === 'text') fields.push('party');
  if (request.dateText !== null) fields.push('date');
  if (request.lowWalking) fields.push('lowWalking');
  if (request.family) fields.push('family');
  if (request.avoidCrowds) fields.push('avoidCrowds');
  return fields;
}

export type RulesTierShortfall =
  | 'errors'
  | 'needs_clarification'
  | 'too_few_fields'
  | 'no_preference_field';

export interface RulesTierAssessment {
  /** `'rules'` → publish the free answer and never call the model. */
  verdict: 'rules' | 'model';
  recognized: RecognizedField[];
  /** Why the model is being asked; `null` whenever `verdict === 'rules'`. */
  escalatedBecause: RulesTierShortfall | null;
  /**
   * True when the rules answer is published even though it carries errors,
   * because the only reason is a place the dataset does not contain.
   */
  datasetGap: boolean;
}

export function assessRulesTier(
  request: ParsedTripRequest,
  options: RulesTierOptions = {
    minRecognizedFields: getRuntimeConfig().rules.minRecognizedFields,
  },
): RulesTierAssessment {
  const recognized = recognizedFields(request);

  // Data gap: not a comprehension failure, and no model call can fix it. This
  // check comes first on purpose; when a dataset gap appears next to another
  // error, the gap is still the reason the request cannot be answered here.
  if (request.unknownHardConstraints.length > 0) {
    return {
      verdict: 'rules',
      recognized,
      escalatedBecause: null,
      datasetGap: true,
    };
  }

  const shortfall = firstShortfall(request, recognized, options);
  return {
    verdict: shortfall === null ? 'rules' : 'model',
    recognized,
    escalatedBecause: shortfall,
    datasetGap: false,
  };
}

/**
 * Order is the contract: a hard failure or a known-missing field escalates
 * regardless of how many fields were recognised, and the "vague request" checks
 * only apply to requests the parser could otherwise have accepted.
 */
function firstShortfall(
  request: ParsedTripRequest,
  recognized: RecognizedField[],
  options: RulesTierOptions,
): RulesTierShortfall | null {
  if (request.errors.length > 0) return 'errors';
  if (request.needsClarification.length > 0) return 'needs_clarification';
  if (recognized.length < options.minRecognizedFields) return 'too_few_fields';
  return PREFERENCE_FIELDS.some((field) => recognized.includes(field))
    ? null
    : 'no_preference_field';
}

/**
 * The first thing an auto click decides — everything that must happen before a
 * model call is even considered.
 *
 * Pure, because the order is load-bearing and has bitten this page before:
 *
 * 1. the length gate outranks everything — an over-long description is rejected
 *    before any state is touched;
 * 2. a model request already in flight outranks the cache, because answering
 *    from cache here would abort a call that has already been paid for;
 * 3. only then is a cached answer reused;
 * 4. otherwise the caller runs the free rules pass and asks the gate.
 *
 * The forced rules path ignores rule 2 on purpose: it spends nothing, so it
 * must never be told to wait.
 */
export type RulesFirstPlan =
  | { kind: 'input_too_long'; message: string }
  | { kind: 'already_running'; message: string }
  | { kind: 'answer_from_cache'; outcome: CachedInterpretation }
  | { kind: 'run_rules' };

export function planRulesFirstClick(options: {
  rawText: string;
  /** True for the `'auto'` cascade; false for a forced rules pass. */
  wantsModel: boolean;
  alreadyRunning: boolean;
  /** Only ever non-null on the cascade path; look it up by fingerprint. */
  cached: CachedInterpretation | null;
  limits?: LlmLocalLimits;
}): RulesFirstPlan {
  const inputCheck = checkLlmInput(options.rawText, options.limits);
  if (!inputCheck.ok)
    return { kind: 'input_too_long', message: inputCheck.reason.message };

  if (options.wantsModel && options.alreadyRunning)
    return {
      kind: 'already_running',
      message: '已有理解请求正在进行，请稍候。',
    };

  if (options.cached)
    return { kind: 'answer_from_cache', outcome: options.cached };

  return { kind: 'run_rules' };
}
