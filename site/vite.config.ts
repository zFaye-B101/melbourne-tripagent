import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type Plugin } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const runtimeSiteRoot = fileURLToPath(new URL('.', import.meta.url));
const runtimeConfigSources: Record<string, string> = {
  'poi.json': resolve(runtimeSiteRoot, 'data/melbourne-pois-v0.1.json'),
  'admission.json': resolve(
    runtimeSiteRoot,
    '../data/verified/poi-admission-price-v0.4.json',
  ),
  'fares.json': resolve(runtimeSiteRoot, 'data/ptv-fares-v0.4.json'),
  'visitor-advice.json': resolve(
    runtimeSiteRoot,
    'data/visitor-advice-v1.json',
  ),
  'rules.json': resolve(runtimeSiteRoot, 'config/rules.v1.json'),
  'prompt.json': resolve(runtimeSiteRoot, 'config/prompt.v2.10.json'),
};

function runtimeManifest(): string {
  const newest = Math.max(
    ...Object.values(runtimeConfigSources).map((file) => statSync(file).mtimeMs),
  );
  return JSON.stringify(
    { version: new Date(newest).toISOString() },
    null,
    2,
  ) + '\n';
}

function runtimeConfigPlugin(): Plugin {
  return {
    name: 'melbourne-runtime-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(
          req.url ?? '/',
          'http://localhost',
        ).pathname;
        const prefix = '/runtime-config/';
        if (!pathname.startsWith(prefix)) return next();
        const name = pathname.slice(prefix.length);
        res.setHeader('cache-control', 'no-store');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        if (name === 'manifest.json') {
          res.end(runtimeManifest());
          return;
        }
        const source = runtimeConfigSources[name];
        if (!source) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'not_found' }));
          return;
        }
        res.end(readFileSync(source));
      });
    },
    generateBundle() {
      for (const [name, source] of Object.entries(runtimeConfigSources))
        this.emitFile({
          type: 'asset',
          fileName: `runtime-config/${name}`,
          source: readFileSync(source),
        });
      this.emitFile({
        type: 'asset',
        fileName: 'runtime-config/manifest.json',
        source: runtimeManifest(),
      });
    },
  };
}

function publicParseEndpoint(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.pathname === '/v1/trip-requests/parse' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      return url.toString();
  } catch {
    // Never echo an invalid value: it could have been a pasted credential.
  }
  throw new Error('Invalid public Parse API URL build configuration.');
}

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    // This public value may contain only the HTTPS Parse API address. Provider
    // keys stay in the BFF's secret store and are never bundled into the site.
    define: {
      __TRIP_PARSE_BFF_URL__: JSON.stringify(
        publicParseEndpoint(process.env.VITE_TRIP_PARSE_BFF_URL),
      ),
    },
    css: { postcss: { plugins: [tailwindcss()] } },
    // Keep hook-using client libraries on vinext's single React instance.
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: { exclude: ['embla-carousel-react'] },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      runtimeConfigPlugin(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
