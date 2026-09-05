import { defineConfig } from 'vitest/config';
import { availableParallelism } from 'node:os';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Each integration worker has its own Vault, watchers and native IO pool.
    // CPU-count parallelism oversubscribes filesystem-heavy tests on Windows.
    // Keep their assertions/timeouts intact; CLI --maxWorkers can override.
    maxWorkers: Math.min(4, availableParallelism()),
  },
});
