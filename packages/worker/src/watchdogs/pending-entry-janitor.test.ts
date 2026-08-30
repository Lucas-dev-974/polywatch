import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PENDING_ENTRY_JANITOR_QUEUE,
  PENDING_WEATHER_ENTRY_JANITOR_QUEUE,
  queueForPendingEntryReason,
} from './pending-entry-janitor.js';
import { WORKER_QUEUES } from '@polywatch/core';

describe('pending-entry janitor routing', () => {
  it('routes ALGO_OPEN to the algo order queue', () => {
    expect(queueForPendingEntryReason('ALGO_OPEN')).toBe('algo');
    expect(PENDING_ENTRY_JANITOR_QUEUE).toBe(WORKER_QUEUES.ALGO_ORDER_SIGNALS);
  });

  it('routes WEATHER_OPEN to the weather order queue', () => {
    expect(queueForPendingEntryReason('WEATHER_OPEN')).toBe('weather');
    expect(PENDING_WEATHER_ENTRY_JANITOR_QUEUE).toBe(
      WORKER_QUEUES.WEATHER_ORDER_SIGNALS,
    );
  });

  it('ignores other reasons', () => {
    expect(queueForPendingEntryReason('COPY_OPEN')).toBeNull();
  });

  it('does not abandon in-flight weather pending (releaseOnSkip false)', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'pending-entry-janitor.ts'),
      'utf8',
    );
    expect(src).toContain('releaseOnSkip: false');
  });
});