import { describe, expect, it } from 'vitest';

import {
  LLM_LOCAL_GUARD_DISCLOSURE,
  LLM_LOCAL_LIMITS,
  checkLlmInput,
  createLlmRequestGuard,
  planAiClick,
} from './llm-local-guard';

const T0 = 1_700_000_000_000;

describe('local LLM input ceiling', () => {
  it('accepts input at the ceiling and returns the normalized text', () => {
    const raw = `  ${'甲'.repeat(LLM_LOCAL_LIMITS.maxInputChars)}  `;
    const result = checkLlmInput(raw);
    expect(result.ok).toBe(true);
    expect(result.ok && result.text.length).toBe(LLM_LOCAL_LIMITS.maxInputChars);
  });

  it('rejects one character past the ceiling without any network call', () => {
    const result = checkLlmInput('甲'.repeat(LLM_LOCAL_LIMITS.maxInputChars + 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.code).toBe('input_too_long');
    expect(result.ok === false && result.reason.actualChars).toBe(
      LLM_LOCAL_LIMITS.maxInputChars + 1,
    );
    expect(result.ok === false && result.reason.message).toContain('2000');
  });

  it('measures the ceiling after normalization, like the pipeline does', () => {
    // Full-width digits normalize to half-width, so NFKC must be applied first.
    const raw = '１'.repeat(LLM_LOCAL_LIMITS.maxInputChars + 1);
    expect(checkLlmInput(raw).ok).toBe(false);
    expect(checkLlmInput(`　${'甲'.repeat(LLM_LOCAL_LIMITS.maxInputChars)}　`).ok).toBe(true);
  });
});

describe('local LLM single-flight and cooldown', () => {
  it('allows one request and rejects a second while it is in flight', () => {
    const guard = createLlmRequestGuard();
    const first = guard.attempt(T0);
    expect(first.allowed).toBe(true);
    expect(guard.isInFlight()).toBe(true);

    const second = guard.attempt(T0 + 1);
    expect(second.allowed).toBe(false);
    expect(second.allowed === false && second.reason.code).toBe('in_flight');
  });

  it('starts the cooldown when the request settles, not when it starts', () => {
    const guard = createLlmRequestGuard({ maxInputChars: 10, cooldownMs: 10_000 });
    const gate = guard.attempt(T0);
    expect(gate.allowed).toBe(true);
    expect(guard.remainingCooldownMs(T0 + 60_000)).toBe(0);

    if (!gate.allowed) throw new Error('expected the first attempt to be allowed');
    gate.release(T0 + 8_000);
    expect(guard.isInFlight()).toBe(false);
    expect(guard.cooldownEndsAt()).toBe(T0 + 18_000);
    expect(guard.remainingCooldownMs(T0 + 8_000)).toBe(10_000);
    expect(guard.remainingCooldownMs(T0 + 17_999)).toBe(1);
    expect(guard.remainingCooldownMs(T0 + 18_000)).toBe(0);
  });

  it('rejects during the cooldown with a retry hint, then allows again', () => {
    const guard = createLlmRequestGuard({ maxInputChars: 10, cooldownMs: 10_000 });
    const gate = guard.attempt(T0);
    if (!gate.allowed) throw new Error('expected the first attempt to be allowed');
    gate.release(T0);

    const blocked = guard.attempt(T0 + 4_000);
    expect(blocked.allowed).toBe(false);
    if (blocked.allowed) throw new Error('expected the cooldown to block');
    expect(blocked.reason.code).toBe('cooldown');
    if (blocked.reason.code !== 'cooldown') throw new Error('expected a cooldown reason');
    expect(blocked.reason.retryAfterMs).toBe(6_000);
    expect(blocked.reason.message).toContain('6 秒');

    const later = guard.attempt(T0 + 10_000);
    expect(later.allowed).toBe(true);
  });

  it('does not extend the cooldown when a rejected attempt happens', () => {
    const guard = createLlmRequestGuard({ maxInputChars: 10, cooldownMs: 10_000 });
    const gate = guard.attempt(T0);
    if (!gate.allowed) throw new Error('expected the first attempt to be allowed');
    gate.release(T0);

    guard.attempt(T0 + 1_000);
    guard.attempt(T0 + 2_000);
    expect(guard.cooldownEndsAt()).toBe(T0 + 10_000);
  });

  it('ignores a second release so an aborted and a completed run cannot double-count', () => {
    const guard = createLlmRequestGuard({ maxInputChars: 10, cooldownMs: 10_000 });
    const gate = guard.attempt(T0);
    if (!gate.allowed) throw new Error('expected the first attempt to be allowed');
    gate.release(T0 + 5_000);
    gate.release(T0 + 9_000);
    expect(guard.cooldownEndsAt()).toBe(T0 + 15_000);
  });

  it('reports no cooldown end while a request is still in flight', () => {
    const guard = createLlmRequestGuard();
    const gate = guard.attempt(T0);
    expect(gate.allowed).toBe(true);
    expect(guard.cooldownEndsAt()).toBe(0);
  });

  it('never retries on its own: a fresh guard only acts when asked', () => {
    const guard = createLlmRequestGuard();
    expect(guard.isInFlight()).toBe(false);
    expect(guard.remainingCooldownMs(T0)).toBe(0);
    expect(guard.cooldownEndsAt()).toBe(0);
  });
});

describe('local guard disclosure', () => {
  it('states that the page guards cannot stop a script', () => {
    expect(LLM_LOCAL_GUARD_DISCLOSURE).toContain('不能阻止脚本直接调用云端接口');
    expect(LLM_LOCAL_GUARD_DISCLOSURE).toContain('只作用于本页面');
  });
});

describe('AI click plan', () => {
  const limits = { maxInputChars: 10, cooldownMs: 10_000 };

  it('rejects an over-long description before the slot is taken', () => {
    const guard = createLlmRequestGuard(limits);
    const plan = planAiClick({
      rawText: '甲'.repeat(11),
      alreadyRunning: false,
      guard,
      now: T0,
      limits,
    });
    expect(plan.kind).toBe('input_too_long');
    // The slot must still be free, so a corrected retry is not punished.
    expect(guard.isInFlight()).toBe(false);
    expect(guard.remainingCooldownMs(T0)).toBe(0);
  });

  it('checks the running state before taking the slot, so an early return cannot strand it', () => {
    const guard = createLlmRequestGuard(limits);
    const plan = planAiClick({
      rawText: '墨尔本 2 天',
      alreadyRunning: true,
      guard,
      now: T0,
      limits,
    });
    expect(plan.kind).toBe('already_running');
    expect(guard.isInFlight()).toBe(false);

    // The very next click must still be able to reach the model.
    const next = planAiClick({
      rawText: '墨尔本 2 天',
      alreadyRunning: false,
      guard,
      now: T0 + 1,
      limits,
    });
    expect(next.kind).toBe('proceed');
    expect(next.kind === 'proceed' && next.modelAllowed).toBe(true);
  });

  it('hands the slot back only when the click acquired it', () => {
    const guard = createLlmRequestGuard(limits);
    const first = planAiClick({
      rawText: '墨尔本 2 天',
      alreadyRunning: false,
      guard,
      now: T0,
      limits,
    });
    expect(first.kind === 'proceed' && first.release !== null).toBe(true);
    if (first.kind !== 'proceed' || first.release === null) throw new Error('expected a slot');
    first.release(T0);

    const duringCooldown = planAiClick({
      rawText: '墨尔本 2 天',
      alreadyRunning: false,
      guard,
      now: T0 + 1_000,
      limits,
    });
    expect(duringCooldown.kind).toBe('proceed');
    if (duringCooldown.kind !== 'proceed') throw new Error('expected proceed');
    expect(duringCooldown.modelAllowed).toBe(false);
    expect(duringCooldown.release).toBeNull();
    expect(duringCooldown.notice).toContain('9 秒');
    expect(guard.remainingCooldownMs(T0 + 1_000)).toBe(9_000);
  });
});
