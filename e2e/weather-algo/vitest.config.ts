import { defineConfig } from 'vitest/config';
import { e2eVitestReporters } from '../vitest-reporters.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: e2eVitestReporters(),
  },
});
