import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Separate from the unit-test config on purpose: the baseline records
// failures as data, so it must never gate `npm test`.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 60_000,
  },
});
