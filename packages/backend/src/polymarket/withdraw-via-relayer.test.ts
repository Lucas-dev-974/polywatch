import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClobCredentials } from '@polywatch/core';

const redisStore = new Map<string, string>();
let setCallCount = 0;

const redisMock = {
  set: vi.fn(
    async (key: string, value: string, ...args: unknown[]): Promise<string | null> => {
      setCallCount += 1;
      const isNx = args.includes('NX');
      if (isNx && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return 'OK';
    },
  ),
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  del: vi.fn(async (key: string) => {
    redisStore.delete(key);
    return 1;
  }),
};

const executeMock = vi.fn();

vi.mock('../redis.js', () => ({
  getRedis: () => redisMock,
}));

vi.mock('../crypto/encryption.js', () => ({
  decrypt: vi.fn(() => '0x' + '11'.repeat(32)),
}));

vi.mock('./wallet-validation.js', () => ({
  assertRelayerWithdrawReady: vi.fn(),
}));

vi.mock('./clob-creds.js', () => ({
  getBuilderCreds: vi.fn(() => ({
    key: 'builder-key',
    secret: 'builder-secret',
    passphrase: 'builder-pass',
  })),
  resolveRelayerUrl: vi.fn(() => 'https://relayer.test'),
}));

vi.mock('./polygon.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./polygon.js')>();
  return {
    ...actual,
    createPolygonProvider: vi.fn(() => ({
      getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1 }),
    })),
  };
});

vi.mock('@polymarket/builder-relayer-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@polymarket/builder-relayer-client')>();
  return {
    ...actual,
    RelayClient: vi.fn().mockImplementation(() => ({
      execute: executeMock,
      executeDepositWalletBatch: executeMock,
    })),
  };
});

import { assertRelayerWithdrawReady } from './wallet-validation.js';
import { withdrawViaRelayer } from './relayer-client.js';

const creds = {
  signerPkEnc: 'enc:signer',
  builderApiKey: 'key',
  builderSecret: 'secret',
  builderPassphrase: 'pass',
} as ClobCredentials;

const WITHDRAW_PARAMS = {
  depositAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  recipientAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  amount: 10,
  mode: 'proxy' as const,
  asset: 'pusd' as const,
};

function mockRelayerSuccess(hash = '0xabc123') {
  executeMock.mockResolvedValue({
    wait: vi.fn().mockResolvedValue({ transactionHash: hash }),
    transactionHash: hash,
    hash,
  });
}

describe('withdrawViaRelayer idempotence', () => {
  beforeEach(() => {
    redisStore.clear();
    setCallCount = 0;
    vi.clearAllMocks();
    vi.mocked(assertRelayerWithdrawReady).mockResolvedValue(undefined);
    mockRelayerSuccess();
  });

  it('clears reservation when preflight fails (R1)', async () => {
    vi.mocked(assertRelayerWithdrawReady).mockRejectedValue(
      new Error('insufficient_balance'),
    );

    await expect(withdrawViaRelayer(creds, ...Object.values(WITHDRAW_PARAMS))).rejects.toThrow(
      'insufficient_balance',
    );

    expect(redisStore.size).toBe(0);
  });

  it('clears reservation when execute fails before tx hash (R1)', async () => {
    executeMock.mockRejectedValue(new Error('relayer_tx_failed'));

    await expect(withdrawViaRelayer(creds, ...Object.values(WITHDRAW_PARAMS))).rejects.toThrow(
      'relayer_tx_failed',
    );

    expect(redisStore.size).toBe(0);
  });

  it('returns tx hash when markCompleted fails after on-chain success (R2 / Q3=a)', async () => {
    redisMock.set.mockImplementation(
      async (key: string, value: string, ...args: unknown[]) => {
        setCallCount += 1;
        const isNx = args.includes('NX');
        // First call: reserve. Second call: markCompleted — simulate Redis failure.
        if (!isNx && setCallCount === 2) {
          throw new Error('redis_down');
        }
        if (isNx && redisStore.has(key)) return null;
        redisStore.set(key, value);
        return 'OK';
      },
    );

    const hash = await withdrawViaRelayer(creds, ...Object.values(WITHDRAW_PARAMS));

    expect(hash).toBe('0xabc123');
    expect(executeMock).toHaveBeenCalled();
  });
});
