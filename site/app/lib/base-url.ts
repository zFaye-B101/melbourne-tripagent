/// <reference types="vite/client" />

/**
 * Build-time base path for static deployments.
 *
 * GitHub Pages project sites are served under `/<repo>/`, while WorkBuddy and
 * local builds use `/`. Vite injects `BASE_URL`; every public asset that is
 * written as a root-absolute path in source must go through `assetUrl`.
 */
const configuredBase = import.meta.env?.BASE_URL ?? '/';

export const BASE_URL = configuredBase.endsWith('/')
  ? configuredBase
  : `${configuredBase}/`;

export function assetUrl(path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${BASE_URL}${path.replace(/^\/+/, '')}`;
}
