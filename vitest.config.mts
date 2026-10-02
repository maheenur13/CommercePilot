import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (not esbuild) so Nest's decorator metadata is emitted for DI.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: { name: 'unit', include: ['tests/unit/**/*.spec.ts'], environment: 'node' },
      },
      {
        plugins,
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.spec.ts'],
          environment: 'node',
          globalSetup: ['tests/e2e/global-setup.ts'],
          setupFiles: ['tests/e2e/setup.ts'],
          fileParallelism: false,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
