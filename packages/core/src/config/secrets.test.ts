import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSecureSecret,
  canEnableRealTrading,
  isInsecureSecret,
  validateProductionSecrets,
} from './secrets.js';

function withBypass<T>(fn: () => T): T {
  process.env.BYPASS_SECRET_SECURITY = 'true';
  try {
    return fn();
  } finally {
    delete process.env.BYPASS_SECRET_SECURITY;
  }
}

afterEach(() => {
  delete process.env.BYPASS_SECRET_SECURITY;
});

describe('isInsecureSecret', () => {
  it('flags known defaults and short values', () => {
    expect(isInsecureSecret('0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isInsecureSecret('dev-service-token-change-in-prod-32')).toBe(true);
    expect(isInsecureSecret('short')).toBe(true);
    expect(isInsecureSecret(undefined)).toBe(true);
  });

  it('accepts random 32+ char secrets', () => {
    expect(isInsecureSecret('a'.repeat(32))).toBe(false);
    expect(isInsecureSecret('f7c2e9b1d4a6083c5e7f9a2b4d6c8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3')).toBe(
      false,
    );
  });
});

describe('assertSecureSecret', () => {
  it('throws in production for insecure values', () => {
    expect(() =>
      assertSecureSecret('JWT_SECRET', 'dev-jwt-secret-change-in-production-32', 'production'),
    ).toThrow(/Insecure default/);
  });

  it('warns but returns in development for insecure values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = assertSecureSecret(
      'SERVICE_TOKEN',
      'dev-service-token-change-in-prod-32',
      'development',
    );
    expect(value).toBe('dev-service-token-change-in-prod-32');
    warn.mockRestore();
  });
});

describe('canEnableRealTrading', () => {
  it('blocks when encryption key or service token is default', () => {
    expect(
      canEnableRealTrading({
        masterEncryptionKey: '0123456789abcdef0123456789abcdef',
        serviceToken: 'real-token-32-chars-long-enough-here',
      }),
    ).toBe(false);
    expect(
      canEnableRealTrading({
        masterEncryptionKey: 'a'.repeat(32),
        serviceToken: 'dev-service-token-change-in-prod-32',
      }),
    ).toBe(false);
  });

  it('allows when both secrets are unique', () => {
    expect(
      canEnableRealTrading({
        masterEncryptionKey: 'a'.repeat(32),
        serviceToken: 'b'.repeat(32),
      }),
    ).toBe(true);
  });

  it('allows insecure secrets when BYPASS_SECRET_SECURITY is set', () => {
    withBypass(() => {
      expect(
        canEnableRealTrading({
          masterEncryptionKey: '0123456789abcdef0123456789abcdef',
          serviceToken: 'dev-service-token-change-in-prod-32',
        }),
      ).toBe(true);
    });
  });
});

describe('validateProductionSecrets', () => {
  it('no-ops in development', () => {
    expect(() =>
      validateProductionSecrets('development', {
        jwtSecret: 'short',
        jwtRefreshSecret: 'short',
        serviceToken: 'short',
        masterEncryptionKey: 'short',
      }),
    ).not.toThrow();
  });

  it('throws in production for any insecure secret', () => {
    expect(() =>
      validateProductionSecrets('production', {
        jwtSecret: 'a'.repeat(32),
        jwtRefreshSecret: 'b'.repeat(32),
        serviceToken: 'c'.repeat(32),
        masterEncryptionKey: '0123456789abcdef0123456789abcdef',
      }),
    ).toThrow();
  });

  it('skips validation when BYPASS_SECRET_SECURITY is set', () => {
    withBypass(() => {
      expect(() =>
        validateProductionSecrets('production', {
          jwtSecret: 'short',
          jwtRefreshSecret: 'short',
          serviceToken: 'short',
          masterEncryptionKey: 'short',
        }),
      ).not.toThrow();
    });
  });
});
