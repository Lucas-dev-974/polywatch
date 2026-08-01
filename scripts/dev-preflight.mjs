#!/usr/bin/env node
/**
 * Pre-flight check for `npm run dev`.
 * Ensures the backend port is free before starting the full stack.
 * If occupied, distinguishes a healthy running stack from a zombie port.
 */
import { createServer } from 'node:net';

const port = Number(process.env.PORT ?? 3000);
const healthUrl = `http://127.0.0.1:${port}/health`;
const HEALTH_TIMEOUT_MS = 1500;

function canBindPort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => {
      resolve({ ok: false, code: err.code ?? 'UNKNOWN' });
    });
    server.once('listening', () => {
      server.close(() => resolve({ ok: true }));
    });
    server.listen({ port, host: '0.0.0.0' });
  });
}

async function probeHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(healthUrl, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function fail(message) {
  console.error(`[dev-preflight] ${message}`);
  process.exit(1);
}

const bind = await canBindPort();
if (bind.ok) {
  process.exit(0);
}

if (bind.code !== 'EADDRINUSE') {
  fail(
    `Cannot bind port ${port} (${bind.code}). Check firewall or permissions.`,
  );
}

const healthy = await probeHealth();
if (healthy) {
  fail(
    `Port ${port} is already in use by a running Polywatch backend (${healthUrl} OK).\n` +
      'Stop the existing stack (Ctrl+C in its terminal) before running `npm run dev` again.',
  );
}

fail(
  `Port ${port} is occupied but ${healthUrl} did not respond.\n` +
    'Another process may be holding the port. Free it or set PORT to another value.',
);
