import { describe, expect, it } from 'vitest';
import { allClobApprovalsGranted, type ApprovalStatus } from './clob-approvals.js';

function granted(overrides: Partial<ApprovalStatus> = {}): ApprovalStatus {
  return {
    pusdToCtf: true,
    pusdToExchange: true,
    pusdToNegRisk: true,
    pusdToAdapter: true,
    ctfToExchange: true,
    ctfToNegRisk: true,
    ctfToAdapter: true,
    ...overrides,
  };
}

describe('allClobApprovalsGranted', () => {
  it('returns true when every V2 + adapter approval is set', () => {
    expect(allClobApprovalsGranted(granted())).toBe(true);
  });

  it('returns false when pUSD → NegRiskAdapter is missing', () => {
    expect(allClobApprovalsGranted(granted({ pusdToAdapter: false }))).toBe(false);
  });

  it('returns false when CTF → NegRiskAdapter is missing', () => {
    expect(allClobApprovalsGranted(granted({ ctfToAdapter: false }))).toBe(false);
  });

  it('returns false when any legacy exchange approval is missing', () => {
    expect(allClobApprovalsGranted(granted({ pusdToExchange: false }))).toBe(false);
    expect(allClobApprovalsGranted(granted({ ctfToNegRisk: false }))).toBe(false);
  });
});
