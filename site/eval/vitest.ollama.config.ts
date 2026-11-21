import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// 本地 Ollama 评测：只在开发者电脑上手动运行，不属于 npm test。
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['eval/ollama.local-eval.ts'],
    testTimeout: 0,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
