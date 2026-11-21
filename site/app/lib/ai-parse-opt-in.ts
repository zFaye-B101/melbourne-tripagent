import { parseEndpoint } from './bff-parse-client';

declare const __TRIP_PARSE_BFF_URL__: string;

/**
 * This is intentionally a public, build-time URL only. It is an address, not
 * an API key. The BFF remains responsible for keeping provider credentials
 * and any cost controls on the server.
 */
export const CONFIGURED_AI_PARSE_BFF_URL =
  typeof __TRIP_PARSE_BFF_URL__ === 'string' ? __TRIP_PARSE_BFF_URL__ : '';

export const LOCAL_AI_TRIAL_ORIGIN = 'http://localhost:3000';
export const LOCAL_AI_TRIAL_ENDPOINT =
  'http://localhost:8787/v1/trip-requests/parse';

export function isLocalAiTrialOrigin(origin: string): boolean {
  return origin === LOCAL_AI_TRIAL_ORIGIN;
}

/**
 * Resolve an endpoint that the browser may display as an optional AI action.
 *
 * Local development keeps its existing loopback endpoint. Any non-local
 * deployment must provide an exact HTTPS Parse API URL at build time; a blank,
 * malformed, or HTTP URL is deliberately treated as not configured.
 */
export function resolveAiParseEndpoint(options: {
  origin: string;
  configuredEndpoint?: string;
}): string | null {
  if (isLocalAiTrialOrigin(options.origin)) return LOCAL_AI_TRIAL_ENDPOINT;

  const endpoint = parseEndpoint(
    options.configuredEndpoint ?? CONFIGURED_AI_PARSE_BFF_URL,
  );
  return endpoint?.startsWith('https://') ? endpoint : null;
}

/**
 * No background or automatic model request is allowed. The caller must carry
 * a click from the current interaction and an endpoint must be configured.
 */
export function aiParseEndpointForExplicitClick(options: {
  origin: string;
  explicitUserClick: boolean;
  configuredEndpoint?: string;
}): string | null {
  if (!options.explicitUserClick) return null;
  return resolveAiParseEndpoint(options);
}

/**
 * `'auto'` — rules first: the deterministic parser answers when its answer is
 * good enough, and the cloud model is asked only when it is not
 * (`interpretation-tier.ts`). This is the current default.
 *
 * `'ai'` — the model is asked on every click, no gate. Kept as the one-line way
 * back to the earlier behaviour for comparison; it costs a call per click.
 *
 * `'rules'` — no model path at all.
 */
export type InterpretationMode = 'rules' | 'auto' | 'ai';

/** Change this one value to switch the whole page's default behaviour. */
export const DEFAULT_INTERPRETATION_MODE: InterpretationMode = 'auto';

/**
 * Which path a *user-initiated* action (the send button or ⌘/Ctrl+Enter)
 * should take by default.
 *
 * The click requirement is unchanged: this only decides which path that click
 * takes, so it still authorises no background or automatic model request.
 * A build with no AI channel at all stays on rules, so a misconfigured deploy
 * degrades to a working page instead of a dead button.
 */
export function defaultInterpretationModeForUserAction(options: {
  origin: string;
  cloudLlmConfigured: boolean;
  configuredEndpoint?: string;
}): InterpretationMode {
  if (DEFAULT_INTERPRETATION_MODE === 'rules') return 'rules';
  return resolveAiParseEndpoint(options) !== null || options.cloudLlmConfigured
    ? DEFAULT_INTERPRETATION_MODE
    : 'rules';
}
