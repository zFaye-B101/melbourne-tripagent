/**
 * Per-page mis-tap guards for the public cloud-LLM click.
 *
 * What these are NOT
 * ------------------
 * The `publishableKey` ships inside the published bundle and the cloud channel
 * answers a script that sends no `Origin` at all, so anything computed in the
 * page is advisory by construction. A browser-side counter cannot express
 * "30 calls per day for the app" or "5 calls per 10 minutes per IP" either: it
 * is per-browser, resettable by clearing storage, and it never sees another
 * visitor. These guards only reduce accidental repeat spend from the real page
 * (double taps, a slow click loop, an over-long paste). Defending the endpoint
 * itself requires a trusted server in front of the model and closing the
 * directly-callable anonymous channel — neither of which this app has.
 *
 * What these are
 * --------------
 * Three deterministic, testable rules applied *before* the model call:
 *
 * 1. Input length ceiling, matching the contract that already governs this
 *    path (`nlu-orchestrator.ts` truncates at 2 000, the draft runtime rejects
 *    > 2 000, the BFF client rejects > 2 000). Reusing that number means no new
 *    contract is introduced.
 * 2. Single flight — at most one in-flight model request per page instance.
 * 3. Settle cooldown — after a request settles, the next model call waits.
 *
 * There is deliberately no retry helper anywhere in this module. The cloud SDK
 * does not auto-retry its streaming call path either (its bundled retry
 * machinery belongs to the database client), so a failure here surfaces once
 * and falls back to the rules path.
 */

/** Local ceilings. Chosen to reuse existing contracts, not to be a security bar. */
export const LLM_LOCAL_LIMITS = {
  /**
   * Same ceiling the deterministic pipeline already enforces end to end, so a
   * rejection here cannot disagree with the downstream validator.
   */
  maxInputChars: 2_000,
  /**
   * Wait after a request settles before the next model call. One measured
   * extraction takes 6–8 s, so a human who reads the result needs more than
   * this; only a repeated click loop is affected.
   */
  cooldownMs: 10_000,
} as const;

export interface LlmLocalLimits {
  maxInputChars: number;
  cooldownMs: number;
}

/** Rejection raised before any network call, with user-facing copy. */
export type LlmGuardRejection =
  | {
      code: 'input_too_long';
      maxInputChars: number;
      actualChars: number;
      message: string;
    }
  | { code: 'in_flight'; message: string }
  | { code: 'cooldown'; retryAfterMs: number; message: string };

export type LlmInputCheck =
  | { ok: true; text: string }
  | { ok: false; reason: Extract<LlmGuardRejection, { code: 'input_too_long' }> };

/**
 * Length gate. Normalizes the same way the pipeline does (NFKC + trim) so the
 * character count matches what the downstream validator will see.
 */
export function checkLlmInput(
  rawText: string,
  limits: LlmLocalLimits = LLM_LOCAL_LIMITS,
): LlmInputCheck {
  const text = rawText.normalize('NFKC').trim();
  if (text.length > limits.maxInputChars) {
    return {
      ok: false,
      reason: {
        code: 'input_too_long',
        maxInputChars: limits.maxInputChars,
        actualChars: text.length,
        message: `旅行描述超过 ${limits.maxInputChars} 字符（当前 ${text.length}），已改为基础理解；请精简后再试 AI 辅助理解。`,
      },
    };
  }
  return { ok: true, text };
}

export type LlmGuardDecision =
  | { allowed: true; release: (now?: number) => void }
  | { allowed: false; reason: LlmGuardRejection };

export interface LlmRequestGuard {
  /** Single-flight + cooldown gate. Call immediately before the model call. */
  attempt(now?: number): LlmGuardDecision;
  /** Milliseconds left in the settle cooldown; 0 when a call may proceed. */
  remainingCooldownMs(now?: number): number;
  /** Timestamp the current cooldown expires at; 0 when there is none. */
  cooldownEndsAt(): number;
  isInFlight(): boolean;
}

/**
 * Build a guard for one page instance.
 *
 * The clock is injectable so the ordering rules are testable without timers.
 * `release` is idempotent: an aborted request and a completed one both settle
 * exactly once, and a double release must not extend the cooldown.
 */
export function createLlmRequestGuard(
  limits: LlmLocalLimits = LLM_LOCAL_LIMITS,
): LlmRequestGuard {
  let inFlight = false;
  let cooldownEndsAt = 0;

  return {
    attempt(now = Date.now()): LlmGuardDecision {
      if (inFlight) {
        return {
          allowed: false,
          reason: {
            code: 'in_flight',
            message: '已有理解请求正在进行，请稍候。',
          },
        };
      }
      const remaining = Math.max(0, cooldownEndsAt - now);
      if (remaining > 0) {
        const seconds = Math.ceil(remaining / 1_000);
        return {
          allowed: false,
          reason: {
            code: 'cooldown',
            retryAfterMs: remaining,
            message: `AI 辅助理解刚刚用过，还需 ${seconds} 秒才能再次使用；这次已改用基础理解。`,
          },
        };
      }
      inFlight = true;
      let settled = false;
      return {
        allowed: true,
        release: (settledAt = Date.now()) => {
          if (settled) return;
          settled = true;
          inFlight = false;
          cooldownEndsAt = settledAt + limits.cooldownMs;
        },
      };
    },

    remainingCooldownMs(now = Date.now()): number {
      return Math.max(0, cooldownEndsAt - now);
    },

    cooldownEndsAt(): number {
      return inFlight ? 0 : cooldownEndsAt;
    },

    isInFlight(): boolean {
      return inFlight;
    },
  };
}

/**
 * Outcome of one AI action, decided entirely before anything is sent.
 *
 * `kind: 'proceed'` with `modelAllowed: false` is the cooldown case: the caller
 * must not reach the model, but should still answer, so it is not a dead end.
 */
export type AiClickPlan =
  | { kind: 'input_too_long'; message: string }
  | { kind: 'already_running'; message: string }
  | {
      kind: 'proceed';
      /** Non-null only when this click acquired the single-flight slot. */
      release: ((now?: number) => void) | null;
      modelAllowed: boolean;
      notice: string;
    };

/**
 * Decide one AI action, in the order that keeps the single-flight slot safe.
 *
 * The order itself is the contract: the length gate and the "an interpretation
 * is already running" check must both come *before* the slot is taken, or an
 * early return would strand the slot and block every later click. That hazard is
 * why this is a pure function instead of inline code — it can be tested.
 */
export function planAiClick(options: {
  rawText: string;
  /**
   * True when any interpretation (rules or AI) is already in flight. Rules runs
   * are free and instant, but a second model call must never overlap one.
   */
  alreadyRunning: boolean;
  guard: LlmRequestGuard;
  now?: number;
  limits?: LlmLocalLimits;
}): AiClickPlan {
  const inputCheck = checkLlmInput(options.rawText, options.limits);
  if (!inputCheck.ok)
    return { kind: 'input_too_long', message: inputCheck.reason.message };

  if (options.alreadyRunning)
    return {
      kind: 'already_running',
      message: '已有理解请求正在进行，请稍候。',
    };

  const decision = options.guard.attempt(options.now);
  if (decision.allowed)
    return {
      kind: 'proceed',
      release: decision.release,
      modelAllowed: true,
      notice: '',
    };

  if (decision.reason.code === 'in_flight')
    return { kind: 'already_running', message: decision.reason.message };

  return {
    kind: 'proceed',
    release: null,
    modelAllowed: false,
    notice: decision.reason.message,
  };
}

/**
 * Disclosure shown next to the AI action. Kept here so the wording is covered
 * by the same tests as the behaviour it describes — the page must not imply
 * that these guards protect the endpoint.
 */
export const LLM_LOCAL_GUARD_DISCLOSURE =
  '页面内只做误触防护：同一时间只跑一个请求、连点冷却 10 秒、描述上限 2000 字符。这些只作用于本页面，不能阻止脚本直接调用云端接口。';
