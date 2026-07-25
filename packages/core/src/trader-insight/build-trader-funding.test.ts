import { describe, expect, it } from 'vitest';
import {
  COLLATERAL_ONRAMP_ADDRESS,
  COLLATERAL_OFFRAMP_ADDRESS,
} from '../polymarket/trading-wallet.js';
import { POLYGON_CLOB_CONTRACTS_V2 } from '../polymarket/clob-contracts.js';
import { buildPolymarketInternalContracts } from '../polymarket/collateral-tokens.js';
import {
  buildTraderFundingAnalysis,
  classifyTokenTransfer,
  type TokenTransferInput,
} from './build-trader-funding.js';

const PROXY = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const EOA = '0x1111111111111111111111111111111111111111';
const EXTERNAL = '0x2222222222222222222222222222222222222222';
const EXCHANGE = POLYGON_CLOB_CONTRACTS_V2.exchangeV2;

function transfer(
  partial: Partial<TokenTransferInput> & Pick<TokenTransferInput, 'from' | 'to'>,
): TokenTransferInput {
  return {
    token: 'USDC.e',
    valueUsdc: 100,
    timestamp: 1_700_000_000,
    txHash: '0xabc',
    ...partial,
  };
}

describe('classifyTokenTransfer', () => {
  const internal = buildPolymarketInternalContracts();
  const watched = [PROXY, EOA];

  it('counts external USDC inflow as deposit', () => {
    const row = classifyTokenTransfer(
      transfer({ from: EXTERNAL, to: PROXY }),
      watched,
      internal,
    );
    expect(row?.direction).toBe('deposit');
    expect(row?.valueUsdc).toBe(100);
  });

  it('counts external USDC outflow as withdrawal', () => {
    const row = classifyTokenTransfer(
      transfer({ from: PROXY, to: EXTERNAL }),
      watched,
      internal,
    );
    expect(row?.direction).toBe('withdrawal');
  });

  it('ignores transfers between watched addresses', () => {
    const row = classifyTokenTransfer(
      transfer({ from: EOA, to: PROXY }),
      watched,
      internal,
    );
    expect(row).toBeNull();
  });

  it('ignores exchange flows', () => {
    const row = classifyTokenTransfer(
      transfer({ from: PROXY, to: EXCHANGE }),
      watched,
      internal,
    );
    expect(row).toBeNull();
  });

  it('counts pUSD from onramp as deposit', () => {
    const row = classifyTokenTransfer(
      transfer({
        token: 'pUSD',
        from: COLLATERAL_ONRAMP_ADDRESS,
        to: PROXY,
      }),
      watched,
      internal,
    );
    expect(row?.direction).toBe('deposit');
  });

  it('counts pUSD to offramp as withdrawal', () => {
    const row = classifyTokenTransfer(
      transfer({
        token: 'pUSD',
        from: PROXY,
        to: COLLATERAL_OFFRAMP_ADDRESS,
      }),
      watched,
      internal,
    );
    expect(row?.direction).toBe('withdrawal');
  });
});

describe('buildTraderFundingAnalysis', () => {
  const internal = buildPolymarketInternalContracts();

  it('aggregates deposits and withdrawals', () => {
    const analysis = buildTraderFundingAnalysis(
      [
        transfer({ from: EXTERNAL, to: PROXY, valueUsdc: 500, timestamp: 100 }),
        transfer({ from: PROXY, to: EXTERNAL, valueUsdc: 200, timestamp: 200 }),
      ],
      [PROXY],
      internal,
    );

    expect(analysis.summary.totalDepositedUsdc).toBe(500);
    expect(analysis.summary.totalWithdrawnUsdc).toBe(200);
    expect(analysis.summary.netDepositedUsdc).toBe(300);
    expect(analysis.summary.depositCount).toBe(1);
    expect(analysis.recentTransfers).toHaveLength(2);
    expect(analysis.coverage.classifiedTransferCount).toBe(2);
    expect(analysis.coverage.rawTransferCount).toBe(2);
  });
});
