import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isClobBook404,
  logBookFetchFailure,
  LOG_BOOK_404_ERRORS_KEY,
} from './book-error-log.js';

describe('isClobBook404', () => {
  it('detects CLOB book 404 errors', () => {
    expect(isClobBook404(new Error('CLOB book error: 404'))).toBe(true);
    expect(isClobBook404(new Error('CLOB book error: 500'))).toBe(false);
    expect(isClobBook404(new Error('network down'))).toBe(false);
  });
});

describe('logBookFetchFailure', () => {
  const warn = vi.fn();
  const log = { warn } as unknown as import('pino').Logger;

  beforeEach(() => {
    warn.mockReset();
  });

  it('suppresses 404 warnings when config service is not initialized (default false)', async () => {
    await logBookFetchFailure(
      log,
      new Error('CLOB book error: 404'),
      'asset-1',
      'sell book REST fallback failed (depth)',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('always logs non-404 failures', async () => {
    await logBookFetchFailure(
      log,
      new Error('CLOB book error: 500'),
      'asset-1',
      'book refresh failed',
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[1]).toBe('book refresh failed');
  });
});

describe('LOG_BOOK_404_ERRORS_KEY', () => {
  it('matches system_config seed key', () => {
    expect(LOG_BOOK_404_ERRORS_KEY).toBe('worker.log.book_404_errors');
  });
});
