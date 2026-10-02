import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Opt-in live-model evals (`pnpm test:eval`). Kept out of `pnpm test` so CI never calls a model.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'eval',
    include: ['tests/evals/**/*.eval.spec.ts'],
    environment: 'node',
    globalSetup: ['tests/e2e/global-setup.ts'],
    setupFiles: ['tests/evals/setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
