import { describe, expect, it } from 'vitest';
import { POLYGON_CLOB_CONTRACTS_V2 } from '@polywatch/core';
import {
  allClobApprovalsGranted,
  buildMissingApprovalCalls,
  requiredApprovalFlags,
  resolveClobOrderKind,
  type ApprovalFlag,
  type ApprovalStatus,
} from './clob-approvals.js';

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

function noneGranted(overrides: Partial<ApprovalStatus> = {}): ApprovalStatus {
  return {
    pusdToCtf: false,
    pusdToExchange: false,
    pusdToNegRisk: false,
    pusdToAdapter: false,
    ctfToExchange: false,
    ctfToNegRisk: false,
    ctfToAdapter: false,
    ...overrides,
  };
}

describe('resolveClobOrderKind', () => {
  it('maps standard BUY/SELL and neg-risk BUY/SELL', () => {
    expect(resolveClobOrderKind({ negRisk: false, side: 'BUY' })).toBe('standard_buy');
    expect(resolveClobOrderKind({ negRisk: false, side: 'SELL' })).toBe('standard_sell');
    expect(resolveClobOrderKind({ negRisk: true, side: 'BUY' })).toBe('neg_risk_buy');
    expect(resolveClobOrderKind({ negRisk: true, side: 'SELL' })).toBe('neg_risk_sell');
  });
});

describe('requiredApprovalFlags', () => {
  it('standard BUY needs only pUSD → Exchange V2', () => {
    expect(requiredApprovalFlags('standard_buy')).toEqual(['pusdToExchange']);
  });

  it('standard SELL needs only CTF → Exchange V2', () => {
    expect(requiredApprovalFlags('standard_sell')).toEqual(['ctfToExchange']);
  });

  it('weather / neg-risk BUY needs only pUSD → NegRiskAdapter', () => {
    expect(requiredApprovalFlags('neg_risk_buy')).toEqual(['pusdToAdapter']);
  });

  it('weather / neg-risk SELL needs only CTF → NegRiskAdapter', () => {
    expect(requiredApprovalFlags('neg_risk_sell')).toEqual(['ctfToAdapter']);
  });

  it('does not require unrelated spenders for a weather BUY', () => {
    const required = requiredApprovalFlags('neg_risk_buy');
    const extras: ApprovalFlag[] = [
      'pusdToCtf',
      'pusdToExchange',
      'pusdToNegRisk',
      'ctfToExchange',
      'ctfToNegRisk',
      'ctfToAdapter',
    ];
    expect(extras.some((flag) => required.includes(flag))).toBe(false);
  });

  it('does not require adapter spenders for a standard BUY', () => {
    const required = requiredApprovalFlags('standard_buy');
    expect(required).not.toContain('pusdToAdapter');
    expect(required).not.toContain('ctfToAdapter');
    expect(required).not.toContain('pusdToNegRisk');
    expect(required).not.toContain('ctfToNegRisk');
  });
});

describe('allClobApprovalsGranted', () => {
  it('returns true when only the required weather-BUY flag is set', () => {
    const required = requiredApprovalFlags('neg_risk_buy');
    expect(allClobApprovalsGranted(noneGranted({ pusdToAdapter: true }), required)).toBe(
      true,
    );
  });

  it('returns false when the required weather-BUY flag is missing even if the other six are set', () => {
    const required = requiredApprovalFlags('neg_risk_buy');
    expect(allClobApprovalsGranted(granted({ pusdToAdapter: false }), required)).toBe(
      false,
    );
  });

  it('ignores missing CTF→adapter and Exchange V2 flags for a weather BUY', () => {
    const required = requiredApprovalFlags('neg_risk_buy');
    expect(
      allClobApprovalsGranted(
        noneGranted({
          pusdToAdapter: true,
          ctfToAdapter: false,
          pusdToExchange: false,
          ctfToExchange: false,
        }),
        required,
      ),
    ).toBe(true);
  });

  it('returns true when only the required standard-BUY flag is set', () => {
    const required = requiredApprovalFlags('standard_buy');
    expect(allClobApprovalsGranted(noneGranted({ pusdToExchange: true }), required)).toBe(
      true,
    );
  });

  it('returns false when adapter is granted but standard Exchange V2 pUSD is missing', () => {
    const required = requiredApprovalFlags('standard_buy');
    expect(
      allClobApprovalsGranted(
        noneGranted({ pusdToAdapter: true, ctfToAdapter: true }),
        required,
      ),
    ).toBe(false);
  });

  it('returns true when only the required weather-SELL flag is set', () => {
    const required = requiredApprovalFlags('neg_risk_sell');
    expect(allClobApprovalsGranted(noneGranted({ ctfToAdapter: true }), required)).toBe(
      true,
    );
  });

  it('returns true when only the required standard-SELL flag is set', () => {
    const required = requiredApprovalFlags('standard_sell');
    expect(allClobApprovalsGranted(noneGranted({ ctfToExchange: true }), required)).toBe(
      true,
    );
  });
});

describe('buildMissingApprovalCalls', () => {
  it('weather BUY with no flags set submits only pUSD → NegRiskAdapter', () => {
    const calls = buildMissingApprovalCalls(
      noneGranted(),
      requiredApprovalFlags('neg_risk_buy'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(POLYGON_CLOB_CONTRACTS_V2.collateral);
    expect(calls[0]?.data).toMatch(/^0x/);
    expect(calls[0]?.data.toLowerCase()).toContain(
      POLYGON_CLOB_CONTRACTS_V2.negRiskAdapter.slice(2).toLowerCase(),
    );
  });

  it('weather BUY already granted submits no calls even if other flags are missing', () => {
    const calls = buildMissingApprovalCalls(
      noneGranted({ pusdToAdapter: true }),
      requiredApprovalFlags('neg_risk_buy'),
    );
    expect(calls).toEqual([]);
  });

  it('standard BUY with no flags set submits only pUSD → Exchange V2', () => {
    const calls = buildMissingApprovalCalls(
      noneGranted(),
      requiredApprovalFlags('standard_buy'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(POLYGON_CLOB_CONTRACTS_V2.collateral);
    expect(calls[0]?.data.toLowerCase()).toContain(
      POLYGON_CLOB_CONTRACTS_V2.exchangeV2.slice(2).toLowerCase(),
    );
  });

  it('weather SELL with no flags set submits only CTF → NegRiskAdapter', () => {
    const calls = buildMissingApprovalCalls(
      noneGranted(),
      requiredApprovalFlags('neg_risk_sell'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(POLYGON_CLOB_CONTRACTS_V2.conditionalTokens);
    expect(calls[0]?.data.toLowerCase()).toContain(
      POLYGON_CLOB_CONTRACTS_V2.negRiskAdapter.slice(2).toLowerCase(),
    );
  });

  it('standard SELL with no flags set submits only CTF → Exchange V2', () => {
    const calls = buildMissingApprovalCalls(
      noneGranted(),
      requiredApprovalFlags('standard_sell'),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(POLYGON_CLOB_CONTRACTS_V2.conditionalTokens);
    expect(calls[0]?.data.toLowerCase()).toContain(
      POLYGON_CLOB_CONTRACTS_V2.exchangeV2.slice(2).toLowerCase(),
    );
  });
});