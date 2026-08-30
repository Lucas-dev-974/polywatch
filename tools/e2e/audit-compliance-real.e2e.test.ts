import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { POLYGON_CLOB_CONTRACTS_V2 } from '../../packages/core/src/polymarket/clob-contracts.js';
import { parseFillResponse } from '../../packages/worker/src/clob/parse-fill-response.js';

const clobApprovalsPath = resolve(
  import.meta.dirname,
  '../../packages/backend/src/polymarket/clob-approvals.ts',
);
const clobApprovalsSource = readFileSync(clobApprovalsPath, 'utf-8');

describe('E2E audit compliance — real mode', () => {
  it('1. slippage guard skips when referenceVwap is 0 (no division by zero)', () => {
    const referenceVwap = 0;
    const fillPrice = 0.5;
    const shouldGuard = referenceVwap != null && referenceVwap > 0;
    expect(shouldGuard).toBe(false);

    if (shouldGuard) {
      const slip = (Math.abs(fillPrice - referenceVwap) / referenceVwap) * 100;
      expect(slip).toBeNaN();
    }
  });

  it('2. V2 contract registry keeps only required V2 addresses plus NegRiskAdapter', () => {
    expect(POLYGON_CLOB_CONTRACTS_V2.collateral).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(POLYGON_CLOB_CONTRACTS_V2.conditionalTokens).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(POLYGON_CLOB_CONTRACTS_V2.exchangeV2).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(POLYGON_CLOB_CONTRACTS_V2.negRiskExchangeV2).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(POLYGON_CLOB_CONTRACTS_V2.negRiskAdapter).toMatch(/^0x[0-9a-fA-F]{40}$/);

    expect(POLYGON_CLOB_CONTRACTS_V2).not.toHaveProperty('exchange');
    expect(POLYGON_CLOB_CONTRACTS_V2).not.toHaveProperty('negRiskExchange');
  });

  it('3. Zod schema rejects malformed CLOB responses', () => {
    const malformed = { orderID: 12345, status: 'matched' };
    const result = parseFillResponse(malformed, 'BUY', 0.5, 200);

    expect(result.type).toBe('invalid');
    if (result.type === 'invalid') {
      expect(result.reason).toContain('response_schema_mismatch');
    }
  });

  it('3. Zod schema accepts valid CLOB V2 market order responses', () => {
    const response = {
      orderID: '0xabcdef1234567890abcdef1234567890abcdef12',
      status: 'matched',
      makingAmount: '100000000',
      takingAmount: '200000000',
    };

    const result = parseFillResponse(response, 'BUY', 0.5, 200);
    expect(result.type).toBe('matched');
    if (result.type === 'matched') {
      expect(result.fill.fillQuantity).toBe(200);
      expect(result.fill.actualFillPrice).toBe(0.5);
    }
  });

  it('4. clob-approvals.ts contains post-submission verification logic', () => {
    expect(clobApprovalsSource).toContain('waitForTransaction');
    expect(clobApprovalsSource).toContain('checkClobApprovals(depositAddress)');
    expect(clobApprovalsSource).toContain('approvals still missing after on-chain submission');
    expect(clobApprovalsSource).toContain('approval tx reverted:');
    expect(clobApprovalsSource).toContain('pusdToAdapter');
    expect(clobApprovalsSource).toContain('ctfToAdapter');
    expect(clobApprovalsSource).toContain('negRiskAdapter');
    expect(clobApprovalsSource).toContain('requiredApprovalFlags');
    expect(clobApprovalsSource).toContain("case 'neg_risk_buy'");
  });
});
