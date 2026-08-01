#!/usr/bin/env node
/**
 * Wait for backend GET /health before starting the frontend.
 * Honors PORT (default 3000), matching backend and dev-preflight.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const waitOn = require('wait-on');

const port = Number(process.env.PORT ?? 3000);
const url = `http-get://127.0.0.1:${port}/health`;
const timeout = Number(process.env.WAIT_BACKEND_TIMEOUT_MS ?? 180_000);

try {
  await waitOn({ resources: [url], timeout });
} catch {
  console.error(
    `[wait-backend-health] Timed out waiting for ${url} (${timeout} ms).`,
  );
  process.exit(1);
}
