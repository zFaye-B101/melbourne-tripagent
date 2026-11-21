import { describe, expect, it } from 'vitest';

import {
  buildPlanProposal,
  canCommitPlanning,
  isProposalCurrent,
  phaseAfterSourceChange,
} from './agent-session';
import { mergeStructuredTripRequest, parseTripRequest } from './planner';

describe('Agent-first plan proposal', () => {
  it('turns parsed text into an inspectable proposal without planning', () => {
    const request = parseTripRequest(
      '墨尔本 3 天，主要在市内，喜欢室外，出发点 CBD，早上 11 点出门',
    );
    const proposal = buildPlanProposal(request, 'draft-a');

    expect(proposal.diagnostics).toEqual({
      attemptedMode: 'rules',
      acceptedMode: 'rules',
      fallbackReasonCode: null,
      draftSchemaVersion: null,
      normalizedRequestVersion: 'parsed-trip-request-v2',
      semanticPolicyVersion: 'trip-semantic-v1',
      promptVersion: null,
    });
    expect(proposal.request.days).toBe(3);
    expect(proposal.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'days', value: '3 天', source: 'user' }),
        expect.objectContaining({ id: 'origin', source: 'user' }),
        expect.objectContaining({ id: 'time', value: '11:00', source: 'user' }),
        expect.objectContaining({
          id: 'venue',
          value: '偏户外',
          source: 'user',
        }),
        expect.objectContaining({
          id: 'area',
          value: '市中心优先',
          source: 'user',
        }),
      ]),
    );
  });

  it('labels assumptions and structured corrections separately', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 2 天'),
      {
        originText: 'Southbank',
        pace: 'relaxed',
        experiencePreferences: { parks_gardens: 'prefer' },
      },
    );
    const proposal = buildPlanProposal(request, 'draft-b');

    expect(proposal.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'origin', source: 'manual' }),
        expect.objectContaining({ id: 'pace', source: 'manual' }),
        expect.objectContaining({ id: 'experiences-manual', source: 'manual' }),
      ]),
    );
    expect(proposal.summary.find((item) => item.id === 'time')).toMatchObject({
      value: '09:30',
      source: 'agent_default',
    });
  });

  it('keeps text and manually added experience sources separate', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 2 天，喜欢历史'),
      { experiencePreferences: { parks_gardens: 'prefer' } },
    );
    const proposal = buildPlanProposal(request, 'mixed-experiences');

    expect(proposal.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'experiences-user',
          value: '历史与遗产',
          source: 'user',
        }),
        expect.objectContaining({
          id: 'experiences-manual',
          value: '公园与花园',
          source: 'manual',
        }),
      ]),
    );
  });

  it('does not relabel a manual preference as user input when the text negates it', () => {
    const request = mergeStructuredTripRequest(
      parseTripRequest('墨尔本玩 2 天，不喜欢历史'),
      { experiencePreferences: { history_heritage: 'prefer' } },
    );
    const proposal = buildPlanProposal(request, 'negated-experience');

    expect(proposal.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'experiences-manual',
          value: '历史与遗产',
          source: 'manual',
        }),
      ]),
    );
    expect(
      proposal.summary.some(
        (item) => item.id === 'experiences-user' && item.value === '历史与遗产',
      ),
    ).toBe(false);
  });

  it('invalidates confirmation as soon as any source condition changes', () => {
    const proposal = buildPlanProposal(parseTripRequest('墨尔本玩 2 天'), 'v1');
    expect(isProposalCurrent(proposal, 'v1')).toBe(true);
    expect(isProposalCurrent(proposal, 'v2')).toBe(false);
    expect(isProposalCurrent(null, 'v1')).toBe(false);
  });

  it('leaves an interrupted interpretation in a resubmittable phase', () => {
    expect(phaseAfterSourceChange(false)).toBe('idle');
    expect(phaseAfterSourceChange(true)).toBe('plan_ready');
  });

  it('lets only the current planning operation commit', () => {
    expect(
      canCommitPlanning({
        revision: 3,
        activeRevision: 3,
        proposalFingerprint: 'B',
        currentFingerprint: 'B',
      }),
    ).toBe(true);
    expect(
      canCommitPlanning({
        revision: 2,
        activeRevision: 3,
        proposalFingerprint: 'A',
        currentFingerprint: 'B',
      }),
    ).toBe(false);
    expect(
      canCommitPlanning({
        revision: 2,
        activeRevision: 3,
        proposalFingerprint: 'A',
        currentFingerprint: 'A',
      }),
    ).toBe(false);
  });

  it('preserves unresolved days for one-question clarification', () => {
    const proposal = buildPlanProposal(
      parseTripRequest('想在墨尔本看历史和花园'),
      'needs-days',
    );
    expect(proposal.request.days).toBeNull();
    expect(proposal.request.needsClarification).toEqual(['days']);
    expect(proposal.summary.find((item) => item.id === 'days')).toMatchObject({
      value: '待确认',
      source: 'needs_confirmation',
    });
  });
});
