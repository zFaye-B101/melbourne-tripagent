import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from '../site/node_modules/esbuild/lib/main.js';

const site = resolve(import.meta.dirname, '../site');
const output = resolve(site, 'dist/tencent-scf');
await mkdir(output, { recursive: true });
await build({
  entryPoints: [resolve(site, 'bff/tencent-scf/index.ts')],
  outfile: resolve(output, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['@cloudbase/node-sdk'],
  logLevel: 'info',
});
await copyFile(
  resolve(site, 'bff/tencent-scf/deployment.package.json'),
  resolve(output, 'package.json'),
);
