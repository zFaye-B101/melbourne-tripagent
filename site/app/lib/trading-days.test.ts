import { describe, expect, it } from 'vitest';

import { auditReplacementOptions, parseTripRequest, planTrip } from './planner';

const QVM = 'mel-cbd-qvm';
const dayOf = (days: { day: number; stops: { poiId: string }[] }[], id: string) =>
  days.find((day) => day.stops.some((stop) => stop.poiId === id))?.day ?? null;

describe('planner respects known non-trading days (Queen Victoria Market)', () => {
  it('blocks a one-day trip whose only day is a non-trading day for a must-visit', () => {
    // 2026-10-05 is a Monday.
    const outcome = planTrip(parseTripRequest('2026-10-05 来墨尔本玩 1 天，必去 Queen Victoria Market。'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('不开市');
  });

  it('moves a must-visit market to a trading day', () => {
    const outcome = planTrip(parseTripRequest('2026-10-05 来墨尔本玩 2 天，必去 Queen Victoria Market，喜欢历史。'));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(dayOf(outcome.result.days, QVM)).toBe(2);
  });

  it('does not schedule the market on a closed day as a filler stop', () => {
    const outcome = planTrip(parseTripRequest('2026-10-07 来墨尔本玩 1 天，喜欢市场和历史。'));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(dayOf(outcome.result.days, QVM)).toBeNull();
  });

  it('keeps previous behaviour when no date is given', () => {
    const outcome = planTrip(parseTripRequest('墨尔本玩 1 天，必去 Queen Victoria Market。'));
    expect(outcome.ok).toBe(true);
  });

  it('does not offer the market as a replacement on a closed day', () => {
    const outcome = planTrip(parseTripRequest('2026-10-05 来墨尔本玩 1 天，喜欢历史。'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const audit = auditReplacementOptions(outcome.result, 0, 0);
    expect(audit.eligible.map((item) => item.poi.id)).not.toContain(QVM);
    expect(audit.ineligible.find((item) => item.poi.id === QVM)?.reasonCode).toBe('closed_on_day');
  });
});
