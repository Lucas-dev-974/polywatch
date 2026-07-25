import { defineConfig } from 'vitest/config';
import { e2eVitestReporters } from '../../e2e/vitest-reporters.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: e2eVitestReporters(),
  },
});
