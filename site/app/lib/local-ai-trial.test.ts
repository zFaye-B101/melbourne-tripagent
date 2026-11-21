import { describe, expect, it } from 'vitest';
import { isLocalAiTrialOrigin, shouldUseLocalAiTrial } from './local-ai-trial';

describe('local AI trial gate', () => {
  it('accepts only the exact localhost origin', () => {
    expect(isLocalAiTrialOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalAiTrialOrigin('https://localhost:3000')).toBe(false);
    expect(isLocalAiTrialOrigin('http://localhost:3001')).toBe(false);
    expect(isLocalAiTrialOrigin('http://127.0.0.1:3000')).toBe(false);
    expect(isLocalAiTrialOrigin('http://localhost:3000/')).toBe(false);
  });

  it('keeps ordinary actions on the rules path without an explicit click', () => {
    expect(
      shouldUseLocalAiTrial({
        origin: 'http://localhost:3000',
        explicitUserClick: false,
      }),
    ).toBe(false);
  });

  it('does not select the remote branch from an unapproved origin', () => {
    expect(
      shouldUseLocalAiTrial({
        origin: 'http://localhost:3001',
        explicitUserClick: true,
      }),
    ).toBe(false);
  });

  it('selects the remote branch only for the explicit local click', () => {
    expect(
      shouldUseLocalAiTrial({
        origin: 'http://localhost:3000',
        explicitUserClick: true,
      }),
    ).toBe(true);
  });
});
