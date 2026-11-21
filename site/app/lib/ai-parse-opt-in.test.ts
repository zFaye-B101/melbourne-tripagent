import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INTERPRETATION_MODE,
  LOCAL_AI_TRIAL_ENDPOINT,
  aiParseEndpointForExplicitClick,
  defaultInterpretationModeForUserAction,
  resolveAiParseEndpoint,
} from './ai-parse-opt-in';

const HTTPS_BFF = 'https://trip-bff.example/v1/trip-requests/parse';
const DEPLOYED_ORIGIN = 'https://melbourne-tripagent.app.workbuddy.host';

describe('AI Parse explicit opt-in gate', () => {
  it('keeps a deployed page on the rules path when no HTTPS BFF is configured', () => {
    expect(
      resolveAiParseEndpoint({
        origin: 'https://melbourne-tripagent.app.workbuddy.host',
        configuredEndpoint: '',
      }),
    ).toBeNull();
    expect(
      aiParseEndpointForExplicitClick({
        origin: 'https://melbourne-tripagent.app.workbuddy.host',
        configuredEndpoint: '',
        explicitUserClick: true,
      }),
    ).toBeNull();
  });

  it('does not authorize a network request before the current user click', () => {
    expect(
      aiParseEndpointForExplicitClick({
        origin: 'https://melbourne-tripagent.app.workbuddy.host',
        configuredEndpoint: HTTPS_BFF,
        explicitUserClick: false,
      }),
    ).toBeNull();
  });

  it('permits only an explicit click to use the configured HTTPS Parse API', () => {
    expect(
      aiParseEndpointForExplicitClick({
        origin: 'https://melbourne-tripagent.app.workbuddy.host',
        configuredEndpoint: HTTPS_BFF,
        explicitUserClick: true,
      }),
    ).toBe(HTTPS_BFF);
  });

  it('retains the local loopback trial without exposing it to deployed origins', () => {
    expect(
      resolveAiParseEndpoint({
        origin: 'http://localhost:3000',
        configuredEndpoint: '',
      }),
    ).toBe(LOCAL_AI_TRIAL_ENDPOINT);
    expect(
      resolveAiParseEndpoint({
        origin: 'https://melbourne-tripagent.app.workbuddy.host',
        configuredEndpoint: 'http://localhost:8787/v1/trip-requests/parse',
      }),
    ).toBeNull();
  });
});

describe('default understanding mode for a user action', () => {
  it('declares the rules-first cascade as the temporary default', () => {
    expect(DEFAULT_INTERPRETATION_MODE).toBe('auto');
  });

  it('uses the cascade on the deployed page even with no Parse BFF configured', () => {
    expect(
      defaultInterpretationModeForUserAction({
        origin: DEPLOYED_ORIGIN,
        configuredEndpoint: '',
        cloudLlmConfigured: true,
      }),
    ).toBe('auto');
  });

  it('uses the Parse BFF when it is configured, with or without the cloud channel', () => {
    expect(
      defaultInterpretationModeForUserAction({
        origin: DEPLOYED_ORIGIN,
        configuredEndpoint: HTTPS_BFF,
        cloudLlmConfigured: false,
      }),
    ).toBe('auto');
  });

  it('stays on rules when this build has no AI channel at all', () => {
    expect(
      defaultInterpretationModeForUserAction({
        origin: DEPLOYED_ORIGIN,
        configuredEndpoint: '',
        cloudLlmConfigured: false,
      }),
    ).toBe('rules');
  });

  it('refuses a non-HTTPS endpoint on a deployed origin', () => {
    expect(
      defaultInterpretationModeForUserAction({
        origin: DEPLOYED_ORIGIN,
        configuredEndpoint: 'http://localhost:8787/v1/trip-requests/parse',
        cloudLlmConfigured: false,
      }),
    ).toBe('rules');
  });

  it('lets the loopback trial default to the cascade path', () => {
    expect(
      defaultInterpretationModeForUserAction({
        origin: 'http://localhost:3000',
        configuredEndpoint: '',
        cloudLlmConfigured: false,
      }),
    ).toBe('auto');
  });

  it('never turns the default into a background request: the click gate still holds', () => {
    expect(
      aiParseEndpointForExplicitClick({
        origin: DEPLOYED_ORIGIN,
        configuredEndpoint: HTTPS_BFF,
        explicitUserClick: false,
      }),
    ).toBeNull();
  });
});
